// Safe areas: the CSS half of the phone fix, and the rule that keeps it honest.
//
// The bug was structural, not cosmetic: the WebView is laid out under the status bar
// and the display cutout (`viewport-fit=cover` + targetSdk 36 edge-to-edge) while
// `src/` contained not one `env(safe-area-inset-*)` — so the app header and the back
// button inside it were drawn under the clock, and the bottom navigation under the
// gesture pill. These tests pin the fix at both ends: the variables exist, every bar
// consumes them, and no spacing utility can delete the inset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');
const app = readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
const admin = readFileSync(path.join(ROOT, 'src', 'admin', 'AdminApp.tsx'), 'utf8');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const adminHtml = readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const block = css.slice(css.indexOf('PHONE CHROME'), css.indexOf('PRINT SYSTEM'));

test('the four insets are variables with a real fallback', () => {
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.match(block, new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`), `--safe-${side}`);
  }
  // A browser with no env() support must read 0, not an invalid value that drops the
  // whole padding declaration and puts the header back under the notch.
  assert.match(block, /@supports not \(top: env\(safe-area-inset-top\)\)/);
  const supports = block.slice(block.indexOf('@supports not'));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.match(supports.slice(0, 400), new RegExp(`--safe-${side}:\\s*0px`));
  }
});

test('the bars add the inset to their own padding instead of replacing it', () => {
  // The old shape — `padding-top: calc(0.375rem + env())` — meant every screen had to
  // remember to keep its padding in sync, and a later `py-2` deleted the inset. Now the
  // padding is a TOKEN and the inset is added to it.
  assert.match(block, /header\.app-header\s*\{[^}]*--app-header-pad:\s*0\.375rem/s);
  assert.match(block, /header\.app-header\s*\{[^}]*padding-top:\s*calc\(var\(--app-header-pad\)\s*\+\s*var\(--safe-top\)\)/s);
  assert.match(block, /header\.app-header\s*\{[^}]*padding-bottom:\s*var\(--app-header-pad\)/s);
  assert.match(block, /nav\.app-bar\s*\{[^}]*padding-bottom:\s*calc\(var\(--app-bar-pad\)\s*\+\s*var\(--safe-bottom\)\)/s);
  // Element-qualified on purpose: the CSS minifier collapses `.app-header.app-header`
  // to one class (measured in the emitted sheet), and an unqualified rule loses to
  // Tailwind's utilities. `header.app-header` is both specific enough and stable.
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, ' '); // comments may QUOTE the trick; only rules matter
  assert.ok(!/\.app-header\.app-header/.test(rules), 'the doubled-class trick is what the minifier undoes');
  // …and the landscape padding must exist EXACTLY once: a second copy outside the
  // layer (where it loses to utilities) is inert, and inert-but-present is how this
  // fix would have been "verified" while doing nothing.
  assert.equal((css.match(/@media \(orientation: landscape\)/g) ?? []).length, 1, 'one landscape rule in the sheet');
});

test('landscape moves the inset to the sides', () => {
  const media = block.slice(block.indexOf('@media (orientation: landscape)'));
  assert.match(media, /header\.app-header\s*\{[^}]*padding-left:\s*calc\(1rem \+ var\(--safe-left\)\)/s);
  assert.match(media, /header\.app-header\s*\{[^}]*padding-right:\s*calc\(1rem \+ var\(--safe-right\)\)/s);
});

test('overscroll and the tap flash are killed for the phone', () => {
  assert.match(css, /html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none/s);
  assert.match(css, /\*\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/s);
});

test('both shells opt into cover, or the insets stay zero', () => {
  for (const [name, doc] of [['index.html', html], ['admin.html', adminHtml]]) {
    assert.match(doc.replace(/\s+/g, ' '), /name="viewport"[^>]*viewport-fit=cover/, `${name} must set viewport-fit=cover`);
    assert.match(doc.replace(/\s+/g, ' '), /width=device-width/, `${name} viewport`);
  }
});

test('every bar and float in the app consumes the insets', () => {
  const uses = (app + admin).replace(/\s+/g, ' ');
  const classNames = [...(app + '\n' + admin).matchAll(/className=(?:"|\{`)([^"`\n]*)/g)].map((m) => m[1]);
  const headers = classNames.filter((c) => /\bapp-header\b/.test(c));
  const bars = classNames.filter((c) => /\bapp-bar\b/.test(c));
  // Three app shells (desktop, tool, home hub) + the admin header; two bottom bars.
  assert.equal(headers.length, 4, `expected 4 inset headers, got ${headers.length}`);
  assert.equal(bars.length, 2, `expected the tool nav and the admin tab strip, got ${bars.length}`);
  // Floating controls carry the inset in their own positioning utility: a `bottom-*`
  // utility sitting next to a margin rule would win by load order, so this is the only
  // form that cannot be undone by the class beside it.
  const floats = (uses.match(/var\(--safe-(?:bottom|top|right)\)/g) ?? []).length;
  assert.ok(floats >= 7, `the assistant button (3 placements), toasts and the splash pill: ${floats}`);
  for (const pos of app.match(/aiFab\('([^']+)'\)/g) ?? []) {
    assert.match(pos, /--safe-bottom/, `every floating button needs the gesture-bar inset: ${pos}`);
  }
});

test('a bar that takes the inset must not also carry a vertical padding utility', () => {
  // This is the regression that would silently undo the whole fix: someone tidies the
  // header with `py-2` and the notch gap disappears, because the utility is declared
  // after the component layer in the emitted sheet.
  const offenders = [];
  for (const [file, src] of [['src/App.tsx', app], ['src/admin/AdminApp.tsx', admin]]) {
    for (const m of src.matchAll(/className=(?:"|\{`)([^"`]*\b(?:app-header|app-bar)\b[^"`]*)["`]/g)) {
      const cls = m[1];
      if (/(^|\s)(p|py|pt|pb)-[\w.[\]]/.test(cls)) offenders.push(`${file}: ${cls.slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [], `spacing utility on an inset bar:\n${offenders.join('\n')}`);
});

test('no custom inset class is used without being defined, or defined without being used', () => {
  // Tailwind purges rules in `@layer components` whose class does not appear in the
  // scanned content — so an unused definition is deleted, and a used-but-undefined
  // class means a bar quietly lost its inset. Both directions are checked.
  const defined = new Set([...block.matchAll(/(?:header\.|nav\.|\.)([a-z][\w-]*)\s*\{/g)].map((m) => m[1]));
  const used = new Set(
    [...(app + admin).matchAll(/\b((?:app-header|app-bar|safe-float[\w-]*)|no-print|brand-btn|brand-scope)\b/g)].map((m) => m[1])
  );
  for (const cls of ['app-header', 'app-bar']) {
    assert.ok(defined.has(cls), `${cls} is not defined in the phone-chrome block → it would be purged`);
    assert.ok(used.has(cls), `${cls} is defined but unused → it would be purged`);
  }
});

test('the insets are applied once per platform, not twice', () => {
  // The Android theme already insets the WebView (`fitsSystemWindows`), and where it
  // does, the WebView's own env() reads 0 — that is why both can be present. A manual
  // padding in JS (an Android-only constant) would double it and leave a huge gap
  // under the status bar, so nothing like that may exist.
  const suspects = [];
  for (const f of ['src/App.tsx', 'src/admin/AdminApp.tsx', 'src/index.css']) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(statusBarHeight|safeAreaInsets|screen\.height|Capacitor\.platform)/g)) {
      suspects.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(suspects, [], `a JS-side inset would be applied on top of the theme's:\n${suspects.join('\n')}`);
});
