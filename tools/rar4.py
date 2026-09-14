"""Minimal RAR4 reader - enough to pull the first page out of a .cbr.

The Pi has no unrar binary and no way to install one without root, but comic
archives almost always store their pages with method 0x30 ("stored"), because
JPEG/PNG data is already compressed and RAR gains nothing by squeezing it
again. Stored entries need no decompression at all: the bytes in the archive
are the file. So this walks the block headers, finds the first image entry that
is stored, and slices it straight out.

Anything genuinely compressed is reported as such rather than guessed at.
"""
import struct

MARKER = b"Rar!\x1a\x07\x00"
IMG = (".jpg", ".jpeg", ".png", ".gif", ".webp")


def entries(fh):
    """Yield (name, method, data_offset, packed_size) for each file block."""
    head = fh.read(7)
    if head != MARKER:
        return
    pos = 7
    while True:
        fh.seek(pos)
        base = fh.read(7)
        if len(base) < 7:
            return
        _crc, htype, flags, hsize = struct.unpack("<HBHH", base)
        if hsize < 7:
            return
        add = 0
        if flags & 0x8000:
            raw = fh.read(4)
            if len(raw) < 4:
                return
            add = struct.unpack("<I", raw)[0]
        if htype == 0x74:                       # file header
            rest = fh.read(hsize - 11)
            if len(rest) < 21:
                return
            packed = add
            method = rest[14]
            name_size = struct.unpack("<H", rest[15:17])[0]
            p = 21
            if flags & 0x100:                   # 64-bit sizes
                if len(rest) >= p + 8:
                    packed |= struct.unpack("<I", rest[p:p + 4])[0] << 32
                p += 8
            name = rest[p:p + name_size].split(b"\x00")[0].decode("utf-8", "ignore")
            yield name, method, pos + hsize, packed
            pos += hsize + packed
        else:
            pos += hsize + add
        if htype == 0x7B:                       # end of archive
            return


def first_image(path):
    """Bytes of the first stored image, or None."""
    with open(path, "rb") as fh:
        found = []
        for name, method, off, size in entries(fh):
            if name.lower().endswith(IMG) and size > 0:
                found.append((name, method, off, size))
        if not found:
            return None
        found.sort(key=lambda t: t[0].lower())
        for name, method, off, size in found:
            if method == 0x30:                  # stored: no decompression
                fh.seek(off)
                return fh.read(size)
    return None
