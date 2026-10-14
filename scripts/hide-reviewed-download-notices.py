#!/usr/bin/env python3
"""Hide confirmed non-book download notices; source files remain recoverable."""
import fcntl,json,urllib.request
from pathlib import Path
out=Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
lock=open(out/'apply.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
rows={r['id']:r for r in json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))}
log=json.loads((out/'applied.json').read_text())
notices={
'Ld24810c03119b5a98ada2ac9a04e43b3d5a16627':'List of torrent download sites, not a book',
'L21ff0c8efa3309c7976bb95182d2f8a3647e65a0':'Sharing/seeding thank-you notice, not a book',
'L674162c875c96d14485de8b5bcd8b49b28ff1426':'Demonoid tracker notice, not a book',
'L36e69cb3654738a85ae8206ddb78ee4fd7389c83':'Ebook download forum advertisement, not a book',
'L7ad366ac1b42c7fb1a9aed460534d5f1c719ca01':'AutoReader software instructions, not a book',
'L37b68268941ebb91fecc5f991b9907c500a43073':'HTTP 416 nginx HTML error page saved with EPUB extension, not book content',
}
for id,reason in notices.items():
    if id not in rows:continue
    request=urllib.request.Request('http://127.0.0.1:4311/api/quarantine',data=json.dumps(dict(id=id,reason='scrub: '+reason+'; original file preserved')).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=30) as response:
        if not json.load(response).get('ok'):raise RuntimeError(id)
    log.append(dict(kind='hidden-notice',id=id,title=rows[id]['title'],reason=reason))
    (out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
print('Reviewed notices hidden; original files retained')
