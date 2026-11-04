'use strict';
const token=location.hash.slice(1) || sessionStorage.getItem('gui-token') || ''; if(token) sessionStorage.setItem('gui-token',token); history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id);
let current=null, selection=new Set(), filter='', itemAnchor=null, savedAnchor=null;
function selectRange(visible,selected,start,end,checked=true){
  const a=visible.findIndex(x=>x.index===start),b=visible.findIndex(x=>x.index===end);
  if(a<0||b<0)return false;
  for(const item of visible.slice(Math.min(a,b),Math.max(a,b)+1))checked?selected.add(item.index):selected.delete(item.index);
  return true;
}
function setupRange(prefix,visible,selected,render){
  $(prefix+'-select').addEventListener('click',()=>{
    const list=visible(),a=Number($(prefix+'-start').value),b=Number($(prefix+'-end').value);
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<1||a>list.length||b>list.length){$(prefix+'-error').textContent='表示中の番号を入力してください';return;}
    $(prefix+'-error').textContent='';selectRange(list,selected(),list[a-1].index,list[b-1].index);render();
  });
}
function visibleItems(){return current ? current.items.filter(x=>x.title.toLocaleLowerCase().includes(filter) && (!$('subject-filter').value || x.subject===$('subject-filter').value)) : [];}
async function api(path,body) {
  const result=await fetch(path,{method:body?'POST':'GET',headers:{'x-app-token':token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await result.json(); if(!result.ok)throw Error(data.error||'操作できません'); return data;
}
function render(s) {
  if(!current || current.dataDir!==s.dataDir) $('data-dir').value=s.dataDir;
  const changed=!current || current.revision!==s.revision || current.mode!==s.mode || JSON.stringify(current.items)!==JSON.stringify(s.items);
  if(changed){selection=new Set(s.resumeIndices || []);itemAnchor=null;filter='';$('filter').value='';
    const subjects=[...new Set(s.items.map(x=>x.subject).filter(Boolean))];
    $('subject-filter').replaceChildren(new Option('すべての科目',''),...subjects.map(x=>new Option(x,x)));
  }
  current=s;$('status').textContent=s.status;$('year').disabled=s.busy;$('resume-year').disabled=s.busy;$('daimon').disabled=s.busy;$('categories').disabled=s.busy;$('resume-bulk').disabled=s.busy;$('cancel').hidden=!s.busy||!s.counts;
  $('set-data-dir').disabled=s.busy;$('choose-data-dir').disabled=s.busy;$('load-folder').disabled=s.busy;$('choose-files-dir').disabled=s.busy;$('load-files').disabled=s.busy;
  $('data-dir-status').textContent=`PDFの保存先: ${s.outputDir}`;
  $('selection').hidden=!s.mode;$('results').hidden=!s.counts;
  $('category').textContent=s.mode==='daimon' ? `${s.category}（科目: ${s.subject||'要入力'}）` : s.mode==='categories' ? '科目や分野を選ぶと、含まれる全問題を1問ずつ取得します。' : '年度・科目を選択してください。';
  $('subject-filter-row').hidden=!['year','categories'].includes(s.mode);
  $('subject-row').hidden=s.mode!=='daimon'||!!s.subject;
  $('count').textContent=`${s.items.length}件`;$('path').textContent=s.outputDir;
  $('counts').textContent=s.counts ? `保存 ${s.counts.saved}件　スキップ ${s.counts.skipped}件　失敗 ${s.counts.failed}件　未処理 ${s.counts.remaining}${s.mode==='categories'?'分野':'件'}` : '';
  $('progress').replaceChildren(...s.progress.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  renderItems();
}
function renderItems(){
  if(!current)return;
  const visible=visibleItems();
  $('items').replaceChildren(...visible.map((item,position)=>{const label=document.createElement('label');label.className='item';const box=document.createElement('input');box.type='checkbox';box.checked=selection.has(item.index);box.disabled=current.busy;box.addEventListener('click',e=>{if(!(e.shiftKey && itemAnchor!==null && selectRange(visible,selection,itemAnchor,item.index,box.checked)))box.checked?selection.add(item.index):selection.delete(item.index);itemAnchor=item.index;renderItems();});const title=document.createElement('span');title.textContent=`${position+1}. ${item.title}`;label.append(box,title);return label;}));
  $('all').checked=visible.length>0&&visible.every(x=>selection.has(x.index));$('all').indeterminate=visible.some(x=>selection.has(x.index))&&!$('all').checked;
  $('all').disabled=current.busy||!visible.length;$('filter').disabled=current.busy;$('subject-filter').disabled=current.busy;$('subject').disabled=current.busy;
  $('range-select').disabled=current.busy||!visible.length;
  $('selected').textContent=`${selection.size}件を選択中`;$('start').disabled=current.busy||!selection.size;
}
setupRange('range',visibleItems,()=>selection,renderItems);
$('filter').addEventListener('input',e=>{filter=e.target.value.trim().toLocaleLowerCase();itemAnchor=null;renderItems();});
$('subject-filter').addEventListener('change',()=>{itemAnchor=null;renderItems();});
$('all').addEventListener('change',e=>{for(const x of current.items.filter(x=>x.title.toLocaleLowerCase().includes(filter) && (!$('subject-filter').value || x.subject===$('subject-filter').value)))e.target.checked?selection.add(x.index):selection.delete(x.index);renderItems();});
async function action(path,body){try{await api(path,body);await refresh();}catch(e){$('status').textContent=e.message;}}
async function chooseFolder(input,status){try{const data=await api('/api/choose-folder',{});$(input).value=data.path;}catch(e){$(status).textContent=e.message;}}
$('choose-data-dir').addEventListener('click',()=>chooseFolder('data-dir','data-dir-status'));
$('choose-files-dir').addEventListener('click',()=>chooseFolder('files-dir','rename-status'));
$('set-data-dir').addEventListener('click',async()=>{try{const data=await api('/api/data-dir',{path:$('data-dir').value.trim()});$('data-dir').value=data.dataDir;$('rename-panel').hidden=true;await refresh();}catch(e){$('data-dir-status').textContent=e.message;}});
$('year').addEventListener('click',()=>action('/api/discover',{mode:'year'}));
$('resume-year').addEventListener('click',()=>action('/api/discover',{mode:'year',resume:true}));
$('daimon').addEventListener('click',()=>action('/api/discover',{mode:'daimon'}));
$('categories').addEventListener('click',()=>action('/api/discover',{mode:'categories'}));
$('resume-bulk').addEventListener('click',()=>action('/api/discover',{mode:'categories',resume:true}));
$('cancel').addEventListener('click',()=>action('/api/cancel',{}));
$('start').addEventListener('click',()=>action('/api/start',{indices:[...selection].sort((a,b)=>a-b),subject:$('subject').value}));
async function refresh(){try{render(await api('/api/status'));}catch{$('status').textContent='GUIとの接続が切れました。ターミナルから再起動してください。';}}
void refresh();setInterval(refresh,1500);

let savedFiles=[], renamedSelection=new Set();
const localToday=new Date();
$('rename-date').value=[localToday.getFullYear(),String(localToday.getMonth()+1).padStart(2,'0'),String(localToday.getDate()).padStart(2,'0')].join('-');
function visibleSaved(){const term=$('rename-filter').value.trim().toLocaleLowerCase();return savedFiles.map((file,index)=>({...file,index})).filter(f=>`${f.name} ${f.folder}`.toLocaleLowerCase().includes(term));}
function renderSaved(){
  const visible=visibleSaved();
  $('saved-files').replaceChildren(...visible.map((file,position)=>{
    const label=document.createElement('label');label.className='item';
    const box=document.createElement('input');box.type='checkbox';box.checked=renamedSelection.has(file.index);
    box.addEventListener('click',e=>{if(!(e.shiftKey && savedAnchor!==null && selectRange(visible,renamedSelection,savedAnchor,file.index,box.checked)))box.checked?renamedSelection.add(file.index):renamedSelection.delete(file.index);savedAnchor=file.index;renderSaved();});
    const text=document.createElement('span');text.className='item-text';const name=document.createElement('span');name.textContent=`${position+1}. ${file.name}`;
    const folder=document.createElement('small');folder.textContent=file.folder;text.append(name,folder);label.append(box,text);return label;
  }));
  const all=$('rename-all');all.checked=visible.length>0&&visible.every(x=>renamedSelection.has(x.index));all.indeterminate=visible.some(x=>renamedSelection.has(x.index))&&!all.checked;all.disabled=!visible.length;
  $('rename-selected').textContent=`${renamedSelection.size}件を選択中`;
  $('rename-start').disabled=!renamedSelection.size||!$('rename-date').value;
  const first=savedFiles[[...renamedSelection][0]], date=$('rename-date').value;
  const copying=document.querySelector('input[name=date-action]:checked').value==='copy';
  $('rename-start').textContent=copying?'日付付きコピーを作成':'日付を付ける';
  $('rename-preview').textContent=first&&date ? `${copying?'コピー':'変更'}例: ${date.replaceAll('-','')}-${first.name.replace(/^\d{8}-/,'')}` : '';
}
setupRange('saved-range',visibleSaved,()=>renamedSelection,renderSaved);
document.querySelectorAll('input[name=date-action]').forEach(r=>r.addEventListener('change',renderSaved));
$('rename-filter').addEventListener('input',()=>{savedAnchor=null;renderSaved();});$('rename-date').addEventListener('input',renderSaved);
$('rename-all').addEventListener('change',e=>{const term=$('rename-filter').value.trim().toLocaleLowerCase();savedFiles.forEach((f,i)=>{if(`${f.name} ${f.folder}`.toLocaleLowerCase().includes(term))e.target.checked?renamedSelection.add(i):renamedSelection.delete(i);});renderSaved();});
$('load-files').addEventListener('click',async()=>{try{const data=await api('/api/files');savedFiles=data.files;renamedSelection.clear();savedAnchor=null;$('rename-panel').hidden=false;$('rename-status').textContent=savedFiles.length?`${savedFiles.length}件のPDFがあります。`:'保存済みPDFがありません。';$('rename-results').replaceChildren();renderSaved();}catch(e){$('rename-status').textContent=e.message;}});
$('load-folder').addEventListener('click',async()=>{try{const data=await api('/api/folder-files',{path:$('files-dir').value.trim()});savedFiles=data.files;renamedSelection.clear();savedAnchor=null;$('rename-panel').hidden=false;$('rename-status').textContent=`${data.root}：${savedFiles.length}件のPDFがあります。`;$('rename-results').replaceChildren();renderSaved();}catch(e){$('rename-status').textContent=e.message;}});
$('rename-start').addEventListener('click',async()=>{
  const button=$('rename-start'),mode=document.querySelector('input[name=date-action]:checked').value;button.disabled=true;$('load-files').disabled=true;$('rename-status').textContent=mode==='copy'?'コピーを作成しています…':'ファイル名を変更しています…';
  try {const data=await api('/api/rename',{indices:[...renamedSelection].sort((a,b)=>a-b),date:$('rename-date').value,mode});
    const labels={created:'コピーを作成',renamed:'変更',skipped:'変更不要',copied:'変更（元の名前も残っています）',failed:'失敗'};
    $('rename-results').replaceChildren(...data.results.map(r=>{const li=document.createElement('li');li.textContent=`${labels[r.status]}: ${r.name}${r.error?' — '+r.error:''}`;return li;}));
    const failures=data.results.filter(x=>x.status==='failed').length;$('rename-status').textContent=`${data.results.length}件を処理しました。失敗 ${failures}件。`;
    savedFiles=data.files;renamedSelection.clear();savedAnchor=null;renderSaved();
  } catch(e){$('rename-status').textContent=e.message;renderSaved();} finally {$('load-files').disabled=false;}
});
