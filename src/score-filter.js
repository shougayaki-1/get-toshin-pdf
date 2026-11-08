// POS shows the highest score adjacent to the label; the 80% pass average is NOT the student's score.
// The visible layout may put the number before or after the label.
export function parseHighestScoreRate(text) {
  const content=String(text ?? '').replace(/％/g,'%');
  const marker='最高得点率';
  const at=content.indexOf(marker);
  if(at<0)return null;
  const before=content.slice(Math.max(0,at-24),at).match(/(?:^|[^\d])(\d{1,3}|-)\s*%\s*$/);
  if(before)return validRate(before[1]);
  const after=content.slice(at+marker.length).match(/^\s*(\d{1,3}|-)\s*%/);
  if(!after)return null;
  const average=content.indexOf('合格者平均',at+marker.length);
  if(average>=0 && at+marker.length+after[0].length>average)return null;
  return validRate(after[1]);
}

function validRate(value) {
  if(value==='-')return null;
  const score=Number(value);
  return Number.isInteger(score) && score>=0 && score<=100 ? score : null;
}

export function isReviewTarget(question) {
  return typeof question.scoreRate==='number' && Number.isFinite(question.scoreRate) &&
    question.scoreRate>=0 && question.scoreRate<80;
}
