// ============================================================
// TIPE DATA UTAMA UNTUK EXCEL LOOP AUTOMATION
// ============================================================

/**
 * @typedef {Object} NormalStep
 * @property {string} id
 * @property {'paste_field' | 'click'} type
 * @property {string} label
 * @property {'selector' | 'coordinate'} target_type
 * @property {string} [css_selector]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} delay_after
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} PeriodicStep
 * @property {string} id
 * @property {string} label
 * @property {'selector' | 'coordinate'} target_type
 * @property {string} [css_selector]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} delay_after
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} ExcelConfig
 * @property {string} excel_path
 * @property {string} sheet_name
 * @property {string} kolom
 * @property {number} row_start
 * @property {number} row_end
 * @property {number} total_loop
 * @property {boolean} skip_empty
 * @property {boolean} trim_spaces
 * @property {boolean} stop_on_consecutive_empty
 * @property {number} consecutive_empty_limit
 * @property {string} tab_normal
 * @property {NormalStep[]} normal_steps
 * @property {number} d_after_copy
 * @property {number} d_tab_switch
 * @property {number} d_before_paste
 * @property {number} d_after_paste
 * @property {number} d_between_clicks
 * @property {number} d_end_loop
 * @property {boolean} periodic_enabled
 * @property {number} periodic_every
 * @property {'sesudah'} periodic_timing
 * @property {string} tab_periodic
 * @property {PeriodicStep[]} periodic_steps
 * @property {number} d_pre_periodic
 * @property {number} d_periodic_tab_switch
 * @property {number} d_post_periodic
 * @property {boolean} random_delay
 */

/**
 * @typedef {Object} ExcelLoopState
 * @property {boolean} is_running
 * @property {boolean} is_paused
 * @property {number} current_row
 * @property {number} counter
 * @property {number} consecutive_empty_count
 * @property {number} total_processed
 * @property {number} total_skipped
 * @property {string[]} errors
 * @property {string} current_value
 * @property {number} last_periodic_at
 */

module.exports = {};
