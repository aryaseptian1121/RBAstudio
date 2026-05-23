const { exec } = require('child_process');
const fs = require('fs');
const Jimp = require('jimp');
const ScreenVerifier = require('./screenVerifier');
const { waitForText, destroyOcrWorker } = require('./ocrReader');
const { ExcelLoopEngine, setBrowserManager: setExcelLoopBrowserManager } = require('./src/services/ExcelLoopEngine');

let isRunning = false;
let currentSender = null;
let adbExecutor = null;
let screenVerifier = null;

const screenshotCache = {
  device: null,
  timestamp: 0,
  image: null
};
const SCREENSHOT_CACHE_TTL = 300; // milliseconds
const lastFoundPositions = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

// Recovery plans for different failure scenarios
const RECOVERY_PLANS = {
  'tap-failed': [
    { type: 'retry', delay: 1000, maxRetries: 2 },
    { type: 'wait-element', timeout: 5000 },
    { type: 'refresh-screen', delay: 2000 }
  ],
  'swipe-failed': [
    { type: 'retry', delay: 500, maxRetries: 3 },
    { type: 'wait-element', timeout: 3000 }
  ],
  'screen-not-ready': [
    { type: 'wait-screen', timeout: 10000, reference: 'ready_screen.png' },
    { type: 'retry', delay: 1000, maxRetries: 2 }
  ],
  'app-crashed': [
    { type: 'restart-app', package: 'com.example.app' },
    { type: 'wait-screen', timeout: 5000, reference: 'app_launched.png' }
  ]
};

function sendLog(sender, type, message) {
  if (!sender) return;
  sender.send('flow-log', { timestamp: Date.now(), type, message });
}

async function runRecovery(plan, node, sender, device) {
  if (!plan || !Array.isArray(plan)) return { success: false, error: 'Invalid recovery plan' };

  sendLog(sender, 'info', `Starting recovery plan for ${node.type}`);

  for (const step of plan) {
    if (!isRunning) break;

    try {
      switch (step.type) {
        case 'retry':
          sendLog(sender, 'info', `Recovery: Retrying in ${step.delay}ms`);
          await delay(step.delay);
          const retryResult = await executeNode(node, sender, device);
          if (retryResult?.success) {
            return { success: true };
          }
          break;

        case 'wait-element':
          sendLog(sender, 'info', `Recovery: Waiting for element (${step.timeout}ms)`);
          await delay(step.timeout);
          break;

        case 'wait-screen':
          if (screenVerifier && step.reference) {
            sendLog(sender, 'info', `Recovery: Waiting for screen match (${step.timeout}ms)`);
            const refPath = `./references/${step.reference}`;
            const screenResult = await screenVerifier.waitForScreen(device, refPath, step.timeout);
            if (screenResult.success) {
              sendLog(sender, 'success', `Recovery: Screen matched (similarity: ${(screenResult.similarity * 100).toFixed(1)}%)`);
              return { success: true };
            }
          }
          break;

        case 'refresh-screen':
          sendLog(sender, 'info', `Recovery: Refreshing screen`);
          await delay(step.delay);
          // Could add screen refresh logic here
          break;

        case 'restart-app':
          if (step.package) {
            sendLog(sender, 'info', `Recovery: Restarting app ${step.package}`);
            await adbExec(device, `shell am force-stop ${step.package}`);
            await delay(1000);
            await adbExec(device, `shell monkey -p ${step.package} 1`);
            await delay(3000);
          }
          break;

        default:
          sendLog(sender, 'warn', `Unknown recovery step: ${step.type}`);
      }
    } catch (err) {
      sendLog(sender, 'error', `Recovery step failed: ${err.message}`);
    }
  }

  return { success: false, error: 'Recovery plan exhausted' };
}

function defaultAdbExecutor(args, device, cb, options = {}) {
  const bin = 'adb';
  const dFlag = device ? `-s "${device}"` : '';
  const cmd = `${bin} ${dFlag} ${args}`;
  const execOptions = {
    timeout: options.timeout || 30000,
    maxBuffer: options.maxBuffer || 50 * 1024 * 1024,
    encoding: options.encoding || 'utf8'
  };
  exec(cmd, execOptions, (err, stdout, stderr) => {
    cb({ success: !err, output: stdout || '', error: err?.message || stderr || '' });
  });
}

function setAdbExecutor(fn) {
  adbExecutor = fn;
}

function getAdbExecutor() {
  return adbExecutor || defaultAdbExecutor;
}

function buildGraph(nodes, edges) {
  const nodeMap = {};
  const edgeMap = {};

  (nodes || []).forEach(node => {
    nodeMap[node.id] = node;
  });

  (edges || []).forEach(edge => {
    const source = edge.source || edge.from;
    const target = edge.target || edge.to;
    if (!source || !target) return;
    if (!edgeMap[source]) edgeMap[source] = [];
    edgeMap[source].push(target);
  });

  return { nodeMap, edgeMap };
}

function getNextNode(edgeMap, id) {
  return edgeMap[id]?.[0] || null;
}

