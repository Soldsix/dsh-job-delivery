/** Five synthetic 100-case failure families exercise the actual native storage-backed queue. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain'
import {recordSchema,providerId,outputId} from '../dist/wire.js'
import {setup,request,scope,signal,until} from './helpers.mjs'
const count=100
function source(family,index){return request(family+'-'+index,scope('room-'+index%3,index%2?'group':'private'),{family,index,text:'原文 '+index+'\nunchanged'})}
test('100 uncertain producer outcomes preserve source and never execute again on replay',async t=>{
 const state=await setup(t);let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(){calls++;throw Error('synthetic producer outcome unknown')}})
 for(let i=0;i<count;i++){const value=source('producer',i),{id}=await state.engine.submit(value,signal());await until(()=>state.engine.inspect(value.scope,id).execution==='uncertain'&&state.engine.status().running===0);await state.engine.submit(value,signal());assert.deepEqual(state.engine.inspect(value.scope,id).request,value)}
 assert.equal(calls,count);assert.equal(state.sent.length,0);t.diagnostic('failure-family=producer-unknown cases=100 real-provider-calls=0')
})
test('100 partial failures keep exact checkpointed outputs without repeating generation or delivery',async t=>{
 const state=await setup(t);let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(input,context){calls++;await context.checkpoint(outputId('saved'),[{type:'text',text:input.payload.text}]);throw Error('synthetic failure after completed original')}})
 for(let i=0;i<count;i++){const value=source('partial',i),{id}=await state.engine.submit(value,signal());await until(()=>state.engine.inspect(value.scope,id).outputs[0]?.state==='accepted'&&state.engine.inspect(value.scope,id).execution==='uncertain');await state.engine.submit(value,signal());assert.equal(state.engine.inspect(value.scope,id).outputs[0].parts[0].text,value.payload.text)}
 await until(()=>state.engine.status().sending===0&&state.engine.status().running===0);assert.equal(calls,count);assert.equal(state.sent.length,count);t.diagnostic('failure-family=partial-then-error cases=100 real-provider-calls=0')
})
test('100 uncertain sends remain untouched by input replay, wake and native storage reopen',async t=>{
 const state=await setup(t);let calls=0,sends=0;state.setSend(async()=>{sends++;return{status:'uncertain',code:'timeout'}});state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(input,context){calls++;await context.checkpoint(outputId('saved'),[{type:'text',text:input.payload.text}])}})
 for(let i=0;i<count;i++){const value=source('send',i),{id}=await state.engine.submit(value,signal());await until(()=>state.engine.inspect(value.scope,id).outputs[0]?.state==='uncertain');await state.engine.submit(value,signal())}
 await state.reopen();state.engine.wake();assert.equal(calls,count);assert.equal(sends,count);assert.equal([...Array(count)].every((_,i)=>state.engine.list(source('send',i).scope).some(value=>value.outputCounts.uncertain>0)),true);t.diagnostic('failure-family=delivery-unknown cases=100 real-provider-calls=0')
})
test('100 durable stops survive reopening and adding a producer later',async t=>{
 const state=await setup(t);let calls=0
 for(let i=0;i<count;i++){const value=source('stop',i),{id}=await state.engine.submit(value,signal());await state.engine.cancel(value.scope,id)}
 await state.reopen();state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(){calls++}});state.engine.wake();assert.equal(calls,0);assert.equal(state.sent.length,0);for(let i=0;i<count;i++)assert.equal(state.engine.list(source('stop',i).scope).every(value=>value.execution==='cancelled'),true);t.diagnostic('failure-family=cancel-before-execute cases=100 real-provider-calls=0')
})
test('100 retained interruption states recover as uncertain instead of becoming new work',async t=>{
 const state=await setup(t),identities=[];let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(input,context){calls++;await context.checkpoint(outputId('saved'),[{type:'text',text:input.payload.text}])}})
 for(let i=0;i<count;i++){const value=source('interruption',i),{id}=await state.engine.submit(value,signal());identities.push({id,scope:value.scope});await until(()=>state.engine.inspect(value.scope,id).outputs[0]?.state==='accepted')}
 await state.engine.close();const domain=await state.domains.open(defineDomain({name:state.config.namespace,version:1,layout:'single',tables:{tasks:domainTable(recordSchema(state.config))}}));for(const {id}of identities)await domain.table('tasks').update(id,value=>({...value,execution:'running',outputs:value.outputs.map(item=>({...item,state:'sending',receipt:null}))}));await domain.close();await state.reopen();state.engine.register({id:providerId('fixture'),maxConcurrent:4,async run(){calls++}});state.engine.wake()
 for(const {id,scope:destination}of identities){const task=state.engine.inspect(destination,id);assert.equal(task.execution,'uncertain');assert.equal(task.outputs[0].state,'uncertain')}assert.equal(calls,count);assert.equal(state.sent.length,count);t.diagnostic('failure-family=retained-interruption-fixture cases=100 real-provider-calls=0')
})
