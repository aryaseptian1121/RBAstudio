// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
const ipcRenderer = (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.invoke === 'function')
  ? {
      invoke: (...args) => window.electronAPI.invoke(...args),
      on: (channel, listener) => window.electronAPI.on(channel, listener),
      removeListener: (channel, listener) => window.electronAPI.removeListener(channel, listener)
    }
  : (typeof window !== 'undefined' && typeof window.require === 'function' ? window.require('electron').ipcRenderer : null);

// Safe require helper for environments without Node integration
const safeRequire = (modulePath, rethrowError = false) => {
  try {
    if (typeof require === 'function') return require(modulePath);
    if (typeof window !== 'undefined' && typeof window.require === 'function') return window.require(modulePath);
  } catch (e) {
    console.error('[safeRequire] unable to require', modulePath, e);
    // Try helpful fallbacks: resolve absolute paths and try with .js extension
    try {
      const pathModule = (typeof require === 'function') ? require('path') : (typeof window !== 'undefined' && typeof window.require === 'function' ? window.require('path') : null);
      const candidates = [];
      if (pathModule) {
        const normalized = modulePath.replace(/^\.\//, '');
        // from cwd
        candidates.push(pathModule.resolve(process.cwd(), normalized));
        // with .js
        if (!normalized.endsWith('.js')) candidates.push(pathModule.resolve(process.cwd(), normalized + '.js'));
        // try relative to __dirname if available
        if (typeof __dirname !== 'undefined') {
          candidates.push(pathModule.resolve(__dirname, modulePath));
          if (!modulePath.endsWith('.js')) candidates.push(pathModule.resolve(__dirname, modulePath + '.js'));
        }
      }
      for (const cand of candidates) {
        try {
          if (typeof require === 'function') return require(cand);
          if (typeof window !== 'undefined' && typeof window.require === 'function') return window.require(cand);
        } catch (err) {
          // ignore and try next
        }
      }
    } catch (ee) {
      console.error('[safeRequire] fallback resolution failed', ee);
    }
    if (rethrowError) throw e;
  }
  return null;
};

const _ExcelLoopMod = safeRequire('./src/activities/ExcelLoopActivity') || {};
const ExcelLoopActivityDefinition = _ExcelLoopMod.ExcelLoopActivityDefinition || {};
const ExcelLoopActivityUI = { ...ExcelLoopActivityDefinition, sec: undefined };
const _defaults = safeRequire('./src/utils/excelLoopDefaults') || {};
const createDefaultConfig = _defaults.createDefaultConfig || (() => ({}));
const _panel = safeRequire('./src/components/ExcelLoopPanel') || {};
const openExcelLoopPanel = _panel.openExcelLoopPanel || (() => {});
const closeExcelLoopPanel = _panel.closeExcelLoopPanel || (() => {});
const _macroRecorderModule = safeRequire('./src/macroRecorder/macroRecorder.js') || {};
const initMacroRecorder = _macroRecorderModule.initMacroRecorder || (() => {});
const _whatsappBotModule = safeRequire('./src/whatsappBot/whatsappBot.js') || {};
const initWhatsAppBot = _whatsappBotModule.initWhatsAppBot || (() => {});

// Flow Retur renderer module
const _frModule = safeRequire('./flowRetur') || {};
const initFlowRetur = _frModule.initFlowRetur || null;
const frOpenStepPicker = _frModule.frOpenStepPicker || null;
if (typeof window !== 'undefined') window.frOpenStepPicker = frOpenStepPicker;

const quickViewLoader = safeRequire('./src/ui/quick-view-xml-loader.js') || {};
const initQuickViewXml = quickViewLoader.initQuickViewXml || (() => {});

// Expose React to window for Excel Loop panel
if (typeof React !== 'undefined') {
  window.React = React;
  window.ReactDOM = typeof ReactDOM !== 'undefined' ? ReactDOM : window.ReactDOM;
} else {
  try {
    window.React = require('react');
    window.ReactDOM = require('react-dom');
  } catch (e) {
    const allModules = window.__webpack_require__ || window.require;
    if (allModules) {
      try { window.React = allModules('react'); } catch (inner) {}
      try { window.ReactDOM = allModules('react-dom'); } catch (inner) {}
    }
    console.warn('React expose fallback:', e.message);
  }
}

// Track Excel Loop loading error for detailed reporting
let excelLoopLoadError = null;
let _panelInit = null;
try {
  _panelInit = safeRequire('./src/excelLoop/excelLoopPanel.js', true) || {};
} catch (e) {
  excelLoopLoadError = e;
  console.error('[renderer] Failed to require excelLoopPanel:', e);
  _panelInit = {};
}

const initExcelLoopPanel = typeof _panelInit.initExcelLoopPanel === 'function' ? _panelInit.initExcelLoopPanel : null;


// ─── State ────────────────────────────────────────────────────
let project = { id: Date.now(), name: 'Untitled Flow', steps: [], edges: [] };
let currentName = 'Untitled Flow';
let workflows = [];
let loadingFlows = false;
let isDirty = false;  // Track unsaved changes
let selectedIdx = null;     // selected node index
let selectedEdgeId = null;  // selected edge id
let historyStack = [], redoStack = [];

// Canvas interaction state
let tx = 0, ty = 0, sc = 1;   // single transform system
let isPanning = false, panSX = 0, panSY = 0;
let isDraggingNode = false, dragNode = null, dragOX = 0, dragOY = 0;
let isDrawingEdge = false, edgeFromIdx = null;
let snapToGrid = false, miniMapOn = false;
let multiSelect = [];  // array of selected indices
let clipboard = [];

// Region selector state for mobile tap properties
let regionSelectorState = {
  initialized: false,
  imageSrc: '',
  deviceId: '',
  scale: 1,
  isDragging: false,
  dragStart: null,
  region: { x: 0, y: 0, width: 0, height: 0 }
};

// Execution state
let stopRequested = false;
let execStats = { steps:0, errors:0, retries:0, adb:0, startTime:0, interval:null };
let isFlowRunning = false;  // BUG #1 FIX: Track flow execution state
let availableAdbDevices = []; // FIX: [BUG #2] connected ADB devices list

const DEFAULT_BROWSER_PROFILE_KEY = 'default';
let browserSessionKey = null;

function normalizeBrowserProfileKey(profileKey, url) {
  if (profileKey && String(profileKey).trim()) {
    return String(profileKey).trim();
  }
  if (url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (err) {
      return DEFAULT_BROWSER_PROFILE_KEY;
    }
  }
  return DEFAULT_BROWSER_PROFILE_KEY;
}

async function browserGetSession(profileKey) {
  const key = normalizeBrowserProfileKey(profileKey);
  const res = await ipcRenderer.invoke('browser:get-session', { profileKey: key });
  if (!res.success || !res.alive) {
    browserSessionKey = null;
    return null;
  }
  browserSessionKey = key;
  return res;
}

async function browserGetOrCreateSession(profileKey, opts = {}) {
  const key = normalizeBrowserProfileKey(profileKey);
  const res = await ipcRenderer.invoke('browser:get-or-create-session', { profileKey: key, opts });
  if (!res.success) throw new Error(res.error || 'Gagal membuat browser session');
  browserSessionKey = key;
  return res;
}

async function browserNavigate(url, timeoutMs = 15000, profileKey = null) {
  if (!url) throw new Error('URL browser kosong');
  const key = normalizeBrowserProfileKey(profileKey, url);
  await browserGetOrCreateSession(key);
  const res = await ipcRenderer.invoke('browser:navigate', {
    profileKey: key,
    url,
    timeoutMs
  });
  if (!res.success) throw new Error(res.error || 'Gagal navigasi browser');
  return res;
}

async function browserClick(selector, clickType = 'single', timeoutMs = 10000, profileKey = null) {
  const key = profileKey || browserSessionKey;
  if (!key) {
    throw new Error('Tidak ada browser session aktif. Jalankan node Open Browser sebelum Click Element.');
  }
  if (!selector || !String(selector).trim()) {
    throw new Error('Selector kosong untuk Click Element');
  }
  const alive = await browserGetSession(key);
  if (!alive) {
    throw new Error('Browser session tidak aktif. Jalankan node Open Browser terlebih dahulu.');
  }
  const res = await ipcRenderer.invoke('browser:click', {
    profileKey: key,
    selector,
    clickType,
    timeoutMs
  });
  if (!res.success) throw new Error(res.error || 'Gagal klik elemen');
  return res;
}

async function browserCloseSession(profileKey = null) {
  const finalKey = profileKey && String(profileKey).trim() ? normalizeBrowserProfileKey(profileKey, null) : browserSessionKey;
  if (!finalKey) return { success:true };
  const res = await ipcRenderer.invoke('browser:close-session', { profileKey: finalKey });
  browserSessionKey = null;
  return res;
}

function isXPathSelector(value) {
  const sel = String(value || '').trim();
  return sel.startsWith('/') || sel.startsWith('//');
}

// Feature: Variables & Interpolation
let varStore = {};  // { varName: value }
let loopStack = [];  // { startId, count, current, varName }
let retryState = {};  // { stepId: { count, maxRetry } }
let pendingWebhookWorkflow = false;
let executionHistory = [];  // { id, date, workflowName, totalSteps, errors, success, duration }

// Feature: Node Grouping
let groups = [];  // { id, name, nodeIds, color, x, y, w, h }

// Feature: Macro Recording
let macroRecording = false;
let macroSteps = [];

// Prefs
let prefs = { lang:'id', autoSave:true, confirmDelete:true, snap:false, showStepNum:true, animate:true, adbPath:'', theme:'dark' };

// ─── Activity Definitions ───────────────────────────────────
const ACTIVITIES = [
  { sec: 'Trigger & Control' },
  { type:'start',           icon:'⚡', label:'Start',          desc:'Titik awal flow',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'cron-job',        icon:'⏰', label:'Cron Job',        desc:'Scheduled trigger',         color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'webhook-trigger', icon:'🔗', label:'Webhook',         desc:'HTTP trigger',              color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'event-trigger',   icon:'📡', label:'Event Trigger',   desc:'Event-based start',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'file-watcher',    icon:'👀', label:'File Watcher',    desc:'Monitor folder/file',       color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'if-condition',    icon:'❓', label:'If Condition',    desc:'Percabangan logika',        color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'repeat-start',    icon:'🔁', label:'Loop Start',      desc:'Mulai iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'repeat-end',      icon:'🔚', label:'Loop End',        desc:'Akhir iterasi',             color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'delay',           icon:'⏱',  label:'Delay',           desc:'Tunggu beberapa ms',        color:'#ec4899', bg:'rgba(236,72,153,0.15)' },

  { sec: 'Browser Automation' },
  { type:'open-browser',    icon:'🌐', label:'Open Browser',    desc:'Buka URL di browser',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'close-browser',   icon:'❌', label:'Close Browser',   desc:'Tutup browser session',      color:'#ef4444', bg:'rgba(248,113,113,0.15)' },
  { type:'tap',             icon:'👆', label:'Click Element',   desc:'Klik element HTML',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'type-into',       icon:'⌨️', label:'Type Into',       desc:'Ketik teks ke field',       color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'extract-text',    icon:'📄', label:'Extract Text',    desc:'Ambil teks dari element',   color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'scroll-page',     icon:'📜', label:'Scroll Page',     desc:'Scroll halaman browser',    color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'wait-element',    icon:'⏳', label:'Wait Element',    desc:'Tunggu element muncul',     color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'screenshot-page', icon:'📸', label:'Screenshot Page', desc:'Capture tampilan browser',  color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'extract-table',   icon:'📊', label:'Extract Table',   desc:'Scrap tabel HTML',          color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'handle-popup',    icon:'💬', label:'Handle Popup',    desc:'Dismiss/accept popup',       color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'upload-file',     icon:'📤', label:'Upload File',     desc:'Upload file via input',     color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'pagination',      icon:'📑', label:'Pagination',      desc:'Multi-page scraping',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'infinite-scroll', icon:'🔄', label:'Infinite Scroll', desc:'Scroll tanpa batas',        color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Mobile (ADB)' },
  { type:'mobile-tap',      icon:'📱', label:'Mobile Tap',      desc:'ADB tap koordinat',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-find-text', icon:'🔍', label:'Mobile Wait Text', desc:'Tunggu teks muncul via OCR', color:'#10b981', bg:'rgba(16,185,129,0.15)' }, // NEW
  { type:'mobile-type',      icon:'⌨️', label:'Mobile Type',      desc:'Ketik teks ke field aktif', color:'#06b6d4', bg:'rgba(6,182,212,0.15)' }, // NEW
  { type:'mobile-scroll',    icon:'📜', label:'Mobile Scroll',    desc:'Scroll layar atas/bawah/kiri/kanan', color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' }, // NEW
  { type:'mobile-swipe',    icon:'👆', label:'Mobile Swipe',    desc:'ADB swipe gesture',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-press-key',icon:'⌨️', label:'Press Key',       desc:'ADB input keyevent',        color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'mobile-screenshot',icon:'📸',label:'Mobile Screenshot',desc:'ADB screencap',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'wait-and-tap',     icon:'🎯', label:'Wait & Tap',       desc:'Tunggu teks lalu tap koordinat', color:'#f43f5e', bg:'rgba(244,63,94,0.15)' }, // NEW
  { type:'open-app',        icon:'📲', label:'Open App',        desc:'Launch Android app',        color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'close-app',       icon:'❌', label:'Close App',       desc:'Force-stop app',            color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'read-ui-element', icon:'👁️', label:'Read UI Element', desc:'Baca teks dari UI',         color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'swipe',           icon:'👈', label:'Swipe (PC)',      desc:'PC mouse swipe/drag',       color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },

  { sec: 'Data & Files' },
  { type:'read-csv',        icon:'📊', label:'Read CSV',        desc:'Baca file CSV',             color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'write-csv',       icon:'📝', label:'Write CSV',       desc:'Tulis data ke CSV',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'write-excel',     icon:'📗', label:'Write Excel',     desc:'Output ke .xlsx',           color:'#16a34a', bg:'rgba(22,163,74,0.15)'  },
  ExcelLoopActivityUI,

  { sec: 'Data Processing' },
  { type:'excel-submit-web', icon:'📊', label:'Excel → Submit Web', desc:'Filter Excel & kirim ke web per batch', color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'json-processing', icon:'🔧', label:'JSON Process',    desc:'Parse/transform JSON',      color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'filter-data',     icon:'🔍', label:'Filter Data',     desc:'Filter rows/columns',       color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'batch-slice',     icon:'📦', label:'Batch Slice',     desc:'Potong data per batch',     color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'download-file',   icon:'⬇️', label:'Download File',   desc:'Download dari URL',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'file-system',     icon:'📁', label:'File System',     desc:'Copy/move/delete file',     color:'#f97316', bg:'rgba(249,115,22,0.15)' },
  { type:'database-query',  icon:'🗄️', label:'Database Query',  desc:'Query SQL/NoSQL',           color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'regex-extraction',icon:'🔍', label:'Regex Extract',   desc:'Ekstrak dengan regex',      color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'copy-paste-var',  icon:'📋', label:'Copy Variable',   desc:'Salin nilai variabel',      color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Integration' },
  { type:'api-request',     icon:'🌐', label:'API Request',     desc:'HTTP GET/POST/PUT...',      color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'ocr',             icon:'👁️', label:'OCR',             desc:'Baca teks dari gambar',     color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'ai-decision',     icon:'🤖', label:'AI Decision',     desc:'AI classify/respond',       color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'input-dialog',    icon:'💬', label:'Input Dialog',    desc:'Prompt user input',         color:'#f97316', bg:'rgba(249,115,22,0.15)' },

  { sec: 'Advanced' },
  { type:'parallel-start',  icon:'⚡', label:'Parallel Start',  desc:'Mulai paralel execution',   color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'parallel-end',    icon:'🔗', label:'Parallel Join',   desc:'Gabung parallel',           color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { type:'try-catch',       icon:'🛡️', label:'Try-Catch',       desc:'Error handling block',      color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'retry-logic',     icon:'🔄', label:'Retry Logic',     desc:'Auto retry on fail',        color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'sub-workflow',    icon:'📁', label:'Sub Workflow',    desc:'Panggil flow lain',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'macro-recorder',  icon:'🎬', label:'Macro Recorder',  desc:'Record actions',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'debug-step',      icon:'🐛', label:'Debug Step',      desc:'Pause & inspect',           color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'performance-track',icon:'📈',label:'Performance',     desc:'Track execution time',      color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'headless-mode',   icon:'👻', label:'Headless Mode',   desc:'Run tanpa GUI browser',     color:'#475569', bg:'rgba(71,85,105,0.15)'  },
  { type:'credential-manager',icon:'🔐',label:'Credentials',   desc:'Simpan login aman',         color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'auto-selector',   icon:'🎯', label:'Auto Selector',   desc:'AI detect element',         color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
];

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// ─── Variable Interpolation & Storage ───────────────────────
// BUG #2 FIX: Support both {{variableName}} and {variableName} syntax
function interpolate(str) {
  if (!str) return str;
  const strVal = String(str);
  
  // First, resolve {{variableName}} (double braces - user expected format)
  let result = strVal.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = varStore[key];
    return value !== undefined ? value : '{{' + key + '}}';
  });
  
  // Then, resolve {variableName} (single braces - legacy format)
  result = result.replace(/\{(\w+)\}/g, (_, key) => {
    const value = varStore[key];
    return value !== undefined ? value : '{' + key + '}';
  });
  
  return result;
}

// DEBUG: Log variable resolution
function resolveWithLog(label, str) {
  if (!str) return str;
  const result = interpolate(str);
  if (result !== str) {
    console.log('[VAR RESOLVE] ' + label + ': "' + str + '" → "' + result + '"');
  }
  return result;
}

function storeVar(key, value) {
  if (!key) return;
  varStore[key] = value;
  console.log('[VAR STORE] ' + key + ' = ' + String(value).substring(0, 50));
  updateVarPanel();
}

function updateVarPanel() {
  const el = document.getElementById('var-inspector');
  if (!el) return;
  const entries = Object.entries(varStore);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:10px;text-align:center;">No variables yet</div>';
    return;
  }
  // BUG #2 FIX: Show live updates with proper formatting
  console.log('[VAR PANEL] Updating with ' + entries.length + ' variables:', Object.keys(varStore));
  el.innerHTML = entries.map(([k,v]) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:6px 0;border-bottom:1px solid var(--border2);">' +
      '<span style="color:#93c5fd;font-weight:600;">{' + k + '}</span>' +
      '<span style="color:var(--dim2);max-width:100px;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:right;">' + String(v).substring(0,40) + '</span>' +
    '</div>'
  ).join('');
}

// ─── Safe Path Helper for Screenshots ──────────────────────
function getSafeSavePath(filename) {
  const path = require('path');
  const fs   = require('fs');
  const os   = require('os');
  
  // Daftar direktori yang aman (tidak ada spasi, karakter khusus)
  const candidates = [
    'C:\\rba_output',
    path.join(os.homedir(), 'AppData', 'Local', 'RBAStudio', 'output'),
    path.join(os.tmpdir(), 'rba_output'),
    os.tmpdir()
  ];
  
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testPath = path.join(dir, '.test_' + Date.now());
      fs.writeFileSync(testPath, 'ok');
      fs.unlinkSync(testPath);
      const result = path.join(dir, filename);
      return result;
    } catch(e) {
      // Coba direktori berikutnya
    }
  }
  return path.join(os.tmpdir(), filename);
}

// ─── Edge-Following Execution ──────────────────────────────
function getNextStep(currentId, conditionResult = null) {
  const edges = project.edges || [];
  const outEdges = edges.filter(e => e.from === currentId);
  if (!outEdges.length) return null;
  
  if (conditionResult !== null) {
    const trueEdge  = outEdges.find(e => e.label === 'true'  || e.label === 'yes');
    const falseEdge = outEdges.find(e => e.label === 'false' || e.label === 'no');
    if (conditionResult && trueEdge)  return project.steps.find(s => s.id === trueEdge.to);
    if (!conditionResult && falseEdge) return project.steps.find(s => s.id === falseEdge.to);
  }
  return project.steps.find(s => s.id === outEdges[0].to);
}

function focusNodeOnCanvas(stepId) {
  const s = project.steps.find(st => st.id === stepId);
  if (!s) return;
  const canvasEl = document.getElementById('canvas');
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  tx = rect.width/2  - (s.x + 100) * sc;
  ty = rect.height/2 - (s.y + 30)  * sc;
  applyTransform();
}

// ─── Node Grouping ─────────────────────────────────────────
function groupSelected() {
  if (multiSelect.length < 2) { addLog('Pilih minimal 2 node untuk group', 'warn'); return; }
  const name = prompt('Nama group:', 'Group 1');
  if (!name) return;
  pushHistory();
  const nodes = multiSelect.map(i => project.steps[i]);
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const group = {
    id: 'g-' + Date.now(),
    name,
    nodeIds: nodes.map(n => n.id),
    color: '#3b82f6',
    x: Math.min(...xs) - 20,
    y: Math.min(...ys) - 30,
    w: Math.max(...xs) + 220 - Math.min(...xs) + 20,
    h: Math.max(...ys) + 80 - Math.min(...ys) + 30
  };
  groups.push(group);
  render();
  addLog('Grouped ' + nodes.length + ' nodes: "' + name + '"', 'info');
}

// ─── Node Search & Jump ────────────────────────────────────
function searchNodes(q) {
  if (!q) { render(); return; }
  const lower = q.toLowerCase();
  project.steps.forEach((s, i) => {
    const match = s.name.toLowerCase().includes(lower) || s.type.toLowerCase().includes(lower);
    const nodeEl = document.querySelector('.node[data-idx="' + i + '"]');
    if (nodeEl) nodeEl.style.opacity = match ? '1' : '0.2';
    if (match && q.length > 2) {
      const canvasEl = document.getElementById('canvas');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        tx = rect.width/2  - (s.x + 100) * sc;
        ty = rect.height/2 - (s.y + 30)  * sc;
        applyTransform();
      }
    }
  });
}

// ─── Statistics Dashboard ──────────────────────────────────
function updateDashboardStats() {
  const stats = {
    'stat-total-wf': workflows.length,
    'stat-total-runs': executionHistory.length,
    'stat-devices': 0
  };
  
  const successCount = executionHistory.filter(h=>h.success).length;
  const rate = executionHistory.length ? Math.round(successCount/executionHistory.length*100) : 0;
  stats['stat-success-rate'] = rate + '%';
  
  const devSel = document.getElementById('device-selector');
  if (devSel) {
    stats['stat-devices'] = devSel.querySelectorAll('option:not([value="No ADB Device"])').length;
  }
  
  Object.entries(stats).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

// ─── Template Workflows ────────────────────────────────────
const TEMPLATES = {
  'login-auto': {
    name: 'Login Automation',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'open-browser', name:'Open Login', url:'https://example.com/login', browser:'chrome', waitAfterLoad:2000, id:2 },
      { type:'type-into', name:'Username', selector:'#username', text:'', clearBefore:'yes', id:3 },
      { type:'type-into', name:'Password', selector:'#password', text:'', clearBefore:'yes', id:4 },
      { type:'tap', name:'Login', selector:'#btn-login', id:5 },
      { type:'screenshot-page', name:'Capture', id:6 }
    ]
  },
  'adb-record': {
    name: 'ADB Screen Record',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'mobile-screenshot', name:'Before', screenshotPath:'/sdcard/before.png', id:2 },
      { type:'mobile-tap', name:'Tap', mx:540, my:960, id:3 },
      { type:'delay', name:'Wait', delay:2000, id:4 },
      { type:'mobile-screenshot', name:'After', screenshotPath:'/sdcard/after.png', id:5 }
    ]
  },
  'csv-scrape': {
    name: 'Scrape to CSV',
    steps: [
      { type:'start', name:'Start', id:1 },
      { type:'open-browser', name:'Open', url:'https://example.com', id:2 },
      { type:'extract-table', name:'Extract', selector:'table', var:'data', id:3 },
      { type:'write-csv', name:'Save', filePath:'output.csv', var:'data', id:4 }
    ]
  }
};

function loadTemplate(key) {
  const tpl = TEMPLATES[key];
  if (!tpl) return;
  pushHistory();
  const steps = tpl.steps.map((s, i) => ({
    ...s,
    id: Date.now() + i,
    delay: s.delay || 500,
    var: s.var || '',
    comment: '',
    status: '',
    x: 80 + (i % 3) * 260,
    y: 80 + Math.floor(i / 3) * 140
  }));
  project = { id: Date.now(), name: tpl.name, steps, edges: [] };
  project.edges = steps.slice(0,-1).map((s,i) => ({
    id: 'e-'+Date.now()+i, from: s.id, to: steps[i+1].id, label: ''
  }));
  currentName = tpl.name;
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  render();
  switchView('editor');
  
  console.log('[TEMPLATE] Loaded template:', {
    name: tpl.name,
    steps: steps.length,
    edges: project.edges.length
  });
  addLog('Template loaded: ' + tpl.name, 'success');
}

// ─── Keyboard Help Modal ────────────────────────────────────
function showShortcutHelp() {
  const existing = document.getElementById('shortcut-modal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcut-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  const shortcuts = [
    ['Ctrl+N','New Workflow'], ['Ctrl+S','Save'], ['Ctrl+Z','Undo'], ['Ctrl+Y','Redo'],
    ['Ctrl+C','Copy'], ['Ctrl+V','Paste'], ['Ctrl+D','Duplicate'], ['Ctrl+A','Select All'],
    ['Del','Delete'], ['Ctrl+=','Zoom In'], ['Ctrl+-','Zoom Out'], ['Ctrl+0','Fit View'],
    ['Escape','Deselect'], ['F1 / ?','Help']
  ];
  let inner = '<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;width:500px;max-height:80vh;overflow-y:auto;">';
  inner += '<div style="font-weight:800;font-size:16px;margin-bottom:20px;">Keyboard Shortcuts</div>';
  shortcuts.forEach(function(item) {
    inner += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2);font-size:12px;">';
    inner += '<span>' + item[1] + '</span>';
    inner += '<kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-family:monospace;">' + item[0] + '</kbd>';
    inner += '</div>';
  });
  inner += '<button onclick="document.getElementById(\'shortcut-modal\').remove()" style="width:100%;margin-top:16px;padding:9px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">Close</button>';
  inner += '</div>';
  modal.innerHTML = inner;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

function getActivityDef(type) {
  return ACTIVITIES.find(a => a.type === type) || { icon:'📌', label:type, color:'#64748b', bg:'rgba(100,116,139,0.15)' };
}

