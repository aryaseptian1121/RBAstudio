const crypto = require('crypto');

function uuidv4() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultPasteStep() {
  return {
    id: uuidv4(),
    type: 'paste_field',
    label: 'Klik Field & Paste',
    target_type: 'selector',
    css_selector: '',
    x: undefined,
    y: undefined,
    delay_after: 500,
    enabled: true,
  };
}

function createDefaultClickStep() {
  return {
    id: uuidv4(),
    type: 'click',
    label: 'Klik Tambahan',
    target_type: 'selector',
    css_selector: '',
    x: undefined,
    y: undefined,
    delay_after: 400,
    enabled: true,
  };
}

function createDefaultTargetConfig() {
  return {
    type: 'browser_url',
    url: '',
    urlMatchMode: 'contains',
    openIfNotFound: true,
    windowTitle: '',
    exePath: '',
    timeout: 5000,
    lookupColumn: 'A',
    lookupKey: '',
    imagePath: '',
    targetsText: '',
    script: '',
  };
}

function createDefaultFocusWindowStep() {
  return {
    id: uuidv4(),
    type: 'fokus_window',
    label: 'Fokus Window',
    windowTitle: '',
    timeout: 5000,
    enabled: true,
  };
}

function createDefaultCoordinateClickStep() {
  return {
    id: uuidv4(),
    type: 'klik_koordinat',
    label: 'Klik Koordinat',
    mode: 'absolut',
    x: 0,
    y: 0,
    windowTitle: '',
    clickType: 'left',
    delayAfter: 200,
    enabled: true,
  };
}

function createDefaultTypeOrPasteStep() {
  return {
    id: uuidv4(),
    type: 'paste_atau_ketik',
    label: 'Paste atau Ketik',
    method: 'paste',
    text: '',
    delayBefore: 150,
    delayAfter: 200,
    enabled: true,
  };
}

function createDefaultPressKeyStep() {
  return {
    id: uuidv4(),
    type: 'tekan_tombol',
    label: 'Tekan Tombol',
    key: 'enter',
    modifiers: [],
    repeat: 1,
    enabled: true,
  };
}

function createDefaultUploadFileDialogStep() {
  return {
    id: uuidv4(),
    type: 'upload_file_dialog',
    label: 'Upload File Dialog',
    filePath: '',
    timeout: 8000,
    enabled: true,
  };
}

function createDefaultWaitWindowStep() {
  return {
    id: uuidv4(),
    type: 'tunggu_window',
    label: 'Tunggu Window',
    windowTitle: '',
    timeout: 10000,
    onTimeout: 'error',
    enabled: true,
  };
}

function createDefaultPeriodicStep() {
  return {
    id: uuidv4(),
    label: 'Langkah Periodic',
    target_type: 'selector',
    css_selector: '',
    x: undefined,
    y: undefined,
    delay_after: 500,
    enabled: true,
  };
}

function createDefaultConfig() {
  return {
    excel_path: '',
    sheet_name: 'Sheet1',
    kolom: 'B',
    row_start: 2,
    row_end: 100,
    total_loop: 99,

    skip_empty: false,
    trim_spaces: false,
    stop_on_consecutive_empty: false,
    consecutive_empty_limit: 5,

    tab_normal: '',
    targetConfig: createDefaultTargetConfig(),
    normal_steps: [createDefaultPasteStep()],

    d_after_copy: 300,
    d_tab_switch: 500,
    d_before_paste: 300,
    d_after_paste: 500,
    d_between_clicks: 400,
    d_end_loop: 500,

    periodic_enabled: false,
    periodic_every: 20,
    periodic_timing: 'sesudah',
    tab_periodic: '',
    periodic_steps: [],

    d_pre_periodic: 500,
    d_periodic_tab_switch: 500,
    d_post_periodic: 1000,

    random_delay: false,
  };
}

function computeTotalLoop(config) {
  if (!config) return 0;
  return Math.max(0, (Number(config.row_end) || 0) - (Number(config.row_start) || 0) + 1);
}

function migrateOldConfig(config) {
  if (!config || typeof config !== 'object') return config;
  const migrated = { ...config };
  if (typeof migrated.tabNormal === 'string' && migrated.tabNormal) {
    migrated.targetConfig = {
      type: 'browser_url',
      url: migrated.tabNormal,
      urlMatchMode: 'contains',
      openIfNotFound: true,
    };
    delete migrated.tabNormal;
  }
  if (!migrated.targetConfig && typeof migrated.tab_normal === 'string' && migrated.tab_normal) {
    migrated.targetConfig = {
      type: 'browser_url',
      url: migrated.tab_normal,
      urlMatchMode: 'contains',
      openIfNotFound: true,
    };
  }
  migrated.targetConfig = {
    ...createDefaultTargetConfig(),
    ...(migrated.targetConfig || {}),
  };
  return migrated;
}

function estimateTimeMs(config) {
  const normalClickCount = (config.normal_steps || []).filter(s => s.enabled && s.type === 'click').length;
  const normalDelay =
    (Number(config.d_after_copy) || 0) +
    (Number(config.d_tab_switch) || 0) +
    (Number(config.d_before_paste) || 0) +
    (Number(config.d_after_paste) || 0) +
    (normalClickCount * (Number(config.d_between_clicks) || 0)) +
    (Number(config.d_end_loop) || 0);

  const periodicDelay = config.periodic_enabled
    ? (Number(config.d_pre_periodic) || 0) +
      (Number(config.d_periodic_tab_switch) || 0) +
      (Number(config.d_post_periodic) || 0) +
      (config.periodic_steps || []).filter(s => s.enabled).reduce((sum, s) => sum + (Number(s.delay_after) || 0), 0)
    : 0;

  const totalLoop = computeTotalLoop(config);
  const periodicCount = config.periodic_enabled && config.periodic_every > 0
    ? Math.floor(totalLoop / config.periodic_every)
    : 0;

  return {
    perLoop: normalDelay,
    totalNormal: normalDelay * totalLoop,
    totalWithPeriodic: normalDelay * totalLoop + periodicDelay * periodicCount,
  };
}

function formatDuration(ms) {
  const millis = Number(ms) || 0;
  if (millis < 1000) return `${millis}ms`;
  const totalSeconds = Math.floor(millis / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} jam ${minutes} menit ${seconds} detik`;
  if (minutes > 0) return `${minutes} menit ${seconds} detik`;
  return `${seconds} detik`;
}

module.exports = {
  createDefaultConfig,
  createDefaultPasteStep,
  createDefaultClickStep,
  createDefaultFocusWindowStep,
  createDefaultCoordinateClickStep,
  createDefaultTypeOrPasteStep,
  createDefaultPressKeyStep,
  createDefaultUploadFileDialogStep,
  createDefaultWaitWindowStep,
  createDefaultTargetConfig,
  createDefaultPeriodicStep,
  computeTotalLoop,
  estimateTimeMs,
  formatDuration,
  migrateOldConfig,
};
