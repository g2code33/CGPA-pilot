#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════
# CGPA PILOT  ·  v1.0.23  ·  ICONS, CGPA FIX, AI BOX, PRINT OVERHAUL
# ─────────────────────────────────────────────────────────────────────────
#   What this delivers:
#
#   1. EVERY ICON IS ADMIN-CHANGEABLE (Icons & Branding page):
#        • NEW "AI Assistant" slot (🤖) — the AI button, AI panel, Privacy
#          page AI section and the admin AI menu item all follow it.
#        • NEW "Admin console" group — all 13 admin side-menu icons.
#        • The AI panel's quick links follow the Calculate / Target /
#          Next / What-If tool icons.
#   2. CGPA DONE PROPERLY: every level you type is the CUMULATIVE CGPA on
#      your transcript (CGPA is cumulative by definition — it is never a
#      level GPA). The fake "Running CGPA" column and all its re-averaging
#      are GONE: your Band is graded from your real value, and your
#      Confirmed CGPA is simply the most recent value you typed.
#   3. AI TYPING AREA: the typing box is now a PURE WHITE card (always
#      stands out), and the small 🔒 privacy line under it moved INSIDE a
#      💡 idea icon — tap it to open, tap again to close.
#   4. SPLASH LOGO BUG FIX: university & department logos on the opening
#      screen were sent to the browser as raw asset: references (the
#      "asset:catalog/…" console errors). They're resolved now.
#   5. PRINT OVERHAUL:
#        • New branded LETTERHEAD on every page: app logo + CGPA PILOT
#          wordmark + tagline, the document title + date, and your
#          university AND department (with both logos).
#        • "Generated with CGPA PILOT" footer on every page.
#        • The header can NEVER overlap the content (guaranteed clearance).
#        • The Flight Path "Entire Page" print: the graph prints ALONE on
#          its own page (just the graph + its key); the milestone table
#          prints whole (never half, header repeats, rows never split).
#        • Removed the "Credit counts are locked everywhere…" text.
#   6. BOTTOM "NEXT": a student who has not entered their results can no
#      longer proceed — every tap tells them to enter their results first.
#   7. 501 tests.
#
#   Run:        bash apply-v1.0.23.sh
#   Afterwards:  redeploy the WORKER (small AI-wording change), the STUDENT
#                Pages project and the ADMIN Pages project.
#
#   If anything stops, paste the FULL output to me.
# ═════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

if [ -d .git ] && [ -f .git/HEAD ]; then
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || true
fi

