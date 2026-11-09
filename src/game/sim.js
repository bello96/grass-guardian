// The whole game without a screen: turns, damage, breaking, hazards and abilities.
// Rendering and sound only read its state and the events it emits, so the same code runs
// headless for the level solver and the tests.

import { Body, Pin, Rope, Sling, World, TICK, box, circle } from '../physics/index.js';
import { raycast } from '../physics/ray.js';
import { LevelBuilder } from './builder.js';
import { BLAST, BUGS, MATERIALS, PROPS, QUEUE_GAP, QUEUE_START, TERMITES } from './catalog.js';

export const GRAVITY = 500;

const HOP_TIME = 0.62;
const SPARE_BUG_BONUS = 1500;
const WORLD_MARGIN = 600;
const CALM_SPEED = 14;
const CALM_SPIN = 0.5;
const CALM_NEEDED = 0.35;
const BUG_REST_SPEED = 12;
const BUG_REST_NEEDED = 0.5;
const BUG_MAX_AFTER_LANDING = 7;
const TURN_LIMIT = 16;
const AFTER_RETIRE_LIMIT = 5;
const WIN_DELAY = 0.9;
const SILK_RANGE = 900;
const SILK_LIFE = 2.6;
const MIN_SPLIT_LENGTH = 34;
const SPLIT_ASPECT = 2.2;
const RIGHTING_TORQUE = 14; // termites are weighted like tumbler dolls

export class GameSim {
  constructor(def) {
    this.def = def;
    this.width = def.width;
    this.world = new World({ gravity: def.gravity ?? GRAVITY });
    this.events = [];
    this.blocks = [];
    this.termites = [];
    this.ropes = [];
    this.zones = [];
    this.score = 0;
    this.shots = 0;
    this.stars = 0;
    this.time = 0;
    this.active = null; // the bug in flight
    this.hopping = null; // the bug on its way to the sling
    this.silk = null;
    this.silkAge = 0;
    this.turnTime = 0;
    this.calmTime = 0;
    this.sinceRetire = 0;
    this.winTimer = -1;
    this.state = 'loading';
    this.endless = !!def.endless;
    this.grabPin = null;

    const builder = new LevelBuilder(this);
    def.build(builder);
    builder.finish();

    this.sling = this.world.addConstraint(new Sling({ x: def.sling.x, y: -def.sling.h }));
    this.sling.onLaunch = body => this.onLaunched(body);
    this.queue = [...def.bugs];

    this.world.onImpact = imp => this.onImpact(imp);
    this.world.onTick = () => this.onTick();
    this.world.sleepAll();
    this.startNextBug();
  }

  /* ---------- queries ---------- */

  targetsLeft() {
    return this.termites.length;
  }

  bodiesOfKind(kind) {
    return this.world.bodies.filter(b => b.ent?.kind === kind);
  }

  /** The event's name always wins: a payload field called `type` must not be able to rename it. */
  emit(type, data) {
    this.events.push({ ...data, type });
  }

  /* ---------- player input ---------- */

  /** True from the moment the last termite dies until the win is declared: nothing more can be fired. */
  isClearing() {
    return !this.endless && this.termites.length === 0;
  }

  beginAim() {
    if (this.state !== 'ready' || this.isClearing()) return false;
    this.state = 'aiming';
    const b = this.sling.body;
    this.sling.aim(b.x, b.y);
    return true;
  }

  aim(x, y) {
    if (this.state === 'aiming') this.sling.aim(x, y);
  }

  /** Returns true if the bug was fired, false if the pull was too small to count. */
  releaseAim() {
    if (this.state !== 'aiming') return false;
    if (this.isClearing()) {
      this.cancelAim();
      return false;
    }
    if (this.sling.release()) {
      this.state = 'launching';
      this.shots++;
      this.emit('release', { strain: this.sling.strain(), x: this.sling.rest.x, y: this.sling.rest.y });
      return true;
    }
    this.state = 'ready';
    return false;
  }

  /** The gesture was taken away, by a pause or the system: the bug goes back with no shot fired. */
  cancelAim() {
    if (this.state !== 'aiming') return false;
    this.sling.cancel();
    this.state = 'ready';
    return true;
  }

