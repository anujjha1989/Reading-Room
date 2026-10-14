#!/usr/bin/env python3
"""Read issue-specific ComicInfo writer credits, without modifying archives."""
import json, subprocess, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
audit=json.loads((out/'audit.json').read_text()); files=json.loads((root/'local-files.json').read_text())
def inspect(row):
    try:
        path=files[row['id']]
        if row['format']=='CBZ':
            with zipfile.ZipFile(path) as archive:
                names=[x for x in archive.namelist() if x.lower().endswith('comicinfo.xml')]
                data=archive.read(names[0]) if len(names)==1 else None
        else:
            listing=subprocess.run(['unrar','lb','-p-',path],capture_output=True,timeout=10)
            names=[x for x in listing.stdout.decode(errors='replace').splitlines() if x.lower().endswith('comicinfo.xml')]
            data=subprocess.run(['unrar','p','-inul','-p-',path,names[0]],capture_output=True,timeout=10).stdout if len(names)==1 else None
        if not data or len(data)>1048576: return None
        tree=ET.fromstring(data)
        writer=(tree.findtext('Writer') or '').strip()
        if writer and len(writer)<200:
            return dict(id=row['id'],title=row['title'],author=writer,source=path+'#'+names[0])
    except Exception: pass
    return None
pending=[x for x in audit if 'missing-author' in x['issues'] and x['format'] in ('CBZ','CBR')]
with ThreadPoolExecutor(max_workers=3) as pool: results=[x for x in pool.map(inspect,pending) if x]
(out/'comic-credits.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Comic archives checked:',len(pending),'embedded writer credits:',len(results),flush=True)
