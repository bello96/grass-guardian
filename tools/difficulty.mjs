// How hard is each level for a person? solve.mjs aims perfectly and only proves a level can be beaten.
// This plays it with unsteady hands through the real game rules and reports how often that wins.
//
//   node tools/difficulty.mjs                          every level, every kind of player (about half an hour)
//   node tools/difficulty.mjs --levels=queen,bounce    only those levels
//   node tools/difficulty.mjs --tiers=casual,regular   only those players
//   node tools/difficulty.mjs --trials=30 --jobs=6     attempts per level and player, and worker threads.
//                                                      Twelve workers plus a browser ran a 16 GB machine out of memory.
//   node tools/difficulty.mjs --out=results.json       also keep every attempt, including its shots
//   TUNE="worker.threshold=70,soldier.strength=300" node tools/difficulty.mjs   try other numbers
//
// A player differs in two ways:
//   hands:   how far a shot lands from what was intended (angle, pull, ability timing, tap point)
//   insight: how many plausible aimed shots they weigh up (K), imagining each with their own hand
//            noise, so a shot that only works at one exact angle does not look good to them
//
// These are models, not people. Compare levels with each other and look for outliers. The numbers are
// not a prediction of what a real player's win rate will be.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GameSim } from '../src/game/sim.js';
import { LEVELS } from '../src/game/levels.js';
import { BUGS, MATERIALS, TERMITES } from '../src/game/catalog.js';
import { flightPath } from '../src/physics/index.js';
import { playShot, pullPoint } from './replay.mjs';

for (const part of (process.env.TUNE ?? '').split(',').filter(Boolean)) {
  const [key, value] = part.split('=');
  const [name, field] = key.split('.');
  (TERMITES[name] ?? MATERIALS[name] ?? BUGS[name])[field] = Number(value);
}

const here = fileURLToPath(import.meta.url);
const FRAME = 1 / 60;
const MAX_PULL = 170;

export const TIERS = {
  // Aims at the nearest termite on the flattest arc that reaches it, with no thought for what is in the way.
  direct: { plan: 'direct', deg: 1.5, pull: 8, t: 0.13, xy: 28 },
  // Weighs up a few ideas, on a small screen or with little care: a finger on a phone.
  casual: { plan: 'search', K: 6, top: 1, M: 0, deg: 2.5, pull: 14, t: 0.18, xy: 45 },
  // Thinks a little, with a mouse or a careful finger.
  regular: { plan: 'search', K: 16, top: 3, M: 3, deg: 1.5, pull: 8, t: 0.12, xy: 28 },
  // Has played the level before and has steady hands.
  expert: { plan: 'search', K: 40, top: 4, M: 5, deg: 0.7, pull: 4, t: 0.07, xy: 14 },
};

/* ---------- random numbers ---------- */

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

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

const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const pick = (list, r) => list[Math.floor(r() * list.length)];
const between = (a, b, r) => a + (b - a) * r();
const round = (x, d = 2) => +x.toFixed(d);

/* ---------- playing through the real rules ---------- */

const isDone = sim => sim.state === 'won' || sim.state === 'lost';

function settle(sim, limit = 60) {
  for (let i = 0; i < limit / FRAME; i++) {
    if (sim.state === 'ready' || isDone(sim)) return;
    sim.update(FRAME);
  }
}

function playAll(def, shots) {
  const sim = new GameSim(def);
  for (const shot of shots) {
    if (isDone(sim)) break;
    playShot(sim, shot);
  }
  settle(sim);
  return sim;
}

/* ---------- every flight a bug can take, so "aim at that" is a lookup ---------- */

const tables = new Map();

