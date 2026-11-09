/** Execution and send capacities reserve room for a complete supported receipt. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {outputId,providerId} from '../dist/wire.js'
import {setup,request,scope,signal,until} from './helpers.mjs'
test('insufficient output and receipt room refuses the output before any external send',async t=>{
 const state=await setup(t,{maxRecordBytes:2048,maxPayloadBytes:128,maxReceiptBytes:512,maxRetainedBytes:8192});state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:'x'.repeat(1100)}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),id).execution==='uncertain');assert.equal(state.sent.length,0);assert.equal(state.engine.inspect(scope(),id).outputs.length,0);assert.equal(state.engine.inspect(scope(),id).failure,'capacity')
})
test('supported receipts persist intact and a terminal receipt releases its reserved capacity',async t=>{
 const state=await setup(t,{maxRecordBytes:4096,maxPayloadBytes:128,maxReceiptBytes:512,maxRetainedBytes:4096});let sends=0;state.setSend(async()=>{sends++;return{status:'accepted',messageIds:['r'.repeat(200)]}});state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:'short'}])}})
 const first=await state.engine.submit(request(),signal());await until(()=>state.engine.inspect(scope(),first.id).outputs[0]?.state==='accepted');const second=await state.engine.submit(request('second'),signal());await until(()=>state.engine.inspect(scope(),second.id).outputs[0]?.state==='accepted');assert.equal(sends,2);assert.equal(state.engine.inspect(scope(),first.id).outputs[0].receipt.messageIds[0].length,200);await state.reopen();assert.equal(state.engine.inspect(scope(),second.id).outputs[0].state,'accepted')
})
test('an oversized transport result faults visibly and remains uncertain without replay',async t=>{
 const state=await setup(t,{maxReceiptBytes:256});let sends=0;state.setSend(async()=>{sends++;return{status:'accepted',messageIds:['r'.repeat(240)]}});state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:'ready'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().sending===0&&state.engine.status().fault==='receipt-invalid');assert.equal(state.engine.inspect(scope(),id).outputs[0].state,'uncertain');assert.equal(sends,1);await state.reopen();state.engine.wake();assert.equal(sends,1)
})
test('retained source capacity rejects new work without evicting earlier records',async t=>{
 const state=await setup(t,{maxTasks:2});const a=await state.engine.submit(request('a'),signal()),b=await state.engine.submit(request('b'),signal());await assert.rejects(state.engine.submit(request('c'),signal()),error=>error.code==='capacity');assert.equal(state.engine.list(scope()).length,2);assert.equal(state.engine.inspect(scope(),a.id).request.operationId,'a');assert.equal(state.engine.inspect(scope(),b.id).request.operationId,'b')
})
