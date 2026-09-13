#!/usr/bin/env python3
"""The Reading Room — extract cover art from the books themselves.

Open Library resolves about a third of this catalogue: 5,059 of 7,404
attempted lookups are known misses, because 3,991 books have no author and
2,114 have filename-derived titles.  No lookup service can match
"0f 8 - Gotham Knights #056".

But the art is already inside the files.  An EPUB carries its cover in the
archive; a CBZ's first page IS the cover; a MOBI stores it as an image record
pointed at by EXTH tag 201.  This reads it straight out of the book.

Cost model: Drive's latency is ~20-25s per request and barely varies with
size, so request COUNT dominates, not bytes.  An average EPUB or MOBI is
about a megabyte, so fetching the whole file in one request beats three
ranged reads by roughly 3x.  Big archives (CBZ, often 20-80MB) are not worth
downloading whole, so those use the ranged path: tail read for the zip
central directory, then one read of the first page.

Covers land in /mnt/seagate/ReadingRoom/covers/<driveId>.jpg at 400px wide.
standalone-server.mjs serves that file directly when it exists, so a cover
becomes one local file read instead of a WAN redirect to Google or
Open Library.

Resumable: an existing output file, or a recorded permanent failure, is
skipped.  Safe to re-run, safe to kill at any point.
"""
import io, json, os, re, struct, sys, threading, time, zipfile, zlib
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

CATALOG   = "/tmp/rrstage/catalog.json"
OUT_DIR   = "/mnt/seagate/ReadingRoom/covers"
STATE     = "/mnt/seagate/ReadingRoom/covers/.extract-state.json"
LOG       = "/mnt/seagate/ReadingRoom/covers/.extract.log"
UA        = "Mozilla/5.0 (compatible; ReadingRoomCoverBot/1)"
WORKERS   = 12
TARGET_W  = 400
JPEG_Q    = 82
MIN_BYTES = 1200            # smaller than this is a spacer, not a cover
WHOLE_CAP = 12 * 1024 * 1024  # read whole files up to here; range-read above

ZIP_FORMATS  = {"EPUB", "CBZ"}
MOBI_FORMATS = {"MOBI", "AZW", "AZW3"}
IMG_RE = re.compile(r"\.(jpe?g|png|gif|webp)$", re.I)

state_lock = threading.Lock()
log_lock = threading.Lock()
counts = {"ok": 0, "fail": 0, "skip": 0, "bytes": 0, "reqs": 0}
state = {}
t0 = time.time()


def log(msg):
    with log_lock:
        line = time.strftime("%H:%M:%S ") + msg
        print(line, flush=True)
        try:
            with open(LOG, "a") as fh:
                fh.write(line + "\n")
        except OSError:
            pass


def drive_url(fid):
    return "https://drive.google.com/uc?export=download&confirm=t&id=" + fid


def _open(fid, headers, timeout):
    req = urllib.request.Request(drive_url(fid), headers=dict(headers, **{"User-Agent": UA}))
    counts["reqs"] += 1
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_range(fid, start=None, end=None, tail=None, timeout=60):
    headers = {}
    if tail is not None:
        headers["Range"] = "bytes=-%d" % tail
    elif start is not None:
        headers["Range"] = "bytes=%d-%s" % (start, "" if end is None else end)
    with _open(fid, headers, timeout) as r:
        if "text/html" in (r.headers.get("content-type") or ""):
            raise RuntimeError("drive returned html (quota or permissions)")
        data = r.read()
        counts["bytes"] += len(data)
        total = None
        cr = r.headers.get("content-range")
        if cr and "/" in cr:
            try: total = int(cr.rsplit("/", 1)[1])
            except ValueError: pass
        return data, total


def fetch_whole(fid, cap=WHOLE_CAP, timeout=120):
    """Whole file in one request.  Returns None if it exceeds `cap` — we stop
    reading rather than pull 80MB of comic to get one page."""
    with _open(fid, {}, timeout) as r:
        if "text/html" in (r.headers.get("content-type") or ""):
            raise RuntimeError("drive returned html (quota or permissions)")
        length = r.headers.get("content-length")
        if length and int(length) > cap:
            return None
        buf = io.BytesIO()
        while True:
            chunk = r.read(262144)
            if not chunk:
                break
            buf.write(chunk)
            if buf.tell() > cap:
                return None
        counts["bytes"] += buf.tell()
        return buf.getvalue()


