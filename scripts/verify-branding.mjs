#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// verify-branding — prove that the logo the administrator set is the logo each
// surface actually serves, instead of assuming it.
//
//   node scripts/verify-branding.mjs                      # live endpoints
//   node scripts/verify-branding.mjs --origin http://localhost:4173
//   node scripts/verify-branding.mjs --logo ~/Downloads/logo.png
//   node scripts/verify-branding.mjs --install /opt/CGPA-Pilot   # local deb
//
// Network mode walks the chain a client walks:
//
//   published config (appearance.logo) → the bytes the admin chose
//   /manifest.webmanifest → its first icon → those bytes
//   /app-icon on Pages (the proxy an installed PWA reads) → those bytes
//   /app-icon on the Worker (the API origin) → those bytes
//   build/icon.png + public/icon-512.png → what a BUILD would ship
//
// and compares SHA-256 of every step. A mismatch is reported with the reason
// that matters ("still serving the bundled default icon"), not a diff of bytes.
// --install inspects an installed Linux package instead: the renderer layout
// (app.asar vs app.asar.unpacked), the SUID helper's owner and mode, the launcher
// entry, the hicolor symlinks and the remembered launch mode — the five things
// that produce a blank window or a stale logo, checked without launching anything.
//
// Node builtins only; no network needed for --install. Exit 0 = everything
// matched, 1 = a failure, warnings alone never fail (this runs in CI before a
// release, where a flaky CDN must not block a build).
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const API = (opt('api', process.env.CF_API_TARGET || 'https://cgpa-pilot.calcitoninpay.workers.dev')).replace(/\/$/, '');
const ORIGIN = (opt('origin', process.env.CGA_ORIGIN || 'https://cgpa-pilot.pages.dev')).replace(/\/$/, '');
const TIMEOUT = Number(opt('timeout', 15000));

const results = [];
let failures = 0;
function ok(label, detail) {
  results.push(['  ok  ', label, detail]);
}
function warn(label, detail) {
  results.push([' warn  ', label, detail]);
}
function bad(label, detail, fix) {
  failures += 1;
  results.push([' FAIL  ', label, detail]);
  if (fix) results.push(['       ', `→ ${fix}`, '']);
}
function head(title) {
  results.push(['', `\n${title}`, '']);
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Image header sniffing — enough to describe what is actually being served. */
function describeImage(bytes) {
  if (!bytes || bytes.length < 12) return { kind: 'empty', w: 0, h: 0 };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { kind: 'png', w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20), colorType: bytes[25] };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < bytes.length - 9; i++) {
      if (bytes[i] === 0xff && [0xc0, 0xc1, 0xc2].includes(bytes[i + 1])) {
        return { kind: 'jpeg', h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
    }
    return { kind: 'jpeg', w: 0, h: 0 };
  }
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'webp', w: 0, h: 0 };
  }
  if (bytes.subarray(0, 5).toString('latin1') === '<?xml' || bytes.subarray(0, 6).toString('latin1') === '<svg id=') {
    return { kind: 'svg', w: 0, h: 0 };
  }
  return { kind: 'unknown', w: 0, h: 0 };
}

const isImage = (info) => ['png', 'jpeg', 'webp', 'svg'].includes(info.kind);
const same = (a, b) => !!a && !!b && a.length === b.length && Buffer.compare(a, b) === 0;

let networkTried = false;
let networkWorked = false;

async function get(url, { headers } = {}) {
  networkTried = true;
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache', ...(headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT) });
  networkWorked = true;
  const buf = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  return { status: res.status, headers: res.headers, bytes: buf };
}

function localBytes(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (v.startsWith('data:image/')) {
    const comma = v.indexOf(',');
    const body = v.slice(comma + 1);
    return v.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  }
  return null;
}

// ── network mode ────────────────────────────────────────────────────────────

