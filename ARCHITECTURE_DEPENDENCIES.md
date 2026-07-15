# WhatsApp Bot & Macro Recorder - Architecture & Dependencies

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                        │
│                           (main.js)                                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              IPC Handler Registry                           │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  WhatsApp Handlers          │  Macro Handlers              │  │
│  │  ─────────────────────────  │  ─────────────────────       │  │
│  │  • wa-connect              │  • macro-start-recording     │  │
│  │  • wa-disconnect           │  • macro-stop-recording      │  │
│  │  • wa-get-groups           │  • macro-play                │  │
│  │  • wa-send-logic-fix       │  • macro-save                │  │
│  │  • wa-parse-excel          │  • macro-list                │  │
│  │  • wa-run                  │  • macro-check-permission    │  │
│  │  • wa-pause/resume/stop    │  • macro-request-permission  │  │
│  │  • wa-export-report        │  • macro-load/delete         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
           ▲                                              ▲
           │                                              │
           │ IPC (Invoke/Send)                            │ IPC (Invoke/Send)
           │                                              │
    ┌──────┴──────┐                              ┌────────┴────────┐
    │              │                              │                 │
    ▼              ▼                              ▼                 ▼
┌────────────┐ ┌────────────┐          ┌──────────────┐ ┌──────────────┐
│ Renderer   │ │ Preload    │          │  Renderer    │ │  Preload     │
│ Process    │ │  Script    │          │  Process     │ │   Script     │
│            │ │            │          │              │ │              │
│ renderer.js│ │ preload.js │          │ renderer.js  │ │ preload.js   │
│            │ │            │          │              │ │              │
│ ▼ Panel    │ │ ▼ API      │          │ ▼ Panel      │ │ ▼ API        │
│   Mount    │ │   Bridge   │          │   Mount      │ │   Bridge     │
└────────────┘ └────────────┘          └──────────────┘ └──────────────┘
```

---

## WhatsApp Bot Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                      WhatsApp Bot Pipeline                         │
└────────────────────────────────────────────────────────────────────┘

1. INITIALIZATION
   ┌──────────────────────────────────────────────────┐
   │ User opens WhatsApp Bot panel                   │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ initWhatsAppBot(mountEl) called                 │
   │ Location: src/whatsappBot/whatsappBot.js:126   │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Load UI state (localStorage)                    │
   │ - Template presets                              │
   │ - Last used settings                            │
   └──────────────────────────────────────────────────┘

2. CONNECTION
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('wa-connect')                    │
   │ Location: main.js:1878                          │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ new Client({                                    │
   │   authStrategy: LocalAuth,                      │
   │   puppeteer: { headless: true }                 │
   │ })                                              │
   │ Module: whatsapp-web.js v1.34.7                │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Client event listeners registered:              │
   │ - 'qr': Send QR image to renderer               │
   │ - 'ready': Send connection info                 │
   │ - 'disconnected': Notify disconnect reason      │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ client.initialize() ← Authentication            │
   │ Returns: {ok, message}                          │
   └──────────────────────────────────────────────────┘

3. DATA INPUT
   ┌──────────────────────────────────────────────────┐
   │ User uploads Excel file                         │
   │ ▼                                               │
   │ ipcMain.handle('wa-parse-excel')                │
   │ Location: main.js:2042                          │
   │ ▼                                               │
   │ XLSX.readFile(filePath)                         │
   │ Module: xlsx v0.18.5                            │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Data Processing (whatsappEngine.js):            │
   │                                                 │
   │ buildRows(headers, rows)                        │
   │   ▼ Normalize column names                      │
   │                                                 │
   │ detectPhoneColumn(headers, rows)                │
   │   ▼ Auto-detect phone column                    │
   │   ▼ Returns index or -1                         │
   │                                                 │
   │ normalizePhone(value)                           │
   │   ▼ Convert to +62 format                       │
   │   ▼ Validate regex: /^\+62\d{8,13}$/            │
   │                                                 │
   │ Returns: {valid, normalized, reason}            │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Filtering & Sorting (whatsappEngine.js):        │
   │                                                 │
   │ applyFilters(rows, filters) - AND/OR logic      │
   │ sortRows(rows, column, direction)               │
   │ searchRows(rows, query)                         │
   │ deleteColumns(rows, headers, indexes)           │
   └──────────────────────────────────────────────────┘

4. GROUP RESOLUTION
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('wa-get-groups')                 │
   │ Location: main.js:1947                          │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ client.getChats()                               │
   │   ▼ Returns all chats (DMs, groups)             │
   │                                                 │
   │ Filter: chat.isGroup === true                   │
   │ Map: { id, name, memberCount }                  │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ resolveGroupByCP() (groupResolver.js)           │
   │   ▼ Extract keyword from CP name                │
   │   ▼ Look up override mapping                    │
   │   ▼ Fuzzy match on group names                  │
   │   ▼ Return best match with strategy             │
   │                                                 │
   │ Strategies:                                     │
   │ • OVERRIDE: Config-based group mapping          │
   │ • EXACT_MATCH: Exact group name found           │
   │ • FUZZY_MATCH: Partial keyword match            │
   └──────────────────────────────────────────────────┘

5. MESSAGE COMPOSITION
   ┌──────────────────────────────────────────────────┐
   │ User selects or creates message template       │
   │                                                 │
   │ Default template (messageTemplates.js):         │
   │ "Halo {{nama}},                                 │
   │  Terima kasih sudah melakukan transaksi.       │
   │  Nomor: {{nomor}}                              │
   │  Resi: {{resi}}                                │
   │                                                 │
   │  Salam,                                         │
   │  RBA Studio Pro"                               │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ buildLogicFixMessage() (logicFix.js)            │
   │   ▼ Context: {cp_name, group_name, awb_count}  │
   │   ▼ renderTemplate() substitutes variables      │
   │   ▼ Status summary aggregation                  │
   │   ▼ AWB list formatting                         │
   │                                                 │
   │ Returns: Formatted message text                 │
   └──────────────────────────────────────────────────┘

6. SENDING
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('wa-run')                        │
   │ Location: main.js:2061                          │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ For each recipient in recipients array:         │
   │   ▼ client.sendMessage(chatId, messageText)     │
   │   ▼ waEngine.processed++                        │
   │   ▼ Emit wa-progress event                      │
   │   ▼ Delay between messages (rate limiting)      │
   │                                                 │
   │ On error:                                       │
   │   ▼ waEngine.failed++                           │
   │   ▼ Log error message                           │
   │   ▼ Continue with next recipient                │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Session checkpoints saved (resumable):          │
   │   ▼ waEngine.checkpoint = [processed_ids]       │
   │   ▼ Allow recovery from crashes                 │
   └──────────────────────────────────────────────────┘

7. REPORTING
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('wa-export-report')              │
   │ Location: main.js:2080+                         │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ buildReportRows() (whatsappEngine.js)           │
   │ exportCsv()                                     │
   │ summarizeReport()                               │
   │                                                 │
   │ Output: CSV file with:                          │
   │ - Recipient, Group, Status, Timestamp          │
   │ - Error messages for failed sends               │
   │ - Delivery confirmation                        │
   └──────────────────────────────────────────────────┘
```

