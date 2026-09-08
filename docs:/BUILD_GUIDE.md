# RBA Studio Pro — Build & Distribution Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ dan npm
- Electron dan dependencies sudah terinstall
- Folder `assets/` dengan icon:
  - `assets/icon.ico` (Windows icon)
  - `assets/icon.icns` (macOS icon)

### Build Commands

```bash
# Development
npm start                 # Run development
npm run dev             # Run dengan debugger

# Building
npm run build           # Build Windows NSIS installer + portable
npm run build:mac       # Build macOS DMG + ZIP
npm run build:all       # Build semua platform (Windows + macOS)
npm run dist:win        # Build Windows only
npm run dist:mac        # Build macOS only
```

---

## 📦 Windows Build (NSIS Installer)

### Perintah Build
```bash
npm run build
# atau
npm run dist:win
```

### Output
- `dist/RBA Studio Pro-Setup-1.0.0.exe` — NSIS Installer
- `dist/RBA Studio Pro-1.0.0-portable.exe` — Portable executable

### Features
- ✅ One-click uninstaller
- ✅ Desktop shortcut
- ✅ Start menu shortcut
- ✅ System-wide installation (Program Files)
- ✅ Auto file association (optional)

### Windows Troubleshooting

**Error: "icon.ico not found"**
```bash
# Pastikan ada file assets/icon.ico
# Atau disable icon temporarily:
# Edit package.json, ubah win.icon: null
```

**Error: "Cannot find scrcpy"**
- Pastikan folder `scrcpy/` ada di root project
- File akan otomatis di-copy ke aplikasi

**Error: "Installer gagal"**
- Pastikan tidak ada aplikasi RBA Studio yang berjalan
- Uninstall versi lama terlebih dahulu
- Jalankan as Administrator jika diperlukan

---

## 🍎 macOS Build (DMG)

### Perintah Build
```bash
npm run build:mac
# atau
npm run dist:mac
```

### Output
- `dist/RBA Studio Pro-1.0.0.dmg` — Installer DMG
- `dist/RBA Studio Pro-1.0.0.zip` — ZIP archive

### Requirements untuk Notarization (Optional)
Jika ingin distribute via Mac App Store:
1. Apple Developer Account
2. Certificate signing
3. Modify build config: `mac.certificateFile` dan `mac.identity`

### macOS Troubleshooting

**Error: "icon.icns not found"**
- Buat atau download `assets/icon.icns`
- Atau disable: edit package.json, ubah `mac.icon: null`

**Error: "Cannot open because it is from an unidentified developer"**
- Normal untuk unsigned builds
- User bisa bypass: System Preferences > Security & Privacy
- Untuk production, setup code signing (lihat Apple Developer docs)

**DMG tidak bisa di-drag aplikasi**
- Normal behavior, icons di-set via package.json `dmg.contents`
- User harus drag ke folder Applications

---

## 🔧 Configuration Details

### package.json Build Settings

**File Inclusion**
```json
"files": [
  "main.js",
  "renderer.js",
  "app.js",
  "auth.js",
  "flowEngine.js",
  "screenVerifier.js",
  "index.html",
  "login.html",
  "package.json",
  "node_modules/**/*"
]
```

**Extra Resources** (akan di-copy ke aplikasi)
```json
"extraResources": [
  {
    "from": "scrcpy",
    "to": "scrcpy"
  },
  {
    "from": "references",
    "to": "references"
  }
]
```

---

## 🛠️ Path Handling (Dev vs Production)

### Automatic Handling di main.js

```javascript
// NEW: Get correct base path for both dev and production
function getBasePath() {
  if (app.isPackaged) {
    return process.resourcesPath;  // Production
  } else {
    return __dirname;              // Development
  }
}
```

**Digunakan untuk:**
- Loading HTML files (login.html, index.html)
- Loading scrcpy binary
- Loading references folder

### Path Resolution Priority
1. Development: `__dirname` → current file directory
2. Production (Built): `process.resourcesPath` → app resources

---

## 📁 Project Structure (untuk Build)

