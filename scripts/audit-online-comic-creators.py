#!/usr/bin/env python3
"""Online series/character creator matches for review, using explicit identities."""
import json,os,subprocess,urllib.parse
from pathlib import Path
out=Path(os.environ.get('CATALOG_REVIEW_OUTPUT','/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13'))
pages=['Hulk','Fantastic Four','Spider-Man','Avengers (comics)','Booster Gold','Green Arrow','Justice League','Outsiders (comics)','R.E.B.E.L.S. (comics)','Secret Six (comics)','Teen Titans','Glory (character)','Prudence and Caution','Dazzler (Marvel Comics)','She-Hulk','Runaways (comics)','Bishop (Marvel Comics)','X-23','Namor','X-Man','Gambit (Marvel Comics)','Alpha Flight','Captain America','Thor (Marvel Comics)','Silver Surfer','Iron Man','Cloak and Dagger (characters)','Doctor Strange','New Warriors','Ghost Rider (Johnny Blaze)','Captain Marvel (Mar-Vell)','Ghost Rider (Danny Ketch)','Mutant X (comics)','Warlock (New Mutants)','Cyclops (Marvel Comics)','Iceman (Marvel Comics)','Chamber (character)','Morlocks (comics)','Mekanix','Soldier X','Weapon X','Emma Frost','X-Statix','Mystique (character)','Starjammers','Jubilee (Marvel Comics)','NYX (comics)','Secret War (comics)','Colossus (character)','Generation Hope','Chaos War','Onslaught (comics)','Mutopia X','Gotham by Gaslight','Batman: The Man Who Laughs']
def get(base,params):
    result=subprocess.run(['curl','-fsSL','--max-time','20',base+'?'+urllib.parse.urlencode(params)],capture_output=True,timeout=25,check=True)
    return json.loads(result.stdout)
found=[]
for offset in range(0,len(pages),35):
    values=get('https://en.wikipedia.org/w/api.php',dict(action='query',titles='|'.join(pages[offset:offset+35]),redirects=1,prop='pageprops',format='json'))['query']['pages'].values()
    entries=[e for e in values if e.get('pageprops',{}).get('wikibase_item')]
    ids=[e['pageprops']['wikibase_item'] for e in entries]
    entities=get('https://www.wikidata.org/w/api.php',dict(action='wbgetentities',ids='|'.join(ids),props='claims',format='json'))['entities']
    candidates=[]
    for entry in entries:
        q=entry['pageprops']['wikibase_item'];claims=entities[q].get('claims',{})
        prop='P170' if claims.get('P170') else 'P50'
        creators=[v.get('mainsnak',{}).get('datavalue',{}).get('value',{}).get('id') for v in claims.get(prop,[])]
        creators=[c for c in creators if c]
        if creators:candidates.append(dict(page=entry['title'],ids=creators,source='https://en.wikipedia.org/wiki/'+entry['title'].replace(' ','_')))
    ids=sorted({i for c in candidates for i in c['ids']})
    labels={}
    for n in range(0,len(ids),40):labels.update(get('https://www.wikidata.org/w/api.php',dict(action='wbgetentities',ids='|'.join(ids[n:n+40]),props='labels',languages='en',format='json'))['entities'])
    for c in candidates:
        names=[labels[i].get('labels',{}).get('en',{}).get('value') for i in c['ids']]
        if all(names):found.append(dict(page=c['page'],author='; '.join(names),source=c['source']))
    (out/'online-comic-creators.json').write_text(json.dumps(found,ensure_ascii=False,indent=2))
print(json.dumps(found,ensure_ascii=False,indent=2))
