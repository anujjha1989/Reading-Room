#!/bin/bash
# Reading Room - re-apply catalogue enrichment after a scan.
#
# WHY THIS EXISTS: a full scan rebuilds catalog.json from an EMPTY catalogue so
# that deleted books drop out (see rr-catalog-rebuild.sh). That means every
# improvement made after a scan - embedded titles and authors, folder-derived
# authors, comic and prose series - is wiped by the next scan. The fix is not
# to hand-edit the catalogue but to make the enrichment repeatable and run it
# whenever the catalogue is newer than the last enrichment.
#
# Each step reads the live catalogue and writes catalog.next.json; the
# privileged installer validates and swaps it in. Order matters: embedded
# metadata first (most authoritative), then the filename and folder
# heuristics, then series grouping, which depends on the titles above it.
set -euo pipefail

CAT=/opt/reading-room/current/site/catalog.json
STAMP=/home/anujjha1989/.reading-room/last-enrich
LOG=/home/anujjha1989/.reading-room/enrich.log
LIB=/home/anujjha1989/rr-tools

exec 9>/home/anujjha1989/.reading-room/enrich.lock
flock -n 9 || { echo "already running"; exit 0; }

if [ "${1:-}" != "--force" ] && [ -f "$STAMP" ] && [ "$STAMP" -nt "$CAT" ]; then
  exit 0                     # catalogue unchanged since the last enrichment
fi

{
  echo "=== enrich $(date -Is) ==="
  for step in swapfix.py merge.py authors.py series.py prose_series.py; do
    echo "--- $step"
    case "$step" in
      merge.py) python3 "$LIB/$step" ;;
      *)        python3 "$LIB/$step" --apply ;;
    esac
    sudo -n /usr/local/sbin/reading-room-apply-catalog
  done
  echo "=== done $(date -Is) ==="
} >> "$LOG" 2>&1

touch "$STAMP"
