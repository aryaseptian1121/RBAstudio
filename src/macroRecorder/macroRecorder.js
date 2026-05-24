'use strict';

function initMacroRecorder(mountElement) {
  if (!mountElement || mountElement.dataset.macroRecorderInit === 'true') return;
  mountElement.dataset.macroRecorderInit = 'true';

  const state = {
    recording: false,
    playing: false,
    events: [],
    savedMacros: [],
    playSpeed: 1.0,
    loopCount: 1,
    captureMouseMove: false,
    playLog: [],
  };

  const api = window.electronAPI || null;

  if (!api || typeof api.invoke !== 'function') {
    mountElement.innerHTML = '<div style="padding:20px;color:#fca5a5;">Macro Recorder membutuhkan window.electronAPI.</div>';
    return;
  }

  const setBadge = (text, color, extraText) => {
    const badge = document.getElementById('mcr-status-badge');
    if (!badge) return;
    badge.innerHTML = text + (extraText ? ` <span style="color:${color};">${extraText}</span>` : '');
    badge.style.color = color;
  };

  async function checkPermission() {
    try {
      const result = await api.invoke('macro-check-permission');
      if (result && result.granted === false) {
        setBadge('⚠️ Izin Accessibility dibutuhkan', '#f59e0b');
      }
      return result && result.granted !== false;
    } catch (err) {
      setBadge('⚠️ Gagal memeriksa izin', '#f59e0b');
      return false;
    }
  }

  function updateEventList() {
    const list = document.getElementById('mcr-event-list');
    if (!list) return;
    const recent = state.events.slice(-50);
    if (recent.length === 0) {
      list.innerHTML = '<p style="color:#4b5563;text-align:center;padding:20px;font-size:13px;">Mulai rekam untuk melihat events...</p>';
      return;
    }

    list.innerHTML = recent.map((evt, index) => {
      const absIndex = state.events.length - recent.length + index;
      const icon = evt.type === 'mouse_click' ? '🖱️' : evt.type === 'key_press' ? '⌨️' : evt.type === 'scroll' ? '↕️' : '📍';
      const desc = evt.type === 'mouse_click'
        ? `${evt.double ? 'D-Click' : 'Click'} ${evt.button || 'left'} (${evt.x},${evt.y})`
        : evt.type === 'key_press'
          ? `Key: ${[evt.ctrl && 'Ctrl', evt.shift && 'Shift', evt.alt && 'Alt', evt.key].filter(Boolean).join('+')}`
          : evt.type === 'scroll'
            ? `Scroll ${evt.direction} (${evt.x},${evt.y})`
            : `Move (${evt.x},${evt.y})`;

      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #1f2937;font-size:12px;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;">${icon} ${desc}</div>
            <div style="color:#6b7280;font-size:11px;margin-top:2px;">${(evt.timestamp / 1000).toFixed(2)}s</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <button data-edit="${absIndex}" style="padding:5px 10px;border:none;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;font-size:11px;">Edit</button>
            <button data-delete="${absIndex}" style="padding:5px 10px;border:none;border-radius:6px;background:#7f1d1d;color:#fca5a5;cursor:pointer;font-size:11px;">Delete</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => editEvent(parseInt(btn.dataset.edit, 10)));
    });

    list.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.delete, 10)));
    });
  }

  function renderMacroList() {
    const list = document.getElementById('mcr-saved-list');
    if (!list) return;
    if (state.savedMacros.length === 0) {
      list.innerHTML = '<p style="color:#6b7280;text-align:center;padding:20px;font-size:13px;">Belum ada makro tersimpan</p>';
      return;
    }

    list.innerHTML = state.savedMacros.map((m) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #374151;border-radius:8px;margin-bottom:8px;background:#1f2937;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${m.name}</div>
          <div style="font-size:12px;color:#9ca3af;">${m.eventCount} events · ${new Date(m.savedAt).toLocaleString('id-ID')}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button data-load="${m.id}" style="padding:5px 12px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Load</button>
          <button data-del="${m.id}" style="padding:5px 10px;background:#7f1d1d;color:#fca5a5;border:none;border-radius:6px;cursor:pointer;font-size:12px;">✕</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-load]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const result = await api.invoke('macro-load', btn.dataset.load);
        if (result.ok) {
          state.events = result.events || [];
          const counter = document.getElementById('mcr-event-count');
          if (counter) counter.textContent = `${state.events.length} events`;
          updateEventList();
          setBadge('✅ Makro dimuat', '#34d399');
          alert(`Makro "${result.name}" berhasil dimuat (${state.events.length} events)`);
        }
      });
    });

    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Hapus makro ini?')) return;
        await api.invoke('macro-delete', btn.dataset.del);
        await loadMacroList();
      });
    });
  }

  async function loadMacroList() {
    const result = await api.invoke('macro-list');
    if (result.ok) {
      state.savedMacros = result.macros || [];
      renderMacroList();
    }
  }

  function deleteEvent(index) {
    if (index < 0 || index >= state.events.length) return;
    state.events.splice(index, 1);
    const counter = document.getElementById('mcr-event-count');
    if (counter) counter.textContent = `${state.events.length} events`;
    updateEventList();
    setBadge('🗑 Event dihapus', '#f59e0b');
  }

  function editEvent(index) {
    const evt = state.events[index];
    if (!evt) return;

    if (evt.type === 'mouse_click') {
      const nextValue = prompt('Edit click: x,y,button (contoh: 120,180,left)', `${evt.x},${evt.y},${evt.button || 'left'}`);
      if (!nextValue) return;
      const [x, y, button] = nextValue.split(',').map((part) => part.trim());
      if (!x || !y || !button) {
        alert('Format tidak valid. Contoh: 120,180,left');
        return;
      }
      evt.x = parseInt(x, 10) || evt.x;
      evt.y = parseInt(y, 10) || evt.y;
      evt.button = button.toLowerCase();
    } else if (evt.type === 'key_press') {
      const nextValue = prompt('Edit key:', evt.key || '');
      if (nextValue === null) return;
      evt.key = nextValue.trim() || evt.key;
    } else if (evt.type === 'mouse_move') {
      const nextValue = prompt('Edit move: x,y', `${evt.x},${evt.y}`);
      if (!nextValue) return;
      const [x, y] = nextValue.split(',').map((part) => part.trim());
      if (!x || !y) {
        alert('Format tidak valid. Contoh: 120,180');
        return;
      }
      evt.x = parseInt(x, 10) || evt.x;
      evt.y = parseInt(y, 10) || evt.y;
    }

    updateEventList();
    setBadge('✏️ Event diperbarui', '#38bdf8');
  }

  async function startRecording() {
    const permissionGranted = await checkPermission();
    if (!permissionGranted) {
      alert('Accessibility permission diperlukan untuk record sistem-wide di macOS. Buka System Preferences → Privacy & Security → Accessibility, tambahkan RBA Studio Pro, lalu restart aplikasi.');
      return;
    }

    const result = await api.invoke('macro-start-recording', { captureMouseMove: state.captureMouseMove });
    if (!result.ok) {
      alert(`Error: ${result.message}`);
      return;
    }
    state.recording = true;
    state.events = [];
    const log = document.getElementById('mcr-log');
    if (log) log.innerHTML = '';
    updateEventList();
    const counter = document.getElementById('mcr-event-count');
    if (counter) counter.textContent = '0 events';
    setBadge('🔴 Merekam...', '#f87171');
    const recordBtn = document.getElementById('mcr-btn-record');
    if (recordBtn) {
      recordBtn.textContent = '🔴 Merekam...';
      recordBtn.style.background = '#7f1d1d';
    }
  }

  async function stopRecording() {
    const result = await api.invoke('macro-stop-recording');
    state.recording = false;
    state.events = result.events || [];
    updateEventList();
    const counter = document.getElementById('mcr-event-count');
    if (counter) counter.textContent = `${state.events.length} events`;
    setBadge(`✅ ${state.events.length} events terekam`, '#34d399');
    const recordBtn = document.getElementById('mcr-btn-record');
    if (recordBtn) {
      recordBtn.textContent = '🔴 Mulai Rekam';
      recordBtn.style.background = '#dc2626';
    }
  }

  async function saveMacro() {
    const name = document.getElementById('mcr-macro-name').value.trim();
    if (!name) {
      alert('Isi nama makro terlebih dahulu');
      return;
    }
    if (state.events.length === 0) {
      alert('Tidak ada events untuk disimpan');
      return;
    }

    const result = await api.invoke('macro-save', { name, events: state.events });
    if (result.ok) {
      alert(`Makro "${name}" berhasil disimpan!`);
      document.getElementById('mcr-macro-name').value = '';
      await loadMacroList();
      setBadge('💾 Makro tersimpan', '#c084fc');
    }
  }

  async function playMacro() {
    if (state.events.length === 0) {
      alert('Tidak ada events. Rekam dulu atau load makro.');
      return;
    }

    const speed = parseFloat(document.getElementById('mcr-speed').value) || 1.0;
    const loops = parseInt(document.getElementById('mcr-loops').value, 10) || 1;
    const logBox = document.getElementById('mcr-log');
    if (logBox) logBox.innerHTML = '';

    state.playing = true;
    setBadge('▶ Playback...', '#22c55e');
    const result = await api.invoke('macro-play', { events: state.events, speed, loops });
    if (!result.ok) {
      alert(`Playback gagal: ${result.message}`);
      state.playing = false;
      setBadge('⚠️ Playback gagal', '#f59e0b');
      return;
    }
    state.playing = false;
    setBadge('✅ Playback selesai', '#34d399');
  }

  mountElement.innerHTML = `
<div style="height:100%;display:flex;flex-direction:column;background:#111827;color:#f9fafb;font-family:system-ui,sans-serif;overflow:hidden;">
  <div style="padding:16px 24px;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
    <div>
      <h2 style="margin:0;font-size:20px;font-weight:700;">🎬 Macro Recorder</h2>
      <p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Rekam mouse, keyboard, dan playback di seluruh layar PC.</p>
    </div>
    <div style="background:#1f2937;border-radius:8px;padding:8px 16px;font-size:13px;color:#9ca3af;" id="mcr-status-badge">⏹ Standby</div>
  </div>

  <div style="flex:1;display:flex;overflow:hidden;">
    <div style="flex:1;display:flex;flex-direction:column;padding:20px;border-right:1px solid #374151;overflow-y:auto;">
      <div style="background:#1f2937;border-radius:10px;padding:16px;margin-bottom:16px;">
        <h3 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#9ca3af;">KONTROL REKAMAN</h3>
        <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
          <button id="mcr-btn-record" style="flex:1;min-width:120px;padding:12px 20px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">🔴 Mulai Rekam</button>
          <button id="mcr-btn-stop-rec" style="flex:1;min-width:100px;padding:12px 16px;background:#374151;color:#9ca3af;border:none;border-radius:8px;font-size:14px;cursor:pointer;">⏹ Stop Rekam</button>
          <button id="mcr-btn-clear" style="padding:12px 14px;background:#111827;color:#9ca3af;border:1px solid #374151;border-radius:8px;font-size:13px;cursor:pointer;">🗑</button>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;color:#9ca3af;margin-bottom:8px;">
          <input type="checkbox" id="mcr-capture-move"/>
          Rekam pergerakan mouse (lebih berat, lebih akurat)
        </label>
        <div style="font-size:12px;color:#6b7280;background:#111827;border-radius:6px;padding:8px 12px;">
          💡 Klik "Mulai Rekam" lalu lakukan aksi di app manapun. Mouse click, keyboard, dan koordinat akan terekam.
        </div>
      </div>

      <div style="background:#1f2937;border-radius:10px;padding:16px;margin-bottom:16px;flex:1;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font-size:14px;font-weight:600;color:#9ca3af;">EVENTS TEREKAM</h3>
          <span id="mcr-event-count" style="font-size:13px;color:#3b82f6;font-weight:600;">0 events</span>
        </div>
        <div id="mcr-event-list" style="background:#0f172a;border-radius:6px;max-height:240px;overflow-y:auto;min-height:60px;">
          <p style="color:#4b5563;text-align:center;padding:20px;font-size:13px;">Mulai rekam untuk melihat events...</p>
        </div>
      </div>

      <div style="background:#1f2937;border-radius:10px;padding:16px;">
        <h3 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#9ca3af;">PLAYBACK</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
          <div>
            <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:4px;">Kecepatan</label>
            <select id="mcr-speed" style="width:100%;padding:6px 10px;background:#111827;border:1px solid #374151;border-radius:6px;color:#f9fafb;font-size:13px;">
              <option value="0.25">0.25x</option>
              <option value="0.5">0.5x</option>
              <option value="1" selected>1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
              <option value="3">3x</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:#9ca3af;margin-bottom:4px;">Ulangi</label>
            <input id="mcr-loops" type="number" min="1" max="999" value="1" style="width:100%;padding:6px 10px;background:#111827;border:1px solid #374151;border-radius:6px;color:#f9fafb;font-size:13px;box-sizing:border-box;"/>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <button id="mcr-btn-play" style="flex:1;padding:10px;background:#16a34a;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">▶ Play</button>
          <button id="mcr-btn-pause-play" style="padding:10px 16px;background:#d97706;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">⏸</button>
          <button id="mcr-btn-stop-play" style="padding:10px 16px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:13px;cursor:pointer;">■</button>
        </div>
        <div style="display:flex;gap:8px;">
          <input id="mcr-macro-name" placeholder="Nama makro..." style="flex:1;padding:8px 12px;background:#111827;border:1px solid #374151;border-radius:6px;color:#f9fafb;font-size:13px;"/>
          <button id="mcr-btn-save" style="padding:8px 16px;background:#7c3aed;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;">💾 Simpan</button>
        </div>
      </div>
    </div>

    <div style="width:320px;display:flex;flex-direction:column;padding:20px;overflow-y:auto;">
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
          <h3 style="margin:0;font-size:14px;font-weight:600;color:#9ca3af;">MAKRO TERSIMPAN</h3>
          <button id="mcr-btn-refresh" style="font-size:12px;color:#3b82f6;background:none;border:none;cursor:pointer;">↻ Refresh</button>
        </div>
        <div id="mcr-saved-list">
          <p style="color:#6b7280;text-align:center;padding:20px;font-size:13px;">Memuat...</p>
        </div>
      </div>

      <div>
        <h3 style="margin:0 0 10px;font-size:14px;font-weight:600;color:#9ca3af;">LOG PLAYBACK</h3>
        <div id="mcr-log" style="background:#0f172a;border-radius:6px;padding:12px;min-height:100px;max-height:250px;overflow-y:auto;font-size:12px;"></div>
      </div>
    </div>
  </div>
</div>`;

  document.getElementById('mcr-btn-record').addEventListener('click', startRecording);
  document.getElementById('mcr-btn-stop-rec').addEventListener('click', stopRecording);
  document.getElementById('mcr-btn-clear').addEventListener('click', () => {
    if (confirm('Hapus semua events yang direkam?')) {
      state.events = [];
      const counter = document.getElementById('mcr-event-count');
      if (counter) counter.textContent = '0 events';
      updateEventList();
      setBadge('🧹 Events dibersihkan', '#60a5fa');
    }
  });
  document.getElementById('mcr-btn-play').addEventListener('click', playMacro);
  document.getElementById('mcr-btn-pause-play').addEventListener('click', async () => {
    await api.invoke('macro-pause-play');
    setBadge('⏸ Playback dijeda', '#f59e0b');
  });
  document.getElementById('mcr-btn-stop-play').addEventListener('click', async () => {
    await api.invoke('macro-stop-play');
    state.playing = false;
    setBadge('■ Playback dihentikan', '#f87171');
  });
  document.getElementById('mcr-btn-save').addEventListener('click', saveMacro);
  document.getElementById('mcr-btn-refresh').addEventListener('click', loadMacroList);
  document.getElementById('mcr-capture-move').addEventListener('change', (e) => {
    state.captureMouseMove = e.target.checked;
  });

  api.on('macro-event-recorded', (evt) => {
    state.events.push(evt);
    const counter = document.getElementById('mcr-event-count');
    if (counter) counter.textContent = `${state.events.length} events`;
    updateEventList();
  });

  api.on('macro-play-log', ({ level, message }) => {
    const logBox = document.getElementById('mcr-log');
    if (!logBox) return;
    const div = document.createElement('div');
    const color = level === 'ERROR' ? '#f87171' : level === 'SUCCESS' ? '#34d399' : '#e5e7eb';
    div.style.cssText = `color:${color};font-size:12px;margin-bottom:2px;font-family:monospace;`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  });

  loadMacroList();
  checkPermission();
}

module.exports = { initMacroRecorder };
