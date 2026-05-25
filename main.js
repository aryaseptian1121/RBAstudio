// ============================================================
// RBA STUDIO PRO — main.js (Electron Main Process)
// Author: Arya Septian  |  Version: 2.0
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, systemPreferences } = require("electron");
const { exec, execSync, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const XLSX = require('xlsx');
const { ExcelLoopEngine } = require('./src/services/ExcelLoopEngine');
const WinAuto = require('./src/services/WindowsAutomation');
const BrowserManager = require('./src/services/BrowserManager');
const { resolveTarget } = require('./src/engine/TargetResolver');
const SmartDetector = require('./src/smartDetector');
const ElectronScreenshotProvider = require('./src/screenshotProviders/electronProvider');
const AdbScreenshotProvider = require('./src/screenshotProviders/adbProvider');
const { buildSmartTargetForClick } = require('./src/smartTargetCapture');

// NEW: Get correct base path for both dev and production
function getBasePath() {
  if (app.isPackaged) {
    return process.resourcesPath;
  } else {
    return __dirname;
  }
}

function logBinaryError(tool, message) {
  const errMsg = `${tool} error: ${message}`;
  console.error(errMsg);
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('binary-error', { tool, message });
  }
}

function resetAdbServer(adbPath, callback) {
  exec(`"${adbPath}" kill-server`, () => {
    exec(`"${adbPath}" start-server`, () => {
      callback();
    });
  });
}

const projectsFile = path.join(app.getPath("userData"), "rba-workflows.json");
const settingsFile  = path.join(app.getPath("userData"), "rba-settings.json");

// ─────────────────────────────────────────
// PERSIST HELPERS
// ─────────────────────────────────────────
function loadSavedWorkflows() {
    try { if (!fs.existsSync(projectsFile)) return []; return JSON.parse(fs.readFileSync(projectsFile,"utf8"))||[]; } catch(e){ return []; }
}
function saveWorkflowsFile(list) {
    try { fs.writeFileSync(projectsFile, JSON.stringify(list,null,2)); } catch(e){}
    return list;
}
function loadSettings() {
    try { if (!fs.existsSync(settingsFile)) return {}; return JSON.parse(fs.readFileSync(settingsFile,"utf8"))||{}; } catch(e){ return {}; }
}
function saveSettingsFile(obj) {
    try { fs.writeFileSync(settingsFile, JSON.stringify(obj,null,2)); } catch(e){}
    return obj;
}

// ─────────────────────────────────────────
// DEVICE POOL & ADB
// ─────────────────────────────────────────
class DevicePool {
    constructor() { this.devices=[]; this.adbPath=null; this.scrcpyPath=null; this.scrcpyProc=null; }

    findAdb() {
        if (this.adbPath) return this.adbPath;
        const candidates = [];
        const settings = loadSettings();

        // 1. Explicit settings, env, or SDK locations first
        if (settings.adbPath) candidates.push(settings.adbPath);
        const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (androidHome) {
            candidates.push(path.join(androidHome, 'platform-tools', os.platform()==='win32' ? 'adb.exe' : 'adb'));
        }
        if (process.env.ADB_PATH) {
            for (const cand of process.env.ADB_PATH.split(path.delimiter).filter(Boolean)) {
                candidates.push(cand);
            }
        }

        // 2. Known macOS/Homebrew defaults
        if (os.platform() === 'darwin') {
            candidates.push('/opt/homebrew/bin/adb');
            candidates.push('/usr/local/bin/adb');
            candidates.push('/usr/local/Cellar/android-platform-tools/35.0.2/platform-tools/adb');
            candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
            candidates.push(path.join(os.homedir(), 'Android', 'sdk', 'platform-tools', 'adb'));
        }

        // 3. Local project and bundled resources
        const basePath = getBasePath();
        candidates.push(path.join(basePath, 'scrcpy', os.platform()==='win32' ? 'adb.exe' : 'adb'));
        candidates.push(path.join(basePath, os.platform()==='win32' ? 'adb.exe' : 'adb'));
        candidates.push(path.join(process.resourcesPath || basePath, 'bin', os.platform()==='win32' ? 'adb.exe' : 'adb'));
        candidates.push(path.join(process.resourcesPath || basePath, 'resources', 'bin', os.platform()==='win32' ? 'adb.exe' : 'adb'));
        candidates.push(path.join(process.resourcesPath || basePath, 'assets', 'bin', os.platform()==='win32' ? 'adb.exe' : 'adb'));

        // 4. Standard PATH lookups
        try {
            const cmd = os.platform()==='win32' ? 'where adb' : 'which adb';
            const result = execSync(cmd, { stdio:['ignore','pipe','ignore'], encoding:'utf8' });
            const found = result.trim().split(/\r?\n/)[0];
            if (found) candidates.push(found);
        } catch(e){}

        // 5. macOS/Linux login shell PATH fallback
        if (os.platform() !== 'win32') {
            try {
                const shell = process.env.SHELL || '/bin/zsh';
                const shellPath = execSync(`${shell} -l -c "which adb"`, { stdio:['ignore','pipe','ignore'], encoding:'utf8', timeout:5000 }).toString().trim();
                if (shellPath) candidates.push(shellPath);
            } catch(e){}
        }

        if (os.platform() === 'win32') {
            candidates.push(path.join(os.homedir(),'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
            candidates.push(path.join(app.getPath('userData'), 'adb', 'adb.exe'));
        } else {
            candidates.push('/usr/local/bin/adb', '/usr/bin/adb');
        }

        const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
        for (const cand of uniqueCandidates) {
            try {
                if (fs.existsSync(cand)) {
                    execSync(`"${cand}" version`, { timeout: 3000, stdio:'pipe' });
                    this.adbPath = cand;
                    console.log(`[ADB] Ditemukan di: ${cand}`);
                    return cand;
                }
            } catch (_) {
                continue;
            }
        }

        this.adbPath = null;
        logBinaryError('adb', 'ADB tidak ditemukan. Pastikan adb tersedia di PATH, Android SDK, atau install dengan Homebrew.');
        return null;
    }

    adb(args, device, cb, options = {}) {
        const bin = this.findAdb();
        if (!bin) {
            return cb({ success:false, output:'', error:'ADB tidak ditemukan. Pastikan adb tersedia di PATH atau Android SDK.' });
        }
        const dFlag = device ? `-s "${device}"` : '';
        const cmd = `"${bin}" ${dFlag} ${args}`;
        const execOptions = {
            timeout: options.timeout || 30000,
            maxBuffer: options.maxBuffer || 50*1024*1024,
            encoding: options.encoding || 'utf8'
        };
        exec(cmd, execOptions, (err, stdout, stderr) => {
            cb({ success:!err, output:stdout||'', error:err?.message||stderr||'' });
        });
    }

    refresh() {
        try {
            const bin = this.findAdb();
            if (!bin) {
                this.devices = [];
                return this.devices;
            }
            // Use timeout of 4s so the 5s socket timeout doesn't interfere
            const out = execSync(`"${bin}" devices`, { encoding:'utf8', timeout:4000 });
            this.devices = out.split('\n').slice(1)
                .map(l=>l.trim())
                .filter(l => l && l.includes('\tdevice'))
                .map(l => l.split(/\s+/)[0]);
        } catch(e) {
            // Don't wipe devices on timeout - keep the last known list
            console.warn('[ADB] Device refresh failed:', e.message);
            // Only reset if we got a connection error, not a timeout
            if (e.message && e.message.includes('ENOENT')) {
                this.devices = [];
            }
        }
        return this.devices;
    }

    findScrcpy() {
        if (this.scrcpyPath) return this.scrcpyPath;
        const candidates = [];
        try {
            const cmd = os.platform()==='win32' ? 'where scrcpy' : 'which scrcpy';
            const result = execSync(cmd,{stdio:['ignore','pipe','ignore'], encoding:'utf8'}).toString().trim();
            if (result) candidates.push(result.split(/\r?\n/)[0]);
        } catch(e){}
        const settings = loadSettings();
        if (settings.scrcpyPath) candidates.push(settings.scrcpyPath);
        
        // Local project scrcpy folder (production: resourcesPath, dev: __dirname)
        const basePath = getBasePath();
        candidates.push(path.join(basePath, 'scrcpy', os.platform()==='win32' ? 'scrcpy.exe' : 'scrcpy'));
        candidates.push(path.join(basePath, os.platform()==='win32' ? 'scrcpy.exe' : 'scrcpy'));

        for (const cand of candidates) {
            if (cand && fs.existsSync(cand)) { this.scrcpyPath = cand; return cand; }
        }
        logBinaryError('scrcpy', 'scrcpy tidak ditemukan. Pastikan scrcpy.exe ada di folder scrcpy atau PATH.');
        return null;
    }

    launchScrcpy(device, args='') {
        try {
            const scrcpy = this.findScrcpy();
            if (!scrcpy) {
                return { success:false, error: 'scrcpy tidak ditemukan. Pastikan file scrcpy ada di folder project atau PATH.' };
            }
            const dFlag = device ? `-s "${device}"` : '';
            if (this.scrcpyProc) { try{this.scrcpyProc.kill();}catch(e){} }
            this.scrcpyProc = spawn(scrcpy, [...dFlag.split(' ').filter(Boolean), ...args.split(' ').filter(Boolean)], { detached:true, stdio:'ignore' });
            this.scrcpyProc.unref();
            return { success:true };
        } catch(e) {
            return { success:false, error: 'scrcpy gagal dijalankan: ' + e.message };
        }
    }
}
const pool = new DevicePool();

// ─────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────
let mainWindow = null;

app.commandLine.appendSwitch('disable-background-timer-throttling'); // CHANGED
app.commandLine.appendSwitch('disable-renderer-backgrounding'); // CHANGED
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); // CHANGED

const { runFlow, stopFlow, setAdbExecutor, cleanupFlow, setExcelLoopBrowserManager } = require('./flowEngine'); // CHANGED
setAdbExecutor(pool.adb.bind(pool)); // CHANGED
setExcelLoopBrowserManager(pool.browserManager?.bind(pool));

let currentExcelLoopEngine = null;
let excelLoopState = { running: false, paused: false, stopped: false };
let waClient = null;
let waEngine = {
  running: false,
  paused: false,
  stopped: false,
  processed: 0,
  failed: 0,
  total: 0,
  checkpoint: []
};

// ── MACRO RECORDER ENGINE ──────────────────────────────────
let macroEngine = {
  isRecording: false,
  isPlaying: false,
  isPaused: false,
  events: [],
  startTime: null,
  playbackSpeed: 1.0,
  loopCount: 1,
};

let ioHook = null;

function getIOHook() {
  if (ioHook) return ioHook;
  try {
    const hookModule = require('uiohook-napi');
    ioHook = hookModule.uIOhook || hookModule;
    return ioHook;
  } catch (e1) {
    try {
      ioHook = require('iohook');
      return ioHook;
    } catch (e2) {
      console.warn('[MacroRecorder] Hook tidak tersedia:', e2.message);
      return null;
    }
  }
}

function getKeyName(keycode, rawcode) {
  const keyMap = {
    8: 'backspace', 9: 'tab', 13: 'enter', 27: 'escape',
    32: 'space', 37: 'left', 38: 'up', 39: 'right', 40: 'down',
    46: 'delete', 112: 'f1', 113: 'f2', 114: 'f3', 115: 'f4',
    116: 'f5', 117: 'f6', 118: 'f7', 119: 'f8', 120: 'f9', 121: 'f10',
    122: 'f11', 123: 'f12', 65: 'a', 66: 'b', 67: 'c', 68: 'd',
    69: 'e', 70: 'f', 71: 'g', 72: 'h', 73: 'i', 74: 'j', 75: 'k',
    76: 'l', 77: 'm', 78: 'n', 79: 'o', 80: 'p', 81: 'q', 82: 'r',
    83: 's', 84: 't', 85: 'u', 86: 'v', 87: 'w', 88: 'x', 89: 'y', 90: 'z',
  };

  if (keyMap[keycode]) return keyMap[keycode];
  if (rawcode >= 32 && rawcode < 127) return String.fromCharCode(rawcode);
  return null;
}

function normalizeKey(key) {
  if (!key) return key;
  const keyLower = String(key).toLowerCase();
  const map = {
    backspace: 'backspace', tab: 'tab', enter: 'enter', escape: 'escape',
    space: 'space', delete: 'delete', left: 'left', right: 'right',
    up: 'up', down: 'down'
  };
  return map[keyLower] || keyLower;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) {
    return { headers: [], data: [], totalRows: 0, sheetName: path.basename(filePath) };
  }

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]);
  const data = lines.slice(1).map((line) => parseLine(line));
  return { headers, data, totalRows: data.length, sheetName: path.basename(filePath) };
}

