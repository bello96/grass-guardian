// The display font is cut down to the characters in use, so new text can silently fall back to a
// system font on some glyphs. These checks catch that, and a font that has grown back to full size.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { charactersInUse, glyphListFile } from '../tools/glyphs.mjs';

const fontUrl = new URL('../assets/fonts/ZCOOLKuaiLe-subset.woff2', import.meta.url);
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the font subset covers every character the game uses', () => {
  const covered = new Set(fs.readFileSync(glyphListFile, 'utf8'));
  const missing = charactersInUse().filter(ch => !covered.has(ch));
  assert.deepEqual(missing, [], `missing from the font, run npm run font: ${missing.join('')}`);
});

test('the shipped font is small, and is a real woff2 file', () => {
  const bytes = fs.readFileSync(fontUrl);
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(bytes.length < 120 * 1024, `font is ${(bytes.length / 1024).toFixed(0)} KB`);
});

test('the page and the stylesheet both load the subset, not the full font', () => {
  for (const [name, text] of [['styles.css', read('../styles.css')], ['index.html', read('../index.html')]]) {
    assert.match(text, /ZCOOLKuaiLe-subset\.woff2/, `${name} should load the subset`);
    assert.doesNotMatch(text, /ZCOOLKuaiLe-Regular/, `${name} still loads the full font`);
  }
});
