#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this once with sudo: sudo ./publish-tailscale.sh" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed on this Pi." >&2
  exit 1
fi

if ! curl --silent --fail --max-time 2 http://127.0.0.1:4311/api/health >/dev/null; then
  echo "The Reading Room service is not healthy. Run: sudo systemctl status reading-room" >&2
  exit 1
fi

echo "Current Tailscale Serve configuration:"
tailscale serve status || true
echo
echo "Publishing The Reading Room to this private tailnet over HTTPS…"
tailscale serve --bg 4311
echo
tailscale serve status
echo
echo "Open the HTTPS address shown above on the iPhone while Tailscale is connected."
