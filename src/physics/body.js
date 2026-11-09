let nextId = 1;

/** A rigid body. Mass is density * area / 1000, so masses stay in a readable 0.1 - 20 range. */
export class Body {
  constructor(o) {
    this.id = nextId++;
    this.shape = o.shape;
    this.isStatic = !!o.isStatic;
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.a = o.angle ?? 0;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.w = o.w ?? 0;
    this.px = this.x;
    this.py = this.y;
    this.pa = this.a;

    const density = o.density ?? 1;
    this.m = this.isStatic ? Infinity : (density * this.shape.area) / 1000;
    this.I = this.isStatic ? Infinity : this.m * this.shape.inertiaPerMass;
    this.imBase = this.isStatic ? 0 : 1 / this.m;
    this.iiBase = this.isStatic ? 0 : 1 / this.I;
    this.im = this.imBase;
    this.ii = this.iiBase;

    this.friction = o.friction ?? 0.5;
    this.restitution = o.restitution ?? 0.1;
    this.airDrag = o.airDrag ?? 0; // quadratic: dv/dt = -airDrag * |v| * v
    this.linDrag = o.linDrag ?? 0; // exponential, per second: settles slow swings that air drag misses
    this.angDrag = o.angDrag ?? 0; // exponential, per second
    this.rollDrag = o.rollDrag ?? 0; // extra spin decay per second while touching something
    this.collides = o.collides ?? null;
    this.noSleep = !!o.noSleep;
    this.ent = o.ent ?? null;

    this.asleep = false;
    this.slowTime = 0;
    this.island = null;
    this.touching = false;
    this.c = Math.cos(this.a);
    this.s = Math.sin(this.a);

    if (this.shape.kind === 'poly') {
      const n = this.shape.n;
      this.wx = new Float64Array(n);
      this.wy = new Float64Array(n);
      this.wnx = new Float64Array(n);
      this.wny = new Float64Array(n);
    }
    this.minX = this.minY = this.maxX = this.maxY = 0;
    this.updateWorld();
  }

  /** Refreshes cached rotation and world-space vertices from the current pose. */
  updateWorld() {
    const c = (this.c = Math.cos(this.a));
    const s = (this.s = Math.sin(this.a));
    if (this.shape.kind !== 'poly') return;
    const { verts, normals, n } = this.shape;
    for (let i = 0; i < n; i++) {
      const v = verts[i], m = normals[i];
      this.wx[i] = this.x + c * v.x - s * v.y;
      this.wy[i] = this.y + s * v.x + c * v.y;
      this.wnx[i] = c * m.x - s * m.y;
      this.wny[i] = s * m.x + c * m.y;
    }
  }

  updateAabb(margin) {
    if (this.shape.kind === 'circle') {
      const r = this.shape.r + margin;
      this.minX = this.x - r;
      this.maxX = this.x + r;
      this.minY = this.y - r;
      this.maxY = this.y + r;
      return;
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < this.shape.n; i++) {
      const x = this.wx[i], y = this.wy[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    this.minX = x0 - margin;
    this.maxX = x1 + margin;
    this.minY = y0 - margin;
    this.maxY = y1 + margin;
  }

  /** World position of a point given in body-local coordinates. */
  localToWorld(lx, ly) {
    return { x: this.x + this.c * lx - this.s * ly, y: this.y + this.s * lx + this.c * ly };
  }

  /** Body-local coordinates of a point given in world coordinates. */
  worldToLocal(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y;
    return { x: this.c * dx + this.s * dy, y: -this.s * dx + this.c * dy };
  }

  /** Applies an instantaneous impulse at a world point. */
  applyImpulse(jx, jy, wx = this.x, wy = this.y) {
    this.vx += jx * this.im;
    this.vy += jy * this.im;
    this.w += this.ii * ((wx - this.x) * jy - (wy - this.y) * jx);
  }
}
