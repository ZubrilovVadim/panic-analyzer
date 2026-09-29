let DATABASE = null;

function normalizeQuotes(text) {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, '"')
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/'/g, '"');
}

async function loadDatabase() {
  try {
    const cached = localStorage.getItem('panic_db');
    if (cached) DATABASE = JSON.parse(cached);
    const response = await fetch('database.json?t=' + Date.now());
    if (response.ok) {
      const fresh = await response.json();
      DATABASE = fresh;
      localStorage.setItem('panic_db', JSON.stringify(fresh));
    }
    updateVersionLabel();
    setStatus(true);
  } catch (e) {
    if (DATABASE) setStatus(false);
    else document.getElementById('version').textContent = 'База не загружена';
  }
}

function updateVersionLabel() {
  if (!DATABASE) return;
  document.getElementById('version').textContent =
    'База v' + DATABASE.version + ' · ' + DATABASE.updated;
}

function setStatus(online) {
  const el = document.getElementById('status');
  el.textContent = online ? 'Онлайн' : 'Офлайн';
  el.classList.toggle('offline', !online);
}

function extractModel(text) {
  const norm = normalizeQuotes(text);
  const m = norm.match(/"product"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function extractSensorArray(text) {
  const m = text.match(/sensor array\s+\d+\s*-\s*\d+\s+is\s+([^\n\\]+)/i);
  if (!m) return null;
  const values = m[1].split(',').map(s => s.trim());
  const found = [];
  values.forEach(v => {
    let clean = v.replace(/^0x/i, '').toLowerCase();
    if (clean && clean !== '0') {
      if (!/^0x/i.test(v) && /^\d+$/.test(clean)) {
        clean = parseInt(clean, 10).toString(16);
      }
      found.push('0x' + clean);
    }
  });
  return found.length > 0 ? found : null;
}

function extractI2C(text) {
  const m = text.match(/i2c[0-5]/gi);
  return m ? [...new Set(m.map(x => x.toLowerCase()))] : [];
}

function extractAOP(text) {
  if (/AOP PANIC/i.test(text)) {
    const m = text.match(/AOP PANIC[^\n\\]*/i);
    return m ? m[0].trim() : 'AOP PANIC';
  }
  return null;
}

function extractOtherCodes(text) {
  const codes = [];
  const checks = [
    'eMemory panic', 'SEP ROM', 'SEP DATA', 'ANS/ANS2',
    'AP Watchdog timeout', 'USB PANIC: Overcurrent', 'AMCC Error',
    'AppleBCMWLAN', 'baseband panic', 'cpu0 fail to halt',
    'WDT timeout', 'Speaker Panic', 'Display TCON Panic',
    'Prox/ALS Panic', 'Multiple Mic Failure', 'Audio DSP Panic',
    'NAND Panic', 'Thermal Panic'
  ];
  checks.forEach(c => {
    const safe = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(safe, 'i').test(text)) codes.push(c);
  });
  return codes;
}

function extractBoardLevel(text) {
  if (!DATABASE || !DATABASE.board_level) return [];
  const found = [];
  for (const category in DATABASE.board_level) {
    const items = DATABASE.board_level[category];
    for (const key in items) {
      const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(safe, 'i').test(text)) {
        found.push({ category: category, key: key, value: items[key] });
      }
    }
  }
  return found;
}

function getModelKey(modelName) {
  if (!DATABASE.measurements || !modelName) return null;
  const keys = Object.keys(DATABASE.measurements);
  if (keys.includes(modelName)) return modelName;
  for (const key of keys) {
    if (key === 'general_i2c' || key === 'power_rails') continue;
    if (key.includes(modelName) || modelName.includes(key.split('(')[0].trim())) return key;
  }
  for (const key of keys) {
    if (key === 'general_i2c' || key === 'power_rails') continue;
    const parts = key.split('/').map(s => s.trim());
    for (const part of parts) {
      if (part.startsWith(modelName) || modelName.startsWith(part)) return key;
    }
  }
  return null;
}

