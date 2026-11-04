import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectOne, inferSubject, listQuestions, readState } from './daimon.js';
import { collectYear, listYears, openYearList, readYearState } from './year.js';
import { copySaved, dateFolderFile, datePrefix, listFolder, listSaved, renameSaved } from './rename-files.js';
import { openCategoryList, listCategories, enterCategory, returnToCategories } from './categories.js';
import { retryTransient } from './retry.js';

const staticDir = fileURLToPath(new URL('../gui/', import.meta.url));
const assets = {'/': ['index.html','text/html; charset=utf-8'], '/app.js':['app.js','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8']};
const response = (res, status, data) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store'}); res.end(JSON.stringify(data)); };
async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 100000) throw Error('request too large'); }
  return JSON.parse(body || '{}');
}
function getPosPage(context) {
  return context.pages().find(p => /\/SSO1\/SSOMenu\/(StudentMenu|PosApplication)\.aspx/i.test(p.url())) ||
    context.pages().find(p => p.url().startsWith('https://pos.toshin.com/'));
}
export async function createGuiServer({context, dir, request}) {
  const settingsDir=dir;
  let knownDirs=[await realpath(dir).catch(()=>path.resolve(dir))];
  try {const settings=JSON.parse(await readFile(path.join(settingsDir,'gui-settings.json'),'utf8'));if(Array.isArray(settings.knownDirs))knownDirs.push(...settings.knownDirs.filter(x=>typeof x==='string' && path.isAbsolute(x)));if(typeof settings.dataDir==='string' && (await stat(settings.dataDir)).isDirectory())dir=await realpath(settings.dataDir);} catch {}
  knownDirs=[...new Set([...knownDirs,path.resolve(dir)])];
  const token = randomBytes(32).toString('hex');
  const state = { mode:null, items:[], frame:null, page:null, subject:null, setId:null, category:null, busy:false,
    cancelRequested:false, revision:0, resumeIndices:[], status:'POSにログインしてから、年度別または大問別の候補を読み込んでください。', progress:[], counts:null };
  let savedFiles=[], filesRoot=null;
  async function readSelectedFiles() {
    const tracked=await listSaved(dir);
    if(!filesRoot)return tracked.map(f=>({...f,tracked:true}));
    const map=new Map();
    for(const root of knownDirs)for(const file of await listSaved(root)) {
      const key=path.resolve(root,file.path), owners=map.get(key)||[];owners.push({dir:root,path:file.path});map.set(key,owners);
    }
    return (await listFolder(filesRoot)).map(f=>({...f,owners:map.get(path.resolve(filesRoot,f.path))||[]}));
  }
  const sendStatus = () => ({ mode:state.mode, items:state.items.map((x,i)=>({index:i, title:state.mode==='year' ? `${x.round} / ${x.subject}` : state.mode==='categories' ? `${x.subject.name} / ${x.title}` : `${x.number} - ${x.title}`, subject:state.mode==='year' ? x.subject : state.mode==='categories' ? x.subject.name : state.subject})),
    subject:state.subject, category:state.category, revision:state.revision, resumeIndices:state.resumeIndices, busy:state.busy, status:state.status, progress:state.progress, counts:state.counts, dataDir:dir,outputDir:path.join(dir,'output') });
  const reset = () => { state.revision++;state.resumeIndices=[];state.items=[];state.mode=null;state.frame=null;state.page=null;state.subject=null;state.counts=null;state.progress=[]; };
  async function discover(mode, resume=false) {
    reset(); state.busy=true; state.status='候補を読み込んでいます…';
    try {
      const page = getPosPage(context); if (!page) throw Error('専用ブラウザでPOSにログインしてください。');
      state.page=page;
      if (mode==='year') {
        const frame=await openYearList(page); const items=await listYears(frame);
        if (!items.length) throw Error('年度別の候補が見つかりません。');
        state.mode=mode; state.frame=frame; state.items=items;
        if(resume) {
          let report;
          try {report=JSON.parse(await readFile(path.join(dir,'bulk-year-report.json'),'utf8'));}
          catch(e) {if(e.code==='ENOENT')throw Error('再開できる履歴がありません');throw e;}
          if(report.mode!=='year' || !Array.isArray(report.categories) || !report.categories.length)throw Error('再開できる履歴がありません');
          state.resumeIndices=report.categories.map(saved=>{
            const matches=items.flatMap((item,i)=>item.round===saved.round && item.subject===saved.subject ? [i] : []);
            if(matches.length!==1)throw Error('前回の年度・科目を確認できません');return matches[0];
          });
          if(new Set(state.resumeIndices).size!==state.resumeIndices.length)throw Error('前回の年度・科目を確認できません');
        }
      } else if(mode==='daimon') {
        const frame=page.frames().find(f=>{try {const u=new URL(f.url());return u.protocol==='https:' && u.hostname==='pos.toshin.com' && /\/EnshuKaishi\/?$/.test(u.pathname);} catch{return false;}});
        if (!frame) throw Error('POSで大問別の分野を開いてください。');
        const links=frame.locator('a[href*="DaimonBunyabetsuTop"]');
        if (!await links.count()) throw Error('大問別の分野を開いてください。');
        const back=await links.first().getAttribute('href');
        const setId=back && new URL(back,frame.url()).searchParams.get('enshuSetId');
        const category=(await frame.locator('h3').first().innerText()).replace(/^\s*[英国数理社情]\s*/, '').trim();
        const items=await listQuestions(frame);
        if (!setId || !items.length || items.some(x=>!x.id || !x.title || !/^\d+$/.test(x.number))) throw Error('問題一覧を確認できません。');
        state.mode=mode;state.frame=frame;state.setId=setId;state.category=category;state.subject=inferSubject(category);state.items=items.map(x=>({...x,category}));
      } else if(mode==='categories') {
        state.status='科目と分野を読み込んでいます…';
        const frame=await openCategoryList(page);const items=await listCategories(frame);
        state.mode=mode;state.frame=frame;state.items=items;
        if(resume) {
          let report;
          try {report=JSON.parse(await readFile(path.join(dir,'bulk-categories-report.json'),'utf8'));}
          catch(e) {if(e.code==='ENOENT')throw Error('再開できる履歴がありません');throw e;}
          if(report.mode!=='categories' || !Array.isArray(report.categories) || !report.categories.length)throw Error('再開できる履歴がありません');
          state.resumeIndices=report.categories.map(saved=>{
            const matches=items.flatMap((item,i)=>item.subject.name===saved.subject && item.title===saved.title ? [i] : []);
            if(matches.length!==1)throw Error('前回の分野を確認できません');return matches[0];
          });
          if(new Set(state.resumeIndices).size!==state.resumeIndices.length)throw Error('前回の分野を確認できません');
        }
      } else throw Error('取得方法が不正です。');
      state.status=resume ? `前回の${state.resumeIndices.length}${mode==='year'?'件':'分野'}を選択しました。保存済みはスキップします。` : state.subject===null && mode==='daimon' ? '科目を判別できません。科目名を入力してください。' : `${state.items.length}件の候補を読み込みました。`;
    } catch(e) { reset();state.status=e.message && /^(専用ブラウザ|POSで|大問別|問題一覧|年度別の候補|再開できる|前回の分野|前回の年度)/.test(e.message) ? e.message : '候補を読み込めません。ログイン状態と画面を確認してください。'; }
    finally {state.busy=false;}
  }
  async function saveBulkReport(mode, categories, completed) {
    const target=path.join(dir,`bulk-${mode}-report.json`), temp=target+'.tmp';
    await writeFile(temp,JSON.stringify({mode,categories,completed,counts:state.counts,progress:state.progress,updatedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
    await rename(temp,target);
  }
  function keepAwake() {
    if(process.platform!=='darwin')return null;
    const child=spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:'ignore'});
    child.on('error',()=>state.progress.push('Macのスリープ防止を開始できませんでした。'));
    return child;
  }
  async function withRetries(fn) {
    return retryTransient(fn,{
      cancelled:()=>state.cancelRequested,
      sleep:async ms=>{for(let left=ms;left>0&&!state.cancelRequested;left-=1000)await new Promise(resolve=>setTimeout(resolve,Math.min(left,1000)));},
      onRetry:(status,attempt,delay)=>{state.status=`HTTP ${status}: ${Math.ceil(delay/1000)}秒待って再試行します（${attempt}/2）。`;}
    });
  }
  async function processCategories(indices, awake) {
    const selected=indices.map(i=>state.items[i]); let completed=0;
    const history=await readState(dir);
    await saveBulkReport('categories',selected.map(x=>({subject:x.subject.name,title:x.title})),completed);
    for(const category of selected) {
      if(state.cancelRequested)break;
      state.status=`分野 ${completed+1}/${selected.length}: ${category.title}`;
      try {
        await enterCategory(state.frame,category);
        const subject=inferSubject(category.title) || category.subject.name;
        if(!subject)throw Error('科目を判別できません');
        const items=await listQuestions(state.frame);
        if(!items.length || items.some(x=>!x.id || !x.title || !/^\d+$/.test(x.number)))throw Error('問題一覧を確認できません');
        for(const item of items) {
          if(state.cancelRequested)break;
          const result=await withRetries(()=>collectOne({page:state.page,frame:state.frame,item:{...item,category:category.title},setId:category.setId,subject,dir,state:history,...(request ? {request} : {})}));
          state.counts[result]++;
          state.progress.push(`${result==='saved'?'保存':'スキップ'}: ${item.title}`);
          if(state.progress.length>200)state.progress.shift();
          await saveBulkReport('categories',selected.map(x=>({subject:x.subject.name,title:x.title})),completed);
          if(result==='saved')await new Promise(resolve=>setTimeout(resolve,2000));
        }
        await returnToCategories(state.frame);
        if(state.cancelRequested)break;
        completed++;state.counts.remaining--;
        await saveBulkReport('categories',selected.map(x=>({subject:x.subject.name,title:x.title})),completed);
        if(completed<selected.length)await new Promise(resolve=>setTimeout(resolve,1500));
      } catch(e) {
        if(state.cancelRequested)break;
        state.counts.failed++;
        const code=/^HTTP (\d{3})$/.exec(e.message)?.[1];
        state.progress.push(`失敗: ${category.title}${code ? ` (HTTP ${code})` : ''}。処理を中断しました。`);
        await saveBulkReport('categories',selected.map(x=>({subject:x.subject.name,title:x.title})),completed).catch(()=>{});
        break;
      }
    }
    await saveBulkReport('categories',selected.map(x=>({subject:x.subject.name,title:x.title})),completed).catch(()=>{});
  }
  async function processItems(indices, subject) {
    state.cancelRequested=false;state.busy=true;state.progress=[]; state.counts={saved:0,skipped:0,failed:0,remaining:indices.length};
    state.status='取得中です。POSの操作を終えるまでこの画面を開いたままにしてください。';
    let initial = []; const awake=keepAwake();
    try {
      if(state.mode==='categories') {await processCategories(indices,awake);return;}
      if(state.mode==='daimon') initial=await listQuestions(state.frame);
      const savedState=state.mode==='year' ? await readYearState(dir) : await readState(dir);
      const yearSelections=state.mode==='year' ? indices.map(i=>({round:state.items[i].round,subject:state.items[i].subject})) : null;
      if(yearSelections)await saveBulkReport('year',yearSelections,0);
      for(const index of indices) {
        if(state.cancelRequested)break;
        const item=state.items[index];
        try {
          const result=await withRetries(()=>state.mode==='year' ? collectYear({page:state.page,frame:state.frame,item,dir,state:savedState,...(request ? {request} : {})}) :
            collectOne({page:state.page,frame:state.frame,item,setId:state.setId,subject,dir,state:savedState,...(request ? {request} : {})}));
          state.counts[result]++; state.counts.remaining--;
          state.progress.push(`${result==='saved'?'保存':'スキップ'}: ${state.mode==='year'?`${item.round} / ${item.subject}`:item.title}`);
          if(yearSelections)await saveBulkReport('year',yearSelections,state.counts.saved+state.counts.skipped);
        } catch(e) {
          if(state.cancelRequested)break;
          state.counts.failed++;state.counts.remaining--;
          const code=/^HTTP (\d{3})$/.exec(e.message)?.[1];
          state.progress.push(`失敗: ${state.mode==='year'?`${item.round} / ${item.subject}`:item.title}${code ? ` (HTTP ${code})` : ''}`);
          if(yearSelections)await saveBulkReport('year',yearSelections,state.counts.saved+state.counts.skipped).catch(()=>{});
          break;
        }
        if(state.progress.at(-1)?.startsWith('保存:')) await new Promise(resolve=>setTimeout(resolve,2000));
      }
    } catch {state.counts.failed++;state.progress.push('処理を開始できません。画面と保存先を確認してください。');}
    finally {
      if(state.mode==='daimon' && initial.length) {
        try { for(let i=0;i<initial.length;i++) {const box=state.frame.locator('input.chkDaimon').nth(i); if(await box.isChecked()!==initial[i].checked) await state.frame.locator('li.questions-item').nth(i).locator('label.checkbox').click();} }
        catch {state.progress.push('POS画面の選択状態を復元できませんでした。');}
      }
      if(awake)awake.kill();
      state.busy=false;state.status=state.counts.failed ? '失敗したため停止しました。確認後、再度候補を読み込んでください。' : state.cancelRequested ? '停止しました。保存済みをスキップして再開できます。' : '取得が完了しました。';
    }
  }
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET' && assets[u.pathname]) {
      const [file,type]=assets[u.pathname];
      try { const body=await readFile(path.join(staticDir,file));res.writeHead(200,{'content-type':type,'cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'});res.end(body); } catch {res.writeHead(500);res.end();} return;
    }
    const supplied=req.headers['x-app-token'];
    if(typeof supplied!=='string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(token))) return response(res,403,{error:'アクセスできません'});
    if(req.method==='GET' && u.pathname==='/api/status') return response(res,200,sendStatus());
    if(req.method==='GET' && u.pathname==='/api/files') {
      if(state.busy) return response(res,409,{error:'処理中です'});
      try {filesRoot=null;savedFiles=await readSelectedFiles();return response(res,200,{files:savedFiles});}
      catch {return response(res,500,{error:'保存履歴を読み込めません'});}
    }
    if(req.method!=='POST' || req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return response(res,403,{error:'アクセスできません'});
    if(u.pathname==='/api/cancel' && state.busy) {state.cancelRequested=true;state.status='現在の処理が終わり次第停止します…';return response(res,202,{});}
    if(state.busy) return response(res,409,{error:'処理中です'});
    try {
      const body=await readJson(req);
      if(u.pathname==='/api/choose-folder') {
        if(process.platform!=='darwin')return response(res,400,{error:'フォルダのパスを入力してください'});
        try {const {stdout}=await promisify(execFile)('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "フォルダを選択してください")']);return response(res,200,{path:stdout.trim()});}
        catch {return response(res,400,{error:'フォルダ選択をキャンセルしました'});}
      }
      if(u.pathname==='/api/data-dir' || u.pathname==='/api/folder-files') {
        if(typeof body.path!=='string' || !path.isAbsolute(body.path))return response(res,400,{error:'フォルダの絶対パスを指定してください'});
        let selected;
        try {selected=await realpath(body.path);if(!(await stat(selected)).isDirectory())throw Error();}
        catch {return response(res,400,{error:'フォルダが見つかりません'});}
        if(u.pathname==='/api/data-dir') {
          const nextDirs=[...new Set([...knownDirs,selected])];
          try {await writeFile(path.join(settingsDir,'gui-settings.json'),JSON.stringify({dataDir:selected,knownDirs:nextDirs})+'\n',{mode:0o600});}
          catch {return response(res,500,{error:'保存先の設定を書き込めません'});}
          dir=selected;knownDirs=nextDirs;filesRoot=null;savedFiles=[];state.counts=null;
          state.status='保存先を変更しました。取得履歴は保存先ごとに管理されます。';
          return response(res,200,{dataDir:dir,outputDir:path.join(dir,'output')});
        }
        try {filesRoot=selected;savedFiles=await readSelectedFiles();return response(res,200,{files:savedFiles,root:filesRoot});}
        catch {filesRoot=null;return response(res,500,{error:'フォルダを読み込めません'});}
      }
      if(u.pathname==='/api/discover' && ['year','daimon','categories'].includes(body.mode)) {void discover(body.mode,body.resume===true && ['year','categories'].includes(body.mode));return response(res,202,{});}
      if(u.pathname==='/api/rename') {
        try {datePrefix(body.date);} catch {return response(res,400,{error:'有効な日付を選択してください'});}
        const mode=body.mode ?? 'rename';
        if(!['rename','copy'].includes(mode))return response(res,400,{error:'操作を選択してください'});
        if(!Array.isArray(body.indices) || !body.indices.length || body.indices.length>savedFiles.length ||
          body.indices.some(i=>!Number.isInteger(i)||i<0||i>=savedFiles.length) || new Set(body.indices).size!==body.indices.length) return response(res,400,{error:'ファイルを選択してください'});
        state.busy=true;const results=[];
        try {
          for(const i of body.indices) {
            const file=savedFiles[i];
            try {const owners=filesRoot?file.owners:[{dir,path:file.path}];
              if(owners.length>1)throw Error('複数の保存履歴が同じファイルを参照しています');
              const result=owners.length ? await (mode==='copy'?copySaved:renameSaved)(owners[0].dir,owners[0].path,body.date) : await dateFolderFile(filesRoot,file.path,body.date,mode);
              results.push({name:file.name,status:result.status,path:result.path});}
            catch(e) {results.push({name:file.name,status:'failed',error:/^(同名|対象ファイル|保存履歴|複数の保存履歴)/.test(e.message)?e.message:'変更できませんでした'});}
          }
          savedFiles=await readSelectedFiles();
          return response(res,200,{results,files:savedFiles});
        } finally {state.busy=false;}
      }
      if(u.pathname==='/api/start') {
        if(!state.mode || !Array.isArray(body.indices) || !body.indices.length || body.indices.length>state.items.length ||
          body.indices.some(i=>!Number.isInteger(i)||i<0||i>=state.items.length) || new Set(body.indices).size!==body.indices.length) return response(res,400,{error:'対象を選択してください'});
        const subject=state.subject || (typeof body.subject==='string' ? body.subject.trim().slice(0,80) : '');
        if(state.mode==='daimon' && !subject) return response(res,400,{error:'科目名を入力してください'});
        void processItems(body.indices,subject);return response(res,202,{});
      }
      return response(res,404,{error:'見つかりません'});
    } catch {return response(res,400,{error:'入力を確認してください'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server, url:`http://127.0.0.1:${server.address().port}/#${token}`, state};
}
