'use strict';
const token=location.hash.slice(1) || sessionStorage.getItem('gui-token') || ''; if(token) sessionStorage.setItem('gui-token',token); history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id);
let current=null, selection=new Set(), filter='';
async function api(path,body) {
  const result=await fetch(path,{method:body?'POST':'GET',headers:{'x-app-token':token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await result.json(); if(!result.ok)throw Error(data.error||'操作できません'); return data;
}
function render(s) {
  const changed=!current || current.mode!==s.mode || JSON.stringify(current.items)!==JSON.stringify(s.items);
  if(changed){selection.clear();filter='';$('filter').value='';}
  current=s;$('status').textContent=s.status;$('year').disabled=s.busy;$('daimon').disabled=s.busy;
  $('selection').hidden=!s.mode;$('results').hidden=!s.counts;
  $('category').textContent=s.mode==='daimon' ? `${s.category}（科目: ${s.subject||'要入力'}）` : '年度・科目を選択してください。';
  $('subject-row').hidden=s.mode!=='daimon'||!!s.subject;
  $('count').textContent=`${s.items.length}件`;$('path').textContent=s.dataDir;
  $('counts').textContent=s.counts ? `保存 ${s.counts.saved}件　スキップ ${s.counts.skipped}件　失敗 ${s.counts.failed}件　未処理 ${s.counts.remaining}件` : '';
  $('progress').replaceChildren(...s.progress.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  renderItems();
}
function renderItems(){
  if(!current)return;
  const visible=current.items.filter(x=>x.title.toLocaleLowerCase().includes(filter));
  $('items').replaceChildren(...visible.map(item=>{const label=document.createElement('label');label.className='item';const box=document.createElement('input');box.type='checkbox';box.checked=selection.has(item.index);box.disabled=current.busy;box.addEventListener('change',()=>{box.checked?selection.add(item.index):selection.delete(item.index);renderItems();});const title=document.createElement('span');title.textContent=item.title;label.append(box,title);return label;}));
  $('all').checked=visible.length>0&&visible.every(x=>selection.has(x.index));$('all').indeterminate=visible.some(x=>selection.has(x.index))&&!$('all').checked;
  $('all').disabled=current.busy||!visible.length;$('filter').disabled=current.busy;$('subject').disabled=current.busy;
  $('selected').textContent=`${selection.size}件を選択中`;$('start').disabled=current.busy||!selection.size;
}
$('filter').addEventListener('input',e=>{filter=e.target.value.trim().toLocaleLowerCase();renderItems();});
$('all').addEventListener('change',e=>{for(const x of current.items.filter(x=>x.title.toLocaleLowerCase().includes(filter)))e.target.checked?selection.add(x.index):selection.delete(x.index);renderItems();});
async function action(path,body){try{await api(path,body);await refresh();}catch(e){$('status').textContent=e.message;}}
$('year').addEventListener('click',()=>action('/api/discover',{mode:'year'}));
$('daimon').addEventListener('click',()=>action('/api/discover',{mode:'daimon'}));
$('start').addEventListener('click',()=>action('/api/start',{indices:[...selection].sort((a,b)=>a-b),subject:$('subject').value}));
async function refresh(){try{render(await api('/api/status'));}catch{$('status').textContent='GUIとの接続が切れました。ターミナルから再起動してください。';}}
void refresh();setInterval(refresh,1500);

let savedFiles=[], renamedSelection=new Set();
const localToday=new Date();
$('rename-date').value=[localToday.getFullYear(),String(localToday.getMonth()+1).padStart(2,'0'),String(localToday.getDate()).padStart(2,'0')].join('-');
function renderSaved(){
  const term=$('rename-filter').value.trim().toLocaleLowerCase();
  const visible=savedFiles.map((file,index)=>({...file,index})).filter(f=>`${f.name} ${f.folder}`.toLocaleLowerCase().includes(term));
  $('saved-files').replaceChildren(...visible.map(file=>{
    const label=document.createElement('label');label.className='item';
    const box=document.createElement('input');box.type='checkbox';box.checked=renamedSelection.has(file.index);
    box.addEventListener('change',()=>{box.checked?renamedSelection.add(file.index):renamedSelection.delete(file.index);renderSaved();});
    const text=document.createElement('span');text.className='item-text';const name=document.createElement('span');name.textContent=file.name;
    const folder=document.createElement('small');folder.textContent=file.folder;text.append(name,folder);label.append(box,text);return label;
  }));
  const all=$('rename-all');all.checked=visible.length>0&&visible.every(x=>renamedSelection.has(x.index));all.indeterminate=visible.some(x=>renamedSelection.has(x.index))&&!all.checked;all.disabled=!visible.length;
  $('rename-selected').textContent=`${renamedSelection.size}件を選択中`;
  $('rename-start').disabled=!renamedSelection.size||!$('rename-date').value;
  const first=savedFiles[[...renamedSelection][0]], date=$('rename-date').value;
  $('rename-preview').textContent=first&&date ? `変更例: ${date.replaceAll('-','')}-${first.name.replace(/^\d{8}-/,'')}` : '';
}
$('rename-filter').addEventListener('input',renderSaved);$('rename-date').addEventListener('input',renderSaved);
$('rename-all').addEventListener('change',e=>{const term=$('rename-filter').value.trim().toLocaleLowerCase();savedFiles.forEach((f,i)=>{if(`${f.name} ${f.folder}`.toLocaleLowerCase().includes(term))e.target.checked?renamedSelection.add(i):renamedSelection.delete(i);});renderSaved();});
$('load-files').addEventListener('click',async()=>{try{const data=await api('/api/files');savedFiles=data.files;renamedSelection.clear();$('rename-panel').hidden=false;$('rename-status').textContent=savedFiles.length?`${savedFiles.length}件のPDFがあります。`:'保存済みPDFがありません。';$('rename-results').replaceChildren();renderSaved();}catch(e){$('rename-status').textContent=e.message;}});
$('rename-start').addEventListener('click',async()=>{
  const button=$('rename-start');button.disabled=true;$('load-files').disabled=true;$('rename-status').textContent='ファイル名を変更しています…';
  try {const data=await api('/api/rename',{indices:[...renamedSelection].sort((a,b)=>a-b),date:$('rename-date').value});
    const labels={renamed:'変更',skipped:'変更不要',copied:'変更（元の名前も残っています）',failed:'失敗'};
    $('rename-results').replaceChildren(...data.results.map(r=>{const li=document.createElement('li');li.textContent=`${labels[r.status]}: ${r.name}${r.error?' — '+r.error:''}`;return li;}));
    const failures=data.results.filter(x=>x.status==='failed').length;$('rename-status').textContent=`${data.results.length}件を処理しました。失敗 ${failures}件。`;
    savedFiles=data.files;renamedSelection.clear();renderSaved();
  } catch(e){$('rename-status').textContent=e.message;renderSaved();} finally {$('load-files').disabled=false;}
});
