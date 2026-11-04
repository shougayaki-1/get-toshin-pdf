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
