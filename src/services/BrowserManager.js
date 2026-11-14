const { BrowserWindow } = require('electron');
const net = require('net');

function normalizeProfileKey(profileKey, url) {
  if (profileKey && String(profileKey).trim()) {
    return String(profileKey).trim();
  }
  if (url && typeof url === 'string') {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (err) {
      return 'default';
    }
  }
  return 'default';
}

class BrowserSessionManager {
  constructor() {
    this.sessions = new Map();
    this.lastActiveProfileKey = null;
  }

  async connect(debugPort = 9222) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: Number(debugPort) || 9222 }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', (err) => {
        reject(new Error(`Tidak bisa konek ke browser: ${err.message}`));
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Tidak bisa konek ke browser di port ${debugPort}`));
      }, 2500);
      socket.on('close', () => clearTimeout(timer));
    });
  }

  async getOrCreate(profileKey, opts = {}) {
    const key = normalizeProfileKey(profileKey, opts.url || profileKey);
    this.lastActiveProfileKey = key;
    const existing = this.sessions.get(key);
    if (existing) {
      const alive = await this._isAlive(existing);
      if (alive) {
        return { session: existing, status: 'reused' };
      }
      await this.close(key);
    }

    const win = new BrowserWindow({
      width: opts.width || 1280,
      height: opts.height || 900,
      show: opts.show !== false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const session = {
      profileKey: key,
      window: win,
      ready: false,
      loading: false,
      lastUrl: '',
      createdAt: Date.now(),
    };

    win.on('closed', () => {
      this.sessions.delete(key);
    });

    win.webContents.on('did-finish-load', () => {
      session.ready = true;
      session.loading = false;
    });
    win.webContents.on('did-fail-load', () => {
      session.ready = false;
      session.loading = false;
    });

    this.sessions.set(key, session);
    return { session, status: 'created' };
  }

  get(profileKey) {
    return this.sessions.get(normalizeProfileKey(profileKey)) || null;
  }

  getAll() {
    return Array.from(this.sessions.values());
  }

  async navigate(profileKey, url, timeoutMs = 15000) {
    const session = this.get(profileKey);
    if (!session) return { success: false, error: 'Browser session tidak ditemukan' };
    session.ready = false;
    session.loading = true;
    session.lastUrl = url;

    const win = session.window;
    return new Promise((resolve) => {
      let timer = null;
      const cleanup = () => {
        win.webContents.removeListener('did-finish-load', onFinish);
        win.webContents.removeListener('did-fail-load', onFail);
        if (timer) clearTimeout(timer);
      };

      const onFinish = () => {
        cleanup();
        session.ready = true;
        session.loading = false;
        resolve({ success: true });
      };
      const onFail = (_, errorCode, errorDescription) => {
        cleanup();
        session.ready = false;
        session.loading = false;
        resolve({ success: false, error: errorDescription || 'Load gagal: ' + errorCode });
      };

      win.webContents.once('did-finish-load', onFinish);
      win.webContents.once('did-fail-load', onFail);
      timer = setTimeout(() => {
        cleanup();
        session.loading = false;
        resolve({ success: false, error: `Timeout setelah ${timeoutMs}ms` });
      }, timeoutMs);

      win.loadURL(url).catch((err) => {
        cleanup();
        session.loading = false;
        resolve({ success: false, error: err.message || String(err) });
      });
    });
  }

  async click(profileKey, { selector, clickType = 'single', timeoutMs = 10000 } = {}) {
    const session = this.get(profileKey);
    if (!session) return { success: false, error: 'Browser session tidak ditemukan' };
    if (!selector || !String(selector).trim()) return { success: false, error: 'Selector kosong' };

    const script = `
      (async () => {
        const selector = ${JSON.stringify(selector)};
        const clickType = ${JSON.stringify(clickType)};
        const timeout = ${timeoutMs};
        const isXPath = selector.trim().startsWith('/') || selector.trim().startsWith('//');

        function findElement() {
          try {
            if (isXPath) {
              const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return result.snapshotLength > 0 ? result.snapshotItem(0) : null;
            }
            return document.querySelector(selector);
          } catch (err) {
            throw new Error('Invalid selector/XPath: ' + err.message);
          }
        }

        const start = Date.now();
        let element = findElement();
        while (!element) {
          if (Date.now() - start >= timeout) {
            throw new Error('Element tidak ditemukan: ' + selector);
          }
          await new Promise(resolve => setTimeout(resolve, 250));
          element = findElement();
        }

        element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        await new Promise(resolve => setTimeout(resolve, 150));

        if (clickType === 'double') {
          element.dispatchEvent(new MouseEvent('dblclick', { view: window, bubbles: true, cancelable: true }));
        } else if (clickType === 'right') {
          element.dispatchEvent(new MouseEvent('contextmenu', { view: window, bubbles: true, cancelable: true, button: 2 }));
        } else {
          element.click();
        }

        return { success: true };
      })();
    `;

    try {
      const result = await session.window.webContents.executeJavaScript(script, true);
      return result && result.success ? result : { success: false, error: result?.error || 'Click JS execution failed' };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  async fillInputByCssSelector(profileKeyOrSelector, selectorOrValue, valueOrTimeout, timeoutMs) {
    if (arguments.length === 3 || typeof profileKeyOrSelector !== 'string' || !this.sessions.has(profileKeyOrSelector)) {
      const selector = profileKeyOrSelector;
      const value = selectorOrValue;
      const delayAfter = valueOrTimeout || 300;
      const profileKey = this.lastActiveProfileKey || 'default';
      
      const result = await this._fillInputByCssSelectorDirect(profileKey, selector, value, 10000);
      if (delayAfter > 0) {
        await new Promise(r => setTimeout(r, delayAfter));
      }
      return result;
    } else {
      return this._fillInputByCssSelectorDirect(profileKeyOrSelector, selectorOrValue, valueOrTimeout, timeoutMs);
    }
  }

  async _fillInputByCssSelectorDirect(profileKey, selector, value, timeoutMs = 10000) {
    const session = this.get(profileKey);
    if (!session) throw new Error('Browser session tidak ditemukan');
    if (!selector || !String(selector).trim()) throw new Error('Selector kosong');

    const script = `
      (async () => {
        const selector = ${JSON.stringify(selector)};
        const value = ${JSON.stringify(value)};
        const timeout = ${timeoutMs};
        const isXPath = selector.trim().startsWith('/') || selector.trim().startsWith('//');

        function findElement() {
          try {
            if (isXPath) {
              const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              return result.snapshotLength > 0 ? result.snapshotItem(0) : null;
            }
            return document.querySelector(selector);
          } catch (err) {
            throw new Error('Invalid selector/XPath: ' + err.message);
          }
        }

        const start = Date.now();
        let element = findElement();
        while (!element) {
          if (Date.now() - start >= timeout) {
            throw new Error('Element tidak ditemukan: ' + selector);
          }
          await new Promise(resolve => setTimeout(resolve, 250));
          element = findElement();
        }

        if ('value' in element) {
          element.focus();
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        if (element.isContentEditable) {
          element.focus();
          document.execCommand('insertText', false, value);
          return { success: true };
        }
        throw new Error('Elemen tidak mendukung input teks');
      })();
    `;

    const result = await session.window.webContents.executeJavaScript(script, true);
    if (!result || !result.success) {
      throw new Error(result?.error || 'Gagal mengisi input');
    }
    return result;
  }

  async clickByCssSelector(selector, delayAfter = 300) {
    const profileKey = this.lastActiveProfileKey || 'default';
    const result = await this.click(profileKey, { selector, clickType: 'single', timeoutMs: 10000 });
    if (!result || !result.success) {
      throw new Error(result?.error || `Gagal klik css selector: ${selector}`);
    }
    if (delayAfter > 0) {
      await new Promise(r => setTimeout(r, delayAfter));
    }
    return result;
  }

  async focusTabByUrl(url, matchMode = 'contains') {
    const profileKey = normalizeProfileKey(undefined, url);
    this.lastActiveProfileKey = profileKey;
    const { session } = await this.getOrCreate(profileKey, { show: true });
    const nav = await this.navigate(profileKey, url, 20000);
    if (!nav.success) {
      throw new Error(nav.error || `Gagal membuka URL: ${url}`);
    }
    return { title: url, url, profileKey };
  }

  async close(profileKey) {
    const session = this.get(profileKey);
    if (!session) return { success: true };
    try {
      if (!session.window.isDestroyed()) {
        session.window.close();
      }
    } catch (err) {
      console.warn('[BrowserSession] close error:', err);
    }
    this.sessions.delete(profileKey);
    return { success: true };
  }

  async closeAll() {
    for (const key of Array.from(this.sessions.keys())) {
      await this.close(key);
    }
  }

  async _isAlive(session) {
    if (!session || !session.window || session.window.isDestroyed()) return false;
    try {
      return await session.window.webContents.executeJavaScript('true', true) === true;
    } catch {
      return false;
    }
  }
}

module.exports = new BrowserSessionManager();
