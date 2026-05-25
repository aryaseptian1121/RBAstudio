const assert = require('assert');
const Jimp = require('jimp');
const SmartDetector = require('../src/smartDetector');
const { buildSmartTargetForClick } = require('../src/smartTargetCapture');

(async () => {
  const originalRecognizeText = SmartDetector.prototype.recognizeText;
  SmartDetector.prototype.recognizeText = async () => ({
    text: 'Simpan',
    candidates: [
      {
        text: 'Simpan',
        bbox: { x1: 40, y1: 40, x2: 90, y2: 70 },
      },
    ],
  });

  const screenshot = await new Jimp(300, 300, '#ffffff').getBufferAsync(Jimp.MIME_PNG);
  const provider = {
    capture: async () => screenshot,
    getDeviceSize: async () => ({ w: 300, h: 300 }),
  };

  const result = await buildSmartTargetForClick({
    x: 150,
    y: 150,
    provider,
  });

  assert.ok(result, 'smartTarget harus dibuat');
  assert.strictEqual(result.ocrText, 'Simpan');
  assert.strictEqual(result.captureStrategy, 'ocr+template');
  assert.ok(result.imageCrop && typeof result.imageCrop === 'string');
  assert.ok(Math.abs(result.regionPercent.x - 0.5) < 0.01);
  assert.ok(Math.abs(result.regionPercent.y - 0.5) < 0.01);

  SmartDetector.prototype.recognizeText = originalRecognizeText;
  console.log('smartTargetCapture test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
