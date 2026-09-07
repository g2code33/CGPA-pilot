#!/bin/bash
# Runs after `dpkg -i cgpa-pilot_*.deb`.
set -e

INSTALL_DIR="/opt/CGPA Pilot"
REAL_BIN="$INSTALL_DIR/cgpa-pilot"
LAUNCHER="/usr/bin/cgpa-pilot"

# Electron's SUID sandbox helper must be root-owned with mode 4755 or the
# app refuses to launch ("chrome-sandbox is owned by root and has mode 4755").
# Some systems unpack the .deb without preserving the setuid bit, so enforce
# it here (postinst runs as root).
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
  chown root:root "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
  chmod 4755 "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
fi

# Install a real `cgpa-pilot` command on PATH. The packaged executable lives
# under /opt/CGPA Pilot (a path with a space), which is not on the user's PATH
# and cannot be typed from the terminal. This launcher also retries with
# `--no-sandbox` if the first launch exits immediately (common on Ubuntu 24+
# where the Electron setuid sandbox is blocked by AppArmor/user namespaces),
# so the app opens reliably from both the menu and the terminal.
if [ -x "$REAL_BIN" ]; then
  cat > "$LAUNCHER" <<'LAUNCH'
#!/usr/bin/env bash
REAL="/opt/CGPA Pilot/cgpa-pilot"
if [ ! -x "$REAL" ]; then
  echo "CGPA Pilot is not installed correctly. Reinstall the .deb." >&2
  exit 1
fi
# Try the normal launch first. If the app exits immediately (non-zero),
# retry once with Chromium sandbox disabled for this launch — this covers
# kernels/distros that block the setuid chrome-sandbox helper.
if "$REAL" "$@"; then
  exit 0
fi
exec "$REAL" --no-sandbox "$@"
LAUNCH
  chown root:root "$LAUNCHER" 2>/dev/null || true
  chmod 0755 "$LAUNCHER"
fi

# Point the desktop launcher at the PATH command instead of the spaced
# /opt path. This also keeps the menu entry working after a shell refresh.
DESKTOP=""
# electron-builder names it `<package-name>.desktop` (e.g. cgpa-pilot.desktop),
# so match that first, then fall back to the app identity fields.
for f in /usr/share/applications/cgpa-pilot.desktop /usr/share/applications/cgpa_pilot.desktop /usr/share/applications/CGPA-*.desktop /usr/share/applications/*.desktop; do
  [ -f "$f" ] || continue
  if grep -q "StartupWMClass=CGPA Pilot" "$f" 2>/dev/null || grep -q "Exec=.*CGPA Pilot.*cgpa-pilot" "$f" 2>/dev/null || grep -q "Name=CGPA Pilot" "$f" 2>/dev/null; then
    DESKTOP="$f"
    break
  fi
done
if [ -n "$DESKTOP" ]; then
  sed -i 's|^Exec=.*|Exec=/usr/bin/cgpa-pilot %U|' "$DESKTOP" 2>/dev/null || true
fi

# Refresh the desktop menu/database.
update-desktop-database -q /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
exit 0
