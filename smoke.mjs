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
assert(existsSync(join(dist, 'index.html')), 'dist/index.html exists (student app)');
assert(existsSync(join(dist, 'admin.html')), 'dist/admin.html exists (separate admin app)');
assert(existsSync(join(dist, 'sw.js')), 'service worker copied to dist');
assert(existsSync(join(dist, 'manifest.webmanifest')), 'PWA manifest copied');
assert(existsSync(join(dist, 'icon-512.png')), 'icon copied');
assert(
  readFileSync(join(dist, 'index.html'), 'utf8').includes('CGPA'),
  'branding present in index.html'
);
assert(
  readFileSync(join(dist, 'admin.html'), 'utf8').includes('Admin'),
  'admin entry marked as admin'
);

// Admin and student bundles are separate; the admin bundle must never ship to
// the student entry — verify student HTML doesn't reference the admin entry.
const studentHtml = readFileSync(join(dist, 'index.html'), 'utf8');
assert(!/admin-main/.test(studentHtml), 'student entry never loads the admin bundle');

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
const STUDENT_STORAGE_FILE = join('src', 'services', 'configCache.ts');
const ADMIN_STORAGE_FILE = join('src', 'admin', 'adminStorage.ts');

const studentStorageModules = [];
const adminStorageModules = [];
for (const file of sources) {
  const rel = file.slice(root.length + 1);
  const code = stripNoise(readFileSync(file, 'utf8'));
  if (!STORAGE_USAGE_RE.test(code)) continue;
  if (rel.startsWith(join('src', 'admin'))) adminStorageModules.push(rel);
  else studentStorageModules.push(rel);
}

// Student application: the curriculum config cache is the sole storage user.
assert(
  studentStorageModules.length === 1 &&
    studentStorageModules[0] === STUDENT_STORAGE_FILE,
  `student app storage calls appear only in ${STUDENT_STORAGE_FILE} (found: ${studentStorageModules.join(', ') || 'none'})`
);

// Admin application (persistent by design): the admin storage service is the
// sole direct storage user; views/services call its functions.
assert(
  adminStorageModules.length === 1 &&
    adminStorageModules[0] === ADMIN_STORAGE_FILE,
  `admin storage calls appear only in ${ADMIN_STORAGE_FILE} (found: ${adminStorageModules.join(', ') || 'none'})`
);

// The config cache must never import student state (privacy boundary).
const cacheCode = stripNoise(
  readFileSync(join(root, STUDENT_STORAGE_FILE), 'utf8')
);
assert(
  !/studentState|AcademicState|CourseEntry|SemesterEntry/.test(cacheCode),
  'configCache never imports student academic state types'
);

// Admin storage must never import student academic state (one-way sync only).
const adminCode = stripNoise(
  readFileSync(join(root, ADMIN_STORAGE_FILE), 'utf8')
);
assert(
  !/studentState|AcademicState|CourseEntry|SemesterEntry/.test(adminCode),
  'adminStorage never imports student academic state (no student data upload)'
);

// ── 3. Config-driven UI ───────────────────────────────────────────────────
for (const f of sources.filter((x) => x.includes(join('src', 'views')))) {
  const code = readFileSync(f, 'utf8');
  assert(
    !/points:\s*4\.0|minScore:\s*80/.test(code),
    `${f.slice(root.length + 1)} contains no hard-coded university grading values`
  );
}

// ── 4. Student academic values never go into URLs or to a server ──────────
// The student state/store/institution-selection layer must not touch the
// URL/history or network — inputs are in-memory and never transmitted.
const noLeakFiles = sources.filter(
  (f) =>
    f.includes(join('src', 'state')) ||
    /coreCgpaService|pendingService|structureService|gradingService|classificationService|scenarioService/.test(
      f
    )
);
const URL_NET_RE =
  /window\.location(?:\.href|\.search|\.hash|=)|\.pushState|\.replaceState|location\.search|new URLSearchParams|history\.(?:push|replace)|fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/;
for (const f of noLeakFiles) {
  const code = stripNoise(readFileSync(f, 'utf8'));
  assert(
    !URL_NET_RE.test(code),
    `${f.slice(root.length + 1)} never writes student values to a URL or the network`
  );
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
