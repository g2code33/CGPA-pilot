#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# CGPA Pilot - v1.0.21 hotfix (Mac / Linux / WSL)
#
#   Double-click me, or in a terminal run:   bash apply-v1.0.21.sh
#
#   This file carries the whole v1.0.21 patch inside it. It will:
#     1. check you are inside the CGPA-pilot folder and main is up to date
#     2. refuse to run if you have OTHER uncommitted work (I never touch it)
#     3. apply the v1.0.21 patch, commit it, and push it to main
#
#   WHAT THIS FIXES (two live bugs found after v1.0.20):
#     1. IMAGES NOT SHOWING: the student site and admin console block
#        cross-origin images via their Content-Security-Policy, and the
#        Worker origin (which serves your R2 images) was not on the list -
#        so the new asset:catalog/... images were refused by the browser
#        ("action has been blocked"). The policy now allows that origin.
#     2. WRONG TOKEN GUIDANCE on the Storage page: it pointed you to the
#        R2 "Object Read Only" token, but those only work with the S3 API -
#        the account-usage view calls Cloudflare's management API, which is
#        why you got "7003 Could not route". The page now points to the
#        correct free read-only "Admin Read" token, warns when the Account
#        ID looks like a "cfk_..." API key instead of the 32-hex Account ID,
#        and every Cloudflare rejection now explains the exact fix.
#
#   AFTER RUNNING ME:
#     1. Redeploy the student site AND the admin console (Pages builds).
#        No Worker redeploy needed - the Worker is already correct.
#     2. Fix the Storage page credentials (2 minutes, step-by-step text
#        below, or follow the on-page guide): a read-only "Admin Read"
#        token + your 32-hex Account ID.
#
#   Builds on v1.0.20 (R2 asset storage).
# -----------------------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo " CGPA Pilot updater - v1.0.21 (hotfix)"
echo " (R2 images now load + correct"
echo "  Storage token guidance)"
echo "============================================"
echo
[ -f package.json ] || {
  echo " ERROR: put this file INSIDE your CGPA-pilot folder"
  echo " (the folder that contains package.json), then run it again."
  exit 1
}
command -v git >/dev/null 2>&1 || { echo " ERROR: git is not installed."; exit 1; }
echo " Repo folder: $PWD"
echo

# --- Safety: never touch other uncommitted work ---
# (old updater files v1.0.12-v1.0.21 are ignored - they are mine, not yours)
if [ -n "$(git status --porcelain | grep -v -e 'apply-v1.0.12.sh' -e 'fix-cgpa-v1.0.12.bat' -e 'v1.0.12.patch' -e '.v1012' -e 'apply-v1.0.13.sh' -e 'fix-cgpa-v1.0.13.bat' -e 'v1.0.13.patch' -e '.v1013' -e 'apply-v1.0.14.sh' -e 'fix-cgpa-v1.0.14.bat' -e 'v1.0.14.patch' -e '.v1014' -e 'apply-v1.0.15.sh' -e 'fix-cgpa-v1.0.15.bat' -e 'v1.0.15.patch' -e '.v1015' -e 'apply-v1.0.16.sh' -e 'fix-cgpa-v1.0.16.bat' -e 'v1.0.16.patch' -e '.v1016' -e 'apply-v1.0.17.sh' -e 'fix-cgpa-v1.0.17.bat' -e 'v1.0.17.patch' -e '.v1017' -e 'apply-v1.0.18.sh' -e 'fix-cgpa-v1.0.18.bat' -e 'v1.0.18.patch' -e '.v1018' -e 'apply-v1.0.19.sh' -e 'fix-cgpa-v1.0.19.bat' -e 'v1.0.19.patch' -e '.v1019' -e 'apply-v1.0.20.sh' -e 'fix-cgpa-v1.0.20.bat' -e 'v1.0.20.patch' -e '.v1020' -e 'apply-v1.0.21.sh' -e 'fix-cgpa-v1.0.21.bat' -e 'v1.0.21.patch' -e '.v1021' | head -n 1)" ]; then
  echo " STOP - this folder has other uncommitted changes:"
  git status --short
  echo
  echo " I never touch your work. Commit or stash those first, then run me again."
  exit 1
fi

echo " Checking main is up to date..."
git checkout main || exit 1
git pull origin main || { echo; echo " Could not update from GitHub - check your internet connection."; exit 1; }

