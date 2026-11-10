// Functions that run inside the game page, opened with ?debug=1 so the App is on globalThis.__game.
// tools/browser-check.mjs sends each one to the browser as source text, so each has to stand alone:
// no imports, and nothing from this module's scope.

/** The page straight after loading: is the font in, has anything been painted, is there Web Audio. */
export async function bootReport(name) {
  await document.fonts.ready;
  const canvas = globalThis.__game.canvas;
  const thumb = document.createElement('canvas');
  thumb.width = 64;
  thumb.height = 30;
  const tc = thumb.getContext('2d');
  tc.drawImage(canvas, 0, 0, 64, 30);
  const px = tc.getImageData(0, 0, 64, 30).data;
  let lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    lo = Math.min(lo, px[i + 1]);
    hi = Math.max(hi, px[i + 1]);
  }
  return {
    // check() alone also says yes when the font was never declared, so look for the loaded face too.
    font: [...document.fonts].some(f => f.family.includes('ZCOOL KuaiLe') && f.status === 'loaded') &&
      document.fonts.check('20px "ZCOOL KuaiLe"', name),
    canvas: [canvas.width, canvas.height],
    css: [innerWidth, innerHeight],
    // How far the green channel spreads over a thumbnail of the canvas: near zero means nothing was drawn.
    painted: hi - lo,
    title: !document.getElementById('title').hidden,
    webAudio: typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === 'function',
  };
}

/** Waits out the opening camera move: a press during it only skips it. */
export async function waitForCamera() {
  const scene = globalThis.__game.scene;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const start = performance.now();
  while (scene.intro > 0 && performance.now() - start < 15000) await frame();
  let last = scene.camX;
  for (let still = 0; still < 3 && performance.now() - start < 15000; ) {
    await frame();
    still = Math.abs(scene.camX - last) < 0.5 ? still + 1 : 0;
    last = scene.camX;
  }
  return scene.intro <= 0;
}

