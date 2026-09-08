# WhatsApp Bot & Macro Recorder - Quick Reference

## 🚀 Quick Start Checklist

### WhatsApp Bot
- [ ] Check `whatsapp-web.js@1.34.7` installed
- [ ] Ensure internet connection
- [ ] Have active WhatsApp account on mobile device
- [ ] Navigate to WhatsApp Bot panel in UI
- [ ] Scan QR code when prompted
- [ ] Upload Excel file with phone numbers/group names
- [ ] Create or select message template
- [ ] Send message to groups

### Macro Recording
- [ ] Check `robotjs@0.7.1` and `uiohook-napi@1.5.5` installed
- [ ] (macOS only) Grant Accessibility permission in System Preferences
- [ ] Navigate to Macro Recorder panel
- [ ] Click "Start Recording"
- [ ] Perform actions (click, type, scroll) in any application
- [ ] Click "Stop Recording"
- [ ] Save macro with descriptive name
- [ ] Load and replay macro

---

## 📁 Key File Locations

### WhatsApp Bot
```
Source Code:
  src/whatsappBot/whatsappBot.js         ← Main UI component
  src/whatsappBot/whatsappEngine.js      ← Data processing
  src/whatsappBot/groupResolver.js       ← Group matching
  src/whatsappBot/logicFix.js            ← Message templates
  src/messageTemplates.js                ← Template utilities
  main.js (lines 1878+)                  ← IPC handlers

Runtime Storage:
  ~/.../wa-session/                      ← WhatsApp session cache
  config/group-ids.json                  ← Optional group ID mapping
```

### Macro Recording
```
Source Code:
  src/macroRecorder/macroRecorder.js     ← Main UI component
  main.js (lines 437-1200)               ← Recording/playback engine
  src/smartDetector.js                   ← AI element detection

Runtime Storage:
  ~/.../macros/                          ← Saved macro JSON files
  macros/macro_<timestamp>.json          ← Individual macro file
```

---

## 🔧 IPC Handlers Quick Reference

### WhatsApp Bot Handlers

```javascript
// Connection
api.waConnect()              → {ok, message}
api.waDisconnect()           → {ok, message}

// Groups
api.waGetGroups()            → {ok, groups: [{id, name, memberCount}]}
api.waParseExcel(filePath)   → {ok, data}

// Messaging
api.waRun({recipients, template, options})        → {ok, message}
api.waPause()                → {ok}
api.waResume()               → {ok}
api.waStop()                 → {ok}
api.waExportReport(data)     → CSV export

// Listeners
api.onWaQr(callback)         → Listen for QR image
api.onWaConnected(callback)  → Listen for connection success
api.onWaDisconnected(callback)→ Listen for disconnect
api.onWaProgress(callback)   → Listen for progress updates
```

### Macro Recorder Handlers

```javascript
// Recording
api.invoke('macro-start-recording', {captureMouseMove: false})
api.invoke('macro-stop-recording')       → {ok, events, duration, count}
api.invoke('macro-get-events')           → {ok, events}

// Playback
api.invoke('macro-play', {events, speed: 1.0, loops: 1})
api.invoke('macro-stop-play')
api.invoke('macro-pause-play')
api.invoke('macro-resume-play')

// Management
api.invoke('macro-save', {name, events})  → {ok, id}
api.invoke('macro-list')                  → {ok, macros}
api.invoke('macro-load', id)              → {ok, ...macroData}
api.invoke('macro-delete', id)            → {ok}

// Permissions (macOS)
api.invoke('macro-check-permission')      → {ok, granted}
api.invoke('macro-request-permission')    → {ok, granted}
```

---

## 🎯 Common Workflows

### WhatsApp: Send Bulk Messages

```javascript
// 1. Connect
const connResult = await api.waConnect();
// Listen for QR and wait for user to scan

// 2. Get Groups
const groupsResult = await api.waGetGroups();
// User selects group from list

// 3. Parse Excel
const excelResult = await api.waParseExcel('/path/to/file.xlsx');
// Extract phone numbers and data

// 4. Create Template
const template = 'Hello {{name}}, your order {{order_id}} is ready!';

// 5. Send Messages
const runResult = await api.waRun({
  recipients: ['+6281234567890', ...],
  template: template,
  options: { delay: 1000 }
});

// 6. Monitor Progress
api.onWaProgress((data) => {
  console.log(`Sent: ${data.processed}/${data.total}`);
});

// 7. Export Report
const report = await api.waExportReport(runResult);
```

### Macro: Record and Replay Actions

```javascript
// 1. Request Permission (macOS)
const perm = await api.invoke('macro-check-permission');
if (!perm.granted) {
  await api.invoke('macro-request-permission');
  // Open System Preferences if needed
}

// 2. Start Recording
const startRes = await api.invoke('macro-start-recording', {
  captureMouseMove: false
});
// User performs: click, type, scroll in any app

// 3. Stop Recording
const stopRes = await api.invoke('macro-stop-recording');
// {ok, events: [{type, timestamp, x, y, ...}], duration, count}

// 4. Save Macro
const saveRes = await api.invoke('macro-save', {
  name: 'Fill Invoice Form',
  events: stopRes.events
});
// Returns {ok, id: 'macro_1234567890'}

// 5. Load Macro
const loadRes = await api.invoke('macro-load', saveRes.id);

// 6. Playback
const playRes = await api.invoke('macro-play', {
  events: loadRes.events,
  speed: 1.0,      // Replay at normal speed
  loops: 1         // Repeat 1 time
});
// Listen for macro-play-log events to track progress
```

