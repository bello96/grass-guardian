// Runs inside the game page, in any engine: renders every sound of the real Sfx graph through that
// engine's own OfflineAudioContext and reports what would reach the speakers. tools/browser-check.mjs
// sends it to the browser as source text, so it has to stand alone: no imports, nothing from this module.
//
// It needs nothing outside src/, so it also works on the deployed site, and it avoids
// OfflineAudioContext.suspend, which not every engine has: the context reports currentTime as 1 s, so
// every sound is scheduled one second in.
//
// Each sound is rendered twice. "single" starts with a cold compressor. "warm" keeps a -100 dBFS constant
// feeding the compressor from the first sample, as the looping ambient bed does in play. Firefox does not
// run a compressor on a silent input, so after a silent lead-in its first sound came out 13 to 17 dB
// quieter than in Chrome. "warm" is what a player hears; clipping is checked in both.
export async function renderSounds() {
  const { Sfx } = await import(new URL('src/audio/sfx.js', document.baseURI).href);
  const SR = 48000;
  const LEAD = 1;
  const db = x => (x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -120);

  function make(seconds, warm = false) {
    const real = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    let unlocking = true;
    const ctx = new Proxy(real, {
      get(target, prop) {
        if (prop === 'currentTime') return LEAD;
        // An offline context cannot be resumed before it starts rendering.
        if (prop === 'resume' && unlocking) return () => Promise.resolve();
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
    const sfx = new Sfx();
    const Saved = globalThis.AudioContext;
    globalThis.AudioContext = function () { return ctx; };
    try {
      sfx.unlock();
    } finally {
      globalThis.AudioContext = Saved;
      unlocking = false;
    }
    sfx.ready = () => true;
    if (warm) {
      const keep = real.createConstantSource();
      keep.offset.value = 1e-5;
      keep.connect(sfx.master);
      keep.start(0);
    }
    return { real, sfx };
  }

  /** Peak in dBFS, samples at or past full scale, samples that are not numbers, and audible length. */
  function stats(buf) {
    let peak = 0, overs = 0, bad = 0, first = -1, last = -1;
    const quiet = 10 ** (-50 / 20);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) {
        const a = Math.abs(ch[i]);
        if (!Number.isFinite(a)) {
          bad++;
          continue;
        }
        if (a > peak) peak = a;
        if (a >= 1) overs++;
        if (a > quiet) {
          if (first < 0 || i < first) first = i;
          if (i > last) last = i;
        }
      }
    }
    return { peak: db(peak), overs, bad, ms: first < 0 ? 0 : Math.round(((last - first) / SR) * 1000) };
  }

  async function alone(fn, seconds, warm) {
    const { real, sfx } = make(seconds, warm);
    fn(sfx);
    return stats(await real.startRendering());
  }

  const sounds = [];
  for (const name of ['twang', 'whoosh', 'hop', 'seat', 'kill', 'bigKill', 'hurt', 'boom', 'plip', 'splash', 'boing', 'snap', 'click', 'slam', 'jet', 'thwip', 'poof', 'tap', 'win', 'lose', 'star']) {
    sounds.push([name, s => s.play(name)]);
  }
  sounds.push(['stretch:full', s => s.stretch(1)]);
  for (const mat of ['twig', 'leaf', 'honey', 'pebble']) sounds.push([`crack:${mat}`, s => s.crack(mat)]);
  for (const mat of ['twig', 'leaf', 'pebble', 'ground', 'honey', 'dew', 'termite', 'bug']) {
    sounds.push([`hit1.0:${mat}`, s => s.impact(mat, 1)]);
    sounds.push([`hit0.2:${mat}`, s => s.impact(mat, 0.2)]);
  }
  const single = {}, warm = {};
  for (const [label, fn] of sounds) {
    single[label] = await alone(fn, 3.4, false);
    warm[label] = await alone(fn, 3.4, true);
  }

  // The loudest moment the game can plausibly make: three pods going off on top of a queen dying.
  const pileUp = s => {
    s.play('boom');
    s.play('boom');
    s.play('boom');
    s.play('bigKill');
    s.crack('pebble');
    s.crack('twig');
  };
  const worst = await alone(pileUp, 2.5, false);
  const worstWarm = await alone(pileUp, 2.5, true);
  const ambient = await (async () => {
    const { real, sfx } = make(6);
    sfx.ambient('dusk');
    return stats(await real.startRendering());
  })();

  return { single, warm, worst, worstWarm, ambient };
}
