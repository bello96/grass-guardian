// Debris, dust, rings and score pop-ups. Purely visual: nothing here feeds back into the physics,
// so it can be as lavish as a frame allows without changing how a shot plays out.

const TAU = Math.PI * 2;
const MAX_PARTS = 520;
const GRAVITY = 520;

const DEBRIS = {
  twig: { kind: 'splinter', colors: ['#a5784a', '#6e4a26', '#d4ad78', '#4f3419'], speed: 240, gravity: 1, life: 1.1, size: [7, 18], width: [2, 3.5] },
  leaf: { kind: 'shred', colors: ['#a7c84a', '#7fa436', '#d5e27a'], speed: 150, gravity: 0.3, life: 1.8, size: [5, 11], width: [3, 7] },
  honey: { kind: 'shard', colors: ['rgba(255,214,100,0.92)', 'rgba(236,154,40,0.86)', 'rgba(255,240,190,0.9)'], speed: 330, gravity: 1, life: 0.95, size: [4, 11], width: [3, 7] },
  pebble: { kind: 'chip', colors: ['#9aa5a9', '#6d797e', '#c6cdce', '#4f5a60'], speed: 210, gravity: 1.15, life: 1.05, size: [4, 11], width: [3, 8] },
};

const puffCache = new Map();

function puffSprite(rgb) {
  if (puffCache.has(rgb)) return puffCache.get(rgb);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${rgb},0.85)`);
  g.addColorStop(0.5, `rgba(${rgb},0.34)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffCache.set(rgb, c);
  return c;
}

export class Fx {
  constructor() {
    this.parts = [];
    this.puffs = [];
    this.rings = [];
    this.popups = [];
    this.threads = [];
    this.flashes = [];
  }

  clear() {
    this.parts.length = this.puffs.length = this.rings.length = 0;
    this.popups.length = this.threads.length = this.flashes.length = 0;
  }

  part(p) {
    if (this.parts.length >= MAX_PARTS) this.parts.shift();
    this.parts.push(p);
  }

