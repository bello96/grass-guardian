// Every shipped level must stand up by itself and must be beatable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameSim } from '../src/game/sim.js';
import { LEVELS, AREAS } from '../src/game/levels.js';
import { BUGS } from '../src/game/catalog.js';
import { replay } from '../tools/replay.mjs';

const solutionsUrl = new URL('./solutions.json', import.meta.url);
const solutions = fs.existsSync(solutionsUrl) ? JSON.parse(fs.readFileSync(solutionsUrl, 'utf8')) : {};

test('level ids are unique and every level belongs to a known area', () => {
  const ids = new Set(LEVELS.map(l => l.id));
  assert.equal(ids.size, LEVELS.length);
  const areas = new Set(AREAS.map(a => a.id));
  for (const l of LEVELS) assert.ok(areas.has(l.area), `${l.id} has unknown area ${l.area}`);
});

for (const def of LEVELS) {
  test(`${def.name}: only uses bugs that exist and has something to hit`, () => {
    for (const type of def.bugs) assert.ok(BUGS[type], `unknown bug ${type}`);
    const sim = new GameSim(def);
    assert.ok(sim.targetsLeft() > 0);
    assert.ok(def.par <= def.bugs.length, 'par needs more bugs than the level gives');
  });

  test(`${def.name}: stands still when woken, with no damage`, () => {
    const sim = new GameSim(def);
    const startScore = sim.score;
    const start = new Map();
    for (const b of sim.world.bodies) {
      if (b.isStatic) continue;
      start.set(b, { x: b.x, y: b.y, a: b.a });
      sim.world.wake(b);
    }
    const count = start.size;
    const termites = sim.targetsLeft();
    for (let i = 0; i < 6 * 60; i++) sim.update(1 / 60);
    assert.equal(sim.score, startScore, 'something broke on its own');
    assert.equal(sim.targetsLeft(), termites, 'a termite died on its own');
    assert.equal(sim.world.bodies.filter(b => !b.isStatic).length, count, 'a body disappeared');
    for (const [b, s] of start) {
      const moved = Math.hypot(b.x - s.x, b.y - s.y);
      const name = `${b.ent.kind}${b.ent.mat ? `:${b.ent.mat}` : ''}`;
      assert.ok(moved < 4, `${name} wandered ${moved.toFixed(2)} from (${s.x}, ${s.y})`);
      assert.ok(Math.abs(b.a - s.a) < 0.08, `${name} at (${s.x}, ${s.y}) tilted ${(b.a - s.a).toFixed(3)}`);
    }
  });

  test(`${def.name}: a recorded solution still wins`, t => {
    const solution = solutions[def.id];
    if (!solution) return t.skip('no recorded solution yet: run node tools/solve.mjs');
    const result = replay(def, solution.shots);
    assert.equal(result.state, 'won', `ended ${result.state} with ${result.targets} termites left`);
    assert.ok(result.shots <= def.bugs.length);
  });
}

// Level 3's tip promises that hitting the bottom brings the upper termites down. Flat shots go into
// the lower floors, and they have to actually pay off, or the tip is a lie.
test('三层小楼: a flat shot at the bottom floors usually brings termites down', () => {
  const def = LEVELS.find(l => l.id === 'three-floors');
  const total = new GameSim(def).targetsLeft();
  let paid = 0, shots = 0;
  for (let deg = 0; deg <= 12; deg += 2) {
    shots++;
    const result = replay(def, [{ deg, pull: 170 }]);
    if (result.targets < total) paid++;
  }
  assert.ok(paid >= shots * 0.6, `only ${paid} of ${shots} flat shots killed anything`);
});

test('蹦一下: bouncing off the mushroom at medium power gets under the eave', () => {
  const def = LEVELS.find(l => l.id === 'bounce');
  const total = new GameSim(def).targetsLeft();
  let paid = 0, shots = 0;
  for (let deg = 30; deg <= 55; deg += 5) {
    shots++;
    if (replay(def, [{ deg, pull: 130 }]).targets < total) paid++;
  }
  assert.ok(paid >= shots * 0.8, `only ${paid} of ${shots} bounces reached a termite`);
});

test('the recorded solutions are not impossibly far from the stated par', () => {
  for (const def of LEVELS) {
    const solution = solutions[def.id];
    if (!solution) continue;
    assert.ok(solution.shots.length <= def.par + 1, `${def.id}: best known ${solution.shots.length}, par ${def.par}`);
  }
});