```
project RBA/
├── main.js                 ✅ Will be included
├── renderer.js             ✅ Will be included
├── app.js                  ✅ Will be included
├── auth.js                 ✅ Will be included
├── flowEngine.js           ✅ Will be included
├── screenVerifier.js       ✅ Will be included
├── index.html              ✅ Will be included
├── login.html              ✅ Will be included
├── package.json            ✅ Will be included
├── scrcpy/                 ✅ extraResources
│   ├── scrcpy.exe
│   ├── adb.exe
│   └── ...
├── references/             ✅ extraResources
│   ├── screen1.png
│   └── ...
├── assets/
│   ├── icon.ico           ⚠️  Required (Windows)
│   └── icon.icns          ⚠️  Required (macOS)
├── build/
│   └── entitlements.mac.plist  (macOS signing)
├── dist/                   📦 Output folder
│   ├── RBA Studio Pro-Setup-1.0.0.exe
│   ├── RBA Studio Pro-1.0.0-portable.exe
│   ├── RBA Studio Pro-1.0.0.dmg
│   └── ...
└── node_modules/           ✅ Will be included (auto)
```

---

## 🧪 Testing Build

### Test Installer Functionality
```bash
# 1. Build
npm run build

# 2. Run installer dari dist/ folder
# - Windows: Double-click .exe
# - macOS: Double-click .dmg, drag RBA Studio Pro to Applications

# 3. Launch aplikasi dari installed location
# Test: Login → Load workflow → Run flow → Verify scrcpy accessible
```

### Common Issues During Testing
- ❌ **HTML tidak load** → Check getBasePath() fix in main.js
- ❌ **scrcpy not found** → Verify folder di extraResources
- ❌ **Files missing** → Check "files" array di build config
- ❌ **Icon missing** → Check assets/ folder

---

## 🔐 Security & Best Practices

### ✅ Do's
- ✅ Keep electron-builder updated
- ✅ Use NSIS untuk Windows (standard)
- ✅ Test installer sebelum distribute
- ✅ Sign aplikasi (recommended untuk production)
- ✅ Include version number yang clear

### ❌ Don'ts
- ❌ Jangan ubah asar setting untuk production
- ❌ Jangan commit build output (dist/) ke git
- ❌ Jangan hardcode absolute paths
- ❌ Jangan forget file inclusion di "files" array

---

## 📊 Build Output Details

### Windows
- **NSIS Installer** (.exe)
  - Ukuran: ~150-200MB (tergantung dependencies)
  - Installation time: 1-3 minutes
  - Can uninstall cleanly

- **Portable** (.exe)
  - Ukuran: ~100-150MB
  - No installation needed
  - Just extract and run

### macOS
- **DMG** (.dmg)
  - Ukuran: ~150-200MB
  - Visual installer (drag & drop)
  - Standard distribution method

- **ZIP** (.zip)
  - Ukuran: ~100-150MB
  - Alternative distribution

---

## 🚢 Distribution Tips

### Windows
1. Use NSIS installer untuk user-friendly installation
2. Include system requirements
3. Test pada Windows 10 dan 11
4. Consider code signing untuk trusted publisher badge

### macOS
1. Sign & notarize untuk Monterey+ compatibility
2. Include usage instructions
3. Test pada Intel dan Apple Silicon
4. Provide support email/website

---

## 🐛 Troubleshooting Checklist

- [ ] Icons ada di `assets/` folder?
- [ ] `scrcpy/` folder ada?
- [ ] `references/` folder ada?
- [ ] Package.json `files` array benar?
- [ ] `getBasePath()` function ada di main.js?
- [ ] HTML loadFile menggunakan basePath?
- [ ] Tidak ada error di build output?
- [ ] Installer bisa dibuka?
- [ ] Aplikasi launch dengan benar?
- [ ] scrcpy binary bisa diakses?

---

## 📞 Additional Resources

- Electron Builder Docs: https://www.electron.build/
- Electron Security: https://www.electronjs.org/docs/tutorial/security
- Code Signing (Windows): https://docs.microsoft.com/en-us/windows/apps/develop/
- Code Signing (macOS): https://developer.apple.com/support/code-signing/

---

**Last Updated:** May 5, 2026  
**Version:** 1.0.0  
**Maintainer:** Arya Septian
