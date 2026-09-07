# Branding: the administrator's logo, all the way down to the OS icon

v1.0.27. "The app logo must be the one the admin set" sounds like one switch; it is
five independent surfaces, and until now three of them could only ever show the
artwork committed to this repository. This document is the map — code, cache lifetimes
and how to check each surface on a real device. One command walks the whole served
chain and says where it disagrees:

```bash
npm run verify:branding                                    # live endpoints
npm run verify:branding -- --install /opt/CGPA-Pilot       # an installed desktop app
npm run verify:branding -- --logo ./the-logo-i-uploaded.png # compare against a file
```

## The pipeline

```
admin console ──POST /api/admin/assets──▶ R2  catalog/<sha16>.png
      │                                        ▲
      └── publish ──▶ D1 payload.appearance.logo = "asset:catalog/<sha16>.png"
                                                  │
        ┌─────────────────────────────────────────┼───────────────────────────────┐
        ▼                                         ▼                               ▼
  WEB / PWA runtime                        DESKTOP runtime                  BUILD TIME
  configSync → configCache                 same config sync                 scripts/refresh-brand-icons.mjs
  brandAssets.materializeBrandImages       window.setIcon + hicolor +       public/icon-512.png
  (asset ref → data URL, in the cache)     .desktop override                build/icons/*, win icon
        │                                         │                          android mipmap-*/ic_launcher*
        ▼                                         ▼                          ios AppIcon, android splash
  /manifest.webmanifest + /app-icon        next launch reads the saved
  (Worker dynamic, Pages proxied)          branding PNG from userData/brand
```

| Stored value | Meaning | Resolved by |
| --- | --- | --- |
| `asset:catalog/<sha16>.png` | the object in R2 (v1.0.20+) | `resolveAssetUrl()` → `/api/assets/<key>` |
| `data:image/png;base64,…` | legacy inline image | used as-is |
| `https://…` | an external image the admin pasted | used as-is (fetched by whom?) |

`src/config/branding.ts` is the single place that decides *which* value is used:
`appLogoImage()` for in-page `<img>`s, `brandIdentityLogo()` for identity surfaces.

## 1. In-page renderers (web + desktop + APK)

`safeLogoUrl()` **skips remote URLs in an offline runtime** (`file://` in Electron,
a Capacitor WebView): a remote asset reference there is a broken image when the
network is down, and a broken logo is worse than the bundled one. That rule is
correct and stays — but it meant an R2-hosted admin logo could *never* reach the
packaged desktop app, which is why the desktop kept showing the old logo.

The fix is `src/services/brandAssets.ts`: after a configuration sync (and once at
boot, in the background — never on the paint path) every `asset:`/remote image in
the appearance block is downloaded **once** and rewritten as a `data:` URL *inside
the cached configuration*. A data URL is local, so `safeLogoUrl()` accepts it and
the logo renders with no network at all, forever, until the admin changes it.

Guards worth knowing about: 24 images max per pass, 3 MB per image, one request per
distinct value, `AbortSignal.timeout(6s)`, failures leave the original reference
untouched, and the running catalog object is never mutated in place. The module
stores nothing itself — it goes through `services/configCache.ts`, the only student
storage boundary (published, non-personal data only; enforced by `npm run smoke`).

Scope decision: only the **appearance** block is materialized. Institution and
department logos (`universities[].logo`, `schools[].logo`) are rendered through
`resolveAssetUrl()` straight from the network — a catalog can hold dozens of them,
and caching every one would bloat the offline store for a picture that is only
decorative on a header row. Where such a logo is used as a *fallback chain*
(`App.tsx` → `safeLogoUrl(school, university, appearance.logo, …)`, e.g. the print
letterhead), an offline device therefore lands on the administrator's app logo,
which is materialized and always available.

## 2. Browser tab / home-screen tile

`applyBrandIdentity()` (called from the boot path in `src/main.tsx` and after every
sync in `src/services/configSync.ts`) rewrites `link[rel=icon]`, `link[rel=shortcut
icon]` and `link[rel=apple-touch-icon]` to the same resolved value. Identity
surfaces use `brandIdentityLogo()`, which — unlike the `<img>` helper — also accepts
the *remote* URL: an icon that fails to load simply leaves the previous one in
place, so preferring the admin's logo is free.

## 3. Installed PWA (Chrome/Edge "Install", Android home screen)

