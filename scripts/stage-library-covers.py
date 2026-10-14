#!/usr/bin/env python3
"""Stage missing, explicitly declared EPUB covers; never replace existing art."""
import io, json, posixpath, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import unquote
from PIL import Image, ImageOps
root = Path('/mnt/seagate/ReadingRoom')
out = root / 'library-repair-backups/scrub-2026-10-13'
audit = json.loads((out / 'audit.json').read_text())
files = json.loads((root / 'local-files.json').read_text())
stage = out / 'staged-covers'; stage.mkdir(exist_ok=True)
manifest = []
for row in audit:
    if 'extractable-cover' not in row['issues']: continue
    try:
        with zipfile.ZipFile(files[row['id']]) as z:
            container = ET.fromstring(z.read('META-INF/container.xml'))
            opf = next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('rootfile'))
            href = row['embeddedCover'][0]
            name = posixpath.normpath(posixpath.join(posixpath.dirname(opf), unquote(href.split('#')[0])))
            if z.getinfo(name).file_size > 20*1024*1024: raise ValueError('oversized artwork')
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(z.read(name))))
            image.load()
            if min(image.size) < 180 or not .35 < image.width/image.height < 2.5: raise ValueError('not usable cover dimensions')
            image.thumbnail((800,1200))
            if image.mode in ('RGBA','LA'):
                background = Image.new('RGB', image.size, 'white'); background.paste(image, mask=image.getchannel('A')); image=background
            image.convert('RGB').save(stage/(row['id']+'.jpg'), quality=90)
            manifest.append(dict(id=row['id'], title=row['title'], source=name, status='staged', width=image.width, height=image.height))
    except Exception as error:
        manifest.append(dict(id=row['id'], title=row['title'], status='review', error=str(error)[:180]))
(out / 'cover-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print('Staged usable embedded covers:',sum(x['status']=='staged' for x in manifest),'Review:',sum(x['status']=='review' for x in manifest))
