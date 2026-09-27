# Mobile: phone chrome, launcher art, and the release config

Two symptoms started this file, and both were structural rather than cosmetic:

* the app header (and the **back button inside it**) was drawn under the status bar and
  the notch on Android, and the bottom navigation under the gesture pill;
* the icon on the home screen, in the app switcher and during installation was a
  **placeholder** — the stock Capacitor logo — while the app itself showed the logo the
  administrator had set.

A third, found while auditing for release: the APK declared
`versionCode 24 / versionName "1.0.24"` while the app was at 1.0.28, and Android will
not install an update whose `versionCode` did not rise. The build succeeded; only the
phone knew.

Everything here is generated or checked by a script. Hand-editing any of it is the way
back to these bugs.

| Concern | Owned by | Verified by |
| --- | --- | --- |
| status-bar / notch / gesture inset | `android/**/styles.xml` + `src/index.css` | `test/mobileSafeArea.test.mjs`, `scripts/verify-branding.mjs` |
| launcher + splash + iOS art | `scripts/mobile-icons.mjs` ← `public/icon-512.png` ← admin logo | `npm run mobile:icons:check`, `test/mobileIcons.test.mjs` |
| version in every manifest | `scripts/sync-mobile-version.mjs` ← `package.json` | `npm run mobile:version:check`, `test/mobileVersion.test.mjs` |
| keyboard, backup, first paint | `AndroidManifest.xml`, `capacitor.config.ts` | `scripts/verify-branding.mjs` |

## Phone chrome — inset once, on purpose

The WebView is laid out under the system bars: `index.html` and `admin.html` set
`viewport-fit=cover`, and `targetSdkVersion 36` makes Android 15+ edge-to-edge
unconditionally. Capacitor 8 forwards no insets to CSS, so *nothing* was padding for the
notch. There are two correct mechanisms and the app uses both, because neither covers
every case:

