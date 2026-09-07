// ─────────────────────────────────────────────────────────────────────────
// brandAssets — the administrator's branding images, usable OFFLINE too.
//
// Since v1.0.20 admin uploads live in R2 and the catalog stores a tiny
// `asset:<key>` reference instead of a data URL. Every renderer turns that into
// a URL of the configuration API (see config/assets.ts) — which is exactly
// what an OFFLINE runtime (Electron `file://`, the Capacitor APK) must not put
// in an <img>: offline it is a broken image, so `safeLogoUrl()` deliberately
// skips remote URLs and the app falls back to the BUNDLED `icon-512.png`. The
// visible result was "the admin set a logo, the desktop app and the installed
// PWA still show the old one".
//
// Fix: after the published configuration arrives, the branding images are
// FETCHED ONCE and stored in the same offline cache as DATA URLs, so from then
// on every runtime renders the administrator's logo with no network at all —
// splash logo, header, print letterhead, favicon, and the desktop window /
// launcher icon (via the preload bridge). Best-effort by design: any failure
// leaves the original reference in place and the bundled fallback still works,
// and nothing here can fail a boot (it is never awaited on the paint path).
//
// PRIVACY: this module touches no storage of its own — it only ever reads the
// PUBLIC configuration API and hands results to services/configCache.ts, the
// single student-storage boundary (published, non-personal data only).
// ─────────────────────────────────────────────────────────────────────────

import type { AppAppearance } from '../config/types';
import { assetKeyOf, isAssetRef, isRemoteHttpUrl } from '../config/assets';
import { configApiUrl } from '../config/apiBase';
import { applyBrandIdentity } from '../config/branding';
import { getRuntimeCatalog, setRuntimeCatalog } from '../config/runtime';
import { writeCachedConfig } from './configCache';

/** Don't let a pathological catalog turn into hundreds of requests. */
export const MAX_BRAND_IMAGES = 24;
/** One image upload is capped at 2 MB server-side; allow a little headroom. */
export const MAX_BRAND_IMAGE_BYTES = 3 * 1024 * 1024;
export const BRAND_IMAGE_TIMEOUT_MS = 6000;

export interface BrandAssetDeps {
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** Skip writeCachedConfig (tests / admin preview). */
  persist?: boolean;
}

/** A string an <img> can render with no network at all. */
export function isInlineDataImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/** True when the value needs to be downloaded to become offline-usable. */
export function isMaterializableImage(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  return isAssetRef(value) || isRemoteHttpUrl(value);
}

/** The request URL for a stored image value (null when there is nothing to get). */
export function brandImageUrl(value: string): string | null {
  const key = assetKeyOf(value);
  if (key) return configApiUrl(`/api/assets/${key}`);
  if (isRemoteHttpUrl(value)) return value;
  return null;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode's argument list small
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa === 'function') return btoa(binary);
  // Node (tests / Electron main) fallback — never bundled for the browser.
  const nodeBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(enc: string): string } } })
    .Buffer;
  return nodeBuffer ? nodeBuffer.from(bytes).toString('base64') : '';
}

function mimeFromContentType(header: string | null, url: string): string {
  const raw = (header ?? '').split(';')[0].trim().toLowerCase();
  if (/^image\/(png|jpeg|jpg|webp|gif)$/.test(raw)) return raw === 'image/jpg' ? 'image/jpeg' : raw;
  // The server answered with something that is explicitly NOT an image (a JSON
  // error body from a proxy, say): honour that and keep the existing value
  // rather than store garbage under an <img> src. A generic/absent type is
  // where the file extension earns its keep.
  if (raw && raw !== 'application/octet-stream') return '';
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return '';
  }
}

/**
 * Download one stored image and return it as a data URL. Null on ANY problem
 * (offline, too big, unsupported type) — callers then keep the existing value.
 */
export async function imageValueToDataUrl(
  value: string,
  deps: BrandAssetDeps = {}
): Promise<string | null> {
  if (isInlineDataImage(value)) return value;
  if (!isMaterializableImage(value)) return null;
  const url = brandImageUrl(value);
  if (!url) return null;
  const maxBytes = deps.maxBytes ?? MAX_BRAND_IMAGE_BYTES;
  const timeoutMs = deps.timeoutMs ?? BRAND_IMAGE_TIMEOUT_MS;
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  try {
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const res = await doFetch(url, { signal });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    const mime = mimeFromContentType(res.headers?.get?.('content-type') ?? null, url);
    if (!mime) return null;
    return `data:${mime};base64,${base64FromBytes(buf)}`;
  } catch {
    return null; // offline / cancelled / blocked — keep the reference as-is
  }
}

