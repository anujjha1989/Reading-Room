#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo: sudo ./install.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${SOURCE_DIR}/app/standalone-server.mjs" || ! -f "${SOURCE_DIR}/app/site/catalog.json" ]]; then
  echo "The package is incomplete. Keep install.sh beside the app and systemd folders." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Installing the required Raspberry Pi OS packages…"
  apt-get update
  apt-get install -y nodejs ca-certificates curl
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 18 )); then
  echo "Node.js 18 or newer is required; this Pi has $(node --version)." >&2
  echo "Upgrade Node.js, then run this installer again." >&2
  exit 1
fi

if ! id reading-room >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/reading-room --shell /usr/sbin/nologin reading-room
fi

install -d -m 0755 /opt/reading-room/releases
install -d -o reading-room -g reading-room -m 0700 /var/lib/reading-room

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="/opt/reading-room/releases/${RELEASE_ID}"
install -d -m 0755 "${RELEASE_DIR}"
cp -a "${SOURCE_DIR}/app/." "${RELEASE_DIR}/"
chown -R root:root "${RELEASE_DIR}"
find "${RELEASE_DIR}" -type d -exec chmod 0755 {} +
find "${RELEASE_DIR}" -type f -exec chmod 0644 {} +
ln -sfnT "${RELEASE_DIR}" /opt/reading-room/current

install -m 0644 "${SOURCE_DIR}/systemd/reading-room.service" /etc/systemd/system/reading-room.service
systemctl daemon-reload
systemctl enable --now reading-room.service

for _ in {1..30}; do
  if curl --silent --fail --max-time 2 http://127.0.0.1:4311/api/health >/dev/null; then
    echo
    echo "The Reading Room is installed and running."
    echo "Next: sudo ${SOURCE_DIR}/publish-tailscale.sh"
    exit 0
  fi
  sleep 0.25
done

echo "The service did not become healthy. Recent log messages:" >&2
journalctl -u reading-room.service -n 30 --no-pager >&2
exit 1