1. **Android, natively** — `android:fitsSystemWindows=true` on the activity's theme
   makes the window inset its content below the status bar and above the gesture bar.
   This is also the only mechanism that fixes elements the CSS cannot reach (the
   activity's own background, the splash).
2. **iOS + PWA + any edge-to-edge WebView, in CSS** — `env(safe-area-inset-*)`, exposed
   as `--safe-top/right/bottom/left` in `src/index.css` with a `@supports` fallback to
   `0px` (a browser without `env()` must get *no* inset, not an invalid declaration that
   deletes the whole padding).

**These never stack.** When the window is already inset, the viewport no longer touches
the bar, so `env()` reports 0 inside it — that is the property that lets both mechanisms
be present at once. The trap is a third mechanism: a JS-side `statusBarHeight` constant,
an Android-only padding, or a `pt-14` "eyeballed" against one device. Those double the
gap, and they are what a test (`the insets are applied once per platform`) refuses.

### The classes

```css
header.app-header {                 /* every top bar: app shells + admin */
  --app-header-pad: 0.375rem;
  padding-top: calc(var(--app-header-pad) + var(--safe-top));
  padding-bottom: var(--app-header-pad);
}
nav.app-bar {                       /* tool nav + admin tab strip */
  padding-bottom: calc(var(--app-bar-pad) + var(--safe-bottom));
}
```

Three details are load-bearing, all of them measured in the **emitted** stylesheet rather
than in the source:

* The inset is *added to* a padding token instead of replacing a `py-*` utility. A bar
  that carries the inset must not also carry `py-*`/`pt-*`/`pb-*` — a test greps for that,
  because `pb-2` added later by someone tidying up silently deletes the notch gap.
* Selectors are **element-qualified** (`header.app-header`, `nav.app-bar`). Tailwind's
  utilities win an equal-specificity tie by load order in this build, and the CSS
  minifier collapses a `.app-header.app-header` "specificity trick" back to one class —
  so the doubled-class idiom looks right in source and does nothing in the bundle.
* Rules live in `@layer components`, which means Tailwind **purges** them unless the
  class appears in the scanned content. A class defined and never used is deleted, so the
  test asserts both directions.

Landscape gets its own rule (the inset moves to the sides, exactly one `@media (orientation: landscape)` in the
sheet — a second copy outside the layer is inert and has already fooled one verification
pass). Floating controls — the assistant button, a transient toast, the update pill —
deliberately do **not** use these classes; they carry the inset in their own positioning
utility, e.g. `bottom-[calc(1.5rem_+_var(--safe-bottom))]`, which is the only form a
neighbouring `bottom-6` cannot override. Underscores are required: `calc()` needs
whitespace around `+`, and Tailwind reads `_` as a space inside `[...]`.

Also set here, both cheap and both things that make a WebView feel like a website in a
frame: `overscroll-behavior-y: none` (no rubber-band revealing a bare window above the
header) and `-webkit-tap-highlight-color: transparent`.

**Not inset on purpose:** centred modals and sheets never reach an edge, so giving them
insets only costs screen height in a landscape phone. If a dialog grows a sticky footer,
that footer needs `app-bar`.

## Launcher, splash and install art

`scripts/mobile-icons.mjs` writes 34 files from one source, `public/icon-512.png`, which
`scripts/refresh-brand-icons.mjs` maintains from the administrator's logo
(`docs/BRANDING.md` §5). So the chain is:

```
admin sets a logo → /api/assets → public/icon-512.png → mipmap-*/ , drawable-*/splash.png ,
                                                        values/ic_launcher_background.xml ,
                                                        iOS AppIcon.appiconset
```

What it produces, and the rule each one follows:

| Output | Rule |
| --- | --- |
| `mipmap-<d>/ic_launcher.png` | 48dp at the density, **opaque** (a legacy tile with transparency shows the wallpaper through it) |
| `…/ic_launcher_round.png` | the same, circle-masked by us, because some launchers use it unmasked |
| `…/ic_launcher_foreground.png` | 108dp adaptive foreground, **full-bleed and opaque** |
| `…/ic_launcher_monochrome.png` | 108dp silhouette, only when the ink coverage is between 2 % and 60 % |
| `mipmap-anydpi-v26/*.xml` | the adaptive spec: `<background>` = the sampled colour |
| `values/ic_launcher_background.xml` | that colour, generated — `#1A1B43`, not the template's `#FFFFFF` |
| `drawable-{port,land}-<d>/splash.png` | the logo at 40 % on the app's own `#EEF2F7`, kept at the size each file already has |
| iOS `AppIcon.appiconset/*` | every entry `Contents.json` declares, at `size × scale`, opaque |

Two decisions here exist because the naive version was tried and looked wrong:

* **The foreground is full-bleed art, not the source tile centred on a canvas.** The
  shipped logo is a rounded tile on a white page; scaled edge-to-edge, that page became
  a pale square *inside* the launcher's circle mask. Nothing in the source PNG shows it —
  only the masked composite does, so `test/mobileIcons.test.mjs` composites the layers
  exactly as a launcher would (`maskCircle(flatten(foreground, backdrop))`) and asserts
  the outer ring contains **zero** page-coloured pixels.
* **The crop is measured, not guessed.** `pngkit`'s `flatBorderTrim` removes only rows
  and columns that are provably flat border (all four corners agree, every sampled pixel
  within a tolerance), then 6 % more to get past the tile's own rounding — and the total
  is **doubled**, because `overScanSquare` takes a fraction of the whole canvas and
  removes half of it per side. For the current logo that is 2 × (8.3 + 6) = 28.6 %, so
  the art is generated from the central 71 % of the source, reported as `crop` in
  `--json`. Skipping either half of that arithmetic produced a rim of the page colour at
  12/3/6/9 o'clock — invisible when viewing the source PNG, obvious in the simulated
  mask, and now asserted directly (`the generated foreground layer has no flat edge
  left`). The cap is 40 %, and exceeding it prints why rather than quietly eating the
  mark.
* The `<monochrome>` layer is all-or-nothing across densities (one bad density makes the
  launcher fall back mid-set), and a nearly-solid or nearly-empty silhouette is refused:
  a themed icon that renders as a filled squircle is worse than no themed icon.

`--check` writes nothing and exits 1, which is what makes it a CI brake; **generation**
exits 0 on a bad source (icon art must never brick a release). Both halves are pinned by
a test, including that generation is byte-idempotent.

## Install-time look (`android/**/res`)

`android:theme` on the activity is `AppTheme.NoActionBarLaunch` and Capacitor 8 never
swaps it (`BridgeActivity` does not call `installSplashScreen()`), so **every**
window-level item — `fitsSystemWindows`, `statusBarColor`, `windowLightStatusBar`,
`windowBackground` — has to be on the launch theme as well as on `AppTheme.NoActionBar`.
That duplication is deliberate; the framework template's advice to put it only on
`NoActionBar` styles a theme this app never applies.

* `values/colors.xml` overrides `colorPrimary`/`colorPrimaryDark`/`colorAccent`. Without
  it those names resolve to **Capacitor's library defaults** (`#3F51B5`, `#303F9F`) and
  the status bar comes out Material indigo on a white app — which is exactly what it was.
* `windowSplashScreenBackground` + `windowSplashScreenAnimatedIcon` + `postSplashScreenTheme`
  are what make Android 12+'s own splash show the brand instead of a blank field, and
  `postSplashScreenTheme` is the item whose absence leaves the logo frozen on screen.
* `windowLightNavigationBar` lives in `values-v27/styles.xml`, which **replaces** rather
  than extends the style, so the items are repeated in full there. (It cannot go in
  plain `values/`: `lintVital` fails a release build for a too-new attribute, and a
  warning nobody reads is the same as no gate.)

## Version sync

```
npm run mobile:version        # write package.json's version everywhere
npm run check:mobile          # CI: fail if any of them drifted
```

`package.json` is canonical. Derived, never hand-set:

* Android `versionCode` = `major*10000 + minor*100 + patch` (1.0.28 → 10028). Monotonic
  for every patch and minor below 100, which `versionCodeFrom` enforces rather than
  trusting — `1.0.100` would otherwise equal `1.1.0`.
* Android `versionName`, iOS `MARKETING_VERSION`, iOS `CURRENT_PROJECT_VERSION` (both
  build configurations, since a Release-only change is a bug that only shows in the
  store), and `public/sw.js`'s `CACHE = 'cgpa-pilot-v<version>'` so an installed PWA
  re-caches on release instead of serving the previous build forever.
* A pre-release keeps its base release's `versionCode`, so a beta cannot be installed
  over its RC by accident.

The script applies one write **per file**, with all edits chained on the working text. Its
first version computed each edit from the original text and wrote each result, so on a
file with two fields the last write restored what the first had changed — and `--check`
on the next run found the file stale after being "written". That is pinned by a test too.

## Release readiness, and what only a human can do

Set and verified here:

* `android:allowBackup="false"` + `res/xml/data_extraction_rules.xml` excluding every
  domain — the whole student record lives in this WebView's storage, and the default
  backs it up to a Google account and restores it onto another device ("nothing is
  stored anywhere but here" has to be true in the manifest as well as the code).
* `android:windowSoftInputMode="adjustResize"`, with `configChanges` already covering the
  keyboard so the activity is not recreated when it opens.
* `capacitor.config.ts` → `android.backgroundColor: '#EEF2F7'`, matching `body` in
  `src/index.css`; this is the window colour before the first frame, i.e. the flash.
* Debugging stays off in release because `android.webContentsDebuggingEnabled` defaults to
  `isDebug` — do **not** pin it to `true`; and `androidScheme` stays `https`, so
  `localStorage`/service workers are on a secure origin.
* `minifyEnabled false` in `android/app/build.gradle`: larger APK, no R8 shrinking. Kept
  deliberately (a Capacitor app is all WebView; R8 would only threaten plugin reflection).

Only you can do these — CI will not fail for them, so read this list at release time:

1. **A release keystore.** `android/app/release-keystore.p12` is absent, so
   `signingConfigs.release` is skipped and the release build falls back to the **debug
   key** (intentional, so CI keeps producing installable APKs). A debug-signed APK can
   never be updated in place by a release-signed one: users must uninstall, losing their
   locally stored record. Decide once, before telling anyone to install: stay on the
   debug key for internal use, or generate the keystore and never change it again. The
   release job already knows how to sign, so this is only secrets plus a key:

   ```bash
   keytool -genkeypair -keystore release-keystore.p12 -storetype PKCS12 \
     -alias cgpapilot -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release-keystore.p12   # → ANDROID_KEYSTORE_BASE64  (never commit this)
   ```

   then set `ANDROID_KEYSTORE_BASE64` (the file, base64 — the job decodes it to
   `android/app/release-keystore.p12`), plus `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_PASSWORD` and `ANDROID_KEY_ALIAS`. `build.gradle` defaults those to
   `changeit`/`cgpapilot`, so a keystore added *without* the secrets fails vaguely at
   signing instead of clearly at config time: set them together or not at all. Store the
   keystore somewhere that outlives GitHub — losing it means every installed app has to be
   reinstalled to receive updates again.
2. **Play Console / signing by Google**, if this leaves a small group of devices: with
   upload key vs app signing key the update path changes again.
3. **iOS**: the project is present (`ios/App`) but nothing here can compile it — that
   needs a Mac with Xcode, a development team, and an archive. `MARKETING_VERSION` is now
   kept in sync, which is the part a Mac cannot get wrong for you.
4. **A real device pass.** The inset rules and the launcher masks are the two things no
   headless check can finish: on a phone with a punch-hole camera, confirm the header text
   clears the clock, the back button is tappable, landscape puts the content inside the
   cutout, and the home-screen tile is the brand both before and after Android's themed-icon
   mode.
5. Pinch-zoom is disabled by `maximum-scale=1, user-scalable=no` in `index.html`. Kept
   because it prevents double-tap zoom in a form-heavy WebView; if that trade-off is wrong
   for your users, deleting those two tokens is the whole change.

## Commands

```bash
npm run mobile:icons          # regenerate the 34 mobile/iOS art files
npm run mobile:version        # push package.json's version into android/ios/sw.js
npm run check:mobile          # both, as gates (what CI should run)
npm run verify:branding       # every surface, including the two gates above
npm run mobile:sync           # version → build:web (which refreshes art) → cap sync android
```

## CI

`.github/workflows/**` is not pushable with this repo's automation token (no `workflows`
scope), so workflow changes ship as patches — `git apply docs/<name>.patch`, then commit
the result. Two are open:

* `docs/ci-android-sdk-resilient.patch` — the ubuntu job failed at **Set up Android SDK**
  on both v1.0.29 runs (`36340016935`, `36340411406`) while type-check, the web build,
  Electron packaging and the whole Windows job passed. `android-actions/setup-android@v3`
  downloads its tools from dl.google.com with no cache, before anything in `android/` is
  read, so an upstream hiccup costs only the APK. The patch prefers the SDK the runner
  already ships and keeps the action as a fallback. `docs/workflow-build-desktop.yml` (the
  tracked copy) already carries the change, so applying the patch to
  `.github/workflows/build-desktop.yml` makes the two agree. **Until it is applied, a
  release may publish without an APK — and the tests below still pass, which is exactly
  why it is easy to miss.**
* `docs/ci-brand-icons-imagemagick.patch` — optional now: `scripts/pngkit.mjs` rasterizes
  a square-PNG logo without ImageMagick. Keep the patch only if a JPEG or SVG logo has to
  be usable as installer art.

The gate worth adding to both Android jobs (the `docs/workflow-build-desktop.yml` copy has
it as a step you can copy):

```yaml
      - name: Mobile assets are current
        run: npm run check:mobile
```

`npm test` already covers the same ground (it regenerates the plan in-process and compares
every byte), so this step is for clarity in the log rather than for coverage.

Related: `docs/BRANDING.md` (where the logo comes from), `docs/DESKTOP-LINUX.md`
(packaging on the desktop), `docs/DEPLOYMENT.md` (what a client fetches).
