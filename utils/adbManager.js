/**
 * ADBManager Singleton
 * Single source of truth for all ADB operations
 * Prevents multiple client instances and socket conflicts
 * 
 * USAGE:
 * const adbManager = require('./utils/adbManager');
 * await adbManager.listDevices();
 * await adbManager.screenshot(deviceId);
 */

const { exec } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getBundledBinaryPath(binName) {
  const suffix = os.platform() === 'win32' ? '.exe' : '';
  const fileName = `${binName}${suffix}`;
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', fileName));
    candidates.push(path.join(process.resourcesPath, 'resources', 'bin', fileName));
  }
  candidates.push(path.join(__dirname, '..', 'resources', 'bin', fileName));
  candidates.push(path.join(__dirname, '..', 'scrcpy', fileName));
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

class ADBManager {
  constructor() {
    this.lastKnownDevices = [];
    this.isRefreshing = false;
    this.consecutiveFailures = 0;
    this.adbBinary = null;
    this.refreshInterval = null;
    this.listeners = [];
    this.init();
  }

  /**
   * Initialize ADB binary location
   */
  init() {
    try {
      const candidates = [];

      // 1. Android SDK env
      const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      if (androidHome) {
        candidates.push(path.join(androidHome, 'platform-tools', os.platform()==='win32' ? 'adb.exe' : 'adb'));
      }

      // 2. ADB_PATH env (can be multiple, delimited)
      if (process.env.ADB_PATH) {
        for (const cand of process.env.ADB_PATH.split(path.delimiter).filter(Boolean)) {
          candidates.push(cand);
        }
      }

      // 3. Platform specific defaults
      if (os.platform() === 'darwin') {
        candidates.push('/opt/homebrew/bin/adb');
        candidates.push('/usr/local/bin/adb');
        candidates.push('/usr/local/Cellar/android-platform-tools/35.0.2/platform-tools/adb');
        candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
        candidates.push(path.join(os.homedir(), 'Android', 'sdk', 'platform-tools', 'adb'));
      } else if (os.platform() === 'win32') {
        candidates.push(path.join(os.homedir(),'AppData','Local','Android','Sdk','platform-tools','adb.exe'));
        candidates.push('C:\Android\platform-tools\adb.exe');
      } else {
        // linux
        candidates.push('/usr/local/bin/adb');
        candidates.push('/usr/bin/adb');
      }

      // 4. Try which/where
      try {
        const cmd = os.platform()==='win32' ? 'where adb' : 'which adb';
        const result = execSync(cmd, { stdio:['ignore','pipe','ignore'], encoding:'utf8' }).toString().trim();
        if (result) candidates.push(result.split(/\r?\n/)[0]);
      } catch(e){}

      // 5. macOS/Linux login shell PATH fallback
      if (os.platform() !== 'win32') {
        try {
          const shell = process.env.SHELL || '/bin/zsh';
          const shellPath = execSync(`${shell} -l -c "which adb"`, { stdio:['ignore','pipe','ignore'], encoding:'utf8', timeout:5000 }).toString().trim();
          if (shellPath) candidates.push(shellPath);
        } catch(e){}
      }

      // 6. Final generic candidate (plain command) - try last
      const bundledAdb = getBundledBinaryPath('adb');
      if (bundledAdb) candidates.push(bundledAdb);
      candidates.push(os.platform()==='win32' ? 'adb.exe' : 'adb');

      const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

      for (const cand of uniqueCandidates) {
        try {
          // If candidate looks like an absolute or relative path, check file exists first
          const looksLikePath = cand.includes(path.sep) || path.isAbsolute(cand);
          if (looksLikePath && !fs.existsSync(cand)) {
            continue;
          }

          // Try running `${cand} version` to verify
          execSync(`"${cand}" version`, { timeout: 3000, stdio:'ignore' });
          this.adbBinary = cand;
          console.log('[ADB] Found:', cand);
          break;
        } catch (_) {
          continue;
        }
      }

      if (!this.adbBinary) {
        console.warn('[ADB] Binary not found in any known location. ADB features will be limited until configured.');
        this.adbBinary = null;
      }

      this.startRefreshLoop();
    } catch (err) {
      console.error('[ADB] Init error:', err.message);
      setTimeout(() => this.reinitialize(), 3000);
    }
  }

  /**
   * Reinitialize ADB connection
   */
  async reinitialize() {
    console.log('[ADB] Reinitializing connection...');
    try {
      await this.killAndRestartServer();
      this.init();
      this.notifyListeners(await this.listDevices());
    } catch (err) {
      console.error('[ADB] Reinitialize failed:', err.message);
    }
  }

