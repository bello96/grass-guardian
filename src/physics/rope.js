// A pull-only elastic chain, solved inside the world's substep loop.
//
// A segment only acts while stretched, so a slack rope exerts no force at all: whatever it holds
// is then in plain free fall. While stretched it corrects position, but limited by the force the
// material can deliver in one substep (force * h^2). That limit is what lets the rope lengthen.
//
//   T = H tanh(E s / H) + L s + D max(0, ds/dt)     s = strain = stretch / rest length
//
// H makes the rope firm under small loads yet stops it from storing huge energy when pulled far.
// L keeps it rising gently past that point. D damps only while lengthening, so a release springs
// back with full snap. Strain, not length, keeps the feel independent of segment count.

const REF_GRAVITY = 500;
const SUBSTEP = 1 / 960;

export class Rope {
  /**
   * @param from,to  fixed point {x, y} or attachment {body, lx, ly}
   * @param points   optional explicit node positions, instead of evenly spaced from/to
   * @param length   total rest length (defaults to the current straight distance)
   * @param load     reference force in world units: the hold, modulus, late and damp factors scale by it
   */
  constructor(o) {
    const load = o.load ?? 500;
    this.load = load;
    this.hold = (o.hold ?? 3.85) * load;
    this.modulus = (o.modulus ?? 26) * load;
    this.late = (o.late ?? 0.35) * load;
    this.damp = (o.damp ?? 0.8) * load;
    const wanted = o.nodeMass ?? Math.max(0.01, (0.03 * load) / REF_GRAVITY);
    this.nodeDrag = o.nodeDrag ?? 2;
    this.nodeAir = o.nodeAir ?? 0.002;
    this.breakForce = o.breakForce ?? Infinity;
    this.onBreak = null;
    this.windX = 0;
    this.world = null;

    const start = o.from ? endPoint(o.from) : o.points[0];
    const end = o.to ? endPoint(o.to) : o.points[o.points.length - 1];
    const segments = o.points ? o.points.length - 1 : o.segments ?? 4;
    const count = segments + 1;
    this.segments = segments;
    this.count = count;
    this.x = new Float64Array(count);
    this.y = new Float64Array(count);
    this.px = new Float64Array(count);
    this.py = new Float64Array(count);
    this.vx = new Float64Array(count);
    this.vy = new Float64Array(count);
    this.w = new Float64Array(count).fill(1 / wanted);
    this.body = new Array(count).fill(null);
    this.lx = new Float64Array(count);
    this.ly = new Float64Array(count);
    this.rest = new Float64Array(segments);
    this.lastLen = new Float64Array(segments);
    this.used = new Float64Array(segments);
    this.tensions = new Float64Array(segments);
    this.broken = new Uint8Array(segments);

    for (let i = 0; i < count; i++) {
      const p = o.points ? o.points[i] : lerpPoint(start, end, i / segments);
      this.x[i] = this.px[i] = p.x;
      this.y[i] = this.py[i] = p.y;
    }
    if (o.from) this.setEnd(0, o.from);
    else this.w[0] = 0;
    if (o.to) this.setEnd(count - 1, o.to);
    else this.w[count - 1] = 0;

    const total = o.length ?? Math.hypot(end.x - start.x, end.y - start.y);
    this.rest.fill(Math.max(total, 1e-3) / segments);
    this.refreshLengths();

    // The damping term feeds on node motion: a substep moves a node by F h^2 / m, which reads as a
    // strain rate and asks for more force. That loop has gain D h / (rest m) and runs away above 1,
    // so a node is never allowed to be light enough for the gain to pass 1/4.
    const floor = (4 * this.damp * SUBSTEP) / this.rest[0];
    this.nodeMass = Math.max(wanted, floor);
    for (let i = 0; i < count; i++) if (this.w[i] !== 0) this.w[i] = 1 / this.nodeMass;
  }

