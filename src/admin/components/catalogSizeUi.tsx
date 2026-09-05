// ─────────────────────────────────────────────────────────────────────────
// catalogSizeUi — admin-facing size indicators (v1.0.19).
//
//  • AssetSizeBadge — a small chip showing how much stored JSON one image
//    costs, coloured by risk (amber > 300 KB, red > 1 MB).
//  • CatalogSizeBanner — the whole catalog's stored size vs the ~2 MB
//    database limit, naming the largest images when it is over the limit.
//
// The measurement rules come from ../catalogSize (shared with the Worker),
// so what the admin sees here is exactly what a publish would be checked
// against on the server.
// ─────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { AdminCatalog } from '../catalogTypes';
import {
  catalogAssetList,
  dataUrlBytes,
  humanBytes,
  largestAssetsSummary,
  D1_VALUE_SAFE_BYTES,
} from '../catalogSize';

/** Amber threshold: one image this big already eats a third of the limit. */
export const ASSET_WARN_BYTES = 300_000;
/** Red threshold: one image this big alone is half the record limit. */
export const ASSET_DANGER_BYTES = 1_000_000;

/** Small coloured chip: the stored byte cost of one embedded image. */
export function AssetSizeBadge({ bytes }: { bytes: number }) {
  if (bytes <= 0) return null;
  const cls =
    bytes > ASSET_DANGER_BYTES
      ? 'bg-red-100 text-red-700 ring-red-200'
      : bytes > ASSET_WARN_BYTES
        ? 'bg-amber-100 text-amber-700 ring-amber-200'
        : 'bg-slate-100 text-slate-500 ring-slate-200';
  return (
    <span
      title={`This image costs ${humanBytes(bytes)} of the ~2 MB catalog record.`}
      className={`rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ring-1 ${cls}`}
    >
      {humanBytes(bytes)}
    </span>
  );
}

/** The stored cost of an image that may be a data URL (0 for plain URLs). */
export function assetBytes(value: string | undefined | null): number {
  return dataUrlBytes(value);
}

/**
 * Page-level banner: total stored catalog size vs the ~2 MB publish limit.
 * Over the limit → red, and the biggest images are named so the admin knows
 * exactly what to shrink (or that emptying the Recycle bin helps).
 */
export function CatalogSizeBanner({ catalog }: { catalog: AdminCatalog }) {
  const { totalBytes, assets } = useMemo(() => {
    const totalBytes = new Blob([JSON.stringify(catalog)]).size;
    return { totalBytes, assets: catalogAssetList(catalog) };
  }, [catalog]);

  const over = totalBytes > D1_VALUE_SAFE_BYTES;
  const used = Math.min(100, Math.round((totalBytes / (2 * 1024 * 1024)) * 100));

  return (
    <div
      className={`rounded-xl px-4 py-2.5 text-[11px] font-semibold ring-1 ${
        over ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-black">
          📦 Catalog size: {humanBytes(totalBytes)}
        </span>
        <span className="opacity-80">
          {over
            ? '— OVER the ~2 MB publish limit. Publishing will be refused until it is smaller.'
            : '— fits the ~2 MB publish limit.'}
        </span>
        {/* usage bar: the whole record at a glance */}
        <span className="ml-auto inline-block h-1.5 w-24 overflow-hidden rounded-full bg-white/80 ring-1 ring-black/5">
          <span
            className={`block h-full rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.max(4, used)}%` }}
          />
        </span>
      </div>
      {over && assets.length > 0 && (
        <p className="mt-1 leading-relaxed">
          Largest images:{' '}
          <span className="font-black">{largestAssetsSummary(assets, 3)}</span>
          {assets.some((a) => a.label.startsWith('Recycle bin')) && (
            <span> — emptying the Recycle bin frees that space too.</span>
          )}{' '}
          Replace them with smaller files (under ~300 KB each), then publish.
        </p>
      )}
      {!over && assets.length > 0 && (
        <p className="mt-1 opacity-70">
          Largest embedded image: {largestAssetsSummary(assets, 1)} — keep each image under ~300 KB.
        </p>
      )}
    </div>
  );
}
