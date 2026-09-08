'use strict';

const { ipcRenderer } = require('electron');

let _frProfiles  = [];
let _frActiveIdx = -1;

const RETUR_STEPS = [
  { key:'firstTap',    label:'Step 1: First Tap',        type:'tap' },
  { key:'pilihSemua1', label:'Step 2: Pilih Semua (1)',  type:'tap' },
  { key:'ttdRetur1',   label:'Step 3: TTD Retur (1)',    type:'tap' },
  { key:'pilihSemua2', label:'Step 4: Pilih Semua (2)', type:'tap' },
  { key:'ttdRetur2',   label:'Step 5: TTD Retur (2)',    type:'tap' },
  { key:'ttdPengirim', label:'Step 6: TTD Pengirim',     type:'tap' },
  { key:'ttdSign1',    label:'Step 7: Tanda Tangan 1',   type:'signature' },
  { key:'submitBtn1',  label:'Step 8: Submit (1)',        type:'tap' },
  { key:'ttdSprinter', label:'Step 9: TTD Sprinter',     type:'tap' },
  { key:'ttdSign2',    label:'Step 10: Tanda Tangan 2',  type:'signature' },
  { key:'submitBtn2',  label:'Step 11: Submit (2)',       type:'tap' },
  { key:'ikonKamera',  label:'Step 12: Icon Kamera',     type:'tap' },
  { key:'konfirmasi',  label:'Step 13: Konfirmasi',       type:'tap' },
  { key:'tetapUpload', label:'Step 14: Tetap Upload',    type:'tap' },
  { key:'ttdRetur3',   label:'Step 15: TTD Retur (3)',   type:'tap' },
  { key:'twoTap',      label:'Step 16: Two Tap',         type:'tap' },
];

async function initFlowRetur() {
  const res = await ipcRenderer.invoke('fr:load-profiles');
  _frProfiles = res.profiles || [];
  _renderProfileSelect();
  _syncActiveDevice();
  _bindEvents();

  // Auto-detect device aktif dari selector global

  // Sync device setiap kali list device berubah
  ipcRenderer.removeAllListeners('device-list');
  ipcRenderer.on('device-list', () => {
    _syncActiveDevice();
  });

  // IPC listeners untuk log realtime
  ipcRenderer.removeAllListeners('fr:log');
  ipcRenderer.removeAllListeners('fr:step-start');
  ipcRenderer.removeAllListeners('fr:step-done');

  ipcRenderer.on('fr:log', (e, { level, msg }) => _frLog(level, msg));
  ipcRenderer.on('fr:step-start', (e, { label }) => _frLog('info', `▶ ${label}`));
  ipcRenderer.on('fr:step-done',  (e, { key, ok }) => {
    _frLog(ok ? 'success' : 'warn', `${ok ? '✅' : '⚠️'} ${key} selesai`);
  });
}

