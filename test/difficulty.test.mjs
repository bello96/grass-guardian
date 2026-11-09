// The difficulty tool itself. A full run takes half an hour, so this only checks that a modelled
// player can get through a level, and that bad hands really are worse than good ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.js';
import { TIERS, playLevel } from '../tools/difficulty.mjs';

const firstLevel = LEVELS[0];

test('a modelled player finishes a level and reports the result', () => {
  const result = playLevel(firstLevel, TIERS.direct, 1);
  assert.equal(result.total, 1);
  assert.equal(typeof result.won, 'boolean');
  assert.ok(result.shots >= 1 && result.shots <= firstLevel.bugs.length);
  assert.equal(result.record.length, result.shots);
});

test('the same seed plays the same game', () => {
  assert.deepEqual(playLevel(firstLevel, TIERS.direct, 7), playLevel(firstLevel, TIERS.direct, 7));
});

test('a shot through unsteady hands differs from what was intended, a full pull does not', () => {
  const steady = playLevel(firstLevel, { ...TIERS.direct, deg: 0, pull: 0 }, 3);
  const shaky = playLevel(firstLevel, { ...TIERS.direct, deg: 4, pull: 20 }, 3);
  assert.notEqual(shaky.record[0].deg, steady.record[0].deg);
  assert.equal(shaky.record[0].pull, steady.record[0].pull);
});
