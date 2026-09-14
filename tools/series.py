#!/usr/bin/env python3
"""Group comic issues into series.

A wall of 2,104 individually-titled issues is unbrowsable; "Batman 679" and
"Batman 645" want to sit together under Batman, in issue order. Two signals:

  filename  strip the issue number and scene-release debris off the title
            ("16 X-Men 107 [nonlocal]" -> X-Men, #107).
  folder    the folder a run of issues lives in is usually named for the
            series, and catches inconsistent filenames.

Leading digits in a filename are usually pack ordering rather than part of the
name - but not always, which is how "100 Bullets 052" becomes "Bullets". So a
folder name that ENDS with the filename-derived name wins: the folder saw the
whole title where the filename had it truncated.

A name is only kept when at least two issues share it after all assignment is
done; a series of one is just a book.
"""
import json, os, re, sys, collections

CAT = "/opt/reading-room/current/site/catalog.json"
MAP = "/mnt/seagate/ReadingRoom/local-files.json"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"
ROOT = "/mnt/seagate/ReadingRoom/library/Books"
COMIC = {"CBR", "CBZ"}

DEBRIS = re.compile(
    r"\s*(?:\[[^\]]*\]|\((?:\d{4}|[^)]*(?:covers?|scan|digital|c2c|webrip|"
    r"minutemen|dcp|empire|zone|team[- ]?dcp)[^)]*)\))\s*", re.I)
# Leading pack-order digits, but NOT a number that is part of the name:
# "001 Uncanny X-Men" and "013 - Watchmen" are ordering, "100 Bullets" is the
# title. Zero-padded, one-or-two digit, or dash-separated counts as ordering.
LEAD_SEQ = re.compile(r"^\s*(?:0\d{1,3}[\s._-]+|\d{1,2}[\s._-]+|\d{1,4}\s*[-–_.]\s*)(?=\D)")
ISSUE = re.compile(r"[\s#._-]*(?:#\s*)?(\d{1,4})(?:\s*\(of\s*\d+\))?\s*$", re.I)
VOLUME = re.compile(r"\s+v(?:ol)?\.?\s*\d+\s*$", re.I)
# Folder names carry ranges and pack numbering: "Batman 001-075", "Pack 13".
RANGE = re.compile(r"\s*[\(\[]?\d{1,4}\s*[-–]\s*\d{1,4}[\)\]]?\s*$")
PACKISH = re.compile(r"\s*[-–—]?\s*(?:pack|part|volume|vol)\s*#?\s*\d+\s*$", re.I)
BAD = re.compile(r"^(?:s|chapter|unamed|unnamed|misc|unknown|nonlocal|various|"
                 r"new|complete|collection|comics?|issues?)$", re.I)


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def acceptable(s):
    return bool(s) and len(s) >= 3 and not BAD.match(s.strip())


def split_issue(title):
    s = DEBRIS.sub(" ", title or "")
    s = LEAD_SEQ.sub("", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—._")
    num = None
    m = ISSUE.search(s)
    if m:
        num = int(m.group(1))
        s = s[:m.start()].strip(" -–—._#")
    s = VOLUME.sub("", s).strip(" -–—._")
    return (s or None), num


def folder_series(path):
    if not path:
        return None
    parts = os.path.relpath(path, ROOT).split(os.sep)[:-1]
    for p in reversed(parts):
        clean = DEBRIS.sub(" ", p)
        clean = LEAD_SEQ.sub("", clean)
        clean = PACKISH.sub("", clean)
        clean = RANGE.sub("", clean)
        clean = re.sub(r"\s+", " ", clean).strip(" -–—._")
        if not acceptable(clean):
            continue
        if norm(clean) in {"collections", "graphic novels", "books", "x men comics", "xmen"}:
            continue
        return clean
    return None


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))
    paths = json.load(open(MAP))
    comics = [b for b in books if (b.get("format") or "").upper() in COMIC]

    # For comics the filename is a better title than the one the scanner
    # derived: it truncates at " - ", so 48 different Batman graphic novels
    # ("Batman - Arkham Asylum", "Batman - The Killing Joke") all ended up
    # titled just "Batman". The filename also carries the issue number that
    # series ordering depends on.
    retitled = 0
    for b in comics:
        p = paths.get(b["id"])
        if not p:
            continue
        stem = os.path.splitext(os.path.basename(p))[0]
        stem = DEBRIS.sub(" ", stem)
        stem = LEAD_SEQ.sub("", stem)
        stem = re.sub(r"\s+", " ", stem).strip(" -–—._")
        if len(stem) >= 3 and stem != (b.get("title") or ""):
            b["title"] = stem
            retitled += 1

    cand = {}
    for b in comics:
        name, num = split_issue(b.get("title"))
        folder = folder_series(paths.get(b["id"]))
        # "100 Bullets" (folder) beats "Bullets" (filename, leading digits
        # mistaken for pack ordering).
        if name and folder and norm(folder).endswith(norm(name)) and len(folder) > len(name):
            name = folder
        cand[b["id"]] = (name if acceptable(name) else None, num,
                         folder if acceptable(folder) else None)

    from_title = collections.Counter(norm(c[0]) for c in cand.values() if c[0])
    from_folder = collections.Counter(norm(c[2]) for c in cand.values() if c[2])
    display = {}
    for name, _, folder in cand.values():
        for s in (name, folder):
            if s and norm(s) not in display:
                display[norm(s)] = s

    # First pass: pick a name. Second pass: keep only names with >= 2 issues.
    pick = {}
    for b in comics:
        name, num, folder = cand[b["id"]]
        if name and from_title[norm(name)] >= 2:
            pick[b["id"]] = display[norm(name)]
        elif folder and from_folder[norm(folder)] >= 2:
            pick[b["id"]] = display[norm(folder)]

    counts = collections.Counter(pick.values())
    pick = {k: v for k, v in pick.items() if counts[v] >= 2}

    assigned = collections.Counter()
    changed = cleared = positioned = 0
    for b in comics:
        s = pick.get(b["id"])
        old = b.get("series") or ""
        if s:
            if old != s:
                b["series"] = s
                changed += 1
            assigned[s] += 1
            num = cand[b["id"]][1]
            if num is not None and b.get("seriesPosition") != num:
                b["seriesPosition"] = num
                positioned += 1
        elif old and not acceptable(old):
            b["series"] = ""
            b.pop("seriesPosition", None)
            cleared += 1

    covered = sum(assigned.values())
    print(f"comics                : {len(comics)}")
    print(f"titles rebuilt        : {retitled}")
    print(f"now in a series       : {covered}  ({100*covered/len(comics):.0f}%)")
    print(f"series values changed : {changed}")
    print(f"issue numbers set     : {positioned}")
    print(f"junk series cleared   : {cleared}")
    print(f"distinct series       : {len(assigned)}")
    print("\nlargest:")
    for s, n in assigned.most_common(22):
        print(f"  {n:5d}  {s}")
    print("\nsmallest:")
    for s, n in assigned.most_common()[-8:]:
        print(f"  {n:5d}  {s}")

    if apply:
        os.makedirs(os.path.dirname(NEXT), exist_ok=True)
        json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"\nwrote {NEXT}")
    else:
        print("\n(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
