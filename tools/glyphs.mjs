// Which characters the game can put on screen, shared by the font tool and its test.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const glyphListFile = new URL('./fonts/glyphs.txt', import.meta.url);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

/** Every character in the page and the code, plus all of printable ASCII for scores and punctuation. */
export function charactersInUse() {
  const found = new Set();
  for (let code = 0x20; code < 0x7f; code++) found.add(String.fromCharCode(code));
  for (const file of [path.join(ROOT, 'index.html'), ...sourceFiles(path.join(ROOT, 'src'))]) {
    for (const ch of fs.readFileSync(file, 'utf8')) {
      if (ch.codePointAt(0) >= 0x80) found.add(ch);
    }
  }
  return [...found].sort();
}
