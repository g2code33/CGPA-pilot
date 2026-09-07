# Desktop packaging — Linux/.deb notes

*Rules as of v1.0.27: sandbox policy (1.0.26), the asar rule (1.0.27) and the
launch-mode ladder (1.0.27). Each one exists because shipping without it produced
a bug report — they are enforced by `test/desktopPackaging.test.mjs`,
`test/desktopRendererPath.test.mjs` and `test/brandDesktopInstall.test.mjs`.*

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

## 2. The renderer must be loaded from a REAL file, never through `app.asar`

Two releases shipped a blank window from getting this half-right each time:

| version | `asarUnpack` | what `loadFile()` was given | result |
|---|---|---|---|
| 1.0.24 | `["dist/**/*"]` | `…/app.asar/dist/index.html` (the marker) | `ERR_FAILED (-2)` |
| 1.0.25 | *(removed)* | `…/app.asar/dist/index.html` (inside the archive) | `ERR_FAILED (-2)` |
| 1.0.27 | `["dist/**/*"]` | `…/app.asar.unpacked/dist/index.html` (real) | paints |

The rule: **a `file://` load must never be handed a path that goes through
`app.asar`.** Node can read there — Electron patches `fs` to understand the
archive and its "unpacked" markers — but Chromium's `file://` loader reads the
real filesystem, so `existsSync()` says yes while the load says *no such URL*:

```
electron: Failed to load URL: file:///opt/CGPA-Pilot/resources/app.asar/dist/index.html with error: ERR_FAILED
```

→ a dark, empty window, then `Segmentation fault (core dumped)` when the dead
renderer takes the process with it.

So both halves are required, and neither alone is enough:

1. `build.asarUnpack: ["dist/**/*"]` in `package.json` — puts real bytes on disk
   (`resources/app.asar.unpacked/dist/`). `asar: true` stays; the archive still
   holds `dist-electron/` and `package.json`.
2. `electron/rendererPath.ts` — `rendererCandidatePaths()` lists the unpacked
   path first, the loose `dist-electron/../dist` second (dev), the archive path
   last; `orderRendererCandidates()` then ranks existing real paths above
   existing archive paths. `main.ts` walks that list by index, so a retry loads a
   *different* file — re-resolving from 0 would return the same path that just
   failed.

If nothing is readable the window shows a diagnostic page (searched paths, the
active launch mode, the reinstall command) instead of an empty rectangle.

**And a third layer, so a packaging slip can never become a blank window again:** if
the only renderer the resolver finds is *inside* the archive, `electron/rendererExtract.ts`
copies `app.asar/dist` out to `<userData>/renderer/dist` (through Node's asar-aware
`fs`, which can read there) and loads the real copy, logging that the build should
have shipped `asarUnpack` of the dist tree. The copy is planned by comparing sizes
*and* contents, so a current extraction costs one stat per file; and the walk is
bounded (files, bytes, depth) — an incomplete tree is refused rather than half-copied,
which is what lets the launch ladder take over instead of showing a broken app.
`npm run verify:branding -- --install …` reports that directory if it exists, because
on a healthy 1.0.27 install it should never be created.

`nativeImage.createFromPath()` has the same limitation as Chromium here — that is
why the window icon is read from bytes: `readFileSync` (asar-aware) →
`createFromBuffer` (see `windowIcon()`).

This is not Linux-only: `asar` / `asarUnpack` apply to the Windows build too, so the
same code path runs there (the real file is
`resources\app.asar.unpacked\dist\index.html`). `test/desktopAsarLayout.test.mjs`
packs a real archive and asserts which candidate wins, and `insideArchive()` matches
backslash paths as well as slash ones (`test/desktopRendererPath.test.mjs`).
Android/iOS have no archive at all — Capacitor serves the bundle from its own asset
layer — so the only thing they share with this rule is the logo source: the same
build-time refresh (`docs/BRANDING.md`).

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

