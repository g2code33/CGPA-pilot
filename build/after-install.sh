#!/bin/bash
# Runs after `dpkg -i cgpa-pilot_*.deb`.
set -e

INSTALL_DIR="/opt/CGPA Pilot"

# Electron's SUID sandbox helper must be root-owned with mode 4755 or the
# app refuses to launch ("chrome-sandbox is owned by root and has mode 4755").
# Some systems unpack the .deb without preserving the setuid bit, so enforce
# it here (postinst runs as root).
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
  chown root:root "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
  chmod 4755 "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
fi

# Refresh the desktop menu/database.
update-desktop-database -q /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
exit 0
