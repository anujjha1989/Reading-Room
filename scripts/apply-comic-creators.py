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
('title',r'^Icons - Chamber\b','Brian K. Vaughan; Lee Ferguson','https://atomicavenue.com/atomic/series/17941/ComicBook/Chamber'),
('title',r'^House Of M Sketchbook$','Brian Michael Bendis; Olivier Coipel','https://en.wikipedia.org/wiki/House_of_M'),
('title',r'^Marvel Team-Up V1 #149$','Louise Simonson','https://fichas.universomarvel.com/usa/mtu1149.html'),
('title',r'^Avengers V3\b','Kurt Busiek; George Pérez','https://www.marvel.com/articles/comics/captain-marvel-s-history-with-the-avengers'),
('title',r'^Phoenix Resurrection\b','Ian Edginton; Dan Abnett','https://www.mightyavengers.net/comics/issue/the-phoenix-resurrection-genesis-1'),
('title',r'^Hellbound\b','Christopher Yost; Harvey Tolibao','https://www.mightyavengers.net/node/18558'),
('title',r'^Icons - Iceman\b','Dan Abnett; Andy Lanning; Karl Kerschl','https://www.mightyavengers.net/comics/collection/x-men-icons-iceman'),
('title',r'^Legends of the Dark Knight 178$','Devin Grayson','https://www.dcuguide.com/Batman%3A_Legends_of_the_Dark_Knight_178'),
('title',r'^X-Men[ _]Vs\.?[ _]','Jeff Parker','https://www.marvel.com/comics/issue/28973/x-men_vs_agents_of_atlas_2009_1'),
('title',r'^Marvel Team-Up V3\b','Robert Kirkman','https://www.marvel.com/comics/issue/76/marvel_team-up_2004_1'),
('title',r'^Icons - Cyclops\b','Brian K. Vaughan; Mark Texeira','https://en.wikipedia.org/wiki/Brian_K._Vaughan'),
('path',r'/ Sin City','Frank Miller','https://images.darkhorse.com/common/salestools/catalogs/DH_Backlist_2009.pdf'),
('title',r'^Beauty And The Beast\b','Ann Nocenti','https://www.marvel.com/comics/issue/62749/beauty_and_the_beast_1985_1'),
('title',r'^X-Terminators\b','Louise Simonson; Jon Bogdanove','https://fichas.universomarvel.com/usa/xtm102.html'),
('path',r'/ Bone$','Jeff Smith','https://catalog.wake.gov/GroupedWork/f89f6448-d08e-b61c-73f0-70bde0292865'),
('path',r'/ Calvin and Hobbes','Bill Watterson','https://www.simonandschuster.com/authors/Bill-Watterson/19962368'),
('title',r'^Captain Marvel V2\b','Fabian Nicieza','https://fichas.universomarvel.com/usa/capmar201.html'),
('title',r'^Ghost Rider V2\b','Howard Mackie; Javier Saltares','https://www.comics.org/character/2323/'),
('title',r'^Heroes Reborn - The Return\b','Peter David','https://www.marvel.com/comics/issue/58429/heroes_reborn_the_return_1997_4'),
('title',r'^X-Babies\b|^X-Babies_','Gregg Schigiel','https://www.penguinrandomhouse.com/authors/48757/gregg-schigiel/'),
('title',r'^Soldier X\b','Darko Macan; Igor Kordey','https://www.astiberri.com/authors/darko-macan'),
('title',r'^Dead Avengers\b','Fred Van Lente; Tom Grummett','https://www.comics.org/issue/787957/'),
('title',r'^Morlocks\b','Geoff Johns; Shawn Martinbrough','https://www.marvel.com/comics/issue/73223/morlocks_2002_3'),
('title',r'^Chaos War\b','Greg Pak; Fred Van Lente','https://gregpak.com/cosmic-book-news-interviews-greg-pak-and-fred-van-lente-about-chaos-war/'),
('title',r'^Onslaught Unleashed\b','Sean McKeever; Filipe Andrade','https://en.wikipedia.org/wiki/List_of_X-Men_limited_series_and_one-shots'),
('title',r'^Adventure Comics\b','Geoff Johns','https://www.dc.com/comics/adventure-comics-2009/adventure-comics-5'),
('title',r'^Muties\b','Karl Bollers','https://www.marvel.com/comics/issue/73226/muties_2002_1'),
('title',r'^Mekanix\b','Chris Claremont; Juan Bobillo','https://en.wikipedia.org/wiki/Mekanix'),
('title',r'^X-Calibre\b','Warren Ellis; Ken Lashley','https://www.marvel.com/comics/guides/147/discover-creator-warren-ellis'),
('title',r'^X-Universe\b','Terry Kavanagh; Scott Lobdell','https://www.comics.org/issue/57058/'),
('title',r'^Weapon X\b','Frank Tieri','https://uncannyxmen.net/comics/issue/weapon-x-2nd-series-1'),
('title',r'^Warlock\s*#?\s*0?5$','Chris Claremont; Bill Sienkiewicz','https://www.marvel.com/comics/issue/10353/newmutants198318Link'),
('title',r'^Prudence and Caution\b','Jim Shooter','https://en.wikipedia.org/wiki/Prudence_%26_Caution'),
('title',r'^Glory\b','Rob Liefeld','https://imagecomics.com/news/going-out-in-a-blaze-of-glory'),
('title',r'^Generation Hope\b','Kieron Gillen','https://www.marvel.com/comics/issue/30078/slug'),
('title',r'^Mutopia X\b','David Hine; Lan Medina','https://en.wikipedia.org/wiki/David_Hine'),
('title',r'^Mutant X\b','Howard Mackie; Tom Raney','https://www.comics.org/issue/62236/'),
('title',r'^X-Statix\b','Peter Milligan; Michael Allred','https://www.marvel.com/articles/comics/peter-milligan-michael-allred-and-laura-allred-return-with-more-mutant-madness-in-the-x-cellent'),
('title',r'^REBELS\b','Tony Bedard; Andy Clarke','https://www.dc.com/graphic-novels/r-e-b-e-l-s-2009/r-e-b-e-l-s-vol-1-the-coming-of-starro'),
('title',r'^Outsiders\b','Mike W. Barr; Jim Aparo','https://www.dc.com/graphic-novels/batman-and-the-outsiders-1984/batman-and-the-outsiders-vol-1'),
('title',r'^Justice League(?: of)? America\b','Gardner Fox; Mike Sekowsky','https://www.dc.com/talent/mike-sekowsky'),
('title',r'^Secret Wars\b','Jim Shooter; Mike Zeck; Bob Layton','https://www.marvel.com/articles/comics/secret-wars-official-marvel-guide'),
('title',r'^Secret War\b','Brian Michael Bendis; Gabriele Dell’Otto','https://www.marvel.com/articles/comics/an-oral-history-of-secret-invasion'),
('title',r'^Emma Frost\b','Chris Claremont; John Byrne','https://www.marvel.com/amp/articles/comics/the-essential-emma-frost'),
('title',r'^Starjammers\b','Chris Claremont; Dave Cockrum','https://www.marvel.com/comics/collection/77922/x-men_starjammers_by_dave_cockrum_trade_paperback'),
('title',r'^Warlock\\?s? 0?5$','Chris Claremont; Bill Sienkiewicz','https://www.marvel.com/comics/issue/10353/newmutants198318Link'),
('title',r'^NYX\b','Joe Quesada; Joshua Middleton','https://en.wikipedia.org/wiki/NYX_%282003_series%29'),
('title',r'^Mystique\b','Chris Claremont; Dave Cockrum','https://en.wikipedia.org/wiki/Mystique_%28character%29'),
('title',r'^Jubilee\b','Chris Claremont; Marc Silvestri','https://en.wikipedia.org/wiki/Jubilee_%28character%29'),
('title',r'^(?:The Times And Life Of Lucas )?Bishop\b','Whilce Portacio; John Byrne','https://www.marvel.com/comics/issue/80137/true_believers_x-men_-_bishop_2019_1'),
('title',r'^Colossus\b','Len Wein; Dave Cockrum','https://en.wikipedia.org/wiki/Colossus_%28character%29'),
('title',r'^New Warriors\b','Fabian Nicieza; Mark Bagley','https://www.marvel.com/comics/issue/42854/new-warriors-1990-1'),
('title',r'^The Mutant Misadventures Of Cloak And Dagge','Bill Mantlo; Ed Hannigan','https://en.wikipedia.org/wiki/Cloak_and_Dagger_%28characters%29'),
('title',r'^Blaze\b','Roy Thomas; Gary Friedrich; Mike Ploog','https://en.wikipedia.org/wiki/Ghost_Rider'),
('title',r'^Alpha Flight\b','John Byrne','https://www.marvel.com/comics/collection/107765/'),
('title',r'^(?:Dr |Doctor )Strange\b','Stan Lee; Steve Ditko','https://www.marvel.com/comics/guides/201/doctor_strange_the_sorcerer_supreme'),
('title',r'^Silver Surfer\b','Stan Lee; Jack Kirby','https://www.marvel.com/articles/comics/who-is-silver-surfer-the-official-marvel-guide?linkId=231447808'),
('title',r'^Namor\b','Bill Everett','https://www.marvel.com/amp/articles/comics/namora-explainer-namor-cousin-agents-of-atlas'),
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
def fold(value):return re.sub(r'[^a-z0-9]','',value.lower())
verified_names={fold(name) for _,_,credit,_ in rules for name in credit.split('; ')}
verified_names.update(map(fold,['Garth Ennis','Brian Azzarello','Chris Ware','Alison Bechdel','Art Spiegelman','Jeff Smith','Daniel Clowes','Craig Thompson','Steven T. Seagle']))
for row in catalog:
    if row.get('category')!='Graphic Novel':continue
    existing=row.get('author','').strip()
    fragment=existing and fold(existing) not in verified_names and fold(existing) in fold(row.get('title','')+' '+row.get('path',''))
    if existing and not fragment:continue
    for field,pattern,author,source in rules:
        if not re.search(pattern,row.get(field,''),re.I):continue
        payload=dict(id=row['id'],author=author)
        if existing:payload['expectedScannedAuthor']=existing
        candidates.append(dict(creditType='series-creator',source=source,**payload))
        count+=1
        if count%50==0:print('Creator credits applied:',count,flush=True)
        break
print('Series-creator pass:',count)
import importlib.util
spec=importlib.util.spec_from_file_location('batch',Path(__file__).with_name('catalogue-correction-batch.py'))
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
batch.install(candidates)
