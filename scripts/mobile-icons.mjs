// ─────────────────────────────────────────────────────────────────────────
// MOBILE APP-ICON GENERATOR  (Android mipmaps + iOS AppIcon + native splash)
//
// A phone shows what is INSIDE the package. The home-screen tile, the icon in the
// installer and the recent-apps card all come from `res/mipmap-*` on Android and
// from `Assets.xcassets/AppIcon.appiconset` on iOS — so runtime branding can never
// fix them, and a build machine without a rasterizer silently shipped the stock
// Capacitor placeholder (a blue "X" on white) forever. That is the bug users
// reported: "downloading the app on Android is not showing the logo of the app on
// the Home Screen and even during installation".
//
// This script regenerates the whole mobile set from one square source logo, using
// scripts/pngkit.mjs — no ImageMagick, no sharp, nothing to install — so it
// produces identical bytes on a laptop and on a CI runner, and can therefore be
// *checked* in CI rather than trusted.
//
// Per Android density (mdpi 1x, hdpi 1.5x, xhdpi 2x, xxhdpi 3x, xxxhdpi 4x):
//
//   mipmap-<d>/ic_launcher.png           48dp, opaque  — pre-26 devices, and what
//                                        the package installer draws
//   mipmap-<d>/ic_launcher_round.png     48dp, circularly masked
//   mipmap-<d>/ic_launcher_foreground.png 108dp        — adaptive foreground
//   mipmap-<d>/ic_launcher_monochrome.png 108dp        — themed icon (Android 13+),
//                                        only when the silhouette is trustworthy
//   mipmap-anydpi-v26/ic_launcher{,_round}.xml          the adaptive spec
//   values/ic_launcher_background.xml                   the adaptive backdrop
//   drawable-<orient>-<d>/splash.png                    the splash before the WebView paints
//
// and for iOS: `AppIcon-512@2x.png`, 1024x1024 and OPAQUE (the App Store rejects an
// icon with an alpha channel).
//
// Two things here are easy to get wrong and are the reason the script exists rather
// than a hand-edit:
//   • the artwork ships as a rounded tile on a flat page, so the page is TRIMMED
//     before use (pngkit's flatBorderTrim measures it, per logo) and a further
//     6% is cropped to get past the tile's own rounding. Scaled edge-to-edge
//     unmodified, that page colour appears as a pale square inside a launcher's
//     circle mask — which is what the first attempt at this fix did, and only the
//     simulation of the mask caught it;
//   • every layer is generated at the exact pixel size the platform expects — AAPT
//     accepts a wrong-sized asset happily, and the launcher then resamples it at
//     the size it is really shown, blurring the logo where it is most visible.
//
// Modes: default writes (only when bytes change, so a routine build never dirties
// the tree); `--check` writes nothing and exits 1 listing anything stale — the CI
// brake. `--json` reports what it decided (backdrop, coverage, dims) for a log.
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bleedToSquare,
  composeCanvas,
  decodePng,
  dominantDarkColor,
  encodePng,
  inkCoverage,
  maskCircle,
  overScanSquare,
  parseHex,
  flatBorderTrim,
  readPngDims,
  resizeArea,
  silhouette,
  toHex,
} from './pngkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LEGACY_DP = 48;
const ADAPTIVE_DP = 108;
/** Android 13+ themed icons are a shape, not a picture: keep it plausible. */
const MONO_INK_MIN = 0.02;
const MONO_INK_MAX = 0.6;
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const IOS_ICONSET = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const SPLASH_BG = '#EEF2F7'; // the app's own background, src/index.css

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? dflt : v;
};
const px = (density, dp) => Math.round(dp * DENSITY[density]);

function sourceFile() {
  const wanted = opt('source');
  if (wanted) {
    const abs = path.isAbsolute(wanted) ? wanted : path.join(ROOT, wanted);
    if (!existsSync(abs)) throw new Error(`source logo not found: ${abs}`);
    return abs;
  }
  // The PWA icon first: scripts/refresh-brand-icons.mjs writes the administrator's
  // logo there at build time, so the mobile art follows the admin, as it must.
  for (const c of [path.join(ROOT, 'public', 'icon-512.png'), path.join(ROOT, 'resources', 'icon.png')]) {
    if (existsSync(c)) return c;
  }
  throw new Error('no source logo found (public/icon-512.png, resources/icon.png); pass --source <png>');
}

/**
 * The whole output, as data — so `--check` and a test can inspect the same plan a
 * build writes, and so the decisions (backdrop colour, over-scan, monochrome
 * trust) are reported rather than baked in silently.
 */