function flights(type, def) {
  if (tables.has(type)) return tables.get(type);
  const sim = new GameSim({ ...def, bugs: [type, type] });
  settle(sim);
  const body = sim.sling.body;
  const out = [];
  for (const pull of [170, 150, 130, 110, 90]) {
    for (let deg = -10; deg <= 85; deg += 0.5) {
      const p = pullPoint(sim, deg, pull);
      const launch = sim.sling.previewLaunch(body, p.x, p.y);
      if (!launch) continue;
      const path = flightPath({ ...launch, airDrag: body.airDrag, gravity: 500, seconds: 3.4, every: 1 / 120 });
      let n = path.findIndex(q => q.y > 10);
      if (n < 0) n = path.length;
      const xs = new Float32Array(n), ys = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = path[i].x;
        ys[i] = path[i].y;
      }
      out.push({ deg, pull, xs, ys });
    }
  }
  tables.set(type, out);
  return out;
}

/** Shots whose flight passes close to a point. Each continuous run of angles gives one shot, flat and lobbed. */
function aimsAt(type, def, tx, ty, tol = 30) {
  const runs = [];
  let run = null;
  for (const f of flights(type, def)) {
    let best = Infinity, at = 0;
    for (let i = 0; i < f.xs.length; i++) {
      const dx = f.xs[i] - tx, dy = f.ys[i] - ty;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        at = i;
      }
    }
    const miss = Math.sqrt(best);
    if (miss < tol) {
      const candidate = { deg: f.deg, pull: f.pull, t: at / 120, miss };
      if (run && run.pull === f.pull && Math.abs(run.lastDeg - f.deg) < 0.75) {
        run.lastDeg = f.deg;
        if (miss < run.best.miss) run.best = candidate;
      } else {
        run = { pull: f.pull, lastDeg: f.deg, best: candidate };
        runs.push(run);
      }
    }
  }
  return runs.map(x => x.best);
}

/** Shots that pass over a point with room to spare, for dropping straight down onto it. */
function passesOver(type, def, tx, ty) {
  const out = [];
  for (const f of flights(type, def)) {
    for (let i = 1; i < f.xs.length; i++) {
      if (f.xs[i] >= tx) {
        const above = ty - f.ys[i];
        if (above > 60 && above < 420) out.push({ deg: f.deg, pull: f.pull, t: i / 120 });
        break;
      }
    }
  }
  return out;
}

/* ---------- what a person might try next ---------- */

function targetsOf(sim) {
  const termites = sim.termites.map(t => ({ x: t.x, y: t.y }));
  const props = [];
  const mushrooms = [];
  for (const b of sim.world.bodies) {
    const kind = b.ent?.kind;
    if (kind === 'block' || kind === 'pod') props.push({ x: b.x, y: b.y });
    if (kind === 'mushroom') mushrooms.push({ x: b.x, y: b.y - b.shape.r * 0.5 });
  }
  const lines = [];
  for (const rope of sim.ropes) {
    if (rope.isBroken?.()) continue;
    const mid = rope.nodePos(Math.floor(rope.count / 2));
    lines.push({ x: mid.x, y: mid.y });
  }
  return { termites, props, lines, mushrooms };
}

function silkSpots(sim) {
  const out = [];
  for (const b of sim.world.bodies) {
    if (b.ent?.kind === 'branch') {
      const half = b.shape.w / 2;
      for (let u = -0.9; u <= 0.9; u += 0.2) out.push({ x: b.x + half * u, y: b.y + b.shape.h / 2 });
    } else if (!b.isStatic) {
      out.push({ x: b.x, y: b.y });
    }
  }
  return out;
}

function chooseTarget(t, r) {
  // A person reads the tip: a mushroom on the level is an invitation to bounce off it.
  if (t.mushrooms.length && r() < 0.35) return pick(t.mushrooms, r);
  const roll = r();
  if (roll < 0.62 && t.termites.length) return pick(t.termites, r);
  if (roll < 0.87 && t.props.length) return pick(t.props, r);
  if (t.lines.length) return pick(t.lines, r);
  if (t.termites.length) return pick(t.termites, r);
  return null;
}