async function verifyServed() {
  head(`Served branding — API ${API}\n                    PWA origin ${ORIGIN}`);

  let logo = null;
  let appName = null;
  let configVersion = null;
  try {
    const cfg = await get(`${API}/api/config/latest`);
    if (cfg.status !== 200) throw new Error(`HTTP ${cfg.status}`);
    const doc = JSON.parse(cfg.bytes.toString('utf8'));
    const appearance = doc?.config?.appearance ?? doc?.appearance ?? {};
    logo = appearance.logo ?? null;
    appName = appearance.appName ?? appearance.name ?? null;
    configVersion = doc?.version ?? doc?.config?.version ?? null;
    ok('published config readable', `version ${configVersion ?? '?'}, appearance.logo ${logo ? `${String(logo).slice(0, 24)}…` : 'not set'}`);
  } catch (e) {
    warn('published config unreadable', `${e.message} — falling back to --logo/what the endpoints serve`);
  }

  // The reference: what the administrator chose, as bytes.
  let expected = null;
  let expectedFrom = null;
  const logoFile = opt('logo');
  if (logoFile && existsSync(path.resolve(logoFile))) {
    expected = readFileSync(path.resolve(logoFile));
    expectedFrom = `--logo ${logoFile}`;
  } else if (logo) {
    expected = localBytes(logo);
    if (!expected && String(logo).startsWith('asset:')) {
      const key = String(logo).slice('asset:'.length);
      try {
        const asset = await get(`${API}/api/assets/${key}`);
        if (asset.status === 200 && asset.bytes.length) {
          expected = asset.bytes;
          expectedFrom = `asset:${key}`;
        } else {
          bad('asset endpoint', `GET /api/assets/${key} → HTTP ${asset.status}`, 'the Worker must serve catalog assets for the PWA icon and the desktop logo to exist at all');
        }
      } catch (e) {
        bad('asset endpoint', `GET /api/assets/${key} failed: ${e.message}`);
      }
    } else if (!expected && /^https?:/i.test(String(logo))) {
      try {
        const res = await get(String(logo));
        expected = res.bytes;
        expectedFrom = String(logo);
      } catch (e) {
        warn('external logo not fetchable', e.message);
      }
    }
  }
  if (expected) {
    const info = describeImage(expected);
    if (!isImage(info)) {
      bad('the admin logo is not an image', `${expected.length} bytes, kind ${info.kind}`, 're-upload a PNG/JPEG/WebP in Icons & branding');
    } else {
      ok('admin logo resolved', `${expectedFrom}: ${info.kind} ${info.w}×${info.h}, ${expected.length} B, sha ${sha(expected)}`);
    }
  } else {
    warn('no reference logo', 'set appearance.logo (or pass --logo <file>) to compare every surface byte-for-byte');
  }

  const bundled = existsSync(path.join(repo, 'public/icon-512.png')) ? readFileSync(path.join(repo, 'public/icon-512.png')) : null;

  /** One surface: fetch it, say what it is, compare to the reference. */
  async function surface(label, url, { expectImage = true, headers } = {}) {
    let res;
    try {
      res = await get(url, { headers });
    } catch (e) {
      // Nothing on this network worked either — that is an offline machine, not a
      // broken deployment. Say so instead of shouting about a failure.
      if (!networkWorked) warn(label, `${url} unreachable from here (${e.message}) — no HTTP endpoint answered at all`);
      else bad(label, `${url} unreachable: ${e.message}`);
      return null;
    }
    if (res.status !== 200) {
      bad(label, `${url} → HTTP ${res.status}`);
      return null;
    }
    const info = describeImage(res.bytes);
    const type = res.headers.get('content-type') ?? '';
    const cache = res.headers.get('cache-control') ?? '';
    if (expectImage && !isImage(info)) {
      bad(label, `${url} is not an image (content-type "${type}", ${res.bytes.length} B, kind ${info.kind})`);
      return res;
    }
    let verdict = `${info.kind} ${info.w}×${info.h}, ${res.bytes.length} B, sha ${sha(res.bytes)}`;
    if (expectImage && label.startsWith('manifest icon') && /^\d+x\d+$/.test(String(label.match(/(\d+)x(\d+)/) ?? ''))) {
      const want = label.match(/icon (\d+)x(\d+)/);
      if (want && info.w && Number(want[1]) !== info.w) {
        warn(`${label} size`, `the manifest declares ${want[1]}×${want[1]} but the file is ${info.w}×${info.h}`, 'installers trust sizes[]; regenerate the icon at the declared size');
      }
    }
    if (cache) verdict += ` · ${cache}`;
    if (/immutable/i.test(cache)) {
      bad(`${label} caching`, `${cache} — an immutable copy freezes the installed icon on the first logo`, 'serve it with a short TTL (≤ 1 h) and a hashed URL instead');
    }
    if (expected) {
      if (same(res.bytes, expected)) ok(label, `${verdict} — matches the admin logo`);
      else if (bundled && same(res.bytes, bundled)) bad(label, `${verdict} — this is the BUNDLED default icon, not the admin logo`, 'the endpoint is not resolving the catalog reference (see worker readImageValue)');
      else warn(label, `${verdict} — differs from the admin logo (expected a re-publish, or a CDN copy within its TTL)`);
    } else {
      ok(label, verdict);
    }
    return res;
  }

  // 1. The manifest, and the icon it points at.
  let manifest = null;
  for (const where of [ORIGIN, API]) {
    try {
      const res = await get(`${where}/manifest.webmanifest`);
      if (res.status !== 200) {
        warn('manifest', `${where}/manifest.webmanifest → HTTP ${res.status}`);
        continue;
      }
      const text = res.bytes.toString('utf8');
      const doc = JSON.parse(text);
      const icons = doc.icons ?? [];
      const type = res.headers.get('content-type') ?? '';
      if (!/manifest|json/.test(type)) warn('manifest content-type', `${where}: "${type}" (a browser may refuse to install it)`);
      if (!icons.length) {
        bad('manifest icons', `${where}: no icons[] entries — an install gets no icon at all`);
        continue;
      }
      if (icons[0].src !== '/app-icon' && !String(icons[0].src).startsWith('/app-icon')) {
        bad('manifest icon order', `${where}: icons[0].src is "${icons[0].src}", not /app-icon`, 'the admin logo endpoint must be FIRST or platforms that keep the first match pick the bundled file');
      } else {
        ok('manifest', `${where}: ${icons.length} icons, first "${icons[0].src}" (${icons[0].sizes}, ${icons[0].purpose})`);
      }
      const has = (purpose) => icons.some((i) => String(i.purpose ?? '').includes(purpose) && String(i.src).includes('app-icon'));
      if (!has('any') || !has('maskable')) warn('manifest purposes', `${where}: /app-icon must be offered for BOTH any and maskable`);
      const name = doc.name ?? '';
      if (appName && name && name !== appName) {
        warn('manifest name', `${where}: "${name}" while the admin set "${appName}"`);
      }
      if (!manifest) manifest = { doc, base: where };
      break; // the first readable manifest is the one the PWA used
    } catch (e) {
      warn('manifest', `${where}: ${e.message}`);
    }
  }
  if (manifest) {
    for (const icon of manifest.doc.icons.slice(0, 2)) {
      const url = new URL(icon.src, `${manifest.base}/`).href;
      await surface(`manifest icon ${icon.sizes}/${icon.purpose}`, url);
    }
  }

  // 2. The two /app-icon endpoints (Pages proxy for the installed PWA, Worker
  //    for the API origin and for the proxy itself).
  await surface('/app-icon (Pages proxy)', `${ORIGIN}/app-icon`);
  if (ORIGIN !== API) await surface('/app-icon (Worker)', `${API}/app-icon`);

  // 3. What a build would ship — the artwork every installer is generated from.
  head('Build inputs (what the next installer would carry)');
  for (const rel of ['build/icon.png', 'build/icons/256x256.png', 'public/icon-512.png']) {
    const file = path.join(repo, rel);
    if (!existsSync(file)) {
      bad(rel, 'missing — run `node scripts/refresh-brand-icons.mjs` (part of build:web)', null);
      continue;
    }
    const bytes = readFileSync(file);
    const info = describeImage(bytes);
    if (expected && same(bytes, expected)) ok(rel, `${info.kind} ${info.w}×${info.h} — IS the admin logo`);
    else if (expected) warn(rel, `${info.kind} ${info.w}×${info.h}, sha ${sha(bytes)} ≠ admin logo ${sha(expected)} (a build would ship the old artwork — run the refresh script)`);
    else ok(rel, `${info.kind} ${info.w}×${info.h}, ${bytes.length} B`);
    if (info.kind === 'png' && info.colorType === 2 && rel.startsWith('build/icons')) {
      warn(`${rel} is RGB (no alpha)`, 'hicolor/PNG icons are expected to be RGBA; an opaque master belongs in build/icon.png only');
    }
  }
}