export function buildPlan() {
  const srcPath = sourceFile();
  const img = decodePng(readFileSync(srcPath));
  if (img.width !== img.height) {
    throw new Error(`${path.relative(ROOT, srcPath)} is ${img.width}x${img.height}; a source logo must be square`);
  }
  const overscan = Number(opt('overscan', '0.06'));
  if (!(overscan >= 0 && overscan < 0.4)) throw new Error(`--overscan must be in [0, 0.4), got ${overscan}`);
  // The crop is measured, not guessed: 0.083 for the shipped logo (84px of flat page
  // on a 1024px canvas) plus 0.06 for the tile's rounding. A logo that already bleeds
  // edge-to-edge is cropped by `--overscan` alone, which is why the default is small.
  const trim = flatBorderTrim(img);
  const trimFrac = trim.inset === 0 ? 0 : Math.max(...Object.values(trim.inset)) / Math.min(img.width, img.height);
  const cropFrac = Math.min(0.34, trimFrac + overscan);
  const tile = overScanSquare(img, cropFrac);
  const backdrop = opt('brand') ?? toHex(dominantDarkColor(tile));
  parseHex(backdrop); // fail now, not inside a half-finished write

  const plan = [];
  const push = (file, bytes, note) => plan.push({ file, bytes, note });
  const report = {
    densities: {},
    monochrome: {},
    overscan,
    flatBorder: Number(trimFrac.toFixed(4)),
    crop: Number(cropFrac.toFixed(4)),
    trimmed: trim.inset === 0 ? null : trim.inset,
    backdrop,
  };
  let anyMonochrome = false;

  for (const density of Object.keys(DENSITY)) {
    const dir = path.join(ANDROID_RES, `mipmap-${density}`);
    if (!existsSync(dir)) continue;
    const legacySize = px(density, LEGACY_DP);
    const adaptiveSize = px(density, ADAPTIVE_DP);
    const legacy = bleedToSquare(tile, legacySize);
    const adaptive = bleedToSquare(tile, adaptiveSize);
    push(path.join(dir, 'ic_launcher.png'), encodePng(legacy), 'legacy launcher icon (opaque)');
    push(path.join(dir, 'ic_launcher_round.png'), encodePng(maskCircle(legacy)), 'circular legacy icon');
    push(path.join(dir, 'ic_launcher_foreground.png'), encodePng(adaptive), 'adaptive foreground');

    // Themed icons are all-or-nothing across densities: one density with a bad
    // silhouette would make the launcher fall back mid-set, so the decision is
    // taken once, at a reference size, and applied everywhere.
    const probe = silhouette(bleedToSquare(tile, 432), parseHex(backdrop));
    const coverage = inkCoverage(probe);
    const usable = coverage >= MONO_INK_MIN && coverage <= MONO_INK_MAX;
    report.densities[density] = { legacy: legacySize, adaptive: adaptiveSize };
    report.monochrome[density] = { coverage, usable };
    if (!usable) continue;
    anyMonochrome = true;
    push(
      path.join(dir, 'ic_launcher_monochrome.png'),
      encodePng(silhouette(adaptive, parseHex(backdrop))),
      'themed-icon layer'
    );
  }
  report.monochromeShared = anyMonochrome;

  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const file = path.join(ANDROID_RES, 'mipmap-anydpi-v26', `${name}.xml`);
    if (!existsSync(path.dirname(file))) continue;
    push(file, Buffer.from(adaptiveXml(anyMonochrome), 'utf8'), 'adaptive icon spec');
  }
  push(
    path.join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
    Buffer.from(colorsXml(backdrop), 'utf8'),
    'adaptive backdrop colour'
  );

  for (const orient of ['port', 'land']) {
    for (const density of Object.keys(DENSITY)) {
      const dir = path.join(ANDROID_RES, `drawable-${orient}-${density}`);
      const file = path.join(dir, 'splash.png');
      if (!existsSync(file)) continue;
      const dims = readPngDims(readFileSync(file));
      const w = dims?.width ?? 480;
      const h = dims?.height ?? (orient === 'port' ? 800 : 480);
      push(file, encodePng(splashCanvas(w, h, tile)), 'native splash');
    }
  }

  // iOS: whatever the asset catalog DECLARES, at the pixel size each entry means
  // (`size` is in points, `scale` multiplies it). Xcode will happily build an app
  // whose declared icon is missing or the wrong size — the App Store validates it
  // later, which is the worst possible time to find out.
  const contents = path.join(IOS_ICONSET, 'Contents.json');
  let declared = null;
  if (existsSync(contents)) {
    try {
      declared = JSON.parse(readFileSync(contents, 'utf8')).images ?? [];
    } catch (e) {
      throw new Error(`${IOS_ICONSET}/Contents.json is not valid JSON (${e.message})`);
    }
  }
  if (declared && declared.length) {
    for (const image of declared) {
      if (!image?.filename) continue; // a slot with no file is an empty slot, not our business
      const [wPt] = String(image.size ?? '1024x1024').split('x').map(Number);
      const scale = Number(String(image.scale ?? '1x').replace(/x$/, '')) || 1;
      const pixels = Math.max(16, Math.round((Number(wPt) || 1024) * scale));
      push(path.join(IOS_ICONSET, image.filename), encodePng(bleedToSquare(tile, pixels)), `iOS ${image.idiom ?? 'icon'} ${image.size}@${image.scale}`);
    }
  } else {
    const iosFile = path.join(IOS_ICONSET, 'AppIcon-512@2x.png');
    const iosSize = existsSync(iosFile) ? (readPngDims(readFileSync(iosFile))?.width ?? 1024) : 1024;
    push(iosFile, encodePng(bleedToSquare(tile, Math.max(512, iosSize))), 'iOS AppIcon (opaque)');
  }

  return { plan, srcPath, report, source: { width: img.width, height: img.height } };
}

