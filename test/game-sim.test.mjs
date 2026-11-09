// Game rules on top of the physics: turns, damage, breaking, ropes, hazards and bug abilities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim, GRAVITY } from '../src/game/sim.js';
import { flightPath } from '../src/physics/index.js';

const near = (actual, expected, tol, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected} ±${tol}, got ${actual}`);

const SLING = { x: 300, h: 140 };
const level = (build, o = {}) => ({
  id: 'test', name: '测试', width: 2400, par: 1, bugs: ['roly', 'roly'], sling: SLING, build, ...o,
});

const advance = (sim, seconds, each) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.update(1 / 60);
    each?.(i / 60);
  }
};
const advanceUntil = (sim, pred, max = 30) => {
  for (let i = 0; i < max * 60; i++) {
    if (pred()) return true;
    sim.update(1 / 60);
  }
  return pred();
};
const untilReady = sim => assert.ok(advanceUntil(sim, () => sim.state === 'ready'), `stuck in ${sim.state}`);

/** Pull point for a launch direction: the band fires opposite to the pull. */
const pullPoint = (sim, degrees, pull) => {
  const a = (degrees * Math.PI) / 180;
  const r = sim.sling.rest;
  return { x: r.x - Math.cos(a) * pull, y: r.y + Math.sin(a) * pull };
};

const fire = (sim, degrees, pull = 170) => {
  untilReady(sim);
  assert.equal(sim.beginAim(), true);
  const p = pullPoint(sim, degrees, pull);
  sim.aim(p.x, p.y);
  advance(sim, 0.25);
  assert.equal(sim.releaseAim(), true);
};

/** Finds a launch angle whose predicted flight passes closest to a world point. */
const aimAt = (sim, x, y, pull = 170, low = true) => {
  let best = null;
  const bug = sim.sling.body;
  for (let deg = low ? -12 : 40; deg <= (low ? 40 : 85); deg += 0.25) {
    const p = pullPoint(sim, deg, pull);
    const launch = sim.sling.previewLaunch(bug, p.x, p.y);
    if (!launch) continue;
    const path = flightPath({ ...launch, airDrag: bug.airDrag, gravity: GRAVITY, seconds: 5, every: 1 / 120 });
    let miss = Infinity;
    for (const q of path) {
      miss = Math.min(miss, Math.hypot(q.x - x, q.y - y));
      if (q.y > 0) break;
    }
    if (!best || miss < best.miss) best = { deg, miss };
  }
  return best;
};

const fireAt = (sim, x, y, pull = 170, low = true) => {
  untilReady(sim);
  const { deg } = aimAt(sim, x, y, pull, low);
  fire(sim, deg, pull);
};

test('a direct hit kills a termite, wins the level and scores it', () => {
  const sim = new GameSim(level(b => b.termite(900, 0)));
  const t = sim.termites[0];
  fireAt(sim, t.x, t.y);
  assert.ok(advanceUntil(sim, () => sim.state === 'won'), `ended in ${sim.state}`);
  assert.equal(sim.targetsLeft(), 0);
  assert.ok(sim.score >= 1000, `score ${sim.score}`);
});

test('winning with spare bugs pays a bonus and more stars than using them all', () => {
  const one = new GameSim(level(b => b.termite(900, 0), { bugs: ['roly', 'roly', 'roly'], par: 1 }));
  const t = one.termites[0];
  fireAt(one, t.x, t.y);
  assert.ok(advanceUntil(one, () => one.state === 'won'));
  assert.equal(one.stars, 3);
  assert.ok(one.score >= 1000 + 2 * 1500, `spare bug bonus missing: ${one.score}`);

  const late = new GameSim(level(b => b.termite(900, 0), { bugs: ['roly', 'roly', 'roly'], par: 1 }));
  fire(late, 80); // sails far away
  advanceUntil(late, () => late.state === 'ready');
  fire(late, 80);
  advanceUntil(late, () => late.state === 'ready');
  const t2 = late.termites[0];
  fireAt(late, t2.x, t2.y);
  assert.ok(advanceUntil(late, () => late.state === 'won'));
  assert.equal(late.stars, 1);
});

test('a miss brings the next bug, and running out of bugs loses', () => {
  const sim = new GameSim(level(b => b.termite(2200, 0), { bugs: ['roly', 'roly'] }));
  fire(sim, 5, 60);
  assert.ok(advanceUntil(sim, () => sim.state === 'ready'), `stuck in ${sim.state}`);
  assert.equal(sim.queue.length, 0);
  fire(sim, 5, 60);
  assert.ok(advanceUntil(sim, () => sim.state === 'lost'), `ended in ${sim.state}`);
  assert.equal(sim.targetsLeft(), 1);
});

test('aiming is refused while a bug is flying', () => {
  const sim = new GameSim(level(b => b.termite(2200, 0)));
  fire(sim, 30);
  advance(sim, 0.4);
  assert.equal(sim.state, 'flying');
  assert.equal(sim.beginAim(), false);
});

test('a soft pull does not fire and costs no bug', () => {
  const sim = new GameSim(level(b => b.termite(2200, 0)));
  untilReady(sim);
  sim.beginAim();
  const p = pullPoint(sim, 20, 8);
  sim.aim(p.x, p.y);
  advance(sim, 0.1);
  assert.equal(sim.releaseAim(), false);
  assert.equal(sim.state, 'ready');
  assert.equal(sim.shots, 0);
});

test('a hard hit breaks a twig plank in two pieces that keep moving', () => {
  const sim = new GameSim(level(b => { b.termite(2300, 0); b.post(900, 0, 160); }));
  const plank = sim.blocks[0];
  const before = sim.blocks.length;
  fireAt(sim, plank.x, plank.y);
  assert.ok(advanceUntil(sim, () => !sim.world.bodies.includes(plank), 6), 'plank never broke');
  assert.equal(sim.blocks.length, before + 1, 'one plank should become two pieces');
  const pieces = sim.blocks;
  const span = plank.shape.h;
  const total = pieces.reduce((s, b) => s + b.shape.h, 0);
  near(total, span, 1e-6, 'pieces add up to the plank');
  assert.ok(pieces.some(b => Math.hypot(b.vx, b.vy) > 20 || !b.asleep), 'pieces should be moving');
});

test('a light hit only cracks a plank', () => {
  const sim = new GameSim(level(b => { b.termite(2300, 0); b.post(520, 0, 160); }));
  const plank = sim.blocks[0];
  fireAt(sim, plank.x, plank.y, 55);
  assert.ok(advanceUntil(sim, () => plank.ent.hp < 1, 6), 'plank was never hit');
  assert.ok(sim.world.bodies.includes(plank), 'the first light hit should not break it');
});

test('breaking through keeps the bug moving, a wall it cannot break stops it dead', () => {
  const after = mat => {
    const sim = new GameSim(level(b => { b.termite(2300, 0); b.block(800, 0, 30, 240, mat); }));
    const wall = sim.blocks[0];
    fireAt(sim, wall.x, wall.y);
    let bug = null;
    assert.ok(advanceUntil(sim, () => {
      bug = sim.active ?? bug;
      return bug && bug.x > wall.x - 120;
    }, 5));
    advance(sim, 0.25);
    return bug.vx;
  };
  const brittle = after('honey');
  const solid = after('pebble');
  assert.ok(brittle > 250, `lost too much speed through honey crystal: ${brittle}`);
  assert.ok(solid < brittle * 0.5, `pebble should stop far more: ${solid} vs ${brittle}`);
});

test('a falling block can crush a termite below it', () => {
  const sim = new GameSim(level(b => {
    b.termite(900, 0);
    b.block(900, 300, 90, 40, 'pebble');
  }));
  sim.world.wake(sim.blocks[0]);
  assert.ok(advanceUntil(sim, () => sim.targetsLeft() === 0, 3), 'termite survived a falling slab');
});

test('settling onto the floor does no harm', () => {
  const sim = new GameSim(level(b => b.termite(900, 2)));
  sim.world.wake(sim.termites[0]);
  advance(sim, 2);
  assert.equal(sim.targetsLeft(), 1);
  assert.equal(sim.termites[0].ent.hp, 1);
});

test('a short drop hurts but does not kill', () => {
  const sim = new GameSim(level(b => b.termite(900, 12)));
  sim.world.wake(sim.termites[0]);
  advance(sim, 2);
  assert.equal(sim.targetsLeft(), 1);
  assert.ok(sim.termites[0].ent.hp < 1, 'a drop should leave a mark');
  assert.ok(sim.termites[0].ent.hp > 0.2, `hp ${sim.termites[0].ent.hp}`);
});

test('falling one floor kills, so a collapsing fort does the work', () => {
  const sim = new GameSim(level(b => b.termite(900, 96)));
  sim.world.wake(sim.termites[0]);
  advance(sim, 2);
  assert.equal(sim.targetsLeft(), 0);
});

test('small knocks add up: a collapse is many light hits, not one big one', () => {
  const sim = new GameSim(level(b => b.termite(900, 0)));
  const t = sim.termites[0];
  for (let i = 0; i < 2; i++) sim.hurtBy(t, 100, null);
  assert.equal(sim.targetsLeft(), 1, 'two knocks should not be enough');
  for (let i = 0; i < 3; i++) if (sim.targetsLeft()) sim.hurtBy(t, 100, null);
  assert.equal(sim.targetsLeft(), 0, 'five knocks should be enough');
});

test('a popper pod blows up when hit and damages what is near it, but not what is far', () => {
  const sim = new GameSim(level(b => {
    b.pod(900, 0);
    b.termite(960, 0);
    b.termite(1500, 0);
  }, { bugs: ['roly', 'roly', 'roly'] }));
  const pod = sim.bodiesOfKind('pod')[0];
  fireAt(sim, pod.x, pod.y);
  assert.ok(advanceUntil(sim, () => !sim.world.bodies.includes(pod), 6), 'pod never popped');
  assert.equal(sim.targetsLeft(), 1, 'near termite should die, far one should live');
  const types = new Set();
  sim.events.forEach(e => types.add(e.type));
  assert.ok(types.has('explode'), 'no explosion event');
});

test('popper pods set each other off', () => {
  const sim = new GameSim(level(b => {
    b.pod(900, 0);
    b.pod(1020, 0);
    b.termite(2300, 0);
  }));
  const [first] = sim.bodiesOfKind('pod');
  sim.damageBody(first, 5);
  sim.update(1 / 60);
  assert.ok(advanceUntil(sim, () => sim.bodiesOfKind('pod').length === 0, 2), 'second pod survived the blast');
});

test('a dew drop bursts at a light touch', () => {
  const sim = new GameSim(level(b => { b.termite(2300, 0); b.dew(900, 0, 26); }));
  const drop = sim.bodiesOfKind('dew')[0];
  fireAt(sim, drop.x, drop.y, 110);
  assert.ok(advanceUntil(sim, () => !sim.world.bodies.includes(drop), 6), 'dew survived');
});

test('a mushroom cap bounces a bug back up', () => {
  const sim = new GameSim(level(b => { b.termite(2300, 0); b.mushroom(800, 0, 60); }));
  const cap = sim.bodiesOfKind('mushroom')[0];
  fireAt(sim, cap.x - 20, cap.y - 62);
  let bug = null, bounced = false;
  assert.ok(advanceUntil(sim, () => {
    bug = sim.active ?? bug;
    if (bug && bug.vy < -150 && bug.x > cap.x - 100) bounced = true;
    return bounced;
  }, 5), 'bug did not bounce');
});

test('a hung block stays still until its rope is cut, and a bug flying through cuts it', () => {
  const sim = new GameSim(level(b => {
    b.hangFrom(900, 620, b.block(900, 260, 80, 40, 'pebble'));
    b.termite(2200, 0);
  }, { bugs: ['roly', 'roly', 'roly'] }));
  const block = sim.blocks[0];
  const y0 = block.y;
  advance(sim, 1.5);
  near(block.y, y0, 0.5, 'hung block moved on its own');
  const rope = sim.ropes[0];
  const mid = rope.nodePos(2);
  fireAt(sim, mid.x, mid.y);
  assert.ok(advanceUntil(sim, () => rope.isBroken(), 5), 'rope was never cut');
  advance(sim, 1.2);
  assert.ok(block.y > y0 + 100, `block should drop: ${block.y - y0}`);
});

test('a rope with its load removed does not keep pulling', () => {
  const sim = new GameSim(level(b => {
    b.hangFrom(900, 620, b.block(900, 260, 80, 40, 'honey'));
    b.termite(2200, 0);
  }));
  const rope = sim.ropes[0];
  const block = sim.blocks[0];
  sim.damageBody(block, 5);
  sim.update(1 / 60);
  assert.ok(!sim.world.bodies.includes(block));
  assert.ok(rope.body.every(b => b === null || b !== block), 'rope still tied to a destroyed block');
  advance(sim, 2);
});

test('a termite that falls in water is gone, and a block just sinks', () => {
  const sim = new GameSim(level(b => {
    b.water(880, 1080);
    b.termite(980, 90);
    b.block(1000, 200, 40, 40, 'twig');
    b.termite(2200, 0);
  }, { bugs: ['roly'] }));
  sim.world.wake(sim.termites[0]);
  sim.world.wake(sim.blocks[0]);
  assert.ok(advanceUntil(sim, () => sim.targetsLeft() === 1, 3), 'termite did not drown');
  assert.ok(advanceUntil(sim, () => sim.blocks.length === 0, 3), 'block did not sink');
});

test('anything leaving the world is removed', () => {
  const sim = new GameSim(level(b => {
    b.termite(2300, 0);
    b.termite(900, 0);
  }, { width: 2400 }));
  const t = sim.termites[0];
  sim.world.wake(t);
  t.vx = 3000;
  assert.ok(advanceUntil(sim, () => !sim.world.bodies.includes(t), 3), 'still in the world');
  assert.equal(sim.targetsLeft(), 1, 'a lost termite counts as gone');
});

test('the click beetle jumps once in mid air', () => {
  const sim = new GameSim(level(b => b.termite(2300, 0), { bugs: ['clicker'] }));
  fire(sim, 30);
  advance(sim, 1.05);
  const bug = sim.active;
  assert.ok(bug.vy > -100, `should be near the top of its arc: ${bug.vy}`);
  assert.equal(sim.useAbility(0, 0), true);
  sim.update(1 / 60);
  assert.ok(bug.vy < -300, `no jump: ${bug.vy}`);
  assert.equal(sim.useAbility(0, 0), false, 'ability is single use');
});

test('a plain roly bug has no ability', () => {
  const sim = new GameSim(level(b => b.termite(2300, 0)));
  fire(sim, 30);
  advance(sim, 0.5);
  assert.equal(sim.useAbility(0, 0), false);
});

test('the stag beetle slams straight down and hits far harder', () => {
  const sim = new GameSim(level(b => { b.termite(2300, 0); b.block(700, 0, 90, 60, 'pebble'); }, { bugs: ['stag'] }));
  const slab = sim.blocks[0];
  const a = fireAtRising(sim, slab.x);
  assert.ok(a, 'could not reach above the slab');
  assert.ok(advanceUntil(sim, () => sim.active && sim.active.x > slab.x - 40, 5));
  assert.equal(sim.useAbility(0, 0), true);
  const bug = sim.active;
  sim.update(1 / 60);
  assert.ok(bug.vy > 500, `no slam: ${bug.vy}`);
  assert.ok(Math.abs(bug.vx) < 150, `should drop nearly straight: ${bug.vx}`);
  assert.ok(advanceUntil(sim, () => !sim.world.bodies.includes(slab), 3), 'pebble survived a slam');
});

function fireAtRising(sim, x) {
  untilReady(sim);
  const bug = sim.sling.body;
  for (let deg = 25; deg <= 80; deg += 0.5) {
    const p = pullPoint(sim, deg, 170);
    const launch = sim.sling.previewLaunch(bug, p.x, p.y);
    const path = flightPath({ ...launch, airDrag: bug.airDrag, gravity: GRAVITY, seconds: 4, every: 1 / 60 });
    const over = path.find(q => q.x >= x);
    if (over && over.y < -220) {
      fire(sim, deg, 170);
      return true;
    }
  }
  return false;
}

test('the bombardier blasts ahead and recoils backward', () => {
  const sim = new GameSim(level(b => {
    b.block(900, 0, 40, 40, 'twig');
    b.termite(2300, 0);
  }, { bugs: ['bomber'] }));
  const crate = sim.blocks[0];
  const { deg } = (untilReady(sim), aimAt(sim, crate.x, crate.y));
  fire(sim, deg);
  assert.ok(advanceUntil(sim, () => sim.active && sim.active.x > crate.x - 220, 5));
  const bug = sim.active;
  const vx0 = bug.vx;
  assert.equal(sim.useAbility(0, 0), true);
  sim.update(1 / 60);
  assert.ok(bug.vx < vx0 * 0.2, `no recoil: ${vx0} then ${bug.vx}`);
  advance(sim, 0.3);
  const moved = !sim.world.bodies.includes(crate) || crate.x > 905;
  assert.ok(moved, 'blast did not move the crate');
});

test('the spider shoots silk at a tapped point and swings from a fixed anchor', () => {
  const sim = new GameSim(level(b => {
    b.branch(800, 1300, 620, 40);
    b.termite(2300, 0);
  }, { bugs: ['spider'] }));
  fire(sim, 25);
  advance(sim, 0.5);
  const bug = sim.active;
  assert.equal(sim.useAbility(1050, -620), true);
  assert.ok(sim.silk, 'no silk rope');
  // Swinging on the silk: never further from the anchor than the rope allows, and it falls then rises.
  const reach = sim.silk.rest[0] * sim.silk.segments * 1.3;
  const anchor = sim.silk.nodePos(sim.silk.count - 1);
  let escaped = false, fell = false, roseAgain = false;
  advance(sim, 2.2, () => {
    if (!sim.silk) return;
    if (Math.hypot(bug.x - anchor.x, bug.y - anchor.y) > reach) escaped = true;
    if (bug.vy > 80) fell = true;
    if (fell && bug.vy < -80) roseAgain = true;
  });
  assert.ok(!escaped, 'bug escaped the silk');
  assert.ok(roseAgain, 'bug never swung back up');
});

test('tapping again lets go of the silk', () => {
  const sim = new GameSim(level(b => {
    b.branch(800, 1300, 620, 40);
    b.termite(2300, 0);
  }, { bugs: ['spider'] }));
  fire(sim, 25);
  advance(sim, 0.5);
  sim.useAbility(1050, -620);
  advance(sim, 0.3);
  const silk = sim.silk;
  assert.equal(sim.useAbility(0, 0), true);
  assert.equal(sim.silk, null);
  assert.ok(!sim.world.constraints.includes(silk));
});

test('silk fired at a loose block yanks it toward the spider', () => {
  const sim = new GameSim(level(b => {
    b.block(1000, 0, 60, 60, 'twig');
    b.termite(2300, 0);
  }, { bugs: ['spider'] }));
  fire(sim, 15, 140);
  const crate = sim.blocks[0];
  const x0 = crate.x;
  assert.ok(advanceUntil(sim, () => sim.state === 'flying', 2));
  advance(sim, 0.1);
  const bug = sim.active;
  sim.useAbility(crate.x, crate.y);
  assert.ok(sim.silk, 'silk did not reach');
  bug.vx = -500; // a hard swing away from the block
  advance(sim, 0.6);
  assert.ok(crate.x < x0 - 10, `crate was not pulled: ${x0} to ${crate.x}`);
});

test('silk fired at empty air is not used up', () => {
  const sim = new GameSim(level(b => b.termite(2300, 0), { bugs: ['spider'] }));
  fire(sim, 40);
  advance(sim, 0.3);
  assert.equal(sim.useAbility(sim.active.x + 400, sim.active.y - 400), false);
  assert.equal(sim.silk, null);
  assert.equal(sim.active.ent.used, false);
});

test('the same inputs give exactly the same result', () => {
  const play = () => {
    const sim = new GameSim(level(b => {
      b.frame(900, 0, 140, 110);
      b.termite(900, 0);
      b.termite(900, 128);
    }));
    fire(sim, 22);
    advance(sim, 6);
    return [sim.score, ...sim.world.bodies.map(b => b.x)];
  };
  assert.deepEqual(play(), play());
});

test('the world is frozen until something touches it', () => {
  const sim = new GameSim(level(b => {
    b.frame(900, 0, 140, 110);
    b.termite(900, 128);
  }));
  advance(sim, 2);
  for (const b of sim.world.bodies) if (!b.isStatic) assert.ok(b.asleep, `${b.ent.kind} is awake`);
});

test('an endless level has no winner and always brings another bug', () => {
  const sim = new GameSim(level(b => b.tag(1100, 300, '草'), { endless: true, bugs: ['roly'] }));
  for (let i = 0; i < 3; i++) {
    fire(sim, 20, 100);
    assert.ok(advanceUntil(sim, () => sim.state === 'ready'), `shot ${i}: stuck in ${sim.state}`);
  }
  assert.equal(sim.stars, 0);
});

test('a title tag can be grabbed, dragged and flung, and it swings back on its silk', () => {
  const sim = new GameSim(level(b => b.tag(1100, 300, '草', 760), { endless: true, bugs: ['roly'] }));
  const tag = sim.bodiesOfKind('tag')[0];
  const restX = tag.x, restY = tag.y;
  assert.equal(sim.tagAt(1500, -300), null, 'empty space is not a tag');
  assert.equal(sim.tagAt(tag.x, tag.y), tag);
  sim.grab(tag, tag.x, tag.y);
  for (let i = 0; i < 30; i++) {
    sim.moveGrab(restX + (i / 30) * 200, restY);
    sim.update(1 / 60);
  }
  near(tag.x, restX + (29 / 30) * 200, 15, 'tag follows the pointer');
  sim.dropGrab();
  let crossed = false;
  advance(sim, 6, () => { if (tag.x < restX) crossed = true; });
  assert.ok(crossed, 'tag never swung back past its resting point');
  advance(sim, 30);
  near(tag.x, restX, 12, 'tag settles under its anchor');
});

test('silk marked as uncuttable survives a bug flying through it', () => {
  const sim = new GameSim(level(b => b.tag(1100, 300, '草', 760), { endless: true, bugs: ['roly'] }));
  const rope = sim.ropes[0];
  const p = rope.nodePos(2);
  fireAt(sim, p.x, p.y);
  advance(sim, 3);
  assert.ok(!rope.isBroken());
});
