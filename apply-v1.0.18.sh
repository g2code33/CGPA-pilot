#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# CGPA Pilot - v1.0.18 updater (Mac / Linux / WSL)
#
#   Double-click me, or in a terminal run:   bash apply-v1.0.18.sh
#
#   This file carries the whole v1.0.18 patch inside it. It will:
#     1. check you are inside the CGPA-pilot folder and main is up to date
#     2. refuse to run if you have OTHER uncommitted work (I never touch it)
#     3. apply the v1.0.18 patch, commit it, and push it to main
#
#   WHAT THIS FIXES (tool icons — the rule you asked for):
#     The admin-enlarged tool icon now genuinely increases in size AND width
#     ALONE, in place, with NO shift — while the tile row stays EXACTLY the
#     same size (it never widens). Every icon slot is a fixed-size box again;
#     the icon is centred on the slot and simply overflows it symmetrically.
#     Works in the mobile tool grid, the desktop sidebar, the privacy row and
#     the screen titles; the admin's Student Preview mirrors the same rule.
#
#   This update works whether or not you have already run apply-v1.0.17.sh
#   (they touch different files). It builds on v1.0.16.
# -----------------------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo " CGPA Pilot updater - v1.0.18"
echo " (tool icons grow in place - the tile row"
echo "  stays exactly the same, no shifting)"
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
# (old updater files v1.0.12-v1.0.18 are ignored - they are mine, not yours)
if [ -n "$(git status --porcelain | grep -v -e 'apply-v1.0.12.sh' -e 'fix-cgpa-v1.0.12.bat' -e 'v1.0.12.patch' -e '.v1012' -e 'apply-v1.0.13.sh' -e 'fix-cgpa-v1.0.13.bat' -e 'v1.0.13.patch' -e '.v1013' -e 'apply-v1.0.14.sh' -e 'fix-cgpa-v1.0.14.bat' -e 'v1.0.14.patch' -e '.v1014' -e 'apply-v1.0.15.sh' -e 'fix-cgpa-v1.0.15.bat' -e 'v1.0.15.patch' -e '.v1015' -e 'apply-v1.0.16.sh' -e 'v1.0.16.patch' -e '.v1016' -e 'apply-v1.0.17.sh' -e 'v1.0.17.patch' -e '.v1017' -e 'apply-v1.0.18.sh' -e 'v1.0.18.patch' -e '.v1018' | head -n 1)" ]; then
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
if grep -q 'FIXED-SLOT ICON GROWTH (v1.0.18)' src/App.tsx; then
  echo
  echo " v1.0.18 is already applied - nothing to do. You are up to date."
  exit 0
fi

# --- This update builds on v1.0.16 (the AI-error/publish/icon fixes) ---
if [ ! -f test/aiChatError.test.mjs ] || ! grep -q 'service-error' src/services/aiChat.ts; then
  echo
  echo ' This update builds on v1.0.16.'
  echo ' Please run apply-v1.0.16.sh first (it is in this folder),'
  echo ' then run me again.'
  exit 1
fi

