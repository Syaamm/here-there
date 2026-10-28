// Lists every text passed to t('...') / tn('...', '...') in src/ that has no Italian translation yet.
// Run from apps/mobile:  node scripts/check-i18n.cjs        (exit code 1 when something is missing)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src');

// the Italian dictionary: read the area files as plain text and pull out every 'key': 'value' pair
const known = new Set();
const dictDir = path.join(src, 'lib', 'i18n', 'it');
for (const f of fs.readdirSync(dictDir)) {
  if (f === 'index.ts') continue;
  const text = fs.readFileSync(path.join(dictDir, f), 'utf8');
  for (const m of text.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|([A-Za-z_]\w*))\s*:/gm)) {
    known.add((m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/\\(['"`\\])/g, '$1'));
  }
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const lit = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|` + '`((?:[^`\\\\$]|\\\\.)*)`)';
const one = new RegExp(String.raw`(?<![\w.])t\(\s*` + lit, 'g');
const two = new RegExp(String.raw`(?<![\w.])tn\(\s*[^,]+,\s*` + lit + String.raw`\s*,\s*` + lit, 'g');

let missing = 0;
for (const file of walk(src).filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes(path.join('lib', 'i18n')))) {
  const text = fs.readFileSync(file, 'utf8');
  const keys = [];
  for (const m of text.matchAll(one)) keys.push(m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(two)) keys.push(m[1] ?? m[2] ?? m[3], m[4] ?? m[5] ?? m[6]);
  const lost = [...new Set(keys.filter((k) => k != null).map((k) => k.replace(/\\(['"`\\])/g, '$1')))].filter((k) => !known.has(k));
  if (lost.length) {
    missing += lost.length;
    console.log(`\n${path.relative(src, file)}`);
    for (const k of lost) console.log('  ' + JSON.stringify(k));
  }
}
console.log(missing ? `\n${missing} text(s) without an Italian translation.` : 'Every t() text has an Italian translation.');
process.exit(missing ? 1 : 0);
