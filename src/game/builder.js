// Level authoring in ground-relative terms: x runs right, and every height is measured upward
// from the ground. Things are placed by what they stand on, so a stack touches exactly.

import { Body, Rope, box, circle, polygon } from '../physics/index.js';
import { MATERIALS, PROPS, TERMITES } from './catalog.js';

const WATER_SURFACE = 14;
const PIT_DEPTH = 150;
const GROUND_DEPTH = 500;
const TERRAIN = { friction: 0.85, restitution: 0.05 };

export class LevelBuilder {
  constructor(sim) {
    this.sim = sim;
    this.pits = [];
  }

  addBlock(shape, x, y, mat, angle = 0) {
    const m = MATERIALS[mat];
    if (!m) throw new Error(`unknown material ${mat}`);
    const body = new Body({
      shape, x, y, angle,
      density: m.density, friction: m.friction, restitution: m.restitution,
      angDrag: 0.3,
      ent: { kind: 'block', mat, hp: 1, gen: 0 },
    });
    this.sim.world.add(body);
    this.sim.blocks.push(body);
    return body;
  }

  /** Upright piece standing on `base`. */
  post(x, base, height, mat = 'twig', width = 18) {
    return this.addBlock(box(width, height), x, -(base + height / 2), mat);
  }

  /** Lying piece whose underside is at `base`. */
  beam(x, base, length, mat = 'twig', thick = 18) {
    return this.addBlock(box(length, thick), x, -(base + thick / 2), mat);
  }

  block(x, base, w, h, mat = 'twig') {
    return this.addBlock(box(w, h), x, -(base + h / 2), mat);
  }

  /** Two posts and a beam. Returns the height of the top of the beam. */
  frame(x, base, width, height, mat = 'twig', o = {}) {
    const postWidth = o.postWidth ?? 18;
    const thick = o.thick ?? 18;
    const span = width + (o.overhang ?? 24);
    this.post(x - width / 2, base, height, mat, postWidth);
    this.post(x + width / 2, base, height, mat, postWidth);
    this.beam(x, base + height, span, o.beamMat ?? mat, thick);
    return base + height + thick;
  }

  termite(x, base = 0, type = 'worker') {
    const t = TERMITES[type];
    const body = new Body({
      shape: circle(t.radius), x, y: -(base + t.radius),
      density: t.density, friction: 0.8, restitution: 0.14,
      angDrag: 1.5, rollDrag: 3,
      ent: { kind: 'termite', type, hp: 1, hurt: 0 },
    });
    this.sim.world.add(body);
    this.sim.termites.push(body);
    return body;
  }

  pod(x, base = 0) {
    const p = PROPS.pod;
    const body = new Body({
      shape: circle(p.radius), x, y: -(base + p.radius),
      density: p.density, friction: p.friction, restitution: p.restitution,
      angDrag: 1, rollDrag: 3,
      ent: { kind: 'pod', hp: 1 },
    });
    return this.sim.world.add(body);
  }

  dew(x, base = 0, r = 22) {
    const p = PROPS.dew;
    const body = new Body({
      shape: circle(r), x, y: -(base + r),
      density: p.density, friction: p.friction, restitution: p.restitution,
      angDrag: 1, rollDrag: 4,
      ent: { kind: 'dew', hp: 1 },
    });
    return this.sim.world.add(body);
  }

  /** A springy mushroom: its cap is solid and throws things back, its stalk is just a stalk. */
  mushroom(x, base = 0, r = 60) {
    const stalk = r * 0.9;
    const stem = new Body({
      shape: box(r * 0.42, stalk), x, y: -(base + stalk / 2), isStatic: true,
      friction: 0.6, restitution: 0.1,
      ent: { kind: 'stalk' },
    });
    this.sim.world.add(stem);
    const cap = new Body({
      shape: circle(r), x, y: -(base + stalk + r * 0.35), isStatic: true,
      friction: 0.5, restitution: 0.95,
      ent: { kind: 'mushroom', squash: 0, stalk },
    });
    return this.sim.world.add(cap);
  }

