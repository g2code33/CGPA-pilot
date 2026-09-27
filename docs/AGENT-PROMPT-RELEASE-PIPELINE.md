# Prompt — Build pipeline (Win / .deb / iOS / Android / Web) + two-surface update system

**How to use this file:** paste everything under `═══ PROMPT START ═══` as your *first*
message to the agent, after filling in the seven blanks at its top. It is stack-aware, not
project-specific: an Electron/Tauri desktop, a Capacitor mobile app and a PWA are all covered;
delete the targets you don't have rather than leaving them ambiguous.

---

═══ PROMPT START ═══

You are working in my repository as a senior engineer who owns build, release and update
infrastructure. Read `README`, the manifests (`package.json` / lockfile / `*.gradle` /
`*.xcodeproj` / `Cargo.toml` / `go.mod` — whichever exist) and any existing CI before writing
anything. Then implement what follows in small, individually justified commits.

## 0. Project facts (I filled these in)

| # | fact | value |
|---|---|---|
| 1 | app name / product name / executable name | `<…>` |
| 2 | targets I need on every push to `main` | `windows(exe)`, `linux(.deb + .AppImage)`, `ios`, `android(apk)`, `web(PWA)` |
| 3 | desktop framework + version | `<Electron 31 / Tauri 2 / none>` |
| 4 | mobile framework | `<Capacitor 6 / React Native / none>` |
| 5 | where the web build is served + where config/API lives | `<Cloudflare Pages + a Worker / Vercel / my own host>` |
| 6 | how updates are delivered | `<GitHub Releases / my Worker / an S3 bucket / an MDM share>` |
| 7 | bundle id / app id / package id | `<com.example.app>` |

Anything I left blank: pick the industry-default, implement it, and record the choice in
`docs/DECISIONS.md` — do not stop to ask me unless it is genuinely blocking, and then ask at
most 4 questions in one message.

## 1. How you must work

- Do not push to `main`, publish a release, or tag anything unless I say so in that same
  message. Default: work on the branch you were given.
- One logical change per commit; commit messages state the *why*, and every version-bumping
  commit changes **all** version fields together (see §3.4).
- Never declare done without running the gates in §7 and pasting **raw** output. Do not
  paraphrase a failure, do not summarise a stack trace, do not say "should work".
- A bug you cannot reproduce locally is not a bug you fixed: add the test that fails against
  the unfixed code *first*, then fix it. If a test can pass both before and after the change,
  it is decoration — rewrite it.
- Never "fix" a packaging, sandbox or security failure by removing the protection that
  surfaced it (no `webSecurity:false`, no blanket `--no-sandbox`, no CSP widening, no disabled
  checksum, no skipped signing) unless I explicitly ask, and then only with the reasoning in
  the commit body.
- Verify flags/CLI/versions against the pinned dependency's own docs or source, not from
  memory. If a tool's behaviour is what the fix depends on, read its source or its emitted
  output and quote the line that proves your claim.
- Do not reformat, rename or "clean up" files unrelated to the task. Do not touch files I did
  not ask about unless a gate fails because of them.

## 2. CI: one push to `main` produces everything

Use GitHub Actions, `.github/workflows/release.yml` (name it so it is obvious), plus
`.github/workflows/ci.yml` for PRs.

**2.1 Triggers.** `push` to `main`; `workflow_dispatch` with inputs `version_override`,
`publish` (bool, default false), `targets` (multi-select); `pull_request` runs build-only.

**2.2 Jobs.** `web` → `desktop-win` + `desktop-linux` + `android` + `ios` (all `needs: web` so
one shared bundle/asset pipeline feeds every target). Each job is independent: a broken iOS
signing config must not stop Windows artifacts from being uploaded.

**2.3 Runners & caching.** `ubuntu-latest` for web/linux/android, `windows-latest` for win,
`macos-14` (arm64) for iOS. npm/pnpm cache by lockfile hash; Gradle cache; XDerivedData cache
only if it demonstrably saves time. Set `concurrency` to cancel superseded PR runs but **never**
a `main` run.

**2.4 Artifacts.** `actions/upload-artifact@v4` with a unique name per leg:
`<app>-<target>-<version>-<git-sha7>` and inside it: every installer/package plus
`SHA256SUMS.txt`, `build-info.json` (`{version, sha, builtAt, runner, target, unsigned}`).
Artifact names must state `unsigned` when a build is not signed — an unsigned artifact with a
normal name is a lie I could install.

