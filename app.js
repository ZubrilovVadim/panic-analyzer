
// ============================================
// PANIC ANALYZER — логика анализа
// ============================================

let DATABASE = null;

// Загрузка базы при старте
async function loadDatabase() {
  try {
    const cached = localStorage.getItem('panic_db');
    if (cached) {
      DATABASE = JSON.parse(cached);
    }
    // Пробуем обновить из сети
    const response = await fetch('database.json');
    if (response.ok) {
      const fresh = await response.json();
      DATABASE = fresh;
      localStorage.setItem('panic_db', JSON.stringify(fresh));
    }
    updateVersionLabel();
    setStatus(true);
  } catch (e) {
    if (DATABASE) {
      setStatus(false);
    } else {
      document.getElementById('version').textContent = 'База не загружена';
    }
  }
}

function updateVersionLabel() {
  if (!DATABASE) return;
  document.getElementById('version').textContent = 
    'База v' + DATABASE.version + ' · ' + DATABASE.updated;
}

function setStatus(online) {
  const el = document.getElementById('status');
  if (online) {
    el.textContent = 'Онлайн';
    el.classList.remove('offline');
  } else {
    el.textContent = 'Офлайн';
    el.classList.add('offline');
  }
}

// Извлечение модели из лога
function extractModel(text) {
  const match = text.match(/"product"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

// Извлечение hex-кода из sensor array
function extractSensorArray(text) {
  const match = text.match(/sensor array 0 - 3 is ([^\n]+)/);
  if (!match) return null;
  const values = match[1].split(',').map(s => s.trim());
  const found = [];
  values.forEach((v, i) => {
    const clean = v.replace(/^0x/i, '').toLowerCase();
    if (clean !== '0' && clean !== '0x0') {
      found.push('0x' + clean);
    }
  });
  return found;
}

// Извлечение i2c-ошибок
function extractI2C(text) {
  const matches = text.match(/i2c[0-5]/gi);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

// Извлечение AOP panic
function extractAOP(text) {
  if (/AOP PANIC/i.test(text)) {
    const match = text.match(/AOP PANIC[^\n]*/i);
    return match ? match[0] : 'AOP PANIC';
  }
  return null;
}

// Извлечение других известных кодов
function extractOtherCodes(text) {
  const codes = [];
  if (/eMemory panic/i.test(text)) codes.push('eMemory panic');
  if (/SEP ROM/i.test(text)) codes.push('SEP ROM');
  if (/SEP DATA/i.test(text)) codes.push('SEP DATA');
  if (/ANS2?/i.test(text)) codes.push('ANS/ANS2');
  if (/AP Watchdog/i.test(text)) codes.push('AP Watchdog timeout');
  if (/USB PANIC.*Overcurrent/i.test(text)) codes.push('USB PANIC: Overcurrent');
  if (/AMCC Error/i.test(text)) codes.push('AMCC Error');
  if (/AppleBCMWLAN/i.test(text)) codes.push('AppleBCMWLAN');
  if (/baseband panic/i.test(text)) codes.push('baseband panic');
  if (/cpu0 fail to halt/i.test(text)) codes.push('cpu0 fail to halt');
  if (/WDT timeout/i.test(text)) codes.push('WDT timeout');
  if (/Speaker Panic/i.test(text)) codes.push('Speaker Panic');
  if (/Display TCON Panic/i.test(text)) codes.push('Display TCON Panic');
  return codes;
}

// Основная функция анализа
function analyze() {
  const input = document.getElementById('input').value.trim();
  const resultEl = document.getElementById('result');

  if (!input) {
    showError('Вставь текст panic-лога');
    return;
  }

  if (!DATABASE) {
    showError('База данных не загружена. Проверь интернет и обнови страницу.');
    return;
  }

  const model = extractModel(input);
  const sensorCodes = extractSensorArray(input);
  const i2cCodes = extractI2C(input);
  const aopCode = extractAOP(input);
  const otherCodes = extractOtherCodes(input);

  if (!model && !sensorCodes && i2cCodes.length === 0 && !aopCode && otherCodes.length === 0) {
    showError('Не удалось распознать panic-лог. Убедись, что вставил полный текст.');
    return;
  }

  let html = '<h2>📋 Результат анализа</h2>';

  // Модель
  if (model) {
    const modelName = (DATABASE.models[model] && DATABASE.models[model].name) || model;
    html += field('Модель устройства', modelName + ' (' + model + ')', true);
  }

  // SMC PANIC
  if (sensorCodes && sensorCodes.length > 0 && model && DATABASE.models[model]) {
    const smcDb = DATABASE.models[model].smc_codes || {};
    sensorCodes.forEach(code => {
      const cause = smcDb[code] || DATABASE.generic_smc[code] || 'Неизвестный код';
      html += probable('SMC PANIC · ' + code, cause);
    });
  } else if (sensorCodes && sensorCodes.length > 0) {
    sensorCodes.forEach(code => {
      const cause = DATABASE.generic_smc[code] || 'Неизвестный код — модель не определена';
      html += probable('SMC PANIC · ' + code, cause);
    });
  }

  // i2c
  if (i2cCodes.length > 0) {
    i2cCodes.forEach(code => {
      const cause = DATABASE.i2c[code] || 'Неизвестная i2c-ошибка';
      html += probable(code.toUpperCase(), cause);
    });
  }

  // AOP
  if (aopCode) {
    const cause = DATABASE.aop[aopCode] || DATABASE.aop['AOP PANIC'] || 'Неизвестный AOP-код';
    html += probable(aopCode, cause);
  }

  // Остальные
  otherCodes.forEach(code => {
    const cause = DATABASE.other[code] || 'Нет описания';
    html += probable(code, cause);
  });

  resultEl.innerHTML = html;
  resultEl.className = 'result show';
}

function field(label, value, highlight) {
  return '<div class="field">' +
    '<div class="field-label">' + label + '</div>' +
    '<div class="field-value' + (highlight ? ' highlight' : '') + '">' + value + '</div>' +
    '</div>';
}

function probable(label, text) {
  return '<div class="probable">' +
    '<div class="label">' + label + '</div>' +
    '<div class="text">' + text + '</div>' +
    '</div>';
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

// Обновление базы вручную
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
    } else {
      alert('❌ Не удалось обновить базу');
    }
  } catch (e) {
    alert('❌ Нет соединения. База остаётся прежней.');
  }
}

// Отслеживание онлайн/офлайн
window.addEventListener('online', () => setStatus(true));
window.addEventListener('offline', () => setStatus(false));

// Запуск
loadDatabase();
