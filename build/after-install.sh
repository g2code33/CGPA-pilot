#!/bin/bash
# Runs as root after `dpkg -i cgpa-pilot_*.deb`.
#
# NOTE: electron-builder runs this file through its macro renderer (the same
# one used for its own after-install template) and replaces every dollar-brace
# identifier with the matching build option — executable, sanitizedProductName,
# productFilename. Anything else in that syntax aborts the build with
# "Macro X is not defined", so shell variables here are written without braces.
set -e

APP="${executable}"                              # cgpa-pilot
INSTALL_DIR="/opt/${sanitizedProductName}"       # /opt/CGPA-Pilot  (never a space — see docs/DESKTOP-LINUX.md)
LAUNCHER="/usr/bin/$APP"
REAL_BIN="$INSTALL_DIR/$APP"
SANDBOX_HELPER="$INSTALL_DIR/chrome-sandbox"

# ── 1. Retire the pre-1.0.25 install ──────────────────────────────────────
# v1.0.24 and older installed under "/opt/CGPA Pilot" (productName contained a
# space). Chromium re-execs that path through a whitespace-split command line,
# so the zygote received "/opt/CGPA" and the app died with
#   FATAL:zygote_host_impl_linux.cc(207)] Check failed: . : Invalid argument (22)
# before a window was ever created. The package manager already removes the
# files it owns; this also clears the leftovers it could not.
if [ -d "/opt/CGPA Pilot" ]; then
  rm -rf "/opt/CGPA Pilot" 2>/dev/null || true
fi

# A hand-written wrapper from v1.0.24 may also still be on PATH; section 3
# replaces it (a stale one would point at the deleted /opt/CGPA Pilot).

# ── 2. Chromium's SUID sandbox helper ─────────────────────────────────────
# Unprivileged user namespaces work → the helper must NOT be setuid (0755).
# They don't (hardened kernels, AppArmor-restricted Ubuntu 24.04+) → the helper
# must be root:root mode 4755 or Electron refuses to start. dpkg does not always
# preserve the setuid bit, so set it here.
USERNS_OK=1
if ! { [ -L /proc/self/ns/user ] && unshare --user true; } 2>/dev/null; then
  USERNS_OK=0
fi
if [ -f "$SANDBOX_HELPER" ]; then
  if [ "$USERNS_OK" = 1 ]; then
    chmod 0755 "$SANDBOX_HELPER" 2>/dev/null || true
  else
    chown root:root "$SANDBOX_HELPER" 2>/dev/null || true
    chmod 4755 "$SANDBOX_HELPER" 2>/dev/null || true
  fi
fi

# ── 3. `cgpa-pilot` on PATH ────────────────────────────────────────────────
# A tiny wrapper (rather than a bare symlink) for two reasons: the packaged
# binary lives under /opt and is not on PATH, and a terminal user gets the real
# error instead of "command not found". It never relaunches the app behind the
# user's back — `exec` replaces the shell, so one command = one process.
if [ -x "$REAL_BIN" ]; then
  # Replace whatever is there (a stale symlink from an older build would be
  # written *through* otherwise).
  rm -f "$LAUNCHER" 2>/dev/null || true
  cat > "$LAUNCHER" <<'LAUNCH'
#!/bin/sh
# CGPA Pilot launcher, written by the .deb's post-install hook.
REAL="/opt/${sanitizedProductName}/${executable}"
HELPER="/opt/${sanitizedProductName}/chrome-sandbox"
[ -x "$REAL" ] || { echo "CGPA Pilot is not installed correctly — reinstall the .deb." >&2; exit 1; }
# Only fall back to an unsandboxed renderer when this system offers neither
# user namespaces nor a working setuid helper; otherwise Electron exits with a
# "SUID sandbox helper" error and the app just looks dead.
EXTRA=""
if [ -f "$HELPER" ] && ! { [ -L /proc/self/ns/user ] && unshare --user true; } 2>/dev/null; then
  MODE=$(stat -c '%a %U' "$HELPER" 2>/dev/null || echo "0 root")
  [ "$MODE" = "4755 root" ] || EXTRA="--no-sandbox"
fi
exec "$REAL" $EXTRA "$@"
LAUNCH
  chown root:root "$LAUNCHER" 2>/dev/null || true
  chmod 0755 "$LAUNCHER"
fi

# ── 4. Desktop database + icon caches ─────────────────────────────────────
# The hicolor theme only serves the sizes listed in its index.theme, which is
# why the package now ships one PNG per size (build/icons/*.png) instead of a
# single 1024px file. Rebuilding the caches makes the logo appear without a
# logout.
if [ -d /usr/share/icons/hicolor ]; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime 2>/dev/null || true
fi
exit 0