**2.5 Secrets must be optional-but-honest.** Every job that needs a credential (Windows code
signing cert, Apple Developer + App Store Connect API key, Android keystore, publish token)
checks for it, and if absent: build unsigned, upload anyway, write an explicit
`::warning::` **and** a `## Signing skipped` section in `$GITHUB_STEP_SUMMARY`. Never fail
silently, never silently skip a target — the run summary ends with a table:
target | version | signed? | artifact | size | why-not if anything.

**2.6 No test may depend on network resources you don't control.** Never download a previous
GitHub release or a cloud artifact from within the test suite; feed fixtures come from the repo
or a local stub server. Verify this by running the whole suite with the network blocked.

**2.7 Release API shape (so this is testable, not folklore).** The publish step talks to the
forge with the `gh` CLI, and the pipeline must be written against these calls:
`gh release create <tag> <files…> -t <title> -n <body>` · `gh release upload <tag> <files…> --clobber` ·
`gh release edit <tag> --draft=false --latest` · `gh api repos/{owner}/{repo}/releases/latest --jq
'.tag_name, .draft, .prerelease'`. Publishing is a **draft-then-publish** sequence: create the
release as `--draft`, upload all artifacts, verify every asset exists with the expected size and
that `SHA256SUMS.txt` covers them, regenerate the update manifest from *those* assets, then flip
it live. A release that already exists for the version is updated (`--clobber`), never duplicated.
Deleting a release must also delete/regenerate its manifest entry — write
`scripts/release-verify.mjs <tag>` that fails until `releases/latest` resolves to the tag, lists
every expected target asset with a matching SHA256, and serves a manifest whose `latest` matches.
This is the check that makes "the app can update itself" true rather than assumed.

**2.8 Publish gate.** Only on `workflow_dispatch` with `publish: true`, or on a tag `v*`, in a
GitHub *Environment* named `release` (so it can require approval). It creates the release,
attaches artifacts, writes the update manifest (§4) and, for `web`, deploys. Publishing must be
idempotent: republishing the same version replaces the assets, and the manifest is rewritten
from the same inputs, never appended to.

## 3. Packaging rules per target (these are the ones that actually break)

**3.1 Windows.** NSIS installer (`oneClick: false`, `allowToChangeInstallationDirectory: true`)
and a portable build. `appId`, `productName`, `shortcutName`, uninstall display name set
explicitly. Icon: a real multi-size `.ico` (16→256) generated at build time from one source
PNG — plus the *installer* icon and the *uninstaller* icon; document that an already-shipped
`.exe`'s embedded icon can only change in a new build. `requestedExecutionLevel: asInvoker`
unless there is a written reason. Prove in a test that the built `*.exe`'s version resource
matches `package.json`.

**3.2 Linux `.deb` (+ `.AppImage`).** `executableName` and `StartupWMClass` must equal the
`.desktop` file's `Name`/`StartupWMClass`, or the taskbar shows a generic icon. Ship the full
hicolor icon set (16/24/32/48/64/96/128/256/512) and a `48x48.png` `Icon:` entry that resolves.
If the app uses a Chromium/Electron SUID sandbox helper, the `afterInstall` hook must set
`root:root` **and** mode `4755` unconditionally, and print `WARNING:` only when that failed;
never copy an upstream "chmod only if user namespaces are unavailable" conditional into a hook
that runs as root — as root the test succeeds and the helper is left non-setuid, so every
launch dies in `setuid_sandbox_host.cc`. `.AppImage` ships its own `.desktop` and must not fight
the deb's for `StartupWMClass`. Every hook script: run `bash -n` on it in a test, and forbid
any unsupported `${…}` macro (including inside comments) that the packager would try to expand.
`apt`/`dnf` must never be required for an update to work.

**3.3 Android / iOS (Capacitor-style).** CI runs `cap sync` then
`./gradlew assembleRelease` / `xcodebuild -exportArchive`. The web bundle inside the native app
is the *same* artifact as `web` built in §2.2 (no duplicate bundling). Play-store and TestFlight
builds cannot self-install: their update action is the store listing (Android: in-app update API
when available, direct APK download + SHA256 for sideload/org-managed installs). iOS: `ipatool`
/ TestFlight external link, and the app must warn when a build's expiry is < 14 days out.
Android needs `queries`/intent permissions to open the Play listing; iOS needs
`LSApplicationQueriesSchemes` if it deep-links. No archive layer exists on mobile: any
"path-inside-archive" logic from desktop must be a no-op there and covered by a test.

