#!/usr/bin/env python3
"""Fill in authors and tidy titles that embedded metadata could not supply.

Sources, each applied only where it is safe:

  folder   "Favorite Authors/<Name>/..." is an explicit statement of
           authorship by whoever filed the library - the most reliable signal
           available once the file itself has none.
  filename a trailing name after "by" or a final dash
           ("Divine-comedy-purgatorio-Dante Alighieri").

Comics are left alone: for them the series matters and a per-issue "author" is
noise, so nothing here touches CBR/CBZ or anything filed as a graphic novel.
"""
import json, os, re, sys

CAT = "/opt/reading-room/current/site/catalog.json"
MAP = "/mnt/seagate/ReadingRoom/local-files.json"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"
ROOT = "/mnt/seagate/ReadingRoom/library/Books"

COMIC = {"CBR", "CBZ"}
FILENAMEISH = re.compile(r"\d{3,}|_|^\W|\.(pdf|epub|mobi)$|retail|calibre|z-?lib|www\.", re.I)
NAME = re.compile(r"^[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,3}$")
NOISE = re.compile(r"\b(pdf only|retail|calibre|z-?lib(?:\.org)?|libgen(?:\.\w+)?|"
                   r"www\.[^\s]+|ebook|epub|mobi)\b", re.I)


def titlecase_ok(s):
    return bool(s) and NAME.match(s.strip()) is not None


def author_from_folder(path):
    parts = os.path.relpath(path, ROOT).split(os.sep)
    for i, p in enumerate(parts[:-1]):
        if p.lower() == "favorite authors" and i + 1 < len(parts) - 1:
            name = re.sub(r"\s*\([^)]*\)", "", parts[i + 1]).strip()
            return name if titlecase_ok(name) else None
    return None


def author_from_name(stem):
    m = re.search(r"\bby\s+([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,3})\s*$", stem)
    # Two words minimum: these filenames are often truncated, and
    # "...People by Dale" would otherwise file Dale Carnegie under "Dale".
    if m and len(m.group(1).split()) >= 2:
        return m.group(1).strip()
    m = re.search(r"[-–—]\s*([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})\s*$", stem)
    if m and titlecase_ok(m.group(1)):
        return m.group(1).strip()
    return None


def tidy_title(t):
    # Deliberately narrow. Many of these titles were truncated by the original
    # scanner ("The Killer Angels (1975) Puli"), so anything that rewrites the
    # middle of a title yields a worse result than leaving it alone. Only
    # trailing [tags] and scanner debris come off, and anything that ends up
    # with unbalanced brackets or a stranded comma is rejected outright.
    s = NOISE.sub(" ", t)
    s = re.sub(r"\s*\[[^\]]*\]\s*", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—.,")
    if len(s) < 3 or " ," in s or s.count("(") != s.count(")"):
        return None
    return s


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))
    paths = json.load(open(MAP))
    by_folder = by_name = tidied = 0
    samples = []

    for b in books:
        fmt = (b.get("format") or "").upper()
        if fmt in COMIC or b.get("category") == "Graphic Novel":
            continue
        p = paths.get(b["id"])
        stem = os.path.splitext(os.path.basename(p))[0] if p else ""

        if not (b.get("author") or "").strip():
            folder = author_from_folder(p) if p else None
            a = folder or author_from_name(stem)
            if a:
                b["author"] = a
                if folder:
                    by_folder += 1
                else:
                    by_name += 1
                if len(samples) < 10:
                    samples.append(("author", stem[:58], a))

        t = (b.get("title") or "").strip()
        if t and FILENAMEISH.search(t):
            nt = tidy_title(t)
            if nt and nt != t and not FILENAMEISH.search(nt):
                if len(samples) < 22:
                    samples.append(("title", t[:52], nt[:52]))
                b["title"] = nt
                tidied += 1

    print(f"authors from folder   : {by_folder}")
    print(f"authors from filename : {by_name}")
    print(f"titles tidied         : {tidied}")
    for kind, was, now in samples:
        print(f"  {kind:6} {was!r}  ->  {now!r}")

    if apply:
        os.makedirs(os.path.dirname(NEXT), exist_ok=True)
        json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"wrote {NEXT}")
    else:
        print("(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
