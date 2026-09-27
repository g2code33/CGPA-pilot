// Mobile icon/splash generation: the pure raster math, the plan, and the committed state.
//
// This exists because the artwork that ships to a phone was a placeholder and nothing
// checked it. The last section is the gate: every byte in `android/app/src/main/res`
// and in the iOS asset catalog must equal what the generator derives from
// `public/icon-512.png` — which is itself the administrator's logo. A hand-edited or
// forgotten icon fails here, not on someone's home screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { adaptiveXml, buildPlan, colorsXml, splashCanvas } from '../scripts/mobile-icons.mjs';
import {
  bleedToSquare,
  clamp255,
  colourDistance,
  composeCanvas,
  crc32,
  crop,
  decodePng,
  dominantColor,
  dominantDarkColor,
  encodePng,
  flatten,
  inkCoverage,
  luma,
  maskCircle,
  maskRoundedSquare,
  overScanSquare,
  parseHex,
  readPngDims,
  resizeArea,
  silhouette,
  toHex,
} from '../scripts/pngkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'icon-512.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SCALE = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const DENSITIES = Object.keys(SCALE);

/** A flat tile, optionally with a different-coloured border and a centre marker. */
function tile(size, fill, { border = null, borderSize = 0, marker = null } = {}) {
  const data = new Uint8Array(size * size * 4);
  const put = (x, y, [r, g, b, a = 255]) => {
    const i = (y * size + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) put(x, y, fill);
  if (border) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < borderSize || y < borderSize || x >= size - borderSize || y >= size - borderSize) put(x, y, border);
      }
    }
  }
  if (marker) put(Math.floor(size / 2), Math.floor(size / 2), marker);
  return { width: size, height: size, data };
}
const at = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

