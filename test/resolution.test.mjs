import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionGovernor } from '../src/render/resolution.js';

/** Feeds this many seconds of frames at a steady rate. */
function run(governor, fps, seconds) {
  for (let i = 0; i < fps * seconds; i++) governor.observe(1 / fps);
}

test('a device holding 60 fps stays at full resolution', () => {
  const g = new ResolutionGovernor();
  run(g, 60, 30);
  assert.equal(g.limit, 2);
});

test('a 120 Hz screen stays at full resolution', () => {
  const g = new ResolutionGovernor();
  run(g, 120, 30);
  assert.equal(g.limit, 2);
});

test('a device stuck at 30 fps steps down, one step at a time', () => {
  const g = new ResolutionGovernor();
  run(g, 30, 2);
  assert.equal(g.limit, 1.5);
  run(g, 30, 2);
  assert.equal(g.limit, 1);
});

test('resolution never drops below one canvas pixel per CSS pixel', () => {
  const g = new ResolutionGovernor();
  run(g, 15, 60);
  assert.equal(g.limit, 1);
});

test('observe reports only the frame on which the limit changed', () => {
  const g = new ResolutionGovernor();
  let changes = 0;
  for (let i = 0; i < 30 * 2; i++) if (g.observe(1 / 30)) changes++;
  assert.equal(changes, 1);
});

test('once the lower resolution holds 60 fps it stays where it is', () => {
  const g = new ResolutionGovernor();
  run(g, 30, 2);
  run(g, 60, 30);
  assert.equal(g.limit, 1.5);
});

test('one long stall does not count, such as a level loading or a tab coming back', () => {
  const g = new ResolutionGovernor();
  run(g, 60, 0.5);
  g.observe(2);
  run(g, 60, 1);
  assert.equal(g.limit, 2);
});

test('a brief busy moment does not lower it when the rest of the window was fast', () => {
  const g = new ResolutionGovernor();
  run(g, 60, 1.2);
  for (let i = 0; i < 6; i++) g.observe(0.05);
  run(g, 60, 3);
  assert.equal(g.limit, 2);
});

test('restart forgets slow frames from before a scene change', () => {
  const g = new ResolutionGovernor();
  run(g, 20, 1.2);
  g.restart();
  run(g, 60, 1);
  assert.equal(g.limit, 2);
});

test('it can start from a lower limit', () => {
  const g = new ResolutionGovernor(1.5);
  assert.equal(g.limit, 1.5);
  run(g, 30, 2);
  assert.equal(g.limit, 1);
});
