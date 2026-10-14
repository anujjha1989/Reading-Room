#!/usr/bin/env python3
"""User-approved series-creator credits, not claims about individual issue writers."""
import fcntl,json,re,urllib.request
from pathlib import Path
out=Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
log=json.loads((out/'applied.json').read_text())
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
# Specific collected works precede franchise-level creators. Existing credits
# and user corrections are never overwritten by this fallback pass.
rules=[
('path',r'/ Hush \[Batman Graphic Novel\]$','Jeph Loeb; Jim Lee','https://www.dc.com/graphic-novels/batman-hush'),
('title',r'^The Man Who Laughs$','Ed Brubaker; Doug Mahnke','https://www.dc.com/graphic-novels/batman-the-man-who-laughs'),
('title',r'^Secret Six\b','Gail Simone','https://www.dc.com/graphic-novels/secret-six-2006/secret-six-six-degrees-of-devastation'),
('title',r'^Teen Titans\b','Bob Haney; Bruno Premiani','https://static.dc.com/2024-01/DC-Connect_45.pdf?plid=675'),
('title',r'^Green Arrow\b','Mort Weisinger; George Papp','https://www.dc.com/graphic-novels/green-arrow-the-golden-age-omnibus-2017/green-arrow-the-golden-age-omnibus-vol-1'),
('title',r'^X-Man\b','Jeph Loeb; Steve Skroce','https://www.marvel.com/comics/issue/18177/x-man_1995_1'),
('title',r'^Gambit\b','Chris Claremont; Jim Lee','https://en.wikipedia.org/wiki/Gambit_%28Marvel_Comics%29'),
('title',r'^X-23\b','Craig Kyle; Christopher Yost','https://en.wikipedia.org/wiki/X-23'),
('title',r'^Gotham by Gaslight$','Brian Augustyn; Mike Mignola','https://www.dc.com/movies/batman-gotham-by-gaslight-2018'),
('title',r'^She-Hulk\b','Stan Lee; John Buscema','https://www.marvel.com/amp/articles/comics/marvel-characters-who-break-fourth-wall-she-hulk-deadpool-more'),
('title',r'^Captain America\b','Joe Simon; Jack Kirby','https://www.loc.gov/exhibitions/geppi-gems/about-this-exhibition/superheroes/marvel-comics/avengers-featuring-captain-america/'),
('title',r'^(?:The Mighty )?Thor\b','Stan Lee; Larry Lieber; Jack Kirby','https://www.marvel.com/articles/comics/stan-lee-silver-age-history-of-marvel-comics?linkId=192786135'),
('title',r'^Iron Man\b','Stan Lee; Larry Lieber; Don Heck; Jack Kirby','https://en.wikipedia.org/wiki/Iron_Man'),
('title',r'^Booster Gold\b','Dan Jurgens','https://danjurgens.com/about/'),
('title',r'^Runaways\b','Brian K. Vaughan; Adrian Alphona','https://www.marvel.com/comics/collection/47772/'),
('title',r'^Dazzler\b','Tom DeFalco; John Romita Jr.','https://en.wikipedia.org/wiki/Dazzler_%28Marvel_Comics%29'),
('title',r'^(?:The )?Incredible Hulk\b|^Fantastic Four\b','Stan Lee; Jack Kirby','https://www.marvel.com/comics/discover/801/jack-kirby'),
('title',r'^(?:Amazing )?Spider-Man\b','Stan Lee; Steve Ditko','https://www.marvel.com/articles/comics/stan-lee-silver-age-history-of-marvel-comics?linkId=192786135'),
('title',r'^Storm\b','Len Wein; Dave Cockrum','https://www.comics.org/character/14867/'),
('title',r'^Charlemagne\b','Jim Shooter','https://en.wikipedia.org/wiki/Charlemagne_%28comics%29'),
('title',r'^Marvel Comics Presents\b|^Marvel Holiday Special\b|^Marvel Fanfare\b|^Solo Avengers\b','Various Creators','https://www.comics.org/series/3654/details/creators/'),
('title',r'^Calvin and Hobbes\b','Bill Watterson','https://publishing.andrewsmcmeel.com/authors/bill-watterson/'),
('title',r'^Green Lantern(?: Corps)?\b','John Broome; Gil Kane','https://www.dc.com/graphic-novels/the-green-lantern-archives-1993/green-lantern-archives-vol-1'),
('title',r'^Doom Patrol\b','Arnold Drake; Bob Haney; Bruno Premiani','https://en.wikipedia.org/wiki/Doom_Patrol'),
('title',r'^Cable\b','Louise Simonson; Rob Liefeld','https://www.marvel.com/articles/comics/rob-liefeld-returns-to-marvel-comics-with-major-x'),
('title',r'^Generation X\b','Scott Lobdell; Chris Bachalo','https://www.comics.org/group/182/'),
('title',r'^(?:Warriors of Plasm|Plasm|SplatterBall|The Great Grimmax)\b','Jim Shooter; David Lapham','https://jimshooter.com/category/19-defiant/?order=asc'),
('title',r'^Dark Dominion\b','Jim Shooter; Steve Ditko','https://en.wikipedia.org/wiki/Dark_Dominion'),
('title',r'^The Good Guys\b','Jim Shooter','https://en.wikipedia.org/wiki/The_Good_Guys_%28comics%29'),
('title',r'^Dogs of War\b','Jim Shooter','https://en.wikipedia.org/wiki/Dogs_of_War_%28comics%29'),
('title',r'^War Dancer\b','Alan Weiss; Jim Shooter','https://en.wikipedia.org/wiki/War_Dancer'),
('title',r'^Catwoman - When in Rome\b','Jeph Loeb; Tim Sale','https://www.dc.com/graphic-novels/catwoman-when-in-rome-2004/catwoman-when-in-rome'),
('title',r'^Transmetropolitan Christmas Special\b','Warren Ellis; Darick Robertson','https://www.dc.com/talent/warren-ellis'),
('title',r'^(?:Coraline|Murder Mysteries by Neil Gaiman)\b','Neil Gaiman; P. Craig Russell','https://www.dc.com/talent/neil-gaiman'),
('path',r'/ Grimm Fairy Tales \[hjpotter92\]','Joe Brusha; Ralph Tedesco','https://www.newyorkcomiccon.com/content/dam/sitebuilder/rna/nycc/2021/docs/NYCC-Panels-2009.pdf.coredownload.059065506.pdf'),
('path',r'/ From Hell$','Alan Moore; Eddie Campbell','https://www.topshelfcomix.com/catalog/alan-moore'),
('path',r'/ Underground$','Jeff Parker; Steve Lieber','https://www.jeffparkerwrites.com/'),
('path',r'/ Bheriya$','Dheeraj Verma','https://en.wikipedia.org/wiki/Dheeraj_Verma'),
('title',r'^(?:New )?Excalibur\b','Chris Claremont; Alan Davis','https://www.marvel.com/comics/issue/8562/excalibur-1988-1'),
('title',r'^New Mutants\b','Chris Claremont; Bob McLeod','https://www.marvel.com/comics/series/2315/the_new_mutants_marvel_graphic_novel_%281982%29'),
('title',r'^X-Factor\b','Bob Layton; Jackson Guice','https://en.wikipedia.org/wiki/X-Factor_%28comics%29'),
('title',r'^(?:New )?Exiles\b','Judd Winick; Mike McKone','https://en.wikipedia.org/wiki/Exiles_%28Marvel_Comics%29'),
('title',r'^Blackest Night\b','Geoff Johns; Ivan Reis','https://www.dc.com/comics/blackest-night-2009/blackest-night-1'),
('path',r'/ Grant Morrison /|Doom Patrol v2 19-29 Grant Morrison','Grant Morrison','https://www.dc.com/talent/grant-morrison'),
('path',r'Batman.*Hush','Jeph Loeb; Jim Lee','https://www.dc.com/graphic-novels/batman-hush'),
('path',r'The Dark Knight Returns|Batman - Year One','Frank Miller','https://www.dc.com/talent/frank-miller'),
('path',r'Whatever Happened to the Caped Crusader','Neil Gaiman','https://www.dc.com/talent/neil-gaiman'),
('path',r'/ Neil Gaiman /|/ Endless$','Neil Gaiman','https://www.dc.com/talent/neil-gaiman'),
('path',r'/ Scott Pilgrim$','Bryan Lee O’Malley','https://www.onipress.com/titles/scott-pilgrim-print-collection-2004-2024'),
('path',r'Alex Ross_ Justice','Alex Ross; Jim Krueger','https://www.dc.com/graphic-novels/justice-2005/justice'),
('path',r'Kevin Smith_s Green Hornet','Kevin Smith','https://www.dynamite.com/htmlfiles/viewProduct.html?PRO=C114726'),
('title',r'What If\b','Roy Thomas','https://www.marvel.com/comics/issue/12121/x'),
('title',r'Black Panther|Black panther','Stan Lee; Jack Kirby','https://www.marvel.com/articles/movies/new-black-panther-featurette-explores-the-history-of-the-wakandan-king'),
('title',r'Wolverine','Len Wein; John Romita Sr.; Herb Trimpe','https://www.marvel.com/articles/comics/wolverine-logan-james-howlett-every-costume-list?cid=EML_Newsletter_202496_WeeklyPulse_Story1'),
('title',r'X-Force|Deadpool','Rob Liefeld; Fabian Nicieza','https://www.marvel.com/comics/issue/541/'),
('title',r'(?:The )?(?:Uncanny |New |Astonishing )?X-Men\b','Stan Lee; Jack Kirby','https://www.marvel.com/comics/discover/801/jack-kirby'),
('title',r'Gotham Knights\b','Bob Kane; Bill Finger','https://www.dc.com/blog/2019/03/19/batman-a-history-of-heroics-the-beginning'),
('title',r'Batman\b','Bob Kane; Bill Finger','https://www.dc.com/blog/2019/03/19/batman-a-history-of-heroics-the-beginning'),
('path',r'/ Ex Machina$','Brian K. Vaughan; Tony Harris','https://www.dc.com/talent/brian-k-vaughan'),
('path',r'/ The Walking Dead 1-79','Robert Kirkman; Tony Moore','https://imagecomics.com/comics/series/the-walking-dead'),
('path',r'/ Transmetropolitan$','Warren Ellis; Darick Robertson','https://www.dc.com/talent/warren-ellis'),
]
count=0
candidates=[]
for row in catalog:
    if row.get('author','').strip() or row.get('category')!='Graphic Novel':continue
    for field,pattern,author,source in rules:
        if not re.search(pattern,row.get(field,''),re.I):continue
        payload=dict(id=row['id'],author=author)
        candidates.append(dict(creditType='series-creator',source=source,**payload))
        count+=1
        if count%50==0:print('Creator credits applied:',count,flush=True)
        break
print('Series-creator pass:',count)
import importlib.util
spec=importlib.util.spec_from_file_location('batch',Path(__file__).with_name('catalogue-correction-batch.py'))
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
batch.install(candidates)
