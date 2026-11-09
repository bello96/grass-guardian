// Draws a running GameSim and turns player input and physics events into camera moves, particles
// and sound. It reads the sim but never changes how a shot plays out, apart from passing input on.

import { GRAVITY } from '../game/sim.js';
import { BUGS, QUEUE_GAP, QUEUE_START } from '../game/catalog.js';
import { flightPath } from '../physics/index.js';
import { blockSprite, mossStrip, soilTile, tagSprite } from './sprites.js';
import { backdropFor, drawBackdrop, drawForeground, drawPollen, makeForeground, makePollen } from './backdrop.js';
import { drawBug, drawDew, drawForkPart, drawMushroom, drawPod, drawTermite, silkStrand, smoothPath } from './cast.js';
import { Fx } from './fx.js';

const VIEW_H = 780;
const VIEW_W_MIN = 1000;
const HORIZON = 0.84; // the ground line sits this far down the screen
const INTRO_SECONDS = 1.9;
const TITLE_SPAN = 1300; // world width the title screen must show: the sling and all four letters
const TITLE_CENTRE = 740;
const GRAB_HINT_AFTER = 2.2; // seconds of nobody touching the bug before it invites a grab
const GRAB_RADIUS = 78;

export class Scene {
  constructor({ sim, sfx, reducedMotion = false, isTitle = false, mood = 'dawn', skipIntro = false, onHint = null }) {
    this.sim = sim;
    this.sfx = sfx;
    this.reduced = reducedMotion;
    this.isTitle = isTitle;
    this.mood = mood;
    this.onHint = onHint;
    this.fx = new Fx();
    this.backdrop = backdropFor(mood);
    this.front = makeForeground(mood);
    this.pollen = makePollen();
    this.t = 0;
    this.w = this.h = 1;
    this.dpr = 1;
    this.camX = 0;
    this.camZ = 1;
    this.shake = 0;
    this.shakeX = this.shakeY = 0;
    this.hitstop = 0;
    this.slowmo = 0;
    this.intro = isTitle || skipIntro ? 0 : INTRO_SECONDS;
    this.pointer = null; // { mode: 'aim' | 'pan' | 'grab', ... }
    this.free = false; // the player is looking around
    this.freeZoom = 1;
    this.trail = [];
    this.lastTrail = null;
    this.preview = null;
    this.queueShift = 0;
    this.bugFx = { squash: 0, vel: 0, dir: 0, hit: 0 };
    this.squashes = new Map();
    this.focus = null;
    this.keyAim = null;
    this.statics = sim.world.bodies.filter(b => b.isStatic);
    this.camInit = false;
    this.idleTime = 0;
    this.soil = null;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.baseZ = Math.min(h / VIEW_H, w / (this.isTitle ? TITLE_SPAN : VIEW_W_MIN));
    if (!this.camInit) {
      this.camZ = this.baseZ;
      this.camX = this.intro > 0 ? this.fortCentre() : this.homeX();
      this.camInit = true;
    }
  }

  homeX() {
    if (this.isTitle) return TITLE_CENTRE;
    return this.sim.sling.rest.x + (this.w * 0.2) / this.baseZ;
  }

