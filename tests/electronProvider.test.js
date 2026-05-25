const assert = require('assert');

const electronPath = require.resolve('electron');
const originalElectron = require.cache[electronPath];

(async () => {
  const mockThumbnail = {
    toPNG: () => Buffer.from('mock-png-buffer'),
  };

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      desktopCapturer: {
        getSources: async () => [
          { id: 'screen:1', name: 'Screen 1', thumbnail: mockThumbnail },
        ],
      },
      screen: {
        getAllDisplays: () => [{ id: 1, size: { width: 1440, height: 900 } }],
        getPrimaryDisplay: () => ({ id: 1, size: { width: 1440, height: 900 } }),
      },
    },
  };

  delete require.cache[require.resolve('../src/screenshotProviders/electronProvider')];
  const ElectronScreenshotProvider = require('../src/screenshotProviders/electronProvider');

  const provider = new ElectronScreenshotProvider();
  const buffer = await provider.capture();
  const size = await provider.getDeviceSize();

  assert.ok(Buffer.isBuffer(buffer));
  assert.strictEqual(buffer.toString('utf8'), 'mock-png-buffer');
  assert.strictEqual(size.w, 1440);
  assert.strictEqual(size.h, 900);
  assert.strictEqual(provider.type, 'electron');

  console.log('electronProvider test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalElectron) {
    require.cache[electronPath] = originalElectron;
  } else {
    delete require.cache[electronPath];
  }
});
