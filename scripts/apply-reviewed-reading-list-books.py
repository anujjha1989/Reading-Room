#!/usr/bin/env python3
"""Exact reviewed book identities backed by online records and source labels."""
import importlib.util,json,urllib.request
from pathlib import Path
rows=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
reviewed={
'Ledbbd88be46ffa06f86aad0c99626331eb65c6cc':("The Panda’s Thumb: More Reflections in Natural History",'Stephen Jay Gould','https://wwnorton.co.uk/books/9780393308198-the-panda-s-thumb'),
'L4a163f77a49d27825730a52f8db94edbec61f943':("Sophie’s World: A Novel About the History of Philosophy",'Jostein Gaarder','https://us.macmillan.com/books/9781250860491/sophiesworld/'),
'Lf911a26c77529d2481fe535d96a9bcf6d022af31':('The Monster at the End of This Book','Jon Stone','https://www.penguinrandomhouse.com/books/241858/the-monster-at-the-end-of-this-book-by-jon-stone-illustrated-by-michael-smollin/'),
'L029e54a59a0cdf0dc54a377aa44eed006a6d19e8':('The Little Prince','Antoine de Saint-Exupéry','https://www.penguinrandomhouse.com/books/639583/the-little-prince-by-antoine-de-saint-exupery-translated-by-richard-howard/'),
'Lb562ce477d039073f1919cf7b8903296be83ec75':('Lord Edgware Dies','Agatha Christie','https://www.agathachristie.com/en/stories/lord-edgware-dies'),
'Ldf6b6a54e14a7311f9380c70071d7bd3dba80c76':('Sparkling Cyanide','Agatha Christie','https://www.agathachristie.com/en/stories/sparkling-cyanide'),
}
seuss={
'L280e9d43db34d14843c13d3556b1ada7ddbe89ca':'And to Think That I Saw It on Mulberry Street',
'Lf65167d4d274b5c255fa1196fd5663b9dd26bf54':'Bartholomew and the Oobleck',
'Le9a005ba59027b04d5e373ed460f98425ffbd4ad':'Horton Hatches the Egg',
'L431bcd6694bc68c4282272871859b4f067101f71':'If I Ran the Circus',
'Lc4e1820007616c0d6958db01878646135912cfc1':'If I Ran the Zoo',
'L765cb69164763ebfb6128dcbbad5996e33eeff03':"McElligot’s Pool",
'L7d62a2fa5a26d8fc8fc0df74d1c238083318f864':'Scrambled Eggs Super!',
'L75281bb12302f7fc24f8949fdcf3fb29b4daa61f':'The 500 Hats of Bartholomew Cubbins',
'Lf30f81ed34d05839d335bb515a3cea88068ea3a1':"The King’s Stilts",
}
for id,title in seuss.items():reviewed[id]=(title,'Dr. Seuss','https://en.wikipedia.org/wiki/Dr._Seuss_bibliography')
candidates=[]
for row in rows:
    if row['id'] not in reviewed or row.get('author','').strip():continue
    title,author,source=reviewed[row['id']]
    candidates.append(dict(id=row['id'],title=title,author=author,source=source))
spec=importlib.util.spec_from_file_location('batch',Path(__file__).with_name('catalogue-correction-batch.py'))
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch);batch.install(candidates)
