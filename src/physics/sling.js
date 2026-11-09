// The sling is a real elastic chain: tip - nodes - pouch - nodes - tip.
//
// Nothing here stores a launch speed. While aiming, the bug is pinned to the pointer and only
// stretches the band. On release the band's tension accelerates it, so a heavier bug leaves slower.
// When the bug crosses the fork the band has gone slack and it simply flies on; the pouch keeps its
// own small momentum and rings down.

import { Rope } from './rope.js';
import { Body } from './body.js';
import { circle } from './shapes.js';
import { SUBSTEP } from './world.js';

const SIDE_SEGMENTS = 3;
const PIN_TIME_CONSTANT = 0.012; // seconds of smoothing, so pointer jumps do not shock the band
const SEAT_DAMPING = 5; // per second: a bug sitting in the pouch stops bobbing

const DEFAULTS = {
  spread: 30,
  maxPull: 170,
  minPull: 22,
  groundY: Infinity,
  load: 900,
  hold: 1,
  modulus: 5,
  late: 0.55,
  damp: 0.03,
  nodeMass: 0.012,
  pouchMass: 0.06,
  nodeDrag: 5,
};

export class Sling {
  constructor(options) {
    this.options = options;
    const o = { ...DEFAULTS, ...options };
    this.rest = { x: o.x, y: o.y };
    this.spread = o.spread;
    this.maxPull = o.maxPull;
    this.minPull = o.minPull;
    this.groundY = o.groundY;
    this.pouchMass = o.pouchMass;
    this.tipL = { x: o.x - o.spread, y: o.y };
    this.tipR = { x: o.x + o.spread, y: o.y };

    const points = [];
    for (let i = 0; i <= 2 * SIDE_SEGMENTS; i++) {
      const t = i / (2 * SIDE_SEGMENTS);
      points.push({ x: this.tipL.x + (this.tipR.x - this.tipL.x) * t, y: o.y });
    }
    this.band = new Rope({
      points,
      length: 2 * o.spread,
      load: o.load,
      hold: o.hold,
      modulus: o.modulus,
      late: o.late,
      damp: o.damp,
      nodeMass: o.nodeMass,
      nodeDrag: o.nodeDrag,
    });
    this.pouchIndex = SIDE_SEGMENTS;
    this.band.w[this.pouchIndex] = 1 / o.pouchMass;

    this.body = null;
    this.state = 'empty'; // empty | loaded | aiming | launching
    this.target = { x: o.x, y: o.y };
    this.launchDir = { x: 1, y: 0 };
    this.onLaunch = null;
  }

  /** Seats a bug in the pouch. Any velocity it arrives with is kept, so it can land with a bounce. */
  load(body) {
    this.body = body;
    this.band.attach(this.pouchIndex, body, 0, 0);
    this.state = 'loaded';
  }

  /** Clamps a desired bug position to what the band and the ground allow. */
  clampPull(x, y) {
    const dx = x - this.rest.x, dy = y - this.rest.y;
    const dist = Math.hypot(dx, dy);
    let cx = x, cy = y;
    if (dist > this.maxPull) {
      cx = this.rest.x + (dx / dist) * this.maxPull;
      cy = this.rest.y + (dy / dist) * this.maxPull;
    }
    if (cy > this.groundY) cy = this.groundY;
    return { x: cx, y: cy };
  }

  /** Pins the bug toward a point; call again as the pointer moves. */
  aim(x, y) {
    if (!this.body || (this.state !== 'loaded' && this.state !== 'aiming')) return;
    if (this.state === 'loaded') {
      this.body.im = 0;
      this.body.ii = 0;
      this.state = 'aiming';
      this.aimFrom = { x: this.body.x, y: this.body.y };
    }
    this.target = this.clampPull(x, y);
  }

  /** Lets go without firing: the bug settles back into the pouch. */
  cancel() {
    if (this.state !== 'aiming') return;
    const b = this.body;
    b.im = b.imBase;
    b.ii = b.iiBase;
    b.vx = b.vy = 0;
    this.state = 'loaded';
  }

