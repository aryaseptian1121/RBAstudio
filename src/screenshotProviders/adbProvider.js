class AdbScreenshotProvider {
  constructor(options = {}) {
    this.type = 'adb';
    this.deviceId = options.deviceId ?? null;
    this.adbManager = options.adbManager || null;
  }

  getManager() {
    if (this.adbManager) {
      return this.adbManager;
    }

    const adbManager = require('../../utils/adbManager');
    return adbManager;
  }

  async capture() {
    if (!this.deviceId) {
      throw new Error('Device ID wajib diisi untuk ADB provider');
    }

    const base64 = await this.getManager().screenshot(this.deviceId);
    if (!base64) {
      throw new Error('ADB screenshot gagal');
    }

    return Buffer.from(String(base64), 'base64');
  }

  async getDeviceSize() {
    if (!this.deviceId) {
      throw new Error('Device ID wajib diisi untuk ADB provider');
    }

    const size = await this.getManager().getScreenSize(this.deviceId);
    return {
      w: Number(size?.width || 0),
      h: Number(size?.height || 0),
    };
  }
}

module.exports = AdbScreenshotProvider;
