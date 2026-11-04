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
        ? '<span class="photo-caption">' + escapeHtml(p.caption) + '</span>'
        : '';
      return '<div class="photo-card">' +
        '<a class="photo-link-preview" href="' + escapeHtml(p.openUrl) + '" target="_blank" rel="noopener noreferrer">' +
          '<img src="' + escapeHtml(p.thumbUrl) + '" alt="' + escapeHtml(p.caption || 'Фото') + '" loading="lazy">' +
        '</a>' +
        '<div class="photo-meta">' +
          tagHtml +
          captionHtml +
          '<a class="photo-open-link" href="' + escapeHtml(p.openUrl) + '" target="_blank" rel="noopener noreferrer"><span>Открыть фото</span> ↗</a>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderReport(model) {
    // 1. Шапка: «Данные на ДД.ММ.ГГГГ»
    const updatedEl = document.getElementById('updated-at');
    if (model.latestDateStr) {
      updatedEl.textContent = 'Синхр: ' + model.latestDateStr;
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

    const percentBadge = document.getElementById('progress-percent-badge');
    if (percentBadge) {
      percentBadge.textContent = model.rawPercent + '%';
    }

    const barTrack = document.getElementById('progress-bar-track');
    const barFill = document.getElementById('progress-bar-fill');
    barFill.style.width = model.barWidthPercent.toFixed(1) + '%';
    barTrack.setAttribute('aria-valuenow', String(Math.round(model.barWidthPercent)));

    const remainingEl = document.getElementById('progress-remaining');
    if (model.overGoal > 0 && model.totalGoal > 0) {
      remainingEl.textContent = '0 сум (+ ' + formatSum(model.overGoal) + ' сверх цели)';
    } else {
      remainingEl.textContent = formatSum(model.remaining);
    }

    const statusEl = document.getElementById('progress-status-text');
    if (statusEl) {
      if (model.overGoal > 0) {
        statusEl.textContent = 'Цель перевыполнена';
        statusEl.className = 'meta-value status-active';
      } else if (model.totalCollected >= model.totalGoal && model.totalGoal > 0) {
        statusEl.textContent = 'Сбор закрыт 100%';
        statusEl.className = 'meta-value status-active';
      } else {
        statusEl.textContent = 'Идёт сбор';
        statusEl.className = 'meta-value status-active';
      }
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
        smetaBtn.innerHTML = isHidden
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>Скрыть смету</span>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span>Оригинал сметы</span>';
      };
    } else {
      smetaBtn.hidden = true;
      smetaPhotosBox.hidden = true;
    }

    // 5. Взносы
    document.getElementById('apartments-count').textContent = pluralizeApartments(model.apartmentsCount);
    const prihodContent = document.getElementById('prihod-content');
    if (!model.prihod.length) {
      prihodContent.innerHTML = '<p class="empty-state">Пока нет записей о взносах</p>';
    } else {
      const rows = model.prihod.map(function (item) {
        var methodStr = (item.method || '').toLowerCase();
        var methodBadge = '<span style="color:var(--text-dim)">—</span>';
        if (methodStr.indexOf('карт') !== -1) {
          methodBadge = '<span class="pill-method pill-card">Карта</span>';
        } else if (methodStr.indexOf('нал') !== -1) {
          methodBadge = '<span class="pill-method pill-cash">Наличные</span>';
        } else if (item.method) {
          methodBadge = '<span class="pill-method pill-cash">' + escapeHtml(item.method) + '</span>';
        }

        return '<tr>' +
          '<td class="date-cell">' + escapeHtml(item.dateStr || '—') + '</td>' +
          '<td><strong>д. ' + escapeHtml(item.house || '—') + '</strong></td>' +
          '<td>кв. ' + escapeHtml(item.flat || '—') + '</td>' +
          '<td class="num">' + formatSum(item.amount) + '</td>' +
          '<td>' + methodBadge + '</td>' +
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
      rashodContent.innerHTML = '<p class="empty-state">Пока нет записей о расходах</p>';
    } else {
      const rows = model.rashod.map(function (item) {
        const receiptCell = item.receiptUrl
          ? '<a class="btn-receipt" href="' + escapeHtml(item.receiptUrl) + '" target="_blank" rel="noopener noreferrer"><span>Чек</span> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg></a>'
          : '<span style="color:var(--text-dim)">—</span>';
        return '<tr>' +
          '<td class="date-cell">' + escapeHtml(item.dateStr || '—') + '</td>' +
          '<td>' + escapeHtml(item.title || '—') + '</td>' +
          '<td class="num">' + formatSum(item.amount) + '</td>' +
          '<td class="num">' + receiptCell + '</td>' +
        '</tr>';
      }).join('');
      rashodContent.innerHTML =
        '<div class="table-wrap">' +
          '<table>' +
            '<thead><tr><th>Дата</th><th>Назначение</th><th class="num">Сумма</th><th class="num">Чек</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    // 7. Фото «до / после»
    const fotoContent = document.getElementById('foto-content');
    if (!model.beforeAfterPhotos.length) {
      fotoContent.innerHTML = '<p class="empty-state">Фотографии будут добавлены по ходу работ</p>';
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

  function initTabs() {
    var nav = document.querySelector('.tabs-nav');
    if (!nav) return;
    var grid = document.querySelector('.dashboard-grid');
    var buttons = nav.querySelectorAll('.tab-btn');
    var sections = document.querySelectorAll('[data-section]');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        buttons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        if (tab === 'all') {
          if (grid) grid.classList.remove('tab-active-single');
          sections.forEach(function (sec) {
            sec.style.display = '';
          });
        } else {
          if (grid) grid.classList.add('tab-active-single');
          sections.forEach(function (sec) {
            if (sec.getAttribute('data-section') === tab) {
              sec.style.display = '';
            } else {
              sec.style.display = 'none';
            }
          });
        }
      });
    });
  }

  function initBeforeAfterSlider() {
    var baContainer = document.getElementById('ba-container');
    var videoWrap = document.getElementById('concept-video-wrap');
    var videoEl = document.getElementById('concept-video');
    var range = document.getElementById('ba-range');
    var beforeImg = document.getElementById('ba-before-img');
    var afterImg = document.getElementById('ba-after-img');
    var viewButtons = document.querySelectorAll('.btn-concept-view');
    var modeButtons = document.querySelectorAll('.btn-concept-mode');
    var captionText = document.getElementById('concept-caption-text');

    var currentView = 'pole';
    var currentMode = 'slider';

    function updateMedia() {
      // 1. Update source files
      if (currentView === 'pole') {
        if (beforeImg) beforeImg.src = 'pole.jpg';
        if (afterImg) afterImg.src = 'pole_concept.jpg';
        if (videoEl) {
          videoEl.src = 'pole_video.mp4';
          videoEl.poster = 'pole_concept.jpg';
        }
      } else {
        if (beforeImg) beforeImg.src = 'ploshadka.jpg';
        if (afterImg) afterImg.src = 'ploshadka_concept.jpg';
        if (videoEl) {
          videoEl.src = 'ploshadka_video.mp4';
          videoEl.poster = 'ploshadka_concept.jpg';
        }
      }

      // 2. Toggle Mode (Slider vs Video)
      if (currentMode === 'slider') {
        if (baContainer) baContainer.hidden = false;
        if (videoWrap) videoWrap.hidden = true;
        if (videoEl) videoEl.pause();
        if (captionText) {
          captionText.textContent = 'Потяните бегунок влево или вправо пальцем или мышкой, чтобы сравнить проект с текущим состоянием';
        }
      } else {
        if (baContainer) baContainer.hidden = true;
        if (videoWrap) videoWrap.hidden = false;
        if (videoEl) {
          videoEl.load();
          videoEl.play().catch(function () {});
        }
        if (captionText) {
          captionText.textContent = 'Сгенерированный ИИ динамический видеоролик реконструкции';
        }
      }
    }

    if (range && baContainer) {
      range.addEventListener('input', function () {
        baContainer.style.setProperty('--ba-pos', range.value + '%');
      });
    }

    viewButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentView = btn.getAttribute('data-view');
        viewButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        updateMedia();
      });
    });

    modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentMode = btn.getAttribute('data-mode');
        modeButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        updateMedia();
      });
    });
  }

  function initBrowser() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof CONFIG === 'undefined') return;

    initTabs();
    initBeforeAfterSlider();

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
        const errorBox = document.getElementById('error-box');
        if (errorBox) errorBox.hidden = true;
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
