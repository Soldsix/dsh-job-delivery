/** Native owner controls use real durable queues with a controlled config-editor fixture. */
import test from 'node:test'
import assert from 'node:assert/strict'
import Control,{Config as ControlConfig} from '../dist/control.js'
import {Config} from '../dist/config.js'
import {providerId,outputId} from '../dist/wire.js'
import {snapshotSchema,detailSchema,decisionSchema} from '../dist/control-codecs.js'
import {setup,request,scope,signal,until,deferred} from './helpers.mjs'

async function mount(t,{editError=false,editorGate,control={}}={}){
 const state=await setup(t),writes=[],entry={options:{id:'job-delivery',name:'dsh-job-delivery',config:state.config},disabled:false,fiber:{state:2,effectiveConfig:state.config,async restart(){writes.push('restart')}}}
 const editor={entries:()=>[entry],async edit(target,change){assert.equal(target,entry);await editorGate?.promise;const next=change(entry.options.config);if(editError)throw Error('SYNTHETIC_PRIVATE_BACKEND_PATH');writes.push(next);entry.options.config=next;entry.fiber.effectiveConfig=Config(next)}}
 const services=state.ctx.plugin({name:'control-fixture',apply(ctx){ctx.effect(()=>ctx.provide('configEditor',editor));ctx.effect(()=>ctx.provide('storageDomain',state.domains));ctx.effect(()=>ctx.provide('jobDelivery',state.engine))}});await services.await()
 const fiber=state.ctx.plugin(Control,ControlConfig(control));await fiber.await();t.after(async()=>{await fiber.dispose();await services.dispose()})
 return{...state,entry,writes,control:state.ctx.jobDeliveryControl}
}

test('owner metadata is scoped, paged and body-free, including uncertain output inspection',async t=>{
 const state=await mount(t,{control:{pageSize:1,maxOutputPreviews:1,maxPreviewMessageIds:1,maxScopeOptions:1}})
 state.setSend(async()=>({status:'uncertain',code:'provider-error'}))
 state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('first'),[{type:'text',text:'SYNTHETIC_OUTPUT_NOT_FOR_CONTROL'}]);await context.checkpoint(outputId('second'),[{type:'text',text:'OTHER_PRIVATE_OUTPUT'}])}})
 const first=await state.engine.submit(request('first',scope(),{prompt:'SYNTHETIC_PROMPT_NOT_FOR_CONTROL'}),signal());await state.engine.submit(request('second'),signal());await state.engine.submit(request('other',scope('other-room')),signal());await until(()=>state.engine.status().running===0&&state.engine.status().sending===0&&state.engine.inspect(scope(),first.id).outputs[0]?.state==='uncertain')
 const snapshot=await state.control.describe();assert.equal(snapshotSchema.safeParse(snapshot).success,true);assert.equal(snapshot.active,true)
 const catalog=await state.control.scopes();assert.equal(catalog.scopes.length,1);assert.equal(catalog.omitted,1)
 const page=await state.control.list({scope:scope(),offset:0});assert.equal(page.tasks.length,1);assert.equal(page.total,2);assert.equal(page.nextOffset,1);assert.equal((await state.control.list({scope:scope(),offset:1})).tasks[0].id,first.id)
 const detail=await state.control.inspect({scope:scope(),id:first.id});assert.equal(detailSchema.safeParse(detail).success,true);assert.equal(detail.outputs.length,1);assert.equal(detail.omittedOutputs,1)
 assert.ok(!JSON.stringify({snapshot,catalog,page,detail}).includes('NOT_FOR_CONTROL'));assert.ok(!JSON.stringify(detail).includes('OTHER_PRIVATE_OUTPUT'))
 await assert.rejects(state.control.inspect({scope:scope('other-room'),id:first.id}),error=>error.details?.reason==='not-found')
})

