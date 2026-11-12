import { openYearList } from './year.js';

const top = /\/CorrectAnswerRequiredFukushuTop(?:[/?]|$)/;
const exercise = /\/EnshuKaishi(?:[/?]|$)/;
const trusted = f => { try { const u=new URL(f.url()); return u.protocol==='https:' && u.hostname==='pos.toshin.com'; } catch { return false; } };

export async function openRequiredList(page) {
  let frame=page.frames().find(f=>trusted(f) && top.test(f.url()));
  if(frame) return frame;
  const current=page.frames().find(f=>trusted(f) && exercise.test(f.url()));
  if(current) {
    const back=current.getByRole('link',{name:'戻る',exact:true}).first();
    const href=await back.getAttribute('href');
    const target=href && new URL(href,current.url());
    if(target && target.protocol==='https:' && target.hostname==='pos.toshin.com' && top.test(target.pathname)) {
      await Promise.all([current.waitForURL(top,{timeout:20000}),back.click()]); return current;
    }
  }
  const year=await openYearList(page);
  const link=year.getByRole('link',{name:'正解必須問題 復習演習'});
  await Promise.all([year.waitForURL(top,{timeout:20000}),link.click()]);
  frame=page.frames().find(f=>trusted(f) && top.test(f.url()));
  if(!frame)throw Error('正解必須問題の一覧を開けません');
  return frame;
}
export async function chooseRequiredType(frame,type) {
  const label=frame.locator('label.criteria-label').filter({has:frame.locator(`input[name="mondaiType"][value="${type}"]`)});
  if(await label.count()!==1)throw Error('問題種別を確認できません');
  const input=label.locator('input');
  if(!await input.isChecked())await label.click();
  if(!await input.isChecked())throw Error('問題種別を選択できません');
  await frame.page().waitForTimeout(350);
}
export async function listRequiredCategories(frame) {
  const types=await frame.locator('input[name="mondaiType"]').evaluateAll(inputs=>inputs.map(i=>({value:i.value,name:i.parentElement.textContent.trim(),checked:i.checked})));
  if(types.length!==2 || !types.some(x=>x.value==='7') || !types.some(x=>x.value==='6'))throw Error('問題種別を確認できません');
  const original=types.find(x=>x.checked); const result=[];
  try {
    for(const type of types) {
      await chooseRequiredType(frame,type.value);
      const cards=await frame.locator('.card-front').evaluateAll((elements,type)=>elements.flatMap(card=>{
        if(!card.getClientRects().length)return [];
        const title=card.querySelector('.card-title-module2')?.textContent.trim();
        const form=card.querySelector('form[action$="/EnshuKaishi"]');
        const setId=form?.querySelector('input[name="enshuSetId"]')?.value;
        const button=form?.querySelector('button[type=submit]');
        if(!title || !setId || !button || button.disabled)return [];
        const subject=title.split(/[\s　]+/)[0];
        return [{title,setId,subject:{name:subject},type:type.value,typeName:type.name}];
      }),type);
      result.push(...cards);
    }
  } finally { if(original)await chooseRequiredType(frame,original.value); }
  const keys=result.map(x=>`${x.type}:${x.setId}`);
  if(new Set(keys).size!==keys.length)throw Error('分野を一意に特定できません');
  return result;
}
export async function enterRequiredCategory(frame,category) {
  await chooseRequiredType(frame,category.type);
  const cards=frame.locator('.card-front');
  const index=await cards.evaluateAll((els,id)=>els.findIndex(card=>card.getClientRects().length && card.querySelector('form[action$="/EnshuKaishi"] input[name="enshuSetId"]')?.value===id),category.setId);
  if(index<0)throw Error('選択した分野が見つかりません');
  const card=cards.nth(index);
  if((await card.locator('.card-title-module2').innerText()).trim()!==category.title)throw Error('選択した分野が変わりました');
  await Promise.all([frame.waitForURL(exercise,{timeout:20000}),card.locator('form[action$="/EnshuKaishi"] button[type=submit]').click()]);
  const href=await frame.locator('a[href*="CorrectAnswerRequiredFukushuTop"]').first().getAttribute('href');
  if(!href || new URL(href,frame.url()).searchParams.get('enshuSetId')!==category.setId)throw Error('演習画面が一致しません');
}
export async function returnToRequired(frame) {
  const back=frame.getByRole('link',{name:'戻る',exact:true}).first();
  const href=await back.getAttribute('href'); const target=href && new URL(href,frame.url());
  if(!target || target.protocol!=='https:' || target.hostname!=='pos.toshin.com' || !top.test(target.pathname))throw Error('正解必須問題の一覧に戻れません');
  await Promise.all([frame.waitForURL(top,{timeout:20000}),back.click()]);
}
