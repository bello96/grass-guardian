// The cast, drawn from code. All of them are round because they have to fly out of a sling:
// the armoured roly-poly curled into a ball, and its friends tucked up tight.
//
// Shell details rotate with the body while the light stays fixed on screen. That mismatch is
// what makes a flat circle read as a ball rolling in the sun.

const TAU = Math.PI * 2;

/** Light from upper left, fixed in screen space. Call with the context at the ball's centre, unrotated. */
function ballLight(ctx, R, strength = 1) {
  const g = ctx.createRadialGradient(-R * 0.36, -R * 0.42, R * 0.08, 0, 0, R * 1.02);
  g.addColorStop(0, `rgba(255,255,255,${0.32 * strength})`);
  g.addColorStop(0.38, `rgba(255,255,255,${0.04 * strength})`);
  g.addColorStop(0.74, 'rgba(0,0,0,0.1)');
  g.addColorStop(1, 'rgba(6,6,28,0.6)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.62 * strength})`;
  ctx.beginPath();
  ctx.ellipse(-R * 0.38, -R * 0.47, R * 0.19, R * 0.1, -0.62, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,200,0.14)';
  ctx.beginPath();
  ctx.ellipse(R * 0.36, R * 0.62, R * 0.34, R * 0.11, -0.5, 0, TAU);
  ctx.fill();
}

/** Round eye with a pupil that looks along (lx, ly), given in the rotated frame. */
function eye(ctx, x, y, r, lx, ly, blink = false, lid = 0) {
  ctx.fillStyle = '#fbfff8';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (blink) {
    ctx.fillStyle = 'rgba(20,16,40,0.9)';
    ctx.fillRect(x - r, y - r * 0.12, r * 2, r * 0.24);
    return;
  }
  ctx.fillStyle = '#17132b';
  ctx.beginPath();
  ctx.arc(x + lx * r * 0.42, y + ly * r * 0.42, r * 0.56, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + lx * r * 0.42 - r * 0.2, y + ly * r * 0.42 - r * 0.22, r * 0.17, 0, TAU);
  ctx.fill();
  if (lid > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 1.02, 0, TAU);
    ctx.clip();
    ctx.fillStyle = eye.lidColor ?? '#7a3a1a';
    ctx.fillRect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2 * lid);
    ctx.restore();
  }
}

/** Turns a world-space direction into the frame of a body rotated by a. */
function intoFrame(dx, dy, a) {
  const c = Math.cos(-a), s = Math.sin(-a);
  const len = Math.hypot(dx, dy) || 1;
  return { x: (c * dx - s * dy) / len, y: (s * dx + c * dy) / len };
}

function antenna(ctx, x0, y0, cx, cy, x1, y1, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cx, cy, x1, y1);
  ctx.stroke();
}

/* ---------- bugs ---------- */

/** State passed to every bug: { a, look: {x, y}, t, squash, stretchDir, mood } */
function squashAndStretch(ctx, o) {
  if (!o.squash) return;
  const dir = o.stretchDir ?? 0;
  ctx.rotate(dir);
  ctx.scale(1 + o.squash, 1 - o.squash * 0.8);
  ctx.rotate(-dir);
}