  /** Bits flung from a point, biased along (vx, vy). */
  burst(mat, x, y, count, vx = 0, vy = 0, power = 1) {
    const spec = DEBRIS[mat];
    if (!spec) return;
    for (let i = 0; i < count; i++) {
      const dir = Math.random() * TAU;
      const speed = spec.speed * power * (0.25 + Math.random());
      this.part({
        kind: spec.kind,
        color: spec.colors[Math.floor(Math.random() * spec.colors.length)],
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(dir) * speed + vx * 0.45,
        vy: Math.sin(dir) * speed + vy * 0.45 - speed * 0.25,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 18,
        len: spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]),
        wid: spec.width[0] + Math.random() * (spec.width[1] - spec.width[0]),
        gravity: spec.gravity,
        drag: spec.kind === 'shred' ? 2.2 : 0.5,
        life: spec.life * (0.6 + Math.random() * 0.6),
        age: 0,
        sway: spec.kind === 'shred' ? Math.random() * TAU : 0,
      });
    }
  }

  /** A whole piece coming apart: debris spreads over its length, not from one spot. */
  shatter(mat, x, y, w, h, angle, vx, vy) {
    const area = w * h;
    const count = Math.min(46, Math.round(8 + area / 110));
    const c = Math.cos(angle), s = Math.sin(angle);
    const spec = DEBRIS[mat];
    if (!spec) return;
    for (let i = 0; i < count; i++) {
      const lx = (Math.random() - 0.5) * w, ly = (Math.random() - 0.5) * h;
      this.burst(mat, x + c * lx - s * ly, y + s * lx + c * ly, 1, vx, vy, 0.8);
    }
    this.puff(x, y, Math.min(46, Math.max(w, h) * 0.45), mat === 'twig' ? '214,190,150' : mat === 'pebble' ? '190,194,190' : mat === 'honey' ? '255,226,150' : '200,224,130', 0.42);
  }

  droplets(x, y, count, speed = 200, up = 0.6, r = 2.4) {
    for (let i = 0; i < count; i++) {
      const dir = Math.random() * TAU;
      const v = speed * (0.3 + Math.random());
      this.part({
        kind: 'drop',
        color: 'rgba(226,250,246,0.9)',
        x, y,
        vx: Math.cos(dir) * v,
        vy: Math.sin(dir) * v - v * up,
        rot: 0, spin: 0,
        len: r * (0.6 + Math.random()),
        wid: 0,
        gravity: 1,
        drag: 0.2,
        life: 0.8 + Math.random() * 0.5,
        age: 0,
        sway: 0,
      });
    }
  }

  seeds(x, y, count) {
    for (let i = 0; i < count; i++) {
      const dir = Math.random() * TAU;
      const v = 240 + Math.random() * 520;
      this.part({
        kind: Math.random() < 0.25 ? 'coil' : 'seed',
        color: Math.random() < 0.7 ? '#3f2b18' : '#9cc04a',
        x, y,
        vx: Math.cos(dir) * v,
        vy: Math.sin(dir) * v - 120,
        rot: dir, spin: (Math.random() - 0.5) * 22,
        len: 4 + Math.random() * 5,
        wid: 3,
        gravity: 1,
        drag: 0.9,
        life: 0.8 + Math.random() * 0.9,
        age: 0,
        sway: 0,
      });
    }
  }

  sawdust(x, y, count, spread = 18) {
    for (let i = 0; i < count; i++) {
      const dir = Math.random() * TAU;
      const v = 40 + Math.random() * 240;
      this.part({
        kind: 'chip',
        color: ['#f1dfbb', '#d4a56c', '#c4602b', '#fbf2dc'][Math.floor(Math.random() * 4)],
        x: x + Math.cos(dir) * spread * Math.random(),
        y: y + Math.sin(dir) * spread * Math.random(),
        vx: Math.cos(dir) * v,
        vy: Math.sin(dir) * v - 110,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 16,
        len: 2.5 + Math.random() * 4.5,
        wid: 2 + Math.random() * 3,
        gravity: 0.8,
        drag: 1.1,
        life: 0.9 + Math.random() * 0.5,
        age: 0,
        sway: 0,
      });
    }
  }

  puff(x, y, size, rgb = '236,226,196', alpha = 0.5, vx = 0, vy = -18, life = 0.7) {
    this.puffs.push({ x, y, size, grow: size * 1.3, rgb, alpha, vx, vy, age: 0, life });
  }

  ring(x, y, radius, rgb = '255,240,190', life = 0.36, width = 5) {
    this.rings.push({ x, y, radius, rgb, life, width, age: 0 });
  }

  flash(x, y, radius, rgb = '255,250,225', life = 0.1) {
    this.flashes.push({ x, y, radius, rgb, life, age: 0 });
  }

  popup(text, x, y, big = false) {
    this.popups.push({ text, x, y, age: 0, life: big ? 1.3 : 1, big });
  }

  /** A loose thread that drifts away and fades, left when silk snaps or lets go. */
  thread(points) {
    if (points.length >= 2) this.threads.push({ points: points.map(p => ({ ...p })), age: 0, life: 1.6 });
  }

  update(dt) {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + GRAVITY * p.gravity * dt;
      if (p.kind === 'shred') p.vx += Math.sin(p.age * 7 + p.sway) * 150 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.y > 0 && p.y < 60 && p.vy > 0) {
        if (p.kind === 'drop') {
          parts.splice(i, 1);
          continue;
        }
        p.y = 0;
        p.vy *= -0.32;
        p.vx *= 0.55;
        p.spin *= 0.5;
      }
    }
    for (const list of [this.puffs, this.rings, this.flashes, this.popups, this.threads]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.age += dt;
        if (e.age >= e.life) list.splice(i, 1);
      }
    }
    for (const p of this.puffs) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (const th of this.threads) {
      for (const pt of th.points) pt.y += 60 * dt;
    }
  }

  draw(ctx) {
    for (const p of this.puffs) {
      const u = p.age / p.life;
      const size = p.size + p.grow * u;
      ctx.globalAlpha = p.alpha * (1 - u) * (1 - u);
      ctx.drawImage(puffSprite(p.rgb), p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;

    for (const th of this.threads) {
      const u = th.age / th.life;
      ctx.strokeStyle = `rgba(246,240,224,${0.8 * (1 - u)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      th.points.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
    }

    for (const p of this.parts) {
      const fade = p.age > p.life * 0.7 ? 1 - (p.age - p.life * 0.7) / (p.life * 0.3) : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case 'drop': {
          const stretch = Math.min(2.2, 1 + Math.hypot(p.vx, p.vy) / 500);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.beginPath();
          ctx.ellipse(0, 0, p.len * stretch, p.len, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'seed':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.len, p.len * 0.62, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        case 'coil':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(0, 0, p.len, 0, TAU * 0.8);
          ctx.stroke();
          ctx.restore();
          break;
        case 'shard':
        case 'chip':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-p.len / 2, -p.wid / 2);
          ctx.lineTo(p.len / 2, -p.wid * 0.1);
          ctx.lineTo(-p.len * 0.1, p.wid / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        case 'shred':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.len, p.wid * (0.45 + 0.55 * Math.abs(Math.sin(p.age * 9 + p.sway))), 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        default:
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.len / 2, -p.wid / 2, p.len, p.wid);
          ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    for (const f of this.flashes) {
      const u = f.age / f.life;
      ctx.fillStyle = `rgba(${f.rgb},${0.85 * (1 - u)})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius * (0.7 + 0.6 * u), 0, TAU);
      ctx.fill();
    }
    for (const r of this.rings) {
      const u = r.age / r.life;
      const eased = 1 - (1 - u) * (1 - u);
      ctx.strokeStyle = `rgba(${r.rgb},${0.8 * (1 - u)})`;
      ctx.lineWidth = r.width * (1 - u) + 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * eased, 0, TAU);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const u = p.age / p.life;
      const rise = (1 - (1 - u) * (1 - u)) * (p.big ? 70 : 46);
      const pop = u < 0.14 ? 0.5 + (u / 0.14) * 0.62 : 1.12 - Math.min(0.12, (u - 0.14) * 0.6);
      const size = (p.big ? 40 : 25) * pop;
      ctx.font = `${size}px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.globalAlpha = u > 0.72 ? 1 - (u - 0.72) / 0.28 : 1;
      ctx.lineWidth = size * 0.2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(30,24,14,0.85)';
      ctx.strokeText(p.text, p.x, p.y - rise);
      ctx.fillStyle = p.big ? '#ffe28a' : '#fff6da';
      ctx.fillText(p.text, p.x, p.y - rise);
    }
    ctx.globalAlpha = 1;
  }
}
