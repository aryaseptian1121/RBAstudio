const BrowserManager = require('../services/BrowserManager');
const WinAuto = require('../services/WindowsAutomation');

async function executeStep(step, context, resolvedTarget, addLog) {

  // ── BROWSER STEPS ──────────────────────────────────────────
  if (step.type === 'paste_field' || step.type === 'klik_css' || (step.type === 'click' && (step.cssSelector || step.selector || step.css_selector))) {
    if (!resolvedTarget || resolvedTarget.type !== 'browser') {
      throw new Error(`Step "${step.label}" butuh target Browser URL. Ubah Tipe Target.`);
    }
    const bm = BrowserManager;
    const selector = step.cssSelector || step.selector || step.css_selector || '';
    if (!selector) throw new Error(`Step "${step.label}": CSS Selector kosong`);

    if (step.type === 'paste_field') {
      const value = resolveVariables(step.value || context.currentCellValue, context);
      addLog('INFO', `Isi field "${selector}" dengan: "${value}"`);
      await bm.fillInputByCssSelector(selector, value, step.delayAfter || 300);
    }
    if (step.type === 'klik_css' || step.type === 'click') {
      addLog('INFO', `Klik elemen: "${selector}"`);
      await bm.clickByCssSelector(selector, step.delayAfter || 300);
    }
    return;
  }

  // ── DESKTOP STEPS ─────────────────────────────────────────
  if (step.type === 'fokus_window') {
    await WinAuto.focusWindowByTitle(
      resolveVariables(step.windowTitle, context),
      step.restoreIfMinimized !== false
    );
    addLog('INFO', `Fokus window: "${step.windowTitle}"`);
    return;
  }

  if (step.type === 'klik_koordinat') {
    const x = parseInt(step.x || 0);
    const y = parseInt(step.y || 0);
    if (step.coordinateMode === 'relative' && step.windowTitle) {
      addLog('INFO', `Klik relatif window "${step.windowTitle}": X=${x}, Y=${y}`);
      await WinAuto.clickRelativeToWindow(step.windowTitle, x, y, step.clickType || 'left');
    } else {
      addLog('INFO', `Klik absolut layar: X=${x}, Y=${y}`);
      await WinAuto.clickAt(x, y, step.clickType || 'left', step.doubleClick);
    }
    await sleep(step.delayAfter || 200);
    return;
  }

  if (step.type === 'paste_atau_ketik') {
    if (step.method === 'paste') {
      addLog('INFO', 'Paste dari clipboard (Ctrl+V)');
      await WinAuto.pasteClipboard();
    } else {
      const text = resolveVariables(step.text || '', context);
      addLog('INFO', `Ketik teks: "${text}"`);
      await WinAuto.typeText(text);
    }
    await sleep(step.delayAfter || 200);
    return;
  }

  if (step.type === 'tekan_tombol') {
    const times = step.repeat || 1;
    for (let i = 0; i < times; i++) {
      await WinAuto.pressKey(step.key || 'enter', step.modifiers || []);
      await sleep(80);
    }
    addLog('INFO', `Tekan tombol: ${step.key} x${times}`);
    return;
  }

  if (step.type === 'upload_file_dialog') {
    const path = resolveVariables(step.filePath || '', context);
    if (!path) throw new Error(`Step "${step.label}": Path file kosong. Isi atau gunakan {{col_B}}`);
    addLog('INFO', `Handle file dialog, path: "${path}"`);
    await WinAuto.handleFileDialog(path, step.timeout || 5000);
    return;
  }

  // ── UNIVERSAL STEPS ───────────────────────────────────────
  if (step.type === 'delay') {
    const ms = parseInt(step.duration || step.delayAfter || 1000);
    addLog('INFO', `Delay ${ms}ms`);
    await sleep(ms);
    return;
  }

  addLog('WARN', `Tipe step tidak dikenal: "${step.type}" — dilewati`);
}

function resolveVariables(template, context) {
  if (!template || typeof template !== 'string') return template || '';
  let result = template;
  
  // Format rowData to object mapping if it is passed as an array
  const rowDataObj = {};
  if (context.rowData) {
    if (Array.isArray(context.rowData)) {
      context.rowData.forEach((val, idx) => {
        const colLetter = String.fromCharCode(65 + idx); // 0 -> A, 1 -> B, etc.
        rowDataObj[colLetter] = val;
      });
    } else {
      Object.assign(rowDataObj, context.rowData);
    }
  }

  // {{col_A}}, {{col_B}} dst
  Object.entries(rowDataObj).forEach(([col, val]) => {
    result = result.replace(new RegExp(`{{col_${col}}}`, 'g'), val ?? '');
    result = result.replace(new RegExp(`{{${col}}}`, 'g'), val ?? '');
  });
  
  const rowNum = context.rowNumber || context.current_row || context.row_number || '';
  const cellVal = context.currentCellValue || context.current_value || context.excel_value || '';
  const loopIdx = context.loopIndex || context.counter || '';

  result = result.replace(/{{row_number}}/g, rowNum);
  result = result.replace(/{{row}}/g, rowNum);
  result = result.replace(/{{excel_value}}/g, cellVal);
  result = result.replace(/{{value}}/g, cellVal);
  result = result.replace(/{{loop_index}}/g, loopIdx);
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { executeStep, resolveVariables };
