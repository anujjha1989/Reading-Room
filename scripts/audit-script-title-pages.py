#!/usr/bin/env python3
"""Fetch online screenplay title pages for human credit review, never apply."""
import concurrent.futures,html,json,re,subprocess,urllib.parse
from pathlib import Path
rows=json.loads(Path('/tmp/catalog-final.json').read_text())
def norm(t):
    t=re.sub(r', The$','',t,flags=re.I);t=re.sub(r'^The ','',t,flags=re.I)
    return re.sub('[^a-z0-9]','',t.lower())
index={norm(html.unescape(t)):html.unescape(u) for u,t in re.findall(r'<a href="([^"]+)"[^>]*>([^<]+)</a>',Path('/tmp/imsdb-index.html').read_text(errors='replace')) if '/Movie Scripts/' in u}
aliases={'following script':'Following','American Beauty Script':'American Beauty','Breakfast Club':'The Breakfast Club','Scarfacefinal':'Scarface','Magnolia-1999':'Magnolia','aseriousman':'A Serious Man','casabla':'Casablanca','Verdict The 538':'The Verdict','THE WONDER BOYS':'Wonder Boys','TAXI DRIVER':'Taxi Driver','alien-3-1992':'Alien 3','all-the-presidents-men-1976':"All the President's Men",'butch-cassidy-and-the-sundance-kid-1969':'Butch Cassidy and the Sundance Kid','children of men-script':'Children of Men','memories-of-murder-2003':'Memories of Murder','misery-1990':'Misery','picnic-at-hanging-rock-1975':'Picnic at Hanging Rock','the-tree-of-life-2011':'The Tree of Life','treasureofthesierramadre':'The Treasure of the Sierra Madre','dailyscript.com scripts Bourne+Supremacy,+The.txt':'The Bourne Supremacy','dailyscript.com scripts Braveheart.txt':'Braveheart','Who s Afraid of Virginia Woolf':"Who's Afraid of Virginia Woolf?"}
def fetch(r):
    title=re.sub(r'\s*\((?:19|20)\d{2}[^)]*\)|\s*\[p\..*?\]','',r['title']).strip()
    title=aliases.get(title,title)
    if title.endswith(', The'):title='The '+title[:-5]
    title=title.replace('Cuckoo s',"Cuckoo's")
    url='https://imsdb.com/scripts/'+urllib.parse.quote(title.replace(' ','-'),safe="-'?")+'.html'
    link=index.get(norm(title))
    if link:
        movieurl='https://imsdb.com'+urllib.parse.quote(link,safe='/')
        info=subprocess.run(['curl','-fsSL','--max-time','12',movieurl],capture_output=True).stdout.decode('utf-8','replace')
        match=re.search(r'href="(/scripts/[^"]+)"',info)
        if match:url='https://imsdb.com'+match.group(1)
    p=subprocess.run(['curl','-fsSL','--max-time','12',url],capture_output=True)
    raw=p.stdout.decode('utf-8','replace')
    start=raw.lower().find('<pre>')
    if p.returncode or start<0:return None
    text=html.unescape(re.sub('<[^>]*>','',raw[start:]))
    credit=re.findall(r'<a href="/writer.php\?w=([^"]+)"',raw)
    return dict(id=r['id'],title=r['title'],source=url,header=text[:1600],onlineWriters=[urllib.parse.unquote_plus(x) for x in credit])
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    found=[x for x in pool.map(fetch,[r for r in rows if r.get('category')=='Script' and not r.get('author','').strip()]) if x]
Path('/tmp/script-title-pages.json').write_text(json.dumps(found,ensure_ascii=False,indent=2))
for x in found:print(x['id'],x['title'],x['source'],'\n',x['header'][:700],'\n',flush=True)
print('Reviewed online pages available:',len(found))