async function adbExec(device, command, options = {}) {
  return new Promise(resolve => {
    const execFn = getAdbExecutor();
    // Pass options to executor so it can use custom timeout/maxBuffer
    execFn(command, device, resolve, options);
  });
}

function isValidRegion(region) {
  return region && region.width > 0 && region.height > 0 && region.x >= 0 && region.y >= 0;
}

function expandRegion(region, padding = 50, maxWidth = Infinity, maxHeight = Infinity) {
  if (!region) return null;
  return {
    x: Math.max(0, region.x - padding),
    y: Math.max(0, region.y - padding),
    width: Math.min(maxWidth - 1, region.width + padding * 2),
    height: Math.min(maxHeight - 1, region.height + padding * 2)
  };
}

async function captureScreen(device, options = {}) {
  const result = await adbExec(device, 'exec-out screencap -p', {
    encoding: 'buffer',
    timeout: options.timeout || 15000,
    maxBuffer: options.maxBuffer || 150 * 1024 * 1024
  });

  if (!result.success) {
    return { success: false, error: result.error || 'ADB screenshot failed' };
  }

  const buffer = Buffer.isBuffer(result.output) ? result.output : Buffer.from(result.output, 'binary');
  try {
    const image = await Jimp.read(buffer);
    return { success: true, image };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to parse screenshot' };
  }
}

async function getScreenImage(device, forceRefresh = false, region = null) {
  const now = Date.now();
  if (!forceRefresh && screenshotCache.image && screenshotCache.device === device && (now - screenshotCache.timestamp) < SCREENSHOT_CACHE_TTL) {
    const cloned = screenshotCache.image.clone();
    if (region && isValidRegion(region)) {
      return { success: true, image: cloned.crop(region.x, region.y, region.width, region.height) };
    }
    return { success: true, image: cloned };
  }

  const capture = await captureScreen(device, { timeout: 12000 });
  if (!capture.success) return capture;

  screenshotCache.device = device;
  screenshotCache.timestamp = Date.now();
  screenshotCache.image = capture.image.clone();

  if (region && isValidRegion(region)) {
    return { success: true, image: capture.image.crop(region.x, region.y, region.width, region.height) };
  }
  return { success: true, image: capture.image };
}

function invalidateScreenCache(device) {
  if (screenshotCache.device === device) {
    screenshotCache.device = null;
    screenshotCache.timestamp = 0;
    screenshotCache.image = null;
  }
}

