const assert = require('assert');
const Jimp = require('jimp');
const SmartDetector = require('../src/smartDetector');

(async () => {
  const image = new Jimp(200, 200, '#ffffff');
  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

  const provider = {
    type: 'electron',
    capture: async () => buffer,
    getDeviceSize: async () => ({ w: 200, h: 200 }),
  };

  const detector = new SmartDetector(provider);

  detector.recognizeText = async () => ({
    text: 'Kirim Pesan',
    candidates: [
      {
        text: 'Kirim Pesan',
        bbox: { x1: 60, y1: 70, x2: 140, y2: 95 },
      },
    ],
  });

  const result = await detector.findElement({
    ocrText: 'Kirim Pesan',
    ocrTextAlt: ['Send'],
    regionPercent: { x: 0.5, y: 0.5 },
  }, buffer, { screenWidth: 200, screenHeight: 200 });

  assert.strictEqual(result.found, true);
  assert.strictEqual(result.layer, 1);
  assert.strictEqual(result.matchedText, 'Kirim Pesan');
  assert.ok(result.confidence >= 95, `Harus confidence tinggi, tapi dapat ${result.confidence}`);

  console.log('smartDetector test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
