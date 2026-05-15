/**
 * Wait & Tap Activity Executor
 * Wait for element to appear, then tap it
 */

const { findImageInScreen, findTextViaUIAutomator, readNodeData, sleep, waitForElement } = require('../utils/imageMatcher');
const adbManager = require('../utils/adbManager');

async function executeWaitAndTap(node, context) {
  const data = readNodeData(node);
  const {
    coordinateX, coordinateY,
    referenceImageBase64,
    targetText,
    matchMode,
    matchThreshold,
    waitTimeout,
    retryInterval,
    deviceId,
  } = data;

  const device = deviceId || context.activeDevice || context.deviceId;
  if (!device) throw new Error('❌ Tidak ada ADB device aktif');

  context.log(`⏳ Wait & Tap dimulai — mode: ${matchMode}, timeout: ${waitTimeout/1000}s`);

  // ── NO IMAGE: direct tap ──
  if (!referenceImageBase64 || matchMode === 'COORDINATE') {
    if (!coordinateX && !coordinateY) throw new Error('❌ Tidak ada koordinat atau gambar');
    context.log(`📍 Tap koordinat langsung (${coordinateX}, ${coordinateY})`);
    await adbManager.tap(device, coordinateX, coordinateY);
    context.log(`✅ Tap OK`);
    return { success: true, method: 'coordinate' };
  }

  // ── IMAGE/TEXT MATCH WITH WAIT LOOP ──
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
    throw new Error(`❌ Elemen tidak ditemukan dalam ${waitTimeout}ms`);
  }

  const tapX = result.coords?.x ?? coordinateX;
  const tapY = result.coords?.y ?? coordinateY;
  context.log(`✅ Elemen ditemukan! Tap di (${tapX}, ${tapY})`);
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

module.exports = { executeWaitAndTap };