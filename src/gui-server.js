import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectOne, inferSubject, listQuestions, readState } from './daimon.js';
import { collectYear, listYears, openYearList, readYearState } from './year.js';
import { datePrefix, listSaved, renameSaved } from './rename-files.js';

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
  const token = randomBytes(32).toString('hex');
  const state = { mode:null, items:[], frame:null, page:null, subject:null, setId:null, category:null, busy:false,
    status:'POSにログインしてから、年度別または大問別の候補を読み込んでください。', progress:[], counts:null };
  let savedFiles=[];
  const sendStatus = () => ({ mode:state.mode, items:state.items.map((x,i)=>({index:i, title:state.mode==='year' ? `${x.round} / ${x.subject}` : `${x.number} - ${x.title}`})),
    subject:state.subject, category:state.category, busy:state.busy, status:state.status, progress:state.progress, counts:state.counts, dataDir:dir });
  const reset = () => { state.items=[];state.mode=null;state.frame=null;state.page=null;state.subject=null;state.counts=null;state.progress=[]; };
  async function discover(mode) {
    reset(); state.busy=true; state.status='候補を読み込んでいます…';
    try {
      const page = getPosPage(context); if (!page) throw Error('専用ブラウザでPOSにログインしてください。');
      state.page=page;
      if (mode==='year') {
        const frame=await openYearList(page); const items=await listYears(frame);
        if (!items.length) throw Error('年度別の候補が見つかりません。');
        state.mode=mode; state.frame=frame; state.items=items;
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
      } else throw Error('取得方法が不正です。');
      state.status=state.subject===null && mode==='daimon' ? '科目を判別できません。科目名を入力してください。' : `${state.items.length}件の候補を読み込みました。`;
    } catch(e) { reset();state.status=e.message && /^(専用ブラウザ|POSで|大問別|問題一覧|年度別の候補)/.test(e.message) ? e.message : '候補を読み込めません。ログイン状態と画面を確認してください。'; }
    finally {state.busy=false;}
  }
  async function processItems(indices, subject) {
    state.busy=true;state.progress=[]; state.counts={saved:0,skipped:0,failed:0,remaining:indices.length};
    state.status='取得中です。POSの操作を終えるまでこの画面を開いたままにしてください。';
    let initial = [];
    try {
      if(state.mode==='daimon') initial=await listQuestions(state.frame);
      const savedState=state.mode==='year' ? await readYearState(dir) : await readState(dir);
      for(const index of indices) {
        const item=state.items[index];
        try {
          const result=state.mode==='year' ? await collectYear({page:state.page,frame:state.frame,item,dir,state:savedState,...(request ? {request} : {})}) :
            await collectOne({page:state.page,frame:state.frame,item,setId:state.setId,subject,dir,state:savedState,...(request ? {request} : {})});
          state.counts[result]++; state.counts.remaining--;
          state.progress.push(`${result==='saved'?'保存':'スキップ'}: ${state.mode==='year'?`${item.round} / ${item.subject}`:item.title}`);
        } catch(e) {
          state.counts.failed++;state.counts.remaining--;
          const code=/^HTTP (\d{3})$/.exec(e.message)?.[1];
          state.progress.push(`失敗: ${state.mode==='year'?`${item.round} / ${item.subject}`:item.title}${code ? ` (HTTP ${code})` : ''}`);
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
    } catch {state.counts.failed++;state.progress.push('処理を開始できません。画面と保存先を確認してください。');}
    finally {
      if(state.mode==='daimon' && initial.length) {
        try { for(let i=0;i<initial.length;i++) {const box=state.frame.locator('input.chkDaimon').nth(i); if(await box.isChecked()!==initial[i].checked) await state.frame.locator('li.questions-item').nth(i).locator('label.checkbox').click();} }
        catch {state.progress.push('POS画面の選択状態を復元できませんでした。');}
      }
      state.busy=false;state.status=state.counts.failed ? '失敗したため停止しました。確認後、再度候補を読み込んでください。' : '取得が完了しました。';
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
      try {savedFiles=await listSaved(dir);return response(res,200,{files:savedFiles});}
      catch {return response(res,500,{error:'保存履歴を読み込めません'});}
    }
    if(req.method!=='POST' || req.headers.origin !== `http://127.0.0.1:${server.address().port}`) return response(res,403,{error:'アクセスできません'});
    if(state.busy) return response(res,409,{error:'処理中です'});
    try {
      const body=await readJson(req);
      if(u.pathname==='/api/discover' && ['year','daimon'].includes(body.mode)) {void discover(body.mode);return response(res,202,{});}
      if(u.pathname==='/api/rename') {
        try {datePrefix(body.date);} catch {return response(res,400,{error:'有効な日付を選択してください'});}
        if(!Array.isArray(body.indices) || !body.indices.length || body.indices.length>savedFiles.length ||
          body.indices.some(i=>!Number.isInteger(i)||i<0||i>=savedFiles.length) || new Set(body.indices).size!==body.indices.length) return response(res,400,{error:'ファイルを選択してください'});
        state.busy=true;const results=[];
        try {
          for(const i of body.indices) {
            const file=savedFiles[i];
            try {const result=await renameSaved(dir,file.path,body.date);results.push({name:file.name,status:result.status,path:result.path});}
            catch(e) {results.push({name:file.name,status:'failed',error:/^(同名|対象ファイル|保存履歴|複数の保存履歴)/.test(e.message)?e.message:'変更できませんでした'});}
          }
          savedFiles=await listSaved(dir);
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
