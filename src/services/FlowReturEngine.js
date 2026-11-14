'use strict';

const RETUR_STEPS = [
  { key: 'firstTap',    label: 'Step 1: First Tap',         type: 'tap' },
  { key: 'pilihSemua1', label: 'Step 2: Pilih Semua (1)',   type: 'tap' },
  { key: 'ttdRetur1',   label: 'Step 3: TTD Retur (1)',     type: 'tap' },
  { key: 'pilihSemua2', label: 'Step 4: Pilih Semua (2)',   type: 'tap' },
  { key: 'ttdRetur2',   label: 'Step 5: TTD Retur (2)',     type: 'tap' },
  { key: 'ttdPengirim', label: 'Step 6: TTD Pengirim',      type: 'tap' },
  { key: 'ttdSign1',    label: 'Step 7: Tanda Tangan 1',    type: 'signature' },
  { key: 'submitBtn1',  label: 'Step 8: Submit (1)',         type: 'tap' },
  { key: 'ttdSprinter', label: 'Step 9: TTD Sprinter',      type: 'tap' },
  { key: 'ttdSign2',    label: 'Step 10: Tanda Tangan 2',   type: 'signature' },
  { key: 'submitBtn2',  label: 'Step 11: Submit (2)',        type: 'tap' },
  { key: 'ikonKamera',  label: 'Step 12: Icon Kamera',      type: 'tap' },
  { key: 'konfirmasi',  label: 'Step 13: Konfirmasi',        type: 'tap' },
  { key: 'tetapUpload', label: 'Step 14: Tetap Upload',      type: 'tap' },
  { key: 'ttdRetur3',   label: 'Step 15: TTD Retur (3)',    type: 'tap' },
  { key: 'twoTap',      label: 'Step 16: Two Tap',          type: 'tap' },
];

class FlowReturEngine {
  constructor(profile, { onLog, onStepStart, onStepDone, onLoopEnd } = {}) {
    this.profile     = profile;
    this.onLog       = onLog       || (() => {});
    this.onStepStart = onStepStart || (() => {});
    this.onStepDone  = onStepDone  || (() => {});
    this.onLoopEnd   = onLoopEnd   || (() => {});
    this.isRunning   = false;
  }

  log(level, msg) { this.onLog(level, `[FlowRetur] ${msg}`); }

  async run({ adbExec, findTemplate, findTextOnScreen, captureScreen }) {
    this._adbExec          = adbExec;
    this._findTemplate     = findTemplate;
    this._findTextOnScreen = findTextOnScreen;
    this._captureScreen    = captureScreen;
    this.isRunning         = true;

    const p         = this.profile;
    const timeout   = (p.waitTimeout     || 30) * 1000;
    const extra     = (p.extraWaitOnSlow || 10) * 1000;
    const stepDelay = p.stepDelay || 500;

    this.log('info', '=== Flow Retur Dimulai ===');

    try {
      // Step 1: sekali di awal
      await this._doStep('firstTap', timeout, extra, stepDelay);

      let iteration = 0;
      const maxIter = p.loopMode === 'count' ? (p.loopCount || 10) : 99999;

      while (this.isRunning) {
        iteration++;
        this.log('info', `─── Iterasi #${iteration} ───`);

        // Cek kondisi stop
        if (p.loopMode === 'count' && iteration > maxIter) {
          this.log('info', `Selesai setelah ${maxIter} iterasi`);
          break;
        }
        if (p.loopMode === 'text' || p.loopMode === 'image') {
          const shouldContinue = await this._checkLoop(p);
          if (!shouldContinue) {
            this.log('info', 'Kondisi stop terpenuhi — loop selesai');
            this.onLoopEnd({ iteration, reason: 'condition' });
            break;
          }
        }

        // Step 2-16
        for (const step of RETUR_STEPS.slice(1)) {
          if (!this.isRunning) break;
          await this._doStep(step.key, timeout, extra, stepDelay);
        }
      }

    } catch (err) {
      this.log('error', err.message);
      throw err;
    } finally {
      this.isRunning = false;
      this.log('info', '=== Flow Retur Selesai ===');
    }
  }

  async _doStep(key, timeout, extra, stepDelay) {
    const def    = RETUR_STEPS.find(s => s.key === key);
    const config = this.profile.steps?.[key];

    this.onStepStart(key, def?.label || key);

    if (!config) {
      this.log('warn', `${key}: tidak dikonfigurasi — dilewati`);
      this.onStepDone(key, false);
      return;
    }

    this.log('info', `▶ ${def?.label || key}`);

    if (def?.type === 'signature') {
      await this._doSignature(key, config, timeout, extra);
    } else {
      await this._doTap(key, config, timeout, extra);
    }

    this.onStepDone(key, true);
    if (stepDelay > 0) await this._delay(stepDelay);
  }