**3.4 Versions.** Semver only, in `package.json` (or the single equivalent). One
`scripts/version.mjs <bump>` writes it to every manifest that must match (native `versionName`/
`CFBundleShortVersionString`, `Info.plist`, `.rc` fields, `manifest.webmanifest` cache version,
worker/service `BUILD_VERSION`) and prints the exact commit to make. The build **fails** if
any of them disagree with the canonical version. CI refuses to run if the version already exists
in the release feed. `dist/version.json` (web) and `build-info.json` (every installer) carry
`{version, sha, builtAt}` and the app displays all three somewhere in Settings → About.

**3.5 Branding/assets are generated, never hand-maintained.** One source of truth (admin-set
logo or a repo asset) is materialised at build time by an idempotent script into every target's
icon set (favicon/apple-touch/manifest/hicolor/ico/android mipmap/ios AppIcon/installer icons).
`npm run verify:branding` (name it like that) checks what the pipeline *would* serve; with
`-- --install <prefix>` it checks a real installed app. CI runs the refresh step and fails if it
would change anything. A test asserts the shipped icons equal the source (byte size/dimensions
via a dependency-free checker is fine).

## 4. Update pipeline (the shared half)

**4.1 One manifest, machine-generated.** `GET /updates/manifest.json` (and, for an Electron
updater, the matching `latest.yml` / `latest-mac.yml` / `latest-linux.yml`) built *from* the
admin config (§5) + CI's own artifact list. Schema, versioned:

```jsonc
{
  "schema": 1,
  "channel": "stable",
  "latest": { "windows": "1.4.0", "linux": "1.4.0", "ios": "1.4.0", "android": "1.4.0", "pwa": "1.4.0" },
  "minSupported": { "windows": "1.2.0", "ios": "1.2.0" },
  "downloads": { "windows": { "url": "…", "sha256": "…", "bytes": 91234567 } },
  "notes": { "en": "markdown, ≤ 2000 chars" },
  "rollout": { "percent": 100, "allowlist": [] },
  "publishedAt": "…", "ttlSeconds": 300
}
```

HTTP: `Cache-Control: public, max-age=300`, `ETag`, `access-control-allow-origin: *`, and a
`HEAD` handler. Unknown/missing target in the manifest = that platform stays on its current
version, never an error. Clients must treat any field as optional and default safely.

**4.2 Client check, once per target.** A single module per platform, e.g.
`src/services/updateService.{ts,kt,swift}` exposing
`check(): UpdateState`, `download()`, `install()`, `dismiss(scope)`, `state$`. Rules:
- compare with real semver (prereleases, build metadata, `v` prefix); **never** offer a
  downgrade; if installed > latest, state = `ahead` (shown as "newer than the release channel"),
  never "up to date".
- cache last-known-good with a TTL; offline = state `unknown(lastSeenAt)`, which must still
  allow a manual check attempt and must render distinctly from `up to date`.
- verify SHA-256 and byte size after download; mismatch = `error:checksum`, refuse to install,
  keep the old file, and say so in the UI (never console-only).
- throttle manual checks (min 20 s apart); one in-flight request max; abort on app hide.
- rollout `percent` is `hash(stableDeviceId) % 100`, computed client-side, so a user never
  flaps in and out of eligibility.
- every state change emits one log line with a prefix (`[updates] …`) and one event to the
  telemetry endpoint if the admin enabled it (default off), including: checked, available,
  not_available, error, downloaded, install_started, install_failed, dismissed, snoozed,
  snooze_cleared.

**4.3 Electron/desktop install mechanics.** Use the framework's own updater when present
(electron-updater `autoDownload:false` by default), else "download → verify → spawn installer →
relaunch". Always: honour a dirty-state gate (never kill unsaved work; ask or wait), write the
staged-download path under `userData`, and expose `getLaunchInfo()`-style diagnostics so support
can read version/update state/flags from DevTools without a log file.

**4.4 PWA.** `sw.js` caches a build hash; on `updatefound` → keep the waiting worker, set state
`ready-to-reload`; `skipWaiting` policy is admin-controlled (§5). No `controllerchange`-triggered
reload loops: reload exactly once, guarded. The manifest URL is fetched with
`cache: 'no-store'`. `npm run verify:pwa` (or equivalent) asserts the precache list matches what
`dist/` actually contains and that every `src`/`href` in the built `index.html` resolves —
that one test has saved me more than any other kind.

## 5. Two update surfaces, one control plane (the part I care about most)

### 5.1 Desktop (Windows, .deb, .AppImage, macOS): a **permanent** header control

