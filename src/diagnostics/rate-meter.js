// Measures how fast a monotonically advancing counter (render frames,
// transport events, solver ticks) moves, in counts per second.
//
// Feed it the counter's current value; it re-evaluates once per window so
// the reading is stable enough to read. Counters that run backwards (reverse
// playback) are measured by magnitude.
export class RateMeter {
  constructor({ windowMs = 500 } = {}) {
    if (!(windowMs > 0)) {
      throw new RangeError("RateMeter windowMs must be positive");
    }
    this.windowMs = windowMs;
    this.reset();
  }

  reset() {
    this.lastCount = null;
    this.lastTime = null;
    this.rate = null;
  }

  // Returns the latest rate (counts/s), or null until one full window passed.
  update(count, time) {
    const value = Number(count);
    const now = Number(time);
    if (!Number.isFinite(value) || !Number.isFinite(now)) {
      return this.rate;
    }

    if (this.lastTime == null || now < this.lastTime) {
      this.lastCount = value;
      this.lastTime = now;
      return this.rate;
    }

    const elapsed = now - this.lastTime;
    if (elapsed >= this.windowMs) {
      this.rate = Math.abs(value - this.lastCount) * 1000 / elapsed;
      this.lastCount = value;
      this.lastTime = now;
    }

    return this.rate;
  }

  // Mean milliseconds per count over the last window (e.g. frame time).
  get period() {
    return this.rate > 0 ? 1000 / this.rate : null;
  }
}

export function formatRate(value, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}

export function formatMs(value, digits = 1) {
  return value == null ? "—" : value.toFixed(digits) + " ms";
}
