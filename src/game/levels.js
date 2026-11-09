// Fifteen levels across three places in the garden. Heights are measured up from the ground.
// Each level teaches one thing, then a later one asks for it again in a harder spot.

const SLING = { x: 400, h: 185 };

/** Two silk lines holding a plank level, with whatever stands on it counted as extra load. */
function hungPlank(b, x, base, length, anchorHeight, standing = [], mat = 'twig', thick = 18) {
  const plank = b.beam(x, base, length, mat, thick);
  const carries = (plank.m + standing.reduce((sum, s) => sum + s.m, 0)) / 2;
  for (const side of [-1, 1]) {
    const lx = side * (length / 2 - 12);
    b.hangFrom(x + lx, anchorHeight, plank, { local: { x: lx, y: -thick / 2 }, carries });
  }
  return plank;
}

export const AREAS = [
  { id: 'slope', name: '落叶坡', mood: 'dawn' },
  { id: 'creek', name: '卵石滩', mood: 'noon' },
  { id: 'thicket', name: '蛛网林', mood: 'dusk' },
];

export const LEVELS = [
  /* ---------- 落叶坡 ---------- */
  {
    id: 'first-hit',
    area: 'slope',
    name: '第一下',
    tip: '按住滚滚向后拉，松手发射。拉得越远飞得越快。',
    width: 1900,
    bugs: ['roly', 'roly', 'roly'],
    par: 1,
    sling: SLING,
    build(b) {
      const top = b.frame(1020, 0, 130, 100);
      b.termite(1020, top);
    },
  },
  {
    id: 'under-eaves',
    area: 'slope',
    name: '屋檐下',
    tip: '枯枝一撞就断，断开后滚滚还能接着往前冲。',
    width: 2000,
    bugs: ['roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      const top = b.frame(1060, 0, 170, 108);
      b.termite(1060, 0);
      b.beam(1060, top, 240, 'leaf', 12);
      b.termite(1060, top + 12);
    },
  },
  {
    id: 'three-floors',
    area: 'slope',
    name: '三层小楼',
    tip: '打下面比打上面更划算：楼塌了，上面的白蚁自己就摔下来了。',
    width: 2100,
    bugs: ['roly', 'roly', 'roly', 'roly'],
    par: 3,
    sling: SLING,
    build(b) {
      const slim = { postWidth: 14 };
      const f1 = b.frame(1090, 0, 150, 96, 'twig', slim);
      b.termite(1090, 0);
      const f2 = b.frame(1090, f1, 126, 86, 'twig', slim);
      b.termite(1090, f1);
      const f3 = b.frame(1090, f2, 102, 76, 'twig', slim);
      b.termite(1090, f2);
      b.beam(1090, f3, 130, 'leaf', 12);
    },
  },
  {
    id: 'downhill',
    area: 'slope',
    name: '翻过土坡',
    tip: '正面打不到？让滚滚落在坡的另一面，它自己会滚下去。',
    width: 2200,
    bugs: ['roly', 'roly', 'roly', 'roly'],
    par: 3,
    sling: SLING,
    build(b) {
      b.hill(760, 1330, 190, 90);
      b.termite(1395, 0);
      b.post(1485, 0, 70, 'leaf', 12);
      b.frame(1570, 0, 110, 70, 'leaf', { postWidth: 12, thick: 12 });
      b.termite(1570, 0);
    },
  },
  {
    id: 'meet-clicker',
    area: 'slope',
    name: '咔哒登场',
    tip: '咔哒飞在半空时点一下屏幕，它会再跳一次，翻过那堵高墙。',
    width: 2200,
    bugs: ['clicker', 'clicker', 'roly'],
    par: 1,
    sling: SLING,
    build(b) {
      b.block(1120, 0, 44, 360, 'pebble');
      const top = b.frame(1340, 0, 120, 170);
      b.termite(1340, top);
      b.termite(1340, 0);
    },
  },

  /* ---------- 卵石滩 ---------- */
  {
    id: 'stubborn-stone',
    area: 'creek',
    name: '石头不听话',
    tip: '大颚很重，飞不远但砸得狠。飞到目标上方时点一下，直接砸下去。',
    width: 1800,
    bugs: ['stag', 'stag', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      const top = b.frame(860, 0, 124, 92, 'pebble', { postWidth: 34, thick: 34, overhang: 40 });
      b.termite(860, 0, 'soldier');
      b.termite(860, top);
    },
  },
  {
    id: 'honey-house',
    area: 'creek',
    name: '蜜晶小屋',
    tip: '蜜晶很脆，撞碎后几乎不减速，一颗虫能穿过好几面墙。',
    width: 2100,
    bugs: ['roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      const opts = { postWidth: 26, thick: 22 };
      const a = b.frame(1120, 0, 124, 88, 'honey', opts);
      b.termite(1120, 0);
      const c = b.frame(1300, 0, 124, 88, 'honey', opts);
      b.termite(1300, 0);
      b.beam(1210, a, 320, 'twig');
      b.termite(1140, Math.max(a, c) + 18);
      b.termite(1280, Math.max(a, c) + 18);
    },
  },
  {
    id: 'bounce',
    area: 'creek',
    name: '蹦一下',
    tip: '蘑菇伞会把东西弹回去。石檐下面打不到，就先借它弹一下。',
    width: 2300,
    bugs: ['roly', 'roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      b.rock([[1290, 150], [1900, 150], [1900, 215], [1270, 200]]);
      b.block(1880, 0, 40, 150, 'pebble');
      b.mushroom(1020, 0, 62);
      b.block(1170, 0, 40, 82, 'pebble');
      b.termite(1420, 0);
      b.termite(1600, 0);
    },
  },
  {
    id: 'creekside',
    area: 'creek',
    name: '小溪边',
    tip: '白蚁不会游泳。把它们撞进水里也算。',
    width: 2300,
    bugs: ['roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      b.water(1200, 1450);
      const left = b.frame(1120, 0, 110, 116);
      b.termite(1120, left);
      b.termite(1120, 0);
      const right = b.frame(1560, 0, 130, 100);
      b.termite(1560, right);
      b.block(1620, right, 40, 40, 'pebble');
    },
  },
  {
    id: 'popper',
    area: 'creek',
    name: '爆裂荚',
    tip: '炮炮飞行中点一下，向前喷出气浪。凤仙荚一碰就炸，还会连环炸。',
    width: 2200,
    bugs: ['bomber', 'roly', 'roly'],
    par: 1,
    sling: SLING,
    build(b) {
      b.post(1190, 0, 120, 'pebble', 30);
      b.post(1420, 0, 120, 'pebble', 30);
      b.beam(1305, 120, 300, 'pebble', 26);
      b.pod(1250, 0);
      b.pod(1360, 0);
      b.termite(1305, 0, 'soldier');
      b.termite(1305, 146);
      b.pod(1130, 0);
    },
  },

  /* ---------- 蛛网林 ---------- */
  {
    id: 'hanging',
    area: 'thicket',
    name: '吊着的',
    tip: '蛛丝可以撞断。断了一根，吊板就歪了。',
    width: 2300,
    bugs: ['roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      b.branch(980, 1760, 640, 40);
      const t1 = b.termite(1120, 348);
      hungPlank(b, 1120, 330, 210, 620, [t1]);
      const t2 = b.termite(1420, 238);
      hungPlank(b, 1420, 220, 210, 620, [t2]);
      b.termite(1270, 0);
    },
  },
  {
    id: 'wrecking',
    area: 'thicket',
    name: '大摆锤',
    tip: '大石头靠两根丝吊着。撞断左边那根，它就会荡进白蚁窝。',
    width: 2300,
    bugs: ['roly', 'roly', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      b.branch(720, 1480, 720, 40);
      const stone = b.block(1020, 250, 76, 76, 'pebble');
      const tiedAt = 250 + 76;
      const alpha = Math.atan2(1020 - 760, 700 - tiedAt); // left line, from vertical
      const beta = Math.atan2(1390 - 1020, 700 - tiedAt); // right line, from vertical
      const share = Math.sin(alpha + beta);
      b.hangFrom(760, 700, stone, { carries: (stone.m * Math.sin(beta)) / share, breakAt: 14 });
      b.hangFrom(1390, 700, stone, { carries: (stone.m * Math.sin(alpha)) / share, breakAt: 14 });
      const top = b.frame(1430, 0, 130, 110);
      b.termite(1430, top);
      b.termite(1430, 0);
      const far = b.frame(1570, 0, 100, 110);
      b.termite(1570, far);
    },
  },
  {
    id: 'meet-spider',
    area: 'thicket',
    name: '蛛蛛登场',
    tip: '蛛蛛飞行中，点树枝射丝荡过去，再点一下松手。',
    width: 2300,
    bugs: ['spider', 'spider', 'roly'],
    par: 2,
    sling: SLING,
    build(b) {
      b.branch(880, 1420, 690, 40);
      b.rock([[1230, -6], [1900, -6], [1900, 300], [1300, 300]]);
      b.block(1370, 300, 30, 130, 'pebble');
      b.termite(1470, 300);
      b.termite(1600, 300);
      b.post(1680, 300, 90, 'twig');
    },
  },
  {
    id: 'swing-over',
    area: 'thicket',
    name: '荡过去',
    tip: '这面墙翻不过去，那就抓着头顶的树枝荡过去。蛛丝也能勾住木块，把它扯下来。',
    width: 2500,
    bugs: ['spider', 'spider', 'clicker', 'spider'],
    par: 3,
    sling: SLING,
    build(b) {
      b.branch(980, 1500, 760, 40);
      b.block(1460, 0, 50, 520, 'pebble');
      const top = b.frame(1720, 0, 140, 120);
      b.termite(1720, 0);
      b.termite(1720, top);
      const t = b.termite(1960, 278);
      hungPlank(b, 1960, 260, 170, 700, [t]);
      b.branch(1860, 2080, 716, 30);
    },
  },
  {
    id: 'queen',
    area: 'thicket',
    name: '蚁后的王座',
    tip: '蚁后皮很厚。把头顶那块大石头放下来，或者把炸药荚全引爆。',
    width: 2600,
    bugs: ['roly', 'clicker', 'stag', 'bomber', 'spider'],
    par: 4,
    sling: SLING,
    build(b) {
      b.branch(1500, 2020, 700, 40);
      // the queen's chamber
      b.post(1500, 0, 170, 'pebble', 34);
      b.post(1880, 0, 170, 'pebble', 34);
      b.beam(1690, 170, 440, 'twig', 22);
      b.termite(1690, 0, 'queen');
      b.pod(1560, 0);
      b.pod(1820, 0);
      // upper guard post
      const f = b.frame(1690, 192, 180, 90, 'honey', { postWidth: 24, thick: 20 });
      b.termite(1690, 192, 'soldier');
      b.termite(1690, f);
      // the stone above her, on one line of silk
      const stone = b.block(1690, 450, 110, 80, 'pebble');
      b.hangFrom(1690, 700, stone, { breakAt: 10 });
      // outworks
      b.block(1330, 0, 40, 200, 'pebble');
      b.termite(1200, 0);
      const out = b.frame(1200, 0, 110, 90);
      b.beam(1200, out, 150, 'leaf', 12);
    },
  },
];