// ── installed-package mode ──────────────────────────────────────────────────

function verifyInstall(dir) {
  head(`Installed package — ${dir}`);
  const resources = path.join(dir, 'resources');
  const asar = path.join(resources, 'app.asar');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const realEntry = path.join(unpacked, 'dist', 'index.html');
  const marker = `<div id="root">`;

  if (!existsSync(dir)) {
    bad('install directory', `${dir} does not exist`, 'pass the app directory, e.g. --install /opt/CGPA-Pilot');
    return;
  }
  if (existsSync(realEntry)) {
    const has = readFileSync(realEntry, 'utf8').includes(marker);
    if (has) ok('renderer entry', `${realEntry} exists with #root — a real file every loader can read`);
    else bad('renderer entry', `${realEntry} has no <div id="root"> — the bundle was not built into the package`, 'rebuild: npm run build && npm run build:electron');
  } else if (existsSync(asar)) {
    bad(
      'renderer entry',
      'no app.asar.unpacked/dist/index.html — this build kept the renderer inside the archive',
      'Chromium cannot file:// read inside app.asar, so the window is blank (ERR_FAILED −2). Reinstall a package built with asarUnpack: ["dist/**/*"] (1.0.27+).'
    );
  } else {
    bad('install directory', `neither ${realEntry} nor ${asar} exists — not an electron-builder install`, null);
  }
  if (existsSync(asar)) ok('archive', `${asar} (${(statSync(asar).size / 1024 / 1024).toFixed(1)} MB)`);
  const legacy = '/opt/CGPA Pilot';
  if (existsSync(legacy)) warn('leftover directory', `${legacy} still exists (a space in the path breaks the zygote)`, `sudo rm -rf '${legacy}'`);

  const helper = path.join(dir, 'chrome-sandbox');
  if (existsSync(helper)) {
    const st = statSync(helper);
    const mode = (st.mode & 0o7777).toString(8);
    let owner = String(st.uid);
    let group = String(st.gid);
    try {
      owner = execFileSync('stat', ['-c', '%U', helper], { encoding: 'utf8' }).trim();
      group = execFileSync('stat', ['-c', '%G', helper], { encoding: 'utf8' }).trim();
    } catch {
      /* non-glibc stat (or Windows dev box) — numeric ids are still informative */
    }
    if (mode === '4755' && owner === 'root') ok('chrome-sandbox', `${mode} ${owner}:${group} — the SUID sandbox is usable`);
    else if (owner === 'root' && mode === '4755') ok('chrome-sandbox', `${mode} ${owner}:${group}`);
    else
      bad(
        'chrome-sandbox',
        `mode ${mode} owned by ${owner}:${group}, expected 4755 root:root`,
        `sudo chown root:root '${helper}' && sudo chmod 4755 '${helper}' — otherwise the app aborts with FATAL:setuid_sandbox_host.cc(163)`
      );
  } else {
    warn('chrome-sandbox', `${helper} not found`, 'fine for an AppImage or a --no-sandbox fallback build; an odd layout for a .deb');
  }

  const launcher = '/usr/bin/cgpa-pilot';
  if (existsSync(launcher)) {
    const text = readFileSync(launcher, 'utf8');
    const execs = (text.match(/^\s*exec\s/gm) ?? []).length;
    if (execs === 1) ok('launcher wrapper', `${launcher} re-execs the app exactly once`);
    else bad('launcher wrapper', `${launcher} contains ${execs} exec lines`, 'a wrapper that re-execs on every crash loops forever; check build/after-install.sh');
    if (/--no-sandbox/.test(text)) warn('launcher wrapper', 'forcing --no-sandbox on this machine (the installer could not make the helper setuid)');
  } else {
    warn('launcher wrapper', `${launcher} not on PATH — start it as ${path.join(dir, 'cgpa-pilot')}`);
  }

  const home = os.homedir();
  const brand = path.join(home, '.config', 'cgpa-pilot', 'brand', 'icon.png');
  const stateFile = path.join(home, '.config', 'cgpa-pilot', 'launch-mode.json');
  if (existsSync(brand)) {
    const info = describeImage(readFileSync(brand));
    ok('brand logo', `${brand}: ${info.kind} ${info.w}×${info.h}, sha ${sha(readFileSync(brand))}`);
  } else {
    warn('brand logo', `${brand} not written yet — it appears after the first config sync in the app`);
  }
  const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512];
  const links = sizes
    .map((sz) => path.join(home, '.local', 'share', 'icons', 'hicolor', `${sz}x${sz}`, 'apps', 'cgpa-pilot.png'))
    .filter((f) => existsSync(f));
  if (links.length === sizes.length) {
    const brandBytes = existsSync(brand) ? readFileSync(brand) : null;
    const stale = brandBytes ? links.filter((f) => !same(readFileSync(f), brandBytes)) : [];
    const plain = links.filter((f) => {
      try {
        readlinkSync(f);
        return false;
      } catch {
        return true; // a copied file from a build that did not symlink
      }
    });
    if (stale.length) {
      bad(
        'hicolor icons',
        `${stale.length}/${sizes.length} sizes differ from the persisted brand logo — the menu is showing an old logo`,
        'restart the app (it re-asserts these on start), then re-run this check; 1.0.27+ re-links them on every launch'
      );
    } else if (plain.length) {
      warn(
        'hicolor icons',
        `all ${sizes.length} sizes correct but ${plain.length} are plain copies, not symlinks`,
        'an older build wrote copies, so a future logo change will not follow on its own'
      );
    } else {
      ok('hicolor icons', `all ${sizes.length} sizes point at ${brand}`);
    }
  } else if (links.length === 0) {
    warn('hicolor icons', 'none installed in ~/.local/share/icons — the DE is showing the packaged artwork', 'open the app once after the branding change; the launcher icon is installed on start');
  } else {
    warn('hicolor icons', `${links.length}/${sizes.length} sizes present`, 'a partially written theme makes the icon inconsistent between menu and dash');
  }

  const userEntries = path.join(home, '.local', 'share', 'applications');
  const found = existsSync(userEntries) ? readdirSync(userEntries).filter((f) => /cgpa/i.test(f)) : [];
  if (found.length) {
    const text = readFileSync(path.join(userEntries, found[0]), 'utf8');
    const get = (k) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1] ?? '';
    ok('desktop override', `${found[0]}: Name="${get('Name')}", Icon=${get('Icon')}, StartupWMClass=${get('StartupWMClass')}, Exec=${get('Exec')}`);
    if (!get('Icon').includes('cgpa-pilot')) bad('desktop override', `Icon=${get('Icon')} does not match the hicolor name cgpa-pilot`, 'the launcher would show the theme default instead of the admin logo');
    if (get('StartupWMClass') && get('StartupWMClass') !== 'cgpa-pilot') warn('desktop override', `StartupWMClass=${get('StartupWMClass')} ≠ window class cgpa-pilot (the running window will not group with it)`);
  } else {
    warn('desktop override', `no ~/.local/share/applications/*cgpa* entry`, 'written on start when /usr/share/applications has the packaged entry');
  }

  if (existsSync(stateFile)) {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    const line = `mode ${state.mode}, failures ${state.failures ?? 0}${state.reason ? `, last failure: ${state.reason}` : ''}`;
    if (state.mode === 0 && !state.reason) ok('launch mode', line);
    else if (state.paintedAt) warn('launch mode', `${line} (later launches skip straight to mode ${state.mode})`);
    else bad('launch mode', `${line} — every mode tried so far failed to paint`, 'run `cgpa-pilot --launch-mode-default` from a terminal and read the stderr line it prints');
  } else {
    ok('launch mode', 'no escalation recorded (first launch, or a normal start)');
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const install = opt('install');
try {
  await verifyServed();
} catch (e) {
  bad('verification crashed', e.message);
}
if (install) verifyInstall(path.resolve(install));

for (const [mark, label, detail] of results) {
  const line = detail ? `${mark} ${label}${detail ? ` — ${detail}` : ''}` : `${mark}${label}`;
  console.log(line.trimEnd());
}
console.log(failures ? `\nFAIL — ${failures} problem(s)` : '\nPASS — every checked surface agrees');
if (networkTried && !networkWorked) console.log('note: no HTTP endpoint answered from here, so network checks were reported as warnings');
if (flag('json')) {
  console.log(JSON.stringify(results.map(([status, label, detail]) => ({ status: status.trim(), label, detail })), null, 2));
}
process.exit(failures ? 1 : 0);