/** Logo centred a touch above centre — where launchers and Android place it. */
function splashCanvas(w, h, tile) {
  const box = Math.max(64, Math.round(Math.min(w, h) * 0.4));
  const sprite = resizeArea(tile, box, box);
  const size = Math.max(w, h);
  const painted = composeCanvas(sprite, size, { background: SPLASH_BG, dy: w < h ? 0 : -Math.round(h * 0.06) });
  if (w === h) return painted;
  // composeCanvas is square; crop the painted strip to the requested shape.
  const out = new Uint8Array(w * h * 4);
  const offX = Math.floor((size - w) / 2);
  const offY = Math.floor((size - h) / 2) + (w > h ? -Math.round(h * 0.06) : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + offY) * size + (x + offX)) * 4;
      const d = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = painted.data[s + c];
    }
  }
  return { width: w, height: h, data: out, alpha: false };
}

function adaptiveXml(monochrome) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by scripts/mobile-icons.mjs — do not hand-edit; run \`npm run
     mobile:icons\`. A launcher on Android 8+ uses an ADAPTIVE icon: backdrop and
     artwork are separate layers and the launcher masks the pair to its own shape
     (circle, squircle, teardrop…), so an icon that only looks right as a square is
     clipped. ${monochrome ? '`monochrome` is the layer themed mode tints (Android 13+).' : 'No `monochrome` layer: the source logo did not separate into a trustworthy silhouette, and a bad one is worse than none — themed mode then scales the foreground instead.'} -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>${monochrome ? `\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>` : ''}
</adaptive-icon>
`;
}

function colorsXml(hex) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by scripts/mobile-icons.mjs from the logo's own backdrop. This was
     #FFFFFF (the template default) while the artwork was the placeholder, which is
     why a home-screen tile could read as an empty white square. -->
<resources>
    <color name="ic_launcher_background">${hex}</color>
</resources>
`;
}

// ── write / check ──────────────────────────────────────────────────────────

function main() {
  const check = flag('check');
  let built;
  try {
    built = buildPlan();
  } catch (e) {
    // Icon art must never brick a build: report it and leave the committed art.
    console.error(`[mobile-icons] ${e.message}`);
    process.exit(check ? 1 : 0);
    return;
  }
  const stale = [];
  const missing = [];
  for (const item of built.plan) {
    const rel = path.relative(ROOT, item.file);
    if (existsSync(item.file) && Buffer.compare(readFileSync(item.file), item.bytes) === 0) continue;
    (existsSync(item.file) ? stale : missing).push(rel);
    if (check) continue;
    mkdirSync(path.dirname(item.file), { recursive: true });
    writeFileSync(item.file, item.bytes);
  }
  const summary = {
    source: path.relative(ROOT, built.srcPath),
    sourceSize: built.source,
    overscan: built.report.overscan,
    crop: built.report.crop,
    flatBorder: built.report.flatBorder,
    backdrop: built.report.backdrop,
    monochrome: built.report.monochromeShared,
    files: built.plan.length,
    stale: check ? stale.concat(missing) : [],
    written: check ? 0 : stale.length + missing.length,
  };
  if (flag('json')) console.log(JSON.stringify(summary, null, 2));
  else if (check) {
    if (summary.stale.length) {
      console.error(`[mobile-icons] ${summary.stale.length} mobile icon file(s) do not match ${summary.source}:`);
      for (const f of summary.stale) console.error(`  - ${f}`);
      console.error('[mobile-icons] fix with: npm run mobile:icons');
    } else {
      console.log(
        `[mobile-icons] ${built.plan.length} mobile icon files match ${summary.source}` +
          ` (backdrop ${summary.backdrop}, crop ${Math.round(summary.crop * 100)}%).`
      );
    }
  } else if (summary.written) {
    console.log(
      `[mobile-icons] refreshed ${summary.written} mobile icon file(s) from ${summary.source}` +
        ` — crop ${Math.round(summary.crop * 100)}% (${Math.round(summary.flatBorder * 100)}% flat page + ${Math.round(summary.overscan * 100)}% rounding), backdrop ${summary.backdrop},` +
        ` themed layer ${summary.monochrome ? 'on' : 'off'}.`
    );
  } else {
    console.log(`[mobile-icons] mobile icon set already current (${summary.source}).`);
  }
  if (check && summary.stale.length) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { adaptiveXml, colorsXml, splashCanvas, DENSITY, LEGACY_DP, ADAPTIVE_DP };