  /** Lets go. Returns true if the pull was enough to fire, false if the bug just drops back. */
  release() {
    if (this.state !== 'aiming') return false;
    const b = this.body;
    const dx = this.rest.x - b.x, dy = this.rest.y - b.y;
    const dist = Math.hypot(dx, dy);
    // Measured from where the aim began too: a heavy bug sags past minPull just by sitting there,
    // and a tap on it must not count as a pull.
    const moved = Math.hypot(b.x - this.aimFrom.x, b.y - this.aimFrom.y);
    if (dist < this.minPull || moved < this.minPull) {
      this.cancel();
      return false;
    }
    b.im = b.imBase;
    b.ii = b.iiBase;
    b.vx = b.vy = 0;
    this.launchDir = { x: dx / dist, y: dy / dist };
    this.state = 'launching';
    return true;
  }

  pullDistance() {
    if (!this.body) return 0;
    return Math.hypot(this.body.x - this.rest.x, this.body.y - this.rest.y);
  }

  /** How strained the band is right now, 0 at rest and 1 at full pull. */
  strain() {
    return Math.min(1, this.pullDistance() / this.maxPull);
  }

  pouch() {
    return this.band.nodePos(this.pouchIndex);
  }

  integrate(h, g) {
    const b = this.body;
    if (b) {
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
      if (this.state === 'aiming') {
        const k = 1 - Math.exp(-h / PIN_TIME_CONSTANT);
        b.x += (this.target.x - b.x) * k;
        b.y += (this.target.y - b.y) * k;
      } else {
        // While launching, the band out-pulls the bug's weight many times over and the pouch carries
        // it, so it leaves along the line of the band instead of sagging below the aim.
        if (this.state !== 'launching') {
          b.vy += g * h;
          const seat = Math.exp(-SEAT_DAMPING * h);
          b.vx *= seat;
          b.vy *= seat;
        }
        b.x += b.vx * h;
        b.y += b.vy * h;
      }
    }
    this.band.integrate(h, g);
  }

  solve(h) {
    this.band.solve(h);
  }

  finish(h) {
    this.band.finish(h);
    const b = this.body;
    if (!b || this.state === 'aiming') {
      if (b) b.vx = b.vy = 0;
      return;
    }
    b.vx = (b.x - b.px) / h;
    b.vy = (b.y - b.py) / h;
    if (this.state !== 'launching') return;
    const past = (b.x - this.rest.x) * this.launchDir.x + (b.y - this.rest.y) * this.launchDir.y;
    if (past < 0) return;

    // Past the fork the band can only pull backward, so the bug and pouch part ways here.
    this.band.detach(this.pouchIndex, this.pouchMass, b.vx, b.vy);
    this.body = null;
    this.state = 'empty';
    b.updateWorld();
    this.onLaunch?.(b);
  }

  /** Runs the same band physics on a copy, from a settled pull, and reports the launch state. */
  previewLaunch(body, x, y) {
    const target = this.clampPull(x, y);
    const test = new Sling(this.options);
    const ghost = new Body({ shape: body.shape ?? circle(24), x: target.x, y: target.y });
    ghost.m = body.m;
    ghost.imBase = ghost.im = body.imBase;
    ghost.airDrag = body.airDrag;
    test.load(ghost);
    test.band.settleStraightThrough(test.pouchIndex);
    const gravity = this.world?.gravity ?? 500;
    test.state = 'aiming';
    test.target = target;
    test.aimFrom = test.rest;
    test.release();
    if (test.state !== 'launching') return null;
    let result = null;
    test.onLaunch = b => {
      result = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    };
    for (let i = 0; i < 960 && !result; i++) {
      test.integrate(SUBSTEP, gravity);
      test.solve(SUBSTEP);
      test.finish(SUBSTEP);
    }
    return result;
  }

  linkedBodies() {
    return null;
  }
}

/** Samples a free flight with the world's own integration order, so it matches a real shot. */
export function flightPath({ x, y, vx, vy, airDrag = 0, gravity, seconds, every }) {
  const out = [{ x, y }];
  const h = SUBSTEP;
  const total = Math.round(seconds / h);
  const stride = Math.max(1, Math.round(every / h));
  for (let i = 1; i <= total; i++) {
    vy += gravity * h;
    if (airDrag > 0) {
      const f = 1 / (1 + airDrag * Math.hypot(vx, vy) * h);
      vx *= f;
      vy *= f;
    }
    x += vx * h;
    y += vy * h;
    if (i % stride === 0) out.push({ x, y });
  }
  return out;
}
