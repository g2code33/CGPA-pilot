#!/bin/bash
# Runs after `apt remove cgpa-pilot`. Removes the PATH launcher we install in
# after-install so no stale `cgpa-pilot` command survives uninstall.
set -e

rm -f /usr/bin/cgpa-pilot 2>/dev/null || true
update-desktop-database -q /usr/share/applications 2>/dev/null || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
exit 0
