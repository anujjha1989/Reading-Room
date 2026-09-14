#!/usr/bin/env python3
"""Group prose books into series.

Only 126 of 5,856 prose books carry a series today, and some of those names are
debris ("128 The Saga of Seven Suns - Kevin J Anderson"). Signals, most
reliable first:

  bracket  libgen-style filenames lead with series and position:
           "[Ibis Trilogy _3] Ghosh, Amitav - Flood of Fire" -> Ibis Trilogy #3
  inline   "Malazan 7 - Reaper's Gale - Steven Erickson" -> Malazan #7
  folder   a folder holding several books by one author

The folder signal needs two guards that the comics version did not. A folder
directly under "Favorite Authors/" is named for the AUTHOR, not a series -
shelving D.H. Lawrence's 30 books as a series called "D.H. Lawrence" just
duplicates the author field. And a download folder ("mobi files by
[www.eBookism.NET]") is not a series either.

A candidate is only accepted when at least two books share it AND they share an
author, which stops a themed folder of unrelated books becoming a series.
"""
import json, os, re, sys, collections

CAT = "/opt/reading-room/current/site/catalog.json"
MAP = "/mnt/seagate/ReadingRoom/local-files.json"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"
ROOT = "/mnt/seagate/ReadingRoom/library/Books"
COMIC = {"CBR", "CBZ"}

GENERIC = {
    "books", "fiction", "non fiction", "nonfiction", "general", "collections",
    "reading lists", "favorite authors", "archive", "new imports", "inbox",
    "short stories", "poetry drama", "classics", "novels", "misc", "other",
    "kindle collection to sort", "downloaded from internet latest", "ebooks",
    "science fiction fantasy", "history politics", "self improvement",
    "biography memoir", "science technology", "film writing", "indian", "plays",
    "penguin classics", "various", "complete works", "collected works",
}
JUNK = re.compile(r"files by|www\.|pdf only|\.net|\.com|\.org|torrent|demonoid|"
                  r"^[A-Za-z]{2,5}[-_ ]?(?:epub|mobi|pdf|azw3?)$", re.I)
BRACKET = re.compile(r"^\s*\[\s*(?P<name>[^\]\d][^\]]*?)\s*[_#]?\s*(?P<num>\d{1,3})?\s*\]")
INLINE = re.compile(r"^\s*(?P<name>[A-Z][\w'’.&-]*(?:\s+[A-Z][\w'’.&-]*){0,3})"
                    r"\s+(?P<num>\d{1,2})\s*[-–—]\s+")
TRAIL_AUTHOR = re.compile(r"\s*[-–—]\s*[A-Z][\w'’.]*(?:\s+[A-Z][\w'’.]*){0,3}\s*$")
# Two or three capitalised words and nothing else: almost certainly a person.
PERSONISH = re.compile(r"^(?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){1,2}$")
LEAD_NUM = re.compile(r"^\s*\d{1,4}\s*[-–—.]?\s+")
# "Harry Hole series (books 1-10)", "Mistborn Series 1-6(EPUB)"
DECOR = re.compile(r"\s*(?:\(?\bbooks?\b[\s\d–-]*\)?|\bseries\b|\(epub\)|\(mobi\)|"
                   r"[\s(]*\d{1,3}\s*[-–]\s*\d{1,3}\s*\)?)\s*", re.I)
NOISE = re.compile(r"\s*[-–—]?\s*(?:libgen(?:\.\w+)?|z-?lib(?:\.org)?|retail|calibre)\s*$", re.I)
# Keep a folder that announces itself as a series even if it looks name-like.
SERIESWORD = re.compile(r"\b(series|trilogy|saga|cycle|chronicles|quartet|sequence)\b", re.I)


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def clean_series(s):
    if not s or JUNK.search(s):
        return None
    s = NOISE.sub("", s)
    s = LEAD_NUM.sub("", s)
    s = TRAIL_AUTHOR.sub("", s)
    s = DECOR.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—_.()")
    if len(s) < 4 or norm(s) in GENERIC or re.fullmatch(r"[\d\s]+", s):
        return None
    return s