function getMeasurements(modelName, i2cCodes) {
  if (!DATABASE.measurements) return '';
  let html = '';
  const general = DATABASE.measurements['general_i2c'];
  if (general) {
    html += '<div class="measure-box">' +
      '<div class="measure-title">📏 Общие параметры I2C</div>' +
      '<div class="measure-row"><b>Diode mode:</b> ' + general.diode_mode_normal + '</div>' +
      '<div class="measure-row"><b>Напряжение:</b> ' + general.voltage_level + '</div>' +
      '<div class="measure-row"><b>Pull-up резистор:</b> ' + general.pull_up_resistor + '</div>' +
      '<div class="measure-row" style="font-size:12px;color:#aaa;margin-top:6px;">' + general.how_to_measure + '</div>' +
      '</div>';
  }
  const modelKey = getModelKey(modelName);
  if (modelKey && DATABASE.measurements[modelKey]) {
    const block = DATABASE.measurements[modelKey];
    let blockHtml = '<div class="measure-box">' +
      '<div class="measure-title">📐 ' + modelKey + '</div>';
    if (i2cCodes && i2cCodes.length > 0) {
      i2cCodes.forEach(code => {
        const sdaKey = code + '_sda';
        const sclKey = code + '_scl';
        if (block[sdaKey]) blockHtml += renderMeasurement(sdaKey, block[sdaKey]);
        if (block[sclKey]) blockHtml += renderMeasurement(sclKey, block[sclKey]);
      });
    } else {
      for (const key in block) {
        if (key === 'note') {
          blockHtml += '<div class="measure-row" style="color:#ffa500;font-size:12px;">' + block[key] + '</div>';
        } else if (typeof block[key] === 'object') {
          blockHtml += renderMeasurement(key, block[key]);
        }
      }
    }
    blockHtml += '</div>';
    html += blockHtml;
  }
  if (DATABASE.measurements['power_rails']) {
    const rails = DATABASE.measurements['power_rails'];
    let railsHtml = '<div class="measure-box">' +
      '<div class="measure-title">⚡ Линии питания</div>';
    for (const key in rails) {
      railsHtml += '<div class="measure-row"><b>' + key + ':</b> ' +
        rails[key].diode + ' | ' + rails[key].voltage +
        (rails[key].note ? ' <span style="color:#aaa;">(' + rails[key].note + ')</span>' : '') +
        '</div>';
    }
    railsHtml += '</div>';
    html += railsHtml;
  }
  return html;
}

function renderMeasurement(key, data) {
  let html = '<div class="measure-item">';
  html += '<div class="measure-key">' + key + '</div>';
  if (data.diode) html += '<div class="measure-row"><b>Diode:</b> ' + data.diode + '</div>';
  if (data.voltage) html += '<div class="measure-row"><b>Напряжение:</b> ' + data.voltage + '</div>';
  if (data.test_point) html += '<div class="measure-row"><b>Test point:</b> ' + data.test_point + '</div>';
  if (data.component) html += '<div class="measure-row"><b>Компонент:</b> ' + data.component + '</div>';
  if (data.note) html += '<div class="measure-row" style="color:#ffa500;font-size:12px;">' + data.note + '</div>';
  html += '</div>';
  return html;
}

let SHARE_TEXT = '';

