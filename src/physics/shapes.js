// Collision shapes. World space has y growing downward, so a positive angle turns clockwise on screen.

export function circle(r) {
  return { kind: 'circle', r, area: Math.PI * r * r, inertiaPerMass: 0.5 * r * r, bound: r };
}

/** Convex polygon. Vertices are re-centred so the body origin is the centroid. */
export function polygon(points) {
  let pts = points.map(([x, y]) => ({ x, y }));
  let doubled = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    doubled += p.x * q.y - q.x * p.y;
  }
  if (doubled < 0) {
    pts.reverse();
    doubled = -doubled;
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  cx /= 3 * doubled;
  cy /= 3 * doubled;
  pts = pts.map(p => ({ x: p.x - cx, y: p.y - cy }));

  const normals = [];
  let inertiaSum = 0, bound = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const len = Math.hypot(ex, ey);
    normals.push({ x: ey / len, y: -ex / len });
    const cross = p.x * q.y - q.x * p.y;
    inertiaSum += cross * (p.x * p.x + p.y * p.y + p.x * q.x + p.y * q.y + q.x * q.x + q.y * q.y);
    bound = Math.max(bound, Math.hypot(p.x, p.y));
  }
  return {
    kind: 'poly',
    verts: pts,
    normals,
    n: pts.length,
    area: doubled / 2,
    inertiaPerMass: inertiaSum / (6 * doubled),
    bound,
    centroid: { x: cx, y: cy },
  };
}

export function box(w, h) {
  const shape = polygon([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]);
  shape.w = w;
  shape.h = h;
  return shape;
}
