#!/usr/bin/env python3
"""Apply ISBN matches only when the printed title and creator agree."""
import json,re,subprocess,urllib.request
from pathlib import Path
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
files=json.loads((root/'local-files.json').read_text())
authors=json.loads(Path('/var/lib/reading-room/author-fixes.json').read_text())
titles=json.loads(Path('/var/lib/reading-room/title-fixes.json').read_text())
records=json.loads((out/'pdf-isbns.json').read_text()); log=json.loads((out/'applied.json').read_text())
def compact(s): return re.sub(r'[^a-z0-9]','',s.casefold())
for item in records:
    if not item['records']: continue
    text=subprocess.run(['pdftotext','-f','1','-l','6',files[item['id']],'-'],capture_output=True,timeout=20).stdout.decode(errors='replace')
    printed=compact(text)
    matching=[r for r in item['records'] if compact(r.get('title','')) in printed and r.get('authors')]
    if not matching: continue
    record=max(matching,key=lambda r:len(r['authors']))
    names=[a['name'] for a in record['authors']]
    if any(re.search(r'\bstaff\b|\bunknown\b',n,re.I) or compact(n) not in printed for n in names): continue
    payload={'id':item['id']}
    if item['id'] not in authors: payload['author']=', '.join(names)
    new_title=record['title']
    # Keep volume identities; they must never collapse into one generic work.
    if not re.search(r'\bvol(?:ume)?\.?\s*\d',item['title'],re.I) and item['id'] not in titles:
        if compact(item['title'])!=compact(new_title): payload['title']=new_title
    if len(payload)==1: continue
    request=urllib.request.Request('http://127.0.0.1:4311/api/meta-fix',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=30) as response:
        if not json.load(response).get('ok'): raise RuntimeError('Failed metadata repair')
    log.append(dict(kind='isbn-metadata',source=record.get('url'),isbns=item['isbns'],oldTitle=item['title'],**payload))
(out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
print('Verified printed-title/creator ISBN repairs:',sum(x['kind']=='isbn-metadata' for x in log),flush=True)
