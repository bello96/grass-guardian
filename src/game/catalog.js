// Everything tunable about the cast and materials. Impulses are mass * speed in world units:
// a roly bug at full speed delivers about 500 to a light target and about 1200 to a heavy wall.
// A hit does (impulse - threshold) / strength of damage, and a thing breaks when its hp (1) runs out.
//
// A collapsing fort lands a run of hits of 40 to 150 on the termites inside, not one big one, so their
// thresholds sit low enough for those to add up. Setting them above that range makes a fort that falls
// on its occupants harmless, and then the only way to kill is a direct hit.

export const MATERIALS = {
  leaf: { density: 0.22, friction: 0.7, restitution: 0.04, threshold: 18, strength: 85, refund: 0.9, score: 40 },
  twig: { density: 0.55, friction: 0.65, restitution: 0.08, threshold: 55, strength: 330, refund: 0.6, score: 120 },
  honey: { density: 1.0, friction: 0.3, restitution: 0.12, threshold: 35, strength: 130, refund: 0.8, score: 160 },
  pebble: { density: 2.2, friction: 0.75, restitution: 0.06, threshold: 340, strength: 1700, refund: 0.25, score: 300 },
};

export const TERMITES = {
  worker: { radius: 20, density: 0.7, threshold: 55, strength: 115, score: 1000 },
  soldier: { radius: 25, density: 0.9, threshold: 110, strength: 400, score: 2000 },
  queen: { radius: 62, density: 0.8, threshold: 260, strength: 3400, score: 8000 },
};

export const PROPS = {
  pod: { radius: 20, density: 0.5, friction: 0.5, restitution: 0.2, threshold: 20, strength: 120, score: 200 },
  dew: { density: 0.45, friction: 0.15, restitution: 0.35, threshold: 6, strength: 40, score: 80 },
};

export const BLAST = { radius: 230, impulse: 1150 };

// Bugs wait their turn on the ground, far enough back to stay clear of a full pull.
export const QUEUE_START = 225;
export const QUEUE_GAP = 58;

// A bug's speed off the sling comes from the band physics: light bugs fly fast, heavy bugs fly short.
export const BUGS = {
  roly: {
    name: '滚滚',
    radius: 24,
    density: 1,
    friction: 0.75,
    restitution: 0.25,
    rollDrag: 0.45,
    airDrag: 1 / 16000,
    crush: 1,
    ability: null,
    hint: '落地后会一路滚过去',
  },
  clicker: {
    name: '咔哒',
    radius: 21,
    density: 0.95,
    friction: 0.6,
    restitution: 0.3,
    rollDrag: 1.2,
    airDrag: 1 / 16000,
    crush: 1,
    ability: 'click',
    hint: '飞行中点一下：空中再跳一次',
  },
  stag: {
    name: '大颚',
    radius: 29,
    density: 1.2,
    friction: 0.8,
    restitution: 0.12,
    rollDrag: 2.5,
    airDrag: 1 / 20000,
    crush: 1.5,
    ability: 'slam',
    hint: '飞行中点一下：垂直砸下去',
  },
  bomber: {
    name: '炮炮',
    radius: 24,
    density: 1,
    friction: 0.7,
    restitution: 0.2,
    rollDrag: 1.5,
    airDrag: 1 / 16000,
    crush: 1,
    ability: 'jet',
    hint: '飞行中点一下：向前喷出气浪',
  },
  spider: {
    name: '蛛蛛',
    radius: 22,
    density: 0.8,
    friction: 0.8,
    restitution: 0.2,
    rollDrag: 2,
    airDrag: 1 / 16000,
    crush: 1,
    ability: 'silk',
    hint: '飞行中点一个地方：射出蛛丝，再点一下松开',
  },
};
