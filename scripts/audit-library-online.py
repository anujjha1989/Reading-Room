#!/usr/bin/env python3
"""Batch public bibliographic lookups; exact unambiguous author matches only."""
import json, re, time, urllib.parse, urllib.request
from pathlib import Path
root = Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
audit = json.loads((root / 'audit.json').read_text())
def norm(s):
    return re.sub(r'[^\w]+', ' ', s.casefold()).strip()
nonbook = re.compile(r'torrent.*download|^nfo$|^read\s*me$|^www\.', re.I)
pending = [x for x in audit if 'missing-author' in x['issues'] and not nonbook.search(x['title'])]
cache = root / 'online.json'
results = json.loads(cache.read_text()) if cache.exists() else {}
pending = [x for x in pending if x['id'] not in results]
for offset in range(0, len(pending), 20):
    batch = pending[offset:offset+20]
    terms = ['title:"' + re.sub(r'["\\]', ' ', x['title']) + '"' for x in batch]
    url = 'https://openlibrary.org/search.json?' + urllib.parse.urlencode(dict(q=' OR '.join('('+x+')' for x in terms), fields='key,title,author_name,isbn', limit=200))
    try:
        request = urllib.request.Request(url, headers={'User-Agent':'HomeBooksCatalogueAudit/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            docs = json.load(response).get('docs', [])
        for row in batch:
            exact = [d for d in docs if norm(d.get('title','')) == norm(row['title']) and d.get('author_name')]
            authors = {tuple(d['author_name']) for d in exact}
            if len(authors) == 1:
                match = exact[0]
                results[row['id']] = dict(title=row['title'], author=', '.join(match['author_name']), source='https://openlibrary.org'+match['key'], status='exact-match-review')
            else:
                results[row['id']] = dict(title=row['title'], status='ambiguous' if exact else 'no-exact-match')
    except Exception as error:
        print('Batch deferred:', str(error)[:120], flush=True)
    temp = cache.with_suffix('.tmp')
    temp.write_text(json.dumps(results, ensure_ascii=False, indent=2)); temp.replace(cache)
    print('Online checked', len(results), 'matches', sum(x.get('author') is not None for x in results.values()), flush=True)
    time.sleep(1.1)
