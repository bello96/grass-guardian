// Rigid-body behaviour the game relies on. y grows downward (screen convention).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Body, circle, box, polygon } from '../src/physics/index.js';

const G = 500;
const near = (actual, expected, tol, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} ±${tol}, got ${actual}`);

const makeWorld = () => new World({ gravity: G });
const addGround = (w, y = 0) =>
  w.add(new Body({ shape: box(8000, 400), x: 0, y: y + 200, isStatic: true, friction: 0.8, restitution: 0 }));
const run = (w, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) w.step(1 / 60); };

test('free fall follows y = g t^2 / 2', () => {
  const w = makeWorld();
  const b = w.add(new Body({ shape: circle(10), x: 0, y: 0 }));
  run(w, 2);
  near(b.y, 0.5 * G * 2 * 2, 2, 'fall distance');
  near(b.vy, G * 2, 0.5, 'fall speed');
});

test('a launched body flies a parabola with range v^2 sin(2a) / g', () => {
  const w = makeWorld();
  const v = 800;
  const a = Math.PI / 4;
  const b = w.add(new Body({ shape: circle(10), x: 0, y: 0, vx: v * Math.cos(a), vy: -v * Math.sin(a) }));
  const flight = (2 * v * Math.sin(a)) / G;
  run(w, flight);
  near(b.x, (v * v) / G, 12, 'range');
  near(b.y, 0, 12, 'back at launch height');
});

test('a dropped ball without bounce comes to rest on the ground, not inside it', () => {
  const w = makeWorld();
  addGround(w);
  const b = w.add(new Body({ shape: circle(20), x: 0, y: -100, restitution: 0 }));
  run(w, 3);
  near(b.y, -20, 0.05, 'rest height');
  near(b.vy, 0, 0.5, 'rest speed');
});

test('restitution 0.5 returns about a quarter of the drop height', () => {
  const w = makeWorld();
  addGround(w);
  const b = w.add(new Body({ shape: circle(20), x: 0, y: -420, restitution: 0.5 }));
  let hit = false, peak = Infinity;
  for (let i = 0; i < 300; i++) {
    w.step(1 / 60);
    if (!hit && b.vy < 0) hit = true;
    if (hit) { peak = Math.min(peak, b.y); if (b.vy > 0) break; }
  }
  assert.ok(hit, 'ball never bounced');
  near(-20 - peak, 400 * 0.25, 8, 'rebound height');
});

test('equal circles with restitution 1 swap velocities and keep momentum', () => {
  const w = new World({ gravity: 0 });
  const a = w.add(new Body({ shape: circle(20), x: -100, y: 0, vx: 300, restitution: 1 }));
  const b = w.add(new Body({ shape: circle(20), x: 100, y: 0, vx: 0, restitution: 1 }));
  run(w, 1);
  near(a.vx, 0, 6, 'striker stops');
  near(b.vx, 300, 6, 'target takes the speed');
  near(a.m * a.vx + b.m * b.vx, a.m * 300, a.m * 2, 'momentum');
});

test('a tall stack of eight boxes stays put for ten seconds', () => {
  const w = makeWorld();
  addGround(w);
  const boxes = [];
  for (let i = 0; i < 8; i++) boxes.push(w.add(new Body({ shape: box(60, 40), x: 0, y: -20 - i * 40, friction: 0.6 })));
  run(w, 10);
  boxes.forEach((b, i) => {
    near(b.x, 0, 0.5, `box ${i} drift`);
    near(b.y, -20 - i * 40, 1, `box ${i} sink`);
    near(b.a, 0, 0.01, `box ${i} tilt`);
  });
});

test('a heavy slab on thin posts neither sinks through nor collapses', () => {
  const w = makeWorld();
  addGround(w);
  const left = w.add(new Body({ shape: box(16, 110), x: -60, y: -55, density: 0.5, friction: 0.6 }));
  const right = w.add(new Body({ shape: box(16, 110), x: 60, y: -55, density: 0.5, friction: 0.6 }));
  const slab = w.add(new Body({ shape: box(170, 40), x: 0, y: -130, density: 3, friction: 0.6 }));
  run(w, 10);
  near(left.x, -60, 1, 'left post');
  near(right.x, 60, 1, 'right post');
  near(slab.y, -130, 1.5, 'slab height');
});

test('static friction holds a box on a slope shallower than its friction angle', () => {
  const w = makeWorld();
  const angle = 0.3; // tan = 0.309
  w.add(new Body({ shape: box(2000, 100), x: 0, y: 0, angle: -angle, isStatic: true, friction: 0.8 }));
  const sinA = Math.sin(angle), cosA = Math.cos(angle);
  // Sit the box exactly on the upper face, which is rotated by -angle.
  const b = w.add(new Body({ shape: box(60, 40), x: -70 * sinA, y: -70 * cosA, angle: -angle, friction: 0.8 }));
  const x0 = b.x;
  run(w, 4);
  near(b.x, x0, 2, 'creep along slope');
});

test('kinetic friction lets a box slide down a steep slope at g(sin - mu cos)', () => {
  const w = makeWorld();
  const angle = 0.6;
  const mu = 0.2;
  w.add(new Body({ shape: box(6000, 100), x: 0, y: 0, angle, isStatic: true, friction: mu }));
  const sinA = Math.sin(angle), cosA = Math.cos(angle);
  const b = w.add(new Body({ shape: box(60, 40), x: 70 * sinA, y: -70 * cosA, angle, friction: mu }));
  const x0 = b.x, y0 = b.y;
  run(w, 1.5);
  const travelled = Math.hypot(b.x - x0, b.y - y0);
  const expected = 0.5 * G * (Math.sin(angle) - mu * Math.cos(angle)) * 1.5 * 1.5;
  near(travelled, expected, expected * 0.12, 'slide distance');
});

test('a fast ball cannot tunnel through a thin wall', () => {
  const w = new World({ gravity: 0 });
  w.add(new Body({ shape: box(10, 400), x: 200, y: 0, isStatic: true }));
  const b = w.add(new Body({ shape: circle(10), x: 0, y: 0, vx: 1500, restitution: 0 }));
  run(w, 1);
  assert.ok(b.x < 200, `ball passed the wall, x=${b.x}`);
});

test('a ball hitting the top of a tall post knocks it flat', () => {
  const w = makeWorld();
  addGround(w);
  const post = w.add(new Body({ shape: box(16, 120), x: 0, y: -60, density: 0.5, friction: 0.7 }));
  w.add(new Body({ shape: circle(24), x: -200, y: -110, vx: 700, density: 1, friction: 0.5 }));
  run(w, 4);
  const lying = Math.abs(Math.abs(Math.sin(post.a)) - 1) < 0.05;
  assert.ok(lying, `post angle ${post.a} is not lying flat`);
  near(post.y, -8, 2, 'post rests on its side');
});

test('a sliding ball spins up until it rolls without slipping', () => {
  const w = makeWorld();
  addGround(w);
  const r = 24;
  const b = w.add(new Body({ shape: circle(r), x: 0, y: -r, vx: 300, friction: 0.5 }));
  run(w, 2);
  assert.ok(b.vx > 100, `lost too much speed: ${b.vx}`);
  near(b.w * r, b.vx, 3, 'rolling condition v = w r');
});

test('a settled stack goes to sleep and a later hit wakes it', () => {
  const w = makeWorld();
  addGround(w);
  const bottom = w.add(new Body({ shape: box(60, 40), x: 0, y: -20 }));
  const top = w.add(new Body({ shape: box(60, 40), x: 0, y: -60 }));
  run(w, 3);
  assert.ok(bottom.asleep && top.asleep, 'stack should be asleep');
  w.add(new Body({ shape: circle(20), x: -200, y: -25, vx: 800, density: 2 }));
  run(w, 1);
  assert.ok(!bottom.asleep || bottom.x > 5, 'hit did not wake the stack');
  assert.ok(bottom.x > 5, `bottom box did not move: ${bottom.x}`);
});

test('removing a support wakes what was resting on it', () => {
  const w = makeWorld();
  addGround(w);
  const bottom = w.add(new Body({ shape: box(60, 40), x: 0, y: -20 }));
  const top = w.add(new Body({ shape: box(60, 40), x: 0, y: -60 }));
  run(w, 3);
  assert.ok(top.asleep);
  w.remove(bottom);
  run(w, 1);
  near(top.y, -20, 1, 'top box dropped to the ground');
});

test('an impact reports about m_eff * dv and a resting contact reports nearly nothing', () => {
  const w = makeWorld();
  addGround(w);
  const b = w.add(new Body({ shape: circle(20), x: 0, y: -520, restitution: 0 }));
  const seen = [];
  w.onImpact = imp => seen.push(imp);
  run(w, 3);
  const impactSpeed = Math.sqrt(2 * G * 500);
  const biggest = Math.max(...seen.map(i => i.impulse));
  near(biggest, b.m * impactSpeed, b.m * impactSpeed * 0.1, 'impact impulse');
  const last = seen.at(-1);
  assert.ok(!last || last.impulse < b.m * 10 || b.asleep, 'resting contact should stop reporting big impulses');
});

test('physics is independent of frame rate because the substep is fixed', () => {
  const simulate = fps => {
    const w = makeWorld();
    addGround(w);
    w.add(new Body({ shape: box(60, 40), x: 40, y: -20 }));
    const b = w.add(new Body({ shape: circle(24), x: -200, y: -200, vx: 500, friction: 0.5, restitution: 0.3 }));
    for (let i = 0; i < 3 * fps; i++) w.step(1 / fps);
    return [b.x, b.y, b.a];
  };
  const base = simulate(240);
  for (const fps of [30, 60, 120]) {
    const other = simulate(fps);
    other.forEach((value, i) => near(value, base[i], 1e-6, `${fps}fps`));
  }
});

test('polygons get their centroid at the body origin and correct area', () => {
  const tri = polygon([[0, 0], [90, 0], [0, 60]]);
  near(tri.area, 2700, 1e-6, 'area');
  const cx = tri.verts.reduce((s, v) => s + v.x, 0) / 3;
  const cy = tri.verts.reduce((s, v) => s + v.y, 0) / 3;
  near(cx, 0, 1e-9, 'centroid x');
  near(cy, 0, 1e-9, 'centroid y');
});

test('a triangle wedge rests stably on the ground', () => {
  const w = makeWorld();
  addGround(w);
  const shape = polygon([[-40, 30], [40, 30], [0, -30]]);
  // Centroid sits one third up from the base, so the base is 20 below the origin.
  const b = w.add(new Body({ shape, x: 0, y: -20 }));
  run(w, 3);
  near(b.a, 0, 0.01, 'wedge tilt');
  near(b.y, -20, 0.5, 'wedge height');
});

test('fast collision pairs in the same frame still produce a contact on both shapes', () => {
  const w = makeWorld();
  addGround(w);
  const b = w.add(new Body({ shape: box(80, 20), x: 0, y: -300, angle: 0.5, friction: 0.5 }));
  run(w, 5);
  near(b.y, -10, 0.5, 'plank ended flat on the ground');
  near(Math.abs(Math.sin(b.a)), 0, 0.02, 'plank flat');
});

test('bodies filtered apart never collide', () => {
  const w = makeWorld();
  addGround(w);
  const a = w.add(new Body({ shape: circle(20), x: 0, y: -20, collides: other => other.isStatic }));
  const b = w.add(new Body({ shape: circle(20), x: 0, y: -200, collides: other => other.isStatic }));
  run(w, 2);
  near(a.y, -20, 0.2);
  near(b.y, -20, 0.2);
});
