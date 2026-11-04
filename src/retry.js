export function httpError(response) {
  const error=new Error(`HTTP ${response.status()}`);
  const value=response.headers?.()['retry-after'];
  if(value) {
    const seconds=Number(value);
    const time=Number.isFinite(seconds) ? seconds*1000 : Date.parse(value)-Date.now();
    if(Number.isFinite(time) && time>0)error.retryAfterMs=time;
  }
  return error;
}
export async function retryTransient(fn,{sleep, onRetry=()=>{}, cancelled=()=>false, attempts=3}) {
  for(let i=1;;i++) {
    try{return await fn();}
    catch(e){
      const status=Number(/^HTTP (\d{3})$/.exec(e.message)?.[1]);
      if(i>=attempts || !(status===429 || status>=500 && status<=599))throw e;
      const delay=Math.max(e.retryAfterMs||0,status===429?60000:30000);
      onRetry(status,i,delay);
      await sleep(delay);
      if(cancelled())throw Error('停止');
    }
  }
}
