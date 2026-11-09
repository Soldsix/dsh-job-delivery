/** Unknown sends require an external observation; retained originals are never regenerated for delivery. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {outputId,providerId} from '../dist/wire.js'
import {setup,request,scope,signal,until,deferred} from './helpers.mjs'
function producer(state,run){state.engine.register({id:providerId('fixture'),maxConcurrent:2,async run(input,context){run?.();await context.checkpoint(outputId('result'),[{type:'text',text:'retained original'}])}})}
test('uncertain send is not retried by wakes, source replay or service restart',async t=>{
 const state=await setup(t);let sends=0,runs=0;producer(state,()=>runs++);state.setSend(async()=>{sends++;return{status:'uncertain',code:'timeout'}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),id).outputs[0]?.state==='uncertain');state.engine.wake();await state.engine.submit(request(),signal());await state.reopen();state.engine.wake();assert.equal(sends,1);assert.equal(runs,1);assert.equal(state.engine.inspect(scope(),id).outputs[0].state,'uncertain')
 await state.engine.resolveDelivery(scope(),id,'result',{state:'accepted',messageIds:['observed-on-server']});assert.equal(state.engine.inspect(scope(),id).outputs[0].state,'accepted');assert.equal(sends,1)
})
test('confirmed no-send resubmits exact output and operation without invoking its producer',async t=>{
 const state=await setup(t);let calls=0;producer(state,()=>calls++);const attempts=[];state.setSend(async message=>{attempts.push(structuredClone(message));return attempts.length===1?{status:'uncertain',code:'provider-error'}:{status:'accepted',messageIds:['accepted-once']}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),id).outputs[0]?.state==='uncertain');await until(()=>state.engine.status().sending===0);await assert.rejects(state.engine.resolveDelivery(scope('other'),id,'result',{state:'not-sent'}),error=>error.code==='not-found');await state.engine.resolveDelivery(scope(),id,'result',{state:'not-sent'});await until(()=>attempts.length===2&&state.engine.inspect(scope(),id).outputs[0].state==='accepted');assert.equal(calls,1);assert.deepEqual(attempts[0],attempts[1]);assert.equal(state.engine.inspect(scope(),id).outputs[0].attempts,2)
})
test('cancel is durable before abort and late accepted receipts remain accepted rather than being replayed',async t=>{
 const state=await setup(t),entered=deferred(),finish=deferred();producer(state);let sends=0;state.setSend(async()=>{sends++;entered.resolve();await finish.promise;return{status:'accepted',messageIds:['late-acceptance']}})
 const {id}=await state.engine.submit(request(),signal());await entered.promise;await state.engine.cancel(scope(),id);assert.equal(state.engine.inspect(scope(),id).cancelRequested,true);finish.resolve();await until(()=>state.engine.status().sending===0);const output=state.engine.inspect(scope(),id).outputs[0];assert.equal(output.state,'accepted');await state.reopen();state.engine.wake();assert.equal(sends,1)
})
test('a definitive offline send holds its saved output and explicit wake retries delivery only',async t=>{
 const state=await setup(t);let runs=0,sends=0;producer(state,()=>runs++);state.setSend(async()=>{sends++;return sends===1?{status:'failed',code:'offline'}:{status:'accepted',messageIds:['online']}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().blockedScopes===1&&state.engine.status().sending===0);assert.equal(state.engine.inspect(scope(),id).outputs[0].state,'pending');state.engine.wake(scope());await until(()=>state.engine.inspect(scope(),id).outputs[0].state==='accepted');assert.equal(runs,1);assert.equal(sends,2)
})
