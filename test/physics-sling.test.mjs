// The sling: drag, elastic charge, launch. Launch speed and separation come out of the band
// physics, so these tests check outcomes rather than any stored launch formula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Body, Sling, flightPath, circle } from '../src/physics/index.js';

const G = 500;
const REST = { x: 300, y: -140 };
const BUG = density => new Body({ shape: circle(24), density, airDrag: 0 });
const near = (actual, expected, tol, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} ±${tol}, got ${actual}`);

function setup(density = 1) {
  const w = new World({ gravity: G });
  const sling = w.addConstraint(new Sling({ x: REST.x, y: REST.y }));
  const bug = BUG(density);
  sling.load(bug);
  let launched = null;
  sling.onLaunch = b => {
    launched = { vx: b.vx, vy: b.vy, x: b.x, y: b.y };
    w.add(b);
  };
  return { w, sling, bug, launched: () => launched };
}
const run = (w, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) w.step(1 / 60); };

function shoot(density, pull, angleDeg = 35) {
  const s = setup(density);
  const a = (angleDeg * Math.PI) / 180;
  s.sling.aim(REST.x - pull * Math.cos(a), REST.y + pull * Math.sin(a));
  run(s.w, 0.5);
  assert.equal(s.sling.release(), true);
  run(s.w, 0.6);
  const l = s.launched();
  assert.ok(l, `pull ${pull} never launched`);
  return { ...l, speed: Math.hypot(l.vx, l.vy), bug: s.bug, sling: s.sling, w: s.w };
}

test('more pull launches faster, up to a brisk top speed', () => {
  const speeds = [40, 80, 120, 170].map(p => shoot(1, p).speed);
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1] * 1.1, `speeds ${speeds}`);
  assert.ok(speeds[3] > 700 && speeds[3] < 950, `top speed ${speeds[3]}`);
});

test('a bug twice as heavy leaves at about 1/sqrt(2) of the speed', () => {
  const light = shoot(1, 170).speed;
  const heavy = shoot(2, 170).speed;
  near(heavy / light, Math.SQRT1_2, 0.07, 'speed ratio');
});

test('the launch goes the opposite way from the pull', () => {
  for (const deg of [10, 35, 60, 80]) {
    const s = shoot(1, 170, deg);
    const launchDeg = (Math.atan2(-s.vy, s.vx) * 180) / Math.PI;
    near(launchDeg, deg, 6, `pull at ${deg} degrees`);
  }
});

test('once it leaves the pouch only gravity acts on the bug', () => {
  const s = shoot(1, 170);
  const vx = s.bug.vx, vy = s.bug.vy;
  run(s.w, 0.5);
  near(s.bug.vx, vx, 0.5, 'horizontal speed is constant');
  near(s.bug.vy - vy, G * 0.5, 2, 'vertical speed follows gravity');
});

test('a tiny pull does not fire: the bug stays in the pouch', () => {
  const s = setup();
  s.sling.aim(REST.x - 6, REST.y + 4);
  run(s.w, 0.2);
  assert.equal(s.sling.release(), false);
  run(s.w, 1);
  assert.equal(s.launched(), null);
  assert.equal(s.sling.state, 'loaded');
  assert.ok(Math.hypot(s.bug.x - REST.x, s.bug.y - REST.y) < 60, 'bug should settle back in the pouch');
});

test('pulling beyond the limit holds the bug at the limit', () => {
  const s = setup();
  s.sling.aim(REST.x - 2000, REST.y + 300);
  run(s.w, 0.5);
  near(Math.hypot(s.bug.x - REST.x, s.bug.y - REST.y), s.sling.maxPull, 1, 'pull distance');
});

test('the bug cannot be dragged below the ground line', () => {
  const s = setup();
  s.sling.groundY = -24;
  s.sling.aim(REST.x - 20, REST.y + 500);
  run(s.w, 0.5);
  assert.ok(s.bug.y <= -24 + 0.5, `bug below ground: ${s.bug.y}`);
});

test('a loaded bug sags into the band under its own weight, then rests', () => {
  const s = setup();
  run(s.w, 3);
  const sag = s.bug.y - REST.y;
  assert.ok(sag > 3 && sag < 45, `sag ${sag}`);
  const before = s.bug.y;
  run(s.w, 1);
  near(s.bug.y, before, 0.1, 'bug at rest in the pouch');
});

test('after the shot the pouch overshoots the fork and rings down to rest', () => {
  const s = setup();
  s.sling.aim(REST.x - 140, REST.y + 100);
  run(s.w, 0.5);
  s.sling.release();
  let furthest = 0;
  for (let i = 0; i < 60 * 3; i++) {
    s.w.step(1 / 60);
    const p = s.sling.pouch();
    if (s.launched()) furthest = Math.max(furthest, p.x - REST.x);
  }
  assert.ok(furthest > 8, `pouch never overshot: ${furthest}`);
  run(s.w, 6);
  const p = s.sling.pouch();
  assert.ok(Math.hypot(p.x - REST.x, p.y - REST.y) < 18, `pouch did not settle: ${p.x - REST.x}, ${p.y - REST.y}`);
});

test('the band can be reloaded after a shot', () => {
  const s = shoot(1, 120);
  const again = BUG(1);
  run(s.w, 2);
  s.sling.load(again);
  assert.equal(s.sling.state, 'loaded');
  let fired = false;
  s.sling.onLaunch = () => { fired = true; };
  s.sling.aim(REST.x - 120, REST.y + 80);
  run(s.w, 0.3);
  assert.equal(s.sling.release(), true);
  run(s.w, 0.6);
  assert.ok(fired);
});

test('the aiming preview predicts the real launch', () => {
  const s = setup();
  const px = REST.x - 150, py = REST.y + 70;
  const predicted = s.sling.previewLaunch(s.bug, px, py);
  s.sling.aim(px, py);
  run(s.w, 0.8);
  s.sling.release();
  run(s.w, 0.6);
  const real = s.launched();
  const speed = Math.hypot(real.vx, real.vy);
  near(Math.hypot(predicted.vx, predicted.vy), speed, speed * 0.03, 'launch speed');
  near(Math.atan2(predicted.vy, predicted.vx), Math.atan2(real.vy, real.vx), 0.03, 'launch angle');
});

test('the flight path helper matches a real flight, drag included', () => {
  const w = new World({ gravity: G });
  const b = w.add(new Body({ shape: circle(24), x: 0, y: 0, vx: 600, vy: -500, airDrag: 1 / 9000 }));
  const path = flightPath({ x: 0, y: 0, vx: 600, vy: -500, airDrag: 1 / 9000, gravity: G, seconds: 2, every: 0.5 });
  run(w, 2);
  const end = path.at(-1);
  near(end.x, b.x, 0.5, 'x');
  near(end.y, b.y, 0.5, 'y');
  assert.equal(path.length, 5);
});

test('air drag shortens the range compared with a pure parabola', () => {
  const drag = flightPath({ x: 0, y: 0, vx: 600, vy: -600, airDrag: 1 / 5000, gravity: G, seconds: 2.4, every: 2.4 }).at(-1);
  const pure = flightPath({ x: 0, y: 0, vx: 600, vy: -600, airDrag: 0, gravity: G, seconds: 2.4, every: 2.4 }).at(-1);
  near(pure.x, 600 * 2.4, 2, 'no drag keeps its speed');
  assert.ok(drag.x < pure.x - 40, `drag barely matters: ${drag.x} vs ${pure.x}`);
});
