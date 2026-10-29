#!/usr/bin/env bash
# Self-updater for a fleet box. Run by fleet-update.timer (every 10 minutes and once after boot), as root:
#   - fetches the branch the box was installed from (main unless /etc/fleet/update.conf says otherwise);
#   - if the installed commit differs: resets /opt/fleet to it, runs `npm ci` only when package.json or
#     package-lock.json changed (flash drives, slow boxes), and restarts every running fleet-worker@ unit;
#   - records the installed commit in /opt/fleet/.fleet-installed so a failed `npm ci` is retried on the
#     next tick instead of being forgotten.
# Force a run:   sudo systemctl start fleet-update        Watch:  journalctl -u fleet-update
# Pause:         FLEET_AUTO_UPDATE=0 in /etc/fleet/update.conf (or `systemctl disable --now fleet-update.timer`)
#
# Everything lives in main() so bash has parsed the whole file before `git reset` rewrites it under us.
set -euo pipefail

main() {
  local root="${FLEET_ROOT:-/opt/fleet}"
  local conf="${FLEET_UPDATE_CONF:-/etc/fleet/update.conf}"
  local systemctl_bin="${FLEET_SYSTEMCTL:-systemctl}"
  local npm_bin="${FLEET_NPM:-npm}"
  local branch="${FLEET_BRANCH:-main}"
  # shellcheck disable=SC1090
  if [ -f "$conf" ]; then . "$conf"; branch="${FLEET_BRANCH:-$branch}"; fi
  if [ "${FLEET_AUTO_UPDATE:-1}" = "0" ]; then
    echo "auto-update paused (FLEET_AUTO_UPDATE=0 in $conf)"
    return 0
  fi
  local marker="$root/.fleet-installed"

  cd "$root"
  git fetch -q --depth 1 origin "$branch"
  local target installed
  target=$(git rev-parse "origin/$branch")
  installed=$(cat "$marker" 2>/dev/null || true)
  if [ "$target" = "$installed" ]; then
    echo "up to date at ${target:0:7} ($branch)"
    return 0
  fi

  # Dependencies only change when the manifest or lockfile does; everything else is a plain checkout.
  local deps_changed=1
  if [ -n "$installed" ] && git cat-file -e "$installed^{commit}" 2>/dev/null \
     && git diff --quiet "$installed" "$target" -- package.json package-lock.json; then
    deps_changed=0
  fi

  echo "updating ${installed:+${installed:0:7} }${installed:-nothing }-> ${target:0:7} ($branch)"
  git reset -q --hard "$target"
  if [ "$deps_changed" = 1 ]; then
    echo "package.json / package-lock.json changed: npm ci"
    "$npm_bin" ci --omit=dev --no-audit --no-fund --loglevel=error
    "$npm_bin" cache clean --force >/dev/null 2>&1 || true
  fi
  # The worker only reads the code (ReadOnlyPaths in the unit); it never needs to own it.
  chmod -R a+rX "$root"
  echo "$target" > "$marker"

  # Restart whatever worker instances are running (fleet-worker@all, or one per role).
  local units
  units=$("$systemctl_bin" list-units --plain --no-legend --type=service 'fleet-worker@*' | awk '{print $1}' | tr '\n' ' ')
  units="${units% }"
  if [ -n "$units" ]; then
    # shellcheck disable=SC2086
    "$systemctl_bin" restart $units
    echo "restarted: $units"
  else
    echo "no running fleet-worker units to restart"
  fi
  echo "now at ${target:0:7}"
}

main "$@"