/** Resolves after this many frames, however slowly the engine draws them. */
export function nextFrames(n) {
  return new Promise(resolve => {
    let k = 0;
    const tick = () => (++k >= n ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
}

/** Where the bug in the sling is, in CSS pixels. */
export function bugOnScreen() {
  const s = globalThis.__game.scene;
  const b = s.sim.sling.body;
  return { x: (b.x - s.camX) * s.camZ + s.w / 2, y: s.h * 0.84 + b.y * s.camZ };
}

/** Frames per second over two seconds. Headless engines draw differently, so this is only a note. */
export function frameRate() {
  return new Promise(resolve => {
    let n = 0;
    const start = performance.now();
    const tick = () => {
      n++;
      if (performance.now() - start < 2000) requestAnimationFrame(tick);
      else resolve(Math.round((n * 1000) / (performance.now() - start)));
    };
    requestAnimationFrame(tick);
  });
}

/**
 * The interface checks: real App, real rAF loop, and pointer and key events sent through the same
 * listeners a player's hand goes through. Returns a line per check.
 */
export async function uiChecks() {
  const app = globalThis.__game;
  const scene = () => app.scene;
  const sim = () => app.scene.sim;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  /**
   * Waits until the game has moved on by this many seconds. A frame advances it by at most 0.05 s, so on
   * a slow engine a wall-clock wait can pass with no frame at all, and a check that nothing happened
   * would pass for nothing. One extra frame at the end lets the game's own update for the last one run.
   */
  const simWait = seconds => new Promise(resolve => {
    let last = null, total = 0;
    const tick = now => {
      if (last !== null) total += Math.min(0.05, (now - last) / 1000);
      last = now;
      requestAnimationFrame(total >= seconds ? () => resolve() : tick);
    };
    requestAnimationFrame(tick);
  });
  const until = async (pred, ms = 6000) => {
    const t = performance.now();
    while (!pred() && performance.now() - t < ms) await wait(16);
    return pred();
  };
  const errors = [];
  addEventListener('error', e => errors.push(e.message));
  const toScreen = (x, y) => {
    const s = scene();
    return { x: (x - s.camX) * s.camZ + s.w / 2, y: s.h * 0.84 + y * s.camZ };
  };
  const ptr = (type, x, y, id = 7, extra = {}) =>
    app.canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0, isPrimary: id === 7, bubbles: true, cancelable: true, ...extra }));
  const key = (code, o = {}) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...o }));
  const bugScreen = () => {
    const b = sim().sling.body;
    return toScreen(b.x, b.y);
  };
  const clearSave = () => {
    try { localStorage.removeItem('grass-sling.v1'); } catch {}
    app.save.data = { stars: {}, best: {}, muted: app.save.data.muted };
  };
  /** A fresh level, sitting ready, with no overlay and no gesture in progress. */
  const fresh = async (index = 0, settle = 300) => {
    app.pointerId = null;
    app.startLevel(index, true);
    await until(() => sim().state === 'ready');
    await simWait(settle / 1000);
  };
  /** Drags the bug back by this many world units, as a finger would. */
  const pull = async (id = 7, dx = -140, dy = 45) => {
    const b = sim().sling.body;
    const s0 = toScreen(b.x, b.y);
    ptr('pointerdown', s0.x, s0.y, id);
    for (let i = 1; i <= 8; i++) {
      const s = toScreen(b.x + (dx * i) / 8, b.y + (dy * i) / 8);
      ptr('pointermove', s.x, s.y, id);
      await wait(16);
    }
    // A release only fires once the bug itself has followed the finger back.
    await simWait(0.1);
  };
  const launchDirect = async () => {
    const r = sim().sling.rest;
    sim().beginAim();
    sim().aim(r.x - 140, r.y + 60);
    await simWait(0.12);
    sim().releaseAim();
    await until(() => sim().state === 'flying', 2000);
  };

  const checks = [];
  const check = async (name, fn) => {
    const before = errors.length;
    let result;
    try {
      result = await fn();
    } catch (e) {
      result = { ok: false, detail: `threw: ${e.message}` };
    }
    const newErrors = errors.slice(before);
    checks.push({ name, ok: !!result.ok && newErrors.length === 0, detail: newErrors.length ? `${result.detail ?? ''} errors: ${newErrors.join('; ')}` : result.detail });
  };

  await check('a normal drag and release fires', async () => {
    await fresh();
    await pull();
    ptr('pointerup', 0, 0);
    await wait(50);
    return { ok: sim().shots === 1, detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('a tap 12 css px beside the bug fires nothing', async () => {
    await fresh();
    const s = bugScreen();
    ptr('pointerdown', s.x + 12, s.y);
    await simWait(0.09);
    ptr('pointerup', s.x + 12, s.y);
    await simWait(0.2);
    return { ok: sim().shots === 0 && sim().state === 'ready', detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('a tap 2 css px below the bug fires nothing', async () => {
    await fresh();
    const s = bugScreen();
    ptr('pointerdown', s.x, s.y + 2);
    await simWait(0.09);
    ptr('pointerup', s.x, s.y + 2);
    await simWait(0.2);
    return { ok: sim().shots === 0 && sim().state === 'ready', detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('a tap dead centre on a sagging stag fires nothing', async () => {
    await fresh(5, 1300);
    const s = bugScreen();
    ptr('pointerdown', s.x, s.y);
    await simWait(0.09);
    ptr('pointerup', s.x, s.y);
    await simWait(0.2);
    return { ok: sim().shots === 0, detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('pressing inside the grab area does not make the bug jump to the finger', async () => {
    await fresh();
    const b = sim().sling.body;
    const startX = b.x, startY = b.y;
    const s = bugScreen();
    ptr('pointerdown', s.x + 34, s.y - 20);
    ptr('pointermove', s.x + 34, s.y - 20);
    await simWait(0.12);
    const moved = Math.hypot(b.x - startX, b.y - startY);
    ptr('pointercancel', 0, 0);
    return { ok: moved < 6, detail: `bug moved ${moved.toFixed(1)} world units` };
  });

  await check('the pull follows the finger from where it pressed', async () => {
    await fresh();
    const b = sim().sling.body;
    const startX = b.x;
    const s = bugScreen();
    ptr('pointerdown', s.x + 30, s.y);
    const z = scene().camZ;
    ptr('pointermove', s.x + 30 - 100 * z, s.y);
    await simWait(0.15);
    const moved = startX - b.x;
    ptr('pointercancel', 0, 0);
    return { ok: Math.abs(moved - 100) < 14, detail: `dragged 100, bug moved ${moved.toFixed(1)}` };
  });

  await check('pointercancel during an aim fires nothing and the bug can be aimed again', async () => {
    await fresh();
    await pull();
    ptr('pointercancel', 0, 0);
    await simWait(0.3);
    const firstOk = sim().shots === 0 && sim().state === 'ready';
    await simWait(0.9);
    await pull();
    const aiming = sim().state === 'aiming';
    ptr('pointerup', 0, 0);
    await wait(40);
    return { ok: firstOk && aiming && sim().shots === 1, detail: `after cancel ok=${firstOk}, re-aim ${aiming}, shots ${sim().shots}` };
  });

  await check('lostpointercapture during an aim fires nothing', async () => {
    await fresh();
    await pull();
    ptr('lostpointercapture', 0, 0);
    await simWait(0.25);
    return { ok: sim().shots === 0 && sim().state === 'ready', detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('lostpointercapture after a normal release changes nothing', async () => {
    await fresh();
    await pull();
    ptr('pointerup', 0, 0);
    ptr('lostpointercapture', 0, 0);
    await wait(50);
    return { ok: sim().shots === 1, detail: `shots ${sim().shots}, ${sim().state}` };
  });

  await check('pausing mid-aim and lifting the finger fires nothing', async () => {
    await fresh();
    await pull();
    key('Escape');
    await wait(30);
    ptr('pointerup', 0, 0);
    await wait(30);
    const paused = app.paused;
    key('Escape');
    await wait(400);
    return { ok: paused && !app.paused && sim().shots === 0 && sim().state === 'ready', detail: `paused ${paused}, shots ${sim().shots}, ${sim().state}` };
  });

  await check('a resting thumb does not block a finger on the bug', async () => {
    await fresh();
    ptr('pointerdown', 40, 60, 21, { isPrimary: true });
    const s = bugScreen();
    ptr('pointerdown', s.x, s.y, 22, { isPrimary: false });
    await wait(40);
    const state = sim().state;
    ptr('pointercancel', 0, 0, 22);
    ptr('pointerup', 0, 0, 21);
    return { ok: state === 'aiming', detail: `state ${state}` };
  });

  await check('a resting thumb does not block an ability tap', async () => {
    await fresh(4);
    await launchDirect();
    ptr('pointerdown', 40, 60, 31, { isPrimary: true });
    ptr('pointerdown', 400, 100, 32, { isPrimary: false });
    ptr('pointerup', 400, 100, 32);
    const used = sim().active?.ent.used;
    ptr('pointerup', 40, 60, 31);
    return { ok: used === true, detail: `used ${used}` };
  });

  await check('a second finger during an aim does not disturb it', async () => {
    await fresh();
    await pull(7);
    ptr('pointerdown', 500, 80, 42, { isPrimary: false });
    ptr('pointerup', 500, 80, 42);
    const state = sim().state, shots = sim().shots;
    ptr('pointercancel', 0, 0, 7);
    return { ok: state === 'aiming' && shots === 0, detail: `state ${state}, shots ${shots}` };
  });

  await check('a win is saved the moment it happens', async () => {
    clearSave();
    await fresh();
    sim().killTermite(sim().termites[0], 'hit');
    await until(() => sim().state === 'won', 4000);
    const stars = app.save.stars('first-hit');
    await until(() => !document.getElementById('result').hidden, 3000);
    return { ok: stars > 0, detail: `stars straight after winning: ${stars}` };
  });

  await check('pressing R in the moment after the last kill does not throw the win away', async () => {
    clearSave();
    await fresh();
    sim().killTermite(sim().termites[0], 'hit');
    key('KeyR');
    await wait(50);
    const stillDown = sim().targetsLeft() === 0;
    await until(() => !document.getElementById('result').hidden, 4000);
    return { ok: stillDown && app.save.stars('first-hit') > 0, detail: `level kept ${stillDown}, stars ${app.save.stars('first-hit')}` };
  });

  await check('Esc in the moment after the last kill does not pause', async () => {
    await fresh();
    sim().killTermite(sim().termites[0], 'hit');
    key('Escape');
    await wait(30);
    const paused = app.paused;
    if (paused) key('Escape');
    await until(() => !document.getElementById('result').hidden, 4000);
    return { ok: !paused, detail: `paused ${paused}` };
  });

  await check('leaving for the map while a result is pending does not throw later', async () => {
    await fresh();
    sim().killTermite(sim().termites[0], 'hit');
    await until(() => sim().state === 'won', 4000);
    app.showMap();
    await simWait(1.2);
    const shown = !document.getElementById('result').hidden;
    if (!document.getElementById('map').hidden) app.showTitle();
    return { ok: !shown, detail: `result sheet appeared over the map: ${shown}` };
  });

  await check('a pointer press takes over from keyboard aiming', async () => {
    await fresh();
    key('ArrowUp');
    await simWait(0.08);
    const wasKey = !!scene().keyAim;
    const s = bugScreen();
    ptr('pointerdown', s.x, s.y);
    const took = scene().pointer?.mode === 'aim' && !scene().keyAim;
    ptr('pointercancel', 0, 0);
    return { ok: wasKey && took, detail: `keyboard aim ${wasKey}, taken over ${took}` };
  });

  await check('a held Space does not fire by key repeat', async () => {
    await fresh();
    key('Space', { repeat: true });
    await simWait(0.03);
    return { ok: sim().state === 'ready', detail: `state ${sim().state}` };
  });

  await check('a kill shows on screen', async () => {
    await fresh();
    const fx = scene().fx;
    const before = fx.parts.length;
    sim().killTermite(sim().termites[0], 'hit');
    await simWait(0.03);
    return { ok: fx.parts.length > before && scene().slowmo > 0, detail: `particles ${before} -> ${fx.parts.length}, slowmo ${scene().slowmo.toFixed(2)}` };
  });

  await check('flying with an ability shows how to use it', async () => {
    await fresh(4);
    await launchDirect();
    await simWait(0.04);
    const hint = document.getElementById('hint');
    return { ok: !hint.hidden && hint.textContent.includes('点'), detail: `hint "${hint.textContent}" hidden ${hint.hidden}` };
  });

  await check('a flight leaves a trail', async () => {
    await fresh();
    await launchDirect();
    await simWait(0.35);
    return { ok: scene().trail.length > 0, detail: `${scene().trail.length} dots` };
  });

  await check('the release-silk hint goes away when the silk is released', async () => {
    await fresh(12);
    const r = sim().sling.rest;
    sim().beginAim();
    sim().aim(r.x - 120, r.y + 120);
    await simWait(0.12);
    sim().releaseAim();
    await until(() => sim().state === 'flying', 2000);
    await simWait(0.25);
    sim().useAbility(1000, -690); // straight at the branch overhead, which starts at x = 880
    await simWait(0.06);
    const during = document.getElementById('hint').textContent;
    const hadSilk = !!sim().silk;
    sim().useAbility(0, 0);
    await simWait(0.06);
    const hint = document.getElementById('hint');
    return { ok: hadSilk && (hint.hidden || !hint.textContent.includes('松开')), detail: `silk ${hadSilk}, during "${during}", after "${hint.textContent}" hidden ${hint.hidden}` };
  });

  await check('a tap in flight with no aim state still works after a cancelled aim', async () => {
    await fresh(4);
    await pull();
    ptr('pointercancel', 0, 0);
    await simWait(0.9);
    await launchDirect();
    ptr('pointerdown', 400, 100);
    ptr('pointerup', 400, 100);
    return { ok: sim().active?.ent.used === true, detail: `used ${sim().active?.ent.used}` };
  });

  app.showTitle();
  const failed = checks.filter(c => !c.ok);
  return {
    pass: checks.length - failed.length,
    fail: failed.length,
    uncaught: errors.length,
    results: checks.map(c => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? `  [${c.detail}]` : ''}`),
  };
}