# --- Already applied? ---
if [ -f src/admin/credsHint.ts ] \
   && [ "$(grep -c "img-src 'self' data: blob: https://cgpa-pilot.calcitoninpay.workers.dev" index.html admin.html 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')" = "2" ]; then
  echo
  echo " v1.0.21 is already applied - nothing to do. You are up to date."
  exit 0
fi

# --- This hotfix builds on v1.0.20 (R2 asset storage) ---
if [ ! -f src/config/assets.ts ] || [ ! -f src/admin/views/StorageMonitor.tsx ]; then
  echo
  echo " This update is a hotfix on top of v1.0.20 (R2 asset storage)."
  echo " Please run apply-v1.0.20.sh first (it is in this folder),"
  echo " then run me again."
  exit 1
fi

echo
echo " Preparing the v1.0.21 patch (embedded in this file)..."
rm -f .v1021.b64 .v1021.patch
B64_DATA=
B64_DATA=""

B64_DATA+="ZGlmZiAtLWdpdCBhL2FkbWluLmh0bWwgYi9hZG1pbi5odG1sCmluZGV4IDIy"
B64_DATA+="ODc3YjUuLmIwNGIwZjIgMTAwNjQ0Ci0tLSBhL2FkbWluLmh0bWwKKysrIGIv"
B64_DATA+="YWRtaW4uaHRtbApAQCAtNSw3ICs1LDcgQEAKICAgICA8bWV0YSBuYW1lPSJ2"
B64_DATA+="aWV3cG9ydCIgY29udGVudD0id2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFs"
B64_DATA+="LXNjYWxlPTEuMCwgdmlld3BvcnQtZml0PWNvdmVyIiAvPgogICAgIDxtZXRh"
B64_DATA+="CiAgICAgICBodHRwLWVxdWl2PSJDb250ZW50LVNlY3VyaXR5LVBvbGljeSIK"
B64_DATA+="LSAgICAgIGNvbnRlbnQ9ImRlZmF1bHQtc3JjICdzZWxmJzsgc2NyaXB0LXNy"
B64_DATA+="YyAnc2VsZic7IHN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnOyBp"
B64_DATA+="bWctc3JjICdzZWxmJyBkYXRhOiBibG9iOjsgZm9udC1zcmMgJ3NlbGYnIGRh"
B64_DATA+="dGE6OyBjb25uZWN0LXNyYyAnc2VsZicgaHR0cHM6Ly9jZ3BhLXBpbG90LmNh"
B64_DATA+="bGNpdG9uaW5wYXkud29ya2Vycy5kZXY7IgorICAgICAgY29udGVudD0iZGVm"
B64_DATA+="YXVsdC1zcmMgJ3NlbGYnOyBzY3JpcHQtc3JjICdzZWxmJzsgc3R5bGUtc3Jj"
B64_DATA+="ICdzZWxmJyAndW5zYWZlLWlubGluZSc7IGltZy1zcmMgJ3NlbGYnIGRhdGE6"
B64_DATA+="IGJsb2I6IGh0dHBzOi8vY2dwYS1waWxvdC5jYWxjaXRvbmlucGF5Lndvcmtl"
B64_DATA+="cnMuZGV2OyBmb250LXNyYyAnc2VsZicgZGF0YTo7IGNvbm5lY3Qtc3JjICdz"
B64_DATA+="ZWxmJyBodHRwczovL2NncGEtcGlsb3QuY2FsY2l0b25pbnBheS53b3JrZXJz"
B64_DATA+="LmRldjsiCiAgICAgLz4KICAgICA8bGluayByZWw9Imljb24iIHR5cGU9Imlt"
B64_DATA+="YWdlL3BuZyIgaHJlZj0iaWNvbi01MTIucG5nIiAvPgogICAgIDxtZXRhIG5h"
B64_DATA+="bWU9InJvYm90cyIgY29udGVudD0ibm9pbmRleCwgbm9mb2xsb3ciIC8+CmRp"
B64_DATA+="ZmYgLS1naXQgYS9pbmRleC5odG1sIGIvaW5kZXguaHRtbAppbmRleCBmNWY1"
B64_DATA+="YzI4Li5mYzFmOWU5IDEwMDY0NAotLS0gYS9pbmRleC5odG1sCisrKyBiL2lu"
B64_DATA+="ZGV4Lmh0bWwKQEAgLTgsNyArOCw3IEBACiAgICAgLz4KICAgICA8bWV0YQog"
B64_DATA+="ICAgICAgaHR0cC1lcXVpdj0iQ29udGVudC1TZWN1cml0eS1Qb2xpY3kiCi0g"
B64_DATA+="ICAgICBjb250ZW50PSJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMg"
B64_DATA+="J3NlbGYnOyBzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJzsgaW1n"
B64_DATA+="LXNyYyAnc2VsZicgZGF0YTogYmxvYjo7IGZvbnQtc3JjICdzZWxmJyBkYXRh"
B64_DATA+="OjsgY29ubmVjdC1zcmMgJ3NlbGYnIGh0dHBzOi8vY2dwYS1waWxvdC5jYWxj"
B64_DATA+="aXRvbmlucGF5LndvcmtlcnMuZGV2OyIKKyAgICAgIGNvbnRlbnQ9ImRlZmF1"
B64_DATA+="bHQtc3JjICdzZWxmJzsgc2NyaXB0LXNyYyAnc2VsZic7IHN0eWxlLXNyYyAn"
B64_DATA+="c2VsZicgJ3Vuc2FmZS1pbmxpbmUnOyBpbWctc3JjICdzZWxmJyBkYXRhOiBi"
B64_DATA+="bG9iOiBodHRwczovL2NncGEtcGlsb3QuY2FsY2l0b25pbnBheS53b3JrZXJz"
B64_DATA+="LmRldjsgZm9udC1zcmMgJ3NlbGYnIGRhdGE6OyBjb25uZWN0LXNyYyAnc2Vs"
B64_DATA+="ZicgaHR0cHM6Ly9jZ3BhLXBpbG90LmNhbGNpdG9uaW5wYXkud29ya2Vycy5k"
B64_DATA+="ZXY7IgogICAgIC8+CiAgICAgPGxpbmsgcmVsPSJpY29uIiB0eXBlPSJpbWFn"
B64_DATA+="ZS9wbmciIGhyZWY9Imljb24tNTEyLnBuZyIgLz4KICAgICA8bGluayByZWw9"
B64_DATA+="Im1hbmlmZXN0IiBocmVmPSJtYW5pZmVzdC53ZWJtYW5pZmVzdCIgLz4KZGlm"
B64_DATA+="ZiAtLWdpdCBhL3NyYy9hZG1pbi9jcmVkc0hpbnQudHMgYi9zcmMvYWRtaW4v"
B64_DATA+="Y3JlZHNIaW50LnRzCm5ldyBmaWxlIG1vZGUgMTAwNjQ0CmluZGV4IDAwMDAw"
B64_DATA+="MDAuLjcyNmJlODkKLS0tIC9kZXYvbnVsbAorKysgYi9zcmMvYWRtaW4vY3Jl"
B64_DATA+="ZHNIaW50LnRzCkBAIC0wLDAgKzEsNTkgQEAKKy8qKgorICogdjEuMC4yMSDi"
B64_DATA+="gJQgaHVtYW4gZ3VpZGFuY2UgZm9yIHdoZW4gdGhlIFN0b3JhZ2UgcGFnZSdz"
B64_DATA+="IENsb3VkZmxhcmUgY3JlZHMgcHJvYmUgZmFpbHMuCisgKgorICogVGhlIHBy"
B64_DATA+="b2JlIHJldHVybnMgQ2xvdWRmbGFyZSdzIHJhdyBlcnJvciBkZXRhaWw7IHRo"
B64_DATA+="aXMgbWFwcyB0aGUgY29tbW9uIGZhaWx1cmVzCisgKiB0byB0aGUgZXhhY3Qg"
B64_DATA+="Zml4IHNvIHRoZSB1c2VyIGRvZXNuJ3QgaGF2ZSB0byBndWVzcyB3aGljaCB2"
B64_DATA+="YWx1ZSBpcyB3cm9uZzoKKyAqCisgKiAgLSBSMiAiT2JqZWN0IFJlYWQgT25s"
B64_DATA+="eSIgLyAiT2JqZWN0IFJlYWQgJiBXcml0ZSIgdG9rZW5zIChjcmVhdGVkIGlu"
B64_DATA+="IHRoZSBSMgorICogICAgZGFzaGJvYXJkKSBhcmUgUzMtQVBJLW9ubHkg4oCU"
B64_DATA+="IHRoZXkgQ0FOTk9UIGhpdCBhcGkuY2xvdWRmbGFyZS5jb20gbWFuYWdlbWVu"
B64_DATA+="dAorICogICAgcm91dGVzIChlcnJvciA3MDAzICJjb3VsZCBub3Qgcm91dGUi"
B64_DATA+="KS4gVGhlIGFjY291bnQtd2lkZSB1c2FnZSB2aWV3IG5lZWRzIGEKKyAqICAg"
B64_DATA+="IHJlYWQtb25seSBBQ0NPVU5UIHRva2VuOiBNeSBQcm9maWxlIOKGkiBBUEkg"
B64_DATA+="VG9rZW5zIOKGkiB0ZW1wbGF0ZSAiQWRtaW4gUmVhZCIuCisgKiAgLSAiY2Zr"
B64_DATA+="X+KApiIgdmFsdWVzIGFyZSAobmV3LWZvcm1hdCkgR2xvYmFsIEFQSSBLRVlT"
B64_DATA+="LCBub3QgQWNjb3VudCBJRHMg4oCUIHBhc3RpbmcKKyAqICAgIG9uZSBpbnRv"
B64_DATA+="IHRoZSBBY2NvdW50IElEIGZpZWxkIGNhbiBuZXZlciB3b3JrLgorICovCisK"
B64_DATA+="K2NvbnN0IEFDQ09VTlRfSURfSElOVCA9CisgICJUaGF0IEFjY291bnQgSUQg"
B64_DATA+="bG9va3MgbGlrZSBhIEdsb2JhbCBBUEkga2V5IChzdGFydHMgd2l0aCAnY2Zr"
B64_DATA+="XycpIOKAlCB0aGF0J3MgdGhlIHdyb25nIHZhbHVlLiAiICsKKyAgIlRoZSBB"
B64_DATA+="Y2NvdW50IElEIGlzIHRoZSAzMi1jaGFyYWN0ZXIgaGV4IGNvZGUgc2hvd24g"
B64_DATA+="b24geW91ciBBY2NvdW50IEhvbWUgcGFnZSAodG9wLXJpZ2h0IG9mIHRoZSBD"
B64_DATA+="bG91ZGZsYXJlIGRhc2hib2FyZCkuIjsKKworY29uc3QgVE9LRU5fSElOVCA9"
B64_DATA+="CisgICJUaGF0IHRva2VuIGNhbid0IHJlYWNoIHRoZSBDbG91ZGZsYXJlIEFQ"
B64_DATA+="SSDigJQgUjIgJ09iamVjdCBSZWFkIE9ubHknIC8gJ09iamVjdCBSZWFkICYg"
B64_DATA+="V3JpdGUnIHRva2VucyAiICsKKyAgIihjcmVhdGVkIGluIFIyIOKGkiBNYW5h"
B64_DATA+="Z2UgUjIgQVBJIFRva2Vucykgb25seSB3b3JrIHdpdGggdGhlIFMzIEFQSSwg"
B64_DATA+="bm90IHRoaXMgdXNhZ2Ugdmlldy4gIiArCisgICJNYWtlIGEgcmVhZC1vbmx5"
B64_DATA+="IGFjY291bnQgdG9rZW4gaW5zdGVhZDogTXkgUHJvZmlsZSAoYXZhdGFyKSDi"
B64_DATA+="hpIgQVBJIFRva2VucyDihpIgQ3JlYXRlIHRva2VuIOKGkiAiICsKKyAgInRl"
B64_DATA+="bXBsYXRlICdBZG1pbiBSZWFkJy4gSXQgY2FuIG9ubHkgcmVhZCDigJQgaXQg"
B64_DATA+="Y2FuJ3QgY2hhbmdlIGFueXRoaW5nLiI7CisKK2NvbnN0IEFDQ09VTlRfTk9U"
B64_DATA+="X0ZPVU5EX0hJTlQgPQorICAiQ2xvdWRmbGFyZSBjb3VsZG4ndCBmaW5kIHRo"
B64_DATA+="YXQgQWNjb3VudCBJRC4gVXNlIHRoZSAzMi1jaGFyYWN0ZXIgaGV4IGNvZGUg"
B64_DATA+="ZnJvbSB5b3VyIEFjY291bnQgSG9tZSAiICsKKyAgInBhZ2UgKHRvcC1yaWdo"
B64_DATA+="dCBvZiB0aGUgZGFzaGJvYXJkKSDigJQgbm90IGFuIEFQSSB0b2tlbiBvciBr"
B64_DATA+="ZXkuIjsKKworLyoqIE1hcCBhIENsb3VkZmxhcmUgZXJyb3IgZGV0YWlsIHN0"
B64_DATA+="cmluZyB0byB0aGUgYWN0aW9uYWJsZSBmaXggZm9yIGl0LiAqLworZXhwb3J0"
B64_DATA+="IGZ1bmN0aW9uIGNyZWRzUHJvYmVIaW50KGRldGFpbDogc3RyaW5nKTogc3Ry"
B64_DATA+="aW5nIHsKKyAgY29uc3QgZCA9IChkZXRhaWwgPz8gJycpLnRvTG93ZXJDYXNl"
B64_DATA+="KCk7CisgIC8vIFRoZSBhY2NvdW50IGlkIGlzIGVjaG9lZCBpbiB0aGUgcmVx"
B64_DATA+="dWVzdCBVUkwgb2YgbW9zdCBlcnJvcnMg4oCUIGNhdGNoIGl0IGZpcnN0LAor"
B64_DATA+="ICAvLyBiZWNhdXNlIGEgY2ZrXyBpZCBicmVha3MgZXZlcnl0aGluZyByZWdh"
B64_DATA+="cmRsZXNzIG9mIHRoZSB0b2tlbi4KKyAgaWYgKGQuaW5jbHVkZXMoJ2Nma18n"
B64_DATA+="KSkgcmV0dXJuIEFDQ09VTlRfSURfSElOVDsKKyAgaWYgKAorICAgIGQuaW5j"
B64_DATA+="bHVkZXMoJzcwMDMnKSB8fAorICAgIGQuaW5jbHVkZXMoJ2NvdWxkIG5vdCBy"
B64_DATA+="b3V0ZScpIHx8CisgICAgZC5pbmNsdWRlcygndW5hdXRob3JpemVkJykgfHwK"
B64_DATA+="KyAgICBkLmluY2x1ZGVzKCdhdXRoZW50aWNhdGlvbiBlcnJvcicpCisgICkg"
B64_DATA+="eworICAgIHJldHVybiBUT0tFTl9ISU5UOworICB9CisgIGlmIChkLmluY2x1"
B64_DATA+="ZGVzKCdhY2NvdW50JykgJiYgKGQuaW5jbHVkZXMoJ25vdCBmb3VuZCcpIHx8"
B64_DATA+="IGQuaW5jbHVkZXMoJ2NvdWxkIG5vdCBiZSBmb3VuZCcpIHx8IGQuaW5jbHVk"
B64_DATA+="ZXMoJzQwNCcpKSkgeworICAgIHJldHVybiBBQ0NPVU5UX05PVF9GT1VORF9I"
B64_DATA+="SU5UOworICB9CisgIHJldHVybiAoCisgICAgJ0NoZWNrIHRoYXQgYm90aCB2"
B64_DATA+="YWx1ZXMgYXJlIGV4YWN0IGNvcGllczogdGhlIHRva2VuIGZyb20gTXkgUHJv"
B64_DATA+="ZmlsZSDihpIgQVBJIFRva2VucywgJyArCisgICAgJ2FuZCB0aGUgMzItY2hh"
B64_DATA+="cmFjdGVyIGhleCBBY2NvdW50IElEIGZyb20gdGhlIEFjY291bnQgSG9tZSBw"
B64_DATA+="YWdlLicKKyAgKTsKK30KKworLyoqCisgKiBBIENsb3VkZmxhcmUgQWNjb3Vu"
B64_DATA+="dCBJRCBpcyBhIDMyLWNoYXJhY3RlciBoZXggY29kZS4gQW55dGhpbmcgZWxz"
B64_DATA+="ZSDigJQgaW4KKyAqIHBhcnRpY3VsYXIgJ2Nma1/igKYnIEdsb2JhbCBBUEkg"
B64_DATA+="a2V5cyDigJQgaXMgc2F2ZWQgd3JvbmcuIFVzZWQgdG8gd2FybiBpbiB0aGUK"
B64_DATA+="KyAqIGZvcm0gQkVGT1JFIHRoZSB1c2VyIHN1Ym1pdHMsIHNvIHRoZSBtaXN0"
B64_DATA+="YWtlIGlzIGNhdWdodCBjbGllbnQtc2lkZS4KKyAqLworZXhwb3J0IGZ1bmN0"
B64_DATA+="aW9uIGFjY291bnRJZExvb2tzVmFsaWQoaWQ6IHN0cmluZyk6IGJvb2xlYW4g"
B64_DATA+="eworICByZXR1cm4gL15bMC05YS1mXXszMn0kL2kudGVzdCgoaWQgPz8gJycp"
B64_DATA+="LnRyaW0oKSk7Cit9CmRpZmYgLS1naXQgYS9zcmMvYWRtaW4vdmlld3MvU3Rv"
B64_DATA+="cmFnZU1vbml0b3IudHN4IGIvc3JjL2FkbWluL3ZpZXdzL1N0b3JhZ2VNb25p"
B64_DATA+="dG9yLnRzeAppbmRleCBiMDY2Mjk2Li5mOTljYTc0IDEwMDY0NAotLS0gYS9z"
B64_DATA+="cmMvYWRtaW4vdmlld3MvU3RvcmFnZU1vbml0b3IudHN4CisrKyBiL3NyYy9h"
B64_DATA+="ZG1pbi92aWV3cy9TdG9yYWdlTW9uaXRvci50c3gKQEAgLTI0LDYgKzI0LDcg"
B64_DATA+="QEAgaW1wb3J0IHsKIH0gZnJvbSAnLi4vYWRtaW5BcGknOwogaW1wb3J0IHsg"
B64_DATA+="aHVtYW5CeXRlcyB9IGZyb20gJy4uL2NhdGFsb2dTaXplJzsKIGltcG9ydCB7"
B64_DATA+="IHIyRmFsbGJhY2tOb3RlIH0gZnJvbSAnLi4vYXNzZXRVcGxvYWQnOworaW1w"
B64_DATA+="b3J0IHsgYWNjb3VudElkTG9va3NWYWxpZCwgY3JlZHNQcm9iZUhpbnQgfSBm"
B64_DATA+="cm9tICcuLi9jcmVkc0hpbnQnOwogCiBjb25zdCBGUkVFX1RJRVJfQllURVMg"
B64_DATA+="PSAxMCAqIDEwMjQgKiAxMDI0ICogMTAyNDsgLy8gUjIgZnJlZSB0aWVyOiAx"
B64_DATA+="MCBHQiAoYWNjb3VudC13aWRlKQogCkBAIC0xMjUsNyArMTI2LDcgQEAgZXhw"
B64_DATA+="b3J0IGZ1bmN0aW9uIFN0b3JhZ2VNb25pdG9yKCkgewogCiAgICAgICAgIHth"
B64_DATA+="Y2NvdW50ID09PSBudWxsICYmICgKICAgICAgICAgICA8cCBjbGFzc05hbWU9"
B64_DATA+="Im10LTMgcm91bmRlZC14bCBiZy1zbGF0ZS01MCBweC0zIHB5LTIuNSB0ZXh0"
B64_DATA+="LVsxMXB4XSBmb250LXNlbWlib2xkIHRleHQtc2xhdGUtNTAwIHJpbmctMSBy"
B64_DATA+="aW5nLXNsYXRlLTIwMCI+Ci0gICAgICAgICAgICBObyBhY2NvdW50IGNyZWRl"
B64_DATA+="bnRpYWxzIHNhdmVkIHlldCDigJQgYWRkIHRoZW0gYmVsb3cgKGEgQ2xvdWRm"
B64_DATA+="bGFyZSBBUEkgdG9rZW4gd2l0aCDigJxSMiBPYmplY3QgUmVhZOKAnSArIHlv"
B64_DATA+="dXIKKyAgICAgICAgICAgIE5vIGFjY291bnQgY3JlZGVudGlhbHMgc2F2ZWQg"
B64_DATA+="eWV0IOKAlCBhZGQgdGhlbSBiZWxvdyAoYSByZWFkLW9ubHkg4oCcQWRtaW4g"
B64_DATA+="UmVhZOKAnSBBUEkgdG9rZW4gKyB5b3VyIDMyLWhleAogICAgICAgICAgICAg"
B64_DATA+="QWNjb3VudCBJRCkuCiAgICAgICAgICAgPC9wPgogICAgICAgICApfQpAQCAt"
B64_DATA+="MjEzLDcgKzIxNCw5IEBAIGZ1bmN0aW9uIENyZWRzRm9ybSh7IGhhc0NyZWRz"
B64_DATA+="LCBvblNhdmVkIH06IHsgaGFzQ3JlZHM6IGJvb2xlYW47IG9uU2F2ZWQ6ICgp"
B64_DATA+="ID0+IHZvCiAgIGNvbnN0IFt0b2tlbiwgc2V0VG9rZW5dID0gdXNlU3RhdGUo"
B64_DATA+="JycpOwogICBjb25zdCBbYWNjb3VudElkLCBzZXRBY2NvdW50SWRdID0gdXNl"
B64_DATA+="U3RhdGUoJycpOwogICBjb25zdCBbYnVzeSwgc2V0QnVzeV0gPSB1c2VTdGF0"
B64_DATA+="ZShmYWxzZSk7Ci0gIGNvbnN0IFttc2csIHNldE1zZ10gPSB1c2VTdGF0ZTx7"
B64_DATA+="IG9rOiBib29sZWFuOyB0ZXh0OiBzdHJpbmcgfSB8IG51bGw+KG51bGwpOwor"
B64_DATA+="ICBjb25zdCBbbXNnLCBzZXRNc2ddID0gdXNlU3RhdGU8eyBvazogYm9vbGVh"
B64_DATA+="bjsgdGV4dDogc3RyaW5nOyBoaW50Pzogc3RyaW5nIH0gfCBudWxsPihudWxs"
B64_DATA+="KTsKKworICBjb25zdCBpZExvb2tzT2ZmID0gYWNjb3VudElkLnRyaW0oKSAh"
B64_DATA+="PT0gJycgJiYgIWFjY291bnRJZExvb2tzVmFsaWQoYWNjb3VudElkKTsKIAog"
B64_DATA+="ICBhc3luYyBmdW5jdGlvbiBkb1NhdmUoKSB7CiAgICAgc2V0QnVzeSh0cnVl"
B64_DATA+="KTsKQEAgLTIyNiwxNCArMjI5LDE0IEBAIGZ1bmN0aW9uIENyZWRzRm9ybSh7"
B64_DATA+="IGhhc0NyZWRzLCBvblNhdmVkIH06IHsgaGFzQ3JlZHM6IGJvb2xlYW47IG9u"
B64_DATA+="U2F2ZWQ6ICgpID0+IHZvCiAgICAgICBzZXRBY2NvdW50SWQoJycpOwogICAg"
B64_DATA+="ICAgc2V0T3BlbihmYWxzZSk7CiAgICAgICBvblNhdmVkKCk7Ci0gICAgfSBl"
B64_DATA+="bHNlIHsKKyAgICB9IGVsc2UgaWYgKHIuZXJyb3IgPT09ICdjcmVkcy1pbnZh"
B64_DATA+="bGlkJykgewogICAgICAgc2V0TXNnKHsKICAgICAgICAgb2s6IGZhbHNlLAot"
B64_DATA+="ICAgICAgICB0ZXh0OgotICAgICAgICAgIHIuZXJyb3IgPT09ICdjcmVkcy1p"
B64_DATA+="bnZhbGlkJwotICAgICAgICAgICAgPyBg4pyXIENsb3VkZmxhcmUgcmVqZWN0"
B64_DATA+="ZWQgdGhlIHRva2VuOiAke3IubWVzc2FnZSA/PyAnY2hlY2sgdGhlIHRva2Vu"
B64_DATA+="IGFuZCBhY2NvdW50IGlkLid9YAotICAgICAgICAgICAgOiBg4pyXICR7ci5t"
B64_DATA+="ZXNzYWdlID8/ICdDb3VsZCBub3Qgc2F2ZSBjcmVkZW50aWFscy4nfWAsCisg"
B64_DATA+="ICAgICAgIHRleHQ6IGDinJcgQ2xvdWRmbGFyZSByZWplY3RlZCB0aGUgY3Jl"
B64_DATA+="ZGVudGlhbHM6ICR7ci5tZXNzYWdlID8/ICdjaGVjayB0aGUgdG9rZW4gYW5k"
B64_DATA+="IGFjY291bnQgaWQuJ31gLAorICAgICAgICBoaW50OiBjcmVkc1Byb2JlSGlu"
B64_DATA+="dChyLm1lc3NhZ2UgPz8gJycpLAogICAgICAgfSk7CisgICAgfSBlbHNlIHsK"
B64_DATA+="KyAgICAgIHNldE1zZyh7IG9rOiBmYWxzZSwgdGV4dDogYOKclyAke3IubWVz"
B64_DATA+="c2FnZSA/PyAnQ291bGQgbm90IHNhdmUgY3JlZGVudGlhbHMuJ31gIH0pOwog"
B64_DATA+="ICAgIH0KICAgfQogCkBAIC0yNjAsNyArMjYzLDE0IEBAIGZ1bmN0aW9uIENy"
B64_DATA+="ZWRzRm9ybSh7IGhhc0NyZWRzLCBvblNhdmVkIH06IHsgaGFzQ3JlZHM6IGJv"
B64_DATA+="b2xlYW47IG9uU2F2ZWQ6ICgpID0+IHZvCiAgICAgICAgIHtoYXNDcmVkcyA/"
B64_DATA+="ICfinI4gRWRpdCBhY2NvdW50IGNyZWRlbnRpYWxzJyA6ICfvvIsgQWRkIGFj"
B64_DATA+="Y291bnQgY3JlZGVudGlhbHMnfQogICAgICAgPC9idXR0b24+CiAgICAgICB7"
B64_DATA+="bXNnICYmICgKLSAgICAgICAgPHAgY2xhc3NOYW1lPXtgbXQtMiB0ZXh0LVsx"
B64_DATA+="MXB4XSBmb250LWJvbGQgJHttc2cub2sgPyAndGV4dC1lbWVyYWxkLTcwMCcg"
B64_DATA+="OiAndGV4dC1yZWQtNjAwJ31gfT57bXNnLnRleHR9PC9wPgorICAgICAgICA8"
B64_DATA+="ZGl2IGNsYXNzTmFtZT0ibXQtMiBzcGFjZS15LTEuNSI+CisgICAgICAgICAg"
B64_DATA+="PHAgY2xhc3NOYW1lPXtgdGV4dC1bMTFweF0gZm9udC1ib2xkICR7bXNnLm9r"
B64_DATA+="ID8gJ3RleHQtZW1lcmFsZC03MDAnIDogJ3RleHQtcmVkLTYwMCd9YH0+e21z"
B64_DATA+="Zy50ZXh0fTwvcD4KKyAgICAgICAgICB7bXNnLmhpbnQgJiYgKAorICAgICAg"
B64_DATA+="ICAgICAgPHAgY2xhc3NOYW1lPSJyb3VuZGVkLWxnIGJnLWFtYmVyLTUwIHB4"
B64_DATA+="LTIuNSBweS0yIHRleHQtWzExcHhdIGZvbnQtc2VtaWJvbGQgbGVhZGluZy1y"
B64_DATA+="ZWxheGVkIHRleHQtYW1iZXItODAwIHJpbmctMSByaW5nLWFtYmVyLTIwMCI+"
B64_DATA+="CisgICAgICAgICAgICAgIHttc2cuaGludH0KKyAgICAgICAgICAgIDwvcD4K"
B64_DATA+="KyAgICAgICAgICApfQorICAgICAgICA8L2Rpdj4KICAgICAgICl9CiAgICAg"
B64_DATA+="ICB7b3BlbiAmJiAoCiAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJtdC0yIHNw"
B64_DATA+="YWNlLXktMiByb3VuZGVkLXhsIGJnLXNsYXRlLTUwIHAtMyByaW5nLTEgcmlu"
B64_DATA+="Zy1zbGF0ZS0yMDAiPgpAQCAtMjY5LDcgKzI3OSw3IEBAIGZ1bmN0aW9uIENy"
B64_DATA+="ZWRzRm9ybSh7IGhhc0NyZWRzLCBvblNhdmVkIH06IHsgaGFzQ3JlZHM6IGJv"
B64_DATA+="b2xlYW47IG9uU2F2ZWQ6ICgpID0+IHZvCiAgICAgICAgICAgICA8aW5wdXQK"
B64_DATA+="ICAgICAgICAgICAgICAgdHlwZT0icGFzc3dvcmQiCiAgICAgICAgICAgICAg"
B64_DATA+="IGNsYXNzTmFtZT0iaW5wdXQgbXQtMSB3LWZ1bGwgdGV4dC14cyIKLSAgICAg"
B64_DATA+="ICAgICAgICAgcGxhY2Vob2xkZXI9IuKAouKAouKAouKAoiAobmVlZHMgUjIg"
B64_DATA+="4oCcT2JqZWN0IFJlYWTigJ0gcGVybWlzc2lvbikiCisgICAgICAgICAgICAg"
B64_DATA+="IHBsYWNlaG9sZGVyPSLigKLigKLigKLigKIgKGFuIOKAnEFkbWluIFJlYWTi"
B64_DATA+="gJ0gdG9rZW4g4oCUIHJlYWQtb25seSkiCiAgICAgICAgICAgICAgIHZhbHVl"
B64_DATA+="PXt0b2tlbn0KICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRU"
B64_DATA+="b2tlbihlLnRhcmdldC52YWx1ZSl9CiAgICAgICAgICAgICAgIGF1dG9Db21w"
B64_DATA+="bGV0ZT0ib2ZmIgpAQCAtMjc5LDE0ICsyODksMjIgQEAgZnVuY3Rpb24gQ3Jl"
B64_DATA+="ZHNGb3JtKHsgaGFzQ3JlZHMsIG9uU2F2ZWQgfTogeyBoYXNDcmVkczogYm9v"
B64_DATA+="bGVhbjsgb25TYXZlZDogKCkgPT4gdm8KICAgICAgICAgICAgIEFjY291bnQg"
B64_DATA+="SUQKICAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgICBjbGFzc05h"
B64_DATA+="bWU9ImlucHV0IG10LTEgdy1mdWxsIHRleHQteHMiCi0gICAgICAgICAgICAg"
B64_DATA+="IHBsYWNlaG9sZGVyPSIzMi1oZXgtY2hhcmFjdGVyIGlkIChkYXNoYm9hcmQg"
B64_DATA+="4oaSIE92ZXJ2aWV3KSIKKyAgICAgICAgICAgICAgcGxhY2Vob2xkZXI9IjMy"
B64_DATA+="LWhleC1jaGFyYWN0ZXIgaWQgKEFjY291bnQgSG9tZSBwYWdlLCB0b3Atcmln"
B64_DATA+="aHQpIgogICAgICAgICAgICAgICB2YWx1ZT17YWNjb3VudElkfQogICAgICAg"
B64_DATA+="ICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldEFjY291bnRJZChlLnRhcmdl"
B64_DATA+="dC52YWx1ZSl9CiAgICAgICAgICAgICAvPgogICAgICAgICAgIDwvbGFiZWw+"
B64_DATA+="CisgICAgICAgICAge2lkTG9va3NPZmYgJiYgKAorICAgICAgICAgICAgPHAg"
B64_DATA+="Y2xhc3NOYW1lPSJ0ZXh0LVsxMHB4XSBmb250LWJvbGQgbGVhZGluZy1yZWxh"
B64_DATA+="eGVkIHRleHQtYW1iZXItNzAwIj4KKyAgICAgICAgICAgICAg4pqg77iPIFRo"
B64_DATA+="YXQgZG9lc27igJl0IGxvb2sgbGlrZSBhbiBBY2NvdW50IElEICgzMiBoZXgg"
B64_DATA+="Y2hhcmFjdGVycykuIElmIGl0IHN0YXJ0cyB3aXRoIOKAnGNma1/igJ0sIGl0"
B64_DATA+="4oCZcyBhbiBBUEkga2V5LAorICAgICAgICAgICAgICBub3QgYW4gQWNjb3Vu"
B64_DATA+="dCBJRCDigJQgdGhlIElEIGlzIG9uIHRoZSBBY2NvdW50IEhvbWUgcGFnZS4K"
B64_DATA+="KyAgICAgICAgICAgIDwvcD4KKyAgICAgICAgICApfQogICAgICAgICAgIDxw"
B64_DATA+="IGNsYXNzTmFtZT0idGV4dC1bMTBweF0gbGVhZGluZy1yZWxheGVkIHRleHQt"
B64_DATA+="c2xhdGUtNTAwIj4KLSAgICAgICAgICAgIENyZWF0ZSBpdCBpbiB0aGUgZGFz"
B64_DATA+="aGJvYXJkOiA8c3Ryb25nPk15IFByb2ZpbGUg4oaSIEFQSSBUb2tlbnMg4oaS"
B64_DATA+="IENyZWF0ZSB0b2tlbiDihpIg4oCcUjIgT2JqZWN0IFJlYWQgT25seeKAnTwv"
B64_DATA+="c3Ryb25nPi4KLSAgICAgICAgICAgIEl0IGlzIHZlcmlmaWVkIGJlZm9yZSBi"
B64_DATA+="ZWluZyBzdG9yZWQsIGFuZCBvbmx5IHRoZSBXb3JrZXIgKEQxKSBldmVyIHNl"
B64_DATA+="ZXMgaXQg4oCUIG5ldmVyIHRoZSBzdHVkZW50IGNvbmZpZy4KKyAgICAgICAg"
B64_DATA+="ICAgIENyZWF0ZSB0aGUgdG9rZW4gaW4gdGhlIGRhc2hib2FyZDogPHN0cm9u"
B64_DATA+="Zz5NeSBQcm9maWxlIOKGkiBBUEkgVG9rZW5zIOKGkiBDcmVhdGUgdG9rZW4g"
B64_DATA+="4oaSIHRlbXBsYXRlIOKAnEFkbWluCisgICAgICAgICAgICBSZWFk4oCdPC9z"
B64_DATA+="dHJvbmc+IOKAlCBpdCBpcyByZWFkLW9ubHkgYW5kIGNhbuKAmXQgY2hhbmdl"
B64_DATA+="IGFueXRoaW5nLiDimqDvuI8gRG9u4oCZdCB1c2UgUjLigJlzIOKAnE9iamVj"
B64_DATA+="dCBSZWFkIE9ubHnigJ0gdG9rZW4KKyAgICAgICAgICAgIChmcm9tIFIyIOKG"
B64_DATA+="kiBNYW5hZ2UgUjIgQVBJIFRva2Vucyk6IHRob3NlIG9ubHkgd29yayB3aXRo"
B64_DATA+="IHRoZSBTMyBBUEksIG5vdCB0aGlzIHVzYWdlIHZpZXcuIEl0IGlzIHZlcmlm"
B64_DATA+="aWVkCisgICAgICAgICAgICBiZWZvcmUgYmVpbmcgc3RvcmVkLCBhbmQgb25s"
B64_DATA+="eSB0aGUgV29ya2VyIChEMSkgZXZlciBzZWVzIGl0IOKAlCBuZXZlciB0aGUg"
B64_DATA+="c3R1ZGVudCBjb25maWcuCiAgICAgICAgICAgPC9wPgogICAgICAgICAgIDxk"
B64_DATA+="aXYgY2xhc3NOYW1lPSJmbGV4IGdhcC0yIj4KICAgICAgICAgICAgIDxidXR0"
B64_DATA+="b24KZGlmZiAtLWdpdCBhL3Rlc3QvY3JlZHNIaW50LnRlc3QubWpzIGIvdGVz"
B64_DATA+="dC9jcmVkc0hpbnQudGVzdC5tanMKbmV3IGZpbGUgbW9kZSAxMDA2NDQKaW5k"
B64_DATA+="ZXggMDAwMDAwMC4uZTAzOGQ1ZAotLS0gL2Rldi9udWxsCisrKyBiL3Rlc3Qv"
B64_DATA+="Y3JlZHNIaW50LnRlc3QubWpzCkBAIC0wLDAgKzEsNjggQEAKKy8vIOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAorLy8gY3JlZHNI"
B64_DATA+="aW50IOKAlCB2MS4wLjIxOiB3aGVuIHRoZSBTdG9yYWdlIHBhZ2UncyBDbG91"
B64_DATA+="ZGZsYXJlIGNyZWRzIHByb2JlIGZhaWxzLAorLy8gdGhlIHJhdyBlcnJvciBt"
B64_DATA+="dXN0IG1hcCB0byB0aGUgZXhhY3QgZml4LiBUaGUgdHdvIGxpdmUgZmFpbHVy"
B64_DATA+="ZXMgdGhhdAorLy8gc2hpcHBlZCB3aXRoIHYxLjAuMjA6CisvLyAgIOKAoiBh"
B64_DATA+="biBSMiAiT2JqZWN0IFJlYWQgT25seSIgdG9rZW4gKFMzLUFQSS1vbmx5KSDi"
B64_DATA+="hpIgNzAwMyAiY291bGQgbm90IHJvdXRlIgorLy8gICDigKIgYSBHbG9iYWwg"
B64_DATA+="QVBJIGtleSAoImNma1/igKYiKSBwYXN0ZWQgYXMgdGhlIEFjY291bnQgSUQK"
B64_DATA+="Ky8vIFJ1bjogbnBtIHRlc3QKKy8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKU"
B64_DATA+="gOKUgOKUgOKUgOKUgOKUgAorCitpbXBvcnQgdGVzdCBmcm9tICdub2RlOnRl"
B64_DATA+="c3QnOworaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydC9zdHJpY3Qn"
B64_DATA+="OworaW1wb3J0IHsgY3JlZHNQcm9iZUhpbnQsIGFjY291bnRJZExvb2tzVmFs"
B64_DATA+="aWQgfSBmcm9tICcuLi9zcmMvYWRtaW4vY3JlZHNIaW50LnRzJzsKKwordGVz"
B64_DATA+="dCgnNzAwMyAiY291bGQgbm90IHJvdXRlIiDihpIgcG9pbnRzIGF0IHRoZSB0"
B64_DATA+="b2tlbiB0eXBlIChTMy1vbmx5IHRva2VucyknLCAoKSA9PiB7CisgIGNvbnN0"
B64_DATA+="IGhpbnQgPSBjcmVkc1Byb2JlSGludCgKKyAgICAnNzAwMyBDb3VsZCBub3Qg"
B64_DATA+="cm91dGUgdG8gL2NsaWVudC92NC9hY2NvdW50cy9hYmNkZWYwMTIzNDU2Nzg5"
B64_DATA+="YWJjZGVmMDEyMzQ1Njc4OS9yMi9idWNrZXRzLCBwZXJoYXBzIHlvdXIgb2Jq"
B64_DATA+="ZWN0IGlkZW50aWZpZXIgaXMgaW52YWxpZD8nCisgICk7CisgIGFzc2VydC5t"
B64_DATA+="YXRjaChoaW50LCAvUjIgJ09iamVjdCBSZWFkIE9ubHknLyk7CisgIGFzc2Vy"
B64_DATA+="dC5tYXRjaChoaW50LCAvUzMgQVBJLyk7CisgIGFzc2VydC5tYXRjaChoaW50"
B64_DATA+="LCAvQWRtaW4gUmVhZC8pOworICBhc3NlcnQuZG9lc05vdE1hdGNoKGhpbnQs"
B64_DATA+="IC9BY2NvdW50IElEIGlzIHRoZSAzMi1jaGFyYWN0ZXIvKTsKK30pOworCit0"
B64_DATA+="ZXN0KCdhICJjZmtf4oCmIiB2YWx1ZSBpbiB0aGUgbWVzc2FnZSDihpIgcG9p"
B64_DATA+="bnRzIGF0IHRoZSB3cm9uZyBBY2NvdW50IElEIGZpcnN0JywgKCkgPT4gewor"
B64_DATA+="ICBjb25zdCBoaW50ID0gY3JlZHNQcm9iZUhpbnQoCisgICAgJzcwMDMgQ291"
B64_DATA+="bGQgbm90IHJvdXRlIHRvIC9jbGllbnQvdjQvYWNjb3VudHMvY2ZrX1h3ZHRR"
B64_DATA+="NTJvazlsUEk3VmluSkRVS2hiRkxMZnR2eVNoMUQwd2ZyWUc3MDI0YTU1OS9y"
B64_DATA+="Mi9idWNrZXRzJworICApOworICBhc3NlcnQubWF0Y2goaGludCwgL2Nma18v"
B64_DATA+="KTsKKyAgYXNzZXJ0Lm1hdGNoKGhpbnQsIC9HbG9iYWwgQVBJIGtleS8pOwor"
B64_DATA+="ICBhc3NlcnQubWF0Y2goaGludCwgL0FjY291bnQgSG9tZSBwYWdlLyk7Cisg"
B64_DATA+="IC8vIFRoZSBhY2NvdW50LWlkIG1pc3Rha2Ugd2lucyBvdmVyIHRoZSB0b2tl"
B64_DATA+="biBoaW50IOKAlCBmaXhpbmcgdGhlIGlkIGlzIHN0ZXAgMS4KKyAgYXNzZXJ0"
B64_DATA+="LmRvZXNOb3RNYXRjaChoaW50LCAvQWRtaW4gUmVhZC8pOworfSk7CisKK3Rl"
B64_DATA+="c3QoJ3VuYXV0aG9yaXplZCAvIGF1dGhlbnRpY2F0aW9uIGVycm9yIOKGkiB0"
B64_DATA+="b2tlbiBoaW50JywgKCkgPT4geworICBhc3NlcnQubWF0Y2goY3JlZHNQcm9i"
B64_DATA+="ZUhpbnQoJzEwMDAwIFVuYXV0aG9yaXplZCcpLCAvQWRtaW4gUmVhZC8pOwor"
B64_DATA+="ICBhc3NlcnQubWF0Y2goY3JlZHNQcm9iZUhpbnQoJzEwMDAwIEF1dGhlbnRp"
B64_DATA+="Y2F0aW9uIGVycm9yJyksIC9TMyBBUEkvKTsKK30pOworCit0ZXN0KCdhY2Nv"
B64_DATA+="dW50IG5vdCBmb3VuZCDihpIgQWNjb3VudCBJRCBoaW50JywgKCkgPT4gewor"
B64_DATA+="ICBhc3NlcnQubWF0Y2goY3JlZHNQcm9iZUhpbnQoJzQwNCBUaGUgYWNjb3Vu"
B64_DATA+="dCB5b3Ugd2VyZSBsb29raW5nIGZvciBjb3VsZCBub3QgYmUgZm91bmQuJyks"
B64_DATA+="IC8zMi1jaGFyYWN0ZXIgaGV4Lyk7Cit9KTsKKwordGVzdCgndW5rbm93biBm"
B64_DATA+="YWlsdXJlIOKGkiBnZW5lcmljICJjaGVjayBib3RoIHZhbHVlcyIgaGludCAo"
B64_DATA+="c3RpbGwgYWN0aW9uYWJsZSknLCAoKSA9PiB7CisgIGNvbnN0IGhpbnQgPSBj"
B64_DATA+="cmVkc1Byb2JlSGludCgnZmV0Y2ggZmFpbGVkOiBuZXR3b3JrIGVycm9yJyk7"
B64_DATA+="CisgIGFzc2VydC5tYXRjaChoaW50LCAvTXkgUHJvZmlsZSDihpIgQVBJIFRv"
B64_DATA+="a2Vucy8pOworICBhc3NlcnQubWF0Y2goaGludCwgL0FjY291bnQgSG9tZSBw"
B64_DATA+="YWdlLyk7Cit9KTsKKwordGVzdCgnZW1wdHkgZGV0YWlsIOKGkiBnZW5lcmlj"
B64_DATA+="IGhpbnQsIG5vIGNyYXNoJywgKCkgPT4geworICBhc3NlcnQuZXF1YWwodHlw"
B64_DATA+="ZW9mIGNyZWRzUHJvYmVIaW50KCcnKSwgJ3N0cmluZycpOworICBhc3NlcnQu"
B64_DATA+="b2soY3JlZHNQcm9iZUhpbnQoJycpLmxlbmd0aCA+IDIwKTsKK30pOworCit0"
B64_DATA+="ZXN0KCdhY2NvdW50SWRMb29rc1ZhbGlkIOKAlCAzMiBoZXggcGFzc2VzIChj"
B64_DATA+="YXNlLWluc2Vuc2l0aXZlKSwgd2l0aC93aXRob3V0IHNwYWNlcycsICgpID0+"
B64_DATA+="IHsKKyAgYXNzZXJ0LmVxdWFsKGFjY291bnRJZExvb2tzVmFsaWQoJzAxMjM0"
B64_DATA+="NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmJyksIHRydWUpOworICBhc3Nl"
B64_DATA+="cnQuZXF1YWwoYWNjb3VudElkTG9va3NWYWxpZCgnMDEyMzQ1Njc4OUFCQ0RF"
B64_DATA+="RjAxMjM0NTY3ODlBQkNERUYnKSwgdHJ1ZSk7CisgIGFzc2VydC5lcXVhbChh"
B64_DATA+="Y2NvdW50SWRMb29rc1ZhbGlkKCcgIDAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2"
B64_DATA+="Nzg5YWJjZGVmICAnKSwgdHJ1ZSk7Cit9KTsKKwordGVzdCgnYWNjb3VudElk"
B64_DATA+="TG9va3NWYWxpZCDigJQgcmVqZWN0cyBjZmtfIGtleXMsIHNob3J0L2xvbmcg"
B64_DATA+="aWRzLCBub24taGV4JywgKCkgPT4geworICBhc3NlcnQuZXF1YWwoYWNjb3Vu"
B64_DATA+="dElkTG9va3NWYWxpZCgnY2ZrX1h3ZHRRNTJvazlsUEk3VmluSkRVS2hiRkxM"
B64_DATA+="ZnR2eVNoMUQwd2ZyWUc3MDI0YTU1OScpLCBmYWxzZSk7CisgIGFzc2VydC5l"
B64_DATA+="cXVhbChhY2NvdW50SWRMb29rc1ZhbGlkKCcwMTIzNDU2Nzg5YWJjZGVmMDEy"
B64_DATA+="MzQ1Njc4OWFiY2RlJyksIGZhbHNlKTsgLy8gMzEKKyAgYXNzZXJ0LmVxdWFs"
B64_DATA+="KGFjY291bnRJZExvb2tzVmFsaWQoJzAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2"
B64_DATA+="Nzg5YWJjZGVmMCcpLCBmYWxzZSk7IC8vIDMzCisgIGFzc2VydC5lcXVhbChh"
B64_DATA+="Y2NvdW50SWRMb29rc1ZhbGlkKCd6enp6NDU2Nzg5YWJjZGVmMDEyMzQ1Njc4"
B64_DATA+="OWFiY2RlZicpLCBmYWxzZSk7IC8vIG5vbi1oZXgKKyAgYXNzZXJ0LmVxdWFs"
B64_DATA+="KGFjY291bnRJZExvb2tzVmFsaWQoJycpLCBmYWxzZSk7CisgIGFzc2VydC5l"
B64_DATA+="cXVhbChhY2NvdW50SWRMb29rc1ZhbGlkKCdzb21lIHJhbmRvbSBhY2NvdW50"
B64_DATA+="IGlkJyksIGZhbHNlKTsKK30pOwo="
printf '%s' "$B64_DATA" > .v1021.b64
tr -d ' \n\t' < .v1021.b64 > .v1021.b64.tmp && mv .v1021.b64.tmp .v1021.b64
if command -v base64 >/dev/null 2>&1; then
  base64 -d .v1021.b64 > .v1021.patch 2>/dev/null || base64 -Di .v1021.patch .v1021.b64
else
  echo " ERROR: base64 is not available."; exit 1
fi

git apply --check .v1021.patch || {
  echo
  echo " ERROR: the patch does not match your current main branch."
  echo " (It expects the v1.0.20 files: index.html, admin.html and"
  echo "  src/admin/views/StorageMonitor.tsx.)"
  echo " If you edited those by hand, restore them and run me again:"
  echo "   git checkout -- index.html admin.html src/admin/views/StorageMonitor.tsx"
  exit 1
}
git apply .v1021.patch || {
  echo
  echo " ERROR: applying the patch failed."
  echo " To undo the partial change run:  git checkout -- ."
  exit 1
}

# --- Bump the version to 1.0.21 ---
sed -i.bak -e 's/"version": "1.0.20"/"version": "1.0.21"/' package.json && rm -f package.json.bak
grep -q '"version": "1.0.21"' package.json || {
  echo " ERROR: the version bump did not take (package.json is not at 1.0.20)."
  git checkout -q -- . 2>/dev/null
  exit 1
}

echo " Committing and pushing..."
git add index.html admin.html package.json src/admin/credsHint.ts src/admin/views/StorageMonitor.tsx test/credsHint.test.mjs
git commit -m "v1.0.21: hotfix - R2 asset images now load (CSP img-src allows the Worker origin on the student site + admin console) and the Storage page token guidance is corrected (read-only 'Admin Read' account token instead of the S3-only R2 'Object Read Only' that caused Cloudflare 7003; warns when the Account ID looks like a cfk_ API key; every Cloudflare rejection now explains the exact fix); 8 new tests (487/487)" || {
  git reset -q 2>/dev/null
  git checkout -q -- index.html admin.html src/admin/views/StorageMonitor.tsx package.json 2>/dev/null
  git clean -qf src/admin/credsHint.ts test/credsHint.test.mjs 2>/dev/null
  rm -f .v1021.b64 .v1021.patch
  echo
  echo " ERROR: the commit failed. I undid the v1.0.21 changes so you can try again."
  exit 1
}
git push origin main || {
  echo
  echo " PUSH FAILED - but the code IS committed locally on main."
  echo " Fix the connection, then run:  git push origin main"
  exit 1
}

rm -f .v1021.b64 .v1021.patch
echo
echo ============================================
echo " DONE - v1.0.21 is committed and pushed to main."
echo
echo " STEP 1 - make the images show up (required):"
echo "  * Redeploy the student site  (Pages -> cgpa-pilot -> Deploy)."
echo "  * Redeploy the admin console (Pages -> cgpa-pilot-admin -> Deploy)."
echo "  * No Worker redeploy needed - the Worker was already correct."
echo
echo " STEP 2 - fix the Storage page credentials (2 minutes):"
echo "  1. Cloudflare dashboard -> My Profile (avatar, top-right)"
echo "     -> API Tokens -> Create token."
echo "  2. Under 'Choose a template' select 'Admin Read' (read-only -"
echo "     it can only READ usage, it can't change anything) ->"
echo "     Create token -> copy it."
echo "  3. On your Account Home page, copy the Account ID - the"
echo "     32-hex-character code (top-right). It is NOT a 'cfk_...'"
echo "     key."
echo "  4. Admin console -> Storage -> 'Edit account credentials'"
echo "     -> paste both -> 'Verify & save'. The per-bucket bars"
echo "     (every project's R2 usage vs the 10 GB free tier) appear."
echo
echo " Note: the bad token was never stored (credentials are verified"
echo " before saving), so you are simply adding the right ones."
echo
echo " The student site + admin update on the next normal load."
echo ============================================