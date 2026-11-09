// Sound cannot be listened to here, but the two rules that protect the player's ears and the game loop can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { audible, softLimitCurve } from '../src/audio/sfx.js';

/** Runs a signal value through the limiter the way a WaveShaperNode does: scaled, clamped, interpolated. */
function limit(curve, x, range = 2) {
  const u = Math.max(-1, Math.min(1, x / range));
  const at = ((u + 1) / 2) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(at));
  return curve[i] + (curve[i + 1] - curve[i]) * (at - i);
}

test('the limiter leaves ordinary sounds alone', () => {
  const curve = softLimitCurve();
  for (const x of [0, 0.05, 0.2, 0.5, 0.69, -0.3, -0.69]) {
    assert.ok(Math.abs(limit(curve, x) - x) < 0.002, `${x} came out as ${limit(curve, x)}`);
  }
});

test('the limiter never reaches full scale, however loud the input', () => {
  const curve = softLimitCurve();
  for (const x of [1, 1.5, 2, 4, 40, -1, -2, -40]) {
    assert.ok(Math.abs(limit(curve, x)) < 1, `${x} came out as ${limit(curve, x)}`);
  }
});

test('the limiter only bends: louder in always means at least as loud out', () => {
  const curve = softLimitCurve();
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], `curve drops at ${i}`);
});

test('a sound scheduled at zero gain does not reach the ramp that would throw', () => {
  assert.ok(audible(0) > 0);
  assert.equal(audible(0.5), 0.5);
});
