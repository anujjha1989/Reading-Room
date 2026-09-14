#!/bin/bash
# Weekly catalogue refresh.
#
# Replaces the reading-room-drive-sync timer, which ran the OLD append-only
# scanner: it listed all of Drive and added anything the catalogue did not
# already know, ignoring the configured sources. With the library now served
# from the Seagate, that run would have re-added the entire Drive tree as
# duplicate entries.
#
# Asking the app for a scan instead reuses the hardened path: the app writes a
# request file, a systemd path unit runs the reconciling rebuild, and the
# enrichment cron re-applies metadata and series once the catalogue settles.
set -eu
curl --fail --silent --show-error -X POST   -H "content-type: application/json" -d "{}"   http://127.0.0.1:4311/api/settings/scan   >> /home/anujjha1989/.reading-room/weekly-scan.log 2>&1
echo " requested $(date -Is)" >> /home/anujjha1989/.reading-room/weekly-scan.log
