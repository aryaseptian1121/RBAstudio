/**
 * Smart Mobile Tap Activity Executor
 * Enhanced mobile-tap with visual element matching
 */

const { findImageInScreen, findTextViaUIAutomator, readNodeData, sleep, waitForElement } = require('../utils/imageMatcher');
const adbManager = require('../utils/adbManager');

async function executeSmartMobileTap(node, context) {
  const data = readNodeData(node);
  const {
    coordinateX, coordinateY,
    referenceImageBase64,
    targetText,
    matchMode,
    matchThreshold,
    waitTimeout,
    retryInterval,
    delayBefore,
    deviceId,
  } = data;

  const device = deviceId || context.activeDevice || context.deviceId;
  if (!device) throw new Error('❌ Tidak ada ADB device aktif');

  // Delay before action
  if (delayBefore > 0) await sleep(delayBefore);

  context.log(`📱 Mobile Tap — mode: ${matchMode}`);

  // ── CASE 1: No image, use coordinates directly ──
  if (!referenceImageBase64 || matchMode === 'COORDINATE') {
    if (!coordinateX && !coordinateY) throw new Error('❌ Tidak ada koordinat atau gambar referensi');
    context.log(`📍 Tap koordinat (${coordinateX}, ${coordinateY})`);
    await adbManager.tap(device, coordinateX, coordinateY);
    context.log(`✅ Tap OK`);
    return { success: true, method: 'coordinate', x: coordinateX, y: coordinateY };
  }

  // ── CASE 2: Enhanced image/text matching with wait loop ──
  context.log(`🔍 Mencari elemen di layar...`);

  const result = await waitForElement({
    matchMode,
    templateImageBase64: referenceImageBase64,
    targetText,
    threshold: matchThreshold,
    timeoutMs: waitTimeout,
    pollIntervalMs: retryInterval,
    coordinateX,
    coordinateY
  }, device, context);

  if (!result.found) {
    throw new Error(`❌ Elemen tidak ditemukan dalam ${waitTimeout}ms. Tap dibatalkan.`);
  }

  const tapX = result.coords?.x ?? coordinateX;
  const tapY = result.coords?.y ?? coordinateY;
  context.log(`👆 Tap di (${tapX}, ${tapY})`);
  await adbManager.tap(device, tapX, tapY);
  context.log(`✅ Tap OK`);
  return {
    success: true,
    method: 'visual_match',
    x: tapX,
    y: tapY,
    confidence: result.score,
    matchMethod: result.method
  };
}


module.exports = { executeSmartMobileTap };