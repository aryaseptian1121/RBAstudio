const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value = '') {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function makeCandidateScore(candidateText, targetText, altTexts = []) {
  const normalizedTarget = normalizeText(targetText);
  const normalizedCandidate = normalizeText(candidateText);

  if (!normalizedTarget) {
    return 0;
  }

  if (normalizedCandidate === normalizedTarget) {
    return 1;
  }

  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) {
    return 0.95;
  }

  for (const alt of altTexts) {
    const normalizedAlt = normalizeText(alt);
    if (!normalizedAlt) continue;
    if (normalizedCandidate === normalizedAlt) {
      return 0.9;
    }
    if (normalizedCandidate.includes(normalizedAlt) || normalizedAlt.includes(normalizedCandidate)) {
      return 0.88;
    }
  }

  return 0;
}

function getRegionPoint(regionHint = 'center', width = 1, height = 1) {
  const mapping = {
    'top-left': { x: 0.25, y: 0.25 },
    'top-right': { x: 0.75, y: 0.25 },
    'bottom-left': { x: 0.25, y: 0.75 },
    'bottom-right': { x: 0.75, y: 0.75 },
    center: { x: 0.5, y: 0.5 },
  };

  const point = mapping[regionHint] || mapping.center;
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

function getRegionHintPoint(smartTarget = {}, width, height) {
  if (smartTarget.regionPercent && typeof smartTarget.regionPercent === 'object') {
    return {
      x: width * (Number(smartTarget.regionPercent.x) || 0),
      y: height * (Number(smartTarget.regionPercent.y) || 0),
    };
  }

  return getRegionPoint(smartTarget.regionHint, width, height);
}

function computeRegionDistance(candidateCenter, regionPoint) {
  const dx = candidateCenter.x - regionPoint.x;
  const dy = candidateCenter.y - regionPoint.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function bboxCenter(bbox = {}) {
  if (!bbox) {
    return { x: 0, y: 0 };
  }

  const x1 = Number(bbox.x1 || bbox.x || bbox.left || 0);
  const y1 = Number(bbox.y1 || bbox.y || bbox.top || 0);
  const x2 = Number(bbox.x2 || bbox.x1 || bbox.right || x1);
  const y2 = Number(bbox.y2 || bbox.y1 || bbox.bottom || y1);

  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
  };
}

function unionBBox(a = {}, b = {}) {
  const x1 = Math.min(Number(a.x1 || a.x || a.left || 0), Number(b.x1 || b.x || b.left || 0));
  const y1 = Math.min(Number(a.y1 || a.y || a.top || 0), Number(b.y1 || b.y || b.top || 0));
  const x2 = Math.max(Number(a.x2 || a.x1 || a.right || 0), Number(b.x2 || b.x1 || b.right || 0));
  const y2 = Math.max(Number(a.y2 || a.y1 || a.bottom || 0), Number(b.y2 || b.y1 || b.bottom || 0));
  return { x1, y1, x2, y2 };
}

function ensureBBox(bbox) {
  if (!bbox) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  return {
    x1: Number(bbox.x1 ?? bbox.x ?? bbox.left ?? 0),
    y1: Number(bbox.y1 ?? bbox.y ?? bbox.top ?? 0),
    x2: Number(bbox.x2 ?? bbox.x1 ?? bbox.right ?? bbox.x ?? 0),
    y2: Number(bbox.y2 ?? bbox.y1 ?? bbox.bottom ?? bbox.y ?? 0),
  };
}

function decodeBase64ToBuffer(value = '') {
  if (!value) return null;
  return Buffer.from(String(value), 'base64');
}

function pixelToGray(r, g, b) {
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

function buildHashFromImage(image) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const small = image.clone().resize(8, 8).grayscale();
  let bits = '';

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const idx = small.getPixelIndex(x, y);
      const value = small.bitmap.data[idx];
      bits += value > 128 ? '1' : '0';
    }
  }

  const byteArray = [];
  for (let i = 0; i < bits.length; i += 8) {
    byteArray.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return byteArray
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function computeSimilarity(hashA = '', hashB = '') {
  if (!hashA || !hashB || hashA.length !== hashB.length) {
    return 0;
  }

  let mismatch = 0;
  for (let i = 0; i < hashA.length; i += 1) {
    if (hashA[i] !== hashB[i]) {
      mismatch += 1;
    }
  }

  return 1 - mismatch / hashA.length;
}

async function readImage(buffer) {
  if (!buffer) {
    throw new Error('Screenshot buffer belum tersedia');
  }
  return Jimp.read(buffer);
}

function getBoundingBoxFromCandidate(candidate) {
  if (candidate && candidate.bbox) {
    return ensureBBox(candidate.bbox);
  }

  if (candidate && candidate.words) {
    return candidate.words.reduce((acc, word) => unionBBox(acc, ensureBBox(word.bbox)), ensureBBox({}));
  }

  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function getCandidateText(candidate) {
  if (!candidate) {
    return '';
  }
  if (typeof candidate.text === 'string' && candidate.text.trim()) {
    return candidate.text;
  }
  if (Array.isArray(candidate.words)) {
    return candidate.words.map((word) => String(word.text || '')).filter(Boolean).join(' ');
  }
  return '';
}

function safeSize(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

class SmartDetector {
  constructor(provider, options = {}) {
    if (!provider || typeof provider.capture !== 'function' || typeof provider.getDeviceSize !== 'function') {
      throw new Error('SmartDetector membutuhkan ScreenshotProvider dengan capture() dan getDeviceSize()');
    }

    this.provider = provider;
    this.minimumConfidence = options.minimumConfidence ?? 60;
    this.preferredLayer = options.preferredLayer || 'auto';
    this.retryOnLowConfidence = options.retryOnLowConfidence ?? 2;
    this.waitForElementTimeout = options.waitForElementTimeout ?? 5000;
  }

  async recognizeText(buffer) {
    const { data } = await Tesseract.recognize(buffer, 'eng', {
      logger: () => {},
    });

    const lines = Array.isArray(data.lines) ? data.lines : [];
    const words = Array.isArray(data.words) ? data.words : [];

    const candidates = [];

    for (const line of lines) {
      const text = String(line.text || '').trim();
      if (!text) continue;
      const bbox = getBoundingBoxFromCandidate(line);
      candidates.push({ text, bbox, source: 'line' });
    }

    if (candidates.length === 0) {
      for (const word of words) {
        const text = String(word.text || '').trim();
        if (!text) continue;
        const bbox = ensureBBox(word.bbox);
        candidates.push({ text, bbox, source: 'word' });
      }
    }

    return {
      text: data.text || '',
      candidates,
      raw: data,
    };
  }

  async getCurrentSize(currentScreenshot, deviceInfo = {}) {
    if (currentScreenshot) {
      const image = await readImage(currentScreenshot);
      return { width: image.bitmap.width, height: image.bitmap.height };
    }

    const providerSize = await this.provider.getDeviceSize();
    return {
      width: safeSize(providerSize?.w, safeSize(deviceInfo.screenWidth, 1)),
      height: safeSize(providerSize?.h, safeSize(deviceInfo.screenHeight, 1)),
    };
  }

  async getCandidateRegion(smartTarget = {}, currentScreenshot, deviceInfo = {}) {
    const screenSize = await this.getCurrentSize(currentScreenshot, deviceInfo);
    const fallbackPoint = getRegionHintPoint(smartTarget, screenSize.width, screenSize.height);

    return {
      width: screenSize.width,
      height: screenSize.height,
      regionPoint: fallbackPoint,
    };
  }

  async extractOcrCandidates(smartTarget = {}, currentScreenshot) {
    const recognition = await this.recognizeText(currentScreenshot);
    const targetText = smartTarget.ocrText || smartTarget.contextText || '';
    const altTexts = Array.isArray(smartTarget.ocrTextAlt) ? smartTarget.ocrTextAlt : [];

    const matches = recognition.candidates
      .map((candidate) => {
        const candidateText = getCandidateText(candidate);
        const score = makeCandidateScore(candidateText, targetText, altTexts);
        return { candidate, candidateText, score };
      })
      .filter((item) => item.score > 0);

    return { recognition, matches };
  }

  async runLayer1(smartTarget = {}, currentScreenshot, deviceInfo = {}) {
    const { recognition, matches } = await this.extractOcrCandidates(smartTarget, currentScreenshot);

    if (!matches.length) {
      return { found: false, confidence: 0, layer: 1, message: 'No OCR match' };
    }

    const { width, height, regionPoint } = await this.getCandidateRegion(smartTarget, currentScreenshot, deviceInfo);

    const ranked = matches
      .map((item) => {
        const bbox = getBoundingBoxFromCandidate(item.candidate);
        const center = bboxCenter(bbox);
        const distance = computeRegionDistance(center, regionPoint);
        const normalizedDistance = Math.max(0, 1 - (distance / Math.max(width, height)));
        const score = item.score * 0.7 + normalizedDistance * 0.3;

        return {
          candidate: item.candidate,
          text: item.candidateText,
          center,
          score,
          distance,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];

    return {
      found: true,
      x: Math.round(best.center.x),
      y: Math.round(best.center.y),
      confidence: 97,
      layer: 1,
      matchedText: best.text,
      ocrText: recognition.text,
      bbox: getBoundingBoxFromCandidate(best.candidate),
    };
  }

  async cropAroundPoint(currentScreenshot, centerX, centerY, size = 80) {
    const image = await readImage(currentScreenshot);
    const half = Math.floor(size / 2);
    const x1 = clamp(Math.floor(centerX) - half, 0, image.bitmap.width - 1);
    const y1 = clamp(Math.floor(centerY) - half, 0, image.bitmap.height - 1);
    const cropWidth = clamp(size, 1, image.bitmap.width - x1);
    const cropHeight = clamp(size, 1, image.bitmap.height - y1);
    return image.clone().crop(x1, y1, cropWidth, cropHeight);
  }

  async runLayer2(smartTarget = {}, currentScreenshot, deviceInfo = {}) {
    if (!smartTarget.visualHash) {
      return { found: false, confidence: 0, layer: 2, message: 'Missing visualHash' };
    }

    let center = null;
    if (smartTarget.regionPercent) {
      const size = await this.getCurrentSize(currentScreenshot, deviceInfo);
      center = {
        x: size.width * Number(smartTarget.regionPercent.x || 0),
        y: size.height * Number(smartTarget.regionPercent.y || 0),
      };
    }

    if (!center) {
      center = { x: 0, y: 0 };
    }

    const crop = await this.cropAroundPoint(currentScreenshot, center.x, center.y, 80);
    const hash = buildHashFromImage(crop);
    const similarity = computeSimilarity(hash, smartTarget.visualHash);

    if (similarity < 0.85) {
      return { found: false, confidence: 0, layer: 2, similarity, message: 'Visual hash below threshold' };
    }

    return {
      found: true,
      x: Math.round(center.x),
      y: Math.round(center.y),
      confidence: 82,
      layer: 2,
      similarity,
    };
  }

  async runLayer3(smartTarget = {}, currentScreenshot, deviceInfo = {}) {
    if (!smartTarget.imageCrop) {
      return { found: false, confidence: 0, layer: 3, message: 'Missing imageCrop' };
    }

    const image = await readImage(currentScreenshot);
    const template = await readImage(decodeBase64ToBuffer(smartTarget.imageCrop));

    const { width, height } = await this.getCurrentSize(currentScreenshot, deviceInfo);
    const searchArea = await this.getCandidateRegion(smartTarget, currentScreenshot, deviceInfo);
    const startX = Math.max(0, Math.floor(searchArea.regionPoint.x - width * 0.2));
    const startY = Math.max(0, Math.floor(searchArea.regionPoint.y - height * 0.2));
    const endX = Math.min(width - template.bitmap.width, Math.floor(searchArea.regionPoint.x + width * 0.2));
    const endY = Math.min(height - template.bitmap.height, Math.floor(searchArea.regionPoint.y + height * 0.2));

    let best = { score: 0, x: 0, y: 0 };
    const step = Math.max(4, Math.floor(template.bitmap.width / 6));

    for (let y = startY; y <= endY; y += step) {
      for (let x = startX; x <= endX; x += step) {
        let numerator = 0;
        let denominatorA = 0;
        let denominatorB = 0;

        for (let ty = 0; ty < template.bitmap.height; ty += 1) {
          for (let tx = 0; tx < template.bitmap.width; tx += 1) {
            const screenColor = Jimp.intToRGBA(image.getPixelColor(x + tx, y + ty));
            const templateColor = Jimp.intToRGBA(template.getPixelColor(tx, ty));
            const screenGray = pixelToGray(screenColor.r, screenColor.g, screenColor.b);
            const templateGray = pixelToGray(templateColor.r, templateColor.g, templateColor.b);
            numerator += (screenGray - 0.5) * (templateGray - 0.5);
            denominatorA += (screenGray - 0.5) ** 2;
            denominatorB += (templateGray - 0.5) ** 2;
          }
        }

        const score = denominatorA === 0 || denominatorB === 0 ? 0 : numerator / Math.sqrt(denominatorA * denominatorB);
        if (score > best.score) {
          best = { score, x, y };
        }
      }
    }

    if (best.score <= 0.7) {
      return { found: false, confidence: 0, layer: 3, matchScore: best.score, message: 'Template score below threshold' };
    }

    return {
      found: true,
      x: Math.round(best.x + template.bitmap.width / 2),
      y: Math.round(best.y + template.bitmap.height / 2),
      confidence: 68,
      layer: 3,
      matchScore: best.score,
    };
  }

  async runLayer4(smartTarget = {}, deviceInfo = {}) {
    const width = safeSize(deviceInfo.screenWidth, 1);
    const height = safeSize(deviceInfo.screenHeight, 1);
    const { x, y } = getRegionHintPoint(smartTarget, width, height);

    return {
      found: true,
      x: Math.round(x),
      y: Math.round(y),
      confidence: 45,
      layer: 4,
    };
  }

  async findElement(smartTarget = {}, currentScreenshot, deviceInfo = {}) {
    if (!currentScreenshot) {
      throw new Error('SmartDetector.findElement membutuhkan currentScreenshot');
    }

    const layer1 = await this.runLayer1(smartTarget, currentScreenshot, deviceInfo);
    if (layer1.found) {
      return layer1;
    }

    const layer2 = await this.runLayer2(smartTarget, currentScreenshot, deviceInfo);
    if (layer2.found) {
      return layer2;
    }

    const layer3 = await this.runLayer3(smartTarget, currentScreenshot, deviceInfo);
    if (layer3.found) {
      return layer3;
    }

    return this.runLayer4(smartTarget, deviceInfo);
  }

  async verifyElementStillVisible(coords = {}, smartTarget = {}, currentScreenshot) {
    if (!currentScreenshot) {
      return { valid: false, confidence: 0 };
    }

    const image = await readImage(currentScreenshot);
    const x = Math.round(Number(coords.x) || 0);
    const y = Math.round(Number(coords.y) || 0);

    const crop = await this.cropAroundPoint(currentScreenshot, x, y, 40);

    if (smartTarget.visualHash) {
      const hash = buildHashFromImage(crop);
      const similarity = computeSimilarity(hash, smartTarget.visualHash);
      return { valid: similarity >= 0.8, confidence: Math.round(similarity * 100), similarity };
    }

    if (smartTarget.ocrText || Array.isArray(smartTarget.ocrTextAlt)) {
      const recognition = await this.recognizeText(crop.getBufferAsync(Jimp.MIME_PNG));
      const text = recognition.text || '';
      const target = normalizeText(smartTarget.ocrText || '');
      const alts = (smartTarget.ocrTextAlt || []).map((value) => normalizeText(value));
      const valid = !!text && (text.includes(target) || alts.some((alt) => text.includes(alt)));
      return { valid, confidence: valid ? 90 : 20 };
    }

    return { valid: x >= 0 && y >= 0 && x <= image.bitmap.width && y <= image.bitmap.height, confidence: 60 };
  }

  async waitForElement(smartTarget = {}, timeout = this.waitForElementTimeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const screenshot = await this.provider.capture();
      const result = await this.runLayer1(smartTarget, screenshot, await this.provider.getDeviceSize());
      if (result.found) {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return { found: false, confidence: 0, layer: 1, message: 'waitForElement timeout' };
  }
}

module.exports = SmartDetector;
