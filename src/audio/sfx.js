// All sound is synthesised at runtime, so the game ships with no audio files.
// Physics events drive it: the louder the hit, the louder the sound.

const MIN_GAP = { wood: 0.05, leaf: 0.07, stone: 0.05, crystal: 0.05, dew: 0.05, squeak: 0.06, hit: 0.04, hurt: 0.09 };

// The compressor slows down loud moments but cannot stop them: pods going off together reach about
// +6 dB at its output, which would crackle. This curve leaves everything below LIMIT_KNEE untouched
// and bends the rest smoothly toward LIMIT_CEILING. It covers +-LIMIT_RANGE, and the signal is scaled
// to fit, because a wave shaper's input stops at +-1.
const LIMIT_KNEE = 0.7;
const LIMIT_CEILING = 0.99;
const LIMIT_RANGE = 2;

export function softLimitCurve(size = 2049) {
  const room = LIMIT_CEILING - LIMIT_KNEE;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * LIMIT_RANGE;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= LIMIT_KNEE ? a : LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room));
  }
  return curve;
}

/** An exponential ramp to exactly zero throws, and an audio error here would stop the whole frame. */
export const audible = gain => Math.max(gain, 0.0005);

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.last = new Map();
    this.noiseBuffer = null;
    this.stretchNodes = null;
    this.ambientNodes = null;
    this.ambientTimer = 0;
  }

  /** Browsers only allow audio after a user gesture, so this runs on the first press. */
  unlock() {
    if (!this.ctx) {
      const AudioCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
      this.master = this.ctx.createDynamicsCompressor();
      this.master.threshold.value = -14;
      this.master.ratio.value = 6;
      this.output = this.ctx.createGain();
      this.output.gain.value = this.muted ? 0 : 0.85;
      const fit = this.ctx.createGain();
      fit.gain.value = 1 / LIMIT_RANGE;
      const limiter = this.ctx.createWaveShaper();
      limiter.curve = softLimitCurve();
      this.master.connect(this.output).connect(fit).connect(limiter).connect(this.ctx.destination);
      const size = this.ctx.sampleRate * 1.2;
      this.noiseBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
      if (this.mood) this.ambient(this.mood);
    }
    // iOS also reports 'interrupted' after a phone call or an app switch.
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.output) this.output.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
  }

  ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  noise({ dur = 0.1, type = 'bandpass', freq = 1000, to = null, q = 1, gain = 0.3, attack = 0.001, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const start = Math.random() * 0.9;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(audible(gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, start);
    src.stop(t + attack + dur + 0.05);
  }

  tone({ freq = 440, to = null, dur = 0.1, type = 'sine', gain = 0.2, attack = 0.002, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(audible(gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }

  throttled(name) {
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0.03;
    if (now - (this.last.get(name) ?? -1) < gap) return true;
    this.last.set(name, now);
    return false;
  }

  /** A body of material being struck. `power` runs from 0 to 1. */
  impact(mat, power = 0.5) {
    if (!this.ready()) return;
    const p = Math.min(1, Math.max(0.06, power));
    const j = 1 + (Math.random() - 0.5) * 0.18;
    switch (mat) {
      case 'twig':
        if (this.throttled('wood')) return;
        this.noise({ dur: 0.07, freq: 820 * j, q: 2.6, gain: 0.5 * p });
        this.tone({ freq: 240 * j, to: 130, dur: 0.07, gain: 0.3 * p, type: 'triangle' });
        break;
      case 'leaf':
        if (this.throttled('leaf')) return;
        this.noise({ dur: 0.12, type: 'highpass', freq: 2600 * j, gain: 0.16 * p });
        break;
      case 'pebble':
      case 'ground':
        if (this.throttled('stone')) return;
        this.noise({ dur: 0.05, freq: 1500 * j, q: 1.2, gain: 0.3 * p });
        this.tone({ freq: 150 * j, to: 62, dur: 0.11, gain: 0.5 * p });
        break;
      case 'honey':
        if (this.throttled('crystal')) return;
        for (const f of [2300, 3400, 4700]) this.tone({ freq: f * j, dur: 0.16, gain: 0.07 * p });
        break;
      case 'dew':
        if (this.throttled('dew')) return;
        this.tone({ freq: 620 * j, to: 1500, dur: 0.07, gain: 0.26 * p });
        break;
      case 'termite':
        if (this.throttled('squeak')) return;
        this.tone({ freq: 900 * j, to: 1500, dur: 0.06, type: 'sawtooth', gain: 0.1 * p });
        this.noise({ dur: 0.04, freq: 900, gain: 0.3 * p });
        break;
      default:
        if (this.throttled('hit')) return;
        this.noise({ dur: 0.05, freq: 700 * j, q: 1, gain: 0.3 * p });
    }
  }

  crack(mat) {
    if (!this.ready()) return;
    const j = 1 + (Math.random() - 0.5) * 0.2;
    switch (mat) {
      case 'twig':
        for (let i = 0; i < 3; i++) this.noise({ dur: 0.04 + i * 0.02, freq: (1300 - i * 300) * j, q: 3, gain: 0.5 - i * 0.1, delay: i * 0.024 });
        this.tone({ freq: 190 * j, to: 80, dur: 0.12, gain: 0.3, type: 'triangle' });
        break;
      case 'leaf':
        this.noise({ dur: 0.2, type: 'highpass', freq: 1900 * j, gain: 0.24 });
        break;
      case 'honey':
        for (let i = 0; i < 7; i++) this.tone({ freq: (1700 + Math.random() * 4200) * j, dur: 0.1 + Math.random() * 0.2, gain: 0.08, delay: i * 0.016 });
        this.noise({ dur: 0.1, type: 'highpass', freq: 3500, gain: 0.16 });
        break;
      case 'pebble':
        this.tone({ freq: 110 * j, to: 42, dur: 0.24, gain: 0.7 });
        for (let i = 0; i < 4; i++) this.noise({ dur: 0.06, freq: (1100 - i * 180) * j, q: 1.2, gain: 0.34, delay: 0.02 + i * 0.05 });
        break;
    }
  }

  play(name, o = {}) {
    if (!this.ready()) return;
    const j = 1 + (Math.random() - 0.5) * 0.12;
    switch (name) {
      case 'twang': {
        const s = o.strain ?? 1;
        this.tone({ freq: 150 + 230 * s, to: 70 + 50 * s, dur: 0.26, type: 'triangle', gain: 0.5 });
        this.tone({ freq: 300 + 460 * s, to: 150, dur: 0.14, type: 'sawtooth', gain: 0.1 });
        this.noise({ dur: 0.05, freq: 1800, q: 0.7, gain: 0.32 });
        break;
      }
      case 'whoosh':
        this.noise({ dur: 0.34, freq: 500, to: 1900, q: 1.1, gain: 0.42 * (o.power ?? 1), attack: 0.05 });
        break;
      case 'hop':
        this.tone({ freq: 300 * j, to: 560 * j, dur: 0.09, gain: 0.14 });
        break;
      case 'seat':
        this.tone({ freq: 180, to: 120, dur: 0.08, type: 'triangle', gain: 0.18 });
        this.noise({ dur: 0.05, freq: 700, gain: 0.08 });
        break;
      case 'kill':
        this.tone({ freq: 1250 * j, to: 330, dur: 0.22, type: 'sawtooth', gain: 0.18 });
        this.noise({ dur: 0.11, freq: 700, q: 0.8, gain: 0.45 });
        this.tone({ freq: 240, to: 90, dur: 0.1, gain: 0.45, delay: 0.02 });
        break;
      case 'bigKill':
        this.tone({ freq: 680, to: 90, dur: 0.6, type: 'sawtooth', gain: 0.18 });
        this.tone({ freq: 90, to: 40, dur: 0.5, gain: 0.7 });
        this.noise({ dur: 0.4, type: 'lowpass', freq: 800, gain: 0.5 });
        break;
      case 'hurt':
        if (this.throttled('hurt')) return; // a collapse lands many small hits at once
        this.tone({ freq: 720 * j, to: 1100 * j, dur: 0.09, type: 'square', gain: 0.05 });
        break;
      case 'boom':
        this.noise({ dur: 0.5, type: 'lowpass', freq: 1200, to: 120, gain: 0.9 });
        this.tone({ freq: 96, to: 34, dur: 0.46, gain: 0.9 });
        for (let i = 0; i < 6; i++) this.noise({ dur: 0.03, freq: 2000 + Math.random() * 2000, q: 2, gain: 0.2, delay: 0.05 + i * 0.05 });
        break;
      case 'plip':
        this.tone({ freq: 520 * j, to: 1680 * j, dur: 0.09, gain: 0.32 });
        this.noise({ dur: 0.08, type: 'highpass', freq: 3000, gain: 0.1 });
        break;
      case 'splash':
        this.noise({ dur: 0.3, freq: 1100, to: 400, q: 0.6, gain: 0.4 * (o.power ?? 1) });
        this.tone({ freq: 340, to: 760, dur: 0.14, gain: 0.16 });
        break;
      case 'boing':
        this.tone({ freq: 150, to: 620, dur: 0.13, gain: 0.32 * (o.power ?? 1) });
        this.tone({ freq: 620, to: 230, dur: 0.2, gain: 0.2 * (o.power ?? 1), delay: 0.11 });
        break;
      case 'snap':
        this.tone({ freq: 1500 * j, to: 200, dur: 0.1, type: 'triangle', gain: 0.24 });
        this.noise({ dur: 0.03, freq: 3400, q: 2, gain: 0.3 });
        break;
      case 'click':
        this.noise({ dur: 0.012, freq: 3300, q: 4, gain: 0.9 });
        this.tone({ freq: 1500, to: 300, dur: 0.05, type: 'square', gain: 0.12, delay: 0.006 });
        this.tone({ freq: 220, to: 660, dur: 0.14, gain: 0.2, delay: 0.01 });
        break;
      case 'slam':
        this.noise({ dur: 0.28, freq: 2300, to: 300, q: 0.8, gain: 0.34 });
        this.tone({ freq: 700, to: 140, dur: 0.26, gain: 0.12 });
        break;
      case 'jet':
        this.noise({ dur: 0.1, type: 'lowpass', freq: 2600, to: 600, gain: 0.7 });
        this.noise({ dur: 0.45, freq: 1500, to: 340, q: 0.6, gain: 0.5, delay: 0.02 });
        this.tone({ freq: 240, to: 54, dur: 0.22, gain: 0.5 });
        break;
      case 'thwip':
        this.noise({ dur: 0.1, freq: 3600, to: 900, q: 1.8, gain: 0.34 });
        this.tone({ freq: 1250, to: 2300, dur: 0.05, gain: 0.08 });
        break;
      case 'poof':
        this.noise({ dur: 0.18, freq: 620, to: 1300, q: 0.7, gain: 0.14 });
        break;
      case 'tap':
        this.tone({ freq: 720, to: 980, dur: 0.05, gain: 0.1 });
        break;
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 880, 1046.5, 880, 1318.5];
        const times = [0, 0.11, 0.22, 0.33, 0.44, 0.58, 0.72];
        notes.forEach((f, i) => {
          this.tone({ freq: f, dur: i === notes.length - 1 ? 0.7 : 0.24, type: 'triangle', gain: 0.26, delay: times[i] });
          this.tone({ freq: f * 2, dur: 0.12, gain: 0.05, delay: times[i] });
        });
        break;
      }
      case 'lose': {
        [392, 349.23, 293.66, 246.94].forEach((f, i) => this.tone({ freq: f, to: f * 0.96, dur: 0.38, type: 'triangle', gain: 0.2, delay: i * 0.21 }));
        break;
      }
      case 'star':
        this.tone({ freq: 880 + (o.index ?? 0) * 220, to: 1760 + (o.index ?? 0) * 220, dur: 0.17, type: 'triangle', gain: 0.22 });
        break;
    }
  }

  /** Continuous creak while the band is drawn, rising with how far it is stretched. */
  stretch(strain) {
    if (!this.ready()) {
      this.stopStretch();
      return;
    }
    if (!this.stretchNodes && strain > 0.02) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 7;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 19;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain).connect(gain.gain);
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      lfo.start();
      this.stretchNodes = { src, filter, gain, lfo, lfoGain };
    }
    if (this.stretchNodes) {
      const t = this.ctx.currentTime;
      const n = this.stretchNodes;
      n.filter.frequency.setTargetAtTime(320 + strain * 1500, t, 0.03);
      n.gain.gain.setTargetAtTime(0.14 * strain, t, 0.03);
      n.lfoGain.gain.setTargetAtTime(0.09 * strain, t, 0.03);
      n.lfo.frequency.setTargetAtTime(13 + strain * 24, t, 0.05);
    }
  }

  stopStretch() {
    if (!this.stretchNodes) return;
    const n = this.stretchNodes;
    this.stretchNodes = null;
    try {
      n.src.stop();
      n.lfo.stop();
    } catch { /* already stopped */ }
    n.src.disconnect();
    n.gain.disconnect();
  }

  /** A low garden hush, with crickets once the light goes. */
  ambient(mood) {
    this.mood = mood;
    if (!this.ctx) return;
    if (!this.ambientNodes) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.022;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.ambientNodes = { src, gain };
    }
  }

  /** Silences everything while the tab is hidden. */
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  updateAmbient(dt) {
    if (!this.ready() || !this.ambientNodes) return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 1.6 + Math.random() * 3.6;
    const quiet = this.mood === 'dusk' ? 0.03 : 0.012;
    const freq = 3900 + Math.random() * 1200;
    for (let i = 0; i < 3; i++) this.tone({ freq, dur: 0.04, gain: quiet, delay: i * 0.075 });
  }
}
