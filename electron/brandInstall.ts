/**
 * Admin branding → the launcher icon and menu entry a desktop environment shows.
 *
 * `appearance.logo` is what the administrator sets in "Icons & branding". For a
 * long time it only reached the HTML UI: the icon GNOME/Windows show in the taskbar,
 * the dash and Activities search came from the files baked into the package, so a
 * rebrand kept showing the old logo until the next build. This module is the
 * runtime half of the fix — the Electron main process hands it the persisted logo
 * and it writes the two things a DE actually reads:
 *
 *   ~/.local/share/icons/hicolor/<N>x<N>/apps/<exec>.png   → symlink to the brand
 *   ~/.local/share/applications/<exec>.desktop             → copy of the system
 *                                                            entry, re-labelled
 *
 * User files take precedence over the root-owned ones, so this needs no sudo, no
 * rebuild, and survives an upgrade that rewrites /usr/share (that is why the app
 * re-asserts them on every start, not only when the logo changes).
 *
 * Paths are injected rather than read from `app` so the behaviour is testable in a
 * temp directory on any platform (test/brandDesktopInstall.test.mjs) — including
 * the fallbacks that only happen on someone else's machine.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The sizes a hicolor theme declares; anything else is never looked up. */
export const HICOLOR_SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512];

export interface BrandInstallOptions {
  /** The user's home directory. */
  home: string;
  /** The persisted admin logo (PNG), written by the branding IPC handler. */
  iconFile: string;
  /** Executable/launcher name — `cgpa-pilot`, the same value as StartupWMClass. */
  execName: string;
  /** Product name the administrator chose, if any. */
  productName?: string | null;
  /** Where the packaged .desktop file lives. Injectable for tests and flatpaks. */
  systemApplicationsDir?: string;
  /**
   * The other name the launcher may be installed under. A .deb installs
   * `/usr/share/applications/<executableName>.desktop`, but an AppImage keeps its
   * entry named after the *product* — and the user override has to reuse that
   * exact basename, or instead of re-labelling the launcher we add a second one.
   */
  desktopAlias?: string | null;
  hicolorSizes?: number[];
  platform?: NodeJS.Platform;
  /** Cache refreshers; replaceable so tests do not touch the real machine. */
  run?: (command: string, args: string[]) => void;
}

export type InstallOutcome = { changed?: string[]; skipped?: string };

const userApplicationsDir = (home: string) => path.join(home, '.local', 'share', 'applications');
const hicolorAppDir = (home: string, size: number) =>
  path.join(home, '.local', 'share', 'icons', 'hicolor', `${size}x${size}`, 'apps');

/** The icon paths a DE will look at for this app, in theme order. */
export function launcherIconPaths(o: Pick<BrandInstallOptions, 'home' | 'execName' | 'hicolorSizes'>): string[] {
  const sizes = o.hicolorSizes ?? HICOLOR_SIZES;
  return sizes.map((size) => path.join(hicolorAppDir(o.home, size), `${o.execName}.png`));
}

/** The names a packaged launcher may be installed under, in lookup order. */
export function desktopBasenames(o: Pick<BrandInstallOptions, 'execName' | 'desktopAlias'>): string[] {
  return [...new Set([o.execName, (o.desktopAlias ?? '').trim()].filter(Boolean))];
}

/** Where the DE will look for each candidate name. */
export function systemDesktopPaths(
  o: Pick<BrandInstallOptions, 'execName' | 'desktopAlias' | 'systemApplicationsDir'>
): string[] {
  const dir = o.systemApplicationsDir ?? '/usr/share/applications';
  return desktopBasenames(o).map((name) => path.join(dir, `${name}.desktop`));
}

/** The user override that shadows one system entry (same basename — see above). */
export function userDesktopPath(o: Pick<BrandInstallOptions, 'home'>, systemFile: string): string {
  return path.join(userApplicationsDir(o.home), path.basename(systemFile));
}

export function desktopEntryPath(o: Pick<BrandInstallOptions, 'home' | 'execName'>): string {
  return path.join(userApplicationsDir(o.home), `${o.execName}.desktop`);
}

/** Write only when the content differs — a launch must not churn the disk. */
export function writeIfChanged(file: string, bytes: Uint8Array | string, mode = 0o644): boolean {
  try {
    const next = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
    if (existsSync(file)) {
      const current = readFileSync(file);
      if (current.length === next.length && current.equals(next)) return false;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, next, { mode });
    return true;
  } catch {
    return false; // an unwritable home is not worth failing a launch over
  }
}

