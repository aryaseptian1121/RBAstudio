/**
 * Image Matching & UI Automation Utilities
 * Shared functions for Mobile Tap and Wait & Tap activities
 */

const Jimp = require('jimp');
const { exec } = require('child_process');
const adbManager = require('./adbManager');

/**
 * Find image template in screen screenshot
 */
async function findImageInScreen(screenBase64, templateBase64, threshold = 0.80, roi = null, context = { log: () => {} }) {
  try {
    const screen   = await Jimp.read(Buffer.from(screenBase64, 'base64'));
    const template = await Jimp.read(Buffer.from(templateBase64, 'base64'));

    const SW = screen.bitmap.width;
    const SH = screen.bitmap.height;
    const TW = template.bitmap.width;
    const TH = template.bitmap.height;

    // Apply ROI if provided
    let searchScreen = screen;
    let offsetX = 0, offsetY = 0;
    if (roi) {
      const { x, y, width, height } = roi;
      const roiX = Math.max(0, Math.min(x, SW - 1));
      const roiY = Math.max(0, Math.min(y, SH - 1));
      const roiW = Math.min(width, SW - roiX);
      const roiH = Math.min(height, SH - roiY);
      searchScreen = screen.clone().crop(roiX, roiY, roiW, roiH);
      offsetX = roiX;
      offsetY = roiY;
      context.log(`[MATCH] ROI digunakan: x=${roiX}, y=${roiY}, w=${roiW}, h=${roiH}`);
    } else {
      context.log(`[MATCH] ROI tidak digunakan — mencari di seluruh screenshot`);
    }

    const SSW = searchScreen.bitmap.width;
    const SSH = searchScreen.bitmap.height;

    context.log(`[MATCH] Screenshot dimuat: ${SW}x${SH}, format: PNG (base64)`);
    context.log(`[MATCH] Template dimuat: ${TW}x${TH}, format: PNG (base64)`);
    context.log(`[MATCH] Search area: ${SSW}x${SSH} (ROI offset: ${offsetX},${offsetY})`);

    let best = { score: 0, x: 0, y: 0, w: TW, h: TH };

    // Multi-scale search
    for (const scale of [1.0, 0.85, 0.75, 1.15, 1.25]) {
      const t = template.clone().scale(scale);
      const tw = t.bitmap.width;
      const th = t.bitmap.height;
      if (tw > SSW || th > SSH) continue;

      const stepX = Math.max(4, Math.floor(tw / 6));
      const stepY = Math.max(4, Math.floor(th / 6));

      for (let y = 0; y <= SSH - th; y += stepY) {
        for (let x = 0; x <= SSW - tw; x += stepX) {
          const region = searchScreen.clone().crop(x, y, tw, th);
          const score  = comparePixels(region.bitmap.data, t.bitmap.data);
          if (score > best.score) best = { score, x, y, w: tw, h: th };
          if (score >= 0.97) break;
        }
        if (best.score >= 0.97) break;
      }
      if (best.score >= threshold) break;
    }

    console.log(`[MATCH] Score: ${(best.score*100).toFixed(2)}% | Threshold: ${(threshold*100).toFixed(0)}% | Method: custom_pixel_diff`);
    console.log(`[MATCH] Hasil: ${best.score >= threshold ? 'PASS' : 'FAIL'} → ${best.score >= threshold ? 'tap akan dilakukan' : 'fallback ke koordinat manual'}`);

    if (best.score >= threshold) {
      return {
        found: true,
        x: best.x + offsetX, y: best.y + offsetY,
        centerX: Math.round(best.x + offsetX + best.w / 2),
        centerY: Math.round(best.y + offsetY + best.h / 2),
        confidence: best.score,
      };
    }

    return null;

  } catch (err) {
    console.error('[ImageMatch] Fatal:', err.message);
    return null;
  }
}

/**
 * Compare pixel data between two images
 */
function comparePixels(dataA, dataB) {
  const len = Math.min(dataA.length, dataB.length);
  if (len === 0) return 0;
  let diff = 0;
  const pixels = len / 4;
  for (let i = 0; i < len; i += 4) {
    diff += (
      Math.abs(dataA[i]   - dataB[i])   * 0.299 +
      Math.abs(dataA[i+1] - dataB[i+1]) * 0.587 +
      Math.abs(dataA[i+2] - dataB[i+2]) * 0.114
    ) / 255;
  }
  return 1 - diff / pixels;
}

/**
 * Find text via UI Automator dump
 */
