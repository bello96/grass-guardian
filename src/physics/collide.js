// Narrow phase. Fills `hit` with up to two contacts. The normal points from B toward A,
// and (ax, ay) / (bx, by) are the touching points on the surface of A and B.
// Pair order is normalised by the world: a circle is always A when the pair is mixed.

export const hit = {
  count: 0,
  nx: 0,
  ny: 0,
  ax: [0, 0],
  ay: [0, 0],
  bx: [0, 0],
  by: [0, 0],
};

function circleCircle(A, B, margin) {
  const ra = A.shape.r, rb = B.shape.r;
  let dx = A.x - B.x, dy = A.y - B.y;
  const dist = Math.hypot(dx, dy);
  if (dist > ra + rb + margin) return 0;
  if (dist < 1e-9) {
    dx = 0;
    dy = -1;
  } else {
    dx /= dist;
    dy /= dist;
  }
  hit.nx = dx;
  hit.ny = dy;
  hit.ax[0] = A.x - dx * ra;
  hit.ay[0] = A.y - dy * ra;
  hit.bx[0] = B.x + dx * rb;
  hit.by[0] = B.y + dy * rb;
  return (hit.count = 1);
}

function circlePoly(A, B, margin) {
  const r = A.shape.r, n = B.shape.n;
  const cx = A.x, cy = A.y;
  let best = -Infinity, edge = 0;
  for (let i = 0; i < n; i++) {
    const s = (cx - B.wx[i]) * B.wnx[i] + (cy - B.wy[i]) * B.wny[i];
    if (s > r + margin) return 0;
    if (s > best) {
      best = s;
      edge = i;
    }
  }
  const i2 = (edge + 1) % n;
  const v1x = B.wx[edge], v1y = B.wy[edge], v2x = B.wx[i2], v2y = B.wy[i2];
  let nx, ny, px, py;
  if (best <= 0) {
    // Centre is inside the polygon: push out through the nearest face.
    nx = B.wnx[edge];
    ny = B.wny[edge];
    px = cx - nx * best;
    py = cy - ny * best;
  } else {
    const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
    const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
    if (u1 <= 0 || u2 <= 0) {
      px = u1 <= 0 ? v1x : v2x;
      py = u1 <= 0 ? v1y : v2y;
      const dx = cx - px, dy = cy - py;
      const dist = Math.hypot(dx, dy);
      if (dist > r + margin || dist < 1e-9) return 0;
      nx = dx / dist;
      ny = dy / dist;
    } else {
      nx = B.wnx[edge];
      ny = B.wny[edge];
      px = cx - nx * best;
      py = cy - ny * best;
    }
  }
  hit.nx = nx;
  hit.ny = ny;
  hit.ax[0] = cx - nx * r;
  hit.ay[0] = cy - ny * r;
  hit.bx[0] = px;
  hit.by[0] = py;
  return (hit.count = 1);
}

let sepResult = 0;
let edgeResult = 0;

function maxSeparation(P, Q, margin) {
  let best = -Infinity, edge = 0;
  const n = P.shape.n, m = Q.shape.n;
  for (let i = 0; i < n; i++) {
    const nx = P.wnx[i], ny = P.wny[i], vx = P.wx[i], vy = P.wy[i];
    let min = Infinity;
    for (let j = 0; j < m; j++) {
      const d = (Q.wx[j] - vx) * nx + (Q.wy[j] - vy) * ny;
      if (d < min) min = d;
    }
    if (min > best) {
      best = min;
      edge = i;
    }
    if (best > margin) break;
  }
  sepResult = best;
  edgeResult = edge;
}

const clipX = [0, 0];
const clipY = [0, 0];

function polyPoly(A, B, margin) {
  maxSeparation(A, B, margin);
  if (sepResult > margin) return 0;
  const sepA = sepResult, edgeA = edgeResult;
  maxSeparation(B, A, margin);
  if (sepResult > margin) return 0;
  const sepB = sepResult, edgeB = edgeResult;

  // Prefer A as the reference so the choice does not flicker between nearly equal axes.
  const flip = sepB > sepA + 0.02;
  const R = flip ? B : A;
  const Q = flip ? A : B;
  const e = flip ? edgeB : edgeA;
  const rn = R.shape.n, qn = Q.shape.n;

  const nx = R.wnx[e], ny = R.wny[e];
  const v1x = R.wx[e], v1y = R.wy[e];
  const v2x = R.wx[(e + 1) % rn], v2y = R.wy[(e + 1) % rn];
  let tx = v2x - v1x, ty = v2y - v1y;
  const tl = Math.hypot(tx, ty);
  tx /= tl;
  ty /= tl;

  // Incident edge: the one facing most directly against the reference normal.
  let incident = 0, minDot = Infinity;
  for (let i = 0; i < qn; i++) {
    const dot = Q.wnx[i] * nx + Q.wny[i] * ny;
    if (dot < minDot) {
      minDot = dot;
      incident = i;
    }
  }
  clipX[0] = Q.wx[incident];
  clipY[0] = Q.wy[incident];
  clipX[1] = Q.wx[(incident + 1) % qn];
  clipY[1] = Q.wy[(incident + 1) % qn];

  // Clip the incident edge to the two side planes of the reference edge.
  const lo = v1x * tx + v1y * ty;
  const hi = v2x * tx + v2y * ty;
  for (let pass = 0; pass < 2; pass++) {
    const sign = pass === 0 ? 1 : -1;
    const limit = pass === 0 ? lo : -hi;
    const d0 = sign * (clipX[0] * tx + clipY[0] * ty) - limit;
    const d1 = sign * (clipX[1] * tx + clipY[1] * ty) - limit;
    if (d0 < 0 && d1 < 0) return 0;
    if (d0 < 0 || d1 < 0) {
      const t = d0 / (d0 - d1);
      const ix = clipX[0] + (clipX[1] - clipX[0]) * t;
      const iy = clipY[0] + (clipY[1] - clipY[0]) * t;
      if (d0 < 0) {
        clipX[0] = ix;
        clipY[0] = iy;
      } else {
        clipX[1] = ix;
        clipY[1] = iy;
      }
    }
  }

  // The world expects the normal from B toward A.
  hit.nx = flip ? nx : -nx;
  hit.ny = flip ? ny : -ny;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const px = clipX[i], py = clipY[i];
    const sep = (px - v1x) * nx + (py - v1y) * ny;
    if (sep > margin) continue;
    // p lies on the incident body; its projection onto the reference edge lies on the reference body.
    const qx = px - nx * sep, qy = py - ny * sep;
    if (flip) {
      hit.ax[count] = px;
      hit.ay[count] = py;
      hit.bx[count] = qx;
      hit.by[count] = qy;
    } else {
      hit.ax[count] = qx;
      hit.ay[count] = qy;
      hit.bx[count] = px;
      hit.by[count] = py;
    }
    count++;
  }
  return (hit.count = count);
}

export function collide(A, B, margin = 0) {
  hit.count = 0;
  const ka = A.shape.kind, kb = B.shape.kind;
  if (ka === 'circle') return kb === 'circle' ? circleCircle(A, B, margin) : circlePoly(A, B, margin);
  return polyPoly(A, B, margin);
}
