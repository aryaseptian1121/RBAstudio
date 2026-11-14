const assert = require('assert');

const adbManagerPath = require.resolve('../utils/adbManager');
const originalAdbManager = require.cache[adbManagerPath];

(async () => {
  require.cache[adbManagerPath] = {
    id: adbManagerPath,
    filename: adbManagerPath,
    loaded: true,
    exports: {
      screenshot: async () => Buffer.from('fake-png-buffer').toString('base64'),
      getScreenSize: async () => ({ width: 1080, height: 1920 }),
    },
  };

  delete require.cache[require.resolve('../src/screenshotProviders/adbProvider')];
  const AdbScreenshotProvider = require('../src/screenshotProviders/adbProvider');

  const provider = new AdbScreenshotProvider({ deviceId: 'emulator-5554' });
  const buffer = await provider.capture();
  const size = await provider.getDeviceSize();

  assert.ok(Buffer.isBuffer(buffer));
  assert.strictEqual(buffer.toString('utf8'), 'fake-png-buffer');
  assert.strictEqual(size.w, 1080);
  assert.strictEqual(size.h, 1920);
  assert.strictEqual(provider.type, 'adb');

  console.log('adbProvider test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalAdbManager) {
    require.cache[adbManagerPath] = originalAdbManager;
  } else {
    delete require.cache[adbManagerPath];
  }
});
