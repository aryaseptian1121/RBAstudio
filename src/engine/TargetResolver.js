const BrowserManager = require('../services/BrowserManager');
const WinAuto = require('../services/WindowsAutomation');

async function resolveTarget(targetConfig, context, addLog) {
  const type = targetConfig?.type || 'browser_url';
  addLog('INFO', `Resolving target tipe: ${type}`);

  switch (type) {

    case 'browser_url': {
      const url = targetConfig.url || '';
      if (!url) throw new Error('URL target kosong. Isi URL di konfigurasi Target.');
      addLog('INFO', `Mencari tab browser: ${url}`);
      try {
        await BrowserManager.connect(targetConfig.debugPort || 9222);
      } catch (e) {
        throw new Error(
          'Tidak bisa konek ke browser.\n' +
          'Solusi: Buka Chrome/Edge dengan perintah:\n' +
          '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n' +
          'Atau gunakan tombol "Buka Browser Debug" di pengaturan.'
        );
      }
      await BrowserManager.focusTabByUrl(url, targetConfig.urlMatchMode || 'contains');
      addLog('INFO', `Tab ditemukan dan difokuskan: ${url}`);
      return { type: 'browser', manager: BrowserManager };
    }

    case 'desktop_exe': {
      const title = targetConfig.windowTitle || '';
      const exe = targetConfig.exeName || '';
      if (!title && !exe) throw new Error('Isi Nama Window atau Nama Proses .exe di konfigurasi Target.');
      addLog('INFO', `Mencari window: "${title || exe}"`);
      await WinAuto.focusWindowByTitle(title || exe, targetConfig.restoreIfMinimized !== false);
      addLog('INFO', `Window ditemukan dan difokuskan: ${title}`);
      return { type: 'desktop' };
    }

    case 'clipboard_only':
      addLog('INFO', 'Mode clipboard — tidak ada window yang difokuskan');
      return { type: 'clipboard' };

    case 'script':
      return { type: 'script', config: targetConfig };

    default:
      addLog('WARN', `Tipe target "${type}" belum diimplementasikan, lanjut tanpa fokus`);
      return { type: 'none' };
  }
}

module.exports = { resolveTarget };
