// ─────────────────────────────────────────────────────────────────────────
// BUILD-TIME BRAND ICON REFRESH  (v1.0.26)
//
// The installer/launcher artwork of every target — the Windows .exe/.ico, the
// Linux hicolor set, the PWA `icon-512.png`, the Android `ic_launcher*` mipmaps
// and the iOS AppIcon — is COMMITTED art, produced when someone last drew the
// logo. Nothing read the administrator's branding, so "the app logo must be the
// one the admin set" could never hold for an INSTALLED app: every installer kept
// shipping whatever artwork was in the repo (that is the "old logo" complaint).
//
// This script closes that gap at build time, alongside scripts/refresh-seed.mjs
// — same FRESH-SEED idea: the live published configuration decides what ships.
//
//   1. take `appearance.logo` from the published catalog: the gitignored
//      `.live.admin-catalog.json` refresh-seed has just written, else a direct
//      fetch of /api/config/latest;
//   2. resolve it — `asset:<key>` → /api/assets/<key> (what v1.0.20+ stores),
//      `data:image/…` (older publishes), or an http(s) URL;
//   3. regenerate every shipped icon from that single image, each sized to the
//      pixel dims of the file it replaces (so densities/adaptive layers stay
//      valid) using ImageMagick;
//   4. change NOTHING when the admin has no logo, the network is down, or no
//      rasterizer is installed.
//
// Safe by construction: branding must never break packaging, so every failure
// path warns and exits 0 — the committed artwork remains as the fallback. A
// branding change that happens AFTER a build is still applied to running
// installs by the runtime half of this fix (brandAssets materialization + the
// desktop shell's per-user launcher icon); this half fixes the installers that
// are built from now on, including what Windows/Android/iOS draw before the app
// ever starts.
//
// Opt out with CGPA_BRAND_ICONS=0 (e.g. a fully offline/reproducible build).
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const apiBase = (process.env.CF_API_TARGET ?? '').replace(/\/$/, '') || 'https://cgpa-pilot.calcitoninpay.workers.dev';
const TIMEOUT_MS = 20000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Linux hicolor / electron-builder sizes (build/icons/<S>x<S>.png). */
const HICOLOR = [16, 24, 32, 48, 64, 96, 128, 256, 512];
/** Capacitor's mipmap buckets — actual dims are read from the existing files. */
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

const log = (msg) => console.log(`[brand-icons] ${msg}`);
const warn = (msg) => console.warn(`[brand-icons] ${msg}`);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Write only on real change, so a routine build never dirties the tree. */
function writeIfChanged(file, bytes) {
  try {
    if (existsSync(file) && sha(readFileSync(file)) === sha(bytes)) return false;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return true;
  } catch (e) {
    warn(`could not write ${path.relative(ROOT, file)} (${e.message})`);
    return false;
  }
}

function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ── 1. the published appearance ────────────────────────────────────────────

function appearanceFromLiveSeed() {
  const text = readTextSafe(path.join(ROOT, 'src', 'config', 'seed', '.live.admin-catalog.json'));
  if (!text) return null;
  try {
    return JSON.parse(text)?.appearance ?? null;
  } catch {
    return null;
  }
}

async function appearanceFromApi() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase}/api/config/latest`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    if (doc?.format !== 'cgpa-pilot-config') throw new Error('unexpected payload');
    return doc.payload?.appearance ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// ── 2. resolve the stored logo value into image bytes ──────────────────────

async function fetchBytes(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('empty response');
    if (buf.length > MAX_IMAGE_BYTES) throw new Error(`${(buf.length / 1048576).toFixed(1)} MB exceeds the ${MAX_IMAGE_BYTES / 1048576} MB limit`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/** `asset:<key>` | `data:image/…` | http(s) URL → bytes (null when unusable). */
async function logoBytes(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('data:image/')) {
    const comma = value.indexOf(',');
    if (comma === -1) return null;
    const body = value.slice(comma + 1);
    try {
      const buf = value.slice(0, comma).includes(';base64')
        ? Buffer.from(body, 'base64')
        : Buffer.from(decodeURIComponent(body), 'utf8');
      return buf.length && buf.length <= MAX_IMAGE_BYTES ? buf : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith('asset:')) {
    const key = value.slice('asset:'.length);
    // Only our own content-addressed prefix — never a traversal or absolute key.
    if (!key.startsWith('catalog/') || key.includes('..')) return null;
    return fetchBytes(`${apiBase}/api/assets/${key}`);
  }
  if (/^https?:\/\//i.test(value)) return fetchBytes(value);
  return null;
}

// ── 3. rasterizing with ImageMagick ────────────────────────────────────────

/** 'magick' (v7, sub-commands) or 'convert' (v6, standalone binaries) or null. */
function detectTool() {
  for (const bin of ['magick', 'convert']) {
    const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
    if (!res.error && res.status === 0) return bin;   // spawnSync sets `error` to undefined, not null, on success
  }
  return null;
}

let TOOL = null;
let TMP = '';

function runIM(sub, args, label) {
  // v7 exposes everything through `magick <subcommand> …`; v6 ships separate
  // binaries (convert/identify/composite), so the subcommand picks the binary.
  const bin = TOOL === 'magick' ? 'magick' : sub === 'convert' ? 'convert' : sub;
  const argv = TOOL === 'magick' ? [sub, ...args] : args;
  const res = spawnSync(bin, argv.map(String), { encoding: 'utf8' });
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${label}: ${(res.stderr || res.stdout || '').trim().split('\n')[0] || 'failed'}`);
  return res.stdout ?? '';
}

