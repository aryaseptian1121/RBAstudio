/**
 * Excel Loop Engine - Main Execution Engine
 * RBA Studio Pro 2.0 - Electron + vanilla JS
 */

const fs = require('fs');
const XLSX = require('xlsx');
const { applyRandomVariance, computeTotalLoop } = require('./excelLoop.config.js');

class ExcelLoopEngine {
  /**
   * Constructor
   * @param {Object} config - Configuration object
   * @param {Function} onLog - Callback for logging: (level, message)
   * @param {Function} onStateChange - Callback for state updates: (state)
   */
  constructor(config, onLog, onStateChange) {
    this.config = config;
    this.onLog = onLog || (() => {});
    this.onStateChange = onStateChange || (() => {});

    // Initialize state
    this.state = {
      is_running: false,
      is_paused: false,
      current_row: 0,
      counter: 0,
      consecutive_empty_count: 0,
      total_processed: 0,
      total_skipped: 0,
      errors: [],
      current_value: '',
      last_periodic_at: 0
    };

    // Internal flags
    this._isPaused = false;
    this._isStopped = false;
    this._activeTimers = [];
  }

  /**
   * Log message with level
   * @private
   */
  _log(level, message) {
    this.onLog(level, message);
  }

  /**
   * Delay with optional random variance
   * @private
   */
  async _delay(ms) {
    const actual = applyRandomVariance(ms, this.config.random_delay);
    this._log('INFO', `⏱ delay ${actual}ms`);

    return new Promise((resolve) => {
      const timerId = setTimeout(() => {
        this._activeTimers = this._activeTimers.filter(id => id !== timerId);
        resolve();
      }, actual);
      this._activeTimers.push(timerId);
    });
  }

  /**
   * Clear all active timers
   * @private
   */
  _clearTimers() {
    this._activeTimers.forEach(timerId => clearTimeout(timerId));
    this._activeTimers = [];
  }

