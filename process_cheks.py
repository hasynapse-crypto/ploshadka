"""
Автоматический процессор чеков взносов для проекта «Площадка».
- Сканирует папку cheks/
- Проверяет на дубликаты (хэш SHA-256 файла + проверка онлайн-таблицы Google Sheets)
- Извлекает дом и квартиру из имени файла (..._Дом-Кв.*)
- Автоматически распознает чек (OCR для картинок + парсер для PDF)
- Извлекает сумму, дату, платежную систему и маску карты
- Сохраняет историю в cheks/processed.json
- Генерирует готовые строки для вставки в лист «Приход» (в cheks/new_rows_to_paste.txt)
- Автоматически открывает Блокнот с новыми строками для вставки в Google Sheets
"""

import os
import re
import sys
import json
import hashlib
import urllib.request
from datetime import datetime

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
CHEKS_DIR = os.path.join(PROJECT_DIR, 'cheks')
PROCESSED_FILE = os.path.join(CHEKS_DIR, 'processed.json')
CONFIG_FILE = os.path.join(PROJECT_DIR, 'config.js')
OUTPUT_TXT = os.path.join(CHEKS_DIR, 'new_rows_to_paste.txt')

FUND_CARD = "6137"

MONTH_MAP = {
    'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04',
    'май': '05', 'мая': '05', 'июн': '06', 'июл': '07',
    'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'h09': '11',
    'дек': '12'
}

# Ручные переопределения (если когда-либо понадобятся)
KNOWN_CHEKS = {
}

_OCR_ENGINE = None

def get_ocr_engine():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _OCR_ENGINE = RapidOCR()
        except ImportError:
            print("[ВНИМАНИЕ] Для OCR установите: pip install rapidocr-onnxruntime pypdf")
            return None
    return _OCR_ENGINE

def clean_amount(val_str):
    cleaned = val_str.replace(' ', '').replace(',', '').strip()
    if '.' in cleaned:
        parts = cleaned.split('.')
        if len(parts) == 2 and (len(parts[1]) == 2 or parts[1] == '0' or parts[1] == '00'):
            cleaned = parts[0]
    try:
        amt = int(re.sub(r'[^\d]', '', cleaned))
        return amt
    except Exception:
        return 0