function resolveTemplateVars(template, rowData = {}) {
  let result = String(template ?? '');
  Object.entries(rowData).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value ?? ''));
  });
  return result;
}

ipcMain.handle('macro-start-recording', async (event, options = {}) => {
  if (process.platform === 'darwin') {
    const granted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!granted) {
      systemPreferences.isTrustedAccessibilityClient(true);
      return {
        ok: false,
        needPermission: true,
        message: 'Accessibility permission diperlukan.\n\nLangkah:\n1. Buka System Preferences yang muncul\n2. Klik Privacy & Security → Accessibility\n3. Aktifkan toggle untuk RBA Studio Pro\n4. Restart RBA Studio Pro\n5. Klik Mulai Rekam lagi'
      };
    }
  }

  const hook = getIOHook();
  if (!hook) {
    return { ok: false, message: 'uiohook-napi tidak tersedia. Jalankan npm install uiohook-napi && npx electron-rebuild' };
  }

  try { hook.stop(); } catch (e) {}
  try { hook.removeAllListeners(); } catch (e) {}

  macroEngine.isRecording = true;
  macroEngine.isPlaying = false;
  macroEngine.isPaused = false;
  macroEngine.events = [];
  macroEngine.startTime = Date.now();
  const captureMove = Boolean(options.captureMouseMove);
  const desktopProvider = new ElectronScreenshotProvider();
  let recordQueue = Promise.resolve();

  const queueRecordedClick = (e, double) => {
    recordQueue = recordQueue
      .then(async () => {
        const evt = {
          type: 'mouse_click',
          timestamp: Date.now() - macroEngine.startTime,
          x: e.x,
          y: e.y,
          button: double ? 'left' : (e.button === 1 ? 'left' : e.button === 2 ? 'right' : 'middle'),
          double,
        };

        try {
          const smartTarget = await buildSmartTargetForClick({
            x: evt.x,
            y: evt.y,
            provider: desktopProvider,
          });

          if (smartTarget) {
            evt.smartTarget = smartTarget;
          }
        } catch (err) {
          console.warn('[MCR] smartTarget capture gagal:', err?.message || err);
        }

        macroEngine.events.push(evt);
        try { event.sender.send('macro-event-recorded', evt); } catch (err) {}
        console.log('[MCR] Click:', evt.x, evt.y, evt.button, double ? '(double)' : '');
      })
      .catch((err) => {
        console.warn('[MCR] queueRecordedClick gagal:', err?.message || err);
      });
  };

  hook.on('mouseclick', (e) => {
    if (!macroEngine.isRecording) return;
    queueRecordedClick(e, false);
  });

  hook.on('mousedblclick', (e) => {
    if (!macroEngine.isRecording) return;
    queueRecordedClick(e, true);
  });

  hook.on('mousewheel', (e) => {
    if (!macroEngine.isRecording) return;
    const evt = {
      type: 'scroll',
      timestamp: Date.now() - macroEngine.startTime,
      x: e.x,
      y: e.y,
      delta: e.rotation || e.delta || 3,
      direction: e.direction === 3 ? 'down' : 'up',
    };
    macroEngine.events.push(evt);
    try { event.sender.send('macro-event-recorded', evt); } catch (err) {}
  });

  if (captureMove) {
    let lastMoveTime = 0;
    hook.on('mousemove', (e) => {
      if (!macroEngine.isRecording) return;
      const now = Date.now();
      if (now - lastMoveTime < 50) return;
      lastMoveTime = now;
      const evt = { type: 'mouse_move', timestamp: now - macroEngine.startTime, x: e.x, y: e.y };
      macroEngine.events.push(evt);
      try { event.sender.send('macro-event-recorded', evt); } catch (err) {}
    });
  }

  hook.on('keydown', (e) => {
    if (!macroEngine.isRecording) return;
    const keyName = getKeyName(e.keycode, e.rawcode);
    if (!keyName) return;

    const modifierKeys = [29, 42, 54, 56, 57, 58, 3675, 3676, 3640];
    if (modifierKeys.includes(e.keycode)) return;

    const evt = {
      type: 'key_press',
      timestamp: Date.now() - macroEngine.startTime,
      key: keyName,
      keycode: e.keycode,
      ctrl: Boolean(e.ctrlKey),
      shift: Boolean(e.shiftKey),
      alt: Boolean(e.altKey),
      meta: Boolean(e.metaKey),
    };
    macroEngine.events.push(evt);
    try { event.sender.send('macro-event-recorded', evt); } catch (err) {}
    console.log('[MCR] Key:', keyName, 'ctrl:', e.ctrlKey, 'meta:', e.metaKey);
  });

  try {
    hook.start();
    console.log('[MCR] Recording started with global hooks');
    return { ok: true, message: 'Recording dimulai! Beralih ke Excel/Word dan lakukan aksi.' };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('macro-stop-recording', async () => {
  const hook = getIOHook();
  macroEngine.isRecording = false;
  if (hook && hook.stop) {
    try { hook.stop(); } catch (e) {}
  }
  if (hook && hook.removeAllListeners) {
    try { hook.removeAllListeners(); } catch (e) {}
  }
  const duration = Date.now() - (macroEngine.startTime || Date.now());
  console.log('[MacroRecorder] Recording stopped. Events:', macroEngine.events.length);
  return { ok: true, events: macroEngine.events, duration, count: macroEngine.events.length };
});

ipcMain.handle('macro-get-events', () => ({ ok: true, events: macroEngine.events }));

ipcMain.handle('macro-play', async (event, { events = [], speed = 1.0, loops = 1 }) => {
  let robot;
  try {
    robot = require('robotjs');
  } catch (e) {
    return { ok: false, message: 'robotjs tidak tersedia' };
  }

  macroEngine.isPlaying = true;
  macroEngine.isPaused = false;
  macroEngine.playbackSpeed = speed;
  macroEngine.loopCount = loops;

  const send = (level, message) => {
    try { event.sender.send('macro-play-log', { level, message }); } catch (err) {}
  };

  const isMac = process.platform === 'darwin';
  const smartDetectionSettings = (() => {
    const smart = (loadSettings().smartDetection || {});
    return {
      enabled: smart.enabled !== false,
      minimumConfidence: Number.isFinite(Number(smart.minimumConfidence)) ? Number(smart.minimumConfidence) : 60,
      verifyBeforeClick: smart.verifyBeforeClick !== false,
      waitForElementTimeout: Number.isFinite(Number(smart.waitForElementTimeout)) ? Number(smart.waitForElementTimeout) : 5000,
      retryOnLowConfidence: Number.isFinite(Number(smart.retryOnLowConfidence)) ? Number(smart.retryOnLowConfidence) : 2,
      allowRawCoordsAsFallback: smart.allowRawCoordsAsFallback !== false,
    };
  })();

  const isMobileStep = (evt = {}) => {
    const mode = String(evt.context || evt.deviceType || '').toLowerCase();
    return mode === 'mobile';
  };

  const resolveSmartClickTarget = async (evt) => {
    const smartTarget = evt?.smartTarget;
    if (!smartDetectionSettings.enabled || !smartTarget) {
      return { x: evt.x, y: evt.y, source: 'raw' };
    }

    const provider = isMobileStep(evt)
      ? new AdbScreenshotProvider({ deviceId: evt.deviceId || evt.device || null })
      : new ElectronScreenshotProvider();

    const detector = new SmartDetector(provider, {
      minimumConfidence: smartDetectionSettings.minimumConfidence,
      retryOnLowConfidence: smartDetectionSettings.retryOnLowConfidence,
      waitForElementTimeout: smartDetectionSettings.waitForElementTimeout,
    });

    const fallbackTarget = { x: evt.x, y: evt.y, source: 'raw' };

    try {
      const waitResult = await detector.waitForElement(smartTarget, smartDetectionSettings.waitForElementTimeout);
      if (!waitResult.found) {
        throw new Error('Element belum terlihat pada waktu tunggu');
      }

      const screenshot = await provider.capture();
      const deviceSize = await provider.getDeviceSize();
      const result = await detector.findElement(smartTarget, screenshot, deviceSize);

      if (!result.found) {
        throw new Error('SmartDetector tidak menemukan elemen');
      }

      const isRegionOnly = result.layer === 4 && !smartTarget.regionHint && !smartTarget.regionPercent;
      if (isRegionOnly) {
        throw new Error('Smart detection hanya menyediakan fallback region');
      }

      if (result.confidence < smartDetectionSettings.minimumConfidence) {
        throw new Error(`Confidence ${result.confidence} di bawah threshold ${smartDetectionSettings.minimumConfidence}`);
      }

      if (smartDetectionSettings.verifyBeforeClick) {
        const verified = await detector.verifyElementStillVisible({ x: result.x, y: result.y }, smartTarget, screenshot);
        if (!verified.valid) {
          throw new Error('Verifikasi visual gagal');
        }
      }

      send('INFO', `Smart klik ${result.layer} (${result.x},${result.y}) confidence=${result.confidence}`);
      return { x: result.x, y: result.y, source: 'smart', confidence: result.confidence };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      send('WARN', `Smart detection fallback: ${message}`);

      if (!smartDetectionSettings.allowRawCoordsAsFallback) {
        throw err;
      }

      return fallbackTarget;
    }
  };

  for (let loop = 0; loop < loops; loop++) {
    if (!macroEngine.isPlaying) break;
    send('INFO', `Loop ${loop + 1}/${loops} dimulai`);

    let lastTimestamp = 0;
    for (const evt of events) {
      if (!macroEngine.isPlaying) break;
      while (macroEngine.isPaused) {
        await sleep(100);
      }

      const delay = Math.max(0, (evt.timestamp - lastTimestamp) / speed);
      if (delay > 0) await sleep(Math.min(delay, 5000));
      lastTimestamp = evt.timestamp;

      try {
        if (evt.type === 'mouse_click') {
          const target = await resolveSmartClickTarget(evt);
          robot.moveMouse(target.x, target.y);
          await sleep(50);
          robot.mouseClick(evt.button || 'left', evt.double);
          send('INFO', `Klik ${evt.button || 'left'} (${target.x},${target.y})${target.source === 'smart' ? ' [smart]' : ''}`);
        } else if (evt.type === 'mouse_move') {
          robot.moveMouse(evt.x, evt.y);
        } else if (evt.type === 'scroll') {
          robot.scrollMouse(0, (evt.direction === 'down' ? 1 : -1) * (evt.delta || 3));
          send('INFO', `Scroll ${evt.direction} (${evt.x},${evt.y})`);
        } else if (evt.type === 'key_press') {
          const mods = [];
          if (evt.ctrl) mods.push(isMac ? 'command' : 'control');
          if (evt.shift) mods.push('shift');
          if (evt.alt) mods.push('alt');
          if (evt.meta) mods.push('command');

          if (evt.key && evt.key.length === 1) {
            if (mods.length > 0) {
              robot.keyTap(evt.key.toLowerCase(), mods);
            } else {
              robot.typeString(evt.key);
            }
          } else {
            robot.keyTap(normalizeKey(evt.key), mods);
          }

          send('INFO', `Tekan: ${[...mods, evt.key].filter(Boolean).join('+')}`);
        }
      } catch (err) {
        send('ERROR', `Step gagal: ${err.message}`);
      }
    }

    if (loop < loops - 1) {
      send('INFO', 'Menunggu sebelum loop berikutnya...');
      await sleep(500);
    }
  }

  macroEngine.isPlaying = false;
  send('SUCCESS', 'Playback selesai!');
  return { ok: true };
});

ipcMain.handle('macro-stop-play', () => {
  macroEngine.isPlaying = false;
  return { ok: true };
});

ipcMain.handle('macro-pause-play', () => {
  macroEngine.isPaused = true;
  return { ok: true };
});

ipcMain.handle('macro-resume-play', () => {
  macroEngine.isPaused = false;
  return { ok: true };
});

ipcMain.handle('macro-save', async (event, { name, events = [] }) => {
  try {
    const macroDir = path.join(app.getPath('userData'), 'macros');
    if (!fs.existsSync(macroDir)) fs.mkdirSync(macroDir, { recursive: true });
    const id = 'macro_' + Date.now();
    const data = {
      id,
      name,
      events,
      savedAt: new Date().toISOString(),
      eventCount: events.length,
    };
    fs.writeFileSync(path.join(macroDir, id + '.json'), JSON.stringify(data, null, 2));
    return { ok: true, id };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('macro-list', async () => {
  try {
    const macroDir = path.join(app.getPath('userData'), 'macros');
    if (!fs.existsSync(macroDir)) return { ok: true, macros: [] };
    const files = fs.readdirSync(macroDir).filter((file) => file.endsWith('.json'));
    const macros = files
      .map((file) => {
        try { return JSON.parse(fs.readFileSync(path.join(macroDir, file), 'utf8')); } catch (err) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    return { ok: true, macros };
  } catch (err) {
    return { ok: true, macros: [] };
  }
});

ipcMain.handle('macro-load', async (event, id) => {
  try {
    const macroDir = path.join(app.getPath('userData'), 'macros');
    const filePath = path.join(macroDir, id + '.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('macro-delete', async (event, id) => {
  try {
    const macroDir = path.join(app.getPath('userData'), 'macros');
    fs.unlinkSync(path.join(macroDir, id + '.json'));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('macro-check-permission', () => {
  if (process.platform !== 'darwin') {
    return { ok: true, granted: true };
  }

  try {
    return { ok: true, granted: systemPreferences.isTrustedAccessibilityClient(false) };
  } catch (err) {
    return { ok: true, granted: false, message: err.message || String(err) };
  }
});

ipcMain.handle('macro-request-permission', () => {
  if (process.platform !== 'darwin') {
    return { ok: true, granted: true };
  }

  try {
    systemPreferences.isTrustedAccessibilityClient(true);
    return { ok: true, granted: systemPreferences.isTrustedAccessibilityClient(false) };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
});

ipcMain.handle('open-file-dialog', async (e, options) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  return await dialog.showOpenDialog(parent, options);
});

ipcMain.handle('dialog:openFile', async (e, options = {}) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  return await dialog.showOpenDialog(parent, {
    properties: ['openFile'],
    filters: options.filters || [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    ...options,
  });
});

ipcMain.handle('browse-file', async (event, filters) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters || [
      { name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return {
    ok: !result.canceled,
    filePath: result.filePaths[0] || null
  };
});

ipcMain.handle('check-macos-permissions', () => {
  if (process.platform !== 'darwin') {
    return { ok: true, accessibility: true, message: 'Accessibility tidak diperlukan di platform ini' };
  }

  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    return {
      ok: true,
      accessibility: trusted,
      message: trusted
        ? 'Accessibility OK'
        : 'Accessibility belum diizinkan — paste ke Word masih bisa via native AppleScript'
    };
  } catch (e) {
    return { ok: true, accessibility: false, message: e.message || 'Gagal memeriksa permission' };
  }
});

ipcMain.handle('open-accessibility-settings', () => {
  if (process.platform !== 'darwin') return { ok: true };

  exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
  return { ok: true };
});

ipcMain.handle('preview-excel', async (event, { filePath, sheetName, maxRows }) => {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[sheetName || wb.SheetNames[0]];
    if (!sheet) return { ok: false, message: 'Sheet tidak ditemukan' };
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return { ok: true, rows: all.slice(0, (maxRows || 10) + 1) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('excel-loop-control', (event, { action }) => {
  if (action === 'stop') {
    excelLoopState.stopped = true;
    excelLoopState.running = false;
  }
  if (action === 'pause') {
    excelLoopState.paused = true;
  }
  if (action === 'resume') {
    excelLoopState.paused = false;
  }
  return { ok: true };
});

ipcMain.handle('run-excel-loop', async (event, { config }) => {
  const send = (level, msg) => {
    try { event.sender.send('excel-loop-log', { level, message: msg }); } catch (e) {}
  };
  const updateStats = (data) => {
    try { event.sender.send('excel-loop-stats', data); } catch (e) {}
  };

  excelLoopState = { running: true, paused: false, stopped: false };

  try {
    const XLSX = require('xlsx');
    send('INFO', 'Membaca file Excel: ' + config.excelPath);

    let workbook;
    try {
      workbook = XLSX.readFile(config.excelPath);
    } catch (e) {
      send('ERROR', 'Gagal baca Excel: ' + e.message);
      return { ok: false, message: e.message };
    }

    const sheetName = config.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      send('ERROR', 'Sheet "' + sheetName + '" tidak ditemukan. Sheet tersedia: ' + workbook.SheetNames.join(', '));
      return { ok: false };
    }

    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const startRow = parseInt(config.startRow) || 2;
    const endRow = Math.min(parseInt(config.endRow) || 100, allRows.length);
    const colIdx = (config.targetColumn || 'A').toUpperCase().charCodeAt(0) - 65;
    const totalLoops = endRow - startRow + 1;

    send('INFO', 'Excel berhasil dibaca. Total baris data: ' + allRows.length);
    send('INFO', 'Akan proses baris ' + startRow + ' sampai ' + endRow + ' (' + totalLoops + ' baris)');

    let robot = null;
    try {
      robot = require('robotjs');
    } catch (e) {
      send('WARN', 'robotjs tidak tersedia — aksi keyboard/mouse desktop tidak bisa dijalankan');
      send('WARN', 'Untuk aktifkan: npm install robotjs && npx electron-rebuild');
    }

    let processed = 0;
    let skipped = 0;

    for (let rowIdx = startRow; rowIdx <= endRow; rowIdx++) {
      if (excelLoopState.stopped) {
        send('INFO', 'Loop dihentikan oleh user.');
        break;
      }
      while (excelLoopState.paused) {
        await sleep(300);
        if (excelLoopState.stopped) break;
      }

      const loopNum = rowIdx - startRow + 1;
      const excelRow = allRows[rowIdx - 1] || [];
      const cellValue = String(excelRow[colIdx] ?? '');

      if (!cellValue.trim() && config.skipEmptyRows) {
        send('INFO', 'Baris ' + rowIdx + ': kosong, dilewati');
        skipped++;
        updateStats({ currentLoop: loopNum, totalLoops, currentRow: rowIdx, processed, skipped, currentCellValue: '' });
        continue;
      }

      const rowData = {};
      excelRow.forEach((val, i) => {
        rowData[String.fromCharCode(65 + i)] = String(val ?? '');
      });

      send('INFO', '── Loop ' + loopNum + '/' + totalLoops + ' | Baris ' + rowIdx + ' ──');
      send('INFO', 'Nilai: "' + cellValue + '"');

      clipboard.writeText(cellValue);
      send('INFO', 'Copy ke clipboard: "' + cellValue + '"');

      updateStats({ currentLoop: loopNum, totalLoops, currentRow: rowIdx, processed, skipped, currentCellValue: cellValue });

      const target = config.targetConfig || {};
      if (target.type === 'desktop_exe' && target.windowTitle) {
        try {
          await focusDesktopWindow(target.windowTitle, send);
          await sleep(target.focusDelay || 300);
        } catch (e) {
          send('ERROR', 'Gagal fokus window "' + target.windowTitle + '": ' + e.message);
          if (config.stopOnError) break;
          skipped++;
          continue;
        }
      }

      let rowOk = true;
      const steps = config.normalFlowSteps || [];

      for (const step of steps) {
        if (step.aktif === false) continue;
        if (excelLoopState.stopped) break;

        send('INFO', 'Step: "' + (step.label || step.type) + '"');

        try {
          await executeStep(step, { cellValue, rowData, rowIdx }, robot, send, config);
          await sleep(step.delayAfter || config.delaySettings?.betweenSteps || 200);
        } catch (e) {
          send('ERROR', 'Step "' + step.label + '" gagal: ' + e.message);
          rowOk = false;
          if (config.stopOnError) {
            excelLoopState.stopped = true;
            break;
          }
        }
      }

      if (rowOk) {
        processed++;
        send('INFO', 'Baris ' + rowIdx + ' selesai ✓');
      } else {
        skipped++;
      }

      updateStats({ currentLoop: loopNum, totalLoops, currentRow: rowIdx, processed, skipped, currentCellValue: cellValue });

      if (rowIdx < endRow) {
        await sleep(config.delayBetweenRows || 500);
      }
    }

    send('SUCCESS', 'Eksekusi selesai! ' + processed + ' berhasil, ' + skipped + ' dilewati/error');
    excelLoopState.running = false;
    return { ok: true, processed, skipped };
  } catch (e) {
    send('ERROR', 'Error tidak terduga: ' + e.message);
    excelLoopState.running = false;
    return { ok: false, message: e.message };
  }
});

async function focusDesktopWindow(windowTitle, send) {
  const escaped = windowTitle.replace(/'/g, "''");
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WF {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc p, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public static string Focus(string q) {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h,l) => {
      if(!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h,sb,256);
      if(sb.ToString().ToLower().Contains(q.ToLower())){f=h;return false;}
      return true;
    }, IntPtr.Zero);
    if(f==IntPtr.Zero) return "NOT_FOUND";
    if(IsIconic(f)) ShowWindow(f,9);
    ShowWindow(f,5); SetForegroundWindow(f);
    return "OK";
  }
}
"@
[WF]::Focus('${escaped}')
  `.trim();

  return new Promise((resolve, reject) => {
    exec('powershell -NoProfile -Command "' + script.replace(/\n/g,' ').replace(/"/g,'\\"') + '"',
      { timeout: 5000 },
      (err, stdout) => {
        const result = stdout.trim();
        if (result === 'NOT_FOUND') {
          reject(new Error('Window "' + windowTitle + '" tidak ditemukan. Pastikan app sudah terbuka.'));
        } else {
          if (send) send('INFO', 'Window difokuskan: "' + windowTitle + '"');
          resolve(true);
        }
      }
    );
  });
}

function buildPasteScript(appName) {

  if (appName === 'Microsoft Word') {
    // Word AppleScript: type text langsung ke selection
    // Tidak butuh Accessibility, tidak butuh System Events
    return `
tell application "Microsoft Word"
  activate
  delay 0.4
  set clipContent to (do shell script "pbpaste")
  type text clipContent into (get selection of active document)
end tell`;
  }

  if (appName === 'Microsoft Excel') {
    return `
tell application "Microsoft Excel"
  activate
  delay 0.4
  set clipContent to (do shell script "pbpaste")
  set value of selection to clipContent
end tell`;
  }

  if (appName === 'Microsoft PowerPoint') {
    return `
tell application "Microsoft PowerPoint"
  activate
  delay 0.4
end tell
tell application "System Events"
  tell process "Microsoft PowerPoint"
    keystroke "v" using {command down}
  end tell
end tell`;
  }

  if (appName === 'Google Chrome' || appName === 'Arc' || appName === 'Safari') {
    // Browser: inject via JavaScript ke focused element
    return `
tell application "${appName}"
  activate
  delay 0.4
  set clipContent to (do shell script "pbpaste")
  execute front window's active tab javascript "
    (function() {
      var el = document.activeElement;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable)) {
        el = document.querySelector('input:not([type=hidden]), textarea');
      }
      if (el) {
        var start = el.selectionStart || 0;
        var end = el.selectionEnd || 0;
        var val = el.value || el.innerText || '';
        var newVal = val.substring(0, start) + '" & clipContent & "' + val.substring(end);
        try {
          var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                       Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, newVal);
          else el.value = newVal;
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
        } catch(e) {
          el.value = newVal;
        }
      }
    })()
  "
end tell`;
  }

  // App lain: coba keystroke via System Events (butuh Accessibility)
  return `
tell application "${appName}"
  activate
end tell
delay 0.5
tell application "System Events"
  tell process "${appName}"
    keystroke "v" using {command down}
  end tell
end tell`;
}

function buildMenuPasteScript(appName) {
  return `
tell application "${appName}"
  activate
end tell
delay 0.5
tell application "System Events"
  tell process "${appName}"
    click menu item "Paste" of menu "Edit" of menu bar item "Edit" of menu bar 1
  end tell
end tell`;
}

function buildTypeScript(appName, text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (appName === 'Microsoft Word') {
    return `
tell application "Microsoft Word"
  activate
end tell
delay 0.4
tell application "Microsoft Word"
  type text "${escaped}"
end tell`;
  }
  if (appName === 'Microsoft Excel') {
    return `
tell application "Microsoft Excel"
  activate
end tell
delay 0.4
tell application "Microsoft Excel"
  type text "${escaped}"
end tell`;
  }
  if (appName === 'Microsoft PowerPoint') {
    return `
tell application "Microsoft PowerPoint"
  activate
end tell
delay 0.4
tell application "Microsoft PowerPoint"
  type text "${escaped}"
end tell`;
  }

  return `
tell application "${appName}"
  activate
end tell
delay 0.4
tell application "${appName}"
  type text "${escaped}"
end tell`;
}

async function executeStep(step, context, robot, send, config) {
  const resolveVars = (text) => {
    if (!text) return '';
    let r = String(text);
    Object.entries(context.rowData || {}).forEach(([col, val]) => {
      r = r.replace(new RegExp('{{col_' + col + '}}', 'g'), val);
    });
    r = r.replace(/{{excel_value}}/g, context.cellValue || '');
    r = r.replace(/{{row_number}}/g, String(context.rowIdx || ''));
    return r;
  };

  const runAppleScript = (script) => new Promise((res, rej) => {
    exec("osascript -e '" + script.replace(/'/g, "'\"'\"'") + "'", { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) rej(new Error(stderr || err.message));
      else res(stdout.trim());
    });
  });

  const runPowerShell = (script) => new Promise((res, rej) => {
    exec('powershell -NoProfile -Command "' + script.replace(/"/g, '\\"') + '"', { timeout: 8000 }, (err, stdout) => {
      if (err) rej(err);
      else res(stdout.trim());
    });
  });

  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const targetTitle = resolveVars(step.windowTitle || config.targetConfig?.windowTitle || '');

  switch (step.type) {
    case 'fokus_window': {
      const title = resolveVars(step.windowTitle || '');
      if (!title) throw new Error('Nama window kosong di step Fokus Window');

      if (isMac) {
        const appName = getMacAppName(title);
        try {
          await runAppleScript(`tell application "${appName}" to activate\ndelay 0.4`);
          send('INFO', 'Window difokuskan: "' + appName + '"');
        } catch (e) {
          await runAppleScript(`tell application "System Events"\n  set frontmost of (first process whose name contains "${title}") to true\nend tell\ndelay 0.4`);
          send('INFO', 'Window difokuskan via System Events: "' + title + '"');
        }
      } else if (isWin) {
        await focusWindowsApp(title, send, runPowerShell);
      }
      await sleep(step.delayAfter || 400);
      break;
    }

    case 'klik_koordinat': {
      if (!robot) throw new Error('robotjs tidak tersedia');
      const x = parseInt(step.x) || 0;
      const y = parseInt(step.y) || 0;
      robot.moveMouse(x, y);
      await sleep(80);
      if (step.clickType === 'double') robot.mouseClick('left', true);
      else robot.mouseClick(step.clickType || 'left');
      send('INFO', 'Klik ' + (step.clickType || 'kiri') + ' di (' + x + ',' + y + ')');
      break;
    }

    case 'paste_atau_ketik': {
      await sleep(config.delaySettings?.beforePaste || 200);

      if (isMac) {
        const appName = getMacAppName(targetTitle);

        if (step.method === 'type') {
          const text = resolveVars(step.text || '');
          if (!text) {
            send('WARN', 'Teks kosong, dilewati');
            break;
          }

          try {
            await runAppleScript(buildTypeScript(appName, text));
            send('INFO', 'Ketik teks ke "' + appName + '"');
          } catch (e) {
            send('ERROR', 'Ketik gagal: ' + e.message);
            throw e;
          }
        } else {
          try {
            await runAppleScript(buildPasteScript(appName));
            send('INFO', 'Paste ke "' + appName + '" berhasil');
          } catch (e) {
            if (e.message && e.message.includes('1002')) {
              send('ERROR', 'PERMISSION DENIED: ' + e.message);
              send('WARN', '>>> Solusi: Buka System Preferences → Privacy & Security → Accessibility');
              send('WARN', '>>> Tambahkan "RBA Studio Pro" ke daftar. Atau coba metode lain di bawah.');
              try {
                await runAppleScript(buildMenuPasteScript(appName));
                send('INFO', 'Paste via menu Edit berhasil (fallback)');
              } catch (e2) {
                send('ERROR', 'Semua metode paste gagal. Grant Accessibility permission.');
                throw e2;
              }
            } else {
              send('ERROR', 'Paste gagal: ' + e.message);
              throw e;
            }
          }
        }
      } else if (isWin) {
        const targetTitle = resolveVars(step.windowTitle || config.targetConfig?.windowTitle || '');
        if (targetTitle) await focusWindowsApp(targetTitle, send, runPowerShell);
        await sleep(200);
        if (robot) {
          robot.keyTap('v', ['control']);
        } else {
          await runPowerShell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")');
        }
        send('INFO', 'Paste (Ctrl+V) ke "' + targetTitle + '"');
      }

      await sleep(step.delayAfter || 300);
      break;
    }

    case 'tekan_tombol': {
      const key = step.key || 'enter';
      const repeat = parseInt(step.repeat) || 1;
      const keyCodeMap = { enter: 36, tab: 48, escape: 53, space: 49, backspace: 51, delete: 117, up: 126, down: 125, left: 123, right: 124 };

      for (let i = 0; i < repeat; i++) {
        if (isMac) {
          const appName = getMacAppName(targetTitle);
          const script = targetTitle
            ? `tell application "${appName}" to activate\ndelay 0.2\ntell application "System Events"\n  tell process "${appName}"\n    key code ${keyCodeMap[key] || 36}\n  end tell\nend tell`
            : `tell application "System Events" to key code ${keyCodeMap[key] || 36}`;

          try {
            await runAppleScript(script);
          } catch (e) {
            if (robot) robot.keyTap(key, step.modifiers || []);
          }
        } else if (robot) {
          robot.keyTap(key, step.modifiers || []);
        }
        await sleep(80);
      }
      send('INFO', 'Tekan: ' + key + (repeat > 1 ? ' x' + repeat : ''));
      break;
    }

    case 'delay': {
      const ms = parseInt(step.duration) || 1000;
      send('INFO', 'Delay ' + ms + 'ms');
      await sleep(ms);
      break;
    }

    default:
      send('WARN', 'Step "' + step.type + '" belum diimplementasi');
  }
}

function getMacAppName(title) {
  if (!title) return title;
  const lower = title.toLowerCase();
  if (lower.includes('microsoft word') || lower.includes('word')) return 'Microsoft Word';
  if (lower.includes('microsoft excel') || lower.includes('excel')) return 'Microsoft Excel';
  if (lower.includes('google chrome') || lower.includes('chrome')) return 'Google Chrome';
  if (lower.includes('safari')) return 'Safari';
  if (lower.includes('arc')) return 'Arc';
  if (lower.includes('firefox')) return 'Firefox';
  if (lower.includes('edge')) return 'Microsoft Edge';
  if (lower.includes('terminal')) return 'Terminal';
  if (lower.includes('finder')) return 'Finder';
  return title;
}

async function focusWindowsApp(title, send, runPowerShell) {
  const escaped = title.replace(/'/g, "''");
  await runPowerShell(`$h = (Get-Process | Where-Object { $_.MainWindowTitle -like '*${escaped}*' } | Select-Object -First 1).MainWindowHandle; if ($h) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class WF { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }'; [WF]::ShowWindow([IntPtr]$h, 9); [WF]::SetForegroundWindow([IntPtr]$h) }`);
  if (send) send('INFO', 'Window difokuskan (Win): "' + title + '"');
  await sleep(300);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

ipcMain.handle('excel-loop-pause', async () => {
  excelLoopState.paused = true;
  return { success: true };
});

ipcMain.handle('excel-loop-resume', async () => {
  excelLoopState.paused = false;
  return { success: true };
});

ipcMain.handle('capture-click-coordinates', async () => {
  try {
    const coords = await WinAuto.captureClickCoordinates(4000);
    if (!coords) return { success: false, error: 'Timeout menunggu klik koordinat' };
    return { success: true, coords };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('excel-loop-stop', async () => {
  currentExcelLoopEngine?.stop();
  currentExcelLoopEngine = null;
  excelLoopState.stopped = true;
  excelLoopState.running = false;
  return { success: true };
});

// ─────────────────────────────────────────
// CLIPBOARD HANDLERS
// ─────────────────────────────────────────
ipcMain.handle('set-clipboard', async (event, text) => {
  try {
    require('electron').clipboard.writeText(String(text || ''));
    return { ok: true, message: 'Clipboard updated' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('get-clipboard', async () => {
  try {
    const text = require('electron').clipboard.readText();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// ─────────────────────────────────────────
// BROWSER ELEMENT CONTROL
// ─────────────────────────────────────────
ipcMain.handle('click-element', async (event, { selector, x, y }) => {
  try {
    // If selector provided, try to click element via CDP
    if (selector) {
      const BM = require('./src/services/BrowserManager');
      const sessions = BM.getSessions?.() || [];
      if (sessions.length > 0) {
        const session = sessions[0];
        const result = await BrowserManager.click(session.profileKey, selector);
        return { ok: result.success, message: result.message || 'Element clicked' };
      }
    }

    // Fallback: use robotjs for coordinate click
    try {
      const robot = require('robotjs');
      if (robot && x !== undefined && y !== undefined) {
        robot.moveMouse(Math.round(x), Math.round(y));
        robot.mouseClick();
        return { ok: true, message: 'Clicked via robotjs' };
      }
    } catch (e) {
      // robotjs not available
    }

    return { ok: false, message: 'Cannot click element (no valid target)' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('paste-clipboard', async () => {
  try {
    const robot = require('robotjs');
    if (robot) {
      robot.keyTap('v', ['control']);
      return { ok: true, message: 'Pasted via Ctrl+V' };
    }
  } catch (e) {
    // robotjs not available
  }

  return { ok: false, message: 'robotjs not available for paste' };
});

ipcMain.handle('test-browser-url', async (event, { url, matchMode, port }) => {
  try {
    await BrowserManager.connect(port || 9222);
    const tab = await BrowserManager.focusTabByUrl(url, matchMode || 'contains');
    return { ok: true, message: `Tab ditemukan: "${tab.title}" — ${tab.url}` };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

ipcMain.handle('test-focus-window', async (event, { windowTitle, exeName, restoreIfMinimized }) => {
  try {
    await WinAuto.focusWindowByTitle(windowTitle || exeName, restoreIfMinimized !== false);
    return { ok: true, message: `Window "${windowTitle || exeName}" berhasil difokuskan` };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

ipcMain.handle('scan-open-windows', async () => {
  try {
    const windows = await WinAuto.listOpenWindows();
    return { ok: true, windows };
  } catch (e) {
    return { ok: false, message: e.message || String(e), windows: [] };
  }
});

ipcMain.handle('capture-click-coordinate', async () => {
  try {
    const coords = await WinAuto.captureClickCoordinates(4000);
    if (!coords) return { ok: false, message: 'Timeout menunggu klik koordinat' };
    return { ok: true, ...coords };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

ipcMain.handle('open-chrome-debug', async (event, { port }) => {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      exec(`"${p}" --remote-debugging-port=${port || 9222}`);
      return { ok: true, message: `Browser dibuka dengan port ${port || 9222}` };
    }
  }
  return { ok: false, message: 'Chrome/Edge tidak ditemukan di lokasi default' };
});

// NEW: Remove any existing listeners to prevent accumulation
ipcMain.removeAllListeners('run-flow');
ipcMain.removeAllListeners('stop-flow');

ipcMain.on('run-flow', async (event, flowData) => { // CHANGED
    await runFlow(flowData, event.sender);
});

ipcMain.on('stop-flow', () => { // CHANGED
    stopFlow();
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width:1600, height:1020, minWidth:1200, minHeight:700,
        title:"RBA Designer Pro — Studio 2.0",
        icon: path.join(__dirname, 'RBA_logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            nodeIntegration: true,
            webSecurity: false,
        },
        backgroundColor:'#080d17'
    });
    
    mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

// ─────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────
ipcMain.on("open-external",   (e,url)=>shell.openExternal(url));
ipcMain.on("get-devices",     (e)=>e.reply("device-list", pool.refresh()));

ipcMain.handle('browser:get-or-create-session', async (e, { profileKey, opts }) => {
    try {
        const { session, status } = await BrowserManager.getOrCreate(profileKey, opts);
        return { success:true, profileKey: session.profileKey, status };
    } catch (err) {
        return { success:false, error: err.message || String(err) };
    }
});

ipcMain.handle('browser:get-session', async (e, { profileKey }) => {
    const session = BrowserManager.get(profileKey);
    if (!session) return { success:false, alive:false, error:'Browser session tidak ditemukan' };
    const alive = await BrowserManager._isAlive(session);
    return { success:true, alive, profileKey: session.profileKey, lastUrl: session.lastUrl };
});

ipcMain.handle('browser:navigate', async (e, { profileKey, url, timeoutMs }) => {
    return await BrowserManager.navigate(profileKey, url, timeoutMs);
});

ipcMain.handle('browser:click', async (e, { profileKey, selector, clickType, timeoutMs }) => {
    return await BrowserManager.click(profileKey, { selector, clickType, timeoutMs });
});

ipcMain.handle('browser:close-session', async (e, { profileKey }) => {
    return await BrowserManager.close(profileKey);
});

ipcMain.handle("get-saved-workflows", ()=>loadSavedWorkflows());
ipcMain.handle("save-workflow", (e,wf)=>{
    const s=loadSavedWorkflows(); const idx=s.findIndex(i=>i.id===wf.id);
    if(idx>=0) s[idx]=wf; else s.unshift(wf);
    return saveWorkflowsFile(s);
});
ipcMain.handle("load-workflow",   (e,id)=>loadSavedWorkflows().find(i=>String(i.id)===String(id))||null);
ipcMain.handle("delete-workflow", (e,id)=>saveWorkflowsFile(loadSavedWorkflows().filter(i=>String(i.id)!==String(id))));
ipcMain.handle("get-settings",    ()=>loadSettings());
ipcMain.handle("save-settings",   (e,s)=>saveSettingsFile(s));

// New: save-flow handler that writes individual flow files to userData/flows
ipcMain.handle('save-flow', async (event, flowData) => {
  try {
    const flowsDir = path.join(app.getPath('userData'), 'flows');
    if (!fs.existsSync(flowsDir)) {
      fs.mkdirSync(flowsDir, { recursive: true });
    }
    const fileName = flowData.id + '.json';
    const filePath = path.join(flowsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(flowData, null, 2), 'utf-8');
    console.log('Flow saved:', filePath);
    return { ok: true, filePath };
  } catch (e) {
    console.error('save-flow error:', e);
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('get-saved-flows', async () => {
  try {
    const flowsDir = path.join(app.getPath('userData'), 'flows');
    if (!fs.existsSync(flowsDir)) return [];
    return fs.readdirSync(flowsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(flowsDir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt || b.updatedAt || Date.now()) - new Date(a.savedAt || a.updatedAt || Date.now()));
  } catch (e) {
    console.error('get-saved-flows error:', e);
    return [];
  }
});

ipcMain.handle('load-flow', async (event, id) => {
  try {
    const flowsDir = path.join(app.getPath('userData'), 'flows');
    const filePath = path.join(flowsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error('load-flow error:', e);
    return null;
  }
});

ipcMain.handle('wa-connect', async (event) => {
  try {
    if (waClient) {
      try {
        await waClient.destroy();
      } catch (error) {
        // ignore
      }
      waClient = null;
    }

    waClient = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(app.getPath('userData'), 'wa-session')
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
    });

    waClient.on('qr', async (qr) => {
      try {
        const img = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
        event.sender.send('wa-qr', img);
      } catch (error) {
        console.error('[wa] Failed to render QR:', error);
      }
    });

    waClient.on('ready', () => {
      try {
        event.sender.send('wa-connected', {
          name: waClient.info.pushname,
          number: waClient.info.wid.user
        });
      } catch (error) {
        console.error('[wa] Failed to emit ready event:', error);
      }
    });

    waClient.on('disconnected', (reason) => {
      try {
        event.sender.send('wa-disconnected', reason);
      } catch (error) {
        console.error('[wa] Failed to emit disconnect event:', error);
      }
    });

    await waClient.initialize();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});

ipcMain.handle('wa-disconnect', async () => {
  try {
    if (waClient) {
      await waClient.destroy();
      waClient = null;
    }
    waEngine = { running: false, paused: false, stopped: false, processed: 0, failed: 0, total: 0, checkpoint: [] };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});

ipcMain.handle('wa-get-groups', async () => {
  if (!waClient) {
    return { ok: false, message: 'WhatsApp belum terhubung' };
  }

  try {
    const chats = await waClient.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id?._serialized || chat.id,
        name: chat.name || 'Grup Tanpa Nama',
        memberCount: chat.groupMetadata?.participants?.length || 0
      }));
    return { ok: true, groups };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});

ipcMain.handle('wa-parse-excel', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') {
      const parsed = parseCsvFile(filePath);
      return { ok: true, headers: parsed.headers, data: parsed.data, totalRows: parsed.totalRows, sheetName: parsed.sheetName };
    }

    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    const headers = rows[0] || [];
    const data = rows.slice(1);
    return { ok: true, headers, data, totalRows: data.length, sheetName };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});

ipcMain.handle('wa-run', async (event, { recipients = [], template = '', options = {} }) => {
  if (!waClient) {
    return { ok: false, message: 'WhatsApp belum terhubung. Scan QR dulu.' };
  }

  const send = (type, data = {}) => {
    try {
      event.sender.send('wa-progress', { type, ...data });
    } catch (error) {
      // ignore
    }
  };

  const delayMin = parseInt(options.delayMin, 10) || 8000;
  const delayMax = parseInt(options.delayMax, 10) || 15000;
  const randomDelay = () => delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));

  waEngine = {
    running: true,
    paused: false,
    stopped: false,
    processed: 0,
    failed: 0,
    total: recipients.length,
    checkpoint: []
  };

  const validRecipients = recipients.filter((item) => item && (item.valid !== false));

  for (let i = 0; i < validRecipients.length; i++) {
    if (waEngine.stopped) break;
    while (waEngine.paused) {
      await sleep(300);
    }

    const recipient = validRecipients[i];
    const displayName = recipient.displayName || recipient.id || recipient.normalized || 'Penerima';
    send('current', { index: i, name: displayName, id: recipient.id || recipient.normalized || '' });

    const message = resolveTemplateVars(template, recipient.rowData || {});
    const chatId = recipient.type === 'group'
      ? recipient.id
      : `${String(recipient.normalized || recipient.id || '').replace(/\+/g, '')}@c.us`;

    try {
      await waClient.sendMessage(chatId, message);
      waEngine.processed += 1;
      waEngine.checkpoint.push({ id: recipient.id || recipient.normalized || '', status: 'success', time: new Date().toISOString() });
      send('success', { index: i, id: recipient.id || recipient.normalized || '', processed: waEngine.processed });
    } catch (error) {
      waEngine.failed += 1;
      waEngine.checkpoint.push({ id: recipient.id || recipient.normalized || '', status: 'failed', error: error.message || String(error), time: new Date().toISOString() });
      send('failed', { index: i, id: recipient.id || recipient.normalized || '', failed: waEngine.failed, error: error.message || String(error) });
    }

    if (i < validRecipients.length - 1) {
      const delayMs = randomDelay();
      send('delay', { ms: delayMs });
      await sleep(delayMs);
    }
  }

  waEngine.running = false;
  send('done', { processed: waEngine.processed, failed: waEngine.failed, total: waEngine.total });
  return { ok: true, processed: waEngine.processed, failed: waEngine.failed };
});

ipcMain.handle('wa-pause', () => {
  waEngine.paused = true;
  return { ok: true };
});

ipcMain.handle('wa-resume', () => {
  waEngine.paused = false;
  return { ok: true };
});

ipcMain.handle('wa-stop', () => {
  waEngine.stopped = true;
  waEngine.running = false;
  waEngine.paused = false;
  return { ok: true };
});

ipcMain.handle('wa-export-report', async (event, { data = [], filename = 'wa-report.xlsx' }) => {
  try {
    const saveResult = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (saveResult.canceled) {
      return { ok: false };
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.map((row) => ({
      Name: row.name,
      Number: row.number || row.id || '',
      Status: row.status,
      Time: row.time,
      Error: row.error || ''
    })));

    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, saveResult.filePath);
    return { ok: true, filePath: saveResult.filePath };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});


// ADB command execution
ipcMain.handle("run-adb", (e, { device, args })=>{
    return new Promise(res=>pool.adb(args, device, res));
});

// scrcpy launch
ipcMain.handle("launch-scrcpy", (e, { device, args })=>{
    return pool.launchScrcpy(device, args||'');
});

// ADB device check (detailed)
ipcMain.handle("adb-info", ()=>{
    const adb = pool.findAdb();
    const devices = adb ? pool.refresh() : [];
    return { found:!!adb, path:adb||'Not found', devices };
});

ipcMain.handle('adb:get-screen-size', async (e, { device } = {}) => {
    const bin = pool.findAdb();
    if (!bin) return { success:false, error:'ADB tidak ditemukan' };
    const dFlag = device ? `-s "${device}"` : '';
    try {
        const output = execSync(`"${bin}" ${dFlag} shell wm size`, { encoding:'utf8', timeout:10000 });
        const match = output.match(/(\d+)x(\d+)/);
        if (!match) return { success:false, error:'Tidak dapat membaca ukuran layar device' };
        return { success:true, width: parseInt(match[1],10), height: parseInt(match[2],10) };
    } catch (err) {
        return { success:false, error: err.message || String(err) };
    }
});

ipcMain.handle('adb:screenshot', async (e, { device } = {}) => {
    const bin = pool.findAdb();
    if (!bin) return { success:false, error:'ADB tidak ditemukan' };
    const dFlag = device ? `-s "${device}"` : '';
    
    // Use async exec instead of execSync to avoid blocking main thread
    return new Promise(resolve => {
        const timeoutId = setTimeout(() => {
            resolve({ success:false, error:'Screencap timeout - device may be unresponsive' });
        }, 25000);
        
        exec(`"${bin}" ${dFlag} exec-out screencap -p`, { 
            encoding:'buffer', 
            maxBuffer:100*1024*1024,
            timeout: 20000  // Timeout before the callback timer fires
        }, (err, stdout) => {
            clearTimeout(timeoutId);
            if (err) {
                resolve({ success:false, error: err.message || String(err) });
            } else {
                resolve({ success:true, imageBase64: Buffer.from(stdout).toString('base64') });
            }
        });
    });
});

// ADB WiFi connect
ipcMain.handle("adb-connect-wifi", async (e, { ip, port })=>{
    return new Promise(resolve=>{
        const bin = pool.findAdb() || 'adb';
        exec(`"${bin}" connect ${ip}:${port||5555}`, {encoding:'utf8', timeout:10000}, (err, stdout)=>{
            const success = !err && stdout.includes('connected');
            resolve({success, output:stdout||'', error:err?.message||''});
        });
    });
});

// Webhook server
let webhookServer = null;
ipcMain.handle("start-webhook", async (e, { port })=>{
    const http = require('http');
    if (webhookServer) { try{webhookServer.close();}catch(err){} webhookServer=null; }
    
    webhookServer = http.createServer((req, res)=>{
        let body = '';
        req.on('data', d=>body+=d);
        req.on('end', ()=>{
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({received:true}));
            BrowserWindow.getAllWindows()[0]?.webContents.send('webhook-received', {
                method:req.method, url:req.url, body:body, headers:req.headers, timestamp:Date.now()
            });
        });
    });
    
    return new Promise(resolve=>{
        webhookServer.listen(parseInt(port)||3344, ()=>{
            resolve({success:true, port:webhookServer.address().port});
        });
        webhookServer.on('error', e=>resolve({success:false, error:e.message}));
    });
});

ipcMain.handle("stop-webhook", ()=>{
    if (webhookServer) { try{webhookServer.close();}catch(err){} webhookServer=null; }
    return {success:true};
});

// Output path handler for portable file storage
ipcMain.handle("get-output-path", async (event, filename) => {
    const outputDir = path.join(app.getPath('userData'), 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    return path.join(outputDir, filename || 'output.json');
});

// ================================
// AUTHENTICATION
// ================================
let isAuthenticated = false;
let currentUser = null;

// Set userData path for auth module
const auth = require('./auth');
auth.setUserDataPath(app.getPath('userData'));

ipcMain.handle('login', async (event, { username, password }) => {
    try {
        const result = await auth.login(username, password);
        if (result.success) {
            isAuthenticated = true;
            currentUser = result.user;
            setTimeout(() => {
                if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'index.html'));
            }, 300);
            return { success: true, ok: true, user: result.user };
        }

        return { success: false, ok: false, message: result.reason || 'Username atau password salah' };
    } catch (e) {
        return { success: false, ok: false, message: 'Error auth: ' + (e.message || String(e)) };
    }
});

ipcMain.handle('get-default-users', async () => {
    return [
        { username: 'admin', password: 'admin123' },
        { username: 'build', password: 'aryaseptian' }
    ];
});

ipcMain.handle('get-activities', async () => {
    try {
        const activityList = require('./src/activities/activityList');
        return activityList || [];
    } catch (e) {
        console.warn('[Main] get-activities failed:', e.message || e);
        return [];
    }
});

ipcMain.handle("auth-login", async (event, { username, password }) => {
    const result = await auth.login(username, password);
    if (result.success) {
        isAuthenticated = true;
        currentUser = result.user;
        // Delay 500ms agar renderer sempat terima response
        // sebelum window berpindah halaman
        setTimeout(() => {
            if (mainWindow) {
                mainWindow.loadFile(path.join(__dirname, 'index.html'));
            }
        }, 500);
    }
    return result;
});

ipcMain.handle("auth-change-password", async (event, { username, oldPassword, newPassword }) => {
    if (!isAuthenticated) {
        return { success: false, reason: 'Belum login' };
    }
    return auth.changePassword(username, oldPassword, newPassword);
});

ipcMain.handle("auth-logout", async () => {
    isAuthenticated = false;
    currentUser = null;
    return { success: true };
});

ipcMain.handle("auth-check", async () => {
    return { 
        authenticated: isAuthenticated, 
        user: currentUser 
    };
});

// ─────────────────────────────────────────
// REFERENCE IMAGE PERSISTENCE (Phase 1)
// ─────────────────────────────────────────

// Save reference image (base64 PNG) to disk for reuse across sessions
ipcMain.handle('save-reference-image', async (event, { nodeId, base64, filename }) => {
  try {
    const saveDir = path.join(app.getPath('userData'), 'reference_images');
    fs.mkdirSync(saveDir, { recursive: true });
    
    const filePath = path.join(saveDir, filename);
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    
    console.log(`[Reference Image] Saved: ${filePath}`);
    return { success: true, filePath, filename };
  } catch (err) {
    console.error('[Reference Image] Save error:', err.message);
    return { success: false, error: err.message };
  }
});

// Load reference image from disk (for persisting across app restarts)
ipcMain.handle('load-reference-image', async (event, { filePath }) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File tidak ditemukan' };
    }
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return { success: true, base64 };
  } catch (err) {
    console.error('[Reference Image] Load error:', err.message);
    return { success: false, error: err.message };
  }
});

// List all saved reference images for node
ipcMain.handle('list-reference-images', async (event, { nodeId }) => {
  try {
    const saveDir = path.join(app.getPath('userData'), 'reference_images');
    if (!fs.existsSync(saveDir)) return { success: true, images: [] };
    
    const files = fs.readdirSync(saveDir).filter(f => f.startsWith('ref_'));
    const images = files.map(f => ({
      filename: f,
      filePath: path.join(saveDir, f),
      size: fs.statSync(path.join(saveDir, f)).size
    }));
    
    return { success: true, images };
  } catch (err) {
    console.error('[Reference Image] List error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────
app.whenReady().then(() => {
    const adbPath = pool.findAdb();
    if (adbPath) {
        resetAdbServer(adbPath, () => {
            console.log('ADB server reset completed');
        });
    }
    createWindow();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