  setEnd(i, end) {
    if (end.body) this.attach(i, end.body, end.lx ?? 0, end.ly ?? 0);
    else this.w[i] = 0;
  }

  attach(i, body, lx = 0, ly = 0) {
    this.body[i] = body;
    this.lx[i] = lx;
    this.ly[i] = ly;
  }

  /** Lets node i carry on as a free point mass, moving with the given velocity. */
  detach(i, mass, vx, vy) {
    const b = this.body[i];
    if (b) {
      const p = this.nodePos(i);
      this.x[i] = p.x;
      this.y[i] = p.y;
      this.px[i] = p.x;
      this.py[i] = p.y;
    }
    this.body[i] = null;
    this.w[i] = 1 / mass;
    this.vx[i] = vx;
    this.vy[i] = vy;
  }

  nodePos(i) {
    const b = this.body[i];
    if (!b) return { x: this.x[i], y: this.y[i] };
    const lx = this.lx[i], ly = this.ly[i];
    if (lx === 0 && ly === 0) return { x: b.x, y: b.y };
    const c = Math.cos(b.a), s = Math.sin(b.a);
    return { x: b.x + c * lx - s * ly, y: b.y + s * lx + c * ly };
  }

  refreshLengths() {
    for (let i = 0; i < this.segments; i++) {
      const a = this.nodePos(i), b = this.nodePos(i + 1);
      this.lastLen[i] = Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  /** Straightens each side of a chain that is held at node k, for example a pulled sling. */
  settleStraightThrough(k) {
    const n = this.count - 1;
    const a = this.nodePos(0), m = this.nodePos(k), b = this.nodePos(n);
    for (let i = 1; i < n; i++) {
      if (i === k || this.body[i] || this.w[i] === 0) continue;
      const from = i < k ? a : m, to = i < k ? m : b;
      const t = i < k ? i / k : (i - k) / (n - k);
      this.x[i] = this.px[i] = from.x + (to.x - from.x) * t;
      this.y[i] = this.py[i] = from.y + (to.y - from.y) * t;
      this.vx[i] = this.vy[i] = 0;
    }
    this.refreshLengths();
  }

  linkedBodies() {
    const out = [];
    for (const b of this.body) if (b && !b.isStatic) out.push(b);
    return this.isBroken() ? out.slice(0, 1) : out;
  }

  isBroken() {
    return this.broken.includes(1);
  }

  cut(i) {
    if (this.broken[i]) return;
    this.broken[i] = 1;
    this.tensions[i] = 0;
    if (this.world) for (const b of this.body) if (b) this.world.wake(b);
    this.onBreak?.(i);
  }

  /** World-space polylines for drawing; a cut rope yields one line per surviving piece. */
  polylines() {
    const lines = [];
    let current = [this.nodePos(0)];
    for (let i = 0; i < this.segments; i++) {
      if (this.broken[i]) {
        lines.push(current);
        current = [this.nodePos(i + 1)];
      } else {
        current.push(this.nodePos(i + 1));
      }
    }
    lines.push(current);
    return lines;
  }

  /** Index of the first intact segment a circle overlaps, or -1. */
  segmentNear(cx, cy, radius) {
    for (let i = 0; i < this.segments; i++) {
      if (this.broken[i]) continue;
      const a = this.nodePos(i), b = this.nodePos(i + 1);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((cx - a.x) * dx + (cy - a.y) * dy) / len2)) : 0;
      if (Math.hypot(cx - a.x - dx * t, cy - a.y - dy * t) <= radius) return i;
    }
    return -1;
  }

  integrate(h, g) {
    const drag = Math.exp(-this.nodeDrag * h);
    for (let i = 0; i < this.count; i++) {
      if (this.body[i] || this.w[i] === 0) continue;
      let vx = this.vx[i] + this.windX * h;
      let vy = this.vy[i] + g * h;
      const f = (drag / (1 + this.nodeAir * Math.hypot(vx, vy) * h));
      vx *= f;
      vy *= f;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += vx * h;
      this.y[i] += vy * h;
    }
  }

