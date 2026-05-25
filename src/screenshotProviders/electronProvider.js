const electron = require('electron');

class ElectronScreenshotProvider {
  constructor(options = {}) {
    this.type = 'electron';
    this.displayId = options.displayId ?? null;
    this.thumbnailSize = options.thumbnailSize ?? null;
    this.desktopCapturer = electron.desktopCapturer || null;
    this.screen = electron.screen || null;
  }

  getDisplay() {
    if (!this.screen || typeof this.screen.getAllDisplays !== 'function' || typeof this.screen.getPrimaryDisplay !== 'function') {
      throw new Error('Electron screen API tidak tersedia');
    }

    const allDisplays = Array.isArray(this.screen.getAllDisplays()) ? this.screen.getAllDisplays() : [];

    if (this.displayId != null) {
      const matched = allDisplays.find((display) => String(display.id) === String(this.displayId));
      if (matched) {
        return matched;
      }
    }

    return this.screen.getPrimaryDisplay();
  }

  selectSource(sources = [], display) {
    const displayId = String(display?.id ?? '');
    const exactMatch = sources.find((source) => String(source.id) === `screen:${displayId}`);
    if (exactMatch) {
      return exactMatch;
    }

    const nameMatch = sources.find((source) => String(source.name || '').includes(String(displayId)));
    if (nameMatch) {
      return nameMatch;
    }

    return sources[0];
  }

  async capture() {
    if (!this.desktopCapturer || typeof this.desktopCapturer.getSources !== 'function') {
      throw new Error('Electron desktopCapturer API tidak tersedia');
    }

    const display = this.getDisplay();
    const captureOptions = {
      types: ['screen'],
    };

    if (this.thumbnailSize) {
      captureOptions.thumbnailSize = this.thumbnailSize;
    }

    const sources = await this.desktopCapturer.getSources(captureOptions);
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('Tidak ada source layar tersedia untuk desktop screenshot');
    }

    const source = this.selectSource(sources, display);
    if (!source || !source.thumbnail || typeof source.thumbnail.toPNG !== 'function') {
      throw new Error('Thumbnail layar tidak tersedia');
    }

    return Buffer.from(source.thumbnail.toPNG());
  }

  async getDeviceSize() {
    const display = this.getDisplay();
    return {
      w: Number(display.size?.width || display.bounds?.width || 0),
      h: Number(display.size?.height || display.bounds?.height || 0),
    };
  }
}

module.exports = ElectronScreenshotProvider;
