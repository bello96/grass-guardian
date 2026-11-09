// Block textures, painted once per size and damage stage and cached as bitmaps.
// Every piece keeps its own grain because the painter is seeded by the piece's size.

const SCALE = 2; // sprites are painted at twice world resolution so they stay sharp when zoomed

const cache = new Map();

function seeded(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ---------- materials: each paints inside the current clip path, in a w x h box centred on 0 ---------- */

function paintTwig(ctx, w, h, rnd) {
  const across = h >= w; // upright plank: grain runs vertically
  const g = across ? ctx.createLinearGradient(-w / 2, 0, w / 2, 0) : ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, '#a5784a');
  g.addColorStop(0.4, '#855c34');
  g.addColorStop(1, '#4f3419');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const length = Math.max(w, h), thick = Math.min(w, h);
  // Bark grain follows the long axis.
  for (let i = 0; i < Math.max(8, thick * 0.7); i++) {
    const offset = (rnd() - 0.5) * thick;
    const start = (rnd() - 0.5) * length;
    const span = length * (0.2 + rnd() * 0.5);
    ctx.strokeStyle = rnd() < 0.7 ? `rgba(44,26,10,${0.2 + rnd() * 0.3})` : `rgba(226,186,130,${0.1 + rnd() * 0.18})`;
    ctx.lineWidth = 0.5 + rnd() * 1.1;
    ctx.beginPath();
    const wob = (rnd() - 0.5) * 3;
    if (across) {
      ctx.moveTo(offset, start);
      ctx.quadraticCurveTo(offset + wob, start + span / 2, offset, start + span);
    } else {
      ctx.moveTo(start, offset);
      ctx.quadraticCurveTo(start + span / 2, offset + wob, start + span, offset);
    }
    ctx.stroke();
  }
  // A knot or two.
  const knots = Math.floor(length / 110) + (rnd() < 0.5 ? 1 : 0);
  for (let i = 0; i < knots; i++) {
    const p = (rnd() - 0.5) * length * 0.8;
    const q = (rnd() - 0.5) * thick * 0.4;
    const kx = across ? q : p, ky = across ? p : q;
    ctx.fillStyle = 'rgba(46,28,12,0.55)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, across ? thick * 0.2 : thick * 0.3, across ? thick * 0.3 : thick * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(214,170,116,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Pale sawn ends.
  ctx.fillStyle = 'rgba(232,202,152,0.75)';
  if (across) {
    ctx.fillRect(-w / 2, -h / 2, w, 3.5);
    ctx.fillRect(-w / 2, h / 2 - 3.5, w, 3.5);
  } else {
    ctx.fillRect(-w / 2, -h / 2, 3.5, h);
    ctx.fillRect(w / 2 - 3.5, -h / 2, 3.5, h);
  }
}

function paintLeaf(ctx, w, h, rnd) {
  const across = h >= w;
  const length = Math.max(w, h), thick = Math.min(w, h);
  ctx.save();
  if (across) ctx.rotate(Math.PI / 2);
  const g = ctx.createLinearGradient(0, -thick / 2, 0, thick / 2);
  g.addColorStop(0, '#b5d14f');
  g.addColorStop(0.5, '#86ad36');
  g.addColorStop(1, '#4f7a25');
  ctx.fillStyle = g;
  ctx.fillRect(-length / 2, -thick / 2, length, thick);
  // Sun coming through the blade.
  const glow = ctx.createLinearGradient(-length / 2, 0, length / 2, 0);
  glow.addColorStop(0, 'rgba(255,236,120,0.42)');
  glow.addColorStop(0.45, 'rgba(255,236,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-length / 2, -thick / 2, length, thick);
  ctx.strokeStyle = 'rgba(232,245,170,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.lineTo(length / 2, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,240,150,0.5)';
  ctx.lineWidth = 0.7;
  for (let x = -length / 2 + 8; x < length / 2; x += 11 + rnd() * 5) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 6, -thick / 2);
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 6, thick / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintHoney(ctx, w, h, rnd) {
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, 'rgba(255,218,110,0.96)');
  g.addColorStop(0.45, 'rgba(238,158,44,0.86)');
  g.addColorStop(1, 'rgba(176,92,18,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // Bubbles caught in the crystal.
  const bubbles = Math.floor((w * h) / 320) + 2;
  for (let i = 0; i < bubbles; i++) {
    const r = 0.8 + rnd() * 2.6;
    const x = (rnd() - 0.5) * w * 0.86, y = (rnd() - 0.5) * h * 0.86;
    ctx.fillStyle = 'rgba(255,240,190,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Inner facets.
  ctx.strokeStyle = 'rgba(255,240,190,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h * 0.1);
  ctx.lineTo(w * 0.1, -h / 2);
  ctx.moveTo(w * 0.2, h / 2);
  ctx.lineTo(w / 2, -h * 0.1);
  ctx.stroke();
  // Bright top edge.
  const edge = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 + Math.min(10, h * 0.3));
  edge.addColorStop(0, 'rgba(255,250,214,0.9)');
  edge.addColorStop(1, 'rgba(255,250,214,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(-w / 2, -h / 2, w, Math.min(10, h * 0.3));
}

function paintPebble(ctx, w, h, rnd) {
  const g = ctx.createLinearGradient(-w * 0.3, -h / 2, w * 0.3, h / 2);
  g.addColorStop(0, '#b7c0c2');
  g.addColorStop(0.5, '#808c91');
  g.addColorStop(1, '#4f5a60');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const specks = Math.floor((w * h) / 26);
  for (let i = 0; i < specks; i++) {
    const dark = rnd() < 0.6;
    ctx.fillStyle = dark ? `rgba(36,44,50,${0.1 + rnd() * 0.3})` : `rgba(240,244,240,${0.08 + rnd() * 0.3})`;
    const r = 0.4 + rnd() * 1.2;
    ctx.beginPath();
    ctx.arc((rnd() - 0.5) * w, (rnd() - 0.5) * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A pale mineral vein.
  ctx.strokeStyle = 'rgba(232,236,230,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const y0 = (rnd() - 0.5) * h;
  ctx.moveTo(-w / 2, y0);
  ctx.quadraticCurveTo((rnd() - 0.5) * w, (rnd() - 0.5) * h, w / 2, (rnd() - 0.5) * h);
  ctx.stroke();
  // Moss in the shade of its underside would be hidden; moss on the top catches the light.
  ctx.fillStyle = 'rgba(112,146,60,0.65)';
  for (let x = -w / 2; x < w / 2; x += 3 + rnd() * 5) {
    if (rnd() < 0.42) {
      ctx.beginPath();
      ctx.ellipse(x, -h / 2 + 1, 2 + rnd() * 3, 1.2 + rnd() * 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const PAINTERS = { twig: paintTwig, leaf: paintLeaf, honey: paintHoney, pebble: paintPebble };
const CORNERS = { twig: 2.5, leaf: 6, honey: 3, pebble: 9 };

function paintCracks(ctx, w, h, rnd, stage, mat) {
  const color = mat === 'honey' ? 'rgba(255,250,220,0.85)' : 'rgba(18,10,4,0.75)';
  const paths = stage === 1 ? 2 : 5;
  for (let i = 0; i < paths; i++) {
    let x = (rnd() - 0.5) * w * 0.8;
    let y = (rnd() - 0.5) * h * 0.8;
    const dir = rnd() * Math.PI * 2;
    const reach = Math.min(40, Math.max(w, h) * (stage === 1 ? 0.22 : 0.4));
    ctx.strokeStyle = color;
    ctx.lineWidth = stage === 1 ? 1 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += Math.cos(dir + (rnd() - 0.5) * 1.3) * (reach / 4);
      y += Math.sin(dir + (rnd() - 0.5) * 1.3) * (reach / 4);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** A piece's picture, centred on the piece: { image, drawW, drawH } with sizes in world units. */
export function blockSprite(body) {
  const mat = body.ent.mat;
  const stage = body.ent.hp > 0.66 ? 0 : body.ent.hp > 0.33 ? 1 : 2;
  const { w, h } = body.shape;
  const key = `${mat}|${w.toFixed(1)}|${h.toFixed(1)}|${stage}`;
  let sprite = cache.get(key);
  if (sprite) return sprite;

  const canvas = makeCanvas(Math.ceil(w * SCALE) + 4, Math.ceil(h * SCALE) + 4);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.translate(w / 2 + 1, h / 2 + 1);
  const rnd = seeded(`${mat}|${w.toFixed(1)}|${h.toFixed(1)}`);
  ctx.save();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, CORNERS[mat]);
  ctx.clip();
  PAINTERS[mat](ctx, w, h, rnd);
  if (stage > 0) paintCracks(ctx, w, h, seeded(`${key}crack`), stage, mat);
  ctx.restore();
  // Outline so a piece stays readable against a busy background.
  roundRectPath(ctx, -w / 2, -h / 2, w, h, CORNERS[mat]);
  ctx.strokeStyle = mat === 'honey' ? 'rgba(120,62,10,0.7)' : mat === 'leaf' ? 'rgba(46,78,20,0.8)' : 'rgba(26,18,10,0.6)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  sprite = { image: canvas, drawW: canvas.width / SCALE, drawH: canvas.height / SCALE };
  cache.set(key, sprite);
  return sprite;
}

/** A tile of soil, repeated along the ground. */
export function soilTile() {
  const key = 'soil';
  if (cache.has(key)) return cache.get(key);
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a281c';
  ctx.fillRect(0, 0, size, size);
  const rnd = seeded('soil');
  for (let i = 0; i < 900; i++) {
    const r = 0.5 + rnd() * 2.6;
    const light = rnd() < 0.45;
    ctx.fillStyle = light ? `rgba(120,90,60,${0.08 + rnd() * 0.22})` : `rgba(14,8,4,${0.1 + rnd() * 0.3})`;
    const x = rnd() * size, y = rnd() * size;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size;
    ctx.fillStyle = `rgba(140,126,110,${0.15 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rnd() * 5, 1.5 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  cache.set(key, canvas);
  return canvas;
}

/** A strip of moss, tufts and tiny sprouts to run along the top of the ground. Tiles horizontally. */
export function mossStrip() {
  const key = 'moss';
  if (cache.has(key)) return cache.get(key);
  const w = 1024, h = 80;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rnd = seeded('moss');
  const baseY = 46;
  const grad = ctx.createLinearGradient(0, baseY - 16, 0, baseY + 22);
  grad.addColorStop(0, '#7ea03a');
  grad.addColorStop(0.5, '#587a2a');
  grad.addColorStop(1, 'rgba(50,60,24,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, baseY - 2, w, 26);
  const each = (x, draw) => {
    draw(x);
    if (x < 60) draw(x + w);
    if (x > w - 60) draw(x - w);
  };
  for (let i = 0; i < 620; i++) {
    const x = rnd() * w;
    const r = 2.4 + rnd() * 5.5;
    const light = rnd();
    const color = light < 0.3 ? '#a7c24e' : light < 0.7 ? '#739635' : '#4d6d26';
    const y = baseY - rnd() * 4;
    each(x, px => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Sprouts and thread-thin grass: huge up close, as everything is down here.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const tall = 8 + rnd() * 24;
    const lean = (rnd() - 0.5) * 12;
    const color = rnd() < 0.5 ? '#9cbf48' : '#6c9436';
    const width = 1 + rnd() * 1.6;
    each(x, px => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, baseY);
      ctx.quadraticCurveTo(px + lean * 0.3, baseY - tall * 0.6, px + lean, baseY - tall);
      ctx.stroke();
    });
  }
  const strip = { canvas, baseY };
  cache.set(key, strip);
  return strip;
}

/** A big leaf with one title character on it. */
export function tagSprite(label, w, h) {
  const key = `tag|${label}|${w}|${h}`;
  if (cache.has(key)) return cache.get(key);
  const pad = 6;
  const canvas = makeCanvas((w + pad * 2) * SCALE, (h + pad * 2) * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.translate(w / 2 + pad, h / 2 + pad);
  const rnd = seeded(label);
  const hw = w / 2, hh = h / 2;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.bezierCurveTo(hw * 0.72, -hh, hw, -hh * 0.6, hw, -hh * 0.1);
    ctx.bezierCurveTo(hw, hh * 0.5, hw * 0.5, hh * 0.86, 0, hh);
    ctx.bezierCurveTo(-hw * 0.5, hh * 0.86, -hw, hh * 0.5, -hw, -hh * 0.1);
    ctx.bezierCurveTo(-hw, -hh * 0.6, -hw * 0.72, -hh, 0, -hh);
    ctx.closePath();
  };
  outline();
  const fill = ctx.createLinearGradient(-hw, -hh, hw, hh);
  fill.addColorStop(0, '#b9d758');
  fill.addColorStop(0.5, '#7fa838');
  fill.addColorStop(1, '#42702b');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(236,246,170,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, hh);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (let y = -hh * 0.72; y < hh * 0.8; y += 22 + rnd() * 6) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(side * hw * 0.5, y - 4, side * hw, y - 32);
      ctx.stroke();
    }
  }
  const sun = ctx.createRadialGradient(-hw * 0.4, -hh * 0.5, 4, -hw * 0.4, -hh * 0.5, hw * 1.2);
  sun.addColorStop(0, 'rgba(255,246,170,0.5)');
  sun.addColorStop(1, 'rgba(255,246,170,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(-hw, -hh, w, h);
  ctx.restore();
  outline();
  ctx.strokeStyle = 'rgba(30,54,16,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const size = Math.min(w, h) * 0.66;
  ctx.font = `${size}px "ZCOOL KuaiLe", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(24,46,20,0.9)';
  ctx.strokeText(label, 0, hh * 0.08);
  ctx.fillStyle = '#fff8dc';
  ctx.fillText(label, 0, hh * 0.08);

  const sprite = { image: canvas, drawW: w + pad * 2, drawH: h + pad * 2 };
  cache.set(key, sprite);
  return sprite;
}