---

## Macro Recorder Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    Macro Recording Pipeline                        │
└────────────────────────────────────────────────────────────────────┘

1. INITIALIZATION
   ┌──────────────────────────────────────────────────┐
   │ User opens Macro Recorder panel                 │
   │ Location: renderer.js                           │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ initMacroRecorder(mountElement)                 │
   │ Location: src/macroRecorder/macroRecorder.js:1 │
   │                                                 │
   │ Initialize state:                               │
   │ - recording: false                              │
   │ - playing: false                                │
   │ - events: []                                    │
   │ - savedMacros: []                               │
   └──────────────────────────────────────────────────┘

2. PERMISSION CHECK (macOS only)
   ┌──────────────────────────────────────────────────┐
   │ checkPermission()                               │
   │   ▼ invoke('macro-check-permission')            │
   │   ▼ systemPreferences.isTrustedAccessibility   │
   │       Client(false)                             │
   │                                                 │
   │ If not granted:                                 │
   │   ▼ Show warning banner                         │
   │   ▼ Disable start button                        │
   │   ▼ Offer to open System Preferences            │
   │       x-apple.systempreferences:                │
   │       com.apple.preference.security?            │
   │       Privacy_Accessibility                     │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ [Optional] Request Permission                   │
   │ invoke('macro-request-permission')              │
   │   ▼ systemPreferences.isTrustedAccessibility   │
   │       Client(true)  ← Triggers prompt            │
   └──────────────────────────────────────────────────┘

