import { GameSim } from './game/sim.js';
import { AREAS, LEVELS } from './game/levels.js';
import { TITLE_LEVEL } from './game/title.js';
import { Save } from './game/save.js';
import { Scene } from './render/scene.js';
import { ResolutionGovernor } from './render/resolution.js';
import { Sfx } from './audio/sfx.js';

const $ = id => document.getElementById(id);
const MAX_DPR = 2;
const RESULT_DELAY = 0.75;

/** Where the five dew drops sit on a leaf, as percentages, wandering up the midrib. */
const NODE_SPOTS = [
  [50, 77],
  [36, 62],
  [62, 47],
  [38, 32],
  [58, 17],
];

class App {
  constructor() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.save = new Save();
    this.sfx = new Sfx();
    this.sfx.muted = this.save.muted;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene = null;
    this.mode = 'title';
    this.paused = false;
    this.levelIndex = -1;
    this.resultTimer = -1;
    this.lastResult = null;
    this.tipTimer = 0;
    this.shownScore = -1;
    this.shownTargets = -1;
    this.last = performance.now();
    this.pointerId = null;
    this.governor = new ResolutionGovernor(MAX_DPR);
    this.newBest = false;

    this.bindUi();
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    // The canvas can change size with no window resize: WeChat on iOS applies its safe-area inset
    // after the first layout.
    if (globalThis.ResizeObserver) new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.showTitle();
    requestAnimationFrame(now => this.frame(now));
  }

  /* ---------- screens ---------- */

  setScreen(id) {
    for (const name of ['title', 'map', 'pause', 'result']) $(name).hidden = name !== id;
    $('hud').hidden = !(id === null || id === 'pause' || id === 'result');
    if (id !== null) this.setHint('');
  }

  makeScene(def, mood, isTitle, skipIntro = false) {
    const sim = new GameSim(def);
    const scene = new Scene({
      sim,
      sfx: this.sfx,
      reducedMotion: this.reduced,
      isTitle,
      mood,
      skipIntro,
      onHint: (text, channel) => this.setHint(text, channel),
    });
    scene.onResult = (kind, data) => this.onResult(kind, data);
    scene.resize(this.cssW, this.cssH, this.dpr);
    this.sfx.ambient(mood);
    this.scene = scene;
    this.shownScore = this.shownTargets = -1;
    this.governor.restart();
    return scene;
  }

  showTitle() {
    this.mode = 'title';
    this.paused = false;
    this.resultTimer = -1;
    this.levelIndex = -1;
    this.makeScene(TITLE_LEVEL, 'dawn', true);
    this.setScreen('title');
    const next = this.nextLevelIndex();
    $('btn-play').textContent = next > 0 ? `继续第 ${next + 1} 关` : '开始游戏';
  }

  showMap() {
    this.paused = false;
    this.resultTimer = -1;
    // The title garden plays quietly behind the leaves.
    if (this.levelIndex >= 0) {
      this.levelIndex = -1;
      this.mode = 'title';
      this.makeScene(TITLE_LEVEL, 'dawn', true);
    }
    this.buildMap();
    this.setScreen('map');
    const next = document.querySelector('.node.is-next') ?? document.querySelector('.node:not(:disabled)');
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  isUnlocked(i) {
    return i === 0 || this.save.stars(LEVELS[i - 1].id) > 0;
  }

  /** The first level not yet won, or the last one once everything is done. */
  nextLevelIndex() {
    const i = LEVELS.findIndex(l => this.save.stars(l.id) === 0);
    return i < 0 ? LEVELS.length - 1 : i;
  }

  buildMap() {
    const host = $('leaves');
    host.textContent = '';
    const nextIndex = LEVELS.findIndex(l => this.save.stars(l.id) === 0);
    AREAS.forEach(area => {
      const leaf = document.createElement('div');
      leaf.className = 'leaf';
      leaf.innerHTML = leafSvg(area.mood);
      const levels = LEVELS.filter(l => l.area === area.id);
      const anyOpen = levels.some(l => this.isUnlocked(LEVELS.indexOf(l)));
      if (!anyOpen) leaf.classList.add('is-locked');
      levels.forEach((level, k) => {
        const index = LEVELS.indexOf(level);
        const button = document.createElement('button');
        const stars = this.save.stars(level.id);
        const open = this.isUnlocked(index);
        button.type = 'button';
        button.className = 'node';
        button.disabled = !open;
        if (index === nextIndex) button.classList.add('is-next');
        const [px, py] = NODE_SPOTS[k % NODE_SPOTS.length];
        button.style.left = `${px}%`;
        button.style.top = `${py}%`;
        button.textContent = String(index + 1);
        button.setAttribute('aria-label', open
          ? `第 ${index + 1} 关，${level.name}，${stars > 0 ? `已得 ${stars} 颗花粉` : '还没通过'}`
          : `第 ${index + 1} 关，${level.name}，通过上一关后解锁`);
        button.title = level.name;
        const row = document.createElement('span');
        row.className = 'node-pollen';
        if (open && stars > 0) {
          for (let s = 0; s < 3; s++) {
            const grain = document.createElement('span');
            grain.className = `grain${s < stars ? ' is-on' : ''}`;
            row.append(grain);
          }
        }
        button.append(row);
        button.addEventListener('click', () => {
          this.sfx.unlock();
          this.sfx.play('tap');
          this.startLevel(index);
        });
        leaf.append(button);
      });
      const name = document.createElement('p');
      name.className = 'leaf-name';
      name.textContent = area.name;
      leaf.append(name);
      host.append(leaf);
    });
    $('map-total').textContent = `花粉 ${this.save.totalStars()} / ${LEVELS.length * 3}`;
  }

  startLevel(index, skipIntro = false) {
    this.levelIndex = index;
    this.mode = 'play';
    this.paused = false;
    this.resultTimer = -1;
    this.lastResult = null;
    const def = LEVELS[index];
    const mood = AREAS.find(a => a.id === def.area).mood;
    this.makeScene(def, mood, false, skipIntro);
    this.setScreen(null);
    $('hud-name').textContent = `${index + 1}. ${def.name}`;
    this.setHint(def.tip, 'tip');
    this.tipTimer = 7;
  }

  retry() {
    if (this.levelIndex >= 0) this.startLevel(this.levelIndex, true);
  }

  setPaused(paused) {
    if (this.mode !== 'play' || this.resultTimer >= 0 || !$('result').hidden) return;
    // The level is already won and only waiting to say so. Its pause menu could restart it.
    if (paused && this.scene.sim.isClearing()) return;
    this.paused = paused;
    this.setScreen(paused ? 'pause' : null);
    if (paused) {
      this.cancelPointer();
      this.sfx.stopStretch();
      $('btn-resume').focus();
    }
  }

  onResult(kind) {
    this.resultTimer = RESULT_DELAY;
    this.lastResult = kind;
    this.setHint('');
    // Saved now rather than when the sheet appears: closing the page in that gap must not lose a win.
    if (kind === 'won') {
      const { sim } = this.scene;
      this.newBest = this.save.recordWin(LEVELS[this.levelIndex].id, sim.stars, sim.score);
    }
  }

  showResult() {
    const { sim } = this.scene;
    const def = LEVELS[this.levelIndex];
    const won = this.lastResult === 'won';
    $('result-heading').textContent = won ? '清场了！' : '虫子用完了';
    const stars = $('result-stars');
    stars.textContent = '';
    let note = '';
    if (won) {
      for (let i = 0; i < 3; i++) {
        const grain = document.createElement('span');
        grain.className = `grain${i < sim.stars ? ' is-on' : ''}`;
        stars.append(grain);
        if (i < sim.stars) setTimeout(() => this.sfx.play('star', { index: i }), 220 * i + 80);
      }
      stars.setAttribute('aria-label', `得到 ${sim.stars} 颗花粉`);
      const used = sim.shots;
      note = sim.stars < 3
        ? `这关用 ${def.par} 只虫就能拿满花粉，你用了 ${used} 只。`
        : this.newBest ? '新纪录。' : '';
      $('result-score').textContent = String(sim.score);
    } else {
      const left = sim.targetsLeft();
      stars.removeAttribute('aria-label');
      note = `还差 ${left} 只白蚁。试试打下面的支撑，让堡垒自己塌下来。`;
      $('result-score').textContent = '';
    }
    $('result-note').textContent = note;
    const hasNext = won && this.levelIndex < LEVELS.length - 1;
    $('btn-next').hidden = !hasNext;
    if (won && !hasNext) {
      $('result-heading').textContent = '花园清静了';
      $('result-note').textContent = `蚁后被赶走了。一共拿到 ${this.save.totalStars()} 颗花粉，满分是 ${LEVELS.length * 3} 颗。`;
    }
    $('btn-again').classList.toggle('btn-main', !won);
    $('btn-again').classList.toggle('btn-quiet', won);
    this.setScreen('result');
    (hasNext ? $('btn-next') : $('btn-again')).focus();
  }

  setHint(text, channel = 'tip') {
    const el = $('hint');
    if (channel === 'tip') this.tipTimer = text ? 7 : 0;
    if (!text && channel === 'ability' && this.tipTimer > 0) return;
    if (channel === 'ability' && text) this.tipTimer = 0;
    el.textContent = text;
    el.hidden = !text;
  }

  /* ---------- wiring ---------- */

  bindUi() {
    const click = (id, fn) => $(id).addEventListener('click', event => {
      // A button that has already done its job and gone away must not act again, or a stray
      // second click on "next level" would skip a level.
      if (event.currentTarget.getClientRects().length === 0) return;
      this.sfx.unlock();
      this.sfx.play('tap');
      fn();
    });
    click('btn-play', () => this.startLevel(this.nextLevelIndex()));
    click('btn-levels', () => this.showMap());
    click('btn-map-back', () => this.showTitle());
    click('btn-pause', () => this.setPaused(true));
    click('btn-resume', () => this.setPaused(false));
    click('btn-retry', () => this.retry());
    click('btn-quit', () => this.showMap());
    click('btn-next', () => this.startLevel(this.levelIndex + 1));
    click('btn-again', () => this.retry());
    click('btn-result-map', () => this.showMap());
    click('btn-sound', () => this.toggleSound());
    this.syncSoundButton();
  }

  toggleSound() {
    const muted = !this.save.muted;
    this.save.muted = muted;
    this.sfx.setMuted(muted);
    this.syncSoundButton();
  }

  syncSoundButton() {
    $('btn-sound').textContent = this.save.muted ? '打开声音' : '关闭声音';
  }

  /** Drops whatever the pointer was doing. Unlike letting go, this fires nothing. */
  cancelPointer() {
    this.pointerId = null;
    this.canvas.classList.remove('is-aiming');
    this.scene.pointerCancel();
  }

  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      if (this.pointerId !== null) {
        // A second finger must not disturb an aim, but a thumb resting on the screen to pan must
        // not stop a finger from aiming or using an ability.
        const mode = this.scene.pointer?.mode;
        if (mode === 'aim' || mode === 'grab') return;
        this.scene.pointerCancel();
      }
      this.pointerId = e.pointerId;
      try {
        c.setPointerCapture?.(e.pointerId);
      } catch { /* capture is a nicety: dragging still works while the pointer stays on the canvas */ }
      if (!this.paused) this.scene.pointerDown(e.clientX, e.clientY);
      c.classList.toggle('is-aiming', this.scene.pointer?.mode === 'aim' || this.scene.pointer?.mode === 'grab');
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (e.pointerId === this.pointerId) this.scene.pointerMove(e.clientX, e.clientY);
    });
    c.addEventListener('pointerup', e => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      c.classList.remove('is-aiming');
      this.sfx.unlock(); // on a touch screen a press cannot start audio, only the lift can
      this.scene.pointerUp();
    });
    // A notification pulled down or a phone call takes the gesture away. That is not letting go.
    const cancel = e => {
      if (e.pointerId === this.pointerId) this.cancelPointer();
    };
    c.addEventListener('pointercancel', cancel);
    c.addEventListener('lostpointercapture', cancel);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.scene.wheel(e.deltaY);
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());

    addEventListener('keydown', e => {
      if (e.repeat && !e.code.startsWith('Arrow')) return; // only aiming should run on a held key
      if (e.code === 'Escape') {
        if (this.mode === 'play') this.setPaused(!this.paused);
        return;
      }
      if (e.code === 'KeyM') {
        this.toggleSound();
        return;
      }
      if (e.code === 'KeyR' && this.mode === 'play' && $('result').hidden && !this.scene.sim.isClearing()) {
        this.retry();
        return;
      }
      const overlayOpen = ['title', 'map', 'pause', 'result'].some(id => !$(id).hidden);
      if (overlayOpen || this.paused) return;
      if (this.scene.keyboard(e.code)) e.preventDefault();
    });

    document.addEventListener('visibilitychange', () => {
      this.sfx.setHidden(document.hidden);
      if (document.hidden) {
        this.cancelPointer();
        this.sfx.stopStretch();
        if (this.mode === 'play' && !this.paused && $('result').hidden) this.setPaused(true);
      }
      this.last = performance.now();
    });
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    const dpr = Math.min(this.governor.limit, devicePixelRatio || 1);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.scene?.resize(w, h, dpr);
  }

  /* ---------- the loop ---------- */

  frame(now) {
    requestAnimationFrame(t => this.frame(t));
    const gap = (now - this.last) / 1000;
    const dt = Math.min(0.05, Math.max(0, gap));
    this.last = now;
    if (this.governor.observe(gap)) this.resize();
    const scene = this.scene;
    if (!this.paused) {
      scene.update(dt);
      if (this.tipTimer > 0) {
        this.tipTimer -= dt;
        if (this.tipTimer <= 0) this.setHint('', 'tip');
      }
      if (scene.sim.state === 'aiming' && this.tipTimer > 0) {
        this.tipTimer = 0;
        this.setHint('', 'tip');
      }
      if (this.resultTimer >= 0) {
        this.resultTimer -= dt;
        if (this.resultTimer < 0) this.showResult();
      }
    }
    scene.draw(this.ctx);
    this.updateHud();
  }

  updateHud() {
    if (this.mode !== 'play') return;
    const { sim } = this.scene;
    if (sim.score !== this.shownScore) {
      this.shownScore = sim.score;
      $('hud-score').textContent = String(sim.score);
    }
    if (sim.targetsLeft() !== this.shownTargets) {
      this.shownTargets = sim.targetsLeft();
      $('hud-targets').textContent = String(this.shownTargets);
    }
  }
}

