// The macro lens. Everything behind the action is enormous and out of focus: blades of grass the
// size of trees, flowers as soft discs of colour, and sunlight breaking up into bokeh.
//
// Blur is cheap here: each far layer is painted small and stretched, which softens it for free and
// works in browsers without canvas filters. Layers tile horizontally for parallax.

const MOODS = {
  dawn: {
    sky: ['#17514f', '#4f8f7c', '#b8c78a', '#f6d68c'],
    sun: { x: 0.78, y: 0.62, color: '255,226,150', size: 0.75 },
    bokeh: ['255,226,150', '255,200,140', '226,240,170'],
    far: '#2b6a5a',
    mid: '#215247',
    near: '#123229',
    flower: ['#f0b8a0', '#f4d78a'],
    shaft: 0.16,
  },
  noon: {
    sky: ['#1d6f7a', '#58a79a', '#b5d8a6', '#eef0b8'],
    sun: { x: 0.28, y: 0.14, color: '255,250,214', size: 0.9 },
    bokeh: ['255,252,220', '216,246,214', '180,232,226'],
    far: '#2f7f70',
    mid: '#22625a',
    near: '#123b35',
    flower: ['#fff2a8', '#f6c6dc'],
    shaft: 0.2,
  },
  dusk: {
    sky: ['#26265a', '#5a4a86', '#b06f86', '#f0a878'],
    sun: { x: 0.2, y: 0.74, color: '255,176,120', size: 0.8 },
    bokeh: ['255,176,120', '220,150,210', '255,226,160'],
    far: '#3a3768',
    mid: '#2b2850',
    near: '#17152f',
    flower: ['#d794c8', '#f2a97a'],
    shaft: 0.12,
  },
};

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Paints with wrap-around so the layer tiles. */
function wrapped(ctx, width, draw) {
  for (const dx of [-width, 0, width]) {
    ctx.save();
    ctx.translate(dx, 0);
    draw();
    ctx.restore();
  }
}

function blade(ctx, x, baseY, height, lean, width, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, baseY);
  ctx.quadraticCurveTo(x - width * 0.3 + lean * 0.3, baseY - height * 0.6, x + lean, baseY - height);
  ctx.quadraticCurveTo(x + width * 0.45 + lean * 0.3, baseY - height * 0.5, x + width / 2, baseY);
  ctx.closePath();
  ctx.fill();
}

