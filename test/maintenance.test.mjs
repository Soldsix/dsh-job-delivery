/** Owner edits cannot race admitted work or hide retained tasks behind smaller limits. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {providerId,outputId} from '../dist/wire.js'
import {taskRevision} from '../dist/revision.js'
import {setup,request,scope,signal,until,deferred} from './helpers.mjs'

test('maintenance refuses new writes and dispatch until the idempotent release',async t=>{
 const state=await setup(t);let calls=0
 const {id}=await state.engine.submit(request(),signal());const release=state.engine.acquireMaintenance()
 assert.equal(state.engine.status().maintenance,true)
 await assert.rejects(state.engine.submit(request('new'),signal()),error=>error.code==='busy')
 await assert.rejects(state.engine.cancel(scope(),id),error=>error.code==='busy')
 assert.throws(()=>state.engine.wake(),error=>error.code==='busy')
 assert.throws(()=>state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(){calls++}}),error=>error.code==='busy')
 assert.doesNotThrow(()=>state.engine.availabilityChanged(scope()));assert.doesNotThrow(()=>state.engine.capacityAvailable())
 assert.throws(()=>state.engine.acquireMaintenance(),error=>error.code==='busy')
 assert.equal(state.engine.list(scope()).length,1);release();release()
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(){calls++}})
 await until(()=>state.engine.inspect(scope(),id).execution==='completed');assert.equal(calls,1);assert.equal(state.engine.status().maintenance,false)
})

test('active execution and admitted cancellation each prevent maintenance',async t=>{
 const state=await setup(t),entered=deferred(),finish=deferred();t.after(()=>finish.resolve())
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(){entered.resolve();await finish.promise}})
 const {id}=await state.engine.submit(request(),signal());await entered.promise
 assert.throws(()=>state.engine.acquireMaintenance(),error=>error.code==='busy')
 finish.resolve();await until(()=>state.engine.status().running===0)
 const cancel=state.engine.cancel(scope(),id)
 assert.throws(()=>state.engine.acquireMaintenance(),error=>error.code==='busy')
 await cancel;const release=state.engine.acquireMaintenance();release()
})

test('replacement checks every retained record and capacity without changing data',async t=>{
 const state=await setup(t);state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:'saved exact text'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().running===0&&state.engine.inspect(scope(),id).outputs[0]?.state==='accepted'&&state.engine.status().sending===0)
 const second=await state.engine.submit(request('second'),signal());await until(()=>state.engine.status().running===0&&state.engine.inspect(scope(),second.id).outputs[0]?.state==='accepted'&&state.engine.status().sending===0)
 const before=state.engine.inspect(scope(),id),release=state.engine.acquireMaintenance();t.after(release)
 assert.throws(()=>state.engine.validateReplacement({...state.config,namespace:'another_domain'}),error=>error.code==='conflict')
 assert.throws(()=>state.engine.validateReplacement({...state.config,maxTextChars:1}),error=>error.code==='invalid')
 assert.throws(()=>state.engine.validateReplacement({...state.config,maxTasks:1}),error=>error.code==='capacity')
 assert.doesNotThrow(()=>state.engine.validateReplacement({...state.config,enabled:false,maxConcurrentExecutions:8}))
 assert.deepEqual(state.engine.inspect(scope(),id),before)
 const scopes=state.engine.scopes();scopes[0].peerId='changed';assert.equal(state.engine.scopes()[0].peerId,scope().peerId)
 assert.equal(state.engine.list(scope())[0].actorId,request().actorId)
})

test('a stale owner decision is rejected inside the serialized record transition',async t=>{
 const state=await setup(t),{id}=await state.engine.submit(request(),signal()),revision=taskRevision(state.engine.inspect(scope(),id))
 const first=state.engine.cancel(scope(),id,revision),second=state.engine.cancel(scope(),id,revision)
 await first;await assert.rejects(second,error=>error.code==='conflict')
 const current=taskRevision(state.engine.inspect(scope(),id));await state.engine.cancel(scope(),id,current)
 assert.equal(state.engine.inspect(scope(),id).cancelRequested,true)
})