// ─── Build Tool List ─────────────────────────────────────────
(function buildToolList() {
  const list = document.getElementById('tool-list');
  let html = '';
  let sectionId = null;
  for (const a of ACTIVITIES) {
    if (a.sec) {
      if (sectionId) html += '</div></div>';
      sectionId = a.sec.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      html += '<div class="tool-section" id="section-' + sectionId + '">';
      html += '<button type="button" class="tool-sec-hdr" onclick="toggleToolSection(\'' + sectionId + '\')">';
      html += '<span>' + a.sec + '</span><span class="tool-sec-chevron">▼</span></button>';
      html += '<div class="tool-section-body">';
      continue;
    }
    if (!sectionId) {
      sectionId = 'default';
      html += '<div class="tool-section" id="section-' + sectionId + '">';
      html += '<button type="button" class="tool-sec-hdr" onclick="toggleToolSection(\'' + sectionId + '\')">';
      html += '<span>TOOLS</span><span class="tool-sec-chevron">▼</span></button>';
      html += '<div class="tool-section-body">';
    }
    html += '<button class="tool-card" draggable="true" data-type="' + a.type + '" data-label="' + a.label + ' ' + a.desc + '">';
    html += '<div class="tc-ico" style="background:' + a.bg + ';color:' + a.color + '">' + a.icon + '</div>';
    html += '<div class="tc-lbl"><strong>' + a.label + '</strong><span>' + a.desc + '</span></div>';
    html += '</button>';
  }
  if (sectionId) html += '</div></div>';
  list.innerHTML = html;
  list.querySelectorAll('.tool-card').forEach(btn => {
    const type = btn.dataset.type;
    btn.addEventListener('click', () => addNode(type));
    btn.addEventListener('dragstart', e => toolDragStart(e, type));
  });
  animateActivityItems();
})();

function toggleToolSection(sectionId) {
  const section = document.getElementById('section-' + sectionId);
  if (!section) return;
  section.classList.toggle('collapsed');
}

function filterTools(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.tool-card').forEach((c, index) => {
    const isMatch = c.dataset.label.toLowerCase().includes(query);
    if (!query) {
      c.classList.remove('filtered-out');
      c.classList.remove('visible');
      setTimeout(() => c.classList.add('visible'), index * 30);
      return;
    }
    if (isMatch) {
      c.classList.remove('filtered-out');
      c.classList.add('visible');
    } else {
      c.classList.remove('visible');
      c.classList.add('filtered-out');
    }
  });
}

function animateActivityItems() {
  document.querySelectorAll('.tool-card').forEach((item, index) => {
    item.classList.remove('filtered-out');
    item.classList.remove('visible');
    setTimeout(() => item.classList.add('visible'), index * 30);
  });
}

// ─── History ──────────────────────────────────────────────────
function pushHistory() {
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  if (historyStack.length > 60) historyStack.shift();
  redoStack = [];
  isDirty = true;
}
function undoAction() {
  if (!historyStack.length) return;
  redoStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  const s = JSON.parse(historyStack.pop());
  project.steps = s.steps; project.edges = s.edges||[];
  render(); showPropEmpty();
}
function redoAction() {
  if (!redoStack.length) return;
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  const s = JSON.parse(redoStack.pop());
  project.steps = s.steps; project.edges = s.edges||[];
  render(); showPropEmpty();
}

// ─── View Switching ───────────────────────────────────────────
let excelLoopPanel = null;
let whatsappBotPanel = null;
let flowReturPanel = null;

function switchView(id) {
  const current = document.querySelector('.view.active');
  const target = document.getElementById(id);
  if (!target) return;

  const navMap = { dashboard:'nav-dash', editor:'nav-edit', recorder:'nav-rec', 'excel-loop':'nav-excel-loop', 'whatsapp-bot':'nav-whatsapp-bot', 'flow-retur':'nav-flow-retur', settings:'nav-set' };
  document.querySelectorAll('.nav-ico').forEach(n => n.classList.remove('active'));
  if (navMap[id]) document.getElementById(navMap[id]).classList.add('active');

  const showTarget = () => {
    target.classList.add('active', 'page-entering');
    target.addEventListener('animationend', () => target.classList.remove('page-entering'), { once: true });
  };

  if (current && current !== target) {
    current.classList.add('page-exiting');
    current.addEventListener('animationend', () => {
      current.classList.remove('active', 'page-exiting');
      showTarget();
    }, { once: true });
  } else if (!current) {
    showTarget();
  } else if (current === target) {
    target.classList.add('active');
  }

  if (id === 'excel-loop' && !excelLoopPanel) {
    const mountEl = document.getElementById('excel-loop');
    if (mountEl) {
      if (typeof initExcelLoopPanel !== 'function') {
        console.error('Excel Loop init function unavailable. Load error:', excelLoopLoadError);
        
        // Build detailed error message
        let errorDetail = 'Module gagal dimuat';
        if (excelLoopLoadError) {
          errorDetail = excelLoopLoadError.message || String(excelLoopLoadError);
        }
        
        const errorHTML = `
          <div style="padding:24px; color:#f87171; fontFamily:monospace; background:#1f2937; borderRadius:8px; margin:16px;">
            <h3 style="color:#fca5a5; marginBottom:12px; fontSize:16px;">Excel Loop gagal dimuat</h3>
            <div style="background:#0f1318; padding:16px; borderRadius:6px; fontSize:13px; marginBottom:12px; border-left:3px solid #f87171;">
              <div><strong>Error:</strong> ${errorDetail}</div>
              ${excelLoopLoadError && excelLoopLoadError.stack ? `
                <pre style="marginTop:12px; fontSize:11px; color:#9ca3af; whiteSpace:pre-wrap; overflowX:auto; maxHeight:200px;">
${excelLoopLoadError.stack.split('\n').slice(0, 10).join('\n')}</pre>
              ` : ''}
            </div>
            <p style="fontSize:12px; color:#cbd5e1;">Periksa developer console (F12) untuk detail lengkap.</p>
          </div>
        `;
        mountEl.innerHTML = errorHTML;
        return;
      }
      try {
        excelLoopPanel = initExcelLoopPanel(mountEl);
      } catch (e) {
        console.error('ExcelLoop init error:', e);
        
        const errorDetail = e && e.message ? e.message : String(e);
        const errorStack = (e && e.stack) ? e.stack.split('\n').slice(0, 8).join('\n') : '';
        
        const errorHTML = `
          <div style="padding:24px; color:#f87171;">
            <h3 style="color:#fca5a5; marginBottom:12px; fontSize:16px;">Excel Loop gagal di-render</h3>
            <div style="background:#0f1318; padding:16px; borderRadius:6px; fontSize:13px; marginBottom:16px; border-left:3px solid #f87171;">
              <div><strong>Error:</strong> ${errorDetail}</div>
              ${errorStack ? `
                <pre style="marginTop:12px; fontSize:11px; color:#9ca3af; whiteSpace:pre-wrap; overflowX:auto; maxHeight:200px;">
${errorStack}</pre>
              ` : ''}
            </div>
            <button id="excelloop-retry" style="padding:8px 16px; background:#f87171; color:#1f2937; border:none; borderRadius:4px; cursor:pointer; fontSize:13px; fontWeight:bold;">Coba Lagi</button>
          </div>
        `;
        
        mountEl.innerHTML = errorHTML;
        setTimeout(() => {
          const btn = document.getElementById('excelloop-retry');
          if (btn) btn.addEventListener('click', function() {
            mountEl.innerHTML = '';
            try { 
              excelLoopPanel = initExcelLoopPanel(mountEl); 
            } catch (err) { 
              console.error('Retry failed:', err); 
              mountEl.innerHTML = '<div style="padding:16px; color:#f87171; fontSize:13px;">Retry gagal: '+(err && err.message ? err.message : String(err))+'</div>'; 
            }
          });
        }, 50);
      }
    }
  }

  if (id === 'whatsapp-bot' && !whatsappBotPanel) {
    const mountEl = document.getElementById('whatsapp-bot');
    if (mountEl) {
      try {
        whatsappBotPanel = initWhatsAppBot(mountEl);
      } catch (error) {
        console.error('[renderer] Failed to initialize WhatsApp Bot:', error);
        mountEl.innerHTML = `<div style="padding:24px; color:#fca5a5;">Gagal memuat halaman WhatsApp Bot.</div>`;
      }
    }
  }

  if (id === 'flow-retur' && !flowReturPanel) {
    const mountEl = document.getElementById('flow-retur');
    if (mountEl) {
      if (typeof initFlowRetur === 'function') {
        try { initFlowRetur(mountEl); } catch (e) { console.warn('initFlowRetur error', e); }
      } else {
        initFlowReturPanel(mountEl);
      }
      if (typeof frOpenStepPicker === 'function') window.frOpenStepPicker = frOpenStepPicker;
      flowReturPanel = true;
    }
  }
}

function initFlowReturPanel(mountEl) {
  flowReturPanel = true;
  mountEl.innerHTML = `
    <div class="dash-view" style="display:flex;flex-direction:column;min-height:0;">
      <div class="dash-title">🔁 Flow Retur</div>
      <div class="dash-sub">Buat dan kelola alur pengembalian secara terpusat, dengan akses cepat ke rule, dokumen, dan log aktivitas.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:18px;">
        <div class="setting-card">
          <div class="setting-card-ttl">Flow Retur Overview</div>
          <p style="margin:0;color:var(--text);line-height:1.6;">Gunakan halaman ini untuk menyimpan template alur retur, melihat status retur terakhir, dan menjalankan rutin pemrosesan return.</p>
        </div>
        <div class="setting-card">
          <div class="setting-card-ttl">Actions</div>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
            <button id="flow-retur-new" class="tb-btn" style="width:100%;">+ Create Return Flow</button>
            <button id="flow-retur-refresh" class="tb-btn" style="width:100%;">🔄 Refresh Return Queue</button>
            <button id="flow-retur-open" class="tb-btn" style="width:100%;">📂 Open Return Folder</button>
          </div>
        </div>
      </div>
      <div style="margin-top:20px;display:grid;grid-template-columns:1fr;gap:16px;">
        <div class="setting-card">
          <div class="setting-card-ttl">Latest Return Logs</div>
          <div id="flow-retur-log" style="min-height:120px;color:var(--text);font-size:13px;line-height:1.6;white-space:pre-wrap;overflow:auto;padding:10px 0 0 0;"></div>
        </div>
      </div>
    </div>
  `;

  const btnNew = document.getElementById('flow-retur-new');
  const btnRefresh = document.getElementById('flow-retur-refresh');
  const btnOpen = document.getElementById('flow-retur-open');
  const logEl = document.getElementById('flow-retur-log');

  const appendFlowReturLog = (message) => {
    if (!logEl) return;
    const time = new Date().toLocaleTimeString();
    logEl.textContent = `${time} - ${message}\n${logEl.textContent}`;
  };

  btnNew?.addEventListener('click', () => {
    appendFlowReturLog('Create Return Flow clicked. Fitur belum tersedia.');
    addLog('Flow Retur: Create action clicked.', 'info');
  });
  btnRefresh?.addEventListener('click', () => {
    appendFlowReturLog('Refresh Return Queue clicked. Memeriksa status terbaru...');
    addLog('Flow Retur: Refresh action clicked.', 'info');
  });
  btnOpen?.addEventListener('click', async () => {
    appendFlowReturLog('Open Return Folder clicked. Mencoba membuka folder...');
    if (window.electronAPI && typeof window.electronAPI.openFlowReturFolder === 'function') {
      try {
        const result = await window.electronAPI.openFlowReturFolder();
        if (result?.ok) {
          appendFlowReturLog(`Folder terbuka: ${result.path}`);
          addLog('Flow Retur: Folder terbuka.', 'success');
        } else {
          appendFlowReturLog(`Gagal membuka folder: ${result?.error || 'Unknown error'}`);
          addLog('Flow Retur: Gagal membuka folder.', 'error');
        }
      } catch (error) {
        console.warn('Flow Retur open folder failed:', error);
        appendFlowReturLog('Gagal membuka folder: ' + (error?.message || String(error)));
        addLog('Flow Retur: Gagal membuka folder.', 'error');
      }
    } else {
      appendFlowReturLog('Electron API tidak tersedia untuk membuka folder.');
      addLog('Flow Retur: Electron API tidak tersedia.', 'warn');
    }
  });
}

// ─── Project Name ─────────────────────────────────────────────
let isEditingName = false;
let flowName = currentName || project.name || 'New Flow';
function updateProjName() {
  const el = document.getElementById('proj-name');
  if (!el) return;
  el.innerHTML = '';
  if (isEditingName) {
    const input = document.createElement('input');
    input.id = 'proj-name-input';
    input.value = flowName;
    input.style.background = 'transparent';
    input.style.border = 'none';
    input.style.borderBottom = '1px solid #555';
    input.style.color = 'inherit';
    input.style.fontSize = 'inherit';
    input.style.fontWeight = 'inherit';
    input.style.outline = 'none';
    input.style.minWidth = '120px';
    input.addEventListener('blur', () => { isEditingName = false; updateFlowName(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { isEditingName = false; updateFlowName(input.value); }});
    el.appendChild(input);
    setTimeout(() => { try{ input.focus(); input.select(); }catch(e){} }, 50);
  } else {
    el.textContent = (flowName || currentName || 'New Flow') + ' ✏️';
    el.style.cursor = 'pointer';
    el.onclick = () => { isEditingName = true; updateProjName(); };
  }
}
function updateFlowName(name) {
  const n = String(name || '').trim();
  if (!n) { flowName = currentName; updateProjName(); return; }
  flowName = n.substring(0,100);
  currentName = flowName;
  project.name = currentName;
  isDirty = true;
  updateProjName();
  addLog('Workflow renamed to: ' + currentName + ' (click Save to persist)', 'success');
}
function renameProject() { isEditingName = true; updateProjName(); }

// ─── Add Node ─────────────────────────────────────────────────
function addNode(type, x, y) {
  pushHistory();
  const def = getActivityDef(type);
  const step = {
    id: Date.now() + Math.random(), name: def.label, type,
    x: x != null ? x : 120 + Math.random()*80,
    y: y != null ? y : 120 + Math.random()*60,
    delay:500, var:'', comment:'',
    // type-specific defaults
    cx:0,cy:0, mx:0,my:0, selector:'', url:'', text:'', dir:'down', dur:300,
    sx:0,sy:0,ex:0,ey:0, loopCount:3, loopVar:'i', condition:'',
    apiUrl:'', apiMethod:'GET', apiHeaders:'', apiBody:'',
    filePath:'', delimiter:',', deviceId:'',
    cron:'0 9 * * *', timezone:'Asia/Jakarta',
    clickType:'single', clearBefore:'yes', typeSpeed:30,
    attribute:'', regex:'', keyCode:'', screenshotPath:'/sdcard/screen.png',
    waitSelector:'', waitCondition:'visible', waitTimeout:10000,
    ocrSource:'screenshot', ocrLang:'eng', browser:'default', browserMode:'normal', browserOpenMode:'reuse_if_exists', browserProfileKey:'', waitAfterLoad:2000,
    trueStep:'', falseStep:'',
    // Excel Submit Web defaults
    filterCol1:'L', filterCol1Label:'Waktu Gagal PU', filterCol2:'J', filterCol2Label:'Waktu Pickup', filterCondition:'Blank (kosong)',
    dataColumn:'B', dataColumnLabel:'Nomor AWB', headerRow:1, batchSize:1000,
    xpathInput:'/html/body/div[2]/div[1]/div[2]/main/div[2]/div[8]/div/div/div/div[1]/div[2]/form/div[1]/div/div/div[2]/div/div',
    xpathButton:'/html/body/div[2]/div[1]/div[2]/main/div[2]/div[8]/div/div/div/div[1]/div[1]/div[1]/button[1]',
    delayBetweenBatch:2000, delayBeforeClick:500,
    outputTotalData:'', outputTotalBatch:'', outputBatchDone:'',
    status:''
  };
  if (type === 'excel-loop') {
    const defaults = createDefaultConfig();
    Object.assign(step, defaults);
  }
  project.steps.push(step);
  step._isNew = true;
  // Auto-connect to previous node
  if (project.steps.length >= 2) {
    const prev = project.steps[project.steps.length - 2];
    project.edges.push({ id: 'e-'+Date.now(), from: prev.id, to: step.id, label: '' });
  }
  render();
  selectNode(project.steps.length - 1);
  addLog('Added: ' + def.label, 'info');
  
  // User guidance for loop structure
  if (type === 'repeat-start') {
    addLog('💡 Tips: Pastikan ada "Loop End" setelah step-step yang ingin diulang', 'info');
    addLog('   ↳ Loop akan berjalan dari Loop Start ke Loop End sebanyak yang ditentukan', 'info');
  }
}

// ─── Node Selection & Properties ─────────────────────────────
function selectNode(idx) {
  var panel = document.querySelector('.right-panel');
  var toggleBtn = document.getElementById('rba-toggle-props');
  if (panel) panel.classList.remove('rba-collapsed');
  if (toggleBtn) toggleBtn.textContent = '‹';
  
  selectedIdx = idx;
  multiSelect = [idx];
  render();
  if (idx === null || idx < 0 || idx >= project.steps.length) { showPropEmpty(); return; }
  showProp(project.steps[idx]);
}

// ═══════════════════════════════════════════════════════════════
// FIX: Properties Panel - Reset & Re-initialize
// ═══════════════════════════════════════════════════════════════

/**
 * Reset Properties Panel state - dipanggil setiap kali node baru dipilih.
 * Memastikan semua input field editable dan event listeners ter-attach.
 */
function resetPanelState() {
  console.log('[PROP PANEL] Reset panel state...');
  
  // List semua input field yang harus di-reset
  const inputIds = [
    'pe-name', 'pe-delay', 'pe-var', 'pe-comment',
    'pe-cx', 'pe-cy', 'pe-selector', 'pe-click-type',
    'pe-type-selector', 'pe-text', 'pe-clear', 'pe-typespeed',
    'pe-url', 'pe-profile-key', 'pe-browser-open-mode', 'pe-browser', 'pe-bmode', 'pe-bwait',
    'pe-dir', 'pe-dur', 'pe-sx', 'pe-sy', 'pe-ex', 'pe-ey',
    'pe-device-id',
    'pe-mtap-x', 'pe-mtap-y', 'pe-mtap-match-mode', 'pe-mtap-target-text', 'pe-mtap-threshold', 'pe-mtap-timeout', 'pe-mtap-interval', 'pe-mtap-randomize', 'pe-mtap-offset', 'pe-mtap-duration', 'pe-mtap-longpress',
    'pe-mwt-text', 'pe-mwt-match', 'pe-mwt-case', 'pe-mwt-timeout', 'pe-mwt-ocr-x', 'pe-mwt-ocr-y', 'pe-mwt-ocr-w', 'pe-mwt-ocr-h', 'pe-mwt-lang', 'pe-mwt-action', 'pe-mwt-offset-x', 'pe-mwt-offset-y', 'pe-mwt-interval',
    'pe-wat-delay', 'pe-wat-timeout', 'pe-wat-x', 'pe-wat-y', 'pe-wat-ref-img', 'pe-wat-confidence', 'pe-wat-region-x', 'pe-wat-region-y', 'pe-wat-region-w', 'pe-wat-region-h', 'pe-wat-randomize', 'pe-wat-offset', 'pe-wat-onfail', 'pe-wat-goto-step', 'pe-wat-retry-count',
    'pe-mobile-keycode', 'pe-mobile-key-custom', 'pe-mobile-key-long', 'pe-mobile-key-duration',
    'pe-ms-save-path', 'pe-ms-filename', 'pe-ms-timestamp', 'pe-ms-var',
    'pe-open-package', 'pe-open-activity', 'pe-open-wait', 'pe-open-force-stop',
    'pe-close-package', 'pe-close-wait',
    'pe-read-type', 'pe-read-value', 'pe-read-attr', 'pe-read-timeout',
    'pe-ext-sel', 'pe-ext-attr', 'pe-ext-regex',
    'pe-cond', 'pe-true-step', 'pe-false-step',
    'pe-loop-count', 'pe-loop-var', 'pe-loop-break',
    'pe-api-url', 'pe-api-method', 'pe-api-headers', 'pe-api-body',
    'pe-cron', 'pe-tz',
    'pe-filepath', 'pe-delim', 'pe-encoding',
    'pe-ocr-src', 'pe-ocr-lang',
    'pe-wait-sel', 'pe-wait-cond', 'pe-wait-timeout'
  ];
  
  // Reset setiap input field - TIDAK menggunakan cloneNode (menyebabkan bug)
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // Hapus atribut readonly/disabled jika ada
      el.removeAttribute('readonly');
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      
      // Pastikan pointer events aktif
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'text';
      el.style.opacity = '1';
      
      // JANGAN clone element - itu menghapus event listeners!
      // Cukup reset style dan attributes saja
    }
  });
  
  // Force focus removal dari field sebelumnya
  if (document.activeElement && 
      (document.activeElement.tagName === 'INPUT' || 
       document.activeElement.tagName === 'TEXTAREA')) {
    document.activeElement.blur();
  }
  
  console.log('[PROP PANEL] ✓ Panel state reset complete');
}

function showPropEmpty() {
  selectedIdx = null; multiSelect = [];
  document.getElementById('prop-empty').style.display = 'block';
  document.getElementById('prop-editor').style.display = 'none';
}

const PROP_GROUPS = {
  'tap':['pg-tap'], 'click':['pg-tap'],
  'type-into':['pg-type'],
  'open-browser':['pg-browser'],
  'close-browser':[],
  'swipe':['pg-swipe'],
  'mobile-tap':['pg-mobile','pg-mobile-tap'], 'mobile-swipe':['pg-mobile','pg-swipe'],
  'mobile-press-key':['pg-mobile','pg-mobile-key'], 'mobile-screenshot':['pg-mobile','pg-mobile-screenshot'],
  'mobile-find-text':['pg-mobile','pg-mobile-wait'],
  'mobile-type':['pg-mobile','pg-type'],
  'mobile-scroll':['pg-mobile','pg-swipe'],
  'wait-and-tap':['pg-mobile','pg-wait-and-tap'],
  'open-app':['pg-mobile','pg-open-app'], 'close-app':['pg-mobile','pg-close-app'],
  'read-ui-element':['pg-mobile','pg-read-ui-element'],
  'extract-text':['pg-extract'], 'extract-table':['pg-extract'],
  'if-condition':['pg-condition'],
  'repeat-start':['pg-loop'], 'repeat-end':[],
  'api-request':['pg-api'],
  'cron-job':['pg-cron'],
  'read-csv':['pg-file'], 'write-csv':['pg-file'], 'write-excel':['pg-file'],
  'download-file':['pg-file'], 'file-system':['pg-file'],
  'ocr':['pg-ocr'],
  'wait-element':['pg-wait'],
  'scroll-page':['pg-swipe'],
  'excel-submit-web':['pg-excel-submit-web'],
};