- A real, always-mounted control in the top header: `<UpdateButton>` — visible even when the
  app has never reached the manifest, even when offline, even when `updates.enabled:false`
  (in the disabled case it renders state `disabled` and still explains why). The admin **cannot**
  remove it; that is a hard requirement and a test must assert it.
- It shows state + last-check time + installed→available versions in a tooltip/aria-label:
  `idle · checking · upToDate · available(vX) · downloading(n%) · ready(restart) · error(reason)`
  plus a dot/badge when an update exists.
- One click = an immediate manual `check()` (throttled). A second click while
  `ready` = install/restart. Long-press/right-click (or a caret menu) = `Check now`, `What's
  new`, `Copy diagnostics`, `Remind me later → snooze the auto-prompt for N days`.
- Auto-check on startup after a delay (admin-configurable), **never** a modal, never steals
  focus, never blocks first paint; results only change the button + a one-line toast.
- `autoInstall: true` (admin) → background download+stage, button becomes
  `Restart to update (vX)`.
- Below `minSupported` → non-dismissible banner + gate before real work, with direct download
  links for each OS and the reason. If offline, the gate degrades to a dismissible warning —
  a user must never be locked out of an app they cannot update.

### 5.2 Mobile (iOS, Android) and installed PWA: a prompt **once per open**, always closable

- Shown exactly once per cold start (per app launch), after first paint and after boot/auth
  settles; no further prompts for that version in that session, regardless of retries.
- A modal/bottom-sheet with: version, size, date, admin `notes` (markdown), primary
  `Update now`, and **all** of: `×`, `Later`, and a snooze picker
  (`Later` / `Remind me tomorrow` / `Remind me in a week` / `Not for this version`).
- Snooze is persisted per version, per device, in the platform's own storage
  (AsyncStorage / Preferences / localStorage / a PWA IndexedDB record) — never on the server,
  so it survives logout; `Not for this version` survives forever until that version becomes the
  installed one.
- Back button (Android) and swipe-down (iOS) dismiss like `Later`, they never exit the app; the
  sheet is focus-trapped and screen-reader labelled; it is not dismissible-on-tap-outside if
  `force:true`.
- Force update below `minSupported`: dismiss controls are replaced by `Update to continue` +
  store links; still with an offline escape hatch as in §5.1.
- No header control on mobile/PWA. No polling while foregrounded beyond the single open-time
  check (plus the admin interval, at most, if `autoCheckMobile:true`).

### 5.3 Admin section = the regulator of both surfaces

Add a Settings → Updates panel, backed by one config block (e.g. `config.updates`) that is the
**only** writer of the manifest inputs:

```jsonc
"updates": {
  "enabled": true, "channel": "stable", "notes": { "en": "…" },
  "checkIntervalMinutes": 720, "telemetry": false,
  "minSupported": { "windows": "1.2.0", "linux": "1.2.0", "ios": "1.2.0", "android": "1.2.0", "pwa": "1.2.0" },
  "desktop": { "headerControl": "persistent", "autoCheck": true, "autoDownload": false,
               "autoInstall": false, "manualCheckThrottleSeconds": 20 },
  "mobile":  { "promptCadence": "per-open",              // "per-open" | "once-a-day" | "off"
               "snoozeOptions": ["session","1d","7d","never-for-version"], "defaultSnooze": "session",
               "autoCheckMobile": false },
  "pwa":     { "reloadStrategy": "prompt" },              // "prompt" | "auto"
  "rollout": { "percent": 100, "allowlistRoles": ["admin"] },
  "sources": { "windows": "…", "linux": "…", "android": "…", "ios": "…", "pwa": "…" }
}
```

Rules the panel must enforce, with the enforcement in code and in tests, not in prose:
- the desktop `headerControl` is **not editable** — the UI shows it as locked/persistent, and
  saving `off` there is rejected server-side;
- mobile cadence has no "every check" option, and `off` only silences the *prompt*, never the
  manual "check for updates" action inside Settings;
- `minSupported` per platform, with a validator that refuses a value higher than `latest`;
- `autoInstall` requires `autoDownload`, and both require an explicit confirmation that says
  what is being given up;
- rollout changes are audited (`who`, `when`, `before`, `after`) and viewable;
- a **Preview** tab that renders both surfaces live (desktop header states; mobile sheet with the
  stored notes, including force and offline variants) so an admin can see what users will get
  without shipping a build;
- if the config endpoint is unreachable at startup the app uses last-known-good, then these
  defaults: `enabled:true`, autoCheck off-until-first-success, `autoDownload:false`,
  `autoInstall:false`, mobile `per-open`, `promptCadence` never `every-check`. A user must be
  able to check manually in every degraded state.

