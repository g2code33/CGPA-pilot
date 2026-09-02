// Test runner: bundles the TypeScript services + test files with esbuild
// (already available via Vite), then runs them with Node's built-in test
// runner (`node --test`). No extra dev dependency is required.
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, '.test-build');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entryPoints = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(here, f));

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: outDir,
  logLevel: 'warning',
});

const bundled = readdirSync(outDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(outDir, f));

const result = spawnSync(process.execPath, ['--test', ...bundled], {
  stdio: 'inherit',
});

rmSync(outDir, { recursive: true, force: true });
process.exit(result.status ?? 1);
