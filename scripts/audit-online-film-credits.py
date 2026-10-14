#!/usr/bin/env python3
"""Match unresolved screenplay titles to online film credits, for review only."""
import json,os,re,subprocess,time,urllib.parse,urllib.request
from pathlib import Path
out=Path(os.environ.get('CATALOG_REVIEW_OUTPUT','/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13'))
def get(base,params):
    response=subprocess.run(['curl','-fsSL','--max-time','15',base+'?'+urllib.parse.urlencode(params)],capture_output=True,timeout=20,check=True)
    return json.loads(response.stdout)
aliases={'following script':'Following','munich':'Munich (2005 film)','28 Weeks Later':'28 Weeks Later',
'500 days of summer':'500 Days of Summer','American Beauty Script':'American Beauty (1999 film)','American Beauty':'American Beauty (1999 film)',
'Amistad':'Amistad (film)','Badlands':'Badlands (film)','Breakfast Club':'The Breakfast Club','Bridge on the River Kwai, The':'The Bridge on the River Kwai',
'Deer Hunter, The':'The Deer Hunter','Gandhi':'Gandhi (film)','History of Violence, A':'A History of Violence','Hunt for Red October, The':'The Hunt for Red October (film)',
'Incredibles, The':'The Incredibles','Magnolia-1999':'Magnolia (film)','Midnight Cowboy':'Midnight Cowboy','Mosquito Coast, The':'The Mosquito Coast (film)',
'Murder on the Orient Express':'Murder on the Orient Express (1974 film)','Network':'Network (1976 film)','Others, The':'The Others (2001 film)',
'Scarfacefinal':'Scarface (1983 film)','Spiderman Script James Cameron':None,'Sunset Blvd':'Sunset Boulevard (film)',
'TAXI DRIVER':'Taxi Driver','Terminator 2':'Terminator 2: Judgment Day','Tootsie':'Tootsie','True Grit':'True Grit (2010 film)',
'Verdict The 538':'The Verdict','Warrior':'Warrior (2011 film)','Who s Afraid of Virginia Woolf':"Who's Afraid of Virginia Woolf? (film)",
'THE WONDER BOYS':'Wonder Boys (film)','Young Adult':'Young Adult (film)','alien-3-1992':'Alien 3','all-the-presidents-men-1976':"All the President's Men (film)",
'aseriousman':'A Serious Man','butch-cassidy-and-the-sundance-kid-1969':'Butch Cassidy and the Sundance Kid','casabla':'Casablanca (film)',
'children of men-script':'Children of Men','dailyscript.com scripts Bourne+Supremacy,+The.txt':'The Bourne Supremacy (film)',
'dailyscript.com scripts Braveheart.txt':'Braveheart','memories-of-murder-2003':'Memories of Murder','misery-1990':'Misery (film)',
'picnic-at-hanging-rock-1975':'Picnic at Hanging Rock (film)','the-tree-of-life-2011':'The Tree of Life (film)',
'treasureofthesierramadre':'The Treasure of the Sierra Madre (film)'}
rows=json.load(urllib.request.urlopen(os.environ.get('CATALOG_ORIGIN','http://127.0.0.1:4311')+'/catalog.json'))
results=[]
for row in rows:
    if row.get('author','').strip() or row.get('category')!='Script':continue
    title=re.sub(r'\s*\((?:19|20)\d{2}[^)]*\)|\s*\[p\..*?\]','',row['title']).strip()
    page=aliases.get(title,title)
    if not page or page.startswith(('New Microsoft','2019 BLACK','Memories of Murder (Kor')):continue
    try:
        response=get('https://en.wikipedia.org/w/api.php',dict(action='query',titles=page,redirects=1,prop='pageprops',format='json'))
        entry=next(iter(response['query']['pages'].values()))
        q=entry.get('pageprops',{}).get('wikibase_item')
        if not q:continue
        entity=get('https://www.wikidata.org/w/api.php',dict(action='wbgetentities',ids=q,props='claims',format='json'))['entities'][q]
        claims=entity.get('claims',{})
        types=[v.get('mainsnak',{}).get('datavalue',{}).get('value',{}).get('id') for v in claims.get('P31',[])]
        if 'Q11424' not in types and 'Q229390' not in types:continue
        ids=[v.get('mainsnak',{}).get('datavalue',{}).get('value',{}).get('id') for v in claims.get('P58',[])]
        ids=[x for x in ids if x]
        if not ids:continue
        names=get('https://www.wikidata.org/w/api.php',dict(action='wbgetentities',ids='|'.join(ids),props='labels',languages='en',format='json'))['entities']
        authors=[names[x]['labels']['en']['value'] for x in ids if names[x].get('labels',{}).get('en')]
        if len(authors)!=len(ids):continue
        results.append(dict(id=row['id'],title=row['title'],page=entry['title'],author='; '.join(authors),source='https://en.wikipedia.org/wiki/'+entry['title'].replace(' ','_'),entity=q))
        print(row['title'],'=>','; '.join(authors),flush=True)
    except Exception as e:print('Deferred',row['title'],str(e),flush=True)
    (out/'online-film-credits.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    time.sleep(.4)
print('Online screenplay matches:',len(results))
