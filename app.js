// ============================================
// PANIC ANALYZER — логика анализа (v3.0)
// ============================================

let DATABASE = null;

// Приводим «умные» кавычки к обычным
function normalizeQuotes(text) {
  return text.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
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

// --- Парсеры ---

function extractModel(text) {
  const norm = normalizeQuotes(text);
  const m = norm.match(/"product"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function extractSensorArray(text) {
  // Берём ровно 4 hex-значения после "sensor array 0 - 3 is"
  const m = text.match(/sensor array 0 - 3 is\s+(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)/i);
  if (!m) return null;
  const found = [];
  for (let i = 1; i <= 4; i++) {
    const clean = m[i].toLowerCase().replace(/^0x/, '');
    if (clean !== '0') found.push('0x' + clean);
  }
  return found;
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

// --- Главная функция ---

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
    showError('Не удалось распознать panic-лог. Убедись, что вставил полный текст (со строкой "product" и "panicString").');
    return;
  }

  let html = '<h2>📋 Результат анализа</h2>';

  if (model) {
    const name = (DATABASE.models[model] && DATABASE.models[model].name) || model;
    html += field('Модель устройства', name + ' (' + model + ')', true);
  } else {
    html += field('Модель устройства', 'Не удалось определить (в логе нет строки "product")', false);
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
    });
  }

  if (i2cCodes.length > 0) {
    i2cCodes.forEach(code => {
      const cause = (DATABASE.i2c && DATABASE.i2c[code]) || 'Неизвестная i2c-ошибка';
      html += probable(code.toUpperCase(), cause);
    });
  }

  if (aopCode) {
    const cause = (DATABASE.aop && (DATABASE.aop[aopCode] || DATABASE.aop['AOP PANIC'])) || 'Неизвестный AOP-код';
    html += probable(aopCode, cause);
  }

  otherCodes.forEach(code => {
    const cause = (DATABASE.other && DATABASE.other[code]) || 'Нет описания';
    html += probable(code, cause);
  });

  if (boardCodes.length > 0) {
    html += '<div style="margin-top:16px;padding-top:12px;border-top:2px solid #ff6b6b;">' +
            '<div style="color:#ff6b6b;font-weight:700;font-size:14px;margin-bottom:10px;">🔧 ТРЕБУЕТ ПАЙКИ / ПЛАТА</div>';
    boardCodes.forEach(item => {
      html += probable(item.category + ' · ' + item.key, item.value);
    });
    html += '</div>';
  }

  resultEl.innerHTML = html;
  resultEl.className = 'result show';
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