3. RECORDING SETUP
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-start-recording')         │
   │ Location: main.js:541                           │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ getIOHook()                                     │
   │   ▼ Try: require('uiohook-napi')                │
   │   ▼ Fallback: require('iohook')                 │
   │                                                 │
   │ If both fail:                                   │
   │   ▼ Return error: "uiohook-napi не tersedia"   │
   │   ▼ Suggest: npm rebuild & rebuild              │
   │   ▼ Suggest: Check asarUnpack config            │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Initialize event listeners:                     │
   │                                                 │
   │ hook.on('mouseclick')                           │
   │   ▼ buildSmartTargetForClick()                  │
   │   ▼ Push to macroEngine.events                  │
   │   ▼ Send 'macro-event-recorded' to UI           │
   │                                                 │
   │ hook.on('mousedblclick')                        │
   │   ▼ Same as above but evt.double = true         │
   │                                                 │
   │ hook.on('mousewheel')                           │
   │   ▼ Record scroll direction & delta             │
   │                                                 │
   │ hook.on('keydown')                              │
   │   ▼ getKeyName(keycode) - normalize key         │
   │   ▼ Skip modifier keys (Ctrl, Shift, Alt)       │
   │   ▼ Record key + modifiers state                │
   │                                                 │
   │ [Optional] hook.on('mousemove')                 │
   │   ▼ Throttle: 50ms min between events           │
   │   ▼ Record only if enabled                      │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ macroEngine state:                              │
   │   isRecording = true                            │
   │   startTime = Date.now()                        │
   │   events = []                                   │
   │                                                 │
   │ hook.start() - Begin listening                  │
   │                                                 │
   │ Return: {ok: true, message: '...'}             │
   └──────────────────────────────────────────────────┘

4. SMART TARGET CAPTURE
   ┌──────────────────────────────────────────────────┐
   │ During recording, for each click:               │
   │                                                 │
   │ buildSmartTargetForClick({x, y, provider})     │
   │ Location: src/smartTargetCapture.js             │
   │ Called from: main.js:579                        │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ ElectronScreenshotProvider.capture()            │
   │   ▼ Screenshot desktop pixel data               │
   │   ▼ Module: jimp v0.22.10                       │
   │   ▼ Returns: Image buffer                       │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ SmartDetector.findElement(target, screenshot)  │
   │ Location: src/smartDetector.js                  │
   │ Module: tesseract.js v2.1.5 for OCR            │
   │                                                 │
   │ Detection layers:                               │
   │ 1. Template matching (jimp)                     │
   │ 2. Feature detection (edge/corner points)       │
   │ 3. OCR text region (tesseract.js)              │
   │ 4. Region hints (fallback)                      │
   │                                                 │
   │ Returns: {found, x, y, confidence, layer}      │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Store in event:                                 │
   │   evt.smartTarget = {                           │
   │     regionHint: {...},                          │
   │     templateImage: base64,                      │
   │     confidence: 0.85,                           │
   │     layer: 1                                    │
   │   }                                             │
   └──────────────────────────────────────────────────┘

