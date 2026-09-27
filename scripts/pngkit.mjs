// ─────────────────────────────────────────────────────────────────────────
// pngkit — a dependency-free PNG reader, compositor and writer.
//
// Why this exists: every shipped icon for every target (Android mipmaps, iOS
// AppIcon, the Windows .ico source, the Linux hicolor set, the PWA icon) has to be
// *rasterized* from one source logo, and the previous pipeline shelled out to
// ImageMagick. Where ImageMagick is absent — as it is on the GitHub Actions runners
// this repo builds on — the refresh step printed a warning and changed nothing, so
// installers shipped whatever art was committed. For the mobile targets that art
// was still the stock Capacitor placeholder, and a launcher reads the APK: no
// runtime branding can fix an icon that was never in the package.
//
// A PNG codec needs no third-party code, only `node:zlib`, so icon generation now
// works anywhere Node runs and produces identical bytes on every machine. The
// module is small and honest about its limits:
//
//   • reads 8/16-bit (and 1/4-bit packed) non-interlaced PNGs of colour types
//     0/2/3/4/6, with PLTE and tRNS;
//   • writes 8-bit RGBA (type 6) or gray+alpha (type 4), filter 0 rows;
//   • resampling is coverage-weighted area filtering in PREMULTIPLIED space, so a
//     soft-edged logo never grows the dark halo naive averaging produces;
//   • anything unsupported throws and says what — a silently wrong icon is worse
//     than a build error.
// ─────────────────────────────────────────────────────────────────────────

import { deflateSync, inflateSync } from 'node:zlib';

const SIGN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// ── decode ───────────────────────────────────────────────────────────────

/**
 * @returns {{width:number,height:number,data:Uint8Array,alpha:boolean}} RGBA,
 *   row-major, 4 bytes per pixel.
 */
export function decodePng(bytes) {
  const buf = toBuffer(bytes);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGN)) throw new Error('not a PNG (bad signature)');
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + len;
    if (end + 4 > buf.length) throw new Error(`PNG chunk ${type} is truncated`);
    if (buf.readUInt32BE(end) !== crc32(buf.subarray(pos + 4, end))) {
      throw new Error(`PNG chunk ${type} fails its CRC (corrupt file)`);
    }
    if (type === 'IHDR') {
      ihdr = {
        width: buf.readUInt32BE(start),
        height: buf.readUInt32BE(start + 4),
        bitDepth: buf[start + 8],
        colorType: buf[start + 9],
        compression: buf[start + 10],
        filter: buf[start + 11],
        interlace: buf[start + 12],
      };
    } else if (type === 'PLTE') palette = buf.subarray(start, end);
    else if (type === 'tRNS') trns = buf.subarray(start, end);
    else if (type === 'IDAT') idat.push(buf.subarray(start, end));
    else if (type === 'IEND') break;
    pos = end + 4;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  if (ihdr.compression !== 0) throw new Error(`PNG compression method ${ihdr.compression} unsupported`);
  if (ihdr.filter !== 0) throw new Error('PNG filter method unsupported');
  if (ihdr.interlace !== 0) throw new Error('interlaced (Adam7) PNG unsupported — export a non-interlaced PNG');
  if (!(ihdr.bitDepth in { 1: 1, 4: 1, 8: 1, 16: 1 })) {
    throw new Error(`PNG bit depth ${ihdr.bitDepth} unsupported (need 1/4/8/16)`);
  }
  const channels = CHANNELS[ihdr.colorType];
  if (!channels) throw new Error(`PNG colour type ${ihdr.colorType} unsupported`);
  if (ihdr.colorType === 3 && !palette) throw new Error('palette PNG without a PLTE chunk');
  const { width, height } = ihdr;
  if (!width || !height || width > 8192 || height > 8192) {
    throw new Error(`PNG is ${width}x${height}; refusing anything over 8192 on a side`);
  }

  const bpp = Math.max(1, Math.floor((channels * ihdr.bitDepth) / 8));
  const stride = Math.floor((width * channels * ihdr.bitDepth + 7) / 8);
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (e) {
    throw new Error(`PNG pixel data could not be inflated (${e.message})`);
  }
  if (raw.length < (stride + 1) * height) {
    throw new Error(`PNG data is short: ${raw.length} bytes for ${height} rows of ${stride + 1}`);
  }

  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    unfilterLine(raw[base], raw.subarray(base + 1, base + 1 + stride), line, prev, bpp);
    emitLine(line, out, y, width, ihdr, palette, trns, channels);
    prev.set(line);
  }
  const alpha = ihdr.colorType === 4 || ihdr.colorType === 6 || trns !== null;
  return { width, height, data: out, alpha };
}

