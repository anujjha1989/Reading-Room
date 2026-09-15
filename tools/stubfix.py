#!/usr/bin/env python3
"""Repair the handful of books whose title is a bare article.

Their FILENAMES were truncated at import ("… - A.epub", "… - The .mobi"), so
the scanner had nothing better to parse: it took the fragment after the last
dash as the title and everything before it as the author. No amount of
rearranging those two fields recovers the real ones.

The books themselves still carry proper metadata, which extract.py already
pulled into meta.jsonl - so that is the source used here. Anything the file
cannot supply is left exactly as it was rather than guessed at.
"""
import json, os, re, sys

CAT = "/opt/reading-room/current/site/catalog.json"
META = "/mnt/seagate/ReadingRoom/meta.jsonl"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"

STUB = re.compile(r"^(a|an|the|of|and|or|in|on|to|is|it|de|la|le|el|los|las)$", re.I)

meta = {}
for line in open(META, encoding="utf-8", errors="ignore"):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    meta[r["id"]] = r


def clean(s):
    s = re.sub(r"\s+", " ", (s or "")).strip(" -–—_.,")
    return s or None


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))
    fixed = skipped = 0

    for b in books:
        if not STUB.match((b.get("title") or "").strip()):
            continue
        m = meta.get(b["id"]) or {}
        t, a = clean(m.get("title")), clean(m.get("author"))
        if not t or STUB.match(t):
            print(f"  LEFT  {b.get('title')!r} / {(b.get('author') or '')[:40]!r}"
                  f"  (file carries no usable title)")
            skipped += 1
            continue
        print(f"  WAS   title={b.get('title')!r} author={(b.get('author') or '')[:40]!r}")
        print(f"  NOW   title={t[:52]!r} author={(a or '')[:36]!r}")
        b["title"] = t
        if a:
            b["author"] = a
        fixed += 1

    print(f"\nrepaired from embedded metadata: {fixed}; left alone: {skipped}")
    if apply and fixed:
        os.makedirs(os.path.dirname(NEXT), exist_ok=True)
        json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)
        print("wrote", NEXT)
    elif not apply:
        print("(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