def extract_text_from_file(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext == '.pdf':
        text = ""
        try:
            from pypdf import PdfReader
            reader = PdfReader(filepath)
            for page in reader.pages:
                text += (page.extract_text() or "") + "\n"
        except Exception:
            text = ""
        if text.strip():
            return text
        engine = get_ocr_engine()
        if engine:
            try:
                from pypdf import PdfReader
                reader = PdfReader(filepath)
                for page in reader.pages:
                    for img_obj in page.images:
                        res, _ = engine(img_obj.data)
                        if res:
                            text += "\n".join([r[1] for r in res]) + "\n"
            except Exception:
                pass
        return text
    else:
        engine = get_ocr_engine()
        if engine:
            res, _ = engine(filepath)
            if res:
                return "\n".join([r[1] for r in res])
        return ""

def extract_house_flat_from_filename(filename):
    matches = re.findall(r'(\d+)-(\d+)', filename)
    if matches:
        return matches[-1][0], matches[-1][1]
    return None, None

def parse_receipt(filepath, filename):
    raw_text = extract_text_from_file(filepath)
    norm_text = raw_text.replace('\r', ' ')
    lines = [line.strip() for line in norm_text.splitlines() if line.strip()]

    house, flat = extract_house_flat_from_filename(filename)

    # 1. Дата
    date_str = None
    m_date = re.search(r'\b(\d{2})[./](\d{2})[./](\d{4})\b', norm_text)
    if m_date:
        date_str = f"{m_date.group(1)}.{m_date.group(2)}.{m_date.group(3)}"
    else:
        m_month = re.search(r'(\d{1,2})\s*([a-zA-Zа-яА-Я0-9]{3,8}?)(?:202[4-9]|\b)', norm_text)
        if m_month:
            day = m_month.group(1).zfill(2)
            mon_raw = m_month.group(2).lower()
            mon = None
            for k, v in MONTH_MAP.items():
                if k in mon_raw:
                    mon = v
                    break
            if mon:
                m_year = re.search(r'\b(202[4-9])\b', norm_text)
                year = m_year.group(1) if m_year else "2026"
                date_str = f"{day}.{mon}.{year}"

    if not date_str:
        m_fn_ymd = re.search(r'(202[4-9])-(\d{2})-(\d{2})', filename)
        if m_fn_ymd:
            date_str = f"{m_fn_ymd.group(3)}.{m_fn_ymd.group(2)}.{m_fn_ymd.group(1)}"
        else:
            m_fn_dmy = re.search(r'(\d{2})-(\d{2})-(202[4-9])', filename)
            if m_fn_dmy:
                date_str = f"{m_fn_dmy.group(1)}.{m_fn_dmy.group(2)}.{m_fn_dmy.group(3)}"

    if not date_str:
        date_str = datetime.now().strftime("%d.%m.%Y")

    # 2. Сумма
    candidates = []
    for i, line in enumerate(lines):
        m_curr = re.findall(r'(\d[0-9\s,.]*?)\s*(?:UZS|cyM|сум|so\'?m)', line, re.IGNORECASE)
        for c in m_curr:
            amt = clean_amount(c)
            if 50000 <= amt <= 15000000 and len(str(amt)) <= 8:
                weight = 10
                if any(w in line.lower() for w in ['итого', 'vtoro', 'сумма', 'cymma', 'receiveramount', 'перевод']):
                    weight += 5
                if amt % 50000 == 0:
                    weight += 3
                candidates.append((amt, weight))
        
        clean_num = re.sub(r'[^\d]', '', line)
        if clean_num and 50000 <= int(clean_num) <= 15000000 and len(clean_num) <= 8:
            val = int(clean_num)
            surr = ' '.join(lines[max(0, i-2):min(len(lines), i+3)]).lower()
            if any(w in surr for w in ['uzs', 'cym', 'сум', 'vtoro', 'итого', 'сумма', 'cymma', 'перевод']):
                weight = 8
                if val % 50000 == 0:
                    weight += 3
                candidates.append((val, weight))

    if candidates:
        candidates.sort(key=lambda x: (x[1], x[0]), reverse=True)
        clean_multiples = [c[0] for c in candidates if c[0] % 50000 == 0]
        if clean_multiples:
            amount = clean_multiples[0]
        else:
            amount = candidates[0][0]
    else:
        amount = 0

    # 3. Время
    m_time = re.search(r'\b([012]?\d:[0-5]\d)(?::[0-5]\d)?\b', norm_text)
    time_str = m_time.group(1) if m_time else ""

    # 4. Платежная система
    service = "Банк"
    text_lower = norm_text.lower()
    if 'click' in text_lower:
        service = "Click"
    elif 'payme' in text_lower:
        service = "Payme"
    elif 'uzum' in text_lower or 'unum' in text_lower:
        service = "Uzum Bank"
    elif 'ipak' in text_lower or 'yuli' in text_lower:
        service = "Ipak Yuli"

    # 5. Маска карты (исключаем карту сбора 6137)
    card_candidates = []
    for m in re.finditer(r'(?:\*+|U\*+|\b[Сс]\s*[ĸkк]арты\D*|\bSender\D*|\bKapTa\s*OTnpaBNTenA\D*)(\d{4})\b', norm_text, re.IGNORECASE):
        c = m.group(1)
        if c != FUND_CARD and c not in ['2026', '2025', '2024']:
            card_candidates.append(c)

    if not card_candidates:
        for m in re.finditer(r'\b(\d{4})\b', norm_text):
            c = m.group(1)
            if c != FUND_CARD and c not in ['2026', '2025', '2024', '0000', '1854', '2114', '1758', '1929', '2046', '1857', '0303']:
                if not card_candidates:
                    card_candidates.append(c)

    card_mask = f"(*{card_candidates[0]})" if card_candidates else ""

    # 6. Детали
    status = "Оплачен" if service in ["Payme", "Click"] else "Успешно"
    detail_parts = []
    if time_str:
        detail_parts.append(time_str)
    if card_mask:
        detail_parts.append(f"{service} {card_mask}")
    else:
        detail_parts.append(service)
    detail_parts.append(status)

    details = " · ".join(detail_parts)

    return {
        "house": house,
        "flat": flat,
        "date": date_str,
        "amount": amount,
        "method": "карта",
        "details": details
    }

def get_file_hash(filepath):
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def get_prihod_url():
    if not os.path.exists(CONFIG_FILE):
        return None
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    m = re.search(r"prihodUrl\s*:\s*['\"]([^'\"]+)['\"]", content)
    return m.group(1) if m else None

def fetch_live_prihod_keys():
    """Возвращает множество существующих записей (house, flat, date, amount) из Google Таблицы."""
    url = get_prihod_url()
    if not url or url.startswith('data/'):
        return set()
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as res:
            text = res.read().decode('utf-8')
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        existing = set()
        for line in lines[1:]: # пропускаем заголовок
            parts = [p.strip().strip('"') for p in line.split(',')]
            if len(parts) >= 4:
                date_str, house, flat, amount_str = parts[0], parts[1], parts[2], parts[3]
                amt_clean = re.sub(r'[^\d]', '', amount_str)
                amt = int(amt_clean) if amt_clean else 0
                key = f"{house.lower()}::{flat.lower()}::{date_str}::{amt}"
                existing.add(key)
        return existing
    except Exception as e:
        print(f"Примечание: Не удалось получить live-данные из таблицы ({e}), проверка только по локальной истории.")
        return set()

def load_processed():
    if os.path.exists(PROCESSED_FILE):
        try:
            with open(PROCESSED_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_processed(data):
    with open(PROCESSED_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    if not os.path.exists(CHEKS_DIR):
        print(f"Папка {CHEKS_DIR} не найдена.")
        return

    processed = load_processed()
    live_existing = fetch_live_prihod_keys()

    new_rows = []
    skipped_count = 0
    added_count = 0

    files = [f for f in os.listdir(CHEKS_DIR) if not f.startswith('.') and f != 'processed.json' and f != 'new_rows_to_paste.txt']

    print("=" * 65)
    print("  АВТОМАТИЧЕСКАЯ ОБРАБОТКА ЧЕКОВ ВЗНОСОВ (OCR + АВТОПРОВЕРКА)")
    print("=" * 65)

    for filename in sorted(files):
        filepath = os.path.join(CHEKS_DIR, filename)
        if not os.path.isfile(filepath):
            continue

        file_hash = get_file_hash(filepath)
        house, flat = extract_house_flat_from_filename(filename)

        if not house or not flat:
            print(f"[ПРЕДУПРЕЖДЕНИЕ] Не удалось определить дом и квартиру из имени: {filename}")
            continue

        # 1. Проверка: был ли файл уже обработан по хэшу?
        if file_hash in processed:
            print(f"[ПРОПУСК] Файл уже был обработан ранее: {filename} (Дом {house}, кв. {flat})")
            skipped_count += 1
            continue

        # 2. Получение данных чека (ручное переопределение или автоматический OCR/PDF)
        key_pair = f"{house}-{flat}"
        info = KNOWN_CHEKS.get(key_pair)
        if info and info.get("amount", 0) > 0:
            date_str = info["date"]
            amount = info["amount"]
            method = info.get("method", "карта")
            details = info.get("details", "")
        else:
            parsed = parse_receipt(filepath, filename)
            date_str = parsed["date"]
            amount = parsed["amount"]
            method = parsed["method"]
            details = parsed["details"]

        if amount <= 0:
            print(f"[ТРЕБУЕТСЯ ПРОВЕРКА] {filename} (д. {house}, кв. {flat}) — сумма не распознана.")
            continue

        # 3. Проверка: есть ли уже такая запись в Google Таблице?
        txn_key = f"{house.lower()}::{flat.lower()}::{date_str}::{amount}"
        if txn_key in live_existing:
            print(f"[ПРОПУСК / ДУБЛИКАТ] Запись уже присутствует в Google Таблице: Дом {house}, кв. {flat}, {amount:,} сум на дату {date_str}!")
            processed[file_hash] = {
                "filename": filename,
                "house": house,
                "flat": flat,
                "amount": amount,
                "date": date_str,
                "details": details,
                "note": "Уже было в Google Таблице"
            }
            skipped_count += 1
            continue

        # Новый чек!
        print(f"[НОВЫЙ ВЗНОС] + Дом {house}, кв. {flat}: {amount:,} сум | {date_str} ({details})")
        new_rows.append((date_str, house, flat, amount, method, details))

        processed[file_hash] = {
            "filename": filename,
            "house": house,
            "flat": flat,
            "amount": amount,
            "date": date_str,
            "details": details
        }
        added_count += 1

    save_processed(processed)

    print("-" * 65)
    print(f"Обработка завершена. Новых чеков: {added_count}, пропущено дубликатов: {skipped_count}")

    if new_rows:
        print("\nГОТОВЫЕ СТРОКИ ДЛЯ ВСТАВКИ В ЛИСТ «Приход» В GOOGLE ТАБЛИЦЕ:")
        print("Дата\tДом\tКвартира\tСумма\tСпособ\tДетали")
        lines_to_save = []
        for r in new_rows:
            tsv_line = f"{r[0]}\t{r[1]}\t{r[2]}\t{r[3]}\t{r[4]}\t{r[5]}"
            lines_to_save.append(tsv_line)
            print(tsv_line)

        with open(OUTPUT_TXT, 'w', encoding='utf-8') as f:
            f.write("\n".join(lines_to_save) + "\n")
        print(f"\nТакже строки сохранены в файл: {OUTPUT_TXT}")
        print("Открываем Блокнот с новыми строками (скопируйте и вставьте в лист «Приход»)...")
        try:
            import subprocess
            subprocess.Popen(['notepad.exe', OUTPUT_TXT])
        except Exception:
            pass
    else:
        if os.path.exists(OUTPUT_TXT):
            try:
                os.remove(OUTPUT_TXT)
            except Exception:
                pass
        print("\nВсе чеки уже учтены, новых записей нет.")

if __name__ == '__main__':
    main()
