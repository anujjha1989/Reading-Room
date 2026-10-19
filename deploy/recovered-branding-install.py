"""Install one complete branding candidate into the recovered service layout."""
import hashlib,json,pathlib,shutil,subprocess,sys,time,urllib.request
root=pathlib.Path.home()/'app-restore';old=root/'releases/home-books-v229';new=root/'releases/home-books-v230'
archive=root/'home-books-branding-v230.tar.gz'
drop=root.parent/'.config/systemd/user/home-books.service.d/release.conf'
backup=root/('branding-rollback-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir(mode=0o700)
if drop.exists():shutil.copy2(drop,backup/'release.conf')
if new.exists():raise RuntimeError('Candidate release already exists; refusing overwrite')
shutil.copytree(old,new)
subprocess.run(['tar','-xzf',str(archive),'-C',str(new/'site')],check=True)
manifest=json.loads((new/'site/branding-manifest.json').read_text())
for name,expected in manifest['files'].items():assert hashlib.sha256((new/'site'/name).read_bytes()).hexdigest()==expected,name
drop.write_text('[Service]\nWorkingDirectory='+str(new)+'\nExecStart=\nExecStart=/usr/local/bin/node '+str(new/'standalone-server.mjs')+'\nEnvironment=READING_ROOM_SITE='+str(new/'site')+'\n')
def restart():
 subprocess.run(['systemctl','--user','daemon-reload'],check=True);subprocess.run(['systemctl','--user','restart','home-books'],check=True)
try:
 restart()
 for attempt in range(30):
  try:
   with urllib.request.urlopen('http://127.0.0.1:4311/',timeout=3) as r:assert b'content="230"' in r.read()
   break
  except Exception:
   if attempt==29:raise
   time.sleep(.3)
 for name,expected in manifest['files'].items():
  if name=='branding-manifest.json':continue
  with urllib.request.urlopen('http://127.0.0.1:4311/'+name,timeout=10) as r:assert hashlib.sha256(r.read()).hexdigest()==expected,name
except Exception:
 if (backup/'release.conf').exists():shutil.copy2(backup/'release.conf',drop)
 else:drop.unlink(missing_ok=True)
 restart();raise
print(json.dumps(dict(version=230,backup=str(backup),filesVerified=len(manifest['files']),source=manifest['commit'])))
