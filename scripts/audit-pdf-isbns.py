#!/usr/bin/env python3
"""Look up valid ISBNs printed in PDF front matter, in small API batches."""
import json, re, subprocess, time, urllib.parse, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
audit=json.loads((out/'audit.json').read_text()); files=json.loads((root/'local-files.json').read_text())
def valid(isbn):
    if len(isbn)==13 and isbn.isdigit(): return sum(int(x)*(1 if i%2==0 else 3) for i,x in enumerate(isbn))%10==0
    if len(isbn)==10 and isbn[:9].isdigit() and isbn[-1] in '0123456789X': return sum((10-i)*(10 if x=='X' else int(x)) for i,x in enumerate(isbn))%11==0
    return False
def inspect(row):
    try:
        result=subprocess.run(['pdftotext','-f','1','-l','6',files[row['id']],'-'],capture_output=True,timeout=15)
        text=result.stdout.decode(errors='replace')
        numbers=set()
        for match in re.findall(r'ISBN(?:\s*[-:]?\s*(?:10|13))?\s*[:]?\s*([0-9X][0-9X\- \t]{8,24})',text,re.I):
            value=re.sub(r'[^0-9X]','',match.upper())
            if valid(value): numbers.add(value)
        return dict(id=row['id'],title=row['title'],isbns=sorted(numbers))
    except Exception: return dict(id=row['id'],title=row['title'],isbns=[])
pending=[x for x in audit if x['format']=='PDF' and ('missing-author' in x['issues'] or 'filename-like-title' in x['issues'] or 'suspect-author' in x['issues'])]
with ThreadPoolExecutor(max_workers=2) as pool: extracted=list(pool.map(inspect,pending))
all_isbns=sorted({n for x in extracted for n in x['isbns']}); records={}
for offset in range(0,len(all_isbns),20):
    batch=all_isbns[offset:offset+20]
    url='https://openlibrary.org/api/books?'+urllib.parse.urlencode(dict(bibkeys=','.join('ISBN:'+x for x in batch),format='json',jscmd='data'))
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'HomeBooksCatalogueAudit/1.0'}),timeout=30) as response: records.update(json.load(response))
    except Exception as error: print('Deferred ISBN batch:',str(error),flush=True)
    time.sleep(1.1)
for row in extracted: row['records']=[records['ISBN:'+n] for n in row['isbns'] if 'ISBN:'+n in records]
(out/'pdf-isbns.json').write_text(json.dumps(extracted,ensure_ascii=False,indent=2))
print('PDFs checked:',len(extracted),'with valid ISBNs:',sum(bool(x['isbns']) for x in extracted),'with online records:',sum(bool(x['records']) for x in extracted),flush=True)
