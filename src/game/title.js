// The title screen is a playable toy: the name hangs on silk and the sling is already loaded.

export const TITLE_LEVEL = {
  id: 'title',
  name: '草丛弹弓',
  width: 1700,
  bugs: ['roly'],
  endless: true,
  sling: { x: 400, h: 185 },
  build(b) {
    const letters = [
      ['草', 760, 450],
      ['丛', 925, 370],
      ['弹', 1090, 430],
      ['弓', 1255, 355],
    ];
    for (const [label, x, base] of letters) b.tag(x, base, label, 1040);
  },
};