## 5. A launch that cannot paint escalates, once

Some failures cannot be detected before the launch — only that nothing painted:

```
Zygote could not fork: process_type renderer process, numfds 4, child_pid -1
write: Broken pipe
Segmentation fault (core dumped)
```

(a kernel or sandbox policy Chromium's renderer cannot start under, a GPU process
that dies with the frame, a read-only `/opt` that swallowed the `chmod 4755`).
The app therefore walks a short ladder and **remembers the mode that worked** in
`<userData>/launch-mode.json`, so nobody watches the dance twice:

| mode | switches | for |
|---|---|---|
| 0 `default` | none | a correct install — sandboxed |
| 1 `no-sandbox` | `--no-sandbox` | no usable SUID helper / blocked userns |
| 2 `no-zygote` | `--no-sandbox --no-zygote --disable-gpu` | kernels where the zygote or the GPU process is what dies |

Mechanics (`electron/launchMode.ts` for the logic, `electron/main.ts` for the
Electron glue):

* A launch is "painted" when the renderer fires `did-finish-load`/`dom-ready` on a
  non-`data:` URL **or** calls `app:version` (the UI's first IPC call). The
  diagnostic page never counts — otherwise it would hide the failure forever.
* No signal within `STARTUP_GRACE_MS` (12 s) is a failure too: silence is what a
  renderer that dies quietly looks like.
* Failure → other candidate paths first, then `escalate()` → write the state file,
  set `CGPA_LAUNCH_MODE` for the child (a crash can happen before the write),
  `app.relaunch()`, `app.exit(0)`. A mode that paints rewrites the file with
  `failures: 0` and `paintedAt`, and becomes the remembered one.
* Exhausted ladder → **no relaunch**; the diagnostic page says so. That is the loop
  guard: without the env hand-off a machine where every mode dies would restart
  forever.
* Support hatch: `cgpa-pilot --launch-mode-default` (or delete
  `~/.config/cgpa-pilot/launch-mode.json`) starts from mode 0 again. `window.cgpaPilot.getLaunchInfo()`
  returns the active mode, its reason, the renderer path and the sandbox fallback —
  readable from DevTools without a log file.

Windows and macOS are unaffected: there is no SUID helper and no zygote re-exec, so
mode 0 is the only rung that matters (the flags are still applied if a machine ever
needs them).

## 6. Verifying an install without launching anything

```bash
npm run verify:branding -- --install /opt/CGPA-Pilot
```

Reports, per machine: whether `app.asar.unpacked/dist/index.html` exists and
contains `#root` (the two ways this goes blank), `chrome-sandbox` owner+mode, the
`/usr/bin/cgpa-pilot` wrapper, the brand logo, all nine hicolor symlinks and
whether their bytes match it, the `~/.local/share/applications` override
(`Name`/`Icon`/`StartupWMClass`/`Exec`), and the remembered launch mode with the
reason it escalated. Exit code 1 = a failure was found; it is a diagnostic, not a
fix — but it names the `chown`/`chmod` or reinstall command for each problem.

## 7. Auto-update

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
sudo apt install ./cgpa-pilot-1.0.27-amd64.deb
hash -r; cgpa-pilot                            # or log out once so GNOME reloads the icon cache
```

Run the check above first — on 1.0.27+ a stale logo is almost always a *partially*
written theme, which the app re-asserts on every start. If the launcher icon still
shows the old logo after upgrading, the desktop environment is reading a stale
cache:

```bash
gtk-update-icon-cache -q -t -f ~/.local/share/icons/hicolor   # only if branding installed its override
update-desktop-database ~/.local/share/applications
```

Only the `.deb` needs a post-install fix-up; the AppImage is self-contained — run
it from a folder whose path has no spaces. The administrator's own logo reaches
both (window icon, dash, Activities): see `docs/BRANDING.md` §"Desktop shell".