/**
 * Rebuild the .desktop text: keep the packaged Exec (that is the working binary
 * path, with the arguments the installer chose) and re-label everything the
 * branding owns. `Icon` stays a NAME rather than a path so the hicolor lookup —
 * including the symlinks above — resolves it.
 */
export function desktopEntryText(systemText: string, execName: string, productName?: string | null): string {
  const name = (productName ?? '').trim();
  const lines = systemText
    .split(/\r?\n/)
    .map((line) => {
      if (name && line.startsWith('Name=')) return `Name=${name}`;
      if (/^Icon=/.test(line)) return `Icon=${execName}`;
      if (/^StartupWMClass=/.test(line)) return `StartupWMClass=${execName}`;
      return line;
    });
  if (name && !lines.some((line) => line.startsWith('Name='))) {
    // A launcher without Name= is labelled by its filename, which is exactly the
    // generic-looking entry the branding was supposed to replace.
    const at = lines.findIndex((line) => line.trim() === '[Desktop Entry]');
    lines.splice(at === -1 ? 0 : at + 1, 0, `Name=${name}`);
  }
  return lines.join('\n');
}

/**
 * Point every hicolor size at the admin's logo. A previous build wrote real copies,
 * so an existing plain file is replaced by a symlink; where symlinks are refused
 * (certain mounts) the bytes are copied instead, which is uglier but works.
 */
export function installLauncherIcon(o: BrandInstallOptions): InstallOutcome {
  if ((o.platform ?? process.platform) !== 'linux') return { skipped: 'not-linux' };
  if (!existsSync(o.iconFile)) return { skipped: 'no-brand-icon' };
  let bytes: Buffer;
  try {
    bytes = readFileSync(o.iconFile);
  } catch {
    return { skipped: 'unreadable-brand-icon' };
  }
  const run =
    o.run ??
    ((command: string, args: string[]) => {
      try {
        spawnSync(command, args, { stdio: 'ignore' });
      } catch {
        /* optional desktop tooling — absent on many systems */
      }
    });

  const changed: string[] = [];
  for (const link of launcherIconPaths(o)) {
    let current: string | null = null;
    try {
      current = readlinkSync(link); // throws for a plain file → rewritten below
    } catch {
      current = null;
    }
    if (current === o.iconFile) continue; // already ours
    try {
      mkdirSync(path.dirname(link), { recursive: true });
      try {
        unlinkSync(link);
      } catch {
        /* nothing there yet */
      }
      try {
        symlinkSync(o.iconFile, link);
      } catch {
        writeFileSync(link, bytes);
      }
      changed.push(link);
    } catch {
      /* best effort: the window icon is already applied */
    }
  }
  // Refresh the caches so the menu shows the new logo without a logout.
  if (changed.length) {
    run('gtk-update-icon-cache', ['-q', '-t', '-f', path.join(o.home, '.local', 'share', 'icons', 'hicolor')]);
    run('update-desktop-database', [userApplicationsDir(o.home)]);
  }
  return { changed };
}

/**
 * Mirror the packaged .desktop entry into ~/.local/share/applications with the
 * admin's product name. Skipped when the system entry is missing: an invented
 * Exec would outlive uninstalls and leave a launcher that cannot start.
 */
export function installDesktopEntry(o: BrandInstallOptions): InstallOutcome {
  if ((o.platform ?? process.platform) !== 'linux') return { skipped: 'not-linux' };
  const candidates = systemDesktopPaths(o);
  const system = candidates.find((file) => existsSync(file));
  if (!system) return { skipped: 'no-system-entry' };
  let text: string;
  try {
    text = readFileSync(system, 'utf8');
  } catch {
    return { skipped: 'unreadable-system-entry' };
  }
  const target = userDesktopPath(o, system);
  const wrote = writeIfChanged(target, desktopEntryText(text, o.execName, o.productName));
  if (wrote) {
    if (o.run) o.run('update-desktop-database', [userApplicationsDir(o.home)]);
    return { changed: [target] };
  }
  return { changed: [] };
}

/** Both halves at once, which is what a branding change and each launch call. */
export function installBranding(o: BrandInstallOptions): { icon: InstallOutcome; entry: InstallOutcome } {
  return { icon: installLauncherIcon(o), entry: installDesktopEntry(o) };
}