  /**
   * Kill and restart ADB server
   */
  killAndRestartServer() {
    return new Promise((resolve) => {
      exec(`"${this.adbBinary}" kill-server`, () => {
        setTimeout(() => {
          exec(`"${this.adbBinary}" start-server`, () => {
            setTimeout(resolve, 1000);
          });
        }, 500);
      });
    });
  }

  /**
   * Start device detection refresh loop
   */
  startRefreshLoop() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);

    this.refreshInterval = setInterval(async () => {
      if (this.isRefreshing) return;

      this.isRefreshing = true;
      try {
        const devices = await this.listDevices();
        this.lastKnownDevices = devices;
        this.consecutiveFailures = 0;
        this.notifyListeners(devices);
      } catch (err) {
        console.warn('[ADB] Refresh error:', err.message);
        this.consecutiveFailures++;
        
        // Auto-recover after 3 consecutive failures
        if (this.consecutiveFailures >= 3) {
          this.consecutiveFailures = 0;
          console.log('[ADB] Auto-recovery triggered');
          await this.reinitialize();
        }
      } finally {
        this.isRefreshing = false;
      }
    }, 5000);
  }

  /**
   * List connected ADB devices
   */
  async listDevices() {
    if (!this.adbBinary) throw new Error('ADB binary not found');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Device list timeout'));
      }, 4000);

      exec(`"${this.adbBinary}" devices`, { encoding: 'utf8' }, (err, stdout) => {
        clearTimeout(timeoutId);
        
        if (err) {
          reject(new Error(err.message || 'Failed to list devices'));
          return;
        }

        try {
          const devices = stdout
            .split('\n')
            .slice(1)
            .map(l => l.trim())
            .filter(l => l && l.includes('\tdevice'))
            .map(l => l.split(/\s+/)[0]);
          resolve(devices);
        } catch (e) {
          reject(new Error('Failed to parse device list: ' + e.message));
        }
      });
    });
  }

  /**
   * Get device screenshot as base64
   */
  async screenshot(deviceId, timeout = 20000) {
    if (!this.adbBinary) throw new Error('ADB binary not found');
    if (!deviceId) throw new Error('Device ID required');

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(null); // Return null on timeout instead of throwing
      }, timeout + 5000);

      exec(`"${this.adbBinary}" -s "${deviceId}" exec-out screencap -p`, {
        encoding: 'buffer',
        maxBuffer: 100 * 1024 * 1024,
        timeout: timeout
      }, (err, stdout) => {
        clearTimeout(timeoutId);
        
        if (err) {
          console.error('[ADB Screenshot] Error:', err.message);
          resolve(null);
        } else {
          try {
            const base64 = Buffer.from(stdout).toString('base64');
            resolve(base64);
          } catch (e) {
            console.error('[ADB Screenshot] Parse error:', e.message);
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * Get device screen size
   */
  async getScreenSize(deviceId) {
    if (!this.adbBinary) throw new Error('ADB binary not found');
    if (!deviceId) throw new Error('Device ID required');

    return new Promise((resolve) => {
      exec(`"${this.adbBinary}" -s "${deviceId}" shell wm size`, {
        encoding: 'utf8',
        timeout: 5000
      }, (err, stdout) => {
        if (err) {
          console.warn('[ADB ScreenSize] Error:', err.message);
          // Return default size on error
          resolve({ width: 1080, height: 1920 });
        } else {
          try {
            const match = stdout.match(/(\d+)x(\d+)/);
            if (match) {
              resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
            } else {
              resolve({ width: 1080, height: 1920 });
            }
          } catch (e) {
            resolve({ width: 1080, height: 1920 });
          }
        }
      });
    });
  }

  /**
   * Tap on device screen
   */
  async tap(deviceId, x, y) {
    if (!this.adbBinary) throw new Error('ADB binary not found');
    if (!deviceId) throw new Error('Device ID required');

    return new Promise((resolve) => {
      exec(`"${this.adbBinary}" -s "${deviceId}" shell input tap ${x} ${y}`, {
        encoding: 'utf8',
        timeout: 5000
      }, (err) => {
        resolve({ success: !err, error: err?.message || '' });
      });
    });
  }

  /**
   * Register device change listener
   */
  onDevicesChange(callback) {
    this.listeners.push(callback);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Notify all listeners of device changes
   */
  notifyListeners(devices) {
    this.listeners.forEach(cb => {
      try {
        cb(devices);
      } catch (err) {
        console.error('[ADB] Listener error:', err.message);
      }
    });
  }

  /**
   * Get last known devices (cached)
   */
  getCachedDevices() {
    return this.lastKnownDevices;
  }

  /**
   * Cleanup on app shutdown
   */
  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.listeners = [];
  }
}

// SINGLETON — only one instance ever
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ADBManager();
  }
  return instance;
}

module.exports = getInstance();

// Cleanup on process exit
process.on('exit', () => {
  getInstance().cleanup();
});