function drawRoly(ctx, R, o) {
  ctx.save();
  ctx.rotate(o.a);
  const base = ctx.createLinearGradient(-R, 0, R, 0);
  base.addColorStop(0, '#3f3f86');
  base.addColorStop(0.55, '#5b5ba8');
  base.addColorStop(1, '#6b67b8');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Armour plates wrapping the ball.
  for (let i = -3; i <= 2; i++) {
    const cx = i * R * 0.34 + R * 0.06;
    ctx.strokeStyle = 'rgba(16,14,54,0.6)';
    ctx.lineWidth = R * 0.075;
    ctx.beginPath();
    ctx.ellipse(cx, 0, R * 0.36, R * 1.12, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(190,190,255,0.3)';
    ctx.lineWidth = R * 0.035;
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.055, 0, R * 0.36, R * 1.12, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  // The gap where the head tucks in.
  ctx.fillStyle = '#231f4e';
  ctx.beginPath();
  ctx.ellipse(R * 0.72, 0, R * 0.46, R * 0.58, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  const look = intoFrame(o.look?.x ?? 1, o.look?.y ?? 0, o.a);
  const blink = o.mood !== 'fly' && (o.t + (o.seed ?? 0)) % 3.3 < 0.11;
  const wide = o.mood === 'fly' ? 1.18 : o.mood === 'hit' ? 0.7 : 1;
  antenna(ctx, R * 0.74, -R * 0.3, R * 1.02, -R * 0.62, R * 1.16, -R * 0.42, R * 0.05, '#8d88d6');
  antenna(ctx, R * 0.74, R * 0.3, R * 1.02, R * 0.62, R * 1.16, R * 0.42, R * 0.05, '#8d88d6');
  if (o.mood === 'hit') {
    ctx.strokeStyle = '#f3f2ff';
    ctx.lineWidth = R * 0.07;
    for (const y of [-0.24, 0.24]) {
      ctx.beginPath();
      ctx.moveTo(R * 0.56, R * (y - 0.11));
      ctx.lineTo(R * 0.84, R * (y + 0.11));
      ctx.moveTo(R * 0.84, R * (y - 0.11));
      ctx.lineTo(R * 0.56, R * (y + 0.11));
      ctx.stroke();
    }
  } else {
    eye(ctx, R * 0.68, -R * 0.24, R * 0.19 * wide, look.x, look.y, blink);
    eye(ctx, R * 0.68, R * 0.24, R * 0.19 * wide, look.x, look.y, blink);
  }
  ctx.restore();
  ballLight(ctx, R);
}

function drawClicker(ctx, R, o) {
  ctx.save();
  ctx.rotate(o.a);
  ctx.scale(1.14, 0.88);
  const shell = ctx.createLinearGradient(0, -R, 0, R);
  shell.addColorStop(0, '#a4632f');
  shell.addColorStop(0.5, '#7c4420');
  shell.addColorStop(1, '#4e2a15');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Long wing cases, finely grooved.
  ctx.strokeStyle = 'rgba(40,18,6,0.45)';
  ctx.lineWidth = R * 0.03;
  for (let y = -0.8; y <= 0.8; y += 0.2) {
    ctx.beginPath();
    ctx.moveTo(-R, y * R);
    ctx.quadraticCurveTo(0, y * R * 1.22, R * 0.42, y * R * 0.72);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(24,10,3,0.8)';
  ctx.lineWidth = R * 0.075;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(R * 0.42, 0);
  ctx.stroke();
  // Neck plate with its two sharp back corners: the hinge that does the clicking.
  ctx.fillStyle = '#3a2011';
  ctx.beginPath();
  ctx.moveTo(R * 0.42, -R);
  ctx.lineTo(R * 0.3, -R * 0.74);
  ctx.quadraticCurveTo(R * 0.42, 0, R * 0.3, R * 0.74);
  ctx.lineTo(R * 0.42, R);
  ctx.lineTo(R * 1.1, R);
  ctx.lineTo(R * 1.1, -R);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const look = intoFrame(o.look?.x ?? 1, o.look?.y ?? 0, o.a);
  const blink = o.mood !== 'fly' && (o.t + (o.seed ?? 1)) % 2.9 < 0.1;
  // Saw-toothed antennae, a click beetle's signature.
  ctx.strokeStyle = '#d29a5f';
  ctx.lineWidth = R * 0.05;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(R * 0.86, side * R * 0.34);
    for (let i = 1; i <= 4; i++) {
      ctx.lineTo(R * (0.86 + i * 0.1), side * R * (0.34 + i * 0.13 + (i % 2) * 0.09));
    }
    ctx.stroke();
  }
  eye(ctx, R * 0.72, -R * 0.36, R * 0.2, look.x, look.y, blink);
  eye(ctx, R * 0.72, R * 0.36, R * 0.2, look.x, look.y, blink);
  ctx.restore();
  ballLight(ctx, R * 0.98, 0.85);
}

function drawStag(ctx, R, o) {
  ctx.save();
  ctx.rotate(o.a);
  const look = intoFrame(o.look?.x ?? 1, o.look?.y ?? 0, o.a);
  // Great curved jaws in front, drawn first so the head sits on top of them.
  ctx.fillStyle = '#2a1a12';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(R * 0.7, side * R * 0.2);
    ctx.quadraticCurveTo(R * 1.1, side * R * 0.86, R * 1.56, side * R * 0.24);
    ctx.quadraticCurveTo(R * 1.28, side * R * 0.42, R * 1.2, side * R * 0.3);
    ctx.lineTo(R * 1.26, side * R * 0.12);
    ctx.quadraticCurveTo(R * 1.02, side * R * 0.24, R * 0.8, side * R * 0.02);
    ctx.closePath();
    ctx.fill();
  }
  const shell = ctx.createLinearGradient(-R, -R, R, R);
  shell.addColorStop(0, '#4a3a2c');
  shell.addColorStop(0.55, '#2c1f18');
  shell.addColorStop(1, '#17100c');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = R * 0.07;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(R * 0.12, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(R * 0.42, 0, R * 0.3, R * 1.02, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.fillStyle = '#20150f';
  ctx.beginPath();
  ctx.ellipse(R * 0.86, 0, R * 0.38, R * 0.74, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  const blink = (o.t + (o.seed ?? 2)) % 4.1 < 0.12 && o.mood !== 'fly';
  eye(ctx, R * 0.78, -R * 0.42, R * 0.15, look.x, look.y, blink);
  eye(ctx, R * 0.78, R * 0.42, R * 0.15, look.x, look.y, blink);
  ctx.restore();
  ballLight(ctx, R, 0.9);
}

function drawBomber(ctx, R, o) {
  ctx.save();
  ctx.rotate(o.a);
  const look = intoFrame(o.look?.x ?? 1, o.look?.y ?? 0, o.a);
  // Blue-green wing cases over an orange head and neck: the colours a real bombardier wears.
  const shell = ctx.createLinearGradient(-R, 0, R * 0.2, 0);
  shell.addColorStop(0, '#0f4f58');
  shell.addColorStop(1, '#1b7c80');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(2,28,34,0.55)';
  ctx.lineWidth = R * 0.04;
  for (let y = -0.75; y <= 0.75; y += 0.25) {
    ctx.beginPath();
    ctx.moveTo(-R, y * R);
    ctx.lineTo(R * 0.15, y * R * 0.92);
    ctx.stroke();
  }
  const head = ctx.createLinearGradient(R * 0.15, 0, R, 0);
  head.addColorStop(0, '#d9622c');
  head.addColorStop(1, '#f08a3c');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(R * 0.76, 0, R * 0.64, R * 1.08, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // The nozzle at the tail, warm when it is ready to go off.
  const ready = !o.used;
  ctx.fillStyle = ready ? `rgba(255,${150 + 60 * Math.sin(o.t * 7)},70,0.95)` : '#553322';
  ctx.beginPath();
  ctx.ellipse(-R * 0.98, 0, R * 0.14, R * 0.2, 0, 0, TAU);
  ctx.fill();
  const blink = (o.t + (o.seed ?? 3)) % 3.6 < 0.1 && o.mood !== 'fly';
  antenna(ctx, R * 0.86, -R * 0.42, R * 1.14, -R * 0.74, R * 1.26, -R * 0.5, R * 0.05, '#7a3b18');
  antenna(ctx, R * 0.86, R * 0.42, R * 1.14, R * 0.74, R * 1.26, R * 0.5, R * 0.05, '#7a3b18');
  eye(ctx, R * 0.66, -R * 0.3, R * 0.21, look.x, look.y, blink);
  eye(ctx, R * 0.66, R * 0.3, R * 0.21, look.x, look.y, blink);
  ctx.restore();
  ballLight(ctx, R, 0.85);
}

function drawSpider(ctx, R, o) {
  ctx.save();
  ctx.rotate(o.a);
  const look = intoFrame(o.look?.x ?? 1, o.look?.y ?? 0, o.a);
  const spread = o.mood === 'fly' ? 1.34 : 1.14;
  const wiggle = Math.sin(o.t * (o.mood === 'fly' ? 14 : 4)) * 0.05;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3c2f2a';
  ctx.lineWidth = R * 0.095;
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const f = (i % 4) / 3 - 0.5;
    const ang = f * 1.5 + wiggle * (i % 2 ? 1 : -1);
    const kx = Math.cos(ang) * R * 1.02, ky = side * (R * 0.72 + Math.abs(Math.sin(ang)) * R * 0.2);
    const ex = Math.cos(ang) * R * spread * 1.24, ey = side * R * spread * 0.92;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * R * 0.4, side * R * 0.5);
    ctx.quadraticCurveTo(kx, ky * 1.2, ex, ey);
    ctx.stroke();
  }
  const fur = ctx.createRadialGradient(-R * 0.1, 0, R * 0.1, 0, 0, R);
  fur.addColorStop(0, '#a9927a');
  fur.addColorStop(1, '#5a4638');
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  // A pale saddle mark and a fuzzy rim.
  ctx.fillStyle = 'rgba(244,232,206,0.8)';
  ctx.beginPath();
  ctx.moveTo(-R * 0.82, 0);
  ctx.quadraticCurveTo(-R * 0.3, -R * 0.5, R * 0.14, 0);
  ctx.quadraticCurveTo(-R * 0.3, R * 0.5, -R * 0.82, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,50,36,0.55)';
  ctx.lineWidth = R * 0.025;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94);
    ctx.lineTo(Math.cos(a + 0.05) * R * 1.07, Math.sin(a + 0.05) * R * 1.07);
    ctx.stroke();
  }
  // Two big front eyes and the small ones spiders are known for.
  const blink = (o.t + (o.seed ?? 4)) % 3.9 < 0.1 && o.mood !== 'fly';
  eye(ctx, R * 0.56, -R * 0.26, R * 0.26, look.x, look.y, blink);
  eye(ctx, R * 0.56, R * 0.26, R * 0.26, look.x, look.y, blink);
  ctx.fillStyle = '#17132b';
  for (const [x, y] of [[0.36, -0.62], [0.36, 0.62], [0.72, -0.62], [0.72, 0.62]]) {
    ctx.beginPath();
    ctx.arc(R * x, R * y, R * 0.075, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ballLight(ctx, R, 0.6);
}

const BUG_DRAW = { roly: drawRoly, clicker: drawClicker, stag: drawStag, bomber: drawBomber, spider: drawSpider };

export function drawBug(ctx, type, x, y, R, o) {
  ctx.save();
  ctx.translate(x, y);
  squashAndStretch(ctx, o);
  BUG_DRAW[type](ctx, R, o);
  ctx.restore();
}

/* ---------- termites ---------- */

function termiteLegs(ctx, R, f, t, awake) {
  ctx.strokeStyle = '#9c6a3c';
  ctx.lineWidth = R * 0.075;
  ctx.lineCap = 'round';
  const step = awake ? Math.sin(t * 12) * R * 0.05 : 0;
  for (let i = 0; i < 3; i++) {
    const x = f * R * (-0.34 + i * 0.3);
    ctx.beginPath();
    ctx.moveTo(x, R * 0.42);
    ctx.lineTo(x - f * R * 0.14 + (i % 2 ? step : -step), R * 0.96);
    ctx.stroke();
  }
}

function drawWorker(ctx, R, o) {
  const f = o.face;
  termiteLegs(ctx, R, f, o.t, o.awake);
  // Pale soft body behind the big head.
  const belly = ctx.createRadialGradient(-f * R * 0.5, -R * 0.08, R * 0.05, -f * R * 0.42, R * 0.12, R * 0.76);
  belly.addColorStop(0, '#fbf2dc');
  belly.addColorStop(1, '#d7bb8d');
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(-f * R * 0.42, R * 0.14, R * 0.68, R * 0.56, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,108,64,0.5)';
  ctx.lineWidth = R * 0.04;
  for (let i = 0; i < 3; i++) {
    const x = -f * R * (0.28 + i * 0.26);
    ctx.beginPath();
    ctx.moveTo(x, -R * 0.26);
    ctx.quadraticCurveTo(x - f * R * 0.08, R * 0.16, x, R * 0.62);
    ctx.stroke();
  }
  drawTermiteHead(ctx, f * R * 0.24, -R * 0.1, R * 0.72, o, '#c4602b', '#8a3c17');
}

function drawSoldier(ctx, R, o) {
  const f = o.face;
  termiteLegs(ctx, R, f, o.t, o.awake);
  const belly = ctx.createRadialGradient(-f * R * 0.5, -R * 0.08, R * 0.05, -f * R * 0.42, R * 0.12, R * 0.74);
  belly.addColorStop(0, '#f1e0bf');
  belly.addColorStop(1, '#c29c68');
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(-f * R * 0.46, R * 0.2, R * 0.6, R * 0.5, 0, 0, TAU);
  ctx.fill();
  drawTermiteHead(ctx, f * R * 0.18, -R * 0.14, R * 0.84, o, '#7f2f14', '#4d1a08', true);
}

function drawTermiteHead(ctx, x, y, r, o, light, dark, soldier = false) {
  const f = o.face;
  ctx.save();
  ctx.translate(x, y);
  // Mandibles: the first thing you notice, and how you tell a soldier apart.
  ctx.fillStyle = soldier ? '#21100a' : '#54250e';
  const reach = soldier ? 1.62 : 1.26;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(f * r * 0.74, side * r * 0.2 + r * 0.18);
    ctx.quadraticCurveTo(f * r * 1.14, side * r * 0.5 + r * 0.14, f * r * reach, r * 0.2);
    ctx.quadraticCurveTo(f * r * 1.08, side * r * 0.14 + r * 0.16, f * r * 0.8, r * 0.18);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.08, 0, 0, r * 1.05);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, soldier ? r * 1.04 : r, r * (soldier ? 0.94 : 1), 0, 0, TAU);
  ctx.fill();
  if (soldier) {
    // A hard crest down the middle of the head.
    ctx.strokeStyle = 'rgba(255,200,150,0.3)';
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(-f * r * 0.8, -r * 0.42);
    ctx.quadraticCurveTo(0, -r * 0.82, f * r * 0.72, -r * 0.3);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, -r * 0.5, r * 0.22, r * 0.11, -0.5, 0, TAU);
  ctx.fill();

  const look = o.look ?? { x: f, y: 0 };
  const scared = o.scared ?? 0;
  const eyeR = r * (0.26 + scared * 0.08);
  const ex = f * r * 0.34;
  eye.lidColor = dark;
  const hurt = o.hurt > 0 || o.hp < 0.4;
  if (o.hurt > 0) {
    // Screwed-up eyes while the hit lands.
    ctx.strokeStyle = '#fff4e0';
    ctx.lineWidth = r * 0.09;
    ctx.lineCap = 'round';
    for (const e of [ex - r * 0.3, ex + r * 0.3]) {
      ctx.beginPath();
      ctx.moveTo(e - eyeR, -r * 0.24);
      ctx.lineTo(e, -r * 0.1);
      ctx.lineTo(e + eyeR, -r * 0.24);
      ctx.stroke();
    }
  } else {
    // Half-lidded and pleased with themselves, until something comes flying.
    const lid = scared > 0.3 ? 0 : soldier ? 0.5 : 0.36;
    eye(ctx, ex - r * 0.3, -r * 0.16, eyeR, look.x, look.y, false, lid);
    eye(ctx, ex + r * 0.3, -r * 0.16, eyeR, look.x, look.y, false, lid);
  }
  if (hurt) {
    ctx.strokeStyle = 'rgba(40,10,0,0.7)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(-f * r * 0.62, r * 0.05);
    ctx.lineTo(-f * r * 0.34, r * 0.28);
    ctx.lineTo(-f * r * 0.5, r * 0.46);
    ctx.stroke();
  }
  ctx.restore();
}

function drawQueen(ctx, R, o) {
  const f = o.face;
  // She is mostly abdomen: a great pale banded sac.
  const sac = ctx.createRadialGradient(-f * R * 0.3, -R * 0.36, R * 0.08, 0, 0, R * 1.06);
  sac.addColorStop(0, '#fff8e8');
  sac.addColorStop(0.7, '#ecd6ad');
  sac.addColorStop(1, '#bc9666');
  ctx.fillStyle = sac;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(146,98,52,0.46)';
  ctx.lineWidth = R * 0.05;
  for (let i = -3; i <= 3; i++) {
    const x = i * R * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, -R * 1.1);
    ctx.quadraticCurveTo(x + f * R * 0.18, 0, x, R * 1.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.36, -R * 0.52, R * 0.2, R * 0.1, -0.5, 0, TAU);
  ctx.fill();
  drawTermiteHead(ctx, f * R * 0.62, -R * 0.54, R * 0.42, o, '#b55326', '#6f2c0f');
  // A crown of twigs stuck together with resin.
  ctx.save();
  ctx.translate(f * R * 0.62, -R * 0.94);
  ctx.strokeStyle = '#5e3b1d';
  ctx.lineWidth = R * 0.05;
  ctx.lineCap = 'round';
  for (const lean of [-0.5, -0.2, 0.1, 0.42]) {
    ctx.beginPath();
    ctx.moveTo(lean * R * 0.28, R * 0.03);
    ctx.lineTo(lean * R * 0.5, -R * 0.2);
    ctx.stroke();
  }
  ctx.fillStyle = '#e8b04a';
  for (const lean of [-0.5, 0.1, 0.42]) {
    ctx.beginPath();
    ctx.arc(lean * R * 0.5, -R * 0.22, R * 0.05, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawTermite(ctx, type, x, y, a, R, o) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  if (type === 'queen') drawQueen(ctx, R, o);
  else if (type === 'soldier') drawSoldier(ctx, R, o);
  else drawWorker(ctx, R, o);
  ctx.restore();
}

/* ---------- things in the garden ---------- */

export function drawPod(ctx, x, y, a, R, t, jitter) {
  ctx.save();
  ctx.translate(x + (jitter ? Math.sin(t * 40) * 0.8 : 0), y);
  ctx.rotate(a + Math.sin(t * 3 + x) * 0.03);
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R * 1.2);
  g.addColorStop(0, '#d9e97c');
  g.addColorStop(0.65, '#8fb23f');
  g.addColorStop(1, '#4f7523');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -R * 1.18);
  ctx.bezierCurveTo(R * 1.16, -R * 0.7, R * 1.1, R * 0.82, 0, R * 0.98);
  ctx.bezierCurveTo(-R * 1.1, R * 0.82, -R * 1.16, -R * 0.7, 0, -R * 1.18);
  ctx.fill();
  // Seams under tension: a touch-me-not pod is about to coil open along these.
  ctx.strokeStyle = 'rgba(50,80,20,0.7)';
  ctx.lineWidth = R * 0.05;
  for (const k of [-0.56, 0, 0.56]) {
    ctx.beginPath();
    ctx.moveTo(0, -R * 1.1);
    ctx.quadraticCurveTo(R * k * 1.5, 0, 0, R * 0.92);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70,46,20,0.5)';
  for (const [sx, sy] of [[-0.42, -0.1], [0.38, 0.14], [-0.3, 0.48], [0.28, -0.42]]) {
    ctx.beginPath();
    ctx.ellipse(R * sx, R * sy, R * 0.12, R * 0.18, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,230,0.55)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.36, -R * 0.54, R * 0.15, R * 0.08, -0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawDew(ctx, x, y, R, sx = 1, sy = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  // A water drop bends light: dark on the sunny side, bright on the far one.
  const body = ctx.createLinearGradient(-R * 0.4, -R, R * 0.4, R);
  body.addColorStop(0, 'rgba(36,86,96,0.62)');
  body.addColorStop(0.5, 'rgba(140,210,214,0.3)');
  body.addColorStop(1, 'rgba(236,255,250,0.78)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,255,250,0.55)';
  ctx.lineWidth = R * 0.06;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.34, -R * 0.42, R * 0.2, R * 0.12, -0.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(R * 0.3, R * 0.5, R * 0.08, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawMushroom(ctx, body, squash) {
  const r = body.shape.r;
  const stalk = body.ent.stalk;
  const groundY = body.y + r * 0.35 + stalk;
  ctx.save();
  // The stalk.
  ctx.translate(body.x, groundY);
  const s = ctx.createLinearGradient(-r * 0.24, 0, r * 0.24, 0);
  s.addColorStop(0, '#f4ecd4');
  s.addColorStop(1, '#b9a57e');
  ctx.fillStyle = s;
  ctx.beginPath();
  ctx.moveTo(-r * 0.27, 0);
  ctx.quadraticCurveTo(-r * 0.17, -stalk * 0.6, -r * 0.2, -stalk);
  ctx.lineTo(r * 0.2, -stalk);
  ctx.quadraticCurveTo(r * 0.17, -stalk * 0.6, r * 0.27, 0);
  ctx.closePath();
  ctx.fill();
  // The cap gives under a hit and springs back.
  ctx.translate(0, -stalk - r * 0.35);
  ctx.scale(1 + squash * 0.22, 1 - squash * 0.3);
  ctx.fillStyle = '#d58d3e';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.34, r * 0.98, r * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,20,0.65)';
  ctx.lineWidth = r * 0.025;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.03, r * 0.36);
    ctx.lineTo(i * r * 0.115, r * 0.56);
    ctx.stroke();
  }
  const cap = ctx.createRadialGradient(-r * 0.3, -r * 0.5, r * 0.1, 0, -r * 0.1, r * 1.1);
  cap.addColorStop(0, '#f2e6ff');
  cap.addColorStop(0.55, '#b59ad8');
  cap.addColorStop(1, '#6b4f9a');
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI * 1.02, -Math.PI * 0.02);
  ctx.quadraticCurveTo(r * 0.9, r * 0.42, 0, r * 0.4);
  ctx.quadraticCurveTo(-r * 0.9, r * 0.42, -r * 0.999, r * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.36, -r * 0.54, r * 0.26, r * 0.1, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Half a forked twig: the back prong goes behind the bug, the front prong in front of it. */
export function drawForkPart(ctx, sling, part, t) {
  const r = sling.rest;
  const baseY = 0;
  const tip = part === 'back' ? sling.tipR : sling.tipL;
  const crotchY = r.y + 58;
  ctx.lineCap = 'round';
  if (part === 'back') {
    const bark = ctx.createLinearGradient(r.x - 22, 0, r.x + 22, 0);
    bark.addColorStop(0, '#6b4a2c');
    bark.addColorStop(1, '#2f2013');
    ctx.strokeStyle = bark;
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(r.x + 6, baseY + 8);
    ctx.quadraticCurveTo(r.x - 4, (baseY + crotchY) / 2, r.x, crotchY);
    ctx.stroke();
  }
  ctx.strokeStyle = part === 'back' ? '#3e2b19' : '#7a5533';
  ctx.lineWidth = part === 'back' ? 14 : 15;
  ctx.beginPath();
  ctx.moveTo(r.x, crotchY);
  ctx.quadraticCurveTo(tip.x * 0.7 + r.x * 0.3, crotchY - 26, tip.x, tip.y + 4);
  ctx.stroke();
  if (part === 'front') {
    ctx.strokeStyle = 'rgba(255,220,170,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r.x - 4, crotchY - 4);
    ctx.quadraticCurveTo(tip.x * 0.7 + r.x * 0.3 - 2, crotchY - 28, tip.x - 3, tip.y + 6);
    ctx.stroke();
    // A leaf bud, because this is a living twig.
    ctx.save();
    ctx.translate(r.x - 10, crotchY + 22);
    ctx.rotate(-2.3 + Math.sin(t * 1.3) * 0.08);
    ctx.fillStyle = '#6f9a3a';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(10, -8, 26, 0);
    ctx.quadraticCurveTo(10, 8, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  // Silk knot where the band ties on.
  ctx.fillStyle = '#efe7d4';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 5.5, 0, TAU);
  ctx.fill();
}

/** Draws a line through points as one smooth curve. Physics uses few nodes; the eye never knows. */
export function smoothPath(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function silkStrand(ctx, pts, width, alpha = 1) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  smoothPath(ctx, pts);
  ctx.strokeStyle = `rgba(60,50,40,${0.28 * alpha})`;
  ctx.lineWidth = width + 1.4;
  ctx.stroke();
  ctx.strokeStyle = `rgba(246,240,224,${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke();
}
