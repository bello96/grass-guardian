// Plays a list of shots through the real game rules, exactly as a player's input would arrive.
// A shot is { deg, pull, ability? } where ability is { after, x?, y? }: seconds after launch,
// plus a tapped world point for the bugs that aim their ability.

import { GameSim } from '../src/game/sim.js';

const FRAME = 1 / 60;
const AIM_SECONDS = 0.25;

export function pullPoint(sim, deg, pull) {
  const a = (deg * Math.PI) / 180;
  const r = sim.sling.rest;
  return { x: r.x - Math.cos(a) * pull, y: r.y + Math.sin(a) * pull };
}

function advance(sim, seconds) {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) sim.update(FRAME);
}

function advanceUntil(sim, pred, limit = 60) {
  for (let i = 0; i < limit / FRAME; i++) {
    if (pred()) return true;
    sim.update(FRAME);
  }
  return pred();
}

const isDone = sim => sim.state === 'won' || sim.state === 'lost';

/** Fires one shot and runs until the game wants another or has ended. */
export function playShot(sim, shot) {
  if (!advanceUntil(sim, () => sim.state === 'ready' || isDone(sim))) return;
  if (isDone(sim)) return;
  sim.beginAim();
  const p = pullPoint(sim, shot.deg, shot.pull);
  sim.aim(p.x, p.y);
  advance(sim, AIM_SECONDS);
  if (!sim.releaseAim()) return;
  if (!advanceUntil(sim, () => sim.state !== 'launching', 3)) return;
  if (shot.ability) {
    let t = 0;
    while (t < shot.ability.after && sim.state === 'flying') {
      sim.update(FRAME);
      t += FRAME;
    }
    if (sim.state === 'flying') {
      const bug = sim.active;
      const x = shot.ability.x ?? bug?.x ?? 0;
      const y = shot.ability.y ?? bug?.y ?? 0;
      sim.useAbility(x, y);
      if (shot.ability.releaseAfter !== undefined && sim.silk) {
        advance(sim, shot.ability.releaseAfter);
        if (sim.silk) sim.useAbility(0, 0);
      }
    }
  }
  advanceUntil(sim, () => sim.state === 'ready' || isDone(sim));
}

export function replay(def, shots) {
  const sim = new GameSim(def);
  for (const shot of shots) {
    if (isDone(sim)) break;
    playShot(sim, shot);
  }
  advanceUntil(sim, () => isDone(sim) || sim.state === 'ready', 10);
  return { state: sim.state, shots: sim.shots, targets: sim.targetsLeft(), score: sim.score, stars: sim.stars };
}
