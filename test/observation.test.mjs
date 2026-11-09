/** Completion observation follows exact tasks through durability, transport and native cleanup. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {providerId,outputId} from '../dist/wire.js'
import {setup,request,scope,signal,deferred,until} from './helpers.mjs'

test('wait joins native cleanup after the final output without waiting for another conversation',async t=>{
 const state=await setup(t),cleanup=deferred(),other=deferred(),nativeWait=state.jobs.wait.bind(state.jobs)
 state.jobs.wait=async(...args)=>{const result=await nativeWait(...args);await cleanup.promise;return result}
 state.engine.register({id:providerId('fixture'),maxConcurrent:2,async run(input,context){if(input.operationId==='other')await other.promise;await context.checkpoint(outputId('original'),[{type:'text',text:input.payload.text}])}})
 try{
  const first=await state.engine.submit(request('first'),signal()),second=await state.engine.submit(request('other',scope('other')),signal());let finished=false
  const waiting=state.engine.wait(scope(),first.id,signal()).then(value=>{finished=true;return value})
  await until(()=>state.engine.inspect(scope(),first.id).outputs[0]?.state==='accepted');assert.equal(state.engine.inspect(scope(),first.id).execution,'completed');assert.equal(finished,false)
  cleanup.resolve();const result=await waiting;assert.equal(result.execution,'completed');assert.equal(result.outputCounts.accepted,1);assert.equal(state.engine.inspect(scope('other'),second.id).execution,'running')
 }finally{cleanup.resolve();other.resolve()}
})

test('cancelling observation frees its subscription without cancelling or repeating the task',async t=>{
 const state=await setup(t,{maxObservers:1}),finish=deferred(),entered=deferred();let calls=0
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;entered.resolve();await finish.promise;await context.checkpoint(outputId('original'),[{type:'text',text:'saved once'}])}})
 try{
  const {id}=await state.engine.submit(request(),signal());await entered.promise
  const abort=new AbortController(),waiting=state.engine.wait(scope(),id,abort.signal);abort.abort();await assert.rejects(waiting,error=>error.code==='cancelled')
  assert.equal(state.engine.inspect(scope(),id).cancelRequested,false);const release=state.engine.subscribe(scope(),()=>{});release();finish.resolve()
  const result=await state.engine.wait(scope(),id,signal());assert.equal(result.execution,'completed');assert.equal(calls,1)
 }finally{finish.resolve()}
})

test('uncertain execution and delivery resolve as uncertain without retries or success substitution',async t=>{
 const state=await setup(t);let calls=0;state.setSend(async()=>({status:'uncertain',code:'provider-error'}))
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(outputId('original'),[{type:'text',text:'partial'}]);throw Error('synthetic unknown remote result')}})
 const {id}=await state.engine.submit(request(),signal()),result=await state.engine.wait(scope(),id,signal())
 assert.equal(result.execution,'uncertain');assert.equal(result.outputCounts.uncertain,1);assert.equal(calls,1);assert.equal(state.jobs.records.size,0)
})

test('exact-scope notifications contain no bodies and contain throwing and rejecting observers',async t=>{
 const state=await setup(t);let calls=0,foreign=0,argumentCount=-1
 const releases=[state.engine.subscribe(scope(),()=>{throw Error('synthetic observer failure')}),state.engine.subscribe(scope(),async()=>{throw Error('synthetic observer rejection')}),state.engine.subscribe(scope(),(...args)=>{calls++;argumentCount=args.length}),state.engine.subscribe(scope('other'),()=>{foreign++}),state.engine.subscribe(scope('group-a','private'),()=>{foreign++}),state.engine.subscribe(scope('group-a','group','other-account'),()=>{foreign++})]
 await state.engine.submit(request(),signal());await until(()=>calls===1);assert.equal(argumentCount,0);assert.equal(foreign,0)
 for(const release of releases){release();release()}
 await state.engine.submit(request('next'),signal());await Promise.resolve();assert.equal(calls,1)
})

test('one observer slot is required per wait and released for completed, missing and aborted tasks',async t=>{
 const state=await setup(t,{maxObservers:1}),{id}=await state.engine.submit(request(),signal()),release=state.engine.subscribe(scope(),()=>{})
 await assert.rejects(state.engine.wait(scope(),id,signal()),error=>error.code==='capacity');const aborted=new AbortController();aborted.abort();await assert.rejects(state.engine.wait(scope(),id,aborted.signal),error=>error.code==='cancelled');release()
 await assert.rejects(state.engine.wait(scope('other'),id,signal()),error=>error.code==='not-found');await state.engine.cancel(scope(),id)
 assert.equal((await state.engine.wait(scope(),id,signal())).execution,'cancelled');const after=state.engine.subscribe(scope(),()=>{});after()
})

test('cancel and join keep the capture owner alive until aborted producer and transport finish',async t=>{
 const state=await setup(t),entered=deferred(),sendEntered=deferred(),producerFinish=deferred(),sendFinish=deferred()
 state.setSend(async(message,abort)=>{sendEntered.resolve();await sendFinish.promise;return{status:'accepted',messageIds:['late-accepted']}})
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('original'),[{type:'text',text:'late result'}]);entered.resolve();await producerFinish.promise}})
 try{
  const {id}=await state.engine.submit(request(),signal());await entered.promise;await sendEntered.promise;await assert.rejects(state.engine.join(scope('other'),id),error=>error.code==='not-found')
  await state.engine.cancel(scope(),id);let joined=false;const joining=state.engine.join(scope(),id).then(()=>{joined=true});producerFinish.resolve();await Promise.resolve();assert.equal(joined,false);sendFinish.resolve();await joining
  const result=await state.engine.wait(scope(),id,signal());assert.equal(result.execution,'cancelled');assert.equal(result.outputCounts.accepted,1)
 }finally{producerFinish.resolve();sendFinish.resolve()}
})

test('runtime closure rejects waiters while join remains available until actual producer cleanup',async t=>{
 const state=await setup(t),entered=deferred(),aborted=deferred(),finish=deferred()
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){entered.resolve();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));aborted.resolve();await finish.promise}})
 try{
  const {id}=await state.engine.submit(request(),signal());await entered.promise;const waiting=state.engine.wait(scope(),id,signal()),closed=state.engine.close();await assert.rejects(waiting,error=>error.code==='closed');await aborted.promise
  let joined=false;const joining=state.engine.join(scope(),id).then(()=>{joined=true});await Promise.resolve();assert.equal(joined,false);finish.resolve();await joining;await closed
 }finally{finish.resolve()}
})
