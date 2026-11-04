import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {copySaved,datePrefix,datedName,listSaved,renameSaved} from '../src/rename-files.js';

test('checks calendar dates and replaces an existing date prefix',()=>{
  assert.equal(datedName('01-問題.pdf','2026-11-05'),'20261105-01-問題.pdf');
  assert.equal(datedName('20261105-01-問題.pdf','2026-11-06'),'20261106-01-問題.pdf');
  assert.throws(()=>datePrefix('2026-02-30'));assert.throws(()=>datePrefix('20261105'));
});
test('renames tracked output and updates the manifest without overwriting',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rename-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'output','国語'),{recursive:true});
  const original='output/国語/01-問題.pdf'; await writeFile(path.join(dir,original),'example');
  await writeFile(path.join(dir,'daimon-manifest.json'),JSON.stringify({version:1,items:[{key:'x',path:original}]}));
  assert.equal((await listSaved(dir)).length,1);
  const result=await renameSaved(dir,original,'2026-11-05');assert.equal(result.status,'renamed');
  assert.equal(await readFile(path.join(dir,result.path),'utf8'),'example');
  await assert.rejects(readFile(path.join(dir,original)),{code:'ENOENT'});
  const manifest=JSON.parse(await readFile(path.join(dir,'daimon-manifest.json'),'utf8'));assert.equal(manifest.items[0].path,result.path);
  assert.equal((await renameSaved(dir,result.path,'2026-11-05')).status,'skipped');
  const collision=path.join(dir,'output','国語','20261106-01-問題.pdf');await writeFile(collision,'do not overwrite');
  await assert.rejects(renameSaved(dir,result.path,'2026-11-06'),/同名/);
  assert.equal(await readFile(collision,'utf8'),'do not overwrite');assert.equal((await listSaved(dir))[0].path,result.path);
});

test('only exposes existing PDFs inside output',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'rename-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'output'),{recursive:true});await writeFile(path.join(dir,'secret.pdf'),'private');
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify({version:1,documents:[{processedPath:'../secret.pdf'},{processedPath:'secret.pdf'},{processedPath:'output/missing.pdf'}]}));
  assert.deepEqual(await listSaved(dir),[]);await assert.rejects(renameSaved(dir,'secret.pdf','2026-11-05'));
});

test('renamed year PDF remains recognized as downloaded',async t=>{
  const {collectYear,readYearState,yearKey}=await import('../src/year.js');
  const dir=await mkdtemp(path.join(tmpdir(),'rename-resume-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'output'),{recursive:true});await writeFile(path.join(dir,'output','問題.pdf'),'example');
  const item={setId:'already-downloaded'};
  await writeFile(path.join(dir,'year-manifest.json'),JSON.stringify({version:1,items:[{key:yearKey(item),path:'output/問題.pdf'}]}));
  await renameSaved(dir,'output/問題.pdf','2026-11-05');
  const state=await readYearState(dir);
  assert.equal(await collectYear({page:null,frame:null,item,dir,state,request:{}}),'skipped');
});

test('dated copies preserve the original and history, avoid collisions, and remain manageable',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'date-copy-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'output'),{recursive:true});const original='output/問題.pdf';
  await writeFile(path.join(dir,original),'example');
  const history=JSON.stringify({version:1,items:[{key:'x',path:original}]});
  await writeFile(path.join(dir,'year-manifest.json'),history);
  const copy=await copySaved(dir,original,'2026-11-05');
  assert.equal(copy.status,'created');assert.equal(await readFile(path.join(dir,copy.path),'utf8'),'example');
  assert.notEqual((await stat(path.join(dir,original))).ino,(await stat(path.join(dir,copy.path))).ino);
  assert.equal(await readFile(path.join(dir,'year-manifest.json'),'utf8'),history);
  assert.equal((await listSaved(dir)).length,2);
  await assert.rejects(copySaved(dir,original,'2026-11-05'),/同名/);
  const renamed=await renameSaved(dir,copy.path,'2026-11-06');
  assert.equal(renamed.status,'renamed');assert.equal((await listSaved(dir)).length,2);
  assert.equal(await readFile(path.join(dir,original),'utf8'),'example');
});
