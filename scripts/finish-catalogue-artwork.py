#!/usr/bin/env python3
"""Cache the app's resolved artwork; quarantine unusably small art reversibly."""
import concurrent.futures, hashlib, io, json, os, shutil, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
root = Path('/mnt/seagate/ReadingRoom')
out = root/'library-repair-backups/scrub-2026-10-13'
backup = out/('artwork-final-'+str(time.time_ns()))
backup.mkdir()
audit = json.loads((out/'artwork-validation.json').read_text())
targets = {r['id'] for r in audit['missing'] + audit['small']}
small = {r['id'] for r in audit['small']}
rows = json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
def repair(row):
    id = row['id']; target = root/'covers'/(id+'.jpg')
    result = dict(id=id, title=row['title'])
    if target.exists() and id not in small:
        return dict(result, status='already-cached')
    if id in small and target.exists():
        shutil.move(str(target), str(backup/target.name))
        result['previousArtworkBackup'] = str(backup/target.name)
    # Omit format intentionally: local-file IDs must not request Drive thumbnails.
    query = urllib.parse.urlencode({k: row.get(k, '') for k in ('id','title','author')})
    try:
        with urllib.request.urlopen('http://127.0.0.1:4311/api/cover?'+query, timeout=10) as response:
            result['source'] = response.url
            data = response.read(5000000)
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            if min(im.size) < 100 or not .35 < im.width/im.height < 1.3:
                return dict(result, status='designed-fallback', reason='No usable portrait cover returned')
            im = im.convert('RGB'); im.thumbnail((800,1200))
            temp = backup/(id+'.new.jpg'); im.save(temp, quality=90)
        if target.exists():
            return dict(result, status='concurrent-art-preserved')
        os.replace(temp, target)
        return dict(result, status='cached', sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    except Exception as error:
        return dict(result, status='designed-fallback', reason=str(error)[:200])
results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = [pool.submit(repair, row) for row in rows if row['id'] in targets]
    for future in concurrent.futures.as_completed(futures):
        results.append(future.result())
        (out/'artwork-final-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        if len(results)%25 == 0: print('Artwork processed:',len(results),flush=True)
print(json.dumps({status:sum(r['status']==status for r in results) for status in sorted({r['status'] for r in results})}),flush=True)
