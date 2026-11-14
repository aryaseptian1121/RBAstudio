const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

// NEW: Reference cache to avoid reloading same images
const refCache = new Map();

class ScreenVerifier {
  constructor(adbExecutor, referencesPath = './references') {
    this.adbExecutor = adbExecutor;
    this.referencesPath = referencesPath;
    this.ensureReferencesDir();
  }

  ensureReferencesDir() {
    if (!fs.existsSync(this.referencesPath)) {
      fs.mkdirSync(this.referencesPath, { recursive: true });
    }
  }

  // NEW: Load reference image from cache or disk
  async loadRef(refPath) {
    if (!refCache.has(refPath)) {
      try {
        const img = await Jimp.read(refPath);
        refCache.set(refPath, img);
      } catch (err) {
        return null;
      }
    }
    return refCache.get(refPath);
  }

  // NEW: Clear reference cache (call on app restart)
  static clearRefCache() {
    refCache.clear();
  }

  async captureScreen(device, filename = null) {
    const tempPath = filename || path.join(this.referencesPath, `temp_${Date.now()}.png`);

    return new Promise((resolve) => {
      this.adbExecutor(`shell screencap -p`, device, async (result) => {
        if (!result.success) {
          resolve({ success: false, error: result.error });
          return;
        }

        try {
          // ADB screencap output is binary, save to file
          const buffer = Buffer.from(result.output, 'binary');
          fs.writeFileSync(tempPath, buffer);

          const image = await Jimp.read(tempPath);
          resolve({
            success: true,
            path: tempPath,
            image: image,
            width: image.bitmap.width,
            height: image.bitmap.height
          });
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  async compareImages(image1, image2, threshold = 0.95) {
    try {
      // Resize images to same size if needed
      const width = Math.min(image1.bitmap.width, image2.bitmap.width);
      const height = Math.min(image1.bitmap.height, image2.bitmap.height);

      image1.resize(width, height);
      image2.resize(width, height);

      const diff = Jimp.diff(image1, image2);
      const similarity = 1 - diff.percent;

      const result = {
        success: true,
        similarity: similarity,
        match: similarity >= threshold,
        diffImage: diff.image
      };

      // NEW: Release image objects to free memory
      image1 = null;
      image2 = null;

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async waitForScreen(device, referencePath, timeout = 10000, threshold = 0.95) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const capture = await this.captureScreen(device);
      if (!capture.success) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      try {
        // CHANGED: Use cache-aware loadRef instead of Jimp.read
        const reference = await this.loadRef(referencePath);
        if (!reference) {
          throw new Error('Failed to load reference image');
        }
        const comparison = await this.compareImages(capture.image, reference, threshold);

        if (comparison.success && comparison.match) {
          // Cleanup temp file
          if (capture.path.includes('temp_')) {
            fs.unlinkSync(capture.path);
          }
          // NEW: Release capture image buffer
          let buf = capture.image;
          buf = null;
          return { success: true, similarity: comparison.similarity };
        }
      } catch (err) {
        // Continue waiting
      }

      // Cleanup temp file
      if (capture.path.includes('temp_')) {
        fs.unlinkSync(capture.path);
      }
      // NEW: Release capture image buffer after each poll
      let buf = capture.image;
      buf = null;

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return { success: false, error: 'Screen did not match within timeout' };
  }

  async saveReference(device, filename) {
    const filepath = path.join(this.referencesPath, filename);
    const capture = await this.captureScreen(device, filepath);

    if (capture.success) {
      return { success: true, path: filepath };
    }

    return { success: false, error: capture.error };
  }

  async verifyScreen(device, referencePath, threshold = 0.95) {
    const capture = await this.captureScreen(device);
    if (!capture.success) {
      return { success: false, error: capture.error };
    }

    try {
      // CHANGED: Use cache-aware loadRef instead of Jimp.read
      const reference = await this.loadRef(referencePath);
      if (!reference) {
        throw new Error('Failed to load reference image');
      }
      const comparison = await this.compareImages(capture.image, reference, threshold);

      // Cleanup temp file
      if (capture.path.includes('temp_')) {
        fs.unlinkSync(capture.path);
      }
      // NEW: Release capture image buffer
      let buf = capture.image;
      buf = null;

      return comparison;
    } catch (err) {
      // Cleanup temp file
      if (capture.path.includes('temp_')) {
        fs.unlinkSync(capture.path);
      }
      return { success: false, error: err.message };
    }
  }
}

module.exports = ScreenVerifier;