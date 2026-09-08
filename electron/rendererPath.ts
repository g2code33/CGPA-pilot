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

// ── the protocol route ────────────────────────────────────────────────────
//
// WHY ANOTHER WAY TO LOAD THE SAME FILE. `file://` reads are performed by
// Chromium's own stack, in a sandboxed process whose file policy is built from a
// small allowlist (the executable, its `app.asar`, userData). On a machine where
// that policy does not cover `resources/app.asar.unpacked/**` — which is what the
// 1.0.27 field report showed, with the file demonstrably present and readable:
//
//     electron: Failed to load URL: file:///opt/CGPA-Pilot/resources/app.asar.unpacked/dist/index.html with error: ERR_FAILED
//
// — the load fails even though Node (in the browser process) can read the same
// path. A privileged custom scheme fixes that structurally: `protocol.handle`
// serves the response *from the main process*, so the bytes reach the renderer
// without any sandboxed process touching the filesystem. It also makes the asar
// question moot — Node's `fs` reads through the archive — so a package can no
// longer be blank-windowed by an unpacking or path-policy detail.
//
// The resolution below is pure (injected `exists`) so the mapping, the traversal
// guard and the SPA fallback are tested without Electron.

/** The scheme the packaged renderer is served over. */
export const RENDERER_SCHEME = 'cgpa';
/** Fixed host so relative URLs resolve predictably (`cgpa://bundle/assets/…`). */
export const RENDERER_HOST = 'bundle';

export function rendererStartURL(): string {
  return `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`;
}

/** Directories the renderer may be read from, best first (see `rendererCandidatePaths`). */
export function rendererRootDirs(appDir: string, mainDir: string): string[] {
  return [...new Set(rendererCandidatePaths(appDir, mainDir).map((f) => path.dirname(f)))];
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface ResolvedRendererFile {
  /** The file to read, or null when nothing matches. */
  file: string | null;
  status: 200 | 404;
  /** True when an unknown path was answered with the app shell (client routing). */
  fallback: boolean;
}

/**
 * Map a request pathname to a file under one of `roots`.
 *
 * Guards, in order of how much they matter: `..` cannot escape a root (the
 * scheme is privileged and the renderer is a normal web page — a traversal here
 * would be a real filesystem read of anything the app can run); a path with no
 * extension falls back to `index.html` so client-side routes keep working; and a
 * missing *asset* is a 404 rather than HTML with a JavaScript content type, which
 * would show up as a confusing syntax error instead of a clear failure.
 */
export function resolveRendererFile(
  pathname: string,
  roots: string[],
  exists: (file: string) => boolean
): ResolvedRendererFile {
  let decoded = pathname || '/';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return { file: null, status: 404, fallback: false }; // a malformed escape is a 404, not a crash
  }
  const clean = decoded.replace(/\\/g, '/'); // Windows separators are not path separators in a URL
  const segments = clean.split('/').filter((part) => part.length > 0 && part !== '.');
  if (segments.some((part) => part === '..')) return { file: null, status: 404, fallback: false };

  const rel = segments.join('/');
  const want = rel === '' || rel === 'index.html' ? 'index.html' : rel;
  for (const root of roots) {
    const candidate = path.join(root, want);
    if (exists(candidate)) return { file: candidate, status: 200, fallback: false };
  }
  if (!path.extname(want)) {
    for (const root of roots) {
      const shell = path.join(root, 'index.html');
      if (exists(shell)) return { file: shell, status: 200, fallback: true };
    }
  }
  return { file: null, status: 404, fallback: false };
}
