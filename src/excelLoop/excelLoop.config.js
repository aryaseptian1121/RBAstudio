/**
 * Excel Loop Configuration & Defaults
 * RBA Studio Pro 2.0 - Electron + vanilla JS
 */

// Simple UUID v4 generator (no external dependency)
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Create default Excel Loop configuration object
 * @returns {Object} Default config with all required properties
 */
function createDefaultConfig() {
  return {
    // Sumber file
    excel_path: '',
    sheet_name: 'Sheet1',
    kolom: 'B',
    row_start: 2,
    row_end: 100,
    total_loop: 99,

    // Opsi baca
    skip_empty: false,
    trim_spaces: false,
    stop_on_consecutive_empty: false,
    consecutive_empty_limit: 5,

    // Normal flow
    tab_normal: '',
    normal_steps: [],

    // Delay normal flow (ms)
    d_after_copy: 300,
    d_tab_switch: 500,
    d_before_paste: 300,
    d_after_paste: 500,
    d_between_clicks: 400,
    d_end_loop: 500,

    // Periodic flow
    periodic_enabled: false,
    periodic_every: 20,
    periodic_timing: 'sesudah',
    tab_periodic: '',
    tab_periodic_mode: 'by_url',
    periodic_steps: [],

    // Hook flows
    pre_loop_flow_id: '',
    post_loop_flow_id: '',
    on_error_flow_id: '',

    // Delay periodic flow (ms)
    d_pre_periodic: 500,
    d_periodic_tab_switch: 500,
    d_post_periodic: 1000,

    // Global
    random_delay: false
  };
}

/**
 * Create default normal step for paste field
 * @returns {Object} NormalStep with paste_field type
 */
function createNormalStepPaste() {
  return {
    type: 'paste_field',
    id: uuidv4(),
    label: 'Klik Field & Paste',
    target_type: 'selector',
    css_selector: '',
    x: 0,
    y: 0,
    delay_after: 500,
    enabled: true
  };
}

/**
 * Create default normal step for click
 * @returns {Object} NormalStep with click type
 */
function createNormalStepClick() {
  return {
    type: 'click',
    id: uuidv4(),
    label: 'Klik Tambahan',
    target_type: 'selector',
    css_selector: '',
    x: 0,
    y: 0,
    delay_after: 400,
    enabled: true
  };
}

function createNormalStepCallExistingFlow() {
  return {
    type: 'call_existing_flow',
    id: uuidv4(),
    label: 'Panggil Flow yang Ada',
    flow_id: '',
    target_type: 'selector',
    css_selector: '',
    x: 0,
    y: 0,
    delay_after: 400,
    enabled: true
  };
}

/**
 * Create default periodic step
 * @returns {Object} PeriodicStep
 */
function createPeriodicStep() {
  return {
    id: uuidv4(),
    label: 'Langkah Periodic',
    target_type: 'selector',
    css_selector: '',
    x: 0,
    y: 0,
    delay_after: 500,
    enabled: true
  };
}

/**
 * Compute total loop count from config
 * @param {Object} config - Configuration object
 * @returns {number} Total loop count
 */
function computeTotalLoop(config) {
  return config.row_end - config.row_start + 1;
}

/**
 * Apply random variance to delay value
 * @param {number} ms - Delay in milliseconds
 * @param {boolean} enabled - Whether to apply variance
 * @returns {number} Adjusted delay in milliseconds
 */
function applyRandomVariance(ms, enabled) {
  if (!enabled) return ms;
  const variance = (Math.random() * 2 - 1) * ms * 0.2;
  return Math.round(ms + variance);
}

/**
 * Format duration from milliseconds to readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2 menit 30 detik" or "1 jam 5 menit")
 */
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} jam`);
  if (minutes > 0) parts.push(`${minutes} menit`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} detik`);

  return parts.join(' ');
}

/**
 * Estimate execution time for the Excel Loop
 * @param {Object} config - Configuration object
 * @returns {Object} Time estimates { perLoop, totalNormal, totalWithPeriodic }
 */
function estimateTime(config) {
  const totalLoop = computeTotalLoop(config);

  // Calculate time per normal loop
  let timePerLoop = 0;
  timePerLoop += config.d_after_copy;
  timePerLoop += config.d_tab_switch;
  timePerLoop += config.d_before_paste;
  timePerLoop += config.d_after_paste;

  // Add time for each normal step
  config.normal_steps.forEach(step => {
    if (step.enabled) {
      timePerLoop += step.delay_after > 0 ? step.delay_after : config.d_between_clicks;
      if (step.type === 'paste_field') {
        timePerLoop += config.d_before_paste + config.d_after_paste;
      }
    }
  });

  timePerLoop += config.d_end_loop;

  // Total time for all normal loops
  const totalNormalTime = timePerLoop * totalLoop;

  // Calculate periodic flow time
  let totalWithPeriodicTime = totalNormalTime;
  if (config.periodic_enabled && config.periodic_every > 0) {
    const periodicCount = Math.floor(totalLoop / config.periodic_every);
    let timePerPeriodic = config.d_pre_periodic + config.d_periodic_tab_switch;

    config.periodic_steps.forEach(step => {
      if (step.enabled) {
        timePerPeriodic += step.delay_after;
      }
    });

    timePerPeriodic += config.d_post_periodic;
    totalWithPeriodicTime += timePerPeriodic * periodicCount;
  }

  return {
    perLoop: timePerLoop,
    totalNormal: totalNormalTime,
    totalWithPeriodic: totalWithPeriodicTime
  };
}

module.exports = {
  createDefaultConfig,
  createNormalStepPaste,
  createNormalStepClick,
  createNormalStepCallExistingFlow,
  createPeriodicStep,
  computeTotalLoop,
  applyRandomVariance,
  formatDuration,
  estimateTime
};