function toBuffer(bytes) {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
}

function unfilterLine(filter, src, line, prev, bpp) {
  switch (filter) {
    case 0:
      line.set(src);
      return;
    case 1:
      for (let i = 0; i < src.length; i++) line[i] = (src[i] + (i >= bpp ? line[i - bpp] : 0)) & 0xff;
      return;
    case 2:
      for (let i = 0; i < src.length; i++) line[i] = (src[i] + prev[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < src.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (src[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < src.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        line[i] = (src[i] + paeth(a, b, c)) & 0xff;
      }
      return;
    default:
      throw new Error(`PNG row filter ${filter} unsupported`);
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** One reconstructed scanline → 8-bit RGBA rows of the output. */
function emitLine(line, out, y, width, ihdr, palette, trns, channels) {
  const { colorType, bitDepth } = ihdr;
  for (let x = 0; x < width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;
    if (colorType === 3) {
      const idx = bitDepth === 8 ? line[x] : readBits(line, x, bitDepth);
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else {
      const at = (i) =>
        bitDepth === 8
          ? line[x * channels + i]
          : bitDepth === 16
            ? (line[(x * channels + i) * 2] << 8) | line[(x * channels + i) * 2 + 1]
            : scaleSample(readBits(line, x * channels + i, bitDepth), bitDepth);
      if (colorType === 0) r = g = b = at(0);
      else if (colorType === 4) {
        r = g = b = at(0);
        a = at(1);
      } else if (colorType === 2) {
        r = at(0);
        g = at(1);
        b = at(2);
      } else {
        r = at(0);
        g = at(1);
        b = at(2);
        a = at(3);
      }
    }
    const o = (y * width + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
}

/** Sub-byte samples are packed MSB-first inside a scanline. */
function readBits(line, index, bitDepth) {
  const bitPos = index * bitDepth;
  const byte = line[bitPos >> 3];
  const shift = 8 - bitDepth - (bitPos & 7);
  return (byte >> shift) & (1 << bitDepth) - 1;
}

/** Any bit depth → 0..255. */
function scaleSample(v, bitDepth) {
  if (bitDepth === 8) return v;
  if (bitDepth === 16) return v >> 8;
  if (bitDepth === 4) return (v << 4) | v;
  if (bitDepth === 1) return v ? 255 : 0;
  return v;
}

// ── encode ───────────────────────────────────────────────────────────────

/**
 * @param {{width:number,height:number,data:Uint8Array}} img RGBA
 * @param {{grayscale?:boolean}} opts write gray+alpha instead of RGBA
 */
export function encodePng(img, opts = {}) {
  const { width, height, data } = img;
  const mono = opts.grayscale === true;
  const channels = mono ? 2 : 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Filter 0. Sub/Up/Paeth were measured here on real icon art and lost: an
    // RGBA tile whose alpha row is constant compresses no better by any filter,
    // at several times the cost, and this runs inside every build.
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const sp = (y * width + x) * 4;
      const d = y * (stride + 1) + 1 + x * channels;
      if (mono) {
        raw[d] = luma(data[sp], data[sp + 1], data[sp + 2]);
        raw[d + 1] = data[sp + 3];
      } else {
        raw[d] = data[sp];
        raw[d + 1] = data[sp + 1];
        raw[d + 2] = data[sp + 2];
        raw[d + 3] = data[sp + 3];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = mono ? 4 : 6;
  return Buffer.concat([
    SIGN,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function luma(r, g, b) {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

let CRC_TABLE = null;
export function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

/** Cheap IHDR peek, for sizing a file against the dimension its name promises. */
export function readPngDims(bytes) {
  try {
    const buf = toBuffer(bytes);
    if (buf.length < 26 || !buf.subarray(0, 8).equals(SIGN)) return null;
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
  } catch {
    return null;
  }
}

// ── geometry ──────────────────────────────────────────────────────────────

export function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Resample to `w`x`h` by coverage-weighted area filtering. Each destination pixel
 * accumulates the source area it spans, in premultiplied space, and divides by
 * the ink found there. Averaging straight RGB is what puts a dark fringe around a
 * soft-edged logo, and averaging without dividing by coverage fades every
 * downscale — both are avoided here deliberately.
 */
export function resizeArea(img, w, h) {
  const { width: sw, height: sh, data } = img;
  const out = new Uint8Array(w * h * 4);
  const xRatio = sw / w;
  const yRatio = sh / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * yRatio;
    const y1 = Math.min(sh, y0 + yRatio);
    const iy0 = Math.floor(y0);
    const iy1 = Math.max(iy0 + 1, Math.ceil(y1));
    for (let x = 0; x < w; x++) {
      const x0 = x * xRatio;
      const x1 = Math.min(sw, x0 + xRatio);
      const ix0 = Math.floor(x0);
      const ix1 = Math.max(ix0 + 1, Math.ceil(x1));
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        const row = sy * sw;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const sp = (row + sx) * 4;
          const a = data[sp + 3] / 255;
          accA += a * weight;
          accR += (data[sp] / 255) * a * weight;
          accG += (data[sp + 1] / 255) * a * weight;
          accB += (data[sp + 2] / 255) * a * weight;
        }
      }
      const d = (y * w + x) * 4;
      const coverage = (x1 - x0) * (y1 - y0);
      const a = accA / coverage;
      if (a <= 0 || accA <= 0) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
        continue;
      }
      out[d] = clamp255(Math.round((accR / accA) * 255));
      out[d + 1] = clamp255(Math.round((accG / accA) * 255));
      out[d + 2] = clamp255(Math.round((accB / accA) * 255));
      out[d + 3] = clamp255(Math.round(a * 255));
    }
  }
  return { width: w, height: h, data: out, alpha: true };
}

export function crop(img, x0, y0, w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      // Transparent, not the previous row: a caller with an off-by-one box gets a
      // visible seam it can see, instead of scrambled art that decodes fine.
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const s = (sy * img.width + sx) * 4;
      const d = (y * w + x) * 4;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
      data[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data, alpha: true };
}

/**
 * Cut away a FLAT page border, exactly — the measurement that makes the rest of the
 * pipeline safe.
 *
 * Icon art ships as a rounded tile on a solid page (see public/icon-512.png: the
 * tile occupies x84..938 of 1024, so 8.3% of every side is page colour). Scaling that
 * edge-to-edge puts the page INSIDE a launcher's mask as a visible square — the exact
 * defect a fixed over-scan was invented to hide, which then clips the artwork whenever
 * the padding is thinner than the guess. Trimming what is demonstrably flat is
 * lossless: a row counts as border only if every sampled pixel (and its alpha) equals
 * the corner colour within `tolerance`, and the four corners have to agree first.
 *
 * Returns { image, inset } — `inset` is how much was removed per side, so a caller can
 * report it and a test can assert the measurement instead of a magic number.
 */
export function flatBorderTrim(img, opts = {}) {
  const tolerance = opts.tolerance ?? 6;
  const maxFrac = opts.maxFrac ?? 0.3;
  const stride = opts.stride ?? Math.max(1, Math.floor(Math.min(img.width, img.height) / 160));
  const { width, height, data } = img;
  const patch = (x, y) => {
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const px = Math.min(width - 1, Math.max(0, x + dx));
        const py = Math.min(height - 1, Math.max(0, y + dy));
        const o = (py * width + px) * 4;
        for (let c = 0; c < 4; c++) acc[c] += data[o + c];
        n += 1;
      }
    }
    return acc.map((v) => v / n);
  };
  const corners = [patch(0, 0), patch(width - 4, 0), patch(0, height - 4), patch(width - 4, height - 4)];
  const ref = corners[0];
  const agree = corners.every((c) => c.every((v, i) => Math.abs(v - ref[i]) <= tolerance * 2));
  if (!agree) return { image: img, inset: 0 };
  const flatRow = (y) => {
    for (let x = 0; x < width; x += stride) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) if (Math.abs(data[o + c] - ref[c]) > tolerance) return false;
    }
    return true;
  };
  const flatCol = (x) => {
    for (let y = 0; y < height; y += stride) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) if (Math.abs(data[o + c] - ref[c]) > tolerance) return false;
    }
    return true;
  };
  const budget = Math.floor(Math.min(width, height) * maxFrac);
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  while (top < budget && height - bottom - top > 1 && flatRow(top)) top += 1;
  while (bottom < budget && height - bottom - top > 1 && flatRow(height - 1 - bottom)) bottom += 1;
  while (left < budget && width - right - left > 1 && flatCol(left)) left += 1;
  while (right < budget && width - right - left > 1 && flatCol(width - 1 - right)) right += 1;
  const inset = Math.max(top, bottom, left, right);
  if (inset === 0) return { image: img, inset: 0 };
  const w = width - left - right;
  const h = height - top - bottom;
  return { image: crop(img, left, top, w, h), inset: { top, bottom, left, right } };
}


/**
 * Center-crop to a square `fraction` SMALLER than the source.
 *
 * Icon art usually ships as a rounded tile on a flat page (see
 * public/icon-512.png). Scaled edge-to-edge, that page's colour becomes a visible
 * square inside a launcher's mask, so the tile has to be over-scanned until its
 * own rounding leaves the frame.
 */
export function overScanSquare(img, fraction = 0.14) {
  const side = Math.min(img.width, img.height);
  const keep = Math.max(1, Math.round(side * (1 - fraction)));
  return crop(img, Math.floor((img.width - keep) / 2), Math.floor((img.height - keep) / 2), keep, keep);
}

/** Center-crop to a square, resample to `size`, force opaque: a full-bleed tile. */
export function bleedToSquare(img, size) {
  const side = Math.min(img.width, img.height);
  const centred = crop(img, Math.floor((img.width - side) / 2), Math.floor((img.height - side) / 2), side, side);
  return flatten(resizeArea(centred, size, size));
}

/** Paint a (resized) sprite centred on a `size`x`size` canvas. */
export function composeCanvas(sprite, size, opts = {}) {
  const out = new Uint8Array(size * size * 4);
  const bg = opts.background ? parseHex(opts.background) : null;
  if (bg) {
    for (let i = 0; i < size * size; i++) {
      out[i * 4] = bg.r;
      out[i * 4 + 1] = bg.g;
      out[i * 4 + 2] = bg.b;
      out[i * 4 + 3] = 255;
    }
  }
  const x0 = Math.round((size - sprite.width) / 2) + Math.round(opts.dx ?? 0);
  const y0 = Math.round((size - sprite.height) / 2) + Math.round(opts.dy ?? 0);
  for (let y = 0; y < sprite.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= size) continue;
    for (let x = 0; x < sprite.width; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= size) continue;
      const sp = (y * sprite.width + x) * 4;
      const as = sprite.data[sp + 3] / 255;
      if (as <= 0) continue;
      const d = (ty * size + tx) * 4;
      const ad = out[d + 3] / 255;
      const ao = as + ad * (1 - as);
      for (let c = 0; c < 3; c++) {
        out[d + c] = clamp255(Math.round((sprite.data[sp + c] * as + out[d + c] * ad * (1 - as)) / (ao || 1)));
      }
      out[d + 3] = clamp255(Math.round(ao * 255));
    }
  }
  return { width: size, height: size, data: out, alpha: true };
}

/** Android's `ic_launcher_round`: a circle, transparent outside it. */
export function maskCircle(img) {
  const { width: w, height: h, data } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r = Math.min(w, h) / 2;
  const out = Uint8Array.from(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const o = (y * w + x) * 4;
      if (d > r) out[o + 3] = 0;
      else if (d > r - 1) out[o + 3] = Math.round(out[o + 3] * (r - d));
    }
  }
  return { width: w, height: h, data: out, alpha: true };
}

