const { 
  normalizePhone,
  detectPhoneColumn,
  buildRows,
  applyFilters,
  sortRows,
  searchRows,
  deleteColumns,
  buildVariableMap,
  applyMappings,
  renderTemplate,
  createRecipientOptions,
  validateRecipients,
  buildReportRows,
  exportCsv,
  summarizeReport,
  loadSettings,
  saveSettings
} = require('./whatsappEngine');
const { autoSendByLogicFix, getCpNameFromRow } = require('./logicFix');
const { resolveGroupByCP, extractKeyword, resolveGroupName } = require('./groupResolver');
const { buildLogicFixMessage, getDefaultLogicFixTemplate, getLogicFixTemplateVariables } = require('../messageTemplates');

function getSafeNumber(value) {
  const result = normalizePhone(value);
  return result.valid ? result.normalized : '';
}

function buildTemplatePresetKey() {
  return 'rba-whatsapp-template-presets';
}

function loadTemplatePresets() {
  try {
    const stored = localStorage.getItem(buildTemplatePresetKey());
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

function saveTemplatePresets(presets) {
  try {
    localStorage.setItem(buildTemplatePresetKey(), JSON.stringify(presets));
  } catch (error) {
    // ignore
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDefaultTemplate() {
  return 'Halo {{nama}},\n\nTerima kasih sudah melakukan transaksi.\nNomor: {{nomor}}\nResi: {{resi}}\n\nSalam,\nRBA Studio Pro';
}

function normalizeHeaderValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_-]+/g, ' ');
}

function resolveExcelColumnIndex(headers = [], candidates = []) {
  const normalizedHeaders = (headers || []).map((header, index) => ({
    header,
    index,
    normalized: normalizeHeaderValue(header)
  }));

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeaderValue(candidate);
    const found = normalizedHeaders.find((item) => item.normalized === normalizedCandidate);
    if (found) {
      return found.index;
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeaderValue(candidate);
    const found = normalizedHeaders.find((item) => item.normalized.includes(normalizedCandidate));
    if (found) {
      return found.index;
    }
  }

  return null;
}

function resolveExcelColumns(headers = []) {
  return {
    awbIndex: resolveExcelColumnIndex(headers, ['No Resi', 'No. Resi', 'AWB', 'awb']),
    cpIndex: resolveExcelColumnIndex(headers, ['CP_Name', 'CP_NAME', 'CP Name', 'cp_name', 'cp name', 'CP']),
    statusIndex: resolveExcelColumnIndex(headers, ['Status Orderan', 'Status', 'status']),
    sourceOrderIndex: resolveExcelColumnIndex(headers, ['Sumber Order', 'Sumber_Order', 'Sumber', 'Source Order', 'source order'])
  };
}

function shouldIncludeSourceOrder(row = [], sourceOrderIndex = null) {
  if (sourceOrderIndex === null || sourceOrderIndex === undefined) {
    return true;
  }

  const sourceValue = String(row[sourceOrderIndex] ?? '').trim();
  if (!sourceValue) {
    return true;
  }

  return sourceValue.trim().toUpperCase().includes('KURIRREKOMENDASI');
}

function initWhatsAppBot(mountEl) {
  if (!mountEl) {
    return null;
  }

  const settings = loadSettings();
  const state = {
    headers: [],
    rawRows: [],
    workbookName: 'Belum ada file',
    totalRows: 0,
    phoneColumnIndex: -1,
    filters: [],
    deleteIndexes: [],
    selectedSortColumn: '',
    sortDirection: 'asc',
    searchTerm: '',
    mappings: {},
    currentRecipients: [],
    recipientsMode: 'number',
    bulkNumbers: '',
    groups: [],
    selectedGroupId: '',
    groupMembers: [],
    template: settings.template || getDefaultTemplate(),
    presets: loadTemplatePresets(),
    selectedPreset: '',
    logicFixTemplateMode: settings.logicFixTemplateMode || 'auto',
    logicFixTemplate: settings.logicFixTemplate || getDefaultLogicFixTemplate(),
    connectionStatus: 'idle',
    qrImage: '',
    qrCountdown: 60,
    connectedInfo: null,
    progress: { total: 0, processed: 0, failed: 0 },
    logs: [],
    report: [],
    reportFilter: 'all',
    options: {
      delayMin: settings.delayMin || 8000,
      delayMax: settings.delayMax || 15000,
      mode: settings.mode || 'all',
      batchSize: settings.batchSize || 10,
      retry: settings.retry || 3,
      skipSent: settings.skipSent !== false
    },
    logicFixDryRun: settings.logicFixDryRun === true,
    logicFixStatus: 'Klik Refresh Deteksi Grup untuk memulai.',
    isConnected: false,
    pendingRun: false,
    isRunning: false,
    isPaused: false,
    stopRequested: false,
    qrTimer: null,
    lastSyncedTemplate: settings.template || getDefaultTemplate()
  };

  mountEl.innerHTML = `
    <div style="padding:24px 24px 32px; overflow-y:auto; height:100%; background:linear-gradient(180deg, rgba(15,23,42,0.95), rgba(2,6,23,0.96));">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:16px; margin-bottom:18px; flex-wrap:wrap;">
        <div>
          <div style="font-size:22px; font-weight:800; margin-bottom:6px;">📲 WhatsApp Bot</div>
          <div style="color:#94a3b8; font-size:13px; max-width:920px;">Kelola data Excel, target penerima, template pesan, dan kirim via WhatsApp dengan kontrol batch, retry, serta laporan real-time.</div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="wa-connect" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">🔗 Connect</button>
          <button id="wa-disconnect" style="border:none; border-radius:10px; padding:10px 14px; background:#7f1d1d; color:#fff; cursor:pointer;">⛔ Disconnect</button>
          <button id="wa-clear" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">🧹 Reset</button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:14px; margin-bottom:20px;">
        <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:16px; padding:16px;">
          <div style="font-size:11px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px;">Status Koneksi</div>
          <div id="wa-status" style="font-size:16px; font-weight:800; color:#38bdf8;">Menunggu Scan</div>
          <div id="wa-account" style="font-size:12px; color:#cbd5e1; margin-top:8px;">Akun belum terhubung</div>
        </div>
        <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:16px; padding:16px;">
          <div style="font-size:11px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px;">Data Terpilih</div>
          <div id="wa-summary-data" style="font-size:16px; font-weight:800; color:#f8fafc;">0 baris</div>
          <div id="wa-summary-valid" style="font-size:12px; color:#cbd5e1; margin-top:8px;">0 nomor valid</div>
        </div>
        <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:16px; padding:16px;">
          <div style="font-size:11px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px;">Progress Pengiriman</div>
          <div id="wa-progress-label" style="font-size:16px; font-weight:800; color:#34d399;">0/0 terkirim</div>
          <div id="wa-progress-meta" style="font-size:12px; color:#cbd5e1; margin-top:8px;">Belum mulai</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1.15fr 0.85fr; gap:18px; align-items:start;">
        <div style="display:flex; flex-direction:column; gap:18px;">
          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <div>
                <div style="font-size:12px; text-transform:uppercase; color:#94a3b8;">TAB 1 — Excel & Data</div>
                <div style="font-size:18px; font-weight:800; margin-top:6px;">Import & Manipulasi Data</div>
              </div>
              <div style="padding:8px 12px; border-radius:999px; background:rgba(59,130,246,0.12); color:#93c5fd; font-size:12px;">${escapeHtml(state.workbookName)}</div>
            </div>
            <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
              <button id="wa-browse" style="border:none; border-radius:10px; padding:10px 14px; background:#1d4ed8; color:#fff; cursor:pointer;">📂 Browse Excel/CSV</button>
              <button id="wa-refresh-data" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">🔄 Refresh Preview</button>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
              <div>
                <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Kolom nomor</div>
                <select id="wa-phone-column" style="width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;"></select>
              </div>
              <div>
                <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Status</div>
                <div id="wa-file-meta" style="padding:10px 12px; border-radius:10px; background:#020617; color:#cbd5e1; min-height:42px;">Belum ada file terpilih.</div>
              </div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Filter data</div>
              <div id="wa-filter-container"></div>
              <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
                <button id="wa-add-filter" style="border:none; border-radius:10px; padding:8px 12px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">➕ Tambah Filter</button>
                <div style="display:flex; gap:8px; align-items:center;">
                  <label style="font-size:12px; color:#cbd5e1;">Mode</label>
                  <select id="wa-filter-mode" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:8px 10px;">
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                  </select>
                </div>
              </div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
              <div>
                <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Hapus kolom</div>
                <div id="wa-delete-columns"></div>
              </div>
              <div>
                <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Sort</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; align-items:center;">
                  <select id="wa-sort-column" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;"></select>
                  <select id="wa-sort-direction" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </div>
              </div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Search / Find</div>
              <input id="wa-search" type="text" placeholder="Cari semua kolom..." style="width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" />
            </div>
            <div>
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Mapping kolom ke variabel</div>
              <div id="wa-mapping"></div>
            </div>
            <div style="margin-top:14px;">
              <div style="font-size:12px; color:#cbd5e1; margin-bottom:8px;">Preview Data (10 baris pertama)</div>
              <div id="wa-preview-table" style="overflow:auto; border-radius:12px; border:1px solid rgba(148,163,184,0.14);"></div>
            </div>
          </div>

          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">TAB 2 — Penerima</div>
            <div style="font-size:18px; font-weight:800; margin-bottom:12px;">Target Penerima</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
              <button data-mode="number" class="wa-mode-btn" style="border:none; border-radius:10px; padding:10px 14px; background:#1d4ed8; color:#fff; cursor:pointer;">📞 Nomor WhatsApp</button>
              <button data-mode="group" class="wa-mode-btn" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">👥 Grup WhatsApp</button>
            </div>
            <div id="wa-target-number-panel">
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Nomor bulk input</div>
              <textarea id="wa-bulk-numbers" style="width:100%; min-height:140px; border-radius:12px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:12px; font-family:ui-monospace, SFMono-Regular, monospace;" placeholder="+6281234567890 atau 081234567890"></textarea>
              <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
                <button id="wa-import-excel-targets" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">📥 Import dari kolom Excel</button>
                <button id="wa-validate-targets" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">✅ Validasi nomor</button>
              </div>
            </div>
            <div id="wa-target-group-panel" style="display:none;">
              <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">Nama grup</div>
              <textarea id="wa-group-input" style="width:100%; min-height:110px; border-radius:12px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:12px; font-family:ui-monospace, SFMono-Regular, monospace;" placeholder="Nama grup 1 per baris"></textarea>
              <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                <button id="wa-scan-groups" style="border:none; border-radius:10px; padding:10px 14px; background:#1d4ed8; color:#fff; cursor:pointer;">🔍 Scan & Cari Grup</button>
                <select id="wa-group-dropdown" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px; min-width:220px;"></select>
              </div>
              <div id="wa-group-info" style="margin-top:10px; font-size:12px; color:#cbd5e1;">Belum ada daftar grup.</div>
            </div>
            <div id="wa-target-summary" style="margin-top:14px; font-size:12px; color:#cbd5e1;"></div>
          </div>

          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">TAB 3 — Pesan</div>
            <div style="font-size:18px; font-weight:800; margin-bottom:12px;">Template Pesan</div>
            <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
              <button id="wa-insert-variable" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">🔧 Insert Variabel</button>
              <button id="wa-save-template" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">💾 Simpan Preset</button>
              <select id="wa-template-select" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px; min-width:220px;"></select>
            </div>
            <textarea id="wa-template-editor" style="width:100%; min-height:160px; border-radius:12px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:12px; font-family:ui-monospace, SFMono-Regular, monospace;">${escapeHtml(state.template)}</textarea>
            <div style="display:flex; justify-content:space-between; margin-top:10px; flex-wrap:wrap; gap:10px;">
              <div style="font-size:12px; color:#cbd5e1;">Karakter: <span id="wa-template-count">0</span></div>
              <div style="font-size:12px; color:#cbd5e1;">Preview baris pertama: <span id="wa-template-preview">-</span></div>
            </div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:18px;">
          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">TAB 4 — Koneksi</div>
            <div style="font-size:18px; font-weight:800; margin-bottom:12px;">QR Login</div>
            <div id="wa-qr-wrapper" style="min-height:320px; display:flex; flex-direction:column; align-items:center; justify-content:center; border:1px dashed rgba(59,130,246,0.3); border-radius:16px; background:rgba(2,6,23,0.7); padding:16px;">
              <div id="wa-qr-empty" style="text-align:center; color:#cbd5e1; font-size:13px;">Klik Connect atau RUN untuk menampilkan QR Code.</div>
              <img id="wa-qr-image" alt="WhatsApp QR" style="display:none; width:260px; border-radius:16px; background:#fff; padding:8px;" />
            </div>
            <div id="wa-qr-meta" style="margin-top:10px; font-size:12px; color:#cbd5e1;">Timer QR: 60 detik</div>
          </div>

          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">TAB 5 — Jalankan</div>
            <div style="font-size:18px; font-weight:800; margin-bottom:12px;">Pengaturan Pengiriman</div>
            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px;">
              <label style="font-size:12px; color:#cbd5e1;">Delay Min (ms)<input id="wa-delay-min" type="number" value="${state.options.delayMin}" style="margin-top:6px; width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" /></label>
              <label style="font-size:12px; color:#cbd5e1;">Delay Max (ms)<input id="wa-delay-max" type="number" value="${state.options.delayMax}" style="margin-top:6px; width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" /></label>
              <label style="font-size:12px; color:#cbd5e1;">Mode<select id="wa-send-mode" style="margin-top:6px; width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
                <option value="all" ${state.options.mode === 'all' ? 'selected' : ''}>Kirim ke semua</option>
                <option value="batch" ${state.options.mode === 'batch' ? 'selected' : ''}>Kirim per batch</option>
                <option value="auto-send-by-logic-fix" ${state.options.mode === 'auto-send-by-logic-fix' ? 'selected' : ''}>Auto Send by Logic Fix</option>
              </select></label>
              <label style="font-size:12px; color:#cbd5e1;">Batch Size<input id="wa-batch-size" type="number" value="${state.options.batchSize}" style="margin-top:6px; width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" /></label>
              <label style="font-size:12px; color:#cbd5e1;">Retry Max<input id="wa-retry-max" type="number" value="${state.options.retry}" style="margin-top:6px; width:100%; border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" /></label>
              <label style="font-size:12px; color:#cbd5e1;">Skip nomer terkirim<input id="wa-skip-sent" type="checkbox" ${state.options.skipSent ? 'checked' : ''} style="display:block; margin-top:10px;" /></label>
            </div>
            <div style="margin-top:14px; padding:12px; border-radius:12px; background:rgba(15,23,42,0.8); border:1px solid rgba(148,163,184,0.16);">
              <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px;">Auto Send by Logic Fix</div>
              <div id="logic-fix-section" style="background:#111827;border:1px solid #1e3a5f;border-radius:10px;padding:20px;margin-top:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <span style="font-size:16px;">🔄</span>
                  <h3 style="margin:0;font-size:15px;font-weight:600;color:#f8fafc;">Auto Send by Logic Fix</h3>
                </div>
                <p style="margin:0 0 20px;font-size:13px;color:#64748b;">
                  Upload Excel → sistem otomatis deteksi CP → kirim ke grup "Monitoring CP_XXX" yang sesuai.
                </p>

                <div class="lf-step" id="lf-step-1">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;">1</div>
                    <span style="font-size:14px;font-weight:600;color:#f8fafc;">Upload File Excel</span>
                    <span id="lf-excel-status" style="font-size:12px;color:#64748b;margin-left:auto;">Belum ada file</span>
                  </div>

                  <div style="display:flex;gap:10px;align-items:stretch;margin-bottom:12px;">
                    <input id="lf-excel-path" readonly placeholder="Pilih file .xlsx atau .xls..." style="flex:1;padding:9px 12px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#94a3b8;font-size:13px;cursor:pointer;" />
                    <button id="lf-browse-btn" style="padding:9px 18px;background:#1e40af;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">📂 Browse Excel</button>
                    <input type="file" id="lf-excel-file-input" accept=".xlsx,.xls,.csv" style="display:none;" />
                  </div>

                  <div id="lf-column-config" style="display:none;">
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
                      <div>
                        <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Kolom AWB / Nomor Resi</label>
                        <select id="lf-col-awb" style="width:100%;padding:7px 10px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:13px;">
                          <option value="">-- Pilih Kolom --</option>
                        </select>
                      </div>
                      <div>
                        <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Kolom Nama CP</label>
                        <select id="lf-col-cp" style="width:100%;padding:7px 10px;background:#1e293b;border:1px solid #334151;border-radius:6px;color:#f8fafc;font-size:13px;">
                          <option value="">-- Pilih Kolom --</option>
                        </select>
                      </div>
                      <div>
                        <label style="display:block;font-size:12px;color:#94a3b8;margin-bottom:4px;">Kolom Status (opsional)</label>
                        <select id="lf-col-status" style="width:100%;padding:7px 10px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#f8fafc;font-size:13px;">
                          <option value="">-- Tidak Ada --</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="lf-step" id="lf-step-2" style="display:none;margin-top:16px;">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;">2</div>
                    <span style="font-size:14px;font-weight:600;color:#f8fafc;">Preview & Konfirmasi Data</span>
                  </div>

                  <div style="background:#0f172a;border-radius:10px;padding:12px;margin-bottom:12px; border:1px solid rgba(59,130,246,0.18);">
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
                      <div>
                        <div style="font-size:12px;color:#64748b;">Template Logic Fix</div>
                        <div style="font-size:14px;font-weight:700;color:#f8fafc;">Manual & Auto Message</div>
                      </div>
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <select id="lf-template-mode" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px; min-width:170px;">
                          <option value="auto" ${state.logicFixTemplateMode === 'auto' ? 'selected' : ''}>Auto (generated)</option>
                          <option value="manual" ${state.logicFixTemplateMode === 'manual' ? 'selected' : ''}>Manual</option>
                        </select>
                        <button id="lf-template-reset" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">↺ Reset</button>
                      </div>
                    </div>

                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                      <button data-lf-template-var="{{cp_name}}" style="border:none; border-radius:10px; padding:8px 12px; background:#1e40af; color:#fff; cursor:pointer; font-size:12px;">CP</button>
                      <button data-lf-template-var="{{group_name}}" style="border:none; border-radius:10px; padding:8px 12px; background:#1e40af; color:#fff; cursor:pointer; font-size:12px;">Grup</button>
                      <button data-lf-template-var="{{awb_count}}" style="border:none; border-radius:10px; padding:8px 12px; background:#1e40af; color:#fff; cursor:pointer; font-size:12px;">Jumlah AWB</button>
                      <button data-lf-template-var="{{awb_list}}" style="border:none; border-radius:10px; padding:8px 12px; background:#1e40af; color:#fff; cursor:pointer; font-size:12px;">AWB List</button>
                      <button data-lf-template-var="{{status_summary}}" style="border:none; border-radius:10px; padding:8px 12px; background:#1e40af; color:#fff; cursor:pointer; font-size:12px;">Status</button>
                    </div>

                    <textarea id="lf-template-editor" style="width:100%; min-height:120px; border-radius:12px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:12px; font-family:ui-monospace, SFMono-Regular, monospace; resize:vertical;">${escapeHtml(state.logicFixTemplate)}</textarea>

                    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; margin-top:12px;">
                      <div>
                        <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Preview pesan Logic Fix</div>
                        <pre id="lf-template-preview" style="margin:0; min-height:140px; padding:12px; border-radius:10px; background:#020617; color:#cbd5e1; font-family:ui-monospace, SFMono-Regular, monospace; font-size:12px; white-space:pre-wrap; overflow:auto;"></pre>
                      </div>
                      <div>
                        <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Variabel tersedia</div>
                        <div id="lf-template-vars" style="padding:12px; border-radius:10px; background:#020617; color:#cbd5e1; font-size:12px; line-height:1.7;"></div>
                      </div>
                    </div>
                  </div>

                  <div id="lf-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;"></div>

                  <div id="lf-preview-table-wrap" style="background:#0f172a;border-radius:8px;max-height:180px;overflow:auto;margin-bottom:12px;">
                    <table id="lf-preview-table" style="width:100%;border-collapse:collapse;font-size:12px;"></table>
                  </div>

                  <div id="lf-groups-preview" style="background:#0f172a;border-radius:8px;padding:12px;margin-bottom:12px;">
                    <div style="font-size:12px;color:#64748b;margin-bottom:8px;">Grup yang akan menerima pesan:</div>
                    <div id="lf-groups-list" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
                  </div>
                </div>

                <div class="lf-step" id="lf-step-3" style="display:none;margin-top:16px;">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;">3</div>
                    <span style="font-size:14px;font-weight:600;color:#f8fafc;">Sambung WhatsApp</span>
                    <span id="lf-wa-status-badge" style="margin-left:auto;padding:3px 10px;border-radius:20px;font-size:11px;background:#7f1d1d;color:#fca5a5;">Belum terhubung</span>
                  </div>

                  <div id="lf-qr-area" style="text-align:center;padding:20px;">
                    <button id="lf-connect-btn" style="padding:12px 28px;background:#16a34a;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">📱 Sambungkan WhatsApp</button>
                    <p style="font-size:12px;color:#64748b;margin-top:8px;">Klik untuk generate QR Code, lalu scan dengan WhatsApp di HP</p>
                  </div>

                  <div id="lf-qr-display" style="display:none;text-align:center;">
                    <img id="lf-qr-img" style="width:200px;height:200px;border-radius:10px;border:3px solid #1e40af;" />
                    <div style="margin-top:8px;font-size:13px;color:#94a3b8;">Scan QR ini dengan WhatsApp di HP kamu</div>
                    <div id="lf-qr-timer" style="margin-top:4px;font-size:12px;color:#f59e0b;">⏱ Timeout: 60 detik</div>
                  </div>

                  <div id="lf-wa-connected-info" style="display:none;background:#052e16;border:1px solid #16a34a;border-radius:8px;padding:12px;text-align:center;">
                    <div style="font-size:20px;margin-bottom:6px;">✅</div>
                    <div id="lf-wa-user-name" style="font-size:14px;font-weight:600;color:#4ade80;"></div>
                    <div id="lf-wa-user-number" style="font-size:12px;color:#16a34a;"></div>
                    <button id="lf-disconnect-btn" style="margin-top:8px;padding:5px 14px;background:transparent;color:#64748b;border:1px solid #334155;border-radius:6px;font-size:12px;cursor:pointer;">Ganti Akun</button>
                  </div>
                </div>

                <div class="lf-step" id="lf-step-4" style="display:none;margin-top:16px;">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <div style="width:24px;height:24px;border-radius:50%;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0;">4</div>
                    <span style="font-size:14px;font-weight:600;color:#f8fafc;">Jalankan & Monitor</span>
                  </div>

                  <div style="background:#1e293b;border-radius:6px;height:6px;margin-bottom:10px;overflow:hidden;">
                    <div id="lf-progress-bar" style="height:100%;background:#1e40af;border-radius:6px;width:0%;transition:width 0.3s;"></div>
                  </div>

                  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
                    <div style="background:#1e293b;border-radius:8px;padding:10px;text-align:center;">
                      <div style="font-size:18px;font-weight:700;color:#f8fafc;" id="lf-stat-total">0</div>
                      <div style="font-size:11px;color:#64748b;">Total Grup</div>
                    </div>
                    <div style="background:#1e293b;border-radius:8px;padding:10px;text-align:center;">
                      <div style="font-size:18px;font-weight:700;color:#22c55e;" id="lf-stat-sent">0</div>
                      <div style="font-size:11px;color:#64748b;">Terkirim</div>
                    </div>
                    <div style="background:#1e293b;border-radius:8px;padding:10px;text-align:center;">
                      <div style="font-size:18px;font-weight:700;color:#ef4444;" id="lf-stat-failed">0</div>
                      <div style="font-size:11px;color:#64748b;">Gagal</div>
                    </div>
                    <div style="background:#1e293b;border-radius:8px;padding:10px;text-align:center;">
                      <div style="font-size:18px;font-weight:700;color:#f59e0b;" id="lf-stat-pending">0</div>
                      <div style="font-size:11px;color:#64748b;">Menunggu</div>
                    </div>
                  </div>

                  <div id="lf-current-status" style="font-size:13px;color:#94a3b8;margin-bottom:10px;padding:8px 12px;background:#1e293b;border-radius:6px;">Siap dijalankan</div>
                  <div id="lf-log" style="background:#0f172a;border-radius:8px;padding:12px;height:150px;overflow-y:auto;font-family:monospace;font-size:11px;margin-bottom:12px;"></div>

                  <div style="display:flex;gap:8px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;cursor:pointer;margin-right:8px;">
                      <input type="checkbox" id="lf-dry-run" /> Dry Run (simulasi)
                    </label>
                    <div style="flex:1;"></div>
                    <button id="lf-run-btn" style="flex:1;padding:11px;background:#16a34a;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">▶ JALANKAN</button>
                    <button id="lf-pause-btn" style="padding:11px 16px;background:#d97706;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">⏸</button>
                    <button id="lf-stop-btn" style="padding:11px 16px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">■</button>
                  </div>
                </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
                  <button id="wa-run" style="border:none; border-radius:10px; padding:10px 14px; background:#16a34a; color:#fff; cursor:pointer;">▶ RUN</button>
                  <button id="wa-pause" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">⏸ PAUSE</button>
                  <button id="wa-resume" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">▶️ RESUME</button>
                  <button id="wa-stop" style="border:none; border-radius:10px; padding:10px 14px; background:#7f1d1d; color:#fff; cursor:pointer;">■ STOP</button>
                </div>

                <div style="margin-top:18px; padding:12px; border-radius:12px; background:#0f172a; border:1px dashed rgba(148,163,184,0.16);">
                  <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px;">Legacy controls</div>
                  <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; align-items:center;">
                    <button id="wa-logic-preview" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">🔄 Refresh Deteksi Grup</button>
                    <button id="wa-logic-run" style="border:none; border-radius:10px; padding:10px 14px; background:#1d4ed8; color:#fff; cursor:pointer;">🚀 Jalankan Logic Fix</button>
                    <label style="font-size:12px; color:#cbd5e1;">Dry run<input id="wa-logic-dry-run" type="checkbox" ${state.logicFixDryRun ? 'checked' : ''} style="display:block; margin-top:6px;" /></label>
                  </div>
                  <div id="wa-logic-status" style="margin-top:10px; font-size:12px; color:#cbd5e1;">${escapeHtml(state.logicFixStatus)}</div>
                  <div id="wa-logic-preview-area" style="margin-top:10px; min-height:110px; padding:12px; border-radius:12px; background:#020617; color:#cbd5e1; font-size:12px; overflow:auto;"></div>
                </div>
              </div>
            </div>
            <div id="wa-run-log" style="margin-top:14px; min-height:160px; padding:12px; border-radius:12px; background:#020617; color:#cbd5e1; overflow-y:auto; font-size:12px;"></div>
          </div>

          <div style="background:rgba(15,23,42,0.92); border:1px solid rgba(148,163,184,0.16); border-radius:18px; padding:18px;">
            <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">TAB 6 — Laporan</div>
            <div style="font-size:18px; font-weight:800; margin-bottom:12px;">Report per Penerima</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
              <select id="wa-report-filter" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
                <option value="all">Semua</option>
                <option value="success">Berhasil</option>
                <option value="failed">Gagal</option>
                <option value="pending">Pending</option>
              </select>
              <button id="wa-export-xlsx" style="border:none; border-radius:10px; padding:10px 14px; background:#1d4ed8; color:#fff; cursor:pointer;">📗 Export Excel</button>
              <button id="wa-export-csv" style="border:none; border-radius:10px; padding:10px 14px; background:#0f172a; color:#f8fafc; border:1px solid rgba(148,163,184,0.2); cursor:pointer;">📄 Export CSV</button>
            </div>
            <div id="wa-report-summary" style="font-size:12px; color:#cbd5e1; margin-bottom:8px;"></div>
            <div id="wa-report-table" style="overflow:auto; border-radius:12px; border:1px solid rgba(148,163,184,0.14);"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const elements = {
    status: mountEl.querySelector('#wa-status'),
    account: mountEl.querySelector('#wa-account'),
    summaryData: mountEl.querySelector('#wa-summary-data'),
    summaryValid: mountEl.querySelector('#wa-summary-valid'),
    progressLabel: mountEl.querySelector('#wa-progress-label'),
    progressMeta: mountEl.querySelector('#wa-progress-meta'),
    fileMeta: mountEl.querySelector('#wa-file-meta'),
    phoneColumn: mountEl.querySelector('#wa-phone-column'),
    filterContainer: mountEl.querySelector('#wa-filter-container'),
    deleteColumns: mountEl.querySelector('#wa-delete-columns'),
    sortColumn: mountEl.querySelector('#wa-sort-column'),
    sortDirection: mountEl.querySelector('#wa-sort-direction'),
    search: mountEl.querySelector('#wa-search'),
    mapping: mountEl.querySelector('#wa-mapping'),
    preview: mountEl.querySelector('#wa-preview-table'),
    bulkNumbers: mountEl.querySelector('#wa-bulk-numbers'),
    targetSummary: mountEl.querySelector('#wa-target-summary'),
    groupInput: mountEl.querySelector('#wa-group-input'),
    groupDropdown: mountEl.querySelector('#wa-group-dropdown'),
    groupInfo: mountEl.querySelector('#wa-group-info'),
    templateEditor: mountEl.querySelector('#wa-template-editor'),
    templateCount: mountEl.querySelector('#wa-template-count'),
    templatePreview: mountEl.querySelector('#wa-template-preview'),
    templateSelect: mountEl.querySelector('#wa-template-select'),
    qrEmpty: mountEl.querySelector('#wa-qr-empty'),
    qrImage: mountEl.querySelector('#wa-qr-image'),
    qrMeta: mountEl.querySelector('#wa-qr-meta'),
    runLog: mountEl.querySelector('#wa-run-log'),
    reportFilter: mountEl.querySelector('#wa-report-filter'),
    reportSummary: mountEl.querySelector('#wa-report-summary'),
    reportTable: mountEl.querySelector('#wa-report-table'),
    delayMin: mountEl.querySelector('#wa-delay-min'),
    delayMax: mountEl.querySelector('#wa-delay-max'),
    sendMode: mountEl.querySelector('#wa-send-mode'),
    batchSize: mountEl.querySelector('#wa-batch-size'),
    retryMax: mountEl.querySelector('#wa-retry-max'),
    skipSent: mountEl.querySelector('#wa-skip-sent'),
    logicRefresh: mountEl.querySelector('#wa-logic-preview'),
    logicRun: mountEl.querySelector('#wa-logic-run'),
    logicDryRun: mountEl.querySelector('#wa-logic-dry-run'),
    logicStatus: mountEl.querySelector('#wa-logic-status'),
    logicPreviewArea: mountEl.querySelector('#wa-logic-preview-area'),
    lfExcelPath: mountEl.querySelector('#lf-excel-path'),
    lfExcelStatus: mountEl.querySelector('#lf-excel-status'),
    lfExcelFileInput: mountEl.querySelector('#lf-excel-file-input'),
    lfBrowseBtn: mountEl.querySelector('#lf-browse-btn'),
    lfColumnConfig: mountEl.querySelector('#lf-column-config'),
    lfColAwb: mountEl.querySelector('#lf-col-awb'),
    lfColCp: mountEl.querySelector('#lf-col-cp'),
    lfColStatus: mountEl.querySelector('#lf-col-status'),
    lfStep2: mountEl.querySelector('#lf-step-2'),
    lfStep3: mountEl.querySelector('#lf-step-3'),
    lfStep4: mountEl.querySelector('#lf-step-4'),
    lfSummary: mountEl.querySelector('#lf-summary'),
    lfPreviewTable: mountEl.querySelector('#lf-preview-table'),
    lfGroupsList: mountEl.querySelector('#lf-groups-list'),
    lfTemplateMode: mountEl.querySelector('#lf-template-mode'),
    lfTemplateEditor: mountEl.querySelector('#lf-template-editor'),
    lfTemplateReset: mountEl.querySelector('#lf-template-reset'),
    lfTemplatePreview: mountEl.querySelector('#lf-template-preview'),
    lfTemplateVars: mountEl.querySelector('#lf-template-vars'),
    lfWaStatusBadge: mountEl.querySelector('#lf-wa-status-badge'),
    lfConnectBtn: mountEl.querySelector('#lf-connect-btn'),
    lfQrArea: mountEl.querySelector('#lf-qr-area'),
    lfQrDisplay: mountEl.querySelector('#lf-qr-display'),
    lfQrImg: mountEl.querySelector('#lf-qr-img'),
    lfQrTimer: mountEl.querySelector('#lf-qr-timer'),
    lfWaConnectedInfo: mountEl.querySelector('#lf-wa-connected-info'),
    lfWaUserName: mountEl.querySelector('#lf-wa-user-name'),
    lfWaUserNumber: mountEl.querySelector('#lf-wa-user-number'),
    lfDisconnectBtn: mountEl.querySelector('#lf-disconnect-btn'),
    lfProgressBar: mountEl.querySelector('#lf-progress-bar'),
    lfStatTotal: mountEl.querySelector('#lf-stat-total'),
    lfStatSent: mountEl.querySelector('#lf-stat-sent'),
    lfStatFailed: mountEl.querySelector('#lf-stat-failed'),
    lfStatPending: mountEl.querySelector('#lf-stat-pending'),
    lfCurrentStatus: mountEl.querySelector('#lf-current-status'),
    lfLog: mountEl.querySelector('#lf-log'),
    lfDryRun: mountEl.querySelector('#lf-dry-run'),
    lfRunBtn: mountEl.querySelector('#lf-run-btn'),
    lfPauseBtn: mountEl.querySelector('#lf-pause-btn'),
    lfStopBtn: mountEl.querySelector('#lf-stop-btn')
  };

  function addLog(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.unshift(`[${timestamp}] ${message}`);
    state.logs = state.logs.slice(0, 80);
    renderLog();
  }

  function setStatus(text, color = '#38bdf8') {
    elements.status.textContent = text;
    elements.status.style.color = color;
  }

  function setLogicFixStatus(text, color = '#cbd5e1') {
    state.logicFixStatus = text;
    elements.logicStatus.textContent = text;
    elements.logicStatus.style.color = color;
  }

  function getLogicFixRows() {
    const baseRows = buildRows(state.headers, state.rawRows);
    return baseRows.map((row) => applyMappings(row, state.mappings));
  }

  async function fetchLogicFixGroups() {
    if (!state.isConnected) {
      throw new Error('WhatsApp belum terkoneksi. Sambungkan dulu sebelum menjalankan Logic Fix.');
    }

    const result = await window.electronAPI.invoke('wa-get-groups');
    if (!result.ok) {
      throw new Error(result.message || 'Gagal mengambil grup WhatsApp');
    }

    state.groups = result.groups || [];
    return state.groups;
  }

  async function sendWhatsAppMessage(recipient, message) {
    const result = await window.electronAPI.invoke('wa-run', {
      recipients: [recipient],
      template: message,
      options: state.options
    });

    if (!result.ok) {
      throw new Error(result.message || 'Gagal mengirim pesan');
    }

    return result;
  }

  async function renderLogicFixPreview() {
    if (!state.isConnected) {
      elements.logicPreviewArea.innerHTML = '<div>Belum ada koneksi WhatsApp. Sambungkan terlebih dahulu untuk mendeteksi grup.</div>';
      setLogicFixStatus('WhatsApp belum terkoneksi. Sambungkan dulu sebelum menjalankan Logic Fix.', '#fca5a5');
      return;
    }

    try {
      const groups = await fetchLogicFixGroups();
      const rows = getLogicFixRows();
      const uniqueRows = [];
      const seenCpNames = new Set();

      rows.forEach((row) => {
        const cpName = getCpNameFromRow(row);
        if (!cpName || seenCpNames.has(cpName)) {
          return;
        }
        seenCpNames.add(cpName);
        uniqueRows.push(row);
      });

      if (!uniqueRows.length) {
        elements.logicPreviewArea.innerHTML = '<div>Belum ada data CP di Excel. Import file untuk melihat hasil deteksi grup.</div>';
        setLogicFixStatus('Belum ada data CP di Excel untuk dideteksi.', '#facc15');
        return;
      }

      const rowsForTable = uniqueRows.map((row) => {
        const cpName = getCpNameFromRow(row);
        const resolved = resolveGroupByCP(cpName, groups);
        const keyword = extractKeyword(cpName);

        return {
          cpName,
          keyword,
          groupName: resolved.found ? resolved.group.name : '-',
          status: resolved.ambiguous
            ? `Ambigu (${resolved.allMatches.length} grup)`
            : resolved.found
              ? 'Cocok'
              : 'Tidak ditemukan'
        };
      });

      elements.logicPreviewArea.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead>
            <tr style="background:rgba(15,23,42,0.92); color:#cbd5e1; text-align:left;">
              <th style="padding:10px; border-bottom:1px solid rgba(148,163,184,0.14);">CP_Name</th>
              <th style="padding:10px; border-bottom:1px solid rgba(148,163,184,0.14);">Keyword</th>
              <th style="padding:10px; border-bottom:1px solid rgba(148,163,184,0.14);">Grup Ditemukan</th>
              <th style="padding:10px; border-bottom:1px solid rgba(148,163,184,0.14);">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rowsForTable.map((row) => `
              <tr style="border-bottom:1px solid rgba(148,163,184,0.08);">
                <td style="padding:10px;">${escapeHtml(row.cpName)}</td>
                <td style="padding:10px;">${escapeHtml(row.keyword)}</td>
                <td style="padding:10px;">${escapeHtml(row.groupName)}</td>
                <td style="padding:10px; color:${row.status === 'Cocok' ? '#34d399' : row.status.startsWith('Ambigu') ? '#facc15' : '#fca5a5'}; font-weight:700;">${escapeHtml(row.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      const found = rowsForTable.filter((row) => row.status === 'Cocok').length;
      const ambiguous = rowsForTable.filter((row) => row.status.startsWith('Ambigu')).length;
      const missing = rowsForTable.filter((row) => row.status === 'Tidak ditemukan').length;
      setLogicFixStatus(`${rowsForTable.length} CP dideteksi • ${found} cocok • ${ambiguous} ambigu • ${missing} tidak ditemukan.`, missing ? '#facc15' : '#34d399');
    } catch (error) {
      elements.logicPreviewArea.innerHTML = `<div>${escapeHtml(error.message || 'Gagal mendeteksi grup')}</div>`;
      setLogicFixStatus(error.message || 'Gagal mendeteksi grup.', '#fca5a5');
    }
  }

  async function runLogicFix() {
    updateOptions();

    if (!state.isConnected) {
      setLogicFixStatus('WhatsApp belum terkoneksi. Sambungkan dulu sebelum menjalankan Logic Fix.', '#fca5a5');
      addLog('Logic Fix dibatalkan: WhatsApp belum terkoneksi', 'warn');
      return;
    }

    const rows = getLogicFixRows();
    if (!rows.length) {
      setLogicFixStatus('Belum ada data Excel untuk diproses.', '#fca5a5');
      addLog('Tidak ada data untuk Logic Fix', 'warn');
      return;
    }

    let allGroups = [];
    try {
      allGroups = await fetchLogicFixGroups();
    } catch (error) {
      setLogicFixStatus(error.message || 'Gagal mengambil grup WhatsApp.', '#fca5a5');
      addLog(error.message || 'Gagal mengambil grup WhatsApp', 'error');
      return;
    }

    setLogicFixStatus('Menjalankan Logic Fix...', '#93c5fd');
    addLog('Memulai Auto Send by Logic Fix', 'info');

    const outcome = await autoSendByLogicFix(rows, {
      mode: state.logicFixTemplateMode,
      template: state.logicFixTemplate,
      retry: state.options.retry,
      delayMs: state.options.delayMin,
      dryRun: state.logicFixDryRun,
      allGroups,
      sendMessage: sendWhatsAppMessage,
      onProgress: (payload) => {
        if (payload.type === 'success') {
          addLog(`Logic Fix berhasil kirim ke ${payload.groupName || payload.cpName}`, 'success');
        }
        if (payload.type === 'failed') {
          addLog(`Logic Fix gagal untuk ${payload.cpName}: ${payload.error}`, 'error');
        }
        if (payload.type === 'retry') {
          addLog(`Retry Logic Fix untuk ${payload.cpName} (percobaan ${payload.attempt})`, 'warn');
        }
        if (payload.type === 'dry-run') {
          addLog(`Dry run Logic Fix: ${payload.cpName} -> ${payload.groupName}`, 'info');
        }
        if (payload.type === 'ambiguous') {
          addLog(`Logic Fix ambiguous untuk ${payload.cpName}; menggunakan ${payload.used}`, 'info');
        }
        if (payload.type === 'skipped') {
          addLog(`Logic Fix skip ${payload.cpName}: ${payload.reason}`, 'warn');
        }
      }
    });

    const sent = outcome.sent.length;
    const skipped = outcome.skipped.length;
    const failed = outcome.failed.length;
    const summaryText = `Logic Fix selesai: ${sent} terkirim, ${skipped} dilewati, ${failed} gagal.`;
    setLogicFixStatus(summaryText, failed ? '#fca5a5' : '#34d399');
    addLog(summaryText, failed ? 'error' : 'success');
    await renderLogicFixPreview();
  }

  function renderLog() {
    elements.runLog.innerHTML = state.logs.map((line) => `<div style="margin-bottom:6px; color:#cbd5e1;">${escapeHtml(line)}</div>`).join('');
  }

  function renderFilters() {
    if (!state.headers.length) {
      elements.filterContainer.innerHTML = '<div style="color:#94a3b8; font-size:12px;">Import Excel terlebih dahulu untuk mengaktifkan filter.</div>';
      return;
    }
 
    elements.filterContainer.innerHTML = state.filters.map((filter, index) => `
      <div style="display:grid; grid-template-columns: 1.3fr 1fr 1.3fr auto; gap:8px; margin-bottom:8px; align-items:center;">
        <select data-filter-index="${index}" data-field="column" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
          ${state.headers.map((header) => `<option value="${escapeHtml(header)}" ${filter.column === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}
        </select>
        <select data-filter-index="${index}" data-field="operator" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
          <option value="eq" ${filter.operator === 'eq' ? 'selected' : ''}>Sama dengan</option>
          <option value="contains" ${filter.operator === 'contains' ? 'selected' : ''}>Mengandung</option>
          <option value="gt" ${filter.operator === 'gt' ? 'selected' : ''}>Lebih besar</option>
          <option value="lt" ${filter.operator === 'lt' ? 'selected' : ''}>Kurang dari</option>
          <option value="not-empty" ${filter.operator === 'not-empty' ? 'selected' : ''}>Tidak kosong</option>
        </select>
        <input data-filter-index="${index}" data-field="value" value="${escapeHtml(filter.value || '')}" placeholder="Nilai filter" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;" />
        <button data-remove-filter="${index}" style="border:none; border-radius:10px; padding:8px 12px; background:#7f1d1d; color:#fff; cursor:pointer;">✕</button>
      </div>
    `).join('');

    mountEl.querySelectorAll('[data-remove-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-remove-filter'));
        state.filters.splice(idx, 1);
        refreshData();
      });
    });

    mountEl.querySelectorAll('[data-filter-index]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.getAttribute('data-filter-index'));
        const field = input.getAttribute('data-field');
        state.filters[index][field] = input.value;
        refreshData();
      });
    });
  }

  function renderDeleteColumns() {
    if (!state.headers.length) {
      elements.deleteColumns.innerHTML = '<div style="color:#94a3b8; font-size:12px;">Import Excel terlebih dahulu untuk melihat opsi hapus kolom.</div>';
      return;
    }

    elements.deleteColumns.innerHTML = state.headers.map((header, index) => `
      <label style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; font-size:12px; color:#cbd5e1;">
        <span>${escapeHtml(header)}</span>
        <input type="checkbox" data-delete-column="${index}" ${state.deleteIndexes.includes(index) ? 'checked' : ''} />
      </label>
    `).join('');

    mountEl.querySelectorAll('[data-delete-column]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const index = Number(checkbox.getAttribute('data-delete-column'));
        if (checkbox.checked) {
          state.deleteIndexes.push(index);
        } else {
          state.deleteIndexes = state.deleteIndexes.filter((item) => item !== index);
        }
        refreshData();
      });
    });
  }

  function renderMapping() {
    if (!state.headers.length) {
      elements.mapping.innerHTML = '<div style="color:#94a3b8; font-size:12px;">Import Excel untuk memetakan kolom ke variabel.</div>';
      return;
    }

    const options = ['nama', 'nomor', 'resi', 'tanggal', 'status', 'keterangan'];
    elements.mapping.innerHTML = state.headers.map((header, index) => `
      <div style="display:grid; grid-template-columns: 1fr auto 1fr; gap:8px; margin-bottom:8px; align-items:center;">
        <div style="font-size:12px; color:#cbd5e1;">${escapeHtml(header)}</div>
        <span style="color:#94a3b8;">→</span>
        <select data-mapping="${index}" style="border-radius:10px; border:1px solid rgba(148,163,184,0.2); background:#020617; color:#f8fafc; padding:10px 12px;">
          <option value="">(kosong)</option>
          ${options.map((name) => `<option value="${escapeHtml(name)}" ${state.mappings[header] === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </div>
    `).join('');

    mountEl.querySelectorAll('[data-mapping]').forEach((select) => {
      select.addEventListener('change', () => {
        const index = Number(select.getAttribute('data-mapping'));
        const header = state.headers[index];
        state.mappings[header] = select.value;
        refreshData();
      });
    });
  }

  function renderPhoneColumn() {
    elements.phoneColumn.innerHTML = state.headers.map((header, index) => `<option value="${index}" ${index === state.phoneColumnIndex ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('');
    if (state.phoneColumnIndex === -1 && state.headers.length) {
      state.phoneColumnIndex = detectPhoneColumn(state.headers, state.rawRows);
      elements.phoneColumn.value = String(state.phoneColumnIndex);
    }
  }

  function renderSortColumn() {
    elements.sortColumn.innerHTML = [''].concat(state.headers).map((header) => `<option value="${escapeHtml(header)}" ${header === state.selectedSortColumn ? 'selected' : ''}>${escapeHtml(header || 'Tidak dipilih')}</option>`).join('');
  }

  function renderTemplatePresets() {
    elements.templateSelect.innerHTML = ['<option value="">Pilih preset</option>'].concat(state.presets.map((preset) => `<option value="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</option>`)).join('');
  }

  function renderPreviewTable() {
    const previewRows = state.currentRecipients.slice(0, 10);
    const columns = ['Nama', 'Nomor', 'Status', 'Preview'];
    if (!previewRows.length) {
      elements.preview.innerHTML = '<div style="padding:14px; color:#94a3b8; font-size:12px;">Belum ada data untuk ditampilkan.</div>';
      return;
    }

    const table = `
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="background:rgba(15,23,42,0.92); color:#cbd5e1; text-align:left;">
            ${columns.map((col) => `<th style="padding:10px; border-bottom:1px solid rgba(148,163,184,0.14);">${escapeHtml(col)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${previewRows.map((row) => `
            <tr style="border-bottom:1px solid rgba(148,163,184,0.08);">
              <td style="padding:10px;">${escapeHtml(row.displayName)}</td>
              <td style="padding:10px;">${escapeHtml(row.normalized || row.reason || row.raw || '')}</td>
              <td style="padding:10px; color:${row.valid ? '#34d399' : '#fca5a5'};">${row.valid ? 'Valid' : 'Invalid'}</td>
              <td style="padding:10px;">${escapeHtml(renderTemplate(elements.templateEditor.value || state.template, row.rowData))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    elements.preview.innerHTML = table;
  }

  function renderReportTable() {
    const filtered = state.report.filter((row) => state.reportFilter === 'all' ? true : row.status === state.reportFilter);
    const summary = summarizeReport(state.report);
    elements.reportSummary.innerHTML = `Total ${summary.total} | Berhasil ${summary.success} | Gagal ${summary.failed} | Pending ${summary.pending} | Success Rate ${summary.successRate}%`;

    if (!filtered.length) {
      elements.reportTable.innerHTML = '<div style="padding:14px; color:#94a3b8; font-size:12px;">Belum ada laporan.</div>';
      return;
    }

    elements.reportTable.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="background:rgba(15,23,42,0.92); color:#cbd5e1; text-align:left;">
            <th style="padding:10px;">Nama/Nomor</th>
            <th style="padding:10px;">Status</th>
            <th style="padding:10px;">Waktu</th>
            <th style="padding:10px;">Pesan Error</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((row) => `
            <tr style="border-bottom:1px solid rgba(148,163,184,0.08);">
              <td style="padding:10px;">${escapeHtml(row.name)}</td>
              <td style="padding:10px; color:${row.status === 'success' ? '#34d399' : row.status === 'failed' ? '#fca5a5' : '#facc15'}; font-weight:700;">${escapeHtml(row.status)}</td>
              <td style="padding:10px;">${escapeHtml(row.time)}</td>
              <td style="padding:10px;">${escapeHtml(row.error || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function syncSummary() {
    const validCount = state.currentRecipients.filter((item) => item.valid).length;
    const totalCount = state.currentRecipients.length;
    elements.summaryData.textContent = `${totalCount} baris`;
    elements.summaryValid.textContent = `${validCount} nomor valid`;
    elements.progressLabel.textContent = `${state.progress.processed}/${state.progress.total} terkirim`;
    elements.progressMeta.textContent = state.progress.failed ? `${state.progress.failed} gagal` : 'Belum mulai';

    const totalTargets = state.recipientsMode === 'group' ? state.groups.length : totalCount;
    elements.targetSummary.textContent = `${totalTargets} target aktif • ${validCount} nomor valid • ${state.progress.failed} gagal`;
  }

  function refreshData() {
    const baseRows = buildRows(state.headers, state.rawRows);
    const filtered = applyFilters(baseRows, state.filters, document.getElementById('wa-filter-mode').value || 'AND');
    const searched = searchRows(filtered, state.searchTerm);
    const sorted = sortRows(searched, state.selectedSortColumn, state.sortDirection);
    const deleted = deleteColumns(sorted, state.headers, state.deleteIndexes);
    const finalRows = deleted.rows;
    const mappedRows = finalRows.map((row) => applyMappings(row, state.mappings));

    state.currentRecipients = createRecipientOptions(state.rawRows, state.headers, state.phoneColumnIndex, state.mappings).filter((row) => {
      if (state.recipientsMode === 'number') {
        return true;
      }
      return false;
    });

    if (state.recipientsMode === 'number') {
      const numberRows = createRecipientOptions(state.rawRows, state.headers, state.phoneColumnIndex, state.mappings);
      state.currentRecipients = numberRows.filter((item) => item.valid).length ? numberRows : [];
    }

    state.progress.total = state.currentRecipients.length;

    renderPhoneColumn();
    renderSortColumn();
    renderDeleteColumns();
    renderFilters();
    renderMapping();
    renderPreviewTable();
    syncSummary();
    renderTemplatePreview();
  }

  function renderTemplatePreview() {
    const sample = state.currentRecipients[0] || { rowData: {} };
    const text = renderTemplate(elements.templateEditor.value || state.template, sample.rowData || {});
    elements.templateCount.textContent = String((elements.templateEditor.value || '').length);
    elements.templatePreview.textContent = text || '-';
  }

  function renderLogicFixTemplatePreview() {
    const selectedGroup = lfState.groups[0];
    if (!selectedGroup) {
      elements.lfTemplatePreview.textContent = 'Belum ada data Logic Fix untuk ditampilkan.';
      elements.lfTemplateVars.innerHTML = getLogicFixTemplateVariables().map((variable) => `<div>${escapeHtml(variable)}</div>`).join('');
      return;
    }

    const message = buildLogicFixMessage(
      {
        cpName: selectedGroup.cpName,
        groupName: selectedGroup.groupName,
        awbs: selectedGroup.awbs,
        statuses: selectedGroup.statuses
      },
      {
        mode: state.logicFixTemplateMode,
        template: state.logicFixTemplate
      }
    );

    elements.lfTemplatePreview.textContent = message || '-';
    elements.lfTemplateVars.innerHTML = getLogicFixTemplateVariables().map((variable) => `<div>${escapeHtml(variable)}</div>`).join('');
    elements.lfTemplateEditor.disabled = state.logicFixTemplateMode === 'auto';
    elements.lfTemplateEditor.placeholder = state.logicFixTemplateMode === 'auto'
      ? 'Auto mode menggunakan template bawaan. Pilih Manual untuk mengedit.'
      : 'Tulis template pesan manual untuk Logic Fix...';
  }

  function updateLogicFixTemplateSettings() {
    state.logicFixTemplateMode = elements.lfTemplateMode.value || 'auto';
    state.logicFixTemplate = elements.lfTemplateEditor.value || getDefaultLogicFixTemplate();
    saveSettings({
      ...state.options,
      template: state.template,
      logicFixDryRun: state.logicFixDryRun,
      logicFixTemplateMode: state.logicFixTemplateMode,
      logicFixTemplate: state.logicFixTemplate
    });
    renderLogicFixTemplatePreview();
  }

  function updateReportSummary() {
    renderReportTable();
  }

  function updateOptions() {
    state.options.delayMin = Number(elements.delayMin.value) || 8000;
    state.options.delayMax = Number(elements.delayMax.value) || 15000;
    state.options.mode = elements.sendMode.value || 'all';
    state.options.batchSize = Number(elements.batchSize.value) || 10;
    state.options.retry = Number(elements.retryMax.value) || 3;
    state.options.skipSent = elements.skipSent.checked;
    state.logicFixDryRun = elements.logicDryRun.checked;
    saveSettings({
      ...state.options,
      template: state.template,
      logicFixDryRun: state.logicFixDryRun,
      logicFixTemplateMode: state.logicFixTemplateMode,
      logicFixTemplate: state.logicFixTemplate
    });
  }

  function updateTemplate() {
    state.template = elements.templateEditor.value;
    state.lastSyncedTemplate = state.template;
    saveSettings({
      ...state.options,
      template: state.template,
      logicFixDryRun: state.logicFixDryRun
    });
    renderTemplatePreview();
  }

  function startQrCountdown() {
    clearInterval(state.qrTimer);
    state.qrCountdown = 60;
    elements.qrMeta.textContent = `Timer QR: ${state.qrCountdown} detik`;
    state.qrTimer = setInterval(() => {
      state.qrCountdown -= 1;
      elements.qrMeta.textContent = `Timer QR: ${state.qrCountdown} detik`;
      if (state.qrCountdown <= 0) {
        clearInterval(state.qrTimer);
        state.qrCountdown = 60;
        elements.qrMeta.textContent = 'QR timeout, klik Connect atau RUN untuk membuat QR baru.';
      }
    }, 1000);
  }

  function showQr(img) {
    elements.qrEmpty.style.display = 'none';
    elements.qrImage.src = img;
    elements.qrImage.style.display = 'block';
    state.qrImage = img;
    setStatus('Menunggu Scan', '#facc15');
    startQrCountdown();
  }

  function setConnected(info) {
    state.isConnected = true;
    state.connectedInfo = info;
    elements.account.textContent = `${info.name || 'Unknown'} • ${info.number || ''}`;
    elements.qrEmpty.textContent = 'Tersambung. Siap kirim pesan.';
    elements.qrEmpty.style.display = 'block';
    elements.qrImage.style.display = 'none';
    setStatus('Tersambung', '#34d399');
    clearInterval(state.qrTimer);
    elements.qrMeta.textContent = 'Status: akun WhatsApp terhubung.';
    addLog(`Tersambung ke ${info.name || info.number || 'akun WhatsApp'}`, 'success');
  }

  const lfState = {
    excelData: null,
    headers: [],
    groups: [],
    waConnected: false,
    running: false,
    qrTimer: null
  };

  function lfAddLog(message, level = 'info') {
    const time = new Date().toLocaleTimeString();
    const color = level === 'error' ? '#f87171' : level === 'success' ? '#4ade80' : level === 'warn' ? '#fbbf24' : '#94a3b8';
    const div = document.createElement('div');
    div.style.cssText = `color:${color};margin-bottom:2px;`;
    div.textContent = `[${time}] ${message}`;
    elements.lfLog.appendChild(div);
    elements.lfLog.scrollTop = elements.lfLog.scrollHeight;
  }

  function lfResetState() {
    elements.lfSummary.innerHTML = '';
    elements.lfPreviewTable.innerHTML = '';
    elements.lfGroupsList.innerHTML = '';
    elements.lfStatTotal.textContent = '0';
    elements.lfStatSent.textContent = '0';
    elements.lfStatFailed.textContent = '0';
    elements.lfStatPending.textContent = '0';
    elements.lfCurrentStatus.textContent = 'Siap dijalankan';
    elements.lfProgressBar.style.width = '0%';
    elements.lfLog.innerHTML = '';
    if (elements.lfTemplatePreview) {
      elements.lfTemplatePreview.textContent = 'Belum ada data Logic Fix untuk ditampilkan.';
    }
  }

  function lfShowQr(img) {
    clearInterval(lfState.qrTimer);
    elements.lfQrArea.style.display = 'none';
    elements.lfQrDisplay.style.display = 'block';
    elements.lfQrImg.src = img;
    elements.lfQrTimer.textContent = '⏱ Timeout: 60 detik';

    let countdown = 60;
    lfState.qrTimer = setInterval(() => {
      countdown -= 1;
      elements.lfQrTimer.textContent = `⏱ Timeout: ${countdown} detik`;
      if (countdown <= 0) {
        clearInterval(lfState.qrTimer);
      }
    }, 1000);
  }

  function lfShowDisconnected() {
    lfState.waConnected = false;
    clearInterval(lfState.qrTimer);
    elements.lfQrArea.style.display = 'block';
    elements.lfQrDisplay.style.display = 'none';
    elements.lfConnectBtn.disabled = false;
    elements.lfConnectBtn.textContent = '📱 Sambungkan WhatsApp';
    elements.lfWaConnectedInfo.style.display = 'none';
    elements.lfWaStatusBadge.textContent = 'Belum terhubung';
    elements.lfWaStatusBadge.style.background = '#7f1d1d';
    elements.lfWaStatusBadge.style.color = '#fca5a5';
    if (elements.lfCurrentStatus) {
      elements.lfCurrentStatus.textContent = 'Menunggu sambungan WhatsApp';
    }
  }

  function lfShowConnected(info) {
    lfState.waConnected = true;
    clearInterval(lfState.qrTimer);
    elements.lfQrArea.style.display = 'none';
    elements.lfQrDisplay.style.display = 'none';
    elements.lfWaConnectedInfo.style.display = 'block';
    elements.lfWaUserName.textContent = '✅ ' + (info.name || 'Terhubung');
    elements.lfWaUserNumber.textContent = '+' + (info.number || '');
    elements.lfWaStatusBadge.textContent = '✅ Terhubung';
    elements.lfWaStatusBadge.style.background = '#052e16';
    elements.lfWaStatusBadge.style.color = '#4ade80';
    elements.lfCurrentStatus.textContent = 'WhatsApp terhubung. Siap menjalankan.';
  }

  function lfRenderPreview() {
    const data = lfState.excelData?.data || [];
    const awbCol = parseInt(elements.lfColAwb.value, 10);
    const previewRows = data.slice(0, 10);
    const totalAwb = data.filter((row) => String(row[awbCol] || '').trim()).length;
    const totalGroups = lfState.groups.length;

    elements.lfSummary.innerHTML = [
      { label: 'Total AWB', value: totalAwb, color: '#3b82f6' },
      { label: 'Total CP/Grup', value: totalGroups, color: '#8b5cf6' },
      { label: 'Rata-rata AWB/Grup', value: totalGroups > 0 ? Math.round(totalAwb / totalGroups) : 0, color: '#10b981' }
    ].map((item) => `
      <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:20px;font-weight:700;color:${item.color};">${item.value}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${item.label}</div>
      </div>`).join('');

    elements.lfPreviewTable.innerHTML = `
      <thead>
        <tr>
          ${lfState.headers.map((header) => `<th style="padding:6px 10px;background:#1e3a5f;color:#93c5fd;font-size:11px;text-align:left;white-space:nowrap;">${escapeHtml(header)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${previewRows.map((row, index) => `
          <tr style="background:${index % 2 === 0 ? '#0f172a' : '#111827'};">
            ${lfState.headers.map((_, colIndex) => `<td style="padding:5px 10px;color:#94a3b8;font-size:11px;border-bottom:1px solid #1e293b;white-space:nowrap;">${escapeHtml(row[colIndex] || '')}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>`;

    elements.lfGroupsList.innerHTML = lfState.groups.length
      ? lfState.groups.map((group) => `<span style="padding:4px 10px;background:#1e3a5f;color:#60a5fa;border-radius:20px;font-size:11px;">${escapeHtml(group.groupName)} (${group.awbs.length} AWB)</span>`).join('')
      : '<span style="font-size:12px;color:#64748b;">Belum ada grup</span>';

    elements.lfStatTotal.textContent = String(totalGroups);
    elements.lfStatPending.textContent = String(totalGroups);
    elements.lfStatSent.textContent = '0';
    elements.lfStatFailed.textContent = '0';
  }

  function lfProcessData() {
    const resolvedColumns = resolveExcelColumns(lfState.headers || []);
    const awbCol = parseInt(elements.lfColAwb.value, 10);
    const cpCol = parseInt(elements.lfColCp.value, 10);
    const statusCol = elements.lfColStatus.value;
    const resolvedAwbCol = Number.isNaN(awbCol) ? resolvedColumns.awbIndex : awbCol;
    const resolvedCpCol = Number.isNaN(cpCol) ? resolvedColumns.cpIndex : cpCol;
    const resolvedStatusCol = statusCol === '' ? resolvedColumns.statusIndex : parseInt(statusCol, 10);
    const sourceOrderCol = resolvedColumns.sourceOrderIndex;

    if (resolvedAwbCol === null || resolvedCpCol === null) {
      return;
    }

    const data = lfState.excelData?.data || [];
    const grouped = {};

    data.forEach((row) => {
      if (!shouldIncludeSourceOrder(row, sourceOrderCol)) {
        return;
      }

      const awb = String(row[resolvedAwbCol] || '').trim();
      const cp = String(row[resolvedCpCol] || '').trim();
      if (!awb || !cp) {
        return;
      }

      const normalizedCp = cp.trim();
      const groupName = resolveGroupName(normalizedCp);
      if (!groupName) {
        return;
      }

      if (!grouped[groupName]) {
        grouped[groupName] = { cpName: normalizedCp, groupName, awbs: [], statuses: {} };
      }

      grouped[groupName].awbs.push(awb);
      if (resolvedStatusCol !== null && resolvedStatusCol !== undefined) {
        const status = String(row[resolvedStatusCol] || '').trim();
        if (status) {
          grouped[groupName].statuses[status] = (grouped[groupName].statuses[status] || 0) + 1;
        }
      }
    });

    lfState.groups = Object.values(grouped);
    lfRenderPreview();
    renderLogicFixTemplatePreview();
    elements.lfStep2.style.display = 'block';
    elements.lfStep3.style.display = 'block';
    elements.lfStep4.style.display = 'block';
    elements.lfCurrentStatus.textContent = 'Data siap diverifikasi';
  }

  async function lfHandleExcelFile(file) {
    if (!file) {
      return;
    }

    const filePath = file.path || file.name;
    elements.lfExcelPath.value = filePath;
    elements.lfExcelStatus.textContent = 'Memuat...';
    lfResetState();

    const result = await window.electronAPI.invoke('wa-parse-excel', filePath);
    if (!result.ok) {
      elements.lfExcelStatus.textContent = `❌ Gagal: ${result.message}`;
      lfAddLog(result.message || 'Gagal memproses Excel', 'error');
      return;
    }

    lfState.excelData = result;
    lfState.headers = result.headers || [];
    elements.lfColumnConfig.style.display = 'block';

    const resolvedColumns = resolveExcelColumns(lfState.headers);

    ['lf-col-awb', 'lf-col-cp', 'lf-col-status'].forEach((id) => {
      const select = mountEl.querySelector(`#${id}`);
      const currentValue = select.value;
      select.innerHTML = id === 'lf-col-status'
        ? '<option value="">-- Tidak Ada --</option>'
        : '<option value="">-- Pilih Kolom --</option>';

      (lfState.headers || []).forEach((header, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Kolom ${String.fromCharCode(65 + index)}: ${header}`;
        select.appendChild(option);
      });

      const resolvedValue = id === 'lf-col-awb'
        ? resolvedColumns.awbIndex
        : id === 'lf-col-cp'
          ? resolvedColumns.cpIndex
          : resolvedColumns.statusIndex;

      const nextValue = resolvedValue === null || resolvedValue === undefined ? '' : String(resolvedValue);
      select.value = nextValue || currentValue || '';
    });

    elements.lfExcelStatus.textContent = `✅ ${result.totalRows} baris ditemukan`;
    lfAddLog(`Excel siap: ${result.totalRows} baris`, 'success');
    lfProcessData();
  }

  async function lfConnectWhatsApp() {
    if (lfState.running) {
      return;
    }

    elements.lfConnectBtn.disabled = true;
    elements.lfConnectBtn.textContent = '⏳ Menghubungkan...';
    elements.lfQrArea.style.display = 'none';
    elements.lfQrDisplay.style.display = 'block';
    elements.lfQrImg.src = '';
    elements.lfQrTimer.textContent = '⏱ Timeout: 60 detik';

    try {
      const result = await window.electronAPI.invoke('wa-connect');
      if (!result.ok) {
        lfShowDisconnected();
        lfAddLog(result.message || 'Gagal menghubungkan WhatsApp', 'error');
      }
    } catch (error) {
      lfShowDisconnected();
      lfAddLog(error.message || 'Gagal menghubungkan WhatsApp', 'error');
    }
  }

  async function lfDisconnect() {
    try {
      await window.electronAPI.invoke('wa-disconnect');
    } catch (error) {
      lfAddLog(error.message || 'Gagal memutuskan WhatsApp', 'error');
    }
    lfShowDisconnected();
  }

  async function lfRun() {
    if (!lfState.excelData) {
      lfAddLog('Upload Excel terlebih dahulu sebelum menjalankan.', 'warn');
      elements.lfCurrentStatus.textContent = 'Upload Excel terlebih dahulu';
      return;
    }

    if (!lfState.waConnected) {
      lfAddLog('WhatsApp belum terhubung. Scan QR dulu di Step 3.', 'warn');
      elements.lfCurrentStatus.textContent = 'WhatsApp belum terhubung';
      return;
    }

    if (!lfState.groups.length) {
      lfAddLog('Tidak ada grup untuk dikirim. Periksa konfigurasi kolom.', 'warn');
      elements.lfCurrentStatus.textContent = 'Tidak ada grup untuk dikirim';
      return;
    }

    lfState.running = true;
    elements.lfCurrentStatus.textContent = 'Menjalankan pengiriman...';
    elements.lfLog.innerHTML = '';
    lfAddLog(lfState.running ? '🚀 Mulai kirim...' : '');

    const isDryRun = elements.lfDryRun.checked;
    let sent = 0;
    let failed = 0;

    for (let index = 0; index < lfState.groups.length; index += 1) {
      if (!lfState.running) {
        break;
      }

      const group = lfState.groups[index];
      const message = buildLogicFixMessage(
        {
          cpName: group.cpName,
          groupName: group.groupName,
          awbs: group.awbs,
          statuses: group.statuses
        },
        {
          mode: state.logicFixTemplateMode,
          template: state.logicFixTemplate
        }
      );

      elements.lfCurrentStatus.textContent = `Mengirim ke: ${group.groupName} (${index + 1}/${lfState.groups.length})...`;
      elements.lfProgressBar.style.width = `${Math.round((index / Math.max(lfState.groups.length, 1)) * 100)}%`;
      lfAddLog(`→ ${group.groupName} (${group.awbs.length} AWB)`, 'info');

      lfAddLog(`[LOGIC FIX] ${group.cpName} → target grup: '${group.groupName}'`, 'info');

      if (!isDryRun) {
        const result = await window.electronAPI.invoke('wa-send-logic-fix', {
          groupName: group.groupName,
          cpName: group.cpName,
          awbs: group.awbs,
          statuses: group.statuses,
          message
        });

        if (result.ok) {
          sent += 1;
          lfAddLog(`[LOGIC FIX] Mengirim ke '${group.groupName}' (ID: ${result.groupId || 'N/A'}) — ${group.awbs.length} AWB`, 'success');
        } else {
          failed += 1;
          lfAddLog(`[LOGIC FIX] WARNING: Grup '${group.groupName}' tidak ditemukan di WA. Skip. ${result.message || ''}`.trim(), 'warn');
        }
      } else {
        sent += 1;
        lfAddLog(`[DRY RUN] Simulasi kirim ke ${group.groupName}`, 'info');
      }

      elements.lfStatSent.textContent = String(sent);
      elements.lfStatFailed.textContent = String(failed);
      elements.lfStatPending.textContent = String(Math.max(lfState.groups.length - sent - failed, 0));

      if (!isDryRun && index < lfState.groups.length - 1) {
        const delay = 8000 + Math.floor(Math.random() * 7000);
        lfAddLog(`⏱ Jeda ${(delay / 1000).toFixed(1)}s...`, 'info');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    lfState.running = false;
    elements.lfProgressBar.style.width = '100%';
    elements.lfCurrentStatus.textContent = `Selesai! ${sent} berhasil, ${failed} gagal.`;
    lfAddLog(`🎉 SELESAI — ${sent} berhasil, ${failed} gagal dari ${lfState.groups.length} grup`, 'success');
  }

  function lfPause() {
    lfState.running = false;
    elements.lfCurrentStatus.textContent = 'Dijeda...';
    lfAddLog('Pengiriman logic fix dijeda', 'warn');
  }

  function lfStop() {
    lfState.running = false;
    elements.lfCurrentStatus.textContent = 'Dihentikan.';
    lfAddLog('Pengiriman logic fix dihentikan', 'warn');
  }

  function bindEvents() {
    mountEl.querySelector('#wa-browse').addEventListener('click', async () => {
      const result = await window.electronAPI.invoke('browse-file', [{ name: 'Excel/CSV', extensions: ['xlsx', 'xls', 'csv'] }]);
      if (!result || result.canceled) return;
      const filePath = result.filePath;
      const parsed = await window.electronAPI.invoke('wa-parse-excel', filePath);
      if (!parsed.ok) {
        addLog(parsed.message || 'Gagal membaca file', 'error');
        return;
      }

      state.headers = parsed.headers || [];
      state.rawRows = parsed.data || [];
      state.totalRows = parsed.totalRows || 0;
      state.workbookName = parsed.sheetName || filePath.split(/[\\/]/).pop();
      state.phoneColumnIndex = detectPhoneColumn(state.headers, state.rawRows);
      elements.fileMeta.textContent = `${state.totalRows} baris • Kolom: ${state.headers.length}`;
      refreshData();
      addLog(`File diparsing: ${state.workbookName}`, 'success');
    });

    mountEl.querySelector('#wa-refresh-data').addEventListener('click', () => refreshData());
    mountEl.querySelector('#wa-add-filter').addEventListener('click', () => {
      state.filters.push({ column: state.headers[0] || '', operator: 'eq', value: '' });
      refreshData();
    });
    mountEl.querySelector('#wa-connect').addEventListener('click', async () => {
      const result = await window.electronAPI.invoke('wa-connect');
      if (result.ok) {
        state.pendingRun = false;
        addLog('Permintaan koneksi WhatsApp dikirim', 'info');
      } else {
        addLog(result.message || 'Gagal menghubungkan', 'error');
      }
    });

    mountEl.querySelector('#wa-disconnect').addEventListener('click', async () => {
      const result = await window.electronAPI.invoke('wa-disconnect');
      if (result.ok) {
        state.isConnected = false;
        state.connectedInfo = null;
        setStatus('Menunggu Scan', '#38bdf8');
        elements.account.textContent = 'Akun belum terhubung';
        elements.qrEmpty.style.display = 'block';
        elements.qrImage.style.display = 'none';
        addLog('WhatsApp terputus', 'info');
      } else {
        addLog(result.message || 'Gagal memutuskan koneksi', 'error');
      }
    });

    mountEl.querySelector('#wa-clear').addEventListener('click', () => {
      state.logs = [];
      state.report = [];
      renderReportTable();
      renderLog();
      addLog('Panel dibersihkan', 'info');
    });

    mountEl.querySelectorAll('.wa-mode-btn').forEach((button) => {
      button.addEventListener('click', () => {
        state.recipientsMode = button.getAttribute('data-mode');
        mountEl.querySelector('#wa-target-number-panel').style.display = state.recipientsMode === 'number' ? 'block' : 'none';
        mountEl.querySelector('#wa-target-group-panel').style.display = state.recipientsMode === 'group' ? 'block' : 'none';
        refreshData();
      });
    });

    mountEl.querySelector('#wa-import-excel-targets').addEventListener('click', () => {
      if (!state.headers.length) {
        addLog('Import file Excel terlebih dahulu', 'warn');
        return;
      }
      const targetValues = createRecipientOptions(state.rawRows, state.headers, state.phoneColumnIndex, state.mappings)
        .map((row) => row.normalized || row.raw?.[state.headers[state.phoneColumnIndex]] || '')
        .filter(Boolean);
      elements.bulkNumbers.value = targetValues.join('\n');
      addLog('Nomor dari kolom Excel diimpor', 'success');
    });

    mountEl.querySelector('#wa-validate-targets').addEventListener('click', () => {
      const results = validateRecipients(elements.bulkNumbers.value);
      const valid = results.filter((item) => item.valid).length;
      const invalid = results.length - valid;
      elements.targetSummary.textContent = `${results.length} nomor terinput • ${valid} valid • ${invalid} invalid`;
      addLog(`Validasi selesai: ${valid} valid, ${invalid} invalid`, 'info');
    });

    mountEl.querySelector('#wa-scan-groups').addEventListener('click', async () => {
      if (!state.isConnected) {
        addLog('Hubungkan WhatsApp terlebih dahulu', 'warn');
        return;
      }
      const result = await window.electronAPI.invoke('wa-get-groups');
      if (!result.ok) {
        addLog(result.message || 'Gagal mengambil grup', 'error');
        return;
      }
      state.groups = result.groups || [];
      elements.groupDropdown.innerHTML = state.groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)} (${group.memberCount} anggota)</option>`).join('');
      elements.groupInfo.textContent = `${state.groups.length} grup ditemukan.`;
      addLog(`Ditemukan ${state.groups.length} grup`, 'success');
    });

    mountEl.querySelector('#wa-insert-variable').addEventListener('click', () => {
      const variables = ['{{nama}}', '{{nomor}}', '{{resi}}', '{{tanggal}}', '{{status}}', '{{keterangan}}'];
      const inserted = variables.join(', ');
      elements.templateEditor.value = `${elements.templateEditor.value}${elements.templateEditor.value.trim() ? '\n' : ''}${inserted}`;
      updateTemplate();
    });

    mountEl.querySelector('#wa-save-template').addEventListener('click', () => {
      const name = prompt('Nama preset template');
      if (!name) return;
      const presets = loadTemplatePresets();
      presets.push({ name, template: elements.templateEditor.value });
      saveTemplatePresets(presets);
      state.presets = presets;
      renderTemplatePresets();
      addLog(`Preset ${name} disimpan`, 'success');
    });

    elements.templateSelect.addEventListener('change', (event) => {
      const selected = state.presets.find((preset) => preset.name === event.target.value);
      if (selected) {
        elements.templateEditor.value = selected.template;
        updateTemplate();
      }
    });

    elements.templateEditor.addEventListener('input', updateTemplate);
    elements.lfTemplateMode.addEventListener('change', updateLogicFixTemplateSettings);
    elements.lfTemplateReset.addEventListener('click', () => {
      elements.lfTemplateEditor.value = getDefaultLogicFixTemplate();
      updateLogicFixTemplateSettings();
    });
    elements.lfTemplateEditor.addEventListener('input', updateLogicFixTemplateSettings);
    mountEl.querySelectorAll('[data-lf-template-var]').forEach((button) => {
      button.addEventListener('click', () => {
        const token = button.getAttribute('data-lf-template-var');
        const editor = elements.lfTemplateEditor;
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? editor.value.length;
        editor.setRangeText(token, start, end, 'end');
        editor.focus();
        updateLogicFixTemplateSettings();
      });
    });
    elements.search.addEventListener('input', (event) => {
      state.searchTerm = event.target.value;
      refreshData();
    });

    elements.sortColumn.addEventListener('change', (event) => {
      state.selectedSortColumn = event.target.value;
      refreshData();
    });

    elements.sortDirection.addEventListener('change', (event) => {
      state.sortDirection = event.target.value;
      refreshData();
    });

    elements.phoneColumn.addEventListener('change', (event) => {
      state.phoneColumnIndex = Number(event.target.value);
      refreshData();
    });

    elements.reportFilter.addEventListener('change', (event) => {
      state.reportFilter = event.target.value;
      renderReportTable();
    });

    mountEl.querySelector('#wa-run').addEventListener('click', async () => {
      updateOptions();
      if (state.options.mode === 'auto-send-by-logic-fix') {
        await runLogicFix();
        return;
      }

      if (!state.isConnected) {
        state.pendingRun = true;
        await window.electronAPI.invoke('wa-connect');
        addLog('Menginisialisasi QR login...', 'info');
        return;
      }

      const recipients = [];
      if (state.recipientsMode === 'number') {
        const validated = validateRecipients(elements.bulkNumbers.value || '');
        const mapped = createRecipientOptions(state.rawRows, state.headers, state.phoneColumnIndex, state.mappings);
        validated.forEach((item, index) => {
          const matched = mapped.find((row) => row.normalized === item.normalized) || {
            displayName: item.raw,
            normalized: item.normalized,
            rowData: {}
          };
          recipients.push({
            id: item.normalized,
            displayName: matched.displayName || item.raw,
            type: 'number',
            normalized: item.normalized,
            rowData: matched.rowData || {},
            valid: item.valid
          });
        });
      } else {
        const groupId = elements.groupDropdown.value;
        if (!groupId) {
          addLog('Pilih grup terlebih dahulu', 'warn');
          return;
        }
        recipients.push({ id: groupId, displayName: elements.groupDropdown.options[elements.groupDropdown.selectedIndex]?.text || groupId, type: 'group', rowData: {} });
      }

      const filteredRecipients = recipients.filter((item) => item.valid !== false);
      state.progress = { total: filteredRecipients.length, processed: 0, failed: 0 };
      state.report = buildReportRows(filteredRecipients, 'pending');
      renderReportTable();
      renderTemplatePreview();
      syncSummary();
      setStatus('Siap Kirim', '#34d399');
      addLog(`Memulai pengiriman ke ${filteredRecipients.length} penerima`, 'info');

      const result = await window.electronAPI.invoke('wa-run', {
        recipients: filteredRecipients,
        template: elements.templateEditor.value || state.template,
        options: state.options
      });

      if (!result.ok) {
        addLog(result.message || 'Gagal menjalankan kirim', 'error');
      }
    });

    elements.logicRefresh.addEventListener('click', () => {
      renderLogicFixPreview();
    });

    elements.logicRun.addEventListener('click', () => {
      runLogicFix();
    });

    elements.logicDryRun.addEventListener('change', () => {
      state.logicFixDryRun = elements.logicDryRun.checked;
      updateOptions();
    });

    mountEl.querySelector('#wa-pause').addEventListener('click', async () => {
      await window.electronAPI.invoke('wa-pause');
      addLog('Pengiriman dijeda', 'info');
      setStatus('Pause', '#facc15');
    });

    mountEl.querySelector('#wa-resume').addEventListener('click', async () => {
      await window.electronAPI.invoke('wa-resume');
      addLog('Pengiriman dilanjutkan', 'info');
      setStatus('Siap Kirim', '#34d399');
    });

    mountEl.querySelector('#wa-stop').addEventListener('click', async () => {
      await window.electronAPI.invoke('wa-stop');
      addLog('Pengiriman dihentikan', 'warn');
      setStatus('Dihentikan', '#fca5a5');
    });

    mountEl.querySelector('#wa-export-xlsx').addEventListener('click', async () => {
      const result = await window.electronAPI.invoke('wa-export-report', {
        data: state.report,
        filename: 'wa-report.xlsx'
      });
      if (result.ok) {
        addLog(`Export Excel berhasil: ${result.filePath}`, 'success');
      } else {
        addLog(result.message || 'Export Excel gagal', 'error');
      }
    });

    mountEl.querySelector('#wa-export-csv').addEventListener('click', () => {
      const blob = new Blob([exportCsv(state.report)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'wa-report.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      addLog('Export CSV berhasil', 'success');
    });

    mountEl.querySelector('#wa-filter-mode').addEventListener('change', () => refreshData());
    mountEl.querySelector('#wa-delay-min').addEventListener('change', updateOptions);
    mountEl.querySelector('#wa-delay-max').addEventListener('change', updateOptions);
    mountEl.querySelector('#wa-send-mode').addEventListener('change', updateOptions);
    mountEl.querySelector('#wa-batch-size').addEventListener('change', updateOptions);
    mountEl.querySelector('#wa-retry-max').addEventListener('change', updateOptions);
    mountEl.querySelector('#wa-skip-sent').addEventListener('change', updateOptions);

    elements.lfBrowseBtn.addEventListener('click', () => elements.lfExcelFileInput.click());
    elements.lfExcelPath.addEventListener('click', () => elements.lfExcelFileInput.click());
    elements.lfExcelFileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      await lfHandleExcelFile(file);
    });
    elements.lfColAwb.addEventListener('change', lfProcessData);
    elements.lfColCp.addEventListener('change', lfProcessData);
    elements.lfColStatus.addEventListener('change', lfProcessData);
    elements.lfConnectBtn.addEventListener('click', lfConnectWhatsApp);
    elements.lfDisconnectBtn.addEventListener('click', lfDisconnect);
    elements.lfRunBtn.addEventListener('click', lfRun);
    elements.lfPauseBtn.addEventListener('click', lfPause);
    elements.lfStopBtn.addEventListener('click', lfStop);

    window.electronAPI.onWaQr((img) => {
      showQr(img);
      lfShowQr(img);
    });

    window.electronAPI.onWaConnected((info) => {
      setConnected(info);
      lfShowConnected(info);
      if (state.pendingRun) {
        state.pendingRun = false;
        mountEl.querySelector('#wa-run').click();
      }
    });

    window.electronAPI.onWaDisconnected(() => {
      state.isConnected = false;
      setStatus('Menunggu Scan', '#38bdf8');
      elements.account.textContent = 'Akun belum terhubung';
      lfShowDisconnected();
      addLog('Koneksi WhatsApp terputus', 'warn');
    });

    window.electronAPI.onWaProgress((payload) => {
      if (payload.type === 'current') {
        elements.progressMeta.textContent = `Mengirim ke ${payload.name || payload.id}`;
      }
      if (payload.type === 'success') {
        state.progress.processed = payload.processed || state.progress.processed + 1;
        state.report = state.report.map((row) => row.id === payload.id ? { ...row, status: 'success', time: new Date().toISOString(), error: '' } : row);
        syncSummary();
        addLog(`Berhasil mengirim ke ${payload.id}`, 'success');
      }
      if (payload.type === 'failed') {
        state.progress.failed = payload.failed || state.progress.failed + 1;
        state.report = state.report.map((row) => row.id === payload.id ? { ...row, status: 'failed', error: payload.error || 'Error tidak diketahui', time: new Date().toISOString() } : row);
        syncSummary();
        addLog(`Gagal mengirim ke ${payload.id}: ${payload.error || 'Error tidak diketahui'}`, 'error');
      }
      if (payload.type === 'delay') {
        elements.progressMeta.textContent = `Menunggu ${payload.ms} ms sebelum pesan berikutnya`; 
      }
      if (payload.type === 'done') {
        state.progress.processed = payload.processed || state.progress.processed;
        state.progress.failed = payload.failed || state.progress.failed;
        syncSummary();
        setStatus('Selesai', '#34d399');
        addLog(`Selesai pengiriman: ${payload.processed} berhasil, ${payload.failed} gagal`, 'success');
      }
      elements.progressLabel.textContent = `${state.progress.processed}/${state.progress.total} terkirim`;
      renderReportTable();
    });

    renderLog();
    renderTemplatePresets();
    refreshData();
    renderLogicFixPreview();
    renderReportTable();
    updateReportSummary();
  }

  bindEvents();

  return {
    state,
    destroy() {
      clearInterval(state.qrTimer);
    }
  };
}

module.exports = {
  initWhatsAppBot
};
