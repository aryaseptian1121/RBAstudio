// ============================================================
// RBA STUDIO PRO — main.js (Electron Main Process)
// Author: Arya Septian  |  Version: 2.0
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { exec, execSync, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { ExcelLoopEngine } = require('./src/services/ExcelLoopEngine');
const WinAuto = require('./src/services/WindowsAutomation');
const BrowserManager = require('./src/services/BrowserManager');
const { resolveTarget } = require('./src/engine/TargetResolver');

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

ipcMain.handle('excel-loop-run', async (e, config) => {
  if (currentExcelLoopEngine) {
    return { success:false, error: 'Excel loop already running' };
  }
  currentExcelLoopEngine = new ExcelLoopEngine(config,
    state => e.sender.send('excel-loop-state', state),
    (level, message) => e.sender.send('excel-loop-log', { level: level.toUpperCase(), message })
  );
  try {
    await currentExcelLoopEngine.run();
    return { success:true };
  } catch (err) {
    return { success:false, error: err.message || String(err) };
  } finally {
    currentExcelLoopEngine = null;
  }
});

ipcMain.handle('excel-loop-pause', async () => {
  currentExcelLoopEngine?.pause();
  return { success: true };
});

ipcMain.handle('excel-loop-resume', async () => {
  currentExcelLoopEngine?.resume();
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
