// Progress lives in localStorage. Storage can be blocked or missing, so every access is guarded
// and the game simply plays without saving in that case.

const KEY = 'grass-sling.v1';

const isTable = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (isTable(saved)) {
      return {
        stars: isTable(saved.stars) ? saved.stars : {},
        best: isTable(saved.best) ? saved.best : {},
        muted: saved.muted === true,
      };
    }
  } catch { /* fall through to a fresh save */ }
  return { stars: {}, best: {}, muted: false };
}

export class Save {
  constructor() {
    this.data = load();
  }

  persist() {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.data));
    } catch { /* progress just will not survive a reload */ }
  }

  stars(id) {
    return this.data.stars[id] ?? 0;
  }

  best(id) {
    return this.data.best[id] ?? 0;
  }

  /** Records a win. Returns true if this is a new best score. */
  recordWin(id, stars, score) {
    const isBest = score > this.best(id);
    this.data.stars[id] = Math.max(this.stars(id), stars);
    if (isBest) this.data.best[id] = score;
    this.persist();
    return isBest;
  }

  get muted() {
    return this.data.muted;
  }

  set muted(value) {
    this.data.muted = value;
    this.persist();
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0);
  }
}