function paintSky(mood) {
  const c = makeCanvas(64, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  mood.sky.forEach((color, i) => g.addColorStop(i / (mood.sky.length - 1), color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  return c;
}

function paintBokeh(mood, seed) {
  const W = 512, H = 288;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const r = 5 + rnd() * rnd() * 30;
    const x = rnd() * W, y = r + 2 + rnd() * (H - 2 * r - 4);
    const color = mood.bokeh[Math.floor(rnd() * mood.bokeh.length)];
    const alpha = 0.04 + rnd() * 0.11;
    wrapped(ctx, W, () => {
      // Bokeh discs have firm edges and flat middles: that is what a wide aperture does to points of light.
      ctx.fillStyle = `rgba(${color},${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${color},${alpha * 0.9})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });
  }
  return c;
}

function paintFarPlants(mood, seed) {
  const W = 170, H = 95;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  ctx.globalAlpha = 0.72;
  for (let i = 0; i < 22; i++) {
    const x = rnd() * W;
    const height = 35 + rnd() * 60;
    const lean = (rnd() - 0.5) * 30;
    const width = 4 + rnd() * 6;
    wrapped(ctx, W, () => blade(ctx, x, H, height, lean, width, mood.far));
  }
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < 7; i++) {
    const x = rnd() * W, y = 20 + rnd() * 40, r = 3 + rnd() * 6;
    const color = mood.flower[Math.floor(rnd() * mood.flower.length)];
    wrapped(ctx, W, () => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return c;
}

function paintMidPlants(mood, seed) {
  const W = 330, H = 184;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = seeded(seed);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const height = 56 + rnd() * 114;
    const lean = (rnd() - 0.5) * 52;
    const width = 5 + rnd() * 9;
    ctx.globalAlpha = 0.8 + rnd() * 0.2;
    wrapped(ctx, W, () => blade(ctx, x, H + 4, height, lean, width, mood.mid));
  }
  return c;
}

/** Three shafts of light, painted tiny so that stretching them melts their edges. */
function paintShafts(mood) {
  const W = 96, H = 54;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const sx = W * mood.sun.x;
  for (let i = 0; i < 3; i++) {
    const x0 = sx + (i - 1) * W * 0.17 - H * 0.1;
    const spread = W * (0.035 + i * 0.012);
    const grad = ctx.createLinearGradient(x0, 0, x0 - H * 0.3, H);
    grad.addColorStop(0, `rgba(${mood.sun.color},0.8)`);
    grad.addColorStop(1, `rgba(${mood.sun.color},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0 - spread * 0.4, -2);
    ctx.lineTo(x0 + spread * 0.4, -2);
    ctx.lineTo(x0 - H * 0.32 + spread, H);
    ctx.lineTo(x0 - H * 0.32 - spread, H);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

const built = new Map();

export function backdropFor(moodName) {
  if (built.has(moodName)) return built.get(moodName);
  const mood = MOODS[moodName] ?? MOODS.dawn;
  const set = {
    mood,
    sky: paintSky(mood),
    bokehFar: paintBokeh(mood, 11),
    bokehNear: paintBokeh(mood, 29),
    far: paintFarPlants(mood, 5),
    mid: paintMidPlants(mood, 17),
    shafts: paintShafts(mood),
  };
  built.set(moodName, set);
  return set;
}

/** Draws one tiling layer across the screen with horizontal parallax. */
function tileLayer(ctx, image, viewW, y, drawH, offsetX) {
  const scale = drawH / image.height;
  const drawW = image.width * scale;
  let x = -(((offsetX % drawW) + drawW) % drawW);
  for (; x < viewW; x += drawW) ctx.drawImage(image, x, y, drawW + 1, drawH);
}

/** Everything behind the world, in screen pixels. `horizon` is the screen y of the ground line. */
export function drawBackdrop(ctx, set, viewW, viewH, camX, zoom, horizon, t) {
  const m = set.mood;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(set.sky, 0, 0, viewW, viewH);

  // Sun haze.
  const sx = viewW * m.sun.x - camX * zoom * 0.015;
  const sy = viewH * m.sun.y;
  const radius = Math.max(viewW, viewH) * m.sun.size;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
  glow.addColorStop(0, `rgba(${m.sun.color},0.72)`);
  glow.addColorStop(0.3, `rgba(${m.sun.color},0.24)`);
  glow.addColorStop(1, `rgba(${m.sun.color},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, viewW, viewH);

  const bokehH = viewH * 0.95;
  tileLayer(ctx, set.bokehFar, viewW, 0, bokehH, camX * zoom * 0.04);
  tileLayer(ctx, set.far, viewW, horizon - viewH * 0.72, viewH * 0.74, camX * zoom * 0.1);
  tileLayer(ctx, set.bokehNear, viewW, 0, bokehH * 0.9, camX * zoom * 0.16 + t * 1.5);
  tileLayer(ctx, set.mid, viewW, horizon - viewH * 0.52, viewH * 0.56, camX * zoom * 0.3);

  // Soft shafts of light through the canopy, breathing slowly.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = m.shaft * (0.72 + 0.28 * Math.sin(t * 0.17));
  ctx.drawImage(set.shafts, -camX * zoom * 0.015, 0, viewW * 1.04, viewH);
  ctx.restore();
}

/** Close, dark, blurred stems at the edges of frame: they sell the depth of field. */
export function makeForeground(moodName) {
  const key = `${moodName}|front`;
  if (built.has(key)) return built.get(key);
  const mood = MOODS[moodName] ?? MOODS.dawn;
  const W = 150, H = 85;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = seeded(41);
  const clump = (cx, n) => {
    for (let i = 0; i < n; i++) {
      blade(ctx, cx + (rnd() - 0.5) * 30, H + 2, 18 + rnd() * 50, (rnd() - 0.5) * 22, 2.5 + rnd() * 3.5, mood.near);
    }
  };
  ctx.globalAlpha = 0.8;
  clump(6, 4);
  clump(W - 6, 5);
  built.set(key, c);
  return c;
}

export function drawForeground(ctx, image, viewW, viewH, camX, zoom) {
  const drawW = viewW * 1.3;
  const drawH = viewH * 0.78;
  const x = -viewW * 0.15 - ((camX * zoom * 0.12) % (viewW * 0.06));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, viewH - drawH + viewH * 0.05, drawW, drawH);
}

/** Drifting pollen, in screen pixels. A few dozen specks catching the light. */
export function makePollen(count = 42) {
  const rnd = seeded(77);
  return Array.from({ length: count }, () => ({
    x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.8, speed: 0.004 + rnd() * 0.012, phase: rnd() * 6.28, alpha: 0.25 + rnd() * 0.55,
  }));
}

export function drawPollen(ctx, pollen, viewW, viewH, moodName, t, camX, zoom) {
  const color = MOODS[moodName]?.bokeh[0] ?? '255,240,190';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of pollen) {
    const px = (((p.x + t * p.speed - camX * zoom * 0.00016) % 1) + 1) % 1;
    const py = (((p.y + Math.sin(t * 0.3 + p.phase) * 0.02 - t * p.speed * 0.45) % 1) + 1) % 1;
    const twinkle = 0.55 + 0.45 * Math.sin(t * 1.4 + p.phase * 3);
    ctx.fillStyle = `rgba(${color},${p.alpha * twinkle})`;
    ctx.beginPath();
    ctx.arc(px * viewW, py * viewH * 0.92, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
