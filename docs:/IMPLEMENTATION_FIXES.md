# RBA STUDIO PRO - IMPLEMENTATION FIXES
**Quick Reference for Deployment Issues**

---

## URGENT FIX #1: Update package.json Build Configuration

Replace the entire `"build"` section in `package.json`:

### BEFORE (❌ Current):
```json
"scripts": {
  "start": "electron .",
  "build": "electron-builder --win --x64",
  "rebuild": "electron-rebuild -f -w robotjs,uiohook-napi",
  "predist": "npm run rebuild"
},
"build": {
  "appId": "com.rba.studio.pro",
  "productName": "RBA Studio Pro",
  "npmRebuild": false,
  "nodeGypRebuild": false,
  "buildDependenciesFromSource": false,
  "asarUnpack": [
    "node_modules/bcryptjs/**",
    "node_modules/jimp/**",
    "node_modules/robotjs/**",
    "node_modules/uiohook-napi/**",
    "node_modules/node-window-manager/**"
  ]
}
```

### AFTER (✅ Fixed):
```json
"scripts": {
  "start": "electron .",
  "build": "npm run rebuild && electron-builder --win --x64",
  "rebuild": "electron-rebuild -f -w robotjs,uiohook-napi"
},
"build": {
  "appId": "com.rba.studio.pro",
  "productName": "RBA Studio Pro",
  "npmRebuild": true,
  "nodeGypRebuild": true,
  "buildDependenciesFromSource": true,
  "asarUnpack": [
    "node_modules/bcryptjs/**",
    "node_modules/jimp/**",
    "node_modules/robotjs/**",
    "node_modules/uiohook-napi/**",
    "node_modules/node-window-manager/**",
    "node_modules/whatsapp-web.js/**",
    "node_modules/qrcode/**",
    "node_modules/tesseract.js/**"
  ]
}
```

---

## URGENT FIX #2: Add macOS Permission Prompt at Startup

Add this code to `main.js` in the `app.on('ready', ...)` section (around line 2000+):

```javascript
// Add after window is created, before mainWindow.loadURL()

if (process.platform === 'darwin') {
  // Check if Accessibility permission is granted
  const isAccessibilityGranted = systemPreferences.isTrustedAccessibilityClient(false);
  
  if (!isAccessibilityGranted) {
    console.log('[STARTUP] Accessibility permission not granted, requesting...');
    
    // Show info dialog
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Accessibility Permission Required',
      message: 'RBA Studio Pro needs Accessibility permission to use Macro Recorder.',
      detail: 'This will open System Preferences. Please:\n\n1. Find "RBA Studio Pro" in the list\n2. Check the checkbox next to it\n3. Close System Preferences\n4. Restart RBA Studio Pro\n\nThis is required for keyboard & mouse recording.',
      buttons: ['Open System Preferences', 'Remind Me Later']
    }).then(result => {
      if (result.response === 0) {
        // Request permission and open settings
        systemPreferences.isTrustedAccessibilityClient(true);
        // Open System Preferences directly to Accessibility
        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      }
    });
  }
}
```

---

## FIX #3: Add Startup Dependency Validation

Add this function to `main.js` (after the DevicePool class definition, around line 370):

```javascript
// ───────────────────────────────────────────────
// DEPENDENCY VALIDATION
// ───────────────────────────────────────────────

function validateCriticalDependencies() {
  console.log('[STARTUP] Validating critical dependencies...');
  
  const issues = [];
  
  // Check Macro Recorder dependencies
  try {
    require('robotjs');
  } catch (e) {
    issues.push({
      feature: 'Macro Recorder',
      module: 'robotjs',
      error: e.message,
      severity: 'error'
    });
  }
  
  try {
    require('uiohook-napi');
  } catch (e) {
    issues.push({
      feature: 'Macro Recorder',
      module: 'uiohook-napi',
      error: e.message,
      severity: 'error'
    });
  }
  
  // Check WhatsApp Bot dependencies
  try {
    require('whatsapp-web.js');
  } catch (e) {
    issues.push({
      feature: 'WhatsApp Bot',
      module: 'whatsapp-web.js',
      error: e.message,
      severity: 'warning'
    });
  }
  
  // Check Macro Storage
  try {
    const macroDir = path.join(app.getPath('userData'), 'macros');
    if (!fs.existsSync(macroDir)) {
      fs.mkdirSync(macroDir, { recursive: true });
    }
  } catch (e) {
    issues.push({
      feature: 'Macro Storage',
      module: 'filesystem',
      error: e.message,
      severity: 'warning'
    });
  }
  
  if (issues.length > 0) {
    console.warn('[STARTUP] Dependency issues detected:');
    issues.forEach(issue => {
      console.warn(`  [${issue.severity.toUpperCase()}] ${issue.feature}: ${issue.module}`);
      console.warn(`    └─ ${issue.error}`);
    });
    
    // Send to renderer
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('startup-issues', { issues });
    }
  } else {
    console.log('[STARTUP] ✅ All critical dependencies validated');
  }
  
  return issues;
}

// Call this in app.on('ready'):
app.on('ready', async () => {
  // ... existing code ...
  
  validateCriticalDependencies();  // ← ADD THIS LINE
  
  // ... rest of ready handler ...
});
```