echo
echo " Preparing the v1.0.18 patch (embedded in this file)..."
rm -f .v1018.b64 .v1018.patch
B64_DATA=
B64_DATA+="ZGlmZiAtLWdpdCBhL3NyYy9BcHAudHN4IGIvc3JjL0FwcC50c3gKaW5kZXggNzI3YjIzZS4uNDRmMGQ5ZSAxMDA2ND"
B64_DATA+="QKLS0tIGEvc3JjL0FwcC50c3gKKysrIGIvc3JjL0FwcC50c3gKQEAgLTUwOSwxMCArNTA5LDE2IEBAIGV4cG9ydCBk"
B64_DATA+="ZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IHByZXZpZXcgfTogeyBwcmV2aWV3PzogU3R1ZGVudFByZXZpZXdDb250cm9scy"
B64_DATA+="B9ID0KICAgICAgICAgICAgICAge2JhZGdlICYmICFkaXNhYmxlZCAmJiAoCiAgICAgICAgICAgICAgICAgPHNwYW4g"
B64_DATA+="Y2xhc3NOYW1lPSJhYnNvbHV0ZSAtcmlnaHQtMSAtdG9wLTEgaC0zIHctMyByb3VuZGVkLWZ1bGwgYmctYW1iZXItND"
B64_DATA+="AwIHJpbmctMiByaW5nLXdoaXRlIiBhcmlhLWhpZGRlbiAvPgogICAgICAgICAgICAgICApfQotICAgICAgICAgICAg"
B64_DATA+="ICB7LyogRml4ZWQtc2l6ZSwgaW52aXNpYmxlIHNsb3Q6IGFuIGFkbWluLWVubGFyZ2VkIGltYWdlCi0gICAgICAgIC"
B64_DATA+="AgICAgICAgICBvdmVyZmxvd3MgdGhpcyBib3gg4oCUIGl0IG5ldmVyIG1vdmVzIHRoZSB0aWxlLiAqL30KLSAgICAg"
B64_DATA+="ICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJncmlkIGgtOSB3LTkgc2hyaW5rLTAgcGxhY2UtaXRlbXMtY2VudGVyIH"
B64_DATA+="RleHQtMnhsIGxlYWRpbmctbm9uZSI+Ci0gICAgICAgICAgICAgICAgPFNsb3RHbHlwaCBhcHBlYXJhbmNlPXthcHBl"
B64_DATA+="YXJhbmNlfSBzbG90PXt0LmlkfSBmYWxsYmFjaz17dC5pY29ufSBpbWdDbHM9ImgtNyB3LTciIC8+CisgICAgICAgIC"
B64_DATA+="AgICAgIHsvKiBGSVhFRC1TTE9UIElDT04gR1JPV1RIICh2MS4wLjE4KTogdGhlIHNsb3QgaXMgQUxXQVlTIDM2IHB4"
B64_DATA+="LAorICAgICAgICAgICAgICAgICAgc28gdGhlIHRpbGUgYW5kIGl0cyByb3cgbmV2ZXIgY2hhbmdlIHNpemUuIFRoZS"
B64_DATA+="BpY29uIEFMT05FCisgICAgICAgICAgICAgICAgICBncm93cyDigJQgdGhlIGdseXBoIGlzIGFic29sdXRlbHkgY2Vu"
B64_DATA+="dHJlZCBvbiB0aGUgc2xvdCwgc28gYW4KKyAgICAgICAgICAgICAgICAgIGFkbWluLWVubGFyZ2VkIGljb24gb3Zlcm"
B64_DATA+="Zsb3dzIHRoZSBzbG90IHN5bW1ldHJpY2FsbHkgKGl0CisgICAgICAgICAgICAgICAgICB0cnVseSBpbmNyZWFzZXMg"
B64_DATA+="aW4gc2l6ZSBhbmQgd2lkdGgsIGluIHBsYWNlKSB3aXRob3V0IGV2ZXIKKyAgICAgICAgICAgICAgICAgIHNoaWZ0aW"
B64_DATA+="5nIHRoZSB0aWxlLCB0aGUgcm93IG9yIHRoZSBsYWJlbC4gKi99CisgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFt"
B64_DATA+="ZT0icmVsYXRpdmUgaC05IHctOSBzaHJpbmstMCB0ZXh0LTJ4bCBsZWFkaW5nLW5vbmUiPgorICAgICAgICAgICAgIC"
B64_DATA+="AgIDxzcGFuIGNsYXNzTmFtZT0iYWJzb2x1dGUgbGVmdC0xLzIgdG9wLTEvMiAtdHJhbnNsYXRlLXgtMS8yIC10cmFu"
B64_DATA+="c2xhdGUteS0xLzIiPgorICAgICAgICAgICAgICAgICAgPFNsb3RHbHlwaCBhcHBlYXJhbmNlPXthcHBlYXJhbmNlfS"
B64_DATA+="BzbG90PXt0LmlkfSBmYWxsYmFjaz17dC5pY29ufSBpbWdDbHM9ImgtNyB3LTciIC8+CisgICAgICAgICAgICAgICAg"
B64_DATA+="PC9zcGFuPgogICAgICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0ibWluLX"
B64_DATA+="ctMCBmbGV4LTEiPgogICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iYmxvY2sgdHJ1bmNhdGUgdGV4dC1b"
B64_DATA+="MTNweF0gZm9udC1leHRyYWJvbGQgbGVhZGluZy10aWdodCB0ZXh0LXNsYXRlLTkwMCI+CkBAIC01NDUsOCArNTUxLD"
B64_DATA+="ExIEBAIGV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IHByZXZpZXcgfTogeyBwcmV2aWV3PzogU3R1ZGVudFBy"
B64_DATA+="ZXZpZXdDb250cm9scyB9ID0KICAgICAgICAgb25DbGljaz17KCkgPT4gc2V0U2NyZWVuKCdwcml2YWN5Jyl9CiAgIC"
B64_DATA+="AgICAgIGNsYXNzTmFtZT0ibXQtMyBmbGV4IHctZnVsbCBpdGVtcy1jZW50ZXIgZ2FwLTIgcm91bmRlZC0yeGwgYmct"
B64_DATA+="ZW1lcmFsZC01MCBweC0zIHB5LTIgdGV4dC1sZWZ0IHJpbmctMSByaW5nLWVtZXJhbGQtMjAwIgogICAgICAgPgotIC"
B64_DATA+="AgICAgICA8c3BhbiBjbGFzc05hbWU9ImZsZXggaC01IHctNSBzaHJpbmstMCBpdGVtcy1jZW50ZXIganVzdGlmeS1j"
B64_DATA+="ZW50ZXIgdGV4dC1iYXNlIj4KLSAgICAgICAgICA8U2xvdEdseXBoIGFwcGVhcmFuY2U9e2FwcGVhcmFuY2V9IHNsb3"
B64_DATA+="Q9InByaXZhY3kiIGZhbGxiYWNrPSLwn5SSIiBpbWdDbHM9ImgtNSB3LTUgb2JqZWN0LWNvbnRhaW4iIC8+CisgICAg"
B64_DATA+="ICAgIHsvKiB2MS4wLjE4OiBmaXhlZCBzbG90IOKAlCB0aGUgaWNvbiBhbG9uZSBncm93cywgY2VudHJlZCBpbiBwbG"
B64_DATA+="FjZS4gKi99CisgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0icmVsYXRpdmUgaC01IHctNSBzaHJpbmstMCB0ZXh0LWJh"
B64_DATA+="c2UiPgorICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iYWJzb2x1dGUgbGVmdC0xLzIgdG9wLTEvMiAtdHJhbnNsYX"
B64_DATA+="RlLXgtMS8yIC10cmFuc2xhdGUteS0xLzIiPgorICAgICAgICAgICAgPFNsb3RHbHlwaCBhcHBlYXJhbmNlPXthcHBl"
B64_DATA+="YXJhbmNlfSBzbG90PSJwcml2YWN5IiBmYWxsYmFjaz0i8J+UkiIgaW1nQ2xzPSJoLTUgdy01IG9iamVjdC1jb250YW"
B64_DATA+="luIiAvPgorICAgICAgICAgIDwvc3Bhbj4KICAgICAgICAgPC9zcGFuPgogICAgICAgICA8c3BhbiBjbGFzc05hbWU9"
B64_DATA+="ImZsZXgtMSB0ZXh0LVsxMXB4XSBmb250LWJvbGQgdGV4dC1lbWVyYWxkLTgwMCI+CiAgICAgICAgICAgTm8gYWNjb3"
B64_DATA+="VudC4gTm90aGluZyB5b3UgdHlwZSBpcyBzYXZlZCBvciBzaGFyZWQg4oCUIHNlZSBob3cuCkBAIC02MDQsOSArNjEz"
B64_DATA+="LDEyIEBAIGV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IHByZXZpZXcgfTogeyBwcmV2aWV3PzogU3R1ZGVudF"
B64_DATA+="ByZXZpZXdDb250cm9scyB9ID0KICAgICAgICAgICAgICAgICAgICAgICAgIDogJ3RleHQtc2xhdGUtNzAwIGhvdmVy"
B64_DATA+="OmJnLXNsYXRlLTEwMCcKICAgICAgICAgICAgICAgICAgIH1gfQogICAgICAgICAgICAgICAgID4KLSAgICAgICAgIC"
B64_DATA+="AgICAgICAgIHsvKiBGaXhlZCBzbG90OiBhbiBhZG1pbi1lbmxhcmdlZCBpbWFnZSBvdmVyZmxvd3MsIHRoZSBuYXYg"
B64_DATA+="cm93IHN0YXlzICovfQotICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJncmlkIGgtOSB3LTkgc2hyaW"
B64_DATA+="5rLTAgcGxhY2UtaXRlbXMtY2VudGVyIHRleHQtMnhsIGxlYWRpbmctbm9uZSI+Ci0gICAgICAgICAgICAgICAgICAg"
B64_DATA+="IDxTbG90R2x5cGggYXBwZWFyYW5jZT17YXBwZWFyYW5jZX0gc2xvdD17dC5pZH0gZmFsbGJhY2s9e3QuaWNvbn0gaW"
B64_DATA+="1nQ2xzPSJoLTcgdy03IiAvPgorICAgICAgICAgICAgICAgICAgey8qIHYxLjAuMTg6IGZpeGVkIHNsb3Qg4oCUIHRo"
B64_DATA+="ZSByb3cgd2lkdGggbmV2ZXIgY2hhbmdlczsgdGhlCisgICAgICAgICAgICAgICAgICAgICAgaWNvbiBhbG9uZSBncm"
B64_DATA+="93cywgY2VudHJlZCBpbiBwbGFjZSAobm8gc2hpZnQpLiAqL30KKyAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNz"
B64_DATA+="TmFtZT0icmVsYXRpdmUgaC05IHctOSBzaHJpbmstMCB0ZXh0LTJ4bCBsZWFkaW5nLW5vbmUiPgorICAgICAgICAgIC"
B64_DATA+="AgICAgICAgICA8c3BhbiBjbGFzc05hbWU9ImFic29sdXRlIGxlZnQtMS8yIHRvcC0xLzIgLXRyYW5zbGF0ZS14LTEv"
B64_DATA+="MiAtdHJhbnNsYXRlLXktMS8yIj4KKyAgICAgICAgICAgICAgICAgICAgICA8U2xvdEdseXBoIGFwcGVhcmFuY2U9e2"
B64_DATA+="FwcGVhcmFuY2V9IHNsb3Q9e3QuaWR9IGZhbGxiYWNrPXt0Lmljb259IGltZ0Nscz0iaC03IHctNyIgLz4KKyAgICAg"
B64_DATA+="ICAgICAgICAgICAgICAgPC9zcGFuPgogICAgICAgICAgICAgICAgICAgPC9zcGFuPgogICAgICAgICAgICAgICAgIC"
B64_DATA+="AgPHNwYW4gY2xhc3NOYW1lPSJtaW4tdy0wIGZsZXgtMSI+CiAgICAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNz"
B64_DATA+="TmFtZT0iYmxvY2sgdHJ1bmNhdGUgdGV4dC1bMTNweF0gZm9udC1leHRyYWJvbGQgbGVhZGluZy10aWdodCI+CkBAIC"
B64_DATA+="02MzIsOCArNjQ0LDExIEBAIGV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEFwcCh7IHByZXZpZXcgfTogeyBwcmV2aWV3"
B64_DATA+="PzogU3R1ZGVudFByZXZpZXdDb250cm9scyB9ID0KICAgICAgICAgICAgICAgICAgIDogJ3RleHQtZW1lcmFsZC04MD"
B64_DATA+="AgaG92ZXI6YmctZW1lcmFsZC01MCcKICAgICAgICAgICAgICAgfWB9CiAgICAgICAgICAgICA+Ci0gICAgICAgICAg"
B64_DATA+="ICAgIDxzcGFuIGNsYXNzTmFtZT0iZ3JpZCBoLTkgdy05IHNocmluay0wIHBsYWNlLWl0ZW1zLWNlbnRlciB0ZXh0LX"
B64_DATA+="hsIGxlYWRpbmctbm9uZSI+Ci0gICAgICAgICAgICAgICAgPFNsb3RHbHlwaCBhcHBlYXJhbmNlPXthcHBlYXJhbmNl"
B64_DATA+="fSBzbG90PSJwcml2YWN5IiBmYWxsYmFjaz0i8J+UkiIgaW1nQ2xzPSJoLTYgdy02IiAvPgorICAgICAgICAgICAgIC"
B64_DATA+="B7LyogdjEuMC4xODogZml4ZWQgc2xvdCDigJQgdGhlIGljb24gYWxvbmUgZ3Jvd3MsIGNlbnRyZWQgaW4gcGxhY2Uu"
B64_DATA+="ICovfQorICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9InJlbGF0aXZlIGgtOSB3LTkgc2hyaW5rLTAgdGV4dC"
B64_DATA+="14bCBsZWFkaW5nLW5vbmUiPgorICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iYWJzb2x1dGUgbGVmdC0x"
B64_DATA+="LzIgdG9wLTEvMiAtdHJhbnNsYXRlLXgtMS8yIC10cmFuc2xhdGUteS0xLzIiPgorICAgICAgICAgICAgICAgICAgPF"
B64_DATA+="Nsb3RHbHlwaCBhcHBlYXJhbmNlPXthcHBlYXJhbmNlfSBzbG90PSJwcml2YWN5IiBmYWxsYmFjaz0i8J+UkiIgaW1n"
B64_DATA+="Q2xzPSJoLTYgdy02IiAvPgorICAgICAgICAgICAgICAgIDwvc3Bhbj4KICAgICAgICAgICAgICAgPC9zcGFuPgogIC"
B64_DATA+="AgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9Im1pbi13LTAgZmxleC0xIj4KICAgICAgICAgICAgICAgICA8c3Bh"
B64_DATA+="biBjbGFzc05hbWU9ImJsb2NrIHRydW5jYXRlIHRleHQtWzEzcHhdIGZvbnQtZXh0cmFib2xkIGxlYWRpbmctdGlnaH"
B64_DATA+="QiPlByaXZhY3k8L3NwYW4+CkBAIC02NzEsMTUgKzY4NiwxOSBAQCBleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBBcHAo"
B64_DATA+="eyBwcmV2aWV3IH06IHsgcHJldmlldz86IFN0dWRlbnRQcmV2aWV3Q29udHJvbHMgfSA9CiAgICAgICAgICAgICAgIC"
B64_DATA+="AgICA8PgogICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibm8tcHJpbnQgbWItNCBmbGV4IGl0ZW1z"
B64_DATA+="LWNlbnRlciBqdXN0aWZ5LWJldHdlZW4gZ2FwLTMiPgogICAgICAgICAgICAgICAgICAgICAgIDxoMSBjbGFzc05hbW"
B64_DATA+="U9ImZsZXggbWluLXctMCBpdGVtcy1jZW50ZXIgZ2FwLTIgdGV4dC14bCBmb250LWJsYWNrIHRyYWNraW5nLXRpZ2h0"
B64_DATA+="IHRleHQtc2xhdGUtOTAwIj4KLSAgICAgICAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iZ3JpZCBoLT"
B64_DATA+="cgdy03IHNocmluay0wIHBsYWNlLWl0ZW1zLWNlbnRlciB0ZXh0LWxnIGxlYWRpbmctbm9uZSI+Ci0gICAgICAgICAg"
B64_DATA+="ICAgICAgICAgICAgICAgIHtTQ1JFRU5fVElUTEVTW3NjcmVlbl0gJiYgKAotICAgICAgICAgICAgICAgICAgICAgIC"
B64_DATA+="AgICAgIDxTbG90R2x5cGgKLSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwcGVhcmFuY2U9e2FwcGVhcmFu"
B64_DATA+="Y2V9Ci0gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzbG90PXtzY3JlZW59Ci0gICAgICAgICAgICAgICAgIC"
B64_DATA+="AgICAgICAgICAgICBmYWxsYmFjaz17U0NSRUVOX1RJVExFU1tzY3JlZW5dIS5pY29ufQotICAgICAgICAgICAgICAg"
B64_DATA+="ICAgICAgICAgICAgICAgaW1nQ2xzPSJoLTUgdy01IG9iamVjdC1jb250YWluIgotICAgICAgICAgICAgICAgICAgIC"
B64_DATA+="AgICAgICAgIC8+Ci0gICAgICAgICAgICAgICAgICAgICAgICAgICl9CisgICAgICAgICAgICAgICAgICAgICAgICB7"
B64_DATA+="LyogdjEuMC4xODogZml4ZWQgc2xvdCDigJQgdGhlIHRpdGxlIG5ldmVyIG1vdmVzOyB0aGUKKyAgICAgICAgICAgIC"
B64_DATA+="AgICAgICAgICAgICAgICBpY29uIGFsb25lIGdyb3dzLCBjZW50cmVkIGluIHBsYWNlIChubyBzaGlmdCkuICovfQor"
B64_DATA+="ICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJyZWxhdGl2ZSBoLTcgdy03IHNocmluay0wIH"
B64_DATA+="RleHQtbGcgbGVhZGluZy1ub25lIj4KKyAgICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJh"
B64_DATA+="YnNvbHV0ZSBsZWZ0LTEvMiB0b3AtMS8yIC10cmFuc2xhdGUteC0xLzIgLXRyYW5zbGF0ZS15LTEvMiI+CisgICAgIC"
B64_DATA+="AgICAgICAgICAgICAgICAgICAgICAge1NDUkVFTl9USVRMRVNbc2NyZWVuXSAmJiAoCisgICAgICAgICAgICAgICAg"
B64_DATA+="ICAgICAgICAgICAgICA8U2xvdEdseXBoCisgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwcGVhcmFuY2"
B64_DATA+="U9e2FwcGVhcmFuY2V9CisgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNsb3Q9e3NjcmVlbn0KKyAgICAg"
B64_DATA+="ICAgICAgICAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s9e1NDUkVFTl9USVRMRVNbc2NyZWVuXSEuaWNvbn0KKy"
B64_DATA+="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW1nQ2xzPSJoLTUgdy01IG9iamVjdC1jb250YWluIgorICAg"
B64_DATA+="ICAgICAgICAgICAgICAgICAgICAgICAgICAgLz4KKyAgICAgICAgICAgICAgICAgICAgICAgICAgICApfQorICAgIC"
B64_DATA+="AgICAgICAgICAgICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICAgICAgICAgICAgICAgICA8L3NwYW4+CiAgICAg"
B64_DATA+="ICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9InRydW5jYXRlIj57c2NyZWVuVGl0bGV9PC9zcGFuPg"
B64_DATA+="ogICAgICAgICAgICAgICAgICAgICAgIDwvaDE+CmRpZmYgLS1naXQgYS9zcmMvYWRtaW4vdmlld3MvU3R1ZGVudFBy"
B64_DATA+="ZXZpZXcudHN4IGIvc3JjL2FkbWluL3ZpZXdzL1N0dWRlbnRQcmV2aWV3LnRzeAppbmRleCAxMmJmZTYwLi4xZjJhYW"
B64_DATA+="MyIDEwMDY0NAotLS0gYS9zcmMvYWRtaW4vdmlld3MvU3R1ZGVudFByZXZpZXcudHN4CisrKyBiL3NyYy9hZG1pbi92"
B64_DATA+="aWV3cy9TdHVkZW50UHJldmlldy50c3gKQEAgLTMyLDYgKzMyLDExIEBAIGNvbnN0IFRPT0xfTUVUQTogUmVjb3JkPH"
B64_DATA+="N0cmluZywgVG9vbE1ldGE+ID0gewogICBtaWxlc3RvbmVzOiB7IHRpdGxlOiAnTWlsZXN0b25lcycsIHRhZ2xpbmU6"
B64_DATA+="ICdTdGFnZS1ieS1zdGFnZSBjaGVja3BvaW50cycsIGVtb2ppOiAn8J+PgScsIG5lZWRzRGF0YTogdHJ1ZSB9LAogfT"
B64_DATA+="sKIGNvbnN0IFRPT0xfT1JERVIgPSBbJ2NhbGN1bGF0ZScsICd0YXJnZXQnLCAnbmV4dCcsICd3aGF0aWYnLCAnZmxp"
B64_DATA+="Z2h0JywgJ21pbGVzdG9uZXMnXTsKKworLy8gSWNvbiBzbG90cyBpbiB0aGUgcHJldmlldyBhcmUgRklYRUQtc2l6ZS"
B64_DATA+="Bib3hlcyB0aGF0IG1pcnJvciB0aGUgcmVhbCBhcHAKKy8vICh2MS4wLjE4KTogQXBwR2x5cGggcmVuZGVycyB0aGUg"
B64_DATA+="YWRtaW4tc2l6ZWQgaWNvbiBjZW50cmVkIGluIGl0cyBvd24KKy8vIGZpeGVkIGJveCwgc28gYW4gZW5sYXJnZWQgaW"
B64_DATA+="NvbiBhbG9uZSBpbmNyZWFzZXMgaW4gc2l6ZSBhbmQgd2lkdGggaW4KKy8vIHBsYWNlIOKAlCB0aGUgdGlsZXMsIHJv"
B64_DATA+="d3MgYW5kIGxhYmVscyBuZXZlciBjaGFuZ2Ugc2l6ZSBvciBwb3NpdGlvbi4KIC8vIFRoZSBwcmV2aWV3IGlzIEFMV0"
B64_DATA+="FZUyBmdWxsIHBob25lIHNpemUg4oCUIGEgZml4ZWQgMzkww5c4MDAgZGV2aWNlIGZyYW1lCiAvLyAoc3RhbmRhcmQg"
B64_DATA+="c21hcnRwaG9uZSksIHdpdGggdGhlIGpvdXJuZXkgY29udGVudCBzY3JvbGxpbmcgaW5zaWRlIGl0LCBhdAogLy8gZX"
B64_DATA+="Zlcnkgc3RhZ2UgKGdhbWUsIHNlbGVjdGlvbiwgbW9kZSwgaG9tZSwgdG9vbHMpLgpAQCAtNDQ0LDggKzQ0OSw5IEBA"
B64_DATA+="IGZ1bmN0aW9uIEhvbWVTY3JlZW4ocHJvcHM6IHsKICAgICAgICAgICAgICAgICAgICAgZGlzYWJsZWQgPyAnYmctc2"
B64_DATA+="xhdGUtMTAwIG9wYWNpdHktNzAgcmluZy1zbGF0ZS0yMDAnIDogJ2JnLXdoaXRlIHNoYWRvdy1zbSByaW5nLXNsYXRl"
B64_DATA+="LTIwMCBhY3RpdmU6c2NhbGUtWzAuOTldJwogICAgICAgICAgICAgICAgICAgfWB9CiAgICAgICAgICAgICAgICAgPg"
B64_DATA+="otICAgICAgICAgICAgICAgICAgey8qIE1pcnJvcnMgdGhlIHJlYWwgdGlsZTogZml4ZWQtc2l6ZSBzbG90LCBhbiBh"
B64_DATA+="ZG1pbi1lbmxhcmdlZAotICAgICAgICAgICAgICAgICAgICAgIGltYWdlIG92ZXJmbG93cyBpdCB3aXRob3V0IG1vdm"
B64_DATA+="luZyB0aGUgdGlsZS4gKi99CisgICAgICAgICAgICAgICAgICB7LyogTWlycm9ycyB0aGUgcmVhbCB0aWxlICh2MS4w"
B64_DATA+="LjE4KTogRklYRUQgMzYgcHggc2xvdCDigJQgdGhlCisgICAgICAgICAgICAgICAgICAgICAgaWNvbiBhbG9uZSBncm"
B64_DATA+="93cyAoY2VudHJlZCBpbiBwbGFjZSksIHRoZSByb3cgbmV2ZXIKKyAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2Vz"
B64_DATA+="IHNpemUgb3IgcG9zaXRpb24uICovfQogICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJncmlkIGgtOS"
B64_DATA+="B3LTkgc2hyaW5rLTAgcGxhY2UtaXRlbXMtY2VudGVyIHRleHQtMnhsIGxlYWRpbmctbm9uZSI+CiAgICAgICAgICAg"
B64_DATA+="ICAgICAgICAgIDxBcHBHbHlwaCBhcHBlYXJhbmNlPXthcHBlYXJhbmNlfSBzbG90PXtpZH0gZmFsbGJhY2s9e20uZW"
B64_DATA+="1vaml9IHNpemU9ezI0fSAvPgogICAgICAgICAgICAgICAgICAgPC9zcGFuPgpAQCAtNTE5LDExICs1MjUsMTIgQEAg"
B64_DATA+="ZnVuY3Rpb24gVG9vbEZyYW1lKHsKICAgICAgICAgPgogICAgICAgICAgIOKGkAogICAgICAgICA8L2J1dHRvbj4KLS"
B64_DATA+="AgICAgICAgPGgxIGNsYXNzTmFtZT0iZmxleCBtaW4tdy0wIGZsZXgtMSBpdGVtcy1jZW50ZXIgZ2FwLTEuNSB0cnVu"
B64_DATA+="Y2F0ZSB0ZXh0LXNtIGZvbnQtZXh0cmFib2xkIHRleHQtc2xhdGUtOTAwIj4KKyAgICAgICAgPGgxIGNsYXNzTmFtZT"
B64_DATA+="0iZmxleCBtaW4tdy0wIGZsZXgtMSBpdGVtcy1jZW50ZXIgZ2FwLTEuNSB0ZXh0LXNtIGZvbnQtZXh0cmFib2xkIHRl"
B64_DATA+="eHQtc2xhdGUtOTAwIj4KKyAgICAgICAgICB7LyogdjEuMC4xODogZml4ZWQgc2xvdCDigJQgdGhlIGljb24gYWxvbm"
B64_DATA+="UgZ3Jvd3MsIGNlbnRyZWQgaW4gcGxhY2UuICovfQogICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT0iZ3JpZCBoLTUg"
B64_DATA+="dy01IHNocmluay0wIHBsYWNlLWl0ZW1zLWNlbnRlciI+CiAgICAgICAgICAgICA8QXBwR2x5cGggYXBwZWFyYW5jZT"
B64_DATA+="17YXBwZWFyYW5jZX0gc2xvdD17dG9vbH0gZmFsbGJhY2s9e20uZW1vaml9IHNpemU9ezE4fSAvPgogICAgICAgICAg"
B64_DATA+="IDwvc3Bhbj4KLSAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9InRydW5jYXRlIj57bS50aXRsZX08L3NwYW4+CisgIC"
B64_DATA+="AgICAgICAgPHNwYW4gY2xhc3NOYW1lPSJtaW4tdy0wIHRydW5jYXRlIj57bS50aXRsZX08L3NwYW4+CiAgICAgICAg"
B64_DATA+="IDwvaDE+CiAgICAgICAgIDxkaXYgY2xhc3NOYW1lPSJmbGV4IHNocmluay0wIGl0ZW1zLWNlbnRlciBnYXAtMS41Ij"
B64_DATA+="4KICAgICAgICAgICA8UGlsbCBsYWJlbD0i8J+UgSIgdGl0bGU9IlJlZnJlc2ggKG9uIHRoZSByZWFsIGFwcCkiIC8+"
B64_DATA+="CkBAIC01MzYsNyArNTQzLDcgQEAgZnVuY3Rpb24gVG9vbEZyYW1lKHsKICAgICAgICAgPGRpdiBjbGFzc05hbWU9Im"
B64_DATA+="14LWF1dG8gdy1mdWxsIG1heC13LW1kIj4KICAgICAgICAgICB7bS5uZWVkc0RhdGEgPyAoCiAgICAgICAgICAgICA8"
B64_DATA+="ZGl2IGNsYXNzTmFtZT0icm91bmRlZC0yeGwgYmctd2hpdGUgcC02IHRleHQtY2VudGVyIHJpbmctMSByaW5nLXNsYX"
B64_DATA+="RlLTIwMCI+Ci0gICAgICAgICAgICAgIHsvKiBGaXhlZCBzbG90OiBhbiBhZG1pbi1lbmxhcmdlZCBpY29uIG92ZXJm"
B64_DATA+="bG93cyB0aGUgY2FyZCdzIHJoeXRobSAqL30KKyAgICAgICAgICAgICAgey8qIHYxLjAuMTg6IGZpeGVkIHNsb3Qg4o"
B64_DATA+="CUIHRoZSBpY29uIGFsb25lIGdyb3dzLCBjZW50cmVkIGluIHBsYWNlLiAqL30KICAgICAgICAgICAgICAgPHNwYW4g"
B64_DATA+="Y2xhc3NOYW1lPSJteC1hdXRvIGdyaWQgaC0xMCB3LTEwIHBsYWNlLWl0ZW1zLWNlbnRlciI+CiAgICAgICAgICAgIC"
B64_DATA+="AgICAgPEFwcEdseXBoIGFwcGVhcmFuY2U9e2FwcGVhcmFuY2V9IHNsb3Q9e3Rvb2x9IGZhbGxiYWNrPXttLmVtb2pp"
B64_DATA+="fSBzaXplPXs0MH0gLz4KICAgICAgICAgICAgICAgPC9zcGFuPgo="