# ----------------------------------------------------------------- zip -----
def pick_zip_name(names_sizes, is_comic):
    imgs = [(n, s) for n, s in names_sizes if IMG_RE.search(n) and s >= MIN_BYTES]
    if not imgs:
        return None
    if is_comic:
        # Page one is the cover; archives are in reading order by name.
        return sorted(imgs, key=lambda t: t[0].lower())[0][0]
    named = [t for t in imgs if "cover" in t[0].lower()]
    if named:
        return max(named, key=lambda t: t[1])[0]
    # Nothing named: the largest image in an ebook is almost always the cover.
    return max(imgs, key=lambda t: t[1])[0]


def zip_cover_local(data, is_comic):
    zf = zipfile.ZipFile(io.BytesIO(data))
    pick = pick_zip_name([(i.filename, i.file_size) for i in zf.infolist()], is_comic)
    if not pick:
        raise RuntimeError("no image entries")
    return zf.read(pick)


def zip_cover_ranged(fid, is_comic):
    """For archives too big to download: read the central directory from the
    tail, then just the one entry we want."""
    tail, total = fetch_range(fid, tail=65536)
    idx = tail.rfind(b"PK\x05\x06")
    if idx < 0:
        raise RuntimeError("no zip EOCD")
    cd_size, cd_off = struct.unpack("<II", tail[idx + 12:idx + 20])
    if cd_size == 0xFFFFFFFF or cd_off == 0xFFFFFFFF:
        raise RuntimeError("zip64 unsupported")
    window_start = (total - len(tail)) if total else None
    if window_start is not None and cd_off >= window_start:
        cd = tail[cd_off - window_start: cd_off - window_start + cd_size]
    else:
        cd, _ = fetch_range(fid, cd_off, cd_off + cd_size - 1)

    entries, pos = [], 0
    while pos + 46 <= len(cd) and cd[pos:pos + 4] == b"PK\x01\x02":
        method = struct.unpack("<H", cd[pos + 10:pos + 12])[0]
        csize, usize = struct.unpack("<II", cd[pos + 20:pos + 28])
        nlen, elen, clen = struct.unpack("<HHH", cd[pos + 28:pos + 34])
        lho = struct.unpack("<I", cd[pos + 42:pos + 46])[0]
        name = cd[pos + 46:pos + 46 + nlen].decode("utf-8", "replace")
        entries.append({"name": name, "method": method, "csize": csize,
                        "usize": usize, "offset": lho})
        pos += 46 + nlen + elen + clen
    if not entries:
        raise RuntimeError("empty central directory")

    pick_name = pick_zip_name([(e["name"], e["usize"]) for e in entries], is_comic)
    if not pick_name:
        raise RuntimeError("no image entries")
    e = next(x for x in entries if x["name"] == pick_name)

    head, _ = fetch_range(fid, e["offset"], e["offset"] + 29)
    if head[:4] != b"PK\x03\x04":
        raise RuntimeError("bad local header")
    nlen, elen = struct.unpack("<HH", head[26:30])
    start = e["offset"] + 30 + nlen + elen
    raw, _ = fetch_range(fid, start, start + e["csize"] - 1)
    if e["method"] == 0:
        return raw
    if e["method"] == 8:
        return zlib.decompressobj(-15).decompress(raw)
    raise RuntimeError("zip method %d" % e["method"])


