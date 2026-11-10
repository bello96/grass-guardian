// Opens the game in real browser engines and checks it there: the page loads with its font, a real tap or
// click starts a level, a real mouse drag aims and fires, the interface checks in tools/page-checks.mjs
// pass, and every sound renders through the engine's own Web Audio without going silent or clipping.
//
//   node tools/browser-check.mjs                     start the local server, check chrome, webkit and firefox
//   node tools/browser-check.mjs --url=https://grass-guardian.dengjiabei.cn/    check the deployed site instead
//   node tools/browser-check.mjs --browsers=webkit,firefox
//   node tools/browser-check.mjs --out=shots         where screenshots go (default: a folder in the system temp)
//
// Each engine stands in for where people play:
//   chrome   Android phones, WeChat included (its XWeb is built on Chromium). Uses the Google Chrome installed here.
//   webkit   iPhones, WeChat included (iOS makes every browser use the system WebKit). Playwright ships the newest
//            WebKit, not the one on an older iPhone, and its Windows build has no Web Audio.
//   firefox  desktop, with a mouse.
// Needs `npm install`, and for webkit and firefox `npx playwright-core install webkit firefox`.
//
// Remote pages go through HTTPS_PROXY or HTTP_PROXY when one is set, except NO_PROXY hosts. Headless frame
// rates say nothing about phones: on Windows, WebKit draws in software at about 13 fps.
// Exits with 1 when an engine fails a check or cannot start.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE_LEVEL } from '../src/game/title.js';
import { bootReport, bugOnScreen, frameRate, nextFrames, uiChecks, waitForCamera } from './page-checks.mjs';
import { renderSounds } from './page-sounds.mjs';

const here = fileURLToPath(import.meta.url);

export const BROWSERS = ['chrome', 'webkit', 'firefox'];

const PROFILES = {
  chrome: { engine: 'chromium', channel: 'chrome', phone: true },
  webkit: { engine: 'webkit', phone: true },
  firefox: { engine: 'firefox', phone: false },
};
/** A phone held sideways, or a desktop window. */
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 720 } };

/** Quieter than this with the compressor running, as in play, a sound counts as not playing. */
const SILENT_DB = -60;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseArgs(argv) {
  const options = { url: undefined, browsers: [...BROWSERS], out: path.join(os.tmpdir(), 'grass-guardian-browser-check') };
  for (const arg of argv) {
    const [, key, value] = arg.match(/^--(url|browsers|out)=(.+)$/) ?? [];
    if (!key) throw new Error(`unknown option ${arg}`);
    if (key === 'browsers') {
      options.browsers = value.split(',').filter(Boolean);
      const unknown = options.browsers.filter(name => !BROWSERS.includes(name));
      if (unknown.length) throw new Error(`unknown browser ${unknown.join(', ')}: pick from ${BROWSERS.join(', ')}`);
    } else {
      options[key] = value;
    }
  }
  return options;
}

/** The checks reach the game through globalThis.__game, which only ?debug=1 sets. */
export function withDebug(url) {
  const address = new URL(url);
  if (!address.searchParams.has('debug')) address.searchParams.set('debug', '1');
  return address.href;
}

/** Playwright's proxy setting for this page, from the usual environment variables. */
export function proxyFor(pageUrl, env = process.env) {
  const host = new URL(pageUrl).hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return undefined;
  const bypass = (env.NO_PROXY || env.no_proxy || '').split(',').map(rule => rule.trim().toLowerCase()).filter(Boolean);
  const direct = bypass.some(rule => rule === '*' || host === rule.replace(/^\./, '') || host.endsWith(rule.startsWith('.') ? rule : `.${rule}`));
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (direct || !raw) return undefined;
  const address = new URL(raw);
  const proxy = { server: `${address.protocol}//${address.host}` };
  if (address.username) proxy.username = decodeURIComponent(address.username);
  if (address.password) proxy.password = decodeURIComponent(address.password);
  return proxy;
}

/** What page-sounds.mjs found: sounds nobody would hear, and anything that clips or is not a number. */
export function soundVerdict(render) {
  const warm = Object.entries(render.warm);
  const every = [...warm, ...Object.entries(render.single)];
  const names = list => [...new Set(list.map(([name]) => name))];
  const silent = names(warm.filter(([, s]) => s.peak < SILENT_DB));
  const clipping = names(every.filter(([, s]) => s.overs > 0));
  const broken = names(every.filter(([, s]) => s.bad > 0));
  const pileUpClips = render.worstWarm.overs > 0 || render.worst.overs > 0;
  return {
    ok: !silent.length && !clipping.length && !broken.length && !pileUpClips,
    silent,
    clipping,
    broken,
    worst: { peak: render.worstWarm.peak, overs: render.worstWarm.overs },
  };
}