## 6. Security & platform hygiene

- CSP in every HTML entry point: `default-src 'self'`, `script-src 'self'`, `style-src 'self'
  'unsafe-inline'`, `img-src 'self' data: blob: <the exact hosts you serve assets from>`,
  `connect-src 'self' <api origins>`. If the desktop app may serve the UI from a custom scheme,
  name that scheme too and pin the literal to the constant in code with a test.
- No secrets in the bundle: signing keys, update-feed admin tokens, telemetry DSNs live in
  CI secrets or the server. Update endpoints: HTTPS only, checksum verification always on, and
  the install path must refuse a payload whose hash the manifest did not sign/produce.
- Rate-limit the manifest and update endpoints; return `304`/`ETag`; log one line per check.
- If the app is served over a local/custom protocol, all local asset serving must refuse path
  traversal (`..`, encoded and backslash forms), 404 missing assets instead of falling back to
  HTML, and set correct MIME types (ES modules are refused without a JS MIME type).

## 7. Gates before you report anything

Run all of them and paste the tail of each:
1. typecheck, unit + integration tests, lint/format if configured.
2. build the web bundle, then the packaging layout tests: renderer/dist actually present,
   unpacked-where-required, `asar` listing (or equivalent) inspected with the real tool, hook
   scripts `bash -n`'d, `.desktop`/icon/WM_CLASS asserted, version fields in lockstep.
3. a smoke run of the **built** desktop binary on CI (`xvfb-run`), asserting the window painted
   a real DOM (`document.title`/root node) and that a deliberately broken load path still
   produces the documented log line and the retry ladder — i.e. prove the fallback fires.
4. an updates contract test: manifest schema validation, semver/never-downgrade,
   checksum-mismatch refusal, offline `unknown(lastSeenAt)`, snooze persistence per version,
   "one prompt per open", and "desktop header control exists with no manifest reachable".
5. the branding/verify script from §3.5, in both modes.
6. a clean-VM-equivalent check: fresh clone → `npm ci` → `npm run build:web` → run the app from
   the checkout, and paste the output.

## 8. What you hand me at the end

- A `docs/RELEASE-PIPELINE.md` with: the job/artifact map, every secret name (and what the run
  looks like when each is missing), how to cut a release, how to roll back a bad manifest, and
  the two-surface update behaviour table (desktop vs mobile/PWA) exactly as implemented.
- The CI run URL(s), the artifact names with sizes, and the run-summary table from §2.5, plus the
  exact commands I can paste to fetch a build: `gh run download <runId> -n <artifact-name>` and
  `gh release download <tag> -p '*_amd64.deb' -D .` — and if download is blocked from your
  environment, say that explicitly instead of guessing at what the artifact contains.
- A short "what I could NOT verify from this environment" list — be blunt and complete; I would
  rather read three honest lines than install a broken build.

═══ PROMPT END ═══

---

## Appendix — the 30-second version (small projects, paste this)

> Read the repo first. Then add `.github/workflows/release.yml`: on push to `main` (and
> `workflow_dispatch`) build web/PWA, Windows installer, Linux `.deb` + AppImage, Android APK
> and iOS, from one shared bundle. Each job uploads
> `<app>-<target>-<version>-<sha7>` with `SHA256SUMS.txt` + `build-info.json`, says "unsigned"
> in the name and step summary when signing secrets are absent, and never fails a sibling job.
> Publishing artifacts/creating releases happens only behind a `release` environment approval.
> Add `scripts/version.mjs` that writes one version everywhere and fails CI on disagreement.
> Updates: one generated `manifest.json` (per-target `latest`, `minSupported`, `sha256`, notes,
> rollout, ttl) served with ETag/`max-age=300`. Desktop shows a **permanent** header update
> button that works offline and is never removed by config; mobile/PWA show **one dismissible
> prompt per app open** with `Later` / snooze / `Not for this version` persisted per version.
> An admin Settings → Updates panel regulates both (channel, interval, per-platform
> `minSupported`, autoDownload/autoInstall, mobile cadence, rollout %, notes) with a live Preview
> of both surfaces, an audit log, and safe last-known-good defaults when unreachable.
> Never offer a downgrade, verify checksums before installing, never relaunch over unsaved work,
> never widen CSP or drop the sandbox to make a build pass. Tests must fail against the unfixed
> code; run typecheck + full suite + a built-app smoke test and paste raw output. Do not push to
> `main` or publish unless I say so in that message.