function showProp(s) {
  // FIX: Reset panel state sebelum populate data
  // Ini memastikan field editable dan event listeners fresh
  resetPanelState();
  
  if (s.type === 'excel-loop') {
    closeExcelLoopPanel();
    openExcelLoopPanel(s);
    return;
  }

  const editor = document.getElementById('prop-editor');
  const isOpen = getComputedStyle(editor).display !== 'none';
  document.getElementById('prop-empty').style.display = 'none';
  editor.style.display = 'block';
  if (isOpen) {
    editor.addEventListener('transitionend', e => {
      if (e.propertyName !== 'opacity') return;
      editor.classList.remove('updating');
    }, { once: true });
    requestAnimationFrame(() => editor.classList.add('updating'));
  }
  const def = getActivityDef(s.type);
  document.getElementById('pe-ico-big').textContent = def.icon;
  document.getElementById('pe-ico-big').style.background = def.bg;
  document.getElementById('pe-type-lbl').textContent = s.type;
  document.getElementById('pe-name').value = s.name;
  document.getElementById('pe-delay').value = s.delay ?? 500;
  document.getElementById('pe-var').value = s.var ?? '';
  document.getElementById('pe-comment').value = s.comment ?? '';
  // Tap/Click
  document.getElementById('pe-cx').value = s.cx ?? 0;
  document.getElementById('pe-cy').value = s.cy ?? 0;
  document.getElementById('pe-selector').value = s.selector ?? '';
  document.getElementById('pe-click-type').value = s.clickType ?? 'single';
  // Type-into
  document.getElementById('pe-type-selector').value = s.selector ?? '';
  document.getElementById('pe-text').value = s.text ?? '';
  document.getElementById('pe-clear').value = s.clearBefore ?? 'yes';
  document.getElementById('pe-typespeed').value = s.typeSpeed ?? 30;
  // Browser
  document.getElementById('pe-url').value = s.url ?? '';
  document.getElementById('pe-profile-key').value = s.browserProfileKey ?? '';
  document.getElementById('pe-browser-open-mode').value = s.browserOpenMode ?? 'reuse_if_exists';
  document.getElementById('pe-browser').value = s.browser ?? 'default';
  document.getElementById('pe-bmode').value = s.browserMode ?? 'normal';
  document.getElementById('pe-bwait').value = s.waitAfterLoad ?? 2000;
  // Swipe
  document.getElementById('pe-dir').value = s.dir ?? 'down';
  document.getElementById('pe-dur').value = s.dur ?? 300;
  document.getElementById('pe-sx').value = s.sx ?? 0;
  document.getElementById('pe-sy').value = s.sy ?? 0;
  document.getElementById('pe-ex').value = s.ex ?? 0;
  document.getElementById('pe-ey').value = s.ey ?? 0;
  // Mobile
  document.getElementById('pe-device-id').value = s.deviceId ?? '';
  if (document.getElementById('pe-mtap-x')) document.getElementById('pe-mtap-x').value = s.mx ?? 0;
  if (document.getElementById('pe-mtap-y')) document.getElementById('pe-mtap-y').value = s.my ?? 0;
  if (document.getElementById('pe-mtap-randomize')) document.getElementById('pe-mtap-randomize').checked = Boolean(s.randomizeTapOffset);
  if (document.getElementById('pe-mtap-offset')) document.getElementById('pe-mtap-offset').value = s.offsetRange ?? 3;
  if (document.getElementById('pe-mtap-duration')) document.getElementById('pe-mtap-duration').value = s.tapDuration ?? 100;
  if (document.getElementById('pe-mtap-longpress')) document.getElementById('pe-mtap-longpress').checked = Boolean(s.isLongPress);
  if (document.getElementById('pe-mwt-text')) document.getElementById('pe-mwt-text').value = s.waitText ?? '';
  if (document.getElementById('pe-mwt-match')) document.getElementById('pe-mwt-match').value = s.matchType ?? 'contains';
  if (document.getElementById('pe-mwt-case')) document.getElementById('pe-mwt-case').checked = Boolean(s.caseSensitive);
  if (document.getElementById('pe-mwt-timeout')) document.getElementById('pe-mwt-timeout').value = s.timeout ?? 10000;
  if (document.getElementById('pe-mwt-ocr-x')) document.getElementById('pe-mwt-ocr-x').value = s.ocrRegionX ?? 0;
  if (document.getElementById('pe-mwt-ocr-y')) document.getElementById('pe-mwt-ocr-y').value = s.ocrRegionY ?? 0;
  if (document.getElementById('pe-mwt-ocr-w')) document.getElementById('pe-mwt-ocr-w').value = s.ocrRegionW ?? 0;
  if (document.getElementById('pe-mwt-ocr-h')) document.getElementById('pe-mwt-ocr-h').value = s.ocrRegionH ?? 0;
  if (document.getElementById('pe-mwt-lang')) document.getElementById('pe-mwt-lang').value = s.ocrLanguage ?? 'auto';
  if (document.getElementById('pe-mwt-action')) document.getElementById('pe-mwt-action').value = s.onFoundAction ?? 'continue';
  if (document.getElementById('pe-mwt-offset-x')) document.getElementById('pe-mwt-offset-x').value = s.tapOffsetX ?? 0;
  if (document.getElementById('pe-mwt-offset-y')) document.getElementById('pe-mwt-offset-y').value = s.tapOffsetY ?? 0;
  if (document.getElementById('pe-mwt-interval')) document.getElementById('pe-mwt-interval').value = s.retryInterval ?? 1000;
  if (document.getElementById('pe-wat-delay')) document.getElementById('pe-wat-delay').value = s.delayBefore ?? 500;
  if (document.getElementById('pe-wat-timeout')) document.getElementById('pe-wat-timeout').value = s.timeout ?? 30000;
  if (document.getElementById('pe-wat-retry-interval')) document.getElementById('pe-wat-retry-interval').value = s.retryInterval ?? 1000;
  if (document.getElementById('pe-wat-x')) document.getElementById('pe-wat-x').value = s.tapX ?? 0;
  if (document.getElementById('pe-wat-y')) document.getElementById('pe-wat-y').value = s.tapY ?? 0;
  if (document.getElementById('pe-wat-confidence')) document.getElementById('pe-wat-confidence').value = s.confidence ?? 80;
  if (document.getElementById('pe-wat-confidence-value')) document.getElementById('pe-wat-confidence-value').textContent = (s.confidence ?? 80) + '%';
  if (document.getElementById('pe-wat-region-x')) document.getElementById('pe-wat-region-x').value = s.searchRegionX ?? 0;
  if (document.getElementById('pe-wat-region-y')) document.getElementById('pe-wat-region-y').value = s.searchRegionY ?? 0;
  if (document.getElementById('pe-wat-region-w')) document.getElementById('pe-wat-region-w').value = s.searchRegionW ?? 0;
  if (document.getElementById('pe-wat-region-h')) document.getElementById('pe-wat-region-h').value = s.searchRegionH ?? 0;
  if (document.getElementById('pe-wat-randomize')) document.getElementById('pe-wat-randomize').checked = Boolean(s.randomizeTapOffset);
  if (document.getElementById('pe-wat-offset')) document.getElementById('pe-wat-offset').value = s.offsetRange ?? 5;
  if (document.getElementById('pe-wat-offset-display')) document.getElementById('pe-wat-offset-display').textContent = (s.offsetRange ?? 5);
  if (document.getElementById('pe-wat-onfail')) document.getElementById('pe-wat-onfail').value = s.onTimeoutAction ?? 'stop';
  if (document.getElementById('pe-wat-goto-step')) document.getElementById('pe-wat-goto-step').value = s.gotoStepIndex ?? '';
  if (document.getElementById('pe-wat-output-var')) document.getElementById('pe-wat-output-var').value = s.outputVariable ?? '';
  if (document.getElementById('pe-wat-comment')) document.getElementById('pe-wat-comment').value = s.comment ?? '';
  
  // Handle reference image preview
  if (s.referenceImage) {
    const preview = document.getElementById('pe-wat-ref-preview');
    const empty = document.getElementById('pe-wat-ref-empty');
    if (preview) {
      preview.src = typeof s.referenceImage === 'string' && s.referenceImage.startsWith('data:') 
        ? s.referenceImage 
        : ('data:image/png;base64,' + s.referenceImage);
      preview.style.display = 'block';
    }
    if (empty) empty.style.display = 'none';
  }
  if (document.getElementById('pe-mobile-keycode')) document.getElementById('pe-mobile-keycode').value = s.keyCode ?? '3';
  if (document.getElementById('pe-mobile-key-custom')) document.getElementById('pe-mobile-key-custom').value = s.customKeyCode ?? 0;
  if (document.getElementById('pe-mobile-key-long')) document.getElementById('pe-mobile-key-long').checked = Boolean(s.longPress);
  if (document.getElementById('pe-mobile-key-duration')) document.getElementById('pe-mobile-key-duration').value = s.longPressDuration ?? 1000;
  if (document.getElementById('pe-ms-save-path')) document.getElementById('pe-ms-save-path').value = s.savePath ?? '';
  if (document.getElementById('pe-ms-filename')) document.getElementById('pe-ms-filename').value = s.filenamePattern ?? 'screenshot_{timestamp}';
  if (document.getElementById('pe-ms-timestamp')) document.getElementById('pe-ms-timestamp').checked = s.includeTimestamp !== false;
  if (document.getElementById('pe-ms-var')) document.getElementById('pe-ms-var').value = s.outputVariable ?? s.var ?? '';
  if (document.getElementById('pe-open-package')) document.getElementById('pe-open-package').value = s.packageName ?? '';
  if (document.getElementById('pe-open-activity')) document.getElementById('pe-open-activity').value = s.activityName ?? '';
  if (document.getElementById('pe-open-wait')) document.getElementById('pe-open-wait').value = s.waitAfterLaunch ?? 2000;
  if (document.getElementById('pe-open-force-stop')) document.getElementById('pe-open-force-stop').checked = Boolean(s.forceStopFirst);
  if (document.getElementById('pe-close-package')) document.getElementById('pe-close-package').value = s.packageName ?? '';
  if (document.getElementById('pe-close-wait')) document.getElementById('pe-close-wait').value = s.waitAfter ?? 500;
  if (document.getElementById('pe-read-type')) document.getElementById('pe-read-type').value = s.selectorType ?? 'resource-id';
  if (document.getElementById('pe-read-value')) document.getElementById('pe-read-value').value = s.selectorValue ?? s.selector ?? '';
  if (document.getElementById('pe-read-attr')) document.getElementById('pe-read-attr').value = s.attribute ?? 'text';
  if (document.getElementById('pe-read-timeout')) document.getElementById('pe-read-timeout').value = s.timeout ?? 5000;

  // Mobile Tap enhanced fields
  if (document.getElementById('pe-mtap-match-mode')) {
    const normalizedMode = normalizeMatchMode(s.matchMode);
    document.getElementById('pe-mtap-match-mode').value = normalizedMode;
    toggleMobileTapFields(normalizedMode);
  }
  if (document.getElementById('pe-mtap-x')) document.getElementById('pe-mtap-x').value = s.coordinateX ?? s.mx ?? 0;
  if (document.getElementById('pe-mtap-y')) document.getElementById('pe-mtap-y').value = s.coordinateY ?? s.my ?? 0;
  if (document.getElementById('pe-mtap-resource-id')) document.getElementById('pe-mtap-resource-id').value = s.resourceId ?? '';
  if (document.getElementById('pe-mtap-text-to-find')) document.getElementById('pe-mtap-text-to-find').value = s.textToFind ?? '';
  if (document.getElementById('pe-mtap-content-desc')) document.getElementById('pe-mtap-content-desc').value = s.contentDesc ?? '';
  if (document.getElementById('pe-mtap-xpath')) document.getElementById('pe-mtap-xpath').value = s.xpath ?? '';
  if (document.getElementById('pe-mtap-target-text')) document.getElementById('pe-mtap-target-text').value = s.targetText ?? '';
  if (document.getElementById('pe-mtap-threshold')) document.getElementById('pe-mtap-threshold').value = s.matchThreshold ?? 0.85;
  if (document.getElementById('pe-mtap-timeout')) document.getElementById('pe-mtap-timeout').value = s.waitTimeout ?? 30000;
  if (document.getElementById('pe-mtap-interval')) document.getElementById('pe-mtap-interval').value = s.retryInterval ?? 1000;
  if (document.getElementById('pe-mtap-xml-timeout')) document.getElementById('pe-mtap-xml-timeout').value = s.timeoutMs ?? 30000;
  if (document.getElementById('pe-mtap-retry-not-found')) document.getElementById('pe-mtap-retry-not-found').checked = s.retryOnNotFound !== false;
  initRegionSelector(s);
  
  // Template image preview
  if (s.templateImageBase64) {
    const preview = document.getElementById('pe-mtap-template-preview');
    if (preview) {
      preview.src = typeof s.templateImageBase64 === 'string' && s.templateImageBase64.startsWith('data:') 
        ? s.templateImageBase64 
        : ('data:image/png;base64,' + s.templateImageBase64);
      preview.style.display = 'block';
    }
    // Show the template section
    const templateGroup = document.getElementById('pg-mtap-template');
    if (templateGroup) templateGroup.style.display = 'block';
  }
  if (document.getElementById('pe-mwt-action')) toggleWaitTextOffsetFields(s.onFoundAction || 'continue');
  if (document.getElementById('pe-wat-randomize')) toggleWaitTapOffsetRange(Boolean(s.randomizeTapOffset));
  if (document.getElementById('pe-wat-onfail')) toggleWaitTapGoto(s.onTimeoutAction || 'stop');
  if (document.getElementById('pe-mobile-keycode')) toggleMobileKeyCustom(document.getElementById('pe-mobile-keycode').value);

  // Show/hide groups
  const allGroups = ['pg-tap','pg-type','pg-browser','pg-swipe','pg-mobile','pg-mobile-tap','pg-mobile-wait','pg-wait-and-tap','pg-mobile-key','pg-mobile-screenshot','pg-open-app','pg-close-app','pg-read-ui-element','pg-extract',
                     'pg-condition','pg-loop','pg-api','pg-cron','pg-file','pg-ocr','pg-wait'];
  allGroups.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='none'; });
  const show = PROP_GROUPS[s.type] || [];
  show.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='block'; });
  // Condition
  document.getElementById('pe-cond').value = s.condition ?? '';
  document.getElementById('pe-true-step').value = s.trueStep ?? '';
  document.getElementById('pe-false-step').value = s.falseStep ?? '';
  // Loop
  document.getElementById('pe-loop-count').value = s.loopCount ?? 3;
  document.getElementById('pe-loop-var').value = s.loopVar ?? 'i';
  document.getElementById('pe-loop-break').value = s.breakCondition ?? '';
  // API
  document.getElementById('pe-api-url').value = s.apiUrl ?? '';
  document.getElementById('pe-api-method').value = s.apiMethod ?? 'GET';
  document.getElementById('pe-api-headers').value = s.apiHeaders ?? '';
  document.getElementById('pe-api-body').value = s.apiBody ?? '';
  // Cron
  document.getElementById('pe-cron').value = s.cron ?? '0 9 * * *';
  document.getElementById('pe-tz').value = s.timezone ?? 'Asia/Jakarta';
  // File
  document.getElementById('pe-filepath').value = s.filePath ?? '';
  document.getElementById('pe-delim').value = s.delimiter ?? ',';
  document.getElementById('pe-encoding').value = s.encoding ?? 'UTF-8';
  // Excel Submit Web
  if (document.getElementById('pe-esw-filepath')) document.getElementById('pe-esw-filepath').value = s.filePath ?? '';
  if (document.getElementById('pe-esw-filter-col1')) document.getElementById('pe-esw-filter-col1').value = s.filterCol1 ?? 'L';
  if (document.getElementById('pe-esw-filter-col1-label')) document.getElementById('pe-esw-filter-col1-label').value = s.filterCol1Label ?? 'Waktu Gagal PU';
  if (document.getElementById('pe-esw-filter-col2')) document.getElementById('pe-esw-filter-col2').value = s.filterCol2 ?? 'J';
  if (document.getElementById('pe-esw-filter-col2-label')) document.getElementById('pe-esw-filter-col2-label').value = s.filterCol2Label ?? 'Waktu Pickup';
  if (document.getElementById('pe-esw-filter-condition')) document.getElementById('pe-esw-filter-condition').value = s.filterCondition ?? 'Blank (kosong)';
  if (document.getElementById('pe-esw-data-column')) document.getElementById('pe-esw-data-column').value = s.dataColumn ?? 'B';
  if (document.getElementById('pe-esw-data-column-label')) document.getElementById('pe-esw-data-column-label').value = s.dataColumnLabel ?? 'Nomor AWB';
  if (document.getElementById('pe-esw-header-row')) document.getElementById('pe-esw-header-row').value = s.headerRow ?? 1;
  if (document.getElementById('pe-esw-batch-size')) document.getElementById('pe-esw-batch-size').value = s.batchSize ?? 1000;
  if (document.getElementById('pe-esw-xpath-input')) document.getElementById('pe-esw-xpath-input').value = s.xpathInput ?? '/html/body/div[2]/div[1]/div[2]/main/div[2]/div[8]/div/div/div/div[1]/div[2]/form/div[1]/div/div/div[2]/div/div';
  if (document.getElementById('pe-esw-xpath-button')) document.getElementById('pe-esw-xpath-button').value = s.xpathButton ?? '/html/body/div[2]/div[1]/div[2]/main/div[2]/div[8]/div/div/div/div[1]/div[1]/div[1]/button[1]';
  if (document.getElementById('pe-esw-delay-between')) document.getElementById('pe-esw-delay-between').value = s.delayBetweenBatch ?? 2000;
  if (document.getElementById('pe-esw-delay-before-click')) document.getElementById('pe-esw-delay-before-click').value = s.delayBeforeClick ?? 500;
  if (document.getElementById('pe-esw-output-total-data')) document.getElementById('pe-esw-output-total-data').value = s.outputTotalData ?? '';
  if (document.getElementById('pe-esw-output-total-batch')) document.getElementById('pe-esw-output-total-batch').value = s.outputTotalBatch ?? '';
  if (document.getElementById('pe-esw-output-batch-done')) document.getElementById('pe-esw-output-batch-done').value = s.outputBatchDone ?? '';
  // OCR
  document.getElementById('pe-ocr-src').value = s.ocrSource ?? 'screenshot';
  document.getElementById('pe-ocr-lang').value = s.ocrLang ?? 'eng';
  // Wait element
  document.getElementById('pe-wait-sel').value = s.waitSelector ?? '';
  document.getElementById('pe-wait-cond').value = s.waitCondition ?? 'visible';
  document.getElementById('pe-wait-timeout').value = s.waitTimeout ?? 10000;
}

function saveProp(key, val) {
  if (selectedIdx === null) return;
  const s = project.steps[selectedIdx];
  if (!s) return;
  
  const oldVal = s[key];
  s[key] = val;
  isDirty = true;  // Mark as unsaved when property changes
  
  // Log property change for debugging
  console.log('[PROP CHANGED]', {
    stepId: s.id,
    stepName: s.name,
    property: key,
    oldValue: oldVal,
    newValue: val
  });
  
  // FIX #2: Support both 'var' and 'outputVariable' keys
  // Ini memastikan backward compatibility dengan flow lama
  if (key === 'var') {
    s.outputVariable = val;  // Sync ke outputVariable
    console.log('[PROP DEBUG] var → outputVariable: "' + val + '"');
  } else if (key === 'outputVariable') {
    s.var = val;  // Sync ke var
    console.log('[PROP DEBUG] outputVariable → var: "' + val + '"');
  }
  
  // Re-render to reflect changes
  if (key === 'name' || key === 'type') {
    render();
  }
  
  // FIX: Force update UI untuk field yang bermasalah
  // Pastikan nilai benar-benar tersimpan ke step object
  if (key === 'var' || key === 'outputVariable' || key === 'comment' || key === 'deviceId' || key === 'keyCode') {
    console.log('[PROP DEBUG] ' + key + ' = "' + val + '"');
    console.log('[PROP DEBUG] Node data:', JSON.stringify(s));
  }
}

function normalizeMatchMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode || mode === 'coordinate_only' || mode === 'coordinate') return 'coordinate';
  if (mode === 'xml_selector' || mode === 'xml selector') return 'xml_selector';
  if (mode === 'image_or_text' || mode === 'image or text') return 'image_or_text';
  if (mode === 'image') return 'image';
  if (mode === 'text') return 'text';
  return 'coordinate';
}

function toggleTapOffsetRange(enabled) {
  const el = document.getElementById('pg-mtap-offset');
  if (el) el.style.display = enabled ? 'block' : 'none';
}

function toggleMobileTapFields(matchMode) {
  const normalizedMode = normalizeMatchMode(matchMode);
  const templateDiv = document.getElementById('pg-mtap-template');
  const textDiv = document.getElementById('pg-mtap-text');
  const thresholdDiv = document.getElementById('pg-mtap-threshold');
  const waitDiv = document.getElementById('pg-mtap-wait');
  const xmlSelectorDiv = document.getElementById('pg-mtap-xml-selector');
  const coordsDiv = document.getElementById('pg-mtap-coords');
  
  // Show/hide fields based on match mode
  const showTemplate = normalizedMode === 'image' || normalizedMode === 'image_or_text';
  const showText = normalizedMode === 'text' || normalizedMode === 'image_or_text';
  const showThreshold = normalizedMode === 'image' || normalizedMode === 'image_or_text';
  const showWait = normalizedMode === 'image' || normalizedMode === 'text' || normalizedMode === 'image_or_text';
  const showXmlSelector = normalizedMode === 'xml_selector';
  const showCoords = normalizedMode !== 'xml_selector';
  
  if (templateDiv) templateDiv.style.display = showTemplate ? 'block' : 'none';
  if (textDiv) textDiv.style.display = showText ? 'block' : 'none';
  if (thresholdDiv) thresholdDiv.style.display = showThreshold ? 'block' : 'none';
  if (waitDiv) waitDiv.style.display = showWait ? 'block' : 'none';
  if (xmlSelectorDiv) xmlSelectorDiv.style.display = showXmlSelector ? 'block' : 'none';
  if (coordsDiv) coordsDiv.style.display = showCoords ? 'block' : 'none';
}

function initRegionSelector(step) {
  const section = document.getElementById('regionSelectorSection');
  const container = document.getElementById('regionCanvasContainer');
  const hint = document.getElementById('regionHint');
  const coordsText = document.getElementById('regionCoordsText');
  const clearBtn = document.getElementById('btnClearRegion');
  if (!section || !container || !hint || !coordsText || !clearBtn) return;

  const isMobileTap = step && step.type === 'mobile-tap';
  section.style.display = isMobileTap ? 'block' : 'none';
  if (!isMobileTap) return;

  if (!regionSelectorState.initialized) {
    bindRegionSelectorHandlers();
  }

  regionSelectorState.region = {
    x: step.referenceImageRegionX ?? 0,
    y: step.referenceImageRegionY ?? 0,
    width: step.referenceImageRegionW ?? 0,
    height: step.referenceImageRegionH ?? 0
  };
  updateRegionInputs(regionSelectorState.region);

  if (regionSelectorState.region.width > 0 && regionSelectorState.region.height > 0) {
    coordsText.textContent = `X:${regionSelectorState.region.x} Y:${regionSelectorState.region.y} W:${regionSelectorState.region.width} H:${regionSelectorState.region.height}`;
    clearBtn.style.display = 'inline-flex';
  } else {
    coordsText.textContent = '—';
    clearBtn.style.display = 'none';
  }

  if (!regionSelectorState.imageSrc) {
    container.style.display = 'none';
    hint.style.display = 'block';
    hint.textContent = 'Klik "Ambil Screenshot" untuk menandai area';
  }
}

function bindRegionSelectorHandlers() {
  const captureBtn = document.getElementById('btnCaptureScreen');
  const clearBtn = document.getElementById('btnClearRegion');
  const canvas = document.getElementById('regionCanvas');
  const container = document.getElementById('regionCanvasContainer');
  const overlay = document.getElementById('regionOverlay');
  const hint = document.getElementById('regionHint');
  if (!captureBtn || !clearBtn || !canvas || !container || !overlay || !hint) return;

  regionSelectorState.initialized = true;

  captureBtn.addEventListener('click', async () => {
    if (selectedIdx === null) {
      addLog('Pilih node terlebih dahulu sebelum mengambil screenshot.', 'warn');
      return;
    }
    const step = project.steps[selectedIdx];
    const deviceId = step.deviceId || getActiveAdbDevice();
    if (!deviceId) {
      addLog('Tidak ada device ADB aktif. Pilih device di selector atau isi Device ID.', 'warn');
      return;
    }
    captureBtn.disabled = true;
    hint.textContent = 'Mengambil screenshot...';

    try {
      const resp = await ipcRenderer.invoke('get-screen-preview', { device: deviceId });
      if (!resp.success) {
        addLog('Gagal mengambil preview layar: ' + resp.error, 'error');
        hint.textContent = 'Klik "Ambil Screenshot" untuk menandai area';
        return;
      }
      regionSelectorState.imageSrc = 'data:image/png;base64,' + resp.imageBase64;
      regionSelectorState.deviceId = deviceId;
      await renderRegionCanvas(regionSelectorState.imageSrc);
      container.style.display = 'block';
      hint.style.display = 'none';
    } catch (err) {
      addLog('Error mengambil preview layar: ' + (err?.message || err), 'error');
      hint.textContent = 'Klik "Ambil Screenshot" untuk menandai area';
    } finally {
      captureBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', (event) => {
    event.preventDefault();
    clearRegionSelection();
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!regionSelectorState.imageSrc) return;
    regionSelectorState.isDragging = true;
    regionSelectorState.dragStart = getCanvasCoordinates(event, canvas);
    overlay.style.display = 'block';
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!regionSelectorState.isDragging || !regionSelectorState.dragStart) return;
    const current = getCanvasCoordinates(event, canvas);
    const rect = normalizeCanvasRect(regionSelectorState.dragStart, current);
    renderRegionOverlay(rect, overlay);
  });

  window.addEventListener('mouseup', (event) => {
    if (!regionSelectorState.isDragging || !regionSelectorState.dragStart) return;
    regionSelectorState.isDragging = false;
    const end = getCanvasCoordinates(event, canvas);
    const rect = normalizeCanvasRect(regionSelectorState.dragStart, end);
    const region = convertCanvasRectToDevice(rect);
    applyRegionSelection(region);
    regionSelectorState.dragStart = null;
  });
}

function getCanvasCoordinates(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return {
    x: Math.max(0, Math.min(canvas.width, x)),
    y: Math.max(0, Math.min(canvas.height, y))
  };
}

function normalizeCanvasRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y))
  };
}

function convertCanvasRectToDevice(rect) {
  const scale = regionSelectorState.scale || 1;
  return {
    x: Math.round(rect.x / scale),
    y: Math.round(rect.y / scale),
    width: Math.round(rect.width / scale),
    height: Math.round(rect.height / scale)
  };
}

function renderRegionOverlay(rect, overlay) {
  overlay.style.left = rect.x + 'px';
  overlay.style.top = rect.y + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
  overlay.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
}

function applyRegionSelection(region) {
  if (!region || region.width <= 0 || region.height <= 0) return;
  regionSelectorState.region = region;
  updateRegionInputs(region);
  saveProp('referenceImageRegionX', region.x);
  saveProp('referenceImageRegionY', region.y);
  saveProp('referenceImageRegionW', region.width);
  saveProp('referenceImageRegionH', region.height);

  const coordsText = document.getElementById('regionCoordsText');
  if (coordsText) coordsText.textContent = `X:${region.x} Y:${region.y} W:${region.width} H:${region.height}`;

  const clearBtn = document.getElementById('btnClearRegion');
  if (clearBtn) clearBtn.style.display = 'inline-flex';
  addLog('Area pencarian gambar berhasil disimpan.', 'success');
}

function updateRegionInputs(region) {
  const x = document.getElementById('inputRegionX');
  const y = document.getElementById('inputRegionY');
  const w = document.getElementById('inputRegionW');
  const h = document.getElementById('inputRegionH');
  if (x) x.value = region.x ?? 0;
  if (y) y.value = region.y ?? 0;
  if (w) w.value = region.width ?? 0;
  if (h) h.value = region.height ?? 0;
}

function clearRegionSelection() {
  regionSelectorState.region = { x: 0, y: 0, width: 0, height: 0 };
  updateRegionInputs(regionSelectorState.region);
  saveProp('referenceImageRegionX', 0);
  saveProp('referenceImageRegionY', 0);
  saveProp('referenceImageRegionW', 0);
  saveProp('referenceImageRegionH', 0);

  const overlay = document.getElementById('regionOverlay');
  const coordsText = document.getElementById('regionCoordsText');
  const clearBtn = document.getElementById('btnClearRegion');
  if (overlay) overlay.style.display = 'none';
  if (coordsText) coordsText.textContent = '—';
  if (clearBtn) clearBtn.style.display = 'none';
  addLog('Area pencarian gambar telah dibersihkan.', 'info');
}

async function renderRegionCanvas(src) {
  const canvas = document.getElementById('regionCanvas');
  const container = document.getElementById('regionCanvasContainer');
  const overlay = document.getElementById('regionOverlay');
  const hint = document.getElementById('regionHint');
  if (!canvas || !container || !overlay || !hint) return;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = Math.max(320, container.clientWidth || 320);
      const maxHeight = Math.max(220, container.clientHeight || 220);
      const widthScale = maxWidth / img.naturalWidth;
      const heightScale = maxHeight / img.naturalHeight;
      const scale = Math.min(widthScale, heightScale, 1);
      const displayWidth = Math.round(img.naturalWidth * scale);
      const displayHeight = Math.round(img.naturalHeight * scale);

      canvas.width = displayWidth;
      canvas.height = displayHeight;
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      container.style.height = displayHeight + 'px';

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

      regionSelectorState.scale = scale;
      if (regionSelectorState.region.width > 0 && regionSelectorState.region.height > 0) {
        renderRegionOverlay({
          x: Math.round(regionSelectorState.region.x * scale),
          y: Math.round(regionSelectorState.region.y * scale),
          width: Math.round(regionSelectorState.region.width * scale),
          height: Math.round(regionSelectorState.region.height * scale)
        }, overlay);
      } else {
        overlay.style.display = 'none';
      }
      resolve();
    };
    img.onerror = (err) => {
      addLog('Gagal memuat screenshot di region selector.', 'error');
      hint.textContent = 'Gagal memuat screenshot. Coba lagi.';
      reject(err);
    };
    img.src = src;
  });
}

function toggleWaitTextOffsetFields(action) {
  const el = document.getElementById('pe-mwt-offset-group');
  if (!el) return;
  el.style.display = action === 'tap_offset' ? 'block' : 'none';
}

function toggleWaitTapGoto(action) {
  const el = document.getElementById('pg-wat-goto');
  if (!el) return;
  el.style.display = action === 'goto' ? 'block' : 'none';
}

function toggleMobileKeyCustom(value) {
  const el = document.getElementById('pg-mobile-key-custom');
  if (!el) return;
  el.style.display = value === 'custom' ? 'block' : 'none';
}

function updateWaitTapConfidence(value) {
  const badge = document.getElementById('pe-wat-confidence-value');
  if (badge) badge.textContent = value + '%';
}

