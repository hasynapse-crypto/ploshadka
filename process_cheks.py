"""
Автоматический процессор чеков взносов для проекта «Площадка».
- Сканирует папку cheks/
- Проверяет на дубликаты (хэш SHA-256 файла + проверка онлайн-таблицы Google Sheets)
- Извлекает дом и квартиру из имени файла (..._Дом-Кв.*)
- Сохраняет историю в cheks/processed.json
- Генерирует готовые строки для вставки в лист «Приход» (в cheks/new_rows_to_paste.txt)
"""

import os
import re
import json
import hashlib
import urllib.request

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
CHEKS_DIR = os.path.join(PROJECT_DIR, 'cheks')
PROCESSED_FILE = os.path.join(CHEKS_DIR, 'processed.json')
CONFIG_FILE = os.path.join(PROJECT_DIR, 'config.js')
OUTPUT_TXT = os.path.join(CHEKS_DIR, 'new_rows_to_paste.txt')

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

def extract_house_flat_from_filename(filename):
    matches = re.findall(r'(\d+)-(\d+)', filename)
    if matches:
        return matches[-1][0], matches[-1][1]
    return None, None

# База известных чеков (можно расширять регулярными выражениями / OCR)
KNOWN_CHEKS = {
    "53-7": {
        "date": "06.11.2026",
        "amount": 1500000,
        "method": "карта",
        "details": "21:14 · Payme (*5036) · Оплачен"
    },
    "54-36": {
        "date": "05.11.2026",
        "amount": 500000,
        "method": "карта",
        "details": "03:33 · Банк перевод · Успешно"
    },
    "54-32": {
        "date": "06.11.2026",
        "amount": 1000000,
        "method": "карта",
        "details": "19:29 · Банк (*1005) · Успешно"
    },
    "51-15": {
        "date": "05.11.2026",
        "amount": 300000,
        "method": "карта",
        "details": "20:46 · Банк (*6137) · Успешно"
    },
    "52-11": {
        "date": "05.11.2026",
        "amount": 300000,
        "method": "карта",
        "details": "18:54 · Payme (*8766) · Оплачен"
    },
    "52-10": {
        "date": "05.11.2026",
        "amount": 1500000,
        "method": "карта",
        "details": "17:58 · Click (*6548) · Оплачен"
    }
}

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
    print("  АВТОМАТИЧЕСКАЯ ОБРАБОТКА ЧЕКОВ ВЗНОСОВ")
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

        key_pair = f"{house}-{flat}"
        info = KNOWN_CHEKS.get(key_pair)
        if not info:
            print(f"[НОВЫЙ НЕИЗВЕСТНЫЙ ЧЕК] {filename} (д. {house}, кв. {flat}) — требует указания суммы.")
            continue

        date_str = info["date"]
        amount = info["amount"]
        method = info["method"]
        details = info["details"]

        # 1. Проверка: был ли файл уже обработан по хэшу?
        if file_hash in processed:
            print(f"[ПРОПУСК] Файл уже был обработан ранее: {filename} (Дом {house}, кв. {flat})")
            skipped_count += 1
            continue

        # 2. Проверка: есть ли уже такая запись в Google Таблице?
        txn_key = f"{house.lower()}::{flat.lower()}::{date_str}::{amount}"
        if txn_key in live_existing:
            print(f"[ПРОПУСК / ДУБЛИКАТ] Запись уже присутствует в Google Таблице: Дом {house}, кв. {flat}, {amount:,} сум на дату {date_str}!")
            # Сохраняем в реестр, чтобы больше не проверять
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
        print(f"[НОВЫЙ ВЗНОС] + Дом {house}, кв. {flat}: {amount:,} сум ({details})")
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
    else:
        print("\nВсе чеки уже учтены, новых записей нет.")

if __name__ == '__main__':
    main()
