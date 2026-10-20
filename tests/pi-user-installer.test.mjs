import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('restored installer reads the version inside quoted HTML metadata',async()=>{
 const source=await readFile(new URL('../deploy/pi-user-install.sh',import.meta.url),'utf8');
 const definition=source.match(/^version_of\(\) \{.*\}$/m)?.[0];assert.ok(definition);
 const root=await mkdtemp(join(tmpdir(),'home-books-install-version-'));
 try{await mkdir(join(root,'site'));for(const version of ['229','230','231']){
  await writeFile(join(root,'site/index.html'),`<!doctype html><html><head><meta name="rr-app-version" content="${version}"/></head></html>`);
  const actual=execFileSync('/bin/bash',['-c',`${definition}\nversion_of "$1"`,'test',root],{encoding:'utf8'}).trim();assert.equal(actual,version);
 }}finally{await rm(root,{recursive:true,force:true});}
});