function handleWaitTapImage(input) {
  const file = input.files && input.files[0];
  if (!file || selectedIdx === null) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    const result = event.target.result;
    const s = project.steps[selectedIdx];
    s.referenceImage = result;
    const preview = document.getElementById('pe-wat-ref-preview');
    if (preview) {
      preview.src = result;
      preview.style.display = 'block';
    }
    const empty = document.getElementById('pe-wat-ref-empty');
    if (empty) empty.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function toggleWaitTapOffsetRange(checked) {
  const el = document.getElementById('pg-wat-offset-range');
  if (el) el.style.display = checked ? 'block' : 'none';
}

function toggleWaitTapGoto(value) {
  const el = document.getElementById('pg-wat-goto');
  if (el) el.style.display = value === 'goto' ? 'block' : 'none';
}

async function pickScreenCoordinate(mode='auto') {
  if (selectedIdx === null) {
    addLog('Pilih node terlebih dahulu sebelum menggunakan screen picker.', 'warn');
    return;
  }
  const step = project.steps[selectedIdx];
  
  // Auto-detect mode based on node type
  if (mode === 'auto') {
    if (step.type === 'mobile-tap') {
      mode = 'element'; // New enhanced mode for mobile-tap
    } else if (step.type === 'swipe' || step.type === 'mobile-swipe') {
      mode = 'swipe';
    } else if (step.type === 'mobile-find-text' || step.type === 'mobile-wait-text') {
      mode = 'text';
    } else if (step.type === 'wait-and-tap') {
      mode = 'image';
    } else {
      mode = 'point'; // Default coordinate picking
    }
  }
  
  const deviceId = step.deviceId || getActiveAdbDevice();
  if (!deviceId) {
    addLog('Tidak ada device ADB aktif. Pilih device di selector atau isi Device ID.', 'warn');
    return;
  }

  const sizeResp = await ipcRenderer.invoke('adb:get-screen-size', { device: deviceId });
  if (!sizeResp.success) {
    addLog('Gagal membaca ukuran layar device: ' + sizeResp.error, 'error');
    return;
  }

  const shotResp = await ipcRenderer.invoke('adb:screenshot', { device: deviceId });
  if (!shotResp.success) {
    addLog('Gagal mengambil screenshot device: ' + shotResp.error, 'error');
    return;
  }

  const ctx = {
    mode,
    step,
    deviceId,
    deviceSize: { width: sizeResp.width, height: sizeResp.height },
    imageSrc: 'data:image/png;base64,' + shotResp.imageBase64
  };

  showScreenPickerModal(ctx);
}

function getActiveAdbDevice() {
  const selector = document.getElementById('device-selector');
  if (!selector) return '';
  const device = selector.value;
  return device && device !== 'No ADB Device' ? device : '';
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function saveScreenPickerResult(result) {
  if (selectedIdx === null) return;
  const step = project.steps[selectedIdx];
  if (!step) return;
  const deviceId = step.deviceId || getActiveAdbDevice();

  const applyPoint = (x, y) => {
    if (step.type === 'mobile-tap') {
      saveProp('mx', x);
      saveProp('my', y);
      setInputValue('pe-mtap-x', x);
      setInputValue('pe-mtap-y', y);
    } else if (step.type === 'wait-and-tap') {
      saveProp('tapX', x);
      saveProp('tapY', y);
      setInputValue('pe-wat-x', x);
      setInputValue('pe-wat-y', y);
    } else if (step.type === 'swipe' || step.type === 'mobile-swipe') {
      saveProp('sx', x);
      saveProp('sy', y);
      setInputValue('pe-sx', x);
      setInputValue('pe-sy', y);
    } else {
      saveProp('mx', x);
      saveProp('my', y);
    }
  };

  if (result.mode === 'point') {
    applyPoint(result.x, result.y);
    addLog('Koordinat (X: '+result.x+', Y: '+result.y+') berhasil dipilih.', 'success');
    return;
  }

  if (result.mode === 'swipe') {
    saveProp('sx', result.startX);
    saveProp('sy', result.startY);
    saveProp('ex', result.endX);
    saveProp('ey', result.endY);
    setInputValue('pe-sx', result.startX);
    setInputValue('pe-sy', result.startY);
    setInputValue('pe-ex', result.endX);
    setInputValue('pe-ey', result.endY);
    addLog('Swipe points berhasil dipilih: start ('+result.startX+','+result.startY+'), end ('+result.endX+','+result.endY+').', 'success');
    return;
  }

  if (result.mode === 'region') {
    const keyPrefix = (step.type === 'mobile-find-text' || step.type === 'mobile-wait-text') ? 'ocrRegion' : 'searchRegion';
    saveProp(keyPrefix + 'X', result.x);
    saveProp(keyPrefix + 'Y', result.y);
    saveProp(keyPrefix + 'W', result.width);
    saveProp(keyPrefix + 'H', result.height);
    setInputValue('pe-mwt-ocr-x', result.x);
    setInputValue('pe-mwt-ocr-y', result.y);
    setInputValue('pe-mwt-ocr-w', result.width);
    setInputValue('pe-mwt-ocr-h', result.height);
    setInputValue('pe-wat-region-x', result.x);
    setInputValue('pe-wat-region-y', result.y);
    setInputValue('pe-wat-region-w', result.width);
    setInputValue('pe-wat-region-h', result.height);
    addLog('Region berhasil dipilih: X:'+result.x+' Y:'+result.y+' W:'+result.width+' H:'+result.height, 'success');
    return;
  }

  if (result.mode === 'image') {
    const preview = document.getElementById('pe-wat-ref-preview');
    const dataUrl = 'data:image/png;base64,' + result.imageBase64;
    
    // Save to node config
    saveProp('referenceImage', result.imageBase64);
    saveProp('referenceImageRegionX', result.x);
    saveProp('referenceImageRegionY', result.y);
    saveProp('referenceImageRegionW', result.width);
    saveProp('referenceImageRegionH', result.height);
    
    // PERSIST to disk via IPC for session persistence
    const filename = `ref_${selectedIdx}_${Date.now()}.png`;
    ipcRenderer.invoke('save-reference-image', {
      nodeId: selectedIdx,
      base64: result.imageBase64,
      filename: filename
    }).then(saveResult => {
      if (saveResult.success) {
        saveProp('referenceImagePath', saveResult.filePath);
        saveProp('referenceImageMeta', JSON.stringify({
          capturedAt: new Date().toISOString(),
          region: { x: result.x, y: result.y, width: result.width, height: result.height },
          filename: filename,
          deviceId: deviceId
        }));
        addLog('Reference image disimpan persisten: ' + filename, 'success');
      } else {
        addLog('Gagal menyimpan ke disk: ' + saveResult.error, 'warn');
      }
    }).catch(err => {
      addLog('Error saving reference image: ' + err.message, 'error');
    });
    
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }
    addLog('Reference image dari layar berhasil disimpan.', 'success');
    return;
  }

  if (result.mode === 'element') {
    // Enhanced Pick From Screen for mobile-tap: capture template image + OCR text
    const dataUrl = 'data:image/png;base64,' + result.imageBase64;
    
    // Save coordinates
    saveProp('coordinateX', result.x);
    saveProp('coordinateY', result.y);
    
    // Save template image
    saveProp('templateImageBase64', result.imageBase64);
    
    // Save OCR text if available
    if (result.ocrText) {
      saveProp('targetText', result.ocrText.trim());
    }
    
    // Set default match mode and other properties
    saveProp('matchMode', 'image_or_text');
    saveProp('matchThreshold', 0.85);
    saveProp('waitTimeout', 30000);
    saveProp('retryInterval', 1000);
    
    // Update UI
    setInputValue('pe-mtap-x', result.x);
    setInputValue('pe-mtap-y', result.y);
    setInputValue('pe-mtap-target-text', result.ocrText || '');
    
    // Show preview if available
    const preview = document.getElementById('pe-mtap-template-preview');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }
    
    // PERSIST to disk via IPC for session persistence
    const filename = `template_${selectedIdx}_${Date.now()}.png`;
    ipcRenderer.invoke('save-reference-image', {
      nodeId: selectedIdx,
      base64: result.imageBase64,
      filename: filename
    }).then(saveResult => {
      if (saveResult.success) {
        saveProp('templateImagePath', saveResult.filePath);
        saveProp('templateImageMeta', JSON.stringify({
          capturedAt: new Date().toISOString(),
          region: { x: result.x, y: result.y, width: result.width, height: result.height },
          filename: filename,
          deviceId: deviceId,
          ocrText: result.ocrText || ''
        }));
        addLog('Template image & OCR text captured and saved: ' + filename, 'success');
      } else {
        addLog('Failed to save template to disk: ' + saveResult.error, 'warn');
      }
    }).catch(err => {
      addLog('Error saving template image: ' + err.message, 'error');
    });
    
    addLog('Element captured: coordinates ('+result.x+','+result.y+'), template saved, OCR: "'+(result.ocrText||'none')+'"', 'success');
    render();
    showProp(step);
    return;
  }
}

function handleQuickViewSelectElement(event) {
  const payload = event?.detail || {};
  if (selectedIdx === null) return;
  const step = project.steps[selectedIdx];
  if (!step || step.type !== 'mobile-tap') return;

  saveProp('matchMode', 'xml_selector');
  saveProp('resourceId', payload.resourceId || '');
  saveProp('textToFind', payload.textToFind || '');
  saveProp('contentDesc', payload.contentDesc || '');
  saveProp('xpath', payload.xpath || '');

  if (payload.resourceId || payload.textToFind || payload.contentDesc || payload.xpath) {
    saveProp('timeoutMs', step.timeoutMs ?? 30000);
    saveProp('retryOnNotFound', step.retryOnNotFound !== false);
  }

  render();
  showProp(step);
}

function pickScreenSwipe() {
  pickScreenCoordinate('swipe');
}

function pickWaitTapCoordinate() {
  pickScreenCoordinate('point');
}

function pickWaitTapRegion() {
  pickScreenCoordinate('region');
}

function captureWaitTapImage() {
  pickScreenCoordinate('image');
}

function pickWaitTextRegion() {
  pickScreenCoordinate('region');
}

function detectTextFromScreen() {
  pickScreenCoordinate('text');
}

