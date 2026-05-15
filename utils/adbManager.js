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
      const candidates = process.platform === 'win32'
        ? ['adb.exe', 'C:\\Android\\platform-tools\\adb.exe']
        : ['/opt/homebrew/bin/adb', '/usr/local/bin/adb', 'adb'];
      
      for (const bin of candidates) {
        try {
          execSync(`"${bin}" version`, { timeout: 2000, stdio: 'ignore' });
          this.adbBinary = bin;
          console.log('[ADB] Found:', bin);
          break;
        } catch (e) {
          // Try next candidate
        }
      }
      
      if (!this.adbBinary) {
        console.warn('[ADB] Binary not found, will fall back to PATH');
        this.adbBinary = 'adb';
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