* `public/manifest.webmanifest` declares `/app-icon` first, then the bundled
  `icon-512.png`. Chrome's icon selection keeps the first entry among equals, so the
  dynamic icon wins wherever it can be served, and a purely static host (no Worker,
  no Pages Function) still gets a valid icon instead of a letter tile.
* On the Worker origin `/manifest.webmanifest` and `/app-icon` are generated
  (`worker/src/index.ts` → `handlePwaIdentity`). The manifest's name/tagline follow
  `appearance`, and the icon URL is `/app-icon?v=<sha256 of the logo bytes>` — the URL
  changes when the logo changes, which is what forces browsers to re-download it.
  `/app-icon` resolves the logo through `readImageValue()` (Worker `src/assets.ts`),
  which understands **both** `asset:` references (bytes streamed from R2) and legacy
  data URLs. Before that, a real deployment's logo — always an `asset:` reference —
  resolved to nothing and the PWA served the bundled icon: the single biggest reason
  an installed app "kept the old logo".
* On Pages the same path is proxied by `functions/app-icon.js`, which deliberately
  rewrites the cache header to `max-age=300`: the Worker's answer says `immutable`,
  and because the Pages URL is stable, honouring it would freeze the icon on whatever
  logo existed at first install. It also refuses a body that is not an image (an error
  page or a JSON 200 from upstream would otherwise be cached as the icon and shown
  broken); `application/octet-stream` — how an asset stored without metadata arrives
  — is accepted and declared as `image/png`. Both halves are asserted by
  `test/pwaBranding.test.mjs`, which *executes* the function with a stubbed Worker.
* `public/sw.js` caches the manifest and the icon as *identity* requests
  (network-first, cache as the offline fallback), and its `CACHE` key is bumped to
  `v9` so existing installs re-cache the new manifest instead of keeping the old one.

Net effect: an installed PWA picks up a new logo by itself — within the Pages TTL
plus the browser's periodic manifest check. Nothing needs to be reinstalled.

## 4. Desktop shell (Electron)

`build/after-install.sh` and `electron/main.ts` handle the OS-level artwork of the
installed app:

* `windowIcon()` reads bytes (never a path — `nativeImage.createFromPath` cannot read
  inside `app.asar`) and prefers `userData/brand/icon.png`, the last logo the
  administrator set, over the `resources/icon.png` copy baked into the package. So a
  branding change is visible on the next launch with no rebuild.
* `branding:set-icon` (preload `setBrandIcon`, called from `applyBrandIdentity`)
  accepts a `data:` URL or any `http(s)` image URL, decodes it with `nativeImage`,
  re-icons every live window immediately, persists the PNG (re-encoded, so a JPEG or
  WebP upload becomes a proper `.png`), and records `appearance.appName` alongside it.
  Non-decodable payloads are refused, leaving the packaged icon in place.
* On Linux it also installs the logo into the **per-user** icon theme —
  `~/.local/share/icons/hicolor/<size>x<size>/apps/cgpa-pilot.png`, symlinks to that
  one saved file — and mirrors `/usr/share/applications/cgpa-pilot.desktop` into
  `~/.local/share/applications/` with `Name=` set to the admin's product name. The
  override reuses the basename of whichever system entry exists — `<executableName>`
  for a `.deb`, `<ProductName>` for an AppImage — because writing the other name
  would add a second launcher instead of re-labelling one. User
  files take precedence over system ones, so the dash, Activities search and alt-tab
  follow the branding without root, and the `Exec=` line keeps pointing at the
  packaged binary because the copy is derived from the installed entry (no entry —
  no override; an invented `Exec` would outlive uninstalls). Both caches are
  refreshed with `gtk-update-icon-cache` / `update-desktop-database`, best-effort.
  Nothing is rewritten when the bytes are unchanged, so a normal launch does zero
  I/O — and the same two calls run once at `app.whenReady()`, *before* any window
  exists, using the persisted `name.txt`: an app upgrade rewrites
  `/usr/share/applications` and `/usr/share/icons` from the package, and without
  that re-assertion the menu entry would fall back to the build-time artwork until
  the next config sync.
* Windows/Linux **installer** icons still come from the build (see §5): a `.exe`'s
  icon resource and the `.deb`'s shipped `icon.png` cannot be changed at runtime
  without admin rights. That is the one surface where a branding change needs a new
  build to appear; everything a running app can control, it now follows.

## 5. Build time: `scripts/refresh-brand-icons.mjs`

