#!/bin/bash
# Runs after `apt remove cgpa-pilot`. Everything this package creates outside
# the install directory is cleaned up here, so no half-broken launcher or
# stale menu entry survives an uninstall (or an upgrade that replaces it).
set -e

rm -f /usr/bin/${executable} 2>/dev/null || true
# Pre-1.0.25 builds installed under a path containing a space; drop the
# directory if a removal of an older package version left it behind.
rmdir "/opt/CGPA Pilot" 2>/dev/null || true

if [ -d /usr/share/icons/hicolor ]; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi
update-desktop-database -q /usr/share/applications 2>/dev/null || true
exit 0
