// The cross-browser check needs Playwright and real browsers, so npm test covers the parts that make
// decisions: which page it opens, how it reaches it, and what counts as a broken sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, proxyFor, soundVerdict, withDebug } from '../tools/browser-check.mjs';

const read = file => fs.readFileSync(new URL(`../tools/${file}`, import.meta.url), 'utf8');

test('with no options it checks every engine on the local server', () => {
  assert.deepEqual(parseArgs([]), {
    url: undefined,
    browsers: ['chrome', 'webkit', 'firefox'],
    out: path.join(os.tmpdir(), 'grass-guardian-browser-check'),
  });
});

test('options pick the page, the engines and where screenshots go', () => {
  assert.deepEqual(parseArgs(['--url=https://grass-guardian.dengjiabei.cn/', '--browsers=webkit,firefox', '--out=shots']), {
    url: 'https://grass-guardian.dengjiabei.cn/',
    browsers: ['webkit', 'firefox'],
    out: 'shots',
  });
});

test('an unknown engine or option is refused rather than skipped', () => {
  assert.throws(() => parseArgs(['--browsers=safari']), /safari/);
  assert.throws(() => parseArgs(['--browser=webkit']), /--browser=webkit/);
});

test('the checks reach the game through ?debug=1, whatever address they are given', () => {
  assert.equal(withDebug('https://grass-guardian.dengjiabei.cn/'), 'https://grass-guardian.dengjiabei.cn/?debug=1');
  assert.equal(withDebug('http://localhost:5173/?lang=zh'), 'http://localhost:5173/?lang=zh&debug=1');
  assert.equal(withDebug('http://localhost:5173/?debug=1'), 'http://localhost:5173/?debug=1');
});

test('remote pages go through the configured proxy, with its password kept out of the address', () => {
  const env = { HTTPS_PROXY: 'http://me:p%40ss@10.0.0.1:6135' };
  assert.deepEqual(proxyFor('https://grass-guardian.dengjiabei.cn/', env), { server: 'http://10.0.0.1:6135', username: 'me', password: 'p@ss' });
  assert.deepEqual(proxyFor('https://example.com/', { http_proxy: 'http://10.0.0.2:8080' }), { server: 'http://10.0.0.2:8080' });
  assert.equal(proxyFor('https://grass-guardian.dengjiabei.cn/', {}), undefined);
});

test('local pages and NO_PROXY hosts are reached directly', () => {
  const env = { HTTPS_PROXY: 'http://10.0.0.1:6135', NO_PROXY: 'localhost,.corp.example,intranet.example' };
  assert.equal(proxyFor('http://localhost:5173/', env), undefined);
  assert.equal(proxyFor('http://127.0.0.1:5173/', env), undefined);
  assert.equal(proxyFor('https://wiki.corp.example/', env), undefined);
  assert.equal(proxyFor('https://intranet.example/', env), undefined);
  assert.deepEqual(proxyFor('https://notintranet.example/', env), { server: 'http://10.0.0.1:6135' });
});

test('a sound render passes only when every sound can be heard and nothing clips', () => {
  const fine = { peak: -12, overs: 0, bad: 0 };
  const render = ({ warm = {}, cold = {}, worstWarm = { peak: -0.1, overs: 0 }, worst = { peak: -1.9, overs: 0 } } = {}) => ({
    warm: { boom: fine, tap: fine, ...warm },
    single: { boom: fine, tap: fine, ...cold },
    worstWarm,
    worst,
  });
  assert.deepEqual(soundVerdict(render()), { ok: true, silent: [], clipping: [], broken: [], worst: { peak: -0.1, overs: 0 } });

  const quiet = soundVerdict(render({ warm: { tap: { peak: -80, overs: 0, bad: 0 } } }));
  assert.deepEqual([quiet.ok, quiet.silent], [false, ['tap']]);
  const clipped = soundVerdict(render({ cold: { boom: { peak: 0.2, overs: 12, bad: 0 } } }));
  assert.deepEqual([clipped.ok, clipped.clipping], [false, ['boom']]);
  const broken = soundVerdict(render({ warm: { boom: { peak: -12, overs: 0, bad: 5 } } }));
  assert.deepEqual([broken.ok, broken.broken], [false, ['boom']]);
  assert.equal(soundVerdict(render({ worstWarm: { peak: 0.4, overs: 3 } })).ok, false);
  assert.equal(soundVerdict(render({ worst: { peak: 0.1, overs: 1 } })).ok, false);
});

test('Playwright is loaded only when the check runs, so npm test needs nothing installed', () => {
  assert.doesNotMatch(read('browser-check.mjs'), /^import[^;]*['"]playwright-core['"]/m);
});

test('the functions that run inside the page do not lean on anything from their module', () => {
  // The browser receives each function's source text alone, so a module import would be missing there.
  for (const file of ['page-checks.mjs', 'page-sounds.mjs']) {
    assert.doesNotMatch(read(file), /^import /m, `${file} imports something`);
  }
});
