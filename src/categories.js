import { openYearList } from './year.js';

const rootPattern=/^https:\/\/pos\.toshin\.com\/TGT\/OPCTTS\/OPCTTS_Student\/DaimonBunyabetsuTop(?:[/?]|$)/;
const exercisePattern=/^https:\/\/pos\.toshin\.com\/TGT\/OPCTTS\/OPCTTS_Student\/EnshuKaishi(?:[/?]|$)/;
export async function openCategoryList(page) {
  let frame=page.frames().find(f=>rootPattern.test(f.url()));
  if(frame) {await frame.locator('input[type=radio][name="科目"]').first().waitFor({state:'attached',timeout:20000});return frame;}
  // Exercise pages link back to their real parent, then the site's navigation is used.
  const exercise=page.frames().find(f=>exercisePattern.test(f.url()));
  if(exercise){
    const back=exercise.getByRole('link',{name:'戻る',exact:true}).first();
    const href=await back.getAttribute('href'); const target=href && new URL(href,exercise.url());
    if(!target || target.protocol!=='https:' || target.hostname!=='pos.toshin.com' || !/\/(DaimonBunyabetsuTop|NendobetsuTop)\/?$/.test(target.pathname)) throw Error('一覧に戻れません');
    await Promise.all([exercise.waitForURL(/\/(DaimonBunyabetsuTop|NendobetsuTop)(?:[/?]|$)/,{timeout:20000}),back.click()]);
    frame=page.frames().find(f=>rootPattern.test(f.url()));
    if(frame) {await frame.locator('input[type=radio][name="科目"]').first().waitFor({state:'attached',timeout:20000});return frame;}
  }
  const year=await openYearList(page);
  const link=year.getByRole('link',{name:'大問別演習',exact:true});
  await Promise.all([year.waitForURL(/\/DaimonBunyabetsuTop(?:[/?]|$)/,{timeout:20000}),link.click()]);
  frame=page.frames().find(f=>rootPattern.test(f.url()));
  if(!frame)throw Error('大問別一覧を開けません');
  await frame.locator('input[type=radio][name="科目"]').first().waitFor({state:'attached',timeout:20000});
  return frame;
}
export async function categorySubjects(frame) {
  return frame.locator('label.criteria-label').evaluateAll(labels=>labels.flatMap((label,index)=>{
    const radio=label.querySelector('input[type=radio][name="科目"]');
    const name=label.querySelector('span')?.textContent?.trim();
    return radio && name && radio.value ? [{index,name,value:radio.value,checked:radio.checked}] : [];
  }));
}
export async function selectCategorySubject(frame, subject) {
  const labels=frame.locator('label.criteria-label');
  const label=labels.nth(subject.index);
  const radio=label.locator('input[type=radio][name="科目"]');
  if(await radio.inputValue()!==subject.value)throw Error('科目一覧が変わりました');
  if(!await radio.isChecked())await label.click();
  if(!await radio.isChecked())throw Error('科目を選択できません');
  await frame.page().waitForTimeout(350);
}
export async function visibleCategories(frame,subject) {
  return frame.locator('.card-front').evaluateAll((cards,subject)=>cards.flatMap(card=>{
    if(!card.getClientRects().length) return [];
    const title=card.querySelector('.card-title-module2')?.textContent?.trim();
    const form=card.querySelector('form[action$="/EnshuKaishi"]');
    const button=form?.querySelector('button[type=submit]');
    const setId=form?.querySelector('input[name="enshuSetId"]')?.value;
    return title && button && !button.disabled && setId ? [{title,setId,subject}] : [];
  }),subject);
}
export async function listCategories(frame) {
  const subjects=await categorySubjects(frame);
  if(!subjects.length)throw Error('科目一覧を確認できません');
  const selected=subjects.find(s=>s.checked);
  const result=[];
  try {
    for(const subject of subjects) {
      await selectCategorySubject(frame,subject);
      result.push(...await visibleCategories(frame,subject));
    }
  } finally {if(selected)await selectCategorySubject(frame,selected);}
  if(!result.length)throw Error('分野を確認できません');
  const unique=new Set();
  for(const x of result){const key=JSON.stringify([x.subject.value,x.setId]);if(unique.has(key))throw Error('分野を一意に特定できません');unique.add(key);}
  return result;
}
export async function enterCategory(frame,category) {
  await selectCategorySubject(frame,category.subject);
  const cards=frame.locator('.card-front');
  const index=await cards.evaluateAll((elements,setId)=>elements.findIndex(card=>card.getClientRects().length && card.querySelector('form[action$="/EnshuKaishi"] input[name="enshuSetId"]')?.value===setId),category.setId);
  if(index<0)throw Error('選択した分野が見つかりません');
  const card=cards.nth(index); const name=(await card.locator('.card-title-module2').innerText()).trim();
  if(name!==category.title)throw Error('選択した分野が変わりました');
  await Promise.all([frame.waitForURL(/\/EnshuKaishi(?:[/?]|$)/,{timeout:20000}),card.locator('form[action$="/EnshuKaishi"] button[type=submit]').click()]);
  const link=frame.locator('a[href*="DaimonBunyabetsuTop"]').first();
  const back=await link.getAttribute('href');
  if(!back || new URL(back,frame.url()).searchParams.get('enshuSetId')!==category.setId)throw Error('演習画面が一致しません');
}
export async function returnToCategories(frame) {
  const back=frame.getByRole('link',{name:'戻る',exact:true}).first();
  const href=await back.getAttribute('href');const target=href && new URL(href,frame.url());
  if(!target || target.protocol!=='https:' || target.hostname!=='pos.toshin.com' || !/\/DaimonBunyabetsuTop\/?$/.test(target.pathname))throw Error('分野一覧に戻れません');
  await Promise.all([frame.waitForURL(/\/DaimonBunyabetsuTop(?:[/?]|$)/,{timeout:20000}),back.click()]);
}
