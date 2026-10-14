#!/usr/bin/env python3
"""Install reviewed missing-field corrections atomically, with rollback."""
import fcntl,json,os,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
out=Path('/mnt/seagate/ReadingRoom/library-repair-backups/scrub-2026-10-13')
data=Path('/var/lib/reading-room')
def atomic(path,value):
    temporary=path.with_name(path.name+'.scrub-next')
    with open(temporary,'w') as f:
        json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    os.chmod(temporary,0o640);shutil.chown(temporary,group='reading-room');os.replace(temporary,path)
def install(candidates):
    lock=open(out/'apply.lock','a');fcntl.flock(lock,fcntl.LOCK_EX)
    rows={r['id']:r for r in json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json'))}
    for p in candidates:
        if p['id'] not in rows or not p.get('source'):raise ValueError('Missing identity/evidence')
        for key in ('author','title'):
            if key in p and (not isinstance(p[key],str) or not p[key].strip() or len(p[key])>300):raise ValueError('Invalid metadata')
    backup=out/('batch-'+str(time.time_ns()));backup.mkdir()
    subprocess.run(['systemctl','stop','reading-room'],check=True)
    installed=[]
    try:
        maps={name:json.loads((data/name).read_text()) for name in ('author-fixes.json','title-fixes.json')}
        for name in maps:shutil.copy2(data/name,backup/name)
        shutil.copy2(out/'applied.json',backup/'applied.json')
        log=json.loads((out/'applied.json').read_text())
        for p in candidates:
            id=p['id'];fields={}
            if p.get('author') and not rows[id].get('author','').strip() and id not in maps['author-fixes.json']:
                fields['author']=p['author'];maps['author-fixes.json'][id]=p['author']
            if p.get('title') and id not in maps['title-fixes.json']:
                fields['title']=p['title'];maps['title-fixes.json'][id]=p['title']
            if fields:
                installed.append(dict(kind='metadata',id=id,source=p['source'],creditType=p.get('creditType','author'),**fields))
        for name,value in maps.items():atomic(data/name,value)
        log.extend(installed);atomic(out/'applied.json',log)
    except Exception:
        for name in ('author-fixes.json','title-fixes.json'):
            if (backup/name).exists():shutil.copy2(backup/name,data/name)
        if (backup/'applied.json').exists():shutil.copy2(backup/'applied.json',out/'applied.json')
        raise
    finally:subprocess.run(['systemctl','start','reading-room'],check=True)
    try:
        for attempt in range(10):
            try:
                current={r['id']:r for r in json.load(urllib.request.urlopen('http://127.0.0.1:4311/catalog.json',timeout=10))};break
            except Exception:
                if attempt==9:raise
                time.sleep(.5)
        for p in installed:
            if p['id'] not in current:continue # Existing work merges remain permitted.
            for key in ('title','author'):
                if key in p and current[p['id']].get(key)!=p[key]:raise RuntimeError('Live correction mismatch: '+p['id'])
    except Exception:
        subprocess.run(['systemctl','stop','reading-room'],check=True)
        for name in ('author-fixes.json','title-fixes.json'):shutil.copy2(backup/name,data/name)
        shutil.copy2(backup/'applied.json',out/'applied.json')
        subprocess.run(['systemctl','start','reading-room'],check=True)
        raise
    print('Verified batch corrections:',len(installed),'backup:',backup)
if __name__=='__main__':install(json.loads(Path(sys.argv[1]).read_text()))
