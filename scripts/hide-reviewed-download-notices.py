#!/usr/bin/env python3
"""Hide confirmed non-book download notices; source files remain recoverable."""
import fcntl,json,urllib.request
from pathlib import Path
out=Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
lock=open(out/'apply.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
rows={r['id']:r for r in json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))}
log=json.loads((out/'applied.json').read_text())
notices={
'L30fd179fe7e5d603b0823e1e6bbac34aa92a66bf':'Blank Memories of Murder part-2 print: 144 pages, no extracted text, fonts or images, opening renders blank; hidden at user request',
'Lc8733307ebd2d9bf430d5c6dedae3e13f8bb2f7c':'Unreadable damaged PDF import: missing PDF header, null-filled beginning, rejected by PDF renderer; hidden at user request',
'Lc46ee67dabafc09cd11c486b8892e5e5dc51206b':'Novelty Xavier Institute graduation diploma, not a comic or book',
'Led4f5b8123d8eb7c233c99d907d5ec2f2dad5f15':'List of Kindle ebook filenames, not book content',
'L51abb56b7feb70f5b8e6b36c730835700f88722f':'Identifier-only text file (87-01), no book content',
'Ld233e2ea35545d4039a33d762d58fc07ebe35af3':'Ebookism download-site advertisement, not a book',
'L8ce6a8e9a27791aee99b84b452817405964f2e3a':'BBC Hollow Crown television episode listings, not a book',
'L11852a179d31a6c78699053905096cbf877662fe':'List of bestselling book filenames, not book content',
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
