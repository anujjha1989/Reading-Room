#!/bin/bash
# Reading Room — reconciling catalogue scan.
#
# The old sync was append-only: drive-scan.mjs skips any file whose ID is
# already known and never removes an entry whose file has gone. A re-uploaded
# book therefore looked new AND left its dead predecessor behind, which is how
# 8,605 of 10,115 entries came to point at files that no longer exist.
#
# This rebuilds instead of appending: rclone lists what is actually in Drive
# (trashed files are not listed), and drive-scan.mjs runs from an EMPTY
# catalogue so its own title/author/series rules produce the whole thing. Same
# derivation, correct inputs, and entries for deleted files simply never appear.
#
# Runs as anujjha1989 (who may sudo the validating installer). The web app runs
# hardened with NoNewPrivileges and cannot do any of this itself; it asks by
# writing a request file, which a systemd path unit turns into a run of this.
set -euo pipefail
umask 022

DIR=/home/anujjha1989/.reading-room
DATA=/var/lib/reading-room
CATALOG=/opt/reading-room/current/site/catalog.json
MANIFEST=$DIR/drive-manifest.json
LOG=$DIR/last-scan.log
FILTERED=$DIR/drive-manifest.filtered.json
EMPTY=$DIR/empty-catalog.json
NEXT=$DIR/catalog.next.json
SUMMARY=$DIR/catalog-sync-summary.json
STATUS=$DATA/scan-status.json
REQUEST=$DATA/scan-request.json
SETTINGS=$DATA/settings.json

mkdir -p "$DIR"
exec > >(tee "$LOG") 2>&1
exec 9>"$DIR/drive-sync.lock"
if ! flock -n 9; then
  echo "A scan is already running." >&2
  exit 0
fi

# Consume the request immediately: the path unit triggers on this file
# existing, so holding it until success turns any failure into a restart loop.
rm -f "$REQUEST"

status() {  # status <state> <message> [extra-json]
  sudo -n /usr/local/sbin/reading-room-write-status "$1" "$2" "${3:-{\}}"
}

fail() {
  if grep -qi "rateLimitExceeded\|userRateLimit\|quota" "$LOG" 2>/dev/null; then
    status failed "Google Drive is rate-limiting us. Nothing changed — try again later."
  else
    status failed "Scan failed — the catalogue was left unchanged."
  fi
}
trap fail ERR

status running "Listing Drive…"
rclone lsjson --recursive --files-only \
  --tpslimit 8 --retries 5 --low-level-retries 20 --retries-sleep 20s \
  reading-room-drive: > "$MANIFEST.new"
mv "$MANIFEST.new" "$MANIFEST"

status running "Reading the catalogue…"
node - "$MANIFEST" "$SETTINGS" "$FILTERED" <<'NODE'
// Keep only files under the enabled source folders. drive-scan.mjs applies its
// own Books/|Scripts/ rule on top, so a source outside those is simply inert.
import fs from "node:fs";
const [, , manifestPath, settingsPath, outPath] = process.argv;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let sources = [{ path: "Books" }, { path: "Scripts" }];
try {
  const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (Array.isArray(s.sources) && s.sources.length) {
    sources = s.sources.filter((x) => x.enabled !== false);
  }
} catch { /* no settings yet: index everything */ }
const prefixes = sources.map((s) => String(s.path).replace(/^\/+|\/+$/g, ""));
const keep = manifest.filter((f) => !f.IsDir && typeof f.Path === "string" &&
  prefixes.some((p) => f.Path === p || f.Path.startsWith(p + "/")));
fs.writeFileSync(outPath, JSON.stringify(keep));
console.log(`manifest: ${manifest.length} files, ${keep.length} within sources`);
NODE

echo "[]" > "$EMPTY"
status running "Rebuilding the catalogue…"
node /usr/local/lib/reading-room/drive-scan.mjs "$EMPTY" "$FILTERED" "$NEXT" "$SUMMARY"

if [ ! -s "$NEXT" ]; then
  status failed "Scan produced no catalogue — nothing changed."
  exit 1
fi

status running "Carrying reading progress across…"
sudo -n /usr/local/sbin/reading-room-migrate-progress "$CATALOG" "$NEXT"

status running "Installing…"
before=$(node -p "require('$CATALOG').length")
sudo -n /usr/local/sbin/reading-room-apply-catalog >/dev/null   # reads catalog.next.json
after=$(node -p "require('$CATALOG').length")

added=$(node -p "
  const a=new Set(require('$CATALOG').map(b=>b.id));
  String(require('$NEXT').filter(b=>a.has(b.id)).length)" 2>/dev/null || echo 0)
rm -f "$REQUEST"
status ready "Scan complete." "{\"before\":$before,\"after\":$after}"
echo "catalogue: $before -> $after"
