// Paste-free helpers for checking the real game in a browser with ?debug=1. It steps the actual scene
// by hand, so screenshots land on the exact moment wanted even if the tab is being throttled, and it
// sends real pointer events through the same handlers a player's hand goes through.
(() => {
  const FRAME = 1 / 60;
  const app = window.__game;
  const scene = () => app.scene;
  const sim = () => app.scene.sim;
  const pointer = (type, x, y) =>
    app.canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, button: 0, bubbles: true, isPrimary: true }));
  const toScreen = (x, y) => {
    const r = scene();
    return { x: (x - r.camX) * r.camZ + r.w / 2, y: r.h * 0.84 + y * r.camZ };
  };
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      scene().update(FRAME);
      app.tipTimer = Math.max(0, app.tipTimer - FRAME);
      if (app.resultTimer >= 0) {
        app.resultTimer -= FRAME;
        if (app.resultTimer < 0) app.showResult();
      }
    }
    scene().draw(app.ctx);
    app.updateHud();
  };
  const until = (pred, maxFrames = 1200) => {
    for (let i = 0; i < maxFrames; i++) {
      if (pred()) return i;
      step();
    }
    return -1;
  };
  window.drive = {
    app, sim, scene, step, until, toScreen, pointer,
    /** Starts a level, frozen so only these helpers move time forward. */
    start(index, skipIntro = true) {
      app.startLevel(index, skipIntro);
      app.frame = () => {}; // stop the live loop; input handlers stay active, unlike when paused
      // Screenshots wait for the compositor, so something must keep asking for frames.
      if (!window.__idleFrames) {
        window.__idleFrames = true;
        const idle = () => requestAnimationFrame(idle);
        idle();
      }
      until(() => sim().state === 'ready');
      step(40);
      return sim().state;
    },
    /** Drags from the bug to a pull at this angle and length, as a player would. */
    aim(deg, pull) {
      const b = sim().sling.body;
      const start = toScreen(b.x, b.y);
      pointer('pointerdown', start.x, start.y);
      const a = (deg * Math.PI) / 180;
      const r = sim().sling.rest;
      for (let i = 1; i <= 20; i++) {
        const t = i / 20;
        const w = toScreen(r.x - Math.cos(a) * pull * t, r.y + Math.sin(a) * pull * t);
        pointer('pointermove', w.x, w.y);
        step();
      }
      step(12);
      return { state: sim().state, strain: +sim().sling.strain().toFixed(2) };
    },
    /** Finds the launch angle whose real band launch and flight pass closest to a world point. */
    angleTo(x, y, pull = 170, low = true) {
      const s = sim();
      const r = s.sling.rest;
      const bug = s.sling.body;
      const h = 1 / 240;
      let best = null;
      for (let deg = low ? -10 : 45; deg <= (low ? 45 : 86); deg += 0.25) {
        const a = (deg * Math.PI) / 180;
        const launch = s.sling.previewLaunch(bug, r.x - Math.cos(a) * pull, r.y + Math.sin(a) * pull);
        if (!launch) continue;
        let { x: px, y: py, vx, vy } = launch;
        let miss = Infinity;
        for (let i = 0; i < 1200 && py < 40; i++) {
          vy += 500 * h;
          const f = 1 / (1 + bug.airDrag * Math.hypot(vx, vy) * h);
          vx *= f;
          vy *= f;
          px += vx * h;
          py += vy * h;
          miss = Math.min(miss, Math.hypot(px - x, py - y));
        }
        if (!best || miss < best.miss) best = { deg, miss };
      }
      return best;
    },
    /** Points the camera at a world x for a look around. */
    look(x, frames = 1) {
      const r = scene();
      r.free = true;
      r.camX = r.clampCam(x, r.camZ);
      step(frames);
      return r.camX;
    },
    release() {
      pointer('pointerup', 0, 0);
      step();
      return sim().state;
    },
    tap(x, y) {
      const s = toScreen(x, y);
      pointer('pointerdown', s.x, s.y);
      pointer('pointerup', s.x, s.y);
      return sim().state;
    },
    status() {
      const s = sim(), r = scene(), a = s.active;
      return {
        state: s.state, score: s.score, left: s.targetsLeft(), blocks: s.blocks.length, queue: s.queue.length,
        bug: a && { x: a.x | 0, y: a.y | 0, v: Math.hypot(a.vx, a.vy) | 0, used: a.ent.used, landed: a.ent.landed },
        fx: { parts: r.fx.parts.length, puffs: r.fx.puffs.length, popups: r.fx.popups.length },
        cam: [r.camX | 0, +r.camZ.toFixed(2)],
      };
    },
  };
  return 'ready';
})();
