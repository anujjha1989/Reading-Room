#!/usr/bin/env python3
"""Read-only catalogue scrub. Never infer identity from a title alone."""
import collections, json, os, re, zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path('/mnt/seagate/ReadingRoom')
rows = json.loads(Path('/opt/reading-room/current/site/catalog.json').read_text())
files = json.loads((ROOT / 'local-files.json').read_text())
manual_titles = json.loads(Path('/var/lib/reading-room/title-fixes.json').read_text())
manual_authors = json.loads(Path('/var/lib/reading-room/author-fixes.json').read_text())

def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()

def valid(s):
    return bool(s and len(s) <= 200 and not re.search(r'https?://|libgen|unknown|calibre|microsoft|z-library|untitled|anonymous', s, re.I))

def inspect(row):
    fid = row['id']; path = files.get(fid)
    title = manual_titles.get(fid, row.get('title', ''))
    author = manual_authors.get(fid, row.get('author', ''))
    result = dict(id=fid, title=title, author=author, format=row.get('format'), issues=[], proposed={})
    if not clean(author): result['issues'].append('missing-author')
    if re.search(r'\.epub$|\.mobi$|libgen|ebookbb|bookzz|[_]|\bretail\b', title, re.I): result['issues'].append('filename-like-title')
    if author and re.search(r'\b(?:volume|edition|epub|mobi|books?|series)\b|\d|\.\.\.$', author, re.I): result['issues'].append('suspect-author')
    cover = ROOT / 'covers' / (fid + '.jpg')
    result['localCover'] = cover.exists()
    if not path or not Path(path).is_file():
        result['issues'].append('missing-file'); return result
    if row.get('format', '').upper() != 'EPUB': return result
    try:
        with zipfile.ZipFile(path) as z:
            container = ET.fromstring(z.read('META-INF/container.xml'))
            opf = next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('rootfile'))
            tree = ET.fromstring(z.read(opf))
            titles = [clean(''.join(e.itertext())) for e in tree.iter() if e.tag.endswith('}title')]
            creators = [clean(''.join(e.itertext())) for e in tree.iter() if e.tag.endswith('}creator')]
            result['embeddedTitle'] = titles
            result['embeddedAuthors'] = creators
            if not author and fid not in manual_authors and len(creators) == 1 and valid(creators[0]):
                result['proposed']['author'] = creators[0]
            if 'filename-like-title' in result['issues'] and fid not in manual_titles and len(titles) == 1 and valid(titles[0]):
                result['proposed']['title'] = titles[0]
            cover_ids = [e.attrib.get('content') for e in tree.iter() if e.tag.endswith('meta') and e.attrib.get('name') == 'cover']
            artwork = [e.attrib.get('href') for e in tree.iter() if e.tag.endswith('item') and (e.attrib.get('id') in cover_ids or 'cover-image' in e.attrib.get('properties', '').split())]
            result['embeddedCover'] = artwork
            if not result['localCover'] and artwork: result['issues'].append('extractable-cover')
    except Exception as error:
        result['issues'].append('embedded-metadata-error'); result['error'] = str(error)[:160]
    return result

out = ROOT / 'library-repair-backups' / 'scrub-2026-10-13'
out.mkdir(parents=True, exist_ok=True)
report = []
with ThreadPoolExecutor(max_workers=3) as pool:
    for index, item in enumerate(pool.map(inspect, rows), 1):
        report.append(item)
        if index % 500 == 0: print('Audited', index, 'of', len(rows), flush=True)
(out / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
summary = dict(entries=len(report), issues=dict(collections.Counter(issue for item in report for issue in item['issues'])),
               proposedTitles=sum('title' in x['proposed'] for x in report), proposedAuthors=sum('author' in x['proposed'] for x in report))
(out / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary), flush=True)