/** Runs server.mjs on a free port and resolves once it says where it is listening. */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { stdio: ['ignore', 'pipe', 'inherit'] });
    let said = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the local server did not start within 10 s'));
    }, 10000);
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`the local server exited with code ${code}`));
    });
    child.stdout.on('data', chunk => {
      said += chunk;
      const address = said.match(/http:\/\/localhost:\d+/);
      if (!address) return;
      clearTimeout(timer);
      resolve({ url: `${address[0]}/`, stop: () => child.kill() });
    });
  });
}

async function checkEngine(playwright, name, url, outDir) {
  const profile = PROFILES[name];
  const failures = [];
  const notes = [];
  console.log(`\n== ${name}`);
  let browser;
  try {
    const proxy = proxyFor(url);
    browser = await playwright[profile.engine].launch({ ...(profile.channel && { channel: profile.channel }), ...(proxy && { proxy }) });
  } catch (error) {
    console.log(`  could not start: ${error.message.split('\n')[0]}`);
    console.log(name === 'chrome' ? '  it uses the Google Chrome installed on this machine' : '  install it with: npx playwright-core install webkit firefox');
    return { name, ok: false, failures: ['could not start'] };
  }
  const version = browser.version();
  console.log(`  version ${version}`);
  let sounds = null;
  try {
    const context = await browser.newContext(profile.phone ? PHONE : DESKTOP);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`page error: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(`console error: ${m.text()}`);
      else if (m.type() === 'warning') notes.push(`console warning: ${m.text()}`);
    });
    page.on('requestfailed', r => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'no reason given'})`));
    page.on('response', r => {
      // 407 is a proxy asking for its password, which Playwright then sends. It never comes from the site.
      if (r.status() >= 400 && r.status() !== 407) errors.push(`HTTP ${r.status()}: ${r.url()}`);
    });

    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => globalThis.__game, null, { timeout: 30000 });
    const boot = await page.evaluate(bootReport, TITLE_LEVEL.name);
    console.log(`  page: canvas ${boot.canvas.join('x')} for ${boot.css.join('x')} css px, font ${boot.font ? 'loaded' : 'MISSING'}, Web Audio ${boot.webAudio ? 'yes' : 'no'}`);
    if (!boot.font) failures.push('the title font did not load');
    if (boot.painted < 40) failures.push(`the canvas looks blank (green spread ${boot.painted})`);
    if (!boot.title) failures.push('the title screen is not showing');
    const titleShot = path.join(outDir, `${name}-title.png`);
    await page.screenshot({ path: titleShot });

    // Press play the way this device would: a finger on a phone, the mouse on a desktop.
    if (profile.phone) await page.tap('#btn-play', { timeout: 10000 });
    else await page.click('#btn-play', { timeout: 10000 });
    await page.waitForFunction(() => globalThis.__game.mode === 'play' && globalThis.__game.scene.sim.state === 'ready', null, { timeout: 15000 });
    const audio = await page.evaluate(() => globalThis.__game.sfx.ctx?.state ?? 'none');
    console.log(`  ${profile.phone ? 'tap' : 'click'} on play: level started, audio ${audio}`);
    if (boot.webAudio && audio !== 'running') failures.push(`audio is ${audio} after pressing play`);

    // A real mouse drag through the engine's own input path. Playwright cannot drag a finger, so touch
    // drags are covered by the touch pointer events in the interface checks.
    await page.evaluate(waitForCamera);
    const bug = await page.evaluate(bugOnScreen);
    await page.mouse.move(bug.x, bug.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(bug.x - (i * 70) / 12, bug.y + (i * 20) / 12);
    // Hold still for a few frames, as a player does while reading the aim dots. A release fires only once
    // the bug itself has moved, and a slow engine may not have drawn a single frame during the drag.
    await page.evaluate(nextFrames, 4);
    const aiming = await page.evaluate(() => ({ state: globalThis.__game.scene.sim.state, dots: globalThis.__game.scene.preview?.length ?? 0 }));
    await page.mouse.up();
    const fired = await page.waitForFunction(() => globalThis.__game.scene.sim.shots === 1, null, { timeout: 5000 }).then(() => true, () => false);
    console.log(`  mouse drag: ${aiming.state} with ${aiming.dots} aim dots, ${fired ? 'fired on release' : 'NOT fired'}`);
    if (aiming.state !== 'aiming' || !aiming.dots || !fired) failures.push('a real mouse drag did not aim and fire');
    await page.waitForFunction(() => globalThis.__game.scene.sim.state === 'flying', null, { timeout: 5000 }).catch(() => {});
    const screenshot = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: screenshot });
    notes.push(`${await page.evaluate(frameRate)} fps here, headless, so not what a phone would do`);

    const ui = await page.evaluate(uiChecks);
    console.log(`  interface checks: ${ui.pass} pass, ${ui.fail} fail${ui.uncaught ? `, ${ui.uncaught} uncaught errors` : ''}`);
    for (const line of ui.results) if (line.startsWith('FAIL')) failures.push(line.slice(5));
    if (ui.uncaught) failures.push(`${ui.uncaught} uncaught errors during the interface checks`);

    if (boot.webAudio) {
      sounds = await page.evaluate(renderSounds);
      const verdict = soundVerdict(sounds);
      console.log(`  sounds: ${Object.keys(sounds.warm).length} rendered, loudest pile-up ${verdict.worst.peak} dBFS${verdict.ok ? ', none silent or clipping' : ''}`);
      if (verdict.silent.length) failures.push(`silent sounds: ${verdict.silent.join(', ')}`);
      if (verdict.clipping.length) failures.push(`clipping sounds: ${verdict.clipping.join(', ')}`);
      if (verdict.broken.length) failures.push(`sounds that output non-numbers: ${verdict.broken.join(', ')}`);
      if (sounds.worstWarm.overs || sounds.worst.overs) failures.push(`the loudest pile-up clips (${sounds.worstWarm.overs} warm, ${sounds.worst.overs} cold samples)`);
    } else {
      notes.push('sound not checked: this build of the engine has no Web Audio');
    }
    failures.push(...new Set(errors));
    console.log(`  screenshots ${titleShot}, ${screenshot}`);
  } catch (error) {
    failures.push(`stopped: ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  for (const note of notes) console.log(`  note: ${note}`);
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  return { name, version, ok: failures.length === 0, failures, sounds };
}

/** The sound whose loudness differs most between engines, as a hint when the audio chain changes. */
function widestSoundGap(results) {
  const rendered = results.filter(r => r.sounds);
  if (rendered.length < 2) return null;
  let widest = { sound: '', db: 0 };
  for (const sound of Object.keys(rendered[0].sounds.warm)) {
    const peaks = rendered.map(r => r.sounds.warm[sound]?.peak).filter(p => typeof p === 'number');
    const db = +(Math.max(...peaks) - Math.min(...peaks)).toFixed(1);
    if (db > widest.db) widest = { sound, db };
  }
  return { ...widest, engines: rendered.map(r => r.name) };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  let playwright;
  try {
    const loaded = await import('playwright-core');
    playwright = loaded.chromium ? loaded : loaded.default;
  } catch {
    console.error('Playwright is not installed: run npm install');
    process.exit(2);
  }
  const server = options.url ? null : await startServer();
  const url = withDebug(options.url ?? server.url);
  console.log(`checking ${url}${proxyFor(url) ? ' through the configured proxy' : ''}`);
  fs.mkdirSync(options.out, { recursive: true });
  const results = [];
  try {
    for (const name of options.browsers) results.push(await checkEngine(playwright, name, url, options.out));
  } finally {
    server?.stop();
  }

  console.log('\n== summary');
  for (const r of results) console.log(`  ${r.name.padEnd(8)} ${(r.version ?? '').padEnd(15)} ${r.ok ? 'ok' : `FAILED (${r.failures.length})`}`);
  const gap = widestSoundGap(results);
  if (gap) console.log(`  sounds differ most on ${gap.sound}: ${gap.db} dB across ${gap.engines.join(', ')} (noisy sounds vary by about 4 dB between renders)`);
  console.log(`  screenshots in ${options.out}`);
  process.exitCode = results.every(r => r.ok) ? 0 : 1;
}

if (process.argv[1] === here) await main();