5. RECORDING STOP
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-stop-recording')          │
   │ Location: main.js:678                           │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ macroEngine.isRecording = false                 │
   │ hook.stop()                                     │
   │ hook.removeAllListeners()                       │
   │                                                 │
   │ Calculate duration = now - startTime            │
   │                                                 │
   │ Return: {                                       │
   │   ok: true,                                     │
   │   events: [...],  // All recorded events        │
   │   duration: 12450,  // ms                       │
   │   count: 23  // Number of events                │
   │ }                                               │
   └──────────────────────────────────────────────────┘

6. SAVE MACRO
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-save')                    │
   │ Location: main.js:774                           │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ const macroDir = app.getPath('userData')        │
   │                  + '/macros'                    │
   │                                                 │
   │ fs.mkdirSync(macroDir, {recursive: true})       │
   │ const id = 'macro_' + Date.now()                │
   │                                                 │
   │ const data = {                                  │
   │   id,                                           │
   │   name,                                         │
   │   events,                                       │
   │   savedAt: new Date().toISOString(),            │
   │   eventCount: events.length                     │
   │ }                                               │
   │                                                 │
   │ fs.writeFileSync(                               │
   │   macroDir + '/' + id + '.json',                │
   │   JSON.stringify(data, null, 2)                │
   │ )                                               │
   │                                                 │
   │ Return: {ok: true, id}                          │
   └──────────────────────────────────────────────────┘

7. LOAD MACRO
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-list')                    │
   │ Location: main.js:799                           │
   │                                                 │
   │ Read all *.json from macros/ directory          │
   │ Sort by savedAt (newest first)                  │
   │                                                 │
   │ Return: {ok, macros: [...]}                     │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-load', id)                │
   │ Location: main.js:815                           │
   │                                                 │
   │ Load JSON file, parse, return data              │
   │ Return: {ok, ...macroData}                      │
   └──────────────────────────────────────────────────┘

8. PLAYBACK
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-play')                    │
   │ Location: main.js:1070                          │
   │ Params: {events, speed: 1.0, loops: 1}          │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ Load robotjs:                                   │
   │   robot = require('robotjs')                    │
   │                                                 │
   │ If failed:                                      │
   │   Return error: "robotjs не tersedia"           │
   │   Suggest: npm rebuild                          │
   └──────────────────────────────────────────────────┘
                      ▼
   ┌──────────────────────────────────────────────────┐
   │ For loop in loops:                              │
   │   For event in events:                          │
   │     Calculate delay = (evt.timestamp - prev)    │
   │                        / speed                  │
   │     sleep(delay)  ← Respect timing              │
   │                                                 │
   │     if evt.type === 'mouse_click':              │
   │       resolveSmartClickTarget(evt)              │
   │         ▼ Capture screenshot                    │
   │         ▼ Search for UI element                 │
   │         ▼ Return {x, y, source}                 │
   │       robot.moveMouse(x, y)                     │
   │       sleep(50ms)                               │
   │       robot.mouseClick(button, double)          │
   │                                                 │
   │     else if evt.type === 'key_press':           │
   │       Build modifiers array                     │
   │       robot.keyTap(key, modifiers)              │
   │                                                 │
   │     else if evt.type === 'scroll':              │
   │       robot.scrollMouse(0, direction*delta)     │
   │                                                 │
   │     Send 'macro-play-log' to UI                 │
   │     On error: send ERROR level log              │
   │                                                 │
   │   End of loop                                   │
   │   Sleep 500ms before next loop                  │
   │ End of loops                                    │
   │                                                 │
   │ Return: {ok: true}                              │
   └──────────────────────────────────────────────────┘

