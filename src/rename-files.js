import { copyFile, link, lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const sources = [
  {name:'daimon-manifest.json', array:'items', field:'path'},
  {name:'year-manifest.json', array:'items', field:'path'},
  {name:'manifest.json', array:'documents', field:'processedPath'},
  {name:'date-copies.json', array:'items', field:'path'}
];
export function datePrefix(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('日付を選択してください');
  const [year,month,day]=date.split('-').map(Number);
  const d=new Date(Date.UTC(year,month-1,day));
  if(year<1000 || d.getUTCFullYear()!==year || d.getUTCMonth()!==month-1 || d.getUTCDate()!==day) throw Error('有効な日付を選択してください');
  return date.replaceAll('-','');
}
export function datedName(name,date) {
  return `${datePrefix(date)}-${name.replace(/^\d{8}-/, '')}`;
}
async function manifests(dir) {
  const out=[];
  for (const source of sources) {
    try {
      const data=JSON.parse(await readFile(path.join(dir,source.name),'utf8'));
      if(!Array.isArray(data[source.array])) throw Error('保存履歴を読み取れません');
      out.push({...source,data});
    } catch(e) {if(e.code!=='ENOENT') throw e;}
  }
  return out;
}
async function safeFile(dir, relative) {
  if(typeof relative!=='string' || !relative || path.isAbsolute(relative)) return null;
  const output=path.resolve(dir,'output'), file=path.resolve(dir,relative), rel=path.relative(output,file);
  if(!rel || rel.startsWith('..'+path.sep) || rel==='..' || path.isAbsolute(rel) || !/\.pdf$/i.test(file)) return null;
  try {
    if(!(await lstat(file)).isFile()) return null;
    const realOutput=await realpath(output), realFile=await realpath(file), actual=path.relative(realOutput,realFile);
    if(!actual || actual==='..' || actual.startsWith('..'+path.sep) || path.isAbsolute(actual)) return null;
    return file;
  } catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function listSaved(dir) {
  const list=[]; const seen=new Set();
  for(const source of await manifests(dir)) for(const record of source.data[source.array]) {
    const rel=record[source.field]; if(seen.has(rel) || !(await safeFile(dir,rel)))continue;
    seen.add(rel); list.push({path:rel,name:path.basename(rel),folder:path.dirname(rel)});
  }
  return list.sort((a,b)=>a.path.localeCompare(b.path,'ja'));
}
async function saveManifest(dir,source) {
  const tmp=path.join(dir,`.rename-manifest-${randomBytes(8).toString('hex')}.tmp`);
  try {await writeFile(tmp,JSON.stringify(source.data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,path.join(dir,source.name));}
  catch(e){await unlink(tmp).catch(()=>{});throw e;}
}
export async function renameSaved(dir,relative,date) {
  const filename=datedName(path.basename(relative),date);
  const groups=await manifests(dir);
  const owners=groups.filter(g=>g.data[g.array].some(record=>record[g.field]===relative));
  if(!owners.length)throw Error('保存履歴に対象がありません');
  // Updating multiple separate manifests cannot be atomic. Avoid losing tracking.
  if(owners.length!==1)throw Error('複数の保存履歴が同じファイルを参照しています');
  const oldFile=await safeFile(dir,relative);
  if(!oldFile)throw Error('対象ファイルが見つかりません');
  const newFile=path.join(path.dirname(oldFile),filename);
  if(oldFile===newFile)return {status:'skipped',path:relative};
  try {await link(oldFile,newFile);} catch(e){if(e.code==='EEXIST')throw Error('同名のファイルが既にあります');throw e;}
  const owner=owners[0], newRel=path.relative(dir,newFile);
  const records=owner.data[owner.array].filter(x=>x[owner.field]===relative);
  for(const record of records)record[owner.field]=newRel;
  try {await saveManifest(dir,owner);} catch(e) {await unlink(newFile).catch(()=>{});throw e;}
  // If deletion fails, retain the extra link rather than risking data loss.
  try {await unlink(oldFile);} catch {return {status:'copied',path:newRel};}
  return {status:'renamed',path:newRel};
}
export async function copySaved(dir,relative,date) {
  const filename=datedName(path.basename(relative),date);
  const groups=await manifests(dir);
  if(!groups.some(g=>g.data[g.array].some(record=>record[g.field]===relative)))throw Error('保存履歴に対象がありません');
  const oldFile=await safeFile(dir,relative);
  if(!oldFile)throw Error('対象ファイルが見つかりません');
  const newFile=path.join(path.dirname(oldFile),filename);
  const temp=path.join(path.dirname(oldFile),`.date-copy-${randomBytes(12).toString('hex')}.tmp`);
  let published=false;
  try {
    await copyFile(oldFile,temp,constants.COPYFILE_EXCL);
    await link(temp,newFile);published=true;
    const owner=groups.find(g=>g.name==='date-copies.json') || {...sources.at(-1),data:{version:1,items:[]}};
    const newRel=path.relative(dir,newFile);
    owner.data.items.push({path:newRel});
    await saveManifest(dir,owner);
    return {status:'created',path:newRel};
  } catch(e) {
    if(published)await unlink(newFile).catch(()=>{});
    if(e.code==='EEXIST')throw Error('同名のファイルが既にあります');
    throw e;
  } finally {await unlink(temp).catch(()=>{});}
}