---

## ⚠️ Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "WhatsApp belum terhubung" | Not connected to WhatsApp | Call waConnect() and scan QR |
| "robotjs tidak tersedia" | Native module not built | Run `npm rebuild` before build |
| "uiohook-napi not found" | Not unpacked during installation | Check electron-builder asarUnpack config |
| "Accessibility permission diperlukan" (macOS) | Permission not granted | System Preferences > Privacy & Security > Accessibility |
| "Grup tidak ditemukan" | Group name misspelled or private group | Check exact group name in WhatsApp |
| Macro clicks off-screen | Screen resolution changed | Use Smart Detection or re-record on target screen |

---

## 📦 Dependencies Installation

### First Time Setup
```bash
# Install all dependencies
npm install

# Rebuild native modules for current Electron version
npm rebuild
# Expands to: electron-rebuild -f -w robotjs,uiohook-napi

# Test
npm start
```

### Before Packaging
```bash
# IMPORTANT: Always rebuild before building for production
npm run rebuild

# Then build
npm run build
# For Windows x64: electron-builder --win --x64
```

---

## 🔍 Debugging Tips

### Check WhatsApp Connection
```javascript
const groups = await api.waGetGroups();
if (!groups.ok) {
  console.error('Connection failed:', groups.message);
} else {
  console.log('Connected. Groups:', groups.groups.map(g => g.name));
}
```

### Check Macro Recording
```javascript
const perm = await api.invoke('macro-check-permission');
console.log('Permission granted:', perm.granted);

const events = await api.invoke('macro-get-events');
console.log('Recorded events:', events.events.length);
```

### View Console Logs
- **macOS/Linux**: `CMD+Option+I` or `Ctrl+Shift+I` in Electron DevTools
- **Windows**: Same keyboard shortcut
- Look for prefixes: `[wa]`, `[MCR]`, `[MacroRecorder]`

### Enable Smart Detection Debugging
```javascript
// In renderer, check smart detection settings:
const settings = await api.invoke('get-settings');
console.log('Smart Detection:', settings.smartDetection);
```

---

## 🌐 Network Requirements

### WhatsApp Bot
- **Requires**: Internet connection (upload + download)
- **Bandwidth**: ~100KB per group message (depending on content)
- **Latency**: Tolerates network delays (built-in retry)
- **Firewall**: Needs access to WhatsApp servers (443/443S)

### Macro Recording
- **Requires**: No internet
- **Can work**: Offline, on any application
- **Note**: Desktop automation only (no web control)

---

## 💾 Data Storage Locations

### macOS
```
WhatsApp:  ~/Library/Application Support/RBA Studio Pro/wa-session/
Macros:    ~/Library/Application Support/RBA Studio Pro/macros/
Settings:  ~/Library/Application Support/RBA Studio Pro/rba-settings.json
Workflows: ~/Library/Application Support/RBA Studio Pro/rba-workflows.json
```

### Windows
```
WhatsApp:  %APPDATA%\RBA Studio Pro\wa-session\
Macros:    %APPDATA%\RBA Studio Pro\macros\
Settings:  %APPDATA%\RBA Studio Pro\rba-settings.json
Workflows: %APPDATA%\RBA Studio Pro\rba-workflows.json
```

### Linux
```
WhatsApp:  ~/.config/RBA Studio Pro/wa-session/
Macros:    ~/.config/RBA Studio Pro/macros/
Settings:  ~/.config/RBA Studio Pro/rba-settings.json
Workflows: ~/.config/RBA Studio Pro/rba-workflows.json
```

---

## 📋 File Format Examples

### Saved Macro JSON
```json
{
  "id": "macro_1721068234567",
  "name": "Fill Invoice Form",
  "events": [
    {
      "type": "mouse_click",
      "timestamp": 150,
      "x": 500,
      "y": 300,
      "button": "left",
      "double": false,
      "smartTarget": { "region": {...}, "hint": "button" }
    },
    {
      "type": "key_press",
      "timestamp": 500,
      "key": "a",
      "ctrl": true,
      "shift": false,
      "alt": false
    }
  ],
  "savedAt": "2024-07-15T10:30:34.567Z",
  "eventCount": 15
}
```

### Config/group-ids.json (Optional)
```json
{
  "Monitoring Tiang Bendera": "120363123456789@g.us",
  "Monitoring CP_MANGGA_BESAR": "120363987654321@g.us",
  "Customer Support": "120363555666777@g.us"
}
```

---

## 🔐 Security Notes

1. **WhatsApp Sessions**: Stored unencrypted at `wa-session/` - treat as sensitive
2. **Macro Recordings**: Store raw screen coordinates - may leak sensitive info
3. **Smart Detection**: Stores visual fingerprints - can identify UI elements
4. **Backup**: Macros stored as readable JSON - no encryption by default

---

## 📚 See Also

- [WHATSAPP_MACRO_ANALYSIS.md](WHATSAPP_MACRO_ANALYSIS.md) - Full technical analysis
- [main.js](main.js) - IPC handler implementation
- [package.json](package.json) - Dependency declarations
- [preload.js](preload.js) - Frontend API definitions

