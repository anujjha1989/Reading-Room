#!/usr/bin/env python3
"""Fix entries whose title and author are the wrong way round.

Where a book sits in an author folder written surname-first
("…/Alcott, Louisa May/Little Women - Louisa May Alcott.epub"), the scanner
took the FOLDER as the title and the leading part of the filename as the
author - giving title "Louisa May Alcott", author "Little Women". Exactly
inverted, which also breaks the Open Library cover lookup, since it searches
for a book called "Louisa May Alcott".

Detected structurally rather than by guesswork: the parent folder must parse as
"Surname, Forename", and the entry's title must equal that same person once
the comma is unwound. Then the title is taken from the filename, with the
author's name trimmed off the end if it is repeated there.
"""
import json, os, re, sys, collections

CAT = "/opt/reading-room/current/site/catalog.json"
MAP = "/mnt/seagate/ReadingRoom/local-files.json"
NEXT = "/home/anujjha1989/.reading-room/catalog.next.json"
ROOT = "/mnt/seagate/ReadingRoom/library/Books"

# Nobiliary particles stay lowercase ("Balzac, Honore de", "Goethe, Johann
# Wolfgang von"), so the forename side has to allow them or those authors are
# missed entirely.
PARTICLE = r"(?:de|del|della|di|da|van|von|der|den|la|le|du|dos|el|al|bin|ibn|st\.?)"
SURNAME_FIRST = re.compile(
    rf"^((?:{PARTICLE}\s+)?[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)?)\s*,\s*"
    rf"([A-Z][\w'’.-]+(?:\s+(?:{PARTICLE}|[A-Z][\w'’.-]*\.?)){{0,3}})$",
    re.I if False else 0)


PERSONISH = re.compile(r"^(?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){1,3}$")


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


# "Discreet Hero, The" is a TITLE with its article moved to the end, not a
# person - unwinding it produces a perfect match against the title and the rule
# would then overwrite that title with the filename.
ARTICLES = {"the", "a", "an", "la", "le", "les", "los", "las", "el", "il", "der", "die", "das"}


def unwind(folder):
    """'Alcott, Louisa May' -> 'Louisa May Alcott'."""
    m = SURNAME_FIRST.match(folder.strip())
    if not m or m.group(2).strip().lower() in ARTICLES:
        return None
    return f"{m.group(2)} {m.group(1)}"


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))
    paths = json.load(open(MAP))
    fixed, samples = 0, []

    for b in books:
        p = paths.get(b["id"])
        if not p:
            continue
        folder = os.path.basename(os.path.dirname(p))
        person = unwind(folder)
        if not person:
            continue
        nt, np_ = norm(b.get("title")), norm(person)
        # The scanner truncates, so "William Beckfor" must still match the
        # folder's "William Beckford". A prefix match of 8+ characters is
        # specific enough to be that author and nothing else.
        if not (nt == np_ or (len(nt) >= 8 and np_.startswith(nt))):
            continue

        stem = os.path.splitext(os.path.basename(p))[0]
        # "Little Women - Louisa May Alcott" -> "Little Women"
        title = stem
        # The filename repeats the author, sometimes in the same truncated form
        # the catalogue holds ("… - William Beckfor"), so strip the truncated
        # spelling too or it stays glued to the title.
        for part in (person, folder, (b.get("title") or "").strip()):
            if not part:
                continue
            title = re.sub(r"\s*[-–—]\s*" + re.escape(part) + r"\s*$", "", title,
                           flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" -–—_.")
        if len(title) < 2 or norm(title) == norm(person):
            continue

        if len(samples) < 12:
            samples.append((b.get("title"), b.get("author"), title, person))
        b["title"], b["author"] = title, person
        fixed += 1

    # NOTE: a second pass comparing the two fields by "shape" was tried and
    # removed. A title that looks like a person's name is not evidence of
    # anything - "The Discreet Hero" and "Julian Barnes" are both three
    # capitalised words - and the rule swapped 623 books, most of them
    # correctly filed. Only the folder structure actually distinguishes the
    # two, so only the folder structure is trusted here.

    print(f"swapped entries fixed : {fixed}")
    for wt, wa, nt, na in samples:
        print(f"  WAS title={wt!r:38} author={wa!r}")
        print(f"  NOW title={nt!r:38} author={na!r}")

    if apply:
        os.makedirs(os.path.dirname(NEXT), exist_ok=True)
        json.dump(books, open(NEXT, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"wrote {NEXT}")
    else:
        print("(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