function _renderProfileSelect() {
  const sel = document.getElementById('fr-profile-select');
  if (!sel) return;

  sel.innerHTML = '<option value="">-- Pilih atau Buat Profile Device --</option>';
  _frProfiles.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${p.profileName} (${p.deviceId || 'no device'})`;
    sel.appendChild(o);
  });
  if (_frActiveIdx >= 0 && _frActiveIdx < _frProfiles.length) {
    sel.value = _frActiveIdx;
  }

  // Tampilkan panduan jika belum ada profile
  _renderEmptyState();
  _updateRunBtn();
}

function _renderEmptyState() {
  const grid  = document.getElementById('fr-steps-grid');
  const badge = document.getElementById('fr-steps-status');
  if (!grid) return;

  if (_frProfiles.length === 0) {
    // Belum ada profile sama sekali — tampilkan panduan mulai
    grid.innerHTML = `
      <div class="fr-empty-state" style="grid-column:1/-1;">
        <div class="fr-empty-icon">📱</div>
        <div class="fr-empty-title">Belum ada profile device</div>
        <div class="fr-empty-desc">
          Buat profile untuk menyimpan konfigurasi steps per device HP.
          <br>Setiap HP bisa punya profile berbeda.
        </div>
        <button
          id="fr-empty-add-btn"
          style="
            padding:10px 24px;
            background:#4f8ef7;border:none;border-radius:8px;
            color:#fff;font-size:14px;font-weight:600;
            cursor:pointer;margin-bottom:28px;
            transition:transform 0.15s ease,box-shadow 0.15s ease;
          "
          onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(79,142,247,0.4)'"
          onmouseleave="this.style.transform='';this.style.boxShadow=''"
        >
          + Buat Profile Pertama
        </button>
        <div class="fr-empty-steps-hint">
          <div class="fr-hint-step">
            <span class="fr-hint-num">1</span>
            <span>Klik <b>+ Buat Profile Pertama</b> → isi nama & Device ID otomatis terisi</span>
          </div>
          <div class="fr-hint-step">
            <span class="fr-hint-num">2</span>
            <span>Klik <b>+ Set</b> pada setiap step → ambil screenshot HP → drag area target</span>
          </div>
          <div class="fr-hint-step">
            <span class="fr-hint-num">3</span>
            <span>Klik <b>▶ Jalankan</b> — engine otomatis tap sesuai gambar yang ditemukan</span>
          </div>
        </div>
      </div>`;
    if (badge) {
      badge.textContent = 'Buat profile dulu';
      badge.className   = 'fr-badge fr-badge-warn';
    }

    // Bind tombol empty state setelah HTML dirender ke DOM
    setTimeout(() => {
      const emptyBtn = document.getElementById('fr-empty-add-btn');
      if (emptyBtn) {
        emptyBtn.onclick = null;
        emptyBtn.addEventListener('click', async () => {
          await _addProfile();
        });
      }
    }, 0);

    return;
  }

  if (_frActiveIdx < 0) {
    // Ada profile tapi belum dipilih
    grid.innerHTML = `
      <div class="fr-empty-state" style="grid-column:1/-1;">
        <div class="fr-empty-icon">👆</div>
        <div class="fr-empty-title">Pilih profile device</div>
        <div class="fr-empty-desc">
          Kamu punya <b>${_frProfiles.length} profile</b>.
          Pilih salah satu dari dropdown di atas untuk mulai konfigurasi steps.
        </div>
      </div>`;
    if (badge) {
      badge.textContent = 'Pilih profile dulu';
      badge.className   = 'fr-badge fr-badge-warn';
    }
    return;
  }

  // Ada profile dan sudah dipilih — render steps grid normal
  _renderStepsGrid();
}

function _syncActiveDevice() {
  const selector = document.getElementById('device-selector');
  const activeDevice = selector?.value && selector.value !== 'No ADB Device'
    ? selector.value : null;
  const deviceInfo = document.getElementById('fr-device-info');
  if (deviceInfo) {
    if (activeDevice) {
      deviceInfo.innerHTML = `
        <span class="fr-device-badge fr-device-connected">
          ✅ ${activeDevice}
        </span>`;
    } else {
      deviceInfo.innerHTML = `
        <span class="fr-device-badge fr-device-disconnected">
          ⚠️ Tidak ada device — hubungkan HP via USB
        </span>`;
    }
  }
  if (activeDevice && _frActiveIdx >= 0) {
    const profile = _frProfiles[_frActiveIdx];
    if (profile && !profile.deviceId) {
      profile.deviceId = activeDevice;
      _renderProfileSelect();
    }
  }
  return activeDevice;
}

function _renderStepsGrid() {
  const grid    = document.getElementById('fr-steps-grid');
  const badge   = document.getElementById('fr-steps-status');
  if (!grid) return;

  const profile = _frProfiles[_frActiveIdx] || null;

  if (!profile) {
    grid.innerHTML = `<div style="color:var(--text-muted,#888);font-size:13px;
      grid-column:1/-1;text-align:center;padding:20px;">
      Pilih atau buat profile device untuk mengkonfigurasi steps</div>`;
    if (badge) { badge.textContent='Pilih profile dulu'; badge.className='fr-badge fr-badge-warn'; }
    return;
  }

  let readyCount = 0;
  grid.innerHTML = RETUR_STEPS.map((step, i) => {
    const cfg     = profile.steps?.[step.key];
    const hasImg  = !!cfg?.image;
    const hasTxt  = !!cfg?.text;
    const hasCrd  = cfg?.x != null;
    const ready   = hasImg || hasTxt || hasCrd;
    if (ready) readyCount++;
    const icon    = step.type === 'signature' ? '✍' : '👆';
    const badgeTxt = ready
      ? (hasImg ? '🖼 Gambar' : hasTxt ? '📝 Teks' : '📍 Koordinat')
      : 'Belum diset';
    const badgeCls = ready ? 'fr-badge-ok' : 'fr-badge-warn';
    return `
      <div class="fr-step-card ${ready ? 'fr-step-ready' : ''}"
           style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                  background:var(--bg-tertiary,#0f0f1a);
                  border:1px solid ${ready ? '#4caf50' : 'var(--border-color,#333)'};
                  border-radius:6px;">
        <span style="font-size:18px;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:500;color:var(--text-primary,#ddd);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${step.label}
          </div>
          <span class="fr-badge ${badgeCls}" style="font-size:10px;">${badgeTxt}</span>
        </div>
        <button onclick="window.frOpenStepPicker('${step.key}')"
                style="padding:4px 8px;font-size:11px;background:var(--bg-secondary,#1a1a2e);
                       border:1px solid var(--border-color,#444);color:var(--text-primary,#eee);
                       border-radius:4px;cursor:pointer;white-space:nowrap;">
          ${ready ? '✏ Edit' : '+ Set'}
        </button>
      </div>`;
  }).join('');

  if (badge) {
    const all = readyCount === RETUR_STEPS.length;
    badge.textContent = all ? `✓ Siap (${readyCount}/16)` : `${readyCount}/16 dikonfigurasi`;
    badge.className   = 'fr-badge ' + (all ? 'fr-badge-ok' : 'fr-badge-warn');
  }
  _updateRunBtn();
}

function _bindEvents() {
  document.getElementById('fr-profile-select')?.addEventListener('change', e => {
    _frActiveIdx = e.target.value === '' ? -1 : parseInt(e.target.value);
    _renderStepsGrid();
    _updateRunBtn();
  });

  document.getElementById('fr-btn-add-profile')?.addEventListener('click', () => _addProfile());
  document.getElementById('fr-btn-edit-profile')?.addEventListener('click', _editProfile);
  document.getElementById('fr-btn-delete-profile')?.addEventListener('click', _deleteProfile);

  document.getElementById('fr-btn-run')?.addEventListener('click', _runFlow);
  document.getElementById('fr-btn-stop')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('fr:stop');
  });
  document.getElementById('fr-btn-clear-log')?.addEventListener('click', () => {
    const l = document.getElementById('fr-log'); if (l) l.innerHTML = '';
  });
}

async function frOpenStepPicker(stepKey) {
  if (_frActiveIdx < 0) return alert('Pilih profile dulu');
  const profile  = _frProfiles[_frActiveIdx];
  const selector   = document.getElementById('device-selector');
  const autoDevice = selector?.value && selector.value !== 'No ADB Device'
    ? selector.value : '';
  const deviceId   = profile.deviceId || autoDevice;
  if (!deviceId) return alert('Tidak ada device ADB aktif. Hubungkan HP via USB.');

  // Ambil screenshot HP via ADB
  _frLog('info', `Mengambil screenshot untuk setup ${stepKey}...`);
  const shot = await ipcRenderer.invoke('get-screen-preview', { device: deviceId });
  if (!shot.success) return alert('Gagal screenshot: ' + shot.error);

  // Gunakan Screen Picker yang sudah ada dengan mode 'element'
  const step     = RETUR_STEPS.find(s => s.key === stepKey);
  const isSign   = step?.type === 'signature';

  // Buka modal picker
  _openFrStepModal(stepKey, step?.label, shot.imageBase64 || shot.base64 || shot.image || shot, isSign, profile);
}

// Note: Slight change - earlier code used shot.base64; adapt to common property
function _openFrStepModal(stepKey, stepLabel, screenshotBase64, isSignature, profile) {
  // Hapus modal lama jika ada
  document.getElementById('fr-step-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'fr-step-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,0.85);
    display:flex;align-items:center;justify-content:center;`;

  modal.innerHTML = `
    <div style="background:var(--bg-primary,#12122a);border-radius:12px;
                width:90vw;max-width:700px;max-height:90vh;
                display:flex;flex-direction:column;overflow:hidden;">

      <div style="padding:16px 20px;border-bottom:1px solid var(--border-color,#333);
                  display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:15px;">${stepLabel}</div>
          <div style="font-size:12px;color:#888;margin-top:2px;">
            ${isSignature
              ? 'Drag untuk menandai AREA tempat tanda tangan muncul'
              : 'Drag untuk crop gambar target, atau klik untuk titik koordinat'}
          </div>
        </div>
        <button id="fr-modal-close" style="background:none;border:none;
                color:#aaa;font-size:20px;cursor:pointer;">✕</button>
      </div>

      ${!isSignature ? `
      <div style="padding:8px 16px;background:rgba(255,255,255,0.03);
                  border-bottom:1px solid var(--border-color,#333);
                  display:flex;gap:16px;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
          <input type="radio" name="fr-pick-mode" value="crop" checked> 🖼 Crop Gambar
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
          <input type="radio" name="fr-pick-mode" value="coordinate"> 📍 Koordinat Saja
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
          <input type="radio" name="fr-pick-mode" value="text">
          📝 Teks:
          <input type="text" id="fr-pick-text" placeholder="teks target"
                 style="width:120px;padding:2px 6px;background:var(--bg-secondary,#1a1a2e);
                        border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;">
        </label>
      </div>` : `
      <div style="padding:8px 16px;background:rgba(255,255,255,0.03);
                  border-bottom:1px solid var(--border-color,#333);
                  font-size:12px;color:#f9a825;">
        ✍ Mode Tanda Tangan — Drag untuk tandai area TTD di layar
      </div>`}

      <div style="position:relative;overflow:auto;flex:1;">
        <canvas id="fr-pick-canvas" style="display:block;max-width:100%;cursor:crosshair;"></canvas>
        <div id="fr-pick-overlay" style="position:absolute;pointer-events:none;display:none;
             border:2px dashed #4f8ef7;background:rgba(79,142,247,0.15);"></div>
      </div>

      <div style="padding:10px 16px;background:rgba(0,0,0,0.3);
                  font-size:12px;color:#aaa;font-family:monospace;"
           id="fr-pick-status">Drag untuk pilih area...</div>

      <div style="padding:12px 16px;border-top:1px solid var(--border-color,#333);
                  display:flex;gap:8px;justify-content:flex-end;">
        <button id="fr-pick-cancel" style="padding:8px 20px;border-radius:6px;cursor:pointer;
                background:var(--bg-secondary,#1a1a2e);border:1px solid #444;color:#eee;">
          Batal
        </button>
        <button id="fr-pick-confirm" style="padding:8px 20px;border-radius:6px;cursor:pointer;
                background:#4f8ef7;border:none;color:#fff;font-weight:600;">
          ✓ Simpan
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Render screenshot ke canvas
  const canvas  = modal.querySelector('#fr-pick-canvas');
  const overlay = modal.querySelector('#fr-pick-overlay');
  const status  = modal.querySelector('#fr-pick-status');
  const ctx     = canvas.getContext('2d');

  let origW = 0, origH = 0, scaleX = 1, scaleY = 1;
  let drag = { active:false, sx:0, sy:0, ex:0, ey:0 };
  let result = null;

  const img = new Image();
  img.onload = () => {
    origW = img.naturalWidth; origH = img.naturalHeight;
    canvas.width = origW; canvas.height = origH;
    ctx.drawImage(img, 0, 0);
    const dispW = canvas.getBoundingClientRect().width || canvas.offsetWidth || 600;
    scaleX = origW / dispW;
    scaleY = origH / (dispW * origH / origW);
  };
  img.src = 'data:image/png;base64,' + (screenshotBase64.base64 || screenshotBase64.imageBase64 || screenshotBase64 || '');

  const getPos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const norm = (a,b,c,d) => ({
    x:Math.min(a,c), y:Math.min(b,d),
    w:Math.abs(c-a), h:Math.abs(d-a)
  });

  canvas.addEventListener('mousedown', e => {
    const p = getPos(e); drag = { active:true, sx:p.x, sy:p.y, ex:p.x, ey:p.y };
    overlay.style.display = 'none';
  });
  canvas.addEventListener('mousemove', e => {
    const p = getPos(e);
    const devX = Math.round(p.x * scaleX), devY = Math.round(p.y * scaleY);
    status.textContent = `Device: X:${devX} Y:${devY}`;
    if (!drag.active) return;
    drag.ex = p.x; drag.ey = p.y;
    const r = norm(drag.sx,drag.sy,drag.ex,drag.ey);
    const cr = canvas.getBoundingClientRect();
    overlay.style.cssText += `;display:block;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
  });
  canvas.addEventListener('mouseup', e => {
    if (!drag.active) return;
    drag.active = false;
    const p = getPos(e); drag.ex = p.x; drag.ey = p.y;
    const r = norm(drag.sx,drag.sy,drag.ex,drag.ey);
    if (r.w < 5 || r.h < 5) { overlay.style.display='none'; return; }

    const devX = Math.round(r.x * scaleX);
    const devY = Math.round(r.y * scaleY);
    const devW = Math.round(r.w * scaleX);
    const devH = Math.round(r.h * scaleY);

    result = { x: devX + Math.round(devW/2), y: devY + Math.round(devH/2),
               rx: devX, ry: devY, rw: devW, rh: devH };

    status.textContent = `Area: X:${devX} Y:${devY} ${devW}×${devH}px  |  Center: (${result.x},${result.y})`;

    // Crop gambar untuk image matching
    const off = document.createElement('canvas');
    off.width = devW; off.height = devH;
    off.getContext('2d').drawImage(canvas,
      r.x * (canvas.width/canvas.offsetWidth || 1),
      r.y * (canvas.height/canvas.offsetHeight || 1),
      r.w * (canvas.width/canvas.offsetWidth || 1),
      r.h * (canvas.height/canvas.offsetHeight || 1),
      0, 0, devW, devH);
    result.base64 = off.toDataURL('image/png').split(',')[1];
  });

  // Konfirmasi
  modal.querySelector('#fr-pick-confirm').addEventListener('click', async () => {
    const mode = modal.querySelector('input[name="fr-pick-mode"]:checked')?.value || 'crop';
    const textVal = modal.querySelector('#fr-pick-text')?.value?.trim() || '';

    if (!profile.steps) profile.steps = {};

    if (mode === 'text' && textVal) {
      profile.steps[stepKey] = { text: textVal, x: result?.x, y: result?.y };
    } else if (mode === 'coordinate' && result) {
      profile.steps[stepKey] = { x: result.x, y: result.y };
    } else if (result?.base64) {
      profile.steps[stepKey] = {
        image: result.base64,
        x: result.x, y: result.y,
        threshold: 0.80
      };
    } else {
      alert('Belum ada pilihan. Drag area terlebih dahulu.');
      return;
    }

    _frProfiles[_frActiveIdx] = profile;
    await ipcRenderer.invoke('fr:save-profiles', { profiles: _frProfiles });
    modal.remove();
    _renderStepsGrid();
    _frLog('success', `✅ ${stepKey} berhasil dikonfigurasi`);
  });

  modal.querySelector('#fr-pick-cancel')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#fr-modal-close')?.addEventListener('click', () => modal.remove());
}

async function _addProfile() {
  const selector   = document.getElementById('device-selector');
  const autoDevice = selector?.value && selector.value !== 'No ADB Device'
    ? selector.value : '';

  return new Promise((resolve) => {
    // Hapus modal lama jika ada
    document.getElementById('fr-profile-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'fr-profile-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      animation:fr-modal-bg 0.2s ease both;`;

    modal.innerHTML = `
      <div style="
        background:#1a1a2e;border-radius:12px;
        border:1px solid rgba(255,255,255,0.1);
        width:420px;padding:28px;
        box-shadow:0 20px 60px rgba(0,0,0,0.5);
        animation:fr-modal-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both;">

        <div style="font-size:16px;font-weight:700;color:#eee;margin-bottom:6px;">
          📱 Buat Profile Device Baru
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:20px;">
          Setiap device HP punya profile konfigurasi sendiri
        </div>

        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">
          Nama Profile *
        </label>
        <input id="fr-modal-name" type="text"
          placeholder="contoh: Samsung A54 Gudang"
          style="width:100%;padding:10px 12px;border-radius:7px;
                 background:#0f0f1a;border:1px solid #333;color:#eee;
                 font-size:13px;box-sizing:border-box;margin-bottom:14px;
                 outline:none;transition:border-color 0.2s;"
          onfocus="this.style.borderColor='#4f8ef7'"
          onblur="this.style.borderColor='#333'">

        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">
          Device ID ADB
        </label>
        <input id="fr-modal-device" type="text"
          placeholder="otomatis dari device aktif"
          value="${autoDevice}"
          style="width:100%;padding:10px 12px;border-radius:7px;
                 background:#0f0f1a;border:1px solid #333;color:#eee;
                 font-size:13px;box-sizing:border-box;margin-bottom:6px;
                 outline:none;transition:border-color 0.2s;"
          onfocus="this.style.borderColor='#4f8ef7'"
          onblur="this.style.borderColor='#333'">
        <div style="font-size:11px;color:#555;margin-bottom:20px;">
          ${autoDevice
            ? `✅ Device aktif terdeteksi: <span style="color:#4caf50">${autoDevice}</span>`
            : '⚠️ Tidak ada device aktif — isi manual atau hubungkan HP dulu'}
        </div>

        <div style="display:flex;gap:10px;">
          <button id="fr-modal-cancel"
            style="flex:1;padding:10px;border-radius:8px;cursor:pointer;
                   background:transparent;border:1px solid #444;color:#aaa;
                   font-size:13px;transition:all 0.15s;">
            Batal
          </button>
          <button id="fr-modal-confirm"
            style="flex:2;padding:10px;border-radius:8px;cursor:pointer;
                   background:#4f8ef7;border:none;color:#fff;
                   font-size:13px;font-weight:600;transition:all 0.15s;">
            ✓ Buat Profile
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    // Focus ke input nama
    setTimeout(() => {
      document.getElementById('fr-modal-name')?.focus();
    }, 100);

    // Enter key submit
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('fr-modal-confirm')?.click();
      }
      if (e.key === 'Escape') {
        document.getElementById('fr-modal-cancel')?.click();
      }
    });

    // Hover effect tombol
    const confirmBtn = modal.querySelector('#fr-modal-confirm');
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.transform = 'translateY(-1px)';
      confirmBtn.style.boxShadow = '0 4px 16px rgba(79,142,247,0.4)';
    });
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.transform = '';
      confirmBtn.style.boxShadow = '';
    });

    // Batal
    document.getElementById('fr-modal-cancel').addEventListener('click', () => {
      modal.style.animation = 'fr-modal-bg 0.15s ease reverse both';
      setTimeout(() => modal.remove(), 150);
      resolve(null);
    });

    // Klik luar modal = batal
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        document.getElementById('fr-modal-cancel')?.click();
      }
    });

    // Konfirmasi
    document.getElementById('fr-modal-confirm').addEventListener('click', async () => {
      const nameEl   = document.getElementById('fr-modal-name');
      const deviceEl = document.getElementById('fr-modal-device');
      const name     = nameEl?.value?.trim() || '';
      const deviceId = deviceEl?.value?.trim() || autoDevice;

      if (!name) {
        nameEl.style.borderColor = '#f44336';
        nameEl.placeholder = 'Nama profile wajib diisi!';
        nameEl.focus();
        return;
      }

      const newProfile = {
        profileName:     name,
        deviceId:        deviceId,
        steps:           {},
        signatureConfig: {
          startOffsetX: -100, startOffsetY: 0,
          endOffsetX:   100,  endOffsetY:   30,
          swipeDuration: 800
        }
      };

      _frProfiles.push(newProfile);
      _frActiveIdx = _frProfiles.length - 1;

      // Animasi close modal
      modal.style.animation = 'fr-modal-bg 0.15s ease reverse both';
      setTimeout(() => modal.remove(), 150);

      try {
        await ipcRenderer.invoke('fr:save-profiles', { profiles: _frProfiles });
        _frLog('success', `✅ Profile "${name}" berhasil dibuat — device: ${deviceId || 'belum diset'}`);
      } catch (err) {
        _frLog('error', 'Gagal simpan profile: ' + err.message);
      }

      _renderProfileSelect();
      _renderStepsGrid();
      _syncActiveDevice();
      resolve(newProfile);
    });
  });
}

