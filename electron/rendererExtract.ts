/**
 * Rescue the renderer out of `app.asar` when a package kept it in there.
 *
 * WHY. The rule (docs/DESKTOP-LINUX.md §2) is that the renderer must be a real
 * file: `asarUnpack` of the dist tree makes electron-builder leave
 * `resources/app.asar.unpacked/dist/…` on disk, and the loader prefers that path.
 * Two releases shipped a blank window because those halves were applied one at a
 * time. A config edit, a build-script change or an electron-builder upgrade can
 * silently undo the packaging half — and the symptom is not a stack trace, it is a
 * dark rectangle on every user's machine.
 *
 * So the main process has a last resort before it gives up: Node's `fs` inside
 * Electron CAN read through the archive (that is the whole reason the bug was
 * invisible to `existsSync`), so we copy the tree out to
 * `<userData>/renderer/dist/` and load that real file instead. The copy is
 * planned by comparing sizes and contents, so a normal launch writes nothing, and
 * it is bounded (files, bytes, depth) because a recursive walk of an unreviewed
 * archive should never be able to hang or fill a disk.
 *
 * The walk/plan are pure over injected `fs`-like objects, which is what lets
 * test/desktopAsarLayout.test.mjs exercise them against a real archive through a
 * `@electron/asar`-backed shim that emulates Electron's patched `fs`.
 */

export interface ReadFsLike {
  readdirSync: (dir: string) => string[];
  statSync: (file: string) => { isDirectory: () => boolean; size: number };
  readFileSync: (file: string) => Uint8Array;
  existsSync: (file: string) => boolean;
}

export interface WriteFsLike {
  mkdirSync: (dir: string, opts: { recursive: boolean }) => unknown;
  writeFileSync: (file: string, data: Uint8Array) => unknown;
  existsSync: (file: string) => boolean;
  statSync: (file: string) => { size: number };
  readFileSync: (file: string) => Uint8Array;
}

export interface TreeLimits {
  maxFiles?: number;
  maxBytes?: number;
  maxDepth?: number;
}

/** Every file under `root`, as archive-relative paths (posix separators). */
export function collectTree(
  root: string,
  fs: ReadFsLike,
  limits: TreeLimits = {}
): { relative: string; size: number }[] {
  const maxFiles = limits.maxFiles ?? 5000;
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024;
  const maxDepth = limits.maxDepth ?? 8;
  const out: { relative: string; size: number }[] = [];
  let total = 0;

  let aborted = false;
  const walk = (dir: string, prefix: string, depth: number) => {
    if (aborted || depth > maxDepth) return;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return; // an unreadable directory is not worth a stack of try/catch upstream
    }
    for (const name of entries.sort()) {
      if (out.length >= maxFiles) {
        aborted = true;
        return;
      }
      const full = `${dir}/${name}`;
      const relative = prefix ? `${prefix}/${name}` : name;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth + 1 > maxDepth) {
          // A directory we will not enter means an incomplete renderer, and an
          // incomplete renderer is a white screen with extra steps. Refuse.
          aborted = true;
          return;
        }
        walk(full, relative, depth + 1);
        if (aborted) return;
        continue;
      }
      if (total + stat.size > maxBytes) {
        aborted = true;
        return;
      }
      total += stat.size;
      out.push({ relative, size: stat.size });
    }
  };

  walk(root, '', 0);
  // An incomplete tree would load a half-copied renderer — worse than the honest
  // failure the caller can escalate from.
  return aborted ? [] : out;
}

export interface CopyPlan {
  /** Files to write, in order. */
  copy: { from: string; to: string; size: number }[];
  /** Files already byte-identical on disk — the usual case. */
  unchanged: number;
  /** True when the plan is empty but the destination lacks an index.html. */
  incomplete: boolean;
  totalBytes: number;
}

/**
 * What has to be written for `srcRoot` (readable only through the archive) to
 * exist as real files under `dstRoot`. Never writes anything itself.
 */
export function planRendererCopy(srcRoot: string, dstRoot: string, read: ReadFsLike, write: WriteFsLike): CopyPlan {
  const tree = collectTree(srcRoot, read);
  const copy: CopyPlan['copy'] = [];
  let unchanged = 0;
  let totalBytes = 0;
  for (const entry of tree) {
    const to = `${dstRoot}/${entry.relative}`;
    const from = `${srcRoot}/${entry.relative}`;
    let real: { size: number } | null = null;
    try {
      real = write.existsSync(to) ? write.statSync(to) : null;
    } catch {
      real = null;
    }
    if (real && real.size === entry.size) {
      // Same size is not enough — a truncated copy would look right forever.
      try {
        const a = read.readFileSync(from);
        const b = write.readFileSync(to);
        if (a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b))) {
          unchanged += 1;
          continue;
        }
      } catch {
        /* fall through and rewrite */
      }
    }
    copy.push({ from, to, size: entry.size });
    totalBytes += entry.size;
  }
  const hasIndex = (() => {
    try {
      return write.existsSync(`${dstRoot}/index.html`);
    } catch {
      return false;
    }
  })();
  return { copy, unchanged, incomplete: !copy.length && !hasIndex, totalBytes };
}

/**
 * Execute a plan and return the destination `index.html`, or null when nothing
 * usable could be written. Contents are read from `read` (the archive-aware fs)
 * and written with `write` (the real fs), which is the whole trick.
 */
export function copyRendererTree(
  srcRoot: string,
  dstRoot: string,
  read: ReadFsLike,
  write: WriteFsLike
): { file: string; copied: number; unchanged: number; bytes: number } | null {
  const plan = planRendererCopy(srcRoot, dstRoot, read, write);
  if (plan.copy.length) {
    for (const item of plan.copy) {
      let bytes: Uint8Array;
      try {
        bytes = read.readFileSync(item.from);
      } catch {
        return null; // unreadable archive → let the caller escalate instead of half-copying
      }
      try {
        const dir = item.to.slice(0, item.to.lastIndexOf('/'));
        if (dir) write.mkdirSync(dir, { recursive: true });
        write.writeFileSync(item.to, bytes);
      } catch {
        return null;
      }
    }
  }
  if (plan.incomplete) return null;
  const entry = `${dstRoot}/index.html`;
  try {
    if (!write.existsSync(entry)) return null;
    // A real file with a mount point is not enough: it must look like our app.
    if (!Buffer.from(write.readFileSync(entry)).toString('utf8').includes('<div id="root">')) return null;
  } catch {
    return null;
  }
  return { file: entry, copied: plan.copy.length, unchanged: plan.unchanged, bytes: plan.totalBytes };
}
