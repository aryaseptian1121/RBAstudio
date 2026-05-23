const ipcRenderer = window.electronAPI;
const {
  createDefaultConfig,
  createDefaultPasteStep,
  createDefaultClickStep,
  createDefaultTargetConfig,
  createDefaultFocusWindowStep,
  createDefaultCoordinateClickStep,
  createDefaultTypeOrPasteStep,
  createDefaultPressKeyStep,
  createDefaultUploadFileDialogStep,
  createDefaultWaitWindowStep,
  createDefaultPeriodicStep,
  computeTotalLoop,
  estimateTimeMs,
  formatDuration,
} = require('../utils/excelLoopDefaults');
const {
  saveExcelLoopConfig,
  loadExcelLoopConfig,
  exportConfigToJSON,
  importConfigFromJSON,
  migrateOldConfig,
} = require('../services/ExcelLoopStorage');

let panelRoot = null;
let panelState = {
  node: null,
  config: null,
  activeTab: 'excel',
  isRunning: false,
  isPaused: false,
};

function createConfigFromNode(node) {
  const defaultConfig = createDefaultConfig();
  if (!node || !node.data) return defaultConfig;
  const loadedConfig = migrateOldConfig(node.data.excelConfig || loadExcelLoopConfig() || {});
  return Object.assign({}, defaultConfig, loadedConfig);
}

function openExcelLoopPanel(node) {
  panelState.node = node;
  panelState.config = createConfigFromNode(node);
  if (!panelState.node.data) panelState.node.data = {};
  panelState.node.data.excelConfig = panelState.config;
  saveExcelLoopConfig(panelState.config);
  renderPanel();
}

function closeExcelLoopPanel() {
  if (!panelRoot) return;
  ipcRenderer.removeAllListeners('excel-loop-log');
  ipcRenderer.removeAllListeners('excel-loop-state');
  panelRoot.remove();
  panelRoot = null;
  panelState = { node: null, config: null, activeTab: 'excel', isRunning: false, isPaused: false };
}

function renderPanel() {
  if (!panelRoot) {
    panelRoot = document.createElement('div');
    panelRoot.id = 'excel-loop-panel-root';
    panelRoot.style.cssText = 'position:fixed;inset:0;background:rgba(7,12,24,0.92);padding:24px;overflow:auto;z-index:99999;font-family:Inter,Arial,sans-serif;color:#e2e8f0;';
    document.body.appendChild(panelRoot);
  }

  panelRoot.innerHTML = `
    <div style="max-width:1120px;margin:0 auto;background:#0f172a;border:1px solid rgba(148,163,184,0.15);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.75);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 26px;background:#111827;border-bottom:1px solid rgba(148,163,184,0.12);">
        <div>
          <div style="font-size:18px;font-weight:800;color:#fff;">Excel Loop Automation</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px;max-width:720px;line-height:1.5;">Konfigurasi pembacaan Excel baris per baris lalu jalankan alur otomatis untuk setiap baris. Gunakan panel ini untuk menyimpan, preview, dan menjalankan loop Excel.</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button id="excel-loop-export" style="border:none;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;border:1px solid rgba(148,163,184,0.18);cursor:pointer;">Export JSON</button>
          <button id="excel-loop-import" style="border:none;background:#1d2939;color:#fff;padding:10px 14px;border-radius:10px;border:1px solid rgba(148,163,184,0.18);cursor:pointer;">Import JSON</button>
          <button id="excel-loop-close" style="border:none;background:#ef4444;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Close</button>
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;padding:16px 26px;background:#0b1220;">
        ${renderTabButton('excel', 'Excel')}
        ${renderTabButton('normal', 'Normal Flow')}
        ${renderTabButton('periodic', 'Periodic Flow')}
        ${renderTabButton('delay', 'Delay')}
        ${renderTabButton('preview', 'Preview')}
        ${renderTabButton('run', 'Jalankan')}
      </div>
      <div id="excel-loop-content" style="padding:0 26px 26px;"></div>
    </div>
  `;

  attachPanelEvents();
  renderTabContent();
}

function renderTabButton(tab, label) {
  return `<button data-tab="${tab}" class="excel-loop-tab-btn" style="border:none;background:transparent;color:#94a3b8;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700;">${label}</button>`;
}

function attachPanelEvents() {
  const closeBtn = panelRoot.querySelector('#excel-loop-close');
  const exportBtn = panelRoot.querySelector('#excel-loop-export');
  const importBtn = panelRoot.querySelector('#excel-loop-import');
  const tabs = panelRoot.querySelectorAll('.excel-loop-tab-btn');

  closeBtn?.addEventListener('click', closeExcelLoopPanel);
  exportBtn?.addEventListener('click', () => exportConfigToJSON(panelState.config));
  importBtn?.addEventListener('click', async () => {
    try {
      const config = await importConfigFromJSON();
      panelState.config = { ...createDefaultConfig(), ...config };
      if (panelState.node) {
        panelState.node.data = panelState.node.data || {};
        panelState.node.data.excelConfig = panelState.config;
      }
      saveExcelLoopConfig(panelState.config);
      renderTabContent();
    } catch (err) {
      appendLog('ERROR', err.message || 'Import gagal');
    }
  });

  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      panelState.activeTab = btn.dataset.tab;
      renderTabContent();
    });
  });

  ipcRenderer.removeAllListeners('excel-loop-log');
  ipcRenderer.removeAllListeners('excel-loop-state');
  ipcRenderer.on('excel-loop-log', (_, payload) => {
    appendLog(payload.level, payload.message);
  });
  ipcRenderer.on('excel-loop-state', (_, payload) => {
    panelState.isRunning = payload.is_running;
    panelState.isPaused = payload.is_paused;
    updateRunStatus(payload);
  });
}

function renderTabContent() {
  const container = panelRoot.querySelector('#excel-loop-content');
  if (!container) return;
  container.innerHTML = '';

  if (panelState.activeTab === 'excel') {
    container.innerHTML = renderExcelTabContent();
  } else if (panelState.activeTab === 'normal') {
    container.innerHTML = renderNormalFlowContent();
  } else if (panelState.activeTab === 'periodic') {
    container.innerHTML = renderPeriodicFlowContent();
  } else if (panelState.activeTab === 'delay') {
    container.innerHTML = renderDelayContent();
  } else if (panelState.activeTab === 'preview') {
    container.innerHTML = renderPreviewContent();
  } else if (panelState.activeTab === 'run') {
    container.innerHTML = renderRunContent();
  }

  updateTabButtons();
  attachContentEvents();
}

function updateTabButtons() {
  panelRoot.querySelectorAll('.excel-loop-tab-btn').forEach((btn) => {
    if (btn.dataset.tab === panelState.activeTab) {
      btn.style.background = '#1d2939';
      btn.style.color = '#fff';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#94a3b8';
    }
  });
}

