/** Abort and unload join actual producer cleanup, independently of sibling tasks. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {outputId,providerId} from '../dist/wire.js'
import {setup,request,scope,signal,until,deferred} from './helpers.mjs'
test('unregister aborts and joins late producer cleanup while another provider continues',async t=>{
 const state=await setup(t),entered=deferred(),aborted=deferred(),finish=deferred();const release=state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){entered.resolve();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));aborted.resolve();await finish.promise}})
 const first=await state.engine.submit(request('first'),signal());await entered.promise;let removed=false;const closing=release().then(()=>{removed=true});await aborted.promise;assert.equal(removed,false)
 state.engine.register({id:providerId('other'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:'other producer works'}])}});const second=await state.engine.submit({...request('second',scope('group-b')),provider:providerId('other')},signal());await until(()=>state.engine.inspect(scope('group-b'),second.id).outputs[0]?.state==='accepted');assert.equal(removed,false);finish.resolve();await closing;assert.equal(state.engine.inspect(scope(),first.id).execution,'uncertain')
})
test('runtime close joins an aborted producer and reopening never blindly repeats its request',async t=>{
 const state=await setup(t),entered=deferred(),aborted=deferred(),finish=deferred();let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;entered.resolve();await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));aborted.resolve();await finish.promise}})
 const {id}=await state.engine.submit(request(),signal());await entered.promise;let closed=false;const closing=state.engine.close().then(()=>{closed=true});await aborted.promise;assert.equal(closed,false);await assert.rejects(state.engine.submit(request('later'),signal()),error=>error.code==='closed');finish.resolve();await closing;await state.reopen();state.engine.wake();assert.equal(calls,1);assert.equal(state.engine.inspect(scope(),id).execution,'uncertain')
})
test('a native job preflight refusal is queued without invoking the producer or creating a retry loop',async t=>{
 const state=await setup(t);let calls=0;state.jobs.refuse=true;state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(outputId('result'),[{type:'text',text:'ready'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().running===0&&state.engine.status().blockedScopes===1);assert.equal(calls,0);assert.equal(state.engine.inspect(scope(),id).execution,'queued');assert.equal(state.engine.inspect(scope(),id).attempts,0);state.jobs.refuse=false;state.engine.wake(scope());await until(()=>state.engine.inspect(scope(),id).outputs[0]?.state==='accepted');assert.equal(calls,1)
})
test('operator-confirmed no execution can retry an empty task while a partial task cannot regenerate',async t=>{
 const state=await setup(t);let fail=true,calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;if(fail)throw Error('synthetic unknown remote status');await context.checkpoint(outputId('result'),[{type:'text',text:'recovered'}]);if(input.operationId==='partial')throw Error('synthetic failure after output')}})
 const first=await state.engine.submit(request('empty'),signal());await until(()=>state.engine.inspect(scope(),first.id).execution==='uncertain'&&state.engine.status().running===0);fail=false;await state.engine.resolveExecution(scope(),first.id,{state:'not-started'});await until(()=>state.engine.inspect(scope(),first.id).execution==='completed');assert.equal(calls,2)
 const partial=await state.engine.submit(request('partial'),signal());await until(()=>state.engine.inspect(scope(),partial.id).execution==='uncertain'&&state.engine.status().running===0);await assert.rejects(state.engine.resolveExecution(scope(),partial.id,{state:'not-started'}),error=>error.code==='conflict');await state.engine.resolveExecution(scope(),partial.id,{state:'completed'});assert.equal(calls,3)
})
