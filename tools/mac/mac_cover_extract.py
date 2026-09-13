#!/usr/bin/env python3
"""Extract cover art from the locally-synced Google Drive mirror.

The Pi had to pull each book over HTTP, and Drive throttles that endpoint so
hard (an observed 404 took 61 seconds) that the job ran at ~43 covers/hour —
days of work. The same books are already on this Mac via Google Drive Desktop,
and each file carries its Drive file ID in the `com.google.drivefs.item-id`
extended attribute, so local files map exactly onto catalogue entries.

Same extraction logic as the Pi-side tool, at disk speed:
  EPUB      the archive entry named "cover", else the largest image
  CBZ/CBR   page one — the first image in reading order
  MOBI/AZW3 the image record pointed at by EXTH tag 201

Output is <driveId>.jpg at 400px wide, ready to drop straight into the Pi's
cover directory, where standalone-server.mjs already serves them.
"""
import ctypes, io, os, re, struct, subprocess, sys, time, zipfile
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

ROOT = "/Users/anuj-mac/Library/CloudStorage/GoogleDrive-anujjha1989@gmail.com/My Drive/Entertainment/Books"
OUT = "/tmp/rr/covers-out"
TARGET_W = 400
JPEG_Q = 82
MIN_BYTES = 1200
IMG_RE = re.compile(r"\.(jpe?g|png|gif|webp)$", re.I)
EBOOK_RE = re.compile(r"\.(epub|cbz|cbr|mobi|azw3|azw)$", re.I)

_libc = ctypes.CDLL("libc.dylib", use_errno=True)
# ssize_t getxattr(const char *path, const char *name, void *value,
#                  size_t size, u_int32_t position, int options);
# Without explicit types ctypes truncates the return to int and mangles the
# 64-bit size argument, which silently yields "no attribute" for every file.
_libc.getxattr.restype = ctypes.c_ssize_t
_libc.getxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p,
                           ctypes.c_size_t, ctypes.c_uint32, ctypes.c_int]

# The "#S" is part of the real attribute name, not display decoration:
# `xattr -l` prints it as a type annotation, but `xattr` lists the name with
# the suffix attached, and getxattr only answers to the full string.
XATTR_NAME = b"com.google.drivefs.item-id#S"


def drive_id(path):
    """Read com.google.drivefs.item-id without a subprocess per file."""
    p = path.encode()
    size = _libc.getxattr(p, XATTR_NAME, None, 0, 0, 0)
    if size <= 0:
        return None
    buf = ctypes.create_string_buffer(size)
    got = _libc.getxattr(p, XATTR_NAME, buf, size, 0, 0)
    if got <= 0:
        return None
    return buf.raw[:got].decode("ascii", "replace").strip()


def pick(names_sizes, is_comic):
    imgs = [(n, s) for n, s in names_sizes if IMG_RE.search(n) and s >= MIN_BYTES]
    if not imgs:
        return None
    if is_comic:
        return sorted(imgs, key=lambda t: t[0].lower())[0][0]
    named = [t for t in imgs if "cover" in t[0].lower()]
    if named:
        return max(named, key=lambda t: t[1])[0]
    return max(imgs, key=lambda t: t[1])[0]


def from_zip(path, is_comic):
    with zipfile.ZipFile(path) as zf:
        name = pick([(i.filename, i.file_size) for i in zf.infolist()], is_comic)
        if not name:
            raise RuntimeError("no image entries")
        return zf.read(name)


def from_rar(path):
    """libarchive (bsdtar) reads RAR; CBRs are just comics in a rar."""
    listing = subprocess.run(["bsdtar", "-tf", path], capture_output=True,
                             timeout=120).stdout.decode("utf-8", "replace")
    names = [n for n in listing.splitlines() if IMG_RE.search(n)]
    if not names:
        raise RuntimeError("no image entries")
    first = sorted(names, key=str.lower)[0]
    out = subprocess.run(["bsdtar", "-xOf", path, first], capture_output=True, timeout=180)
    if not out.stdout:
        raise RuntimeError("rar extract produced nothing")
    return out.stdout