/** One plausible shot: aimed at something, with its ability timed roughly the way the tips say. */
function proposeShot(sim, type, def, r) {
  const ability = BUGS[type].ability;
  const target = chooseTarget(targetsOf(sim), r);

  let base = null;
  if (target && r() > 0.15) {
    const options = ability === 'slam' && r() < 0.8
      ? passesOver(type, def, target.x, target.y)
      : aimsAt(type, def, target.x, target.y);
    if (options.length) base = pick(options, r);
  }
  const aimed = !!base;
  if (!base) base = { deg: round(between(-8, 84, r)), pull: pick([170, 170, 170, 150, 130], r), t: between(0.4, 1.6, r) };
  const shot = { deg: base.deg, pull: base.pull };

  if (ability && r() > 0.07) {
    if (ability === 'silk') {
      const spot = pick(silkSpots(sim), r);
      if (spot) shot.ability = { after: round(between(0.05, 1.45, r)), x: round(spot.x), y: round(spot.y), releaseAfter: round(between(0.2, 1.8, r)) };
    } else if (ability === 'slam') {
      shot.ability = { after: round(Math.max(0.05, base.t - between(0, 0.15, r))) };
    } else if (ability === 'jet') {
      shot.ability = { after: round(Math.max(0.05, base.t - between(0.1, 0.5, r))) };
    } else {
      shot.ability = { after: round(aimed ? base.t * between(0.25, 0.9, r) : between(0.15, 1.3, r)) };
    }
  }
  return shot;
}

function directShot(sim, type, def) {
  const r = sim.sling.rest;
  const nearest = [...sim.termites].sort((a, b) => Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y))[0];
  const ability = BUGS[type].ability;
  let base = null;
  if (nearest) {
    const options = aimsAt(type, def, nearest.x, nearest.y).sort((a, b) => b.pull - a.pull || a.deg - b.deg);
    base = options[0] ?? null;
  }
  if (!base) base = { deg: 42, pull: MAX_PULL, t: 1.2 };
  const shot = { deg: base.deg, pull: base.pull };
  if (ability === 'jet') shot.ability = { after: round(Math.max(0.05, base.t - 0.3)) };
  if (ability === 'click') shot.ability = { after: round(base.t * 0.6) };
  if (ability === 'slam') shot.ability = { after: round(Math.max(0.05, base.t - 0.05)) };
  return shot;
}

/** What actually comes out of an unsteady hand. Dragging past the limit always gives a full pull. */
function withHands(shot, tier, r) {
  const out = {
    deg: round(shot.deg + gauss(r) * tier.deg),
    pull: shot.pull >= MAX_PULL ? MAX_PULL : round(Math.min(MAX_PULL, shot.pull + gauss(r) * tier.pull)),
  };
  if (shot.ability) {
    out.ability = { ...shot.ability, after: round(Math.max(0.02, shot.ability.after + gauss(r) * tier.t)) };
    if (shot.ability.x !== undefined) {
      out.ability.x = round(shot.ability.x + gauss(r) * tier.xy);
      out.ability.y = round(shot.ability.y + gauss(r) * tier.xy);
      out.ability.releaseAfter = round(Math.max(0.05, shot.ability.releaseAfter + gauss(r) * tier.t));
    }
  }
  return out;
}

// A win is a win: scoring higher must not make a fragile shot look better than a safe one.
function worth(sim, total) {
  if (sim.state === 'won') return 1e6;
  return (total - sim.targetsLeft()) * 1e4 + sim.score * 0.1;
}

/* ---------- one person's one go at a level ---------- */