Committed artwork is what Windows' taskbar, Android's launcher and iOS draw *before*
the app's first paint, so those files must be regenerated from the published
branding rather than hoped to be current. Wired into `build:web` right after
`scripts/refresh-seed.mjs` (which every packaging job runs first — desktop
`.deb`/`.exe`/AppImage, `cap sync android`, `xcodebuild`) it:

1. reads `appearance.logo` from the live published catalog (the gitignored
   `.live.admin-catalog.json` if the seed refresh already fetched it, else
   `/api/config/latest`),
2. resolves it (`asset:` → `/api/assets/<key>`, `data:`, `http(s)`),
3. re-renders every shipped icon with ImageMagick — `public/icon-512.png`,
   `build/icon.png` (opaque master) and the `build/icons/{16…512}` hicolor set that
   `win.icon` and `linux.icon` consume, all five Android `mipmap-*` buckets
   (`ic_launcher`, `ic_launcher_round` circle-cropped, `ic_launcher_foreground` at
   66 % for the adaptive-icon safe zone, and the `drawable-{port,land}-*` splash),
   and the iOS `AppIcon.appiconset` entries — each sized to the pixel dimensions of
   the file it replaces, so density rules and Xcode's manifest stay valid,
4. writes only changed bytes (a routine build leaves the tree clean).

Failures are warnings by design — no rasterizer, no network, no admin logo, an
unreadable image all leave the committed artwork in place, because branding must
never be able to break packaging. `CGPA_BRAND_ICONS=0` skips it entirely (a
reproducible or fully offline build).

> **Keeping CI able to rasterize:** the Ubuntu runner ships ImageMagick, the
> Windows and macOS ones do not, so those two legs would fall back to the copy-only
> path above. The steps that install it live in
> `docs/ci-brand-icons-imagemagick.patch` — apply them with
> `git apply docs/ci-brand-icons-imagemagick.patch` (this repo keeps
> `.github/workflows` edits as patches, like `docs/ci-ios-upload-fix.patch`, because
> the automation token has no `workflows` scope). They are `continue-on-error`, so
> even unapplied the release still builds — only the installer artwork lags.

Without ImageMagick the script limits itself to copying a **square PNG** into the
three targets whose consumers resize for themselves (`public/icon-512.png` and, when
the source is big enough, `build/icons/{256,512}`), and refuses everything else:
renaming a JPEG to `.png` or writing a 600×300 wordmark into a density-mipmap or an
iOS AppIcon would be worse than the artwork already in the repo. That fallback is
why `.github/workflows/build-desktop.yml` installs ImageMagick on the Windows and
macOS legs (Ubuntu runners ship it) — with `continue-on-error`, so a failed install
degrades the *branding* of that build instead of failing the release. If a Windows
`.exe` ever ships the old logo, check that step's log for "ImageMagick not found".

## Checking a device

| Surface | Expect |
| --- | --- |
| Browser tab | admin logo after the first load; `/app-icon?v=…` in the manifest |
| Installed PWA | `chrome://apps` / shortcut icon changes within a day; force it with DevTools → Application → Manifest → update, or re-add the app |
| Desktop window/taskbar | `~/.config/cgpa-pilot/brand/icon.png` exists and equals the admin logo; next launch uses it |
| GNOME/Activities icon | `ls -l ~/.local/share/icons/hicolor/48x48/apps/cgpa-pilot.png` → symlink into that brand dir. A *plain file* there is an older build's copy: correct today, but it will not follow the next change |
| Android launcher | `adb shell dumpsys package com.cgpapilot.app` after the build; the icon is baked at build time (§5) |
| Windows Start/taskbar | icon comes from the `.exe` built after the branding publish; `ie4uinit.exe -show` clears a stale cache |

Two limits worth knowing, both deliberate:

* Pages serves the **static** `public/manifest.webmanifest`, so a rebrand changes the
  icon there but not its `name` — Cloudflare Pages functions cannot rewrite a file
  that the CDN already serves. Only the Worker origin has a dynamic name. A pinned
  shortcut keeps the name it was installed with until it is re-added.
* The `.desktop` `Icon=` is a *name*, not a path: the DE resolves it through hicolor,
  which is why the nine symlinks are the mechanism and why a partially written theme
  shows a half-updated logo (`verify-branding` counts them).

Related: `docs/DESKTOP-LINUX.md` (packaging, sandbox helper, launch modes),
`build/icons/README.md` (why one PNG per hicolor size), `docs/DEPLOYMENT.md`
(publish → what a client sees).
