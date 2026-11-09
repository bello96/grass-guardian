// Cuts the display font down to the characters the game actually uses. The full font is 1.5 MB and
// the game cannot paint its title until the font arrives, so this is most of the first load on a phone.
//
//   npm run font     run again after adding text with new characters; npm test fails if you forget
//
// The full font stays in tools/fonts/ and is not deployed. A subset is a modified version under the
// SIL OFL 1.1; this font declares no Reserved Font Name, so it may keep its name.

import fs from 'node:fs';
import subsetFont from 'subset-font';
import { charactersInUse, glyphListFile } from './glyphs.mjs';

const SOURCE = new URL('./fonts/ZCOOLKuaiLe-Regular.ttf', import.meta.url);
const TARGET = new URL('../assets/fonts/ZCOOLKuaiLe-subset.woff2', import.meta.url);

const characters = charactersInUse();
const subset = await subsetFont(fs.readFileSync(SOURCE), characters.join(''), { targetFormat: 'woff2' });
fs.writeFileSync(TARGET, subset);
fs.writeFileSync(glyphListFile, characters.join(''));

const before = fs.statSync(SOURCE).size;
console.log(`${characters.length} characters, ${(before / 1024).toFixed(0)} KB -> ${(subset.length / 1024).toFixed(1)} KB`);
