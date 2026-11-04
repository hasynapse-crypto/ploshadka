(function () {
  'use strict';

  /**
   * Разбирает CSV-текст с поддержкой запятых, кавычек ("") и переносов строк внутри ячеек.
   * Возвращает массив непустых строк (каждая строка — массив значений ячеек).
   */
  function parseCSV(text) {
    if (!text) return [];
    const cleaned = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      const next = cleaned[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(cell);
          cell = '';
        } else if (ch === '\r' && next === '\n') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          row.push(cell);
          rows.push(row);
          row = [];
          cell = '';
        } else {
          cell += ch;
        }
      }
    }

    row.push(cell);
    rows.push(row);

    return rows.filter(function (r) {
      return r.some(function (val) {
        return String(val).trim() !== '';
      });
    });
  }

  /**
   * Преобразует строку с суммой в число (удаляет пробелы, неразрывные пробелы и «сум»).
   */
  function parseAmount(value) {
    if (value === null || value === undefined) return 0;
    const cleaned = String(value)
      .replace(/сум/gi, '')
      .replace(/[\s\u00A0\u202F]/g, '')
      .replace(',', '.')
      .trim();
    if (!cleaned) return 0;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
  }

  /**
   * Форматирует число в вид «7 752 000 сум».
   */
  function formatNumber(num) {
    const rounded = Math.round(Number(num) || 0);
    const sign = rounded < 0 ? '−' : '';
    const absStr = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return sign + absStr;
  }

  function formatSum(num) {
    return formatNumber(num) + ' сум';
  }

  /**
   * Разбирает дату формата ДД.ММ.ГГГГ в объект Date.
   * Возвращает null, если дата пустая или некорректная.
   */
  function parseRuDate(str) {
    if (!str) return null;
    const trimmed = String(str).trim();
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function formatRuDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return dd + '.' + mm + '.' + yyyy;
  }

  /**
   * Сортирует массив записей по дате (новые сверху).
   * Записи с нераспознанной датой помещаются в конец списка.
   */
  function sortByDateDesc(items) {
    return items.slice().sort(function (a, b) {
      if (a.dateObj && b.dateObj) {
        return b.dateObj.getTime() - a.dateObj.getTime();
      }
      if (a.dateObj && !b.dateObj) return -1;
      if (!a.dateObj && b.dateObj) return 1;
      return 0;
    });
  }

  /**
   * Извлекает ID файла из ссылки Google Диска.
   */
  function extractDriveFileId(url) {
    if (!url) return null;
    const trimmed = String(url).trim();
    const fileMatch = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
    if (fileMatch) return fileMatch[1];
    const idMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(trimmed);
    if (idMatch) return idMatch[1];
    return null;
  }

  function buildPhotoUrls(rawUrl) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;
    const fileId = extractDriveFileId(trimmed);
    if (fileId) {
      return {
        thumbUrl: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1000',
        openUrl: 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/view'
      };
    }
    return {
      thumbUrl: trimmed,
      openUrl: trimmed
    };
  }

  function pluralizeApartments(n) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'Сдали ' + n + ' квартир';
    if (last === 1) return 'Сдала ' + n + ' квартира';
    if (last >= 2 && last <= 4) return 'Сдали ' + n + ' квартиры';
    return 'Сдали ' + n + ' квартир';
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Обрабатывает 4 CSV-текста и возвращает готовую модель для отрисовки.
   */
  function buildReportModel(csvTexts) {
    // 1. Смета
    const smetaRows = parseCSV(csvTexts.smeta).slice(1);
    const materials = [];
    const works = [];
    const otherSmeta = [];
    let materialsSum = 0;
    let worksSum = 0;
    let totalGoal = 0;

    smetaRows.forEach(function (r) {
      const sectionRaw = (r[0] || '').trim();
      const sectionKey = sectionRaw.toLowerCase();
      const title = (r[1] || '').trim();
      const qty = (r[2] || '').trim();
      const unit = (r[3] || '').trim();
      const price = parseAmount(r[4]);
      const sum = parseAmount(r[5]);

      if (!title && sum === 0) return;

      const item = {
        section: sectionRaw,
        title: title,
        qty: qty,
        unit: unit,
        price: price,
        sum: sum
      };

      totalGoal += sum;
      if (sectionKey === 'материалы') {
        materials.push(item);
        materialsSum += sum;
      } else if (sectionKey === 'работы') {
        works.push(item);
        worksSum += sum;
      } else {
        otherSmeta.push(item);
      }
    });

    // 2. Приход (Дата, Дом, Квартира, Сумма, Способ)
    const prihodRows = parseCSV(csvTexts.prihod).slice(1);
    const prihodItems = [];
    const uniqueApartments = new Set();
    let totalCollected = 0;

    prihodRows.forEach(function (r) {
      const dateStr = (r[0] || '').trim();
      const house = (r[1] || '').trim();
      const flat = (r[2] || '').trim();
      const amount = parseAmount(r[3]);
      const method = (r[4] || '').trim();

      if (!dateStr && !house && !flat && amount === 0) return;

      totalCollected += amount;

      const houseNorm = house.toLowerCase();
      const flatNorm = flat.toLowerCase();
      if (houseNorm || flatNorm) {
        uniqueApartments.add(houseNorm + '::' + flatNorm);
      }

      prihodItems.push({
        dateStr: dateStr,
        dateObj: parseRuDate(dateStr),
        house: house,
        flat: flat,
        amount: amount,
        method: method
      });
    });

    const sortedPrihod = sortByDateDesc(prihodItems);

    // 3. Расход (Дата, На что, Сумма, Чек)
    const rashodRows = parseCSV(csvTexts.rashod).slice(1);
    const rashodItems = [];
    let totalSpent = 0;

    rashodRows.forEach(function (r) {
      const dateStr = (r[0] || '').trim();
      const title = (r[1] || '').trim();
      const amount = parseAmount(r[2]);
      const receiptRaw = (r[3] || '').trim();

      if (!dateStr && !title && amount === 0 && !receiptRaw) return;

      totalSpent += amount;
      const receiptLinks = buildPhotoUrls(receiptRaw);

      rashodItems.push({
        dateStr: dateStr,
        dateObj: parseRuDate(dateStr),
        title: title,
        amount: amount,
        receiptUrl: receiptLinks ? receiptLinks.openUrl : ''
      });
    });

    const sortedRashod = sortByDateDesc(rashodItems);

    // 4. Самая поздняя дата из «Прихода» и «Расхода»
    let latestDate = null;
    prihodItems.concat(rashodItems).forEach(function (item) {
      if (item.dateObj) {
        if (!latestDate || item.dateObj.getTime() > latestDate.getTime()) {
          latestDate = item.dateObj;
        }
      }
    });

    // 5. Фото (Тип, Подпись, Ссылка)
    const fotoRows = parseCSV(csvTexts.foto).slice(1);
    const smetaPhotos = [];
    const beforeAfterPhotos = [];

    fotoRows.forEach(function (r) {
      const typeRaw = (r[0] || '').trim();
      const typeKey = typeRaw.toLowerCase();
      const caption = (r[1] || '').trim();
      const linkRaw = (r[2] || '').trim();
      const urls = buildPhotoUrls(linkRaw);
      if (!urls) return;

      const photoItem = {
        type: typeRaw,
        typeKey: typeKey,
        caption: caption,
        thumbUrl: urls.thumbUrl,
        openUrl: urls.openUrl
      };

      if (typeKey === 'смета') {
        smetaPhotos.push(photoItem);
      } else {
        beforeAfterPhotos.push(photoItem);
      }
    });

    // 6. Итоги и прогресс
    const balance = totalCollected - totalSpent;
    const rawPercent = totalGoal > 0 ? Math.round((totalCollected / totalGoal) * 100) : 0;
    const barWidthPercent = totalGoal > 0
      ? Math.min(100, Math.max(0, (totalCollected / totalGoal) * 100))
      : 0;
    const remaining = Math.max(0, totalGoal - totalCollected);
    const overGoal = Math.max(0, totalCollected - totalGoal);

    return {
      latestDateStr: latestDate ? formatRuDate(latestDate) : null,
      totalGoal: totalGoal,
      totalCollected: totalCollected,
      totalSpent: totalSpent,
      balance: balance,
      rawPercent: rawPercent,
      barWidthPercent: barWidthPercent,
      remaining: remaining,
      overGoal: overGoal,
      apartmentsCount: uniqueApartments.size,
      materials: materials,
      materialsSum: materialsSum,
      works: works,
      worksSum: worksSum,
      otherSmeta: otherSmeta,
      prihod: sortedPrihod,
      rashod: sortedRashod,
      smetaPhotos: smetaPhotos,
      beforeAfterPhotos: beforeAfterPhotos
    };
  }

  function renderSmetaGroup(title, items, subtotal) {
    if (!items.length) return '';
    const rowsHtml = items.map(function (item) {
      let detail = '';
      if (item.qty && item.price > 0) {
        const unitStr = item.unit ? ' ' + escapeHtml(item.unit) : '';
        detail = '<span class="sub-detail">' +
          escapeHtml(item.qty) + unitStr + ' × ' + formatNumber(item.price) +
          '</span>';
      } else if (item.qty) {
        const unitStr = item.unit ? ' ' + escapeHtml(item.unit) : '';
        detail = '<span class="sub-detail">' + escapeHtml(item.qty) + unitStr + '</span>';
      }
      return '<tr>' +
        '<td>' + escapeHtml(item.title) + detail + '</td>' +
        '<td class="num">' + formatSum(item.sum) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="smeta-group">' +
      '<h3 class="smeta-group-title">' + escapeHtml(title) + '</h3>' +
      '<div class="table-wrap">' +
        '<table>' +
          '<thead><tr><th>Позиция</th><th class="num">Сумма</th></tr></thead>' +
          '<tbody>' +
            rowsHtml +
            '<tr class="subtotal-row">' +
              '<td>Итого ' + escapeHtml(title.toLowerCase()) + '</td>' +
              '<td class="num">' + formatSum(subtotal) + '</td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  function renderPhotosGrid(photos, showTypeTag) {
    return photos.map(function (p) {
      const tagHtml = showTypeTag && p.type
        ? '<span class="photo-tag">' + escapeHtml(p.type) + '</span>'
        : '';
      const captionHtml = p.caption
        ? '<span>' + escapeHtml(p.caption) + '</span>'
        : '';
      return '<div class="photo-card">' +
        '<a class="photo-link-preview" href="' + escapeHtml(p.openUrl) + '" target="_blank" rel="noopener noreferrer">' +
          '<img src="' + escapeHtml(p.thumbUrl) + '" alt="' + escapeHtml(p.caption || 'Фото') + '" loading="lazy">' +
        '</a>' +
        '<div class="photo-meta">' +
          tagHtml +
          captionHtml +
          '<a class="photo-open-link" href="' + escapeHtml(p.openUrl) + '" target="_blank" rel="noopener noreferrer">Открыть фото ↗</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderReport(model) {
    // 1. Шапка: «Данные на ДД.ММ.ГГГГ»
    const updatedEl = document.getElementById('updated-at');
    if (model.latestDateStr) {
      updatedEl.textContent = 'Данные на ' + model.latestDateStr;
      updatedEl.hidden = false;
    } else {
      updatedEl.hidden = true;
    }

    // 2. Прогресс сбора
    const progressTitle = document.getElementById('progress-title');
    progressTitle.textContent =
      'Собрано ' + formatNumber(model.totalCollected) +
      ' из ' + formatSum(model.totalGoal) +
      ' (' + model.rawPercent + '%)';

    const barTrack = document.getElementById('progress-bar-track');
    const barFill = document.getElementById('progress-bar-fill');
    barFill.style.width = model.barWidthPercent.toFixed(1) + '%';
    barTrack.setAttribute('aria-valuenow', String(Math.round(model.barWidthPercent)));

    const remainingEl = document.getElementById('progress-remaining');
    if (model.overGoal > 0 && model.totalGoal > 0) {
      remainingEl.textContent = 'Осталось собрать: 0 сум (сверх цели: +' + formatSum(model.overGoal) + ')';
    } else {
      remainingEl.textContent = 'Осталось собрать: ' + formatSum(model.remaining);
    }

    // 3. Три карточки
    document.getElementById('stat-collected').textContent = formatSum(model.totalCollected);
    document.getElementById('stat-spent').textContent = formatSum(model.totalSpent);
    document.getElementById('stat-balance').textContent = formatSum(model.balance);

    // 4. Смета и фото сметы мастера
    const smetaContent = document.getElementById('smeta-content');
    if (!model.materials.length && !model.works.length && !model.otherSmeta.length) {
      smetaContent.innerHTML = '<p class="empty-state">Пока нет записей</p>';
    } else {
      const otherSum = model.otherSmeta.reduce(function (acc, i) { return acc + i.sum; }, 0);
      smetaContent.innerHTML =
        renderSmetaGroup('Материалы', model.materials, model.materialsSum) +
        renderSmetaGroup('Работы', model.works, model.worksSum) +
        renderSmetaGroup('Прочее', model.otherSmeta, otherSum) +
        '<div class="smeta-total">' +
          '<span>Всего по смете</span>' +
          '<span>' + formatSum(model.totalGoal) + '</span>' +
        '</div>';
    }

    const smetaBtn = document.getElementById('toggle-smeta-photos');
    const smetaPhotosBox = document.getElementById('smeta-photos-box');
    if (model.smetaPhotos.length > 0) {
      smetaBtn.hidden = false;
      smetaPhotosBox.innerHTML = renderPhotosGrid(model.smetaPhotos, false);
      smetaBtn.onclick = function () {
        const isHidden = smetaPhotosBox.hidden;
        smetaPhotosBox.hidden = !isHidden;
        smetaBtn.textContent = isHidden ? 'Скрыть фото сметы' : 'Фото сметы мастера';
      };
    } else {
      smetaBtn.hidden = true;
      smetaPhotosBox.hidden = true;
    }

    // 5. Взносы
    document.getElementById('apartments-count').textContent = pluralizeApartments(model.apartmentsCount);
    const prihodContent = document.getElementById('prihod-content');
    if (!model.prihod.length) {
      prihodContent.innerHTML = '<p class="empty-state">Пока нет записей</p>';
    } else {
      const rows = model.prihod.map(function (item) {
        return '<tr>' +
          '<td>' + escapeHtml(item.dateStr || '—') + '</td>' +
          '<td>' + escapeHtml(item.house || '—') + '</td>' +
          '<td>' + escapeHtml(item.flat || '—') + '</td>' +
          '<td class="num">' + formatSum(item.amount) + '</td>' +
          '<td>' + escapeHtml(item.method || '—') + '</td>' +
        '</tr>';
      }).join('');
      prihodContent.innerHTML =
        '<div class="table-wrap">' +
          '<table>' +
            '<thead><tr><th>Дата</th><th>Дом</th><th>Кв.</th><th class="num">Сумма</th><th>Способ</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    // 6. Расходы
    const rashodContent = document.getElementById('rashod-content');
    if (!model.rashod.length) {
      rashodContent.innerHTML = '<p class="empty-state">Пока нет записей</p>';
    } else {
      const rows = model.rashod.map(function (item) {
        const receiptCell = item.receiptUrl
          ? '<a class="btn-link" href="' + escapeHtml(item.receiptUrl) + '" target="_blank" rel="noopener noreferrer">Чек</a>'
          : '—';
        return '<tr>' +
          '<td>' + escapeHtml(item.dateStr || '—') + '</td>' +
          '<td>' + escapeHtml(item.title || '—') + '</td>' +
          '<td class="num">' + formatSum(item.amount) + '</td>' +
          '<td class="num">' + receiptCell + '</td>' +
        '</tr>';
      }).join('');
      rashodContent.innerHTML =
        '<div class="table-wrap">' +
          '<table>' +
            '<thead><tr><th>Дата</th><th>На что</th><th class="num">Сумма</th><th class="num">Чек</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    // 7. Фото «до / после»
    const fotoContent = document.getElementById('foto-content');
    if (!model.beforeAfterPhotos.length) {
      fotoContent.innerHTML = '<p class="empty-state">Пока нет записей</p>';
    } else {
      fotoContent.innerHTML = '<div class="photos-grid">' +
        renderPhotosGrid(model.beforeAfterPhotos, true) +
        '</div>';
    }
  }

  function fetchCSV(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' for ' + url);
      }
      return res.text();
    });
  }

  function initBrowser() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof CONFIG === 'undefined') return;

    Promise.all([
      fetchCSV(CONFIG.smetaUrl),
      fetchCSV(CONFIG.prihodUrl),
      fetchCSV(CONFIG.rashodUrl),
      fetchCSV(CONFIG.fotoUrl)
    ])
      .then(function (results) {
        const model = buildReportModel({
          smeta: results[0],
          prihod: results[1],
          rashod: results[2],
          foto: results[3]
        });
        renderReport(model);
      })
      .catch(function (err) {
        console.error(err);
        const errorBox = document.getElementById('error-box');
        if (errorBox) errorBox.hidden = false;
      });
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initBrowser);
    } else {
      initBrowser();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseCSV: parseCSV,
      parseAmount: parseAmount,
      formatNumber: formatNumber,
      formatSum: formatSum,
      parseRuDate: parseRuDate,
      extractDriveFileId: extractDriveFileId,
      buildPhotoUrls: buildPhotoUrls,
      buildReportModel: buildReportModel,
      pluralizeApartments: pluralizeApartments
    };
  }
})();
