// A hand holding a body by one point. It is a hard position constraint. Pointer updates arrive once
// a frame, so the hand glides linearly to each new position over about one frame's worth of substeps:
// that keeps its speed steady, so letting go throws the body at the speed the hand was really moving,
// and holding it off-centre makes it turn around that point.

const DEFAULT_GLIDE = 16; // substeps, one 60 Hz frame
const MIN_GLIDE = 4;
const MAX_GLIDE = 32;

export class Pin {
  constructor(body, lx, ly, x, y) {
    this.body = body;
    this.lx = lx;
    this.ly = ly;
    this.hand = { x, y };
    this.target = { x, y };
    this.glide = DEFAULT_GLIDE; // how many substeps pass between pointer updates
    this.sinceMove = 0;
    this.remaining = 0;
    this.world = null;
  }

  moveTo(x, y) {
    if (this.sinceMove > 0) {
      this.glide += (Math.min(MAX_GLIDE, Math.max(MIN_GLIDE, this.sinceMove)) - this.glide) * 0.5;
    }
    this.sinceMove = 0;
    this.target.x = x;
    this.target.y = y;
    this.remaining = Math.max(1, Math.round(this.glide));
  }

  integrate() {
    this.sinceMove++;
    if (this.remaining <= 0) return;
    this.hand.x += (this.target.x - this.hand.x) / this.remaining;
    this.hand.y += (this.target.y - this.hand.y) / this.remaining;
    this.remaining--;
  }

  solve() {
    const b = this.body;
    const c = Math.cos(b.a), s = Math.sin(b.a);
    const rx = c * this.lx - s * this.ly, ry = s * this.lx + c * this.ly;
    const dx = this.hand.x - b.x - rx, dy = this.hand.y - b.y - ry;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-9) return;
    const nx = dx / dist, ny = dy / dist;
    const cr = rx * ny - ry * nx;
    const lambda = dist / (b.im + b.ii * cr * cr);
    b.x += nx * lambda * b.im;
    b.y += ny * lambda * b.im;
    b.a += b.ii * cr * lambda;
  }

  finish() {}

  linkedBodies() {
    return null;
  }
}
