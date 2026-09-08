# RBA Studio Pro — Build Setup Checklist ✅

## Pre-Build Setup (One-time)

### 1. Install Prerequisites
- [ ] Node.js 16+ installed (`node --version`)
- [ ] npm 7+ installed (`npm --version`)
- [ ] Git installed (if using version control)

### 2. Project Structure Verification
```
project RBA/
├── main.js                      ✅
├── app.js                       ✅
├── renderer.js                  ✅
├── auth.js                      ✅
├── flowEngine.js                ✅
├── screenVerifier.js            ✅
├── index.html                   ✅
├── login.html                   ✅
├── package.json                 ✅
├── scrcpy/                      ✅ (CRITICAL for functionality)
│   ├── scrcpy.exe / scrcpy
│   ├── adb.exe / adb
│   └── ... (other scrcpy files)
├── references/                  ✅ (Optional but recommended)
├── assets/                      ⚠️  REQUIRED
│   ├── icon.ico                 (Windows - 256x256 minimum)
│   └── icon.icns                (macOS - optional but recommended)
├── build/                       ✅
│   └── entitlements.mac.plist  (macOS support)
└── build-helper.sh              ✅
```

- [ ] Verify all files are present
- [ ] Check scrcpy folder has executable files
- [ ] Check icon files exist in assets/

### 3. Create Assets Folder (if not exists)
```bash
mkdir -p assets
# Then add:
# - icon.ico (for Windows)
# - icon.icns (for macOS, optional)
```

**Icon Requirements:**
- Windows (icon.ico): 256x256 pixels minimum, ICO format
- macOS (icon.icns): 512x512 pixels minimum, ICNS format

### 4. Verify package.json Updates
- [ ] Check build scripts exist (npm run build, npm run build:mac, etc.)
- [ ] Check "files" array includes all source files
- [ ] Check "extraResources" includes scrcpy/ folder
- [ ] Check paths use correct format

### 5. Verify main.js Updates
- [ ] getBasePath() function exists
- [ ] createWindow() uses basePath for HTML loading
- [ ] auth-login handler uses basePath for index.html
- [ ] scrcpy path detection uses getBasePath()

---

## Build Execution

### Option A: Using Helper Script (Recommended)
```bash
# Make script executable (one time)
chmod +x build-helper.sh

# Build Windows
./build-helper.sh windows

# Build macOS
./build-helper.sh mac

# Build both
./build-helper.sh all
```

### Option B: Direct Commands
```bash
# Install dependencies (first time)
npm install

# Build Windows NSIS installer + portable
npm run build
npm run dist:win

# Build macOS DMG + ZIP
npm run build:mac
npm run dist:mac

# Build both
npm run build:all
npm run dist
```

---

## Post-Build Verification

### Artifacts Created ✅
After build, check `dist/` folder contains:

**Windows:**
- [ ] `RBA Studio Pro-Setup-1.0.0.exe` (NSIS installer)
- [ ] `RBA Studio Pro-1.0.0-portable.exe` (portable)

**macOS:**
- [ ] `RBA Studio Pro-1.0.0.dmg` (installer)
- [ ] `RBA Studio Pro-1.0.0.zip` (archive)

### Testing Windows Build
```bash
# 1. Run NSIS installer
"dist/RBA Studio Pro-Setup-1.0.0.exe"

# 2. Follow installation wizard
# 3. Launch from Start Menu or Desktop
# 4. Test:
#    ✓ Login works
#    ✓ UI loads correctly
#    ✓ scrcpy command works (optional: test with ADB)
```

### Testing macOS Build
```bash
# 1. Open DMG
open "dist/RBA Studio Pro-1.0.0.dmg"

# 2. Drag RBA Studio Pro to Applications
# 3. Launch from Applications
# 4. Approve security prompt if needed
# 5. Test same as Windows
```

---

## Common Issues & Solutions

### ❌ Issue: "icon.ico not found"
**Solution:**
1. Create/download `assets/icon.ico`
2. Or edit `package.json`, set `"icon": null` under `win`
3. Rebuild

### ❌ Issue: "scrcpy folder not found"
**Solution:**
1. Ensure `scrcpy/` folder exists in project root
2. Check that executable files are present
3. Rebuild

### ❌ Issue: "HTML file not found" (after installation)
**Solution:**
1. Verify getBasePath() function in main.js
2. Check createWindow() uses basePath
3. Verify "files" array includes HTML files
4. Rebuild

### ❌ Issue: Installer is very large (>300MB)
**Solution:**
1. Check node_modules size: `du -sh node_modules/`
2. Consider using npm ci instead of npm install
3. Remove unnecessary dependencies
4. Rebuild

### ❌ Issue: "Cannot open application" (macOS)
**Solution:**
1. Open System Preferences > Security & Privacy
2. Click "Open Anyway"
3. For production: sign and notarize application
4. See macOS troubleshooting in BUILD_GUIDE.md

---

## Production Distribution

### Before Distribute
- [ ] Test installer on target OS
- [ ] Verify all features work (login, flows, scrcpy)
- [ ] Check version number is correct
- [ ] Test on different hardware if possible

### Distribution Methods
1. **Direct Download** → Upload .exe/.dmg to website
2. **GitHub Releases** → Use GitHub Releases tab
3. **Installer Services** → Use Inno Setup (Windows), Sparkle (macOS)
4. **Code Signing** → For trusted distribution (optional but recommended)

### Recommended Versioning
```
package.json: "version": "1.0.0"
→ Generates: RBA Studio Pro-Setup-1.0.0.exe, RBA Studio Pro-1.0.0.dmg
```

Update version with each release:
- Major: `1.0.0` → significant features
- Minor: `1.1.0` → feature additions
- Patch: `1.0.1` → bug fixes

---

## Maintenance & Updates

### For Next Versions
```bash
# 1. Update version in package.json
# 2. Test locally: npm start
# 3. Build: npm run build:all
# 4. Test installers
# 5. Distribute new .exe/.dmg files
```

### Keeping Dependencies Fresh
```bash
# Check for updates
npm outdated

# Update safely (respects package.json ranges)
npm update

# Update specific package
npm install package-name@latest
```

---

## Support & Documentation

- **Build Guide:** See [BUILD_GUIDE.md](BUILD_GUIDE.md)
- **electron-builder Docs:** https://www.electron.build/
- **Electron Security:** https://www.electronjs.org/docs/tutorial/security
- **Troubleshooting:** Check BUILD_GUIDE.md troubleshooting section

---

## Completion Status

When all items are checked ✅, your build system is ready!

```
Setup Phase:        ■■■■■■■■■■ 100%
Build Phase:        Ready
Distribution Phase: Ready
```

**Estimated Time:** 5-10 minutes for first build  
**Support:** Contact Arya Septian for issues  
**Last Updated:** May 5, 2026
