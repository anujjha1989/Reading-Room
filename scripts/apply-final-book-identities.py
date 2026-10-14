#!/usr/bin/env python3
"""Apply individually verified identities without changing original books."""
import json, urllib.request
from pathlib import Path
out = Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
log = json.loads((out/'applied.json').read_text())
rows = {r['id']: r for r in json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))}
repairs = [
    ('L20a286b381905cb51ff47e9cdeb1146a584fee9b', None, 'Noam Chomsky', 'MOBI EXTH author; https://openlibrary.org/books/OL2546076M/Turning_the_tide'),
    ('La13520877cd3476c3802172714efe5bb11072faf', 'The Bridges of Madison County', 'Robert James Waller', 'Original filename; https://www.hachettebookgroup.com/titles/robert-james-waller/the-bridges-of-madison-county/9781455554294/'),
    ('L3a8734e2a8cf759b7d382de61a092809a37bc426', 'The Great Gatsby: First Draft Screenplay', 'Truman Capote', 'Scanned title page in original EPUB; screenplay, not the Fitzgerald novel'),
]
for id, title, author, source in repairs:
    row = rows.get(id)
    if not row or (row.get('author', '').strip() and row['author'] != author): continue
    payload = dict(id=id, author=author)
    if title: payload['title'] = title
    request = urllib.request.Request('http://127.0.0.1:4311/api/meta-fix', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        if not json.load(response).get('ok'): raise RuntimeError('Correction failed')
    if not any(item.get('id') == id and item.get('source') == source for item in log):
        log.append(dict(kind='metadata', source=source, **payload))
(out/'applied.json').write_text(json.dumps(log, ensure_ascii=False, indent=2))
print('Verified identities applied')
