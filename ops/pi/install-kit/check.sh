#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4311}"
echo "Checking ${BASE_URL}…"
curl --fail --silent --show-error "${BASE_URL}/api/health"
echo
curl --fail --silent --show-error --output /dev/null "${BASE_URL}/catalog.json"
echo "Catalogue endpoint: OK"