# ── 0. Pre-checks ──────────────────────────────────────────────────────
if [ ! -f package.json ]; then
  echo "✗ I don't seem to be in the CGPA Pilot project folder."
  echo "  Put me in the project root (next to package.json) and run me again."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found. Install Node 18+ first (https://nodejs.org)."
  exit 1
fi

# v1.0.23 sits on top of v1.0.22 — the R2 list fix must be in place first.
if ! grep -q "per_page=1000" worker/src/assets.ts 2>/dev/null; then
  echo "✗ Your project still has the OLD worker code (v1.0.21)."
  echo "  Run apply-v1.0.22.sh first, then run this script again."
  exit 1
fi

if [ -f src/splashLogos.ts ] && grep -q '"version": "1.0.23"' package.json; then
  echo "✓ v1.0.23 is already applied — nothing to do."
  exit 0
fi

# ── 1. Back up what we're about to change ──────────────────────────────
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="backup-v1.0.23-$TS"
mkdir -p "$BACKUP"
for f in package.json src/App.tsx src/config/branding.ts src/views/AiAssistant.tsx src/views/Privacy.tsx src/components/ui.tsx src/admin/AdminApp.tsx src/services/historyProgress.ts src/services/coreCgpaService.ts src/state/derived.ts src/views/Calculate.tsx src/services/aiContext.ts src/admin/aiSettings.ts worker/src/ai.ts src/views/Print.tsx src/views/FlightPath.tsx src/views/Target.tsx src/services/scopedPrint.ts src/index.css; do
  cp -f "$f" "$BACKUP/$(echo "$f" | tr / _)" 2>/dev/null || true
done
echo "✓ Backup of the old files: $BACKUP/"

# ── 2. Apply the patch ─────────────────────────────────────────────────
PATCH="v1.0.23.patch"
if [ ! -f "$PATCH" ]; then
  # Auto-find: the file may have landed in Downloads or the home folder.
  FOUND=""
  for cand in "$HOME/Downloads/$PATCH" "$HOME/Downloads/v1.0.23.patch" "$HOME/$PATCH" "./$PATCH"; do
    if [ -f "$cand" ] && [ "$cand" != "$PATCH" ]; then FOUND="$cand"; break; fi
  done
  if [ -n "$FOUND" ]; then
    cp -f "$FOUND" "$PATCH"
    echo "✓ Found $PATCH at $FOUND — copied it into the project folder."
  else
    echo "✗ Missing $PATCH — put it in the project folder (next to this"
    echo "  script) and run me again."
    exit 1
  fi
fi
git apply --check "$PATCH" 2>/dev/null && git apply "$PATCH" \
  || { echo "   (strict apply didn't fit — trying fuzzy…)"; patch -p1 --forward < "$PATCH"; }

# ── 3. Bump the version ────────────────────────────────────────────────
sed -i 's/"version": "1.0.2[0-9]"/"version": "1.0.23"/' package.json
V="$(node -e "process.stdout.write(require('./package.json').version)")"
if [ "$V" != "1.0.23" ]; then
  echo "✗ Version bump failed (now $V)."
  exit 1
fi
echo "✓ Version: $V"

# ── 4. Verify the code is in place ─────────────────────────────────────
FAIL=0
chk() { if ! grep -q "$2" "$1" 2>/dev/null; then echo "  ✗ $1 is missing: $2"; FAIL=1; else echo "  ✓ $1"; fi; }
chk src/splashLogos.ts              "splashLogoItems"
chk src/App.tsx                     "splashLogoItems"
chk src/App.tsx                     "slot=\"ai\""
chk src/App.tsx                     "nudgeEnterResults"
chk src/config/branding.ts          "'ai' | 'admin'"
chk src/config/branding.ts          "Admin console"
chk src/views/AiAssistant.tsx       "TipIcon"
chk src/views/AiAssistant.tsx       "PURE WHITE card"
chk src/views/Privacy.tsx           "slot=\"ai\""
chk src/components/ui.tsx           "ReactNode"
chk src/admin/AdminApp.tsx          "NavIcon"
chk src/services/historyProgress.ts "v1.0.23"
chk src/services/coreCgpaService.ts "latestHistoryCgpa"
chk worker/src/ai.ts                "cumulative CGPA"
chk src/views/Calculate.tsx         "CGPA (cumulative)"
chk src/services/scopedPrint.ts     "print-footer"
chk src/services/scopedPrint.ts     "departmentLogo"
chk src/index.css                   "22mm 14mm 14mm"
chk test/splashLogos.test.mjs       "splashLogos"
chk test/iconSlots.test.mjs         "admin nav item"
chk test/historyProgress.test.mjs   "as-is"
# the deleted Target text must be GONE
if grep -q "Credit counts are locked everywhere" src/views/Target.tsx 2>/dev/null; then
  echo "  ✗ src/views/Target.tsx still has the deleted 'Credit counts are locked' text"; FAIL=1
else
  echo "  ✓ src/views/Target.tsx (old text removed)"
fi
[ "$FAIL" = "1" ] && { echo "✗ Some files did not update — full STOP."; exit 1; }

# ── 5. Install if needed, then run ALL tests ───────────────────────────
if [ ! -d node_modules ]; then
  echo "⏳ First run: installing dependencies (one-time, a few minutes)…"
  npm install --no-audit --no-fund
fi
echo "⏳ Running the full test suite…"
if node test/run-tests.mjs; then
  echo "✓ All tests passed."
else
  echo "✗ Some tests failed — full STOP."
  exit 1
fi

# ── 6. Type-check + production build ───────────────────────────────────
echo "⏳ Type-checking…"
npx tsc -p tsconfig.json --noEmit
npx tsc -p worker/tsconfig.json --noEmit
echo "⏳ Building the student app…"
npx vite build
echo "✓ Build OK."

# ── 7. Done ────────────────────────────────────────────────────────────
cat <<'EOF'

════════════════════════════════════════════════════════════════════════
✓✓✓ v1.0.23 APPLIED ✓✓✓
══════════════════════════════════════════════════════════════════════

WHAT'S NEW (what you asked for):
  1. EVERY icon changeable in Admin → Icons & Branding:
     new "AI Assistant" group (the 🤖 everywhere) + new "Admin console"
     group (all 13 admin menu icons). The AI panel's quick links follow
     the tool icons.
  2. CGPA fixed: the numbers you type ARE your cumulative CGPA — the
     "Running CGPA" column is gone, the Band grades your real value, and
     Confirmed CGPA = the most recent value you typed.
  3. AI panel: pure white typing box; the privacy line is now inside the
     💡 idea icon under it (tap to open / close).
  4. The "asset:catalog/…" logo errors are fixed.
  5. Printing: new branded letterhead (app + university + department +
     both logos + tagline), a "Generated with CGPA PILOT" footer on every
     page, header can never overlap the content, the graph prints ALONE
     (graph + key only), tables print whole.
  6. Bottom Next: no results entered → no proceed; every tap tells them.

DO THIS NEXT (3 deploys):
  1. Cloudflare → Workers → YOUR WORKER → Redeploy
     (small AI wording fix inside the Worker).
  2. Pages → deploy the STUDENT project.
  3. Pages → deploy the ADMIN project.
  4. Then: Admin → Icons & Branding → set any icons (emoji or image)
     → Save → publish.
  5. Refresh the student site (Ctrl/Cmd + Shift + R):
     • opening screen shows the university/department logos, console CLEAN
     • AI box is pure white; tap the 💡 under it
     • History mode: no "Running CGPA" column
     • Print anything: new letterhead + footer; Flight Path → Entire
       Page: graph alone on its own page

If you see a STOP or ERROR anywhere above, paste the full output to me.
EOF