  /** Solid scenery from a convex outline given as [x, height] points. */
  rock(points) {
    const shape = polygon(points.map(([x, h]) => [x, -h]));
    const body = new Body({
      shape, x: shape.centroid.x, y: shape.centroid.y, isStatic: true, ...TERRAIN,
      ent: { kind: 'terrain' },
    });
    return this.sim.world.add(body);
  }

  /** A trapezoid mound. */
  hill(x0, x1, height, topWidth = (x1 - x0) * 0.35) {
    const mid = (x0 + x1) / 2;
    return this.rock([[x0, -6], [x1, -6], [mid + topWidth / 2, height], [mid - topWidth / 2, height]]);
  }

  /** A thick horizontal branch overhead that ropes can hang from and silk can stick to. */
  branch(x0, x1, height, thick = 34) {
    const body = new Body({
      shape: box(x1 - x0, thick), x: (x0 + x1) / 2, y: -height, isStatic: true,
      friction: 0.8, restitution: 0.05,
      ent: { kind: 'branch' },
    });
    return this.sim.world.add(body);
  }

  /** Hangs a body from a fixed point on silk, sized so it already sits at its resting stretch. */
  hangFrom(anchorX, anchorHeight, body, o = {}) {
    const local = o.local ?? (body.shape.kind === 'circle' ? { x: 0, y: -body.shape.r } : { x: 0, y: -body.shape.h / 2 });
    const from = { x: anchorX, y: -anchorHeight };
    const weight = (o.carries ?? body.m) * this.sim.world.gravity;
    const load = weight * 1.15;
    body.linDrag = Math.max(body.linDrag, 0.1);
    const tied = body.localToWorld(local.x, local.y);
    const distance = Math.hypot(tied.x - from.x, tied.y - from.y);
    const rope = new Rope({
      from,
      to: { body, lx: local.x, ly: local.y },
      length: distance / (1 + restingStrain(weight, load)),
      load,
      segments: o.segments ?? 4,
      breakForce: load * (o.breakAt ?? 8),
    });
    return this.sim.addRope(rope);
  }

  /** A letter on a leaf, hanging on silk for the title screen. It can be grabbed and hit, never cut. */
  tag(x, base, label, anchorHeight = base + 400, w = 150, h = 170) {
    const body = new Body({
      shape: box(w, h), x, y: -(base + h / 2),
      density: 0.6, friction: 0.5, restitution: 0.3,
      angDrag: 0.5, airDrag: 1 / 4000, linDrag: 0.25,
      noSleep: true,
      ent: { kind: 'tag', label },
    });
    this.sim.world.add(body);
    const rope = this.hangFrom(x, anchorHeight, body, { breakAt: 1e6 });
    rope.uncuttable = true;
    return body;
  }

  /** A pit with water in it. Termites drown; blocks sink. */
  water(x0, x1) {
    this.pits.push([x0, x1]);
    this.sim.zones.push({ kind: 'water', x0, x1, y: WATER_SURFACE });
  }

  /** Lays the ground around any pits. Runs once after the level is authored. */
  finish() {
    const left = -3000, right = this.sim.width + 3000;
    const pits = [...this.pits].sort((a, b) => a[0] - b[0]);
    let cursor = left;
    const lay = (x0, x1) => {
      if (x1 <= x0) return;
      const body = new Body({
        shape: box(x1 - x0, GROUND_DEPTH), x: (x0 + x1) / 2, y: GROUND_DEPTH / 2, isStatic: true, ...TERRAIN,
        ent: { kind: 'terrain', ground: true },
      });
      this.sim.world.add(body);
    };
    for (const [x0, x1] of pits) {
      lay(cursor, x0);
      const floor = new Body({
        shape: box(x1 - x0 + 40, GROUND_DEPTH), x: (x0 + x1) / 2, y: PIT_DEPTH + GROUND_DEPTH / 2, isStatic: true, ...TERRAIN,
        ent: { kind: 'terrain' },
      });
      this.sim.world.add(floor);
      cursor = x1;
    }
    lay(cursor, right);
  }
}

/** The strain at which a rope with the default material carries `weight`. */
function restingStrain(weight, load) {
  const hold = 3.85 * load, modulus = 26 * load, late = 0.35 * load;
  let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const force = hold * Math.tanh((modulus * s) / hold) + late * s;
    if (force < weight) lo = s;
    else hi = s;
  }
  return lo;
}
