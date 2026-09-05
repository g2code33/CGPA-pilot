// ─────────────────────────────────────────────────────────────────────────
// BUILD-TIME SEED REFRESH
//
// Fetches the LIVE published catalog from the config backend and writes it
// to the GITIGNORED `src/config/seed/.live.admin-catalog.json`, merged over
// the committed seed's shape. The Vite plugin (vite.config.ts) prefers that
// live file when building, so the bundled offline fallback always carries
// the LATEST published universities/curricula/branding — never a stale
// logo, wordmark or icon. The committed admin-catalog.json stays the
// bootstrap/emergency layer and is never modified here.
//
// Safe by design: if the network/backend is unavailable, the script warns
// and the build simply keeps the committed seed (it never fails a build).
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const apiBase = (process.env.CF_API_TARGET ?? '').replace(/\/$/, '');
const API = apiBase
  ? `${apiBase}/api/config/latest`
  : 'https://cgpa-pilot.calcitoninpay.workers.dev/api/config/latest';

const seedDir = new URL('../src/config/seed/', import.meta.url);
const committedPath = new URL('admin-catalog.json', seedDir);
const livePath = new URL('.live.admin-catalog.json', seedDir);

try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch(API, { signal: ctrl.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = await res.json();
  if (doc?.format !== 'cgpa-pilot-config' || !doc.payload) {
    throw new Error('unexpected payload');
  }

  const p = doc.payload;
  const committed = JSON.parse(readFileSync(committedPath, 'utf8'));

  // Merge over the committed seed so admin-only keys (trash, etc.) survive;
  // only the student-facing data + branding come from the live publish.
  const live = {
    ...committed,
    universities: p.universities ?? committed.universities,
    curricula: p.curricula ?? committed.curricula,
  };
  if (p.appearance) live.appearance = p.appearance;
  if (p.settings) live.settings = p.settings;
  live._live = {
    source: 'published',
    version: doc.version ?? null,
    updatedAt: doc.updatedAt ?? null,
    fetchedAt: new Date().toISOString(),
  };

  writeFileSync(livePath, JSON.stringify(live, null, 2) + '\n');
  console.log(
    `[seed] live seed refreshed from published v${doc.version ?? '?'} → ${livePath.pathname}`
  );
} catch (e) {
  // Drop any STALE live file from a previous run so the build deterministically
  // falls back to the committed seed rather than shipping an old snapshot.
  try {
    if (existsSync(livePath)) unlinkSync(livePath);
  } catch {
    /* ignore */
  }
  console.warn(
    `[seed] live fetch failed (${e.message}) — build keeps the committed seed.`
  );
}
