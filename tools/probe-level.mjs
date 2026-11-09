// Fires many random full-power shots at one level and reports what they achieve, to show why a
// level is too hard or too easy.   node tools/probe-level.mjs <level-id> [shots]
import { GameSim } from '../src/game/sim.js';
import { LEVELS } from '../src/game/levels.js';
import { playShot } from './replay.mjs';

const def = LEVELS.find(l => l.id === process.argv[2]);
const count = Number(process.argv[3] ?? 200);
if (!def) throw new Error(`no level ${process.argv[2]}`);

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

const kills = new Map();
let bestShot = null, bestKills = -1, ropeCuts = 0;
const start = new GameSim(def);
const total = start.targetsLeft();
for (let i = 0; i < count; i++) {
  const shot = { deg: +(-8 + rnd() * 92).toFixed(2), pull: [170, 170, 150, 125][Math.floor(rnd() * 4)] };
  const sim = new GameSim(def);
  playShot(sim, shot);
  const k = total - sim.targetsLeft();
  kills.set(k, (kills.get(k) ?? 0) + 1);
  if (sim.ropes.some(r => r.isBroken())) ropeCuts++;
  if (k > bestKills) {
    bestKills = k;
    bestShot = shot;
  }
}
console.log(`${def.id}: ${total} termites, ${count} random shots`);
console.log('kills per shot:', [...kills.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join('  '));
console.log('shots that cut a rope:', ropeCuts);
console.log('best shot:', JSON.stringify(bestShot), 'killed', bestKills);

// Replays the best shot, printing where everything ended up.
const sim = new GameSim(def);
playShot(sim, bestShot);
console.log('after best shot: state', sim.state, 'score', sim.score);
for (const t of sim.termites) console.log(`  termite ${t.ent.type} at x=${t.x | 0} h=${-t.y | 0} hp=${t.ent.hp.toFixed(2)}`);