async function findTextViaUIAutomator(deviceId, targetText, context) {
  return new Promise((resolve) => {
    const cmd = `adb -s ${deviceId} shell uiautomator dump /sdcard/ui.xml 2>/dev/null && adb -s ${deviceId} shell cat /sdcard/ui.xml`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      const escaped = targetText.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
      const match = stdout.match(
        new RegExp(`text="${escaped}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i')
      );
      if (match) {
        const [,x1,y1,x2,y2] = match.map(Number);
        resolve({
          centerX: Math.round((x1+x2)/2),
          centerY: Math.round((y1+y2)/2),
          confidence: 1.0,
        });
      } else {
        resolve(null);
      }
    });
  });
}

async function runMatching(screenBase64, config, deviceId, context = { log: () => {} }) {
  const {
    matchMode = 'IMAGE_OR_TEXT',
    threshold = 0.80,
    templateImageBase64,
    targetText,
    coordinateX = 0,
    coordinateY = 0
  } = config;

  context.log(`🔎 Running matching (${matchMode}, threshold ${(threshold*100).toFixed(0)}%)`);

  if ((matchMode === 'IMAGE' || matchMode === 'IMAGE_OR_TEXT') && templateImageBase64) {
    // Define ROI around saved coordinates (400x400 area centered on coordinateX,coordinateY)
    const roiRadius = 200;
    const roi = {
      x: Math.max(0, coordinateX - roiRadius),
      y: Math.max(0, coordinateY - roiRadius),
      width: roiRadius * 2,
      height: roiRadius * 2
    };

    const match = await findImageInScreen(screenBase64, templateImageBase64, threshold, roi, context);
    if (match) {
      return {
        found: true,
        coords: { x: match.centerX, y: match.centerY },
        score: match.confidence,
        method: 'image'
      };
    }
  }

  if ((matchMode === 'TEXT' || matchMode === 'IMAGE_OR_TEXT') && targetText) {
    const textMatch = await findTextViaUIAutomator(deviceId, targetText, context);
    if (textMatch) {
      return {
        found: true,
        coords: { x: textMatch.centerX, y: textMatch.centerY },
        score: textMatch.confidence ?? 1.0,
        method: 'text'
      };
    }
  }

  return { found: false, coords: null };
}

async function waitForElement(config, deviceId, context = { log: () => {} }) {
  const {
    timeoutMs = 10000,
    pollIntervalMs = 500
  } = config;

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime;
    context.log(`📸 Capturing screenshot for wait (${elapsed}ms elapsed)`);

    const screenBase64 = await adbManager.screenshot(deviceId);
    if (!screenBase64) {
      context.log('⚠️ Screenshot failed during wait loop');
    } else {
      const result = await runMatching(screenBase64, config, deviceId, context);
      if (result.found) {
        context.log(`✅ Element found via ${result.method} after ${elapsed}ms (score ${(result.score*100).toFixed(1)}%)`);
        return result;
      }
      context.log(`⏳ Element not found yet after ${elapsed}ms`);
    }

    await sleep(pollIntervalMs);
  }

  context.log(`⚠️ Wait timed out after ${timeoutMs}ms`);
  return { found: false, coords: null };
}

/**
 * Universal node data reader with fallback field names
 */
function readNodeData(node) {
  const raw = node.data || node.properties || node.config || node || {};

  // Debug: log all available fields to find mismatches
  console.log('[DEBUG NODE DATA]', JSON.stringify(raw, (k,v) =>
    (k.toLowerCase().includes('image') || k.toLowerCase().includes('base64'))
      ? `[BASE64:${v?.length||0}]` : v
  , 2));

  return {
    // Coordinate — try every possible field name
    coordinateX: raw.coordinateX ?? raw.x ?? raw.tapX ?? raw.coordinate_x ?? 0,
    coordinateY: raw.coordinateY ?? raw.y ?? raw.tapY ?? raw.coordinate_y ?? 0,

    // Reference image — try every possible field name
    referenceImageBase64:
      raw.referenceImageBase64 ??
      raw.templateImageBase64 ??
      raw.referenceImage ??
      raw.capturedImage ??
      raw.imageBase64 ??
      raw.image ??
      null,

    // Text target
    targetText: raw.targetText ?? raw.ocrText ?? raw.text ?? raw.targetLabel ?? '',

    // Settings
    matchMode: raw.matchMode ?? raw.match_mode ?? 'IMAGE_OR_TEXT',
    matchThreshold: parseFloat(raw.matchThreshold ?? raw.confidenceThreshold ?? raw.threshold ?? 0.80),
    waitTimeout: parseInt(raw.waitTimeout ?? 30000),
    retryInterval: parseInt(raw.retryInterval ?? 1000),
    delayBefore: parseInt(raw.delayBefore ?? raw.delay ?? 500),
    deviceId: raw.deviceId ?? raw.device_id ?? raw.device ?? null,
  };
}

/**
 * Sleep utility
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  findImageInScreen,
  findTextViaUIAutomator,
  waitForElement,
  readNodeData,
  sleep
};