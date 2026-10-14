#!/usr/bin/env python3
"""Apply reviewed printed credits; retain evidence and never rewrite book files."""
import fcntl,json,re,urllib.request
from pathlib import Path
out=Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
lock=open(out/'apply.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
evidence=json.loads((out/'remaining-frontmatter.json').read_text())
log=json.loads((out/'applied.json').read_text())
catalog=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
reviewed={
'L1a5d0a523b580f0584aca7f447ed455d91396c95':('The Keys to the Street','Christopher Nolan; Michael Stokes'),
'L219301637cea44ae0567370c2a2a96eb0c74634d':('Absolute Power','William Goldman'),
'L409a51a0e054f4dd49943be775549247e4161bbd':('Analyze That','Peter Steinfeld; Harold Ramis; Peter Tolan'),
'La49b57fad4f1689b96d0fe76decd5107d572057c':('Atonement','Christopher Hampton'),
'Lcb053fa6715ed50cb376660d3d0d8e5c1febe1fc':("Before the Devil Knows You’re Dead",'Kelly Masterson'),
'L68722f5a5c5151e68458cc0d3fdcc476747ce1f7':('Being There','Jerzy Kosinski; Robert C. Jones'),
'L8bd83ce41569dd8aed7206cee4dabc3bff6cecbf':('The English Patient','Anthony Minghella'),
'L9a15947fd04f869a9aa3fa3460f75aea4287f4f7':('The Godfather Part II [Digital]','Mario Puzo; Francis Ford Coppola'),
'Lf1cbaa2f71403cb411b2395229b30d1b08314ac6':('The Godfather Part II','Mario Puzo; Francis Ford Coppola'),
'L887ce03cd8f8b7abb29f65857d28e5b497f5af77':('The Godfather Part II','Mario Puzo; Francis Ford Coppola'),
'L6855016bd8727a7edf5aafe73f34cae6aa0f68de':('Ikiru','Shinobu Hashimoto; Akira Kurosawa; Hideo Oguni'),
'L3b5b1dac685d2624646fb6a86ad65ce91c16b4bb':('King Kong (2005)','Fran Walsh; Philippa Boyens; Peter Jackson'),
'L34fbdfcc99ff71d9f9134fab30a5efa25790b88d':('MASH','Ring Lardner Jr.'),
'L1b2b14aece807ecc5423e8ca58c23e4a7fa54e15':('Moon','Nathan Parker'),
'L348a7bbd4d8c5323d3b3da406cc44093c6105f4d':('Mr. Smith Goes to Washington','Sidney Buchman'),
'Ld08f6d6f843c3720ac3493e11c26bb7b382ba057':('The Next Three Days','Paul Haggis'),
'L909871b18528b4341a72cea863207a2ad0514108':('The Night of the Hunter','James Agee; Charles Laughton'),
'L04ba2308e403cd472ef6494ac4e4c9acd2a79ccc':('Ran','Akira Kurosawa; Hideo Oguni; Masato Ide'),
'Lb8befeff94d7f0364c79df023c8cb138406d05b0':('Scream 4','Kevin Williamson'),
'L1801ec7b127401342fab590b8ed64e15df9ab84a':('Seven Samurai','Akira Kurosawa; Shinobu Hashimoto; Hideo Oguni'),
'L91eed6623727cb5ea350717319d80fa79d2ed62c':('Sideways','Alexander Payne; Jim Taylor'),
'L1fcd0e55e1a6f1b86994f3c275ad0ec0dfcc6b8c':('Some Like It Hot [Digital]','Billy Wilder; I. A. L. Diamond'),
'Lee0cef718d9da31d944dfdcf8b2f77e538a71e9f':('Sweeney Todd','John Logan'),
'L90f46a6ce17da8a044c0ef82f5b74b40b8d09527':('There Will Be Blood','Paul Thomas Anderson'),
'L43850d8dee201845eb6c66f2129e6ab52c202b8a':('Taxi Driver','Paul Schrader'),
'Lb4636c291d5d5be2edb32841379ae628751e3fa5':('Up in the Air','Jason Reitman; Sheldon Turner'),
'L975a742f46c628eab5e6bdcabf59cc8da0b1414d':('The Wizard of Oz','Noel Langley; Florence Ryerson; Edgar Allan Woolf'),
'Le7ead48b3531befc2a3db660d272ed644bcb1922':('Anora','Sean Baker'),
'L1dc33befc603f4adce48b25fca7d1e98cc01d9a7':('Conclave','Peter Straughan'),
'L328e4c399b5f99f74b756203f3999cacc29e457d':('Parasite','Bong Joon Ho; Han Jin Won'),
'L1b9ca80652e3ccf08506f0ad9757ece4ea323949':('I Heart Murder',"Tom O’Donnell"),
'L5ff0d4cd92d37662a199a15800e1e2695c825c79':('The House Is Not for Sale','Roy Parker'),
'Lf3a57e0319103d19376091a021d2488c8a1973d4':('Diamond as Big as the Ritz','Cody Behan'),
'Lc0b93c7f04f6a3cb0beb10822594e6ba19b46ca4':("Don’t Go in the Water",'Peter Joseph'),
'L4728e4e68c5f0dc2f2f1b740f1dbfd376fd8953c':('This Is Going to Hurt','Cameron Fay'),
'Ld1c8d08b1bf3536b36ef9c2e29687aa2f8653935':('Magical Place Called Glendale','Sara Monge'),
'Lbfa41afb71b3c289fe08e33d4837c540c408b659':('Doctor Faustus','Thomas Mann'),
'Lb2fa528a71cc8da83c234bb022a6191b749450fc':("Dave Barry’s Only Travel Guide You’ll Ever Need",'Dave Barry'),
'Lf904209c411d758b90aeea2dde14db84fad1112f':('A Walk to Remember','Nicholas Sparks'),
'Le9dfc5870dd785335762e0635d89d8441a25e34b':("Captain Corelli’s Mandolin",'Louis de Bernières'),
'Lf109bec8ae92d164e5eafd34ca0953dd36fee656':('The Jungle','Upton Sinclair'),
'Lf3148a131f05a2b6aae0b9c06a55cd631fc6bebb':('The Thorn Birds','Colleen McCullough'),
'L8655c01f1b31a6d9a0134e11864780f8a600a134':('Wuthering Heights','Emily Brontë'),
'L2938388b39bd9a6c7468d9c389169ecf219e16a9':('War and Peace','Leo Tolstoy'),
'L0d839124d08d8d34dc9f281415684c3d427ceb79':('Good Omens','Neil Gaiman; Terry Pratchett'),
'L816fbda7bb15bcfe69be21b266763cc50404cec3':('A Stranger in the Mirror','Sidney Sheldon'),
'L572920a7b41a61b094071fc3dab0d6c0d49412f3':('The Stars Shine Down','Sidney Sheldon'),
'L96963cbca0ea3dd09747a544e8b60d8294db4fd0':('Word-Formation in English','Ingo Plag'),
'Lc3208df403ba43b32a3b7da0ce08a96f907868d0':('Handy Dictionary of Poetical Quotations','George W. Powers'),
'L31dd28a91aed8556e74f9da4080f18bb01e6d501':('The Divine Invasion','Philip K. Dick'),
'Lbee4aa58dc9668b17a93d07e1e056d11f2d24e19':('The Psychology of Imagination','Jean-Paul Sartre'),
'Lbd48ac8b2a393d9f234d442e36efb8925f2b186c':('365 Steps to Self-Confidence','David Lawrence Preston'),
'Le243661d7689bc3657dd8a41407833a8c3fbf06c':('Being John Malkovich','Charlie Kaufman'),
'L4856b9b493bffe7bcade7ea60216df78cfe651fa':('Being John Malkovich: Introduction','Charlie Kaufman'),
'L594ae57c6ade89b936eaf4b0083415a5f65ab41c':('Human Nature: Interview with Charlie Kaufman','Dave Franklin'),
'L9affde99824d54ad7e4a6ad7d2d04685aaaa8de0':('Batman Begins: David Goyer Draft','David Goyer'),
'L4b93c6524e898408a4b04d38aae8122630594d63':('Inception','Christopher Nolan'),
'L8951a805f9b9583817cf321a15f7fd4d65385cc7':('The Dark Knight','Jonathan Nolan; Christopher Nolan'),
'Lb136aee2db61e16cd7bd3bc77e8e209a1d3b5e19':('The Curious Case of Benjamin Button (2007-10-30 Draft)','Eric Roth'),
'L5de82ebe0f129dfb6c230a2b5740d184b1453fc0':('Natural Born Killers','Quentin Tarantino'),
'L8b922cbc14a448bdea11e891fc2ddab3167d4c0c':('Natural Born Killers (1990 Draft)','Quentin Tarantino'),
'Lf8b8c1e67c8d72e605b92d7b5df9ba93d8296527':('True Romance (1992 Draft)','Quentin Tarantino'),
'Lfd723f4efbbf5672f2a0c2ed62d1bfeaf0819708':('25th Hour','David Benioff'),
'L2025be219d29c494c5d4fa54417c73b95056eca1':('Alien: Revised Final Draft','Walter Hill; David Giler; Dan O’Bannon'),
'L4848840033f722f3ddd4aaf069336ad361c549d3':('The American','Rowan Joffe'),
'L546b3506992583b9d514f3e192f23b8f304a8547':('The Apartment','Billy Wilder; I. A. L. Diamond'),
'Le6b28ef8138a2b1d252c2bcdd66014ab5c1c39b5':('Apocalypse Now: Redux','John Milius; Francis Ford Coppola; Michael Herr'),
'L0a6016afd042562f9b1f47d3b45b8b70187287be':('Apt Pupil','Brandon Boyce'),
'L4c356184c05224d962ac4dbc1537229506d96fa8':('Bad Santa (Production Draft)','Glenn Ficarra; John Requa; Ethan Coen; Joel Coen; Terry Zwigoff'),
'L2d7522e52f0dc885133f4ba9c4b2816b64d30e64':('Barry Lyndon','Stanley Kubrick'),
'Ldcab7d2db7c0680777d1b7c59175818b01f8c812':('The Big Sleep','William Faulkner; Leigh Brackett; Jules Furthman'),
'Lac3f3efdab7ee80e9359c43142b002e7a048d208':('Bringing Out the Dead','Paul Schrader'),
'L193782c822a98e35ce88176b519c8d0e672ffdcd':('Bruce Almighty (2002 Draft)','Steve Koren; Mark O’Keefe; Steve Oedekerk'),
'Lb4ae08d3141525bf7e8d55bcdb4ad55f26df4b71':('Capote','Dan Futterman'),
'L49c6ed6f2bcf95da988edfeccafb45f3eef3c182':('Casablanca','Julius J. Epstein; Philip G. Epstein; Howard Koch'),
'Lea6d1c2518e4b26897f01a3c826c35ffe3acd16d':('Cinema Paradiso','Giuseppe Tornatore'),
'L16f4244ed99c0edd6064c9e069f975588d8abf08':('Cloudy with a Chance of Meatballs','Phil Lord; Chris Miller'),
'Lea6e7206cc2423c693ad8d4fb56004d219399e15':('Fight Club','Jim Uhls'),
'L201b0b3befa3e1c34a4af9a779b71fc38d8fcc1e':('Four Lions','Christopher Morris; Jesse Armstrong; Sam Bain; Simon Blackwell'),
'L97c034d2406ca1f4fd9e9c7d194fc6b13cff015e':('Full Body Massage','Dan Gurskis'),
'L7df3ceaa7da3a216f8affb4bacee704ede7905f3':('The Grapes of Wrath','Nunnally Johnson'),
'L1be7994d64900dc81234b9fb4ee600d37be559ad':('Hannah and Her Sisters (Shooting Script)','Woody Allen'),
'Ldb88cd3e5971830fb696973e0d1f17a353e11774':('Hugo','John Logan'),
'Le87c7a526a62622d089916c0147bbc0df1c9e99d':('Hunger (Shooting Script)','Enda Walsh; Steve McQueen'),
'L7a6f899eac0dfb9a8417360fc21a484e9ac6ed16':('Hunger (Shooting Script)','Enda Walsh; Steve McQueen'),
'L0f5c004affce71e290a961c88aa998ce4cbfeec8':("It’s a Wonderful Life",'Frances Goodrich; Albert Hackett; Jo Swerling; Frank Capra'),
'Le1960c653e8ce17aeb68ba1797201f6fb94eb8c6':('Kill Bill','Quentin Tarantino'),
'Lf4b4fbffc967ab0016fba6e0ee5672f938f929db':('Lost in Translation','Sofia Coppola'),
'L74e486dc4455fe157984d9eaf8db40e2175d9869':('The Maltese Falcon','John Huston'),
'Lb7b45721fef6b83d4cd0ed76b9e30b33aa737177':('The Maltese Falcon','John Huston'),
'L9afbca6cf11d11280a72e617a9448f895dbe9d7f':('Midnight in Paris','Woody Allen'),
'Le1308515925d6fe77854bf0a59902588e8b4b80c':('Moneyball','Steven Zaillian; Aaron Sorkin'),
'L03b46a59b490b955600145819381f2e80da2f44d':('On the Waterfront','Budd Schulberg'),
'L0ca49710a6db4972a52982fe62357bda3f5c5d03':("Pan’s Labyrinth",'Guillermo del Toro'),
'L7bd089721887a250e3e0e89ed683b32b396ea410':('Raging Bull','Paul Schrader; Mardik Martin'),
'L84abe70fd2b897f3d3222916f8138581746303e2':('Ratatouille','Brad Bird'),
'Ldad393001b77c69819dffc85957c5c841a464826':('Rear Window','John Michael Hayes'),
'Ld441db23fd767dfe4b3df3ae3b52013108c60349':('Scream 2','Kevin Williamson'),
'L4aed9c8790f8b6daddb160f18f34f8d15df695b0':('Scream 3','Ehren Kruger'),
'Lae3bf4cae42a26fc9f75a299529bb26679ef8982':('Shame','Abi Morgan; Steve McQueen'),
'Lb0d4f4b517846692d5eedaf11d87c36598e701c9':('Super 8','J. J. Abrams'),
'L496ac0d2f85c80224704774064e6f829f91285a3':('The Artist','Michel Hazanavicius'),
'Lf0759e4817ff3a497145aae32f1ca7860acedfaa':('The Godfather','Mario Puzo; Francis Ford Coppola'),
'Lb491da84bfe992a4066d734c5922772fb8374702':('The Piano','Jane Campion'),
'L82d539435d9867ba6d73bf092b9371fd9623cbb8':('The Road','Joe Penhall'),
'L55bffc6d272c794e0539586a804a0f6bb5bbfcf8':('The Shawshank Redemption','Frank Darabont'),
'L6eb5e80ac19bfd405e74595d1219b6e6b2c392f3':('The Silence of the Lambs','Ted Tally'),
'Le9e5d41d068d5e64b6625a6afe266a67320718ee':('Throne of Blood','Shinobu Hashimoto; Ryuzo Kikushima; Akira Kurosawa; Hideo Oguni'),
'L515fc1edc1c299aab368ea237e8852572fd23860':('Training Day','David Ayer'),
'Lb98485fa1891f99431eaac636bf49447ff90f6f1':('Training Day','David Ayer'),
'Le1351f784ab14f2023d718ff7fa6cf2e3f213f3f':("Monster’s Ball",'Milo Addica; Will Rokos'),
'L1c6e4a415e7a92ef5fb331eed516572a34bfce6f':('Snatch','Guy Ritchie'),
'Lce256e7983b781eb35a6611996b82c571f30aa7e':('The Ghost and the Darkness','William Goldman'),
'L777da591a3b34e6530c6a4631754afa8941a4cc1':('The Brutalist (Final Shooting Draft)','Brady Corbet; Mona Fastvold'),
'L8cf6df0d1b01b898f39d1fdf5fd0c5bf412464d6':('The Princess Bride','William Goldman'),
'Lda73f800c344f1e58e9295271c319d2ab3569fda':('The Substance','Coralie Fargeat'),
'L1c64a79ededbe552201012dcc571bad1139ae1f1':('White Noise','Noah Baumbach'),
'L4de83b2a372d4666997af2d40505087119cb936e':('10-31','Ian Shorr; Peter Gamble'),
'L3a2039b1c9df370381e01de6b10dfa13cbc58efc':('Death of a Salesman','Arthur Miller'),
}
for row in catalog:
    id=row['id']
    own=any(item.get('id')==id and str(item.get('source','')).startswith('Reviewed original front matter:') for item in log)
    if id not in evidence:continue
    text=evidence[id]['text']
    poetry=re.match(r'\s*Classic Poetry Series\s+(.+?)\s+- poems -',text)
    pg=re.search(r'^Author:\s*([^\n\r]+)',text[:2000],re.M)
    volume=re.match(r'Complete Works of Swami Vivekananda\s+Volume (\d+)',text.strip())
    if poetry:reviewed[id]=(f'Poems of {poetry[1]}',poetry[1].strip())
    elif pg and pg.group(1).strip()=='Various':reviewed[id]=(row['title'].replace(' By Var',''),'Various Authors')
    elif volume:reviewed[id]=(f'The Complete Works of Swami Vivekananda, Volume {volume[1]}','Swami Vivekananda')
    if id not in reviewed:continue
    title,author=reviewed[id]
    if row.get('author','').strip() and row['author']!=author and not own:continue
    payload=dict(id=id,author=author)
    if not row.get('titleCorrected'):payload['title']=title
    if row.get('author')==author and row.get('titleCorrected'):
        if not any(item.get('id')==id and item.get('author')==author for item in log):
            log.append(dict(kind='metadata',source='Reviewed original front matter: '+evidence[id]['path'],**payload))
            (out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
        continue
    request=urllib.request.Request('http://127.0.0.1:4311/api/meta-fix',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=30) as response:
        if not json.load(response).get('ok'):raise RuntimeError(id)
    log.append(dict(kind='metadata',source='Reviewed original front matter: '+evidence[id]['path'],**payload))
    (out/'applied.json').write_text(json.dumps(log,ensure_ascii=False,indent=2))
print('Printed-credit pass complete')
