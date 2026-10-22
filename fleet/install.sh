#!/usr/bin/env bash
# One-box installer / updater for the fleet worker on headless Debian 12 (also Ubuntu 22.04+).
#
#   curl -fsSL https://raw.githubusercontent.com/notrelaxedd/emmetts-property-services/main/fleet/install.sh | sudo bash
#
# Re-running it updates the code and restarts the service. Idempotent.
#   - installs git, curl and Node 22 (NodeSource) if missing or older (supabase-js needs native WebSocket)
#   - creates the `fleet` system user, clones/updates /opt/fleet (branch: main)
#   - installs the systemd unit; /etc/fleet/all.env holds FLEET_ROLE=all + the keys
#   - caps journald at 50 MB (small flash drives), no local logs or DB
set -euo pipefail

REPO="${FLEET_REPO:-https://github.com/notrelaxedd/emmetts-property-services.git}"
BRANCH="${FLEET_BRANCH:-main}"
ROLE="${FLEET_ROLE:-all}"
ROOT=/opt/fleet
ENV_DIR=/etc/fleet
ENV_FILE="$ENV_DIR/$ROLE.env"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> user + checkout"
id fleet >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin fleet
if [ -d "$ROOT/.git" ]; then
  git -C "$ROOT" fetch -q origin "$BRANCH"
  git -C "$ROOT" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" --depth 1 "$REPO" "$ROOT"
fi
echo "    $(git -C "$ROOT" rev-parse --short HEAD) ($BRANCH)"

echo "==> dependencies (production only; tsx is a runtime dependency)"
cd "$ROOT"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
npm cache clean --force >/dev/null 2>&1 || true
chown -R fleet:fleet "$ROOT"

echo "==> environment file"
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  sed -e "s/^FLEET_ROLE=.*/FLEET_ROLE=$ROLE/" "$ROOT/fleet/env.example" > "$ENV_FILE"
  chmod 0640 "$ENV_FILE"; chown root:fleet "$ENV_FILE"
  NEW_ENV=1
else
  NEW_ENV=0
fi

echo "==> systemd"
install -m 0644 "$ROOT/fleet/systemd/fleet-worker@.service" /etc/systemd/system/fleet-worker@.service
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=50M\nRuntimeMaxUse=20M\n' > /etc/systemd/journald.conf.d/fleet.conf
systemctl restart systemd-journald
systemctl daemon-reload

if [ "$NEW_ENV" -eq 1 ]; then
  cat <<MSG

Almost there. Fill in the keys, then start the service:

  sudo nano $ENV_FILE        # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, ANTHROPIC_API_KEY (+ Stripe/email if used)
  sudo systemctl enable --now fleet-worker@$ROLE
  journalctl -fu fleet-worker@$ROLE   # watch it start; the Fleet page in /admin shows green rows

MSG
else
  systemctl enable -q fleet-worker@"$ROLE"
  systemctl restart fleet-worker@"$ROLE"
  sleep 2
  systemctl --no-pager --lines=5 status fleet-worker@"$ROLE" || true
  echo
  echo "Updated and restarted. Logs: journalctl -fu fleet-worker@$ROLE"
fi