/** `WxH` of an existing file, or null (missing identify/file). */
function dimsOf(file) {
  if (!existsSync(file)) return null;
  try {
    const out = runIM('identify', ['-format', '%wx%h', file], 'identify').trim();
    return /^\d+x\d+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Convert `src` into PNG bytes. `-define png:color-type=6` forces 8-bit RGBA:
 * ImageMagick otherwise "optimises" small outputs to a palette, which makes the
 * Linux .ico set and Android's masked layers look banded (and once made
 * electron-builder reject the file outright).
 */
function toPng(args, label = 'convert', colorType = 6) {
  const out = path.join(TMP, `o-${Math.random().toString(36).slice(2)}.png`);
  runIM('convert', [...args, '-define', `png:color-type=${colorType}`, out], label);
  try {
    return readFileSync(out);
  } finally {
    try {
      rmSync(out);
    } catch {
      /* temp file cleanup is cosmetic */
    }
  }
}

/**
 * Fit the logo into a square `size`, using `scale` of it, optionally flattened
 * onto `background` (opaque). `round` crops to a circle (Android's legacy
 * `ic_launcher_round`, which the launcher displays as-is).
 */
function squareIcon(src, { size, scale = 0.88, background = null, round = false }) {
  const fit = Math.max(8, Math.round(size * scale));
  const args = [src, '-filter', 'Mitchell', '-resize', `${fit}x${fit}`, '-gravity', 'center'];
  args.push('-background', background ?? 'none', '-extent', `${size}x${size}`);
  // Flatten AFTER the canvas exists — `-extent` would otherwise re-add a
  // channel — and a master carrying alpha breaks the Windows .ico (black
  // fringing) and fails App Store icon validation (color-type 2 = RGB, no alpha).
  const flat = background ? toPng(args, 'convert', 2) : toPng(args);
  if (!round) return flat;
  // Circle in the alpha channel, copied onto the flattened icon. Input and
  // output are separate files: ImageMagick refuses to write a file it reads.
  const half = Math.round(size / 2);
  const mask = path.join(TMP, `mask-${size}.png`);
  const roundIn = path.join(TMP, `round-in-${size}.png`);
  const roundOut = path.join(TMP, `round-out-${size}.png`);
  try {
    writeFileSync(mask, toPng(['-size', `${size}x${size}`, 'xc:none', '-fill', 'white', '-draw', `circle ${half},${half} ${half},1`]));
    writeFileSync(roundIn, flat);
    runIM('convert', [roundIn, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-define', 'png:color-type=6', roundOut], 'round mask');
    return readFileSync(roundOut);
  } catch (e) {
    warn(`round crop unavailable (${e instanceof Error ? e.message : e}) — the square icon is used; Android masks it anyway.`);
    return flat;
  }
}

/** Adaptive-icon foreground layer: smaller, always transparent. */
function foregroundIcon(src, size) {
  return squareIcon(src, { size, scale: 0.66 });
}

// ── 4. targets ─────────────────────────────────────────────────────────────

function androidBackgroundColour() {
  const xml = readTextSafe(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml'));
  const m = xml && /<color name="ic_launcher_background">(#[0-9a-fA-F]{3,8})<\/color>/.exec(xml);
  return m ? m[1] : '#FFFFFF';
}

function refreshWebAndDesktop(src) {
  let n = 0;
  for (const size of HICOLOR) {
    const file = path.join(ROOT, 'build', 'icons', `${size}x${size}.png`);
    const dims = dimsOf(file);
    const target = dims ? Number(dims.split('x')[0]) : size;
    if (writeIfChanged(file, squareIcon(src, { size: target }))) n += 1;
  }
  const webIcon = path.join(ROOT, 'public', 'icon-512.png');
  const webDims = dimsOf(webIcon);
  const webSize = webDims ? Math.max(...webDims.split('x').map(Number)) : 512;
  if (writeIfChanged(webIcon, squareIcon(src, { size: webSize }))) n += 1;
  const master = path.join(ROOT, 'build', 'icon.png');
  const masterDims = dimsOf(master);
  const masterSize = masterDims ? Number(masterDims.split('x')[0]) : 1024;
  // The Windows/mac master is opaque: .ico/.icns with alpha render as black.
  if (writeIfChanged(master, squareIcon(src, { size: masterSize, scale: 0.86, background: '#ffffff' }))) n += 1;
  return n;
}

function refreshAndroid(src) {
  let n = 0;
  const bg = androidBackgroundColour();
  const resDir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
  for (const density of DENSITIES) {
    const dir = path.join(resDir, `mipmap-${density}`);
    if (!existsSync(dir)) continue;
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const file = path.join(dir, name);
      const dims = dimsOf(file);
      if (!dims) continue;
      const size = Number(dims.split('x')[0]);
      const data = name.endsWith('foreground.png')
        ? foregroundIcon(src, size)
        : squareIcon(src, { size, background: bg, round: name.includes('round') });
      if (writeIfChanged(file, data)) n += 1;
    }
  }
  // The native splash (what flashes before the webview paints) shows the same
  // logo, so an APK must not open with the old one.
  for (const orient of ['port', 'land']) {
    for (const density of DENSITIES) {
      const file = path.join(resDir, `drawable-${orient}-${density}`, 'splash.png');
      const dims = dimsOf(file);
      if (!dims) continue;
      const [w, h] = dims.split('x').map(Number);
      const box = Math.max(64, Math.round(Math.min(w, h) * 0.4));
      const logo = path.join(TMP, `splash-${orient}-${density}.png`);
      writeFileSync(logo, squareIcon(src, { size: box }));
      if (writeIfChanged(file, flatSplash(w, h, logo))) n += 1;
    }
  }
  return n;
}

/** Logo centred (a touch above centre, as launchers do) on the app's background. */
function flatSplash(w, h, logoFile) {
  const offset = Math.round(h * 0.06);
  return toPng(['-size', `${w}x${h}`, 'xc:#eef2f7', logoFile, '-gravity', 'center', '-geometry', `+0-${offset}`, '-composite'], 'splash');
}

function refreshIos(src) {
  let n = 0;
  const dir = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
  const text = readTextSafe(path.join(dir, 'Contents.json'));
  if (!text) return 0;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return 0;
  }
  for (const image of doc.images ?? []) {
    if (!image?.filename) continue;
    const file = path.join(dir, image.filename);
    const dims = dimsOf(file);
    const size = dims
      ? Number(dims.split('x')[0])
      : Number(String(image.size ?? '1024x1024').split('x')[0]) || 1024;
    // iOS rejects alpha in App Store icons, hence the white plate.
    if (writeIfChanged(file, squareIcon(src, { size: Math.max(64, size), scale: 0.82, background: '#ffffff' }))) n += 1;
  }
  return n;
}

// ── 5. main ────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.CGPA_BRAND_ICONS === '0') {
    log('CGPA_BRAND_ICONS=0 — keeping the committed icon artwork.');
    return;
  }
  let appearance = appearanceFromLiveSeed();
  if (!appearance) {
    try {
      appearance = await appearanceFromApi();
    } catch (e) {
      warn(`published catalog unavailable (${e.message}) — keeping the committed icon artwork.`);
      return;
    }
  }
  const logoValue = appearance?.logo || appearance?.appIcon?.image;
  if (typeof logoValue !== 'string' || logoValue.length < 64) {
    log('the administrator has not set an app logo — keeping the committed icon artwork.');
    return;
  }
  let bytes;
  try {
    bytes = await logoBytes(logoValue);
  } catch (e) {
    warn(`could not download the admin logo (${e.message}) — keeping the committed icon artwork.`);
    return;
  }
  if (!bytes) {
    warn('the admin logo could not be read as an image — keeping the committed icon artwork.');
    return;
  }

  TMP = mkdtempSync(path.join(os.tmpdir(), 'cgpa-brand-'));
  try {
    // Keep the original extension/content: re-naming a JPEG logo.png is fine
    // for ImageMagick (it sniffs), and the outputs are always PNG.
    const src = path.join(TMP, 'logo-in');
    writeFileSync(src, bytes);

    TOOL = detectTool();
    if (!TOOL) {
      // No rasterizer: only refresh what a consumer can scale itself. Android
      // (density dims, masked layers) and iOS (exact 1024, no alpha) must keep
      // the committed artwork rather than receive a wrong-sized file.
      let n = 0;
      for (const rel of ['public/icon-512.png', 'build/icons/512x512.png', 'build/icons/256x256.png']) {
        if (writeIfChanged(path.join(ROOT, rel), bytes)) n += 1;
      }
      warn(
        `ImageMagick not found — copied the logo to ${n} file(s) without resizing; ` +
          'the remaining installer icon sets keep the committed artwork.'
      );
      return;
    }

    let written = 0;
    written += refreshWebAndDesktop(src);
    written += refreshAndroid(src);
    written += refreshIos(src);
    log(
      written
        ? `refreshed ${written} shipped icon file(s) from the published branding.`
        : 'the shipped icon artwork already matches the published branding.'
    );
  } finally {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* temp dir cleanup is cosmetic */
    }
  }
}

try {
  await main();
} catch (e) {
  // Branding must never break a build: warn loudly, keep the old artwork.
  warn(`skipped (${e instanceof Error ? e.message : String(e)}) — keeping the committed icon artwork.`);
}