async function _editProfile() {
  if (_frActiveIdx < 0) {
    _frLog('warn', 'Pilih profile dulu sebelum edit');
    return;
  }
  const p = _frProfiles[_frActiveIdx];

  const selector   = document.getElementById('device-selector');
  const autoDevice = selector?.value && selector.value !== 'No ADB Device'
    ? selector.value : '';

  return new Promise((resolve) => {
    document.getElementById('fr-profile-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'fr-profile-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      animation:fr-modal-bg 0.2s ease both;`;

    modal.innerHTML = `
      <div style="
        background:#1a1a2e;border-radius:12px;
        border:1px solid rgba(255,255,255,0.1);
        width:420px;padding:28px;
        box-shadow:0 20px 60px rgba(0,0,0,0.5);
        animation:fr-modal-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both;">

        <div style="font-size:16px;font-weight:700;color:#eee;margin-bottom:6px;">
          ✏️ Edit Profile
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:20px;">
          ${p.profileName}
        </div>

        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Nama Profile *</label>
        <input id="fr-modal-name" type="text" value="${p.profileName}"
          style="width:100%;padding:10px 12px;border-radius:7px;
                 background:#0f0f1a;border:1px solid #333;color:#eee;
                 font-size:13px;box-sizing:border-box;margin-bottom:14px;
                 outline:none;transition:border-color 0.2s;"
          onfocus="this.style.borderColor='#4f8ef7'"
          onblur="this.style.borderColor='#333'">

        <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Device ID ADB</label>
        <input id="fr-modal-device" type="text" value="${p.deviceId || autoDevice}"
          style="width:100%;padding:10px 12px;border-radius:7px;
                 background:#0f0f1a;border:1px solid #333;color:#eee;
                 font-size:13px;box-sizing:border-box;margin-bottom:20px;
                 outline:none;transition:border-color 0.2s;"
          onfocus="this.style.borderColor='#4f8ef7'"
          onblur="this.style.borderColor='#333'">

        <div style="display:flex;gap:10px;">
          <button id="fr-modal-cancel"
            style="flex:1;padding:10px;border-radius:8px;cursor:pointer;
                   background:transparent;border:1px solid #444;color:#aaa;font-size:13px;">
            Batal
          </button>
          <button id="fr-modal-confirm"
            style="flex:2;padding:10px;border-radius:8px;cursor:pointer;
                   background:#4f8ef7;border:none;color:#fff;font-size:13px;font-weight:600;">
            ✓ Simpan
          </button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('fr-modal-name')?.focus(), 100);

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('fr-modal-confirm')?.click();
      if (e.key === 'Escape') document.getElementById('fr-modal-cancel')?.click();
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) document.getElementById('fr-modal-cancel')?.click();
    });

    document.getElementById('fr-modal-cancel').addEventListener('click', () => {
      modal.remove(); resolve(null);
    });

    document.getElementById('fr-modal-confirm').addEventListener('click', async () => {
      const name     = document.getElementById('fr-modal-name')?.value?.trim() || '';
      const deviceId = document.getElementById('fr-modal-device')?.value?.trim() || '';
      if (!name) {
        document.getElementById('fr-modal-name').style.borderColor = '#f44336';
        return;
      }
      p.profileName = name;
      p.deviceId    = deviceId;
      modal.remove();
      await ipcRenderer.invoke('fr:save-profiles', { profiles: _frProfiles });
      _renderProfileSelect();
      _syncActiveDevice();
      _frLog('success', `✅ Profile diperbarui: "${name}"`);
      resolve(p);
    });
  });
}

