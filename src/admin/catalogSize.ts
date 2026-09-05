// ─────────────────────────────────────────────────────────────────────────
// catalogSize — measures WHERE the catalog's weight lives.
//
// The admin catalog (all institutions, curricula, appearance icons and
// logos) is stored as ONE JSON document in a single database record with a
// ~2 MB limit. Images are the usual culprit: they are stored as base64
// data URLs, which bloat by ~33%. This module walks the catalog, measures
// every embedded image, and turns an over-limit publish into an actionable
// answer: "Largest images: app logo (1.6 MB), University 'X' logo (950 KB)".
//
// Kept DOM/storage-free so BOTH the browser admin and the Cloudflare Worker
// import the exact same measurement rules (same labels, same message).
// ─────────────────────────────────────────────────────────────────────────

import type { AdminCatalog } from './catalogTypes';

/** Hard per-record limit the database enforces (~2 MB). */
export const D1_VALUE_LIMIT_BYTES = 2 * 1024 * 1024;
/** Small margin under the hard limit — we refuse slightly early, with a clear message. */
export const D1_VALUE_SAFE_BYTES = 1_900_000;

/** One embedded image and how much stored JSON it costs. */
export interface CatalogAsset {
  /** Human-readable location, e.g. `App logo`, `Tool icon: Target`. */
  label: string;
  /** Decoded image bytes (the base64 payload). */
  bytes: number;
}

/** Friendly byte sizes for admin-facing copy. */
export function humanBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

/**
 * The decoded byte size of a base64 data URL (0 for anything else — URLs,
 * paths, undefined…). This is what the image actually costs inside the
 * stored JSON document.
 */
export function dataUrlBytes(value: string | null | undefined): number {
  if (typeof value !== 'string' || !value.startsWith('data:')) return 0;
  const header = value.indexOf(',');
  if (header < 0 || !value.includes('base64')) return 0;
  const b64 = value.slice(header + 1);
  if (!b64) return 0;
  return Math.floor((b64.length * 3) / 4);
}

/** Display names for the well-known icon slots (fallback: the slot id). */
const SLOT_LABELS: Record<string, string> = {
  appIcon: 'App icon',
  calculate: 'My results',
  target: 'Target',
  next: 'Next Semester',
  whatif: 'What-If',
  flight: 'Flight Path',
  milestones: 'Milestones',
  privacy: 'Privacy',
  plane: 'Hero plane',
  quickmode: 'Quick mode',
};

/** Recursively collect the sizes of every `data:image` string in a value. */
function collectDataUrls(node: unknown, out: number[], seen: WeakSet<object>): void {
  if (typeof node === 'string') {
    const b = node.startsWith('data:image') ? dataUrlBytes(node) : 0;
    if (b > 0) out.push(b);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectDataUrls(x, out, seen);
    return;
  }
  if (node && typeof node === 'object') {
    if (seen.has(node as object)) return;
    seen.add(node as object);
    for (const v of Object.values(node as Record<string, unknown>)) collectDataUrls(v, out, seen);
  }
}

/**
 * Every embedded image in the catalog, with a human label and its stored
 * byte cost, sorted largest-first. Recycle-bin snapshots are scanned too —
 * a deleted university with a big logo still costs JSON bytes until purged.
 */
export function catalogAssetList(catalog: AdminCatalog): CatalogAsset[] {
  const out: CatalogAsset[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const bytes = dataUrlBytes(value);
    if (bytes > 0) out.push({ label, bytes });
  };

  const a = catalog.appearance;
  if (a) {
    add('App logo', a.logo);
    add('App icon', a.appIcon?.image);
    for (const [slot, icon] of Object.entries(a.icons ?? {})) {
      add(`Tool icon: ${SLOT_LABELS[slot] ?? slot}`, icon?.image);
    }
    add('Wordmark image', a.appImage);
    add('Tagline image', a.taglineImage);
  }

  for (const u of catalog.universities) {
    add(`University “${u.shortName || u.name}” logo`, u.logo);
    for (const s of u.schools ?? []) {
      add(`Department “${s.name}” logo`, s.logo);
    }
  }

  // Recycle bin: aggregate every image hidden inside the deleted-item
  // snapshots so "empty the bin" is an obvious size lever.
  if (catalog.trash && catalog.trash.length > 0) {
    const found: number[] = [];
    for (const t of catalog.trash) collectDataUrls(t.data, found, new WeakSet());
    if (found.length > 0) {
      out.push({
        label: `Recycle bin (${found.length} embedded image${found.length === 1 ? '' : 's'})`,
        bytes: found.reduce((s, b) => s + b, 0),
      });
    }
  }

  out.sort((x, y) => y.bytes - x.bytes);
  return out;
}

/** "App logo (1.6 MB), University “X” logo (950 KB)" — the top N assets. */
export function largestAssetsSummary(assets: CatalogAsset[], n = 3): string {
  return assets
    .slice(0, n)
    .map((a) => `${a.label} (${humanBytes(a.bytes)})`)
    .join(', ');
}

/**
 * The over-limit publish message. Names the biggest images so the admin
 * knows EXACTLY what to shrink (instead of guessing).
 */
export function oversizeCatalogMessage(biggestBytes: number, assets: CatalogAsset[]): string {
  const mb = (n: number) => (n / 1_000_000).toFixed(1);
  const top = largestAssetsSummary(assets, 3);
  return `The catalog is ${mb(biggestBytes)} MB as stored JSON — the database limit is ~2 MB per record.${
    top
      ? ` Largest images: ${top}. `
      : ''
  }Use smaller images (e.g. under ~300 KB each — resize to ~512×512 and save as JPEG/PNG), then try again.`;
}
