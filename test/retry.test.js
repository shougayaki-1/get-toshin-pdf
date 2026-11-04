import test from 'node:test';
import assert from 'node:assert/strict';
import {httpError,retryTransient} from '../src/retry.js';

test('honors retry-after and limits retry on 429 or server errors',async()=>{
  const waits=[];let calls=0;
  const result=await retryTransient(async()=>{calls++;if(calls<3)throw httpError({status:()=>429,headers:()=>({'retry-after':'90'})});return 'ok';},{sleep:async ms=>waits.push(ms)});
  assert.equal(result,'ok');assert.equal(calls,3);assert.deepEqual(waits,[90000,90000]);
  calls=0;await assert.rejects(retryTransient(async()=>{calls++;throw Error('HTTP 403');},{sleep:async()=>{}}),/403/);assert.equal(calls,1);
  calls=0;await assert.rejects(retryTransient(async()=>{calls++;throw Error('HTTP 503');},{sleep:async()=>{}}),/503/);assert.equal(calls,3);
});

test('retry wait can be cancelled before another request',async()=>{
  let calls=0,cancelled=false;
  await assert.rejects(retryTransient(async()=>{calls++;throw Error('HTTP 429');},{sleep:async()=>{cancelled=true;},cancelled:()=>cancelled}),/停止/);
  assert.equal(calls,1);
});