/** A squircle-ish rounded square, for launchers and previews. */
export function maskRoundedSquare(img, radiusRatio = 0.22) {
  const { width: w, height: h } = img;
  const r = Math.round(Math.min(w, h) * radiusRatio);
  const data = Uint8Array.from(img.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.max(r, Math.min(w - r, x));
      const cy = Math.max(r, Math.min(h - r, y));
      const d = Math.hypot(x - cx, y - cy);
      const o = (y * w + x) * 4;
      if (d > r) data[o + 3] = 0;
      else if (d > r - 1) data[o + 3] = Math.round(data[o + 3] * (r - d));
    }
  }
  return { width: w, height: h, data, alpha: true };
}

/** Force every pixel opaque over `background` — .ico sources and App Store art. */
export function flatten(img, background = '#FFFFFF') {
  const bg = parseHex(background);
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    const a = img.data[o + 3] / 255;
    out[o] = Math.round(img.data[o] * a + bg.r * (1 - a));
    out[o + 1] = Math.round(img.data[o + 1] * a + bg.g * (1 - a));
    out[o + 2] = Math.round(img.data[o + 2] * a + bg.b * (1 - a));
    out[o + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out, alpha: false };
}

// ── colour ────────────────────────────────────────────────────────────────

/** '#rrggbb' or '#rgb' -> {r,g,b} */
export function parseHex(hex) {
  let s = String(hex).trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error(`not a hex colour: ${hex}`);
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

export function toHex(rgb) {
  const h = (v) => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

/** How far a pixel is from a backdrop colour — luma contrast or chroma distance,
 * whichever is larger, so a mid-tone mark of a different hue still separates. */
export function colourDistance(r, g, b, bg) {
  const lumaDelta = Math.abs(luma(r, g, b) - luma(bg.r, bg.g, bg.b));
  const chromaDelta = 0.7 * Math.max(Math.abs(r - bg.r), Math.abs(g - bg.g), Math.abs(b - bg.b));
  return Math.max(lumaDelta, chromaDelta);
}

function quantisedBuckets(img, onlyDark) {
  const buckets = new Map();
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    if (img.data[o + 3] < 200) continue;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    if (onlyDark && luma(r, g, b) > 140) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

/** Most common opaque colour at any brightness. */
export function dominantColor(img) {
  return quantisedBuckets(img, false) ?? { r: 255, g: 255, b: 255 };
}

/**
 * The backdrop of a logo tile: the most common DARK colour, because a mark is
 * normally lighter than the field it sits on, and the field is where the pixels
 * are. Used for an adaptive icon's `<background>` and for the launcher's letterbox.
 */
export function dominantDarkColor(img) {
  return quantisedBuckets(img, true) ?? dominantColor(img);
}

/**
 * A themed-icon silhouette (Android 13 `monochrome`): the mark becomes white ink
 * with alpha, the backdrop becomes transparent. The launcher tints this in themed
 * mode, so colour is dropped and only the shape matters.
 *
 * The band is deliberately high. A logo's gradient or vignette sits *near* its own
 * average colour, so a loose band turns that wash into one soft blob of ink and the
 * themed icon renders as a filled squircle. Measured on the shipped logo: the mark
 * is 150-220 from the backdrop colour, the wash is under 95.
 */
export function silhouette(img, backdrop, near = 105, far = 175) {
  const bg = backdrop ?? dominantColor(img);
  const { width, height, data } = img;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < 40) continue;
    const d = colourDistance(data[o], data[o + 1], data[o + 2], bg);
    const t = Math.max(0, Math.min(1, (d - near) / (far - near)));
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = clamp255(Math.round(t * t * (3 - 2 * t) * 255));
  }
  return { width, height, data: out, alpha: true };
}

/** Where a layer's ink is, from its own alpha. */
export function alphaBBox(img, minAlpha = 40) {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < minAlpha) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, width: img.width, height: img.height, found: false };
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, found: true };
}

/** Fraction of pixels carrying ink above `minAlpha`. */
export function inkCoverage(img, minAlpha = 200) {
  let ink = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] > minAlpha) ink += 1;
  return Number((ink / n).toFixed(4));
}