---

## FIX #4: Add WhatsApp Session Persistence

Update the WhatsApp bot initialization in `main.js`. Find the section with `waClient` (around line 650) and update:

```javascript
// BEFORE (may be missing session path):
let waClient = null;

// AFTER (with proper session management):
let waClient = null;
const waSessionPath = path.join(app.getPath('userData'), 'wa-session');

// Ensure session directory exists
if (!fs.existsSync(waSessionPath)) {
  try {
    fs.mkdirSync(waSessionPath, { recursive: true });
    console.log('[WA] Session directory created:', waSessionPath);
  } catch (e) {
    console.warn('[WA] Failed to create session directory:', e.message);
  }
}

// Create client with proper session persistence
function createWhatsAppClient() {
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    
    waClient = new Client({
      authStrategy: new LocalAuth({
        clientId: 'rba-studio-pro',
        dataPath: waSessionPath
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });
    
    console.log('[WA] Client created with session path:', waSessionPath);
    return waClient;
  } catch (e) {
    console.error('[WA] Failed to create client:', e.message);
    throw e;
  }
}
```

---

## FIX #5: Build Pre-Check Script

Create a new file: `scripts/pre-build-check.js`

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📋 RBA Studio Pro - Pre-Build Validation\n');

let hasErrors = false;

// Check 1: package.json config
console.log('Checking package.json configuration...');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (pkg.build.npmRebuild !== true) {
    console.error('  ❌ npmRebuild should be true');
    hasErrors = true;
  } else {
    console.log('  ✅ npmRebuild: true');
  }
  
  if (pkg.build.nodeGypRebuild !== true) {
    console.error('  ❌ nodeGypRebuild should be true');
    hasErrors = true;
  } else {
    console.log('  ✅ nodeGypRebuild: true');
  }
  
  const requiredModules = [
    'robotjs',
    'uiohook-napi',
    'whatsapp-web.js',
    'qrcode',
    'tesseract.js'
  ];
  
  const missing = requiredModules.filter(m => 
    !pkg.build.asarUnpack.some(p => p.includes(m))
  );
  
  if (missing.length > 0) {
    console.error(`  ❌ Missing asarUnpack entries: ${missing.join(', ')}`);
    hasErrors = true;
  } else {
    console.log('  ✅ All required modules in asarUnpack');
  }
} catch (e) {
  console.error('  ❌ Error reading package.json:', e.message);
  hasErrors = true;
}

// Check 2: node_modules exist
console.log('\nChecking node_modules...');
const criticalModules = [
  'robotjs',
  'uiohook-napi',
  'whatsapp-web.js',
  'electron-rebuild'
];

for (const mod of criticalModules) {
  const modPath = path.join('node_modules', mod);
  if (fs.existsSync(modPath)) {
    console.log(`  ✅ ${mod}`);
  } else {
    console.error(`  ❌ ${mod} not found`);
    hasErrors = true;
  }
}

// Check 3: Platform requirements
console.log('\nChecking platform requirements...');
const platform = process.platform;

if (platform === 'darwin') {
  try {
    execSync('xcode-select --version', { stdio: 'pipe' });
    console.log('  ✅ Xcode CLI tools found');
  } catch {
    console.error('  ⚠️  Xcode CLI tools not found. Install with: xcode-select --install');
  }
} else if (platform === 'win32') {
  try {
    execSync('where cl.exe', { stdio: 'pipe' });
    console.log('  ✅ C++ build tools found');
  } catch {
    console.error('  ⚠️  C++ build tools not found. Install Visual Studio Build Tools');
  }
}

