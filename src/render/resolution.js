// Lowers the canvas resolution on a device that cannot keep up. Drawing costs far more than the
// physics, and most of that cost is filling pixels, so this is the change that buys the most frame
// rate. Physics runs on a fixed step, so the game plays the same at any resolution.

const STEP = 0.5;
const LOWEST = 1;
const WINDOW_SECONDS = 1.5;
const SLOW_FRAME = 1 / 45; // an average above this means the device is falling behind
const STALL = 0.25; // one frame this long is a hiccup, not a measure of the device

export class ResolutionGovernor {
  constructor(limit = 2) {
    this.limit = limit;
    this.restart();
  }

  /** Forgets the current measurement. Call after anything that skews it, such as a scene change. */
  restart() {
    this.elapsed = 0;
    this.frames = 0;
  }

  /** Takes the gap between two frames in seconds. Returns true when the limit has just dropped. */
  observe(gap) {
    if (gap > STALL) return false;
    this.elapsed += gap;
    this.frames++;
    if (this.elapsed < WINDOW_SECONDS) return false;
    const slow = this.elapsed / this.frames > SLOW_FRAME;
    this.restart();
    if (!slow || this.limit <= LOWEST) return false;
    this.limit = Math.max(LOWEST, this.limit - STEP);
    return true;
  }
}
