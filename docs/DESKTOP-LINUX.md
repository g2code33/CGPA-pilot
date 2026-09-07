# Desktop packaging — Linux/.deb notes (v1.0.25)

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

## 4. The SUID sandbox helper

`/opt/CGPA-Pilot/chrome-sandbox` must be

- mode **0755** when unprivileged user namespaces work (the normal case, and
  what Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1` arrangement
  relies on for the packaged binary), or
- owned by **root** with mode **4755** when they do not — otherwise Electron
  prints "The SUID sandbox helper binary was found, but is not configured
  correctly" and exits.

`build/after-install.sh` probes `unshare --user true` (the same test
electron-builder's own template uses) and applies the right mode. It then writes
`/usr/bin/cgpa-pilot` as a wrapper that `exec`s the real binary **once**, adding
`--no-sandbox` only when this machine can offer neither mechanism. It must never
"run, and if that fails run again with `--no-sandbox`" — that turns a crash into
a silently unsandboxed blank window and destroys the exit code.

If the app is launched from a path containing a space anyway (e.g. an AppImage in
`~/My Apps/`), `main.ts` disables the sandbox for that launch rather than dying,
and prints why.

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
sudo apt remove cgpa-pilot                    # drops the old /opt/CGPA Pilot package files
sudo apt install ./cgpa-pilot-1.0.25-amd64.deb
hash -r; cgpa-pilot                            # or log out once so GNOME reloads the icon cache
```

Only the `.deb` needs a post-install fix-up; the AppImage is self-contained — run
it from a folder whose path has no spaces.
