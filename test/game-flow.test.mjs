// Bad moments in a turn: tapping instead of dragging, the system taking the gesture away, the last
// termite dying at an awkward time. Each of these used to cost the player a bug or a win.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim } from '../src/game/sim.js';
import { TITLE_LEVEL } from '../src/game/title.js';
import { Save } from '../src/game/save.js';
import { playShot } from '../tools/replay.mjs';

const SLING = { x: 300, h: 140 };
const level = (build, o = {}) => ({
  id: 'test', name: '测试', width: 2400, par: 1, bugs: ['roly', 'roly'], sling: SLING, build, ...o,
});
const advance = (sim, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.update(1 / 60);
};
const advanceUntil = (sim, pred, max = 30) => {
  for (let i = 0; i < max * 60; i++) {
    if (pred()) return true;
    sim.update(1 / 60);
  }
  return pred();
};
const ready = sim => assert.ok(advanceUntil(sim, () => sim.state === 'ready'), `stuck in ${sim.state}`);
const oneTermite = b => b.termite(900, 0);

/* ---------- events reach the screen under their own names ---------- */

test('every event a turn produces keeps the name it was emitted with', () => {
  const sim = new GameSim(level(oneTermite));
  const t = sim.termites[0];
  playShot(sim, { deg: 12, pull: 170 });
  if (sim.targetsLeft() > 0) sim.killTermite(t, 'hit');
  advanceUntil(sim, () => sim.state === 'won');
  const names = new Set(sim.events.map(e => e.type));
  for (const name of ['hop', 'seated', 'release', 'launch', 'kill', 'won']) {
    assert.ok(names.has(name), `no "${name}" event, got: ${[...names].join(' ')}`);
  }
  assert.ok(!names.has('roly') && !names.has('worker'), 'a payload overwrote an event name');
});

test('a retiring bug reports its own event', () => {
  const sim = new GameSim(level(oneTermite));
  playShot(sim, { deg: 80, pull: 170 });
  assert.ok(sim.events.some(e => e.type === 'retire'), 'no retire event');
});

test('events still say which bug or termite they are about', () => {
  const sim = new GameSim(level(b => b.termite(900, 0, 'queen'), { bugs: ['clicker', 'roly'] }));
  sim.killTermite(sim.termites[0], 'hit');
  assert.equal(sim.events.find(e => e.type === 'kill').who, 'queen');
  assert.equal(sim.events.find(e => e.type === 'hop').who, 'clicker');
});

test('a hit that only hurts a termite announces it', () => {
  const sim = new GameSim(level(oneTermite));
  sim.damageBody(sim.termites[0], 0.2);
  const hurt = sim.events.find(e => e.type === 'hurt');
  assert.ok(hurt, 'no hurt event');
  assert.equal(hurt.who, 'worker');
});

/* ---------- a press that was not really a pull ---------- */

test('pressing the bug and letting go does not fire it', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  const b = sim.sling.body;
  assert.equal(sim.beginAim(), true);
  sim.aim(b.x, b.y);
  advance(sim, 0.1);
  assert.equal(sim.releaseAim(), false);
  assert.equal(sim.state, 'ready');
  assert.equal(sim.shots, 0);
});

test('a heavy bug that sags below the fork does not fire on a tap either', () => {
  const sim = new GameSim(level(oneTermite, { bugs: ['stag', 'stag'] }));
  ready(sim);
  advance(sim, 1.5);
  const b = sim.sling.body;
  const sag = Math.hypot(b.x - sim.sling.rest.x, b.y - sim.sling.rest.y);
  assert.ok(sag > sim.sling.minPull, `this test needs a sag past minPull, got ${sag}`);
  assert.equal(sim.beginAim(), true);
  sim.aim(b.x, b.y);
  advance(sim, 0.1);
  assert.equal(sim.releaseAim(), false);
  assert.equal(sim.shots, 0);
});

test('a real pull still fires', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  const r = sim.sling.rest;
  assert.equal(sim.beginAim(), true);
  sim.aim(r.x - 120, r.y + 40);
  advance(sim, 0.2);
  assert.equal(sim.releaseAim(), true);
  assert.equal(sim.shots, 1);
});

/* ---------- the gesture is taken away ---------- */

