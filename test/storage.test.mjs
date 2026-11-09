/** Native storage fault, durable admission and interrupted-record recovery cases. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {StorageError} from '@deepseek-ai/dsh-storage'
import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain'
import {recordSchema,outputId,providerId} from '../dist/wire.js'
import {setup,scope,request,signal,until,deferred} from './helpers.mjs'
export function intercepted(native,intercept){return{close:async()=>{},kv:{async open(spec){const unit=await native.kv.open(spec);return new Proxy(unit,{get(target,key){if(key==='putRecord')return(table,id,value)=>intercept(()=>unit.putRecord(table,id,value),value);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})}}}}
function output(state,count){state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){count?.();await context.checkpoint(outputId('result'),[{type:'text',text:'stored result'}])}})}

test('no producer starts before full source durability, and a cancelled admission still returns its committed identity',async t=>{
 const entered=deferred(),finish=deferred();let first=true,calls=0
 const state=await setup(t,{}, {backend:native=>intercepted(native,async(write,value)=>{if(first){first=false;entered.resolve();await finish.promise}await write()})});output(state,()=>calls++)
 const abort=new AbortController(),admission=state.engine.submit(request(),abort.signal);await entered.promise;assert.equal(calls,0);assert.equal(state.jobs.seen.length,0);abort.abort();finish.resolve();const admitted=await admission;await until(()=>state.sent.length===1);assert.equal(calls,1);assert.equal((await state.engine.submit(request(),signal())).id,admitted.id)
})

test('ambiguous native storage failure stops execution while safe status remains observable',async t=>{
 let armed=true,calls=0;const state=await setup(t,{}, {backend:native=>intercepted(native,async(write,value)=>{await write();if(armed){armed=false;throw new StorageError('unknown-state','SYNTHETIC_PRIVATE_BACKEND_DETAIL')}})});output(state,()=>calls++)
 await assert.rejects(state.engine.submit(request(),signal()),error=>error.code==='storage');assert.equal(calls,0);const status=state.engine.status();assert.equal(status.fault,'storage');assert.equal(status.tasks,null);assert.equal(status.stopping,true);assert.ok(!JSON.stringify(status).includes('SYNTHETIC_PRIVATE_BACKEND_DETAIL'))
 await assert.rejects(state.engine.submit(request('later'),signal()),error=>error.code==='storage');await state.reopen();assert.equal(state.engine.inspect(scope(),(await state.engine.submit(request(),signal())).id).execution,'queued');assert.equal(calls,0)
})

test('restored execution and sending interruptions are classified without repeating generation or sending',async t=>{
 const state=await setup(t);output(state);const {id}=await state.engine.submit(request(),signal());await until(()=>state.sent.length===1&&state.engine.status().running===0&&state.engine.status().sending===0);await state.engine.close()
 const native=await state.domains.open(defineDomain({name:state.config.namespace,version:1,layout:'single',tables:{tasks:domainTable(recordSchema(state.config))}}));await native.table('tasks').update(id,value=>({...value,execution:'running',outputs:value.outputs.map(item=>({...item,state:'sending',receipt:null}))}));await native.close()
 await state.reopen();const restored=state.engine.inspect(scope(),id);assert.equal(restored.execution,'uncertain');assert.equal(restored.outputs[0].state,'uncertain');state.engine.wake();assert.equal(state.sent.length,1);assert.equal(state.jobs.seen.length,1)
})

test('durable cancellation keeps pending outputs stopped across reopen',async t=>{
 const state=await setup(t),entered=deferred(),finish=deferred();let calls=0
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(outputId('saved'),[{type:'text',text:'saved before stop'}]);entered.resolve();await finish.promise}})
 state.setAvailability('offline');const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().blockedScopes===1);await state.engine.cancel(scope(),id);await state.reopen();state.setAvailability('available');state.engine.wake();assert.equal(state.engine.inspect(scope(),id).execution,'cancelled');assert.equal(calls,0);assert.equal(state.sent.length,0);finish.resolve()
})

test('a future native unit version fails loudly instead of hiding tasks and allowing a duplicate admission',async t=>{
 let declaration;const state=await setup(t,{}, {facility:domains=>({async open(spec){declaration=spec;return domains.open(spec)}})}),{id}=await state.engine.submit(request(),signal());await state.engine.close()
 const future=await state.domains.open({...declaration,version:2,compatibleVersions:[1]});await future.table('tasks').update(id,value=>({...value,updatedAt:value.updatedAt+1}));await future.close()
 await assert.rejects(state.reopen(),error=>error.code==='storage');assert.equal(state.sent.length,0);assert.equal(state.jobs.seen.length,0)
})
