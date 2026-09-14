#!/usr/bin/env python3
"""Typographic covers for the books that have no art anywhere.

Only for books where the file contains no image AND Open Library has nothing -
93 of 8,782. Run probe_ol.py first: a generated cover is stored locally and
local art beats the Open Library fallback, so generating one for a book that
has a real cover available would be a downgrade.

The look is a cloth-bound hardback: a muted board colour, a blind-stamped rule,
the title in serif and the author below it. The colour is derived from the
title's hash, so a book always gets the same board and the shelf looks varied
rather than random.
"""
import hashlib, json, os, sys, textwrap

from PIL import Image, ImageDraw, ImageFont

CAT = "/opt/reading-room/current/site/catalog.json"
COVERS = "/mnt/seagate/ReadingRoom/covers"
PROBE = "/mnt/seagate/ReadingRoom/ol-probe.json"

W, H = 600, 900
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

# Book-cloth colours: desaturated, mid-to-dark, all readable under cream ink.
BOARDS = [
    (74, 59, 56), (56, 68, 74), (66, 74, 58), (86, 62, 58), (58, 62, 82),
    (92, 76, 52), (63, 50, 68), (48, 72, 68), (80, 58, 72), (54, 58, 60),
    (96, 70, 46), (44, 64, 58),
]
INK = (238, 231, 217)


import re

# Scanner debris that belongs on no book jacket: "{Stephen King & Peter
# Straub}(2026, Scribner){115851430} libgen.li". Cleaned for the artwork only -
# the catalogue keeps whatever it holds.
DEBRIS = [
    (re.compile(r"\{[^}]*\}"), " "),
    # Any parenthetical carrying a year or a comma is publication data, not
    # part of the title: "(2026, Scribner)", "(1932 Pulitzer)".
    (re.compile(r"\([^)]*(?:\d{4}|,)[^)]*\)"), " "),
    (re.compile(r"\b(?:libgen(?:\.\w+)?|z-?lib(?:\.org)?|retail|calibre|www\.[^\s]+)\b", re.I), " "),
    (re.compile(r"\s*[-–—]\s*$"), ""),
    (re.compile(r"\s+"), " "),
]
# Filenames sanitise "." out of initials, leaving "E. M_ Forster".
INITIAL_US = re.compile(r"\b([A-Z])_(?=\s|$)")


def tidy(text, is_name=False):
    text = INITIAL_US.sub(r"\1.", text) if is_name else text.replace("_", " ")
    for pat, rep in DEBRIS:
        text = pat.sub(rep, text)
    return text.strip(" -–—_.,") if not is_name else text.strip(" -–—_,")


def board_for(seed):
    # Two bytes, so neighbouring titles do not land on the same board and the
    # shelf reads as varied rather than as one colour repeated.
    h = hashlib.sha1(seed.encode("utf-8", "ignore")).digest()
    return BOARDS[(h[0] << 8 | h[7]) % len(BOARDS)]


def fit(draw, text, font_path, max_w, start, min_size, max_lines):
    """Largest size at which text wraps into max_lines within max_w."""
    size = start
    while size >= min_size:
        font = ImageFont.truetype(font_path, size)
        avg = max(1, draw.textlength("abcdefghij", font=font) / 10)
        lines = textwrap.wrap(text, width=max(8, int(max_w / avg)))
        if len(lines) <= max_lines and all(
                draw.textlength(l, font=font) <= max_w for l in lines):
            return font, lines
        size -= 2
    font = ImageFont.truetype(font_path, min_size)
    lines = textwrap.wrap(text, width=max(8, int(max_w / 12)))[:max_lines]
    return font, lines


def render(title, author):
    author = tidy(author or "", is_name=True)
    title = tidy(title or "")
    # "A Room with a View - E. M. Forster": the filename repeated the author
    # and the scanner kept it. On a jacket the byline appears once.
    if author:
        title = re.sub(r"\s*[-–—]\s*" + re.escape(author) + r"\s*$", "", title,
                       flags=re.I).strip(" -–—_.,") or title
    bg = board_for(title or author or "untitled")
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)

    # Blind-stamped double rule, as on a cloth binding.
    light = tuple(min(255, c + 26) for c in bg)
    d.rectangle([38, 38, W - 39, H - 39], outline=light, width=2)
    d.rectangle([48, 48, W - 49, H - 49], outline=tuple(max(0, c - 14) for c in bg), width=1)

    inner = W - 150
    tfont, tlines = fit(d, title or "Untitled", SERIF_BOLD, inner, 60, 26, 5)
    afont = ImageFont.truetype(SERIF, 27)

    th = sum(tfont.size + 14 for _ in tlines)
    y = (H - th) / 2 - 60
    for line in tlines:
        d.text(((W - d.textlength(line, font=tfont)) / 2, y), line,
               font=tfont, fill=INK)
        y += tfont.size + 14

    if author:
        y += 34
        d.line([(W / 2 - 44, y), (W / 2 + 44, y)], fill=light, width=2)
        y += 26
        _, alines = fit(d, author, SERIF, inner, 27, 17, 2)
        for line in alines:
            d.text(((W - d.textlength(line, font=afont)) / 2, y), line,
                   font=afont, fill=tuple(int(c * 0.82 + 30) for c in INK))
            y += afont.size + 8
    return im


def main():
    apply = "--apply" in sys.argv
    cat = json.load(open(CAT))
    have = {n[:-4] for n in os.listdir(COVERS) if n.endswith(".jpg")}
    probe = json.load(open(PROBE)) if os.path.exists(PROBE) else {}

    todo = [b for b in cat
            if b["id"] not in have and probe.get(b["id"]) not in ("200", "302")]
    print(f"books needing generated art: {len(todo)}")
    if not apply:
        for b in todo[:15]:
            print(f"  {(b.get('title') or '')[:50]:50} | {(b.get('author') or '')[:26]}")
        print("(dry run - pass --apply to write)")
        return

    made = 0
    for b in todo:
        try:
            im = render((b.get("title") or "").strip(), (b.get("author") or "").strip())
            tmp = os.path.join(COVERS, b["id"] + ".jpg.tmp")
            im.save(tmp, "JPEG", quality=88, optimize=True, progressive=True)
            os.replace(tmp, os.path.join(COVERS, b["id"] + ".jpg"))
            made += 1
        except Exception as e:
            print(f"  failed {b['id']}: {type(e).__name__}: {e}")
    print(f"generated: {made}")


if __name__ == "__main__":
    main()
