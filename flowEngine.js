const { exec } = require('child_process');
const ScreenVerifier = require('./screenVerifier');
const { waitForText, destroyOcrWorker } = require('./ocrReader') // NEW

let isRunning = false;
let currentSender = null;
let adbExecutor = null;
let screenVerifier = null;

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

function defaultAdbExecutor(args, device, cb) {
  const bin = 'adb';
  const dFlag = device ? `-s "${device}"` : '';
  const cmd = `${bin} ${dFlag} ${args}`;
  exec(cmd, { timeout: 30000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
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

async function adbExec(device, command) {
  return new Promise(resolve => {
    const execFn = getAdbExecutor();
    execFn(command, device, resolve);
  });
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

    // NEW: Mobile Wait Text — tunggu teks muncul via OCR
    if (type === 'mobile-find-text' || type === 'wait_for_text') { // NEW
      const result = await waitForText( // NEW
        device, // NEW
        data.waitText || data.text || '', // NEW
        { // NEW
          timeout:       data.waitTimeout  || 30000, // NEW
          interval:      data.waitInterval || 2000, // NEW
          caseSensitive: false // NEW
        }, // NEW
        sender // NEW
      ) // NEW
      if (!result.found) { // NEW
        const onFail = data.waitOnFail || 'stop' // NEW
        if (onFail === 'stop') { // NEW
          isRunning = false // NEW
          sendLog(sender, 'error', `Text not found: "${data.waitText}" — flow stopped`) // NEW
          return // NEW
        } // NEW
        if (onFail === 'recovery') { // NEW
          await runRecovery(RECOVERY_PLANS['tap-failed'], node, sender, device) // NEW
        } // NEW
        sendLog(sender, 'warn', `Text not found: "${data.waitText}" — skipping`) // NEW
      } // NEW
      return // NEW
    } // NEW

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

    // NEW: Wait & Tap
    if (type === 'wait-and-tap') { // NEW
      const result = await waitForText( // NEW
        device, // NEW
        data.watText || '', // NEW
        { timeout: data.watTimeout || 15000, interval: 2000 }, // NEW
        sender // NEW
      ) // NEW
      if (!result.found) { // NEW
        if ((data.watOnFail || 'stop') === 'stop') { // NEW
          isRunning = false // NEW
          sendLog(sender,'error',`Wait & Tap: "${data.watText}" tidak muncul — stop`) // NEW
          return { success:false, error:'Wait text not found' } // NEW
        } // NEW
        sendLog(sender,'warn',`Wait & Tap: timeout, tap tetap dijalankan`) // NEW
      } // NEW
      await delay(data.watDelay || 500) // NEW
      await adbExec(device, `shell input tap ${data.watX || 540} ${data.watY || 960}`) // NEW
      sendLog(sender,'success',`Wait & Tap selesai: tap ${data.watX || 540},${data.watY || 960}`) // NEW
      return { success: true }; // NEW
    } // NEW

    if (type === 'tap' || type === 'mobile-tap' || type === 'click') {
      if (tapX == null || tapY == null) {
        sendLog(sender, 'warn', 'Tap node missing coordinates');
        return { success: false, error: 'Missing coordinates' };
      }
      const result = await adbExec(device, `shell input tap ${tapX} ${tapY}`);
      if (!result.success) {
        sendLog(sender, 'error', `ADB tap failed: ${result.error}`);
        // Try recovery for tap failure
        const recoveryPlan = RECOVERY_PLANS['tap-failed'];
        const recoveryResult = await runRecovery(recoveryPlan, node, sender, device);
        return recoveryResult;
      }
      sendLog(sender, 'success', `Tap ${tapX},${tapY}`);
      return { success: true };
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

module.exports = { runFlow, stopFlow, setAdbExecutor, cleanupFlow };
