#!/usr/bin/env python3
"""Verify live metadata and original artwork, plus preservation of prior edits."""
import collections,hashlib,json,urllib.parse,urllib.request
from pathlib import Path
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
log=json.loads((out/'applied.json').read_text()); errors=[]
for name in ['title-fixes.json','author-fixes.json','hidden-ids.json']:
    old=json.loads((out/'before'/name).read_text())
    new=json.loads((Path('/var/lib/reading-room')/name).read_text())
    for key,value in old.items():
        if new.get(key)!=value: errors.append('Previous edit changed: '+name+' '+key)
with urllib.request.urlopen('http://127.0.0.1:4311/catalog.json') as response: catalog=json.load(response)
index={x['id']:x for x in catalog}; covered=0; merged=[]
final={}
for item in log:
    if item['kind'] in ('metadata','isbn-metadata'):
        final.setdefault(item['id'],{}).update({key:item[key] for key in ['title','author'] if key in item})
    if item['kind']=='hidden-notice' and item['id'] in index: errors.append('Notice still visible: '+item['id'])
    if item['kind']=='embedded-cover':
        url='http://127.0.0.1:4311/api/cover?'+urllib.parse.urlencode(dict(id=item['id'],title=item.get('title') or index.get(item['id'],{}).get('title','Book')))
        with urllib.request.urlopen(url) as response:
            data=response.read()
            expected=(root/'covers'/(item['id']+'.jpg')).read_bytes()
            if response.headers.get_content_type()!='image/jpeg' or hashlib.sha256(data).digest()!=hashlib.sha256(expected).digest(): errors.append('Cover mismatch: '+item['id'])
        covered+=1
for key,fields in final.items():
    if key not in index: merged.append(key); continue
    for field,value in fields.items():
        if index[key].get(field)!=value: errors.append('Metadata mismatch: '+key+' '+field)
report=dict(visibleEntries=len(catalog),coverChecks=covered,metadataChecks=len(final),mergedDuplicateIds=merged,errors=errors,
            remainingMissingAuthorsByFormat=dict(collections.Counter(x['format'] for x in catalog if not x.get('author','').strip())))
(out/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
if errors: raise SystemExit(1)
