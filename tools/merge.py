#!/usr/bin/env python3
"""Fold extracted metadata into the catalogue.

Conservative on purpose: an author is only filled in where there was none, and
a title is only replaced where the existing one is clearly a filename rather
than a title AND the extracted one is not. The scanner's titles are often fine
and were sometimes hand-corrected, so overwriting wholesale would lose work.

Writes catalog.next.json; reading-room-apply-catalog validates and installs it.
"""
import json, os, re, sys

CAT = "/opt/reading-room/current/site/catalog.json"
META = "/mnt/seagate/ReadingRoom/meta.jsonl"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"

# The app's own definition of "this title is really a filename".
FILENAMEISH = re.compile(r"\d{3,}|_|^\W|\.(pdf|epub|mobi)$|retail|calibre|z-?lib|www\.", re.I)
JUNK = re.compile(r"^(unknown|untitled|no title|calibre|ebook|book|\W*)$", re.I)

def clean(s):
    if not s:
        return None
    s = re.sub(r"\s+", " ", str(s)).strip().strip("-–—_ ")
    if len(s) < 2 or JUNK.match(s):
        return None
    return s

def person(name):
    """'Moore, Alison' -> 'Alison Moore'; leaves everything else alone."""
    if not name:
        return None
    if name.count(",") == 1 and "&" not in name and ";" not in name:
        last, first = [p.strip() for p in name.split(",")]
        if last and first and " " not in last and len(first.split()) <= 3:
            return f"{first} {last}"
    return name

meta = {}
with open(META, encoding="utf-8", errors="ignore") as fh:
    for line in fh:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        meta[r["id"]] = r

books = json.load(open(CAT))
filled_author = retitled = filled_title = 0

for b in books:
    m = meta.get(b["id"])
    if not m:
        continue
    a = person(clean(m.get("author")))
    if a and not (b.get("author") or "").strip():
        b["author"] = a
        filled_author += 1
    t = clean(m.get("title"))
    if t:
        cur = (b.get("title") or "").strip()
        if not cur:
            b["title"] = t
            filled_title += 1
        elif FILENAMEISH.search(cur) and not FILENAMEISH.search(t):
            b["title"] = t
            retitled += 1

os.makedirs(os.path.dirname(NEXT), exist_ok=True)
json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)

no_author = sum(1 for b in books if not (b.get("author") or "").strip())
poor = sum(1 for b in books if FILENAMEISH.search(b.get("title") or ""))
print(f"entries            : {len(books)}")
print(f"authors filled in  : {filled_author}")
print(f"titles replaced    : {retitled}  (+{filled_title} that were empty)")
print(f"still no author    : {no_author}")
print(f"still filename-ish : {poor}")
print(f"wrote {NEXT}")
