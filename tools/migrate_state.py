#!/usr/bin/env python3
"""Carry reading progress across the catalogue rebuild.

library-state.json is keyed by Drive file ID, and the rebuild replaces 8,605
stale IDs with the real ones. Without this, every book in progress silently
forgets its position — the one genuinely destructive side effect of the
rebuild, and the one thing here that cannot be regenerated.

Old entry -> new entry is matched on normalised title + format, which is how
the same physical book appears in both catalogues.
"""
import json, re, sys, unicodedata

OLD_CAT = "/tmp/rrstage/catalog.json"
NEW_CAT = "/tmp/rrstage/rebuilt-catalog.json"
STATE = "/tmp/rrstage/library-state.json"
OUT = "/tmp/rrstage/library-state.migrated.json"


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(a|an|the)\b", " ", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()


old = {b["id"]: b for b in json.load(open(OLD_CAT))}
new = json.load(open(NEW_CAT))
state = json.load(open(STATE))

index = {}
for b in new:
    index.setdefault((norm(b["title"]), (b.get("format") or "").upper()), []).append(b)

entries = state.get("states", [])
moved = kept = lost = 0
for e in entries:
    bid = e.get("bookId")
    if any(b["id"] == bid for b in new):
        kept += 1
        continue
    src = old.get(bid)
    if not src:
        lost += 1
        continue
    hit = index.get((norm(src["title"]), (src.get("format") or "").upper()))
    if not hit:
        lost += 1
        continue
    target = hit[0]["id"]
    e["bookId"] = target
    if e.get("fileId") == bid:
        e["fileId"] = target
    moved += 1

print("progress entries : %d" % len(entries))
print("  already valid  : %d" % kept)
print("  remapped       : %d" % moved)
print("  unmatched      : %d" % lost)

if "--apply" in sys.argv:
    json.dump(state, open(OUT, "w"))
    print("wrote %s" % OUT)
else:
    print("(dry run)")
