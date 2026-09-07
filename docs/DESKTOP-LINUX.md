# Desktop packaging — Linux/.deb notes (v1.0.25, sandbox policy revised in v1.0.26)

Everything here is enforced by `test/desktopPackaging.test.mjs`, so a regression
fails `npm test` instead of shipping a .deb that will not open.

## 1. The install path must not contain a space

```json
"productName": "CGPA-Pilot"      // ← NOT "CGPA Pilot"
```

electron-builder installs Linux packages into `/opt/<productName>`. Chromium on
Linux starts its **zygote** by re-executing the browser binary through a
whitespace-split command line, so a spaced path is truncated at the space:

```
LaunchProcess: failed to execvp:
/opt/CGPA
[23736:FATAL:zygote_host_impl_linux.cc(207)] Check failed: . : Invalid argument (22)
/usr/bin/cgpa-pilot: line 12: 23736 Trace/breakpoint trap (core dumped) "$REAL" "$@"
```

The app dies before a window exists — "double-clicking does nothing". The
product name is therefore space-free; the pretty brand lives where the user
actually reads it:

| Where                | Key                          | Value        |
| -------------------- | ---------------------------- | ------------ |
| Linux menu entry     | `linux.desktop.Name`         | `CGPA Pilot` |
| Windows shortcut     | `nsis.shortcutName`          | `CGPA Pilot` |
| Add/Remove Programs  | `nsis.uninstallDisplayName`  | `CGPA Pilot` |
| Window title         | `BrowserWindow({ title })`   | `CGPA Pilot` |

`appId` (`com.cgpapilot.app`) is unchanged, so the NSIS installer keeps the same
GUID and updates the existing Windows install in place. The `deb` package name
comes from `package.json` `name` (`cgpa-pilot`), so `apt` treats 1.0.25 as an
upgrade of 1.0.24 and removes the old `/opt/CGPA Pilot` payload; the post-install
hook deletes whatever that leaves behind.

Electron's own data directory is unaffected: `app.getName()` still reads the
top-level `name` (`cgpa-pilot`), so `~/.config/cgpa-pilot` keeps the user's data.

## 2. `dist/` must stay inside `app.asar`

`asarUnpack: ["dist/**/*"]` was the second half of the blank-window bug. Unpacked
files are *removed* from the archive and only a marker stays:

```jsonc
// header of app.asar with asarUnpack: ["dist/**/*"]
{ "dist": { "files": { "index.html": { "size": 1224, "unpacked": true } } } }
// vs. without asarUnpack
{ "dist": { "files": { "index.html": { "size": 1224, "offset": "1713163", … } } } }
```

Node's `fs` shim follows the marker into `app.asar.unpacked`, but Chromium's
`file://` loader — which is what `win.loadFile()` uses — does not, so the load
rejects and the log shows:

```
electron: Failed to load URL: file:///opt/…/resources/app.asar/dist/index.html with error: ERR_FAILED
```

→ a dark, empty window. Nothing in this app needs an unpacked file (no native
module, no child process reading `dist/`), so `asarUnpack` is gone.
`electron/main.ts` still probes the `app.asar.unpacked` layout as a fallback and,
if nothing is readable, renders a diagnostic page with the searched paths
instead of an empty rectangle.

## 3. Icons: sizes, transparency, WM_CLASS

See `build/icons/README.md`. Two independent reasons the logo was missing:

- `linux.icon` pointed at a single `build/icon.png`, which electron-builder
  installs as `hicolor/1024x1024/apps/cgpa-pilot.png` — a directory that
  `hicolor/index.theme` does not declare, so no desktop environment reads it.
  The package now ships one PNG per hicolor size (16…512), all RGBA.
- `StartupWMClass` defaults to the product name (`CGPA Pilot`), while Electron's
  real `WM_CLASS` comes from the executable (`cgpa-pilot`). A window that cannot
  be matched to its `.desktop` file gets a generic icon in the dash/alt-tab.
  `linux.desktop.StartupWMClass` is now explicitly `cgpa-pilot`.