/** Every image field of the appearance block, as [get, set] accessors. */
function brandImageFields(a: AppAppearance): { get: () => string | undefined; set: (v: string) => void }[] {
  const fields: { get: () => string | undefined; set: (v: string) => void }[] = [
    { get: () => a.logo, set: (v) => (a.logo = v) },
    { get: () => a.appImage, set: (v) => (a.appImage = v) },
    { get: () => a.taglineImage, set: (v) => (a.taglineImage = v) },
    // `emoji` is only the fallback glyph; it is kept as the admin set it.
    {
      get: () => a.appIcon?.image,
      set: (v) => (a.appIcon = { ...a.appIcon, emoji: a.appIcon?.emoji ?? '', image: v }),
    },
  ];
  // Per-slot icons (tools, game, admin menu) — same offline story as the logo.
  const icons = a.icons ?? {};
  for (const slot of Object.keys(icons)) {
    const icon = icons[slot];
    if (!icon) continue;
    fields.push({
      get: () => icon.image,
      set: (v) => {
        (a.icons ??= {})[slot] = { ...icon, image: v };
      },
    });
  }
  return fields;
}

export interface MaterializeResult {
  appearance?: AppAppearance;
  /** True when at least one reference became a data URL. */
  changed: boolean;
  /** References we could not resolve (offline, oversize, unknown type). */
  failed: number;
}

/**
 * Replace `asset:`/remote image values in a COPY of the appearance block with
 * data URLs. Never mutates the input, never throws, and does at most
 * MAX_BRAND_IMAGES requests (each deduplicated, so one logo reused across
 * slots is fetched once).
 */
export async function materializeBrandImages(
  appearance: AppAppearance | undefined,
  deps: BrandAssetDeps = {}
): Promise<MaterializeResult> {
  if (!appearance) return { changed: false, failed: 0 };
  const next: AppAppearance = JSON.parse(JSON.stringify(appearance));
  const cache = new Map<string, Promise<string | null>>();
  let changed = false;
  let failed = 0;
  const resolve = (value: string): Promise<string | null> => {
    const hit = cache.get(value);
    if (hit) return hit;
    if (cache.size >= MAX_BRAND_IMAGES) return Promise.resolve(null);
    const p = imageValueToDataUrl(value, deps);
    cache.set(value, p);
    return p;
  };

  for (const field of brandImageFields(next)) {
    const value = field.get();
    if (!isMaterializableImage(value)) continue;
    const dataUrl = await resolve(value as string);
    if (dataUrl && dataUrl !== value) {
      field.set(dataUrl);
      changed = true;
    } else if (!dataUrl) {
      failed += 1;
    }
  }
  return { appearance: changed ? next : appearance, changed, failed };
}

// ── Boot / sync hook ───────────────────────────────────────────────────────

let inFlight: Promise<AppAppearance | undefined> | null = null;

/**
 * Bring the running (and cached) branding images offline-usable, then re-apply
 * the identity surfaces (favicon + the desktop window/launcher icon). Safe to
 * call fire-and-forget on every boot and after every successful config sync;
 * concurrent calls share one pass.
 */
export function refreshBrandIdentity(deps: BrandAssetDeps = {}): Promise<AppAppearance | undefined> {
  if (inFlight) return inFlight;
  const pass = (async () => {
    try {
      const catalog = getRuntimeCatalog();
      if (!catalog.appearance) {
        applyBrandIdentity(undefined);
        return undefined;
      }
      // Apply what we have right now (a materialized cache means the logo is
      // already a data URL and this is the only pass), then improve on it.
      applyBrandIdentity(catalog.appearance);
      const { appearance, changed } = await materializeBrandImages(catalog.appearance, deps);
      if (!appearance) return catalog.appearance;
      if (changed) {
        setRuntimeCatalog({ ...catalog, appearance });
        if (deps.persist !== false) {
          await writeCachedConfig(
            {
              universities: catalog.universities,
              curricula: catalog.curricula,
              appearance,
              settings: catalog.settings,
            },
            {
              version: catalog.version,
              updatedAt: catalog.updatedAt,
              // writeCachedConfig only distinguishes backend-synced from local;
              // a seed/legacy catalog with branding stays 'local' and keeps its version.
              source: catalog.source === 'backend' ? 'backend' : 'local',
            }
          );
        }
      }
      applyBrandIdentity(appearance);
      return appearance;
    } catch {
      return undefined; // branding is cosmetic — never break the app over it
    }
  })();
  // Clear the guard from a microtask AFTER the assignment below: a pass with
  // nothing to do (no appearance, or everything already materialized) completes
  // SYNCHRONOUSLY, and clearing it inside the body would leave `inFlight`
  // pointing at that finished promise forever — every later refresh would then
  // be silently skipped, i.e. the logo would never appear.
  const done = () => {
    if (inFlight === pass) inFlight = null;
  };
  void pass.then(done, done);
  inFlight = pass;
  return pass;
}
