const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearRuntimeCache } = require('../src/services/cacheManager');

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rba-cache-test-'));
  const referencesDir = path.join(tempRoot, 'references');
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(referencesDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(referencesDir, 'temp_capture.png'), 'temp');
  fs.writeFileSync(path.join(outputDir, 'tmp_result.png'), 'temp');
  fs.writeFileSync(path.join(referencesDir, 'keep_reference.png'), 'keep');

  const result = await clearRuntimeCache({
    referencesDir,
    outputDir,
    tempDir: tempRoot,
    clearDisk: true
  });

  assert.strictEqual(result.deletedFiles.length, 2);
  assert.strictEqual(fs.existsSync(path.join(referencesDir, 'temp_capture.png')), false);
  assert.strictEqual(fs.existsSync(path.join(outputDir, 'tmp_result.png')), false);
  assert.strictEqual(fs.existsSync(path.join(referencesDir, 'keep_reference.png')), true);

  console.log('cacheManager test passed');
})();
