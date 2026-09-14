#!/usr/bin/env python3
"""Which cover-less books can Open Library actually serve?

Run BEFORE generating any placeholder art. sendLocalCover wins over the Open
Library fallback, so writing a generated cover for a book that has a real one
available would be a downgrade, not a fix. This asks the app's own /api/cover
for each book (which also warms its cache) and records the verdict.
"""
import json, os, subprocess, sys, urllib.parse

CAT = "/opt/reading-room/current/site/catalog.json"
COVERS = "/mnt/seagate/ReadingRoom/covers"
OUT = "/mnt/seagate/ReadingRoom/ol-probe.json"

cat = json.load(open(CAT))
have = {n[:-4] for n in os.listdir(COVERS) if n.endswith(".jpg")}
miss = [b for b in cat if b["id"] not in have]

done = {}
if os.path.exists(OUT):
    done = json.load(open(OUT))

for i, b in enumerate(miss, 1):
    if b["id"] in done:
        continue
    q = urllib.parse.urlencode({
        "id": b["id"], "title": b.get("title") or "",
        "author": b.get("author") or "", "format": b.get("format") or "",
    })
    try:
        code = subprocess.run(
            ["curl", "-s", "-m", "25", "-o", "/dev/null", "-w", "%{http_code}",
             "http://127.0.0.1:4311/api/cover?" + q],
            capture_output=True, text=True, timeout=40).stdout.strip()
    except subprocess.TimeoutExpired:
        code = "timeout"
    done[b["id"]] = code
    if i % 25 == 0:
        json.dump(done, open(OUT, "w"))
        print(f"  {i}/{len(miss)}", flush=True)

json.dump(done, open(OUT, "w"))
hits = sum(1 for v in done.values() if v in ("200", "302"))
print(f"probed {len(done)}: Open Library has {hits}, needs generating {len(done) - hits}")
