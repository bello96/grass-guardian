// Silk ropes: they pull but never push, stiffen then give, can be read and can break.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Body, Rope, circle, box } from '../src/physics/index.js';

const G = 500;
const near = (actual, expected, tol, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} ±${tol}, got ${actual}`);
const run = (w, seconds, each) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    w.step(1 / 60);
    each?.(i / 60);
  }
};

function hang({ length = 300, bodyY, radius = 10, density = 2, rope = {} } = {}) {
  const w = new World({ gravity: G });
  const b = w.add(new Body({ shape: circle(radius), x: 0, y: bodyY ?? length, density, noSleep: true }));
  const r = w.addConstraint(new Rope({
    from: { x: 0, y: 0 },
    to: { body: b, lx: 0, ly: 0 },
    length,
    load: b.m * G,
    ...rope,
  }));
  return { w, b, r };
}

test('a hung body settles with a small stretch and rope tension equal to the weight it carries', () => {
  const { w, b, r } = hang();
  run(w, 30);
  const stretch = (b.y - 300) / 300;
  assert.ok(stretch > 0 && stretch < 0.06, `stretch ${stretch}`);
  // The body plus the three free rope nodes hang from the top segment: read it by hand.
  const carried = (b.m + 3 * r.nodeMass) * G;
  near(r.tensions[0], carried, carried * 0.02, 'top tension');
  near(r.tensions[3], b.m * G, b.m * G * 0.02, 'bottom tension');
});

test('a slack rope pulls nothing, so a lifted body is in plain free fall until it goes taut', () => {
  const { w, b, r } = hang({ bodyY: 50 });
  let fell = 0, dropped = 0;
  for (let i = 0; i < 60; i++) {
    w.step(1 / 60);
    if (b.y > 290) break;
    fell = (i + 1) / 60;
    dropped = b.y - 50;
    // Until the upper nodes reach full length the rope is slack throughout: exactly no force.
    if (fell < 0.6) assert.equal(r.tensions[3], 0, `force at t=${fell}`);
  }
  near(dropped, 0.5 * G * fell * fell, 3, 'free fall distance');
});

test('tension rises steeply then flattens: three times the strain gives far less than three times the force', () => {
  const measure = strain => {
    const w = new World({ gravity: 0 });
    const b = w.add(new Body({ shape: circle(10), x: 0, y: 300 * (1 + strain), isStatic: true }));
    const r = w.addConstraint(new Rope({ from: { x: 0, y: 0 }, to: { body: b, lx: 0, ly: 0 }, length: 300, load: 1000 }));
    run(w, 3);
    return r.tensions[0];
  };
  const low = measure(0.2), high = measure(0.6);
  assert.ok(low > 0, 'no tension at 20% strain');
  assert.ok(high > low, 'tension must keep rising');
  assert.ok(high < 2 * low, `saturation missing: ${low} then ${high}`);
});

test('a hung ball swings with the period of a pendulum of that length', () => {
  const { w, b } = hang();
  run(w, 20);
  const restY = b.y, L = restY;
  b.vx = 120;
  const crossings = [];
  let prev = b.x, t = 0;
  for (let i = 0; i < 60 * 14; i++) {
    w.step(1 / 60);
    t += 1 / 60;
    if (prev < 0 && b.x >= 0) crossings.push(t);
    prev = b.x;
  }
  assert.ok(crossings.length >= 2, 'never completed a swing');
  const period = crossings[1] - crossings[0];
  near(period, 2 * Math.PI * Math.sqrt(L / G), 0.25, 'period');
});

test('a swing dies away rather than ringing forever or gaining energy', () => {
  const { w, b } = hang();
  run(w, 20);
  b.vx = 200;
  let early = 0, late = 0;
  run(w, 30, t => {
    if (t < 6) early = Math.max(early, Math.abs(b.x));
    if (t > 24) late = Math.max(late, Math.abs(b.x));
  });
  assert.ok(early > 20, `barely swung: ${early}`);
  assert.ok(late < early * 0.7, `not losing energy: ${early} then ${late}`);
});

test('a rope tied to a corner hangs the box with its centre under the anchor', () => {
  const w = new World({ gravity: G });
  const shape = box(80, 40);
  const b = w.add(new Body({ shape, x: 0, y: 340, density: 1 }));
  w.addConstraint(new Rope({ from: { x: 0, y: 0 }, to: { body: b, lx: 40, ly: -20 }, length: 300, load: b.m * G }));
  run(w, 60);
  near(b.x, 0, 3, 'centre below anchor');
  const corner = b.localToWorld(40, -20);
  near(corner.x, 0, 3, 'tied corner below anchor');
});

test('stretching then letting go throws the body back past where it hangs', () => {
  const { w, b, r } = hang();
  run(w, 20);
  const restY = b.y;
  // Hold the body far below rest, as a player's hand would.
  const hand = { y: restY + 170 };
  b.y = hand.y;
  b.vy = 0;
  run(w, 0.02);
  b.y = hand.y;
  b.vy = 0;
  let top = Infinity;
  run(w, 4, () => { top = Math.min(top, b.y); });
  assert.ok(top < restY - 40, `no recoil past rest: top ${top}, rest ${restY}`);
});

test('a hard enough catch snaps the rope and the body keeps falling', () => {
  const { w, b, r } = hang({ bodyY: 10, rope: { breakForce: 2.2 * 2 * (Math.PI * 100 / 1000) * G } });
  let snapped = null;
  r.onBreak = i => { snapped = i; };
  run(w, 1.5);
  assert.ok(r.isBroken(), 'rope should have snapped');
  assert.notEqual(snapped, null, 'break was not reported');
  assert.ok(b.y > 330, `body stopped by a broken rope: y=${b.y}`);
});

test('a gentle hang does not reach that limit', () => {
  const { w, r } = hang({ rope: { breakForce: 2.2 * 2 * (Math.PI * 100 / 1000) * G } });
  run(w, 10);
  assert.ok(!r.isBroken());
});

test('cutting a rope drops a sleeping body', () => {
  const { w, b, r } = hang();
  run(w, 20);
  w.putToSleep([b]);
  const y0 = b.y;
  r.cut(1);
  run(w, 1);
  assert.ok(b.y > y0 + 200, `body did not fall: ${b.y - y0}`);
});

test('the cut end stays attached to what it was tied to, so both pieces dangle', () => {
  const { w, r } = hang();
  run(w, 5);
  r.cut(2);
  run(w, 5);
  const pieces = r.polylines();
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].length >= 2 && pieces[1].length >= 2);
  near(pieces[0][0].x, 0, 1e-9, 'first piece keeps the anchor');
  near(pieces[0][0].y, 0, 1e-9, 'first piece keeps the anchor');
});

test('a segment reports being crossed by a moving circle', () => {
  const { w, r } = hang();
  run(w, 5);
  assert.notEqual(r.segmentNear(0, 150, 15), -1, 'circle on the rope should hit it');
  assert.equal(r.segmentNear(100, 150, 15), -1, 'circle far away should not');
});

test('hanging a dynamic body from another dynamic body shares the load', () => {
  const w = new World({ gravity: G });
  const top = w.add(new Body({ shape: box(100, 30), x: 0, y: 0, isStatic: true }));
  const mid = w.add(new Body({ shape: circle(10), x: 0, y: 100, density: 2, noSleep: true }));
  const low = w.add(new Body({ shape: circle(10), x: 0, y: 200, density: 2, noSleep: true }));
  const load = (mid.m + low.m) * G;
  w.addConstraint(new Rope({ from: { body: top, lx: 0, ly: 0 }, to: { body: mid, lx: 0, ly: 0 }, length: 100, load }));
  const lower = w.addConstraint(new Rope({ from: { body: mid, lx: 0, ly: 0 }, to: { body: low, lx: 0, ly: 0 }, length: 100, load: low.m * G }));
  run(w, 15);
  near(lower.tensions[0], low.m * G + 3 * lower.nodeMass * G, low.m * G * 0.03, 'lower rope tension');
  assert.ok(low.y > mid.y && mid.y > 100, 'chain order kept');
});

test('a grabbed body follows the hand, and letting go throws it at the speed of the hand', async () => {
  const { Pin } = await import('../src/physics/index.js');
  const w = new World({ gravity: G });
  const b = w.add(new Body({ shape: box(80, 80), x: 0, y: 300, noSleep: true }));
  w.addConstraint(new Rope({ from: { x: 0, y: 0 }, to: { body: b, lx: 0, ly: -40 }, length: 260, load: b.m * G }));
  const pin = w.addConstraint(new Pin(b, 0, 0, 0, 300));
  // The hand sweeps sideways at a steady 400 units per second.
  for (let i = 0; i < 30; i++) {
    pin.moveTo((i / 60) * 400, 300);
    w.step(1 / 60);
  }
  near(b.x, 29 / 60 * 400, 12, 'body keeps up with the hand');
  w.removeConstraint(pin);
  near(b.vx, 400, 40, 'speed at release');
});

test('grabbing away from the centre makes a body turn', async () => {
  const { Pin } = await import('../src/physics/index.js');
  const w = new World({ gravity: 0 });
  const b = w.add(new Body({ shape: box(100, 100), x: 0, y: 0, noSleep: true }));
  const pin = w.addConstraint(new Pin(b, 40, 0, 40, 0));
  for (let i = 0; i < 30; i++) {
    pin.moveTo(40, (i / 60) * 300);
    w.step(1 / 60);
  }
  assert.ok(Math.abs(b.a) > 0.3, `body barely turned: ${b.a}`);
});