export function playLevel(def, tier, seed) {
  const r = rng(seed);
  const total = new GameSim(def).targetsLeft();
  const shots = [];
  let sim = playAll(def, shots);
  while (!isDone(sim) && sim.state === 'ready') {
    const type = sim.sling.body.ent.type;
    let intended;
    if (tier.plan === 'direct') {
      intended = directShot(sim, type, def);
    } else {
      // Imagine each idea once, then think harder about the few that looked best, so one lucky
      // imagined outcome cannot sell a shot that usually fails.
      const ideas = [];
      for (let k = 0; k < tier.K; k++) {
        const candidate = proposeShot(sim, type, def, r);
        ideas.push({ candidate, sum: worth(playAll(def, [...shots, withHands(candidate, tier, r)]), total) });
      }
      ideas.sort((a, b) => b.sum - a.sum);
      let bestValue = -Infinity;
      for (const idea of ideas.slice(0, tier.top)) {
        for (let m = 0; m < tier.M; m++) idea.sum += worth(playAll(def, [...shots, withHands(idea.candidate, tier, r)]), total);
        const value = idea.sum / (tier.M + 1);
        if (value > bestValue) {
          bestValue = value;
          intended = idea.candidate;
        }
      }
    }
    shots.push(withHands(intended, tier, r));
    sim = playAll(def, shots);
  }
  return {
    won: sim.state === 'won',
    shots: sim.shots,
    stars: sim.state === 'won' ? sim.stars : 0,
    killed: total - sim.targetsLeft(),
    total,
    score: sim.score,
    record: shots,
  };
}

/* ---------- running it all ---------- */

function report(results, levelIds, tierNames) {
  const cell = (text, width) => String(text).padStart(width);
  console.log(`\n${''.padEnd(28)}${tierNames.map(t => t.padEnd(20)).join('')}`);
  console.log(`${'level'.padEnd(16)}${'par/bugs'.padEnd(12)}${tierNames.map(() => 'win  3*  2* kills   ').join('')}`);
  for (const id of levelIds) {
    const def = LEVELS.find(l => l.id === id);
    const cells = tierNames.map(tier => {
      const list = results.filter(x => x.level === id && x.tier === tier);
      if (!list.length) return ''.padEnd(20);
      const pct = n => cell(Math.round((100 * n) / list.length), 3);
      const kills = list.reduce((a, x) => a + x.killed / x.total, 0) / list.length;
      return `${pct(list.filter(x => x.won).length)} ${pct(list.filter(x => x.stars === 3).length)} ${pct(list.filter(x => x.stars >= 2).length)} ${kills.toFixed(2)}   `;
    });
    console.log(`${id.padEnd(16)}${`${def.par}/${def.bugs.length}`.padEnd(12)}${cells.join('')}`);
  }
}

if (!isMainThread) {
  parentPort.on('message', task => {
    if (task === 'stop') process.exit(0);
    const def = LEVELS.find(l => l.id === task.level);
    parentPort.postMessage({ ...task, ...playLevel(def, TIERS[task.tier], hash(`${task.level}/${task.tier}/${task.trial}`)) });
  });
} else if (process.argv[1] === here) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
  const trials = Number(option('trials', 30));
  const jobs = Number(option('jobs', 6));
  const out = option('out', null);
  const levelIds = option('levels', LEVELS.map(l => l.id).join(',')).split(',');
  const tierNames = option('tiers', Object.keys(TIERS).join(',')).split(',');

  const tasks = [];
  for (const tier of tierNames) {
    for (const level of levelIds) {
      for (let trial = 0; trial < trials; trial++) tasks.push({ level, tier, trial });
    }
  }
  const results = [];
  let cursor = 0;
  const started = Date.now();

  await new Promise(resolve => {
    const feed = worker => worker.postMessage(cursor < tasks.length ? tasks[cursor++] : 'stop');
    for (let i = 0; i < Math.min(jobs, tasks.length); i++) {
      const worker = new Worker(here);
      worker.on('message', message => {
        results.push(message);
        if (results.length % 50 === 0) {
          const seconds = (Date.now() - started) / 1000;
          console.log(`${results.length}/${tasks.length}, ${((seconds / results.length) * (tasks.length - results.length)).toFixed(0)}s left`);
        }
        if (results.length === tasks.length) resolve();
        feed(worker);
      });
      worker.on('error', error => {
        console.error('worker failed', error);
        process.exit(1);
      });
      feed(worker);
    }
  });
  if (out) fs.writeFileSync(out, JSON.stringify(results));
  report(results, levelIds, tierNames);
}
