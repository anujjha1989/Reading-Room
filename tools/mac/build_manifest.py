#!/usr/bin/env python3
"""Build an rclone-style manifest of the Entertainment folder from Finder.

The catalogue's file IDs are stale: of 10,115 entries only 1,510 exist in the
Drive folder, and for "The Complete Works of Salman Rushdie" all three
catalogue IDs are dead while the one real file carries a fourth ID entirely.
Files were re-uploaded over time and the scanner only ever appended, never
reconciled — it matches on `existingIds`, so a re-uploaded file looks new and
the dead entry is never removed.

Rather than reimplement the metadata rules, this emits the same manifest shape
reading-room-drive-scan.mjs already consumes ({Path, ID, ModTime, IsDir}), so
that script can rebuild the catalogue from an empty starting point using its
own title/author/series/category derivation, unchanged.

The Finder mirror is authoritative for both liveness and IDs: trashed files
don't sync, and each file carries its real Drive ID in an extended attribute.
"""
import ctypes, datetime, json, os

ROOT = "/Users/anuj-mac/Library/CloudStorage/GoogleDrive-anujjha1989@gmail.com/My Drive/Entertainment"
OUT = "/tmp/rr/manifest.json"
# Exactly the set reading-room-drive-scan.mjs supports.
SUPPORTED = {"EPUB", "PDF", "MOBI", "AZW", "AZW3", "CBR", "CBZ",
             "DOC", "DOCX", "RTF", "TXT", "FDX"}
# It only ingests these two trees; Audiobooks and Music are not the library.
TOP = ("Books", "Scripts")

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


rows, skipped_noid, skipped_ext = [], 0, 0
for top in TOP:
    base = os.path.join(ROOT, top)
    if not os.path.isdir(base):
        continue
    for dirpath, dirs, names in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith(".") and not d.endswith(".app")]
        for n in names:
            if n.startswith("."):
                continue
            ext = os.path.splitext(n)[1].lstrip(".").upper()
            if ext not in SUPPORTED:
                skipped_ext += 1
                continue
            full = os.path.join(dirpath, n)
            fid = drive_id(full)
            if not fid:
                skipped_noid += 1
                continue
            try:
                mtime = os.path.getmtime(full)
            except OSError:
                continue
            rows.append({
                "Path": os.path.relpath(full, ROOT).replace(os.sep, "/"),
                "ID": fid,
                "ModTime": datetime.datetime.utcfromtimestamp(mtime)
                            .replace(microsecond=0).isoformat() + "Z",
                "IsDir": False,
            })

# The scanner asserts globally unique IDs. Drive can expose the same file in
# two places (a shortcut, or the same object in two folders); keep the first.
seen, uniq = set(), []
dupes = 0
for r in rows:
    if r["ID"] in seen:
        dupes += 1
        continue
    seen.add(r["ID"])
    uniq.append(r)

json.dump(uniq, open(OUT, "w"))
print("manifest rows      : %d" % len(uniq))
print("  duplicate IDs    : %d (dropped)" % dupes)
print("  skipped, no ID   : %d" % skipped_noid)
print("  skipped, non-book: %d" % skipped_ext)
import collections
for k, v in collections.Counter(r["Path"].split("/")[0] for r in uniq).most_common():
    print("  %-10s %d" % (k, v))
for k, v in collections.Counter(
        os.path.splitext(r["Path"])[1].lstrip(".").upper() for r in uniq).most_common():
    print("    %-6s %d" % (k, v))
print("wrote %s" % OUT)