function attachContentEvents() {
  const bindings = [
    ['excel-path', 'excel_path'],
    ['excel-sheet', 'sheet_name'],
    ['excel-column', 'kolom'],
    ['excel-row-start', 'row_start', 'number'],
    ['excel-row-end', 'row_end', 'number'],
    ['tab-normal', 'tab_normal'],
    ['tab-periodic', 'tab_periodic'],
    ['periodic-every', 'periodic_every', 'number'],
    ['delay-after-copy', 'd_after_copy', 'number'],
    ['delay-tab-switch', 'd_tab_switch', 'number'],
    ['delay-before-paste', 'd_before_paste', 'number'],
    ['delay-after-paste', 'd_after_paste', 'number'],
    ['delay-between-clicks', 'd_between_clicks', 'number'],
    ['delay-end-loop', 'd_end_loop', 'number'],
    ['delay-pre-periodic', 'd_pre_periodic', 'number'],
    ['delay-periodic-switch', 'd_periodic_tab_switch', 'number'],
    ['delay-post-periodic', 'd_post_periodic', 'number'],
  ];

  bindings.forEach(([id, key, type]) => {
    const el = panelRoot.querySelector(`#${id}`);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = Boolean(panelState.config[key]);
      el.addEventListener('change', () => updateConfig(key, el.checked));
    } else {
      el.value = panelState.config[key] ?? '';
      el.addEventListener('input', () => {
        const rawValue = el.value;
        updateConfig(key, type === 'number' ? Number(rawValue) : rawValue);
      });
    }
  });

  const fileBrowse = panelRoot.querySelector('#excel-browse');
  fileBrowse?.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('open-file-dialog', {
      title: 'Pilih file Excel',
      properties: ['openFile'],
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    });
    if (result?.canceled || !result.filePaths?.length) return;
    updateConfig('excel_path', result.filePaths[0]);
    renderTabContent();
  });

  const skipEmpty = panelRoot.querySelector('#skip-empty');
  const trimSpaces = panelRoot.querySelector('#trim-spaces');
  const stopConsecutive = panelRoot.querySelector('#stop-consecutive');
  const consecutiveLimit = panelRoot.querySelector('#consecutive-limit');

  skipEmpty?.addEventListener('change', () => updateConfig('skip_empty', skipEmpty.checked));
  trimSpaces?.addEventListener('change', () => updateConfig('trim_spaces', trimSpaces.checked));
  stopConsecutive?.addEventListener('change', () => {
    updateConfig('stop_on_consecutive_empty', stopConsecutive.checked);
    renderTabContent();
  });
  consecutiveLimit?.addEventListener('input', () => updateConfig('consecutive_empty_limit', Number(consecutiveLimit.value)));

  const randomDelay = panelRoot.querySelector('#random-delay');
  randomDelay?.addEventListener('change', () => updateConfig('random_delay', randomDelay.checked));

  const targetType = panelRoot.querySelector('#target-type');
  const targetConfigFields = [
    ['target-url', 'url'],
    ['target-urlmatch', 'urlMatchMode'],
    ['target-open-if-not-found', 'openIfNotFound', 'checkbox'],
    ['target-debug-port', 'debugPort', 'number'],
    ['target-window-title', 'windowTitle'],
    ['target-timeout', 'timeout', 'number'],
    ['target-lookup-column', 'lookupColumn'],
    ['target-lookup-key', 'lookupKey'],
    ['target-image-path', 'imagePath'],
    ['target-multi-list', 'targetsText'],
    ['target-script', 'script'],
  ];

  const updateTargetField = (field, value) => {
    updateConfig('targetConfig', { ...panelState.config.targetConfig, [field]: value });
  };

  targetType?.addEventListener('change', () => {
    updateTargetField('type', targetType.value);
    renderTabContent();
  });

  targetConfigFields.forEach(([id, field, type]) => {
    const el = panelRoot.querySelector(`#${id}`);
    if (!el) return;
    if (type === 'checkbox' || el.type === 'checkbox') {
      el.checked = Boolean(panelState.config.targetConfig?.[field]);
      el.addEventListener('change', () => updateTargetField(field, el.checked));
    } else {
      const currentValue = panelState.config.targetConfig?.[field];
      el.value = currentValue != null ? currentValue : '';
      el.addEventListener('input', () => {
        let value = el.value;
        if (type === 'number') value = Number(value);
        updateTargetField(field, value);
      });
    }
  });

  panelRoot.querySelectorAll('.target-test-button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetConfig = panelState.config.targetConfig || {};
      const targetType = btn.dataset.targetType;
      appendLog('INFO', `Menguji target: ${targetType}`);
      try {
        let result;
        if (targetType === 'browser_url') {
          result = await ipcRenderer.invoke('test-browser-url', {
            url: targetConfig.url || '',
            matchMode: targetConfig.urlMatchMode || 'contains',
            port: Number(targetConfig.debugPort || 9222)
          });
        } else if (targetType === 'desktop_exe') {
          result = await ipcRenderer.invoke('test-focus-window', {
            windowTitle: targetConfig.windowTitle || '',
            exeName: '',
            restoreIfMinimized: true
          });
        } else {
          result = await ipcRenderer.invoke('excel-loop-test-target', { targetConfig });
        }

        if (result?.ok || result?.success) {
          appendLog('SUCCESS', `Target test berhasil: ${result.message || 'Koneksi sukses'}`);
        } else {
          appendLog('ERROR', `Target test gagal: ${result?.message || result?.error || 'unknown error'}`);
        }
      } catch (err) {
        appendLog('ERROR', err.message || 'Target test gagal');
      }
    });
  });

  const openChromeDebugBtn = panelRoot.querySelector('#target-open-chrome-debug');
  openChromeDebugBtn?.addEventListener('click', async () => {
    const targetConfig = panelState.config.targetConfig || {};
    const port = Number(targetConfig.debugPort || 9222);
    appendLog('INFO', `Membuka Chrome dengan remote debugging port ${port}...`);
    try {
      const result = await ipcRenderer.invoke('open-chrome-debug', { port });
      if (result?.ok) {
        appendLog('SUCCESS', result.message || 'Chrome debug berhasil dibuka.');
      } else {
        appendLog('ERROR', result?.message || 'Gagal membuka Chrome debug.');
      }
    } catch (err) {
      appendLog('ERROR', err.message || 'Gagal membuka Chrome debug.');
    }
  });

  const scanWindowsBtn = panelRoot.querySelector('#target-scan-windows');
  const scanListContainer = panelRoot.querySelector('#target-scan-list-container');
  const scanList = panelRoot.querySelector('#target-scan-list');

  scanWindowsBtn?.addEventListener('click', async () => {
    appendLog('INFO', 'Memindai window aktif...');
    scanWindowsBtn.disabled = true;
    const originalText = scanWindowsBtn.textContent;
    scanWindowsBtn.textContent = 'Memindai...';
    try {
      const result = await ipcRenderer.invoke('scan-open-windows');
      if (result?.ok && result.windows) {
        appendLog('SUCCESS', `Ditemukan ${result.windows.length} window aktif.`);
        if (scanList && scanListContainer) {
          scanList.innerHTML = '';
          result.windows.forEach(win => {
            const title = typeof win === 'string' ? win : (win?.title || '');
            const ownerName = typeof win === 'string' ? '' : (win?.owner?.name || '');
            
            const item = document.createElement('div');
            item.className = 'scan-window-item';
            item.style.cssText = 'padding:6px 10px;background:#1e293b;border-radius:6px;cursor:pointer;font-size:11px;transition:background 0.2s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            item.title = ownerName ? `${title} (${ownerName})` : title;
            item.innerHTML = ownerName 
              ? `<span style="color:#38bdf8;">[${escapeHtml(ownerName)}]</span> ${escapeHtml(title)}`
              : escapeHtml(title);
            
            item.addEventListener('mouseenter', () => { item.style.background = '#334155'; });
            item.addEventListener('mouseleave', () => { item.style.background = '#1e293b'; });
            
            item.addEventListener('click', () => {
              const titleInput = panelRoot.querySelector('#target-window-title');
              if (titleInput) {
                titleInput.value = title;
                titleInput.dispatchEvent(new Event('input'));
                appendLog('INFO', `Window terpilih: "${title}"`);
              }
            });
            scanList.appendChild(item);
          });
          scanListContainer.style.display = 'block';
        }
      } else {
        appendLog('ERROR', `Gagal memindai window: ${result?.message || 'unknown error'}`);
      }
    } catch (err) {
      appendLog('ERROR', err.message || 'Gagal memindai window');
    } finally {
      scanWindowsBtn.disabled = false;
      scanWindowsBtn.textContent = originalText;
    }
  });

  const normalAddPaste = panelRoot.querySelector('#normal-add-paste');
  const normalAddClick = panelRoot.querySelector('#normal-add-click');
  const normalAddFocusWindow = panelRoot.querySelector('#normal-add-focus-window');
  const normalAddCoordinateClick = panelRoot.querySelector('#normal-add-coordinate-click');
  const normalAddPasteOrType = panelRoot.querySelector('#normal-add-paste-or-type');
  const normalAddPressKey = panelRoot.querySelector('#normal-add-press-key');
  const normalAddUploadFile = panelRoot.querySelector('#normal-add-upload-file');
  const normalAddWaitWindow = panelRoot.querySelector('#normal-add-wait-window');
  const periodicAdd = panelRoot.querySelector('#periodic-add-step');
  normalAddPaste?.addEventListener('click', () => addNormalStep('paste_field'));
  normalAddClick?.addEventListener('click', () => addNormalStep('click'));
  normalAddFocusWindow?.addEventListener('click', () => addNormalStep('fokus_window'));
  normalAddCoordinateClick?.addEventListener('click', () => addNormalStep('klik_koordinat'));
  normalAddPasteOrType?.addEventListener('click', () => addNormalStep('paste_atau_ketik'));
  normalAddPressKey?.addEventListener('click', () => addNormalStep('tekan_tombol'));
  normalAddUploadFile?.addEventListener('click', () => addNormalStep('upload_file_dialog'));
  normalAddWaitWindow?.addEventListener('click', () => addNormalStep('tunggu_window'));
  periodicAdd?.addEventListener('click', () => addPeriodicStep());

  panelRoot.querySelectorAll('.excel-step-input').forEach((input) => {
    const changeHandler = () => {
      const stepId = input.dataset.stepId;
      const stepField = input.dataset.stepField;
      const stepType = input.dataset.stepType;
      const stepValue = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
      updateStep(stepId, stepField, stepValue, stepType);
    };

    input.addEventListener('change', changeHandler);
    input.addEventListener('blur', changeHandler);
  });

  panelRoot.querySelectorAll('.excel-step-delete').forEach((btn) => {
    btn.onclick = () => {
      removeStep(btn.dataset.stepId);
    };
  });

  panelRoot.querySelectorAll('.excel-step-record-coordinate').forEach((btn) => {
    btn.onclick = async () => {
      const stepId = btn.dataset.stepId;
      const originalText = btn.textContent;
      btn.disabled = true;
      for (let counter = 3; counter >= 1; counter -= 1) {
        btn.textContent = `Rekam dalam ${counter}...`;
        await new Promise(r => setTimeout(r, 800));
      }
      btn.textContent = 'Mencari klik...';
      const result = await ipcRenderer.invoke('capture-click-coordinates');
      if (result?.success && result.coords) {
        updateStep(stepId, 'x', Number(result.coords.x));
        updateStep(stepId, 'y', Number(result.coords.y));
        appendLog('SUCCESS', `Koordinat terekam: X=${result.coords.x}, Y=${result.coords.y}`);
      } else {
        appendLog('ERROR', result?.error || 'Gagal merekam koordinat');
      }
      btn.disabled = false;
      btn.textContent = originalText;
    };
  });

  panelRoot.querySelectorAll('.excel-step-move').forEach((btn) => {
    btn.onclick = () => {
      moveStep(btn.dataset.stepId, btn.dataset.direction);
    };
  });

  const runBtn = panelRoot.querySelector('#excel-run-start');
  const pauseBtn = panelRoot.querySelector('#excel-run-pause');
  const resumeBtn = panelRoot.querySelector('#excel-run-resume');
  const stopBtn = panelRoot.querySelector('#excel-run-stop');
  const clearLogs = panelRoot.querySelector('#excel-run-clear');

  runBtn?.addEventListener('click', startEngine);
  pauseBtn?.addEventListener('click', pauseEngine);
  resumeBtn?.addEventListener('click', resumeEngine);
  stopBtn?.addEventListener('click', stopEngine);
  clearLogs?.addEventListener('click', () => {
    const logBody = panelRoot.querySelector('#excel-run-log');
    if (logBody) logBody.innerHTML = '';
  });

  syncAdditionalVisibility();
  renderSteps();
  renderPreviewSummaries();
  updateRunStatus(panelState);
}