def from_mobi(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 78:
        raise RuntimeError("short mobi")
    nrec = struct.unpack(">H", data[76:78])[0]
    if not 1 <= nrec < 12000 or len(data) < 78 + nrec * 8:
        raise RuntimeError("bad record table")
    offs = [struct.unpack(">I", data[78 + i * 8:82 + i * 8])[0] for i in range(nrec)]
    rec0 = data[offs[0]:]
    if rec0[16:20] != b"MOBI":
        raise RuntimeError("no MOBI header")
    hdr_len = struct.unpack(">I", rec0[20:24])[0]
    first_image = struct.unpack(">I", rec0[108:112])[0]
    if not struct.unpack(">I", rec0[128:132])[0] & 0x40:
        raise RuntimeError("no EXTH")
    exth = rec0[16 + hdr_len:]
    if exth[:4] != b"EXTH":
        raise RuntimeError("EXTH not where expected")
    count = struct.unpack(">I", exth[8:12])[0]
    pos, rel = 12, None
    for _ in range(min(count, 500)):
        if pos + 8 > len(exth):
            break
        rtype, rlen = struct.unpack(">II", exth[pos:pos + 8])
        if rlen < 8:
            break
        if rtype == 201 and rlen == 12:
            rel = struct.unpack(">I", exth[pos + 8:pos + 12])[0]
            break
        pos += rlen
    if rel is None or rel == 0xFFFFFFFF:
        raise RuntimeError("no EXTH 201")
    rec = first_image + rel
    if rec + 1 >= len(offs):
        raise RuntimeError("cover record out of range")
    return data[offs[rec]:offs[rec + 1]]


counts = {"ok": 0, "fail": 0, "skip": 0, "noid": 0}
reasons = {}


def handle(path):
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    fid = drive_id(path)
    if not fid:
        counts["noid"] += 1
        return
    dest = os.path.join(OUT, fid + ".jpg")
    if os.path.exists(dest):
        counts["skip"] += 1
        return
    try:
        if ext == "epub":
            data = from_zip(path, False)
        elif ext == "cbz":
            data = from_zip(path, True)
        elif ext == "cbr":
            data = from_rar(path)
        elif ext in ("mobi", "azw3", "azw"):
            data = from_mobi(path)
        else:
            counts["skip"] += 1
            return
        img = Image.open(io.BytesIO(data))
        img.load()
        if img.width < 80 or img.height < 80:
            raise RuntimeError("too small (%dx%d)" % (img.width, img.height))
        if img.width > TARGET_W:
            h = max(1, round(img.height * TARGET_W / img.width))
            img = img.resize((TARGET_W, h), Image.LANCZOS)
        tmp = dest + ".tmp"
        img.convert("RGB").save(tmp, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
        os.replace(tmp, dest)
        counts["ok"] += 1
    except Exception as e:
        counts["fail"] += 1
        key = "%s: %s" % (ext, str(e)[:44])
        reasons[key] = reasons.get(key, 0) + 1


def main():
    os.makedirs(OUT, exist_ok=True)
    files = []
    for dirpath, _dirs, names in os.walk(ROOT):
        for n in names:
            if EBOOK_RE.search(n):
                files.append(os.path.join(dirpath, n))
    print("found %d book files" % len(files), flush=True)

    t0 = time.time()
    done = [0]

    def wrapped(p):
        handle(p)
        done[0] += 1
        if done[0] % 250 == 0:
            print("  %d/%d  ok=%d fail=%d skip=%d noid=%d  %.0f/min"
                  % (done[0], len(files), counts["ok"], counts["fail"],
                     counts["skip"], counts["noid"],
                     done[0] / max(1e-9, (time.time() - t0) / 60)), flush=True)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(wrapped, files))

    print("\nDONE in %.1f min: ok=%d fail=%d skip=%d noid=%d"
          % ((time.time() - t0) / 60, counts["ok"], counts["fail"],
             counts["skip"], counts["noid"]), flush=True)
    print("top failure reasons:", flush=True)
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])[:12]:
        print("  %5d  %s" % (v, k), flush=True)


if __name__ == "__main__":
    main()
