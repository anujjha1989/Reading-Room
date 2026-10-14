#!/usr/bin/env python3
"""Remove import encoding from display titles; never edit book files or IDs."""
import importlib.util,json,re,urllib.request
from pathlib import Path
rows=json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))
candidates=[]
for row in rows:
    if row.get('category')!='Graphic Novel':continue
    original=row['title'];title=original
    saga=re.match(r'^Saga_(\d{3})_28',title)
    if saga:title='Saga #'+str(int(saga[1]))
    else:
        title=re.sub(r'(?<=\w)_(s|t|ll|ve|re)\b',r'’\1',title)
        title=re.sub(r'(?<=\w)s_\s', 's’ ',title)
        title=re.sub(r'\s_\s',' & ',title)
        title=title.replace('_',' ')
        title=re.sub(r'\s+',' ',title).strip()
    if title!=original:
        candidates.append(dict(id=row['id'],title=title,source='Original catalogue title: punctuation/filename-encoding cleanup only'))
spec=importlib.util.spec_from_file_location('batch',Path(__file__).with_name('catalogue-correction-batch.py'))
batch=importlib.util.module_from_spec(spec);spec.loader.exec_module(batch)
batch.install(candidates)