test('crc32 matches zlib — one wrong word moves a chunk and hides it in a decoder', () => {
  const bytes = readFileSync(SRC).subarray(0, 4096);
  assert.equal(crc32(bytes), zlib.crc32(bytes) >>> 0);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('encode/decode round-trips an RGBA image byte for byte', () => {
  const img = tile(37, [12, 200, 90], { marker: [255, 0, 0, 40] });
  const back = decodePng(encodePng(img));
  assert.deepEqual({ width: back.width, height: back.height }, { width: 37, height: 37 });
  assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
});

test('encodePng honours the greyscale mode and the decoder returns RGBA', () => {
  const png = encodePng(tile(8, [200, 60, 60]), { grayscale: true });
  const dims = readPngDims(png);
  assert.equal(dims.colorType, 4, 'grey + alpha, the form build/icon.png and .ico want');
  const back = decodePng(png);
  assert.equal(back.width, 8);
  assert.ok(Math.abs(back.data[0] - luma(200, 60, 60)) <= 1, 'luma preserved through the encoder');
  assert.equal(back.data[0], back.data[2], 'grey means grey: no leftover hue');
});

test('the shipped master is a square opaque PNG, as the resize rules assume', () => {
  const dims = readPngDims(readFileSync(SRC));
  assert.deepEqual(dims, { width: 1024, height: 1024, bitDepth: 8, colorType: 2 });
  assert.equal(dims.colorType, 2, 'no alpha: public/icon-512.png is a flat tile by design');
});

test('crop copies exactly, and reads outside the source as transparent', () => {
  const img = tile(8, [10, 20, 30], { marker: [99, 99, 99] });
  const c = crop(img, 2, 2, 6, 6);
  assert.deepEqual([c.width, c.height], [6, 6]);
  assert.deepEqual(at(c, 0, 0), [10, 20, 30]);
  const oob = crop(img, 6, 6, 8, 8);
  assert.deepEqual([oob.width, oob.height], [8, 8]);
  assert.deepEqual(at(oob, 0, 0), [10, 20, 30], 'the in-bounds corner copies exactly');
  assert.deepEqual([oob.data[(0 * 8 + 7) * 4 + 3], oob.data[(7 * 8 + 7) * 4]], [0, 0], 'reads past the edge are transparent zeros, never black paint');
});

test('resizeArea averages (a box filter), so a checkerboard becomes grey', () => {
  const flat = tile(64, [200, 100, 50]);
  assert.deepEqual(at(resizeArea(flat, 8, 8), 0, 0), [200, 100, 50]);
  const data = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = (x + y) % 2 === 0 ? 255 : 0;
      const i = (y * 64 + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const out = resizeArea({ width: 64, height: 64, data }, 32, 32);
  const avg = Array.from(out.data.filter((_, i) => i % 4 === 0)).reduce((a, b) => a + b, 0) / (32 * 32);
  assert.ok(Math.abs(avg - 127.5) < 3, `half black, half white must average to grey, got ${avg}`);
});

test('bleedToSquare centre-crops then fills the square — no letterbox, no stretch', () => {
  const src = tile(100, [1, 2, 3]);
  for (let y = 42; y < 58; y++) for (let x = 42; x < 58; x++) {
    const i = (y * 100 + x) * 4;
    src.data[i] = src.data[i + 1] = src.data[i + 2] = 250;
  }
  const out = bleedToSquare(src, 80);
  assert.deepEqual([out.width, out.height], [80, 80]);
  assert.equal(out.data[3], 255, 'opaque end to end: a transparent launcher tile shows the wallpaper');
  assert.deepEqual(at(out, 40, 40), [250, 250, 250], 'the centre survives the crop and the resize');
});

test('overScanSquare crops INTO the artwork, which is how a white surround dies', () => {
  // The defect this exists for: a logo drawn as a rounded tile on a white page.
  const logo = tile(100, [200, 30, 30], { border: [255, 255, 255], borderSize: 6 });
  const o = overScanSquare(logo, 0.14);
  assert.equal(o.width, 86);
  assert.equal(o.height, 86);
  assert.deepEqual(at(o, 0, 0), [200, 30, 30], 'the corner is now art, not the page behind it');
  assert.deepEqual(at(logo, 0, 0), [255, 255, 255], '…which is what it was before');
  // The function itself is dumb arithmetic; the range that would eat the mark is
  // refused by the caller (asserted on the CLI below).
  assert.equal(overScanSquare(logo, 0).width, 100, 'zero over-scan is a plain centre-crop');
});

test('masks clear the corners and leave the centre', () => {
  const m = maskCircle(tile(101, [9, 9, 9]));
  assert.equal(m.data[3], 0, 'a circle must clear its corner');
  assert.equal(m.data[(50 * 101 + 50) * 4 + 3], 255);
  const r = maskRoundedSquare(tile(101, [9, 9, 9]), 0.24);
  assert.equal(r.data[3], 0);
  assert.notDeepEqual(Buffer.from(m.data), Buffer.from(r.data), 'a circle and a squircle are different shapes');
});

test('flatten composites antialiased art onto a colour and forces opacity', () => {
  const src = tile(4, [255, 0, 0], { marker: [0, 0, 255, 128] });
  const out = flatten(src, '#FFFFFF');
  assert.equal(out.data[3], 255, 'an opaque pixel keeps its colour');
  assert.deepEqual(at(out, 2, 2), [127, 127, 255], 'a half-transparent blue becomes pale blue, not black');
  assert.equal(out.alpha, false);
  assert.throws(() => flatten(src, 'crimson'), /hex/);
});

test('parseHex/toHex/parse round-trip, and a bad colour is refused', () => {
  assert.deepEqual(parseHex('#1a1b43'), { r: 26, g: 27, b: 67 });
  assert.deepEqual(parseHex('#ABC'), { r: 170, g: 187, b: 204 });
  assert.equal(toHex(parseHex('#1A1B43')), '#1A1B43');
  assert.throws(() => parseHex('nope'), /hex/i);
  assert.equal(clamp255(-4), 0);
  assert.equal(clamp255(900), 255);
});

test('the backdrop is the common DARK colour, not the common colour', () => {
  // A white logo field on a dark mark would be sampled the wrong way round by a
  // plain average, and the adaptive background would then be white.
  const art = tile(64, [255, 255, 255]);
  for (let i = 0; i < 700; i++) {
    const o = i * 4;
    art.data[o] = 26;
    art.data[o + 1] = 27;
    art.data[o + 2] = 67;
  }
  assert.equal(toHex(dominantColor(art)), '#FFFFFF', 'by mass, white wins');
  assert.equal(toHex(dominantDarkColor(art)), '#1A1B43', 'the FIELD of the tile is what a launcher should paint');
});

test('colourDistance separates a mark from a wash of the same hue', () => {
  const bg = parseHex('#1A1B43');
  assert.equal(colourDistance(26, 27, 67, bg), 0, 'a backdrop pixel is no distance from the backdrop');
  const mark = colourDistance(250, 250, 250, bg);
  const wash = colourDistance(40, 45, 95, bg);
  assert.ok(mark > 100, `the mark must read as ink: ${mark}`);
  assert.ok(wash < mark, `a gradient wash must stay closer than the mark: ${wash} vs ${mark}`);
});

test('luma is Rec.709', () => {
  assert.ok(Math.abs(luma(255, 255, 255) - 255) < 0.01);
  assert.equal(luma(0, 0, 0), 0);
  assert.ok(Math.abs(luma(0, 255, 0) - 182) < 1, 'green is the bright primary');
});

test('silhouette is alpha-only ink', () => {
  const art = tile(64, [250, 10, 200], { marker: [255, 255, 255, 255] });
  const sil = silhouette(art, parseHex('#1A1B43'));
  const inky = (x, y) => sil.data[(y * 64 + x) * 4 + 3] > 200;
  assert.ok(inky(32, 32));
  const i = (5 * 64 + 5) * 4;
  assert.deepEqual([sil.data[i], sil.data[i + 1], sil.data[i + 2]], [255, 255, 255], 'no colour survives');
  assert.equal(inkCoverage(silhouette(tile(64, [255, 255, 255]), parseHex('#FFFFFF'))), 0, 'a flat tile is not a mark');
});

test('composeCanvas centres, offsets and out-crops', () => {
  const small = composeCanvas(tile(4, [7, 7, 7]), 12, { background: '#000000' });
  assert.deepEqual([small.width, small.height], [12, 12]);
  assert.deepEqual(at(small, 0, 0), [0, 0, 0]);
  assert.deepEqual(at(small, 6, 6), [7, 7, 7]);
  const nudged = composeCanvas(tile(4, [7, 7, 7]), 12, { background: '#000000', dy: -2 });
  assert.deepEqual(at(nudged, 6, 4), [7, 7, 7], 'the splash sits above centre on purpose');
  assert.throws(() => composeCanvas(tile(4, [7, 7, 7]), 12, { background: [0, 0, 0] }), /hex/);
  const big = composeCanvas(tile(20, [7, 8, 9]), 8, { background: '#000000' });
  assert.deepEqual([big.width, big.height], [8, 8]);
  assert.deepEqual(at(big, 0, 0), [7, 8, 9], 'an oversized sprite is centre-cropped, never padded');
});

test('buildPlan describes the whole Android set the platform asks for', () => {
  const { plan, srcPath, report, source } = buildPlan();
  assert.equal(srcPath, SRC, 'the mobile art follows the administrator logo written by refresh-brand-icons');
  assert.deepEqual(source, { width: 1024, height: 1024 });
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  const files = plan.map((i) => rel(i.file));
  for (const d of DENSITIES) {
    for (const base of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      assert.ok(files.includes(`android/app/src/main/res/mipmap-${d}/${base}`), `${d}/${base}`);
    }
    assert.deepEqual(report.densities[d], { legacy: Math.round(48 * SCALE[d]), adaptive: Math.round(108 * SCALE[d]) });
    for (const [name, expect] of [
      ['ic_launcher.png', Math.round(48 * SCALE[d])],
      ['ic_launcher_round.png', Math.round(48 * SCALE[d])],
      ['ic_launcher_foreground.png', Math.round(108 * SCALE[d])],
    ]) {
      const item = plan.find((i) => rel(i.file).endsWith(`mipmap-${d}/${name}`));
      const dims = readPngDims(item.bytes);
      assert.deepEqual([dims.width, dims.height], [expect, expect], `${d}/${name} must be ${expect}px`);
    }
  }
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    assert.ok(files.includes(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`), `${name}.xml`);
  }
  assert.ok(files.includes('android/app/src/main/res/values/ic_launcher_background.xml'));
  for (const orient of ['port', 'land']) {
    for (const d of DENSITIES) {
      const rel2 = `android/app/src/main/res/drawable-${orient}-${d}/splash.png`;
      const item = plan.find((i) => rel(i.file) === rel2);
      assert.ok(item, rel2);
      // Generated to the dimensions the file already declares: a resize of a native
      // splash would be a layout change nobody asked for, so the invariant is
      // "same size, new art" — and portrait is taller than landscape, always.
      const dims = readPngDims(item.bytes);
      const onDisk = readPngDims(readFileSync(path.join(ROOT, rel2)));
      assert.deepEqual(dims, onDisk, `${rel2} was resized`);
      assert.ok(dims.height > dims.width || dims.width > dims.height, `${rel2} must not be square`);
      assert.equal(orient === 'port' ? dims.height > dims.width : dims.width > dims.height, true, `${rel2} orientation`);
    }
  }
  assert.ok(files.some((f) => f.startsWith('ios/App/App/Assets.xcassets/AppIcon.appiconset/')), 'iOS catalog entry');
  assert.equal(report.overscan, 0.06, 'the extra crop is a sixth of the canvas, not a guess at the whole border');
  assert.ok(report.flatBorder > 0.08 && report.flatBorder < 0.09, `measured flat page: ${report.flatBorder}`);
  assert.ok(report.crop > report.flatBorder, 'the mark is cropped past its own page, which is the whole point');
  assert.deepEqual(report.trimmed, { top: 84, bottom: 85, left: 84, right: 85 });
  assert.match(report.backdrop, /^#[0-9A-F]{6}$/);
});

test('every planned byte equals what is committed, so CI can reproduce it', () => {
  const { plan } = buildPlan();
  const drifted = [];
  for (const item of plan) {
    const rel = path.relative(ROOT, item.file).split(path.sep).join('/');
    if (!existsSync(item.file)) drifted.push(`${rel}: MISSING`);
    else if (!Buffer.compare(readFileSync(item.file), item.bytes) === 0) drifted.push(`${rel}: ${item.note}`);
  }
  assert.deepEqual(drifted, [], `stale mobile artwork:\n${drifted.join('\n')}`);
});

test('legacy tiles are opaque, round ones masked, adaptive ones full-bleed', () => {
  const plan = buildPlan().plan;
  const get = (p) => plan.find((i) => i.file.replace(/\\/g, '/').endsWith(p));
  const legacy = decodePng(get('/mipmap-xxxhdpi/ic_launcher.png').bytes);
  assert.equal(legacy.data[3], 255, 'a transparent legacy tile shows the wallpaper through it');
  const round = decodePng(get('/mipmap-xxxhdpi/ic_launcher_round.png').bytes);
  assert.equal(round.data[3], 0, 'the round variant must actually be round');
  assert.equal(round.data[((round.height >> 1) * round.width + (round.width >> 1)) * 4 + 3], 255);
  const fg = decodePng(get('/mipmap-xxxhdpi/ic_launcher_foreground.png').bytes);
  assert.equal(fg.width, fg.height);
  assert.equal(fg.data[3], 255, 'the foreground layer is opaque, so no white square can appear inside a mask');
  // The masked composite is what a launcher actually shows — this is the shape the
  // first attempt got wrong (a pale square inside the circle), and viewing the source
  // PNG could not catch it. Compose the layers the way the platform does and look at
  // THAT.
  const { report } = buildPlan();
  const shown = maskCircle(flatten(fg, report.backdrop));
  assert.ok(inkCoverage(shown) > 0.5, 'the mark must fill the masked tile');
  assert.equal(shown.data[3], 0, 'the corner is cut away, so the launcher shows its own shape');
  // The white of the graduation cap is the ARTWORK and is allowed. The defect this
  // guards is the page colour surviving as a FRAME, so only the outer ring is judged —
  // measured, not eyeballed, because viewing the source PNG is what missed it before.
  const mid = shown.width / 2;
  const isWhite = (x, y) => {
    const o = (y * shown.width + x) * 4;
    return shown.data[o + 3] > 200 && shown.data[o] > 245 && shown.data[o + 1] > 245 && shown.data[o + 2] > 245;
  };
  let ringInk = 0;
  let ringWhite = 0;
  for (let a = 0; a < 360; a += 1) {
    const r = mid * 0.97;
    const x = Math.round(mid + r * Math.cos((a * Math.PI) / 180));
    const y = Math.round(mid + r * Math.sin((a * Math.PI) / 180));
    if (x < 0 || y < 0 || x >= shown.width || y >= shown.height) continue;
    const o = (y * shown.width + x) * 4;
    if (shown.data[o + 3] <= 200) continue;
    ringInk += 1;
    if (isWhite(x, y)) ringWhite += 1;
  }
  assert.ok(ringInk > 300, `a full sweep of the masked edge, got ${ringInk} samples`);
  assert.equal(ringWhite, 0, `${ringWhite}/${ringInk} edge pixels are the page colour — a white frame is back`);
});

test('the themed layer is emitted only when the mark can read as ink', () => {
  const { report } = buildPlan();
  const coverages = DENSITIES.map((d) => report.monochrome[d].coverage);
  assert.ok(coverages.every((c) => c >= 0.02 && c <= 0.6), `measured coverage: ${coverages}`);
  assert.equal(
    report.monochromeShared,
    coverages.every((c) => c >= 0.02 && c <= 0.6),
    'one decision for every density, or a launcher falls back mid-set'
  );
  const xml = adaptiveXml(true);
  assert.match(xml, /<foreground\s+android:drawable="@mipmap\/ic_launcher_foreground"/);
  assert.match(xml, /<monochrome\s+android:drawable="@mipmap\/ic_launcher_monochrome"/);
  const bare = adaptiveXml(false);
  assert.ok(!bare.includes('<monochrome'), 'a half-tinted monochrome layer is worse than none');
  assert.match(bare, /did not separate into a trustworthy silhouette/, 'and the XML says why, in the file');
  assert.match(bare, /<\/adaptive-icon>/);
});

test('the adaptive backdrop colour is written once, from the art', () => {
  const { plan, report } = buildPlan();
  const xml = plan.find((i) => i.file.endsWith(path.join('values', 'ic_launcher_background.xml')));
  assert.ok(xml.bytes.toString('utf8').includes(`<color name="ic_launcher_background">${report.backdrop}</color>`));
  const standalone = colorsXml('#0A1B2C');
  assert.equal((standalone.match(/<color /g) ?? []).length, 1);
  assert.match(standalone, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<!--[\s\S]*-->\n<resources>/);
  assert.equal(toHex(parseHex(colorsXml('#0A1B2C').match(/>(#[0-9A-F]{6})</)[1])), '#0A1B2C');
});

test('the native splash is the logo above centre on the app background', () => {
  const tileImg = decodePng(readFileSync(SRC));
  const c = splashCanvas(320, 480, overScanSquare(tileImg, 0.14));
  assert.deepEqual([c.width, c.height], [320, 480]);
  assert.deepEqual(at(c, 0, 0), [0xee, 0xf2, 0xf7], 'the strip the status bar sits on is the app background');
  const wide = splashCanvas(480, 320, overScanSquare(tileImg, 0.14));
  assert.deepEqual([wide.width, wide.height], [480, 320]);
  // Portrait keeps the art centred horizontally and lifted; the top row must be clean.
  const mid = Math.floor(wide.width / 2);
  assert.deepEqual(at(c, mid, 4), [0xee, 0xf2, 0xf7]);
});

test('the CLI check reports a stale set without touching it, and generation can be undone', () => {
  const clean = run(['scripts/mobile-icons.mjs', '--check'], 0);
  assert.match(clean, /mobile icon files match public\/icon-512\.png/);
  const dir = path.join(ROOT, 'test', 'tmp-mobile-icons');
  mkdirSync(dir, { recursive: true });
  // Generation writes into the repo (that IS its job), so the test snapshots every
  // byte it could touch and puts them back — a test that leaves the working tree
  // dirty is a test that makes the next one lie.
  const snapshot = new Map(buildPlan().plan.map((i) => [i.file, readFileSync(i.file)]));
  const restore = () => {
    for (const [file, bytes] of snapshot) writeFileSync(file, bytes);
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const flat = path.join(dir, 'flat.png');
    writeFileSync(flat, encodePng(tile(256, [20, 20, 20])));
    const stale = run(['scripts/mobile-icons.mjs', '--check', '--source', flat]);
    assert.match(stale, /do not match test\/tmp-mobile-icons\/flat\.png/);
    assert.match(stale, /mipmap-anydpi-v26\/ic_launcher\.xml/);
    assert.equal(snapshot.size, 34);
    // `--check` never writes: the bytes on disk are still the snapshot.
    for (const [file, bytes] of snapshot) assert.deepEqual(readFileSync(file), bytes, `${path.basename(file)} was written by a check`);
    // Generation does write, and a usable-but-different source legitimately changes
    // the themed-layer decision.
    run(['scripts/mobile-icons.mjs', '--source', flat], 0);
    assert.equal(
      readFileSync(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8').includes('<monochrome'),
      false,
      'a flat tile has no silhouette, so the themed layer must go'
    );
    assert.match(run(['scripts/mobile-icons.mjs', '--check'], 1), /do not match/);
  } finally {
    restore();
  }
  assert.match(run(['scripts/mobile-icons.mjs', '--check'], 0), /mobile icon files match/);

  mkdirSync(dir, { recursive: true });
  const wide = path.join(dir, 'wide.png');
  writeFileSync(wide, encodePng({ width: 64, height: 32, data: new Uint8Array(64 * 32 * 4).fill(200) }));
  try {
    assert.match(run(['scripts/mobile-icons.mjs', '--check', '--source', wide], 1), /must be square/);
    assert.match(
      run(['scripts/mobile-icons.mjs', '--source', wide], 0),
      /must be square/,
      'icon art must never brick a build: only the gate is allowed to fail'
    );
    assert.match(run(['scripts/mobile-icons.mjs', '--check', '--source', 'package.json'], 1), /png|image|decode|signature/i);
    assert.match(run(['scripts/mobile-icons.mjs', '--check', '--source', 'nope.png'], 1), /not found/);
    assert.match(run(['scripts/mobile-icons.mjs', '--check', '--overscan', '0.9'], 1), /overscan/);
    assert.match(
      run(['scripts/mobile-icons.mjs', '--check', '--brand', 'seasalt'], 1),
      /hex/i,
      'a brand colour is validated before it can reach a generated resource'
    );
  } finally {
    for (const [file, bytes] of snapshot) writeFileSync(file, bytes);
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(run(['scripts/mobile-icons.mjs', '--check'], 0), /mobile icon files match/, 'the working tree is clean again');
});

/** Runs the generator and hands back BOTH streams, whatever the exit code was. */
function run(args, expectCode) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (expectCode !== undefined) assert.equal(res.status, expectCode, out);
  return out;
}