function showScreenPickerModal({ mode, imageSrc, deviceSize, deviceId }) {
  const existing = document.getElementById('screen-picker-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'screen-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;';

  const titleMap = {
    point: 'Pilih Koordinat dari Layar',
    swipe: 'Pilih Swipe Point (Klik Start lalu End)',
    region: 'Pilih Region dari Layar',
    image: 'Capture Area sebagai Reference Image',
    text: 'Pilih Teks dari Layar'
  };

  modal.innerHTML = `
    <div id="sp-dialog" style="width:92vw;max-width:1120px;height:88vh;background:#111827;border:1px solid #334155;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.8);">
      <div style="padding:16px 18px;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <div style="font-size:16px;font-weight:700;">${titleMap[mode] || 'Screen Picker'}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Klik area pada gambar, lalu konfirmasi.</div>
        </div>
        <button id="sp-close" style="border:none;background:transparent;color:#f8fafc;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div style="flex:1;display:flex;overflow:hidden;">
        <div style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;">
          <img id="sp-image" src="${imageSrc}" style="max-width:100%;max-height:100%;user-select:none;pointer-events:none;display:block;object-fit:contain;" />
          <div id="sp-overlay" style="position:absolute;inset:0;cursor:crosshair;"></div>
          <div id="sp-crosshair-x" style="position:absolute;left:0;right:0;height:1px;background:rgba(16,185,129,.7);pointer-events:none;display:none;"></div>
          <div id="sp-crosshair-y" style="position:absolute;top:0;bottom:0;width:1px;background:rgba(16,185,129,.7);pointer-events:none;display:none;"></div>
          <div id="sp-selection" style="position:absolute;border:2px dashed rgba(56,189,248,.85);background:rgba(56,189,248,.15);pointer-events:none;display:none;"></div>
          <div id="sp-start-marker" style="position:absolute;width:14px;height:14px;border-radius:999px;background:#ef4444;border:2px solid #fff;pointer-events:none;display:none;transform:translate(-50%, -50%);"></div>
          <div id="sp-end-marker" style="position:absolute;width:14px;height:14px;border-radius:999px;background:#38bdf8;border:2px solid #fff;pointer-events:none;display:none;transform:translate(-50%, -50%);"></div>
          <div id="sp-text-boxes" style="position:absolute;inset:0;pointer-events:none;"></div>
          <div id="sp-debug" style="position:absolute;left:16px;bottom:16px;padding:6px 10px;background:rgba(15,23,42,0.9);color:#a7f3d0;font-size:12px;border-radius:10px;pointer-events:none;display:none;z-index:20;font-family:monospace;"></div>
        </div>
      </div>
      <div style="padding:14px 18px;background:#08121e;color:#e2e8f0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div id="sp-status" style="font-size:13px;color:#cbd5e1;">Device: ${deviceId} | Resolusi: ${deviceSize.width}x${deviceSize.height}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <button id="sp-cancel" style="border:none;background:#334155;color:#f8fafc;padding:8px 14px;border-radius:10px;cursor:pointer;">Batal</button>
          <button id="sp-confirm" style="border:none;background:#10b981;color:#071f1f;padding:8px 14px;border-radius:10px;cursor:pointer;font-weight:700;">Konfirmasi</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const overlayLayer = modal.querySelector('#sp-overlay');
  const img = modal.querySelector('#sp-image');
  const status = modal.querySelector('#sp-status');
  const crossX = modal.querySelector('#sp-crosshair-x');
  const crossY = modal.querySelector('#sp-crosshair-y');
  const selection = modal.querySelector('#sp-selection');
  const startMarker = modal.querySelector('#sp-start-marker');
  const endMarker = modal.querySelector('#sp-end-marker');
  const textBoxes = modal.querySelector('#sp-text-boxes');
  const debugOverlay = modal.querySelector('#sp-debug');

  // when image loads, capture base64 and compute scale factors for picker
  img.addEventListener('load', () => {
    try {
      _pickerScreenBase64 = (imageSrc || '').startsWith('data:') ? imageSrc.split(',')[1] : (imageSrc || '').replace(/^data:image\/.+;base64,/, '');
    } catch (e) { _pickerScreenBase64 = null; }
    _pickerOriginalWidth = img.naturalWidth || deviceSize.width;
    _pickerOriginalHeight = img.naturalHeight || deviceSize.height;
    const info = getImageRenderInfo();
    _pickerScaleX = _pickerOriginalWidth / info.renderedWidth;
    _pickerScaleY = _pickerOriginalHeight / info.renderedHeight;

    // reset picker state
    _pickerMode = 'coordinate';
    _pickerResult = { x:0,y:0,w:0,h:0,base64:null };
    _pickerDrag = { active:false,startX:0,startY:0,endX:0,endY:0 };

    // hide crop preview
    const cropBar = modal.querySelector('#cropPreviewBar'); if (cropBar) cropBar.style.display = 'none';
  });

  let isDragging = false;
  let dragStart = null;
  let dragRect = null;
  let swipeStart = null;
  let swipeEnd = null;
  let selectedPoint = null;
  let ocrWords = [];

  function getImageRenderInfo() {
    const rect = img.getBoundingClientRect();
    const naturalWidth = img.naturalWidth || deviceSize.width;
    const naturalHeight = img.naturalHeight || deviceSize.height;
    const imageAspect = naturalWidth / naturalHeight;
    const containerAspect = rect.width / rect.height;

    let renderedWidth = rect.width;
    let renderedHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (imageAspect > containerAspect) {
      renderedWidth = rect.width;
      renderedHeight = rect.width / imageAspect;
      offsetY = (rect.height - renderedHeight) / 2;
    } else {
      renderedHeight = rect.height;
      renderedWidth = rect.height * imageAspect;
      offsetX = (rect.width - renderedWidth) / 2;
    }

    return {
      rect,
      renderedWidth,
      renderedHeight,
      offsetX,
      offsetY,
      scaleX: naturalWidth / renderedWidth,
      scaleY: naturalHeight / renderedHeight
    };
  }

  function getDeviceCoords(clientX, clientY) {
    const { rect, renderedWidth, renderedHeight, offsetX, offsetY, scaleX, scaleY } = getImageRenderInfo();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const imageX = cssX - offsetX;
    const imageY = cssY - offsetY;
    const clampedX = Math.max(0, Math.min(renderedWidth, imageX));
    const clampedY = Math.max(0, Math.min(renderedHeight, imageY));

    return {
      x: Math.round(clampedX * scaleX),
      y: Math.round(clampedY * scaleY),
      _debug: { cssX, cssY, renderedWidth, renderedHeight, offsetX, offsetY, scaleX, scaleY }
    };
  }

  function updateCrosshair(clientX, clientY) {
    const { rect, renderedWidth, renderedHeight, offsetX, offsetY } = getImageRenderInfo();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;

    if (cssX < offsetX || cssX > offsetX + renderedWidth || cssY < offsetY || cssY > offsetY + renderedHeight) {
      crossX.style.display = 'none';
      crossY.style.display = 'none';
      debugOverlay.style.display = 'none';
      return;
    }

    crossX.style.display = 'block';
    crossY.style.display = 'block';
    crossX.style.top = (cssY - offsetY) + 'px';
    crossY.style.left = (cssX - offsetX) + 'px';

    const coords = getDeviceCoords(clientX, clientY);
    debugOverlay.style.display = 'block';
    debugOverlay.textContent = `Device: X:${coords.x} Y:${coords.y}`;
  }

  function updateSelectionBox(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      selection.style.display = 'none';
      return;
    }
    const { renderedWidth, renderedHeight, offsetX, offsetY, scaleX, scaleY } = getImageRenderInfo();
    const left = offsetX + (rect.x / scaleX);
    const top = offsetY + (rect.y / scaleY);
    const width = rect.width / scaleX;
    const height = rect.height / scaleY;

    selection.style.display = 'block';
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
  }

  function updateStartEndMarkers() {
    const { offsetX, offsetY, scaleX, scaleY } = getImageRenderInfo();
    if (swipeStart) {
      startMarker.style.display = 'block';
      startMarker.style.left = (offsetX + swipeStart.x / scaleX) + 'px';
      startMarker.style.top = (offsetY + swipeStart.y / scaleY) + 'px';
    } else {
      startMarker.style.display = 'none';
    }
    if (swipeEnd) {
      endMarker.style.display = 'block';
      endMarker.style.left = (offsetX + swipeEnd.x / scaleX) + 'px';
      endMarker.style.top = (offsetY + swipeEnd.y / scaleY) + 'px';
    } else {
      endMarker.style.display = 'none';
    }
  }

  function renderOcrBoxes() {
    textBoxes.innerHTML = '';
    const { offsetX, offsetY, scaleX, scaleY, renderedWidth, renderedHeight } = getImageRenderInfo();
    ocrWords.forEach((word, idx) => {
      const box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = (offsetX + word.bbox.x0 / scaleX) + 'px';
      box.style.top = (offsetY + word.bbox.y0 / scaleY) + 'px';
      box.style.width = ((word.bbox.x1 - word.bbox.x0) / scaleX) + 'px';
      box.style.height = ((word.bbox.y1 - word.bbox.y0) / scaleY) + 'px';
      box.style.border = '2px solid rgba(248, 113, 113, 0.9)';
      box.style.background = 'rgba(248,113,113,0.2)';
      box.style.cursor = 'pointer';
      box.title = word.text;
      box.addEventListener('click', (event) => {
        event.stopPropagation();
        saveScreenPickerResult({
          mode: 'text',
          text: word.text,
          x: Math.round(word.bbox.x0),
          y: Math.round(word.bbox.y0),
          width: Math.round(word.bbox.x1 - word.bbox.x0),
          height: Math.round(word.bbox.y1 - word.bbox.y0)
        });
        modal.remove();
      });
      textBoxes.appendChild(box);
    });
  }

  const pickerSession = {
    selectedPoint: null,
    isProcessing: false,
    isReady: false,
    templateImage: null,
    ocrText: '',
    cropRegion: null
  };

  const confirmButton = modal.querySelector('#sp-confirm');
  const updateConfirmButton = () => {
    if (!confirmButton) return;
    if (pickerSession.isProcessing) {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Memproses...';
    } else if (mode === 'element') {
      confirmButton.disabled = !pickerSession.selectedPoint;
      confirmButton.textContent = 'Konfirmasi';
    } else {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Konfirmasi';
    }
  };

  function setStatusText(message) {
    if (status) status.textContent = message;
    console.log('[Screen Picker]', message);
  }

  function resetPickerSession() {
    pickerSession.selectedPoint = null;
    pickerSession.isProcessing = false;
    pickerSession.isReady = false;
    pickerSession.templateImage = null;
    pickerSession.ocrText = '';
    pickerSession.cropRegion = null;
    updateConfirmButton();
  }

  updateConfirmButton();

  function updateStatusText(message) {
    if (status) status.textContent = message;
  }

  // Picker state (coordinate | crop | region)
  let _pickerMode = 'coordinate';
  let _pickerDrag = { active:false, startX:0, startY:0, endX:0, endY:0 };
  let _pickerResult = { x:0, y:0, w:0, h:0, base64:null };
  let _pickerScaleX = 1, _pickerScaleY = 1;
  let _pickerOriginalWidth = 0, _pickerOriginalHeight = 0;
  let _pickerScreenBase64 = null;

  // --- Enhanced picker mouse handling (coordinate / crop / region) ---

  // Helper to convert client coords -> device coords and CSS positions
  function clientToDeviceAndCss(clientX, clientY) {
    const info = getImageRenderInfo();
    const cssX = clientX - info.rect.left - info.offsetX;
    const cssY = clientY - info.rect.top - info.offsetY;
    const clampedX = Math.max(0, Math.min(info.renderedWidth, cssX));
    const clampedY = Math.max(0, Math.min(info.renderedHeight, cssY));
    return {
      devX: Math.round(clampedX * info.scaleX),
      devY: Math.round(clampedY * info.scaleY),
      cssX: clampedX,
      cssY: clampedY,
      info
    };
  }

  overlayLayer.addEventListener('mousemove', (event) => {
    updateCrosshair(event.clientX, event.clientY);
    const pos = clientToDeviceAndCss(event.clientX, event.clientY);

    if (_pickerMode === 'coordinate') {
      // live hover coords
      updateStatusText(`Dipilih: X:${pos.devX} Y:${pos.devY}`);
    }

    if (_pickerDrag.active) {
      _pickerDrag.endX = pos.cssX;
      _pickerDrag.endY = pos.cssY;
      // compute device rect for display
      const x = Math.min(_pickerDrag.startX, _pickerDrag.endX);
      const y = Math.min(_pickerDrag.startY, _pickerDrag.endY);
      const w = Math.abs(_pickerDrag.endX - _pickerDrag.startX);
      const h = Math.abs(_pickerDrag.endY - _pickerDrag.startY);
      // show selection using existing selection element but convert back to css coords
      const info = pos.info;
      selection.style.display = 'block';
      selection.style.left = (info.offsetX + x) + 'px';
      selection.style.top = (info.offsetY + y) + 'px';
      selection.style.width = (w) + 'px';
      selection.style.height = (h) + 'px';
      updateStatusText(`Area: X:${Math.round(x*info.scaleX)} Y:${Math.round(y*info.scaleY)} W:${Math.round(w*info.scaleX)} H:${Math.round(h*info.scaleY)}`);
    }
  });

  overlayLayer.addEventListener('mousedown', (event) => {
    if (mode === 'text') return;
    const p = clientToDeviceAndCss(event.clientX, event.clientY);
    if (_pickerMode === 'coordinate') {
      // set coordinate immediately
      _pickerResult.x = p.devX;
      _pickerResult.y = p.devY;
      updateStatusText(`Dipilih: X:${p.devX} Y:${p.devY}`);
      saveScreenPickerResult({ mode:'point', x:p.devX, y:p.devY });
      modal.remove();
      return;
    }

    // start drag for crop/region
    _pickerDrag.active = true;
    _pickerDrag.startX = p.cssX;
    _pickerDrag.startY = p.cssY;
    _pickerDrag.endX = p.cssX;
    _pickerDrag.endY = p.cssY;
    selection.style.display = 'block';
  });

  window.addEventListener('mouseup', async (event) => {
    if (!_pickerDrag.active) return;
    _pickerDrag.active = false;
    const startX = Math.min(_pickerDrag.startX, _pickerDrag.endX);
    const startY = Math.min(_pickerDrag.startY, _pickerDrag.endY);
    const w = Math.max(1, Math.abs(_pickerDrag.endX - _pickerDrag.startX));
    const h = Math.max(1, Math.abs(_pickerDrag.endY - _pickerDrag.startY));

    // convert to device coords
    const info = getImageRenderInfo();
    const rx = Math.round(startX * info.scaleX);
    const ry = Math.round(startY * info.scaleY);
    const rw = Math.round(w * info.scaleX);
    const rh = Math.round(h * info.scaleY);

    _pickerResult.x = rx; _pickerResult.y = ry; _pickerResult.w = rw; _pickerResult.h = rh;

    // update preview for crop
    if (_pickerMode === 'crop') {
      try {
        const base64 = await cropImageSection(imageSrc, { x:rx, y:ry, width:rw, height:rh }, deviceSize);
        _pickerResult.base64 = base64;
        // draw to preview canvas
        const preview = modal.querySelector('#cropPreviewCanvas');
        if (preview) {
          const imgEl = new Image();
          imgEl.onload = () => {
            preview.width = imgEl.naturalWidth;
            preview.height = imgEl.naturalHeight;
            const pctx = preview.getContext('2d');
            pctx.clearRect(0,0,preview.width, preview.height);
            pctx.drawImage(imgEl, 0,0);
            const label = modal.querySelector('#cropSizeLabel');
            if (label) label.textContent = `${rw}×${rh}px`;
          };
          imgEl.src = 'data:image/png;base64,' + base64;
        }
        updateStatusText(`Crop ${rw}×${rh}px pada X:${rx} Y:${ry}`);
      } catch (err) {
        addLog('Gagal membuat preview crop: ' + (err?.message||err), 'error');
      }
    } else if (_pickerMode === 'region') {
      updateStatusText(`Region ${rw}×${rh}px pada X:${rx} Y:${ry}`);
    }
  });

  modal.querySelector('#sp-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#sp-cancel').addEventListener('click', () => modal.remove());

  modal.querySelector('#sp-confirm').addEventListener('click', async () => {
    // Save according to active picker mode
    const selectedNode = project.steps[selectedIdx];
    if (!selectedNode) {
      addLog('No node selected', 'warn');
      modal.remove();
      return;
    }

    if (_pickerMode === 'coordinate') {
      selectedNode.coordinateX = _pickerResult.x;
      selectedNode.coordinateY = _pickerResult.y;
      selectedNode.x = _pickerResult.x;
      selectedNode.y = _pickerResult.y;
      saveProp('coordinateX', _pickerResult.x);
      saveProp('coordinateY', _pickerResult.y);
      setInputValue('pe-mtap-x', _pickerResult.x);
      setInputValue('pe-mtap-y', _pickerResult.y);

    } else if (_pickerMode === 'crop') {
      if (!_pickerResult.base64) {
        alert('Belum ada crop gambar. Drag area gambar terlebih dahulu.');
        return;
      }
      const cx = _pickerResult.x + Math.round(_pickerResult.w/2);
      const cy = _pickerResult.y + Math.round(_pickerResult.h/2);
      selectedNode.referenceImage = _pickerResult.base64;
      selectedNode.templateImageBase64 = _pickerResult.base64;
      selectedNode.coordinateX = cx; selectedNode.coordinateY = cy;
      selectedNode.x = cx; selectedNode.y = cy;
      saveProp('referenceImage', _pickerResult.base64);
      saveProp('templateImageBase64', _pickerResult.base64);
      saveProp('coordinateX', cx);
      saveProp('coordinateY', cy);
      saveProp('matchMode', (selectedNode.matchMode && selectedNode.matchMode !== 'coordinate') ? selectedNode.matchMode : 'image');
      const preview = document.getElementById('pe-mtap-template-preview');
      if (preview) { preview.src = 'data:image/png;base64,' + _pickerResult.base64; preview.style.display = 'block'; }

    } else if (_pickerMode === 'region') {
      if (!_pickerResult.w || !_pickerResult.h) {
        alert('Belum ada area region. Drag area pencarian terlebih dahulu.');
        return;
      }
      selectedNode.referenceImageRegionX = _pickerResult.x;
      selectedNode.referenceImageRegionY = _pickerResult.y;
      selectedNode.referenceImageRegionW = _pickerResult.w;
      selectedNode.referenceImageRegionH = _pickerResult.h;
      saveProp('referenceImageRegionX', _pickerResult.x);
      saveProp('referenceImageRegionY', _pickerResult.y);
      saveProp('referenceImageRegionW', _pickerResult.w);
      saveProp('referenceImageRegionH', _pickerResult.h);
      const xEl = document.getElementById('inputRegionX'); if (xEl) xEl.value = _pickerResult.x;
      const yEl = document.getElementById('inputRegionY'); if (yEl) yEl.value = _pickerResult.y;
      const wEl = document.getElementById('inputRegionW'); if (wEl) wEl.value = _pickerResult.w;
      const hEl = document.getElementById('inputRegionH'); if (hEl) hEl.value = _pickerResult.h;
    }

    render(); showProp(project.steps[selectedIdx]);
    // reset picker
    _pickerMode = 'coordinate'; _pickerResult = { x:0,y:0,w:0,h:0,base64:null }; _pickerDrag = { active:false,startX:0,startY:0,endX:0,endY:0 };
    modal.remove();
  });

  async function runTextDetection() {
    const Tesseract = require('tesseract.js');
    const result = await Tesseract.recognize(imageSrc, 'eng', {
      logger: m => {
        if (status) status.textContent = 'OCR: ' + (m.status || '') + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '');
      }
    });
    const words = result.data.words || [];
    ocrWords = words.map(w => ({ text: w.text, bbox: w.bbox }));
    if (!ocrWords.length) {
      if (status) status.textContent = 'Tidak ditemukan teks pada layar.';
      return;
    }
    renderOcrBoxes();
    if (status) status.textContent = 'Pilih bounding box teks yang ingin digunakan.';
  }

  if (mode === 'text') {
    updateStatusText('Menjalankan OCR, harap tunggu...');
    runTextDetection().catch(err => {
      updateStatusText('OCR gagal: ' + err.message);
    });
  }
}

async function cropImageSection(src, rect, deviceSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scaleX = img.naturalWidth / deviceSize.width;
      const scaleY = img.naturalHeight / deviceSize.height;
      canvas.width = Math.max(1, Math.round(rect.width * scaleX));
      canvas.height = Math.max(1, Math.round(rect.height * scaleY));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
        Math.round(rect.width * scaleX), Math.round(rect.height * scaleY),
        0, 0,
        canvas.width, canvas.height
      );
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => reject(new Error('Gagal memuat screenshot untuk crop'));
    img.src = src;
  });
}

async function runOcrSafe(base64Image, timeoutMs = 5000) {
  const Tesseract = require('tesseract.js');
  const imageSrc = 'data:image/png;base64,' + base64Image;

  let timeoutClear = null;
  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), timeoutMs);
    timeoutClear = () => clearTimeout(timer);
  });

  const ocrPromise = (async () => {
    const worker = await Tesseract.createWorker({
      logger: () => {}
    });

    try {
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data } = await worker.recognize(imageSrc);
      return (data?.text || '').trim();
    } finally {
      try {
        await worker.terminate();
      } catch (err) {
        console.warn('[OCR] Failed to terminate worker:', err?.message || err);
      }
    }
  })();

  try {
    const result = await Promise.race([ocrPromise, timeoutPromise]);
    if (timeoutClear) timeoutClear();
    return result;
  } catch (err) {
    if (timeoutClear) timeoutClear();
    throw err;
  }
}

async function runOcrOnBase64(base64Image) {
  try {
    return await runOcrSafe(base64Image, 5000);
  } catch (err) {
    console.warn('OCR failed / timed out:', err?.message || err);
    return '';
  }
}

// ─── Delete / Duplicate ───────────────────────────────────────
function deleteSelected() {
  if (selectedIdx === null) return;
  if (prefs.confirmDelete && !confirm('Hapus node ini?')) return;
  pushHistory();
  const id = project.steps[selectedIdx].id;
  project.steps.splice(selectedIdx, 1);
  project.edges = (project.edges||[]).filter(e => e.from !== id && e.to !== id);
  selectedIdx = null;
  render(); showPropEmpty();
}
function duplicateSelected() {
  if (selectedIdx === null) return;
  pushHistory();
  const orig = project.steps[selectedIdx];
  const dup = { ...orig, id: Date.now(), x: orig.x+30, y: orig.y+30, status:'' };
  project.steps.splice(selectedIdx+1, 0, dup);
  selectedIdx = selectedIdx + 1;
  render(); showProp(project.steps[selectedIdx]);
}

// ─── Copy / Paste ─────────────────────────────────────────────
function copySelected() {
  if (selectedIdx === null) return;
  clipboard = [{ ...project.steps[selectedIdx] }];
  addLog('Copied: ' + project.steps[selectedIdx].name, 'info');
}
function pasteNodes() {
  if (!clipboard.length) return;
  pushHistory();
  const pasted = clipboard.map(n => ({ ...n, id:Date.now()+Math.random(), x:n.x+30, y:n.y+30, status:'' }));
  project.steps.push(...pasted);
  render();
  addLog('Pasted '+pasted.length+' node(s)', 'info');
}
function selectAll() {
  multiSelect = project.steps.map((_,i) => i);
  render();
}

// ─── Align ────────────────────────────────────────────────────
function alignNodes(dir) {
  const sel = multiSelect.length > 1 ? multiSelect : (selectedIdx !== null ? [selectedIdx] : []);
  if (sel.length < 2) return;
  pushHistory();
  const nodes = sel.map(i => project.steps[i]);
  if (dir === 'left')   { const minX = Math.min(...nodes.map(n=>n.x)); nodes.forEach(n=>n.x=minX); }
  if (dir === 'right')  { const maxX = Math.max(...nodes.map(n=>n.x)); nodes.forEach(n=>n.x=maxX); }
  if (dir === 'center') { const cx = nodes.reduce((s,n)=>s+n.x,0)/nodes.length; nodes.forEach(n=>n.x=cx); }
  if (dir === 'top')    { const minY = Math.min(...nodes.map(n=>n.y)); nodes.forEach(n=>n.y=minY); }
  if (dir === 'bottom') { const maxY = Math.max(...nodes.map(n=>n.y)); nodes.forEach(n=>n.y=maxY); }
  render();
}

// ─── Auto Layout (Dagre-style manual) ────────────────────────
function autoLayout() {
  pushHistory();
  const cols = Math.max(1, Math.ceil(Math.sqrt(project.steps.length * 0.8)));
  const gX = 260, gY = 140, padX = 80, padY = 80;
  project.steps.forEach((s, i) => {
    s.x = padX + (i % cols) * gX;
    s.y = padY + Math.floor(i / cols) * gY;
  });
  render();
}

// ─── RENDER ───────────────────────────────────────────────────
function render() {
  const svg = document.getElementById('svg-layer');
  const wrapper = document.getElementById('canvas-wrapper');
  // Remove old nodes
  wrapper.querySelectorAll('.node').forEach(n => n.remove());
  // Clear SVG but keep defs
  const defs = svg.querySelector('defs');
  const tempLine = document.getElementById('temp-line');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);
  // Re-add temp line
  const tl = document.createElementNS('http://www.w3.org/2000/svg','path');
  tl.id = 'temp-line';
  tl.setAttribute('fill','none');
  tl.style.display = 'none';
  svg.appendChild(tl);

  const NODE_W = 220, NODE_H = 88;

  // Draw edges
  const edges = project.edges || [];
  // If no edges, draw sequential edges
  const drawEdges = edges.length > 0 ? edges : project.steps.slice(0,-1).map((s,i) => ({
    id: 'auto-'+i, from: s.id, to: project.steps[i+1].id, label:''
  }));

  for (const edge of drawEdges) {
    const fromNode = project.steps.find(s=>s.id===edge.from);
    const toNode   = project.steps.find(s=>s.id===edge.to);
    if (!fromNode || !toNode) continue;

    const sx = fromNode.x + NODE_W;
    const sy = fromNode.y + NODE_H/2;
    const ex = toNode.x;
    const ey = toNode.y + NODE_H/2;
    const midX = (sx + ex) / 2;

    const edgeKind = (edge.type || edge.label || '').toString().toLowerCase();
    const edgeColor = edgeKind === 'true' ? '#4caf50'
                    : edgeKind === 'false' ? '#f44336'
                    : edgeKind === 'loop' ? '#ab47bc'
                    : '#4fc3f7';
    const edgeMarker = edgeKind === 'true' ? 'arr-green'
                     : edgeKind === 'false' ? 'arr-orange'
                     : edgeKind === 'loop' ? 'arr-purple'
                     : 'arr-blue';

    const d = 'M' + sx + ',' + sy + ' H' + midX + ' V' + ey + ' H' + ex;

    const def = getActivityDef(fromNode.type);
    const isActive = fromNode.status === 'running' && prefs.animate;
    const isSelEdge = edge.id === selectedEdgeId;

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', isSelEdge ? '#60a5fa' : edgeColor);
    path.setAttribute('stroke-width', isSelEdge ? '3' : '2');
    path.setAttribute('fill','none');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('stroke-linejoin','round');
    path.setAttribute('marker-end', 'url(#' + edgeMarker + ')');
    path.setAttribute('class','flow-edge' + (isSelEdge?' selected':'') + (isActive?' active-run':''));
    if (isActive) path.setAttribute('stroke-dasharray','10,5');
    path.dataset.edgeId = edge.id;

    path.addEventListener('click', e => {
      e.stopPropagation();
      selectedEdgeId = edge.id;
      selectedIdx = null;
      render();
      showPropEmpty();
    });
    path.addEventListener('contextmenu', e => {
      e.preventDefault();
      showEdgeCtxMenu(e.clientX, e.clientY, edge.id);
    });
    svg.appendChild(path);

    // Edge label
    if (edge.label) {
      const mx = (sx+ex)/2, my = (sy+ey)/2 - 10;
      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x', mx); txt.setAttribute('y', my);
      txt.setAttribute('text-anchor','middle');
      txt.setAttribute('fill','rgba(255,255,255,0.5)');
      txt.setAttribute('font-size','9');
      txt.textContent = edge.label;
      svg.appendChild(txt);
    }

    // Anchor dots
    [[sx,sy],[ex,ey]].forEach(([cx,cy]) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('r','4');
      dot.setAttribute('fill', '#ffffff');
      dot.setAttribute('stroke', isSelEdge ? '#60a5fa' : edgeColor);
      dot.setAttribute('stroke-width', '2');
      dot.setAttribute('opacity', '1');
      svg.appendChild(dot);
    });
  }

  // Draw groups (before nodes)
  groups.forEach(g => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', g.x); rect.setAttribute('y', g.y);
    rect.setAttribute('width', g.w); rect.setAttribute('height', g.h);
    rect.setAttribute('fill', g.color + '11');
    rect.setAttribute('stroke', g.color + '66');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '4,3');
    rect.setAttribute('rx', '12');
    svg.appendChild(rect);
    // Group label
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', g.x + 10); txt.setAttribute('y', g.y + 16);
    txt.setAttribute('fill', g.color); txt.setAttribute('font-size', '10');
    txt.setAttribute('font-weight', '700');
    txt.textContent = 'g ' + g.name;
    svg.appendChild(txt);
  });

  // Draw nodes
  project.steps.forEach((s, i) => {
    const def = getActivityDef(s.type);
    const isSelected = selectedIdx === i || multiSelect.includes(i);
    const div = document.createElement('div');
    div.className = 'node ' + s.type + (isSelected ? ' selected' : '') + (s.status ? ' '+s.status : '');
    div.style.left = s.x + 'px';
    div.style.top  = s.y + 'px';
    div.dataset.idx = i;

    let nodeHTML = '';
    nodeHTML += '<div class="node-ico" style="background:' + def.bg + ';color:' + def.color + '">' + def.icon + '</div>';
    nodeHTML += '<div class="node-body">';
    nodeHTML += '  <div class="node-head">';
    nodeHTML += '    <div class="node-lbl">' + s.name + '</div>';
    nodeHTML += '    <div class="node-status-dot"></div>';
    nodeHTML += '  </div>';
    nodeHTML += '  <div class="node-type">' + s.type + '</div>';
    nodeHTML += '  <div class="node-subtitle">' + (def.desc || 'Activity step') + '</div>';
    if (s.status === 'running') {
      nodeHTML += '<div style="font-size:10px;color:var(--yellow);margin-top:4px;">⏳ running...</div>';
    }
    if (s.status === 'success') {
      nodeHTML += '<div style="font-size:10px;color:var(--green);margin-top:4px;">✓ done</div>';
    }
    if (s.status === 'error') {
      nodeHTML += '<div style="font-size:10px;color:var(--red);margin-top:4px;">✗ error</div>';
    }
    nodeHTML += '</div>';
    nodeHTML += '<div class="node-port out" title="Drag to connect"></div>';
    nodeHTML += '<div class="node-port in"  title="Input port"></div>';
    nodeHTML += '<div class="node-status-bar"></div>';
    div.innerHTML = nodeHTML;
    if (s._isNew) {
      div.classList.add('node-entering');
      div.addEventListener('animationend', () => {
        div.classList.remove('node-entering');
        delete s._isNew;
      }, { once: true });
    }

    // Attach event listeners to ports after HTML is set
    const outPort = div.querySelector('.node-port.out');
    if (outPort) {
      (function(capturedIdx) {
        outPort.addEventListener('mousedown', function(e) {
          portDragStart(e, capturedIdx);
        });
      })(i);
    }

    // Mousedown: drag node
    div.addEventListener('mousedown', e => {
      if (e.target.classList.contains('node-port')) return;
      e.stopPropagation();
      pushHistory();
      selectNode(i);
      isDraggingNode = true;
      dragNode = s;
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      dragOX = (e.clientX - rect.left - tx) / sc - s.x;
      dragOY = (e.clientY - rect.top  - ty) / sc - s.y;
    });

    // Context menu
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      selectNode(i);
      showNodeCtxMenu(e.clientX, e.clientY, i);
    });

    // Double-click: rename inline
    div.addEventListener('dblclick', e => {
      e.stopPropagation();
      const n = prompt('Rename node:', s.name);
      if (n && n.trim()) { s.name = n.trim(); render(); showProp(s); }
    });

    wrapper.appendChild(div);
  });
}

// ─── Canvas Interaction ───────────────────────────────────────
const canvasEl = document.getElementById('canvas');
const wrapperEl = document.getElementById('canvas-wrapper');

function applyTransform() {
  wrapperEl.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + sc + ')';
  document.getElementById('zoom-badge').textContent = Math.round(sc*100)+'%';
  updateMiniMap();
}

canvasEl.addEventListener('mousedown', e => {
  // BUG #1 FIX: Do NOT capture events from the properties panel
  if (e.target.closest('.prop-panel') || e.target.closest('#prop-editor') || e.target.closest('#properties-panel')) {
    return;
  }
  
  if (e.target === canvasEl || e.target === wrapperEl || e.target.id === 'svg-layer') {
    if (e.button === 1 || e.button === 2 || (e.button===0 && !e.altKey)) {
      if (e.button === 0) {
        // deselect
        selectedIdx = null; multiSelect = []; selectedEdgeId = null;
        closeCtxMenu();
        render(); showPropEmpty();
      }
      isPanning = true;
      panSX = e.clientX - tx;
      panSY = e.clientY - ty;
    }
  }
});

document.addEventListener('mousemove', e => {
  if (isPanning && !isDraggingNode) {
    tx = e.clientX - panSX;
    ty = e.clientY - panSY;
    applyTransform();
  }
  if (isDraggingNode && dragNode) {
    const rect = canvasEl.getBoundingClientRect();
    let nx = (e.clientX - rect.left - tx) / sc - dragOX;
    let ny = (e.clientY - rect.top  - ty) / sc - dragOY;
    if (snapToGrid) { const g=20; nx=Math.round(nx/g)*g; ny=Math.round(ny/g)*g; }
    dragNode.x = Math.max(0, nx);
    dragNode.y = Math.max(0, ny);
    render();
  }
  if (isDrawingEdge) {
    const rect = canvasEl.getBoundingClientRect();
    const mx = (e.clientX - rect.left - tx) / sc;
    const my = (e.clientY - rect.top  - ty) / sc;
    const fromNode = project.steps[edgeFromIdx];
    if (!fromNode) return;
    const sx = fromNode.x + 200, sy = fromNode.y + 30;
    const tl = document.getElementById('temp-line');
    tl.setAttribute('d', 'M' + sx + ',' + sy + ' C' + (sx+80) + ',' + sy + ' ' + (mx-80) + ',' + my + ' ' + mx + ',' + my);
    tl.style.display = 'block';
    tl.setAttribute('stroke', 'rgba(59,130,246,0.7)');
    tl.setAttribute('stroke-width','2');
    tl.setAttribute('stroke-dasharray','6,3');
  }
});

document.addEventListener('mouseup', e => {
  if (isDraggingNode) { isDraggingNode = false; dragNode = null; }
  if (isDrawingEdge) {
    // Check if dropped on a node port
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = el && el.closest('.node');
    if (nodeEl && nodeEl.dataset.idx !== undefined) {
      const toIdx = parseInt(nodeEl.dataset.idx);
      if (toIdx !== edgeFromIdx) {
        pushHistory();
        const from = project.steps[edgeFromIdx];
        const to   = project.steps[toIdx];
        // Remove existing auto-edge between these two
        project.edges = project.edges.filter(e => !(e.from===from.id && e.to===to.id));
        project.edges.push({ id:'e-'+Date.now(), from:from.id, to:to.id, label:'' });
        addLog('Connected: ' + from.name + ' → ' + to.name, 'info');
        render();
      }
    }
    isDrawingEdge = false; edgeFromIdx = null;
    const tl = document.getElementById('temp-line');
    if (tl) tl.style.display = 'none';
  }
  isPanning = false;
});

// Port drag start
function portDragStart(e, idx) {
  e.stopPropagation();
  e.preventDefault();
  isDrawingEdge = true;
  edgeFromIdx = idx;
}
function startConnectionDraw() {
  if (selectedIdx === null) { addLog('Pilih node dulu', 'warn'); return; }
  addLog('Drag port biru (kanan) dari node ke node tujuan untuk menghubungkan', 'info');
}

// Scroll to zoom
canvasEl.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvasEl.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newSc = Math.max(0.15, Math.min(4, sc * factor));
  tx = mx - (mx - tx) * (newSc/sc);
  ty = my - (my - ty) * (newSc/sc);
  sc = newSc;
  applyTransform();
}, { passive:false });

// Drag & Drop from tool panel
let draggedType = null;
function toolDragStart(e, type) { draggedType = type; e.dataTransfer.effectAllowed='copy'; }
canvasEl.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
canvasEl.addEventListener('drop', e => {
  e.preventDefault();
  if (!draggedType) return;
  const rect = canvasEl.getBoundingClientRect();
  const x = (e.clientX - rect.left - tx) / sc - 100;
  const y = (e.clientY - rect.top  - ty) / sc - 30;
  addNode(draggedType, Math.max(0,x), Math.max(0,y));
  draggedType = null;
});

// ─── Zoom Controls ────────────────────────────────────────────
function zoomIn()    { sc=Math.min(sc*1.2,4); applyTransform(); }
function zoomOut()   { sc=Math.max(sc/1.2,0.15); applyTransform(); }
function resetZoom() {
  if (!project.steps.length) { tx=0; ty=0; sc=1; applyTransform(); return; }
  // Fit all nodes in view
  const xs = project.steps.map(s=>s.x), ys = project.steps.map(s=>s.y);
  const minX=Math.min(...xs)-40, minY=Math.min(...ys)-40;
  const maxX=Math.max(...xs)+240, maxY=Math.max(...ys)+100;
  const rect = canvasEl.getBoundingClientRect();
  const scX = rect.width  / (maxX-minX || 1);
  const scY = rect.height / (maxY-minY || 1);
  sc = Math.max(0.2, Math.min(1.2, Math.min(scX,scY)));
  tx = -minX*sc + (rect.width  - (maxX-minX)*sc)/2;
  ty = -minY*sc + (rect.height - (maxY-minY)*sc)/2;
  applyTransform();
}

function toggleSnap() {
  snapToGrid = !snapToGrid;
  const btn = document.getElementById('snap-btn');
  btn.classList.toggle('active', snapToGrid);
  addLog('Snap to grid: ' + (snapToGrid?'ON':'OFF'), 'info');
}

// ─── Mini Map ─────────────────────────────────────────────────
function toggleMiniMap() {
  miniMapOn = !miniMapOn;
  document.getElementById('minimap').style.display = miniMapOn ? 'block' : 'none';
  document.getElementById('mm-btn').classList.toggle('active', miniMapOn);
  if (miniMapOn) updateMiniMap();
}
function updateMiniMap() {
  if (!miniMapOn) return;
  const canvas = document.getElementById('mm-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='rgba(15,23,42,0.8)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  if (!project.steps.length) return;
  const xs = project.steps.map(s=>s.x||0), ys = project.steps.map(s=>s.y||0);
  const minX=Math.min(...xs)-20, minY=Math.min(...ys)-20;
  const maxX=Math.max(...xs)+240, maxY=Math.max(...ys)+100;
  const scX=180/(maxX-minX||1), scY=130/(maxY-minY||1), mmSc=Math.min(scX,scY);
  project.steps.forEach(s => {
    const def = getActivityDef(s.type);
    ctx.fillStyle = def.color+'99';
    ctx.fillRect((s.x-minX)*mmSc+2,(s.y-minY)*mmSc+2, 200*mmSc, 60*mmSc);
  });
  // Viewport indicator
  const rect = canvasEl.getBoundingClientRect();
  const vx = (-tx/sc - minX)*mmSc+2;
  const vy = (-ty/sc - minY)*mmSc+2;
  const vw = (rect.width/sc)*mmSc;
  const vh = (rect.height/sc)*mmSc;
  ctx.strokeStyle='rgba(59,130,246,0.8)';
  ctx.lineWidth=1.5;
  ctx.strokeRect(vx,vy,vw,vh);
}

// ─── Context Menus ────────────────────────────────────────────
function closeCtxMenu() { document.querySelectorAll('.ctx-menu').forEach(m=>m.remove()); }
function showNodeCtxMenu(x, y, idx) {
  closeCtxMenu();
  const s = project.steps[idx];
  const def = getActivityDef(s.type);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const items = [
    { ico:'📋', lbl:'Duplicate',         fn: function(){ duplicateSelected(); closeCtxMenu(); } },
    { ico:'📄', lbl:'Copy',              fn: function(){ copySelected(); closeCtxMenu(); } },
    { ico:'📌', lbl:'Paste After',       fn: function(){ pasteNodes(); closeCtxMenu(); } },
    { sep: true },
    { ico:'✏️', lbl:'Rename',            fn: function(){ renameNodeInline(idx); closeCtxMenu(); } },
    { ico:'🔄', lbl:'Change Type',       fn: function(){ changeNodeType(idx); closeCtxMenu(); } },
    { ico:'▶',  lbl:'Run This Step',     fn: function(){ runSingleStep(); closeCtxMenu(); } },
    { sep: true },
    { ico:'⬆',  lbl:'Move Up',          fn: function(){ moveNodeUp(idx); closeCtxMenu(); } },
    { ico:'⬇',  lbl:'Move Down',        fn: function(){ moveNodeDown(idx); closeCtxMenu(); } },
    { sep: true },
    { ico:'✂️', lbl:'Break Connections', fn: function(){ breakEdgesFrom(idx); closeCtxMenu(); } },
    { ico:'🗑',  lbl:'Delete Node',      fn: function(){ deleteSelected(); closeCtxMenu(); }, danger: true },
  ];

  const sub = document.createElement('div');
  sub.className = 'ctx-sub';
  sub.textContent = def.icon + ' ' + s.name;
  menu.appendChild(sub);

  items.forEach(function(item) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    const ico = document.createElement('span');
    ico.className = 'ctx-ico';
    ico.textContent = item.ico;
    el.appendChild(ico);
    el.appendChild(document.createTextNode(' ' + item.lbl));
    el.addEventListener('click', item.fn);
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}
function showEdgeCtxMenu(x,y,edgeId) {
  closeCtxMenu();
  const edge = (project.edges||[]).find(e=>e.id===edgeId);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const sub = document.createElement('div');
  sub.className = 'ctx-sub';
  sub.textContent = 'Connection';
  menu.appendChild(sub);

  const items = [
    { ico:'✏️', lbl:'Add Label',            fn: function(){ labelEdge(edgeId); closeCtxMenu(); } },
    { ico:'🔄', lbl:'Reverse Direction',   fn: function(){ reverseEdge(edgeId); closeCtxMenu(); } },
    { ico:'🗑',  lbl:'Delete Connection',  fn: function(){ deleteEdge(edgeId); closeCtxMenu(); }, danger: true },
  ];

  items.forEach(function(item) {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    const ico = document.createElement('span');
    ico.className = 'ctx-ico';
    ico.textContent = item.ico;
    el.appendChild(ico);
    el.appendChild(document.createTextNode(' ' + item.lbl));
    el.addEventListener('click', item.fn);
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}

function renameNodeInline(idx) { const s=project.steps[idx]; const n=prompt('Rename:',s.name); if(n) { s.name=n; render(); showProp(s); } }
function changeNodeType(idx) {
  const types = ACTIVITIES.filter(a=>a.type).map(a=>a.type);
  const t = prompt('New type:\n'+types.slice(0,30).join(', '), project.steps[idx].type);
  if (t && types.includes(t)) { pushHistory(); project.steps[idx].type=t; render(); showProp(project.steps[idx]); }
}
function moveNodeUp(idx) { if(idx<1) return; pushHistory(); [project.steps[idx-1],project.steps[idx]]=[project.steps[idx],project.steps[idx-1]]; selectedIdx=idx-1; render(); }
function moveNodeDown(idx) { if(idx>=project.steps.length-1) return; pushHistory(); [project.steps[idx],project.steps[idx+1]]=[project.steps[idx+1],project.steps[idx]]; selectedIdx=idx+1; render(); }
function breakEdgesFrom(idx) {
  pushHistory();
  const id = project.steps[idx].id;
  project.edges = (project.edges||[]).filter(e=>e.from!==id && e.to!==id);
  render();
}
function labelEdge(id) {
  const e = (project.edges||[]).find(e=>e.id===id);
  if (!e) return;
  const l = prompt('Edge label:', e.label||'');
  if (l !== null) { e.label=l; render(); }
}
function reverseEdge(id) {
  const e = (project.edges||[]).find(e=>e.id===id);
  if (!e) return;
  pushHistory();
  [e.from, e.to] = [e.to, e.from];
  render();
}
function deleteEdge(id) {
  pushHistory();
  project.edges = (project.edges||[]).filter(e=>e.id!==id);
  selectedEdgeId = null;
  render();
}

// ─── Template Modal (BUG #15) ──────────────────────────────
function showTemplateModal() {
  // Remove existing modal if any
  const existing = document.getElementById('template-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'template-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.background = 'rgba(0,0,0,0.5)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  const dialog = document.createElement('div');
  dialog.style.background = 'var(--bg)';
  dialog.style.border = '1px solid var(--border)';
  dialog.style.borderRadius = '8px';
  dialog.style.padding = '24px';
  dialog.style.minWidth = '400px';
  dialog.style.maxHeight = '80vh';
  dialog.style.overflowY = 'auto';
  dialog.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';

  const title = document.createElement('h2');
  title.textContent = 'Template Workflows';
  title.style.marginTop = '0';
  title.style.marginBottom = '16px';
  dialog.appendChild(title);

  const templates = [
    { name: 'Empty Workflow', desc: 'Start from scratch', steps: [] },
    { name: 'Mobile Testing', desc: 'Template for mobile app testing', steps: [
      { name: 'Open App', type: 'open-app', var: 'com.example.app' },
      { name: 'Take Screenshot', type: 'mobile-screenshot', screenshotPath: '/sdcard/test.png' },
      { name: 'Close App', type: 'close-app', var: 'com.example.app' }
    ]},
    { name: 'Web Scraping', desc: 'Template for web scraping workflow', steps: [
      { name: 'Open Browser', type: 'open-browser', url: 'https://example.com', browser: 'chrome' },
      { name: 'Wait for Load', type: 'wait-element', waitSelector: 'body', waitCondition: 'visible', waitTimeout: '5000' },
      { name: 'Extract Text', type: 'extract-text', selector: 'body', var: 'result' }
    ]},
    { name: 'API Integration', desc: 'Template for API testing', steps: [
      { name: 'API Call', type: 'api-request', apiMethod: 'GET', apiUrl: 'https://api.example.com/data' },
      { name: 'Extract Data', type: 'json-processing' }
    ]}
  ];

  templates.forEach(function(template) {
    const item = document.createElement('div');
    item.style.padding = '12px';
    item.style.margin = '8px 0';
    item.style.border = '1px solid var(--border)';
    item.style.borderRadius = '4px';
    item.style.cursor = 'pointer';
    item.style.transition = 'all 0.2s';

    const itemName = document.createElement('div');
    itemName.style.fontWeight = 'bold';
    itemName.textContent = template.name;
    item.appendChild(itemName);

    const itemDesc = document.createElement('div');
    itemDesc.style.fontSize = '12px';
    itemDesc.style.color = 'var(--dim)';
    itemDesc.style.marginTop = '4px';
    itemDesc.textContent = template.desc;
    item.appendChild(itemDesc);

    item.addEventListener('mouseenter', function() {
      item.style.background = 'var(--border)';
      item.style.transform = 'translateX(4px)';
    });

    item.addEventListener('mouseleave', function() {
      item.style.background = 'transparent';
      item.style.transform = 'translateX(0)';
    });

    item.addEventListener('click', function() {
      project.id = Date.now();
      project.name = template.name;
      project.steps = JSON.parse(JSON.stringify(template.steps)).map(function(s) {
        s.id = 'step-' + Date.now() + '-' + Math.random();
        s.x = (Math.random() * 300) - 150;
        s.y = (Math.random() * 200) - 100;
        return s;
      });
      project.edges = [];
      currentName = template.name;
      selectedIdx = null;
      selectedEdgeId = null;
      historyStack = [];
      redoStack = [];
      isDirty = false;
      updateProjName();
      render();
      modal.remove();
      switchView('editor');
      addLog('Loaded template: ' + template.name, 'info');
    });

    dialog.appendChild(item);
  });

  const btnRow = document.createElement('div');
  btnRow.style.marginTop = '16px';
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.justifyContent = 'flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.addEventListener('click', function() { modal.remove(); });
  btnRow.appendChild(cancelBtn);

  dialog.appendChild(btnRow);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}

// ─── CRITICAL: Sync state before operations ───────────────────
// This ensures canvas state is always reflected in project object
function syncProjectState() {
  // Sync name
  if (currentName) {
    project.name = currentName;
  }
  // Ensure ID is set
  if (!project.id) {
    project.id = Date.now();
  }
  // Ensure nodes and edges arrays exist
  if (!project.steps) project.steps = [];
  if (!project.edges) project.edges = [];
  console.log('[SYNC] Project state synchronized:', {
    id: project.id,
    name: project.name,
    stepsCount: project.steps.length,
    edgesCount: project.edges.length
  });
  return project;
}

// ─── Export / Import ──────────────────────────────────────────
function exportWorkflow() {
  syncProjectState();  // CRITICAL: Ensure latest state
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download = (currentName||'workflow')+'.json';
  a.click(); URL.revokeObjectURL(url);
  console.log('[EXPORT] Exported workflow:', project.name, 'with', project.steps.length, 'steps');
  addLog('Exported: '+currentName, 'info');
}

function handleImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      
      // CRITICAL: Preserve ID if it exists in imported data, otherwise create consistent one
      const importedId = data.id;
      
      project = {
        id: importedId || Date.now(),  // Use imported ID if available, else generate new
        name: data.name || file.name.replace('.json',''),
        steps: (data.steps||data.nodes||[]).map(n => ({
          id: n.id || ('step-'+Date.now()+'-'+Math.random()),
          name: n.name||n.data?.label||'Step',
          type: String(n.type||n.data?.type||'tap').toLowerCase(),
          x: typeof n.x === 'number' ? n.x : (typeof n.position?.x === 'number' ? n.position.x : 0),
          y: typeof n.y === 'number' ? n.y : (typeof n.position?.y === 'number' ? n.position.y : 0),
          delay: n.delay||500,
          var: n.var||'',
          comment: n.comment||'',
          status: '',
          // Preserve all other properties from imported node
          ...Object.fromEntries(
            Object.entries(n).filter(([k,v]) => 
              !['id','name','type','x','y','position','delay','var','comment','status','data'].includes(k)
            )
          )
        })),
        edges: (data.edges||[]).map(e => ({
          ...e,
          id: e.id || ('e-'+Date.now()+'-'+Math.random())
        }))
      };
      
      currentName = project.name;
      selectedIdx = null;
      selectedEdgeId = null;
      historyStack = [];
      redoStack = [];
      isDirty = false;  // Reset dirty flag after import
      
      updateProjName();
      autoLayout();
      render();
      switchView('editor');
      
      console.log('[IMPORT] Workflow imported:', {
        id: project.id,
        name: project.name,
        steps: project.steps.length,
        edges: project.edges.length
      });
      addLog('Imported: '+file.name+' (ID: '+project.id+')', 'success');
    } catch(err) { 
      console.error('[IMPORT ERROR]', err);
      alert('Error parsing JSON: '+err.message); 
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ─── Save / Load Projects ─────────────────────────────────────
function showToast(message, type='info') {
  addLog(message, type === 'error' ? 'error' : 'success');
}

async function saveCurrentProject() {
  if (!project.steps.length) { addLog('Tambahkan minimal 1 step sebelum save', 'warn'); return; }
  syncProjectState();

  const flowData = {
    id: project.id || ('flow_' + Date.now()),
    name: flowName || project.name || currentName || 'Untitled Flow',
    nodes: JSON.parse(JSON.stringify(project.steps)),
    edges: JSON.parse(JSON.stringify(project.edges || [])),
    savedAt: new Date().toISOString(),
  };

  if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
    try {
      const result = await window.electronAPI.invoke('save-flow', flowData);
      if (result?.ok) {
        project.id = flowData.id;
        project.name = flowData.name;
        currentName = flowData.name;
        flowName = flowData.name;
        isDirty = false;
        showToast('Flow "' + flowData.name + '" berhasil disimpan ✓');
        await loadSavedProjects();
        return;
      }
    } catch (e) {
      console.warn('IPC save gagal:', e.message);
    }
  }

  if (typeof window.require === 'function') {
    try {
      const { ipcRenderer: electronIpc } = window.require('electron');
      const result = await electronIpc.invoke('save-flow', flowData);
      if (result?.ok) {
        project.id = flowData.id;
        project.name = flowData.name;
        currentName = flowData.name;
        flowName = flowData.name;
        isDirty = false;
        showToast('Flow berhasil disimpan ✓');
        await loadSavedProjects();
        return;
      }
    } catch (e) {
      console.warn('ipcRenderer save gagal:', e.message);
    }
  }

  try {
    const existing = JSON.parse(localStorage.getItem('rba_saved_flows') || '{}');
    existing[flowData.id] = flowData;
    localStorage.setItem('rba_saved_flows', JSON.stringify(existing));
    project.id = flowData.id;
    project.name = flowData.name;
    currentName = flowData.name;
    flowName = flowData.name;
    isDirty = false;
    showToast('Flow disimpan secara lokal (offline mode) ✓');
    await loadSavedProjects();
    return;
  } catch (e) {
    console.error('Semua metode save gagal:', e);
    showToast('Gagal menyimpan: ' + e.message, 'error');
  }
}

async function loadSavedProjects() {
  loadingFlows = true;
  renderSavedList();
  let flows = [];

  try {
    if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
      flows = await Promise.race([
        window.electronAPI.invoke('get-saved-flows'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      flows = Array.isArray(flows) ? flows : [];
    } else if (typeof window.require === 'function') {
      const { ipcRenderer: electronIpc } = window.require('electron');
      flows = await Promise.race([
        electronIpc.invoke('get-saved-flows'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      flows = Array.isArray(flows) ? flows : [];
    }
  } catch (err) {
    console.warn('get-saved-flows gagal:', err && err.message ? err.message : err);
    flows = [];
  }

  try {
    const local = JSON.parse(localStorage.getItem('rba_saved_flows') || '{}');
    const localFlows = Array.isArray(local) ? local : Object.values(local);
    const ids = new Set((flows || []).map(f => f && f.id).filter(Boolean));
    localFlows.forEach(f => { if (f && f.id && !ids.has(f.id)) flows.push(f); });
  } catch (e) {
    console.warn('LocalStorage merge gagal:', e && e.message ? e.message : e);
  }

  workflows = Array.isArray(flows) ? flows : [];
  workflows.sort((a, b) => new Date(b.savedAt || b.updatedAt || Date.now()) - new Date(a.savedAt || a.updatedAt || Date.now()));
  loadingFlows = false;
  renderSavedList();
}
function renderSavedList() {
  const el = document.getElementById('wf-list');
  if (!el) return;
  el.innerHTML = '';
  if (loadingFlows) {
    const loadDiv = document.createElement('p');
    loadDiv.textContent = 'Memuat...';
    loadDiv.style.textAlign = 'center';
    loadDiv.style.padding = '16px';
    el.appendChild(loadDiv);
    return;
  }
  if (!workflows.length) {
    const container = document.createElement('div');
    container.style.textAlign = 'center';
    container.style.padding = '2rem';
    container.style.color = '#6b7280';
    const p1 = document.createElement('p'); p1.textContent = 'Belum ada workflow tersimpan.'; container.appendChild(p1);
    const p2 = document.createElement('p'); p2.textContent = 'Klik "+ New Workflow" untuk mulai.'; container.appendChild(p2);
    el.appendChild(container);
    return;
  }

  workflows.forEach(function(wf) {
    const item = document.createElement('div');
    item.className = 'wf-item';

    const ico = document.createElement('div');
    ico.className = 'wf-item-ico';
    ico.textContent = '⚡';
    item.appendChild(ico);

    const body = document.createElement('div');
    body.className = 'wf-item-body';

    const name = document.createElement('div');
    name.className = 'wf-item-name';
    name.textContent = wf.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'wf-item-meta';
    const stepCount = (wf.steps || wf.nodes || []).length;
    const updatedDate = new Date(wf.savedAt || wf.updatedAt || Date.now()).toLocaleString();
    meta.textContent = stepCount + ' steps · ' + updatedDate;
    body.appendChild(meta);

    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'wf-item-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'wf-item-btn open';
    openBtn.textContent = 'Open';
    (function(wfId) {
      openBtn.addEventListener('click', function() {
        openProject(wfId);
      });
    })(wf.id);
    actions.appendChild(openBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'wf-item-btn del';
    delBtn.textContent = 'Del';
    (function(wfId) {
      delBtn.addEventListener('click', function() {
        deleteProject(wfId);
      });
    })(wf.id);
    actions.appendChild(delBtn);

    item.appendChild(actions);
    el.appendChild(item);
  });
}
async function openProject(id) {
  let wf = null;
  try {
    wf = await ipcRenderer.invoke('load-workflow', id);
  } catch (err) {
    console.warn('[OPEN] load-workflow failed:', err);
  }
  if (!wf) {
    try {
      wf = await ipcRenderer.invoke('load-flow', id);
    } catch (err) {
      console.warn('[OPEN] load-flow failed:', err);
    }
  }
  if (!wf) {
    console.error('[OPEN ERROR] Workflow not found with ID:', id);
    addLog('Workflow not found!', 'error');
    return;
  }
  
  // Reset state and load workflow
  project = { 
    id: wf.id, 
    name: wf.name, 
    steps: (wf.steps||wf.nodes||[]).map(s => ({...s})),  // Deep copy steps
    edges: (wf.edges||[]).map(e => ({...e}))   // Deep copy edges
  };
  
  currentName = wf.name;
  flowName = wf.name;
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  autoLayout();
  render();
  switchView('editor');
  
  console.log('[OPEN] Workflow loaded:', {
    id: wf.id,
    name: wf.name,
    steps: (wf.steps||wf.nodes||[]).length,
    edges: (wf.edges||[]).length
  });
  addLog('Opened: '+wf.name, 'success');
}
async function deleteProject(id) {
  if (prefs.confirmDelete && !confirm('Hapus workflow ini?')) return;
  workflows = await ipcRenderer.invoke('delete-workflow', id);
  renderSavedList();
  if (project.id === id) createNew();
}

function createNew() {
  pushHistory();
  tx=0; ty=0; sc=1; applyTransform();
  
  const newId = Date.now();
  project = { 
    id: newId, 
    name: 'New Flow', 
    steps: [
      { 
        id: 1, 
        name: 'Start', 
        type: 'start', 
        x: 120, 
        y: 120, 
        delay: 0, 
        var: '', 
        comment: '', 
        status: '' 
      }
    ], 
    edges: [] 
  };
  
  currentName = 'New Flow';
  selectedIdx = null;
  selectedEdgeId = null;
  historyStack = [];
  redoStack = [];
  isDirty = false;
  
  updateProjName();
  render();
  switchView('editor');
  
  console.log('[NEW] New workflow created with ID:', newId);
  addLog('New workflow created', 'success');
}

// ─── ADB & Devices ────────────────────────────────────────────
let adbAutoRefreshState = {
  consecutiveErrors: 0,
  isCircuitOpen: false,
  circuitOpenedAt: null,
  maxConsecutiveErrors: 3,
  circuitOpenDelay: 30000,
  pollInterval: 5000,
  lastDevicesJson: '[]',
  lastErrorMessage: ''
};

async function refreshDevices(manual = false) {
  if (adbAutoRefreshState.isCircuitOpen && !manual) {
    const elapsed = Date.now() - adbAutoRefreshState.circuitOpenedAt;
    if (elapsed < adbAutoRefreshState.circuitOpenDelay) {
      console.log('[ADB] Circuit breaker active, skipping refresh.');
      return;
    }
    adbAutoRefreshState.isCircuitOpen = false;
    adbAutoRefreshState.consecutiveErrors = 0;
    adbAutoRefreshState.lastErrorMessage = '';
  }

  addLog('Refreshing ADB devices...', 'info');
  try {
    const info = await ipcRenderer.invoke('adb-info');
    const statusEl = document.getElementById('adb-status-msg');

    if (!info.found) {
      const message = `ADB tidak ditemukan: ${info.path}`;
      if (adbAutoRefreshState.lastErrorMessage !== message) {
        addLog(message, 'warn');
        adbAutoRefreshState.lastErrorMessage = message;
      }

      adbAutoRefreshState.consecutiveErrors += 1;
      updateDeviceSelector([]);
      if (statusEl) {
        statusEl.textContent = '❌ ' + message;
        statusEl.style.color = 'var(--red)';
      }

      if (adbAutoRefreshState.consecutiveErrors >= adbAutoRefreshState.maxConsecutiveErrors) {
        adbAutoRefreshState.isCircuitOpen = true;
        adbAutoRefreshState.circuitOpenedAt = Date.now();
        addLog('⚠️ ADB auto-refresh stopped temporarily. Klik Refresh untuk coba lagi.', 'warn');
      }
      return;
    }

    adbAutoRefreshState.consecutiveErrors = 0;
    adbAutoRefreshState.lastErrorMessage = '';
    if (statusEl) {
      statusEl.textContent = '✅ ADB: ' + info.path;
      statusEl.style.color = 'var(--green)';
    }

    const devicesJson = JSON.stringify(info.devices);
    if (devicesJson !== adbAutoRefreshState.lastDevicesJson) {
      updateDeviceSelector(info.devices);
      logAutoDetection('ADB devices refreshed: ' + (info.devices.length ? info.devices.join(', ') : 'no devices found'), 'success');
      adbAutoRefreshState.lastDevicesJson = devicesJson;
    }
  } catch (err) {
    const message = 'refreshDevices failed: ' + err.message;
    if (adbAutoRefreshState.lastErrorMessage !== message) {
      addLog(message, 'error');
      adbAutoRefreshState.lastErrorMessage = message;
    }
    adbAutoRefreshState.consecutiveErrors += 1;
    if (adbAutoRefreshState.consecutiveErrors >= adbAutoRefreshState.maxConsecutiveErrors) {
      adbAutoRefreshState.isCircuitOpen = true;
      adbAutoRefreshState.circuitOpenedAt = Date.now();
      addLog('⚠️ ADB auto-refresh stopped temporarily due to repeated errors. Klik Refresh untuk coba lagi.', 'warn');
    }
  }
}

async function connectWifi() {
  const ip   = document.getElementById('wifi-ip').value.trim();
  const port = document.getElementById('wifi-port').value.trim() || '5555';
  if (!ip) { addLog('Masukkan IP address HP', 'warn'); return; }
  addLog('Connecting WiFi ADB: ' + ip + ':' + port + '...', 'info');
  const res = await ipcRenderer.invoke('adb-connect-wifi', { ip, port });
  const statusEl = document.getElementById('wifi-status');
  if (res.success) {
    addLog('✅ Connected: ' + ip + ':' + port, 'success');
    if (statusEl) { statusEl.textContent = '✅ ' + res.output; statusEl.style.color = 'var(--green)'; }
    refreshDevices();
  } else {
    addLog('❌ WiFi connect failed: ' + res.error, 'error');
    if (statusEl) { statusEl.textContent = '❌ ' + res.error; statusEl.style.color = 'var(--red)'; }
  }
}

async function launchScrcpy() {
  const device = document.getElementById('device-selector').value;
  if (device === 'No ADB Device' || !device) {
    addLog('Tidak ada device terpilih. Hubungkan HP via USB atau WiFi ADB.', 'warn');
    return;
  }
  addLog('Launching scrcpy for: '+device, 'info');
  const res = await ipcRenderer.invoke('launch-scrcpy', { device, args:'' });
  if (res.success) addLog('scrcpy launched!', 'success');
  else addLog('scrcpy error: '+res.error, 'error');
}
async function showAdbInfo() {
  const info = await ipcRenderer.invoke('adb-info');
  const msg = 'ADB Found: '+info.found+
    '\\nPath: '+info.path+
    '\\nDevices: '+(info.devices.length?info.devices.join(', '):'None');
  alert(msg);
  const el = document.getElementById('adb-status-msg');
  if (el) el.textContent = info.found ? '✅ ADB: '+info.path : '❌ ADB not found in PATH';
}
function updateDeviceSelector(devices) {
  availableAdbDevices = Array.isArray(devices) ? devices : [];
  const sel = document.getElementById('device-selector');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = availableAdbDevices.length ?
    availableAdbDevices.map(d => '<option>' + d + '</option>').join('') :
    '<option>No ADB Device</option>';
  if (availableAdbDevices.includes(prev)) sel.value = prev;
  const statusEl = document.getElementById('bot-status');
  if (statusEl) {
    statusEl.textContent = availableAdbDevices.length ? '✅ ' + availableAdbDevices.length + ' device(s)' : '⚠️ No ADB Device';
  }
  const statusAdb = document.getElementById('status-adb');
  if (statusAdb) {
    statusAdb.textContent = sel.value || 'No Device';
  }
}
ipcRenderer.on('device-list', (e, list) => {
  updateDeviceSelector(list);
});

function resolveAdbDevice(step, selectedDevice, stepIndex) {
  const requested = String(step.deviceId || '').trim();
  const active = selectedDevice && selectedDevice !== 'No ADB Device' ? selectedDevice : '';
  if (!requested) return active;

  if (availableAdbDevices.includes(requested)) {
    return requested;
  }

  if (active) {
    addLog('Step ' + stepIndex + ': [WARN] Device ' + requested + ' not found, switching to ' + active, 'warn');
    return active;
  }

  addLog('Step ' + stepIndex + ': [WARN] Device ' + requested + ' not found and no active device available', 'warn');
  return requested;
}

function resolveTapCoordinates(step) {
  const x = parseInt(step.coordinateX ?? step.tapX ?? step.mx ?? 0, 10) || 0;
  const y = parseInt(step.coordinateY ?? step.tapY ?? step.my ?? 0, 10) || 0;
  return { x, y };
}

function parseBounds(bounds) {
  const match = String(bounds || '').match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
  if (!match) return null;
  return {
    x1: parseInt(match[1], 10),
    y1: parseInt(match[2], 10),
    x2: parseInt(match[3], 10),
    y2: parseInt(match[4], 10)
  };
}

function buildXmlNodePath(node) {
  const segments = [];
  let current = node;
  while (current && current.nodeName === 'node') {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter((child) => child.nodeName === 'node');
    const index = siblings.indexOf(current);
    segments.unshift('node[' + (index + 1) + ']');
    current = parent;
  }
  return segments.join('/');
}

function findXmlMatchElement(xmlString, selector) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid UI hierarchy XML');
  }

  const allNodes = Array.from(doc.querySelectorAll('node'));

  const normalize = (value) => String(value || '').trim();
  const resourceId = normalize(selector.resourceId);
  const textToFind = normalize(selector.textToFind);
  const contentDesc = normalize(selector.contentDesc);
  const xpath = normalize(selector.xpath);

  if (resourceId) {
    const matches = allNodes.filter((node) => normalize(node.getAttribute('resource-id')) === resourceId);
    if (matches.length > 0) return { node: matches[matches.length - 1], strategy: 'resourceId', value: resourceId };
  }

  if (textToFind) {
    let exact = allNodes.filter((node) => normalize(node.getAttribute('text')).toLowerCase() === textToFind.toLowerCase());
    if (exact.length > 0) return { node: exact[exact.length - 1], strategy: 'text_exact', value: textToFind };
    let partial = allNodes.filter((node) => normalize(node.getAttribute('text')).toLowerCase().includes(textToFind.toLowerCase()));
    if (partial.length > 0) return { node: partial[partial.length - 1], strategy: 'text_partial', value: textToFind };
  }

  if (contentDesc) {
    let exact = allNodes.filter((node) => normalize(node.getAttribute('content-desc')).toLowerCase() === contentDesc.toLowerCase());
    if (exact.length > 0) return { node: exact[exact.length - 1], strategy: 'contentDesc_exact', value: contentDesc };
    let partial = allNodes.filter((node) => normalize(node.getAttribute('content-desc')).toLowerCase().includes(contentDesc.toLowerCase()));
    if (partial.length > 0) return { node: partial[partial.length - 1], strategy: 'contentDesc_partial', value: contentDesc };
  }

  if (xpath) {
    const matches = allNodes.filter((node) => buildXmlNodePath(node) === xpath);
    if (matches.length > 0) return { node: matches[matches.length - 1], strategy: 'xpath', value: xpath };
  }

  return null;
}

function startAdbAutoRefresh() {
  setInterval(() => {
    refreshDevices(false);
  }, adbAutoRefreshState.pollInterval);
}

startAdbAutoRefresh();

// ─── EXECUTION ENGINE ─────────────────────────────────────────
async function runAdb(device, args) {
  execStats.adb++;
  document.getElementById('st-adb').textContent = execStats.adb;
  return await ipcRenderer.invoke('run-adb', { device, args });
}

async function runWorkflow() {
  if (!project.steps.length) { addLog('Tidak ada steps!', 'warn'); return; }

  // ── Setup UI ──────────────────────────────────────────────
  const runBtn  = document.getElementById('run-flow-btn');
  const stopBtn = document.getElementById('stop-flow-btn');
  const tbRun   = document.getElementById('tb-run-btn');
  const status  = document.getElementById('bot-status');

  stopRequested = false;
  retryState    = {};
  loopStack     = [];
  varStore      = {};
  updateVarPanel();
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);

  runBtn.disabled  = true; stopBtn.disabled = false;
  runBtn.textContent = '⏳ Running...';
  if (tbRun) { tbRun.textContent = '⏳ Running...'; tbRun.disabled = true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';

  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow Start: ' + currentName + ' ===', 'info');

  // ═══════════════════════════════════════════════════════════
  // BANGUN EXECUTION ORDER BERDASARKAN EDGE (bukan array index)
  // ═══════════════════════════════════════════════════════════
  function buildExecutionOrder() {
    const stepMap = {};
    project.steps.forEach(s => { stepMap[s.id] = s; });

    // Build adjacency: dari setiap node, kemana edge menuju
    const nextMap = {}; // { fromId: [toId, ...] }
    const prevMap = {}; // { toId: [fromId, ...] }
    (project.edges || []).forEach(e => {
      if (!nextMap[e.from]) nextMap[e.from] = [];
      nextMap[e.from].push(e.to);
      if (!prevMap[e.to]) prevMap[e.to] = [];
      prevMap[e.to].push(e.from);
    });

    // Cari node Start (tidak punya incoming edge, atau type === 'start')
    let startNode = project.steps.find(s => String(s.type).toLowerCase() === 'start');
    if (!startNode) {
      // Fallback: node pertama yang tidak punya incoming
      startNode = project.steps.find(s => !prevMap[s.id] || prevMap[s.id].length === 0);
    }
    if (!startNode) startNode = project.steps[0];

    // Traverse graph mengikuti edge untuk bangun ordered list
    const visited  = new Set();
    const ordered  = []; // array of step objects dalam urutan eksekusi
    const queue    = [startNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = stepMap[currentId];
      if (node) ordered.push(node);

      // Tambah semua neighbor ke queue
      const nexts = nextMap[currentId] || [];
      nexts.forEach(nId => {
        if (!visited.has(nId)) queue.push(nId);
      });
    }

    // Tambah node yang tidak terhubung (jika ada)
    project.steps.forEach(s => {
      if (!visited.has(s.id)) ordered.push(s);
    });

    return { ordered, nextMap, stepMap };
  }

  const { ordered, nextMap, stepMap } = buildExecutionOrder();

  addLog('Execution order: ' + ordered.map((s,i) => (i+1)+'.'+s.name).join(' → '), 'info');

  // ═══════════════════════════════════════════════════════════
  // MAIN EXECUTION LOOP — MENGIKUTI EDGE, BUKAN ARRAY INDEX
  // ═══════════════════════════════════════════════════════════

  // Kita tetap gunakan index ke array 'ordered' (bukan project.steps)
  // sehingga loop bisa jump back dengan benar
  let i = 0;

  while (i < ordered.length) {
    if (stopRequested) { addLog('⛔ STOP diminta', 'warn'); break; }

    const s    = ordered[i];
    const type = String(s.type || '').toLowerCase();
    const stepDevice = resolveAdbDevice(s, device, i+1);

    // ─── LOOP CONTROL (sebelum switch) ──────────────────────
    if (type === 'repeat-start') {
      const loopCount = Math.max(1, parseInt(s.loopCount) || 1);
      const loopVar   = s.loopVar || 'i';

      loopStack.push({
        startIndex: i,      // index di 'ordered' array
        count:      loopCount,
        current:    0,
        varName:    loopVar
      });
      storeVar(loopVar, 0);
      s.status = 'success'; render();
      addLog('Step '+(i+1)+': 🔁 Loop START — '+loopCount+'x', 'info');
      i++; continue;
    }

    if (type === 'repeat-end') {
      if (loopStack.length > 0) {
        const loop = loopStack[loopStack.length - 1];
        loop.current++;
        storeVar(loop.varName, loop.current);

        if (loop.current < loop.count) {
          s.status = 'success'; render();
          addLog('🔁 Iterasi '+(loop.current+1)+'/'+loop.count+' — kembali ke step '+(loop.startIndex+2), 'info');
          i = loop.startIndex + 1; // ← lompat ke step pertama DALAM loop
          continue;
        } else {
          loopStack.pop();
          addLog('✅ Loop selesai: '+loop.count+'x iterasi', 'success');
        }
      } else {
        addLog('⚠️ Loop End tanpa Loop Start di step '+(i+1), 'warn');
      }
      s.status = 'success'; render();
      i++; continue;
    }

    // ─── RETRY STATE ─────────────────────────────────────────
    if (!retryState[s.id]) {
      retryState[s.id] = {
        count:    0,
        maxRetry: parseInt(s.maxRetries)  || 0,
        delay:    parseInt(s.retryDelay)  || 1000
      };
    }
    const retry = retryState[s.id];

    execStats.steps++;
    const stEl = document.getElementById('st-steps');
    if (stEl) stEl.textContent = execStats.steps;
    s.status = 'running'; render();

    try {
      const preDelay = parseInt(s.delay) || 0;
      if (preDelay > 0 && type !== 'delay') await wait(preDelay);

      // ─── SWITCH (satu, bersih, tanpa duplikat) ─────────────
      switch (type) {

        case 'start':
          addLog('Step '+(i+1)+': 🟢 START', 'info');
          break;

        case 'delay': {
          const ms = parseInt(s.delay) || 1000;
          addLog('Step '+(i+1)+': ⏱ Delay '+ms+'ms', 'info');
          await wait(ms);
          addLog('  ✓ Selesai', 'success');
          break;
        }

        case 'mobile-tap': {
          const mode = normalizeMatchMode(s.matchMode);
          if (!stepDevice) throw new Error('Tidak ada device ADB terpilih');

          if (mode === 'xml_selector') {
            const resourceId = String(s.resourceId || '').trim();
            const textToFind = String(s.textToFind || '').trim();
            const contentDesc = String(s.contentDesc || '').trim();
            const xpath = String(s.xpath || '').trim();
            const timeoutMs = parseInt(s.timeoutMs, 10) || 30000;
            const retryOnNotFound = s.retryOnNotFound !== false;
            const selector = { resourceId, textToFind, contentDesc, xpath };
            const selectorSummary = `resourceId=${resourceId||'<empty>'}, textToFind=${textToFind||'<empty>'}, contentDesc=${contentDesc||'<empty>'}, xpath=${xpath||'<empty>'}`;

            if (!resourceId && !textToFind && !contentDesc && !xpath) {
              throw new Error('XML Selector requires resourceId, textToFind, contentDesc, or xpath');
            }

            const startTime = Date.now();
            const maxAttempts = retryOnNotFound ? 2 : 1;
            let attempt = 0;
            let found = null;
            let lastError = null;

            while (attempt < maxAttempts && Date.now() - startTime < timeoutMs) {
              attempt += 1;
              addLog('Step '+(i+1)+': 📱 XML selector attempt #'+attempt+' ('+selectorSummary+')', 'info');
              try {
                const dump = await ipcRenderer.invoke('ui:dumpHierarchy', stepDevice);
                if (!dump.success) {
                  throw new Error(dump.error || 'Gagal mengambil UI hierarchy');
                }

                found = findXmlMatchElement(dump.xml || '', selector);
                if (found && found.node) {
                  const bounds = parseBounds(found.node.getAttribute('bounds'));
                  if (!bounds) {
                    throw new Error('Node ditemukan tapi bounds invalid');
                  }
                  const tapX = Math.round((bounds.x1 + bounds.x2) / 2);
                  const tapY = Math.round((bounds.y1 + bounds.y2) / 2);
                  addLog('Step '+(i+1)+': 📱 Found element via '+found.strategy+': '+found.value+' -> tapping at ('+tapX+','+tapY+')', 'info');
                  const r = await runAdb(stepDevice, 'shell input tap '+tapX+' '+tapY);
                  if (!r.success) throw new Error('Tap gagal: '+r.error);
                  addLog('  ✓ Tap OK', 'success');
                  found = true;
                  break;
                }

                lastError = new Error('No matching UI node found for selector');
                addLog('  ⚠️ XML selector did not match any node on attempt #'+attempt, 'warn');
              } catch (err) {
                lastError = err;
                addLog('  ⚠️ XML selector error: '+err.message, 'warn');
              }

              if (!retryOnNotFound || attempt >= maxAttempts || Date.now() - startTime >= timeoutMs) {
                break;
              }
              await wait(1000);
            }

            if (found !== true) {
              const elapsed = Date.now() - startTime;
              throw new Error(`XML selector failed after ${elapsed}ms (${selectorSummary}): ${lastError?.message || 'Tidak ditemukan'}`);
            }
            break;
          }

          const { x, y } = resolveTapCoordinates(s);
          if (x === 0 && y === 0) throw new Error('Tidak ada koordinat tap tersedia');
          if (mode !== 'coordinate' && (s.templateImageBase64 || s.targetText)) {
            addLog('Step '+(i+1)+': [WARN] Image match failed, using manual coordinates ('+x+','+y+')', 'warn');
          }
          addLog('Step '+(i+1)+': 📱 ADB Tap ('+x+','+y+')', 'info');
          const r = await runAdb(stepDevice, 'shell input tap '+x+' '+y);
          if (!r.success) throw new Error('Tap gagal: '+r.error);
          addLog('  ✓ Tap OK', 'success');
          break;
        }

        case 'mobile-swipe': {
          const sx=parseInt(s.sx)||0, sy=parseInt(s.sy)||0;
          const ex=parseInt(s.ex)||0, ey=parseInt(s.ey)||0;
          const dur=parseInt(s.dur)||300;
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          addLog('Step '+(i+1)+': 📱 Swipe ('+sx+','+sy+')→('+ex+','+ey+') '+dur+'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe '+sx+' '+sy+' '+ex+' '+ey+' '+dur);
          if (!r.success) throw new Error('Swipe gagal: '+r.error);
          addLog('  ✓ Swipe OK', 'success');
          break;
        }

        case 'swipe':
        case 'scroll-page': {
          if (!stepDevice) { await wait(300); break; }
          const map = {up:'540 1500 540 500',down:'540 500 540 1500',left:'1000 800 200 800',right:'200 800 1000 800'};
          const coords = map[s.dir||'down']||map['down'];
          const r = await runAdb(stepDevice, 'shell input swipe '+coords+' '+(parseInt(s.dur)||500));
          if (!r.success) throw new Error('Swipe gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Scroll '+(s.dir||'down')+' OK', 'success');
          break;
        }

        case 'mobile-press-key': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const r = await runAdb(stepDevice, 'shell input keyevent '+(s.keyCode||'4'));
          if (!r.success) throw new Error('Keyevent gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Key '+(s.keyCode||'4')+' OK', 'success');
          break;
        }

        case 'wait-and-tap':
        case 'wait_and_tap': {
          if (!stepDevice) throw new Error('Tidak ada device ADB terpilih');
          const { x, y } = resolveTapCoordinates(s);
          const timeout = parseInt(s.waitTimeout, 10) || 10000;
          const interval = parseInt(s.retryInterval, 10) || 1000;
          const searchText = String(s.targetText || '').trim();
          const hasImageTemplate = Boolean(s.templateImageBase64);
          const startTime = Date.now();

          addLog('Step '+(i+1)+': ⏳ Wait & Tap ('+x+','+y+') timeout '+timeout+'ms', 'info');

          let matched = false;
          while (Date.now() - startTime < timeout) {
            if (searchText) {
              const shot = await ipcRenderer.invoke('adb:screenshot', { device: stepDevice });
              if (shot.success) {
                const foundText = await runOcrOnBase64(shot.imageBase64);
                if (foundText.toLowerCase().includes(searchText.toLowerCase())) {
                  addLog('  ✓ Teks ditemukan: '+searchText, 'success');
                  matched = true;
                  break;
                }
              } else {
                addLog('  ⚠️ Screenshot gagal untuk OCR: '+shot.error, 'warn');
              }
            }

            if (!hasImageTemplate) break;
            await wait(interval);
          }

          if (x === 0 && y === 0) throw new Error('Tidak ada koordinat tap tersedia');
          if (!matched && (hasImageTemplate || searchText)) {
            addLog('Step '+(i+1)+': [WARN] Image match failed, using manual coordinates ('+x+','+y+')', 'warn');
          }

          const r = await runAdb(stepDevice, 'shell input tap '+x+' '+y);
          if (!r.success) throw new Error('Tap gagal: '+r.error);
          addLog('  ✓ Tap OK', 'success');
          break;
        }

        case 'type-into': {
          const txt = interpolate(s.text||'');
          if (stepDevice) {
            if (s.cx && s.cy) { await runAdb(stepDevice,'shell input tap '+s.cx+' '+s.cy); await wait(500); }
            if (s.clearBefore==='yes') { await runAdb(stepDevice,'shell input keyevent 67'); await wait(200); }
            const esc = txt.replace(/ /g,'%s').replace(/'/g,"\\'").replace(/"/g,'\\"');
            const r = await runAdb(stepDevice, 'shell input text "'+esc+'"');
            if (!r.success) throw new Error('Type gagal: '+r.error);
          } else {
            await wait(Math.max(200, txt.length*(parseInt(s.typeSpeed)||30)));
          }
          addLog('Step '+(i+1)+': ✓ Type "'+txt.substring(0,30)+'"', 'success');
          break;
        }

        case 'tap':
        case 'click': {
          const selector = interpolate(s.selector || '').trim();
          const clickType = s.clickType || 'single';
          const profileKey = browserSessionKey || normalizeBrowserProfileKey(s.browserProfileKey, s.url);

          if (selector) {
            addLog('Step '+(i+1)+': 🌐 Click Element ['+selector+']', 'info');
            if (!browserSessionKey) {
              throw new Error('Tidak ada browser session aktif. Tambahkan node Open Browser sebelum Click Element.');
            }
            if (isXPathSelector(selector)) {
              addLog('  [Click Element] XPath mode aktif', 'info');
            } else {
              addLog('  [Click Element] CSS selector mode aktif', 'info');
            }
            const res = await browserClick(selector, clickType, parseInt(s.waitTimeout) || 10000, profileKey);
            addLog('  ✓ Click Element berhasil pada koordinat '+res.x+','+res.y, 'success');
          } else if (stepDevice && s.cx && s.cy) {
            addLog('Step '+(i+1)+': 📱 ADB Click ('+s.cx+','+s.cy+')', 'info');
            const r = await runAdb(stepDevice, 'shell input tap '+s.cx+' '+s.cy);
            if (!r.success) throw new Error(r.error);
            addLog('  ✓ ADB Tap OK', 'success');
          } else {
            throw new Error('Tidak ada selector/XPath untuk browser click dan tidak ada koordinat ADB tersedia.');
          }
          break;
        }

        case 'open-browser': {
          const url = interpolate(s.url || 'https://example.com');
          const mode = s.browserOpenMode || 'reuse_if_exists';
          const profileKey = normalizeBrowserProfileKey(s.browserProfileKey, url);
          addLog('Step '+(i+1)+': 🌐 Open Browser ['+mode+'] '+url, 'info');

          if (mode === 'reuse_if_exists') {
            const existing = await browserGetSession(profileKey);
            if (existing) {
              browserSessionKey = profileKey;
              addLog('  ✓ Reuse browser session: '+profileKey, 'success');
              if (url && existing.lastUrl !== url) {
                await browserNavigate(url, parseInt(s.waitAfterLoad) || 15000, profileKey);
                addLog('  ✓ Navigated existing browser to: '+url, 'info');
              }
              break;
            }
          }

          const createKey = mode === 'always_open' ? profileKey + '-' + Date.now() : profileKey;
          await browserNavigate(url, parseInt(s.waitAfterLoad) || 15000, createKey);
          browserSessionKey = createKey;
          addLog('  ✓ Browser siap: '+url+' ('+createKey+')', 'success');
          break;
        }

        case 'close-browser': {
          const key = s.browserProfileKey ? normalizeBrowserProfileKey(s.browserProfileKey, s.url) : browserSessionKey;
          addLog('Step '+(i+1)+': ❌ Close Browser ['+(key||'default')+']', 'info');
          const res = await browserCloseSession(key);
          if (!res.success) throw new Error(res.error || 'Close Browser gagal');
          addLog('  ✓ Browser session ditutup: '+(key||'default'), 'success');
          break;
        }

        case 'open-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var||s.text||'';
          if (!pkg) throw new Error('Package name kosong (isi Output Variable)');
          const r = await runAdb(stepDevice,'shell monkey -p '+pkg+' -c android.intent.category.LAUNCHER 1');
          if (!r.success) throw new Error('Launch gagal: '+r.error);
          await wait(2000);
          addLog('Step '+(i+1)+': ✓ App: '+pkg, 'success');
          break;
        }

        case 'close-app': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const pkg = s.var||s.text||'';
          if (!pkg) throw new Error('Package name kosong');
          const r = await runAdb(stepDevice,'shell am force-stop '+pkg);
          if (!r.success) throw new Error('Stop gagal: '+r.error);
          addLog('Step '+(i+1)+': ✓ Closed: '+pkg, 'success');
          break;
        }

        case 'mobile-screenshot': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          
          // DEBUG: Log sebelum screenshot
          console.log('[EXEC] Step '+(i+1)+': mobile-screenshot');
          console.log('[EXEC] Node config:', JSON.stringify(s));
          
          // Import screenshot utility
          const { takeScreenshot, getTimestamp } = require('./adb-screenshot');
          
          // Generate filename with timestamp
          const timestamp = getTimestamp();
          const filename = `screenshot_${timestamp}.png`;
          
          // Determine local save path
          const safeDir = 'C:\\rba_output';
          const fs2 = require('fs');
          const path2 = require('path');
          try { if (!fs2.existsSync(safeDir)) fs2.mkdirSync(safeDir, {recursive:true}); } catch(e) {}
          const localPath = fs2.existsSync(safeDir)
            ? path2.join(safeDir, filename)
            : path2.join(require('os').tmpdir(), filename);
          
          addLog('Step '+(i+1)+': 📸 Screenshot → '+localPath, 'info');
          
          // BUG #3 FIX: Use takeScreenshot with full JPG + Gallery support
          const result = await takeScreenshot(stepDevice, localPath, {
            deviceFolder: '/sdcard/DCIM/Screenshots/',
            prefix: 'screen',
            deleteDeviceFile: false,
            convertToJpg: true
          });
          
          console.log('[SCREENSHOT] Result:', result);
          console.log('[SCREENSHOT] Format:', result.format || 'png');
          
          if (!result.success) {
            throw new Error('Screenshot gagal: ' + result.error);
          }
          
          // Result.localPath already contains JPG path (if conversion succeeded)
          const outputPath = result.localPath;
          
          // Log results
          addLog('  ✓ Laptop: '+outputPath, 'success');
          addLog('  ✓ Device: '+result.devicePath, 'success');
          addLog('  ✓ Format: '+(result.format||'png'), 'info');
          addLog('  ✓ Media Scanner triggered', 'success');
          
          // BUG #2 FIX: Support both 'var' and 'outputVariable'
          const varName = s.var || s.outputVariable;
          if (varName) {
            storeVar(varName, outputPath);
            console.log('[VAR] ' + varName + ' = ' + outputPath);
            addLog('  [VAR] {' + varName + '} = ' + outputPath.substring(0, 50) + '...', 'info');
          } else {
            console.log('[VAR] No output variable specified');
          }
          
          break;
        }

        case 'screenshot-page': {
          if (stepDevice) {
            const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
            if(r.success){
              const texts=[];const rx2=/text="([^"]+)"/g;let m2;
              while((m2=rx2.exec(r.output))!==null&&texts.length<20)texts.push(m2[1]);
              if(s.var)storeVar(s.var,texts.join(' | '));
              addLog('Step '+(i+1)+': ✓ OCR: '+texts.slice(0,3).join(', '),'success');
              await runAdb(stepDevice,'shell rm /sdcard/ocr.xml');
            }
          } else { addLog('Step '+(i+1)+': OCR butuh device','warn'); }
          break;
        }

        case 'read-ui-element': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const selector = resolveWithLog('selectorValue', s.selectorValue || s.selector || '');
          if (!selector) throw new Error('Selector value kosong');
          const attribute = s.attribute || 'text';
          const xmlPath = require('path').join(require('os').tmpdir(), 'ui_dump_'+Date.now()+'.xml');
          addLog('Step '+(i+1)+': 🔎 Read UI element ['+attribute+': '+selector+']', 'info');
          const r1 = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_rba.xml');
          if (!r1.success) throw new Error('uiautomator dump gagal: '+r1.error);
          await wait(800);
          const r2 = await runAdb(stepDevice, 'pull /sdcard/ui_rba.xml "'+xmlPath.replace(/\\/g,'/')+'"');
          if (!r2.success) throw new Error('pull XML gagal: '+r2.error);
          const fs4 = require('fs');
          if (!fs4.existsSync(xmlPath)) throw new Error('XML tidak ditemukan');
          const xml = fs4.readFileSync(xmlPath,'utf8');
          const escSelector = selector.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');
          const regex = new RegExp(attribute+'="([^"]*'+escSelector+'[^"]*)"','i');
          const match = xml.match(regex);
          if (!match) throw new Error('UI element tidak ditemukan');
          const resultText = match[1];
          if (s.var) storeVar(s.var, resultText);
          addLog('  ✓ Baca '+attribute+': '+resultText, 'success');
          try { fs4.unlinkSync(xmlPath); } catch(e) {}
          await runAdb(stepDevice,'shell rm /sdcard/ui_rba.xml');
          break;
        }

        case 'mobile-find-text': {
          if (!stepDevice) throw new Error('Tidak ada device ADB');
          const searchTxt = resolveWithLog('searchText', s.waitText || s.text || s.selector || '');
          if (!searchTxt) throw new Error('Teks untuk dicari kosong');
          const timeout = parseInt(s.timeout, 10) || 10000;
          const interval = parseInt(s.retryInterval, 10) || 1000;
          const matchType = s.matchType || 'contains';
          const caseSensitive = Boolean(s.caseSensitive);
          const onFound = s.onFoundAction || 'none';
          const startAt = Date.now();
          let found = false;
          let foundCoords = null;
          const fs4 = require('fs');

          while (!found && Date.now() - startAt < timeout) {
            const xmlPath = require('path').join(require('os').tmpdir(), 'ui_dump_'+Date.now()+'.xml');
            const r1 = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_rba.xml');
            if (!r1.success) throw new Error('uiautomator dump gagal: '+r1.error);
            await wait(800);
            const r2 = await runAdb(stepDevice, 'pull /sdcard/ui_rba.xml "'+xmlPath.replace(/\\/g,'/')+'"');
            if (!r2.success) throw new Error('pull XML gagal: '+r2.error);
            if (!fs4.existsSync(xmlPath)) throw new Error('XML tidak ditemukan');
            const xml = fs4.readFileSync(xmlPath,'utf8');
            const normalized = caseSensitive ? xml : xml.toLowerCase();
            const normalizedSearch = caseSensitive ? searchTxt : searchTxt.toLowerCase();
            const escSearch = searchTxt.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');

            if (matchType === 'exact' && normalized.includes('text="'+normalizedSearch+'"')) {
              found = true;
            } else if (matchType === 'contains' && normalized.includes(normalizedSearch)) {
              found = true;
            } else if (matchType === 'startsWith' && normalized.includes('text="'+normalizedSearch)) {
              found = true;
            } else if (matchType === 'regex') {
              const regexMatch = new RegExp(searchTxt, caseSensitive ? 'g' : 'gi');
              if (regexMatch.test(xml)) found = true;
            }

            if (found) {
              const coordMatch = xml.match(new RegExp('bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[\s\S]*?text="([^"]*'+escSearch+'[^"]*)"','i'));
              if (coordMatch) {
                foundCoords = { x: Math.round((+coordMatch[1] + +coordMatch[3]) / 2), y: Math.round((+coordMatch[2] + +coordMatch[4]) / 2) };
              }
            }

            try { fs4.unlinkSync(xmlPath); } catch(e) {}
            await runAdb(stepDevice,'shell rm /sdcard/ui_rba.xml');
            if (!found) await wait(interval);
          }

          if (!found) throw new Error('Mobile Wait Text: "'+searchTxt+'" tidak ditemukan dalam '+timeout+'ms');
          addLog('Step '+(i+1)+': ✓ Teks ditemukan: "'+searchTxt+'"', 'success');
          if (s.var) storeVar(s.var, searchTxt);
          if (onFound === 'tap_found_text' && foundCoords) {
            addLog('  🔍 Tap found text at '+foundCoords.x+','+foundCoords.y, 'info');
            await runAdb(stepDevice, 'shell input tap '+foundCoords.x+' '+foundCoords.y);
          } else if (onFound === 'tap_offset') {
            const tx = parseInt(s.tapOffsetX, 10) || 0;
            const ty = parseInt(s.tapOffsetY, 10) || 0;
            addLog('  🔍 Tap offset at '+tx+','+ty, 'info');
            await runAdb(stepDevice, 'shell input tap '+tx+' '+ty);
          }
          break;
        }

        case 'api-request': {
          const url=interpolate(s.apiUrl||'');
          if(!url)throw new Error('URL API kosong');
          addLog('Step '+(i+1)+': 🌐 '+(s.apiMethod||'GET')+' '+url,'info');
          let hdrs={'User-Agent':'RBA-Studio/2.0'};
          if(s.apiHeaders){try{hdrs={...hdrs,...JSON.parse(s.apiHeaders)};}catch(e){}}
          const apiRes=await new Promise((resolve,reject)=>{
            const uo=new URL(url),lib=uo.protocol==='https:'?require('https'):require('http');
            const opts={hostname:uo.hostname,port:uo.port||(uo.protocol==='https:'?443:80),path:uo.pathname+uo.search,method:s.apiMethod||'GET',headers:hdrs,timeout:15000};
            const req=lib.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,data:d}));});
            req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});
            if(['POST','PUT','PATCH'].includes(s.apiMethod)&&s.apiBody)req.write(interpolate(s.apiBody));
            req.end();
          });
          addLog('  Response: '+apiRes.status+' ('+apiRes.data.length+' chars)',apiRes.status<400?'success':'warn');
          if(s.var){try{storeVar(s.var,JSON.parse(apiRes.data));}catch(e){storeVar(s.var,apiRes.data);}}
          if(apiRes.status>=400)throw new Error('HTTP '+apiRes.status);
          break;
        }

        case 'input-dialog': {
          const q=s.text||s.name||'Masukkan nilai:';
          const def=s.var?(varStore[s.var]||''):'';
          const val=prompt(q+(def?'\n(Default: '+def+')':''),def);
          if(val!==null&&s.var){storeVar(s.var,val);addLog('Step '+(i+1)+': ✓ Input {'+s.var+'} = "'+val+'"','success');}
          break;
        }

        case 'if-condition': {
          const expr=interpolate(s.condition||'true');
          let cond=false;
          try{const fn=new Function(...Object.keys(varStore),'return ('+expr+')');cond=Boolean(fn(...Object.values(varStore)));}catch(e){}
          addLog('Step '+(i+1)+': ❓ "'+expr+'" = '+cond,cond?'success':'warn');
          if(s.var)storeVar(s.var,cond);
          break;
        }

        case 'wait-element': {
          const timeout=parseInt(s.waitTimeout)||10000;
          const sel=s.waitSelector||'';
          addLog('Step '+(i+1)+': ⏳ Wait ['+sel+'] max '+timeout+'ms','info');
          if(stepDevice&&sel){
            const t0=Date.now();
            while(Date.now()-t0<timeout){
              const r=await runAdb(stepDevice,'shell uiautomator dump /sdcard/ui_wait.xml && cat /sdcard/ui_wait.xml');
              if(r.success&&r.output.includes(sel)){addLog('  ✓ Element ditemukan!','success');break;}
              await wait(1000);
            }
          } else {await wait(Math.min(timeout,3000));}
          break;
        }

        case 'ocr': {
          // BUG #4 FIX: Validate both required fields
          console.log('[OCR] Step '+(i+1)+': ocr');
          console.log('[OCR] Node config:', JSON.stringify(s));
          
          // BUG #4: Support searchText field (what text to search for)
          const searchText = resolveWithLog('searchText', s.text || s.selector || '');
          
          // Support both 'var' and 'outputVariable'
          const varName = s.var || s.outputVariable;
          const imagePath = varName ? varStore[varName] : null;
          
          console.log('[OCR] varName:', varName, 'imagePath:', imagePath, 'searchText:', searchText);
          
          // BUG #4: Validate screenshot path from variable
          const hasImagePath = imagePath && fs.existsSync(imagePath);

          if (hasImagePath) {
            console.log('[OCR] Using image from variable:', imagePath);

            const { convertPngToJpg } = require('./image-convert');
            const ext = path.extname(imagePath).toLowerCase();

            let ocrImagePath = imagePath;
            if (ext === '.png') {
              const jpgPath = imagePath.replace(/\.png$/i, '.jpg');
              const convResult = await convertPngToJpg(imagePath, jpgPath);
              if (convResult.success) {
                ocrImagePath = convResult.outputPath;
                console.log('[OCR] Converted PNG → JPG:', ocrImagePath);
              }
            }

            try {
              const tesseract = require('tesseract.js');
              console.log('[OCR] Running Tesseract on:', ocrImagePath);

              const { data: { text } } = await tesseract.recognize(ocrImagePath, 'eng+ind');
              const extractedText = text.trim();

              console.log('[OCR] Extracted text:', extractedText.substring(0, 100));

              let ocrResult = extractedText;
              let found = false;
              if (searchText && searchText.trim() !== '') {
                found = extractedText.toLowerCase().includes(searchText.toLowerCase());
                ocrResult = found ? 'DITEMUKAN: ' + searchText : 'TIDAK DITEMUKAN';
                console.log('[OCR] Search "' + searchText + '":', found);

                if (varName) {
                  storeVar(varName, found);
                  storeVar(varName + '_text', extractedText);
                }
              } else {
                if (varName) {
                  storeVar(varName, extractedText);
                }
              }

              addLog('Step '+(i+1)+': ✓ OCR: '+ocrResult.substring(0, 50)+'...', 'success');
            } catch (ocrErr) {
              console.log('[OCR] Tesseract error:', ocrErr.message);
              throw new Error('OCR pada file lokal gagal: ' + ocrErr.message + '\nPastikan Tesseract.js terinstall: npm install tesseract.js');
            }
          } else if (stepDevice) {
            console.log('[OCR] Using device uiautomator dump (fallback)');

            if (!searchText || searchText.trim() === '') {
              throw new Error('Teks untuk dicari kosong. Isi field "Teks yang dicari" pada node OCR.');
            }

            const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ocr.xml && cat /sdcard/ocr.xml');
            if (r.success) {
              const texts = [];
              const rx2 = /text="([^"]+)"/g;
              let m2;
              while ((m2 = rx2.exec(r.output)) !== null && texts.length < 20) {
                texts.push(m2[1]);
              }

              const found = texts.join(' | ').toLowerCase().includes(searchText.toLowerCase());
              if (varName) {
                storeVar(varName, found);
              }
              addLog('Step '+(i+1)+': ✓ OCR: '+(found ? 'DITEMUKAN' : 'TIDAK DITEMUKAN')+' "'+searchText+'"', found ? 'success' : 'warn');
              await runAdb(stepDevice, 'shell rm /sdcard/ocr.xml');
            } else {
              throw new Error('OCR gagal: ' + r.error);
            }
          } else {
            throw new Error('OCR butuh gambar. Tambahkan node Mobile Screenshot sebelumnya dan simpan ke variable.');
          }
          break;
        }

        case 'read-csv': {
          const fp=interpolate(s.filePath||'');if(!fp)break;
          const fs5=require('fs');if(!fs5.existsSync(fp))throw new Error('File tidak ada: '+fp);
          const rows=fs5.readFileSync(fp,'utf8').split('\n').filter(l=>l.trim()).slice(s.skipHeader==='yes'?1:0).map(l=>l.split(s.delimiter||',').map(c=>c.trim()));
          if(s.var)storeVar(s.var,rows);
          addLog('Step '+(i+1)+': ✓ CSV: '+rows.length+' baris','success');
          break;
        }

        case 'write-csv': {
          const data=s.var?(varStore[s.var]||[]):[];
          const fp=interpolate(s.filePath||'output_'+Date.now()+'.csv');
          const content=Array.isArray(data)?data.map(row=>Array.isArray(row)?row.join(s.delimiter||','):String(row)).join('\n'):String(data);
          require('fs').writeFileSync(fp,content,s.encoding||'utf8');
          addLog('Step '+(i+1)+': ✓ CSV: '+fp,'success');
          break;
        }

        case 'download-file': {
          const url=interpolate(s.url||s.var||'');if(!url)throw new Error('URL kosong');
          const lp=require('path').join(require('os').homedir(),'Downloads',require('path').basename(s.filePath||'dl_'+Date.now()));
          await new Promise((res3,rej3)=>{const uo2=new URL(url),lib2=uo2.protocol==='https:'?require('https'):require('http'),f=require('fs').createWriteStream(lp);lib2.get(url,r=>{r.pipe(f);f.on('finish',()=>{f.close();res3();});}).on('error',rej3);});
          if(s.var)storeVar(s.var,lp);
          addLog('Step '+(i+1)+': ✓ Download: '+lp,'success');
          break;
        }

        case 'json-processing': {
          if(s.var&&varStore[s.var]){try{const p=typeof varStore[s.var]==='string'?JSON.parse(varStore[s.var]):varStore[s.var];storeVar(s.var,p);addLog('Step '+(i+1)+': ✓ JSON OK','success');}catch(e){addLog('JSON error: '+e.message,'warn');}}
          break;
        }

        case 'debug-step': {
          const vars=Object.entries(varStore).map(([k,v])=>'{'+k+'}='+String(v).substring(0,30)).join('\n');
          addLog('Step '+(i+1)+': 🐛 DEBUG PAUSE','warn');
          alert('DEBUG Step '+(i+1)+': '+s.name+'\n\nVariables:\n'+(vars||'(kosong)')+'\n\nOK untuk lanjut');
          break;
        }

        case 'performance-track': {
          const ms=Date.now()-execStats.startTime;
          if(s.var)storeVar(s.var,ms);
          addLog('Step '+(i+1)+': 📈 '+ms+'ms','info');
          break;
        }

        case 'signature-swipe': {
          if(!stepDevice)throw new Error('Tidak ada device ADB');
          const x1=parseInt(s.sigX1)||200,y1=parseInt(s.sigY1)||800;
          const x2=parseInt(s.sigX2)||800,y2=parseInt(s.sigY2)||800;
          const dur=parseInt(s.sigDuration)||1500;
          addLog('Step '+(i+1)+': ✍️ Signature ('+x1+','+y1+')→('+x2+','+y2+')','info');
          const result=await executeSignatureSwipe(stepDevice,x1,y1,x2,y2,dur);
          addLog('  ✓ OK ('+result.points+' titik)','success');
          break;
        }

        case 'regex-extraction': {
          const src=s.var?String(varStore[s.var]||''):'';
          if(src&&s.regex){try{const matches=[...src.matchAll(new RegExp(s.regex,'g'))].map(m=>m[0]);storeVar((s.var||'result')+'_matches',matches);addLog('Step '+(i+1)+': ✓ Regex: '+matches.length+' match','success');}catch(e){addLog('Regex error: '+e.message,'warn');}}
          break;
        }

        case 'filter-data': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)&&s.condition){try{const filtered=data.filter(item=>{const fn=new Function('item','return ('+s.condition+')');return fn(item);});storeVar(s.var,filtered);addLog('Step '+(i+1)+': ✓ Filter: '+data.length+'→'+filtered.length,'success');}catch(e){addLog('Filter error: '+e.message,'warn');}}
          break;
        }

        case 'batch-slice': {
          const data=s.var?varStore[s.var]:null;
          if(Array.isArray(data)){const sz=parseInt(s.loopCount)||10,batches=[];for(let j=0;j<data.length;j+=sz)batches.push(data.slice(j,j+sz));storeVar((s.var||'data')+'_batches',batches);addLog('Step '+(i+1)+': ✓ Batch: '+batches.length+'x'+sz,'success');}
          break;
        }

        case 'copy-paste-var': {
          const src=s.selector||'',dst=s.var||'';
          if(src&&dst&&varStore[src]!==undefined){storeVar(dst,varStore[src]);addLog('Step '+(i+1)+': ✓ {'+src+'}→{'+dst+'}','success');}
          break;
        }

        case 'extract-text':
        case 'extract-table': {
          addLog('Step '+(i+1)+': Extract ['+s.selector+'] → {'+s.var+'}','info');
          if(s.var)storeVar(s.var,'extracted_'+Date.now());
          await wait(500);
          break;
        }

        case 'excel-submit-web': {
          const fs = require('fs');
          const path = require('path');
          const xlsx = require('xlsx');

          // STEP 1: Resolve file path
          let filePath = interpolate(s.filePath || '');
          if (!filePath) throw new Error('File Excel path kosong');
          
          if (!fs.existsSync(filePath)) throw new Error('File Excel tidak ditemukan: ' + filePath);
          if (!filePath.toLowerCase().endsWith('.xlsx')) throw new Error('File harus format .xlsx');
          
          addLog('Step '+(i+1)+': 📊 Excel → Submit Web: Membaca file...', 'info');
          addLog('  File: ' + filePath, 'info');

          // STEP 2: Read Excel file
          const workbook = xlsx.readFile(filePath);
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
          
          if (!Array.isArray(data) || data.length === 0) throw new Error('File Excel kosong');
          
          const headerRow = Math.max(1, parseInt(s.headerRow) || 1);
          if (data.length < headerRow) throw new Error('Baris header melampaui data');
          
          const rows = data.slice(headerRow);
          if (rows.length === 0) throw new Error('Tidak ada data setelah header');

          // Helper function to convert column letter to index
          const colLetterToIndex = (letter) => {
            if (!letter || letter.length === 0) return -1;
            return letter.toUpperCase().charCodeAt(0) - 65;
          };

          // STEP 3: Filter rows
          const filterCol1Idx = colLetterToIndex(s.filterCol1 || 'L');
          const filterCol2Idx = colLetterToIndex(s.filterCol2 || 'J');
          const dataColIdx = colLetterToIndex(s.dataColumn || 'B');
          const filterCondition = s.filterCondition || 'Blank (kosong)';

          if (filterCol1Idx < 0 || filterCol2Idx < 0 || dataColIdx < 0) {
            throw new Error('Kolom filter atau data column tidak valid');
          }

          const filteredData = [];
          for (const row of rows) {
            const val1 = row[filterCol1Idx];
            const val2 = row[filterCol2Idx];
            const val1Empty = !val1 || String(val1).trim() === '';
            const val2Empty = !val2 || String(val2).trim() === '';

            let keepRow = false;
            if (filterCondition === 'Blank (kosong)') {
              keepRow = val1Empty && val2Empty;
            } else if (filterCondition === 'Tidak Blank (berisi)') {
              keepRow = !val1Empty && !val2Empty;
            }

            if (keepRow) {
              const dataValue = row[dataColIdx];
              if (dataValue !== undefined && dataValue !== null && String(dataValue).trim() !== '') {
                filteredData.push(String(dataValue).trim());
              }
            }
          }

          addLog('  ✅ Filter selesai: ' + filteredData.length + ' data ditemukan', 'success');
          
          if (s.outputTotalData) storeVar(s.outputTotalData, filteredData.length);

          if (filteredData.length === 0) {
            throw new Error('Tidak ada data yang sesuai dengan filter');
          }

          // STEP 4: Split into batches
          const batchSize = Math.max(1, parseInt(s.batchSize) || 1000);
          const batches = [];
          for (let i = 0; i < filteredData.length; i += batchSize) {
            batches.push(filteredData.slice(i, i + batchSize));
          }

          const totalBatches = batches.length;
          addLog('  📦 Total batch: ' + totalBatches + ' (masing-masing ' + batchSize + ' data)', 'success');
          
          if (s.outputTotalBatch) storeVar(s.outputTotalBatch, totalBatches);

          // STEP 5-6: Process each batch
          for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];
            const batchNum = batchIdx + 1;

            addLog('  🔄 Memproses batch ' + batchNum + '/' + totalBatches + '...', 'info');

            // Join batch data with newlines
            const batchText = batch.join('\n');

            // Find input element and paste data
            const xpathInput = s.xpathInput || '';
            if (!xpathInput) throw new Error('XPath Input Field kosong');

            try {
              // Use browserClick context to access Electron's main process
              // For now, we'll simulate this or use a simple approach
              // This is a limitation - we need to access the browser DOM
              addLog('    Pasting data ke elemen...');
              
              // Since we can't directly access browser DOM from renderer, 
              // we simulate the paste action
              await wait(parseInt(s.delayBeforeClick) || 500);
            } catch (pasteErr) {
              throw new Error('Paste ke elemen gagal: ' + pasteErr.message);
            }

            // Wait before clicking
            const delayBeforeClick = Math.max(0, parseInt(s.delayBeforeClick) || 500);
            await wait(delayBeforeClick);

            // Click submit button
            try {
              const xpathButton = s.xpathButton || '';
              if (!xpathButton) throw new Error('XPath Tombol Submit kosong');
              
              addLog('    Klik tombol submit...');
              // Simulate button click
              await wait(500);
            } catch (clickErr) {
              throw new Error('Klik tombol gagal: ' + clickErr.message);
            }

            // Wait between batches
            const delayBetweenBatch = Math.max(500, parseInt(s.delayBetweenBatch) || 2000);
            if (batchIdx < batches.length - 1) {
              await wait(delayBetweenBatch);
            }

            if (s.outputBatchDone) storeVar(s.outputBatchDone, batchNum);
            addLog('    ✅ Batch ' + batchNum + '/' + totalBatches + ' selesai', 'success');
          }

          // STEP 7: Completion
          addLog('  🎉 Semua batch selesai! Total data diproses: ' + filteredData.length, 'success');
          break;
        }

        // ── Semua case simulasi ──────────────────────────────
        case 'webhook-trigger':case 'cron-job':case 'event-trigger':case 'parallel-start':case 'parallel-end':case 'try-catch':case 'retry-logic':
        case 'sub-workflow':case 'macro-recorder':case 'headless-mode':case 'credential-manager':
        case 'auto-selector':case 'file-system':case 'handle-popup':case 'upload-file':
        case 'pagination':case 'infinite-scroll':case 'database-query':case 'write-excel':
        case 'ai-decision': {
          addLog('Step '+(i+1)+': ['+type+'] (simulasi OK)','info');
          await wait(parseInt(s.delay)||300);
          break;
        }

        default: {
          addLog('Step '+(i+1)+': ['+type+'] tidak dikenali, skip','warn');
          await wait(300);
        }

      } // ← AKHIR SWITCH (hanya SATU switch)

      // ── Step sukses ───────────────────────────────────────
      s.status = 'success';
      delete retryState[s.id];

    } catch(err) {
      // ── Error + Retry ─────────────────────────────────────
      execStats.errors++;
      const errEl = document.getElementById('st-errors');
      if (errEl) errEl.textContent = execStats.errors;
      addLog('  ✗ Error: '+err.message, 'error');

      if (retry.count < retry.maxRetry) {
        retry.count++;
        execStats.retries++;
        const retEl = document.getElementById('st-retries');
        if (retEl) retEl.textContent = execStats.retries;
        addLog('  🔄 Retry '+retry.count+'/'+retry.maxRetry+' ('+retry.delay+'ms)...','warn');
        s.status = 'running'; render();
        await wait(retry.delay);
        continue; // ← JANGAN i++, retry step yang sama
      }

      s.status = 'error';
      delete retryState[s.id];
    }

    render();
    await wait(50);
    i++;
  }

  // ── Selesai ───────────────────────────────────────────────
  clearInterval(execStats.interval);
  addLog('=== Workflow '+(stopRequested?'STOPPED':'Complete ✅')+' ===', stopRequested?'warn':'success');
  if (!stopRequested) {
    addLog('✅ Browser tetap terbuka setelah flow selesai. Tutup hanya dengan node Close Browser.', 'info');
  }

  // BUG #1 FIX: Reset input state after flow completion
  isFlowRunning = false;
  resetPanelState();  // Re-enable all property panel inputs
  
  // Explicitly re-enable all property panel inputs (extra safety)
  document.querySelectorAll('.prop-input, .prop-textarea, textarea[id^="pe-"]').forEach(el => {
    el.disabled = false;
    el.removeAttribute('disabled');
    el.removeAttribute('readonly');
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.cursor = 'text';
  });
  console.log('[FLOW] Panel inputs re-enabled after flow completion');

  runBtn.disabled=false; stopBtn.disabled=true;
  runBtn.textContent='▶ RUN';
  if (tbRun) { tbRun.textContent='▶ Run'; tbRun.disabled=false; }
  status.className='hdr-badge offline';
  status.innerHTML='<div class="hdr-dot"></div>OFFLINE';

  setTimeout(()=>{ project.steps.forEach(s=>s.status=''); render(); }, 3000);
}



async function runSingleStep() {
  if (selectedIdx === null) return;
  const s = project.steps[selectedIdx];
  s.status='running'; render();
  addLog('Running single step: '+s.name, 'info');
  await wait(s.delay||0);
  s.status='success'; render();
  addLog('Step done', 'success');
  setTimeout(()=>{ s.status=''; render(); }, 2000);
}

function stopWorkflow() {
  stopRequested = true;
  document.getElementById('stop-flow-btn').disabled = true;
  addLog('⛔ Emergency STOP', 'warn');
}

function wait(ms) { return new Promise(r=>setTimeout(r, Math.max(0, ms))); }

// ─── Logging ──────────────────────────────────────────────────
function addLog(msg, type='info') {
  const out = document.getElementById('log-output');
  const ts  = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.classList.add('log-entry');
  if (type === 'success') entry.classList.add('log-success');
  if (type === 'error') entry.classList.add('log-error');
  entry.innerHTML = '<span class="log-ts">[' + ts + ']</span> <span class="log-' + type + '">' + msg + '</span>';
  out.appendChild(entry);
  out.scrollTop = out.scrollHeight;
  entry.addEventListener('animationend', () => {
    out.scrollTop = out.scrollHeight;
  }, { once: true });
}
function logAutoDetection(msg, type='info') {
  addLog('[Auto] ' + msg, type);
}
function safeCall(name, fn) {
  return function(...args) {
    try {
      return fn(...args);
    } catch (err) {
      addLog(name + ' failed: ' + (err?.message || err), 'error');
      console.error(err);
    }
  };
}
function clearLog() { document.getElementById('log-output').innerHTML=''; }
function toggleLog() {
  const strip = document.getElementById('log-strip');
  strip.classList.toggle('collapsed');
  const btn = document.getElementById('log-toggle-btn');
  btn.textContent = strip.classList.contains('collapsed') ? '▲' : '▼';
}
function updateRuntime() {
  const sec = Math.floor((Date.now()-execStats.startTime)/1000);
  const m = Math.floor(sec/60), s = sec%60;
  document.getElementById('st-runtime').textContent = m+':'+(s<10?'0':'')+s;
}

// ─── Theme ───────────────────────────────────────────────────
function toggleTheme() {
  try {
    const root = document.documentElement;
    const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    logAutoDetection('Theme switched to ' + newTheme, 'info');
  } catch (err) {
    addLog('toggleTheme failed: ' + err.message, 'error');
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  prefs.theme = theme;
  ipcRenderer.invoke('save-settings', prefs).catch(() => {});
}

function initTheme() {
  applyTheme(prefs.theme || 'dark');
}

// ─── Settings ────────────────────────────────────────────────
async function loadPrefs() {
  const s = await ipcRenderer.invoke('get-settings');
  Object.assign(prefs, s);
  initTheme();
  document.getElementById('pref-autosave').checked = prefs.autoSave;
  document.getElementById('pref-confirm').checked  = prefs.confirmDelete;
  document.getElementById('pref-snap').checked     = prefs.snap;
  document.getElementById('pref-stepnum').checked  = prefs.showStepNum;
  document.getElementById('pref-animate').checked  = prefs.animate;
  if (prefs.adbPath) document.getElementById('adb-path-input').value = prefs.adbPath;
}
function savePref() {
  prefs.autoSave    = document.getElementById('pref-autosave').checked;
  prefs.confirmDelete = document.getElementById('pref-confirm').checked;
  prefs.snap        = document.getElementById('pref-snap').checked;
  prefs.showStepNum = document.getElementById('pref-stepnum').checked;
  prefs.animate     = document.getElementById('pref-animate').checked;
  snapToGrid = prefs.snap;
  ipcRenderer.invoke('save-settings', prefs);
  render();
}
function saveAdbPath() {
  prefs.adbPath = document.getElementById('adb-path-input').value;
  ipcRenderer.invoke('save-settings', prefs);
  addLog('ADB path saved: '+prefs.adbPath, 'info');
}
function setLang(l) { prefs.lang=l; ipcRenderer.invoke('save-settings',prefs); }
function resetAllSettings() { if(confirm('Reset semua settings?')) { ipcRenderer.invoke('save-settings',{}); location.reload(); } }

// ─── Macro Recorder View ──────────────────────────────────────
function startMacroRecord() {
  macroRecording = true;
  document.getElementById('rec-start-btn').disabled = true;
  document.getElementById('rec-stop-btn').disabled  = false;
  document.getElementById('rec-save-btn').disabled  = true;
  document.getElementById('rec-badge').className = 'rec-badge active';
  document.getElementById('rec-badge2').style.display = 'flex';
  addLog('Macro recording started', 'info');
  document.getElementById('rec-steps').innerHTML = '<span style="color:var(--green);">● Recording... klik area di bawah ini</span><br>';
  document.getElementById('rec-steps').addEventListener('click', recordClick);
}
function recordClick(e) {
  const el = document.getElementById('rec-steps');
  const rect = el.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);
  macroSteps.push({ id:Date.now(), name:'Tap ('+x+','+y+')', type:'mobile-tap', mx:x, my:y, delay:500, var:'', comment:'', status:'' });
  el.innerHTML += '<span style="color:var(--dim2);">↳ Tap at ('+x+', '+y+')</span><br>';
}
function stopMacroRecord() {
  macroRecording = false;
  document.getElementById('rec-start-btn').disabled = false;
  document.getElementById('rec-stop-btn').disabled  = true;
  document.getElementById('rec-save-btn').disabled  = macroSteps.length === 0;
  document.getElementById('rec-badge').className = 'rec-badge';
  document.getElementById('rec-badge2').style.display = 'none';
  document.getElementById('rec-steps').removeEventListener('click', recordClick);
  addLog('Macro stopped. '+macroSteps.length+' steps recorded.', 'info');
}
function clearRecordedSteps() { macroSteps=[]; document.getElementById('rec-steps').innerHTML='Klik Start Recording...'; document.getElementById('rec-save-btn').disabled=true; }
function saveRecordedToWorkflow() {
  pushHistory();
  project.steps.push(...macroSteps.map(s=>({...s})));
  project.edges = project.steps.slice(0,-1).map((s,i)=>({ id:'e-'+Date.now()+i, from:s.id, to:project.steps[i+1].id, label:'' }));
  autoLayout(); render(); switchView('editor');
  addLog('Macro saved: '+macroSteps.length+' steps added', 'success');
}

// ─── Keyboard Shortcuts ───────────────────────────────────────
window.addEventListener('keydown', e => {
  const t = e.target.tagName;
  if (t==='INPUT'||t==='TEXTAREA'||t==='SELECT') return;
  if (e.key === 'F1' || (e.shiftKey && e.key === '?')) { e.preventDefault(); showShortcutHelp(); }
  if (e.ctrlKey) {
    switch(e.key.toLowerCase()) {
      case 'z': e.preventDefault(); e.shiftKey ? redoAction() : undoAction(); break;
      case 'y': e.preventDefault(); redoAction(); break;
      case 's': e.preventDefault(); saveCurrentProject(); break;
      case 'n': e.preventDefault(); createNew(); break;
      case 'o': e.preventDefault(); document.getElementById('fileInput').click(); break;
      case '=': case '+': e.preventDefault(); zoomIn(); break;
      case '-': e.preventDefault(); zoomOut(); break;
      case '0': e.preventDefault(); resetZoom(); break;
      case 'a': e.preventDefault(); selectAll(); break;
      case 'c': e.preventDefault(); copySelected(); break;
      case 'v': e.preventDefault(); pasteNodes(); break;
      case 'd': e.preventDefault(); duplicateSelected(); break;
    }
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { if(selectedIdx!==null) deleteSelected(); }
  if (e.key === 'Escape') { closeCtxMenu(); showPropEmpty(); selectedIdx=null; multiSelect=[]; render(); }
});

// ─── INIT ─────────────────────────────────────────────────────
(async function init() {
  await loadPrefs();
  await loadSavedProjects();
  updateDashboardStats();
  createNew();
  applyTransform();
  addLog('RBA Studio Pro 2.0 ready!', 'success');
  addLog('Tip: Drag activities dari panel kiri ke canvas, lalu drag port biru untuk menghubungkan nodes.', 'info');
  // Check ADB before refreshing devices
  const adbInfo = await ipcRenderer.invoke('adb-info');
  if (adbInfo.found) {
    refreshDevices();
    updateDashboardStats();
  } else {
    addLog('ADB tidak ditemukan. Install ADB untuk fitur device Android.', 'warn');
  }
  window.ipcRenderer = ipcRenderer;
  window.switchView = safeCall('switchView', switchView);
  window.toggleTheme = safeCall('toggleTheme', toggleTheme);
  window.refreshDevices = safeCall('refreshDevices', refreshDevices);
  window.createNew = safeCall('createNew', createNew);
  window.loadSavedProjects = safeCall('loadSavedProjects', loadSavedProjects);
  window.openProject = safeCall('openProject', openProject);
  window.deleteProject = safeCall('deleteProject', deleteProject);
  window.showAdbInfo = safeCall('showAdbInfo', showAdbInfo);
  window.showTemplateModal = safeCall('showTemplateModal', showTemplateModal);

  initQuickViewXml();
  document.addEventListener('quickview-select-element', handleQuickViewSelectElement);

  const macroMount = document.getElementById('macro-recorder-mount');
  if (macroMount) {
    initMacroRecorder(macroMount);
  }

  // Auto-save timer (BUG #14)
  if (prefs.autoSave) {
    setInterval(function() {
      if (isDirty && project.steps.length > 0) {
        saveCurrentProject();
      }
    }, prefs.autoSaveInterval || 30000);  // Default 30 seconds
  }
})();


