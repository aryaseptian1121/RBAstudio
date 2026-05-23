const { migrateOldConfig } = require('../utils/excelLoopDefaults');

const STORAGE_KEY = 'rba_excel_loop_config';

function saveExcelLoopConfig(config) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  } catch (err) {
    console.warn('ExcelLoopStorage.save failed', err.message || err);
  }
}

function loadExcelLoopConfig() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateOldConfig(JSON.parse(raw));
  } catch (err) {
    console.warn('ExcelLoopStorage.load failed', err.message || err);
    return null;
  }
}

function exportConfigToJSON(config) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'excel-loop-config.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importConfigFromJSON() {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('Environment tidak mendukung import file'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return reject(new Error('Tidak ada file dipilih'));
      try {
        const text = await file.text();
        const config = migrateOldConfig(JSON.parse(text));
        resolve(config);
      } catch (err) {
        reject(new Error('File JSON tidak valid'));
      }
    };
    input.click();
  });
}

module.exports = {
  saveExcelLoopConfig,
  loadExcelLoopConfig,
  exportConfigToJSON,
  importConfigFromJSON,
};