function analyze() {
  const input = document.getElementById('input').value.trim();
  const resultEl = document.getElementById('result');

  if (!input) { showError('Вставь текст panic-лога'); return; }
  if (!DATABASE) { showError('База данных не загружена. Проверь интернет и обнови страницу.'); return; }

  const model = extractModel(input);
  const sensorCodes = extractSensorArray(input);
  const i2cCodes = extractI2C(input);
  const aopCode = extractAOP(input);
  const otherCodes = extractOtherCodes(input);
  const boardCodes = extractBoardLevel(input);

  const nothingFound = !model && !sensorCodes && i2cCodes.length === 0 &&
                       !aopCode && otherCodes.length === 0 && boardCodes.length === 0;

  if (nothingFound) {
    showError('Не удалось распознать panic-лог. Убедись, что вставил полный текст.');
    return;
  }

  // КОРОТКИЙ текст для шаринга/копирования
  const lines = [];

  let html = '<h2>📋 Результат анализа</h2>';
  let modelName = null;
  if (model) {
    modelName = (DATABASE.models[model] && DATABASE.models[model].name) || model;
    html += field('Модель устройства', modelName + ' (' + model + ')', true);
    lines.push('📱 ' + modelName);
  } else {
    html += field('Модель устройства', 'Не удалось определить', false);
    lines.push('📱 Panic Analyzer');
  }

  if (sensorCodes && sensorCodes.length > 0) {
    sensorCodes.forEach(code => {
      let cause = 'Неизвестный код';
      if (model && DATABASE.models[model] && DATABASE.models[model].smc_codes && DATABASE.models[model].smc_codes[code]) {
        cause = DATABASE.models[model].smc_codes[code];
      } else if (DATABASE.generic_smc && DATABASE.generic_smc[code]) {
        cause = DATABASE.generic_smc[code];
      }
      html += probable('SMC PANIC · ' + code, cause);
      lines.push('SMC ' + code + ' — ' + cause);
    });
  }

  if (i2cCodes.length > 0) {
    i2cCodes.forEach(code => {
      const cause = (DATABASE.i2c && DATABASE.i2c[code]) || 'Неизвестная i2c-ошибка';
      html += probable(code.toUpperCase(), cause);
      lines.push(code.toUpperCase() + ' — ' + cause);
    });
  }

  if (aopCode) {
    const cause = (DATABASE.aop && (DATABASE.aop[aopCode] || DATABASE.aop['AOP PANIC'])) || 'Неизвестный AOP-код';
    html += probable(aopCode, cause);
    lines.push(aopCode + ' — ' + cause);
  }

  otherCodes.forEach(code => {
    const cause = (DATABASE.other && DATABASE.other[code]) || 'Нет описания';
    html += probable(code, cause);
    lines.push(code + ' — ' + cause);
  });

  if (boardCodes.length > 0) {
    html += '<div class="board-divider">' +
            '<div class="title">🔧 ТРЕБУЕТ ПАЙКИ / ПЛАТА</div>';
    lines.push('');
    lines.push('🔧 Требует пайки:');
    boardCodes.forEach(item => {
      html += probable(item.category + ' · ' + item.key, item.value);
      lines.push(item.key + ' — ' + item.value);
    });
    html += '</div>';
  }

  html += getMeasurements(modelName, i2cCodes);

  SHARE_TEXT = lines.join('\n');

  html += '<div class="share-wrap">' +
            '<button class="btn-share-icon" onclick="copyResult()" aria-label="Копировать">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
              '</svg>' +
            '</button>' +
            '<button class="btn-share-icon" onclick="shareResult()" aria-label="Поделиться">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M12 15V3"/>' +
                '<path d="M8 7l4-4 4 4"/>' +
                '<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>' +
              '</svg>' +
            '</button>' +
          '</div>';

  resultEl.innerHTML = html;
  resultEl.className = 'result show';
}

async function copyResult() {
  if (!SHARE_TEXT) { alert('Сначала проанализируй паник'); return; }

  try {
    await navigator.clipboard.writeText(SHARE_TEXT);
    alert('✅ Скопировано:\n\n' + SHARE_TEXT);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = SHARE_TEXT;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      alert('✅ Скопировано:\n\n' + SHARE_TEXT);
    } catch (err) {
      alert('❌ Не удалось скопировать');
    }
    document.body.removeChild(ta);
  }
}

async function shareResult() {
  if (!SHARE_TEXT) { alert('Сначала проанализируй паник'); return; }

  if (navigator.share) {
    try {
      await navigator.share({ text: SHARE_TEXT });
    } catch (e) {}
    return;
  }
  copyResult();
}

function field(label, value, highlight) {
  return '<div class="field"><div class="field-label">' + label + '</div>' +
    '<div class="field-value' + (highlight ? ' highlight' : '') + '">' + value + '</div></div>';
}

function probable(label, text) {
  return '<div class="probable"><div class="label">' + label + '</div>' +
    '<div class="text">' + text + '</div></div>';
}

function showError(msg) {
  const resultEl = document.getElementById('result');
  resultEl.innerHTML = '<h2>⚠️ Ошибка</h2><div class="field-value">' + msg + '</div>';
  resultEl.className = 'result error show';
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('result').className = 'result';
  SHARE_TEXT = '';
}

async function updateDatabase() {
  try {
    const response = await fetch('database.json?t=' + Date.now());
    if (response.ok) {
      const fresh = await response.json();
      DATABASE = fresh;
      localStorage.setItem('panic_db', JSON.stringify(fresh));
      updateVersionLabel();
      setStatus(true);
      alert('✅ База обновлена до v' + fresh.version);
    } else alert('❌ Не удалось обновить базу');
  } catch (e) { alert('❌ Нет соединения. База остаётся прежней.'); }
}

window.addEventListener('online', () => setStatus(true));
window.addEventListener('offline', () => setStatus(false));

loadDatabase();
