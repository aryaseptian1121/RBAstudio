const Jimp = require('jimp');
const SmartDetector = require('./smartDetector');
const ElectronScreenshotProvider = require('./screenshotProviders/electronProvider');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value = '') {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function ensureBBox(bbox = {}) {
  return {
    x1: Number(bbox.x1 ?? bbox.x ?? bbox.left ?? 0),
    y1: Number(bbox.y1 ?? bbox.y ?? bbox.top ?? 0),
    x2: Number(bbox.x2 ?? bbox.x1 ?? bbox.right ?? bbox.x ?? 0),
    y2: Number(bbox.y2 ?? bbox.y1 ?? bbox.bottom ?? bbox.y ?? 0),
  };
}

function getCandidateText(candidate) {
  if (!candidate) return '';
  if (typeof candidate.text === 'string' && candidate.text.trim()) {
    return candidate.text.trim();
  }
  if (Array.isArray(candidate.words)) {
    return candidate.words.map((word) => String(word.text || '')).filter(Boolean).join(' ');
  }
  return '';
}

function getCandidateBBox(candidate) {
  if (!candidate) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }
  if (candidate.bbox) return ensureBBox(candidate.bbox);
  if (Array.isArray(candidate.words)) {
    return candidate.words.reduce((acc, word) => {
      const bbox = ensureBBox(word.bbox);
      return {
        x1: Math.min(acc.x1, bbox.x1),
        y1: Math.min(acc.y1, bbox.y1),
        x2: Math.max(acc.x2, bbox.x2),
        y2: Math.max(acc.y2, bbox.y2),
      };
    }, { x1: Number.POSITIVE_INFINITY, y1: Number.POSITIVE_INFINITY, x2: Number.NEGATIVE_INFINITY, y2: Number.NEGATIVE_INFINITY });
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function pickBestOcrCandidate(candidates = [], cropCenter = { x: 0, y: 0 }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const scored = candidates
    .map((candidate) => {
      const text = getCandidateText(candidate);
      if (!text) return null;
      const bbox = getCandidateBBox(candidate);
      const cx = (bbox.x1 + bbox.x2) / 2;
      const cy = (bbox.y1 + bbox.y2) / 2;
      const distance = Math.sqrt((cx - cropCenter.x) ** 2 + (cy - cropCenter.y) ** 2);
      const lengthBonus = Math.min(text.length, 24) * 0.25;
      const score = lengthBonus - distance * 0.02;
      return { text, bbox, distance, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  return scored[0];
}

async function cropAroundPoint(buffer, x, y, width, height, cropSize = 120) {
  const image = await Jimp.read(buffer);
  const half = Math.floor(cropSize / 2);
  const cropX = clamp(Math.floor(x) - half, 0, Math.max(0, image.bitmap.width - 1));
  const cropY = clamp(Math.floor(y) - half, 0, Math.max(0, image.bitmap.height - 1));
  const cropWidth = clamp(cropSize, 1, image.bitmap.width - cropX);
  const cropHeight = clamp(cropSize, 1, image.bitmap.height - cropY);
  return image.clone().crop(cropX, cropY, cropWidth, cropHeight);
}

async function buildSmartTargetForClick({
  x,
  y,
  provider = null,
  cropSize = 120,
  fallbackProvider = null,
} = {}) {
  const resolvedProvider = provider || fallbackProvider || new ElectronScreenshotProvider();

  try {
    const screenshot = await resolvedProvider.capture();
    const screenSize = await resolvedProvider.getDeviceSize();

    const image = await cropAroundPoint(screenshot, x, y, Number(screenSize?.w || 0), Number(screenSize?.h || 0), cropSize);
    const cropBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
    const detector = new SmartDetector(resolvedProvider);
    const recognition = await detector.recognizeText(cropBuffer);

    const cropCenter = { x: cropSize / 2, y: cropSize / 2 };
    const bestCandidate = pickBestOcrCandidate(recognition?.candidates || [], cropCenter);
    const ocrText = bestCandidate ? bestCandidate.text : '';

    const regionPercent = {
      x: clamp((Number(x) + 0.5) / Math.max(1, Number(screenSize?.w || 1)), 0, 1),
      y: clamp((Number(y) + 0.5) / Math.max(1, Number(screenSize?.h || 1)), 0, 1),
    };

    return {
      source: 'recorded',
      regionPercent,
      imageCrop: toBase64(cropBuffer),
      ocrText: ocrText || '',
      ocrTextAlt: [],
      captureStrategy: 'ocr+template',
      captureCropSize: cropSize,
      captureAt: { x: Number(x) || 0, y: Number(y) || 0 },
      normalizedOcrText: ocrText ? normalizeText(ocrText) : '',
    };
  } catch (error) {
    console.warn('[SmartTargetCapture] gagal membuat smartTarget:', error?.message || error);
    return null;
  }
}

module.exports = {
  buildSmartTargetForClick,
};
