/*
 WindowsAutomation service
 Provides desktop automation helpers for Windows using robotjs and node-window-manager (optional).
 All functions include try/catch and throw informative errors.

 Note: Requires native modules. Rebuild for Electron using @electron/rebuild.
*/

const robot = (() => {
  try { return require('robotjs'); } catch (e) { return null; }
})();
let windowManager = null;
try {
  windowManager = require('node-window-manager');
} catch (e) {
  windowManager = null;
}
const clipboardy = (() => { try { return require('clipboardy'); } catch (e) { return null; } })();

function ensureRobot() {
  if (!robot) throw new Error('robotjs belum terinstall atau gagal diload. Jalankan npm install robotjs dan rebuild untuk Electron.');
}

function ensureWindowManager() {
  if (!windowManager) throw new Error('node-window-manager belum terinstall. Beberapa fitur fokus window tidak tersedia.');
}

module.exports = {
  async focusWindow(windowTitle, timeout = 5000) {
    try {
      ensureWindowManager();
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const wins = windowManager.Window.getWindows();
        const found = wins.find(w => String(w.getTitle() || '').toLowerCase().includes(String(windowTitle || '').toLowerCase()));
        if (found) {
          found.bringToTop();
          try { found.focus(); } catch (_) {}
          return true;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    } catch (err) {
      throw new Error('focusWindow error: ' + err.message);
    }
  },

  async clickAt(x, y, clickType = 'left') {
    try {
      ensureRobot();
      robot.moveMouseSmooth(Math.round(x), Math.round(y));
      await new Promise(r => setTimeout(r, 60));
      robot.mouseClick(clickType === 'right' ? 'right' : 'left');
      return true;
    } catch (err) {
      throw new Error('clickAt error: ' + err.message);
    }
  },

  async clickRelativeToWindow(windowTitle, relX, relY, clickType = 'left') {
    try {
      ensureWindowManager();
      ensureRobot();
      const wins = windowManager.Window.getWindows();
      const found = wins.find(w => String(w.getTitle() || '').toLowerCase().includes(String(windowTitle || '').toLowerCase()));
      if (!found) throw new Error(`Window "${windowTitle}" tidak ditemukan`);
      const bounds = found.getBounds();
      const absX = Math.round(bounds.x + (Number(relX) || 0));
      const absY = Math.round(bounds.y + (Number(relY) || 0));
      robot.moveMouseSmooth(absX, absY);
      await new Promise(r => setTimeout(r, 60));
      robot.mouseClick(clickType === 'right' ? 'right' : 'left');
      return true;
    } catch (err) {
      throw new Error('clickRelativeToWindow error: ' + err.message);
    }
  },

  async pasteFromClipboard() {
    try {
      ensureRobot();
      // Prefer using keyboard paste (Ctrl+V)
      robot.keyTap('v', process.platform === 'darwin' ? 'command' : 'control');
      return true;
    } catch (err) {
      throw new Error('pasteFromClipboard error: ' + err.message);
    }
  },

  async typeText(text) {
    try {
      ensureRobot();
      if (typeof text !== 'string') text = String(text || '');
      robot.typeString(text);
      return true;
    } catch (err) {
      throw new Error('typeText error: ' + err.message);
    }
  },

  async pressKey(key, modifiers = []) {
    try {
      ensureRobot();
      const mods = Array.isArray(modifiers) ? modifiers : [modifiers];
      robot.keyTap(String(key), mods);
      return true;
    } catch (err) {
      throw new Error('pressKey error: ' + err.message);
    }
  },

  async handleFileDialog(filePath) {
    try {
      ensureRobot();
      if (!filePath) throw new Error('handleFileDialog: filePath kosong');
      // Type file path then press Enter
      robot.typeString(String(filePath));
      await new Promise(r => setTimeout(r, 120));
      robot.keyTap('enter');
      return true;
    } catch (err) {
      throw new Error('handleFileDialog error: ' + err.message);
    }
  },

  async waitForWindow(title, timeout = 10000) {
    try {
      ensureWindowManager();
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const wins = windowManager.Window.getWindows();
        const found = wins.find(w => String(w.getTitle() || '').toLowerCase().includes(String(title || '').toLowerCase()));
        if (found) return true;
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    } catch (err) {
      throw new Error('waitForWindow error: ' + err.message);
    }
  },

  // Helper used by main IPC for coordinate capture: polls mouse and tries to detect click
  async captureClickCoordinates(timeout = 4000) {
    try {
      ensureRobot();
      const start = Date.now();
      let lastPos = robot.getMousePos();
      while (Date.now() - start < timeout) {
        const pos = robot.getMousePos();
        // Simple heuristic: if mouse position changed significantly and then stable -> treat as click
        if (pos.x !== lastPos.x || pos.y !== lastPos.y) {
          // wait briefly for click to settle
          await new Promise(r => setTimeout(r, 60));
          const settled = robot.getMousePos();
          return { x: settled.x, y: settled.y };
        }
        lastPos = pos;
        await new Promise(r => setTimeout(r, 50));
      }
      return null;
    } catch (err) {
      throw new Error('captureClickCoordinates error: ' + err.message);
    }
  },

  async focusWindowByTitle(windowTitle, restoreIfMinimized = true) {
    const success = await this.focusWindow(windowTitle, 5000);
    if (!success) {
      throw new Error(`Window "${windowTitle}" tidak ditemukan`);
    }
    return success;
  },

  async pasteClipboard() {
    return this.pasteFromClipboard();
  },

  async listOpenWindows() {
    try {
      ensureWindowManager();
      const wins = windowManager.Window.getWindows();
      return [...new Set(wins.map(w => String(w.getTitle() || '').trim()).filter(Boolean))];
    } catch (err) {
      throw new Error('listOpenWindows error: ' + err.message);
    }
  }
};
