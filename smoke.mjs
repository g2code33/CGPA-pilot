// Build smoke test + privacy/architecture enforcement.
//  1. The web build must contain the app shell and PWA artifacts.
//  2. SOURCE ENFORCEMENT (the real guard): persistent-storage API *calls*
//     may appear ONLY in src/services/configCache.ts, which holds non-personal
//     curriculum config and must never import student state.
//  3. Views must be config-driven (no hard-coded university grading tables).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('❌ SMOKE FAIL:', msg);
    failures++;
  } else {
    console.log('✅', msg);
  }
}

// Strip comments and string literals so privacy text cannot cause false hits.
function stripNoise(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

// Real storage API usage only (member access), not the words in prose.
const STORAGE_USAGE_RE =
  /\b(?:localStorage|sessionStorage|indexedDB)\b|\.cookie\b/;

// ── 1. Build artifacts ─────────────────────────────────────────────────────
assert(existsSync(join(dist, 'index.html')), 'dist/index.html exists');
assert(existsSync(join(dist, 'sw.js')), 'service worker copied to dist');
assert(existsSync(join(dist, 'manifest.webmanifest')), 'PWA manifest copied');
assert(existsSync(join(dist, 'icon-512.png')), 'icon copied');
assert(
  readFileSync(join(dist, 'index.html'), 'utf8').includes('CGPA'),
  'branding present in index.html'
);

// The minified bundle inlines configCache (the only module allowed to store
// non-personal config). Assert it never sets/reads cookies (student-tracking
// vector) — localStorage is legitimate for the curriculum cache only.
let jsBundles = 0;
for (const f of readdirSync(join(dist, 'assets'))) {
  if (!f.endsWith('.js')) continue;
  jsBundles++;
  const code = readFileSync(join(dist, 'assets', f), 'utf8');
  assert(!/\.cookie\b/.test(code), `bundle ${f} uses no cookies`);
  assert(!/indexedDB/.test(code), `bundle ${f} uses no IndexedDB`);
}
assert(jsBundles > 0, `scanned ${jsBundles} JS bundle(s)`);

// ── 2. Source architecture enforcement ────────────────────────────────────
const ALLOWED_STORAGE_FILE = join('src', 'services', 'configCache.ts');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const sources = walk(join(root, 'src'));
const storageModules = [];
for (const file of sources) {
  const rel = file.slice(root.length + 1);
  const code = stripNoise(readFileSync(file, 'utf8'));
  if (STORAGE_USAGE_RE.test(code)) storageModules.push(rel);
}

assert(
  storageModules.length === 1 && storageModules[0] === ALLOWED_STORAGE_FILE,
  `storage API calls appear only in ${ALLOWED_STORAGE_FILE} (found in: ${storageModules.join(', ') || 'none'})`
);

// The config cache must never import student state (privacy boundary).
const cacheCode = stripNoise(readFileSync(join(root, ALLOWED_STORAGE_FILE), 'utf8'));
assert(
  !/studentState|AcademicState|CourseEntry|SemesterEntry/.test(cacheCode),
  'configCache never imports student academic state types'
);

// ── 3. Config-driven UI ───────────────────────────────────────────────────
for (const f of sources.filter((x) => x.includes(join('src', 'views')))) {
  const code = readFileSync(f, 'utf8');
  assert(
    !/points:\s*4\.0|minScore:\s*80/.test(code),
    `${f.slice(root.length + 1)} contains no hard-coded university grading values`
  );
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
