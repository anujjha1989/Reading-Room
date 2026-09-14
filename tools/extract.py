#!/usr/bin/env python3
"""Reading Room - pull a cover image and real metadata out of every book file.

Everything is read straight from the file on disk: no Drive calls, no Calibre
subprocess per book (ebook-meta costs a second of process startup each time,
which is hours across 8,782 books). EPUB and CBZ are zips, MOBI/AZW3 is a Palm
database with an EXTH metadata block, PDF goes through poppler.

Writes:
  covers/<id>.jpg     normalised JPEG, long edge 800px
  meta.jsonl          one {id,title,author,source} per book, appended

Resumable: a book whose cover already exists and whose id is already in
meta.jsonl is skipped, so this can be killed and restarted freely.
"""
import io, json, os, re, struct, subprocess, sys, tempfile, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed

from PIL import Image

CAT = "/opt/reading-room/current/site/catalog.json"
MAP = "/mnt/seagate/ReadingRoom/local-files.json"
COVERS = "/mnt/seagate/ReadingRoom/covers"
META = "/mnt/seagate/ReadingRoom/meta.jsonl"

MAX_EDGE = 800
IMG_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp")


# ---------------------------------------------------------------- EPUB

def epub(path):
    """(cover_bytes, title, author) from an EPUB."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        opf_name = None
        try:
            root = ET.fromstring(z.read("META-INF/container.xml"))
            for rf in root.iter():
                if rf.tag.endswith("rootfile") and rf.get("full-path"):
                    opf_name = rf.get("full-path")
                    break
        except Exception:
            pass
        if not opf_name:
            opf_name = next((n for n in names if n.lower().endswith(".opf")), None)
        title = author = None
        cover = None
        if opf_name:
            base = os.path.dirname(opf_name)
            try:
                opf = ET.fromstring(z.read(opf_name))
            except Exception:
                opf = None
            if opf is not None:
                manifest, cover_id, props_cover = {}, None, None
                for el in opf.iter():
                    tag = el.tag.split("}")[-1]
                    if tag == "title" and not title and (el.text or "").strip():
                        title = el.text.strip()
                    elif tag == "creator" and not author and (el.text or "").strip():
                        author = el.text.strip()
                    elif tag == "meta" and el.get("name") == "cover":
                        cover_id = el.get("content")
                    elif tag == "item":
                        manifest[el.get("id")] = (el.get("href"), el.get("properties") or "")
                        if "cover-image" in (el.get("properties") or ""):
                            props_cover = el.get("href")
                for href in (props_cover,
                             manifest.get(cover_id, (None, ""))[0] if cover_id else None):
                    if not href:
                        continue
                    full = os.path.normpath(os.path.join(base, href)).replace(os.sep, "/")
                    if full in names:
                        cover = z.read(full)
                        break
        if cover is None:
            # Fall back to the biggest image that looks like a cover, then to
            # the biggest image at all - front matter is usually the largest.
            imgs = [n for n in names if n.lower().endswith(IMG_EXT)]
            if imgs:
                named = [n for n in imgs if "cover" in n.lower()]
                pick = max(named or imgs, key=lambda n: z.getinfo(n).file_size)
                cover = z.read(pick)
    return cover, title, author


# ---------------------------------------------------------------- MOBI / AZW3

def _palm_records(data):
    count = struct.unpack(">H", data[76:78])[0]
    offs = [struct.unpack(">I", data[78 + i * 8: 82 + i * 8])[0] for i in range(count)]
    offs.append(len(data))
    return [(offs[i], offs[i + 1]) for i in range(count)]

def mobi(path):
    with open(path, "rb") as fh:
        data = fh.read()
    recs = _palm_records(data)
    if not recs:
        return None, None, None
    r0 = data[recs[0][0]:recs[0][1]]
    title = author = None
    cover = None
    if r0[16:20] == b"MOBI":
        mlen = struct.unpack(">I", r0[20:24])[0]
        first_img = struct.unpack(">I", r0[16 + 108:16 + 112])[0]
        exth_flag = struct.unpack(">I", r0[16 + 128:16 + 132])[0]
        cover_off = None
        # The EXTH-present flag is unreliable - Calibre-converted files leave
        # it at zero while still writing a perfectly good EXTH block - so the
        # block is detected by its magic instead.
        if True:
            e = 16 + mlen
            if r0[e:e + 4] == b"EXTH":
                n = struct.unpack(">I", r0[e + 8:e + 12])[0]
                p = e + 12
                for _ in range(n):
                    if p + 8 > len(r0):
                        break
                    rtype, rlen = struct.unpack(">II", r0[p:p + 8])
                    payload = r0[p + 8:p + rlen]
                    if rtype == 100 and not author:
                        author = payload.decode("utf-8", "ignore").strip()
                    elif rtype == 503 and not title:
                        title = payload.decode("utf-8", "ignore").strip()
                    elif rtype == 201 and len(payload) == 4:
                        v = struct.unpack(">I", payload)[0]
                        if v != 0xFFFFFFFF:
                            cover_off = v
                    p += rlen
        if cover_off is not None and first_img != 0xFFFFFFFF:
            idx = first_img + cover_off
            if 0 <= idx < len(recs):
                cover = data[recs[idx][0]:recs[idx][1]]
    # EXTH 201 often points at the thumbnail rather than the full cover, so the
    # largest embedded image is computed too and the bigger of the two wins -
    # on a MOBI the cover is the only full-page image, so it is always largest.
    best = None
    for s, e in recs[1:]:
        chunk = data[s:e]
        if chunk[:3] == b"\xff\xd8\xff" or chunk[:8] == b"\x89PNG\r\n\x1a\n":
            if best is None or len(chunk) > len(best):
                best = chunk
    if best is not None and (cover is None or len(best) > len(cover)):
        cover = best
    if not title and r0[16:20] == b"MOBI":
        # The real title lives in the MOBI header's full-name field. The Palm
        # database name at the top of the file is only 31 bytes and Calibre
        # fills it with a placeholder like "CR!DJZ3J2C7GS1G9FPTXX2KAJEV7BWF".
        try:
            off = struct.unpack(">I", r0[16 + 84:16 + 88])[0]
            ln = struct.unpack(">I", r0[16 + 88:16 + 92])[0]
            if 0 < off and 0 < ln < 1024 and off + ln <= len(r0):
                title = r0[off:off + ln].decode("utf-8", "ignore").strip() or None
        except Exception:
            pass
    if title and re.match(r"^(CR!|BOOKMOBI|\W*$)", title):
        title = None
    return cover, title, author


# ---------------------------------------------------------------- CBZ / PDF

def cbz(path):
    with zipfile.ZipFile(path) as z:
        imgs = sorted(n for n in z.namelist() if n.lower().endswith(IMG_EXT))
        return (z.read(imgs[0]) if imgs else None), None, None

def pdf(path):
    title = author = None
    try:
        out = subprocess.run(["pdfinfo", path], capture_output=True, timeout=30,
                             text=True, errors="ignore").stdout
        for line in out.splitlines():
            if line.startswith("Title:"):
                title = line.split(":", 1)[1].strip() or None
            elif line.startswith("Author:"):
                author = line.split(":", 1)[1].strip() or None
    except Exception:
        pass
    cover = None
    with tempfile.TemporaryDirectory() as td:
        stem = os.path.join(td, "p")
        try:
            subprocess.run(["pdftoppm", "-jpeg", "-f", "1", "-l", "1",
                            "-scale-to", str(MAX_EDGE), path, stem],
                           capture_output=True, timeout=90)
            for f in sorted(os.listdir(td)):
                cover = open(os.path.join(td, f), "rb").read()
                break
        except Exception:
            pass
    return cover, title, author


def cbr(path):
    # A surprising number of .cbr files are actually zips, so try that first.
    try:
        if zipfile.is_zipfile(path):
            return cbz(path)
    except Exception:
        pass
    # No unrar binary on the Pi and no root to install one; rar4.first_image
    # handles the stored (uncompressed) entries that comics almost always use.
    try:
        import rar4
        raw = rar4.first_image(path)
        if raw:
            return raw, None, None
    except Exception:
        pass
    try:
        import rarfile
        with rarfile.RarFile(path) as rf:
            imgs = sorted(n for n in rf.namelist() if n.lower().endswith(IMG_EXT))
            if imgs:
                return rf.read(imgs[0]), None, None
    except Exception:
        pass
    return None, None, None


HANDLERS = {"EPUB": epub, "MOBI": mobi, "AZW": mobi, "AZW3": mobi,
            "CBZ": cbz, "CBR": cbr, "PDF": pdf}


# ---------------------------------------------------------------- driver

def normalise(raw):
    im = Image.open(io.BytesIO(raw))
    im.load()
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    w, h = im.size
    if max(w, h) > MAX_EDGE:
        s = MAX_EDGE / max(w, h)
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=82, optimize=True, progressive=True)
    return buf.getvalue()


def real_format(path, fmt):
    """Trust the file's magic bytes over its extension.

    Some .cbz files are RAR archives and some .epub files are not zips at all;
    opening those with the handler the extension implies just raises BadZipFile
    and the book silently ends up with no cover.
    """
    try:
        with open(path, "rb") as fh:
            head = fh.read(8)
    except OSError:
        return fmt
    if head[:4] == b"Rar!":
        return "CBR" if fmt in ("CBZ", "CBR", "EPUB") else fmt
    if head[:2] == b"PK" and fmt == "CBR":
        return "CBZ"
    if head[:5] == b"%PDF-" and fmt != "PDF":
        return "PDF"
    return fmt


def one(job):
    book_id, path, fmt = job
    out = os.path.join(COVERS, book_id + ".jpg")
    res = {"id": book_id, "format": fmt}
    actual = real_format(path, fmt)
    if actual != fmt:
        res["actual_format"] = actual
        fmt = actual
    handler = HANDLERS.get(fmt)
    if not handler:
        res["skip"] = "unsupported"
        return res
    try:
        raw, title, author = handler(path)
    except Exception as e:
        res["error"] = f"{type(e).__name__}: {e}"[:160]
        return res
    if title:
        res["title"] = title[:300]
    if author:
        res["author"] = author[:200]
    if raw and not os.path.exists(out):
        try:
            jpg = normalise(raw)
            if len(jpg) > 1000:
                tmp = out + ".tmp"
                with open(tmp, "wb") as fh:
                    fh.write(jpg)
                os.replace(tmp, out)
                res["cover"] = len(jpg)
        except Exception as e:
            res["cover_error"] = f"{type(e).__name__}"[:60]
    return res


def main():
    only = sys.argv[1].upper().split(",") if len(sys.argv) > 1 else None
    os.makedirs(COVERS, exist_ok=True)
    catalogue = json.load(open(CAT))
    paths = json.load(open(MAP))

    done = set()
    if os.path.exists(META):
        for line in open(META, encoding="utf-8", errors="ignore"):
            try:
                done.add(json.loads(line)["id"])
            except Exception:
                pass

    jobs = []
    for b in catalogue:
        p = paths.get(b["id"])
        if not p or b["id"] in done:
            continue
        fmt = (b.get("format") or "").upper()
        if only and fmt not in only:
            continue
        jobs.append((b["id"], p, fmt))

    print(f"{len(jobs)} to process ({len(done)} already done)", flush=True)
    n = cov = meta = err = 0
    with open(META, "a", encoding="utf-8") as sink, ProcessPoolExecutor(4) as pool:
        for fut in as_completed([pool.submit(one, j) for j in jobs]):
            r = fut.result()
            sink.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
            cov += 1 if r.get("cover") else 0
            meta += 1 if (r.get("title") or r.get("author")) else 0
            err += 1 if r.get("error") else 0
            if n % 250 == 0:
                sink.flush()
                print(f"  {n}/{len(jobs)}  covers={cov} meta={meta} err={err}", flush=True)
    print(f"done: {n} processed, {cov} covers, {meta} with metadata, {err} errors", flush=True)


if __name__ == "__main__":
    main()
