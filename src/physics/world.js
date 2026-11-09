// Small-step position based rigid body dynamics.
//
// Each substep predicts motion from velocity, corrects positions so contacts and ropes hold,
// derives velocity back from the corrected positions, then applies bounce and sliding friction.
// Because velocity comes from position change, momentum carries through grabs, ropes and hits
// without any special casing.
//
// References: Muller et al., "Detailed Rigid Body Simulation with Extended Position Based Dynamics";
// Macklin et al., "Small Steps in Physics Simulation".
//
// Time advances in a fixed substep and everything that could reorder the solve (broad phase,
// sleeping, impact reports, game ticks) runs on a fixed tick, so a run is identical at any frame rate.

import { collide, hit } from './collide.js';

export const SUBSTEP = 1 / 960;
export const SUBSTEPS_PER_TICK = 8;
export const TICK = SUBSTEP * SUBSTEPS_PER_TICK;

const MAX_SPEED = 3000;
const MAX_SPIN = 80;
const SLEEP_SPEED = 5;
const SLEEP_SPIN = 0.25;
const SLEEP_AFTER = 0.5;
const WAKE_SPEED = 12;
const MIN_BOUNCE_SPEED = 18;
const SLEEP_CHECK_TICKS = 12;

class Manifold {
  constructor() {
    this.a = this.b = null;
    this.count = 0;
    this.nx = this.ny = 0;
    this.mu = this.e = 0;
    this.lax = [0, 0];
    this.lay = [0, 0];
    this.lbx = [0, 0];
    this.lby = [0, 0];
    this.vnPre = [0, 0];
    this.lambda = [0, 0];
    this.wx = this.wy = 0;
  }
}

export class World {
  constructor({ gravity = 500 } = {}) {
    this.gravity = gravity;
    this.bodies = [];
    this.constraints = []; // ropes, pins: integrate(h, g), solve(h), finish(h)
    this.pairs = [];
    this.pairPool = [];
    this.contacts = [];
    this.contactCount = 0;
    this.sap = [];
    this.pairsDirty = true;
    this.accumulator = 0;
    this.subCount = 0;
    this.tickCount = 0;
    this.time = 0;
    this.onImpact = null; // (impact) => void, called at the end of a tick
    this.onTick = null; // () => void, called at the end of a tick
    this.pending = new Map(); // pair id -> strongest impact this tick
    this.parent = new Map();
  }

  add(body) {
    this.bodies.push(body);
    this.sap.push(body);
    this.pairsDirty = true;
    return body;
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    this.sap.splice(this.sap.indexOf(body), 1);
    this.wakeAround(body);
    this.wake(body);
    this.pairsDirty = true;
  }

  addConstraint(constraint) {
    this.constraints.push(constraint);
    constraint.world = this;
    return constraint;
  }

  removeConstraint(constraint) {
    const i = this.constraints.indexOf(constraint);
    if (i >= 0) this.constraints.splice(i, 1);
  }

  wake(body) {
    if (!body.asleep) return;
    const group = body.island ?? [body];
    for (const b of group) {
      b.asleep = false;
      b.im = b.imBase;
      b.ii = b.iiBase;
      b.slowTime = 0;
      b.island = null;
    }
    this.pairsDirty = true;
  }

  wakeAround(body, pad = 3) {
    body.updateAabb(pad);
    const { minX, minY, maxX, maxY } = body;
    for (const other of this.bodies) {
      if (!other.asleep) continue;
      other.updateAabb(0);
      if (other.minX <= maxX && other.maxX >= minX && other.minY <= maxY && other.maxY >= minY) this.wake(other);
    }
  }

