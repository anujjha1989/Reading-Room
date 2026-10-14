#!/usr/bin/env python3
"""Render unreadable front matter and comic opening pages for local OCR review."""
import io,json,subprocess,zipfile,urllib.request
from pathlib import Path
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
dest=out/'credit-pages';dest.mkdir(exist_ok=True)
files=json.loads((root/'local-files.json').read_text())
front=json.loads((out/'remaining-frontmatter.json').read_text())
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
def stage(row):
    id=row['id'];path=files[id]; paths=[]
    try:
        if row['format']=='PDF':
            prefix=str(dest/id)
            if not list(dest.glob(id+'-*.jpg')):
                subprocess.run(['pdftoppm','-f','1','-l','3','-scale-to','1500','-jpeg','-jpegopt','quality=80',path,prefix],capture_output=True,timeout=45,check=True)
            paths=sorted(str(p) for p in dest.glob(id+'-*.jpg'))
        else:
            if row['format']=='CBZ':
                archive=zipfile.ZipFile(path)
                names=sorted(n for n in archive.namelist() if n.lower().endswith(('.jpg','.jpeg','.png','.webp')) and not n.startswith('__MACOSX/'))[:3]
                read=archive.read
            else:
                listing=subprocess.run(['unrar','lb','-p-',path],capture_output=True,timeout=15,check=True)
                names=sorted(n for n in listing.stdout.decode(errors='replace').splitlines() if n.lower().endswith(('.jpg','.jpeg','.png','.webp')))[:3]
                def read(n):return subprocess.run(['unrar','p','-inul','-p-',path,n],capture_output=True,timeout=25,check=True).stdout
            for number,name in enumerate(names):
                target=dest/f'{id}-{number+1}.jpg'
                if not target.exists():
                    with Image.open(io.BytesIO(read(name))) as im:
                        im=im.convert('RGB');im.thumbnail((1500,1500));im.save(target,quality=80)
                paths.append(str(target))
            if row['format']=='CBZ':archive.close()
        return dict(id=id,title=row['title'],pages=paths)
    except Exception as e:return dict(id=id,title=row['title'],pages=paths,error=str(e))
pending=[r for r in catalog if not r.get('author','').strip() and (r['format'] in ('CBR','CBZ') or (r['format']=='PDF' and not front.get(r['id'],{}).get('text','').strip()))]
results=[]
with ThreadPoolExecutor(max_workers=2) as pool:
    for result in pool.map(stage,pending):
        results.append(result)
        (out/'credit-pages-manifest.next.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
        (out/'credit-pages-manifest.next.json').replace(out/'credit-pages-manifest.json')
        if len(results)%50==0:print('Staged',len(results),'of',len(pending),flush=True)
print('Complete:',len(results))
