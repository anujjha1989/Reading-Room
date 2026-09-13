#!/usr/bin/env python3
"""Re-key extracted covers from local Drive IDs onto catalogue IDs.

The locally-synced mirror and the catalogue are two different Drive listings:
both hold the same books, but only 1,337 of 10,115 file IDs coincide. Covers
are served as <catalogue id>.jpg, so the covers extracted from local files
have to be matched back by title rather than by ID.

The catalogue's `title` was derived from the filename stem by
reading-room-drive-scan.mjs, so reversing it is mostly a matter of applying
the same normalisation to both sides. Matching is deliberately conservative:
a title that maps to more than one catalogue entry of the same format is
ambiguous, and an ambiguous match would put the wrong art on a book, which is
worse than no art at all.

Pass --apply to write the re-keyed copies; without it, only reports.
"""
import ctypes, json, os, re, shutil, sys, unicodedata
from collections import defaultdict

CAT = "/tmp/rr/cat.json"
SRC = "/tmp/rr/covers-out"          # <local drive id>.jpg
DEST = "/tmp/rr/covers-keyed"       # <catalogue id>.jpg
ROOT = "/Users/anuj-mac/Library/CloudStorage/GoogleDrive-anujjha1989@gmail.com/My Drive/Entertainment/Books"
EBOOK_RE = re.compile(r"\.(epub|cbz|cbr|mobi|azw3|azw)$", re.I)

_libc = ctypes.CDLL("libc.dylib", use_errno=True)
_libc.getxattr.restype = ctypes.c_ssize_t
_libc.getxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p,
                           ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]
XATTR = b"com.google.drivefs.item-id#S"


def drive_id(path):
    p = path.encode()
    n = _libc.getxattr(p, XATTR, None, 0, 0, 0)
    if n <= 0:
        return None
    buf = ctypes.create_string_buffer(n)
    got = _libc.getxattr(p, XATTR, buf, n, 0, 0)
    return buf.raw[:got].decode("ascii", "replace").strip() if got > 0 else None


def norm(s):
    """Aggressive but order-preserving: case, accents, punctuation and the
    articles that filenames add or drop freely all stop mattering."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"\b(a|an|the)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _strip_noise(t):
    t = re.sub(r"^\[([^\]]+)\]\s*", "", t)
    t = re.sub(r"^\d+(\.\d+)?\s*[-–—:]\s*", "", t)
    t = re.sub(r"\s*\(dup(licate)?\)\s*$", "", t, flags=re.I)
    t = re.sub(r"\s*\(\d{4}(,[^)]*)?\)\s*$", "", t)
    t = re.sub(r"\s*\((epub|pdf|mobi|azw3?)\)\s*$", "", t, flags=re.I)
    return t.strip()


def candidate_titles(stem):
    """Filenames put the author first as often as last ("Women in Love -
    D H Lawrence" vs "David Herbert Lawrence - Women in Love"), and guessing
    which half is the title from the string alone is unreliable. So offer
    every plausible reading and let a unique catalogue hit decide — a wrong
    guess simply fails to match rather than mislabelling a book."""
    out = []
    base = _strip_noise(stem)
    out.append(base)
    out.append(stem.strip())
    parts = [p.strip() for p in re.split(r"\s+[-–—]\s+", base) if p.strip()]
    if len(parts) >= 2 and re.fullmatch(r"\d+(\.\d+)?", parts[0]):
        parts.pop(0)
    if len(parts) >= 2:
        out.append(" ".join(parts[:-1]))   # author trails
        out.append(" ".join(parts[1:]))    # author leads
        out.append(parts[0])
        out.append(parts[-1])
    seen, uniq = set(), []
    for t in out:
        k = norm(t)
        if k and k not in seen:
            seen.add(k)
            uniq.append(k)
    return uniq


def main():
    apply = "--apply" in sys.argv
    books = json.load(open(CAT))

    # Catalogue index: normalised title -> entries. Format is used to break
    # ties, since the same work often exists as both EPUB and MOBI.
    by_title = defaultdict(list)
    for b in books:
        by_title[norm(b["title"])].append(b)

    have = {f[:-4] for f in os.listdir(SRC) if f.endswith(".jpg")}
    print("extracted covers: %d" % len(have))

    exact = ambiguous = unmatched = nocover = 0
    dup_applied = [0]
    mapping = {}
    for dirpath, _dirs, names in os.walk(ROOT):
        for n in names:
            if not EBOOK_RE.search(n):
                continue
            fid = drive_id(os.path.join(dirpath, n))
            if not fid or fid not in have:
                nocover += 1
                continue
            stem, ext = os.path.splitext(n)
            fmt = ext.lstrip(".").upper()
            cands = []
            for key in candidate_titles(stem):
                hit = by_title.get(key)
                if hit:
                    cands = hit
                    break
            if not cands:
                unmatched += 1
                continue
            same_fmt = [c for c in cands if (c.get("format") or "").upper() == fmt]
            pick = same_fmt or cands
            if len(pick) > 1:
                # The catalogue holds 10,115 records for 8,250 unique titles,
                # so several entries sharing a title AND a format are nearly
                # always duplicate records of one work — the same cover is
                # right for all of them. Only distinctive titles qualify: a
                # title like "31" or "100 Bullets 002" really could be two
                # different books, and there wrong art is worse than none.
                key = norm(pick[0]["title"])
                if len(key) >= 10 and re.search(r"[a-z]{4}", key):
                    for c in pick:
                        mapping[c["id"]] = fid
                    dup_applied[0] += len(pick)
                else:
                    ambiguous += 1
                continue
            mapping[pick[0]["id"]] = fid
            exact += 1

    print("matched   : %d" % exact)
    print("dup records covered: %d" % dup_applied[0])
    print("ambiguous : %d" % ambiguous)
    print("unmatched : %d" % unmatched)
    print("no cover  : %d" % nocover)
    already = sum(1 for b in books if b["id"] in have)
    print("id already matched catalogue: %d" % already)
    total = len(set(mapping) | {b["id"] for b in books if b["id"] in have})
    print("=> catalogue entries that will have art: %d / %d (%.0f%%)"
          % (total, len(books), 100.0 * total / len(books)))

    if not apply:
        print("\n(dry run — pass --apply to write)")
        return
    os.makedirs(DEST, exist_ok=True)
    written = 0
    for cat_id, local_id in mapping.items():
        shutil.copyfile(os.path.join(SRC, local_id + ".jpg"),
                        os.path.join(DEST, cat_id + ".jpg"))
        written += 1
    for b in books:                       # IDs that already lined up
        if b["id"] in have and not os.path.exists(os.path.join(DEST, b["id"] + ".jpg")):
            shutil.copyfile(os.path.join(SRC, b["id"] + ".jpg"),
                            os.path.join(DEST, b["id"] + ".jpg"))
            written += 1
    print("wrote %d files to %s" % (written, DEST))


if __name__ == "__main__":
    main()