async function _deleteProfile() {
  if (_frActiveIdx < 0) return;
  if (!confirm(`Hapus profile "${_frProfiles[_frActiveIdx].profileName}"?`)) return;
  _frProfiles.splice(_frActiveIdx, 1);
  _frActiveIdx = -1;
  await ipcRenderer.invoke('fr:save-profiles', { profiles: _frProfiles });
  _renderProfileSelect();
  _renderStepsGrid();
}

async function _runFlow() {
  if (_frActiveIdx < 0) return alert('Pilih profile dulu');
  const profile = JSON.parse(JSON.stringify(_frProfiles[_frActiveIdx]));

  const autoDevice = (() => {
    const sel = document.getElementById('device-selector');
    return sel?.value && sel.value !== 'No ADB Device' ? sel.value : '';
  })();
  if (!profile.deviceId && autoDevice) {
    profile.deviceId = autoDevice;
    _frLog('info', `Auto-detect device: ${autoDevice}`);
  }
  if (!profile.deviceId) {
    return alert('Tidak ada device ADB aktif. Hubungkan HP via USB dan refresh devices.');
  }

  profile.waitTimeout     = parseInt(document.getElementById('fr-timeout')?.value || 30);
  profile.extraWaitOnSlow = parseInt(document.getElementById('fr-extra-wait')?.value || 10);
  profile.stepDelay       = parseInt(document.getElementById('fr-step-delay')?.value || 500);
  profile.loopMode        = document.querySelector('input[name="fr-loop-mode"]:checked')?.value || 'text';
  profile.loopCount       = parseInt(document.getElementById('fr-loop-count-value')?.value || 10);
  profile.loopCondition   = { text: document.getElementById('fr-loop-text-value')?.value || '' };
  profile.signatureConfig = {
    startOffsetX: parseInt(document.getElementById('fr-sig-sx')?.value || -100),
    startOffsetY: parseInt(document.getElementById('fr-sig-sy')?.value || 0),
    endOffsetX:   parseInt(document.getElementById('fr-sig-ex')?.value || 100),
    endOffsetY:   parseInt(document.getElementById('fr-sig-ey')?.value || 30),
    swipeDuration:parseInt(document.getElementById('fr-sig-dur')?.value || 800),
  };

  document.getElementById('fr-btn-run').style.display  = 'none';
  document.getElementById('fr-btn-stop').style.display = 'inline-flex';
  _frLog('info', '▶ Memulai Flow Retur...');

  try {
    await ipcRenderer.invoke('fr:run', profile);
  } catch (err) {
    _frLog('error', 'Error: ' + err.message);
  } finally {
    document.getElementById('fr-btn-run').style.display  = 'inline-flex';
    document.getElementById('fr-btn-stop').style.display = 'none';
  }
}

function _frLog(level, msg) {
  const el  = document.getElementById('fr-log');
  if (!el) return;
  const c   = { info:'#aaa', success:'#4caf50', warn:'#ff9800', error:'#f44336' };
  const div = document.createElement('div');
  div.style.cssText = `color:${c[level]||'#aaa'};font-size:12px;padding:1px 0;`;
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function _updateRunBtn() {
  const btn = document.getElementById('fr-btn-run');
  if (!btn) return;
  const p = _frProfiles[_frActiveIdx];
  const selector = document.getElementById('device-selector');
  const autoDevice = selector?.value && selector.value !== 'No ADB Device'
    ? selector.value : '';
  btn.disabled = !p?.deviceId && !autoDevice;
  btn.title    = btn.disabled ? 'Isi Device ID di profile dulu atau pilih device aktif' : '';
}

// ── Expose ke window — dipastikan semua fungsi sudah terdefinisi ──
if (typeof window !== 'undefined') {
  window.frAddProfile     = _addProfile;
  window.frOpenStepPicker = frOpenStepPicker;
  window.frEditProfile    = _editProfile;
  window.frDeleteProfile  = _deleteProfile;
}

if (typeof module !== 'undefined') module.exports = { initFlowRetur, frOpenStepPicker };