# ---------------------------------------------------------------- mobi -----
def mobi_cover_local(data):
    """PalmDB record table -> MOBI header -> EXTH 201 -> the image record."""
    if len(data) < 78:
        raise RuntimeError("short mobi")
    nrec = struct.unpack(">H", data[76:78])[0]
    if not 1 <= nrec < 12000 or len(data) < 78 + nrec * 8:
        raise RuntimeError("bad record table")
    offsets = [struct.unpack(">I", data[78 + i * 8: 82 + i * 8])[0] for i in range(nrec)]

    rec0 = data[offsets[0]:]
    if rec0[16:20] != b"MOBI":
        raise RuntimeError("no MOBI header")
    hdr_len = struct.unpack(">I", rec0[20:24])[0]
    first_image = struct.unpack(">I", rec0[108:112])[0]
    exth_flags = struct.unpack(">I", rec0[128:132])[0]
    if not exth_flags & 0x40:
        raise RuntimeError("no EXTH")

    exth = rec0[16 + hdr_len:]
    if exth[:4] != b"EXTH":
        raise RuntimeError("EXTH not where expected")
    count = struct.unpack(">I", exth[8:12])[0]
    pos, cover_rel = 12, None
    for _ in range(min(count, 500)):
        if pos + 8 > len(exth):
            break
        rtype, rlen = struct.unpack(">II", exth[pos:pos + 8])
        if rlen < 8:
            break
        if rtype == 201 and rlen == 12:
            cover_rel = struct.unpack(">I", exth[pos + 8:pos + 12])[0]
            break
        pos += rlen
    if cover_rel is None or cover_rel == 0xFFFFFFFF:
        raise RuntimeError("no EXTH 201")

    rec = first_image + cover_rel
    if rec + 1 >= len(offsets):
        raise RuntimeError("cover record out of range")
    return data[offsets[rec]:offsets[rec + 1]]


# ---------------------------------------------------------------- save -----
def save(fid, data):
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.width < 80 or img.height < 80:
        raise RuntimeError("too small to be a cover (%dx%d)" % (img.width, img.height))
    if img.width > TARGET_W:
        h = max(1, round(img.height * TARGET_W / img.width))
        img = img.resize((TARGET_W, h), Image.LANCZOS)
    tmp = os.path.join(OUT_DIR, "." + fid + ".tmp")
    img.convert("RGB").save(tmp, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    os.replace(tmp, os.path.join(OUT_DIR, fid + ".jpg"))


def handle(book):
    fid = book["id"]
    fmt = (book.get("format") or "").upper()
    dest = os.path.join(OUT_DIR, fid + ".jpg")
    if os.path.exists(dest) or state.get(fid) == "fail":
        counts["skip"] += 1
        return
    try:
        if fmt in ZIP_FORMATS:
            is_comic = fmt == "CBZ"
            whole = None
            if not is_comic:                     # ebooks: usually ~1MB, one request
                whole = fetch_whole(fid)
            data = zip_cover_local(whole, is_comic) if whole is not None \
                else zip_cover_ranged(fid, is_comic)
        elif fmt in MOBI_FORMATS:
            whole = fetch_whole(fid)
            if whole is None:
                raise RuntimeError("mobi over size cap")
            data = mobi_cover_local(whole)
        else:
            counts["skip"] += 1
            return
        save(fid, data)
        counts["ok"] += 1
        if counts["ok"] % 25 == 0:
            rate = counts["ok"] / max(1e-9, (time.time() - t0) / 3600)
            log("ok=%d fail=%d skip=%d  %.0f MB  %.0f/hr"
                % (counts["ok"], counts["fail"], counts["skip"],
                   counts["bytes"] / 1e6, rate))
    except Exception as e:
        counts["fail"] += 1
        with state_lock:
            state[fid] = "fail"
            if counts["fail"] % 50 == 0:
                try: json.dump(state, open(STATE, "w"))
                except OSError: pass
        if counts["fail"] % 25 == 0:
            log("  fail #%d %s %s: %s" % (counts["fail"], fmt, fid[:12], str(e)[:70]))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    global state
    if os.path.exists(STATE):
        try: state = json.load(open(STATE))
        except Exception: state = {}

    books = json.load(open(CATALOG))
    only = set(a.upper() for a in sys.argv[1:] if a.isalpha())
    todo = [b for b in books
            if (b.get("format") or "").upper() in (only or (ZIP_FORMATS | MOBI_FORMATS))]
    # Cheapest and most numerous first, so the visible win lands early.
    order = {"EPUB": 0, "MOBI": 1, "CBZ": 2, "AZW3": 3, "AZW": 4}
    todo.sort(key=lambda b: order.get((b.get("format") or "").upper(), 9))
    log("start: %d candidates, %d workers" % (len(todo), WORKERS))

    try:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(handle, todo))
    finally:
        with state_lock:
            try: json.dump(state, open(STATE, "w"))
            except OSError: pass
        log("done: ok=%d fail=%d skip=%d  %.0f MB in %d requests"
            % (counts["ok"], counts["fail"], counts["skip"],
               counts["bytes"] / 1e6, counts["reqs"]))


if __name__ == "__main__":
    main()
