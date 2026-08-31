#!/bin/bash
# Runs after `dpkg -i cgpa-pilot_*.deb` — refresh the desktop menu/database.
set -e
update-desktop-database -q /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
exit 0