printf '%s' "$B64_DATA" > .v1018.b64
if command -v base64 >/dev/null 2>&1; then
  base64 -d .v1018.b64 > .v1018.patch 2>/dev/null || base64 -Di .v1018.patch .v1018.b64
else
  echo " ERROR: base64 is not available."; exit 1
fi

git apply --check .v1018.patch || {
  echo
  echo " ERROR: the patch does not match your current main branch."
  echo " (It expects v1.0.16, with or without v1.0.17 applied.)"
  echo " Make sure you pulled first, then run me again."
  exit 1
}
git apply .v1018.patch || {
  echo
  echo " ERROR: applying the patch failed."
  echo " To undo the partial change run:  git checkout -- ."
  exit 1
}

# --- Bump the version to 1.0.18 (works from 1.0.16 OR 1.0.17) ---
sed -i.bak -e 's/"version": "1.0.16"/"version": "1.0.18"/' -e 's/"version": "1.0.17"/"version": "1.0.18"/' package.json && rm -f package.json.bak

echo " Committing and pushing..."
git add package.json src/App.tsx src/admin/views/StudentPreview.tsx
git commit -m "v1.0.18: tool icons grow in place WITHOUT changing the tile row - every icon slot is a fixed-size box and the icon is centred on it, so an admin-enlarged icon alone increases in size and width in place (no shift), while the tile, its row and the labels keep their exact size; Student Preview mirrors the same fixed slots" || {
  git reset -q 2>/dev/null
  git checkout -q -- . 2>/dev/null
  rm -f .v1018.b64 .v1018.patch
  echo
  echo " ERROR: the commit failed. I undid the v1.0.18 changes so you can try again."
  exit 1
}
git push origin main || {
  echo
  echo " PUSH FAILED - but the code IS committed locally on main."
  echo " Fix the connection, then run:  git push origin main"
  exit 1
}

rm -f .v1018.b64 .v1018.patch
echo
echo ============================================
echo " DONE - v1.0.18 is committed and pushed to main."
echo
echo " What changed (tool icons, exactly as you asked):"
echo "  - The admin-enlarged tool icon now GENUINELY increases in size"
echo "    AND width - alone, in place, with NO shift or movement."
echo "  - The tile row stays EXACTLY the same: every icon slot is a"
echo "    fixed-size box (it never widens), and the icon is centred on"
echo "    the slot, overflowing it symmetrically when it is bigger."
echo "  - Covers: the mobile tool grid, the desktop sidebar, the privacy"
echo "    row and the screen titles - and the admin's Student Preview"
echo "    shows exactly the same behaviour."
echo
echo " (If you have not run apply-v1.0.17.sh yet, run it any time -"
echo "  the two updates do not interfere with each other.)"
echo
echo " The student site + admin update on the next normal load."
echo ============================================