function leafSvg(mood) {
  const tones = {
    dawn: ['#b5d14f', '#6f9a35', '#3d6a28'],
    noon: ['#9fd46c', '#4f9d57', '#2b6b48'],
    dusk: ['#a58cc9', '#5f6a9a', '#32406e'],
  }[mood];
  const id = `leaf-${mood}`;
  const veins = [];
  for (let y = 410; y >= 90; y -= 58) {
    veins.push(`M150 ${y} Q ${150 - 62} ${y - 18} ${150 - 118} ${y - 74}`, `M150 ${y} Q ${150 + 62} ${y - 18} ${150 + 118} ${y - 74}`);
  }
  const outline = 'M150 4 C 248 58 296 170 288 276 C 280 388 208 462 150 500 C 92 462 20 388 12 276 C 4 170 52 58 150 4 Z';
  return `<svg viewBox="0 0 300 520" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tones[0]}"/><stop offset=".52" stop-color="${tones[1]}"/><stop offset="1" stop-color="${tones[2]}"/>
    </linearGradient>
    <clipPath id="${id}-edge"><path d="${outline}"/></clipPath></defs>
    <path d="${outline}" fill="url(#${id})" stroke="rgba(10,32,18,.55)" stroke-width="2"/>
    <path d="M150 8 L150 498" stroke="rgba(250,255,214,.62)" stroke-width="3.4" fill="none"/>
    <path d="${veins.join(' ')}" stroke="rgba(250,255,214,.34)" stroke-width="1.6" fill="none" clip-path="url(#${id}-edge)"/>
    <path d="M150 498 C 150 508 148 514 142 520" stroke="${tones[2]}" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

/** In-app browsers, WeChat above all, would otherwise treat the game as a page they can drag and restyle. */
function settleInAppBrowser() {
  // Only the level map and a sheet on a short screen scroll. Dragging anything else would pull the
  // whole page down and uncover the browser's backdrop ("网页由…提供" in WeChat).
  document.addEventListener('touchmove', e => {
    const scrollable = e.touches.length === 1 && e.target.closest?.('.leaves, .sheet');
    if (e.cancelable && !scrollable) e.preventDefault();
  }, { passive: false });

  // WeChat on Android scales page text by its own font-size setting (iOS is handled in the CSS), so
  // ask it to keep the default. This API is unofficial, and a failure must never stop the game.
  const keepFontSize = () => {
    try {
      const reset = () => globalThis.WeixinJSBridge.invoke('setFontSizeCallback', { fontSize: 0 });
      reset();
      globalThis.WeixinJSBridge.on('menu:setfont', reset);
    } catch { /* not available */ }
  };
  if (typeof globalThis.WeixinJSBridge?.invoke === 'function') keepFontSize();
  else document.addEventListener('WeixinJSBridgeReady', keepFontSize);
}

function showBootFailure(error) {
  console.error(error);
  const note = document.createElement('p');
  note.className = 'noscript';
  note.textContent = '这个浏览器运行不了草丛弹弓，升级系统或换个浏览器试试。';
  document.body.append(note);
}

async function boot() {
  settleInAppBrowser();
  // Title letters are painted once into bitmaps, so the font has to be in place first.
  try {
    await Promise.race([
      document.fonts.load('80px "ZCOOL KuaiLe"', '草丛弹弓'),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  } catch { /* the fallback font still works */ }
  const app = new App();
  if (new URLSearchParams(location.search).has('debug')) globalThis.__game = app;
}

boot().catch(showBootFailure);
