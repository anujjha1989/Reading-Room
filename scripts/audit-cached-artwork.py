#!/usr/bin/env python3
"""Validate cached image files without OCR or changing artwork."""
import collections,json,urllib.request
from pathlib import Path
from PIL import Image
root=Path('/mnt/seagate/ReadingRoom');out=root/'library-repair-backups/scrub-2026-10-13'
rows=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
report={'checked':0,'missing':[],'invalid':[],'small':[],'formats':{}}
formats=collections.Counter()
for row in rows:
    path=root/'covers'/(row['id']+'.jpg')
    if not path.exists():report['missing'].append(dict(id=row['id'],title=row['title']));continue
    try:
        with Image.open(path) as im:
            formats[im.format]+=1
            if min(im.size)<80:report['small'].append(dict(id=row['id'],title=row['title'],size=im.size))
            im.verify()
        report['checked']+=1
    except Exception as e:report['invalid'].append(dict(id=row['id'],title=row['title'],error=str(e)))
report['formats']=dict(formats)
(out/'artwork-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in report.items()}))