function renderExcelTabContent() {
  const totalLoop = computeTotalLoop(panelState.config);
  return `
    <div style="display:grid;gap:18px;">
      <div style="display:grid;grid-template-columns:1fr auto;gap:12px;">
        <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;">
          <div style="font-weight:700;margin-bottom:12px;">Sumber File Excel</div>
          <div style="display:grid;gap:12px;">
            <label style="font-size:11px;color:#94a3b8;">Path File</label>
            <div style="display:grid;grid-template-columns:1fr auto;gap:10px;"> 
              <input class="prop-input" id="excel-path" type="text" placeholder="C:\\Users\\user\\data.xlsx" value="${escapeHtml(panelState.config.excel_path)}" style="width:100%;"> 
              <button id="excel-browse" style="border:none;background:#3b82f6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Browse</button>
            </div>
            <span style="font-size:11px;color:#94a3b8;">Path absolut ke file .xlsx atau .xls</span>
            <label style="font-size:11px;color:#94a3b8;">Nama Sheet</label>
            <input class="prop-input" id="excel-sheet" type="text" value="${escapeHtml(panelState.config.sheet_name)}" placeholder="Sheet1">
            <label style="font-size:11px;color:#94a3b8;">Kolom Target</label>
            <input class="prop-input" id="excel-column" type="text" maxlength="2" value="${escapeHtml(panelState.config.kolom.toUpperCase())}" placeholder="A">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <label style="font-size:11px;color:#94a3b8;">Row Mulai</label>
                <input class="prop-input" id="excel-row-start" type="number" min="1" value="${panelState.config.row_start}">
              </div>
              <div>
                <label style="font-size:11px;color:#94a3b8;">Row Akhir</label>
                <input class="prop-input" id="excel-row-end" type="number" min="1" value="${panelState.config.row_end}">
              </div>
            </div>
            <div style="font-size:12px;color:#fff;font-weight:700;">Total Loop: ${totalLoop}</div>
          </div>
        </div>
        <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;">
          <div style="font-weight:700;margin-bottom:12px;">Opsi Baca</div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input id="skip-empty" type="checkbox" ${panelState.config.skip_empty ? 'checked' : ''}>Skip baris kosong</label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input id="trim-spaces" type="checkbox" ${panelState.config.trim_spaces ? 'checked' : ''}>Trim spasi (hapus spasi awal/akhir)</label>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input id="stop-consecutive" type="checkbox" ${panelState.config.stop_on_consecutive_empty ? 'checked' : ''}>Hentikan otomatis jika N baris kosong berurutan</label>
          <div id="consecutive-group" style="display:${panelState.config.stop_on_consecutive_empty ? 'block' : 'none'};margin-top:12px;">
            <label style="font-size:11px;color:#94a3b8;">N baris kosong berurutan</label>
            <input class="prop-input" id="consecutive-limit" type="number" min="1" value="${panelState.config.consecutive_empty_limit}">
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNormalFlowContent() {
  const stepsHtml = (panelState.config.normal_steps || []).map((step, idx) => renderNormalStepCard(step, idx)).join('');
  const pasteCount = (panelState.config.normal_steps || []).filter(s => s.type === 'paste_field').length;
  return `
    <div style="display:grid;gap:18px;">
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:14px;">
        <div style="font-weight:700;margin-bottom:12px;">Target Normal Flow</div>
        <div style="display:grid;gap:10px;max-width:720px;">
          <label style="font-size:11px;color:#94a3b8;">Tipe Target</label>
          <select id="target-type" class="prop-input" style="max-width:420px;">
            <option value="browser_url" ${panelState.config.targetConfig?.type === 'browser_url' ? 'selected' : ''}>Browser URL</option>
            <option value="desktop_exe" ${panelState.config.targetConfig?.type === 'desktop_exe' ? 'selected' : ''}>Desktop Window / EXE</option>
            <option value="excel_lookup" ${panelState.config.targetConfig?.type === 'excel_lookup' ? 'selected' : ''}>Excel Lookup</option>
            <option value="image_match" ${panelState.config.targetConfig?.type === 'image_match' ? 'selected' : ''}>Image Match</option>
            <option value="clipboard_only" ${panelState.config.targetConfig?.type === 'clipboard_only' ? 'selected' : ''}>Clipboard Only</option>
            <option value="multi_target" ${panelState.config.targetConfig?.type === 'multi_target' ? 'selected' : ''}>Multi Target</option>
            <option value="script" ${panelState.config.targetConfig?.type === 'script' ? 'selected' : ''}>Script</option>
          </select>
        </div>
        <div id="target-config-sections" style="display:grid;gap:12px;">
          <div class="target-config-section" data-target-type="browser_url" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'browser_url' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">URL</label>
              <input class="prop-input" id="target-url" type="text" value="${escapeHtml(panelState.config.targetConfig?.url || '')}" placeholder="https://example.com">
              <label style="font-size:11px;color:#94a3b8;">Mode Pencocokan URL</label>
              <select class="prop-input" id="target-urlmatch" style="max-width:240px;">
                <option value="contains" ${panelState.config.targetConfig?.urlMatchMode === 'contains' ? 'selected' : ''}>Contains</option>
                <option value="exact" ${panelState.config.targetConfig?.urlMatchMode === 'exact' ? 'selected' : ''}>Exact</option>
              </select>
              <label style="font-size:11px;color:#94a3b8;">Port Debug Browser</label>
              <input class="prop-input" id="target-debug-port" type="number" value="${panelState.config.targetConfig?.debugPort || 9222}" placeholder="9222" style="max-width:120px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;color:#94a3b8;"><input id="target-open-if-not-found" type="checkbox" ${panelState.config.targetConfig?.openIfNotFound ? 'checked' : ''}>Buka jika tidak ditemukan</label>
              <div style="display:flex;gap:10px;margin-top:5px;">
                <button type="button" id="target-open-chrome-debug" style="border:none;background:#10b981;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Buka Chrome Debug</button>
                <button type="button" class="target-test-button" data-target-type="browser_url" style="border:none;background:#3b82f6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Browser URL</button>
              </div>
            </div>
          </div>
          <div class="target-config-section" data-target-type="desktop_exe" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'desktop_exe' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">Judul Window / EXE</label>
              <input class="prop-input" id="target-window-title" type="text" value="${escapeHtml(panelState.config.targetConfig?.windowTitle || '')}" placeholder="Nama window atau executable">
              <label style="font-size:11px;color:#94a3b8;">Timeout (ms)</label>
              <input class="prop-input" id="target-timeout" type="number" value="${panelState.config.targetConfig?.timeout || 5000}">
              <div style="display:flex;gap:10px;margin-top:5px;">
                <button type="button" id="target-scan-windows" style="border:none;background:#6366f1;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Scan Window Aktif</button>
                <button type="button" class="target-test-button" data-target-type="desktop_exe" style="border:none;background:#2563eb;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Fokus Window</button>
              </div>
              <div id="target-scan-list-container" style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:10px;padding:10px;max-height:150px;overflow-y:auto;display:none;">
                <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">Pilih window di bawah ini:</div>
                <div id="target-scan-list" style="display:grid;gap:6px;"></div>
              </div>
            </div>
          </div>
          <div class="target-config-section" data-target-type="excel_lookup" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'excel_lookup' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">Kolom Lookup</label>
              <input class="prop-input" id="target-lookup-column" type="text" maxlength="2" value="${escapeHtml(panelState.config.targetConfig?.lookupColumn || 'A')}">
              <label style="font-size:11px;color:#94a3b8;">Kunci Lookup</label>
              <input class="prop-input" id="target-lookup-key" type="text" value="${escapeHtml(panelState.config.targetConfig?.lookupKey || '')}" placeholder="{{excel_value}}">
              <button type="button" class="target-test-button" data-target-type="excel_lookup" style="border:none;background:#8b5cf6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Excel Lookup</button>
            </div>
          </div>
          <div class="target-config-section" data-target-type="image_match" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'image_match' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">Path Image</label>
              <input class="prop-input" id="target-image-path" type="text" value="${escapeHtml(panelState.config.targetConfig?.imagePath || '')}" placeholder="C:\references\image.png">
              <button type="button" class="target-test-button" data-target-type="image_match" style="border:none;background:#14b8a6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Image Match</button>
            </div>
          </div>
          <div class="target-config-section" data-target-type="clipboard_only" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'clipboard_only' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <div style="font-size:11px;color:#94a3b8;">Clipboard Only akan menggunakan teks yang sudah ada di clipboard.</div>
              <button type="button" class="target-test-button" data-target-type="clipboard_only" style="border:none;background:#f59e0b;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Clipboard</button>
            </div>
          </div>
          <div class="target-config-section" data-target-type="multi_target" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'multi_target' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">Daftar Target (pisahkan dengan ;)</label>
              <input class="prop-input" id="target-multi-list" type="text" value="${escapeHtml(panelState.config.targetConfig?.targetsText || '')}" placeholder="https://site1.com;https://site2.com">
              <button type="button" class="target-test-button" data-target-type="multi_target" style="border:none;background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Multi Target</button>
            </div>
          </div>
          <div class="target-config-section" data-target-type="script" style="transition:all 180ms ease;overflow:hidden;${panelState.config.targetConfig?.type === 'script' ? 'opacity:1;max-height:999px;transform:none;pointer-events:auto;' : 'opacity:0;max-height:0;transform:translateY(-8px);pointer-events:none;'}">
            <div style="display:grid;gap:10px;">
              <label style="font-size:11px;color:#94a3b8;">Script</label>
              <textarea class="prop-input" id="target-script" style="min-height:120px;resize:vertical;">${escapeHtml(panelState.config.targetConfig?.script || '')}</textarea>
              <button type="button" class="target-test-button" data-target-type="script" style="border:none;background:#ef4444;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Test Script</button>
            </div>
          </div>
        </div>
        <div style="font-size:11px;color:#94a3b8;">Target ini akan di-resolve sebelum langkah pertama dijalankan di setiap baris.</div>
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;">
        <div style="font-weight:700;margin-bottom:12px;">Target Normal Flow (Legacy)</div>
        <label style="font-size:11px;color:#94a3b8;">Tab Normal</label>
        <input class="prop-input" id="tab-normal" type="text" value="${escapeHtml(panelState.config.tab_normal)}" placeholder="URL atau nama tab browser">
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><div style="font-weight:700;">Builder Langkah Normal Flow</div><div style="display:flex;gap:10px;flex-wrap:wrap;"><button id="normal-add-paste" style="border:none;background:${pasteCount ? '#64748b' : '#3b82f6'};color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;${pasteCount ? 'opacity:0.5;cursor:not-allowed;' : ''};">Tambah Paste Field</button><button id="normal-add-click" style="border:none;background:#10b981;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Klik Tambahan</button><button id="normal-add-focus-window" style="border:none;background:#2563eb;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Fokus Window</button><button id="normal-add-coordinate-click" style="border:none;background:#8b5cf6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Klik Koordinat</button><button id="normal-add-paste-or-type" style="border:none;background:#f97316;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Paste/Ketik</button><button id="normal-add-press-key" style="border:none;background:#0ea5e9;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Tekan Tombol</button><button id="normal-add-upload-file" style="border:none;background:#14b8a6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Upload File Dialog</button><button id="normal-add-wait-window" style="border:none;background:#f43f5e;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Tunggu Window</button></div></div>
        <div style="display:grid;gap:12px;">${stepsHtml}</div>
      </div>
    </div>
  `;
}

function renderPeriodicFlowContent() {
  const stepsHtml = (panelState.config.periodic_steps || []).map(step => renderPeriodicStepCard(step)).join('');
  return `
    <div style="display:grid;gap:18px;">
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;">
        <div style="font-weight:700;margin-bottom:12px;">Langkah yang dijalankan setiap N loop (setelah normal flow selesai)</div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input id="periodic-enabled" type="checkbox" ${panelState.config.periodic_enabled ? 'checked' : ''}>Aktifkan Periodic Flow</label>
        <div id="periodic-body" style="display:${panelState.config.periodic_enabled ? 'grid' : 'none'};gap:12px;margin-top:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><label style="font-size:11px;color:#94a3b8;">Jalankan setiap</label><input class="prop-input" id="periodic-every" type="number" min="1" value="${panelState.config.periodic_every}"> loop</div>
            <div><label style="font-size:11px;color:#94a3b8;">Tab Periodic</label><input class="prop-input" id="tab-periodic" type="text" value="${escapeHtml(panelState.config.tab_periodic)}" placeholder="URL atau nama tab browser"></div>
          </div>
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:12px;padding:14px;">
            <div style="font-size:11px;color:#94a3b8;">Timing</div>
            <div style="font-weight:700;margin-top:4px;">Sesudah Normal Flow</div>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button id="periodic-add-step" style="border:none;background:#3b82f6;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Tambah Langkah Periodic</button>
          </div>
          <div style="display:grid;gap:12px;">${stepsHtml || '<div style="color:#94a3b8;font-size:12px;">Belum ada langkah periodic.</div>'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderDelayContent() {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:14px;">
        <div style="font-weight:700;">Normal Flow Delays</div>
        ${renderDelayCard('Delay setelah copy', 'delay-after-copy', panelState.config.d_after_copy)}
        ${renderDelayCard('Delay pindah tab', 'delay-tab-switch', panelState.config.d_tab_switch)}
        ${renderDelayCard('Delay sebelum paste', 'delay-before-paste', panelState.config.d_before_paste)}
        ${renderDelayCard('Delay setelah paste', 'delay-after-paste', panelState.config.d_after_paste)}
        ${renderDelayCard('Delay antar klik', 'delay-between-clicks', panelState.config.d_between_clicks)}
        ${renderDelayCard('Delay akhir loop', 'delay-end-loop', panelState.config.d_end_loop)}
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:14px;">
        <div style="font-weight:700;">Periodic Flow Delays</div>
        ${renderDelayCard('Delay sebelum periodic', 'delay-pre-periodic', panelState.config.d_pre_periodic)}
        ${renderDelayCard('Delay pindah tab periodic', 'delay-periodic-switch', panelState.config.d_periodic_tab_switch)}
        ${renderDelayCard('Delay setelah periodic', 'delay-post-periodic', panelState.config.d_post_periodic)}
        <div style="margin-top:12px;border-top:1px solid rgba(148,163,184,0.08);padding-top:12px;">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><input id="random-delay" type="checkbox" ${panelState.config.random_delay ? 'checked' : ''}>Random Delay ±20%</label>
          <div id="random-delay-hint" style="font-size:11px;color:#94a3b8;display:${panelState.config.random_delay ? 'block' : 'none'};margin-top:8px;">Setiap delay akan divariasikan secara acak ±20% dari nilai yang diset. Contoh: 500ms → 400ms - 600ms.</div>
        </div>
      </div>
    </div>
  `;
}

function renderPreviewContent() {
  const totalLoop = computeTotalLoop(panelState.config);
  const rangeText = `${panelState.config.sheet_name}!${panelState.config.kolom}${panelState.config.row_start}:${panelState.config.kolom}${panelState.config.row_end}`;
  const estimate = estimateTimeMs(panelState.config);
  return `
    <div style="display:grid;gap:18px;">
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:12px;">
        <div style="font-weight:700;">Ringkasan Eksekusi</div>
        <div>Total loop: <strong>${totalLoop}</strong></div>
        <div>Kolom yang dibaca: <strong>${escapeHtml(rangeText)}</strong></div>
        <div>File: <strong>${escapeHtml(panelState.config.excel_path || '(belum diisi)')}</strong></div>
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;white-space:pre-wrap;line-height:1.6;">
        <div style="font-weight:700;margin-bottom:10px;">Alur Normal Flow</div>
        Setiap loop:\n  [1] Baca cell ${panelState.config.kolom}${panelState.config.row_start} dari Excel\n  [2] Copy nilai → delay ${panelState.config.d_after_copy}ms\n  [3] Pindah ke tab: ${escapeHtml(panelState.config.tab_normal)} → delay ${panelState.config.d_tab_switch}ms\n  [4] Klik ${panelState.config.normal_steps?.[0]?.label || 'Paste Field'} → delay ${panelState.config.d_before_paste}ms\n  [5] Paste → delay ${panelState.config.d_after_paste}ms\n  ${panelState.config.normal_steps?.slice(1).map((step, i) => `[${6 + i}] Klik ${step.label} → delay ${step.delay_after}ms`).join('\n  ')}\n  [N] Kembali ke tab Excel → delay ${panelState.config.d_end_loop}ms
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;">
        <div style="font-weight:700;margin-bottom:10px;">Alur Periodic Flow</div>
        ${panelState.config.periodic_enabled ? `Setiap ${panelState.config.periodic_every} loop:\n  [P1] Delay ${panelState.config.d_pre_periodic}ms\n  [P2] Pindah ke tab: ${escapeHtml(panelState.config.tab_periodic)} → delay ${panelState.config.d_periodic_tab_switch}ms\n  ${panelState.config.periodic_steps.map((step, i) => `[P${3 + i}] Klik ${step.label} → delay ${step.delay_after}ms`).join('\n  ')}\n  [PN] Kembali ke tab Excel → delay ${panelState.config.d_post_periodic}ms` : '<span style="color:#94a3b8;">Periodic flow tidak diaktifkan.</span>'}
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
        <div><div style="font-size:11px;color:#94a3b8;">Estimasi per loop</div><div style="font-weight:700;margin-top:6px;">${formatDuration(estimate.perLoop)}</div></div>
        <div><div style="font-size:11px;color:#94a3b8;">Estimasi total normal</div><div style="font-weight:700;margin-top:6px;">${formatDuration(estimate.totalNormal)}</div></div>
        <div><div style="font-size:11px;color:#94a3b8;">Estimasi total dengan periodic</div><div style="font-weight:700;margin-top:6px;">${formatDuration(estimate.totalWithPeriodic)}</div></div>
      </div>
    </div>
  `;
}

function renderRunContent() {
  const state = panelState.isRunning ? 'RUNNING' : panelState.isPaused ? 'PAUSED' : 'IDLE';
  const statusColor = panelState.isRunning ? '#10b981' : panelState.isPaused ? '#f59e0b' : '#94a3b8';
  const config = panelState.config;
  const totalLoop = computeTotalLoop(config);
  return `
    <div style="display:grid;gap:18px;">
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;color:#94a3b8;">Status</div>
          <div style="font-size:16px;font-weight:800;color:${statusColor};">${state === 'RUNNING' ? 'Berjalan' : state === 'PAUSED' ? 'Dijeda' : state === 'IDLE' ? 'Siap dijalankan' : state === 'STOPPED' ? 'Dihentikan' : 'Selesai'}</div>
          <div style="font-size:12px;color:#94a3b8;">${state === 'RUNNING' ? `Loop ${config.current_row - config.row_start + 1}/${totalLoop}` : state === 'PAUSED' ? `Dijeda pada loop ${config.current_row - config.row_start + 1}` : ''}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:12px;width:100%;max-width:720px;">
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;"><div style="font-size:10px;color:#94a3b8;">Loop Saat Ini</div><div style="font-size:16px;font-weight:800;">${config.current_row - config.row_start + 1}/${totalLoop}</div></div>
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;"><div style="font-size:10px;color:#94a3b8;">Baris</div><div style="font-size:16px;font-weight:800;">${config.current_row}</div></div>
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;"><div style="font-size:10px;color:#94a3b8;">Diproses</div><div style="font-size:16px;font-weight:800;">${config.total_processed || 0}</div></div>
          <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;"><div style="font-size:10px;color:#94a3b8;">Dilewati</div><div style="font-size:16px;font-weight:800;">${config.total_skipped || 0}</div></div>
        </div>
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;display:grid;gap:14px;">
        <div style="font-weight:700;">Nilai Cell Saat Ini</div>
        <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:12px;padding:16px;font-family:'Courier New',monospace;font-size:14px;min-height:64px;color:#fff;">${escapeHtml(config.current_value || '(belum ada)')}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button id="excel-run-start" class="btn-full" style="background:#10b981;color:#fff;">▶ JALANKAN</button>
        <button id="excel-run-pause" class="btn-full" style="background:#fbbf24;color:#000;">⏸ JEDA</button>
        <button id="excel-run-resume" class="btn-full" style="background:#3b82f6;color:#fff;">▶ LANJUT</button>
        <button id="excel-run-stop" class="btn-full" style="background:#ef4444;color:#fff;">⏹ STOP</button>
        <button id="excel-run-clear" class="btn-full" style="background:#475569;color:#fff;">Clear Log</button>
      </div>
      <div style="background:#111827;border:1px solid rgba(148,163,184,0.12);border-radius:16px;padding:18px;max-height:320px;overflow:auto;">
        <div style="font-weight:700;margin-bottom:10px;">Log Eksekusi</div>
        <div id="excel-run-log" style="font-family:'Courier New',monospace;font-size:12px;line-height:1.6;color:#94a3b8;max-height:240px;overflow:auto;"></div>
      </div>
    </div>
  `;
}

function renderNormalStepCard(step, idx) {
  const typeLabels = {
    paste_field: 'Paste Field',
    click: 'Klik Web',
    fokus_window: 'Fokus Window',
    klik_koordinat: 'Klik Koordinat',
    paste_atau_ketik: 'Paste atau Ketik',
    tekan_tombol: 'Tekan Tombol',
    upload_file_dialog: 'Upload File Dialog',
    tunggu_window: 'Tunggu Window',
  };
  const typeLabel = typeLabels[step.type] || step.type || 'Langkah';
  const badgeColor = step.type === 'paste_field' ? '#3b82f6' : step.type === 'click' ? '#10b981' : '#f59e0b';
  return `
    <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;display:grid;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;"><span style="padding:4px 10px;border-radius:999px;font-size:11px;background:${badgeColor};color:#fff;">${escapeHtml(typeLabel)}</span><strong style="font-size:13px;">${escapeHtml(step.label || 'Langkah')}</strong></div>
        <div style="display:flex;gap:8px;"><button class="excel-step-move" data-step-id="${step.id}" data-direction="up" style="border:none;background:#1f2937;color:#e2e8f0;padding:6px 10px;border-radius:10px;cursor:pointer;">Up</button><button class="excel-step-move" data-step-id="${step.id}" data-direction="down" style="border:none;background:#1f2937;color:#e2e8f0;padding:6px 10px;border-radius:10px;cursor:pointer;">Down</button><button class="excel-step-delete" data-step-id="${step.id}" style="border:none;background:#ef4444;color:#fff;padding:6px 10px;border-radius:10px;cursor:pointer;">Hapus</button></div>
      </div>
      <div style="display:grid;gap:10px;">
        <label style="font-size:11px;color:#94a3b8;">Label</label>
        <input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="label" value="${escapeHtml(step.label)}" placeholder="Label langkah">
      </div>
      ${step.type === 'fokus_window' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Judul Window</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="windowTitle" value="${escapeHtml(step.windowTitle || '')}" placeholder="Judul atau nama window"><label style="font-size:11px;color:#94a3b8;">Timeout (ms)</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="timeout" type="number" value="${step.timeout || 5000}"></div>
      ` : step.type === 'klik_koordinat' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Mode</label><select class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="mode"><option value="relatif" ${step.mode === 'relatif' ? 'selected' : ''}>Relatif ke window</option><option value="absolut" ${step.mode === 'absolut' ? 'selected' : ''}>Absolut</option></select><label style="font-size:11px;color:#94a3b8;">Judul Window</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="windowTitle" value="${escapeHtml(step.windowTitle || '')}" placeholder="Judul atau nama window"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label style="font-size:11px;color:#94a3b8;">X</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="x" type="number" value="${step.x ?? 0}"></div><div><label style="font-size:11px;color:#94a3b8;">Y</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="y" type="number" value="${step.y ?? 0}"></div></div><button type="button" class="excel-step-record-coordinate" data-step-id="${step.id}" style="border:none;background:#6366f1;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Rekam Koordinat</button><div class="coordinate-preview" style="font-size:11px;color:#94a3b8;">Koordinat terekam: X=${step.x ?? 0}, Y=${step.y ?? 0}</div></div>
      ` : step.type === 'paste_atau_ketik' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Metode</label><select class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="method"><option value="paste" ${step.method === 'paste' ? 'selected' : ''}>Paste</option><option value="type" ${step.method === 'type' ? 'selected' : ''}>Ketik</option></select><label style="font-size:11px;color:#94a3b8;">Teks / Template</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="text" value="${escapeHtml(step.text || '')}" placeholder="Contoh {{excel_value}}"><label style="font-size:11px;color:#94a3b8;">Delay sebelum</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="delayBefore" type="number" value="${step.delayBefore || 150}"></div>
      ` : step.type === 'tekan_tombol' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Tombol</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="key" value="${escapeHtml(step.key || '')}" placeholder="enter"><label style="font-size:11px;color:#94a3b8;">Modifiers</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="modifiers" value="${escapeHtml((step.modifiers || []).join(','))}" placeholder="ctrl,shift"><label style="font-size:11px;color:#94a3b8;">Ulang</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="repeat" type="number" value="${step.repeat || 1}"></div>
      ` : step.type === 'upload_file_dialog' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Path File</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="filePath" value="${escapeHtml(step.filePath || '')}" placeholder="{{col_B}}"><label style="font-size:11px;color:#94a3b8;">Timeout (ms)</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="timeout" type="number" value="${step.timeout || 8000}"></div>
      ` : step.type === 'tunggu_window' ? `
        <div style="display:grid;gap:10px;"><label style="font-size:11px;color:#94a3b8;">Judul Window</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="windowTitle" value="${escapeHtml(step.windowTitle || '')}" placeholder="Judul atau nama window"><label style="font-size:11px;color:#94a3b8;">Timeout (ms)</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="timeout" type="number" value="${step.timeout || 10000}"><label style="font-size:11px;color:#94a3b8;">On timeout</label><select class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="onTimeout"><option value="error" ${step.onTimeout === 'error' ? 'selected' : ''}>Error</option><option value="skip" ${step.onTimeout === 'skip' ? 'selected' : ''}>Skip Row</option></select></div>
      ` : `
        <div style="display:grid;gap:10px;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label style="font-size:11px;color:#94a3b8;">Target Type</label><select class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="target_type"><option value="selector" ${step.target_type === 'selector' ? 'selected' : ''}>CSS Selector</option><option value="coordinate" ${step.target_type === 'coordinate' ? 'selected' : ''}>Koordinat XY</option></select></div><div><label style="font-size:11px;color:#94a3b8;">Delay setelah step ini (ms)</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="delay_after" type="number" value="${step.delay_after}"></div></div>${step.target_type === 'selector' ? `
            <label style="font-size:11px;color:#94a3b8;">CSS Selector</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="css_selector" value="${escapeHtml(step.css_selector || '')}" placeholder="e.g. #btn-submit">
          ` : `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label style="font-size:11px;color:#94a3b8;">X</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="x" type="number" value="${step.x ?? 0}"></div><div><label style="font-size:11px;color:#94a3b8;">Y</label><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="y" type="number" value="${step.y ?? 0}"></div></div>
          `}</div>
      `}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#94a3b8;"><input class="excel-step-input" type="checkbox" data-step-id="${step.id}" data-step-field="enabled" ${step.enabled ? 'checked' : ''}>Aktif</div></div>
    </div>
  `;
}
function renderPeriodicStepCard(step) {
  return `
    <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;display:grid;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div style="font-weight:700;">${escapeHtml(step.label)}</div>
        <div style="display:flex;gap:8px;"><button class="excel-step-move" data-step-id="${step.id}" data-direction="up" style="border:none;background:#1f2937;color:#e2e8f0;padding:6px 10px;border-radius:10px;cursor:pointer;">Up</button><button class="excel-step-move" data-step-id="${step.id}" data-direction="down" style="border:none;background:#1f2937;color:#e2e8f0;padding:6px 10px;border-radius:10px;cursor:pointer;">Down</button><button class="excel-step-delete" data-step-id="${step.id}" style="border:none;background:#ef4444;color:#fff;padding:6px 10px;border-radius:10px;cursor:pointer;">Hapus</button></div>
      </div>
      <div style="display:grid;gap:10px;">
        <label style="font-size:11px;color:#94a3b8;">Label</label>
        <input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="label" value="${escapeHtml(step.label)}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;">Target Type</label>
          <select class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="target_type">
            <option value="selector" ${step.target_type === 'selector' ? 'selected' : ''}>CSS Selector</option>
            <option value="coordinate" ${step.target_type === 'coordinate' ? 'selected' : ''}>Koordinat XY</option>
          </select>
        </div>
        <div style="display:grid;gap:10px;">${step.target_type === 'selector' ? `
            <label style="font-size:11px;color:#94a3b8;">CSS Selector</label>
            <input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="css_selector" value="${escapeHtml(step.css_selector || '')}" placeholder="e.g. #btn-refresh">
          ` : `
            <label style="font-size:11px;color:#94a3b8;">Koordinat X/Y</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="x" type="number" value="${step.x ?? 0}" placeholder="X"><input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="y" type="number" value="${step.y ?? 0}" placeholder="Y"></div>
          `}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;"><div>
        <label style="font-size:11px;color:#94a3b8;">Delay setelah step ini (ms)</label>
        <input class="prop-input excel-step-input" data-step-id="${step.id}" data-step-field="delay_after" type="number" value="${step.delay_after}">
      </div><label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#94a3b8;"><input class="excel-step-input" type="checkbox" data-step-id="${step.id}" data-step-field="enabled" ${step.enabled ? 'checked' : ''}>Aktif</label></div>
    </div>
  `;
}

function renderDelayCard(title, id, value) {
  return `
    <div style="background:#0f172a;border:1px solid rgba(148,163,184,0.08);border-radius:14px;padding:14px;">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">${title}</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;"><input class="prop-input" id="${id}" type="number" min="0" step="100" value="${value}"><span style="font-size:12px;color:#94a3b8;">ms</span></div>
    </div>
  `;
}

function renderSteps() {
  const normalWrapper = panelRoot.querySelector('#excel-normal-steps');
  const periodicWrapper = panelRoot.querySelector('#excel-periodic-steps');
  if (normalWrapper) normalWrapper.innerHTML = (panelState.config.normal_steps || []).map((step, idx) => renderNormalStepCard(step, idx)).join('');
  if (periodicWrapper) periodicWrapper.innerHTML = (panelState.config.periodic_steps || []).map(step => renderPeriodicStepCard(step)).join('');
}

function syncAdditionalVisibility() {
  const periodicBody = panelRoot.querySelector('#periodic-body');
  if (periodicBody) {
    periodicBody.style.display = panelState.config.periodic_enabled ? 'grid' : 'none';
  }
}

function renderPreviewSummaries() {
  if (panelState.activeTab !== 'preview') return;
  // simply re-render preview content
}

function updateConfig(key, value) {
  panelState.config = { ...panelState.config, [key]: value };
  if (key === 'kolom' && typeof value === 'string') {
    panelState.config.kolom = value.toUpperCase();
  }
  if (panelState.config.row_start != null && panelState.config.row_end != null) {
    panelState.config.total_loop = computeTotalLoop(panelState.config);
  }
  if (panelState.node) {
    panelState.node.data = panelState.node.data || {};
    panelState.node.data.excelConfig = panelState.config;
  }
  saveExcelLoopConfig(panelState.config);
  renderTabContent();
}

function updateStep(stepId, field, value, stepType = null) {
  const steps = stepType === 'periodic' ? panelState.config.periodic_steps : panelState.config.normal_steps;
  if (!Array.isArray(steps)) return;
  const idx = steps.findIndex(step => step.id === stepId);
  if (idx < 0) return;
  steps[idx] = { ...steps[idx], [field]: value };
  panelState.config = { ...panelState.config, [stepType === 'periodic' ? 'periodic_steps' : 'normal_steps']: [...steps] };
  if (panelState.node) {
    panelState.node.data = panelState.node.data || {};
    panelState.node.data.excelConfig = panelState.config;
  }
  saveExcelLoopConfig(panelState.config);
  renderTabContent();
}

function addNormalStep(type) {
  const existingPaste = panelState.config.normal_steps.filter(s => s.type === 'paste_field').length;
  if (type === 'paste_field' && existingPaste > 0) return;
  let step;
  switch (type) {
    case 'paste_field': step = createDefaultPasteStep(); break;
    case 'click': step = createDefaultClickStep(); break;
    case 'fokus_window': step = createDefaultFocusWindowStep(); break;
    case 'klik_koordinat': step = createDefaultCoordinateClickStep(); break;
    case 'paste_atau_ketik': step = createDefaultTypeOrPasteStep(); break;
    case 'tekan_tombol': step = createDefaultPressKeyStep(); break;
    case 'upload_file_dialog': step = createDefaultUploadFileDialogStep(); break;
    case 'tunggu_window': step = createDefaultWaitWindowStep(); break;
    default: return;
  }
  panelState.config.normal_steps = [...(panelState.config.normal_steps || []), step];
  updateConfig('normal_steps', panelState.config.normal_steps);
}

function addPeriodicStep() {
  panelState.config.periodic_steps = [...(panelState.config.periodic_steps || []), createDefaultPeriodicStep()];
  updateConfig('periodic_steps', panelState.config.periodic_steps);
}

function removeStep(stepId) {
  panelState.config.normal_steps = (panelState.config.normal_steps || []).filter(step => step.id !== stepId);
  panelState.config.periodic_steps = (panelState.config.periodic_steps || []).filter(step => step.id !== stepId);
  updateConfig('normal_steps', panelState.config.normal_steps);
  updateConfig('periodic_steps', panelState.config.periodic_steps);
}

function moveStep(stepId, direction) {
  const steps = panelState.config.normal_steps || [];
  const idx = steps.findIndex(step => step.id === stepId);
  if (idx < 0) return;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= steps.length) return;
  const next = [...steps];
  [next[idx], next[target]] = [next[target], next[idx]];
  panelState.config.normal_steps = next;
  updateConfig('normal_steps', next);
}

function getLogColor(level) {
  if (level === 'SUCCESS') return '#34d399';
  if (level === 'WARN') return '#fbbf24';
  if (level === 'ERROR') return '#f87171';
  return '#94a3b8';
}

function appendLog(level, message) {
  const logBody = panelRoot.querySelector('#excel-run-log');
  if (!logBody) return;
  const line = document.createElement('div');
  line.style.marginBottom = '4px';
  line.innerHTML = `<span style="color:#475569;">[${new Date().toLocaleTimeString()}]</span> <span style="color:${getLogColor(level)};font-weight:600;">[${level}]</span> ${escapeHtml(message)}`;
  logBody.appendChild(line);
  logBody.scrollTop = logBody.scrollHeight;
}

async function startEngine() {
  if (panelState.isRunning) return;
  try {
    panelState.isRunning = true;
    panelState.isPaused = false;
    appendLog('INFO', 'Memulai Excel Loop Engine...');
    await ipcRenderer.invoke('excel-loop-run', panelState.config);
  } catch (err) {
    appendLog('ERROR', err.message || 'Gagal memulai');
    panelState.isRunning = false;
  }
  updateRunStatus(panelState);
}

async function pauseEngine() {
  if (!panelRoot) return;
  panelState.isPaused = true;
  await ipcRenderer.invoke('excel-loop-pause');
  updateRunStatus(panelState);
}

async function resumeEngine() {
  if (!panelRoot) return;
  panelState.isPaused = false;
  await ipcRenderer.invoke('excel-loop-resume');
  updateRunStatus(panelState);
}

async function stopEngine() {
  if (!panelRoot) return;
  panelState.isRunning = false;
  panelState.isPaused = false;
  await ipcRenderer.invoke('excel-loop-stop');
  updateRunStatus(panelState);
}

function updateRunStatus(state) {
  const runBtn = panelRoot?.querySelector('#excel-run-start');
  const pauseBtn = panelRoot?.querySelector('#excel-run-pause');
  const resumeBtn = panelRoot?.querySelector('#excel-run-resume');
  const stopBtn = panelRoot?.querySelector('#excel-run-stop');
  if (!runBtn || !pauseBtn || !resumeBtn || !stopBtn) return;
  runBtn.disabled = state.is_running;
  pauseBtn.disabled = !state.is_running || state.is_paused;
  resumeBtn.disabled = !state.is_paused;
  stopBtn.disabled = !state.is_running && !state.is_paused;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { openExcelLoopPanel, closeExcelLoopPanel, createConfigFromNode };