  /**
   * Read Excel file and parse data
   * @private
   */
  async _readExcel() {
    if (!this.config.excel_path || typeof this.config.excel_path !== 'string') {
      throw new Error('File Excel belum berhasil dimuat. Coba pilih file lagi.');
    }

    if (!fs.existsSync(this.config.excel_path)) {
      throw new Error(`File Excel tidak ditemukan: ${this.config.excel_path}`);
    }

    const buffer = await fs.promises.readFile(this.config.excel_path);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = String(this.config.sheet_name || '');

    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Sheet "${sheetName}" tidak ditemukan di file Excel`);
    }

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false
    });

    if (!Array.isArray(data)) {
      throw new Error('File Excel belum berhasil dimuat. Coba pilih file lagi.');
    }

    return JSON.parse(JSON.stringify(data));
  }

  /**
   * Get cell value from data array
   * @private
   */
  _getCellValue(data, row, col) {
    // Convert column letter to index (A=0, B=1, etc.)
    const colIndex = col.toUpperCase().charCodeAt(0) - 65;

    // Access cell (row is 1-based, data array is 0-based)
    const rowData = data[row - 1];
    if (!rowData || colIndex < 0 || colIndex >= rowData.length) {
      return '';
    }

    let value = String(rowData[colIndex] || '');

    // Apply trim if configured
    if (this.config.trim_spaces) {
      value = value.trim();
    }

    return value;
  }

  /**
   * Run normal flow for a cell value
   * @private
   */
  async _runNormalFlow(cellValue) {
    this._log('INFO', `📋 [NORMAL FLOW] nilai: "${cellValue}"`);

    // Copy to clipboard
    await this._copyToClipboard(cellValue);
    await this._delay(this.config.d_after_copy);

    // Switch to normal tab
    await this._switchToTab(this.config.tab_normal);
    await this._delay(this.config.d_tab_switch);

    // Execute each enabled normal step
    for (const step of this.config.normal_steps) {
      if (!step.enabled) continue;

      if (step.type === 'paste_field') {
        // Click target
        await this._clickTarget(step.target_type, step.css_selector, step.x, step.y);
        await this._delay(this.config.d_before_paste);

        // Paste
        await this._pasteClipboard();
        await this._delay(this.config.d_after_paste);

        this._log('SUCCESS', `✅ Paste field "${step.label}" berhasil`);
      } else if (step.type === 'click') {
        // Click target
        await this._clickTarget(step.target_type, step.css_selector, step.x, step.y);

        // Delay after click
        const delayTime = step.delay_after > 0 ? step.delay_after : this.config.d_between_clicks;
        await this._delay(delayTime);

        this._log('SUCCESS', `✅ Klik "${step.label}" berhasil`);
      }
    }

    // Switch back to Excel
    await this._switchToExcel();
    await this._delay(this.config.d_end_loop);

    this._log('INFO', `✅ [NORMAL FLOW] selesai`);
  }

  /**
   * Run periodic flow
   * @private
   */
  async _runPeriodicFlow() {
    if (!this.config.periodic_enabled) {
      return;
    }

    this._log('INFO', `🔄 [PERIODIC FLOW] dimulai`);

    // Pre-delay
    await this._delay(this.config.d_pre_periodic);

    // Switch to periodic tab
    await this._switchToTab(this.config.tab_periodic);
    await this._delay(this.config.d_periodic_tab_switch);

    // Execute each enabled periodic step
    for (const step of this.config.periodic_steps) {
      if (!step.enabled) continue;

      await this._clickTarget(step.target_type, step.css_selector, step.x, step.y);
      await this._delay(step.delay_after);

      this._log('SUCCESS', `✅ Periodic step "${step.label}" berhasil`);
    }

    // Post-delay
    await this._delay(this.config.d_post_periodic);

    // Switch back to Excel
    await this._switchToExcel();

    // Update last periodic execution
    this.state.last_periodic_at = this.state.counter;

    this._log('INFO', `✅ [PERIODIC FLOW] selesai`);
  }

  /**
   * Pause execution
   */
  pause() {
    this._isPaused = true;
    this.state.is_paused = true;
    this._log('WARN', '⏸ Eksekusi dijeda');
    this.onStateChange(this.state);
  }

  /**
   * Resume execution
   */
  resume() {
    this._isPaused = false;
    this.state.is_paused = false;
    this._log('INFO', '▶ Eksekusi dilanjutkan');
    this.onStateChange(this.state);
  }

  /**
   * Stop execution
   */
  stop() {
    this._isStopped = true;
    this._isPaused = false;
    this.state.is_running = false;
    this._clearTimers();
    this._log('WARN', '⏹ Eksekusi dihentikan');
    this.onStateChange(this.state);
  }

  /**
   * Validate configuration
   * @private
   */
  _validate() {
    const errors = [];

    // Check required fields
    if (!this.config.excel_path || this.config.excel_path.trim() === '') {
      errors.push('Path file Excel tidak boleh kosong');
    }

    if (!this.config.sheet_name || this.config.sheet_name.trim() === '') {
      errors.push('Nama sheet tidak boleh kosong');
    }

    // Check column format
    if (!/^[A-Za-z]+$/.test(this.config.kolom)) {
      errors.push('Kolom harus huruf (A, B, C, ...)');
    }

    // Check row range
    if (this.config.row_start < 1) {
      errors.push('Row start harus >= 1');
    }

    if (this.config.row_end < this.config.row_start) {
      errors.push('Row end harus >= row start');
    }

    // Check normal tab
    if (!this.config.tab_normal || this.config.tab_normal.trim() === '') {
      errors.push('Tab normal tidak boleh kosong');
    }

    // Check for at least one paste_field step
    const hasPasteStep = this.config.normal_steps.some(
      s => s.enabled && s.type === 'paste_field'
    );
    if (!hasPasteStep) {
      errors.push('Minimal harus ada 1 step "Paste Field" yang aktif');
    }

    // Check periodic config if enabled
    if (this.config.periodic_enabled) {
      if (!this.config.tab_periodic || this.config.tab_periodic.trim() === '') {
        errors.push('Tab periodic tidak boleh kosong saat periodic flow aktif');
      }

      if (this.config.periodic_every < 1) {
        errors.push('Periodic every harus >= 1');
      }
    }

    // Check each step
    const allSteps = [
      ...this.config.normal_steps,
      ...this.config.periodic_steps
    ];

    for (const step of allSteps) {
      if (!step.enabled) continue;

      if (!step.label || step.label.trim() === '') {
        errors.push(`Step harus memiliki label (ID: ${step.id})`);
      }

      if (step.target_type === 'selector') {
        if (!step.css_selector || step.css_selector.trim() === '') {
          errors.push(`Step "${step.label}" harus memiliki CSS selector`);
        }
      } else if (step.target_type === 'coordinate') {
        if (step.x === undefined || step.y === undefined) {
          errors.push(`Step "${step.label}" harus memiliki koordinat X dan Y`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error('Konfigurasi tidak valid:\n' + errors.join('\n'));
    }

    // Update total_loop
    this.config.total_loop = computeTotalLoop(this.config);
  }

  /**
   * Main execution loop
   */
  async run() {
    try {
      // Validate configuration
      this._validate();

      // Read Excel file
      this._log('INFO', `📂 Membaca: ${this.config.excel_path}`);
      let excelData;
      try {
        excelData = await this._readExcel();
        if (!excelData || !Array.isArray(excelData) || excelData.length === 0) {
          throw new Error('File Excel belum berhasil dimuat. Coba pilih file lagi.');
        }
      } catch (err) {
        this._log('ERROR', `❌ Error membaca file: ${err.message}`);
        throw err;
      }

      const rowStart = Number(this.config.row_start) || 1;
      const actualRows = excelData.length;
      const effectiveEnd = Math.min(Number(this.config.row_end) || actualRows, actualRows);
      this.config.row_end = effectiveEnd;
      this.config.total_loop = Math.max(0, effectiveEnd - rowStart + 1);

      // Reset state
      this.state = {
        is_running: true,
        is_paused: false,
        current_row: rowStart,
        counter: 0,
        consecutive_empty_count: 0,
        total_processed: 0,
        total_skipped: 0,
        errors: [],
        current_value: '',
        last_periodic_at: 0,
        total_rows: actualRows
      };

      this._log('INFO', `🚀 Mulai: ${this.config.total_loop} loop`);
      this.onStateChange(this.state);

      // Main loop
      while (this.state.current_row <= this.config.row_end) {
        // Check if stopped
        if (this._isStopped) break;

        // Handle pause
        while (this._isPaused && !this._isStopped) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (this._isStopped) break;

        // Log loop start
        this._log('INFO', `━━━ Loop ${this.state.counter + 1}/${this.config.total_loop} | Baris ${this.state.current_row} ━━━`);

        // Get cell value
        const val = this._getCellValue(excelData, this.state.current_row, this.config.kolom);
        this.state.current_value = val;

        // Handle empty cell
        if (!val || val.trim() === '') {
          this.state.consecutive_empty_count++;

          if (this.config.skip_empty) {
            this._log('WARN', `⏭ Baris kosong, dilewati`);
            this.state.total_skipped++;
            this.state.current_row++;
            this.onStateChange(this.state);
            continue;
          }

          if (
            this.config.stop_on_consecutive_empty &&
            this.state.consecutive_empty_count >= this.config.consecutive_empty_limit
          ) {
            this._log('WARN', `⚠️ ${this.config.consecutive_empty_limit} baris kosong berurutan, dihentikan`);
            break;
          }
        } else {
          this.state.consecutive_empty_count = 0;
        }

        // Run normal flow
        try {
          await this._runNormalFlow(val);
          this.state.total_processed++;
          this.state.counter++;
        } catch (err) {
          this._log('ERROR', `❌ Error di loop: ${err.message}`);
          this.state.errors.push(err.message);
          this.state.counter++;
        }

        this.state.current_row++;
        this.onStateChange(this.state);

        // Check periodic flow
        if (
          this.config.periodic_enabled &&
          this.state.counter > 0 &&
          this.state.counter % this.config.periodic_every === 0
        ) {
          try {
            await this._runPeriodicFlow();
          } catch (err) {
            this._log('ERROR', `❌ Error periodic flow: ${err.message}`);
          }
        }
      }

      // Mark as complete
      this.state.is_running = false;

      // Log completion
      if (!this._isStopped) {
        this._log('SUCCESS', `🎉 Selesai! ${this.state.total_processed} baris diproses, ${this.state.total_skipped} dilewati`);
      }

      this.onStateChange(this.state);
    } catch (err) {
      this.state.is_running = false;
      this._log('ERROR', `❌ Fatal error: ${err.message}`);
      this.onStateChange(this.state);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STUB METHODS — Implementasi diperlukan oleh developer
  // ═══════════════════════════════════════════════════════════

  /**
   * Switch to browser tab (NOP — handled by browser session)
   * @private
   */
  async _switchToTab(tabIdentifier) {
    // In Excel Loop context, tab is identified by name (e.g., URL or window title)
    // If using browser CDP, tab is already selected during normal flow setup
    // For desktop app, this would switch windows — implement as needed
    this._log('INFO', `📑 Tab: ${tabIdentifier}`);
  }

  /**
   * Copy value to clipboard
   * Uses Electron clipboard API via IPC if available
   * @private
   */
  async _copyToClipboard(value) {
    try {
      // Try to use Electron clipboard via require (if in main process)
      try {
        const { clipboard } = require('electron');
        if (clipboard) {
          clipboard.writeText(String(value || ''));
          this._log('INFO', `📋 Copy ke clipboard: "${String(value).substring(0, 50)}"`);
          return;
        }
      } catch (e) {
        // Not in main process, try alternative
      }

      // Fallback: use navigator.clipboard (if in renderer with secure context)
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(String(value || ''));
        this._log('INFO', `📋 Copy ke clipboard: "${String(value).substring(0, 50)}"`);
        return;
      }

      this._log('WARN', '⚠️ Clipboard tidak tersedia, copy operation skipped');
    } catch (err) {
      this._log('WARN', `⚠️ Copy error: ${err.message}`);
    }
  }

  /**
   * Click target element by selector or coordinate
   * @private
   */
  async _clickTarget(target_type, css_selector, x, y) {
    try {
      if (target_type === 'selector' && css_selector) {
        // Try to use Electron automation or browser CDP
        try {
          const { ipcRenderer } = require('electron');
          if (ipcRenderer) {
            // Request click via IPC to main process
            const result = await ipcRenderer.invoke('click-element', {
              selector: css_selector,
              x, y
            });
            if (result.success) {
              this._log('INFO', `👆 Klik selector: ${css_selector}`);
              return;
            }
          }
        } catch (e) {
          // Not in renderer with ipcRenderer
        }

        // Fallback: try direct DOM manipulation (if in browser)
        if (typeof document !== 'undefined') {
          const elem = document.querySelector(css_selector);
          if (elem) {
            elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 100));
            elem.click();
            this._log('INFO', `👆 Klik selector: ${css_selector}`);
            return;
          }
        }
      }

      if (target_type === 'coordinate' && x !== undefined && y !== undefined) {
        // Try to use robotjs for desktop automation
        try {
          const robot = require('robotjs');
          if (robot) {
            robot.moveMouse(Math.round(x), Math.round(y));
            await new Promise(r => setTimeout(r, 80));
            robot.mouseClick();
            this._log('INFO', `👆 Klik koordinat: ${x}, ${y}`);
            return;
          }
        } catch (e) {
          // robotjs not available
        }

        // Fallback: log warning
        this._log('WARN', `⚠️ Koordinat click tidak support (robotjs belum di-setup): ${x}, ${y}`);
        return;
      }

      this._log('WARN', `⚠️ Target tidak valid untuk click`);
    } catch (err) {
      this._log('WARN', `⚠️ Click error: ${err.message}`);
    }
  }

  /**
   * Paste from clipboard using keyboard emulation
   * @private
   */
  async _pasteClipboard() {
    try {
      // Try to use robotjs for keyboard emulation
      try {
        const robot = require('robotjs');
        if (robot) {
          robot.keyTap('v', ['control']);
          await new Promise(r => setTimeout(r, 50));
          this._log('INFO', `📥 Paste clipboard (Ctrl+V)`);
          return;
        }
      } catch (e) {
        // robotjs not available
      }

      // Try IPC to main process
      try {
        const { ipcRenderer } = require('electron');
        if (ipcRenderer) {
          const result = await ipcRenderer.invoke('paste-clipboard');
          if (result.success) {
            this._log('INFO', `📥 Paste clipboard`);
            return;
          }
        }
      } catch (e) {
        // ipcRenderer not available
      }

      this._log('WARN', `⚠️ Paste tidak support (robotjs/IPC belum di-setup)`);
    } catch (err) {
      this._log('WARN', `⚠️ Paste error: ${err.message}`);
    }
  }

  /**
   * Switch back to Excel window (NOP — handled by browser context)
   * @private
   */
  async _switchToExcel() {
    // In Excel Loop, we stay in same browser context
    // This is a placeholder for future desktop app integration
    this._log('INFO', `📑 Switch back to Excel`);
  }
}

module.exports = { ExcelLoopEngine };
