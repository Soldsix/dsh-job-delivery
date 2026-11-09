/** Native Cordis injection access differs from passing an IM object to the queue constructor. */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Plugin from '../dist/index.js'
import {setup,request,scope,signal,until} from './helpers.mjs'
test('a later injected IM provider reaches the runtime through its injected child context',async t=>{
 const state=await setup(t),fibers=[];let service,calls=0
 try{
  const services=state.ctx.plugin({name:'native-job-services',apply(ctx){ctx.effect(()=>ctx.provide('jobs',Object.assign(state.jobs,{attachController:()=>()=>{}})));ctx.effect(()=>ctx.provide('storageDomain',state.domains))}});fibers.push(services);await services.await()
  const runtime=state.ctx.plugin(Plugin,Plugin.Config({enabled:true,namespace:'injected_tasks'}));fibers.push(runtime);await runtime.await()
  const consumer=state.ctx.plugin({name:'native-job-consumer',inject:['jobDelivery'],apply(ctx){service=ctx.jobDelivery;ctx.effect(()=>ctx.jobDelivery.register({id:Plugin.providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(Plugin.outputId('reply'),[{type:'text',text:'injected provider output'}])}}))}});fibers.push(consumer);await consumer.await();assert.ok(service);assert.equal(service.status().imAvailable,false)
  const {id}=await service.submit(request(),signal());await until(()=>service.status().blockedScopes===1);assert.equal(calls,0)
  const transport=state.ctx.plugin({name:'native-im-injection',apply(ctx){ctx.effect(()=>ctx.provide('im',state.im))}});fibers.push(transport);await transport.await();await until(()=>service.inspect(scope(),id).outputs[0]?.state==='accepted');assert.equal(calls,1);assert.equal(service.status().imAvailable,true)
 }finally{for(const fiber of fibers.reverse())await fiber.dispose()}
})

test('native settlement wakes job-admission holds while muted destinations remain held',async t=>{
 const state=await setup(t),fibers=[];let service,calls=0
 try{
  const services=state.ctx.plugin({name:'capacity-services',apply(ctx){ctx.effect(()=>ctx.provide('jobs',Object.assign(state.jobs,{attachController:()=>()=>{}})));ctx.effect(()=>ctx.provide('storageDomain',state.domains));ctx.effect(()=>ctx.provide('im',state.im))}});fibers.push(services);await services.await()
  const runtime=state.ctx.plugin(Plugin,Plugin.Config({enabled:true,namespace:'capacity_tasks'}));fibers.push(runtime);await runtime.await()
  const consumer=state.ctx.plugin({name:'capacity-consumer',inject:['jobDelivery'],apply(ctx){service=ctx.jobDelivery;ctx.effect(()=>ctx.jobDelivery.register({id:Plugin.providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(Plugin.outputId('reply'),[{type:'text',text:'capacity available'}])}}))}});fibers.push(consumer);await consumer.await();state.jobs.refuse=true
  const first=await service.submit(request(),signal());await until(()=>service.status().running===0&&service.status().blockedScopes===1);assert.equal(calls,0);state.jobs.refuse=false;state.jobs.emitSettled();await until(()=>service.inspect(scope(),first.id).outputs[0]?.state==='accepted');assert.equal(calls,1)
  state.setAvailability('muted');await service.submit(request('muted',scope('other-room')),signal());await until(()=>service.status().running===0&&service.status().blockedScopes===1);state.jobs.emitSettled();assert.equal(service.status().blockedScopes,1);assert.equal(calls,1)
 }finally{for(const fiber of fibers.reverse())await fiber.dispose()}
})