  /** Puts every dynamic body to sleep, grouped by what touches what. Used when a level loads. */
  sleepAll() {
    this.buildPairs(0);
    this.parent.clear();
    for (const pair of this.pairs) {
      if (pair.a.isStatic || pair.b.isStatic) continue;
      if (collide(pair.a, pair.b, 0.5) > 0) this.union(pair.a, pair.b);
    }
    this.joinConstraints();
    const groups = new Map();
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      const root = this.find(b);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(b);
    }
    for (const group of groups.values()) {
      if (group.some(b => b.noSleep)) continue;
      this.putToSleep(group);
    }
    this.pairsDirty = true;
  }

  find(b) {
    let p = this.parent.get(b);
    if (p === undefined) {
      this.parent.set(b, b);
      return b;
    }
    if (p === b) return b;
    p = this.find(p);
    this.parent.set(b, p);
    return p;
  }

  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  joinConstraints() {
    for (const c of this.constraints) {
      const linked = c.linkedBodies?.();
      if (!linked) continue;
      for (let i = 1; i < linked.length; i++) this.union(linked[0], linked[i]);
    }
  }

  putToSleep(group) {
    for (const b of group) {
      b.asleep = true;
      b.island = group;
      b.im = 0;
      b.ii = 0;
      b.vx = b.vy = b.w = 0;
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
    }
  }

  buildPairs(tickSeconds) {
    const sap = this.sap;
    for (let i = 0; i < sap.length; i++) {
      const b = sap[i];
      if (b.isStatic || b.asleep) {
        b.updateAabb(1);
      } else {
        const speed = Math.hypot(b.vx, b.vy) + Math.abs(b.w) * b.shape.bound;
        b.updateAabb(speed * tickSeconds + 3);
      }
    }
    // Insertion sort: the list is nearly sorted from the previous tick. Ties keep body order.
    for (let i = 1; i < sap.length; i++) {
      const b = sap[i];
      let j = i - 1;
      while (j >= 0 && (sap[j].minX > b.minX || (sap[j].minX === b.minX && sap[j].id > b.id))) {
        sap[j + 1] = sap[j];
        j--;
      }
      sap[j + 1] = b;
    }
    for (const pair of this.pairs) this.pairPool.push(pair);
    this.pairs.length = 0;
    for (let i = 0; i < sap.length; i++) {
      const a = sap[i];
      const aInert = a.isStatic || a.asleep;
      for (let j = i + 1; j < sap.length; j++) {
        const b = sap[j];
        if (b.minX > a.maxX) break;
        if (b.minY > a.maxY || b.maxY < a.minY) continue;
        if (aInert && (b.isStatic || b.asleep)) continue;
        if ((a.collides && !a.collides(b)) || (b.collides && !b.collides(a))) continue;
        const pair = this.pairPool.pop() ?? { a: null, b: null, key: 0, touching: false };
        // Circles come first so the narrow phase only needs one mixed case.
        if (a.shape.kind === 'poly' && b.shape.kind === 'circle') {
          pair.a = b;
          pair.b = a;
        } else {
          pair.a = a;
          pair.b = b;
        }
        const ay = a.isStatic ? -Infinity : a.y;
        const by = b.isStatic ? -Infinity : b.y;
        // Solve from the bottom up: a stack then converges in a single pass.
        pair.key = Math.max(ay, by) + (a.isStatic || b.isStatic ? 1e-3 : 0);
        pair.touching = false;
        this.pairs.push(pair);
      }
    }
    this.pairs.sort((p, q) => q.key - p.key || p.a.id - q.a.id || p.b.id - q.b.id);
    this.pairsDirty = false;
  }

  /** Advances by real time and returns how many substeps ran. */
  step(dt) {
    this.accumulator += dt;
    const n = Math.floor((this.accumulator + 1e-9) / SUBSTEP);
    this.accumulator -= n * SUBSTEP;
    for (let i = 0; i < n; i++) this.advanceSubstep();
    return n;
  }

  advanceSubstep() {
    if (this.subCount % SUBSTEPS_PER_TICK === 0) this.pairsDirty = true;
    if (this.pairsDirty) this.buildPairs(TICK);
    this.substep(SUBSTEP);
    this.subCount++;
    if (this.subCount % SUBSTEPS_PER_TICK === 0) this.endTick();
  }

  /** Runs exactly one fixed tick; handy for headless simulation. */
  tick() {
    do this.advanceSubstep();
    while (this.subCount % SUBSTEPS_PER_TICK !== 0);
  }

  substep(h) {
    const g = this.gravity;
    const bodies = this.bodies;
    this.time += h;

    // 1. Predict from velocity.
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic || b.asleep) continue;
      b.vy += g * h;
      if (b.airDrag > 0) {
        const f = 1 / (1 + b.airDrag * Math.hypot(b.vx, b.vy) * h);
        b.vx *= f;
        b.vy *= f;
      }
      if (b.linDrag > 0) {
        const f = 1 - b.linDrag * h;
        b.vx *= f;
        b.vy *= f;
      }
      if (b.angDrag > 0) b.w *= 1 - b.angDrag * h;
      if (b.touching && b.rollDrag > 0) b.w *= 1 - b.rollDrag * h;
      b.touching = false;
      b.px = b.x;
      b.py = b.y;
      b.pa = b.a;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
      b.updateWorld();
    }
    const constraints = this.constraints;
    for (let i = 0; i < constraints.length; i++) constraints[i].integrate(h, g);

    // 2. Find contacts on the predicted poses.
    let count = 0;
    const pairs = this.pairs;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const A = pair.a, B = pair.b;
      const aActive = !A.isStatic && !A.asleep;
      const bActive = !B.isStatic && !B.asleep;
      if (!aActive && !bActive) continue;
      const n = collide(A, B);
      if (n === 0) continue;
      pair.touching = true;
      if (A.asleep && B.vx * B.vx + B.vy * B.vy > WAKE_SPEED * WAKE_SPEED) this.wake(A);
      if (B.asleep && A.vx * A.vx + A.vy * A.vy > WAKE_SPEED * WAKE_SPEED) this.wake(B);
      const m = this.contacts[count] ?? (this.contacts[count] = new Manifold());
      count++;
      m.a = A;
      m.b = B;
      m.count = n;
      m.nx = hit.nx;
      m.ny = hit.ny;
      m.mu = Math.sqrt(A.friction * B.friction);
      m.e = Math.max(A.restitution, B.restitution);
      m.lambda[0] = m.lambda[1] = 0;
      m.wx = m.wy = 0;
      for (let k = 0; k < n; k++) {
        const dax = hit.ax[k] - A.x, day = hit.ay[k] - A.y;
        const dbx = hit.bx[k] - B.x, dby = hit.by[k] - B.y;
        m.lax[k] = A.c * dax + A.s * day;
        m.lay[k] = -A.s * dax + A.c * day;
        m.lbx[k] = B.c * dbx + B.s * dby;
        m.lby[k] = -B.s * dbx + B.c * dby;
        m.wx += hit.ax[k] / n;
        m.wy += hit.ay[k] / n;
        // Approach speed before any correction: this is what bounce and damage are based on.
        const vax = A.vx - A.w * day, vay = A.vy + A.w * dax;
        const vbx = B.vx - B.w * dby, vby = B.vy + B.w * dbx;
        m.vnPre[k] = (vax - vbx) * m.nx + (vay - vby) * m.ny;
      }
    }
    this.contactCount = count;

    // 3. Correct positions.
    for (let i = 0; i < count; i++) this.solveContactPosition(this.contacts[i]);
    for (let i = 0; i < constraints.length; i++) constraints[i].solve(h);

    // 4. Velocity is whatever motion the corrected positions imply.
    const inv = 1 / h;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic || b.asleep) continue;
      b.vx = (b.x - b.px) * inv;
      b.vy = (b.y - b.py) * inv;
      b.w = (b.a - b.pa) * inv;
      b.updateWorld();
    }
    for (let i = 0; i < constraints.length; i++) constraints[i].finish(h);

    // 5. Bounce and sliding friction.
    for (let i = 0; i < count; i++) this.solveContactVelocity(this.contacts[i], h);

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic || b.asleep) continue;
      const s2 = b.vx * b.vx + b.vy * b.vy;
      if (s2 > MAX_SPEED * MAX_SPEED) {
        const f = MAX_SPEED / Math.sqrt(s2);
        b.vx *= f;
        b.vy *= f;
      }
      if (b.w > MAX_SPIN) b.w = MAX_SPIN;
      else if (b.w < -MAX_SPIN) b.w = -MAX_SPIN;
    }
  }

  solveContactPosition(m) {
    const A = m.a, B = m.b;
    if (A.im + A.ii + B.im + B.ii === 0) return;
    const nx = m.nx, ny = m.ny;
    const sum = A.im + B.im;
    let ca = Math.cos(A.a), sa = Math.sin(A.a), cb = Math.cos(B.a), sb = Math.sin(B.a);

    let l0 = 0, l1 = 0;
    const rax0 = ca * m.lax[0] - sa * m.lay[0], ray0 = sa * m.lax[0] + ca * m.lay[0];
    const rbx0 = cb * m.lbx[0] - sb * m.lby[0], rby0 = sb * m.lbx[0] + cb * m.lby[0];
    const d0 = (A.x + rax0 - B.x - rbx0) * nx + (A.y + ray0 - B.y - rby0) * ny;
    const a0 = rax0 * ny - ray0 * nx, b0 = rbx0 * ny - rby0 * nx;
    const k00 = sum + A.ii * a0 * a0 + B.ii * b0 * b0;
    if (m.count === 1) {
      if (d0 >= 0) return;
      l0 = -d0 / k00;
      A.a += A.ii * a0 * l0;
      B.a -= B.ii * b0 * l0;
    } else {
      const rax1 = ca * m.lax[1] - sa * m.lay[1], ray1 = sa * m.lax[1] + ca * m.lay[1];
      const rbx1 = cb * m.lbx[1] - sb * m.lby[1], rby1 = sb * m.lbx[1] + cb * m.lby[1];
      const d1 = (A.x + rax1 - B.x - rbx1) * nx + (A.y + ray1 - B.y - rby1) * ny;
      if (d0 >= 0 && d1 >= 0) return;
      const a1 = rax1 * ny - ray1 * nx, b1 = rbx1 * ny - rby1 * nx;
      const k11 = sum + A.ii * a1 * a1 + B.ii * b1 * b1;
      const k01 = sum + A.ii * a0 * a1 + B.ii * b0 * b1;
      const det = k00 * k11 - k01 * k01;
      // Solve both points together; a one-at-a-time solve tilts thin posts a little every substep.
      const wellPosed = det > 1e-9 * k00 * k11;
      let solved = false;
      if (wellPosed) {
        l0 = (-d0 * k11 + d1 * k01) / det;
        l1 = (-d1 * k00 + d0 * k01) / det;
        solved = l0 >= 0 && l1 >= 0;
      }
      if (!solved) {
        // Try one point alone: it must hold without leaving the other one penetrating.
        l0 = d0 < 0 ? -d0 / k00 : 0;
        l1 = 0;
        if (d1 + k01 * l0 < 0) {
          l1 = d1 < 0 ? -d1 / k11 : 0;
          l0 = 0;
          if (d0 + k01 * l1 < 0 && wellPosed) {
            l0 = Math.max(0, (-d0 * k11 + d1 * k01) / det);
            l1 = Math.max(0, (-d1 * k00 + d0 * k01) / det);
          }
        }
      }
      A.a += A.ii * (a0 * l0 + a1 * l1);
      B.a -= B.ii * (b0 * l0 + b1 * l1);
    }
    const total = l0 + l1;
    if (total <= 0) return;
    m.lambda[0] = l0;
    m.lambda[1] = l1;
    A.x += nx * total * A.im;
    A.y += ny * total * A.im;
    B.x -= nx * total * B.im;
    B.y -= ny * total * B.im;
    A.touching = B.touching = true;

    // Static friction acts at the centre of pressure, using lever arms from the corrected pose.
    const f = l1 / total;
    const lax = m.lax[0] + (m.lax[1] - m.lax[0]) * f, lay = m.lay[0] + (m.lay[1] - m.lay[0]) * f;
    const lbx = m.lbx[0] + (m.lbx[1] - m.lbx[0]) * f, lby = m.lby[0] + (m.lby[1] - m.lby[0]) * f;
    ca = Math.cos(A.a);
    sa = Math.sin(A.a);
    cb = Math.cos(B.a);
    sb = Math.sin(B.a);
    const rax = ca * lax - sa * lay, ray = sa * lax + ca * lay;
    const rbx = cb * lbx - sb * lby, rby = sb * lbx + cb * lby;
    const pca = Math.cos(A.pa), psa = Math.sin(A.pa);
    const moveAx = A.x + rax - (A.px + pca * lax - psa * lay);
    const moveAy = A.y + ray - (A.py + psa * lax + pca * lay);
    let moveBx = 0, moveBy = 0;
    if (!B.isStatic && !B.asleep) {
      const pcb = Math.cos(B.pa), psb = Math.sin(B.pa);
      moveBx = B.x + rbx - (B.px + pcb * lbx - psb * lby);
      moveBy = B.y + rby - (B.py + psb * lbx + pcb * lby);
    }
    const dx = moveAx - moveBx, dy = moveAy - moveBy;
    const dn = dx * nx + dy * ny;
    const tx0 = dx - dn * nx, ty0 = dy - dn * ny;
    const slip = Math.hypot(tx0, ty0);
    if (slip < 1e-12) return;
    const tx = tx0 / slip, ty = ty0 / slip;
    const ctA = rax * ty - ray * tx, ctB = rbx * ty - rby * tx;
    const wt = sum + A.ii * ctA * ctA + B.ii * ctB * ctB;
    const lambdaT = slip / wt;
    if (lambdaT > m.mu * total) return; // too much slip for the load: sliding friction takes over
    const fx = tx * lambdaT, fy = ty * lambdaT;
    A.x -= fx * A.im;
    A.y -= fy * A.im;
    A.a -= A.ii * ctA * lambdaT;
    B.x += fx * B.im;
    B.y += fy * B.im;
    B.a += B.ii * ctB * lambdaT;
  }

  solveContactVelocity(m, h) {
    const l0 = m.lambda[0], l1 = m.lambda[1];
    const total = l0 + l1;
    if (total === 0) return;
    const A = m.a, B = m.b;
    const nx = m.nx, ny = m.ny;
    const sum = A.im + B.im;
    const both = l0 > 0 && l1 > 0;
    const first = l0 > 0 ? 0 : 1;

    const rax = A.c * m.lax[first] - A.s * m.lay[first], ray = A.s * m.lax[first] + A.c * m.lay[first];
    const rbx = B.c * m.lbx[first] - B.s * m.lby[first], rby = B.s * m.lbx[first] + B.c * m.lby[first];
    const a0 = rax * ny - ray * nx, b0 = rbx * ny - rby * nx;
    const k00 = sum + A.ii * a0 * a0 + B.ii * b0 * b0;
    const vn0 = (A.vx - A.w * ray - B.vx + B.w * rby) * nx + (A.vy + A.w * rax - B.vy - B.w * rbx) * ny;
    const pre0 = m.vnPre[first];
    const t0 = Math.max(-(-pre0 > MIN_BOUNCE_SPEED ? m.e : 0) * pre0, 0);

    let impact = 0; // normal impulse this contact had to deliver, judged from the approach speed
    if (both) {
      const rax1 = A.c * m.lax[1] - A.s * m.lay[1], ray1 = A.s * m.lax[1] + A.c * m.lay[1];
      const rbx1 = B.c * m.lbx[1] - B.s * m.lby[1], rby1 = B.s * m.lbx[1] + B.c * m.lby[1];
      const a1 = rax1 * ny - ray1 * nx, b1 = rbx1 * ny - rby1 * nx;
      const k11 = sum + A.ii * a1 * a1 + B.ii * b1 * b1;
      const k01 = sum + A.ii * a0 * a1 + B.ii * b0 * b1;
      const det = k00 * k11 - k01 * k01;
      const vn1 = (A.vx - A.w * ray1 - B.vx + B.w * rby1) * nx + (A.vy + A.w * rax1 - B.vy - B.w * rbx1) * ny;
      const pre1 = m.vnPre[1];
      const t1 = Math.max(-(-pre1 > MIN_BOUNCE_SPEED ? m.e : 0) * pre1, 0);
      let j0, j1;
      if (det > 1e-9 * k00 * k11) {
        const e0 = t0 - vn0, e1 = t1 - vn1;
        j0 = (e0 * k11 - e1 * k01) / det;
        j1 = (e1 * k00 - e0 * k01) / det;
        const f0 = t0 - pre0, f1 = t1 - pre1;
        impact = Math.max(0, (f0 * k11 - f1 * k01) / det) + Math.max(0, (f1 * k00 - f0 * k01) / det);
      } else {
        j0 = (t0 - vn0) / k00;
        j1 = 0;
        impact = Math.max(0, (t0 - pre0) / k00);
      }
      const j = j0 + j1;
      A.vx += nx * j * A.im;
      A.vy += ny * j * A.im;
      A.w += A.ii * (a0 * j0 + a1 * j1);
      B.vx -= nx * j * B.im;
      B.vy -= ny * j * B.im;
      B.w -= B.ii * (b0 * j0 + b1 * j1);
    } else {
      const j = (t0 - vn0) / k00;
      impact = Math.max(0, (t0 - pre0) / k00);
      A.vx += nx * j * A.im;
      A.vy += ny * j * A.im;
      A.w += A.ii * a0 * j;
      B.vx -= nx * j * B.im;
      B.vy -= ny * j * B.im;
      B.w -= B.ii * b0 * j;
    }

    // Sliding friction at the centre of pressure, bounded by the normal impulse (Coulomb).
    const f = l1 / total;
    const lax = m.lax[0] + (m.lax[1] - m.lax[0]) * f, lay = m.lay[0] + (m.lay[1] - m.lay[0]) * f;
    const lbx = m.lbx[0] + (m.lbx[1] - m.lbx[0]) * f, lby = m.lby[0] + (m.lby[1] - m.lby[0]) * f;
    const crx = A.c * lax - A.s * lay, cry = A.s * lax + A.c * lay;
    const dbx = B.c * lbx - B.s * lby, dby = B.s * lbx + B.c * lby;
    const vx = A.vx - A.w * cry - B.vx + B.w * dby;
    const vy = A.vy + A.w * crx - B.vy - B.w * dbx;
    const vnNow = vx * nx + vy * ny;
    const tx0 = vx - vnNow * nx, ty0 = vy - vnNow * ny;
    const vt = Math.hypot(tx0, ty0);
    if (vt > 1e-9) {
      const tx = tx0 / vt, ty = ty0 / vt;
      const ctA = crx * ty - cry * tx, ctB = dbx * ty - dby * tx;
      const wt = sum + A.ii * ctA * ctA + B.ii * ctB * ctB;
      const jt = Math.min(m.mu * Math.max(total / h, impact), vt / wt);
      A.vx -= tx * jt * A.im;
      A.vy -= ty * jt * A.im;
      A.w -= A.ii * ctA * jt;
      B.vx += tx * jt * B.im;
      B.vy += ty * jt * B.im;
      B.w += B.ii * ctB * jt;
    }

    // Report real impacts: resting contacts approach far slower than the bounce threshold.
    const approach = -Math.min(pre0, both ? m.vnPre[1] : pre0);
    if (approach > MIN_BOUNCE_SPEED && this.onImpact) {
      const key = A.id * 100000 + B.id;
      const prev = this.pending.get(key);
      if (!prev || prev.impulse < impact) {
        this.pending.set(key, { a: A, b: B, impulse: impact, speed: approach, x: m.wx, y: m.wy, nx, ny });
      }
    }
  }

  endTick() {
    this.tickCount++;
    this.updateSleep();
    if (this.pending.size > 0) {
      const list = [...this.pending.values()];
      this.pending.clear();
      if (this.onImpact) for (const imp of list) this.onImpact(imp);
    }
    if (this.onTick) this.onTick();
  }

  updateSleep() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic || b.asleep) continue;
      const slow = b.vx * b.vx + b.vy * b.vy < SLEEP_SPEED * SLEEP_SPEED && Math.abs(b.w) < SLEEP_SPIN;
      b.slowTime = slow ? b.slowTime + TICK : 0;
    }
    if (this.tickCount % SLEEP_CHECK_TICKS !== 0) return;

    this.parent.clear();
    for (const pair of this.pairs) {
      if (!pair.touching || pair.a.isStatic || pair.b.isStatic) continue;
      this.union(pair.a, pair.b);
    }
    this.joinConstraints();
    const groups = new Map();
    for (const b of bodies) {
      if (b.isStatic) continue;
      const root = this.find(b);
      let group = groups.get(root);
      if (!group) groups.set(root, (group = []));
      group.push(b);
    }
    for (const group of groups.values()) {
      let ready = false;
      let blocked = false;
      for (const b of group) {
        if (b.noSleep) blocked = true;
        else if (!b.asleep) {
          ready = true;
          if (b.slowTime < SLEEP_AFTER) blocked = true;
        }
      }
      if (ready && !blocked) {
        const merged = new Set();
        for (const b of group) {
          merged.add(b);
          if (b.island) for (const other of b.island) merged.add(other);
        }
        this.putToSleep([...merged]);
        this.pairsDirty = true;
      }
    }
  }
}