  fortCentre() {
    const xs = this.sim.termites.map(t => t.x);
    if (xs.length === 0) return this.homeX();
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  clampCam(x, z) {
    const half = this.w / (2 * z);
    const min = -260 + half, max = this.sim.width + 220 - half;
    return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, x));
  }

  toWorld(sx, sy) {
    return {
      x: this.camX + (sx - this.w / 2) / this.camZ,
      y: (sy - this.h * HORIZON) / this.camZ,
    };
  }

  /* ---------- input ---------- */

  pointerDown(sx, sy) {
    this.sfx.unlock();
    if (this.intro > 0) {
      this.intro = 0;
      return;
    }
    const p = this.toWorld(sx, sy);
    const sim = this.sim;
    if (this.isTitle) {
      const tag = sim.tagAt(p.x, p.y);
      if (tag) {
        sim.grab(tag, p.x, p.y);
        this.pointer = { mode: 'grab' };
        this.sfx.play('tap');
        return;
      }
    }
    const keyboardAiming = sim.state === 'aiming' && this.keyAim;
    if (sim.state === 'ready' || keyboardAiming) {
      const b = sim.sling.body;
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.shape.r + GRAB_RADIUS && (keyboardAiming || sim.beginAim())) {
        // The pull follows the finger's movement, not its position, so the bug does not jump to
        // wherever the press landed inside the generous grab area.
        this.keyAim = null;
        this.pointer = { mode: 'aim', dx: b.x - p.x, dy: b.y - p.y };
        this.free = false;
        this.sfx.play('tap');
        return;
      }
    }
    if (sim.state === 'flying') {
      sim.useAbility(p.x, p.y);
      return;
    }
    this.pointer = { mode: 'pan', sx, last: sx };
  }

  pointerMove(sx, sy) {
    const ptr = this.pointer;
    if (!ptr) return;
    const p = this.toWorld(sx, sy);
    if (ptr.mode === 'aim') this.sim.aim(p.x + ptr.dx, p.y + ptr.dy);
    else if (ptr.mode === 'grab') this.sim.moveGrab(p.x, p.y);
    else if (ptr.mode === 'pan' && !this.isTitle) {
      if (Math.abs(sx - ptr.sx) > 4) this.free = true;
      this.camX = this.clampCam(this.camX - (sx - ptr.last) / this.camZ, this.camZ);
      ptr.last = sx;
    }
  }

  pointerUp() {
    const ptr = this.pointer;
    this.pointer = null;
    if (!ptr) return;
    if (ptr.mode === 'aim') this.sim.releaseAim();
    else if (ptr.mode === 'grab') this.sim.dropGrab();
  }

  /** The gesture was taken away, by a pause or the system. Unlike letting go, this fires nothing. */
  pointerCancel() {
    const ptr = this.pointer;
    this.pointer = null;
    if (ptr?.mode === 'aim') this.sim.cancelAim();
    else if (ptr?.mode === 'grab') this.sim.dropGrab();
  }

  wheel(deltaY) {
    if (this.isTitle) return;
    this.freeZoom = Math.min(1.5, Math.max(0.55, this.freeZoom * Math.exp(-deltaY * 0.001)));
    this.free = true;
  }

  /** Keyboard aiming: arrows set the angle and pull, space fires or uses the ability. */
  keyboard(code) {
    const sim = this.sim;
    if (this.intro > 0) {
      this.intro = 0;
      return true;
    }
    if (code === 'Space' || code === 'Enter') {
      this.sfx.unlock();
      if (sim.state === 'aiming' && this.keyAim) {
        sim.releaseAim();
        this.keyAim = null;
      } else if (sim.state === 'flying') {
        const b = sim.active;
        if (b) sim.useAbility(b.x + (b.vx >= 0 ? 320 : -320), b.y - 420);
      } else {
        this.beginKeyAim();
      }
      return true;
    }
    const delta = { ArrowUp: [3, 0], ArrowDown: [-3, 0], ArrowLeft: [0, 12], ArrowRight: [0, -12] }[code];
    if (!delta) return false;
    if (!this.keyAim && !this.beginKeyAim()) return true;
    this.keyAim.deg = Math.max(-30, Math.min(88, this.keyAim.deg + delta[0]));
    this.keyAim.pull = Math.max(30, Math.min(170, this.keyAim.pull + delta[1]));
    this.applyKeyAim();
    return true;
  }

  beginKeyAim() {
    if (this.sim.state !== 'ready' || !this.sim.beginAim()) return false;
    this.keyAim = { deg: 35, pull: 140 };
    this.applyKeyAim();
    this.free = false;
    return true;
  }

  applyKeyAim() {
    const a = (this.keyAim.deg * Math.PI) / 180;
    const r = this.sim.sling.rest;
    this.sim.aim(r.x - Math.cos(a) * this.keyAim.pull, r.y + Math.sin(a) * this.keyAim.pull);
  }

  /* ---------- update ---------- */

  update(dt) {
    this.t += dt;
    let scale = 1;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      scale = 0.12;
    } else if (this.slowmo > 0) {
      this.slowmo -= dt;
      scale = 0.32;
    }
    this.sim.update(dt * scale);
    this.handleEvents();
    this.fx.update(dt * (scale < 1 ? Math.max(scale, 0.4) : 1));
    this.updateBugFx(dt);
    this.updatePreview();
    this.updateTrail();
    this.updateCamera(dt);
    this.updateMushrooms(dt);
    this.queueShift = Math.max(0, this.queueShift - dt * 3);
    this.idleTime = this.sim.state === 'ready' ? this.idleTime + dt : 0;
    this.shake *= Math.exp(-dt * 7);
    if (this.reduced) this.shake = 0;
    this.shakeX = this.shake * Math.sin(this.t * 61);
    this.shakeY = this.shake * Math.cos(this.t * 47);

    const sim = this.sim;
    this.sfx.updateAmbient(dt);
    if (sim.state === 'aiming') this.sfx.stretch(sim.sling.strain());
    else this.sfx.stopStretch();
    if (this.intro > 0) this.intro -= dt;
  }

  addShake(amount) {
    this.shake = Math.min(26, this.shake + amount);
  }

  handleEvents() {
    const { sim, fx, sfx } = this;
    // Taken off the queue first, so one bad event cannot throw again on every frame and freeze the game.
    for (const e of sim.events.splice(0)) {
      switch (e.type) {
        case 'hit': {
          const power = Math.min(1, e.impulse / 1200);
          sfx.impact(e.a === 'ground' ? e.b : e.a, power);
          if (e.a !== 'ground' && e.b !== 'ground' && e.a !== e.b) sfx.impact(e.b, power * 0.7);
          for (const m of [e.a, e.b]) {
            if (e.impulse > 90 && ['twig', 'leaf', 'honey', 'pebble'].includes(m)) {
              fx.burst(m, e.x, e.y, Math.min(9, Math.round(e.impulse / 150)), 0, 0, 0.5);
            }
          }
          if (e.impulse > 160) fx.puff(e.x, e.y, 10 + power * 14, '226,214,186', 0.34 * power + 0.1, 0, -10, 0.5);
          if (e.impulse > 240) this.addShake(power * 7);
          if (e.bug) {
            const bf = this.bugFx;
            bf.vel = -Math.min(11, e.impulse / 140);
            bf.hit = 0.7;
            bf.dir = Math.atan2(sim.active?.vy ?? 1, sim.active?.vx ?? 0);
          }
          if (e.impulse > 950 && !this.reduced) this.hitstop = Math.max(this.hitstop, 0.05);
          break;
        }
        case 'break':
          sfx.crack(e.mat);
          fx.shatter(e.mat, e.x, e.y, e.w, e.h, e.a, e.vx, e.vy);
          this.addShake(3);
          break;
        case 'hurt':
          sfx.play('hurt');
          fx.sawdust(e.x, e.y, 5, 10);
          break;
        case 'kill': {
          sfx.play(e.who === 'queen' ? 'bigKill' : 'kill');
          fx.sawdust(e.x, e.y, e.r > 40 ? 70 : 22, e.r);
          fx.puff(e.x, e.y, e.r * 1.2, '250,238,208', 0.75, 0, -28, 0.8);
          fx.ring(e.x, e.y, e.r * 2.6, '255,236,180', 0.34, 4);
          this.addShake(e.r > 40 ? 15 : 5);
          if (sim.targetsLeft() === 0 && !this.reduced) this.slowmo = 0.8;
          break;
        }
        case 'score':
          fx.popup(`+${e.points}`, e.x, e.y - 18, e.points >= 1000);
          break;
        case 'explode':
          sfx.play('boom');
          fx.flash(e.x, e.y, e.radius * 0.5, '255,244,190', 0.14);
          fx.ring(e.x, e.y, e.radius, '255,226,150', 0.42, 9);
          fx.seeds(e.x, e.y, 46);
          for (let i = 0; i < 7; i++) {
            const a = Math.random() * 6.28, d = Math.random() * e.radius * 0.35;
            fx.puff(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 26 + Math.random() * 26, i % 2 ? '186,206,110' : '230,220,170', 0.62, Math.cos(a) * 60, Math.sin(a) * 60 - 30, 0.9);
          }
          this.addShake(24);
          if (!this.reduced) this.hitstop = Math.max(this.hitstop, 0.08);
          break;
        case 'burst':
          sfx.play('plip');
          fx.droplets(e.x, e.y, Math.round(e.r * 1.4), 240);
          fx.ring(e.x, e.y, e.r * 2, '226,250,246', 0.26, 2.5);
          break;
        case 'splash':
          sfx.play('splash', { power: Math.min(1, e.speed / 500) });
          fx.droplets(e.x, e.y, 22, 170 + Math.min(280, e.speed * 0.5), 1.1, 3);
          break;
        case 'ropeCut':
          sfx.play('snap');
          fx.droplets(e.x, e.y, 5, 120, 0.4, 1.6);
          break;
        case 'ropeSnap':
          sfx.play('snap');
          for (const line of e.rope.polylines()) fx.thread(line);
          break;
        case 'mushroom':
          sfx.play('boing', { power: Math.min(1, e.impulse / 700) });
          break;
        case 'release':
          sfx.stopStretch();
          sfx.play('twang', { strain: e.strain });
          break;
        case 'launch':
          this.trail = [];
          this.lastTrail = { x: e.x, y: e.y };
          this.preview = null;
          sfx.play('whoosh', { power: Math.min(1, e.speed / 800) });
          if (BUGS[e.who].ability) this.onHint?.(BUGS[e.who].hint, 'ability');
          else this.onHint?.('', 'ability');
          break;
        case 'ability':
          this.abilityFx(e);
          break;
        case 'silkOff':
          for (const line of e.lines) fx.thread(line);
          this.onHint?.('', 'ability');
          break;
        case 'hop':
          sfx.play('hop');
          this.queueShift = 1;
          break;
        case 'seated':
          sfx.play('seat');
          this.bugFx.vel = -5;
          this.bugFx.dir = Math.PI / 2;
          break;
        case 'retire':
          sfx.play('poof');
          fx.puff(e.x, e.y, 26, '236,228,206', 0.55, 0, -22, 0.6);
          this.onHint?.('', 'ability');
          break;
        case 'won':
          sfx.play('win');
          this.onResult?.('won', e);
          break;
        case 'lost':
          sfx.play('lose');
          this.onResult?.('lost', e);
          break;
      }
    }
  }

  abilityFx(e) {
    const { fx, sfx } = this;
    switch (e.kind) {
      case 'click':
        sfx.play('click');
        fx.ring(e.x, e.y, 54, '255,226,170', 0.2, 4);
        fx.flash(e.x, e.y, 18, '255,244,210', 0.07);
        this.onHint?.('', 'ability');
        break;
      case 'slam':
        sfx.play('slam');
        fx.ring(e.x, e.y, 70, '255,255,255', 0.22, 3);
        this.onHint?.('', 'ability');
        break;
      case 'jet': {
        sfx.play('jet');
        const n = 14;
        for (let i = 0; i < n; i++) {
          const spread = (Math.random() - 0.5) * 1.0;
          const c = Math.cos(spread), s = Math.sin(spread);
          const dx = e.dx * c - e.dy * s, dy = e.dx * s + e.dy * c;
          const v = 240 + Math.random() * 520;
          fx.puff(e.x + dx * 22, e.y + dy * 22, 12 + Math.random() * 22, i % 3 ? '255,206,120' : '255,244,206', 0.75, dx * v, dy * v, 0.5 + Math.random() * 0.25);
        }
        fx.flash(e.x + e.dx * 26, e.y + e.dy * 26, 30, '255,232,150', 0.08);
        this.addShake(9);
        this.onHint?.('', 'ability');
        break;
      }
      case 'silk':
        sfx.play('thwip');
        fx.droplets(e.tx, e.ty, 5, 70, 0.3, 1.5);
        this.onHint?.('再点一下松开蛛丝', 'ability');
        break;
      case 'silkMiss':
        sfx.play('poof');
        fx.thread([{ x: e.x, y: e.y }, { x: e.x + e.dx * 160, y: e.y + e.dy * 160 }]);
        break;
    }
  }

  updateBugFx(dt) {
    const f = this.bugFx;
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      f.vel += (-300 * f.squash - 15 * f.vel) * h;
      f.squash += f.vel * h;
    }
    if (f.hit > 0) f.hit -= dt;
  }

  updatePreview() {
    const sim = this.sim;
    if (sim.state !== 'aiming' || sim.sling.strain() < 0.13) {
      this.preview = null;
      return;
    }
    const b = sim.sling.body;
    const launch = sim.sling.previewLaunch(b, sim.sling.target.x, sim.sling.target.y);
    if (!launch) {
      this.preview = null;
      return;
    }
    this.preview = flightPath({ ...launch, airDrag: b.airDrag, gravity: GRAVITY, seconds: 1.05, every: 0.075 });
  }

  updateTrail() {
    const bug = this.sim.active;
    if (!bug || bug.ent.landed || !this.lastTrail) return;
    if (Math.hypot(bug.x - this.lastTrail.x, bug.y - this.lastTrail.y) > 42) {
      this.lastTrail = { x: bug.x, y: bug.y };
      this.trail.push(this.lastTrail);
      if (this.trail.length > 90) this.trail.shift();
    }
  }

  updateMushrooms(dt) {
    for (const b of this.statics) {
      const e = b.ent;
      if (e?.kind !== 'mushroom') continue;
      e.squashVel = (e.squashVel ?? 0) + (-420 * e.squash - 14 * (e.squashVel ?? 0)) * dt;
      e.squash += e.squashVel * dt;
    }
  }

  updateCamera(dt) {
    const sim = this.sim;
    const base = this.baseZ;
    let tx = this.homeX(), tz = base * this.freeZoom, rate = 2.6;

    if (this.isTitle) {
      tz = base;
      tx = this.homeX();
    } else if (this.intro > 0) {
      const u = this.intro / INTRO_SECONDS;
      tx = u > 0.42 ? this.fortCentre() : this.homeX();
      rate = u > 0.42 ? 6 : 2.1;
      tz = base;
    } else if (sim.state === 'aiming') {
      const strain = sim.sling.strain();
      tz = base * (1 - strain * 0.08);
      tx = this.homeX() - (strain * 46) / tz;
      rate = 5;
    } else if (sim.state === 'flying' || sim.state === 'launching' || sim.state === 'settling') {
      this.free = false;
      const bug = sim.active;
      if (bug) {
        tx = bug.x + bug.vx * 0.26;
        const high = -bug.y + 130;
        const fit = (this.h * HORIZON - 40) / Math.max(1, high);
        tz = Math.max(base * 0.55, Math.min(base, fit));
        rate = 4.2;
        this.focus = bug.x;
      } else if (this.focus !== null) {
        tx = this.focus;
        rate = 2;
        tz = base;
      }
    } else if (this.free) {
      tx = this.camX;
    } else {
      tz = base;
    }
    const k = 1 - Math.exp(-dt * rate);
    this.camZ += (tz - this.camZ) * Math.min(1, 1 - Math.exp(-dt * 3.4));
    this.camX += (this.clampCam(tx, this.camZ) - this.camX) * k;
    this.camX = this.clampCam(this.camX, this.camZ);
  }

  /* ---------- drawing ---------- */

  draw(ctx) {
    const { w, h, dpr, sim, t } = this;
    const z = this.camZ;
    const horizon = h * HORIZON + this.shakeY * 0.6;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackdrop(ctx, this.backdrop, w, h, this.camX, z, horizon, t);

    ctx.setTransform(
      dpr * z, 0, 0, dpr * z,
      dpr * (w / 2 - this.camX * z + this.shakeX),
      dpr * (h * HORIZON + this.shakeY),
    );

    const viewMin = this.camX - w / (2 * z) - 80;
    const viewMax = this.camX + w / (2 * z) + 80;
    this.drawGround(ctx, viewMin, viewMax);
    this.drawStatics(ctx);
    this.drawRopes(ctx);
    this.drawShadows(ctx);
    this.drawTrail(ctx);

    drawForkPart(ctx, sim.sling, 'back', t);
    this.drawBand(ctx, 'back');
    this.drawBodies(ctx);
    this.drawQueue(ctx);
    this.drawHopping(ctx);
    const wrap = sim.state === 'aiming' && sim.sling.strain() > 0.22;
    if (!wrap) this.drawBand(ctx, 'front');
    this.drawLoadedBug(ctx);
    if (wrap) this.drawBand(ctx, 'front');
    drawForkPart(ctx, sim.sling, 'front', t);
    this.drawActiveBug(ctx);
    this.drawPreview(ctx);
    this.fx.draw(ctx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPollen(ctx, this.pollen, w, h, this.mood, t, this.camX, z);
    drawForeground(ctx, this.front, w, h, this.camX, z);
    this.drawVignette(ctx);
  }

  drawVignette(ctx) {
    const { w, h } = this;
    const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.42, w / 2, h * 0.46, Math.max(w, h) * 0.8);
    g.addColorStop(0, 'rgba(8,20,20,0)');
    g.addColorStop(1, 'rgba(8,20,20,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  soilPattern(ctx) {
    if (!this.soil) this.soil = ctx.createPattern(soilTile(), 'repeat');
    return this.soil;
  }

  drawGround(ctx, viewMin, viewMax) {
    const strip = mossStrip();
    for (const z of this.sim.zones) this.drawWater(ctx, z);
    for (const b of this.statics) {
      const e = b.ent;
      if (!e?.ground) continue;
      const half = b.shape.w / 2;
      const x0 = Math.max(viewMin, b.x - half), x1 = Math.min(viewMax, b.x + half);
      if (x1 <= x0) continue;
      ctx.fillStyle = this.soilPattern(ctx);
      ctx.fillRect(x0, 0, x1 - x0, 600);
      const fade = ctx.createLinearGradient(0, 0, 0, 180);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(10,6,4,0.55)');
      ctx.fillStyle = fade;
      ctx.fillRect(x0, 0, x1 - x0, 600);
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x - half, -strip.baseY - 8, b.shape.w, strip.canvas.height + 16);
      ctx.clip();
      const tile = strip.canvas.width;
      const start = Math.floor(x0 / tile) * tile;
      for (let x = start; x < x1; x += tile) ctx.drawImage(strip.canvas, x, 4 - strip.baseY);
      ctx.restore();
    }
  }

  drawWater(ctx, zone) {
    const { t } = this;
    const depth = 160;
    ctx.fillStyle = this.soilPattern(ctx);
    ctx.fillRect(zone.x0 - 20, 0, zone.x1 - zone.x0 + 40, 600);
    const g = ctx.createLinearGradient(0, zone.y, 0, zone.y + depth);
    g.addColorStop(0, 'rgba(88,190,190,0.92)');
    g.addColorStop(1, 'rgba(16,70,86,0.97)');
    ctx.fillStyle = g;
    ctx.fillRect(zone.x0, zone.y, zone.x1 - zone.x0, depth);
    ctx.strokeStyle = 'rgba(232,255,250,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = zone.x0; x <= zone.x1; x += 8) {
      const y = zone.y + Math.sin(x * 0.05 + t * 2.2) * 1.5 + Math.sin(x * 0.11 - t * 1.4);
      if (x === zone.x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,255,250,0.2)';
    for (let i = 0; i < 6; i++) {
      const span = zone.x1 - zone.x0;
      const x = zone.x0 + ((i * 53.7 + t * 12) % span);
      ctx.beginPath();
      ctx.ellipse(x, zone.y + 18 + (i % 3) * 24, 18, 2.2, 0, 0, 6.3);
      ctx.fill();
    }
  }

  drawStatics(ctx) {
    for (const b of this.statics) {
      const e = b.ent;
      if (!e) continue;
      if (e.kind === 'terrain' && !e.ground) this.drawRock(ctx, b);
      else if (e.kind === 'branch') this.drawBranch(ctx, b);
    }
    for (const b of this.statics) if (b.ent?.kind === 'mushroom') drawMushroom(ctx, b, Math.max(0, b.ent.squash));
  }

  drawRock(ctx, b) {
    const n = b.shape.n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(b.wx[i], b.wy[i]) : ctx.moveTo(b.wx[i], b.wy[i]));
    ctx.closePath();
    ctx.fillStyle = this.soilPattern(ctx);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,6,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      if (b.wny[i] > -0.3) continue; // moss only grows on faces looking up
      const j = (i + 1) % n;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#587a2a';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(b.wx[i], b.wy[i] + 2);
      ctx.lineTo(b.wx[j], b.wy[j] + 2);
      ctx.stroke();
      ctx.strokeStyle = '#8fb040';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(b.wx[i], b.wy[i] - 1.5);
      ctx.lineTo(b.wx[j], b.wy[j] - 1.5);
      ctx.stroke();
    }
  }

  drawBranch(ctx, b) {
    const w = b.shape.w, h = b.shape.h;
    const x0 = b.x - w / 2, y0 = b.y - h / 2;
    const bark = ctx.createLinearGradient(0, y0, 0, y0 + h);
    bark.addColorStop(0, '#6e5236');
    bark.addColorStop(0.5, '#4a3522');
    bark.addColorStop(1, '#2a1c11');
    ctx.fillStyle = bark;
    ctx.beginPath();
    ctx.moveTo(x0 - 40, y0 + 6);
    ctx.quadraticCurveTo(b.x, y0 - 4, x0 + w + 40, y0 + 6);
    ctx.lineTo(x0 + w + 40, y0 + h - 6);
    ctx.quadraticCurveTo(b.x, y0 + h + 4, x0 - 40, y0 + h - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,6,0.45)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const y = y0 + (h * (i + 0.6)) / 5.4;
      ctx.beginPath();
      ctx.moveTo(x0 - 30, y);
      ctx.quadraticCurveTo(b.x + (i - 2) * 40, y + (i % 2 ? 3 : -3), x0 + w + 30, y);
      ctx.stroke();
    }
    // Leaves hanging off it, moving a little.
    for (let i = 0; i <= Math.floor(w / 120); i++) {
      const lx = x0 + i * 120 + (i % 2) * 34;
      const sway = Math.sin(this.t * 1.2 + i * 1.7) * 0.1;
      ctx.save();
      ctx.translate(lx, y0 + h - 2);
      ctx.rotate(1.2 + (i % 3) * 0.3 + sway);
      ctx.fillStyle = i % 2 ? '#587a2a' : '#749a36';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(18, -11, 44, 0);
      ctx.quadraticCurveTo(18, 11, 0, 0);
      ctx.fill();
      ctx.restore();
    }
  }

  drawRopes(ctx) {
    for (const rope of this.sim.ropes) {
      const strain = Math.min(1, Math.max(...rope.tensions) / (rope.load * 3));
      const width = 2.5 - strain * 0.7;
      for (const line of rope.polylines()) {
        silkStrand(ctx, line, width);
        // Dew beads strung along the silk.
        for (let i = 1; i < line.length - 1; i++) {
          drawDew(ctx, line[i].x, line[i].y + 2.5, 2.8);
        }
      }
    }
    if (this.sim.silk) {
      for (const line of this.sim.silk.polylines()) silkStrand(ctx, line, 2.6);
    }
  }

  drawShadows(ctx) {
    ctx.fillStyle = 'rgba(14,8,4,0.3)';
    for (const b of this.sim.world.bodies) {
      if (b.isStatic) continue;
      const height = -b.y;
      if (height < -20 || height > 460) continue;
      const k = 1 - height / 520;
      const size = b.shape.bound * (0.75 + 0.35 * (1 - k));
      ctx.globalAlpha = 0.65 * k * k;
      ctx.beginPath();
      ctx.ellipse(b.x + height * 0.08, 4, size, 5 * k + 2, 0, 0, 6.3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawTrail(ctx) {
    ctx.fillStyle = 'rgba(255,248,224,0.62)';
    for (let i = 0; i < this.trail.length; i++) {
      const r = i % 3 === 0 ? 3.6 : 2.2;
      ctx.beginPath();
      ctx.arc(this.trail[i].x, this.trail[i].y, r, 0, 6.3);
      ctx.fill();
    }
  }

  drawBand(ctx, side) {
    const band = this.sim.sling.band;
    const k = this.sim.sling.pouchIndex;
    const pts = [];
    if (side === 'back') for (let i = band.count - 1; i >= k; i--) pts.push(band.nodePos(i));
    else for (let i = 0; i <= k; i++) pts.push(band.nodePos(i));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    // Elastic thins as it stretches, keeping its volume: this is most of what makes it read as rubbery.
    const ratio = Math.max(1, length / this.sim.sling.spread);
    const width = 6.5 / Math.pow(ratio, 0.42);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    smoothPath(ctx, pts);
    ctx.strokeStyle = 'rgba(36,26,16,0.45)';
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.strokeStyle = side === 'back' ? '#cfc4a8' : '#f4eedb';
    ctx.lineWidth = width;
    ctx.stroke();
    if (side === 'front') {
      // A bright line along the strand catches more light the tighter it is pulled.
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.9, 0.25 + (ratio - 1) * 0.16)})`;
      ctx.lineWidth = Math.max(0.8, width * 0.3);
      ctx.stroke();
    }
    if (side === 'back') {
      // The pouch: a small curled leaf that the bug sits in.
      const p = pts[pts.length - 1], q = pts[pts.length - 2];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.y - q.y, p.x - q.x) + Math.PI / 2);
      ctx.fillStyle = '#7f6a3c';
      ctx.beginPath();
      ctx.ellipse(0, 0, 20, 9, 0, 0, 6.3);
      ctx.fill();
      ctx.restore();
    }
  }

  drawBodies(ctx) {
    const t = this.t;
    const bug = this.sim.active;
    for (const b of this.sim.world.bodies) {
      if (b.isStatic) continue;
      const e = b.ent;
      if (!e) continue;
      switch (e.kind) {
        case 'block': {
          const s = blockSprite(b);
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.a);
          ctx.drawImage(s.image, -s.drawW / 2, -s.drawH / 2, s.drawW, s.drawH);
          ctx.restore();
          break;
        }
        case 'tag': {
          const s = tagSprite(b.ent.label, b.shape.w, b.shape.h);
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.a);
          ctx.drawImage(s.image, -s.drawW / 2, -s.drawH / 2, s.drawW, s.drawH);
          ctx.restore();
          break;
        }
        case 'pod':
          drawPod(ctx, b.x, b.y, b.a, b.shape.r, t, e.hp < 1);
          break;
        case 'dew': {
          const speed = Math.hypot(b.vx, b.vy);
          const stretch = Math.min(0.2, speed / 2400);
          drawDew(ctx, b.x, b.y, b.shape.r, 1 + stretch * 0.5, 1 - stretch * 0.4);
          break;
        }
        case 'termite':
          this.drawOneTermite(ctx, b, bug);
          break;
      }
    }
  }

  drawOneTermite(ctx, b, bug) {
    const e = b.ent;
    let lx = -1, ly = 0, scared = 0;
    if (bug && !bug.asleep) {
      const dx = bug.x - b.x, dy = bug.y - b.y;
      const dist = Math.hypot(dx, dy) || 1;
      lx = dx / dist;
      ly = dy / dist;
      if (dist < 460 && Math.hypot(bug.vx, bug.vy) > 120) scared = 1 - dist / 460;
    } else {
      // Idle glances around, always returning to the sling.
      const glance = Math.sin(this.t * 0.8 + b.id * 1.9);
      lx = glance > 0.75 ? 0.6 : -1;
      ly = Math.sin(this.t * 0.5 + b.id) * 0.3;
      const size = Math.hypot(lx, ly);
      lx /= size;
      ly /= size;
    }
    const face = lx > 0.25 ? 1 : -1;
    const cos = Math.cos(-b.a), sin = Math.sin(-b.a);
    drawTermite(ctx, e.type, b.x, b.y, b.a, b.shape.r, {
      face,
      t: this.t,
      awake: !b.asleep,
      hurt: e.hurt,
      hp: e.hp,
      scared,
      look: { x: cos * lx - sin * ly, y: sin * lx + cos * ly },
    });
  }

  drawQueue(ctx) {
    const sim = this.sim;
    const r = sim.sling.rest;
    sim.queue.forEach((type, i) => {
      const spec = BUGS[type];
      const hop = Math.abs(Math.sin(this.t * 2.2 + i * 1.3)) * 2.5;
      const shuffle = this.queueShift > 0 ? this.queueShift * QUEUE_GAP : 0;
      const x = r.x - QUEUE_START - i * QUEUE_GAP - shuffle;
      drawBug(ctx, type, x, -spec.radius - hop, spec.radius, {
        a: 0, look: { x: 1, y: 0 }, t: this.t, seed: i * 1.7, mood: 'idle',
        squash: hop * 0.012, stretchDir: Math.PI / 2,
      });
    });
  }

  drawHopping(ctx) {
    const hop = this.sim.hopping;
    if (!hop) return;
    const b = hop.body;
    drawBug(ctx, b.ent.type, b.x, b.y, b.shape.r, { a: b.a, look: { x: 1, y: 0 }, t: this.t, mood: 'idle' });
  }

  drawLoadedBug(ctx) {
    const sling = this.sim.sling;
    const b = sling.body;
    if (!b) return;
    if (this.idleTime > GRAB_HINT_AFTER && this.intro <= 0 && !this.reduced) {
      const wave = (this.t * 0.9) % 1;
      ctx.strokeStyle = `rgba(255,240,180,${0.75 * (1 - wave)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.shape.r + 8 + wave * 26, 0, 6.3);
      ctx.stroke();
    }
    const strain = sling.strain();
    const dx = sling.rest.x - b.x, dy = sling.rest.y - b.y;
    const toward = Math.atan2(dy, dx);
    const f = this.bugFx;
    const aiming = this.sim.state === 'aiming';
    const stretch = aiming ? strain * 0.16 : f.squash * 0.07;
    drawBug(ctx, b.ent.type, b.x, b.y, b.shape.r, {
      a: aiming || strain > 0.1 ? toward : 0,
      look: { x: Math.cos(aiming ? toward : 0), y: Math.sin(aiming ? toward : 0) },
      t: this.t,
      mood: aiming ? 'aim' : 'idle',
      squash: stretch,
      stretchDir: aiming ? toward : f.dir,
      used: false,
    });
  }

  drawActiveBug(ctx) {
    const b = this.sim.active;
    if (!b) return;
    const f = this.bugFx;
    const speed = Math.hypot(b.vx, b.vy);
    const mood = f.hit > 0 ? 'hit' : b.ent.landed ? 'idle' : 'fly';
    let squash, dir;
    if (Math.abs(f.squash) > 0.04) {
      squash = Math.max(-0.42, f.squash * 0.1);
      dir = f.dir;
    } else {
      squash = Math.min(0.13, speed / 6200);
      dir = Math.atan2(b.vy, b.vx);
    }
    drawBug(ctx, b.ent.type, b.x, b.y, b.shape.r, {
      a: b.a,
      look: speed > 40 ? { x: b.vx / speed, y: b.vy / speed } : { x: 1, y: 0 },
      t: this.t,
      mood,
      squash,
      stretchDir: dir,
      used: b.ent.used,
    });
  }

  drawPreview(ctx) {
    const path = this.preview;
    if (!path) return;
    for (let i = 1; i < path.length; i++) {
      const u = i / path.length;
      const r = 6.4 - u * 3.8;
      ctx.globalAlpha = 0.95 * (1 - u * u);
      ctx.fillStyle = 'rgba(40,28,10,0.5)';
      ctx.beginPath();
      ctx.arc(path[i].x, path[i].y, r + 1.5, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = '#ffe28a';
      ctx.beginPath();
      ctx.arc(path[i].x, path[i].y, r, 0, 6.3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
