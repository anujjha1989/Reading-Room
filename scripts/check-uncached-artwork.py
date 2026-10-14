#!/usr/bin/env python3
"""Check uncached catalogue art through the same endpoint used by the apps."""
import concurrent.futures, io, json, urllib.error, urllib.parse, urllib.request
from pathlib import Path
from PIL import Image
root = Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
rows = json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
missing = {r['id'] for r in json.loads((root/'artwork-validation.json').read_text())['missing']}
def check(row):
    result = {'id': row['id'], 'title': row['title']}
    url = 'http://127.0.0.1:4311/api/cover?' + urllib.parse.urlencode({k: row.get(k, '') for k in ('id', 'title', 'author', 'format')})
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            data = response.read(5000000)
            result['mime'] = response.headers.get_content_type()
        with Image.open(io.BytesIO(data)) as im:
            result['size'] = im.size
            im.verify()
        result['status'] = 'available'
    except urllib.error.HTTPError as e:
        result['status'] = 'fallback' if e.code == 404 else 'error'
        result['httpStatus'] = e.code
    except Exception as e:
        result.update(status='error', error=str(e))
    return result
results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = [pool.submit(check, r) for r in rows if r['id'] in missing]
    for future in concurrent.futures.as_completed(futures):
        results.append(future.result())
        if len(results) % 20 == 0:
            (root/'uncached-artwork-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
            print('Artwork checked:', len(results), flush=True)
(root/'uncached-artwork-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps({status: sum(r['status'] == status for r in results) for status in ('available', 'fallback', 'error')}))
