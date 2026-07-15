const { exec } = require('child_process'); // NEW
const Tesseract = require('tesseract.js'); // NEW

let ocrWorker = null; // NEW
let waitActive = true; // NEW
const OCR_LANGUAGE = 'eng'; // NEW

function delay(ms) { // NEW
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); // NEW
}

function sendProgress(sender, type, message) { // NEW
  if (!sender || typeof sender.send !== 'function') return; // NEW
  sender.send('flow-log', { timestamp: Date.now(), type, message }); // NEW
}

async function getOcrWorker() { // NEW
  if (ocrWorker) return ocrWorker; // NEW

  ocrWorker = Tesseract.createWorker({ // NEW
    logger: () => {} // NEW
  }); // NEW

  await ocrWorker.load(); // NEW
  await ocrWorker.loadLanguage(OCR_LANGUAGE); // NEW
  await ocrWorker.initialize(OCR_LANGUAGE); // NEW

  return ocrWorker; // NEW
}

async function readTextFromScreen(deviceId) { // NEW
  if (!deviceId) { // NEW
    throw new Error('Device ID is required for OCR'); // NEW
  }

  const command = `adb -s "${deviceId}" exec-out screencap -p`; // NEW

  let buffer = await new Promise((resolve, reject) => { // NEW
    exec(command, { encoding: null, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => { // NEW
      if (err) { // NEW
        return reject(new Error(stderr || err.message || 'ADB screencap failed')); // NEW
      } // NEW
      resolve(stdout); // NEW
    }); // NEW
  }); // NEW

  try { // NEW
    const worker = await getOcrWorker(); // NEW
    const { data } = await worker.recognize(buffer); // NEW
    const text = String(data?.text || ''); // NEW
    return text; // NEW
  } finally { // NEW
    // Null out buffer reference so V8 can reclaim memory sooner // NEW
    // eslint-disable-next-line no-param-reassign // NEW
    buffer = null; // NEW
  } // NEW
}

async function waitForText(deviceId, targetText, options = {}, sender) { // NEW
  const timeout = Number.isFinite(options.timeout) ? options.timeout : 30000; // NEW
  const interval = Number.isFinite(options.interval) ? options.interval : 2000; // NEW
  const caseSensitive = Boolean(options.caseSensitive); // NEW
  const startTime = Date.now(); // NEW
  const normalizedTarget = caseSensitive ? String(targetText) : String(targetText).toLowerCase(); // NEW

  waitActive = true; // NEW

  while (waitActive) { // NEW
    const elapsed = Date.now() - startTime; // NEW
    let recognizedText = ''; // NEW

    try { // NEW
      recognizedText = await readTextFromScreen(deviceId); // NEW
    } catch (err) { // NEW
      sendProgress(sender, 'warn', `OCR read failed: ${err.message}`); // NEW
    }

    const searchText = caseSensitive ? recognizedText : recognizedText.toLowerCase(); // NEW
    sendProgress(sender, 'info', `Waiting for text: "${targetText}" (${(elapsed / 1000).toFixed(1)}s elapsed)`); // NEW

    if (searchText.includes(normalizedTarget)) { // NEW
      const foundElapsed = Date.now() - startTime; // NEW
      sendProgress(sender, 'success', `Text found: "${targetText}" in ${(foundElapsed / 1000).toFixed(1)}s`); // NEW
      return { found: true, elapsed: foundElapsed }; // NEW
    }

    if (elapsed >= timeout) { // NEW
      sendProgress(sender, 'warn', `Text not found after ${(timeout / 1000).toFixed(0)}s`); // NEW
      return { found: false, elapsed }; // NEW
    }

    if (!waitActive) break; // NEW
    await delay(interval); // NEW
  } // NEW

  const finalElapsed = Date.now() - startTime; // NEW
  return { found: false, elapsed: finalElapsed }; // NEW
}

async function destroyOcrWorker() { // NEW
  waitActive = false; // NEW
  if (!ocrWorker) return; // NEW
  try { // NEW
    await ocrWorker.terminate(); // NEW
  } catch (err) { // NEW
    // Ignore termination errors during cleanup // NEW
  } // NEW
  ocrWorker = null; // NEW
}

function resetOcrState() {
  waitActive = false;
  ocrWorker = null;
}

module.exports = { waitForText, destroyOcrWorker, resetOcrState }; // NEW