  async _doTap(key, cfg, timeout, extra) {
    const device    = this.profile.deviceId;
    const totalWait = timeout + extra;
    const interval  = 1500;
    const start     = Date.now();
    let   attempt   = 0;

    while (this.isRunning) {
      const elapsed = Date.now() - start;

      if (elapsed >= totalWait) {
        // Fallback koordinat jika ada
        if (cfg.x != null && cfg.y != null) {
          this.log('warn', `${key}: timeout — fallback koordinat (${cfg.x},${cfg.y})`);
          await this._adbExec(device, `shell input tap ${cfg.x} ${cfg.y}`);
          return;
        }
        throw new Error(`${key}: tidak ditemukan setelah ${totalWait}ms, tidak ada koordinat fallback`);
      }

      attempt++;
      const remaining = Math.round((totalWait - elapsed) / 1000);
      this.log('info', `${key}: percobaan #${attempt} — sisa ${remaining}s`);

      try {
        let found = null;

        // 1. Image matching
        if (cfg.image) {
          const match = await this._findTemplate(device, cfg.image, {
            threshold: cfg.threshold || 0.80,
            forceFullScan: true
          });
          if (match.found) {
            found = { x: match.centerX, y: match.centerY, method: 'image',
                      conf: (match.confidence * 100).toFixed(1) };
          }
        }

        // 2. Text matching (jika image gagal)
        if (!found && cfg.text) {
          const screen = await this._captureScreen(device);
          if (screen.success) {
            const r = await this._findTextOnScreen(screen.image, cfg.text);
            if (r.found) {
              found = { x: r.centerX, y: r.centerY, method: 'text', conf: '—' };
            }
          }
        }

        if (found) {
          await this._adbExec(device, `shell input tap ${found.x} ${found.y}`);
          this.log('success',
            `✅ ${key}: tap (${found.x},${found.y}) via ${found.method}` +
            (found.method === 'image' ? ` ${found.conf}%` : ''));
          return;
        }

        this.log('info', `${key}: belum ditemukan...`);
        await this._delay(interval);

      } catch (err) {
        this.log('warn', `${key}: error — ${err.message}`);
        await this._delay(interval);
      }
    }
  }

  async _doSignature(key, cfg, timeout, extra) {
    const device    = this.profile.deviceId;
    const sig       = this.profile.signatureConfig || {};
    const totalWait = timeout + extra;
    const start     = Date.now();

    this.log('info', `${key}: menunggu area TTD...`);

    let area = null;
    while (this.isRunning) {
      if (Date.now() - start >= totalWait) break;

      if (cfg.image) {
        const match = await this._findTemplate(device, cfg.image, {
          threshold: 0.75, forceFullScan: true
        });
        if (match.found) { area = match; break; }
      }
      await this._delay(1500);
    }

    // Fallback ke koordinat area
    if (!area && cfg.x != null) {
      area = { centerX: cfg.x, centerY: cfg.y };
      this.log('warn', `${key}: fallback koordinat area TTD`);
    }
    if (!area) throw new Error(`${key}: area TTD tidak ditemukan`);

    const cx = area.centerX;
    const cy = area.centerY;
    const x1 = cx + (sig.startOffsetX ?? -100);
    const y1 = cy + (sig.startOffsetY ?? 0);
    const x2 = cx + (sig.endOffsetX   ?? 100);
    const y2 = cy + (sig.endOffsetY   ?? 30);
    const ms = sig.swipeDuration || 800;

    await this._adbExec(device, `shell input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);
    this.log('success', `✅ ${key}: tanda tangan selesai`);
  }

  async _checkLoop(profile) {
    const cond   = profile.loopCondition || {};
    const device = profile.deviceId;

    if (profile.loopMode === 'text' && cond.text) {
      const screen = await this._captureScreen(device);
      if (!screen.success) return true;
      const r = await this._findTextOnScreen(screen.image, cond.text);
      return r.found; // lanjut jika text masih ada
    }

    if (profile.loopMode === 'image' && cond.image) {
      const match = await this._findTemplate(device, cond.image,
        { threshold: 0.75, forceFullScan: true });
      return match.found;
    }

    return true;
  }

  stop() {
    this.isRunning = false;
    this.log('warn', 'Dihentikan oleh user');
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { FlowReturEngine, RETUR_STEPS };
