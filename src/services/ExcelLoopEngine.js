const { clipboard } = require('electron');
const fs = require('fs');
const XLSX = require('xlsx');
const { executeStep, DESKTOP_ACTIONS } = require('../executors/stepExecutor');
const { resolveTarget } = require('../engine/TargetResolver');

let browserManager = null;

function setBrowserManager(manager) {
  browserManager = manager;
}

function isUrl(value) {
  if (!value || typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

function normalizeBrowserProfileKey(profileKey, url) {
  if (profileKey && String(profileKey).trim()) {
    return String(profileKey).trim();
  }
  if (url && typeof url === 'string') {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (err) {
      return 'default';
    }
  }
  return 'default';
}

class ExcelLoopEngine {
  constructor(config, onStateUpdate, onLog) {
    this.config = config;
    this.onStateUpdate = onStateUpdate || (() => {});
    this.onLog = onLog || (() => {});
    this.isPaused = false;
    this.isStopped = false;
    this.activeTimers = [];
    this.clipboardValue = '';
    this.activeBrowserKey = null;
    this.state = {
      is_running: false,
      is_paused: false,
      current_row: config.row_start || 2,
      counter: 0,
      consecutive_empty_count: 0,
      total_processed: 0,
      total_skipped: 0,
      errors: [],
      current_value: '',
      last_periodic_at: 0,
    };
  }

  applyRandomVariance(ms) {
    const base = Number(ms) || 0;
    if (!this.config.random_delay) return base;
    const variance = Math.round(base * 0.2);
    const offset = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
    return Math.max(0, base + offset);
  }

  delay(ms) {
    const actual = this.applyRandomVariance(ms);
    this.onLog('INFO', `  ⏱ Menunggu ${actual}ms${this.config.random_delay ? ` (base: ${ms}ms ±20%)` : ''}`);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.activeTimers = this.activeTimers.filter(t => t !== timer);
        resolve();
      }, actual);
      this.activeTimers.push(timer);
    });
  }

  clearAllTimers() {
    this.activeTimers.forEach(clearTimeout);
    this.activeTimers = [];
  }

  getBrowserSession(key, createIfMissing = true) {
    if (!browserManager) {
      throw new Error('Browser manager belum diinisialisasi');
    }
    const profileKey = normalizeBrowserProfileKey(key, key);
    if (createIfMissing) {
      return browserManager.getOrCreate(profileKey).then(result => {
        if (!result || !result.session) {
          throw new Error(`Browser session gagal dibuat untuk key: ${profileKey}`);
        }
        return result.session;
      });
    }
    const session = browserManager.get(profileKey);
    if (!session) {
      throw new Error(`Browser session tidak ditemukan: ${profileKey}`);
    }
    return Promise.resolve(session);
  }

  async switchToTab(tabIdentifier) {
    if (!tabIdentifier) {
      throw new Error('Tab identifier tidak boleh kosong');
    }
    if (!browserManager) {
      throw new Error('Browser manager belum diset — tambahkan Tab Normal di konfigurasi');
    }
    const trimmed = String(tabIdentifier || '').trim();
    const key = normalizeBrowserProfileKey(trimmed, trimmed);
    let session = browserManager.get(key);

    if (isUrl(trimmed)) {
      const result = await browserManager.getOrCreate(key, { show: true });
      session = result.session;
      const nav = await browserManager.navigate(key, trimmed, 20000);
      if (!nav.success) {
        throw new Error(`Gagal navigasi ke ${trimmed}: ${nav.error || 'unknown'}`);
      }
      this.activeBrowserKey = key;
      this.onLog('INFO', `  🔀 Pindah ke tab: ${trimmed} (profile: ${key})`);
      return;
    }

    if (!session) {
      throw new Error(`Browser tab tidak ditemukan: ${trimmed}`);
    }
    this.activeBrowserKey = key;
    this.onLog('INFO', `  🔀 Aktifkan browser session: ${trimmed}`);
  }

  async copyToClipboard(value) {
    const text = String(value ?? '');
    this.clipboardValue = text;
    try {
      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(text);
      }
    } catch (err) {
      this.onLog('WARN', `  ⚠ Clipboard write error: ${err.message}`);
    }
    this.onLog('INFO', `  📋 Copy ke clipboard: "${text}"`);
  }

  async clickElement(step) {
    const session = await this.getBrowserSession(this.activeBrowserKey, false);
    if (!session) {
      throw new Error('Browser session belum tersedia untuk klik');
    }
    if (step.target_type === 'selector' && step.css_selector) {
      this.onLog('INFO', `  🖱 Klik selector: ${step.css_selector}`);
      const result = await browserManager.click(this.activeBrowserKey, {
        selector: step.css_selector,
        clickType: 'single',
        timeoutMs: 10000,
      });
      if (!result.success) {
        throw new Error(result.error || `Gagal klik selector ${step.css_selector}`);
      }
      return;
    }

    if (step.target_type === 'coordinate' && step.x !== undefined && step.y !== undefined) {
      this.onLog('INFO', `  🖱 Klik koordinat: (${step.x}, ${step.y})`);
      const script = `
        (async () => {
          const x = ${Number(step.x)};
          const y = ${Number(step.y)};
          const element = document.elementFromPoint(x, y);
          if (!element) {
            throw new Error('Tidak ada elemen pada koordinat ' + x + ',' + y);
          }
          element.scrollIntoView({ behavior:'instant', block:'center', inline:'center' });
          await new Promise(resolve => setTimeout(resolve, 150));
          element.click();
          return true;
        })();
      `;
      const result = await session.window.webContents.executeJavaScript(script, true);
      if (result !== true) {
        throw new Error('Gagal klik koordinat');
      }
      return;
    }

    throw new Error(`Step "${step.label}": target tidak valid (selector atau koordinat harus diisi)`);
  }

  async pasteFromClipboard() {
    if (!this.activeBrowserKey) {
      throw new Error('Tidak ada browser session aktif untuk paste');
    }
    const session = await this.getBrowserSession(this.activeBrowserKey, false);
    if (!session) {
      throw new Error('Browser session tidak tersedia untuk paste');
    }
    const payload = this.clipboardValue;
    this.onLog('INFO', `  📌 Paste ke elemen aktif`);
    const script = `
      (async () => {
        const active = document.activeElement;
        if (!active) {
          throw new Error('Tidak ada elemen aktif untuk paste');
        }
        const value = ${JSON.stringify(payload)};
        if ('value' in active) {
          active.focus();
          active.value = value;
          active.dispatchEvent(new Event('input', { bubbles:true }));
          return true;
        }
        if (active.isContentEditable) {
          active.focus();
          document.execCommand('insertText', false, value);
          return true;
        }
        throw new Error('Elemen aktif tidak mendukung input teks');
      })();
    `;
    const result = await session.window.webContents.executeJavaScript(script, true);
    if (result !== true) {
      throw new Error('Paste tidak berhasil');
    }
  }

  async switchToExcelTab() {
    this.onLog('INFO', '  🔀 Kembali ke tab Excel (data dibaca langsung dari file Excel)');
    return;
  }

  privateEnsureBrowserKey() {
    if (!this.activeBrowserKey) {
      throw new Error('Browser session belum ditentukan. Pastikan tab_normal atau tab_periodic sudah dikonfigurasi.');
    }
  }

  async runNormalFlow(cellValue, excelData, resolvedTarget) {
    this.onLog('INFO', `📋 [NORMAL FLOW] Nilai: "${cellValue}"`);
    
    await this.copyToClipboard(cellValue);
    await this.delay(this.config.d_after_copy);

    const activeSteps = (this.config.normal_steps || []).filter(s => s.enabled);
    for (const step of activeSteps) {
      if (this.isStopped) return;
      const rowData = excelData[this.state.current_row - 1] || [];
      const context = {
        rowNumber: this.state.current_row,
        row_number: this.state.current_row,
        current_row: this.state.current_row,
        loopIndex: this.state.counter + 1,
        counter: this.state.counter + 1,
        currentCellValue: cellValue,
        current_value: cellValue,
        excel_value: cellValue,
        rowData,
        browserManager,
      };

      try {
        await executeStep(step, context, resolvedTarget, (level, message) => this.onLog(level, message));
        this.onLog('SUCCESS', `  ✅ Step "${step.label}" selesai`);
      } catch (err) {
        this.onLog('ERROR', `❌ Baris ${this.state.current_row} | Step "${step.label}": ${err.message}`);
        throw err;
      }
    }

    await this.switchToExcelTab();
    await this.delay(this.config.d_end_loop);
    this.onLog('SUCCESS', `✅ [NORMAL FLOW] Selesai`);
  }

  async runPeriodicFlow() {
    if (!this.config.periodic_enabled) return;
    this.onLog('INFO', `🔄 [PERIODIC FLOW] Dimulai (counter: ${this.state.counter})`);

    await this.delay(this.config.d_pre_periodic);
    await this.switchToTab(this.config.tab_periodic);
    await this.delay(this.config.d_periodic_tab_switch);

    const activeSteps = (this.config.periodic_steps || []).filter(s => s.enabled);
    for (const step of activeSteps) {
      if (this.isStopped) return;
      const actionContext = {
        rowNumber: this.state.current_row,
        row_number: this.state.current_row,
        current_row: this.state.current_row,
        currentCellValue: '',
        current_value: '',
        excel_value: '',
        rowData: [],
        browserManager,
      };
      
      try {
        await executeStep(step, actionContext, this.resolvedTarget, (level, message) => this.onLog(level, message));
        this.onLog('SUCCESS', `  ✅ Periodic step "${step.label}" selesai`);
      } catch (err) {
        this.onLog('ERROR', `❌ Periodic step "${step.label}" gagal: ${err.message}`);
      }
    }

    await this.delay(this.config.d_post_periodic);
    await this.switchToExcelTab();
    this.state.last_periodic_at = this.state.counter;
    this.onLog('SUCCESS', `✅ [PERIODIC FLOW] Selesai`);
  }

  pause() {
    if (!this.state.is_running) return;
    this.isPaused = true;
    this.state.is_paused = true;
    this.onLog('WARN', `⏸ Dijeda pada loop ${this.state.counter}`);
    this.onStateUpdate({ ...this.state });
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.state.is_paused = false;
    this.onLog('INFO', `▶ Dilanjutkan dari loop ${this.state.counter}`);
    this.onStateUpdate({ ...this.state });
  }

  stop() {
    this.isStopped = true;
    this.isPaused = false;
    this.state.is_running = false;
    this.state.is_paused = false;
    this.clearAllTimers();
    this.onLog('ERROR', `⏹ Dihentikan pada loop ${this.state.counter}`);
    this.onStateUpdate({ ...this.state });
  }

  getCellValue(data, row, col) {
    const colIndex = String(col || '').toUpperCase().charCodeAt(0) - 65;
    if (Number.isNaN(colIndex) || colIndex < 0) return '';
    const rowData = data[row - 1] || [];
    const value = rowData[colIndex] ?? '';
    const text = String(value);
    return this.config.trim_spaces ? text.trim() : text;
  }

  readExcelData() {
    if (!this.config.excel_path) {
      throw new Error('Path file Excel harus diisi');
    }
    if (!fs.existsSync(this.config.excel_path)) {
      throw new Error(`File Excel tidak ditemukan: ${this.config.excel_path}`);
    }

    const workbook = XLSX.readFile(this.config.excel_path);
    const sheet = workbook.Sheets[this.config.sheet_name];
    if (!sheet) {
      throw new Error(`Sheet "${this.config.sheet_name}" tidak ditemukan di file Excel`);
    }
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  }

  validateConfig() {
    const errors = [];
    if (!this.config.excel_path) errors.push('Path file Excel harus diisi');
    if (!this.config.sheet_name) errors.push('Nama sheet harus diisi');
    if (!this.config.kolom || !/^[A-Za-z]+$/.test(this.config.kolom)) errors.push('Kolom harus berupa huruf (A, B, C, ...)');
    if (Number(this.config.row_start) < 1) errors.push('Row Mulai minimal 1');
    if (Number(this.config.row_end) < Number(this.config.row_start)) errors.push('Row Akhir harus >= Row Mulai');
    const targetConfig = this.config.targetConfig || {};
    if (targetConfig.type === 'browser_url') {
      const normalizedUrl = String(targetConfig.url || this.config.tab_normal || '').trim();
      if (!normalizedUrl) errors.push('Tab Normal atau Target URL harus diisi');
    } else if (targetConfig.type === 'desktop_exe') {
      if (!String(targetConfig.windowTitle || '').trim()) errors.push('Target Desktop Window harus diisi');
    } else if (targetConfig.type === 'excel_lookup') {
      if (!String(targetConfig.lookupColumn || '').trim()) errors.push('Target Excel Lookup membutuhkan Kolom Lookup');
      if (!String(targetConfig.lookupKey || '').trim()) errors.push('Target Excel Lookup membutuhkan Kunci Lookup');
    } else if (targetConfig.type === 'image_match') {
      if (!String(targetConfig.imagePath || '').trim()) errors.push('Target Image Match membutuhkan path image');
    } else if (targetConfig.type === 'multi_target') {
      if (!String(targetConfig.targetsText || '').trim()) errors.push('Target Multi Target membutuhkan daftar target');
    } else if (targetConfig.type === 'script') {
      if (!String(targetConfig.script || '').trim()) errors.push('Target Script harus diisi');
    }
    const hasPasteStep = (this.config.normal_steps || []).some(s => s.type === 'paste_field' && s.enabled);
    if (!hasPasteStep) errors.push('Normal Flow harus memiliki minimal 1 langkah Paste Field yang aktif');
    if (this.config.periodic_enabled) {
      if (!this.config.tab_periodic) errors.push('Tab Periodic harus diisi jika Periodic Flow diaktifkan');
      if (Number(this.config.periodic_every) < 1) errors.push('Periodic setiap minimal 1 loop');
    }
    (this.config.normal_steps || []).filter(s => s.enabled).forEach((step, i) => {
      if (!step.label) errors.push(`Normal Step ${i + 1}: label harus diisi`);
      if (step.target_type === 'selector' && !step.css_selector) {
        errors.push(`Normal Step ${i + 1} "${step.label}": CSS selector harus diisi`);
      }
      if (step.target_type === 'coordinate' && (step.x === undefined || step.y === undefined)) {
        errors.push(`Normal Step ${i + 1} "${step.label}": koordinat X dan Y harus diisi`);
      }
    });
    if (this.config.periodic_enabled) {
      (this.config.periodic_steps || []).filter(s => s.enabled).forEach((step, i) => {
        if (!step.label) errors.push(`Periodic Step ${i + 1}: label harus diisi`);
        if (step.target_type === 'selector' && !step.css_selector) {
          errors.push(`Periodic Step ${i + 1} "${step.label}": CSS selector harus diisi`);
        }
        if (step.target_type === 'coordinate' && (step.x === undefined || step.y === undefined)) {
          errors.push(`Periodic Step ${i + 1} "${step.label}": koordinat X dan Y harus diisi`);
        }
      });
    }
    if (errors.length) {
      throw new Error('Konfigurasi tidak valid:\n' + errors.map(e => `• ${e}`).join('\n'));
    }
    this.config.total_loop = Math.max(0, Number(this.config.row_end) - Number(this.config.row_start) + 1);
    this.onLog('INFO', '✅ Validasi konfigurasi OK');
  }

  async run() {
    this.validateConfig();
    let excelData;
    try {
      excelData = this.readExcelData();
      const actualRows = excelData.length;
      const rowStart = Math.max(1, Number(this.config.row_start));
      const rowEnd = Math.min(Math.max(Number(this.config.row_end), rowStart), actualRows);
      this.config.row_end = rowEnd;
      this.config.total_loop = Math.max(0, rowEnd - rowStart + 1);
      this.onLog('SUCCESS', `✅ File berhasil dibaca. Total baris di sheet: ${actualRows}`);
    } catch (err) {
      this.onLog('ERROR', `❌ Gagal membaca Excel: ${err.message}`);
      throw err;
    }

    // Resolve target SEKALI di awal loop (bukan per baris)
    let resolvedTarget;
    try {
      const initialContext = {
        rowNumber: Math.max(1, Number(this.config.row_start)),
        row_number: Math.max(1, Number(this.config.row_start)),
        current_row: Math.max(1, Number(this.config.row_start)),
        currentCellValue: '',
        current_value: '',
        excel_value: '',
        rowData: excelData[Math.max(1, Number(this.config.row_start)) - 1] || [],
        excelData,
        browserManager,
        config: this.config,
        onLog: this.onLog,
      };
      this.onLog('INFO', `Resolving target...`);
      resolvedTarget = await resolveTarget(this.config.targetConfig || {}, initialContext, (level, message) => this.onLog(level, message));
      this.resolvedTarget = resolvedTarget;
    } catch (e) {
      this.onLog('ERROR', '❌ Gagal resolve target: ' + e.message);
      throw e;
    }

    this.state = {
      ...this.state,
      is_running: true,
      is_paused: false,
      current_row: Math.max(1, Number(this.config.row_start)),
      counter: 0,
      consecutive_empty_count: 0,
      total_processed: 0,
      total_skipped: 0,
      errors: [],
      current_value: '',
      last_periodic_at: 0,
    };
    this.isPaused = false;
    this.isStopped = false;
    this.onStateUpdate({ ...this.state });
    this.onLog('INFO', `🚀 Mulai eksekusi: ${this.config.total_loop} loop (baris ${this.config.row_start} - ${this.config.row_end})`);

    while (this.state.current_row <= this.config.row_end) {
      if (this.isStopped) break;
      while (this.isPaused && !this.isStopped) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (this.isStopped) break;

      const currentRow = this.state.current_row;
      this.onLog('INFO', `━━━ Loop ${this.state.counter + 1}/${this.config.total_loop} | Baris ${currentRow} ━━━`);
      const cellValue = this.getCellValue(excelData, currentRow, this.config.kolom);
      this.state.current_value = cellValue;

      if (!cellValue) {
        this.state.consecutive_empty_count += 1;
        if (this.config.skip_empty) {
          this.onLog('WARN', `⚠ Baris ${currentRow} kosong, dilewati`);
          this.state.total_skipped += 1;
          this.state.current_row += 1;
          this.onStateUpdate({ ...this.state });
          continue;
        }
        if (this.config.stop_on_consecutive_empty && this.state.consecutive_empty_count >= this.config.consecutive_empty_limit) {
          this.onLog('WARN', `⚠ ${this.config.consecutive_empty_limit} baris kosong berurutan. Eksekusi dihentikan.`);
          break;
        }
      } else {
        this.state.consecutive_empty_count = 0;
      }

      this.onLog('INFO', `📌 Nilai cell: "${cellValue}"`);
      try {
        await this.runNormalFlow(cellValue, excelData, resolvedTarget);
        this.state.total_processed += 1;
        this.state.counter += 1;
      } catch (err) {
        const errMsg = `Loop ${this.state.counter + 1} | Baris ${currentRow}: ${err.message}`;
        this.onLog('ERROR', `❌ ${errMsg}`);
        this.state.errors.push(errMsg);
        this.state.counter += 1;
        if (this.config.stopOnError || this.config.stop_on_error) {
          this.isStopped = true;
          break;
        }
      }

      this.state.current_row += 1;
      this.onStateUpdate({ ...this.state });

      if (this.config.periodic_enabled && this.state.counter > 0 && this.state.counter % this.config.periodic_every === 0) {
        this.onLog('INFO', `🔄 Counter ${this.state.counter} — Waktunya Periodic Flow!`);
        try {
          await this.runPeriodicFlow();
        } catch (err) {
          this.onLog('ERROR', `❌ Periodic Flow error: ${err.message}`);
        }
      }
    }

    this.state.is_running = false;
    this.state.is_paused = false;
    if (!this.isStopped) {
      this.onLog('SUCCESS', `🎉 Eksekusi selesai! ${this.state.total_processed} baris diproses, ${this.state.total_skipped} dilewati`);
    }
    this.onStateUpdate({ ...this.state });
  }
}

module.exports = {
  ExcelLoopEngine,
  setBrowserManager,
};