// Results
console.log('\n' + '='.repeat(50));
if (hasErrors) {
  console.error('❌ Pre-build check FAILED. Fix issues above before building.');
  process.exit(1);
} else {
  console.log('✅ Pre-build check PASSED. Ready to build!');
  console.log('\nNext steps:');
  console.log('  1. npm run rebuild');
  console.log('  2. npm run build');
}
```

Add to `package.json` scripts:
```json
"scripts": {
  "start": "electron .",
  "precheck": "node scripts/pre-build-check.js",
  "build": "npm run precheck && npm run rebuild && electron-builder --win --x64",
  "rebuild": "electron-rebuild -f -w robotjs,uiohook-napi"
}
```

---

## TESTING CHECKLIST

After applying fixes:

### Test 1: Build Process
```bash
npm run rebuild
# ✅ Should show: "rebuilt: robotjs@0.7.1, uiohook-napi@1.5.5"

npm run build
# ✅ Should complete without errors
# ✅ Check that rebuilt modules are in app.asar.unpacked/
```

### Test 2: Macro Recorder (First Device)
```
1. Launch app
2. Tools → Macro Recorder → Start Recording
   ✅ Should NOT show "uiohook-napi" error
   ✅ Should say "Recording started"
3. Move mouse, click, type something
4. Tools → Macro Recorder → Stop Recording
   ✅ Should show events recorded
```

### Test 3: Macro Recorder (Second Device)
```
1. Copy built app to another device
2. Launch app
3. Tools → Macro Recorder → Start Recording
   ✅ Should work WITHOUT errors
   ✅ macOS: If permission prompt appears:
      - Click "Open Preferences"
      - Enable in System Preferences
      - Restart app
      - Try again
```

### Test 4: WhatsApp Bot
```
1. Tools → WhatsApp Bot → Connect
   ✅ Should show QR code (not module error)
2. Scan with phone
   ✅ Should connect
3. Session saved to: ~/.../wa-session/
   ✅ Can verify by checking folder exists
```

### Test 5: Clear Cache
```
1. Tools → Settings → Clear Cache
   ✅ Should show: "X files deleted"
2. On second device:
   ✅ Should also work correctly
```

---

## ROLLOUT PLAN

### Phase 1: Fix & Validate (Dev Machine)
- [ ] Apply all 5 fixes above
- [ ] Run `npm run precheck`
- [ ] Build locally: `npm run build`
- [ ] Test all features on dev machine
- [ ] Verify in app.asar.unpacked/ folder:
  - [ ] robotjs.node exists
  - [ ] uiohook-napi folder exists
  - [ ] whatsapp-web.js folder exists

### Phase 2: Test on Different Devices
- [ ] Copy build to Windows device → Test Macro Recorder
- [ ] Copy build to macOS device → Test with Accessibility permission
- [ ] Copy build to Linux device → Test basic features

### Phase 3: Release
- [ ] Document system requirements in README.md
- [ ] Create BUILD_INSTRUCTIONS.md for users
- [ ] Tag new version
- [ ] Release build

---

## QUICK REFERENCE: Build Commands

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Rebuild native modules (CRITICAL)
npm run rebuild

# Full build sequence
npm run precheck && npm run rebuild && npm run build

# Build for specific platform
npm run build -- --win      # Windows
npm run build -- --mac      # macOS
npm run build -- --linux    # Linux
```

---

## TROUBLESHOOTING

### Issue: "robotjs not found" after build
**Solution:** 
```bash
rm -rf node_modules
npm install
npm run rebuild
npm run build
```

### Issue: "Missing module" on second device
**Solution:**
1. Check `asarUnpack` in package.json includes the module
2. Verify in built app: `Inspect app.asar.unpacked/ folder`
3. If missing: `npm run rebuild && npm run build`

### Issue: macOS "permission denied" for Macro Recorder
**Solution:**
1. System Preferences → Privacy & Security → Accessibility
2. Find "RBA Studio Pro"
3. Check the checkbox
4. Restart RBA Studio Pro

### Issue: WhatsApp session not persisting
**Solution:**
1. Check folder exists: `~/.../wa-session/`
2. Verify `whatsapp-web.js` is unpacked: `app.asar.unpacked/whatsapp-web.js/`
3. Rebuild and redeploy

---

**Last Updated:** 2026-07-15  
**Status:** READY TO IMPLEMENT ✅