test('reconciliation requires confirmation and a fresh revision, then sends only retained output',async t=>{
 const state=await mount(t);let calls=0
 state.setSend(async()=>({status:'uncertain',code:'provider-error'}));state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(outputId('result'),[{type:'text',text:'EXACT_SAVED_OUTPUT'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().sending===0&&state.engine.inspect(scope(),id).outputs[0]?.state==='uncertain')
 const detail=await state.control.inspect({scope:scope(),id}),decision={scope:scope(),id,revision:detail.revision,kind:'delivery',outputId:'result',state:'not-sent'}
 assert.equal(decisionSchema.safeParse({...decision,confirmed:false}).success,false)
 await assert.rejects(async()=>state.control.reconcile(decision),error=>error.details?.reason==='invalid')
 await assert.rejects(state.control.reconcile({...decision,confirmed:true,revision:'0'.repeat(64)}),error=>error.details?.reason==='conflict')
 state.setSend(async message=>{state.sent.push(message);return{status:'accepted',messageIds:['observed-receipt']}})
 await state.control.reconcile({...decision,confirmed:true});await until(()=>state.engine.inspect(scope(),id).outputs[0]?.state==='accepted');assert.equal(calls,1);assert.equal(state.sent.length,1);assert.equal(state.sent[0].parts[0].text,'EXACT_SAVED_OUTPUT')
 await assert.rejects(state.control.reconcile({...decision,confirmed:true}),error=>error.details?.reason==='conflict');assert.equal(calls,1)
})

test('configuration edit holds the queue idle and preserves drafts on sanitized apply failure',async t=>{
 const gate=deferred(),state=await mount(t,{editError:true,editorGate:gate});t.after(()=>gate.resolve())
 const before=await state.control.describe(),saving=state.control.save({revision:before.revision,patch:{maxTasks:9}});await until(()=>state.engine.status().maintenance)
 await assert.rejects(state.engine.submit(request(),signal()),error=>error.code==='busy');state.engine.availabilityChanged(scope());gate.resolve()
 await assert.rejects(saving,error=>error.details?.reason==='apply-failed'&&!JSON.stringify(error).includes('PRIVATE_BACKEND'))
 assert.equal(state.engine.status().maintenance,false);assert.equal(state.writes.length,0);assert.equal((await state.control.describe()).revision,before.revision)
 await state.engine.submit(request(),signal())
})

test('invalid, stale and retained-data-breaking settings are refused before editor writes',async t=>{
 const state=await mount(t),first=await state.engine.submit(request(),signal()),snapshot=await state.control.describe()
 await assert.rejects(state.control.save({revision:'0'.repeat(64),patch:{enabled:false}}),error=>error.details?.reason==='conflict')
 await assert.rejects(state.control.save({revision:snapshot.revision,patch:{maxTasks:0}}),error=>error.details?.reason==='invalid')
 await assert.rejects(state.control.save({revision:snapshot.revision,patch:{namespace:'new_domain'}}),error=>error.details?.reason==='conflict')
 await assert.rejects(state.control.save({revision:snapshot.revision,patch:{maxPayloadBytes:1}}),error=>error.details?.reason==='invalid')
 assert.equal(state.writes.length,0);assert.equal(state.engine.inspect(scope(),first.id).execution,'queued')
 const saved=await state.control.save({revision:snapshot.revision,patch:{maxTasks:9}});assert.equal(saved.config.maxTasks,9);assert.equal(saved.active,false);assert.notEqual(saved.appliedRevision,saved.revision)
})

test('saved configuration remains visible when the runtime Loader component has no fiber',async t=>{
 const state=await mount(t);state.entry.disabled=true;state.entry.fiber=undefined
 const snapshot=await state.control.describe();assert.equal(snapshot.entryDisabled,true);assert.equal(snapshot.active,false);assert.equal(snapshot.config.namespace,state.config.namespace)
 await assert.rejects(state.control.scopes(),error=>error.details?.reason==='unavailable')
 await assert.rejects(state.control.restart({revision:snapshot.revision}),error=>error.details?.reason==='unavailable')
 assert.equal(state.engine.status().maintenance,false)
})
