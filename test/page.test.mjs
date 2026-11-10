// What the page asks the browser for has to exist, and has to survive the upload filter. A mistake
// here does not show up locally: the dev server serves every file, whatever .assetsignore says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE_LEVEL } from '../src/game/title.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

const html = read('index.html');
const css = read('styles.css');
const preloaded = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);

function referenced() {
  const fromHtml = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1]);
  const fromCss = [...css.matchAll(/url\('([^':]+)'\)/g)].map(m => m[1]);
  return [...new Set([...fromHtml, ...fromCss])];
}

test('the page preloads exactly the modules the game is made of', () => {
  assert.deepEqual([...preloaded].sort(), walk('src').filter(f => f.endsWith('.js')).sort());
});

test('everything the page and stylesheet ask for exists', () => {
  const list = referenced();
  assert.ok(list.includes('styles.css') && list.includes('src/main.js'), 'the reference scan found nothing useful');
  for (const file of list) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
});

test('nothing the page asks for is filtered out of the upload', () => {
  const ignored = read('.assetsignore').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  for (const file of referenced()) {
    const parts = file.split('/');
    for (const rule of ignored) {
      const hit = rule.startsWith('*.') ? file.endsWith(rule.slice(1)) : parts.includes(rule);
      assert.ok(!hit, `${file} is needed by the page but ${rule} keeps it from being uploaded`);
    }
  }
});

test('the game goes by one name: the letters on the title screen, the page title and its fallbacks', () => {
  const name = TITLE_LEVEL.name;
  assert.equal(name, '草原卫士');
  const letters = [];
  const builder = new Proxy({}, { get: (_, method) => (method === 'tag' ? (x, base, label) => letters.push(label) : () => {}) });
  TITLE_LEVEL.build(builder);
  assert.equal(letters.join(''), name, 'the letters hanging on the title screen spell something else');
  assert.match(html, new RegExp(`<title>${name}</title>`));
  assert.match(html, new RegExp(`<h1[^>]*>${name}</h1>`));
  assert.match(html, new RegExp(`<meta name="description" content="${name}：`));
  assert.match(html, new RegExp(`<noscript>[\\s\\S]*${name}[\\s\\S]*</noscript>`));
});

test('the code avoids Array.at, which iOS before 15.4 does not have', () => {
  // WeChat on iOS uses the system WebKit, and a missing method here stops the game from booting.
  for (const file of walk('src')) {
    assert.doesNotMatch(read(file), /\.at\(-?\d/, `${file} uses .at()`);
  }
});

test('development files stay out of the upload', () => {
  const ignored = read('.assetsignore').split(/\r?\n/);
  for (const rule of ['node_modules', '.git', 'test', 'tools', 'server.mjs', 'package.json', 'wrangler.jsonc']) {
    assert.ok(ignored.includes(rule), `${rule} would be published`);
  }
});
