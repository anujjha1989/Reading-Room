#!/usr/bin/env python3
"""Bounded, resumable extraction for human review. Never mutates books."""
import json, re, subprocess, zipfile, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path('/mnt/seagate/ReadingRoom')
out=root/'library-repair-backups/scrub-2026-10-13'
target=out/'remaining-frontmatter.json'
old=json.loads(target.read_text()) if target.exists() else {}
files=json.loads((root/'local-files.json').read_text())
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
def inspect(row):
    id=row['id']; path=files.get(id); text=''; error=''
    if id in old:return id,old[id]
    try:
        if row['format']=='PDF':
            text=subprocess.run(['pdftotext','-f','1','-l','5',path,'-'],capture_output=True,timeout=20).stdout.decode(errors='replace')
        elif row['format'] in ('DOCX','EPUB'):
            with zipfile.ZipFile(path) as z:
                names=['word/document.xml'] if row['format']=='DOCX' else [n for n in z.namelist() if n.endswith(('.html','.xhtml'))][:5]
                text='\n'.join(re.sub('<[^>]+>',' ',z.read(n).decode(errors='replace')) for n in names)
        elif row['format']=='DOC':
            text=subprocess.run(['antiword',path],capture_output=True,timeout=15).stdout.decode(errors='replace')
        else:text=Path(path).read_bytes()[:20000].decode(errors='replace')
    except Exception as e:error=str(e)
    return id,dict(title=row['title'],format=row['format'],path=path,text=text[:7000],error=error)
pending=[r for r in catalog if not r.get('author','').strip() and r['format'] not in ('CBR','CBZ')]
with ThreadPoolExecutor(max_workers=2) as pool:
    for id,result in pool.map(inspect,pending):
        old[id]=result
        target.write_text(json.dumps(old,ensure_ascii=False,indent=2))
print('Front matter inspected:',len(pending),'empty:',sum(not old[r['id']]['text'].strip() for r in pending))
