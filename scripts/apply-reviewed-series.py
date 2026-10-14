#!/usr/bin/env python3
"""Apply publisher-verified regular-series credits and staged local covers."""
import fcntl,hashlib,json,os,re,shutil,urllib.request
from pathlib import Path
from PIL import Image
root=Path('/mnt/seagate/ReadingRoom'); out=root/'library-repair-backups/scrub-2026-10-13'
lock=open(out/'apply.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
log=json.loads((out/'applied.json').read_text())
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
rules=[
    (r'(?:Batman - )?Dark Victory\s+#?\s*\d+','Jeph Loeb','https://www.dc.com/graphic-novels/batman-dark-victory-1999/batman-dark-victory-new-edition'),
    (r'Jimmy Corrigan\s+#?\s*\d+','Chris Ware','https://www.penguinrandomhouse.com/books/185703/jimmy-corrigan-the-smartest-kid-on-earth-by-chris-ware/'),
    (r'Identity Crisis\s+#?\s*0?[1-7]','Brad Meltzer','https://www.dc.com/graphic-novels/identity-crisis-2004/identity-crisis'),
    (r'House Of M\s+#?\s*0?[1-8]','Brian Michael Bendis','https://www.marvel.com/comics/guides/258/house_of_m_the_complete_event'),
    (r'Frank Miller_s Ronin\s+#?\s*0?[1-6]','Frank Miller','https://www.dc.com/graphic-novels/ronin-1983/ronin'),
    (r'Promethea Vol1\s+#?\s*\d+','Alan Moore','https://www.dc.com/comics/promethea-1999/promethea-32-variant'),
    (r'Saga_\d{3}_28(?:2012|2013|2014)_29_28[Dd]igital_29_28(?:Zone_Empire_2|Megan_Empire)','Brian K. Vaughan','https://imagecomics.com/creators/brian-k-vaughan'),
    (r'Watchmen\s+#?\s*(?:0?[1-9]|1[0-2])','Alan Moore','https://www.dc.com/graphic-novels/watchmen-1986/watchmen'),
    (r'Batman - The Long Halloween\s+#?\s*(?:0?[1-9]|1[0-3])','Jeph Loeb','https://www.dc.com/graphic-novels/batman-the-long-halloween-1996/batman-the-long-halloween'),
    (r'100 Bullets\s+#?\s*\d+','Brian Azzarello','https://www.dc.com/graphic-novels/100-bullets-1999/100-bullets-vol-1-first-shot-last-call'),
    (r'V For Vendetta\s+#?\s*\d+','Alan Moore','https://www.dc.com/graphic-novels/v-for-vendetta-1988/v-for-vendetta-new-edition'),
    (r'Promethea(?:\s+Vol)?\s+#?\s*\d+','Alan Moore','https://www.dc.com/comics/promethea-1999/promethea-32-variant'),
    (r'Saga[_\s]+#?\s*\d+','Brian K. Vaughan','https://imagecomics.com/comics/series/saga'),
    (r'Y\s*[-:]\s*The Last Man\s+#?\s*\d+','Brian K. Vaughan','https://www.dc.com/talent/brian-k-vaughan'),
    (r'Ex Machina\s+#?\s*\d+','Brian K. Vaughan','https://www.dc.com/graphic-novels/ex-machina-2004/ex-machina-deluxe-edition-vol-2'),
    (r'The Boys\s+#?\s*\d+','Garth Ennis','https://dynamite.com/titles/the-boys/'),
    (r'American Virgin\s+#?\s*\d+','Steven T. Seagle','https://www.dc.com/talent/steven-t-seagle'),
]
for row in catalog:
    if row['format'] not in ('CBR','CBZ'): continue
    for pattern,author,source in rules:
        if not re.fullmatch(pattern,row['title'],re.I): continue
        if row.get('author','').strip():
            if row['author']==author and not any(item.get('id')==row['id'] and item.get('author')==author for item in log):
                log.append(dict(kind='metadata',source=source,title=row['title'],id=row['id'],author=author))
            break
        payload=dict(id=row['id'],author=author)
        request=urllib.request.Request('http://127.0.0.1:4311/api/meta-fix',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(request,timeout=30) as response:
            if not json.load(response).get('ok'): raise RuntimeError('Correction failed')
        log.append(dict(kind='metadata',source=source,title=row['title'],**payload))
        break
rejected=[]
placeholders={'7e522607d655cc6e9ec077a2c9b39dfd','9488fd1ce286ac72d8152552b4353894','037cd2eb8839b58e20108f0199dbe2a1'}
for image in (out/'staged-mobi-covers').glob('*.jpg'):
    target=root/'covers'/image.name
    if target.exists(): continue
    try:
        with Image.open(image) as picture:
            picture.verify()
        with Image.open(image) as picture:
            if min(picture.size)<180 or not .35<picture.width/picture.height<2.5: raise ValueError('Unusable dimensions')
        if hashlib.md5(image.read_bytes()).hexdigest() in placeholders: raise ValueError('Generic app icon')
        with open(target,'xb') as dest, open(image,'rb') as src: shutil.copyfileobj(src,dest)
        os.chmod(target,0o644)
        log.append(dict(kind='embedded-cover',id=image.stem,source='MOBI EXTH cover record'))
    except Exception as error: rejected.append(dict(id=image.stem,reason=str(error)))
(out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
(out/'mobi-cover-review.json').write_text(json.dumps(rejected,indent=2))
print('Total applied:',{kind:sum(x['kind']==kind for x in log) for kind in set(x['kind'] for x in log)},'MOBI covers needing review:',len(rejected))