9. PAUSE/RESUME
   ┌──────────────────────────────────────────────────┐
   │ ipcMain.handle('macro-pause-play')              │
   │   macroEngine.isPaused = true                   │
   │                                                 │
   │ ipcMain.handle('macro-resume-play')             │
   │   macroEngine.isPaused = false                  │
   │                                                 │
   │ During playback, check:                         │
   │   while (macroEngine.isPaused) {                │
   │     sleep(100ms)                                │
   │   }                                             │
   └──────────────────────────────────────────────────┘
```

---

## Dependency Graph

```
RBA Studio Pro
│
├─ Electron Framework
│  └─ electron@28.0.0
│  └─ electron-builder@24.0.0
│
├─ WhatsApp Bot Dependencies
│  ├─ whatsapp-web.js@1.34.7
│  │  └─ Puppeteer (bundled)
│  │     └─ Chromium Browser (auto-downloaded)
│  ├─ qrcode@1.5.4
│  │  └─ canvas, pngjs (image generation)
│  └─ xlsx@0.18.5
│     └─ SSF (spreadsheet formula engine)
│
├─ Macro Recording Dependencies (Native Modules ⚠️)
│  ├─ uiohook-napi@1.5.5 ★ REQUIRES electron-rebuild
│  │  └─ node-pre-gyp (native build tools)
│  │     ├─ macOS: Cocoa API
│  │     ├─ Windows: Win32 API
│  │     └─ Linux: X11/Wayland
│  │
│  ├─ robotjs@0.7.1 ★ REQUIRES electron-rebuild
│  │  └─ node-pre-gyp
│  │     ├─ macOS: CoreGraphics, EventKit
│  │     ├─ Windows: Win32, Xinput
│  │     └─ Linux: X11
│  │
│  └─ [Optional] iohook (fallback)
│
├─ Image & OCR Dependencies
│  ├─ jimp@0.22.10
│  │  └─ Sharp, Chained image processing
│  │
│  └─ tesseract.js@2.1.5
│     └─ tesseract-ocr (WASM)
│
└─ Infrastructure
   ├─ node-window-manager@2.2.4
   ├─ chrome-remote-interface@0.34.0
   ├─ clipboardy@5.3.1
   ├─ fast-xml-parser@4.5.6
   ├─ bcryptjs@2.4.3
   └─ axios@1.15.2
```

---

## Data Flow Diagrams

### WhatsApp Bot Message Flow

```
┌─────────────┐
│ Excel File  │
└──────┬──────┘
       │
       ▼
┌──────────────────────────┐
│ XLSX.readFile()          │
│ Extract headers & rows   │
└──────┬───────────────────┘
       │
       ├─ detectPhoneColumn()
       │  └─ Returns column index
       │
       ├─ normalizePhone()
       │  └─ Convert to +62 format
       │
       ▼
┌──────────────────────────┐
│ Cleaned Data             │
│ [{phone, cp_name, ...}]  │
└──────┬───────────────────┘
       │
       ├─ applyFilters()
       ├─ sortRows()
       ├─ searchRows()
       │
       ▼
┌──────────────────────────┐
│ Filtered Data            │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ resolveGroupByCP()       │
│ Map: CP name → Group ID  │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Message Template         │
│ {{cp_name}}, {{awb}},... │
└──────┬───────────────────┘
       │
       ├─ buildLogicFixMessage()
       │  └─ Substitute variables
       │
       ▼
┌──────────────────────────┐
│ Formatted Message        │
│ "Halo CP_MANGGA_BESAR,   │
│  Total AWB: 42, ..."     │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ client.sendMessage()     │
│ WhatsApp API call        │
└──────┬───────────────────┘
       │
       ├─ Rate limiting (delay)
       ├─ Error handling
       ├─ Progress tracking
       │
       ▼
