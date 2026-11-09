// Brute-force level solver. Tries random shots through the real game rules and keeps the best
// sequence it finds, so "this level can be beaten" is something we prove rather than assume.
//
//   node tools/solve.mjs                 solve every level and write test/solutions.json
//   node tools/solve.mjs queen popper    only those levels, merged into the existing file
//   node tools/solve.mjs --tries=400     try harder (random shots per decision)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GameSim } from '../src/game/sim.js';
import { LEVELS } from '../src/game/levels.js';
import { BUGS } from '../src/game/catalog.js';
import { replay } from './replay.mjs';

const OUT = new URL('../test/solutions.json', import.meta.url);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x, d = 2) => +x.toFixed(d);

/** Places worth firing silk at, taken from the level itself. */
function silkTargets(def) {
  const sim = new GameSim(def);
  const out = [];
  for (const b of sim.world.bodies) {
    const kind = b.ent?.kind;
    if (kind === 'branch') {
      const half = b.shape.w / 2;
      for (let u = -0.9; u <= 0.9; u += 0.2) out.push({ x: b.x + half * u, y: b.y + b.shape.h / 2 });
    } else if (!b.isStatic) {
      out.push({ x: b.x, y: b.y });
    }
  }
  return out;
}

function randomShot(type, targets, r) {
  const shot = {
    deg: round(-8 + r() * 92),
    pull: [170, 170, 170, 155, 140, 120, 100][Math.floor(r() * 7)],
  };
  const ability = BUGS[type].ability;
  if (!ability || r() < 0.15) return shot;
  if (ability === 'silk') {
    const t = targets[Math.floor(r() * targets.length)];
    if (t) shot.ability = { after: round(0.05 + r() * 1.4), x: round(t.x), y: round(t.y), releaseAfter: round(0.2 + r() * 1.6) };
  } else {
    shot.ability = { after: round(0.1 + r() * 2.1) };
  }
  return shot;
}

const worth = result =>
  result.state === 'won' ? 1e9 - result.shots * 1e7 + result.score : -result.targets * 1e6 + result.score;

function solveLevel(def, triesPerShot, restarts) {
  const targets = silkTargets(def);
  let best = null;
  for (let restart = 0; restart < restarts; restart++) {
    const r = rng(((restart + 1) * 7919) ^ hash(def.id));
    const shots = [];
    let last = null;
    for (let k = 0; k < def.bugs.length; k++) {
      let bestShot = null, bestResult = null;
      for (let i = 0; i < triesPerShot; i++) {
        const shot = randomShot(def.bugs[k], targets, r);
        const result = replay(def, [...shots, shot]);
        if (!bestResult || worth(result) > worth(bestResult)) {
          bestShot = shot;
          bestResult = result;
        }
        if (result.state === 'won' && result.shots <= def.par) break;
      }
      shots.push(bestShot);
      last = bestResult;
      if (last.state === 'won') break;
    }
    if (last?.state === 'won' && (!best || last.shots < best.result.shots || (last.shots === best.result.shots && last.score > best.result.score))) {
      best = { shots: [...shots], result: last };
    }
    if (best && best.result.shots <= def.par) break;
  }
  return best;
}

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const here = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const childIndex = args.indexOf('--child');
const tries = Number(args.find(a => a.startsWith('--tries='))?.slice(8) ?? 160);
const restarts = Number(args.find(a => a.startsWith('--restarts='))?.slice(11) ?? 6);

if (childIndex >= 0) {
  const def = LEVELS.find(l => l.id === args[childIndex + 1]);
  const found = solveLevel(def, tries, restarts);
  process.stdout.write(JSON.stringify({ id: def.id, found }));
} else {
  const wanted = args.filter(a => !a.startsWith('--'));
  const defs = wanted.length ? LEVELS.filter(l => wanted.includes(l.id)) : LEVELS;
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const limit = Math.max(2, Math.min(defs.length, os.cpus().length - 2));
  let cursor = 0, running = 0;
  const report = [];
  await new Promise(resolve => {
    const launch = () => {
      while (running < limit && cursor < defs.length) {
        const def = defs[cursor++];
        running++;
        const started = Date.now();
        const child = spawn(process.execPath, [here, '--child', def.id, `--tries=${tries}`, `--restarts=${restarts}`]);
        let data = '';
        child.stdout.on('data', chunk => (data += chunk));
        child.stderr.on('data', chunk => process.stderr.write(chunk));
        child.on('close', () => {
          running--;
          const seconds = ((Date.now() - started) / 1000).toFixed(0);
          try {
            const { found } = JSON.parse(data);
            if (found) {
              results[def.id] = { shots: found.shots, score: found.result.score };
              report.push(`${def.id.padEnd(16)} solved in ${found.result.shots} (par ${def.par}, ${def.bugs.length} bugs) score ${found.result.score}  ${seconds}s`);
            } else {
              report.push(`${def.id.padEnd(16)} NOT SOLVED (par ${def.par}, ${def.bugs.length} bugs)  ${seconds}s`);
            }
          } catch {
            report.push(`${def.id.padEnd(16)} solver crashed`);
          }
          console.log(report.at(-1));
          if (cursor >= defs.length && running === 0) resolve();
          else launch();
        });
      }
    };
    launch();
  });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
}