test('cancelling an aim fires nothing and hands the bug back', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  const r = sim.sling.rest;
  sim.beginAim();
  sim.aim(r.x - 160, r.y + 40);
  advance(sim, 0.25);
  assert.equal(sim.cancelAim(), true);
  assert.equal(sim.state, 'ready');
  assert.equal(sim.shots, 0);
  assert.ok(!sim.events.some(e => e.type === 'release'), 'a cancel must not twang the sling');

  advance(sim, 2.5);
  assert.equal(sim.state, 'ready', 'the band must not throw the bug off');
  const b = sim.sling.body;
  assert.ok(Math.hypot(b.x - r.x, b.y - r.y) < 30, 'bug did not settle back on the sling');

  assert.equal(sim.beginAim(), true, 'the same bug can be aimed again');
  sim.aim(r.x - 160, r.y + 40);
  advance(sim, 0.25);
  assert.equal(sim.releaseAim(), true);
  assert.equal(sim.shots, 1);
});

test('cancelling when nothing is being aimed does nothing', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  assert.equal(sim.cancelAim(), false);
  assert.equal(sim.state, 'ready');
});

/* ---------- the last termite dies at an awkward moment ---------- */

test('once the last termite is gone a seated bug cannot be fired', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  sim.killTermite(sim.termites[0], 'hit');
  assert.equal(sim.beginAim(), false);
  assert.ok(advanceUntil(sim, () => sim.state === 'won', 3));
  assert.equal(sim.shots, 0);
  assert.equal(sim.stars, 3);
});

test('letting go in the moment after the last termite dies does not spend a shot', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  const r = sim.sling.rest;
  sim.beginAim();
  sim.aim(r.x - 160, r.y + 40);
  advance(sim, 0.2);
  sim.killTermite(sim.termites[0], 'hit');
  assert.equal(sim.releaseAim(), false);
  assert.equal(sim.shots, 0);
  assert.ok(advanceUntil(sim, () => sim.state === 'won', 3));
  assert.equal(sim.events.filter(e => e.type === 'won').length, 1, 'won twice');
});

test('winning while the player is still holding a pull leaves the game won', () => {
  const sim = new GameSim(level(oneTermite));
  ready(sim);
  const r = sim.sling.rest;
  sim.beginAim();
  sim.aim(r.x - 160, r.y + 40);
  advance(sim, 0.2);
  sim.killTermite(sim.termites[0], 'hit');
  assert.ok(advanceUntil(sim, () => sim.state === 'won', 3));
  assert.equal(sim.releaseAim(), false);
  advance(sim, 1);
  assert.equal(sim.state, 'won');
  assert.equal(sim.shots, 0);
});

/* ---------- the title screen ---------- */

test('a title letter flung off the world stays in the title', () => {
  const sim = new GameSim(TITLE_LEVEL);
  const tags = sim.bodiesOfKind('tag');
  assert.equal(tags.length, 4);
  const letter = tags[3];
  letter.x = sim.width + 5000;
  letter.updateWorld();
  advance(sim, 0.2);
  assert.equal(sim.bodiesOfKind('tag').length, 4);
});

/* ---------- saved progress ---------- */

function withStorage(raw, fn) {
  const stub = { getItem: () => raw, setItem() {} };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
  try {
    fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}

for (const raw of ['{"stars":null}', '{"best":null}', '{"stars":[1],"best":"x","muted":"yes"}', '{"stars":{"a":3},"best":7}']) {
  test(`a save holding ${raw} still loads and can record a win`, () => {
    withStorage(raw, () => {
      const save = new Save();
      assert.equal(save.stars('nothing'), 0);
      assert.equal(save.best('nothing'), 0);
      assert.equal(typeof save.totalStars(), 'number');
      assert.equal(save.recordWin('first-hit', 2, 100), true);
      assert.equal(save.stars('first-hit'), 2);
    });
  });
}

test('a good save keeps its contents', () => {
  withStorage('{"stars":{"a":3},"best":{"a":900},"muted":true}', () => {
    const save = new Save();
    assert.equal(save.stars('a'), 3);
    assert.equal(save.best('a'), 900);
    assert.equal(save.muted, true);
  });
});
