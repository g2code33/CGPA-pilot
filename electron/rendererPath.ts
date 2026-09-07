/**
 * Renderer entry-point resolution — pure, so the packaging guards in
 * test/desktopRendererPath.test.mjs can exercise it without Electron.
 *
 * WHY THIS EXISTS. Two releases in a row shipped a blank window from this exact
 * shape of bug:
 *
 *   1.0.24  dist/** was `asarUnpack`ed, but the app still loaded
 *           `…/resources/app.asar/dist/index.html`. The archive keeps a marker
 *           for unpacked files; Node's patched fs follows it, Chromium's
 *           `file://` loader does not → ERR_FAILED.
 *   1.0.25  `asarUnpack` was removed, so the bytes lived *only* in the archive.
 *           Node can read that (Electron patches fs), Chromium still cannot →
 *           the same ERR_FAILED, then a dead renderer and a segfault.
 *
 * The rule that actually works: never hand a `file://` load a path that goes
 * through the archive. Real files first; the archive path last, only as a
 * fallback for layouts where nothing else exists (dev, or a loose app dir).
 */

import path from 'node:path';

/** True for a path readable only through Electron's asar shim, not by Chromium. */
export function insideArchive(file: string): boolean {
  // Normalise separators by hand: `path.sep` is the HOST's, and this same check
  // has to be right about a Windows install ("C:\…\app.asar\dist\index.html")
  // when the test suite runs on Linux.
  const posix = file.split(path.sep).join('/').split('\\').join('/');
  if (posix.includes('app.asar.unpacked')) return false;
  return /(^|\/)app\.asar\//.test(posix);
}

/**
 * Order candidate renderer entry points: existing real paths first (in the
 * caller's preference order), then existing archive paths, then everything that
 * does not exist (so a caller can still report what it looked for).
 */
export function orderRendererCandidates(candidates: string[], exists: (file: string) => boolean): string[] {
  const unique = [...new Set(candidates.map((f) => path.resolve(f)))];
  const real = unique.filter((f) => !insideArchive(f));
  const archive = unique.filter(insideArchive);
  const rank = (f: string) => (exists(f) ? 0 : 1);
  return [
    ...real.sort((a, b) => rank(a) - rank(b)),
    ...archive.sort((a, b) => rank(a) - rank(b)),
  ];
}

/**
 * The candidate list for a packaged/dev app, before ordering.
 * `appDir` is `app.getAppPath()` (…/resources/app.asar in a packaged build),
 * `mainDir` is `__dirname` (…/app.asar/dist-electron, or dist-electron in dev).
 */
export function rendererCandidatePaths(appDir: string, mainDir: string): string[] {
  const rel = path.join('dist', 'index.html');
  return [
    // Packaged, normal case: dist/** is asarUnpacked, so this is a real file.
    path.join(path.dirname(appDir), 'app.asar.unpacked', rel),
    // `npm run dev:desktop`, or an asar-less build.
    path.join(mainDir, '..', rel),
    // Inside the archive — Chromium cannot read it; kept as a last resort for
    // layouts where the renderer really is only in there.
    path.join(appDir, rel),
  ];
}

/** The first candidate that `readable` accepts (exists and has bytes). */
export function pickRendererEntry(ordered: string[], readable: (file: string) => boolean, fromIndex = 0): string | null {
  for (let i = Math.max(0, fromIndex); i < ordered.length; i++) {
    if (readable(ordered[i])) return ordered[i];
  }
  return null;
}

/** Index of `file` in the ordered list, or -1. */
export function indexOfEntry(ordered: string[], file: string): number {
  const want = path.resolve(file);
  return ordered.findIndex((f) => path.resolve(f) === want);
}
