'use strict';

function initExcelLoopPanel(mountElement) {
  if (!mountElement) return;

  let config = {
    excelPath: '', sheetName: '', startRow: 2, endRow: 100,
    targetColumn: 'A', skipEmptyRows: true, delayBetweenRows: 500,
    stopOnError: false, normalFlowSteps: [],
    targetConfig: { type: 'desktop_exe', windowTitle: 'Microsoft Word', url: '', debugPort: 9222 },
  };
  let logs = [];
  let engineStopped = false;
  let enginePaused = false;
  let activeTab = 'excel';

  const tabs = ['excel','normal-flow','delay','preview','jalankan'];
  const tabLabels = { 'excel':'Excel','normal-flow':'Normal Flow',
    'delay':'Delay','preview':'Preview','jalankan':'Jalankan' };

  function addLog(level, msg) {
    const time = new Date().toLocaleTimeString();
    logs.push({ time, level, message: msg });
    const logBox = document.getElementById('elp-log-box');
    if (logBox) {
      const color = level==='ERROR'?'#f87171':level==='SUCCESS'?'#34d399':
                    level==='WARN'?'#fbbf24':'#e5e7eb';
      const div = document.createElement('div');
      div.style.cssText = 'color:'+color+';margin-bottom:3px;font-family:monospace;font-size:12px;';
      div.textContent = '['+time+'] ['+level+'] '+msg;
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  function saveConfig() {
    try { localStorage.setItem('rba_excel_loop_config', JSON.stringify(config)); } catch(e) {}
  }

  function loadConfig() {
    try {
      const saved = localStorage.getItem('rba_excel_loop_config');
      if (saved) config = Object.assign({}, config, JSON.parse(saved));
      if (!config.targetConfig) config.targetConfig = { type: 'desktop_exe', windowTitle: 'Microsoft Word', url: '', debugPort: 9222 };
      if (config.targetConfig.type === 'browser_url') config.targetConfig.type = 'desktop_exe';
      if (!config.targetConfig.windowTitle) config.targetConfig.windowTitle = 'Microsoft Word';
      if (!config.targetConfig.url) config.targetConfig.url = '';
      if (!config.targetConfig.debugPort) config.targetConfig.debugPort = 9222;
    } catch(e) {}
  }

  function render() {
    mountElement.innerHTML = `
<div style="height:100%;display:flex;flex-direction:column;background:#111827;
            color:#f9fafb;font-family:system-ui,sans-serif;overflow:hidden;">

  <!-- Header -->
  <div style="padding:16px 24px;border-bottom:1px solid #374151;
              display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
    <div>
      <h2 style="margin:0;font-size:20px;font-weight:700;">⚡ Excel Loop Automation</h2>
      <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">
        Konfigurasi pembacaan Excel baris per baris lalu jalankan alur otomatis.
      </p>
    </div>
    <div style="display:flex;gap:8px;">
      <button id="elp-export" style="padding:6px 14px;background:transparent;
        border:1px solid #374151;border-radius:6px;color:#f9fafb;cursor:pointer;font-size:13px;">
        Export JSON</button>
      <button id="elp-import" style="padding:6px 14px;background:transparent;
        border:1px solid #374151;border-radius:6px;color:#f9fafb;cursor:pointer;font-size:13px;">
        Import JSON</button>
    </div>
  </div>

  <!-- Tabs -->
  <div id="elp-tabs" style="display:flex;border-bottom:1px solid #374151;
       padding:0 24px;flex-shrink:0;overflow-x:auto;">
    ${tabs.map(t=>`
      <button data-tab="${t}" style="padding:10px 18px;cursor:pointer;background:none;
        border:none;border-bottom:${activeTab===t?'2px solid #3b82f6':'2px solid transparent'};
        color:${activeTab===t?'#f9fafb':'#9ca3af'};font-size:14px;white-space:nowrap;">
        ${tabLabels[t]}</button>`).join('')}
  </div>

  <!-- Content -->
  <div id="elp-content" style="flex:1;overflow-y:auto;padding:24px;">
    ${renderTabContent()}
  </div>
</div>`;
    bindEvents();
  }

  const { ipcRenderer } = require('electron');
  ipcRenderer.removeAllListeners('excel-loop-log');
  ipcRenderer.removeAllListeners('excel-loop-stats');
  ipcRenderer.on('excel-loop-log', (event, { level, message }) => {
    addLog(level, message);
  });
  ipcRenderer.on('excel-loop-stats', (event, data) => {
    const g = id => document.getElementById(id);
    if (g('elp-status-text')) g('elp-status-text').textContent = 'Berjalan';
    if (g('elp-loop-text')) g('elp-loop-text').textContent = (data.currentLoop || 0) + '/' + (data.totalLoops || 0);
    if (g('elp-row-text')) g('elp-row-text').textContent = String(data.currentRow || '—');
    if (g('elp-proc-text')) g('elp-proc-text').textContent = String(data.processed || 0);
    if (g('elp-skip-text')) g('elp-skip-text').textContent = String(data.skipped || 0);
    if (g('elp-cell-value')) g('elp-cell-value').textContent = data.currentCellValue || '(kosong)';
  });

  function renderTabContent() {
    if (activeTab === 'excel') return `
<div style="background:#1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h3 style="margin:0 0 16px;font-size:16px;font-weight:600;">Sumber File Excel</h3>
  <div style="margin-bottom:16px;">
    <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Path File Excel</label>
    <div style="display:flex;gap:8px;">
      <input id="elp-excel-path" value="${config.excelPath}"
        style="flex:1;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;"
        placeholder="Pilih file .xlsx atau isi path manual"/>
      <button id="elp-browse" style="padding:8px 16px;background:#3b82f6;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:14px;">Browse</button>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Nama Sheet</label>
      <input id="elp-sheet" value="${config.sheetName}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"
        placeholder="Sheet1"/>
    </div>
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Baris Mulai</label>
      <input id="elp-start-row" type="number" value="${config.startRow}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
    </div>
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Baris Selesai</label>
      <input id="elp-end-row" type="number" value="${config.endRow}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Kolom Target Utama</label>
      <input id="elp-target-col" value="${config.targetColumn}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"
        placeholder="A"/>
    </div>
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Delay Antar Baris (ms)</label>
      <input id="elp-delay-rows" type="number" value="${config.delayBetweenRows}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
    </div>
  </div>
  <div style="margin-top:16px;display:flex;gap:24px;">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
      <input id="elp-skip-empty" type="checkbox" ${config.skipEmptyRows?'checked':''}/>
      Lewati baris kosong</label>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
      <input id="elp-stop-error" type="checkbox" ${config.stopOnError?'checked':''}/>
      Stop jika error</label>
  </div>
</div>`;

    if (activeTab === 'normal-flow') return `
<div style="background:#1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h3 style="margin:0 0 16px;font-size:16px;font-weight:600;">Target Aksi</h3>
  <div style="margin-bottom:16px;">
    <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Tipe Target</label>
    <select id="elp-target-type"
      style="padding:8px 12px;background:#111827;border:1px solid #374151;
             border-radius:6px;color:#f9fafb;font-size:14px;min-width:220px;">
      <option value="desktop_exe" ${config.targetConfig.type==='desktop_exe'?'selected':''}>Aplikasi Desktop (.exe)</option>
      <option value="browser_url" ${config.targetConfig.type==='browser_url'?'selected':''}>Browser Tab (URL)</option>
      <option value="clipboard_only" ${config.targetConfig.type==='clipboard_only'?'selected':''}>Clipboard Saja</option>
    </select>
  </div>
  ${config.targetConfig.type==='desktop_exe'?`
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
    <div>
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">Nama Window</label>
      <input id="elp-window-title" value="${config.targetConfig.windowTitle||''}"
        style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"
        placeholder="contoh: JNT Express"/>
    </div>
    <div style="display:flex;align-items:flex-end;">
      <button id="elp-test-window" style="padding:8px 16px;background:#7c3aed;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:14px;width:100%;">
        Test Fokus Window</button>
    </div>
  </div>`:`
  <div style="margin-bottom:16px;">
    <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">URL Target</label>
    <input id="elp-target-url" value="${config.targetConfig.url||''}"
      style="width:100%;padding:8px 12px;background:#111827;border:1px solid #374151;
             border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"
      placeholder="https://example.com"/>
  </div>`}
</div>
<div style="background:#1f2937;border-radius:8px;padding:20px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h3 style="margin:0;font-size:16px;font-weight:600;">Langkah Normal Flow</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button data-add="fokus_window" style="padding:6px 12px;background:#2563eb;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;">+ Fokus Window</button>
      <button data-add="klik_koordinat" style="padding:6px 12px;background:#16a34a;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;">+ Klik Koordinat</button>
      <button data-add="paste_atau_ketik" style="padding:6px 12px;background:#7c3aed;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;">+ Paste/Ketik</button>
      <button data-add="tekan_tombol" style="padding:6px 12px;background:#0891b2;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;">+ Tekan Tombol</button>
      <button data-add="delay" style="padding:6px 12px;background:#374151;color:white;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;">+ Delay</button>
    </div>
  </div>
  <div id="elp-steps-list">
    ${config.normalFlowSteps.length===0
      ? '<p style="color:#6b7280;text-align:center;padding:24px 0;font-size:14px;">Belum ada langkah.</p>'
      : config.normalFlowSteps.map((step,i)=>renderStep(step,i)).join('')}
  </div>
</div>`;

    if (activeTab === 'jalankan') return `
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;
     background:#1f2937;border-radius:8px;padding:16px;margin-bottom:20px;">
  ${[
    ['Status','<span id="elp-status-text">Siap dijalankan</span>'],
    ['Loop','<span id="elp-loop-text">0/0</span>'],
    ['Baris','<span id="elp-row-text">—</span>'],
    ['Diproses','<span id="elp-proc-text">0</span>'],
    ['Dilewati','<span id="elp-skip-text">0</span>'],
  ].map(([l,v])=>`<div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${l}</div>
    <div style="font-size:15px;font-weight:600;">${v}</div>
  </div>`).join('')}
</div>
<div style="background:#1f2937;border-radius:8px;padding:12px;margin-bottom:16px;">
  <div style="font-size:13px;color:#9ca3af;margin-bottom:6px;">Nilai Cell Saat Ini</div>
  <pre id="elp-cell-value" style="margin:0;font-family:monospace;font-size:14px;
       color:#f9fafb;">(belum ada)</pre>
</div>
<div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
  <button id="elp-run"
    style="flex:1;min-width:120px;padding:10px 20px;
           background:linear-gradient(135deg,#16a34a,#15803d);
           color:white;border:none;border-radius:10px;
           font-size:14px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:6px;
           box-shadow:0 2px 8px rgba(22,163,74,0.4);">
    <span style="font-size:16px;">▶</span> Jalankan
  </button>
  <button id="elp-pause"
    style="flex:1;min-width:100px;padding:10px 16px;
           background:linear-gradient(135deg,#d97706,#b45309);
           color:white;border:none;border-radius:10px;
           font-size:14px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:6px;
           box-shadow:0 2px 8px rgba(217,119,6,0.4);">
    <span>⏸</span> Jeda
  </button>
  <button id="elp-resume"
    style="flex:1;min-width:100px;padding:10px 16px;
           background:linear-gradient(135deg,#2563eb,#1d4ed8);
           color:white;border:none;border-radius:10px;
           font-size:14px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:6px;
           box-shadow:0 2px 8px rgba(37,99,235,0.4);">
    <span>▶</span> Lanjut
  </button>
  <button id="elp-stop"
    style="flex:1;min-width:100px;padding:10px 16px;
           background:linear-gradient(135deg,#dc2626,#b91c1c);
           color:white;border:none;border-radius:10px;
           font-size:14px;font-weight:600;cursor:pointer;
           display:flex;align-items:center;justify-content:center;gap:6px;
           box-shadow:0 2px 8px rgba(220,38,38,0.4);">
    <span>■</span> Stop
  </button>
  <button id="elp-clear-log"
    style="padding:10px 16px;background:#1f2937;
           color:#9ca3af;border:1px solid #374151;border-radius:10px;
           font-size:13px;cursor:pointer;">
    🗑 Clear Log
  </button>
</div>
<div>
  <div style="font-size:13px;font-weight:600;color:#9ca3af;margin-bottom:8px;">Log Eksekusi</div>
  <div id="elp-log-box" style="background:#0f172a;border-radius:8px;padding:16px;
       min-height:150px;max-height:350px;overflow-y:auto;"></div>
</div>`;

    if (activeTab === 'delay') return `
<div style="background:#1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h3 style="margin:0 0 4px;font-size:16px;font-weight:600;">Pengaturan Delay</h3>
  <p style="margin:0 0 20px;font-size:13px;color:#9ca3af;">
    Atur jeda waktu antar aksi untuk memastikan app target merespons dengan benar.</p>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Delay sebelum loop dimulai (ms)</label>
      <input id="elp-delay-before-loop" type="number"
        value="${config.delaySettings?.beforeLoop||0}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Waktu tunggu sebelum baris pertama diproses</p>
    </div>
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Delay antar baris (ms)</label>
      <input id="elp-delay-between-rows" type="number"
        value="${config.delayBetweenRows||500}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Jeda setelah satu baris selesai sebelum baris berikutnya</p>
    </div>
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Delay antar step (ms)</label>
      <input id="elp-delay-between-steps" type="number"
        value="${config.delaySettings?.betweenSteps||200}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Jeda antar setiap langkah dalam satu baris</p>
    </div>
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Delay sebelum paste (ms)</label>
      <input id="elp-delay-before-paste" type="number"
        value="${config.delaySettings?.beforePaste||150}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Tunggu sebelum Ctrl+V agar field siap menerima input</p>
    </div>
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Delay setelah klik (ms)</label>
      <input id="elp-delay-after-click" type="number"
        value="${config.delaySettings?.afterClick||300}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Tunggu setelah klik sebelum aksi berikutnya</p>
    </div>
    <div style="background:#111827;border-radius:8px;padding:16px;">
      <label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:6px;">
        Timeout fokus window (ms)</label>
      <input id="elp-delay-window-timeout" type="number"
        value="${config.delaySettings?.windowTimeout||3000}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:14px;box-sizing:border-box;"/>
      <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
        Batas waktu tunggu window app muncul</p>
    </div>
  </div>

  <button id="elp-save-delay"
    style="margin-top:20px;padding:10px 24px;background:#3b82f6;color:white;
           border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
    Simpan Pengaturan Delay</button>
</div>`;

    if (activeTab === 'preview') return `
<div style="background:#1f2937;border-radius:8px;padding:20px;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <div>
      <h3 style="margin:0 0 4px;font-size:16px;font-weight:600;">Preview Data Excel</h3>
      <p style="margin:0;font-size:13px;color:#9ca3af;">
        Tampilkan 10 baris pertama dari file Excel yang dipilih</p>
    </div>
    <button id="elp-load-preview"
      style="padding:8px 20px;background:#3b82f6;color:white;border:none;
             border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
      Muat Preview</button>
  </div>
  <div id="elp-preview-content"
    style="background:#111827;border-radius:8px;padding:16px;min-height:120px;
           color:#9ca3af;font-size:13px;text-align:center;line-height:1.8;">
    ${config.excelPath
      ? 'Klik "Muat Preview" untuk melihat data dari:<br><code style="color:#60a5fa">'
        + config.excelPath + '</code>'
      : 'Pilih file Excel di tab Excel terlebih dahulu,<br>lalu klik "Muat Preview".'}
  </div>
</div>`;

    return `<div style="color:#9ca3af;text-align:center;padding:60px 0;font-size:15px;">
      Tab dalam pengembangan</div>`;
  }

  function renderStep(step, i) {
    const typeColors = {fokus_window:'#2563eb',klik_koordinat:'#16a34a',
      paste_atau_ketik:'#7c3aed',tekan_tombol:'#0891b2',delay:'#374151'};
    const bg = typeColors[step.type]||'#374151';
    return `<div data-step-idx="${i}" style="background:#0f172a;border-radius:8px;padding:16px;
      margin-bottom:10px;border:1px solid #374151;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="padding:3px 8px;background:${bg};border-radius:4px;
            font-size:11px;font-weight:700;color:white;">
            ${step.type.toUpperCase().replace(/_/g,' ')}...</span>
          <input data-step-label="${i}" value="${step.label||''}"
            style="padding:4px 8px;background:#1f2937;border:1px solid #374151;
                   border-radius:4px;color:#f9fafb;font-size:14px;"/>
        </div>
        <div style="display:flex;gap:6px;">
          <button data-step-up="${i}" style="padding:4px 10px;background:#374151;
            color:#f9fafb;border:none;border-radius:4px;cursor:pointer;">↑</button>
          <button data-step-down="${i}" style="padding:4px 10px;background:#374151;
            color:#f9fafb;border:none;border-radius:4px;cursor:pointer;">↓</button>
          <button data-step-del="${i}" style="padding:4px 10px;background:#7f1d1d;
            color:#fca5a5;border:none;border-radius:4px;cursor:pointer;">Hapus</button>
        </div>
      </div>
      ${renderStepFields(step, i)}
    </div>`;
  }

  function renderStepFields(step, i) {
    const inp = (id,lbl,val,type='text',ph='')=>
      `<div><label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:4px;">${lbl}</label>
      <input data-field="${id}" data-step-field-idx="${i}" type="${type}" value="${val}"
        placeholder="${ph}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:13px;box-sizing:border-box;"/></div>`;

    if (step.type==='fokus_window') return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      ${inp('windowTitle','Judul Window',step.windowTitle||'','text','contoh: JNT Express')}
      ${inp('delayAfter','Delay setelah (ms)',step.delayAfter||400,'number')}</div>`;

    if (step.type==='klik_koordinat') return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">
      ${inp('x','X',step.x||0,'number')}${inp('y','Y',step.y||0,'number')}
      ${inp('delayAfter','Delay (ms)',step.delayAfter||300,'number')}
      <div><label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:4px;">Klik</label>
      <select data-field="clickType" data-step-field-idx="${i}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:13px;">
        <option value="left" ${(step.clickType||'left')==='left'?'selected':''}>Kiri</option>
        <option value="right" ${step.clickType==='right'?'selected':''}>Kanan</option>
        <option value="double" ${step.clickType==='double'?'selected':''}>Double</option>
      </select></div></div>`;

    if (step.type==='paste_atau_ketik') return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">
      <div><label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:4px;">Metode</label>
      <select data-field="method" data-step-field-idx="${i}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:13px;">
        <option value="paste" ${(step.method||'paste')==='paste'?'selected':''}>Paste (Ctrl+V)</option>
        <option value="type" ${step.method==='type'?'selected':''}>Ketik Manual</option>
      </select></div>
      ${inp('windowTitle','Window Target',step.windowTitle||'','text','Microsoft Word')}
      ${inp('text','Teks (jika ketik)',step.text||'','text','{{col_A}}')}
      ${inp('delayAfter','Delay (ms)',step.delayAfter||200,'number')}</div>`;

    if (step.type==='tekan_tombol') return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
      <div><label style="display:block;font-size:13px;color:#9ca3af;margin-bottom:4px;">Tombol</label>
      <select data-field="key" data-step-field-idx="${i}"
        style="width:100%;padding:8px 12px;background:#1f2937;border:1px solid #374151;
               border-radius:6px;color:#f9fafb;font-size:13px;">
        ${['enter','tab','escape','space','backspace','delete','up','down'].map(k=>
          `<option value="${k}" ${(step.key||'enter')===k?'selected':''}>${k.toUpperCase()}</option>`
        ).join('')}</select></div>
      ${inp('repeat','Ulangi',step.repeat||1,'number')}
      ${inp('delayAfter','Delay (ms)',step.delayAfter||200,'number')}</div>`;

    if (step.type==='delay') return inp('duration','Durasi (ms)',step.duration||1000,'number');
    return '';
  }

  function bindEvents() {
    document.querySelectorAll('[data-tab]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        syncConfigFromDOM();
        activeTab=btn.dataset.tab;
        render();
      });
    });

    const expBtn=document.getElementById('elp-export');
    if(expBtn) expBtn.addEventListener('click',()=>{
      const a=document.createElement('a');
      a.href='data:application/json,'+encodeURIComponent(JSON.stringify(config,null,2));
      a.download='excel-loop-config.json'; a.click();
    });
    const impBtn=document.getElementById('elp-import');
    if(impBtn) impBtn.addEventListener('click',()=>{
      const inp=document.createElement('input');inp.type='file';inp.accept='.json';
      inp.onchange=e=>{const r=new FileReader();
        r.onload=ev=>{try{config=Object.assign({},config,JSON.parse(ev.target.result));
          saveConfig();render();}catch{alert('JSON tidak valid');}};
        r.readAsText(e.target.files[0]);};inp.click();
    });

    const browseBtn=document.getElementById('elp-browse');
    if(browseBtn) browseBtn.addEventListener('click',async()=>{
      if(window.electronAPI?.browseFile){
        const r=await window.electronAPI.browseFile([{name:'Excel',extensions:['xlsx','xls','csv']}]);
        if(r?.ok&&r.filePath){
          config.excelPath=r.filePath;
          const el=document.getElementById('elp-excel-path');
          if(el)el.value=r.filePath;
          saveConfig();
        }
      }
    });

    const ttEl=document.getElementById('elp-target-type');
    if(ttEl) ttEl.addEventListener('change',e=>{
      config.targetConfig.type=e.target.value;saveConfig();
      const content=document.getElementById('elp-content');
      if(content){content.innerHTML=renderTabContent();bindEvents();}
    });

    const twBtn=document.getElementById('elp-test-window');
    if(twBtn) twBtn.addEventListener('click',async()=>{
      const wt=document.getElementById('elp-window-title');
      if(wt)config.targetConfig.windowTitle=wt.value;
      if(window.electronAPI?.testFocusWindow){
        const r=await window.electronAPI.testFocusWindow({windowTitle:config.targetConfig.windowTitle});
        alert(r?.message||'Test selesai');
      }
    });

    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        syncConfigFromDOM();
        const type=btn.dataset.add;
        const defaults={fokus_window:{windowTitle:'',delayAfter:400},
          klik_koordinat:{x:0,y:0,clickType:'left',delayAfter:300},
          paste_atau_ketik:{method:'paste',windowTitle:'',text:'',delayAfter:200},
          tekan_tombol:{key:'enter',repeat:1,delayAfter:200},
          delay:{duration:1000}};
        config.normalFlowSteps.push({
          id:Date.now()+'',type,label:type.replace(/_/g,' '),
          aktif:true,...(defaults[type]||{})
        });
        saveConfig();render();
      });
    });

    document.querySelectorAll('[data-step-del]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        syncConfigFromDOM();
        const i=parseInt(btn.dataset.stepDel);
        config.normalFlowSteps.splice(i,1);saveConfig();render();
      });
    });
    document.querySelectorAll('[data-step-up]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        syncConfigFromDOM();const i=parseInt(btn.dataset.stepUp);
        if(i>0){[config.normalFlowSteps[i],config.normalFlowSteps[i-1]]=
          [config.normalFlowSteps[i-1],config.normalFlowSteps[i]];saveConfig();render();}
      });
    });
    document.querySelectorAll('[data-step-down]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        syncConfigFromDOM();const i=parseInt(btn.dataset.stepDown);
        if(i<config.normalFlowSteps.length-1){
          [config.normalFlowSteps[i],config.normalFlowSteps[i+1]]=
          [config.normalFlowSteps[i+1],config.normalFlowSteps[i]];saveConfig();render();}
      });
    });

    document.querySelectorAll('[data-step-field-idx]').forEach(el=>{
      el.addEventListener('change',()=>syncConfigFromDOM());
    });

    const runBtn=document.getElementById('elp-run');
    if(runBtn) runBtn.addEventListener('click',()=>handleRun());
    const pauseBtn=document.getElementById('elp-pause');
    if(pauseBtn) pauseBtn.addEventListener('click',()=>{
      if(window.electronAPI?.invoke) window.electronAPI.invoke('excel-loop-control', { action: 'pause' });
      enginePaused=true;setStatus('Dijeda');});
    const resumeBtn=document.getElementById('elp-resume');
    if(resumeBtn) resumeBtn.addEventListener('click',()=>{
      if(window.electronAPI?.invoke) window.electronAPI.invoke('excel-loop-control', { action: 'resume' });
      enginePaused=false;setStatus('Berjalan');});
    const stopBtn=document.getElementById('elp-stop');
    if(stopBtn) stopBtn.addEventListener('click',()=>{
      if(window.electronAPI?.invoke) window.electronAPI.invoke('excel-loop-control', { action: 'stop' });
      engineStopped=true;setStatus('Dihentikan');});
    const clearBtn=document.getElementById('elp-clear-log');
    if(clearBtn) clearBtn.addEventListener('click',()=>{
      logs=[];const lb=document.getElementById('elp-log-box');if(lb)lb.innerHTML='';});

    const saveDelayBtn=document.getElementById('elp-save-delay');
    if(saveDelayBtn) saveDelayBtn.addEventListener('click',()=>{
      const g=id=>{const el=document.getElementById(id);return el ? parseInt(el.value)||0 : 0; };
      config.delaySettings = {
        beforeLoop: g('elp-delay-before-loop'),
        betweenSteps: g('elp-delay-between-steps'),
        beforePaste: g('elp-delay-before-paste'),
        afterClick: g('elp-delay-after-click'),
        windowTimeout: g('elp-delay-window-timeout'),
      };
      config.delayBetweenRows = g('elp-delay-between-rows');
      saveConfig();
      const btn=document.getElementById('elp-save-delay');
      if(btn){
        btn.textContent='✓ Tersimpan';
        btn.style.background='#16a34a';
        setTimeout(()=>{
          btn.textContent='Simpan Pengaturan Delay';
          btn.style.background='#3b82f6';
        }, 2000);
      }
    });

    const previewBtn=document.getElementById('elp-load-preview');
    if(previewBtn) previewBtn.addEventListener('click', async ()=>{
      const box=document.getElementById('elp-preview-content');
      if(!box) return;
      if(!config.excelPath){
        box.innerHTML='<span style="color:#f87171">Pilih file Excel dulu di tab Excel.</span>';
        return;
      }
      box.innerHTML='<span style="color:#9ca3af">Memuat data...</span>';
      try {
        let rows=[];
        if(window.electronAPI?.invoke){
          const r=await window.electronAPI.invoke('preview-excel', {
            filePath: config.excelPath,
            sheetName: config.sheetName || '',
            maxRows: 10
          });
          if(r?.ok) rows=r.rows;
          else throw new Error(r?.message || 'Gagal load');
        }
        if(rows.length===0){
          box.innerHTML='<span style="color:#fbbf24">Data kosong atau file tidak bisa dibaca.</span>';
          return;
        }
        const headers=rows[0];
        const dataRows=rows.slice(1);
        box.innerHTML = `
<div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr>${headers.map((h,i)=>`
        <th style="padding:8px 12px;background:#374151;color:#f9fafb;
                   text-align:left;border:1px solid #4b5563;white-space:nowrap;">
          <span style="color:#9ca3af;font-size:11px;">Kol ${String.fromCharCode(65+i)}</span><br>
          ${h||'—'}
        </th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${dataRows.map((row,ri)=>`
        <tr style="background:${ri%2===0?'#111827':'#0f172a'}">
          ${headers.map((_,i)=>`
            <td style="padding:7px 12px;border:1px solid #1f2937;color:#e5e7eb;">
              ${row[i]??''}
            </td>`).join('')}
        </tr>`).join('')}
    </tbody>
  </table>
</div>
<p style="margin:12px 0 0;font-size:12px;color:#6b7280;">
  Menampilkan ${dataRows.length} baris pertama dari sheet "${config.sheetName||'Sheet1'}"</p>`;
      } catch (e) {
        box.innerHTML = '<span style="color:#f87171">Error: ' + e.message + '</span>';
      }
    });
  }

  function syncConfigFromDOM() {
    const g=id=>{const el=document.getElementById(id);return el?el.value:null;};
    const gc=id=>{const el=document.getElementById(id);return el?el.checked:false;};
    if(g('elp-excel-path')!==null) config.excelPath=g('elp-excel-path');
    if(g('elp-sheet')!==null) config.sheetName=g('elp-sheet');
    if(g('elp-start-row')!==null) config.startRow=parseInt(g('elp-start-row'))||2;
    if(g('elp-end-row')!==null) config.endRow=parseInt(g('elp-end-row'))||100;
    if(g('elp-target-col')!==null) config.targetColumn=g('elp-target-col')||'A';
    if(g('elp-delay-rows')!==null) config.delayBetweenRows=parseInt(g('elp-delay-rows'))||500;
    if(document.getElementById('elp-skip-empty'))
      config.skipEmptyRows=gc('elp-skip-empty');
    if(document.getElementById('elp-stop-error'))
      config.stopOnError=gc('elp-stop-error');
    if(g('elp-window-title')!==null)
      config.targetConfig.windowTitle=g('elp-window-title');
    if(g('elp-target-url')!==null)
      config.targetConfig.url=g('elp-target-url');
    document.querySelectorAll('[data-step-field-idx]').forEach(el=>{
      const i=parseInt(el.dataset.stepFieldIdx);
      const field=el.dataset.field;
      if(config.normalFlowSteps[i]&&field){
        const val=el.type==='number'?parseInt(el.value)||0:el.value;
        config.normalFlowSteps[i][field]=val;
      }
    });
    document.querySelectorAll('[data-step-label]').forEach(el=>{
      const i=parseInt(el.dataset.stepLabel);
      if(config.normalFlowSteps[i]) config.normalFlowSteps[i].label=el.value;
    });
    saveConfig();
  }

  function setStatus(text) {
    const el=document.getElementById('elp-status-text');
    if(el)el.textContent=text;
  }

  async function handleRun() {
    syncConfigFromDOM();
    engineStopped=false; enginePaused=false;
    const lb=document.getElementById('elp-log-box');
    if(lb)lb.innerHTML='';
    logs=[];
    setStatus('Berjalan');
    addLog('INFO','Memulai Excel Loop Engine...');
    if(!config.excelPath){addLog('ERROR','File Excel belum dipilih!');setStatus('Error');return;}
    addLog('INFO','File: '+config.excelPath);
    addLog('INFO','Baris: '+config.startRow+' - '+config.endRow);
    addLog('INFO','Target: '+config.targetConfig.type+
      (config.targetConfig.windowTitle?' ('+config.targetConfig.windowTitle+')':
       config.targetConfig.url?' ('+config.targetConfig.url+')':'')
    );
    if(window.electronAPI?.invoke){
      try {
        window.electronAPI.invoke('run-excel-loop',{config}).then(r=>{
          addLog(r?.ok?'SUCCESS':'ERROR', r?.message||'Selesai');
          setStatus(r?.ok?'Selesai':'Error');
        }).catch(e=>{addLog('ERROR',e.message);setStatus('Error');});
      } catch(e){addLog('ERROR',e.message);setStatus('Error');}
    } else {
      addLog('WARN','IPC tidak tersedia — simulasi mode');
      for(let i=config.startRow;i<=Math.min(config.endRow,config.startRow+4);i++){
        if(engineStopped)break;
        while(enginePaused)await sleep(300);
        const cv=document.getElementById('elp-cell-value');
        if(cv)cv.textContent='ROW_'+i+'_DATA';
        const lt=document.getElementById('elp-loop-text');
        if(lt)lt.textContent=(i-config.startRow+1)+'/'+(config.endRow-config.startRow+1);
        const rt=document.getElementById('elp-row-text');
        if(rt)rt.textContent=String(i);
        addLog('INFO','── Loop '+(i-config.startRow+1)+' | Baris '+i+' ──');
        addLog('INFO','Nilai: "ROW_'+i+'_DATA"');
        await sleep(config.delayBetweenRows||500);
        const pt=document.getElementById('elp-proc-text');
        if(pt)pt.textContent=String(i-config.startRow+1);
      }
      addLog('SUCCESS','Simulasi selesai!');
      setStatus('Selesai');
    }
  }

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  loadConfig();
  render();
  console.log('[ExcelLoop] Panel berhasil dimuat (pure DOM mode)');
}

module.exports = { initExcelLoopPanel };
