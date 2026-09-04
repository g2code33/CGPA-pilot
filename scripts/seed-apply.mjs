#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// seed-apply — bake an admin catalog export into the committed seed.
//
// Usage (from the repo root):
//   npm run seed:apply -- path/to/admin-catalog.json
//
// Validates the file as an AdminCatalog-shaped document and writes it to
// src/config/seed/admin-catalog.json — the durable, build-shipped seed that
// both the admin console and the student app load as their default config.
//
// After it runs, commit + push the updated admin-catalog.json. From then on
// that data is part of the app for every user and survives any deploy.
//
// This is a build-time repo tool; it does NOT run in the browser app.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'config', 'seed', 'admin-catalog.json');

function fail(msg) {
  console.error(`❌ seed-apply: ${msg}`);
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  fail(
    'provide the exported admin-catalog.json path, e.g.\n' +
      '    npm run seed:apply -- ./admin-catalog.json'
  );
}

let doc;
try {
  doc = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  fail(`could not read "${inputPath}" as JSON: ${e.message}`);
}

if (!doc || typeof doc !== 'object') fail('file must contain a JSON object.');
if (!Array.isArray(doc.universities) || doc.universities.length === 0) {
  fail('missing a non-empty "universities" array.');
}
if (!Array.isArray(doc.curricula)) fail('missing a "curricula" array.');

// Persist the exact AdminCatalog shape used at runtime.
const normalized = {
  universities: doc.universities,
  curricula: doc.curricula,
  trash: Array.isArray(doc.trash) ? doc.trash : [],
  ...(doc.appearance ? { appearance: doc.appearance } : {}),
};

writeFileSync(target, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
const nUnis = normalized.universities.length;
const nCurr = normalized.curricula.length;
console.log(
  `✅ Seed written to src/config/seed/admin-catalog.json\n` +
    `   (${nUnis} universit${nUnis === 1 ? 'y' : 'ies'}, ${nCurr} curriculum version${nCurr === 1 ? '' : 's'})\n\n` +
    `Next: commit this file and push. From then on this admin catalog is the\n` +
    `built-in seed shipped to every user on every device.`
);
