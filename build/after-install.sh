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

# ── 2. Chromium's SUID sandbox helper — always root:root 4755 ─────────────
# A helper that exists with the WRONG owner or mode is a hard abort, not a
# warning:
#   FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was found,
#   but is not configured correctly. Rather than run without sandboxing I'm
#   aborting now. You need to make sure that /opt/CGPA-Pilot/chrome-sandbox is
#   owned by root and has mode 4755.
# Do NOT try to be clever by probing `unshare --user` here and keeping the
# helper at 0755 when user namespaces "work" (v1.0.25 did, and that is the abort
# above): this script runs as ROOT, and root can always create a user
# namespace, so the probe succeeds on exactly the systems where *unprivileged*
# userns is disabled (Debian kernel.unprivileged_userns_clone=0) or AppArmor-
# restricted (Ubuntu 24.04+) — the kernel the app then runs on as a normal user.
# A correctly setuid helper costs nothing where userns do work: Chromium only
# execs it when it needs it, and both paths stay sandboxed. dpkg also does not
# reliably preserve the setuid bit on unpack, so set it explicitly.
if [ -f "$SANDBOX_HELPER" ]; then
  chown root:root "$SANDBOX_HELPER" 2>/dev/null || true
  chmod 4755 "$SANDBOX_HELPER" 2>/dev/null || true
  # If it still is not right (read-only /opt, noexec mount, unusual policy),
  # say so loudly — a dpkg warning beats an unexplained "Trace/breakpoint trap".
  HELPER_STATE=$(stat -c '%a %U' "$SANDBOX_HELPER" 2>/dev/null || echo unknown)
  if [ "$HELPER_STATE" != "4755 root" ]; then
    echo "WARNING: $SANDBOX_HELPER is '$HELPER_STATE', expected '4755 root'." >&2
    echo "WARNING: if CGPA Pilot aborts with the SUID-sandbox message, run:" >&2
    echo "WARNING:   sudo chown root:root '$SANDBOX_HELPER' && sudo chmod 4755 '$SANDBOX_HELPER'" >&2
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

# Decide the sandbox mode ONCE, before exec — never "run it, and if it fails run
# it again with --no-sandbox" (that turns a crash into a mystery and hides the
# exit code). Chromium aborts when it has neither unprivileged user namespaces
# nor a usable setuid helper; a correctly installed package always has the
# helper at 4755 root, so this branch is only the safety net for a read-only or
# hand-copied install.
SANDBOX_OK=1
HELPER_STATE=$(stat -c '%a %U' "$HELPER" 2>/dev/null || echo missing)
[ "$HELPER_STATE" = "4755 root" ] || SANDBOX_OK=0
if [ "$SANDBOX_OK" = 0 ]; then
  # This probe runs as the *user* (unlike the post-install hook, which runs as
  # root, where it would always succeed and tell nothing).
  if [ -L /proc/self/ns/user ] && command -v unshare >/dev/null 2>&1; then
    timeout 5 unshare --user true 2>/dev/null && SANDBOX_OK=1
  fi
fi
if [ "$SANDBOX_OK" = 0 ]; then
  echo "CGPA Pilot: the Chromium sandbox is unavailable on this system" >&2
  echo "  (chrome-sandbox is '$HELPER_STATE' and unprivileged user namespaces" >&2
  echo "   cannot be created). Starting unsandboxed; to restore it, run:" >&2
  echo "  sudo chown root:root '$HELPER' && sudo chmod 4755 '$HELPER'" >&2
  exec "$REAL" --no-sandbox "$@"
fi
exec "$REAL" "$@"
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