┌──────────────────────────┐
│ waEngine.processed++     │
│ Emit wa-progress         │
│ Store checkpoint         │
└──────────────────────────┘
```

### Macro Recording Data Flow

```
┌──────────────────────────┐
│ User Action              │
│ (Click/Type/Scroll)      │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ uiohook-napi             │
│ Global Event Hook        │
└──────┬───────────────────┘
       │
       ├─ mouseclick()
       ├─ mousedblclick()
       ├─ keydown()
       ├─ mousewheel()
       │
       ▼
┌──────────────────────────┐
│ Callback Handler         │
│ (Record to queue)        │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ buildSmartTargetForClick()
│ [Optional]               │
├─ ElectronScreenshotProvider
│  └─ jimp: Capture pixels
├─ SmartDetector
│  └─ tesseract: Find element
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Event Object             │
│ {type, timestamp, x, y,  │
│  button, smartTarget}    │
└──────┬───────────────────┘
       │
       ├─ Add to macroEngine.events
       ├─ Send to UI
       │
       ▼
┌──────────────────────────┐
│ UI Display               │
│ Event List               │
│ - Edit / Delete buttons  │
└──────┬───────────────────┘
       │
    [User clicks Stop]
       │
       ▼
┌──────────────────────────┐
│ macro-stop-recording     │
│ Return events array      │
└──────┬───────────────────┘
       │
       ├─ User saves?
       │
       ▼
┌──────────────────────────┐
│ macro-save               │
│ Write to macros/*.json   │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Stored Macro             │
└──────────────────────────┘
```

---

## Error Handling Flow

### WhatsApp Error Flow

```
wa-connect()
  │
  ├─ Puppeteer launch fails
  │  └─ Return: {ok: false, message: "..."}
  │
  ├─ QR rendering fails
  │  └─ console.error('[wa] Failed to render QR')
  │  └─ Continue (user retries)
  │
  └─ Initialization timeout
     └─ Return: {ok: false, message: "..."}

wa-send-logic-fix()
  │
  ├─ Group not found
  │  └─ Return: {ok: false, message: "Grup tidak ditemukan"}
  │
  ├─ Send fails
  │  └─ waEngine.failed++
  │  └─ Log error
  │  └─ Continue (skip recipient)
  │
  └─ Network error
     └─ Retry logic (built-in to whatsapp-web.js)
```

### Macro Error Flow

```
macro-start-recording()
  │
  ├─ Permission denied (macOS)
  │  └─ Return: {ok: false, needPermission: true}
  │  └─ UI shows banner + System Preferences link
  │
  ├─ Hook not available
  │  └─ Return: {ok: false, message: "..."}
  │  └─ Suggest npm rebuild
  │
  └─ Already recording
     └─ Stop previous session first

macro-play()
  │
  ├─ robotjs not found
  │  └─ Return: {ok: false, message: "..."}
  │
  ├─ Element not found during smart detection
  │  └─ Log warning
  │  └─ Fall back to raw coordinates
  │
  ├─ Confidence too low
  │  └─ Log WARN
  │  └─ Use raw coordinates or fail
  │
  └─ Click fails (coordinates off)
     └─ Log ERROR
     └─ Continue to next event
        (or stop if user configured)
```

---

## Build & Deployment Chain

```
Development
   │
   ├─ npm install
   │
   ├─ npm run rebuild
   │  └─ electron-rebuild -f -w robotjs,uiohook-napi
   │     └─ Compile native modules for current Electron
   │
   └─ npm start
      └─ electron .

Production Build
   │
   ├─ npm run rebuild
   │  └─ [CRITICAL STEP]
   │
   ├─ npm run build
   │  └─ electron-builder --win --x64
   │     ├─ Collect dependencies
   │     ├─ Unpack asarUnpack modules
   │     │  ├─ robotjs binaries
   │     │  ├─ uiohook-napi binaries
   │     │  └─ Other native modules
   │     ├─ Create ASAR archive
   │     ├─ Create installer (NSIS)
   │     └─ Sign & notarize (if configured)
   │
   └─ Output
      └─ dist/RBA\ Studio\ Pro.exe
      └─ installer or portable
```