def from_filename(stem):
    m = BRACKET.match(stem)
    if m:
        name = clean_series(m.group("name"))
        if name:
            return name, int(m.group("num")) if m.group("num") else None
    m = INLINE.match(stem)
    if m:
        name = clean_series(m.group("name"))
        if name:
            return name, int(m.group("num"))
    return None, None


def from_folder(path):
    """Nearest ancestor folder that names a series rather than an author."""
    if not path:
        return None
    parts = os.path.relpath(path, ROOT).split(os.sep)[:-1]
    for i in range(len(parts) - 1, -1, -1):
        p = parts[i]
        # Directly under "Favorite Authors/" means this folder is a person.
        if i > 0 and parts[i - 1].lower() == "favorite authors":
            continue
        c = clean_series(p)
        if c:
            return c
    return None


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))
    paths = json.load(open(MAP))
    prose = [b for b in books
             if (b.get("format") or "").upper() not in COMIC
             and b.get("category") != "Graphic Novel"]

    cand = {}
    for b in prose:
        p = paths.get(b["id"])
        stem = os.path.splitext(os.path.basename(p))[0] if p else ""
        name, num = from_filename(stem)
        cand[b["id"]] = (name, num, from_folder(p))

    authors = collections.defaultdict(collections.Counter)
    members = collections.Counter()
    for b in prose:
        for s in (cand[b["id"]][0], cand[b["id"]][2]):
            if s:
                members[norm(s)] += 1
                a = norm(b.get("author"))
                if a:
                    authors[norm(s)][a] += 1
    display = {}
    for name, _, folder in cand.values():
        for s in (name, folder):
            if s and norm(s) not in display:
                display[norm(s)] = s

    def ok(s, need=2):
        k = norm(s)
        if members[k] < need or len(authors[k]) > 2:
            return False
        # A "series" named after its own author is just the author again.
        # Compared as token SETS, because the folder writes it one way round
        # ("Murdoch, Iris") and the metadata the other ("Iris Murdoch").
        if not SERIESWORD.search(s):
            ktok = set(k.split())
            for a in authors[k]:
                atok = set(a.split())
                if ktok and (ktok == atok or ktok <= atok or atok <= ktok):
                    return False
            # No member has an author at all, and the name reads like a person:
            # it is an author folder whose books simply lack metadata, not a
            # series. (A real series named for its detective - George Felse -
            # survives, because those books do carry their author.)
            if not authors[k] and PERSONISH.match(s.strip()):
                return False
        return True

    pick, positions = {}, {}
    for b in prose:
        name, num, folder = cand[b["id"]]
        chosen = None
        if name and ok(name):
            chosen = display[norm(name)]
        elif folder and ok(folder, need=3):
            chosen = display[norm(folder)]
        if chosen:
            pick[b["id"]] = chosen
            if num is not None:
                positions[b["id"]] = num

    counts = collections.Counter(pick.values())
    pick = {k: v for k, v in pick.items() if counts[v] >= 2}

    assigned = collections.Counter()
    changed = positioned = tidied = 0
    for b in prose:
        s = pick.get(b["id"])
        if s:
            if (b.get("series") or "") != s:
                b["series"] = s
                changed += 1
            assigned[s] += 1
            n = positions.get(b["id"])
            if n is not None and b.get("seriesPosition") != n:
                b["seriesPosition"] = n
                positioned += 1
        else:
            old = (b.get("series") or "").strip()
            if old:
                c = clean_series(old)
                if c != old:
                    b["series"] = c or ""
                    tidied += 1

    total_in_series = sum(1 for b in prose if (b.get("series") or "").strip())
    print(f"prose books        : {len(prose)}")
    print(f"in a series (total): {total_in_series}  (was 126)")
    print(f"  newly grouped    : {sum(assigned.values())}")
    print(f"series set         : {changed}")
    print(f"positions set      : {positioned}")
    print(f"old names tidied   : {tidied}")
    print(f"distinct series    : {len(assigned)}")
    print("\nall series:")
    for s, n in assigned.most_common():
        print(f"  {n:4d}  {s}")

    if apply:
        os.makedirs(os.path.dirname(NEXT), exist_ok=True)
        json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"\nwrote {NEXT}")
    else:
        print("\n(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