`resources/icon.png` (from `build/icons/256x256.png`, via `extraResources`) is
read with `nativeImage.createFromBuffer` and handed to `new BrowserWindow({ icon })`
— `createFromPath` cannot read inside `app.asar`, which is why the window icon
used to be empty even when everything else worked.

## 4. The SUID sandbox helper: always `root:root` 4755

`/opt/CGPA-Pilot/chrome-sandbox` is Electron's setuid sandbox helper. Chromium
checks it *before* it decides whether it needs it, and a helper that exists with
the wrong owner or mode is a hard abort, not a warning:

```
FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was found, but is not
configured correctly. Rather than run without sandboxing I'm aborting now. You need to make
sure that /opt/CGPA-Pilot/chrome-sandbox is owned by root and has mode 4755.
Trace/breakpoint trap (core dumped) cgpa-pilot
```

v1.0.25 tried to be helpful: it probed `unshare --user true` and kept the helper at
0755 when user namespaces "worked". The probe ran in the **post-install hook,
which is root**, and root can always create a user namespace — so on exactly the
machines that need the setuid bit (Debian `kernel.unprivileged_userns_clone=0`,
Ubuntu 24.04+ with `kernel.apparmor_restrict_unprivileged_userns=1`) the helper
was left unusable and the app would not open. **1.0.26 always installs the
helper as `root:root` mode 4755** and verifies the result, printing the exact
repair command to `dpkg`'s output if it could not be applied (read-only `/opt`).

A correct 4755 helper costs nothing on systems where user namespaces work:
Chromium only execs it when it needs it, and both paths are sandboxed.

Two safety nets stay in place, and neither weakens a healthy install:

- `/usr/bin/cgpa-pilot` (written by the hook) stats the helper and — only if it
  is not `4755 root` — probes `unshare --user true` **as the launching user**.
  Only when both mechanisms are missing does it add `--no-sandbox`, saying why on
  stderr. It never re-execs the app on failure.
- `electron/main.ts` performs the same check for launches that bypass the
  wrapper (AppImage, `exec` from a terminal, a launcher written before 1.0.26),
  which also covers the space-in-path case of §1.

Verify a machine in three commands:

```bash
stat -c '%a %U %n' /opt/CGPA-Pilot/chrome-sandbox   # want: 4755 root
unshare --user true; echo "userns probe: $?"       # 0 = unprivileged userns available
cgpa-pilot                                          # stderr says what it decided
```

and to repair a helper that was unpacked without its bits (an `apt`-less
`dpkg -x`, a copied `/opt`, a filesystem mounted `nosuid`):

```bash
sudo chown root:root /opt/CGPA-Pilot/chrome-sandbox && sudo chmod 4755 /opt/CGPA-Pilot/chrome-sandbox
```

Installing the 1.0.26 `.deb` does that by itself — the release artefact is the
fix; no manual step is needed on an upgrade.

## 5. Auto-update

`electron-updater` defaults `autoInstallOnAppQuit` to true: the downloaded update
is installed from a quit handler, which runs `apt`/`pkexec` on Linux and logs

```
Update installer has already been triggered. Quitting application.
```

That line is informational (it comes from the quit hook of an install that was
already triggered) but it reads like a crash, and quitting the app should never
start a package-manager transaction. It is off now — updates install when the
user presses *Restart now*, which also reports a refusal ("the update is still
downloading") instead of doing nothing.

## Repairing an existing machine

```bash
sudo apt remove cgpa-pilot                     # drops the old /opt/CGPA Pilot package files too
sudo apt install ./cgpa-pilot-1.0.26-amd64.deb
hash -r; cgpa-pilot                            # or log out once so GNOME reloads the icon cache
```

If the launcher icon still shows the old logo after upgrading, the desktop
environment is reading a stale cache:

```bash
gtk-update-icon-cache -q -t -f ~/.local/share/icons/hicolor   # only if branding installed its override
update-desktop-database ~/.local/share/applications
```

Only the `.deb` needs a post-install fix-up; the AppImage is self-contained — run
it from a folder whose path has no spaces. The administrator's own logo reaches
both (window icon, dash, Activities): see `docs/BRANDING.md` §"Desktop shell".