  solve(h) {
    const h2 = h * h;
    for (let i = 0; i < this.segments; i++) {
      if (this.broken[i]) continue;
      const j = i + 1;
      const A = this.body[i], B = this.body[j];
      let ax, ay, bx, by, rax = 0, ray = 0, rbx = 0, rby = 0;
      if (A) {
        const lx = this.lx[i], ly = this.ly[i];
        if (lx !== 0 || ly !== 0) {
          const c = Math.cos(A.a), s = Math.sin(A.a);
          rax = c * lx - s * ly;
          ray = s * lx + c * ly;
        }
        ax = A.x + rax;
        ay = A.y + ray;
      } else {
        ax = this.x[i];
        ay = this.y[i];
      }
      if (B) {
        const lx = this.lx[j], ly = this.ly[j];
        if (lx !== 0 || ly !== 0) {
          const c = Math.cos(B.a), s = Math.sin(B.a);
          rbx = c * lx - s * ly;
          rby = s * lx + c * ly;
        }
        bx = B.x + rbx;
        by = B.y + rby;
      } else {
        bx = this.x[j];
        by = this.y[j];
      }
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      const rest = this.rest[i];
      const stretch = len - rest;
      if (stretch <= 0 || len < 1e-9) continue; // slack: no force, whatever hangs here is falling

      const nx = dx / len, ny = dy / len;
      const crA = rax * ny - ray * nx, crB = rbx * ny - rby * nx;
      const wa = A ? A.im + A.ii * crA * crA : this.w[i];
      const wb = B ? B.im + B.ii * crB * crB : this.w[j];
      const total = wa + wb;
      if (total === 0) continue;

      const strain = stretch / rest;
      const rate = (len - this.lastLen[i]) / (h * rest);
      const force =
        this.hold * Math.tanh((this.modulus * strain) / this.hold) +
        this.late * strain +
        (rate > 0 ? this.damp * rate : 0);
      const room = force * h2 - this.used[i];
      if (room <= 0) continue;
      const lambda = Math.min(stretch / total, room);
      this.used[i] += lambda;

      if (A) {
        A.x += nx * lambda * A.im;
        A.y += ny * lambda * A.im;
        A.a += A.ii * crA * lambda;
      } else {
        this.x[i] += nx * lambda * wa;
        this.y[i] += ny * lambda * wa;
      }
      if (B) {
        B.x -= nx * lambda * B.im;
        B.y -= ny * lambda * B.im;
        B.a -= B.ii * crB * lambda;
      } else {
        this.x[j] -= nx * lambda * wb;
        this.y[j] -= ny * lambda * wb;
      }
    }
  }

  finish(h) {
    const inv = 1 / h, inv2 = inv * inv;
    for (let i = 0; i < this.count; i++) {
      if (this.body[i] || this.w[i] === 0) continue;
      this.vx[i] = (this.x[i] - this.px[i]) * inv;
      this.vy[i] = (this.y[i] - this.py[i]) * inv;
    }
    for (let i = 0; i < this.segments; i++) {
      if (this.broken[i]) continue;
      const a = this.nodePos(i), b = this.nodePos(i + 1);
      this.lastLen[i] = Math.hypot(b.x - a.x, b.y - a.y);
      this.tensions[i] = this.used[i] * inv2;
      this.used[i] = 0;
      if (this.tensions[i] > this.breakForce) this.cut(i);
    }
  }
}

function endPoint(end) {
  if (!end.body) return end;
  const lx = end.lx ?? 0, ly = end.ly ?? 0;
  const c = Math.cos(end.body.a), s = Math.sin(end.body.a);
  return { x: end.body.x + c * lx - s * ly, y: end.body.y + s * lx + c * ly };
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
