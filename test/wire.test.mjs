/** Queued wire and durable-state validation refuse ambiguous authority or replay classifications. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {defineDomain,domainTable} from '@deepseek-ai/dsh-storage-domain'
import {Config,validateConfig} from '../dist/config.js'
import {recordSchema,providerId,outputId} from '../dist/wire.js'
import {setup,request,scope,signal,until} from './helpers.mjs'
test('configuration and complete incoming identities fail before source persistence',async t=>{
 assert.throws(()=>validateConfig(Config({namespace:'../escape'})));assert.throws(()=>validateConfig(Config({namespace:'bad-name'})));assert.throws(()=>validateConfig(Config({maxRecordBytes:1024,maxReceiptBytes:1024,maxPayloadBytes:100})))
 const state=await setup(t);for(const value of[{...request(),liveDestination:'not-authorized'},{...request(),actorId:undefined},{...request(),scope:{...scope(),owner:true}},{...request(),payload:{amount:Infinity}},{...request(),payload:'x'.repeat(state.config.maxPayloadBytes+1)}])await assert.rejects(state.engine.submit(value,signal()),error=>error.code==='invalid');assert.equal(state.engine.status().tasks,0)
 const first=await state.engine.submit(request(),signal());await assert.rejects(state.engine.submit({...request(),actorId:'different-actor'},signal()),error=>error.code==='conflict');assert.equal(state.engine.inspect(scope(),first.id).request.actorId,'synthetic-actor')
})
test('an uncertain receipt cannot be restored as pending and resent by a corrupted classification',async t=>{
 const state=await setup(t);state.setSend(async()=>({status:'uncertain',code:'timeout'}));state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('saved'),[{type:'text',text:'original'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),id).outputs[0]?.state==='uncertain'&&state.engine.status().sending===0&&state.engine.status().running===0);await state.engine.close()
 const domain=await state.domains.open(defineDomain({name:state.config.namespace,version:1,layout:'single',tables:{tasks:domainTable(recordSchema(state.config))}}));await domain.table('tasks').update(id,value=>({...value,outputs:value.outputs.map(output=>({...output,state:'pending'}))}));await domain.close();await assert.rejects(state.reopen(),error=>error.code==='storage')
})
test('contradictory checkpoint identities preserve the first original and do not silently overwrite it',async t=>{
 const state=await setup(t);state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('same'),[{type:'text',text:'first immutable original'}]);await context.checkpoint(outputId('same'),[{type:'text',text:'different result'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),id).execution==='uncertain');assert.equal(state.engine.inspect(scope(),id).outputs[0].parts[0].text,'first immutable original');assert.equal(state.engine.inspect(scope(),id).failure,'conflict')
})