  /** Mid-flight ability. (x, y) is the tapped world point, which only the spider cares about. */
  useAbility(x, y) {
    const bug = this.active;
    if (!bug || this.state !== 'flying') return false;
    const kind = BUGS[bug.ent.type].ability;
    if (this.silk) {
      this.releaseSilk();
      return true;
    }
    if (!kind || bug.ent.used) return false;
    switch (kind) {
      case 'click': return this.abilityClick(bug);
      case 'slam': return this.abilitySlam(bug);
      case 'jet': return this.abilityJet(bug);
      case 'silk': return this.abilitySilk(bug, x, y);
    }
    return false;
  }

  abilityClick(bug) {
    bug.ent.used = true;
    bug.vy = -560;
    bug.vx *= 1.05;
    bug.w += bug.vx >= 0 ? 26 : -26;
    this.emit('ability', { kind: 'click', x: bug.x, y: bug.y });
    return true;
  }

  abilitySlam(bug) {
    bug.ent.used = true;
    bug.ent.slamming = true;
    bug.vx *= 0.2;
    bug.vy = Math.max(bug.vy, 0) + 900;
    this.emit('ability', { kind: 'slam', x: bug.x, y: bug.y });
    return true;
  }

  /** Hot gas forward; the bug is thrown back by the same push. */
  abilityJet(bug) {
    bug.ent.used = true;
    const speed = Math.hypot(bug.vx, bug.vy) || 1;
    const dx = bug.vx / speed, dy = bug.vy / speed;
    const range = 340, halfCone = 0.56;
    for (const b of [...this.world.bodies]) {
      if (b === bug || b.isStatic) continue;
      const ox = b.x - bug.x, oy = b.y - bug.y;
      const dist = Math.hypot(ox, oy);
      if (dist > range + b.shape.bound || dist < 1e-6) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, (ox * dx + oy * dy) / dist)));
      if (off > halfCone) continue;
      this.world.wake(b);
      const falloff = (1 - Math.min(1, dist / (range + b.shape.bound))) * (1 - off / halfCone * 0.5);
      const j = 1500 * falloff;
      b.applyImpulse((dx * j + (ox / dist) * j) / 2, (dy * j + (oy / dist) * j) / 2);
      this.hurtBy(b, j * 0.8, null);
    }
    bug.vx = -dx * speed * 0.35;
    bug.vy = -dy * speed * 0.35 - 40;
    this.emit('ability', { kind: 'jet', x: bug.x, y: bug.y, dx, dy });
    return true;
  }

  abilitySilk(bug, x, y) {
    const dx0 = x - bug.x, dy0 = y - bug.y;
    const dist0 = Math.hypot(dx0, dy0);
    if (dist0 < 1e-6) return false;
    const dx = dx0 / dist0, dy = dy0 / dist0;
    const found = raycast(this.world.bodies, bug.x, bug.y, dx, dy, SILK_RANGE, b => b === bug);
    if (!found) {
      this.emit('ability', { kind: 'silkMiss', x: bug.x, y: bug.y, dx, dy });
      return false;
    }
    bug.ent.used = true;
    const target = found.body;
    const to = target.isStatic
      ? { x: found.x, y: found.y }
      : { body: target, ...localOf(target, found.x, found.y) };
    if (!target.isStatic) this.world.wake(target);
    const load = bug.m * this.world.gravity * 1.6;
    this.silk = new Rope({
      from: { body: bug, lx: 0, ly: 0 },
      to,
      length: found.dist * 0.9,
      load,
      segments: 4,
      nodeMass: 0.012,
      nodeDrag: 4,
      kind: 'grapple',
    });
    this.silkAge = 0;
    this.world.addConstraint(this.silk);
    this.emit('ability', { kind: 'silk', x: bug.x, y: bug.y, tx: found.x, ty: found.y });
    return true;
  }

  releaseSilk() {
    if (!this.silk) return;
    this.world.removeConstraint(this.silk);
    this.emit('silkOff', { lines: this.silk.polylines() });
    this.silk = null;
  }

  /* ---------- grabbing title tags ---------- */

  tagAt(x, y) {
    for (const b of this.world.bodies) {
      if (b.ent?.kind !== 'tag') continue;
      const p = b.worldToLocal(x, y);
      if (Math.abs(p.x) <= b.shape.w / 2 && Math.abs(p.y) <= b.shape.h / 2) return b;
    }
    return null;
  }

  grab(body, x, y) {
    this.dropGrab();
    const p = body.worldToLocal(x, y);
    this.world.wake(body);
    this.grabPin = this.world.addConstraint(new Pin(body, p.x, p.y, x, y));
  }

  moveGrab(x, y) {
    this.grabPin?.moveTo(x, y);
  }

  dropGrab() {
    if (!this.grabPin) return;
    this.world.removeConstraint(this.grabPin);
    this.grabPin = null;
  }

  /* ---------- turn flow ---------- */

  startNextBug() {
    const type = this.queue.shift();
    const spec = BUGS[type];
    const r = this.sling.rest;
    const body = new Body({
      shape: circle(spec.radius), x: r.x - QUEUE_START, y: -spec.radius,
      density: spec.density, friction: spec.friction, restitution: spec.restitution,
      rollDrag: spec.rollDrag, airDrag: spec.airDrag, angDrag: 0.15,
      noSleep: true,
      ent: { kind: 'bug', type, landed: false, used: false, restTime: 0, landedTime: 0 },
    });
    this.sling.groundY = -spec.radius;
    this.hopping = { body, t: 0, fromX: body.x, fromY: body.y };
    this.state = 'loading';
    this.turnTime = 0;
    this.calmTime = 0;
    this.sinceRetire = 0;
    this.emit('hop', { x: body.x, y: body.y, who: type });
  }

  updateHop() {
    const hop = this.hopping;
    if (!hop) return;
    hop.t += TICK;
    const r = this.sling.rest;
    const u = Math.min(1, hop.t / HOP_TIME);
    const b = hop.body;
    b.x = hop.fromX + (r.x - hop.fromX) * u;
    b.y = hop.fromY + (r.y - hop.fromY) * u - Math.sin(Math.PI * u) * 120;
    b.a += 0.09 * Math.sign(r.x - hop.fromX);
    if (u >= 1) {
      this.hopping = null;
      b.vx = 0;
      b.vy = 150; // lands with some weight, so the band dips and recovers
      b.a = 0;
      this.sling.load(b);
      this.state = 'ready';
      this.emit('seated', { x: b.x, y: b.y, who: b.ent.type });
    }
  }

  onLaunched(body) {
    this.world.add(body);
    this.active = body;
    this.state = 'flying';
    const speed = Math.hypot(body.vx, body.vy);
    body.w = ((body.vx >= 0 ? 1 : -1) * speed) / (body.shape.r * 3.5);
    body.updateWorld();
    this.turnTime = 0;
    this.emit('launch', { x: body.x, y: body.y, speed, who: body.ent.type });
  }

  retireBug(reason) {
    const bug = this.active;
    if (!bug) return;
    this.releaseSilk();
    this.world.remove(bug);
    this.active = null;
    this.sinceRetire = 0;
    this.emit('retire', { x: bug.x, y: bug.y, who: bug.ent.type, reason });
  }

  worldCalm() {
    const bodies = this.world.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic || b.asleep) continue;
      if (b.vx * b.vx + b.vy * b.vy > CALM_SPEED * CALM_SPEED || Math.abs(b.w) > CALM_SPIN) return false;
    }
    return true;
  }

  endTurn() {
    if (this.endless) {
      this.queue = [...this.def.bugs];
      return this.startNextBug();
    }
    if (this.targetsLeft() === 0) return this.finishWon();
    if (this.queue.length > 0) return this.startNextBug();
    this.state = 'lost';
    this.emit('lost', {});
  }

  finishWon() {
    this.cancelAim();
    if (this.active) this.retireBug('won');
    const spare = this.queue.length;
    for (let i = 0; i < spare; i++) this.addScore(SPARE_BUG_BONUS, this.def.sling.x - QUEUE_START - i * QUEUE_GAP, -70 - i * 44);
    this.queue.length = 0;
    const par = this.def.par ?? 1;
    this.stars = this.shots <= par ? 3 : this.shots <= par + 1 ? 2 : 1;
    this.state = 'won';
    this.emit('won', { stars: this.stars, score: this.score });
  }

  /* ---------- every tick ---------- */

  update(dt) {
    this.world.step(Math.min(dt, 1 / 30));
  }

  onTick() {
    this.time += TICK;
    this.updateHop();
    this.updateWind();
    this.updateTermites();
    this.updateRopeCuts();
    this.updateZones();
    this.updateBounds();
    this.updateSilk();

    if (this.state === 'won' || this.state === 'lost') return;
    if (!this.endless && this.termites.length === 0 && this.state !== 'loading') {
      if (this.winTimer < 0) this.winTimer = WIN_DELAY;
      this.winTimer -= TICK;
      if (this.winTimer <= 0) this.finishWon();
      return;
    }
    if (this.state === 'flying' || this.state === 'settling') this.updateTurn();
  }

  updateTurn() {
    this.turnTime += TICK;
    const bug = this.active;
    if (bug) {
      if (bug.ent.landed) {
        if (this.state === 'flying' && !this.silk) this.state = 'settling';
        bug.ent.landedTime += TICK;
        const slow = bug.vx * bug.vx + bug.vy * bug.vy < BUG_REST_SPEED * BUG_REST_SPEED;
        bug.ent.restTime = slow ? bug.ent.restTime + TICK : 0;
        if (bug.ent.restTime > BUG_REST_NEEDED || bug.ent.landedTime > BUG_MAX_AFTER_LANDING) this.retireBug('rest');
      } else if (this.turnTime > TURN_LIMIT) {
        this.retireBug('timeout');
      }
      return;
    }
    this.state = 'settling';
    this.sinceRetire += TICK;
    this.calmTime = this.worldCalm() ? this.calmTime + TICK : 0;
    if (this.calmTime > CALM_NEEDED || this.sinceRetire > AFTER_RETIRE_LIMIT) this.endTurn();
  }

  updateWind() {
    const t = this.time;
    const wind = 10 * Math.sin(t * 0.7) + 6 * Math.sin(t * 1.9 + 1);
    for (const rope of this.ropes) rope.windX = wind;
    if (this.endless) {
      // Title letters are never quite still: a faint breeze keeps them alive.
      for (const b of this.world.bodies) {
        if (b.ent?.kind === 'tag' && !b.asleep) b.vx += wind * 0.12 * TICK;
      }
    }
  }

  /** Tumbler-doll righting, so a termite that has been knocked about ends up facing the player. */
  updateTermites() {
    for (const t of this.termites) {
      if (t.ent.hurt > 0) t.ent.hurt -= TICK;
      if (t.asleep) continue;
      t.w -= Math.sin(t.a) * RIGHTING_TORQUE * TICK;
    }
  }

  updateRopeCuts() {
    const cutters = [];
    if (this.active && Math.hypot(this.active.vx, this.active.vy) > 120) cutters.push(this.active);
    for (const b of this.blocks) {
      if (!b.asleep && b.vx * b.vx + b.vy * b.vy > 260 * 260) cutters.push(b);
    }
    if (cutters.length === 0) return;
    for (const rope of this.ropes) {
      if (rope.uncuttable) continue;
      for (const c of cutters) {
        const reach = c.shape.bound * (c.shape.kind === 'circle' ? 1 : 0.6);
        const i = rope.segmentNear(c.x, c.y, reach);
        if (i < 0) continue;
        if (rope.body.includes(c)) continue;
        const p = rope.nodePos(i);
        rope.cut(i);
        c.vx *= 0.97;
        c.vy *= 0.97;
        this.addScore(60, p.x, p.y);
        this.emit('ropeCut', { x: c.x, y: c.y });
      }
    }
  }

  updateZones() {
    if (this.zones.length === 0) return;
    for (const b of [...this.world.bodies]) {
      if (b.isStatic || b.asleep) continue;
      for (const z of this.zones) {
        if (b.x < z.x0 || b.x > z.x1 || b.y < z.y) continue;
        this.emit('splash', { x: b.x, y: z.y, size: b.shape.bound, speed: Math.hypot(b.vx, b.vy) });
        if (b === this.active) this.retireBug('water');
        else if (b.ent.kind === 'termite') this.killTermite(b, 'water');
        else this.removeBody(b);
        break;
      }
    }
  }

  updateBounds() {
    for (const b of [...this.world.bodies]) {
      if (b.isStatic || b.ent?.kind === 'tag') continue; // a flung title letter swings back on its silk
      if (b.x > -WORLD_MARGIN && b.x < this.width + WORLD_MARGIN && b.y < WORLD_MARGIN) continue;
      if (b === this.active) this.retireBug('out');
      else if (b.ent.kind === 'termite') this.killTermite(b, 'out');
      else this.removeBody(b);
    }
  }

  updateSilk() {
    if (!this.silk) return;
    this.silkAge += TICK;
    if (this.silkAge > SILK_LIFE || this.silk.isBroken()) this.releaseSilk();
  }

  /* ---------- damage ---------- */

  onImpact(imp) {
    const { a, b } = imp;
    if (imp.impulse < 1) return;
    for (const self of [a, b]) {
      if (self.ent?.kind === 'bug') self.ent.landed = true;
      if (self.ent?.kind === 'mushroom') {
        self.ent.squash = Math.min(1, imp.impulse / 700);
        this.emit('mushroom', { x: imp.x, y: imp.y, impulse: imp.impulse });
      }
    }
    this.emit('hit', {
      x: imp.x, y: imp.y, impulse: imp.impulse, speed: imp.speed,
      a: matOf(a), b: matOf(b),
      bug: a === this.active || b === this.active,
    });
    this.takeHit(a, b, imp, 1);
    this.takeHit(b, a, imp, -1);
  }

  takeHit(self, other, imp, sign) {
    if (self.isStatic || !self.ent || !this.world.bodies.includes(self)) return;
    let impulse = imp.impulse;
    if (other.ent?.kind === 'bug') {
      impulse *= BUGS[other.ent.type].crush;
      if (other.ent.slamming) impulse *= 1.4;
    }
    const broke = this.hurtBy(self, impulse, imp);
    // Smashing through something costs far less momentum than being stopped by it.
    if (broke && self.ent.kind === 'block' && !other.isStatic) {
      const refund = MATERIALS[self.ent.mat].refund * imp.impulse;
      other.applyImpulse(sign * imp.nx * refund, sign * imp.ny * refund);
    }
  }

  /** Applies an impulse's worth of damage and returns true if the body was destroyed. */
  hurtBy(body, impulse, imp) {
    const spec = damageSpec(body);
    if (!spec) return false;
    const dmg = (impulse - spec.threshold) / spec.strength;
    if (dmg <= 0) return false;
    return this.damageBody(body, dmg, imp);
  }

  /** Removes hp directly. Returns true if the body was destroyed by it. */
  damageBody(body, dmg, imp = null) {
    const ent = body.ent;
    if (!ent || !this.world.bodies.includes(body) || ent.kind === 'bug') return false;
    ent.hp -= dmg;
    if (ent.kind === 'termite') {
      ent.hurt = 0.5;
      this.emit('hurt', { x: body.x, y: body.y, who: ent.type, hp: ent.hp });
    }
    if (ent.hp > 0) return false;
    switch (ent.kind) {
      case 'termite': this.killTermite(body, 'hit'); break;
      case 'block': this.breakBlock(body, imp); break;
      case 'pod': this.popPod(body); break;
      case 'dew': this.burstDew(body); break;
      default: return false;
    }
    return true;
  }

  killTermite(body, cause) {
    const spec = TERMITES[body.ent.type];
    this.termites.splice(this.termites.indexOf(body), 1);
    this.removeBody(body);
    this.addScore(spec.score, body.x, body.y);
    this.emit('kill', { x: body.x, y: body.y, who: body.ent.type, cause, r: body.shape.r });
  }

  breakBlock(body, imp) {
    const mat = body.ent.mat;
    this.addScore(body.ent.gen === 0 ? MATERIALS[mat].score : Math.round(MATERIALS[mat].score / 3), body.x, body.y);
    this.emit('break', {
      mat, x: body.x, y: body.y, a: body.a, w: body.shape.w ?? body.shape.bound * 2, h: body.shape.h ?? body.shape.bound * 2,
      vx: body.vx, vy: body.vy,
    });
    const pieces = this.splitBlock(body, imp);
    this.removeBody(body);
    for (const piece of pieces) {
      this.world.add(piece);
      this.blocks.push(piece);
    }
  }

  /** A long plank snaps across its length where it was hit; the halves carry on with its motion. */
  splitBlock(body, imp) {
    const s = body.shape;
    if (!s.w || body.ent.gen >= 1) return [];
    const along = s.h >= s.w ? 'h' : 'w';
    const length = s[along], thick = along === 'h' ? s.w : s.h;
    if (length / thick < SPLIT_ASPECT || length < MIN_SPLIT_LENGTH * 2) return [];
    let t = 0.5;
    if (imp) {
      const local = body.worldToLocal(imp.x, imp.y);
      t = Math.min(0.68, Math.max(0.32, 0.5 + (along === 'h' ? local.y : local.x) / length));
    }
    const out = [];
    for (const [portion, offset] of [[t, (t - 1) / 2], [1 - t, t / 2]]) {
      const size = length * portion;
      const lx = along === 'w' ? offset * length : 0;
      const ly = along === 'h' ? offset * length : 0;
      const p = body.localToWorld(lx, ly);
      const m = MATERIALS[body.ent.mat];
      const piece = new Body({
        shape: along === 'h' ? box(thick, size) : box(size, thick),
        x: p.x, y: p.y, angle: body.a,
        density: m.density, friction: m.friction, restitution: m.restitution, angDrag: 0.3,
        vx: body.vx - body.w * (p.y - body.y),
        vy: body.vy + body.w * (p.x - body.x),
        w: body.w,
        ent: { kind: 'block', mat: body.ent.mat, hp: 0.7, gen: body.ent.gen + 1 },
      });
      out.push(piece);
    }
    return out;
  }

  popPod(body) {
    this.addScore(PROPS.pod.score, body.x, body.y);
    this.removeBody(body);
    this.emit('explode', { x: body.x, y: body.y, radius: BLAST.radius });
    this.blast(body.x, body.y, BLAST.radius, BLAST.impulse);
  }

  /** Radial shove plus damage. Bodies destroyed by it can set off further blasts. */
  blast(x, y, radius, impulse) {
    for (const b of [...this.world.bodies]) {
      if (b.isStatic || !this.world.bodies.includes(b)) continue;
      const dx = b.x - x, dy = b.y - y;
      const dist = Math.hypot(dx, dy);
      const reach = Math.max(0, dist - b.shape.bound * 0.5);
      if (reach >= radius) continue;
      const fall = 1 - reach / radius;
      const j = impulse * fall * fall;
      this.world.wake(b);
      const nx = dist > 1e-6 ? dx / dist : 0, ny = dist > 1e-6 ? dy / dist : -1;
      b.applyImpulse(nx * j, ny * j - j * 0.25);
      if (b.ent.kind !== 'bug') this.hurtBy(b, j, null);
    }
  }

  burstDew(body) {
    this.addScore(PROPS.dew.score, body.x, body.y);
    this.removeBody(body);
    this.emit('burst', { x: body.x, y: body.y, r: body.shape.r });
  }

  removeBody(body) {
    for (const rope of this.ropes) {
      for (let i = 0; i < rope.count; i++) {
        if (rope.body[i] === body) rope.detach(i, rope.nodeMass, body.vx, body.vy);
      }
    }
    if (this.silk?.body.includes(body)) this.releaseSilk();
    const i = this.blocks.indexOf(body);
    if (i >= 0) this.blocks.splice(i, 1);
    this.world.remove(body);
  }

  addRope(rope) {
    this.ropes.push(rope);
    this.world.addConstraint(rope);
    rope.onBreak = () => this.emit('ropeSnap', { rope });
    return rope;
  }

  addScore(points, x, y) {
    this.score += points;
    this.emit('score', { points, x, y });
  }
}

function matOf(body) {
  const e = body.ent;
  if (!e) return 'ground';
  if (e.kind === 'block') return e.mat;
  if (e.kind === 'terrain' || e.kind === 'branch' || e.kind === 'stalk') return 'ground';
  return e.kind;
}

function damageSpec(body) {
  const e = body.ent;
  switch (e?.kind) {
    case 'block': return MATERIALS[e.mat];
    case 'termite': return TERMITES[e.type];
    case 'pod': return PROPS.pod;
    case 'dew': return PROPS.dew;
    default: return null;
  }
}

function localOf(body, x, y) {
  const p = body.worldToLocal(x, y);
  return { lx: p.x, ly: p.y };
}