async function loadTemplateImage(data) {
  if (!data) return null;
  try {
    if (typeof data === 'string') {
      if (data.startsWith('data:image')) {
        const base64 = data.split(',')[1];
        return await Jimp.read(Buffer.from(base64, 'base64'));
      }
      if (fs.existsSync(data)) {
        return await Jimp.read(data);
      }
      const buffer = Buffer.from(data, 'base64');
      return await Jimp.read(buffer);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function findTemplateOnImage(screenImage, templateImage, threshold = 0.85, step = 4) {
  const screenW = screenImage.bitmap.width;
  const screenH = screenImage.bitmap.height;
  const tmplW = templateImage.bitmap.width;
  const tmplH = templateImage.bitmap.height;

  if (screenW < tmplW || screenH < tmplH) {
    return { found: false, confidence: 0, x: 0, y: 0, width: tmplW, height: tmplH, centerX: 0, centerY: 0 };
  }

  const sampleStep = Math.max(1, Math.floor(Math.min(tmplW, tmplH) / 12));
  const samples = [];
  for (let ty = 0; ty < tmplH; ty += sampleStep) {
    for (let tx = 0; tx < tmplW; tx += sampleStep) {
      const rgba = Jimp.intToRGBA(templateImage.getPixelColor(tx, ty));
      samples.push({ x: tx, y: ty, r: rgba.r, g: rgba.g, b: rgba.b });
    }
  }
  const maxAllowedDiff = (1 - threshold) * samples.length * 255 * 3;

  let bestScore = 0;
  let bestX = 0;
  let bestY = 0;
  const outerStep = Math.max(1, Math.min(step, Math.floor(Math.min(tmplW, tmplH) / 4)));

  for (let sy = 0; sy <= screenH - tmplH; sy += outerStep) {
    for (let sx = 0; sx <= screenW - tmplW; sx += outerStep) {
      let totalDiff = 0;
      let earlyExit = false;
      for (const px of samples) {
        const rgba = Jimp.intToRGBA(screenImage.getPixelColor(sx + px.x, sy + px.y));
        totalDiff += Math.abs(px.r - rgba.r) + Math.abs(px.g - rgba.g) + Math.abs(px.b - rgba.b);
        if (totalDiff > maxAllowedDiff) {
          earlyExit = true;
          break;
        }
      }
      if (earlyExit) continue;

      const score = 1 - totalDiff / (samples.length * 255 * 3);
      if (score > bestScore) {
        bestScore = score;
        bestX = sx;
        bestY = sy;
        if (bestScore >= 0.98) break;
      }
    }
    if (bestScore >= 0.98) break;
  }

  const found = bestScore >= threshold;
  return {
    found,
    confidence: bestScore,
    x: bestX,
    y: bestY,
    width: tmplW,
    height: tmplH,
    centerX: bestX + Math.floor(tmplW / 2),
    centerY: bestY + Math.floor(tmplH / 2)
  };
}

async function findTemplate(device, templateData, options = {}) {
  const {
    threshold = 0.85,
    nodeId = null,
    searchRegion = null,
    smartSearchRadius = 120,
    step = 4,
    forceFullScan = false
  } = options;

  const templateImage = await loadTemplateImage(templateData);
  if (!templateImage) {
    return { found: false, confidence: 0, error: 'Invalid template image' };
  }

  const screenRegion = isValidRegion(searchRegion) ? searchRegion : null;

  // 1. Try last known position first
  if (!forceFullScan && nodeId && lastFoundPositions.has(nodeId)) {
    const previous = lastFoundPositions.get(nodeId);
    const smartRegion = expandRegion(previous, smartSearchRadius);
    const capture = await getScreenImage(device, false, smartRegion);
    if (capture.success) {
      const localMatch = await findTemplateOnImage(capture.image, templateImage, threshold, step);
      if (localMatch.found) {
        const absoluteX = smartRegion.x + localMatch.x;
        const absoluteY = smartRegion.y + localMatch.y;
        lastFoundPositions.set(nodeId, { x: absoluteX, y: absoluteY, width: templateImage.bitmap.width, height: templateImage.bitmap.height });
        return { ...localMatch, x: absoluteX, y: absoluteY, centerX: absoluteX + Math.floor(templateImage.bitmap.width / 2), centerY: absoluteY + Math.floor(templateImage.bitmap.height / 2) };
      }
    }
  }

  // 2. Full region scan
  const capture = await getScreenImage(device, true, screenRegion);
  if (!capture.success) {
    return { found: false, confidence: 0, error: capture.error };
  }

  const match = await findTemplateOnImage(capture.image, templateImage, threshold, step);
  if (!match.found) {
    return match;
  }

  const absoluteX = (screenRegion ? screenRegion.x : 0) + match.x;
  const absoluteY = (screenRegion ? screenRegion.y : 0) + match.y;
  if (nodeId) {
    lastFoundPositions.set(nodeId, { x: absoluteX, y: absoluteY, width: templateImage.bitmap.width, height: templateImage.bitmap.height });
  }

  return {
    ...match,
    x: absoluteX,
    y: absoluteY,
    centerX: absoluteX + Math.floor(templateImage.bitmap.width / 2),
    centerY: absoluteY + Math.floor(templateImage.bitmap.height / 2)
  };
}

async function runOcrOnScreen(screenImage, targetText) {
  // Simple OCR-based text finding - convert image to base64 and use Tesseract
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');
    
    // Convert Jimp image to base64
    const base64 = await new Promise((resolve, reject) => {
      screenImage.getBase64('image/png', (err, data) => {
        if (err) reject(err);
        else resolve(data.split(',')[1]);
      });
    });
    
    const { data } = await worker.recognize('data:image/png;base64,' + base64);
    await worker.terminate();
    
    const recognizedText = data.text || '';
    
    // Simple text matching - look for target text in recognized text
    if (recognizedText.toLowerCase().includes(targetText.toLowerCase())) {
      // For now, return center of screen as location (could be improved with word bounding boxes)
      return {
        found: true,
        centerX: Math.floor(screenImage.bitmap.width / 2),
        centerY: Math.floor(screenImage.bitmap.height / 2),
        confidence: 0.8, // Placeholder confidence
        text: recognizedText
      };
    }
    
    return { found: false };
  } catch (err) {
    console.warn('OCR screen search failed:', err.message);
    return { found: false };
  }
}

function normalizeNumber(value) {
  const num = parseInt(value);
  return Number.isNaN(num) ? 0 : num;
}

// NEW: Cleanup flow resources and state
function cleanupFlow() {
  isRunning = false;
  currentSender = null;
  screenVerifier = null;
  destroyOcrWorker() // NEW
  // NEW: Clear reference cache to free memory on app restart
  const ScreenVerifier = require('./screenVerifier');
  ScreenVerifier.clearRefCache();
}

async function executeNode(node, sender, device) {
  if (!isRunning) return { success: false, error: 'Flow stopped' };

  const type = String(node.type || node.data?.type || '').toLowerCase();
  const data = node.data || {};

  // Smart Verify: Check screen state before execution if reference exists
  if (screenVerifier && data.verifyBefore && typeof data.verifyBefore === 'string') {
    const refPath = `./references/${data.verifyBefore}`;
    if (require('fs').existsSync(refPath)) {
      sendLog(sender, 'info', `Verifying screen before ${type}...`);
      const verifyResult = await screenVerifier.verifyScreen(device, refPath, data.verifyThreshold || 0.95);
      if (!verifyResult.success) {
        sendLog(sender, 'error', `Screen verification failed: ${verifyResult.error}`);
        // Try recovery
        const recoveryPlan = RECOVERY_PLANS['screen-not-ready'];
        const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
        if (!recoveryResult.success) {
          return { success: false, error: 'Screen verification and recovery failed' };
        }
      } else if (!verifyResult.match) {
        sendLog(sender, 'warn', `Screen mismatch (${(verifyResult.similarity * 100).toFixed(1)}%), attempting recovery`);
        const recoveryPlan = RECOVERY_PLANS['screen-not-ready'];
        const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
        if (!recoveryResult.success) {
          return { success: false, error: 'Screen mismatch and recovery failed' };
        }
      } else {
        sendLog(sender, 'success', `Screen verified (${(verifyResult.similarity * 100).toFixed(1)}% match)`);
      }
    }
  }

  const tapX = data.x ?? data.cx ?? data.mx;
  const tapY = data.y ?? data.cy ?? data.my;
  const swipeX1 = data.x1 ?? data.sx;
  const swipeY1 = data.y1 ?? data.sy;
  const swipeX2 = data.x2 ?? data.ex;
  const swipeY2 = data.y2 ?? data.ey;
  const duration = normalizeNumber(data.duration || data.delay || data.dur);
  const keycode = data.keycode || data.keyCode || data.key;

  try {
    if (type === 'delay') {
      const ms = duration || 0;
      sendLog(sender, 'info', `Delay ${ms}ms`);
      await delay(ms);
      return { success: true };
    }

    if (type === 'excel-loop') {
      const engine = new ExcelLoopEngine(data, (state) => {
        if (sender) {
          sender.send('excel-loop-state', state);
        }
        if (state.current_row != null) {
          data.current_row = state.current_row;
          data.total_processed = state.total_processed;
          data.total_skipped = state.total_skipped;
          data.current_value = state.current_value;
        }
      }, (level, message) => {
        if (sender) sender.send('excel-loop-log', { level: level.toUpperCase(), message });
      });
      await engine.run();
      return { success: true };
    }

    // NEW: Mobile Wait Text / Find Text — OCR-based text detection with polling
    if (type === 'mobile-find-text' || type === 'wait_for_text' || type === 'mobile-wait-text') {
      const {
        waitText = data.text || data.targetText || '',
        timeout = 30000,
        retryInterval = 2000,
        caseSensitive = false,
        matchType = 'contains',  // contains, exact, startsWith, regex
        ocrRegionX = 0,
        ocrRegionY = 0,
        ocrRegionW = 0,
        ocrRegionH = 0,
        ocrLanguage = 'ind+eng',
        onFoundAction = 'continue',  // continue, tap, tap_offset
        tapOffsetX = null,
        tapOffsetY = null,
        onTimeoutAction = 'stop',
        gotoStepIndex = null,
        outputVariable = null,
        delayBefore = 0
      } = data;

      if (!waitText) {
        sendLog(sender, 'error', 'Mobile Wait Text: No target text provided');
        return { success: false, error: 'No target text' };
      }

      if (delayBefore > 0) await delay(delayBefore);

      sendLog(sender, 'info', `[Wait Text] Starting OCR polling for: "${waitText}" (timeout: ${timeout}ms)`);

      const startTime = Date.now();
      let attempt = 0;

      while (isRunning) {
        const elapsed = Date.now() - startTime;

        if (elapsed >= timeout) {
          sendLog(sender, 'warn', `[Wait Text] Timeout after ${attempt} attempts (${elapsed}ms)`);

          if (outputVariable) setVariable?.(outputVariable, 'timeout');

          if (onTimeoutAction === 'stop') {
            isRunning = false;
            return { success: false, error: `Text not found: "${waitText}"` };
          } else if (onTimeoutAction === 'skip') {
            sendLog(sender, 'info', `[Wait Text] Skipping due to timeout`);
            return { success: true, skipped: true };
          } else if (onTimeoutAction === 'goto' && gotoStepIndex !== null) {
            sendLog(sender, 'info', `[Wait Text] Going to step ${gotoStepIndex}`);
            return { success: true, gotoStep: gotoStepIndex };
          }
          break;
        }

        attempt++;
        sendLog(sender, 'info', `[Wait Text] Attempt #${attempt} (${elapsed}ms elapsed)`);

        try {
          // Use waitForText from ocrReader for OCR
          const result = await waitForText(
            device,
            waitText,
            {
              timeout: Math.min(retryInterval, 5000),
              interval: 500,
              caseSensitive: caseSensitive,
              matchType: matchType
            },
            sender
          );

          if (result && result.found) {
            sendLog(sender, 'success', `[Wait Text] Text found: "${waitText}" after ${attempt} attempts`);

            if (outputVariable) setVariable?.(outputVariable, 'found');

            // Handle found action
            if (onFoundAction === 'tap' && tapOffsetX !== null && tapOffsetY !== null) {
              await adbExec(device, `shell input tap ${tapOffsetX} ${tapOffsetY}`);
              sendLog(sender, 'success', `[Wait Text] Tapped at offset (${tapOffsetX}, ${tapOffsetY})`);
            }

            return { success: true, foundText: waitText };
          }

        } catch (err) {
          sendLog(sender, 'warn', `[Wait Text] OCR attempt error: ${err.message}`);
        }

        // Wait before next poll
        await delay(retryInterval);
      }

      return { success: false, error: 'Wait Text polling ended' };
    }

    // NEW: Mobile Type Text
    if (type === 'mobile-type') { // NEW
      const text = data.typeText || data.text || '' // NEW
      if (!text) { sendLog(sender,'warn','Mobile Type: teks kosong'); return { success:false, error:'Text empty' } } // NEW
      if (data.typeClear) { // NEW
        await adbExec(device, 'shell input keyevent KEYCODE_CTRL_A') // NEW
        await delay(100) // NEW
        await adbExec(device, 'shell input keyevent KEYCODE_DEL') // NEW
        await delay(100) // NEW
      } // NEW
      const escaped = String(text).replace(/ /g, '%s') // NEW
                          .replace(/&/g, '\\&') // NEW
                          .replace(/</g, '\\<') // NEW
                          .replace(/>/g, '\\>') // NEW
      await adbExec(device, `shell input text "${escaped}"`) // NEW
      sendLog(sender, 'success', `Typed: "${text}"`) // NEW
      return { success: true }; // NEW
    } // NEW

    // NEW: Mobile Scroll
    if (type === 'mobile-scroll') { // NEW
      const dir      = data.scrollDir   || 'down' // NEW
      const count    = data.scrollCount || 1 // NEW
      const speed    = { slow:800, normal:500, fast:200 }[data.scrollSpeed||'normal'] // NEW
      const dist     = { short:300, medium:500, long:800, full:1000 }[data.scrollDist||'medium'] // NEW

      const cx = 540, cy = 960 // NEW
      let x1,y1,x2,y2 // NEW
      if (dir==='down')  { x1=cx;y1=cy-dist/2; x2=cx;y2=cy+dist/2 } // NEW
      if (dir==='up')    { x1=cx;y1=cy+dist/2; x2=cx;y2=cy-dist/2 } // NEW
      if (dir==='right') { x1=cx-dist/2;y1=cy; x2=cx+dist/2;y2=cy } // NEW
      if (dir==='left')  { x1=cx+dist/2;y1=cy; x2=cx-dist/2;y2=cy } // NEW

      for (let i=0; i<count; i++) { // NEW
        if (!isRunning) return { success:false, error:'Flow stopped' } // NEW
        await adbExec(device, `shell input swipe ${x1} ${y1} ${x2} ${y2} ${speed}`) // NEW
        if (i < count-1) await delay(300) // NEW
      } // NEW
      sendLog(sender,'success',`Scrolled ${dir} x${count}`) // NEW
      return { success: true }; // NEW
    } // NEW

    // NEW: Wait & Tap — Enhanced polling version with image matching
    if (type === 'wait-and-tap') {
      const {
        referenceImage,
        referenceImagePath,
        referenceImageRegionX = 0,
        referenceImageRegionY = 0,
        referenceImageRegionW = 0,
        referenceImageRegionH = 0,
        tapX,
        tapY,
        timeout = 30000,
        retryInterval = 1000,
        confidence = 80,
        randomizeTapOffset = false,
        offsetRange = 5,
        delayBefore = 0,
        onTimeoutAction = 'stop',
        gotoStepIndex = null,
        outputVariable = null
      } = data;

      if (!referenceImage && !referenceImagePath) {
        sendLog(sender, 'error', 'Wait & Tap: No reference image provided');
        return { success: false, error: 'No reference image' };
      }

      if (delayBefore > 0) await delay(delayBefore);

      const templateSource = referenceImage || null;
      const threshold = Math.max(0.1, Math.min(1, confidence / 100));
      const searchRegion = isValidRegion({ x: referenceImageRegionX, y: referenceImageRegionY, width: referenceImageRegionW, height: referenceImageRegionH })
        ? { x: referenceImageRegionX, y: referenceImageRegionY, width: referenceImageRegionW, height: referenceImageRegionH }
        : null;
      const nodeId = node.id || null;
      const startTime = Date.now();
      let attempt = 0;

      sendLog(sender, 'info', `[Wait & Tap] Starting visual wait (timeout: ${timeout}ms, interval: ${retryInterval}ms, threshold: ${(threshold*100).toFixed(0)}%)`);

      while (isRunning) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeout) {
          sendLog(sender, 'warn', `[Wait & Tap] Timeout after ${attempt} attempts (${elapsed}ms)`);
          if (outputVariable) setVariable?.(outputVariable, 'timeout');
          if (onTimeoutAction === 'stop') {
            isRunning = false;
            return { success: false, error: 'Wait & Tap timeout' };
          }
          if (onTimeoutAction === 'skip') {
            sendLog(sender, 'info', '[Wait & Tap] Skipping due to timeout');
            return { success: true, skipped: true };
          }
          if (onTimeoutAction === 'goto' && gotoStepIndex !== null) {
            sendLog(sender, 'info', `[Wait & Tap] Going to step ${gotoStepIndex}`);
            return { success: true, gotoStep: gotoStepIndex };
          }
          break;
        }

        attempt++;
        sendLog(sender, 'info', `[Wait & Tap] Attempt #${attempt} (${elapsed}ms elapsed)`);

        try {
          const match = await findTemplate(device, templateSource, {
            threshold,
            nodeId,
            searchRegion,
            smartSearchRadius: 120,
            step: Math.max(2, Math.floor(Math.min(referenceImageRegionW || 100, referenceImageRegionH || 100) / 8)),
            forceFullScan: attempt % 5 === 0
          });

          if (!match.found) {
            sendLog(sender, 'info', `[Wait & Tap] Not found yet (best confidence ${(match.confidence*100).toFixed(1)}%)`);
            await delay(retryInterval);
            continue;
          }

          let targetX = match.centerX;
          let targetY = match.centerY;
          if (typeof tapX === 'number' && typeof tapY === 'number') {
            targetX = tapX;
            targetY = tapY;
          }
          if (randomizeTapOffset && offsetRange > 0) {
            targetX += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
            targetY += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
          }

          const tapResult = await adbExec(device, `shell input tap ${targetX} ${targetY}`);
          invalidateScreenCache(device);
          if (!tapResult.success) {
            sendLog(sender, 'error', `[Wait & Tap] Tap failed: ${tapResult.error}`);
            return { success: false, error: 'Tap failed after match' };
          }

          if (outputVariable) setVariable?.(outputVariable, 'found');
          sendLog(sender, 'success', `[Wait & Tap] Found and tapped at (${targetX},${targetY}) — confidence ${(match.confidence*100).toFixed(1)}%`);
          return { success: true, elapsed, attempts: attempt, tapX: targetX, tapY: targetY, foundAt: match };
        } catch (err) {
          sendLog(sender, 'error', `[Wait & Tap] Error: ${err.message}`);
          await delay(retryInterval);
        }
      }

      return { success: false, error: 'Wait & Tap aborted' };
    }

    if (type === 'tap' || type === 'mobile-tap' || type === 'click') {
      // Enhanced mobile-tap with visual element matching
      const {
        // Legacy properties for backward compatibility
        referenceImage,
        referenceImagePath,
        referenceImageRegionX = 0,
        referenceImageRegionY = 0,
        referenceImageRegionW = 0,
        referenceImageRegionH = 0,
        confidence = 80,
        randomizeTapOffset = false,
        offsetRange = 5,
        
        // New enhanced properties
        coordinateX,
        coordinateY,
        templateImageBase64,
        targetText,
        matchMode = 'COORDINATE_ONLY', // 'COORDINATE_ONLY', 'IMAGE', 'TEXT', 'IMAGE_OR_TEXT'
        matchThreshold = 0.85,
        waitTimeout = 30000,
        retryInterval = 1000
      } = data;

      // If no enhanced properties, fall back to legacy behavior
      if (!templateImageBase64 && !targetText && matchMode === 'COORDINATE_ONLY') {
        // Legacy image matching
        if (referenceImage || referenceImagePath) {
          const templateSource = referenceImage || null;
          const threshold = Math.max(0.1, Math.min(1, confidence / 100));
          const searchRegion = isValidRegion({ x: referenceImageRegionX, y: referenceImageRegionY, width: referenceImageRegionW, height: referenceImageRegionH })
            ? { x: referenceImageRegionX, y: referenceImageRegionY, width: referenceImageRegionW, height: referenceImageRegionH }
            : null;
          const nodeId = node.id || null;
          const match = await findTemplate(device, templateSource, {
            threshold,
            nodeId,
            searchRegion,
            smartSearchRadius: 120,
            step: Math.max(2, Math.floor(Math.min(referenceImageRegionW || 100, referenceImageRegionH || 100) / 8)),
            forceFullScan: true
          });

          if (!match.found) {
            sendLog(sender, 'warn', `[Tap] Reference image not found (best confidence ${(match.confidence * 100).toFixed(1)}%)`);
            return { success: false, error: 'Reference image not found' };
          }
          let targetX = match.centerX;
          let targetY = match.centerY;
          if (randomizeTapOffset && offsetRange > 0) {
            targetX += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
            targetY += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
          }
          const result = await adbExec(device, `shell input tap ${targetX} ${targetY}`);
          invalidateScreenCache(device);
          if (!result.success) {
            sendLog(sender, 'error', `ADB tap failed: ${result.error}`);
            const recoveryPlan = RECOVERY_PLANS['tap-failed'];
            const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
            return recoveryResult;
          }
          sendLog(sender, 'success', `Tap at matched position ${targetX},${targetY}`);
          return { success: true };
        }

        // Coordinate-only tap
        if (tapX == null || tapY == null) {
          sendLog(sender, 'warn', 'Tap node missing coordinates');
          return { success: false, error: 'Missing coordinates' };
        }
        const result = await adbExec(device, `shell input tap ${tapX} ${tapY}`);
        if (!result.success) {
          sendLog(sender, 'error', `ADB tap failed: ${result.error}`);
          const recoveryPlan = RECOVERY_PLANS['tap-failed'];
          const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
          return recoveryResult;
        }
        sendLog(sender, 'success', `Tap ${tapX},${tapY}`);
        return { success: true };
      }

      // Enhanced visual element matching with wait/retry
      sendLog(sender, 'info', `[Mobile Tap] Starting visual element search (mode: ${matchMode}, timeout: ${waitTimeout}ms)`);
      
      const startTime = Date.now();
      let attempt = 0;
      const nodeId = node.id || null;
      
      while (Date.now() - startTime < waitTimeout) {
        attempt++;
        const elapsed = Date.now() - startTime;
        
        sendLog(sender, 'info', `[Mobile Tap] Attempt #${attempt} (${elapsed}ms elapsed)`);
        
        try {
          // Take current screenshot
          const currentScreen = await getScreenImage(device, true);
          if (!currentScreen.success) {
            sendLog(sender, 'warn', `[Mobile Tap] Screenshot failed: ${currentScreen.error}`);
            await delay(retryInterval);
            continue;
          }
          
          let foundLocation = null;
          
          // Try image template matching
          if ((matchMode === 'IMAGE' || matchMode === 'IMAGE_OR_TEXT') && templateImageBase64) {
            const match = await findTemplateOnImage(currentScreen.image, await loadTemplateImage(templateImageBase64), matchThreshold, 4);
            if (match.found) {
              foundLocation = {
                centerX: match.centerX,
                centerY: match.centerY,
                confidence: match.confidence,
                method: 'image'
              };
            }
          }
          
          // Try OCR text search if image didn't work or mode includes text
          if (!foundLocation && (matchMode === 'TEXT' || matchMode === 'IMAGE_OR_TEXT') && targetText) {
            // Use OCR to find text on screen
            const ocrResult = await runOcrOnScreen(currentScreen.image, targetText);
            if (ocrResult.found) {
              foundLocation = {
                centerX: ocrResult.centerX,
                centerY: ocrResult.centerY,
                confidence: ocrResult.confidence,
                method: 'ocr'
              };
            }
          }
          
          if (foundLocation) {
            // Element found! Tap at center of found location
            let targetX = foundLocation.centerX;
            let targetY = foundLocation.centerY;
            
            // Apply randomization if enabled
            if (randomizeTapOffset && offsetRange > 0) {
              targetX += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
              targetY += Math.floor(Math.random() * (offsetRange * 2 + 1)) - offsetRange;
            }
            
            const tapResult = await adbExec(device, `shell input tap ${targetX} ${targetY}`);
            invalidateScreenCache(device);
            
            if (!tapResult.success) {
              sendLog(sender, 'error', `[Mobile Tap] Tap failed: ${tapResult.error}`);
              return { success: false, error: 'Tap failed after element found' };
            }
            
            sendLog(sender, 'success', `✅ Element found and tapped at (${targetX},${targetY}) via ${foundLocation.method} (confidence: ${(foundLocation.confidence * 100).toFixed(1)}%)`);
            return { success: true, location: foundLocation, attempts: attempt, elapsed };
          }
          
          // Element not found yet, wait and retry
          sendLog(sender, 'info', `⏳ Element not found, retrying in ${retryInterval}ms...`);
          await delay(retryInterval);
          
        } catch (err) {
          sendLog(sender, 'warn', `[Mobile Tap] Attempt error: ${err.message}`);
          await delay(retryInterval);
        }
      }
      
      // Timeout reached - fallback to saved coordinates
      const finalElapsed = Date.now() - startTime;
      sendLog(sender, 'warn', `⏳ Element not found after ${finalElapsed}ms timeout (${attempt} attempts)`);
      
      if (coordinateX != null && coordinateY != null && coordinateX !== 0 && coordinateY !== 0) {
        sendLog(sender, 'info', `⚠️ Fallback to saved coordinates (${coordinateX},${coordinateY})`);
        const fallbackResult = await adbExec(device, `shell input tap ${coordinateX} ${coordinateY}`);
        invalidateScreenCache(device);
        if (!fallbackResult.success) {
          sendLog(sender, 'error', `Fallback tap failed: ${fallbackResult.error}`);
          throw new Error(`Element not found and fallback tap failed: ${fallbackResult.error}`);
        }
        sendLog(sender, 'success', `Tap at fallback coordinates ${coordinateX},${coordinateY}`);
        return { success: true, method: 'coordinate_fallback', x: coordinateX, y: coordinateY };
      }
      
      throw new Error(`Element not found: timeout after ${waitTimeout}ms and no valid fallback coordinates`);
    }

    if (type === 'swipe' || type === 'mobile-swipe') {
      if (swipeX1 == null || swipeY1 == null || swipeX2 == null || swipeY2 == null) {
        sendLog(sender, 'warn', 'Swipe node missing coordinates');
        return { success: false, error: 'Missing coordinates' };
      }
      const result = await adbExec(device, `shell input swipe ${swipeX1} ${swipeY1} ${swipeX2} ${swipeY2} ${duration || 300}`);
      if (!result.success) {
        sendLog(sender, 'error', `ADB swipe failed: ${result.error}`);
        // Try recovery for swipe failure
        const recoveryPlan = RECOVERY_PLANS['swipe-failed'];
        const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
        return recoveryResult;
      }
      sendLog(sender, 'success', `Swipe ${swipeX1},${swipeY1} -> ${swipeX2},${swipeY2}`);
      return { success: true };
    }

    if (type === 'key' || type === 'mobile-press-key') {
      if (!keycode) {
        sendLog(sender, 'warn', 'Key node missing keycode');
        return { success: false, error: 'Missing keycode' };
      }
      const result = await adbExec(device, `shell input keyevent ${keycode}`);
      if (!result.success) {
        sendLog(sender, 'error', `ADB keyevent failed: ${result.error}`);
        return { success: false, error: result.error };
      }
      sendLog(sender, 'success', `Key event ${keycode}`);
      return { success: true };
    }

    // NEW: wait_for_text node
    if (type === 'wait_for_text') {
      const result = await waitForText(
        device,
        node.data.text,
        {
          timeout:       node.data.timeout       || 30000,
          interval:      node.data.interval      || 2000,
          caseSensitive: node.data.caseSensitive || false
        },
        sender
      )
      if (!result.found) {
        if (node.data.onFail === 'stop') {
          isRunning = false
          return
        }
        if (node.data.onFail === 'recovery') {
          await runRecovery('full_restart', sender, device)
        }
        // 'skip' → lanjut saja
      }
      return
    }

    sendLog(sender, 'info', `Skipped unsupported node type: ${type}`);
    return { success: true };
  } catch (err) {
    sendLog(sender, 'error', `Node execution error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function runFlow(flowData, sender) {
  if (isRunning) {
    sendLog(sender, 'warn', 'Flow already running');
    return;
  }

  if (!flowData || !Array.isArray(flowData.nodes) || flowData.nodes.length === 0) {
    sendLog(sender, 'error', 'Flow data must include at least one node');
    return;
  }

  // NEW: Reset state before starting new run
  isRunning = false;
  await new Promise(r => setTimeout(r, 100));
  
  isRunning = true;
  currentSender = sender;

  // Initialize screen verifier
  screenVerifier = new ScreenVerifier(getAdbExecutor());

  const { nodeMap, edgeMap } = buildGraph(flowData.nodes, flowData.edges || []);
  const startId = flowData.nodes[0].id;
  const device = flowData.device || '';
  const loopStack = [];

  sendLog(sender, 'info', `Flow started: ${flowData.name || 'unnamed'}`);

  let currentId = startId;
  let flowSuccess = true;

  while (currentId && isRunning) {
    const node = nodeMap[currentId];
    if (!node) {
      sendLog(sender, 'warn', `Missing node: ${currentId}`);
      flowSuccess = false;
      break;
    }

    const type = String(node.type || node.data?.type || '').toLowerCase();
    if (type === 'repeat-start' || type === 'loop-start' || type === 'loop') {
      loopStack.push({
        startId: getNextNode(edgeMap, currentId),
        current: 0,
        max: Math.max(1, normalizeNumber(node.data?.repeat || node.data?.repeatCount || node.data?.loopCount))
      });
      sendLog(sender, 'info', `Loop started (${loopStack[loopStack.length - 1].max}x)`);
      currentId = getNextNode(edgeMap, currentId);
      continue;
    }

    if (type === 'repeat-end' || type === 'loop-end') {
      const loop = loopStack[loopStack.length - 1];
      if (loop && loop.current < loop.max - 1) {
        loop.current += 1;
        sendLog(sender, 'info', `Loop iteration ${loop.current + 1}/${loop.max}`);
        currentId = loop.startId;
        continue;
      }
      loopStack.pop();
      currentId = getNextNode(edgeMap, currentId);
      continue;
    }

    const execResult = await executeNode(node, sender, node.data?.deviceId || device);
    if (!execResult?.success) {
      sendLog(sender, 'error', `Node ${node.name || node.id} failed: ${execResult?.error || 'Unknown error'}`);
      flowSuccess = false;
      // Continue to next node instead of stopping flow
      currentId = getNextNode(edgeMap, currentId);
      continue;
    }

    currentId = getNextNode(edgeMap, currentId);
  }

  if (isRunning) {
    sendLog(sender, flowSuccess ? 'success' : 'warn', `Flow complete (${flowSuccess ? 'success' : 'with errors'})`);
    sender.send('flow-complete', { success: flowSuccess });
  }

  // NEW: Cleanup flow resources
  cleanupFlow();
}

function stopFlow() {
  if (!isRunning) return;
  if (currentSender) {
    sendLog(currentSender, 'warn', 'Flow stopped by user');
    currentSender.send('flow-complete', { success: false });
  }
  // NEW: Cleanup flow resources on stop
  cleanupFlow();
}

module.exports = { runFlow, stopFlow, setAdbExecutor, cleanupFlow, setExcelLoopBrowserManager };
