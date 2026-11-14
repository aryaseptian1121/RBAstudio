// ============================================================
// RBA STUDIO PRO — app.js (Enhanced & Fixed)
// Author: Arya Septian  |  Version: 2.0
// ============================================================
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require("electron");
const { exec, execSync, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// Import activity executors
const { executeSmartMobileTap } = require('./activities/SmartMobileTap');
const { executeWaitAndTap }     = require('./activities/WaitAndTap');

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

function getBundledBinaryPath(binName) {
    const suffix = os.platform() === 'win32' ? '.exe' : '';
    const fileName = `${binName}${suffix}`;
    const candidates = [];
    if (app.isPackaged) {
        candidates.push(path.join(process.resourcesPath, 'bin', fileName));
        candidates.push(path.join(process.resourcesPath, 'resources', 'bin', fileName));
    } else {
        candidates.push(path.join(__dirname, 'resources', 'bin', fileName));
        candidates.push(path.join(__dirname, 'scrcpy', fileName));
    }
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

// ─────────────────────────────────────────
// DEVICE POOL & ADB
// ─────────────────────────────────────────
class DevicePool {
    constructor() { this.devices=[]; this.adbPath=null; this.scrcpyProc=null; }

    findAdb() {
        if (this.adbPath) return this.adbPath;
        
        // 1. Try which (macOS/Linux) or where (Windows)
        try {
            const cmd = os.platform()==='win32' ? 'where adb' : 'which adb';
            const result = execSync(cmd, { stdio:['ignore','pipe','ignore'], encoding:'utf8' });
            const found = result.trim().split(/\r?\n/)[0];
            if (found && fs.existsSync(found)) { this.adbPath=found; return found; }
        } catch(e){}
        
        // 2. Check environment variables
        const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (androidHome) {
            const candidate = path.join(androidHome, 'platform-tools', os.platform()==='win32' ? 'adb.exe' : 'adb');
            if (fs.existsSync(candidate)) { this.adbPath=candidate; return candidate; }
        }
        if (process.env.ADB_PATH) {
            for (const cand of process.env.ADB_PATH.split(path.delimiter).filter(Boolean)) {
                if (fs.existsSync(cand)) { this.adbPath = cand; return cand; }
            }
        }
        
        // 3. Platform default paths
        const bundledAdb = getBundledBinaryPath('adb');
        if (bundledAdb) defaults.push(bundledAdb);
        const defaults = [];
        if (os.platform() === 'win32') {
            defaults.push(path.join(os.homedir(),'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
            defaults.push('C:\\platform-tools\\adb.exe');
        } else {
            defaults.push('/usr/local/bin/adb', '/usr/bin/adb');
        }
        for (const cand of defaults) {
            if (cand && fs.existsSync(cand)) { this.adbPath=cand; return cand; }
        }

        // 4. Fallback from preferences file
        try {
            const settings = loadSettings();
            if (settings.adbPath && fs.existsSync(settings.adbPath)) { this.adbPath = settings.adbPath; return settings.adbPath; }
        } catch(e) {}
        return null;
    }

    adb(args, device, cb) {
        const bin = this.findAdb() || getBundledBinaryPath('adb') || 'adb';
        const dFlag = device ? '-s "' + device + '"' : '';
        const cmd = '"' + bin + '" ' + dFlag + ' ' + args + '';
        exec(cmd, { timeout: 15000, encoding:'utf8' }, (err, stdout, stderr) => {
            cb({ success:!err, output:stdout||'', error:err?.message||stderr||'' });
        });
    }

    refresh() {
        try {
            const bin = this.findAdb() || getBundledBinaryPath('adb') || 'adb';
            const out = execSync('"' + bin + '" devices', { encoding:'utf8', timeout:5000 });
            this.devices = out.split('\n').slice(1)
                .map(l=>l.trim())
                .filter(l => l && l.includes('\tdevice'))
                .map(l => l.split(/\s+/)[0]);
        } catch(e) { this.devices=[]; }
        return this.devices;
    }

    launchScrcpy(device, args='') {
        try {
            const bundledScrcpy = getBundledBinaryPath('scrcpy');
            const cmd = os.platform()==='win32' ? 'where scrcpy' : 'which scrcpy';
            const scrcpy = bundledScrcpy || execSync(cmd,{stdio:['ignore','pipe','ignore']}).toString().trim().split(/\r?\n/)[0];
            const dFlag = device ? '-s "' + device + '"' : '';
            if (this.scrcpyProc) { try{this.scrcpyProc.kill();}catch(e){} }
            this.scrcpyProc = spawn(scrcpy, [...dFlag.split(' ').filter(Boolean), ...args.split(' ').filter(Boolean)], { detached:true, stdio:'ignore' });
            this.scrcpyProc.unref();
            return { success:true };
        } catch(e) {
            return { success:false, error: 'scrcpy tidak ditemukan. Pastikan scrcpy ada di PATH.\n' + e.message };
        }
    }
}
const pool = new DevicePool();

// ─────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────
function createWindow() {
    const win = new BrowserWindow({
        width:1600, height:1020, minWidth:1200, minHeight:700,
        title:"RBA Designer Pro — Studio 2.0",
        webPreferences:{ nodeIntegration:true, contextIsolation:false },
        backgroundColor:'#080d17'
    });
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function setupAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }
  template.push({
    label: 'File',
    submenu: [
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  });
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forcereload' },
      { role: 'toggledevtools' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
        { label: 'Open Barcode Generator', accelerator: isMac ? 'Cmd+Shift+B' : 'Ctrl+Shift+B', click: () => {
          const w = BrowserWindow.getAllWindows()[0];
          if (w) w.webContents.send('open-barcode');
        } }
    ]
  });
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ─────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────
ipcMain.on("open-external",   (e,url)=>shell.openExternal(url));
ipcMain.on("get-devices",     (e)=>e.reply("device-list", pool.refresh()));

ipcMain.handle("get-saved-workflows", ()=>loadSavedWorkflows());
ipcMain.handle("save-workflow", (e,wf)=>{
    const s=loadSavedWorkflows(); const idx=s.findIndex(i=>i.id===wf.id);
    if(idx>=0) s[idx]=wf; else s.unshift(wf);
    return saveWorkflowsFile(s);
});
ipcMain.handle("load-workflow",   (e,id)=>loadSavedWorkflows().find(i=>i.id===id)||null);
ipcMain.handle("delete-workflow", (e,id)=>saveWorkflowsFile(loadSavedWorkflows().filter(i=>i.id!==id)));
ipcMain.handle("get-settings",    ()=>loadSettings());
ipcMain.handle("save-settings",   (e,s)=>saveSettingsFile(s));

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

// Open file dialog
ipcMain.handle("open-file-dialog", async (e, opts)=>{
    const res = await dialog.showOpenDialog(opts||{});
    return res;
});

// ADB WiFi connect
ipcMain.handle("adb-connect-wifi", async (e, { ip, port })=>{
    return new Promise(resolve=>{
        const bin = pool.findAdb() || getBundledBinaryPath('adb') || 'adb';
        exec('"' + bin + '" connect ' + ip + ':' + port||5555 + '', {encoding:'utf8', timeout:10000}, (err, stdout)=>{
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

// ─────────────────────────────────────────
// FRONTEND HTML
// ─────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="id" data-theme="dark">
<head>
<meta charset="UTF-8">
<title>RBA Studio Pro 2.0</title>
<style>
/* ── TOKENS ─────────────────────────────────────── */
:root {
  --bg: #070c18; --bg2: #0d1529; --bg3: #111827; --card: #0f1a2e;
  --border: rgba(255,255,255,0.10); --border2: rgba(255,255,255,0.06);
  --accent: #3b82f6; --accent2: #6366f1; --green: #10b981; --red: #ef4444;
  --orange: #f97316; --yellow: #eab308; --purple: #a855f7;
  --text: #f1f5f9; --dim: #64748b; --dim2: #94a3b8;
  --radius: 16px; --radius-sm: 10px;
  --glow-blue: 0 0 20px rgba(59,130,246,0.35);
  --glow-green: 0 0 20px rgba(16,185,129,0.35);
}
[data-theme="light"] {
  --bg:#f0f4ff; --bg2:#ffffff; --bg3:#f8faff; --card:#ffffff;
  --border:#dde3f0; --border2:#e8edf8;
  --text:#1e293b; --dim:#64748b; --dim2:#94a3b8;
}

/* ── RESET ──────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0;font-family:'Inter','Segoe UI',Arial,sans-serif;}
body{background:var(--bg);color:var(--text);height:100vh;overflow:hidden;user-select:none;}

/* ── LAYOUT ─────────────────────────────────────── */
.shell{display:flex;height:100vh;}
.sidebar{width:220px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:flex-start;padding:16px 12px;gap:8px;z-index:200;flex-shrink:0;}
.sidebar-labels{position:fixed;left:80px;top:20px;display:flex;flex-direction:column;gap:6px;pointer-events:auto;z-index:210}
.sidebar-labels .item{background:transparent;color:var(--dim2);padding:10px 14px;border-radius:8px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px}
.sidebar-labels .item:hover{background:rgba(255,255,255,0.03);color:var(--text)}
.sidebar-labels .item.active{background:var(--accent);color:#fff}
.main{flex:1;display:flex;flex-direction:column;min-width:0;}
header{height:56px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:14px;flex-shrink:0;}

/* ── SIDEBAR ICONS ───────────────────────────────── */
.nav-ico{height:44px;border-radius:12px;display:flex;align-items:center;gap:12px;cursor:pointer;color:var(--dim2);font-size:15px;padding:8px 12px;transition:all .18s;position:relative;width:100%;}
.nav-ico .icon{width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;border-radius:8px}
.nav-ico:hover{background:rgba(255,255,255,0.03);color:var(--text);}
.nav-ico.active{background:var(--accent);color:#fff;box-shadow:var(--glow-blue);}
.nav-ico .tooltip{display:none}
.nav-ico .label-inline{font-size:14px;color:var(--dim2)}
/* Permanent label next to icon (used for some items like Barcode) */
.nav-ico .label{position:absolute;left:56px;top:50%;transform:translateY(-50%);color:var(--text);font-size:13px;white-space:nowrap;opacity:1;padding-left:6px;}
.sidebar-sep{width:36px;height:1px;background:var(--border);margin:6px 0;}

/* ── HEADER ──────────────────────────────────────── */
.hdr-logo{font-weight:800;font-size:14px;letter-spacing:.04em;background:linear-gradient(135deg,#60a5fa,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hdr-project{font-size:13px;font-weight:600;color:var(--dim2);cursor:pointer;padding:4px 10px;border-radius:8px;border:1px solid var(--border2);}
.hdr-project:hover{border-color:var(--accent);color:var(--text);}
.hdr-project-input{width:min(360px,100%);min-width:200px;padding:4px 10px;border-radius:8px;border:1px solid var(--border2);background:rgba(255,255,255,0.08);color:var(--text);font-size:13px;font-family:inherit;outline:none;}
.hdr-project-input:focus{border-color:var(--accent);background:rgba(255,255,255,0.12);}
.wf-item-edit-input{width:100%;min-width:200px;padding:8px 10px;border-radius:8px;border:1px solid var(--border2);background:rgba(255,255,255,0.08);color:var(--text);font-size:12px;font-family:inherit;outline:none;}
.wf-item-edit-input:focus{border-color:var(--accent);background:rgba(255,255,255,0.12);}
.hdr-spacer{flex:1;}
.hdr-badge{display:flex;align-items:center;gap:6px;font-size:11px;padding:5px 12px;border-radius:20px;border:1px solid var(--border);background:rgba(255,255,255,0.03);cursor:pointer;}
.hdr-badge.online{border-color:var(--green);color:var(--green);background:rgba(16,185,129,0.1);}
.hdr-badge.offline{border-color:var(--red);color:var(--red);background:rgba(239,68,68,0.08);}
.hdr-dot{width:7px;height:7px;border-radius:50%;background:currentColor;}

/* Dashboard CTA */
.dash-cta{display:flex;align-items:center;justify-content:space-between;gap:12px;background:linear-gradient(90deg,rgba(79,70,229,0.08),rgba(139,92,246,0.04));border:1px solid rgba(99,102,241,0.08);padding:14px;border-radius:12px;margin-top:12px}
.dash-cta-text{font-size:14px;color:var(--dim2)}
.hdr-btn{border:none;background:rgba(255,255,255,0.07);color:var(--text);border-radius:10px;padding:7px 14px;font-size:12px;cursor:pointer;transition:.15s;border:1px solid var(--border2);}
.hdr-btn:hover{background:rgba(255,255,255,0.12);}
.hdr-btn.primary{background:var(--accent);color:#fff;border-color:transparent;}
.hdr-btn.primary:hover{background:#2563eb;}
.hdr-btn.danger{background:var(--red);color:#fff;border-color:transparent;}

/* ── VIEWS ───────────────────────────────────────── */
.view{display:none;flex:1;overflow:hidden;}
.view.active{display:flex;flex-direction:column;}

/* ── EDITOR LAYOUT ───────────────────────────────── */
.editor-shell{display:flex;flex:1;overflow:hidden;gap:0;}
.left-panel{width:256px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.right-panel{width:300px;flex-shrink:0;background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.canvas-zone{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;}
.log-strip{height:220px;border-top:1px solid var(--border);background:var(--bg2);display:flex;flex-direction:column;flex-shrink:0;transition:height .25s;}
.log-strip.collapsed{height:36px;}

/* ── PANEL COMMON ────────────────────────────────── */
.panel-hdr{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--dim);padding:14px 16px 10px;border-bottom:1px solid var(--border2);text-transform:uppercase;}
.panel-body{flex:1;overflow-y:auto;padding:12px;}
.panel-body::-webkit-scrollbar{width:4px;}
.panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}

/* ── SEARCH ──────────────────────────────────────── */
.search-bar{margin:10px 12px 8px;position:relative;}
.search-bar input{width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border2);color:var(--text);border-radius:10px;padding:8px 12px 8px 32px;font-size:12px;outline:none;}
.search-bar input:focus{border-color:var(--accent);}
.search-bar::before{content:'🔍';position:absolute;left:10px;top:9px;font-size:11px;}

/* ── SECTION TITLE ───────────────────────────────── */
.sec{font-size:10px;font-weight:700;color:var(--dim);letter-spacing:.1em;padding:14px 4px 6px;text-transform:uppercase;}

/* ── TOOL CARDS ──────────────────────────────────── */
.tool-card{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;background:transparent;border:1px solid transparent;color:var(--text);font-size:12px;font-weight:500;transition:.15s;width:100%;text-align:left;}
.tool-card:hover{background:rgba(255,255,255,0.06);border-color:var(--border);}
.tool-card .tc-ico{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
.tool-card .tc-lbl strong{display:block;font-size:12px;}
.tool-card .tc-lbl span{font-size:10px;color:var(--dim2);}

/* ── TOOLBAR ─────────────────────────────────────── */
.toolbar{display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--bg2);flex-wrap:wrap;flex-shrink:0;}
.tb-btn{border:none;background:rgba(255,255,255,0.06);color:var(--text);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer;transition:.15s;border:1px solid var(--border2);white-space:nowrap;}
.tb-btn:hover{background:rgba(255,255,255,0.12);}
.tb-btn.active{background:rgba(59,130,246,0.2);border-color:rgba(59,130,246,0.5);color:#93c5fd;}
.tb-sep{width:1px;height:20px;background:var(--border);flex-shrink:0;}
.tb-run{background:var(--green)!important;color:#fff!important;border-color:transparent!important;}
.tb-run:hover{background:#059669!important;}
.tb-stop{background:var(--red)!important;color:#fff!important;border-color:transparent!important;}
.tb-stop:hover{background:#dc2626!important;}

/* ── CANVAS ──────────────────────────────────────── */
.canvas-area{flex:1;position:relative;overflow:hidden;
  background-color:var(--bg);
  background-image:
    radial-gradient(circle, rgba(59,130,246,0.04) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px);
  background-size: 20px 20px, 100px 100px, 100px 100px;
  cursor:grab;
}
.canvas-area:active{cursor:grabbing;}
#canvas-wrapper{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;}
#svg-layer{position:absolute;top:0;left:0;width:12000px;height:9000px;pointer-events:all;overflow:visible;}

/* ── NODES ───────────────────────────────────────── */
.node{
  position:absolute;width:200px;background:var(--card);
  border:1.5px solid rgba(255,255,255,0.1);border-radius:14px;
  padding:12px 14px;cursor:move;color:var(--text);
  box-shadow:0 4px 24px rgba(0,0,0,0.4);z-index:10;
  transition:border-color .2s, box-shadow .2s;
  display:flex;align-items:center;gap:12px;
}
.node:hover{border-color:rgba(255,255,255,0.25);box-shadow:0 8px 32px rgba(0,0,0,0.5);}
.node.selected{border-color:var(--accent)!important;box-shadow:0 0 0 2px rgba(59,130,246,0.3), 0 8px 32px rgba(0,0,0,0.5);}
.node.running{border-color:var(--yellow)!important;animation:pulse-node 1s infinite;}
.node.success{border-color:var(--green)!important;}
.node.error{border-color:var(--red)!important;}
.node-ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
.node-body{min-width:0;}
.node-lbl{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.node-type{font-size:10px;color:var(--dim2);text-transform:uppercase;letter-spacing:.06em;margin-top:1px;}
.node-port{position:absolute;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);top:50%;transform:translateY(-50%);cursor:crosshair;z-index:20;}
.node-port.out{right:-5px;}
.node-port.in{left:-5px;}
.node-status-bar{position:absolute;bottom:0;left:0;right:0;height:3px;border-radius:0 0 12px 12px;background:transparent;transition:.2s;}
.node.running .node-status-bar{background:var(--yellow);}
.node.success .node-status-bar{background:var(--green);}
.node.error   .node-status-bar{background:var(--red);}
.node-step-num{position:absolute;top:-8px;left:8px;font-size:9px;font-weight:700;background:var(--accent);color:#fff;border-radius:4px;padding:1px 5px;}

@keyframes pulse-node{0%,100%{box-shadow:0 0 0 2px rgba(234,179,8,0.5);}50%{box-shadow:0 0 0 6px rgba(234,179,8,0.0);}}

/* ── SVG LINES ───────────────────────────────────── */
.flow-edge{fill:none;stroke-width:2;stroke-linecap:round;cursor:pointer;pointer-events:stroke;transition:stroke-width .2s,opacity .2s;}
.flow-edge:hover{stroke-width:3;}
.flow-edge.selected{stroke-width:3;filter:drop-shadow(0 0 6px currentColor);}
.flow-edge.active-run{stroke-dasharray:10,5;animation:dash-anim 0.6s linear infinite;}
@keyframes dash-anim{to{stroke-dashoffset:-15;}}

/* ── CONTEXT MENU ────────────────────────────────── */
.ctx-menu{position:fixed;background:rgba(13,21,41,0.98);border:1px solid var(--border);border-radius:10px;padding:6px;z-index:9999;min-width:180px;box-shadow:0 16px 48px rgba(0,0,0,0.6);backdrop-filter:blur(10px);}
.ctx-item{padding:7px 12px;font-size:12px;cursor:pointer;border-radius:6px;color:var(--text);display:flex;align-items:center;gap:8px;transition:.12s;}
.ctx-item:hover{background:rgba(59,130,246,0.18);}
.ctx-item.danger:hover{background:rgba(239,68,68,0.18);color:var(--red);}
.ctx-item .ctx-ico{width:16px;text-align:center;}
.ctx-sep{height:1px;background:var(--border);margin:4px 0;}
.ctx-sub{color:var(--dim);font-size:10px;font-weight:700;letter-spacing:.08em;padding:6px 12px 2px;text-transform:uppercase;}

/* ── PROPERTIES PANEL ────────────────────────────── */
.prop-group{margin-bottom:16px;}
.prop-label{font-size:10px;font-weight:700;color:var(--dim2);letter-spacing:.06em;margin-bottom:5px;display:block;text-transform:uppercase;}
.prop-input{width:100%;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12px;outline:none;transition:.15s;}
.prop-input.prop-warning-device{border-color:#f59e0b!important;box-shadow:0 0 0 3px rgba(245,158,11,0.18);}
.prop-input:focus{border-color:var(--accent);background:rgba(59,130,246,0.06);}
.prop-select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M0 0l6 8 6-8z' fill='%2364748b'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px;}
.prop-sep{height:1px;background:var(--border2);margin:14px 0;}
.prop-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.prop-ico-big{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;}
.prop-empty{color:var(--dim);text-align:center;padding:48px 16px;font-size:12px;line-height:1.7;}
.btn-full{width:100%;padding:9px;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;transition:.15s;margin-bottom:6px;}
.btn-delete{background:rgba(239,68,68,0.15);color:var(--red);border:1px solid rgba(239,68,68,0.25);}
.btn-delete:hover{background:var(--red);color:#fff;}
.btn-dup{background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.25);}
.btn-dup:hover{background:var(--accent2);color:#fff;}
.btn-run-step{background:rgba(16,185,129,0.15);color:var(--green);border:1px solid rgba(16,185,129,0.25);}
.btn-run-step:hover{background:var(--green);color:#fff;}
.btn-draw-conn{background:rgba(59,130,246,0.12);color:#93c5fd;border:1px solid rgba(59,130,246,0.25);}
.btn-draw-conn:hover{background:var(--accent);color:#fff;}
.prop-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}

/* ── DEVICE CARD ─────────────────────────────────── */
.dev-section{margin-top:auto;padding:12px;border-top:1px solid var(--border);}
.dev-label{font-size:10px;color:var(--dim);font-weight:700;letter-spacing:.06em;margin-bottom:6px;text-transform:uppercase;}
.dev-select{width:100%;background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px;font-size:11px;}
.dev-actions{display:flex;gap:6px;margin-top:8px;}
.dev-btn{flex:1;border:none;border-radius:7px;padding:6px;font-size:10px;cursor:pointer;font-weight:600;transition:.15s;}
.dev-btn.refresh{background:rgba(59,130,246,0.15);color:#93c5fd;border:1px solid rgba(59,130,246,0.2);}
.dev-btn.scrcpy{background:rgba(168,85,247,0.15);color:#c4b5fd;border:1px solid rgba(168,85,247,0.2);}
.dev-btn:hover{filter:brightness(1.3);}

/* ── LOG PANEL ───────────────────────────────────── */
.log-hdr{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;cursor:pointer;border-bottom:1px solid var(--border2);flex-shrink:0;}
.log-hdr-title{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);display:flex;align-items:center;gap:8px;}
.log-hdr-actions{display:flex;gap:6px;}
.log-body{display:flex;flex:1;overflow:hidden;}
.log-output{flex:1;overflow-y:auto;padding:8px 14px;font-family:'Consolas','Courier New',monospace;font-size:11px;line-height:1.7;color:#94a3b8;}
.log-output .log-info{color:#94a3b8;}
.log-output .log-warn{color:#fbbf24;}
.log-output .log-error{color:#f87171;}
.log-output .log-success{color:#34d399;}
.log-output .log-ts{color:#475569;}
.log-stats{width:200px;border-left:1px solid var(--border2);padding:12px;flex-shrink:0;}
.stat-item{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;}
.stat-val{font-weight:700;color:var(--text);}

/* ── DASHBOARD ───────────────────────────────────── */
.dash-view{padding:32px;overflow-y:auto;flex:1;}
.dash-title{font-size:22px;font-weight:800;margin-bottom:6px;}
.dash-sub{font-size:13px;color:var(--dim2);margin-bottom:28px;}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:28px;}
.dash-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px;}
.dash-summary .dash-card{cursor:default;}
.dash-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;cursor:pointer;transition:.2s;}
.dash-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.3);}
.dash-card-ico{font-size:24px;margin-bottom:10px;}
.dash-card-ttl{font-size:13px;font-weight:700;margin-bottom:4px;}
.dash-card-sub{font-size:11px;color:var(--dim2);}
.wf-list-wrap{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.wf-list-hdr{padding:14px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between;}
.wf-item{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--border2);transition:.15s;}
.wf-item:last-child{border-bottom:none;}
.wf-item:hover{background:rgba(255,255,255,0.03);}
.wf-item-ico{width:36px;height:36px;border-radius:8px;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;}
.wf-item-body{flex:1;min-width:0;}
.wf-item-name{font-size:12px;font-weight:700;}
.wf-item-meta{font-size:10px;color:var(--dim2);}
.wf-item-actions{display:flex;gap:6px;}
.wf-item-btn{border:none;border-radius:6px;padding:5px 10px;font-size:10px;cursor:pointer;font-weight:600;}
.wf-item-btn.open{background:rgba(59,130,246,0.15);color:#93c5fd;}
.wf-item-btn.rename{background:rgba(148,163,184,0.12);color:#cbd5e1;}
.wf-item-btn.save{background:rgba(16,185,129,0.12);color:#86efac;}
.wf-item-btn.cancel{background:rgba(148,163,184,0.12);color:#cbd5e1;}
.wf-item-btn.del{background:rgba(239,68,68,0.12);color:var(--red);}

/* ── SETTINGS ────────────────────────────────────── */
.settings-view{padding:32px;overflow-y:auto;flex:1;}
.settings-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;}
.setting-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;}
.setting-card-ttl{font-size:11px;font-weight:700;letter-spacing:.1em;color:var(--dim);text-transform:uppercase;margin-bottom:16px;}

/* ── MINIMAP ─────────────────────────────────────── */
#minimap{position:absolute;bottom:16px;right:16px;width:180px;height:130px;background:rgba(7,12,24,0.9);border:1px solid var(--border);border-radius:10px;overflow:hidden;z-index:50;display:none;}
#minimap canvas{width:100%;height:100%;}
.minimap-viewport{position:absolute;border:1px solid rgba(59,130,246,0.6);pointer-events:none;}

/* ── ZOOM INDICATOR ──────────────────────────────── */
.zoom-badge{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:rgba(13,21,41,0.85);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-size:11px;font-weight:700;color:var(--dim2);pointer-events:none;z-index:30;}

/* ── TEMP LINE ───────────────────────────────────── */
#temp-line{pointer-events:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:6,3;fill:none;}

/* ── TOGGLE ──────────────────────────────────────── */
.toggle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.toggle-row label{font-size:12px;color:var(--dim2);}
.toggle{position:relative;width:36px;height:20px;}
.toggle input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:rgba(255,255,255,0.1);border-radius:20px;cursor:pointer;transition:.2s;}
.toggle input:checked+.toggle-slider{background:var(--accent);}
.toggle-slider::after{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;}
.toggle input:checked+.toggle-slider::after{transform:translateX(16px);}

/* ── REC INDICATOR ───────────────────────────────── */
.rec-badge{display:none;align-items:center;gap:6px;font-size:11px;color:var(--red);animation:blink 1s step-start infinite;}
@keyframes blink{50%{opacity:0;}}
.rec-badge.active{display:flex;}
.rec-dot{width:8px;height:8px;border-radius:50%;background:var(--red);}

/* ── BARCODE GENERATOR ─────────────────────────────── */
.barcode-layout{display:grid;grid-template-columns:1.08fr 1.8fr 0.95fr;gap:14px;height:100%;padding:18px;overflow:hidden;box-sizing:border-box;}
  .barcode-layout.left-collapsed{grid-template-columns:56px 1fr 0.95fr;}
.barcode-panel{background:rgba(15,23,42,0.76);border:1px solid rgba(148,163,184,0.22);border-radius:20px;box-shadow:0 18px 42px rgba(15,23,42,0.22);display:flex;flex-direction:column;overflow:hidden;min-width:0;}
.barcode-panel-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.18);}
.barcode-panel-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;}
.barcode-panel-body{padding:14px;overflow:auto;display:flex;flex-direction:column;gap:14px;min-height:0;}
.barcode-format-card{background:linear-gradient(180deg, rgba(99,102,241,0.1), rgba(15,23,42,0.02));border:1px solid rgba(148,163,184,0.22);border-radius:16px;padding:12px;cursor:pointer;transition:all .18s ease;display:flex;flex-direction:column;gap:10px;min-height:92px;}
.barcode-format-card:hover{border-color:rgba(165,180,252,0.9);transform:translateY(-1px);box-shadow:0 14px 28px rgba(99,102,241,0.12);}
.barcode-format-card.active{border-color:rgba(129,140,248,0.9);background:linear-gradient(180deg, rgba(99,102,241,0.18), rgba(99,102,241,0.04));box-shadow:0 14px 28px rgba(99,102,241,0.18);}
.barcode-format-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.barcode-format-card-top strong{font-size:12px;color:#e2e8f0;line-height:1.35;}
.barcode-chip{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:rgba(99,102,241,0.18);color:#c7d2fe;border-radius:999px;padding:5px 8px;}
.barcode-mini-preview{height:48px;background:rgba(255,255,255,0.92);border:1px solid rgba(148,163,184,0.25);border-radius:10px;padding:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.barcode-mini-preview svg{width:100%;height:100%;max-width:118px;}
.barcode-category{display:flex;flex-direction:column;gap:10px;}
.barcode-category-header{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1;margin-top:4px;}
.barcode-category-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.barcode-input-row{display:flex;gap:8px;flex-wrap:wrap;}
.barcode-button{border:1px solid rgba(148,163,184,0.22);border-radius:10px;padding:9px 12px;font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:all .18s ease;background:rgba(15,23,42,0.38);color:#e2e8f0;}
.barcode-button.primary{background:linear-gradient(135deg,#4f46e5,#8b5cf6);border-color:transparent;color:#fff;box-shadow:0 12px 22px rgba(79,70,229,0.28);}
.barcode-button.secondary{background:rgba(148,163,184,0.08);}
.barcode-button.ghost{background:transparent;}
.barcode-button:hover{filter:brightness(1.04);transform:translateY(-1px);}
/* Smooth micro-interactions for buttons */
.barcode-button{transition:background-color var(--transition-base), transform 120ms ease, box-shadow var(--transition-base);}
.barcode-button:active{transform:translateY(0);}

/* Toggle switch styling */
.barcode-toggle{display:flex;align-items:center;justify-content:space-between;padding:8px 0;gap:12px;}
.barcode-toggle .toggle-wrap{position:relative;width:44px;height:24px;background:var(--toggle-bg);border-radius:999px;padding:3px;display:flex;align-items:center;}
.barcode-toggle .toggle-thumb{width:18px;height:18px;border-radius:50%;background:var(--toggle-thumb);box-shadow:0 2px 6px rgba(0,0,0,0.25);transition:transform .18s ease;}
.barcode-toggle input[type='checkbox']{appearance:none;-webkit-appearance:none;position:absolute;left:0;top:0;width:100%;height:100%;margin:0;cursor:pointer;}
.barcode-toggle input[type='checkbox']:checked + .toggle-wrap{background:linear-gradient(90deg,var(--accent-blue),var(--sidebar-item-active-text));}
.barcode-toggle input[type='checkbox']:checked + .toggle-wrap .toggle-thumb{transform:translateX(20px);} 

/* Color swatch styling for color inputs */
.barcode-option input[type='color']{appearance:none;border:none;padding:0;width:44px;height:36px;border-radius:8px;cursor:pointer;}
.barcode-option input[type='color']::-webkit-color-swatch-wrapper{padding:0;border-radius:8px;}
.barcode-option input[type='color']::-webkit-color-swatch{border-radius:8px;border:1px solid rgba(0,0,0,0.08);}

/* Skeleton for heavy preview */
.skeleton-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;}
.skeleton-card{background:linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));border-radius:12px;padding:16px;min-height:140px;position:relative;overflow:hidden;}
.skeleton-line{height:12px;background:linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08));border-radius:6px;margin-top:8px;animation: shimmer 1.2s infinite linear;}
@keyframes shimmer{0%{transform:translateX(-20%);}100%{transform:translateX(120%);}}

/* Info banner when limiting preview */
.preview-info{font-size:12px;color:var(--dim);padding:8px 12px;background:transparent;border-radius:8px;text-align:center;}
.barcode-textarea{width:100%;min-height:170px;resize:vertical;border-radius:12px;border:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.42);color:#f8fafc;padding:12px 14px;font-size:13px;line-height:1.5;}
.barcode-textarea:focus{outline:none;border-color:rgba(129,140,248,0.9);box-shadow:0 0 0 3px rgba(99,102,241,0.18);}
.barcode-help{font-size:11px;color:#cbd5e1;line-height:1.6;}
.barcode-output-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.barcode-output-grid{display:flex;flex-direction:column;gap:12px;min-height:140px;max-height:480px;overflow:auto;padding-right:4px;}
.barcode-output-card{background:rgba(255,255,255,0.98);border:1px solid rgba(15,23,42,0.08);border-radius:16px;display:flex;flex-direction:column;align-items:center;padding:12px;gap:10px;min-height:180px;box-shadow:0 10px 22px rgba(15,23,42,0.08);}
.barcode-output-card svg{width:100%;height:92px;max-width:100%;}
.barcode-output-text{font-size:11px;text-align:center;color:#0f172a;line-height:1.4;word-break:break-word;}
.hidden-preview{display:none !important;}
.barcode-button:focus, .barcode-button:hover{box-shadow:0 8px 20px rgba(59,130,246,0.12);transform:translateY(-3px) scale(1.02);}
.barcode-output-error{font-size:11px;color:#dc2626;line-height:1.4;text-align:center;}
.barcode-empty{border:1px dashed rgba(148,163,184,0.55);border-radius:16px;padding:22px 16px;background:rgba(148,163,184,0.03);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:180px;color:#cbd5e1;text-align:center;}
.barcode-empty-icon{font-size:28px;opacity:.8;}
.barcode-options-wrap{display:grid;grid-template-columns:1fr;gap:10px;}
.barcode-option{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#cbd5e1;}
.barcode-option input[type="number"], .barcode-option select, .barcode-option input[type="text"]{width:100%;background:rgba(15,23,42,0.42);border:1px solid rgba(148,163,184,0.22);padding:9px 10px;border-radius:10px;color:#f8fafc;box-sizing:border-box;}
.barcode-option input[type="color"]{width:100%;min-height:42px;border-radius:10px;border:1px solid rgba(148,163,184,0.22);background:rgba(15,23,42,0.42);padding:4px;box-sizing:border-box;}
.barcode-toggle{display:flex;align-items:center;justify-content:space-between;padding:8px 0;}
.barcode-toggle input{accent-color:#8b5cf6;transform:scale(1.08);}
.barcode-download-wrap{display:flex;flex-direction:column;gap:8px;}
.barcode-sequence-modal{position:fixed;inset:0;background:rgba(15,23,42,0.72);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px;}
.barcode-sequence-modal.active{display:flex;}
.barcode-sequence-box{width:min(520px,100%);background:rgba(15,23,42,0.96);border:1px solid rgba(148,163,184,0.22);border-radius:22px;padding:18px;box-shadow:0 22px 48px rgba(15,23,42,0.4);}
.barcode-sequence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.barcode-sequence-grid .barcode-option{font-size:11px;}
.barcode-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a5b4fc;}
.barcode-print-view{display:none;}
@media print{
  body * { visibility: hidden; }
  #barcode-print-view, #barcode-print-view * { visibility: visible; }
  #barcode-print-view{ position: absolute; inset: 0; display: block; background: white; }
  .barcode-print-grid{ display:grid; grid-template-columns: repeat(auto-fit, minmax(2.625in, 1fr)); gap: .2in; }
  .barcode-print-card{ display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:1in; max-height:1.2in; border:1px solid #d1d5db; border-radius:8px; padding:.12in; }
  .barcode-print-card svg{ width:100%; max-height:0.7in; }
  .barcode-print-card .caption{ font-size:10px; text-align:center; color:#111827; }
}
@media (max-width: 1024px){ .barcode-layout{grid-template-columns:1fr;overflow:auto;} .barcode-sequence-grid{grid-template-columns:1fr;} }
</style>
</head>
<body>
<div class="shell">

  <!-- SIDEBAR -->
  <nav class="sidebar">
    <div class="nav-ico active" id="nav-dash" onclick="switchView('dashboard')" title="">
      <div class="icon">⊞</div><div class="label-inline">Dashboard</div>
    </div>
    <div class="nav-ico barcode-hot" id="nav-barcode-hot" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();" title="">
      <div class="icon">🏷️</div><div class="label-inline">Barcode</div>
    </div>
    <div class="nav-ico" id="nav-edit" onclick="switchView('editor')" title="">
      <div class="icon">⚡</div><div class="label-inline">Workflows</div>
    </div>
    <div class="nav-ico" id="nav-rec" onclick="switchView('recorder')" title="">
      <div class="icon">🎬</div><div class="label-inline">Macro Recorder</div>
    </div>
    <div class="nav-ico" id="nav-set" onclick="switchView('settings')" title="">
      <div class="icon">⚙️</div><div class="label-inline">Settings</div>
    </div>
    <div class="nav-ico" id="nav-barcode" onclick="switchView('barcode-generator')" title="">
      <div class="icon">🏷️</div><div class="label-inline">Barcode Generator</div>
    </div>

    <!-- VISIBLE SIDEBAR LABELS (for discoverability) -->
    <div class="sidebar-labels">
      <div class="item" onclick="switchView('dashboard')">🏠 Dashboard</div>
      <div class="item" onclick="switchView('editor')">⚡ Workflows</div>
      <div class="item" onclick="switchView('recorder')">🎬 Macro Recorder</div>
      <div class="item" onclick="switchView('excel-loop')">📊 Excel Loop</div>
      <div class="item" onclick="switchView('whatsapp-bot')">💬 WhatsApp Bot</div>
      <div class="item" onclick="switchView('flow-retur')">🔁 Flow Retur</div>
      <div class="item" onclick="switchView('settings')">⚙️ Settings</div>
      <div class="item active" id="sidebar-barcode-item" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();">🏷️ Barcode Generator</div>
      <div class="item" onclick="toggleTheme()">🌓 Theme</div>
      <div class="item" onclick="showAdbInfo()">📱 Devices</div>
    </div>
    <div class="sidebar-sep"></div>
    <div class="nav-ico" onclick="toggleTheme()" title="">
      <div class="icon">🌓</div><div class="label-inline">Theme</div>
    </div>
    <div class="nav-ico" onclick="showAdbInfo()" title="" style="margin-top:auto;">
      <div class="icon">📱</div><div class="label-inline">Devices</div>
    </div>
  </nav>

  <div class="main">
    <!-- HEADER -->
    <header>
      <div class="hdr-logo">RBA Studio Pro</div>
      <div class="hdr-project" id="proj-name" onclick="enterHeaderRename()">Untitled Flow ✏️</div>
      <div class="hdr-spacer"></div>
      <div class="rec-badge" id="rec-badge"><div class="rec-dot"></div>REC</div>
      <div class="hdr-badge offline" id="bot-status"><div class="hdr-dot"></div>OFFLINE</div>
      <button class="hdr-btn primary" id="run-flow-btn" onclick="runWorkflow()">▶ RUN</button>
      <button class="hdr-btn danger"  id="stop-flow-btn" onclick="stopWorkflow()" disabled>■ STOP</button>
      <button class="hdr-btn" onclick="saveCurrentProject()">💾 Save</button>
      <button class="hdr-btn" id="hdr-barcode-btn" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();">🏷️ Barcode</button>
    </header>

    <!-- DASHBOARD VIEW -->
    <div class="view active" id="dashboard">
      <div class="dash-view">
        <div class="dash-title">🏠 Dashboard</div>
        <div class="dash-sub">Kelola & jalankan workflow automasi Anda</div>
        <div class="dash-cta">
          <div class="dash-cta-text">Buat barcode, ekspor ke SVG/PNG/PDF, dan cetak label dengan cepat.</div>
          <button class="hdr-btn primary" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();">Buka Barcode Generator</button>
        </div>
        <div class="dash-grid">
          <div class="dash-card" onclick="createNew(); switchView('editor')">
            <div class="dash-card-ico">➕</div>
            <div class="dash-card-ttl">New Workflow</div>
            <div class="dash-card-sub">Buat flow baru dari awal</div>
          </div>
          <div class="dash-card" onclick="document.getElementById('fileInput').click()">
            <div class="dash-card-ico">📂</div>
            <div class="dash-card-ttl">Import JSON</div>
            <div class="dash-card-sub">Muat workflow dari file</div>
          </div>
          <div class="dash-card" onclick="refreshDevices()">
            <div class="dash-card-ico">📱</div>
            <div class="dash-card-ttl">Scan Devices</div>
            <div class="dash-card-sub">Deteksi perangkat ADB</div>
          </div>
          <div class="dash-card" onclick="switchView('recorder')">
            <div class="dash-card-ico">🎬</div>
            <div class="dash-card-ttl">Macro Recorder</div>
            <div class="dash-card-sub">Rekam klik menjadi workflow</div>
          </div>
          <div class="dash-card" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();">
            <div class="dash-card-ico">🏷️</div>
            <div class="dash-card-ttl">Barcode Generator</div>
            <div class="dash-card-sub">Buat dan ekspor barcode cepat</div>
          </div>
        </div>
        <div class="dash-summary">
          <div class="dash-card">
            <div class="dash-card-ico">📁</div>
            <div class="dash-card-ttl">Workflows</div>
            <div class="dash-card-sub"><span id="stat-total-wf">0</span> tersimpan</div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">▶️</div>
            <div class="dash-card-ttl">Runs</div>
            <div class="dash-card-sub"><span id="stat-total-runs">0</span> eksekusi</div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">✅</div>
            <div class="dash-card-ttl">Success Rate</div>
            <div class="dash-card-sub"><span id="stat-success-rate">0%</span></div>
          </div>
          <div class="dash-card">
            <div class="dash-card-ico">📱</div>
            <div class="dash-card-ttl">ADB Devices</div>
            <div class="dash-card-sub"><span id="stat-devices">0</span></div>
          </div>
          <div class="dash-card" onclick="switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator();">
            <div class="dash-card-ico">🏷️</div>
            <div class="dash-card-ttl">Barcode</div>
            <div class="dash-card-sub">Quick access</div>
          </div>
        </div>
        <div class="wf-list-wrap">
          <div class="wf-list-hdr">
            <span>📋 Saved Workflows</span>
            <button class="hdr-btn" onclick="loadSavedProjects()">🔄 Refresh</button>
          </div>
          <div id="wf-list" style="padding:8px;color:var(--dim);font-size:12px;text-align:center;">Memuat...</div>
        </div>
      </div>
    </div>

    <!-- EDITOR VIEW -->
    <div class="view" id="editor">
      <div class="editor-shell">

        <!-- LEFT: Tool Panel -->
        <div class="left-panel">
          <div class="panel-hdr">🧩 Activities</div>
          <div class="search-bar"><input type="text" placeholder="Cari activity..." oninput="filterTools(this.value)" id="tool-search"></div>
          <div class="panel-body" id="tool-list">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- CENTER: Canvas + Toolbar + Log -->
        <div class="canvas-zone">
          <div class="toolbar" id="toolbar">
            <button class="tb-btn" onclick="createNew()" title="New (Ctrl+N)">+ New</button>
            <button class="tb-btn" onclick="document.getElementById('fileInput').click()" title="Open (Ctrl+O)">📂 Open</button>
            <button class="tb-btn" onclick="saveCurrentProject()" title="Save (Ctrl+S)">💾 Save</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="undoAction()" title="Undo (Ctrl+Z)">↩ Undo</button>
            <button class="tb-btn" onclick="redoAction()" title="Redo (Ctrl+Y)">↪ Redo</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="selectAll()" title="Select All (Ctrl+A)">⬛ All</button>
            <button class="tb-btn" onclick="copySelected()" title="Copy (Ctrl+C)">📋 Copy</button>
            <button class="tb-btn" onclick="pasteNodes()" title="Paste (Ctrl+V)">📌 Paste</button>
            <button class="tb-btn" onclick="deleteSelected()" title="Delete (Del)">🗑 Delete</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="autoLayout()" title="Auto Arrange">⚡ Arrange</button>
            <button class="tb-btn" onclick="alignNodes('left')" title="Align Left">⬛ Align L</button>
            <button class="tb-btn" onclick="alignNodes('center')" title="Align Center">⬜ Center</button>
            <button class="tb-btn" onclick="alignNodes('right')" title="Align Right">▪ Align R</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="zoomIn()"   title="Zoom In (Ctrl+=)">🔍+</button>
            <button class="tb-btn" onclick="zoomOut()"  title="Zoom Out (Ctrl+-)">🔍-</button>
            <button class="tb-btn" onclick="resetZoom()" title="Fit (Ctrl+0)">⊡ Fit</button>
            <button class="tb-btn" id="snap-btn" onclick="toggleSnap()" title="Snap to Grid">📐 Snap</button>
            <button class="tb-btn" id="mm-btn" onclick="toggleMiniMap()" title="Mini Map">🗺 Map</button>
            <div class="tb-sep"></div>
            <button class="tb-btn" onclick="exportWorkflow()" title="Export JSON">📤 Export</button>
            <button class="tb-btn tb-run" onclick="runWorkflow()" id="tb-run-btn">▶ Run</button>
          </div>

          <div class="canvas-area" id="canvas">
            <div id="canvas-wrapper">
              <svg id="svg-layer">
                <defs>
                  <marker id="arr-default" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#64748b"/>
                  </marker>
                  <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#3b82f6"/>
                  </marker>
                  <marker id="arr-green" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#10b981"/>
                  </marker>
                  <marker id="arr-orange" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#f97316"/>
                  </marker>
                  <marker id="arr-purple" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#a855f7"/>
                  </marker>
                  <marker id="arr-yellow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L7,3 L0,6 Z" fill="#eab308"/>
                  </marker>
                  <filter id="glow-blue"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>
                <path id="temp-line" d="" style="display:none;"/>
              </svg>
            </div>
            <div class="zoom-badge" id="zoom-badge">100%</div>
            <div id="minimap">
              <canvas id="mm-canvas" width="180" height="130"></canvas>
            </div>
          </div>

          <!-- LOG STRIP -->
          <div class="log-strip" id="log-strip">
            <div class="log-hdr" onclick="toggleLog()">
              <div class="log-hdr-title">
                <span>📋</span> EXECUTION LOG
                <div class="rec-badge" id="rec-badge2" style="display:none;">
                  <div class="rec-dot"></div>RECORDING
                </div>
              </div>
              <div class="log-hdr-actions">
                <button class="hdr-btn" onclick="event.stopPropagation();clearLog()" style="font-size:10px;padding:3px 8px;">Clear</button>
                <button class="hdr-btn" onclick="event.stopPropagation();toggleLog()" style="font-size:10px;padding:3px 8px;" id="log-toggle-btn">▼</button>
              </div>
            </div>
            <div class="log-body" id="log-body">
              <div class="log-output" id="log-output"></div>
              <div class="log-stats">
                <div style="font-size:10px;font-weight:700;color:var(--dim);letter-spacing:.1em;margin-bottom:10px;">BOT STATS</div>
                <div class="stat-item"><span>Steps Run</span><span class="stat-val" id="st-steps">0</span></div>
                <div class="stat-item"><span>Errors</span><span class="stat-val" id="st-errors">0</span></div>
                <div class="stat-item"><span>Retries</span><span class="stat-val" id="st-retries">0</span></div>
                <div class="stat-item"><span>Runtime</span><span class="stat-val" id="st-runtime">0:00</span></div>
                <div class="stat-item"><span>ADB Cmds</span><span class="stat-val" id="st-adb">0</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: Properties Panel -->
        <div class="right-panel">
          <div class="panel-hdr">⚙️ Properties</div>
          <div class="panel-body" id="prop-panel">
            <div class="prop-empty" id="prop-empty">
              Klik node untuk edit properties<br><br>
              💡 Drag activity dari kiri ke canvas<br>
              🔗 Drag port biru untuk hubungkan node
            </div>
            <div id="prop-editor" style="display:none;">
              <div class="prop-title">
                <div class="prop-ico-big" id="pe-ico-big">📌</div>
                <div>
                  <div id="pe-type-lbl" style="font-size:10px;color:var(--dim2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;"></div>
                  <input class="prop-input" id="pe-name" placeholder="Node name" oninput="saveProp('name',this.value)" style="font-weight:700;padding:4px 8px;">
                </div>
              </div>
              <div class="prop-sep"></div>

              <!-- General -->
              <div class="prop-group" id="pg-general">
                <label class="prop-label">Delay Before (ms)</label>
                <input class="prop-input" type="number" id="pe-delay" value="500" oninput="saveProp('delay',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Output Variable</label>
                <input class="prop-input" id="pe-var" placeholder="e.g. result_text" oninput="saveProp('var',this.value)">
                <label class="prop-label" style="margin-top:8px;">Comment / Notes</label>
                <textarea class="prop-input" id="pe-comment" rows="2" placeholder="Optional note..." oninput="saveProp('comment',this.value)" style="resize:vertical;"></textarea>
              </div>

              <!-- TAP / CLICK -->
              <div class="prop-group" id="pg-tap" style="display:none;">
                <label class="prop-label">Selector / XPath</label>
                <input class="prop-input" id="pe-selector" placeholder="e.g. #btn-login or //button" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Koordinat X</label>
                <input class="prop-input" type="number" id="pe-cx" placeholder="0" oninput="saveProp('cx',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Koordinat Y</label>
                <input class="prop-input" type="number" id="pe-cy" placeholder="0" oninput="saveProp('cy',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Click Type</label>
                <select class="prop-input prop-select" id="pe-click-type" onchange="saveProp('clickType',this.value)">
                  <option value="single">Single Click</option>
                  <option value="double">Double Click</option>
                  <option value="right">Right Click</option>
                  <option value="middle">Middle Click</option>
                </select>
              </div>

              <!-- TYPE-INTO -->
              <div class="prop-group" id="pg-type" style="display:none;">
                <label class="prop-label">Selector / Field ID</label>
                <input class="prop-input" id="pe-type-selector" placeholder="e.g. #username" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Text to Type</label>
                <textarea class="prop-input" id="pe-text" rows="3" placeholder="Text atau {variable}" oninput="saveProp('text',this.value)"></textarea>
                <label class="prop-label" style="margin-top:8px;">Clear Before Type</label>
                <select class="prop-input prop-select" id="pe-clear" onchange="saveProp('clearBefore',this.value)">
                  <option value="yes">Yes — clear field first</option>
                  <option value="no">No — append text</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Typing Speed (ms/char)</label>
                <input class="prop-input" type="number" id="pe-typespeed" value="30" oninput="saveProp('typeSpeed',+this.value)">
              </div>

              <!-- OPEN BROWSER -->
              <div class="prop-group" id="pg-browser" style="display:none;">
                <label class="prop-label">URL</label>
                <input class="prop-input" id="pe-url" placeholder="https://..." oninput="saveProp('url',this.value)">
                <label class="prop-label" style="margin-top:8px;">Browser</label>
                <select class="prop-input prop-select" id="pe-browser" onchange="saveProp('browser',this.value)">
                  <option value="default">Default</option>
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="edge">Edge</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Mode</label>
                <select class="prop-input prop-select" id="pe-bmode" onchange="saveProp('browserMode',this.value)">
                  <option value="normal">Normal</option>
                  <option value="headless">Headless</option>
                  <option value="incognito">Incognito</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Wait After Load (ms)</label>
                <input class="prop-input" type="number" id="pe-bwait" value="2000" oninput="saveProp('waitAfterLoad',+this.value)">
              </div>

              <!-- SWIPE -->
              <div class="prop-group" id="pg-swipe" style="display:none;">
                <label class="prop-label">Direction</label>
                <select class="prop-input prop-select" id="pe-dir" onchange="saveProp('dir',this.value)">
                  <option value="up">Scroll Up</option>
                  <option value="down">Scroll Down</option>
                  <option value="left">Swipe Left</option>
                  <option value="right">Swipe Right</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Duration (ms)</label>
                <input class="prop-input" type="number" id="pe-dur" value="300" oninput="saveProp('dur',+this.value)">
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">Start X</label>
                    <input class="prop-input" type="number" id="pe-sx" oninput="saveProp('sx',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">Start Y</label>
                    <input class="prop-input" type="number" id="pe-sy" oninput="saveProp('sy',+this.value)">
                  </div>
                </div>
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">End X</label>
                    <input class="prop-input" type="number" id="pe-ex" oninput="saveProp('ex',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">End Y</label>
                    <input class="prop-input" type="number" id="pe-ey" oninput="saveProp('ey',+this.value)">
                  </div>
                </div>
              </div>

              <!-- MOBILE -->
              <div class="prop-group" id="pg-mobile" style="display:none;">
                <label class="prop-label">Device ID (kosong = perangkat aktif)</label>
                <input class="prop-input" id="pe-device-id" placeholder="Kosong = perangkat aktif" oninput="saveProp('deviceId',this.value)">
                <div class="prop-row2" style="margin-top:8px;">
                  <div>
                    <label class="prop-label">X</label>
                    <input class="prop-input" type="number" id="pe-mx" oninput="saveProp('mx',+this.value)">
                  </div>
                  <div>
                    <label class="prop-label">Y</label>
                    <input class="prop-input" type="number" id="pe-my" oninput="saveProp('my',+this.value)">
                  </div>
                </div>
                <label class="prop-label" style="margin-top:8px;">Key Code (press-key)</label>
                <input class="prop-input" id="pe-keycode" placeholder="e.g. 3 (Home), 4 (Back)" oninput="saveProp('keyCode',this.value)">
                <label class="prop-label" style="margin-top:8px;">Screenshot Path</label>
                <input class="prop-input" id="pe-screenshot-path" placeholder="/sdcard/screen.png" oninput="saveProp('screenshotPath',this.value)">
              </div>

              <div class="prop-group" id="pg-wait-and-tap" style="display:none;"> <!-- NEW -->
                <label class="prop-label">Teks yang Ditunggu *</label> <!-- NEW -->
                <input class="prop-input" id="pe-wat-text"
                  placeholder="Contoh: Menunggu Pickup"
                  oninput="saveProp('watText', this.value)"> <!-- NEW -->

                <label class="prop-label">Timeout Tunggu (ms)</label> <!-- NEW -->
                <input class="prop-input" type="number" id="pe-wat-timeout"
                  value="15000"
                  oninput="saveProp('watTimeout', +this.value)"> <!-- NEW -->

                <label class="prop-label">Interval Cek (ms)</label> <!-- NEW -->
                <input class="prop-input" type="number" id="pe-wat-interval"
                  value="2000"
                  oninput="saveProp('watInterval', +this.value)"> <!-- NEW -->

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"> <!-- NEW -->
                  <div> <!-- NEW -->
                    <label class="prop-label">Tap X (koordinat)</label> <!-- NEW -->
                    <input class="prop-input" type="number" id="pe-wat-x"
                      value="540" placeholder="540"
                      oninput="saveProp('watX', +this.value)"> <!-- NEW -->
                  </div> <!-- NEW -->
                  <div> <!-- NEW -->
                    <label class="prop-label">Tap Y (koordinat)</label> <!-- NEW -->
                    <input class="prop-input" type="number" id="pe-wat-y"
                      value="960" placeholder="960"
                      oninput="saveProp('watY', +this.value)"> <!-- NEW -->
                  </div> <!-- NEW -->
                </div> <!-- NEW -->

                <label class="prop-label">Delay Sebelum Tap (ms)</label> <!-- NEW -->
                <input class="prop-input" type="number" id="pe-wat-delay"
                  value="500"
                  oninput="saveProp('watDelay', +this.value)"> <!-- NEW -->

                <label class="prop-label">Jika Teks Tidak Muncul</label> <!-- NEW -->
                <select class="prop-input prop-select" id="pe-wat-onfail"
                  onchange="saveProp('watOnFail', this.value)"> <!-- NEW -->
                  <option value="stop">Stop Flow</option> <!-- NEW -->
                  <option value="skip">Skip & Lanjut Tap Tetap</option> <!-- NEW -->
                </select> <!-- NEW -->
              </div> <!-- NEW -->

              <!-- EXTRACT TEXT -->
              <div class="prop-group" id="pg-extract" style="display:none;">
                <label class="prop-label">CSS Selector / XPath</label>
                <input class="prop-input" id="pe-ext-sel" placeholder="e.g. .price or //span[@class='price']" oninput="saveProp('selector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Attribute (kosong = innerText)</label>
                <input class="prop-input" id="pe-ext-attr" placeholder="e.g. href, value, data-id" oninput="saveProp('attribute',this.value)">
                <label class="prop-label" style="margin-top:8px;">Regex Filter</label>
                <input class="prop-input" id="pe-ext-regex" placeholder="e.g. \\d+" oninput="saveProp('regex',this.value)">
              </div>

              <!-- IF CONDITION -->
              <div class="prop-group" id="pg-condition" style="display:none;">
                <label class="prop-label">Condition Expression</label>
                <input class="prop-input" id="pe-cond" placeholder="e.g. {price} > 100" oninput="saveProp('condition',this.value)">
                <label class="prop-label" style="margin-top:8px;">True → Step</label>
                <input class="prop-input" id="pe-true-step" placeholder="Node ID atau nama" oninput="saveProp('trueStep',this.value)">
                <label class="prop-label" style="margin-top:8px;">False → Step</label>
                <input class="prop-input" id="pe-false-step" placeholder="Node ID atau nama" oninput="saveProp('falseStep',this.value)">
              </div>

              <!-- REPEAT / LOOP -->
              <div class="prop-group" id="pg-loop" style="display:none;">
                <label class="prop-label">Repeat Count</label>
                <input class="prop-input" type="number" id="pe-loop-count" value="3" min="1" oninput="saveProp('loopCount',+this.value)">
                <label class="prop-label" style="margin-top:8px;">Loop Variable Name</label>
                <input class="prop-input" id="pe-loop-var" placeholder="i" oninput="saveProp('loopVar',this.value)">
                <label class="prop-label" style="margin-top:8px;">Break Condition</label>
                <input class="prop-input" id="pe-loop-break" placeholder="e.g. {i} >= 5" oninput="saveProp('breakCondition',this.value)">
              </div>

              <!-- API REQUEST -->
              <div class="prop-group" id="pg-api" style="display:none;">
                <label class="prop-label">URL</label>
                <input class="prop-input" id="pe-api-url" placeholder="https://api.example.com/endpoint" oninput="saveProp('apiUrl',this.value)">
                <label class="prop-label" style="margin-top:8px;">Method</label>
                <select class="prop-input prop-select" id="pe-api-method" onchange="saveProp('apiMethod',this.value)">
                  <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Headers (JSON)</label>
                <textarea class="prop-input" id="pe-api-headers" rows="2" placeholder='{"Authorization":"Bearer ..."}' oninput="saveProp('apiHeaders',this.value)"></textarea>
                <label class="prop-label" style="margin-top:8px;">Body (JSON)</label>
                <textarea class="prop-input" id="pe-api-body" rows="3" placeholder='{"key":"value"}' oninput="saveProp('apiBody',this.value)"></textarea>
              </div>

              <!-- CRON / SCHEDULER -->
              <div class="prop-group" id="pg-cron" style="display:none;">
                <label class="prop-label">Cron Expression</label>
                <input class="prop-input" id="pe-cron" placeholder="e.g. 0 9 * * 1-5" oninput="saveProp('cron',this.value)">
                <label class="prop-label" style="margin-top:8px;">Timezone</label>
                <input class="prop-input" id="pe-tz" placeholder="Asia/Jakarta" oninput="saveProp('timezone',this.value)">
              </div>

              <!-- READ/WRITE FILE -->
              <div class="prop-group" id="pg-file" style="display:none;">
                <label class="prop-label">File Path</label>
                <input class="prop-input" id="pe-filepath" placeholder="C:/data/file.csv" oninput="saveProp('filePath',this.value)">
                <label class="prop-label" style="margin-top:8px;">Delimiter (CSV)</label>
                <input class="prop-input" id="pe-delim" value="," oninput="saveProp('delimiter',this.value)">
                <label class="prop-label" style="margin-top:8px;">Encoding</label>
                <select class="prop-input prop-select" id="pe-encoding" onchange="saveProp('encoding',this.value)">
                  <option>UTF-8</option><option>ISO-8859-1</option><option>ASCII</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Skip Header Row</label>
                <select class="prop-input prop-select" id="pe-skip-hdr" onchange="saveProp('skipHeader',this.value)">
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>

              <!-- OCR -->
              <div class="prop-group" id="pg-ocr" style="display:none;">
                <label class="prop-label">Source (url / selector / screenshot)</label>
                <input class="prop-input" id="pe-ocr-src" placeholder="screenshot or https://..." oninput="saveProp('ocrSource',this.value)">
                <label class="prop-label" style="margin-top:8px;">Language</label>
                <input class="prop-input" id="pe-ocr-lang" value="eng" placeholder="eng, ind..." oninput="saveProp('ocrLang',this.value)">
              </div>

              <!-- WAIT ELEMENT -->
              <div class="prop-group" id="pg-wait" style="display:none;">
                <label class="prop-label">Selector to Wait For</label>
                <input class="prop-input" id="pe-wait-sel" placeholder=".loading-spinner" oninput="saveProp('waitSelector',this.value)">
                <label class="prop-label" style="margin-top:8px;">Wait Condition</label>
                <select class="prop-input prop-select" id="pe-wait-cond" onchange="saveProp('waitCondition',this.value)">
                  <option value="visible">Visible</option>
                  <option value="hidden">Hidden / Disappear</option>
                  <option value="clickable">Clickable</option>
                  <option value="present">Present in DOM</option>
                </select>
                <label class="prop-label" style="margin-top:8px;">Timeout (ms)</label>
                <input class="prop-input" type="number" id="pe-wait-timeout" value="10000" oninput="saveProp('waitTimeout',+this.value)">
              </div>

              <div class="prop-sep"></div>

          <div class="prop-group" id="var-panel">
            <div class="prop-title" style="justify-content:space-between;">
              <span>📦 Variables</span>
              <span id="var-count" style="font-size:11px;color:var(--dim);">(0)</span>
            </div>
            <div id="var-inspector" style="min-height:90px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--dim);font-size:11px;overflow-y:auto;"></div>
          </div>

              <!-- Quick Actions -->
              <button class="btn-full btn-run-step" onclick="runSingleStep()">▶ Run This Step</button>
              <button class="btn-full btn-draw-conn" onclick="startConnectionDraw()">🔗 Draw Connection</button>
              <button class="btn-full btn-dup" onclick="duplicateSelected()">📋 Duplicate Node</button>
              <button class="btn-full btn-delete" onclick="deleteSelected()">🗑️ Delete Node</button>
            </div>
          </div>

          <!-- Device Section -->
          <div class="dev-section">
            <div class="dev-label">Active ADB Device</div>
            <select class="dev-select" id="device-selector">
              <option>No ADB Device</option>
            </select>
            <div class="dev-actions">
              <button class="dev-btn refresh" onclick="refreshDevices()">🔄 Refresh</button>
              <button class="dev-btn scrcpy" onclick="launchScrcpy()">📱 scrcpy</button>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- RECORDER VIEW -->
    <div class="view" id="recorder">
      <div class="dash-view">
        <div class="dash-title">🎬 Macro Recorder</div>
        <div class="dash-sub">Klik pada canvas untuk merekam tap. Setiap klik akan menjadi node Tap dalam workflow.</div>
        <div style="display:flex;gap:12px;margin-bottom:20px;">
          <button class="hdr-btn primary" id="rec-start-btn" onclick="startMacroRecord()">● Start Recording</button>
          <button class="hdr-btn" id="rec-stop-btn" onclick="stopMacroRecord()" disabled>■ Stop</button>
          <button class="hdr-btn" onclick="clearRecordedSteps()">🗑 Clear</button>
          <button class="hdr-btn" onclick="saveRecordedToWorkflow()" id="rec-save-btn" disabled>💾 Save to Workflow</button>
        </div>
        <div id="rec-steps" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-height:120px;font-size:12px;color:var(--dim2);">
          Klik 'Start Recording' lalu klik pada area yang ingin direkam...
        </div>
      </div>
    </div>

    <!-- SETTINGS VIEW -->
    <div class="view" id="settings">
      <div class="settings-view">
        <div class="dash-title" style="margin-bottom:20px;">⚙️ Pengaturan</div>
        <div class="settings-grid">
          <div class="setting-card">
            <div class="setting-card-ttl">🌐 Bahasa / Language</div>
            <label class="prop-label">Language</label>
            <select class="prop-input prop-select" id="lang-sel" onchange="setLang(this.value)">
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">📱 ADB Configuration</div>
            <label class="prop-label">ADB Path (kosong = auto-detect)</label>
            <input class="prop-input" id="adb-path-input" placeholder="C:/platform-tools/adb.exe" style="margin-bottom:8px;">
            <button class="hdr-btn" onclick="saveAdbPath()" style="width:100%;margin-bottom:6px;">Save ADB Path</button>
            <button class="hdr-btn" onclick="showAdbInfo()" style="width:100%;">🔍 Check ADB Status</button>
            <div id="adb-status-msg" style="font-size:11px;color:var(--dim2);margin-top:8px;"></div>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">⚙️ Editor Preferences</div>
            <div class="toggle-row">
              <label>Auto-save workflows</label>
              <label class="toggle"><input type="checkbox" id="pref-autosave" onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Confirm on delete</label>
              <label class="toggle"><input type="checkbox" id="pref-confirm" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Snap to Grid (default)</label>
              <label class="toggle"><input type="checkbox" id="pref-snap" onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Show step numbers</label>
              <label class="toggle"><input type="checkbox" id="pref-stepnum" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
            <div class="toggle-row">
              <label>Animate connections</label>
              <label class="toggle"><input type="checkbox" id="pref-animate" checked onchange="savePref()"><span class="toggle-slider"></span></label>
            </div>
          </div>
          <div class="setting-card">
            <div class="setting-card-ttl">ℹ️ About</div>
            <div style="font-size:12px;line-height:1.8;color:var(--dim2);">
              <strong style="color:var(--text);">RBA Studio Pro</strong><br>
              Version: <strong style="color:var(--text);">2.0</strong><br>
              Developer: <strong style="color:var(--text);">Arya Septian</strong><br>
              <a href="#" onclick="ipcRenderer.send('open-external','mailto:aryaseptian1121@gmail.com')" style="color:var(--accent);">aryaseptian1121@gmail.com</a><br><br>
              <button class="hdr-btn" onclick="resetAllSettings()" style="width:100%;">🔄 Reset All Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- BARCODE GENERATOR VIEW -->
    <div class="view" id="barcode-generator">
      <div class="barcode-layout">
        <aside class="barcode-panel">
          <div class="barcode-panel-header">
            <div class="barcode-panel-title">Select Barcode Format</div>
            <button id="barcode-left-hide" class="barcode-button ghost" title="Hide formats" style="height:36px;display:flex;align-items:center;justify-content:center;padding:6px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <div class="barcode-panel-body">
            <div class="barcode-format-card active" id="barcode-custom-design" onclick="selectBarcodeFormat('custom')">
              <div class="barcode-format-card-top">
                <strong>Custom Barcode Design</strong>
                <span class="barcode-chip">Default</span>
              </div>
              <div class="barcode-mini-preview"><svg width="120" height="32" viewBox="0 0 120 32"><path d="M8 8h2v16h-2zm6 0h4v16h-4zm8 0h2v16h-2zm6 0h2v16h-2zm6 0h4v16h-4zm10 0h2v16h-2zm6 0h4v16h-4zm8 0h2v16h-2zm6 0h2v16h-2zm6 0h4v16h-4zm8 0h4v16h-4z" fill="#111827"></path></svg></div>
            </div>
            <div class="barcode-option">
              <label class="barcode-label">Search</label>
              <input id="barcode-search" type="text" placeholder="Cari tipe barcode..." oninput="renderBarcodeFormatSelector()">
            </div>
            <div id="barcode-format-list" class="barcode-category"></div>
          </div>
        </aside>

        <section class="barcode-panel">
          <div class="barcode-panel-header">
            <div class="barcode-panel-title">Barcode Values</div>
          </div>
          <div class="barcode-panel-body">
            <div class="barcode-input-row">
              <button class="barcode-button secondary" id="barcode-import-csv" type="button">📁 Import CSV</button>
              <button class="barcode-button secondary" id="barcode-create-sequence" type="button">⏭ Create sequence</button>
            </div>
            <textarea id="barcode-values-input" class="barcode-textarea" placeholder="1234567890\nABC123\n..."></textarea>
            <div class="barcode-help">Tekan Tab untuk menambahkan caption custom. Contoh: <strong>ABC123    Item A</strong> atau paste 2 kolom Excel (value + caption) lalu otomatis akan dipisah.</div>
            <div class="barcode-output-toolbar">
              <div class="barcode-button-group" style="display:flex;gap:8px;align-items:center;">
                <button class="barcode-button ghost" id="barcode-copy-output" type="button">📋 Copy</button>
                <button class="barcode-button ghost" id="barcode-print-labels" type="button">🖨 Print Labels</button>
                <button class="barcode-button ghost" id="barcode-hide-toggle" type="button" title="Hide preview">🙈</button>
                <button class="barcode-button ghost" id="barcode-play-toggle" type="button" title="Play/Pause scroll">▶</button>
                <input id="barcode-play-speed" type="number" min="10" max="1000" value="150" style="width:84px;padding:6px;border-radius:8px;border:1px solid rgba(148,163,184,0.12);background:transparent;color:var(--text);" title="Scroll speed (px/s)">
              </div>
            </div>
            <div id="barcode-preview" class="barcode-output-grid"></div>
          </div>
        </section>

        <aside class="barcode-panel">
          <div class="barcode-panel-header">
            <div class="barcode-panel-title">Options</div>
          </div>
          <div class="barcode-panel-body">
            <div class="barcode-options-wrap">
              <div class="barcode-toggle">
                <span>Show Text</span>
                <input id="barcode-show-text" type="checkbox" checked>
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Maximum Display Width (px)</label>
                <input id="barcode-max-width" type="number" value="260" min="80" max="800">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Barcode Height (px)</label>
                <input id="barcode-height" type="number" value="80" min="20" max="400">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Barcode Margin (px)</label>
                <input id="barcode-margin" type="number" value="10" min="0" max="80">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Barcode Color</label>
                <input id="barcode-color" type="color" value="#111827">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Background</label>
                <input id="barcode-bg-color" type="color" value="#ffffff">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Font Size</label>
                <input id="barcode-font-size" type="number" value="18" min="8" max="40">
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Text Alignment</label>
                <select id="barcode-text-align">
                  <option value="center">Center</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div class="barcode-option">
                <label class="barcode-label">Rotation</label>
                <input id="barcode-rotation" type="number" value="0" min="0" max="360" step="90">
              </div>
              <div class="barcode-download-wrap">
                <label class="barcode-label">Download format</label>
                <select id="barcode-download-format">
                  <option value="svg">SVG</option>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="pdf">PDF</option>
                </select>
                <button class="barcode-button primary" id="barcode-download-btn" type="button">⬇ Download</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <input id="barcode-csv-input" type="file" accept=".csv,.txt" style="display:none;">
    <div id="barcode-sequence-modal" class="barcode-sequence-modal" aria-hidden="true">
      <div class="barcode-sequence-box">
        <div class="barcode-panel-title" style="margin-bottom:12px;">Create sequence</div>
        <div class="barcode-sequence-grid">
          <div class="barcode-option"><label class="barcode-label">Prefix</label><input id="sequence-prefix" type="text" value=""></div>
          <div class="barcode-option"><label class="barcode-label">Suffix</label><input id="sequence-suffix" type="text" value=""></div>
          <div class="barcode-option"><label class="barcode-label">Start</label><input id="sequence-start" type="number" value="1"></div>
          <div class="barcode-option"><label class="barcode-label">Count</label><input id="sequence-count" type="number" value="10" min="1"></div>
          <div class="barcode-option"><label class="barcode-label">Step</label><input id="sequence-step" type="number" value="1" min="1"></div>
          <div class="barcode-option"><label class="barcode-label">Padding</label><input id="sequence-padding" type="number" value="0" min="0" max="12"></div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button type="button" class="barcode-button ghost" id="barcode-sequence-cancel">Cancel</button>
          <button type="button" class="barcode-button primary" id="barcode-sequence-apply">Apply</button>
        </div>
      </div>
    </div>

    <div id="barcode-print-view" class="barcode-print-view"></div>

  </div><!-- /.main -->
</div><!-- /.shell -->

<!-- Hidden file input -->
<input type="file" id="fileInput" accept=".json" style="display:none" onchange="handleImport(this)">

<script>
// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
const { ipcRenderer } = require('electron');

// Menu -> renderer bridge: open barcode when main process requests
ipcRenderer.on('open-barcode', () => {
  try { switchView('barcode-generator'); if (typeof initBarcodeGenerator === 'function') initBarcodeGenerator(); }
  catch(e){ console.error('Failed to open barcode from menu:', e); }
});

// ─── State ────────────────────────────────────────────────────
let project = { id: Date.now(), name: 'Untitled Flow', steps: [], edges: [] };
let currentName = 'Untitled Flow';
let workflows = [];
let selectedIdx = null;     // selected node index
let selectedEdgeId = null;  // selected edge id
let headerRenameOriginal = '';
let rowRenameId = null;
let rowRenameOriginalName = '';
let historyStack = [], redoStack = [];

// Canvas interaction state
let tx = 0, ty = 0, sc = 1;   // single transform system
let isPanning = false, panSX = 0, panSY = 0;
let isDraggingNode = false, dragNode = null, dragOX = 0, dragOY = 0;
let isDrawingEdge = false, edgeFromIdx = null;
let snapToGrid = false, miniMapOn = false;
let multiSelect = [];  // array of selected indices
let clipboard = [];

// Execution state
let stopRequested = false;
let execStats = { steps:0, errors:0, retries:0, adb:0, startTime:0, interval:null };

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
  { type:'tap',             icon:'👆', label:'Click Element',   desc:'Klik element HTML',         color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },
  { type:'type-into',       icon:'⌨️', label:'Type Into',       desc:'Ketik teks ke field',       color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'extract-text',    icon:'📄', label:'Extract Text',    desc:'Ambil teks dari element',   color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'scroll-page',     icon:'📜', label:'Scroll Page',     desc:'Scroll halaman browser',    color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'wait-element',    icon:'⏳', label:'Wait Element',    desc:'Tunggu element muncul',     color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },
  { type:'screenshot-page', icon:'📸', label:'Screenshot Page', desc:'Capture tampilan browser',  color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'extract-table',   icon:'📊', label:'Extract Table',   desc:'Scrap tabel HTML',          color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'handle-popup',    icon:'💬', label:'Handle Popup',    desc:'Dismiss/accept popup',      color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'upload-file',     icon:'📤', label:'Upload File',     desc:'Upload file via input',     color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'pagination',      icon:'📑', label:'Pagination',      desc:'Multi-page scraping',       color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'infinite-scroll', icon:'🔄', label:'Infinite Scroll', desc:'Scroll tanpa batas',        color:'#06b6d4', bg:'rgba(6,182,212,0.15)'  },

  { sec: 'Mobile (ADB)' },
  { type:'mobile-tap',      icon:'📱', label:'Mobile Tap',      desc:'ADB tap koordinat',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-swipe',    icon:'👆', label:'Mobile Swipe',    desc:'ADB swipe gesture',         color:'#a855f7', bg:'rgba(168,85,247,0.15)' },
  { type:'mobile-press-key',icon:'⌨️', label:'Press Key',       desc:'ADB input keyevent',        color:'#8b5cf6', bg:'rgba(139,92,246,0.15)' },
  { type:'mobile-screenshot',icon:'📸',label:'Mobile Screenshot',desc:'ADB screencap',            color:'#ec4899', bg:'rgba(236,72,153,0.15)' },
  { type:'mobile-find-text',icon:'🔎', label:'Find Text (OCR)', desc:'OCR pada layar HP',         color:'#14b8a6', bg:'rgba(20,184,166,0.15)' },
  { type:'open-app',        icon:'📲', label:'Open App',        desc:'Launch Android app',        color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'close-app',       icon:'❌', label:'Close App',       desc:'Force-stop app',            color:'#f43f5e', bg:'rgba(244,63,94,0.15)'  },
  { type:'read-ui-element', icon:'👁️', label:'Read UI Element', desc:'Baca teks dari UI',         color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'swipe',           icon:'👈', label:'Swipe (PC)',      desc:'PC mouse swipe/drag',       color:'#f59e0b', bg:'rgba(245,158,11,0.15)' },

  { sec: 'Data & Files' },
  { type:'read-csv',        icon:'📊', label:'Read CSV',        desc:'Baca file CSV',             color:'#3b82f6', bg:'rgba(59,130,246,0.15)' },
  { type:'write-csv',       icon:'📝', label:'Write CSV',       desc:'Tulis data ke CSV',         color:'#10b981', bg:'rgba(16,185,129,0.15)' },
  { type:'write-excel',     icon:'📗', label:'Write Excel',     desc:'Output ke .xlsx',           color:'#16a34a', bg:'rgba(22,163,74,0.15)'  },
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
function interpolate(str) {
  if (!str) return str;
  return String(str).replace(/\{(\w+)\}/g, (_, key) => (varStore[key] !== undefined ? varStore[key] : '{' + key + '}'));
}

function storeVar(key, value) {
  if (!key) return;
  varStore[key] = value;
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
  el.innerHTML = entries.map(([k,v]) =>
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:6px 0;border-bottom:1px solid var(--border2);">' +
      '<span style="color:#93c5fd;font-weight:600;">{' + k + '}</span>' +
      '<span style="color:var(--dim2);max-width:100px;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:right;">' + String(v).substring(0,40) + '</span>' +
    '</div>'
  ).join('');
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
  updateProjName(); render(); switchView('editor');
  addLog('Template loaded: ' + tpl.name, 'success');
}

// ─── Keyboard Help Modal ───────────────────────────────────
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
  for (const a of ACTIVITIES) {
    if (a.sec) {
      html += \'<div class="sec">\' + a.sec + '</div>\';
      continue;
    }
    html += \'<button class="tool-card" draggable="true"
      ondragstart="toolDragStart(event, '\' + a.type + '')"
      onclick="addNode('\' + a.type + '')"
      data-type="\' + a.type + '" data-label="\' + a.label + ' \' + a.desc + '">
      <div class="tc-ico" style="background:\' + a.bg + ';color:\' + a.color + '">\' + a.icon + '</div>
      <div class="tc-lbl"><strong>\' + a.label + '</strong><span>\' + a.desc + '</span></div>
    </button>\';
  }
  list.innerHTML = html;
})();

function filterTools(q) {
  document.querySelectorAll('.tool-card').forEach(c => {
    c.style.display = c.dataset.label.toLowerCase().includes(q.toLowerCase()) ? 'flex' : 'none';
  });
}

// ─── History ──────────────────────────────────────────────────
function pushHistory() {
  historyStack.push(JSON.stringify({steps:project.steps, edges:project.edges}));
  if (historyStack.length > 60) historyStack.shift();
  redoStack = [];
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
function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-ico').forEach(n => n.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  const map = { dashboard:'nav-dash', editor:'nav-edit', recorder:'nav-rec', settings:'nav-set', 'barcode-generator':'nav-barcode' };
  if (map[id]) {
    const nav = document.getElementById(map[id]);
    if (nav) nav.classList.add('active');
  }
  // also mark the hot barcode nav visible/active if present
  if (id === 'barcode-generator') {
    const hot = document.getElementById('nav-barcode-hot'); if (hot) hot.classList.add('active');
    const sidebarItem = document.getElementById('sidebar-barcode-item'); if (sidebarItem) sidebarItem.classList.add('active');
  }
}

// ─── Project Name ─────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function updateProjName() {
  const el = document.getElementById('proj-name');
  if (!el || el.dataset.editing === 'true') return;
  el.textContent = currentName + ' ✏️';
}

function flashElement(el, color) {
  if (!el) return;
  const previous = el.style.borderColor || '';
  el.style.borderColor = color;
  setTimeout(() => { el.style.borderColor = previous || 'var(--border2)'; }, 300);
}

function enterHeaderRename() {
  const el = document.getElementById('proj-name');
  if (!el || el.dataset.editing === 'true') return;
  el.dataset.editing = 'true';
  headerRenameOriginal = currentName;
  el.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'proj-name-input';
  input.className = 'hdr-project-input';
  input.value = currentName;
  input.maxLength = 50;
  input.autocomplete = 'off';
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finishHeaderRename(true); }
    if (e.key === 'Escape') { e.preventDefault(); finishHeaderRename(false); }
  };
  input.onblur = () => finishHeaderRename(true);
  el.appendChild(input);
  input.focus();
  input.select();
}

function finishHeaderRename(save) {
  const el = document.getElementById('proj-name');
  if (!el || el.dataset.editing !== 'true') return;
  const input = document.getElementById('proj-name-input');
  el.dataset.editing = 'false';
  if (!input) { updateProjName(); return; }
  const value = String(input.value || '').trim();
  if (save && value) {
    currentName = value.substring(0, 50);
    project.name = currentName;
    updateProjName();
    saveCurrentProject();
    flashElement(el, '#22c55e');
    return;
  }
  currentName = headerRenameOriginal;
  updateProjName();
  if (save && !value) flashElement(el, '#ef4444');
}

function renameProject() {
  enterHeaderRename();
}

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
    watText:'',
    watTimeout:15000,
    watInterval:2000,
    watX:540,
    watY:960,
    watDelay:500,
    watOnFail:'stop',
    ocrSource:'screenshot', ocrLang:'eng', browser:'default', browserMode:'normal', waitAfterLoad:2000,
    trueStep:'', falseStep:'',
    status:''
  };
  project.steps.push(step);
  // Auto-connect to previous node
  if (project.steps.length >= 2) {
    const prev = project.steps[project.steps.length - 2];
    project.edges.push({ id: 'e-'+Date.now(), from: prev.id, to: step.id, label: '' });
  }
  render();
  selectNode(project.steps.length - 1);
  addLog('Added: ' + def.label, 'info');
}

// ─── Node Selection & Properties ─────────────────────────────
function selectNode(idx) {
  selectedIdx = idx;
  multiSelect = [idx];
  render();
  if (idx === null || idx < 0 || idx >= project.steps.length) { showPropEmpty(); return; }
  showProp(project.steps[idx]);
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
  'swipe':['pg-swipe'],
  'mobile-tap':['pg-mobile'], 'mobile-swipe':['pg-mobile','pg-swipe'],
  'mobile-press-key':['pg-mobile'], 'mobile-screenshot':['pg-mobile'],
  'mobile-find-text':['pg-mobile'], 'wait-and-tap':['pg-device','pg-wait-and-tap'],
  'open-app':['pg-mobile'], 'close-app':['pg-mobile'],
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
};

function showProp(s) {
  document.getElementById('prop-empty').style.display = 'none';
  document.getElementById('prop-editor').style.display = 'block';
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
  document.getElementById('pe-mx').value = s.mx ?? 0;
  document.getElementById('pe-my').value = s.my ?? 0;
  document.getElementById('pe-device-id').value = s.deviceId ?? '';
  document.getElementById('pe-keycode').value = s.keyCode ?? '';
  document.getElementById('pe-screenshot-path').value = s.screenshotPath ?? '/sdcard/screen.png';
  // Extract
  document.getElementById('pe-ext-sel').value = s.selector ?? '';
  document.getElementById('pe-ext-attr').value = s.attribute ?? '';
  document.getElementById('pe-ext-regex').value = s.regex ?? '';
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
  // OCR
  document.getElementById('pe-ocr-src').value = s.ocrSource ?? 'screenshot';
  document.getElementById('pe-ocr-lang').value = s.ocrLang ?? 'eng';
  // Wait element
  document.getElementById('pe-wait-sel').value = s.waitSelector ?? '';
  document.getElementById('pe-wait-cond').value = s.waitCondition ?? 'visible';
  document.getElementById('pe-wait-timeout').value = s.waitTimeout ?? 10000;
  if (document.getElementById('pe-wat-text'))
    document.getElementById('pe-wat-text').value    = s.watText    ?? '';
  if (document.getElementById('pe-wat-timeout'))
    document.getElementById('pe-wat-timeout').value = s.watTimeout ?? 15000;
  if (document.getElementById('pe-wat-interval'))
    document.getElementById('pe-wat-interval').value= s.watInterval?? 2000;
  if (document.getElementById('pe-wat-x'))
    document.getElementById('pe-wat-x').value       = s.watX       ?? 540;
  if (document.getElementById('pe-wat-y'))
    document.getElementById('pe-wat-y').value       = s.watY       ?? 960;
  if (document.getElementById('pe-wat-delay'))
    document.getElementById('pe-wat-delay').value   = s.watDelay   ?? 500;
  if (document.getElementById('pe-wat-onfail'))
    document.getElementById('pe-wat-onfail').value  = s.watOnFail  ?? 'stop';

  // Show/hide groups
  const allGroups = ['pg-tap','pg-type','pg-browser','pg-swipe','pg-mobile','pg-extract',
                     'pg-condition','pg-loop','pg-api','pg-cron','pg-file','pg-ocr','pg-wait','pg-wait-and-tap'];
  allGroups.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='none'; });
  const show = PROP_GROUPS[s.type] || [];
  show.forEach(g => { const el = document.getElementById(g); if(el) el.style.display='block'; });
}

function saveProp(key, val) {
  if (selectedIdx === null) return;
  const s = project.steps[selectedIdx];
  if (!s) return;
  s[key] = val;
  // Sync name display
  if (key === 'name') {
    render();
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

  const NODE_W = 200, NODE_H = 60;

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
    const dx = ex - sx, dy = ey - sy;
    const cpOff = Math.max(60, Math.abs(dx) * 0.45);
    const cp1x = sx + cpOff, cp1y = sy;
    const cp2x = ex - cpOff, cp2y = ey;
    const d = \'M\' + sx + ',\' + sy + ' C\' + cp1x + ',\' + cp1y + ' \' + cp2x + ',\' + cp2y + ' \' + ex + ',\' + ey + '\';

    const def = getActivityDef(fromNode.type);
    const isActive = fromNode.status === 'running' && prefs.animate;
    const isSelEdge = edge.id === selectedEdgeId;

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', isSelEdge ? '#60a5fa' : def.color);
    path.setAttribute('stroke-width', isSelEdge ? '3' : '2');
    path.setAttribute('fill','none');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('marker-end', 'url(#arr-default)');
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

    // Junction dots
    [[sx,sy],[ex,ey]].forEach(([cx,cy]) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx',cx); dot.setAttribute('cy',cy); dot.setAttribute('r','3.5');
      dot.setAttribute('fill', def.color); dot.setAttribute('opacity','0.7');
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

    div.innerHTML =
      (prefs.showStepNum ? \'<div class="node-step-num">\' + i+1 + '</div>\' : '') +
      \'<div class="node-ico" style="background:\' + def.bg + ';color:\' + def.color + '">\' + def.icon + '</div>\' +
      \'<div class="node-body">
         <div class="node-lbl">\' + s.name + '</div>
         <div class="node-type">\' + s.type + '</div>
         \' + s.status==='running' ? '<div style="font-size:9px;color:var(--yellow);margin-top:2px;">⏳ running...</div>' : '' + '
         \' + s.status==='success' ? '<div style="font-size:9px;color:var(--green);margin-top:2px;">✓ done</div>' : '' + '
         \' + s.status==='error'   ? '<div style="font-size:9px;color:var(--red);margin-top:2px;">✗ error</div>'   : '' + '
       </div>\' +
      \'<div class="node-port out" title="Drag to connect" onmousedown="portDragStart(event,\' + i + ')"></div>\' +
      \'<div class="node-port in"  title="Input port"></div>\' +
      \'<div class="node-status-bar"></div>\';

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
  wrapperEl.style.transform = \'translate(\' + tx + 'px, \' + ty + 'px) scale(\' + sc + ')\';
  document.getElementById('zoom-badge').textContent = Math.round(sc*100)+'%';
  updateMiniMap();
}

canvasEl.addEventListener('mousedown', e => {
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
    tl.setAttribute('d', \'M\' + sx + ',\' + sy + ' C\' + sx+80 + ',\' + sy + ' \' + mx-80 + ',\' + my + ' \' + mx + ',\' + my + '\');
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
        addLog(\'Connected: \' + from.name + ' → \' + to.name + '\', 'info');
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
  const scX = rect.width  / (maxX-minX);
  const scY = rect.height / (maxY-minY);
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
  menu.style.left = x+'px'; menu.style.top = y+'px';
  menu.innerHTML = \'
    <div class="ctx-sub">\' + def.icon + ' \' + s.name + '</div>
    <div class="ctx-item" onclick="duplicateSelected();closeCtxMenu()"><span class="ctx-ico">📋</span> Duplicate</div>
    <div class="ctx-item" onclick="copySelected();closeCtxMenu()"><span class="ctx-ico">📄</span> Copy</div>
    <div class="ctx-item" onclick="pasteNodes();closeCtxMenu()"><span class="ctx-ico">📌</span> Paste After</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="renameNodeInline(\' + idx + ');closeCtxMenu()"><span class="ctx-ico">✏️</span> Rename</div>
    <div class="ctx-item" onclick="changeNodeType(\' + idx + ');closeCtxMenu()"><span class="ctx-ico">🔄</span> Change Type</div>
    <div class="ctx-item" onclick="runSingleStep();closeCtxMenu()"><span class="ctx-ico">▶</span> Run This Step</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="moveNodeUp(\' + idx + ');closeCtxMenu()"><span class="ctx-ico">⬆</span> Move Up</div>
    <div class="ctx-item" onclick="moveNodeDown(\' + idx + ');closeCtxMenu()"><span class="ctx-ico">⬇</span> Move Down</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="breakEdgesFrom(\' + idx + ');closeCtxMenu()"><span class="ctx-ico">✂️</span> Break Connections</div>
    <div class="ctx-item danger" onclick="deleteSelected();closeCtxMenu()"><span class="ctx-ico">🗑</span> Delete Node</div>
  \';
  document.body.appendChild(menu);
  // Auto-close
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}
function showEdgeCtxMenu(x,y,edgeId) {
  closeCtxMenu();
  const edge = (project.edges||[]).find(e=>e.id===edgeId);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left=x+'px'; menu.style.top=y+'px';
  menu.innerHTML = \'
    <div class="ctx-sub">Connection</div>
    <div class="ctx-item" onclick="labelEdge('\' + edgeId + '');closeCtxMenu()"><span class="ctx-ico">✏️</span> Add Label</div>
    <div class="ctx-item" onclick="reverseEdge('\' + edgeId + '');closeCtxMenu()"><span class="ctx-ico">🔄</span> Reverse Direction</div>
    <div class="ctx-item danger" onclick="deleteEdge('\' + edgeId + '');closeCtxMenu()"><span class="ctx-ico">🗑</span> Delete Connection</div>
  \';
  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('click', closeCtxMenu, {once:true}), 0);
}

function renameNodeInline(idx) { const s=project.steps[idx]; const n=prompt('Rename:',s.name); if(n) { s.name=n; render(); showProp(s); } }
function changeNodeType(idx) {
  const types = ACTIVITIES.filter(a=>a.type).map(a=>a.type);
  const t = prompt('New type:\\n'+types.slice(0,30).join(', '), project.steps[idx].type);
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

// ─── Export / Import ──────────────────────────────────────────
function exportWorkflow() {
  const data = JSON.stringify(project, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download = (currentName||'workflow')+'.json';
  a.click(); URL.revokeObjectURL(url);
  addLog('Exported: '+currentName, 'info');
}
function handleImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      project = {
        id: Date.now(), name: file.name.replace('.json',''),
        steps: (data.steps||data.nodes||[]).map(n => ({
          id: n.id||Date.now()+Math.random(), name: n.name||n.data?.label||'Step',
          type: String(n.type||n.data?.type||'tap').toLowerCase(),
          x: n.x||n.position?.x||0, y: n.y||n.position?.y||0,
          delay:n.delay||500, var:n.var||'', comment:n.comment||'',
          status:'', ...n
        })),
        edges: data.edges||[]
      };
      currentName = project.name;
      updateProjName();
      autoLayout(); render();
      switchView('editor');
      addLog('Imported: '+file.name, 'info');
    } catch(err) { alert('Error parsing JSON: '+err.message); }
  };
  reader.readAsText(file);
  input.value = '';
}

// ─── Save / Load Projects ─────────────────────────────────────
async function saveCurrentProject() {
  if (!project.steps.length) { addLog('Tambahkan minimal 1 step sebelum save', 'warn'); return; }
  project.name = currentName;
  project.id = project.id || Date.now();
  const list = await ipcRenderer.invoke('save-workflow', {
    ...project, updatedAt: new Date().toISOString()
  });
  workflows = list;
  renderSavedList();
  addLog('Saved: '+currentName, 'success');
}
async function loadSavedProjects() {
  workflows = await ipcRenderer.invoke('get-saved-workflows');
  renderSavedList();
}
function handleRowRenameKey(e, id) {
  if (e.key === 'Enter') { e.preventDefault(); saveRowRename(id); }
  if (e.key === 'Escape') { e.preventDefault(); cancelRowRename(); }
}
function handleRowRenameBlur(e, id) {
  const next = e.relatedTarget;
  if (next && next.classList && next.classList.contains('wf-item-btn')) return;
  saveRowRename(id);
}
async function saveRowRename(id) {
  const wf = workflows.find(i => i.id === id);
  const input = document.getElementById('wf-edit-input-' + id);
  rowRenameId = null;
  if (!wf || !input) { renderSavedList(); return; }
  const value = String(input.value || '').trim();
  if (!value) { renderSavedList(); return; }
  wf.name = value.substring(0, 50);
  const list = await ipcRenderer.invoke('save-workflow', {
    ...wf,
    updatedAt: new Date().toISOString()
  });
  workflows = list;
  renderSavedList();
  flashElement(document.getElementById('wf-row-' + id), '#22c55e');
}
function cancelRowRename() {
  rowRenameId = null;
  renderSavedList();
}
function startRowRename(id) {
  const wf = workflows.find(i => i.id === id);
  if (!wf) return;
  rowRenameId = id;
  rowRenameOriginalName = wf.name;
  renderSavedList();
  setTimeout(() => {
    const input = document.getElementById('wf-edit-input-' + id);
    if (input) { input.focus(); input.select(); }
  }, 0);
}
function renderSavedList() {
  const el = document.getElementById('wf-list');
  if (!el) return;
  if (!workflows.length) {
    el.innerHTML = '<div style="color:var(--dim);text-align:center;padding:24px;font-size:12px;">Belum ada workflow tersimpan</div>';
    return;
  }
  el.innerHTML = workflows.map(wf => {
    const editing = rowRenameId === wf.id;
    const rowName = escapeHtml(wf.name || 'Untitled Flow');
    return '\n    <div class="wf-item" id="wf-row-' + wf.id + '">\n      <div class="wf-item-ico">⚡</div>\n      <div class="wf-item-body">\n        ' + (editing ?
      '<input id="wf-edit-input-' + wf.id + '" class="wf-item-edit-input" value="' + rowName + '" maxlength="50" onkeydown="handleRowRenameKey(event,' + JSON.stringify(wf.id) + ')" onblur="handleRowRenameBlur(event,' + JSON.stringify(wf.id) + ')">' :
      '<div class="wf-item-name">' + rowName + '</div>') +
      '<div class="wf-item-meta">' + (wf.steps||[]).length + ' steps · ' + new Date(wf.updatedAt||Date.now()).toLocaleString() + '</div>\n      </div>\n      <div class="wf-item-actions">\n        <button class="wf-item-btn open" onclick="openProject(' + JSON.stringify(wf.id) + ')">Open</button>\n        ' + (editing ?
      '<button class="wf-item-btn save" onclick="saveRowRename(' + JSON.stringify(wf.id) + ')">Save</button>' +
      '<button class="wf-item-btn cancel" onclick="cancelRowRename()">Cancel</button>' :
      '<button class="wf-item-btn rename" onclick="startRowRename(' + JSON.stringify(wf.id) + ')">Rename</button>' +
      '<button class="wf-item-btn del" onclick="deleteProject(' + JSON.stringify(wf.id) + ')">Del</button>') +
    '\n      </div>\n    </div>\n';
  }).join('');
}
async function openProject(id) {
  const wf = await ipcRenderer.invoke('load-workflow', id);
  if (!wf) return;
  project = { id:wf.id, name:wf.name, steps:wf.steps||[], edges:wf.edges||[] };
  currentName = wf.name;
  updateProjName(); autoLayout(); render();
  switchView('editor');
  addLog('Opened: '+wf.name, 'info');
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
  project = { id:Date.now(), name:'New Flow', steps:[
    { id:1, name:'Start', type:'start', x:120, y:120, delay:0, var:'', comment:'', status:'' }
  ], edges:[] };
  currentName = 'New Flow';
  updateProjName(); render();
  switchView('editor');
  addLog('New workflow created', 'info');
}

// ─── ADB & Devices ────────────────────────────────────────────
function refreshDevices() {
  ipcRenderer.send('get-devices');
  addLog('Refreshing ADB devices...', 'info');
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
ipcRenderer.on('device-list', (e, list) => {
  const sel = document.getElementById('device-selector');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = list.length ?
    list.map(d=>\'<option>\' + d + '</option>\').join('') :
    '<option>No ADB Device</option>';
  if (list.includes(prev)) sel.value = prev;
  const statusEl = document.getElementById('bot-status');
});
setInterval(() => { if(typeof ipcRenderer !== 'undefined') ipcRenderer.send('get-devices'); }, 5000);

// ─── EXECUTION ENGINE ─────────────────────────────────────────
async function runAdb(device, args) {
  execStats.adb++;
  document.getElementById('st-adb').textContent = execStats.adb;
  return await ipcRenderer.invoke('run-adb', { device, args });
}

// ─── Variable Interpolation ───────────────────────────────────
function interpolate(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return varStore[key] !== undefined ? String(varStore[key]) : match;
  });
}

async function runWorkflow() {
  if (!project.steps.length) { addLog('Tidak ada steps! Buat workflow dulu.', 'warn'); return; }
  const runBtn  = document.getElementById('run-flow-btn');
  const stopBtn = document.getElementById('stop-flow-btn');
  const tbRun   = document.getElementById('tb-run-btn');
  const status  = document.getElementById('bot-status');

  stopRequested = false;
  execStats = { steps:0, errors:0, retries:0, adb:0, startTime:Date.now(), interval:null };
  execStats.interval = setInterval(updateRuntime, 500);

  runBtn.disabled = true; stopBtn.disabled = false;
  runBtn.textContent = '⏳ Running...';
  if (tbRun) { tbRun.textContent = '⏳ Running...'; tbRun.disabled=true; }
  status.className = 'hdr-badge online';
  status.innerHTML = '<div class="hdr-dot"></div>ONLINE';

  const device = document.getElementById('device-selector').value;
  addLog('=== Workflow Start ===', 'info');

  // ══════════════════════════════════════════════════
  // MAIN EXECUTION LOOP WITH RETRY LOGIC
  // ══════════════════════════════════════════════════
  let i = 0;
  while (i < project.steps.length) {
    if (stopRequested) { addLog('⛔ STOP requested', 'warn'); break; }

    const s = project.steps[i];
    const type = s.type;
    const stepDevice = device;

    // ── RETRY LOGIC ────────────────────────────────────────
    if (!retryState[s.id]) retryState[s.id] = { count: 0, maxRetry: parseInt(s.maxRetries) || 0, delay: parseInt(s.retryDelay) || 1000 };
    const retry = retryState[s.id];

    try {
      execStats.steps++;
      document.getElementById('st-steps').textContent = execStats.steps;

      switch(type) {

        // ══════════════════════════════════════════════════
        // TIMING & CONTROL
        // ══════════════════════════════════════════════════
        case 'start':
          addLog('Step ' + (i+1) + ': 🟢 START', 'info');
          break;

        case 'delay': {
          const ms = parseInt(s.delay) || 1000;
          addLog('Step ' + (i+1) + ': ⏱ Delay ' + ms + 'ms', 'info');
          await wait(ms);
          addLog('  Delay selesai', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — TAP
        // ══════════════════════════════════════════════════
        case 'mobile-tap': {
          const useSmartTap = (s.matchMode && s.matchMode !== 'COORDINATE') || s.templateImageBase64 || s.targetText || s.referenceImageBase64;
          if (useSmartTap) {
            try {
              const context = {
                activeDevice: stepDevice,
                deviceId: stepDevice,
                log: (msg, level = 'info') => addLog('Step ' + (i+1) + ': ' + msg, level)
              };
              const result = await executeSmartMobileTap(project.steps[i], context);
              addLog('Step ' + (i+1) + ': ✅ Smart Mobile Tap completed via ' + result.method, 'success');
            } catch (err) {
              throw new Error('Smart Mobile Tap failed: ' + err.message);
            }
            break;
          }

          const x = parseInt(s.mx) || 0;
          const y = parseInt(s.my) || 0;
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB terpilih');
          addLog('Step ' + (i+1) + ': 📱 ADB Tap (' + x + ', ' + y + ')', 'info');
          const r = await runAdb(stepDevice, 'shell input tap ' + x + ' ' + y);
          if (!r.success) throw new Error('ADB tap gagal: ' + r.error);
          addLog('  Tap berhasil', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — SMART TAP (Enhanced with visual matching)
        // ══════════════════════════════════════════════════
        case 'mobile-tap-enhanced':
        case 'smart-mobile-tap': {
          try {
            const context = {
              activeDevice: stepDevice,
              deviceId: stepDevice,
              log: (msg, level = 'info') => addLog('Step ' + (i+1) + ': ' + msg, level)
            };
            const result = await executeSmartMobileTap(project.steps[i], context);
            addLog('Step ' + (i+1) + ': ✅ Smart Mobile Tap completed via ' + result.method, 'success');
          } catch (err) {
            throw new Error('Smart Mobile Tap failed: ' + err.message);
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — WAIT & TAP (Wait for element, then tap)
        // ══════════════════════════════════════════════════
        case 'wait-and-tap':
        case 'wait_and_tap': {
          try {
            const context = {
              activeDevice: stepDevice,
              deviceId: stepDevice,
              log: (msg, level = 'info') => addLog('Step ' + (i+1) + ': ' + msg, level)
            };
            const result = await executeWaitAndTap(project.steps[i], context);
            addLog('Step ' + (i+1) + ': ✅ Wait & Tap completed via ' + result.method, 'success');
          } catch (err) {
            throw new Error('Wait & Tap failed: ' + err.message);
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — SWIPE
        // ══════════════════════════════════════════════════
        case 'mobile-swipe': {
          const sx = parseInt(s.sx) || 0;
          const sy = parseInt(s.sy) || 0;
          const ex = parseInt(s.ex) || 0;
          const ey = parseInt(s.ey) || 0;
          const dur = parseInt(s.dur) || 300;
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB terpilih');
          addLog('Step ' + (i+1) + ': 📱 ADB Swipe (' + sx + ',' + sy + ')→(' + ex + ',' + ey + ') ' + dur + 'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe ' + sx + ' ' + sy + ' ' + ex + ' ' + ey + ' ' + dur);
          if (!r.success) throw new Error('ADB swipe gagal: ' + r.error);
          addLog('  Swipe berhasil', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — SWIPE ARAH (scroll-page & swipe PC)
        // ══════════════════════════════════════════════════
        case 'swipe':
        case 'scroll-page': {
          if (!stepDevice || stepDevice === 'No ADB Device') {
            addLog('Step ' + (i+1) + ': Tidak ada device, skip swipe', 'warn');
            await wait(300);
            break;
          }
          const dirMap = { up: '540 1500 540 500', down: '540 500 540 1500', left: '1000 800 200 800', right: '200 800 1000 800' };
          const coords = dirMap[s.dir || 'down'] || dirMap['down'];
          const swipeDur = parseInt(s.dur) || 500;
          addLog('Step ' + (i+1) + ': Swipe ' + (s.dir || 'down') + ' (' + coords + ') ' + swipeDur + 'ms', 'info');
          const r = await runAdb(stepDevice, 'shell input swipe ' + coords + ' ' + swipeDur);
          if (!r.success) throw new Error('Swipe gagal: ' + r.error);
          addLog('  Swipe berhasil', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — PRESS KEY
        // ══════════════════════════════════════════════════
        case 'mobile-press-key': {
          const keyCode = s.keyCode || '4'; // Default: Back button
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          addLog('Step ' + (i+1) + ': ⌨️ ADB Keyevent ' + keyCode + ' (3=Home,4=Back,24=Vol+,25=Vol-,26=Power)', 'info');
          const r = await runAdb(stepDevice, 'shell input keyevent ' + keyCode);
          if (!r.success) throw new Error('Keyevent gagal: ' + r.error);
          addLog('  Keyevent berhasil', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — TYPE TEXT (input teks ke HP via ADB)
        // ══════════════════════════════════════════════════
        case 'type-into': {
          if (!stepDevice || stepDevice === 'No ADB Device') {
            addLog('Step ' + (i+1) + ': [Browser mode] Type into ' + (s.selector || 'field') + ': "' + ((s.text || '').substring(0, 30)) + '..."', 'info');
            await wait(Math.max(200, (s.text || '').length * (s.typeSpeed || 30)));
            break;
          }
          // ADB mode: tap dulu ke koordinat (jika ada), lalu ketik
          const textToType = interpolate(s.text || '');
          if (s.cx && s.cy) {
            addLog('  ADB Tap ke field (' + s.cx + ',' + s.cy + ')', 'info');
            await runAdb(stepDevice, 'shell input tap ' + s.cx + ' ' + s.cy);
            await wait(500);
          }
          if (s.clearBefore === 'yes') {
            // Select all + delete
            await runAdb(stepDevice, 'shell input keyevent --longpress 29'); // Ctrl+A workaround
            await runAdb(stepDevice, 'shell input keyevent 67'); // DEL
            await wait(200);
          }
          // Escape special chars untuk ADB input text
          const escaped = textToType.replace(/ /g, '%s').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/&/g, '\\&').replace(/</g, '\\<').replace(/>/g, '\\>');
          addLog('  ADB input text: "' + textToType.substring(0, 30) + '..."', 'info');
          const r = await runAdb(stepDevice, 'shell input text "' + escaped + '"');
          if (!r.success) throw new Error('Input text gagal: ' + r.error);
          await wait((textToType.length * (parseInt(s.typeSpeed) || 30)));
          addLog('  Teks berhasil diketik', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — SCREENSHOT (FIXED: pull ke folder kerja)
        // ══════════════════════════════════════════════════
        case 'mobile-screenshot': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const devicePath = s.screenshotPath || '/sdcard/rba_screen_' + Date.now() + '.png';
          const localFileName = 'screenshot_' + Date.now() + '.png';
          // Simpan di folder yang sama dengan app atau Documents
          const localPath = require('path').join(require('os').homedir(), 'Documents', localFileName);

          addLog('Step ' + (i+1) + ': Mengambil screenshot...', 'info');
          const r1 = await runAdb(stepDevice, 'shell screencap -p ' + devicePath);
          if (!r1.success) throw new Error('screencap gagal: ' + r1.error);

          addLog('  Menarik file dari device ke: ' + localPath, 'info');
          const r2 = await runAdb(stepDevice, 'pull ' + devicePath + ' "' + localPath + '"');
          if (!r2.success) throw new Error('pull gagal: ' + r2.error);

          // Hapus file dari device setelah berhasil pull
          await runAdb(stepDevice, 'shell rm ' + devicePath);

          // Simpan path ke variable jika ada output var
          if (s.var) storeVar(s.var, localPath);

          addLog('  Screenshot tersimpan: ' + localPath, 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — READ UI ELEMENT (FIXED: parse XML dump)
        // ══════════════════════════════════════════════════
        case 'read-ui-element':
        case 'mobile-find-text': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const localXmlPath = require('path').join(require('os').homedir(), 'Documents', 'ui_dump_' + Date.now() + '.xml');

          addLog('Step ' + (i+1) + ': Dump UI hierarchy dari device...', 'info');
          const r1 = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump_rba.xml');
          if (!r1.success) throw new Error('uiautomator dump gagal: ' + r1.error);

          await wait(500); // tunggu file selesai ditulis

          addLog('  Pull XML ke lokal...', 'info');
          const r2 = await runAdb(stepDevice, 'pull /sdcard/ui_dump_rba.xml "' + localXmlPath + '"');
          if (!r2.success) throw new Error('pull XML gagal: ' + r2.error);

          // Baca dan parse XML
          const fs = require('fs');
          if (fs.existsSync(localXmlPath)) {
            const xmlContent = fs.readFileSync(localXmlPath, 'utf8');

            // Cari teks yang diminta
            const searchText = interpolate(s.selector || s.text || '');
            let foundText = '';
            let foundBounds = '';

            if (searchText) {
              // Cari elemen berdasarkan text atau resource-id
              const escapedSearch = searchText.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
              const textMatch = xmlContent.match(new RegExp('text="([^"]*' + escapedSearch + '[^"]*)"', 'i'));
              const idMatch = xmlContent.match(new RegExp('resource-id="([^"]*' + escapedSearch + '[^"]*)"', 'i'));

              if (textMatch) {
                foundText = textMatch[1];
                // Ambil bounds dari elemen yang sama
                const boundsMatch = xmlContent.substring(xmlContent.lastIndexOf('<', xmlContent.indexOf(textMatch[0]))).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
                if (boundsMatch) {
                  const cx = Math.round((parseInt(boundsMatch[1]) + parseInt(boundsMatch[3])) / 2);
                  const cy = Math.round((parseInt(boundsMatch[2]) + parseInt(boundsMatch[4])) / 2);
                  foundBounds = cx + ',' + cy;
                  addLog('  Elemen ditemukan: "' + foundText + '" di (' + foundBounds + ')', 'success');
                }
              } else if (idMatch) {
                foundText = idMatch[1];
                addLog('  Element ID ditemukan: ' + foundText, 'success');
              } else {
                addLog('  Teks "' + searchText + '" tidak ditemukan di UI', 'warn');
              }
            } else {
              // Tidak ada search, ambil semua teks
              const allTexts = [];
              const textRegex = /text="([^"]+)"/g;
              let match;
              while ((match = textRegex.exec(xmlContent)) !== null && allTexts.length < 20) {
                if (match[1].trim()) allTexts.push(match[1]);
              }
              foundText = allTexts.join(', ');
              addLog('  UI texts: ' + foundText.substring(0, 100), 'info');
            }

            if (s.var && foundText) storeVar(s.var, foundText);

            // Bersihkan file temp
            try { fs.unlinkSync(localXmlPath); } catch(e) {}
            await runAdb(stepDevice, 'shell rm /sdcard/ui_dump_rba.xml');
          } else {
            throw new Error('File XML dump tidak ditemukan di: ' + localXmlPath);
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — OPEN APP
        // ══════════════════════════════════════════════════
        case 'open-app': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const pkgName = s.var || s.text || '';
          if (!pkgName) throw new Error('Package name kosong. Isi Output Variable dengan package name (e.g. com.whatsapp)');
          addLog('Step ' + (i+1) + ': Membuka app: ' + pkgName, 'info');
          const r = await runAdb(stepDevice, 'shell monkey -p ' + pkgName + ' -c android.intent.category.LAUNCHER 1');
          if (!r.success) throw new Error('Gagal buka app: ' + r.error);
          await wait(2000); // Tunggu app terbuka
          addLog('  App terbuka: ' + pkgName, 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // MOBILE ADB — CLOSE APP
        // ══════════════════════════════════════════════════
        case 'close-app': {
          if (!stepDevice || stepDevice === 'No ADB Device') throw new Error('Tidak ada device ADB');
          const pkgName = s.var || s.text || '';
          if (!pkgName) throw new Error('Package name kosong');
          addLog('Step ' + (i+1) + ': Force-stop: ' + pkgName, 'info');
          const r = await runAdb(stepDevice, 'shell am force-stop ' + pkgName);
          if (!r.success) throw new Error('Gagal stop app: ' + r.error);
          addLog('  App dihentikan', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // BROWSER — OPEN URL
        // ══════════════════════════════════════════════════
        case 'open-browser': {
          const url = interpolate(s.url || 'https://example.com');
          addLog('Step ' + (i+1) + ': Membuka browser: ' + url, 'info');
          // Di Electron, gunakan shell.openExternal untuk buka browser default
          ipcRenderer.send('open-external', url);
          const waitTime = parseInt(s.waitAfterLoad) || 2000;
          await wait(waitTime);
          addLog('  Browser dibuka (menunggu ' + waitTime + 'ms)', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // BROWSER — CLICK / TAP ELEMENT
        // ══════════════════════════════════════════════════
        case 'tap':
        case 'click': {
          addLog('Step ' + (i+1) + ': Click [' + (s.selector || '(' + s.cx + ',' + s.cy + ')') + '] type=' + (s.clickType || 'single'), 'info');
          // Jika ada device ADB dan koordinat, gunakan ADB tap
          if (stepDevice && stepDevice !== 'No ADB Device' && s.cx && s.cy) {
            const r = await runAdb(stepDevice, 'shell input tap ' + s.cx + ' ' + s.cy);
            if (!r.success) throw new Error('Tap gagal: ' + r.error);
          } else {
            await wait(500);
            addLog('  (Simulasi click — butuh Puppeteer untuk browser automation)', 'warn');
          }
          addLog('  Click selesai', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // BROWSER — EXTRACT TEXT
        // ══════════════════════════════════════════════════
        case 'extract-text':
        case 'extract-table': {
          addLog('Step ' + (i+1) + ': Extract dari [' + (s.selector || 'body') + '] -> {' + (s.var || 'result') + '}', 'info');
          // Placeholder: Simulasi dengan nilai dummy (butuh Puppeteer untuk real)
          const fakeExtracted = 'extracted_value_' + Date.now();
          if (s.var) {
            storeVar(s.var, fakeExtracted);
            addLog('  Nilai disimpan ke {' + s.var + '}: ' + fakeExtracted, 'success');
          }
          // Jika ada device ADB, coba baca dari UI dump
          if (stepDevice && stepDevice !== 'No ADB Device' && s.selector) {
            addLog('  (Mencoba baca dari UI dump via ADB...)', 'info');
            // Delegasi ke read-ui-element logic
            const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump_rba.xml && cat /sdcard/ui_dump_rba.xml');
            if (r.success) addLog('  UI dump tersedia untuk dibaca', 'info');
          }
          await wait(500);
          break;
        }

        // ══════════════════════════════════════════════════
        // WAIT ELEMENT
        // ══════════════════════════════════════════════════
        case 'wait-element': {
          const timeout = parseInt(s.waitTimeout) || 10000;
          const selector = s.waitSelector || '';
          addLog(\'Step \' + i+1 + ': Menunggu [\' + selector + '] menjadi \' + s.waitCondition || 'visible' + ' (max \' + timeout + 'ms)\', 'info');
          // Implementasi polling ADB jika ada device
          if (stepDevice && stepDevice !== 'No ADB Device' && selector) {
            const startTime = Date.now();
            const pollInterval = 1000;
            let found = false;
            while (Date.now() - startTime < timeout) {
              const r = await runAdb(stepDevice, \'shell uiautomator dump /sdcard/ui_dump_wait.xml && cat /sdcard/ui_dump_wait.xml\');
              if (r.success && r.output.includes(selector)) {
                found = true;
                addLog(\'  Element [\' + selector + '] ditemukan!\', 'success');
                break;
              }
              await wait(pollInterval);
              addLog(\'  Polling... (\' + Math.round((Date.now() - startTime) / 1000) + 's/\' + Math.round(timeout / 1000) + 's)\', 'info');
            }
            if (!found) {
              if (s.waitCondition === 'hidden') {
                addLog(\'  Element [\' + selector + '] tidak terlihat (sesuai kondisi "hidden")\', 'success');
              } else {
                throw new Error('Timeout: Element [' + selector + '] tidak ditemukan dalam ' + timeout + 'ms');
              }
            }
          } else {
            await wait(Math.min(timeout, 3000));
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // API REQUEST (FIXED: gunakan node http/https, bukan fetch)
        // ══════════════════════════════════════════════════
        case 'api-request': {
          const url = interpolate(s.apiUrl || '');
          if (!url) throw new Error('URL API kosong');
          
          addLog(\'Step \' + i+1 + ': \' + s.apiMethod || 'GET' + ' \' + url + '\', 'info');
          
          try {
            // Parse headers
            let headers = { 'User-Agent': 'RBA-Studio/2.0' };
            if (s.apiHeaders) {
              try { headers = { ...headers, ...JSON.parse(s.apiHeaders) }; } catch(e) { addLog(\'  Warning: Headers JSON tidak valid\', 'warn'); }
            }
            
            // Gunakan Node.js https/http module (bukan browser fetch, untuk hindari CORS di Electron)
            const result = await new Promise((resolve, reject) => {
              const urlObj = new URL(url);
              const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
              
              const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: s.apiMethod || 'GET',
                headers: headers,
                timeout: 15000
              };
              
              const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
              });
              
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
              
              if (['POST', 'PUT', 'PATCH'].includes(s.apiMethod) && s.apiBody) {
                const body = interpolate(s.apiBody);
                req.write(body);
              }
              req.end();
            });
            
            addLog(\'  Response: \' + result.status + ' (\' + result.data.length + ' chars)\', result.status >= 200 && result.status < 300 ? 'success' : 'warn');
            addLog(\'  Data: \' + result.data.substring(0, 100) + '\' + result.data.length > 100 ? '...' : '' + '\', 'info');
            
            // Simpan response ke variable
            if (s.var) {
              // Coba parse JSON
              try {
                const parsed = JSON.parse(result.data);
                storeVar(s.var, parsed);
                addLog(\'  Response JSON disimpan ke {\' + s.var + '}\', 'success');
              } catch(e) {
                storeVar(s.var, result.data);
                addLog(\'  Response text disimpan ke {\' + s.var + '}\', 'success');
              }
            }
            
            if (result.status >= 400) throw new Error('HTTP Error: ' + result.status);
            
          } catch(err) {
            throw new Error('API Request gagal: ' + err.message);
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // INPUT DIALOG (FIXED: tersambung ke varStore)
        // ══════════════════════════════════════════════════
        case 'input-dialog': {
          const question = s.text || s.name || 'Masukkan nilai:';
          const defaultVal = s.var ? (varStore[s.var] || '') : '';
          addLog(\'Step \' + i+1 + ': Menunggu input user: "\' + question + '"\', 'info');
          const val = prompt(question + (defaultVal ? '\\n(Default: ' + defaultVal + ')' : ''), defaultVal);
          if (val === null) {
            addLog(\'  Input dibatalkan oleh user\', 'warn');
          } else {
            if (s.var) {
              storeVar(s.var, val);
              addLog(\'  Input {\' + s.var + '} = "\' + val + '" disimpan\', 'success');
            } else {
              addLog(\'  Input: "\' + val + '" (tidak ada output variable)\', 'info');
            }
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // SCREENSHOT (browser/page)
        // ══════════════════════════════════════════════════
        case 'screenshot-page': {
          addLog(\'Step \' + i+1 + ': Screenshot browser (butuh Puppeteer untuk implementasi penuh)\', 'warn');
          // Jika ada device, ambil screenshot dari HP
          if (stepDevice && stepDevice !== 'No ADB Device') {
            const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
            const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
            const r1 = await runAdb(stepDevice, \'shell screencap -p \' + devicePath + '\');
            if (r1.success) {
              const r2 = await runAdb(stepDevice, \'pull \' + devicePath + ' "\' + localPath + '"\');
              if (r2.success) {
                await runAdb(stepDevice, \'shell rm \' + devicePath + '\');
                if (s.var) storeVar(s.var, localPath);
                addLog(\'  Screenshot HP: \' + localPath + '\', 'success');
              }
            }
          } else {
            await wait(1000);
            addLog(\'  (Tidak ada device ADB, skip screenshot)\', 'warn');
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // IF CONDITION (FIXED: evaluasi ekspresi variabel)
        // ══════════════════════════════════════════════════
        case 'if-condition': {
          const expr = interpolate(s.condition || 'true');
          let result = false;
          try {
            // Evaluasi kondisi dengan variabel yang ada
            const fn = new Function(...Object.keys(varStore), 'return (' + expr + ')');
            result = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            // Coba evaluasi sederhana: "value == something"
            addLog(\'  Kondisi eval error: \' + e.message + ', dianggap false\', 'warn');
            result = false;
          }
          addLog(\'  Kondisi "\' + expr + '" = \' + result + '\', result ? 'success' : 'warn');
          // Simpan hasil ke variable untuk dipakai step berikutnya
          if (s.var) storeVar(s.var, result);
          // Note: percabangan true/false path ditangani di runWorkflow() via edge routing
          break;
        }

        // ══════════════════════════════════════════════════
        // OCR (via ADB screenshot + text extraction)
        // ══════════════════════════════════════════════════
        case 'ocr': {
          addLog(\'Step \' + i+1 + ': OCR analysis...\', 'info');
          if (stepDevice && stepDevice !== 'No ADB Device') {
            // Screenshot dan ambil UI dump sebagai alternatif OCR
            const r = await runAdb(stepDevice, \'shell uiautomator dump /sdcard/ocr_dump.xml && cat /sdcard/ocr_dump.xml\');
            if (r.success) {
              const allTexts = [];
              const textRegex = /text="([^"]+)"/g;
              let m;
              while ((m = textRegex.exec(r.output)) !== null && allTexts.length < 30) {
                if (m[1].trim()) allTexts.push(m[1]);
              }
              const ocrResult = allTexts.join(' | ');
              if (s.var) storeVar(s.var, ocrResult);
              addLog(\'  OCR (via UI dump): \' + ocrResult.substring(0, 100) + '\', 'success');
              await runAdb(stepDevice, \'shell rm /sdcard/ocr_dump.xml\');
            }
          } else {
            addLog(\'  OCR butuh device ADB\', 'warn');
          }
          await wait(1000);
          break;
        }

        // ══════════════════════════════════════════════════
        // READ CSV / WRITE CSV
        // ══════════════════════════════════════════════════
        case 'read-csv': {
          const filePath = interpolate(s.filePath || '');
          if (!filePath) { addLog(\'  File path kosong\', 'warn'); break; }
          const fs = require('fs');
          if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan: ' + filePath);
          const content = fs.readFileSync(filePath, s.encoding || 'utf8');
          const delimiter = s.delimiter || ',';
          const lines = content.split('\\n').filter(l => l.trim());
          const startIdx = s.skipHeader === 'yes' ? 1 : 0;
          const rows = lines.slice(startIdx).map(l => l.split(delimiter).map(cell => cell.trim()));
          if (s.var) storeVar(s.var, rows);
          addLog(\'  CSV dibaca: \' + rows.length + ' baris dari \' + filePath + '\', 'success');
          break;
        }

        case 'write-csv': {
          const data = s.var ? (varStore[s.var] || []) : [];
          const filePath = interpolate(s.filePath || 'output_' + Date.now() + '.csv');
          const delimiter = s.delimiter || ',';
          const fs = require('fs');
          let content = '';
          if (Array.isArray(data)) {
            content = data.map(row => Array.isArray(row) ? row.join(delimiter) : String(row)).join('\\n');
          } else {
            content = String(data);
          }
          fs.writeFileSync(filePath, content, s.encoding || 'utf8');
          addLog(\'  CSV ditulis: \' + filePath + ' (\' + content.length + ' bytes)\', 'success');
          break;
        }

        case 'write-excel': {
          addLog(\'Step \' + i+1 + ': Write Excel: \' + s.filePath || 'output.xlsx' + ' (butuh library xlsx)\', 'warn');
          break;
        }

        // ══════════════════════════════════════════════════
        // DOWNLOAD FILE
        // ══════════════════════════════════════════════════
        case 'download-file': {
          const url = interpolate(s.url || s.var || '');
          if (!url) throw new Error('URL download kosong');
          const fileName = s.filePath || 'download_' + Date.now();
          const localPath = require('path').join(require('os').homedir(), 'Downloads', require('path').basename(fileName));
          addLog(\'Step \' + i+1 + ': Download: \' + url + ' -> \' + localPath + '\', 'info');
          await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
            const fs = require('fs');
            const file = fs.createWriteStream(localPath);
            lib.get(url, (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (err) => { require('fs').unlink(localPath, ()=>{}); reject(err); });
          });
          if (s.var) storeVar(s.var, localPath);
          addLog(\'  Download selesai: \' + localPath + '\', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // JSON PROCESSING
        // ══════════════════════════════════════════════════
        case 'json-processing': {
          const sourceVar = s.var || '';
          const sourceData = sourceVar ? varStore[sourceVar] : null;
          addLog(\'Step \' + i+1 + ': JSON process {\' + sourceVar + '}\', 'info');
          if (sourceData) {
            try {
              const parsed = typeof sourceData === 'string' ? JSON.parse(sourceData) : sourceData;
              addLog(\'  JSON parsed: \' + JSON.stringify(parsed).substring(0, 100) + '\', 'success');
              if (sourceVar) storeVar(sourceVar, parsed);
            } catch(e) { addLog(\'  JSON parse error: \' + e.message + '\', 'warn'); }
          }
          await wait(200);
          break;
        }

        // ══════════════════════════════════════════════════
        // DEBUG STEP
        // ══════════════════════════════════════════════════
        case 'debug-step': {
          addLog(\'Step \' + i+1 + ': === DEBUG BREAKPOINT di step \' + i+1 + ' ===\', 'warn');
          addLog(\'  Variables saat ini:\', 'info');
          Object.entries(varStore).forEach(([k, v]) => addLog(\'    {\' + k + '} = \' + JSON.stringify(v).substring(0, 50) + '\', 'info'));
          alert('DEBUG PAUSE\\nStep ' + (i+1) + ': ' + s.name + '\\n\\nVariables:\\n' + Object.entries(varStore).map(([k, v]) => '{' + k + '} = ' + String(v).substring(0, 30)).join('\\n') + '\\n\\nKlik OK untuk lanjut.');
          break;
        }

        // ══════════════════════════════════════════════════
        // PERFORMANCE TRACK
        // ══════════════════════════════════════════════════
        case 'performance-track': {
          const elapsed = Date.now() - execStats.startTime;
          addLog(\'Step \' + i+1 + ': Performance: \' + elapsed + 'ms sejak mulai\', 'info');
          if (s.var) storeVar(s.var, elapsed);
          break;
        }

        // ══════════════════════════════════════════════════
        // CONTROL FLOW (handled by runWorkflow, log saja)
        // ══════════════════════════════════════════════════
        case 'repeat-start': addLog(\'Step \' + i+1 + ': Loop start (dihandle oleh workflow engine)\', 'info'); break;
        case 'repeat-end':   addLog(\'Step \' + i+1 + ': Loop end (dihandle oleh workflow engine)\', 'info'); break;
        case 'parallel-start': addLog(\'Step \' + i+1 + ': Parallel start\', 'info'); break;
        case 'parallel-end':   addLog(\'Step \' + i+1 + ': Parallel join\', 'info'); break;
        case 'try-catch':      addLog(\'Step \' + i+1 + ': Try-Catch block aktif\', 'info'); break;
        case 'retry-logic':    addLog(\'Step \' + i+1 + ': Retry logic diset (dihandle oleh workflow engine)\', 'info'); break;
        case 'sub-workflow':   addLog(\'Step \' + i+1 + ': Sub-workflow: \' + s.var || 'tidak diset' + '\', 'warn'); break;
        case 'cron-job':       addLog(\'Step \' + i+1 + ': Cron: \' + s.cron || '?' + ' [\' + s.timezone || 'local' + ']\', 'info'); break;
        case 'webhook-trigger': addLog(\'Step \' + i+1 + ': Webhook trigger aktif\', 'info'); break;
        case 'credential-manager': addLog(\'Step \' + i+1 + ': Credentials loaded\', 'info'); break;
        case 'auto-selector':  addLog(\'Step \' + i+1 + ': Auto selector (AI element detection)\', 'warn'); break;
        case 'headless-mode':  addLog(\'Step \' + i+1 + ': Headless mode (butuh Puppeteer)\', 'warn'); break;
        case 'file-system':    addLog(\'Step \' + i+1 + ': File system op: \' + s.filePath || '?' + '\', 'info'); break;
        case 'handle-popup':   addLog(\'Step \' + i+1 + ': Handle popup\', 'info'); await wait(500); break;
        case 'upload-file':    addLog(\'Step \' + i+1 + ': Upload file: \' + s.filePath || '?' + '\', 'info'); await wait(1500); break;
        case 'pagination':     addLog(\'Step \' + i+1 + ': Pagination scraping\', 'info'); await wait(1000); break;
        case 'infinite-scroll': addLog(\'Step \' + i+1 + ': Infinite scroll\', 'info'); await wait(2000); break;

        case 'database-query': addLog(\'Step \' + i+1 + ': DB Query (butuh driver database)\', 'warn'); await wait(800); break;
        case 'regex-extraction': {
          const src = s.var ? String(varStore[s.var] || '') : '';
          if (src && s.regex) {
            try {
              const rx = new RegExp(s.regex, 'g');
              const matches = [...src.matchAll(rx)].map(m => m[0]);
              if (s.var) storeVar(s.var + '_matches', matches);
              addLog(\'Step \' + i+1 + ': Regex found \' + matches.length + ' match(es): \' + matches.slice(0,3).join(', ') + '\', 'success');
            } catch(e) { addLog(\'  Regex error: \' + e.message + '\', 'warn'); }
          }
          break;
        }
        case 'copy-paste-var': {
          const srcVar = s.selector || s.var || '';
          const dstVar = s.var || '';
          if (srcVar && dstVar && varStore[srcVar] !== undefined) {
            storeVar(dstVar, varStore[srcVar]);
            addLog(\'Step \' + i+1 + ': {\' + srcVar + '} -> {\' + dstVar + '} = \' + String(varStore[srcVar]).substring(0,30) + '\', 'success');
          }
          break;
        }
        case 'ai-decision': {
          addLog(\'Step \' + i+1 + ': AI Decision (butuh integrasi AI API — set apiUrl ke endpoint AI)\', 'warn');
          if (s.var) storeVar(s.var, 'ai_pending');
          await wait(500);
          break;
        }
        case 'filter-data': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data) && s.condition) {
            try {
              const filtered = data.filter(item => {
                const fn = new Function('item', 'return (' + s.condition + ')');
                return fn(item);
              });
              if (s.var) storeVar(s.var, filtered);
              addLog(\'Step \' + i+1 + ': Filter: \' + data.length + ' -> \' + filtered.length + ' items\', 'success');
            } catch(e) { addLog(\'  Filter error: \' + e.message + '\', 'warn'); }
          }
          break;
        }
        case 'batch-slice': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data)) {
            const size = parseInt(s.loopCount) || 10;
            const batches = [];
            for (let j = 0; j < data.length; j += size) batches.push(data.slice(j, j + size));
            storeVar((s.var || 'data') + '_batches', batches);
            addLog(\'Step \' + i+1 + ': Batch \' + data.length + ' items -> \' + batches.length + ' batch(es) of \' + size + '\', 'success');
          }
          break;
        }

        default:
          addLog(\'Step \' + i+1 + ': [\' + type + '] tidak ada implementasi spesifik, skip\', 'warn');
          await wait(parseInt(s.delay) || rdinat, gunakan ADB tap
          if (stepDevice && stepDevice !== 'No ADB Device' && s.cx && s.cy) {
            const r = await runAdb(stepDevice, \'shell input tap \' + s.cx + ' \' + s.cy + '\');
            if (!r.success) throw new Error('Tap gagal: ' + r.error);
          } else {
            await wait(500);
            addLog(\'  (Simulasi click — butuh Puppeteer untuk browser automation)\', 'warn');
          }
          addLog('  Click selesai', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // BROWSER — EXTRACT TEXT
        // ══════════════════════════════════════════════════
        case 'extract-text':
        case 'extract-table': {
          addLog('Step ' + (i+1) + ': Extract dari [' + (s.selector || 'body') + '] -> {' + (s.var || 'result') + '}', 'info');
          // Placeholder: Simulasi dengan nilai dummy (butuh Puppeteer untuk real)
          const fakeExtracted = 'extracted_value_' + Date.now();
          if (s.var) {
            storeVar(s.var, fakeExtracted);
            addLog('  Nilai disimpan ke {' + s.var + '}: ' + fakeExtracted, 'success');
          }
          // Jika ada device ADB, coba baca dari UI dump
          if (stepDevice && stepDevice !== 'No ADB Device' && s.selector) {
            addLog('  (Mencoba baca dari UI dump via ADB...)', 'info');
            // Delegasi ke read-ui-element logic
            const r = await runAdb(stepDevice, 'shell uiautomator dump /sdcard/ui_dump_rba.xml && cat /sdcard/ui_dump_rba.xml');
            if (r.success) addLog('  UI dump tersedia untuk dibaca', 'info');
          }
          await wait(500);
          break;
        }

        // ══════════════════════════════════════════════════
        // WAIT ELEMENT
        // ══════════════════════════════════════════════════
        case 'wait-element': {
          const timeout = parseInt(s.waitTimeout) || 10000;
          const selector = s.waitSelector || '';
          addLog(\'Step \' + i+1 + ': Menunggu [\' + selector + '] menjadi \' + s.waitCondition || 'visible' + ' (max \' + timeout + 'ms)\', 'info');
          // Implementasi polling ADB jika ada device
          if (stepDevice && stepDevice !== 'No ADB Device' && selector) {
            const startTime = Date.now();
            const pollInterval = 1000;
            let found = false;
            while (Date.now() - startTime < timeout) {
              const r = await runAdb(stepDevice, \'shell uiautomator dump /sdcard/ui_dump_wait.xml && cat /sdcard/ui_dump_wait.xml\');
              if (r.success && r.output.includes(selector)) {
                found = true;
                addLog(\'  Element [\' + selector + '] ditemukan!\', 'success');
                break;
              }
              await wait(pollInterval);
              addLog(\'  Polling... (\' + Math.round((Date.now() - startTime) / 1000) + 's/\' + Math.round(timeout / 1000) + 's)\', 'info');
            }
            if (!found) {
              if (s.waitCondition === 'hidden') {
                addLog(\'  Element [\' + selector + '] tidak terlihat (sesuai kondisi "hidden")\', 'success');
              } else {
                throw new Error('Timeout: Element [' + selector + '] tidak ditemukan dalam ' + timeout + 'ms');
              }
            }
          } else {
            await wait(Math.min(timeout, 3000));
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // API REQUEST (FIXED: gunakan node http/https, bukan fetch)
        // ══════════════════════════════════════════════════
        case 'api-request': {
          const url = interpolate(s.apiUrl || '');
          if (!url) throw new Error('URL API kosong');
          
          addLog(\'Step \' + i+1 + ': \' + s.apiMethod || 'GET' + ' \' + url + '\', 'info');
          
          try {
            // Parse headers
            let headers = { 'User-Agent': 'RBA-Studio/2.0' };
            if (s.apiHeaders) {
              try { headers = { ...headers, ...JSON.parse(s.apiHeaders) }; } catch(e) { addLog(\'  Warning: Headers JSON tidak valid\', 'warn'); }
            }
            
            // Gunakan Node.js https/http module (bukan browser fetch, untuk hindari CORS di Electron)
            const result = await new Promise((resolve, reject) => {
              const urlObj = new URL(url);
              const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
              
              const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: s.apiMethod || 'GET',
                headers: headers,
                timeout: 15000
              };
              
              const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
              });
              
              req.on('error', reject);
              req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
              
              if (['POST', 'PUT', 'PATCH'].includes(s.apiMethod) && s.apiBody) {
                const body = interpolate(s.apiBody);
                req.write(body);
              }
              req.end();
            });
            
            addLog(\'  Response: \' + result.status + ' (\' + result.data.length + ' chars)\', result.status >= 200 && result.status < 300 ? 'success' : 'warn');
            addLog(\'  Data: \' + result.data.substring(0, 100) + '\' + result.data.length > 100 ? '...' : '' + '\', 'info');
            
            // Simpan response ke variable
            if (s.var) {
              // Coba parse JSON
              try {
                const parsed = JSON.parse(result.data);
                storeVar(s.var, parsed);
                addLog(\'  Response JSON disimpan ke {\' + s.var + '}\', 'success');
              } catch(e) {
                storeVar(s.var, result.data);
                addLog(\'  Response text disimpan ke {\' + s.var + '}\', 'success');
              }
            }
            
            if (result.status >= 400) throw new Error('HTTP Error: ' + result.status);
            
          } catch(err) {
            throw new Error('API Request gagal: ' + err.message);
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // INPUT DIALOG (FIXED: tersambung ke varStore)
        // ══════════════════════════════════════════════════
        case 'input-dialog': {
          const question = s.text || s.name || 'Masukkan nilai:';
          const defaultVal = s.var ? (varStore[s.var] || '') : '';
          addLog(\'Step \' + i+1 + ': Menunggu input user: "\' + question + '"\', 'info');
          const val = prompt(question + (defaultVal ? '\\n(Default: ' + defaultVal + ')' : ''), defaultVal);
          if (val === null) {
            addLog(\'  Input dibatalkan oleh user\', 'warn');
          } else {
            if (s.var) {
              storeVar(s.var, val);
              addLog(\'  Input {\' + s.var + '} = "\' + val + '" disimpan\', 'success');
            } else {
              addLog(\'  Input: "\' + val + '" (tidak ada output variable)\', 'info');
            }
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // SCREENSHOT (browser/page)
        // ══════════════════════════════════════════════════
        case 'screenshot-page': {
          addLog(\'Step \' + i+1 + ': Screenshot browser (butuh Puppeteer untuk implementasi penuh)\', 'warn');
          // Jika ada device, ambil screenshot dari HP
          if (stepDevice && stepDevice !== 'No ADB Device') {
            const devicePath = '/sdcard/rba_screen_' + Date.now() + '.png';
            const localPath = require('path').join(require('os').homedir(), 'Documents', 'screenshot_' + Date.now() + '.png');
            const r1 = await runAdb(stepDevice, \'shell screencap -p \' + devicePath + '\');
            if (r1.success) {
              const r2 = await runAdb(stepDevice, \'pull \' + devicePath + ' "\' + localPath + '"\');
              if (r2.success) {
                await runAdb(stepDevice, \'shell rm \' + devicePath + '\');
                if (s.var) storeVar(s.var, localPath);
                addLog(\'  Screenshot HP: \' + localPath + '\', 'success');
              }
            }
          } else {
            await wait(1000);
            addLog(\'  (Tidak ada device ADB, skip screenshot)\', 'warn');
          }
          break;
        }

        // ══════════════════════════════════════════════════
        // IF CONDITION (FIXED: evaluasi ekspresi variabel)
        // ══════════════════════════════════════════════════
        case 'if-condition': {
          const expr = interpolate(s.condition || 'true');
          let result = false;
          try {
            // Evaluasi kondisi dengan variabel yang ada
            const fn = new Function(...Object.keys(varStore), 'return (' + expr + ')');
            result = Boolean(fn(...Object.values(varStore)));
          } catch(e) {
            // Coba evaluasi sederhana: "value == something"
            addLog(\'  Kondisi eval error: \' + e.message + ', dianggap false\', 'warn');
            result = false;
          }
          addLog(\'  Kondisi "\' + expr + '" = \' + result + '\', result ? 'success' : 'warn');
          // Simpan hasil ke variable untuk dipakai step berikutnya
          if (s.var) storeVar(s.var, result);
          // Note: percabangan true/false path ditangani di runWorkflow() via edge routing
          break;
        }

        // ══════════════════════════════════════════════════
        // OCR (via ADB screenshot + text extraction)
        // ══════════════════════════════════════════════════
        case 'ocr': {
          addLog(\'Step \' + i+1 + ': OCR analysis...\', 'info');
          if (stepDevice && stepDevice !== 'No ADB Device') {
            // Screenshot dan ambil UI dump sebagai alternatif OCR
            const r = await runAdb(stepDevice, \'shell uiautomator dump /sdcard/ocr_dump.xml && cat /sdcard/ocr_dump.xml\');
            if (r.success) {
              const allTexts = [];
              const textRegex = /text="([^"]+)"/g;
              let m;
              while ((m = textRegex.exec(r.output)) !== null && allTexts.length < 30) {
                if (m[1].trim()) allTexts.push(m[1]);
              }
              const ocrResult = allTexts.join(' | ');
              if (s.var) storeVar(s.var, ocrResult);
              addLog(\'  OCR (via UI dump): \' + ocrResult.substring(0, 100) + '\', 'success');
              await runAdb(stepDevice, \'shell rm /sdcard/ocr_dump.xml\');
            }
          } else {
            addLog(\'  OCR butuh device ADB\', 'warn');
          }
          await wait(1000);
          break;
        }

        // ══════════════════════════════════════════════════
        // READ CSV / WRITE CSV
        // ══════════════════════════════════════════════════
        case 'read-csv': {
          const filePath = interpolate(s.filePath || '');
          if (!filePath) { addLog(\'  File path kosong\', 'warn'); break; }
          const fs = require('fs');
          if (!fs.existsSync(filePath)) throw new Error('File tidak ditemukan: ' + filePath);
          const content = fs.readFileSync(filePath, s.encoding || 'utf8');
          const delimiter = s.delimiter || ',';
          const lines = content.split('\\n').filter(l => l.trim());
          const startIdx = s.skipHeader === 'yes' ? 1 : 0;
          const rows = lines.slice(startIdx).map(l => l.split(delimiter).map(cell => cell.trim()));
          if (s.var) storeVar(s.var, rows);
          addLog(\'  CSV dibaca: \' + rows.length + ' baris dari \' + filePath + '\', 'success');
          break;
        }

        case 'write-csv': {
          const data = s.var ? (varStore[s.var] || []) : [];
          const filePath = interpolate(s.filePath || 'output_' + Date.now() + '.csv');
          const delimiter = s.delimiter || ',';
          const fs = require('fs');
          let content = '';
          if (Array.isArray(data)) {
            content = data.map(row => Array.isArray(row) ? row.join(delimiter) : String(row)).join('\\n');
          } else {
            content = String(data);
          }
          fs.writeFileSync(filePath, content, s.encoding || 'utf8');
          addLog(\'  CSV ditulis: \' + filePath + ' (\' + content.length + ' bytes)\', 'success');
          break;
        }

        case 'write-excel': {
          addLog(\'Step \' + i+1 + ': Write Excel: \' + s.filePath || 'output.xlsx' + ' (butuh library xlsx)\', 'warn');
          break;
        }

        // ══════════════════════════════════════════════════
        // DOWNLOAD FILE
        // ══════════════════════════════════════════════════
        case 'download-file': {
          const url = interpolate(s.url || s.var || '');
          if (!url) throw new Error('URL download kosong');
          const fileName = s.filePath || 'download_' + Date.now();
          const localPath = require('path').join(require('os').homedir(), 'Downloads', require('path').basename(fileName));
          addLog(\'Step \' + i+1 + ': Download: \' + url + ' -> \' + localPath + '\', 'info');
          await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
            const fs = require('fs');
            const file = fs.createWriteStream(localPath);
            lib.get(url, (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); resolve(); });
            }).on('error', (err) => { require('fs').unlink(localPath, ()=>{}); reject(err); });
          });
          if (s.var) storeVar(s.var, localPath);
          addLog(\'  Download selesai: \' + localPath + '\', 'success');
          break;
        }

        // ══════════════════════════════════════════════════
        // JSON PROCESSING
        // ══════════════════════════════════════════════════
        case 'json-processing': {
          const sourceVar = s.var || '';
          const sourceData = sourceVar ? varStore[sourceVar] : null;
          addLog(\'Step \' + i+1 + ': JSON process {\' + sourceVar + '}\', 'info');
          if (sourceData) {
            try {
              const parsed = typeof sourceData === 'string' ? JSON.parse(sourceData) : sourceData;
              addLog(\'  JSON parsed: \' + JSON.stringify(parsed).substring(0, 100) + '\', 'success');
              if (sourceVar) storeVar(sourceVar, parsed);
            } catch(e) { addLog(\'  JSON parse error: \' + e.message + '\', 'warn'); }
          }
          await wait(200);
          break;
        }

        // ══════════════════════════════════════════════════
        // DEBUG STEP
        // ══════════════════════════════════════════════════
        case 'debug-step': {
          addLog(\'Step \' + i+1 + ': === DEBUG BREAKPOINT di step \' + i+1 + ' ===\', 'warn');
          addLog(\'  Variables saat ini:\', 'info');
          Object.entries(varStore).forEach(([k, v]) => addLog(\'    {\' + k + '} = \' + JSON.stringify(v).substring(0, 50) + '\', 'info'));
          alert('DEBUG PAUSE\\nStep ' + (i+1) + ': ' + s.name + '\\n\\nVariables:\\n' + Object.entries(varStore).map(([k, v]) => '{' + k + '} = ' + String(v).substring(0, 30)).join('\\n') + '\\n\\nKlik OK untuk lanjut.');
          break;
        }

        // ══════════════════════════════════════════════════
        // PERFORMANCE TRACK
        // ══════════════════════════════════════════════════
        case 'performance-track': {
          const elapsed = Date.now() - execStats.startTime;
          addLog(\'Step \' + i+1 + ': Performance: \' + elapsed + 'ms sejak mulai\', 'info');
          if (s.var) storeVar(s.var, elapsed);
          break;
        }

        // ══════════════════════════════════════════════════
        // CONTROL FLOW (handled by runWorkflow, log saja)
        // ══════════════════════════════════════════════════
        case 'repeat-start': addLog(\'Step \' + i+1 + ': Loop start (dihandle oleh workflow engine)\', 'info'); break;
        case 'repeat-end':   addLog(\'Step \' + i+1 + ': Loop end (dihandle oleh workflow engine)\', 'info'); break;
        case 'parallel-start': addLog(\'Step \' + i+1 + ': Parallel start\', 'info'); break;
        case 'parallel-end':   addLog(\'Step \' + i+1 + ': Parallel join\', 'info'); break;
        case 'try-catch':      addLog(\'Step \' + i+1 + ': Try-Catch block aktif\', 'info'); break;
        case 'retry-logic':    addLog(\'Step \' + i+1 + ': Retry logic diset (dihandle oleh workflow engine)\', 'info'); break;
        case 'sub-workflow':   addLog(\'Step \' + i+1 + ': Sub-workflow: \' + s.var || 'tidak diset' + '\', 'warn'); break;
        case 'cron-job':       addLog(\'Step \' + i+1 + ': Cron: \' + s.cron || '?' + ' [\' + s.timezone || 'local' + ']\', 'info'); break;
        case 'webhook-trigger': addLog(\'Step \' + i+1 + ': Webhook trigger aktif\', 'info'); break;
        case 'credential-manager': addLog(\'Step \' + i+1 + ': Credentials loaded\', 'info'); break;
        case 'auto-selector':  addLog(\'Step \' + i+1 + ': Auto selector (AI element detection)\', 'warn'); break;
        case 'headless-mode':  addLog(\'Step \' + i+1 + ': Headless mode (butuh Puppeteer)\', 'warn'); break;
        case 'file-system':    addLog(\'Step \' + i+1 + ': File system op: \' + s.filePath || '?' + '\', 'info'); break;
        case 'handle-popup':   addLog(\'Step \' + i+1 + ': Handle popup\', 'info'); await wait(500); break;
        case 'upload-file':    addLog(\'Step \' + i+1 + ': Upload file: \' + s.filePath || '?' + '\', 'info'); await wait(1500); break;
        case 'pagination':     addLog(\'Step \' + i+1 + ': Pagination scraping\', 'info'); await wait(1000); break;
        case 'infinite-scroll': addLog(\'Step \' + i+1 + ': Infinite scroll\', 'info'); await wait(2000); break;

        case 'database-query': addLog(\'Step \' + i+1 + ': DB Query (butuh driver database)\', 'warn'); await wait(800); break;
        case 'regex-extraction': {
          const src = s.var ? String(varStore[s.var] || '') : '';
          if (src && s.regex) {
            try {
              const rx = new RegExp(s.regex, 'g');
              const matches = [...src.matchAll(rx)].map(m => m[0]);
              if (s.var) storeVar(s.var + '_matches', matches);
              addLog(\'Step \' + i+1 + ': Regex found \' + matches.length + ' match(es): \' + matches.slice(0,3).join(', ') + '\', 'success');
            } catch(e) { addLog(\'  Regex error: \' + e.message + '\', 'warn'); }
          }
          break;
        }
        case 'copy-paste-var': {
          const srcVar = s.selector || s.var || '';
          const dstVar = s.var || '';
          if (srcVar && dstVar && varStore[srcVar] !== undefined) {
            storeVar(dstVar, varStore[srcVar]);
            addLog(\'Step \' + i+1 + ': {\' + srcVar + '} -> {\' + dstVar + '} = \' + String(varStore[srcVar]).substring(0,30) + '\', 'success');
          }
          break;
        }
        case 'ai-decision': {
          addLog(\'Step \' + i+1 + ': AI Decision (butuh integrasi AI API — set apiUrl ke endpoint AI)\', 'warn');
          if (s.var) storeVar(s.var, 'ai_pending');
          await wait(500);
          break;
        }
        case 'filter-data': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data) && s.condition) {
            try {
              const filtered = data.filter(item => {
                const fn = new Function('item', 'return (' + s.condition + ')');
                return fn(item);
              });
              if (s.var) storeVar(s.var, filtered);
              addLog(\'Step \' + i+1 + ': Filter: \' + data.length + ' -> \' + filtered.length + ' items\', 'success');
            } catch(e) { addLog(\'  Filter error: \' + e.message + '\', 'warn'); }
          }
          break;
        }
        case 'batch-slice': {
          const data = s.var ? varStore[s.var] : null;
          if (Array.isArray(data)) {
            const size = parseInt(s.loopCount) || 10;
            const batches = [];
            for (let j = 0; j < data.length; j += size) batches.push(data.slice(j, j + size));
            storeVar((s.var || 'data') + '_batches', batches);
            addLog(\'Step \' + i+1 + ': Batch \' + data.length + ' items -> \' + batches.length + ' batch(es) of \' + size + '\', 'success');
          }
          break;
        }

        default:
          addLog(\'Step \' + i+1 + ': [\' + type + '] tidak ada implementasi spesifik, skip\', 'warn');
          await wait(parseInt(s.delay) || 500);
      }
      s.status = 'success';
      retry.count = 0; // Reset retry count on success
    } catch(err) {
      s.status = 'error';
      execStats.errors++;
      document.getElementById('st-errors').textContent = execStats.errors;
      addLog(\'  ✗ Error: \' + err.message + '\', 'error');

      // ── RETRY LOGIC ────────────────────────────────────────
      if (retry.count < retry.maxRetry) {
        retry.count++;
        execStats.retries++;
        document.getElementById('st-retries').textContent = execStats.retries;
        addLog(\'  🔄 Retry \' + retry.count + '/\' + retry.maxRetry + ' in \' + retry.delay + 'ms...\', 'warn');
        await wait(retry.delay);
        continue; // Retry the same step
      } else {
        addLog(\'  ❌ Max retries reached, skipping step\', 'error');
        // Continue to next step instead of breaking (configurable)
      }
    }

    // ── LOOP CONTROL ─────────────────────────────────────────
    if (type === 'repeat-start') {
      const loopCount = parseInt(s.loopCount) || 1;
      const loopVar = s.var || 'loop_index';
      loopStack.push({ startId: s.id, count: loopCount, current: 0, varName: loopVar, startIndex: i });
      storeVar(loopVar, 0);
      addLog(\'  Loop start: \' + loopCount + ' iterations\', 'info');
    } else if (type === 'repeat-end') {
      if (loopStack.length > 0) {
        const loop = loopStack[loopStack.length - 1];
        loop.current++;
        if (loop.current < loop.count) {
          // Continue loop
          storeVar(loop.varName, loop.current);
          i = loop.startIndex; // Jump back to repeat-start
          addLog(\'  Loop iteration \' + loop.current + 1 + '/\' + loop.count + '\', 'info');
          continue;
        } else {
          // Exit loop
          loopStack.pop();
          addLog(\'  Loop end after \' + loop.count + ' iterations\', 'success');
        }
      }
    } else if (type === 'if-condition') {
      // Handle conditional branching via edges (already handled in canvas logic)
      // Here we just log the result
    }

    render();
    await wait(50); // brief visual pause between steps
    i++; // Move to next step
  }

  clearInterval(execStats.interval);
  addLog('=== Workflow '+(stopRequested?'STOPPED':'Complete')+' ===', stopRequested?'warn':'success');

  runBtn.disabled=false; stopBtn.disabled=true;
  runBtn.textContent='▶ RUN';
  if (tbRun) { tbRun.textContent='▶ Run'; tbRun.disabled=false; }
  status.className='hdr-badge offline';
  status.innerHTML='<div class="hdr-dot"></div>OFFLINE';

  setTimeout(() => { project.steps.forEach(s=>s.status=''); render(); }, 3000);
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
  out.innerHTML += \'<span class="log-ts">[\' + ts + ']</span> <span class="log-\' + type + '">\' + msg + '</span><br>\';
  out.scrollTop = out.scrollHeight;
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
  const root = document.documentElement;
  const newTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', newTheme);
  prefs.theme = newTheme;
  ipcRenderer.invoke('save-settings', prefs);
}

// ─── Barcode Generator ───────────────────────────────────────
const JsBarcode = require('jsbarcode');
const { jsPDF } = require('jspdf');
const JSZip = require('jszip');

const BARCODE_TYPE_MAP = {
  custom: { jsBarcodeFormat: 'CODE128', validate: () => null, example: 'ABC-abc-1234' },
  code128: { jsBarcodeFormat: 'CODE128', validate: (v) => /^[\s\S]+$/.test(v) ? null : 'Value tidak boleh kosong', example: 'ABC-abc-1234' },
  code128a: { jsBarcodeFormat: 'CODE128A', validate: (v) => /^[A-Z0-9\s]+$/.test(v) ? null : 'Code 128A hanya huruf besar dan angka', example: 'ABC123' },
  code128b: { jsBarcodeFormat: 'CODE128B', validate: (v) => v && v.length > 0 ? null : 'Value tidak boleh kosong', example: 'Hello World!' },
  code128c: { jsBarcodeFormat: 'CODE128C', validate: (v) => /^\d+$/.test(v) && v.length % 2 === 0 ? null : 'Code 128C harus angka genap', example: '12345678' },
  ean13: { jsBarcodeFormat: 'EAN13', validate: (v) => /^\d+$/.test(v) && v.length >= 12 && v.length <= 13 ? null : 'EAN-13 harus 12-13 digit angka', example: '5901234123457' },
  ean8: { jsBarcodeFormat: 'EAN8', validate: (v) => /^\d+$/.test(v) && v.length >= 7 && v.length <= 8 ? null : 'EAN-8 harus 7-8 digit angka', example: '96385074' },
  upca: { jsBarcodeFormat: 'UPC', validate: (v) => /^\d+$/.test(v) && v.length >= 11 && v.length <= 12 ? null : 'UPC-A harus 11-12 digit angka', example: '042100005264' },
  code39: { jsBarcodeFormat: 'CODE39', validate: (v) => /^[A-Z0-9\-.$/+%\s]+$/.test(v) ? null : 'Code 39 hanya karakter yang diperbolehkan', example: 'CODE39' },
  itf14: { jsBarcodeFormat: 'ITF14', validate: (v) => /^\d+$/.test(v) && v.length % 2 === 0 ? null : 'ITF14 harus digit genap', example: '10012345000017' },
  msi: { jsBarcodeFormat: 'MSI', validate: (v) => /^\d+$/.test(v) ? null : 'MSI hanya angka', example: '1234567' },
  pharmacode: { jsBarcodeFormat: 'pharmacode', validate: (v) => /^\d+$/.test(v) && Number(v) >= 3 && Number(v) <= 131070 ? null : 'Pharmacode harus angka 3-131070', example: '12345' },
  codabar: { jsBarcodeFormat: 'codabar', validate: (v) => /^[A-D0-9\-.$/:+\s]+$/.test(v) ? null : 'Codabar hanya karakter yang diperbolehkan', example: 'A123456A' },
  gs1_128: { jsBarcodeFormat: 'CODE128', validate: (v) => v && v.length > 0 ? null : 'GS1-128 tidak boleh kosong', example: '(01)09521234543213(3103)000123' },
  qr: { jsBarcodeFormat: 'QR', validate: (v) => v && v.length > 0 ? null : 'QR tidak boleh kosong', example: 'https://rba.app' },
  datamatrix: { jsBarcodeFormat: 'DATAMATRIX', validate: (v) => v && v.length > 0 ? null : 'Data Matrix tidak boleh kosong', example: 'RBA-123' }
};

const BARCODE_FORMATS = [
  { id: 'custom', title: 'Custom Barcode Design', category: 'Popular', example: 'ABC-abc-1234' },
  { id: 'code128', title: 'Code 128', category: 'Code 128', example: 'ABC-abc-1234' },
  { id: 'code128a', title: 'Code 128A', category: 'Code 128', example: 'ABC123' },
  { id: 'code128b', title: 'Code 128B', category: 'Code 128', example: 'Hello World!' },
  { id: 'code128c', title: 'Code 128C', category: 'Code 128', example: '12345678' },
  { id: 'gs1_128', title: 'GS1-128', category: 'Code 128', example: '(01)09521234543213(3103)000123' },
  { id: 'ean13', title: 'EAN-13', category: 'EAN / UPC', example: '5901234123457' },
  { id: 'ean8', title: 'EAN-8', category: 'EAN / UPC', example: '96385074' },
  { id: 'upca', title: 'UPC-A', category: 'EAN / UPC', example: '042100005264' },
  { id: 'code39', title: 'Code 39', category: 'Code 39 / Code 93', example: 'CODE39' },
  { id: 'itf14', title: 'ITF (Interleaved 2 of 5)', category: 'ITF', example: '10012345000017' },
  { id: 'msi', title: 'MSI', category: 'MSI', example: '1234567' },
  { id: 'pharmacode', title: 'Pharmacode', category: 'Pharmacode', example: '12345' },
  { id: 'codabar', title: 'Codabar', category: 'Codabar', example: 'A123456A' },
  { id: 'qr', title: 'QR Code', category: '2D', example: 'https://rba.app' },
  { id: 'datamatrix', title: 'Data Matrix', category: '2D', example: 'RBA-123' }
];

const barcodeState = {
  selectedFormat: 'custom',
  search: '',
  entries: [],
  options: {
    showText: true,
    maxWidth: 260,
    height: 80,
    margin: 10,
    color: '#111827',
    background: '#ffffff',
    fontSize: 18,
    textAlign: 'center',
    rotation: 0
  }
};

function normalizeBarcodeValue(value, formatId) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (formatId === 'gs1_128') {
    return parseGS1Input(text);
  }
  return text;
}

function parseGS1Input(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  const aiMatches = [...text.matchAll(/\((\d{2,4})\)/g)];
  if (!aiMatches.length) return text;
  let result = '';
  let cursor = 0;
  for (const match of aiMatches) {
    const idx = match.index;
    const ai = match[1];
    if (idx > cursor) {
      result += text.slice(cursor, idx);
    }
    result += '\u00f1' + ai + ' '; 
    cursor = idx + match[0].length;
  }
  if (cursor < text.length) {
    result += text.slice(cursor);
  }
  return result.replace(/\s+/g, '').replace(/\u00f1+/g, '\u00f1');
}

function validateValue(v, formatId) {
  const validator = (BARCODE_TYPE_MAP[formatId] || BARCODE_TYPE_MAP.code128).validate;
  if (!v || !String(v).trim()) return 'Value tidak boleh kosong';
  return validator(String(v).trim()) || null;
}

function ensureBarcodeEntries() {
  if (!barcodeState.entries.length) {
    barcodeState.entries = [{ id: crypto.randomUUID ? crypto.randomUUID() : 'entry-' + Date.now(), value: BARCODE_TYPE_MAP[barcodeState.selectedFormat].example || 'ABC123', caption: '', error: null }];
  }
  return barcodeState.entries;
}

function parseBarcodeTextarea() {
  const textarea = document.getElementById('barcode-values-input');
  if (!textarea) return;
  const raw = textarea.value || '';
  const lines = raw.split(/\r?\n/).filter(line => line.trim() !== '');
  if (!lines.length) {
    barcodeState.entries = [];
    return;
  }
  barcodeState.entries = lines.map((line) => {
    const parts = line.split('\t');
    const value = (parts[0] || '').trim();
    const caption = (parts[1] || '').trim();
    const error = validateValue(value, barcodeState.selectedFormat);
    return { id: crypto.randomUUID ? crypto.randomUUID() : 'entry-' + Date.now(), value, caption, error };
  });
  barcodeState.entries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
  if (!barcodeState.entries.length) {
    barcodeState.entries = [{ id: crypto.randomUUID ? crypto.randomUUID() : 'entry-' + Date.now(), value: '', caption: '', error: 'Value tidak boleh kosong' }];
  }
}

function serializeEntriesToTextarea() {
  const textarea = document.getElementById('barcode-values-input');
  if (!textarea) return;
  textarea.value = barcodeState.entries
    .map((entry) => {
      const value = String(entry.value || '').trim();
      const caption = String(entry.caption || '').trim();
      if (!value) return '';
      return caption ? value + '\t' + caption : value;
    })
    .filter(Boolean)
    .join('\n');
}

function renderBarcodeFormatSelector() {
  var search = (document.getElementById('barcode-search') || { value: '' }).value.toLowerCase();
  var list = document.getElementById('barcode-format-list');
  if (!list) return;
  var categories = {};
  BARCODE_FORMATS.forEach(function(format) {
    var match = format.title.toLowerCase().includes(search) || format.category.toLowerCase().includes(search) || format.id.toLowerCase().includes(search);
    if (!match) return;
    if (!categories[format.category]) categories[format.category] = [];
    categories[format.category].push(format);
  });
  var htmlParts = [];
  Object.keys(categories).forEach(function(category) {
    var items = categories[category];
    var itemHtml = '';
    items.forEach(function(item) {
      var activeClass = barcodeState.selectedFormat === item.id ? 'active' : '';
      itemHtml += '<div class="barcode-format-card ' + activeClass + '" data-format="' + item.id + '" onclick="selectBarcodeFormat(\'' + item.id + '\')">' +
        '<div class="barcode-format-card-top"><strong>' + item.title + '</strong></div>' +
        '<div class="barcode-mini-preview">' + renderMiniBarcode(item.example || '', item.id) + '</div>' +
        '</div>';
    });
    htmlParts.push('<div class="barcode-category"><div class="barcode-category-header"><span>' + category + '</span><span>' + items.length + '</span></div><div class="barcode-category-items">' + itemHtml + '</div></div>');
  });
  list.innerHTML = htmlParts.join('');
  var customCard = document.getElementById('barcode-custom-design');
  if (customCard) {
    customCard.classList.toggle('active', barcodeState.selectedFormat === 'custom');
  }
}

function renderMiniBarcode(value, formatId) {
  if (!value) return '<span style="color:#475569;font-size:11px;">N/A</span>';
  var normalized = normalizeBarcodeValue(value, formatId || barcodeState.selectedFormat);
  var safeFormat = formatId === 'custom' ? 'CODE128' : (BARCODE_TYPE_MAP[formatId] || BARCODE_TYPE_MAP.code128).jsBarcodeFormat;
  var svgId = 'mini-' + formatId + '-' + Math.random().toString(16).slice(2);
  setTimeout(() => {
    try {
      const el = document.getElementById(svgId);
      if (el && typeof JsBarcode === 'function') {
        JsBarcode(el, normalized, { format: safeFormat, displayValue: false, background: '#ffffff', lineColor: '#111827', width: 1.5, height: 28, margin: 4 });
      }
    } catch (e) {}
  }, 0);
  return '<svg id="' + svgId + '" xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32"></svg>';
}

function updateBarcodeOptionsFromInput() {
  barcodeState.options.showText = document.getElementById('barcode-show-text').checked;
  barcodeState.options.maxWidth = Number(document.getElementById('barcode-max-width').value || 260);
  barcodeState.options.height = Number(document.getElementById('barcode-height').value || 80);
  barcodeState.options.margin = Number(document.getElementById('barcode-margin').value || 10);
  barcodeState.options.color = document.getElementById('barcode-color').value || '#111827';
  barcodeState.options.background = document.getElementById('barcode-bg-color').value || '#ffffff';
  barcodeState.options.fontSize = Number(document.getElementById('barcode-font-size').value || 18);
  barcodeState.options.textAlign = document.getElementById('barcode-text-align').value || 'center';
  barcodeState.options.rotation = Number(document.getElementById('barcode-rotation').value || 0);
}

function createBarcodeSvg(value, caption, formatId) {
  const safeFormat = formatId === 'custom' ? 'CODE128' : (BARCODE_TYPE_MAP[formatId] || BARCODE_TYPE_MAP.code128).jsBarcodeFormat;
  const normalizedValue = normalizeBarcodeValue(value, formatId || barcodeState.selectedFormat);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '0 0 320 180');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const options = {
    format: safeFormat,
    // Always disable JsBarcode's own display text; we render caption/value ourselves
    displayValue: false,
    text: normalizedValue,
    fontSize: barcodeState.options.fontSize,
    height: barcodeState.options.height,
    width: Math.max(1.2, Math.min(3.2, Math.max(1, barcodeState.options.maxWidth / 180))),
    margin: barcodeState.options.margin,
    background: barcodeState.options.background,
    lineColor: barcodeState.options.color,
    textAlign: barcodeState.options.textAlign,
    textMargin: 8,
    fontOptions: '',
    flat: false,
    rotation: barcodeState.options.rotation
  };
  if (formatId === 'gs1_128') {
    options.text = normalizedValue;
  }
  if (formatId === 'qr' || formatId === 'datamatrix') {
    const parent = document.createElement('div');
    parent.style.width = '100%';
    parent.style.display = 'flex';
    parent.style.justifyContent = 'center';
    parent.style.alignItems = 'center';
    parent.style.height = '100%';
    parent.innerHTML = formatId === 'qr' ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><text x="60" y="60" text-anchor="middle" font-size="12" fill="#111827">QR</text></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><text x="60" y="60" text-anchor="middle" font-size="12" fill="#111827">DM</text></svg>';
    return parent;
  }
  try {
    JsBarcode(svg, normalizedValue, options);
  } catch (e) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '160');
    text.setAttribute('y', '100');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#dc2626');
    text.setAttribute('font-size', '12');
    text.textContent = 'Invalid value';
    svg.appendChild(text);
  }
  return svg;
}

function renderBarcodePreview() {
  const preview = document.getElementById('barcode-preview');
  if (!preview) return;
  const entries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
  if (!entries.length) {
    preview.innerHTML = '<div class="barcode-empty">' +
      '<div class="barcode-empty-icon">📦</div>' +
      '<div><strong>Barcode Values masih kosong</strong></div>' +
      '<div>Masukkan value pertama Anda untuk mulai membuat barcode.</div>' +
      '</div>';
    return;
  }

  preview.innerHTML = entries.map((entry) => {
    const formatId = barcodeState.selectedFormat || 'custom';
    const validationError = validateValue(entry.value, formatId);
    const safeValue = normalizeBarcodeValue(entry.value, formatId);
    const captionText = entry.caption || safeValue;
    const wrapper = document.createElement('div');
    wrapper.className = 'barcode-output-card';
    try {
      const svg = createBarcodeSvg(entry.value, entry.caption, formatId);
      wrapper.appendChild(svg);
    } catch (err) {
      wrapper.innerHTML = '<div style="color:#dc2626;font-weight:600;">Preview failed</div>';
    }
    const label = document.createElement('div');
    label.className = 'barcode-output-text';
    label.textContent = captionText || safeValue || 'No value';
    wrapper.appendChild(label);
    if (validationError) {
      const errorNode = document.createElement('div');
      errorNode.className = 'barcode-output-error';
      errorNode.textContent = validationError;
      wrapper.appendChild(errorNode);
    }
    return wrapper.outerHTML;
  }).join('');
}

function selectBarcodeFormat(formatId) {
  barcodeState.selectedFormat = formatId;
  const currentEntries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
  if (currentEntries.length) {
    barcodeState.entries = currentEntries.map((entry) => ({ ...entry, error: validateValue(entry.value, formatId) }));
  } else {
    barcodeState.entries = [];
  }
  serializeEntriesToTextarea();
  renderBarcodeFormatSelector();
  renderBarcodePreview();
}

function syncBarcodeTextareaToState() {
  parseBarcodeTextarea();
  renderBarcodePreview();
}

function assignBarcodeOptionsToInputs() {
  const el = (id) => document.getElementById(id);
  el('barcode-show-text').checked = barcodeState.options.showText;
  el('barcode-max-width').value = barcodeState.options.maxWidth;
  el('barcode-height').value = barcodeState.options.height;
  el('barcode-margin').value = barcodeState.options.margin;
  el('barcode-color').value = barcodeState.options.color;
  el('barcode-bg-color').value = barcodeState.options.background;
  el('barcode-font-size').value = barcodeState.options.fontSize;
  el('barcode-text-align').value = barcodeState.options.textAlign;
  el('barcode-rotation').value = barcodeState.options.rotation;
}

function initBarcodeGenerator() {
  assignBarcodeOptionsToInputs();
  renderBarcodeFormatSelector();
  const textarea = document.getElementById('barcode-values-input');
  if (textarea) {
    const txt = String(textarea.value || '').trim();
    if (!txt) {
      barcodeState.entries = [];
    } else {
      barcodeState.entries = textarea.value.split(/\r?\n/).filter(Boolean).map((line) => ({
        id: crypto.randomUUID ? crypto.randomUUID() : 'entry-' + Date.now(),
        value: (line.split('\t')[0] || '').trim(),
        caption: (line.split('\t')[1] || '').trim(),
        error: null
      }));
    }
  }
  selectBarcodeFormat('custom');
  renderBarcodePreview();

  document.getElementById('barcode-show-text').addEventListener('change', () => {
    updateBarcodeOptionsFromInput();
    renderBarcodePreview();
  });
  ['barcode-max-width', 'barcode-height', 'barcode-margin', 'barcode-color', 'barcode-bg-color', 'barcode-font-size', 'barcode-text-align', 'barcode-rotation'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      updateBarcodeOptionsFromInput();
      renderBarcodePreview();
    });
    document.getElementById(id).addEventListener('change', () => {
      updateBarcodeOptionsFromInput();
      renderBarcodePreview();
    });
  });

  const valuesEditor = document.getElementById('barcode-values-input');
  if (valuesEditor) {
    valuesEditor.addEventListener('input', () => {
      let timeout = valuesEditor.dataset.debounce;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        syncBarcodeTextareaToState();
      }, 200);
      valuesEditor.dataset.debounce = timeout;
    });
  }

  document.getElementById('barcode-import-csv').addEventListener('click', () => {
    document.getElementById('barcode-csv-input').click();
  });

  document.getElementById('barcode-csv-input').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = String(loadEvent.target.result || '');
      const textarea = document.getElementById('barcode-values-input');
      if (textarea) {
        textarea.value = text.replace(/\r/g, '').trim();
        syncBarcodeTextareaToState();
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('barcode-copy-output').addEventListener('click', async () => {
    const svgList = [...document.querySelectorAll('#barcode-preview svg')];
    if (!svgList.length) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgList[0])], { type: 'image/svg+xml' });
    const item = new ClipboardItem({ 'image/svg+xml': blob });
    try {
      await navigator.clipboard.write([item]);
      addLog('Barcode SVG copied to clipboard', 'success');
    } catch (e) {
      addLog('Clipboard tidak didukung pada browser ini', 'warn');
    }
  });

  document.getElementById('barcode-create-sequence').addEventListener('click', () => {
    const container = document.getElementById('barcode-generator');
    const modal = container && container.querySelector('#barcode-sequence-modal');
    if (modal) modal.classList.add('active');
  });

  document.getElementById('barcode-sequence-cancel').addEventListener('click', () => {
    const container = document.getElementById('barcode-generator');
    const modal = container && container.querySelector('#barcode-sequence-modal');
    if (modal) modal.classList.remove('active');
  });

  document.getElementById('barcode-sequence-apply').addEventListener('click', () => {
    const container = document.getElementById('barcode-generator');
    const modal = container && container.querySelector('#barcode-sequence-modal');
    const prefixEl = container && container.querySelector('#sequence-prefix');
    const suffixEl = container && container.querySelector('#sequence-suffix');
    const startEl = container && container.querySelector('#sequence-start');
    const countEl = container && container.querySelector('#sequence-count');
    const stepEl = container && container.querySelector('#sequence-step');
    const paddingEl = container && container.querySelector('#sequence-padding');

    const prefix = prefixEl ? prefixEl.value || '' : '';
    const suffix = suffixEl ? suffixEl.value || '' : '';
    const start = Number(startEl ? startEl.value : 1) || 1;
    const count = Number(countEl ? countEl.value : 10) || 10;
    const step = Number(stepEl ? stepEl.value : 1) || 1;
    const padding = Number(paddingEl ? paddingEl.value : 0) || 0;
    const values = generateSequence({ prefix, start, count, step, padding, suffix });
    const textarea = container && container.querySelector('#barcode-values-input');
    if (textarea) {
      textarea.value = values.join('\n');
      syncBarcodeTextareaToState();
    }
    if (modal) modal.classList.remove('active');
  });

  document.getElementById('barcode-download-btn').addEventListener('click', () => {
    const format = document.getElementById('barcode-download-format').value;
    performBarcodeDownload(format);
  });

  document.getElementById('barcode-print-labels').addEventListener('click', () => {
    renderPrintLabels();
    window.print();
  });
}

function generateSequence({ prefix, start, count, step, padding, suffix }) {
  const values = [];
  let current = Number(start) || 1;
  for (let i = 0; i < (Number(count) || 1); i++) {
    const raw = String(current);
    const padded = padding > 0 ? raw.padStart(Number(padding), '0') : raw;
    values.push(String(prefix || '') + padded + String(suffix || ''));
    current += Number(step) || 1;
  }
  return values;
}

function performBarcodeDownload(format) {
  const entries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
  if (!entries.length) return;
  if (format === 'pdf') {
    const { jsPDF } = require('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    entries.forEach((entry, index) => {
      if (index > 0) doc.addPage();
      const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat);
      const serialized = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([serialized], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        doc.addImage(dataUrl, 'PNG', 20, 30, 170, 80);
        if (index === entries.length - 1) {
          doc.save('barcode-export.pdf');
        }
      };
      image.src = url;
    });
    return;
  }

  const zip = new JSZip();
  entries.forEach((entry, idx) => {
    const safe = normalizeBarcodeValue(entry.value, barcodeState.selectedFormat);
    const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat);
    const xml = new XMLSerializer().serializeToString(svg);
    const fileName = 'barcode-' + String(idx + 1).padStart(3, '0') + '.' + format;
    if (format === 'svg') {
      zip.file(fileName, xml);
    } else {
      const blob = svgToBlob(xml, format);
      zip.file(fileName, blob);
    }
  });

  if (entries.length === 1 && format !== 'svg') {
    const svg = createBarcodeSvg(entries[0].value, entries[0].caption, barcodeState.selectedFormat);
    const blob = svgToBlob(new XMLSerializer().serializeToString(svg), format);
    triggerDownload(blob, 'barcode-export.' + format);
    return;
  }

  zip.generateAsync({ type: 'blob' }).then((content) => {
    triggerDownload(content, 'barcode-export.zip');
  });
}

function svgToBlob(svgString, format) {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  if (format === 'svg') return svgBlob;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob);
      }, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
    };
    image.src = url;
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 400);
}

function renderPrintLabels() {
  const view = document.getElementById('barcode-print-view');
  if (!view) return;
  const entries = barcodeState.entries.filter((entry) => entry.value && entry.value.trim());
  if (!entries.length) return;
  view.innerHTML = '<div class="barcode-print-grid">' + entries.map((entry) => {
    const svg = createBarcodeSvg(entry.value, entry.caption, barcodeState.selectedFormat);
    const xml = new XMLSerializer().serializeToString(svg);
    const displayText = entry.caption || entry.value;
    return '<div class="barcode-print-card">' + xml + '<div class="caption">' + displayText + '</div></div>';
  }).join('') + '</div>';
}

// ─── Settings ────────────────────────────────────────────────
async function loadPrefs() {
  const s = await ipcRenderer.invoke('get-settings');
  Object.assign(prefs, s);
  document.documentElement.setAttribute('data-theme', prefs.theme || 'dark');
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
})();
</script>
</body>
</html>`;

app.whenReady().then(() => { createWindow(); setupAppMenu(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });








