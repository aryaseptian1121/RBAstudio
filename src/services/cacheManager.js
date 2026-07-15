const fs = require('fs');
const path = require('path');
const os = require('os');

function normalizePath(value) {
  return value ? path.resolve(String(value)) : null;
}

function shouldDeleteFile(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  return normalized.startsWith('temp_')
    || normalized.startsWith('tmp_')
    || normalized.endsWith('.tmp')
    || normalized.endsWith('.cache')
    || normalized.includes('_cache')
    || normalized.includes('screenshot')
    || normalized.includes('ocr');
}

async function clearRuntimeCache(options = {}) {
  const referencesDir = normalizePath(options.referencesDir || path.join(process.cwd(), 'references'));
  const outputDir = normalizePath(options.outputDir || path.join(process.cwd(), 'output'));
  const tempDir = normalizePath(options.tempDir || os.tmpdir());
  const clearDisk = options.clearDisk !== false;

  const targets = [];
  if (referencesDir && fs.existsSync(referencesDir)) {
    targets.push(referencesDir);
  }
  if (outputDir && fs.existsSync(outputDir)) {
    targets.push(outputDir);
  }
  if (tempDir && fs.existsSync(tempDir)) {
    targets.push(tempDir);
  }

  const deletedFiles = [];

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;

    const entries = fs.readdirSync(target, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(target, entry.name);
      if (!clearDisk) continue;
      try {
        if (entry.isDirectory()) {
          continue;
        }
        if (clearDisk && shouldDeleteFile(entry.name)) {
          fs.unlinkSync(entryPath);
          deletedFiles.push(entryPath);
        }
      } catch (error) {
        // Ignore individual file errors and continue.
      }
    }
  }

  return {
    ok: true,
    deletedFiles,
    deletedCount: deletedFiles.length,
    targets
  };
}

module.exports = { clearRuntimeCache };
