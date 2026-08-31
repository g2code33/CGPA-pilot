// Minimal build smoke test: the web build must contain the app shell and the
// PWA artifacts, and it must NOT contain any student-persistence calls.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ SMOKE FAIL:', msg);
    process.exit(1);
  }
  console.log('✅', msg);
}

assert(existsSync(join(dist, 'index.html')), 'dist/index.html exists');
assert(existsSync(join(dist, 'sw.js')), 'service worker copied to dist');
assert(existsSync(join(dist, 'manifest.webmanifest')), 'PWA manifest copied');
assert(existsSync(join(dist, 'icon-512.png')), 'icon copied');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
assert(html.includes('CGPA'), 'branding present in index.html');

// Privacy guarantee: no persistence APIs anywhere in the shipped bundle.
const bundles = ['assets'];
let scanned = 0;
for (const dir of bundles) {
  const dirPath = join(dist, dir);
  if (!existsSync(dirPath)) continue;
  for (const f of await import('node:fs').then((fs) => fs.readdirSync(dirPath))) {
    if (!f.endsWith('.js')) continue;
    const code = readFileSync(join(dirPath, f), 'utf8');
    scanned++;
    for (const banned of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'document.cookie',
    ]) {
      assert(!code.includes(banned), `bundle ${f} has no ${banned}`);
    }
  }
}
assert(scanned > 0, `scanned ${scanned} JS bundle(s)`);

console.log('\nSmoke test passed.');
