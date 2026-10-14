#!/usr/bin/env python3
"""Apply reviewed catalogue repairs with backups; original books stay untouched."""
import json, os, re, shutil, urllib.request
from pathlib import Path
root = Path('/mnt/seagate/ReadingRoom')
out = root / 'library-repair-backups/scrub-2026-10-13'
audit = json.loads((out/'audit.json').read_text())
backup = out/'before'; backup.mkdir(exist_ok=True)
for name in ['title-fixes.json','author-fixes.json','hidden-ids.json']:
    destination=backup/name
    if not destination.exists(): shutil.copy2(Path('/var/lib/reading-room')/name, destination)
authors=json.loads(Path('/var/lib/reading-room/author-fixes.json').read_text())
titles=json.loads(Path('/var/lib/reading-room/title-fixes.json').read_text())
hidden=json.loads(Path('/var/lib/reading-room/hidden-ids.json').read_text())
reviewed = {
    'The Complete Works of James Joyce': ('James Joyce','https://books.google.com/books?id=PX6nCwAAQBAJ'),
    'The Complete Works of Rudyard Kipling': ('Rudyard Kipling','https://www.delphiclassics.com/Sample%20PDFs/Complete%20Works%20of%20Rudyard%20Kipling%20-%20sample.pdf'),
    'The Complete Works of Vincent van Gogh': ('Vincent van Gogh','https://www.delphiclassics.com/shop/vincent-van-gogh/'),
    'Clifton Chronicles': ('Jeffrey Archer','https://www.panmacmillan.com/series/the-clifton-chronicles/s103786110423'),
    'How the World Works (Real Story) -Soft Skull Press': ('Noam Chomsky','https://openlibrary.org/books/OL25972752M/How_The_World_Works'),
    'Cartesian Linguistics A Chapter in the History of Rationalist Thought': ('Noam Chomsky','https://books.google.com/books?id=QTNlAAAAMAAJ'),
    'Fateful Triangle, Updated Edition The United States, Israel, and the Palestinians': ('Noam Chomsky','https://www.plutobooks.com/product/fateful-triangle/'),
    'Language and Mind-Noam Chomsky- Cambridge University Press': ('Noam Chomsky','https://assets.cambridge.org/052185/8194/frontmatter/0521858194_frontmatter.htm'),
    'New Horizons in the Study of Language and Mind-Cambridge University Press': ('Noam Chomsky','https://www.cambridge.org/core/books/new-horizons-in-the-study-of-language-and-mind/2CF4C469C8867CB0168F4B9D6EA8BF38'),
    'On Nature and Language- Noam Chomsky, Adriana Belletti-Cambridge University Press': ('Noam Chomsky','https://assets.cambridge.org/97805218/15482/frontmatter/9780521815482_frontmatter.pdf'),
    'The Classical Style Haydn, Mozart, Beethoven': ('Charles Rosen','https://openlibrary.org/works/OL1858943W'),
    'The Collapse of Complex Societies': ('Joseph A. Tainter','https://openlibrary.org/works/OL4741769W'),
    'Absolute Watchmen': ('Alan Moore','https://www.dc.com/graphic-novels/watchmen-1986/absolute-watchmen-new-edition'),
    'Holes': ('Louis Sachar','https://www.penguinrandomhouse.com/books/159528/holes-by-louis-sachar/'),
    'Social Psychology For Dummies': ('Daniel Richardson','https://openlibrary.org/books/OL29229555M/Social_Psychology_for_Dummies'),
    '50 Psychology Classics': ('Tom Butler-Bowdon','https://www.hachette.co.uk/wp-content/uploads/2020/06/JMP-Business-catalogue-2020-Digital.pdf'),
    'The Assassins': ('Bernard Lewis','https://openlibrary.org/works/OL1157052W'),
    'RAGE OF ANGELS': ('Sidney Sheldon','https://openlibrary.org/works/OL1881771W'),
    'Memories of Midnight': ('Sidney Sheldon','https://openlibrary.org/works/OL10640706W'),
}
def post(endpoint, payload):
    request=urllib.request.Request('http://127.0.0.1:4311/api/'+endpoint, data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        result=json.load(response)
        if not result.get('ok'): raise RuntimeError(result)

log=json.loads((out/'applied.json').read_text()) if (out/'applied.json').exists() else []
for row in audit:
    if row['format'] in ('CBR','CBZ') and re.fullmatch(r'The Walking Dead\s+#?\s*\d+',row['title'],re.I):
        reviewed[row['title']]=('Robert Kirkman','https://imagecomics.com/comics/series/the-walking-dead')
    if row['format'] in ('CBR','CBZ') and re.fullmatch(r'Transmetropolitan\s+#?\s*\d+',row['title'],re.I):
        reviewed[row['title']]=('Warren Ellis','https://www.dc.com/talent/warren-ellis')
    if row['title'] in reviewed and not row['author'] and row['id'] not in authors:
        author,source=reviewed[row['title']]
        payload=dict(id=row['id'],author=author)
        if row['title'].startswith('How the World Works') and row['id'] not in titles: payload['title']='How the World Works'
        post('meta-fix',payload); log.append(dict(kind='metadata',source=source,**payload))
    if row['format']=='TXT' and row['id'] not in hidden and re.search(r'torrent.*download|^nfo$|^read\s*me$|^www\.',row['title'],re.I):
        post('quarantine',dict(id=row['id'],reason='scrub: non-book download notice; source file preserved'))
        log.append(dict(kind='hidden-notice',id=row['id'],title=row['title']))
for row in json.loads((out/'cover-manifest.json').read_text()):
    if row['status']!='staged': continue
    destination=root/'covers'/(row['id']+'.jpg')
    if destination.exists(): continue
    with open(destination,'xb') as target, open(out/'staged-covers'/(row['id']+'.jpg'),'rb') as source:
        shutil.copyfileobj(source,target)
    os.chmod(destination,0o644)
    log.append(dict(kind='embedded-cover',id=row['id'],title=row['title']))
(out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
print('Applied',len(log),'repairs:', {kind:sum(x['kind']==kind for x in log) for kind in ['metadata','hidden-notice','embedded-cover']})
