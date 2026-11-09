/** First body hit by a ray. (dx, dy) must be a unit vector. `skip` filters bodies out. */
export function raycast(bodies, ox, oy, dx, dy, maxDist, skip) {
  let best = null;
  let bestT = maxDist;
  for (const b of bodies) {
    if (skip?.(b)) continue;
    let t = Infinity;
    if (b.shape.kind === 'circle') {
      const fx = ox - b.x, fy = oy - b.y;
      const q = fx * dx + fy * dy;
      const c = fx * fx + fy * fy - b.shape.r * b.shape.r;
      const disc = q * q - c;
      if (disc >= 0) {
        const root = -q - Math.sqrt(disc);
        if (root >= 0) t = root;
      }
    } else {
      const n = b.shape.n;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = b.wx[j] - b.wx[i], ey = b.wy[j] - b.wy[i];
        const denom = dx * ey - dy * ex;
        if (Math.abs(denom) < 1e-12) continue;
        const ax = b.wx[i] - ox, ay = b.wy[i] - oy;
        const hitT = (ax * ey - ay * ex) / denom;
        const u = (ax * dy - ay * dx) / denom;
        if (hitT >= 0 && u >= 0 && u <= 1 && hitT < t) t = hitT;
      }
    }
    if (t < bestT) {
      bestT = t;
      best = b;
    }
  }
  return best ? { body: best, x: ox + dx * bestT, y: oy + dy * bestT, dist: bestT } : null;
}
