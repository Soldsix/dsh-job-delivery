/** Durable source admission, fair producers, independent scopes and partial originals. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {outputId,providerId,TaskError,canonical,taskIdentity} from '../dist/wire.js'
import {setup,request,scope,signal,until,deferred} from './helpers.mjs'

test('scoped source replay preserves exact input and cannot conflict or read another conversation',async t=>{
 const state=await setup(t),source=request('source',scope(),{text:' original\n\rline ',nested:{b:2,a:1}}),first=await state.engine.submit(source,signal());assert.equal(first.replayed,false)
 const reversed={payload:{nested:{a:1,b:2},text:' original\n\rline '},provider:source.provider,operationId:source.operationId,actorId:source.actorId,scope:source.scope};assert.deepEqual(await state.engine.submit(reversed,signal()),{id:first.id,replayed:true});assert.deepEqual(state.engine.inspect(scope(),first.id).request,source)
 await assert.rejects(state.engine.submit({...source,payload:{text:'changed'}},signal()),error=>error.code==='conflict');assert.throws(()=>state.engine.inspect(scope('group-a','private'),first.id),error=>error.code==='not-found');assert.throws(()=>state.engine.inspect(scope('group-b'),first.id),error=>error.code==='not-found')
 assert.notEqual((await state.engine.submit(request('source',scope('group-a','private')),signal())).id,first.id);const cancelled=new AbortController();cancelled.abort();await assert.rejects(state.engine.submit(request('cancelled'),cancelled.signal),error=>error.code==='cancelled');assert.equal(state.engine.status().tasks,2)
 const release=state.engine.register({id:providerId('fixture'),maxConcurrent:2,async run(input,context){await context.checkpoint(outputId('result'),[{type:'text',text:input.payload.text??'private fixture'}])}});await until(()=>state.sent.length===2);await release();assert.ok(state.jobs.seen.every(value=>!value.label.includes('original')));assert.equal(state.jobs.records.size,0)
 const held=state.engine.inspect(scope(),first.id);held.request.payload.text='outside mutation';assert.equal(state.engine.inspect(scope(),first.id).request.payload.text,' original\n\rline ')
})

test('producer and output replay are independent and never regenerate an already completed task',async t=>{
 const state=await setup(t);let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;const parts=[{type:'text',text:'exact output\nnext'},{type:'image',attachmentId:'synthetic-stored-reference'}];await context.checkpoint(outputId('first'),parts);await context.checkpoint(outputId('first'),parts)}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.sent.length===1&&state.engine.inspect(scope(),id).execution==='completed');await state.reopen();await state.engine.submit(request(),signal());state.engine.wake();await until(()=>state.engine.status().running===0&&state.engine.status().sending===0);assert.equal(calls,1);assert.equal(state.sent.length,1);assert.equal(state.engine.inspect(scope(),id).outputs[0].state,'accepted')
})

test('one busy group cannot take a second group slot or block direct text dispatch',async t=>{
 const state=await setup(t,{maxConcurrentExecutions:2,maxExecutionsPerScope:1}),arrivals=[],gates=new Map()
 for(let i=0;i<12;i++)await state.engine.submit(request('a-'+i,scope('group-a')),signal());await state.engine.submit(request('b',scope('group-b')),signal());await state.engine.submit(request('c',scope('group-c')),signal())
 state.engine.register({id:providerId('fixture'),maxConcurrent:2,async run(input,context){arrivals.push(input.scope.peerId);const gate=deferred();gates.set(input.scope.peerId,gate);await gate.promise;if(!context.signal.aborted)await context.checkpoint(outputId('result'),[{type:'text',text:'ready'}])}})
 await until(()=>arrivals.length===2);assert.deepEqual(new Set(arrivals),new Set(['group-a','group-b']));let normal=0;const unsubscribe=state.im.subscribe(()=>{normal++},()=>true);await state.im.publish({scope:scope(),messageId:'ordinary-chat',senderId:'actor',sentAt:0,receivedAt:0,parts:[{type:'text',text:'ordinary message'}],directedToBot:true});assert.equal(normal,1);await unsubscribe()
 gates.get('group-a').resolve();await until(()=>arrivals.length===3);assert.equal(arrivals[2],'group-c');for(const gate of gates.values())gate.resolve();for(const destination of ['group-a','group-b','group-c'])for(const item of state.engine.list(scope(destination)))await state.engine.cancel(scope(destination),item.id);for(const gate of gates.values())gate.resolve();await until(()=>state.engine.status().running===0)
})

test('muted and offline destinations spend no producer work and wake without regenerating source',async t=>{
 const state=await setup(t);state.setAvailability('muted');let calls=0;state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input,context){calls++;await context.checkpoint(outputId('result'),[{type:'text',text:'new output'}])}})
 const {id}=await state.engine.submit(request(),signal());await until(()=>state.engine.status().blockedScopes===1&&state.engine.status().running===0);assert.equal(calls,0);assert.equal(state.jobs.seen.length,0);assert.equal(state.engine.inspect(scope(),id).execution,'queued')
 state.setAvailability('available');state.engine.wake(scope());await until(()=>state.sent.length===1);assert.equal(calls,1);assert.equal(state.engine.inspect(scope(),id).attempts,1)
})

test('partial outputs survive producer failure and late output calls cannot alter a cancelled task',async t=>{
 const state=await setup(t),started=deferred(),finish=deferred();let lateError
 state.engine.register({id:providerId('fixture'),maxConcurrent:2,async run(input,context){await context.checkpoint(outputId('first'),[{type:'text',text:'first ready'}]);if(input.operationId==='cancel'){started.resolve();await finish.promise;try{await context.checkpoint(outputId('late'),[{type:'text',text:'must not appear'}])}catch(error){lateError=error.code}}else throw Error('PRIVATE_FIXTURE_PROVIDER_DETAIL')}})
 const failed=await state.engine.submit(request('fail'),signal());await until(()=>state.engine.inspect(scope(),failed.id).execution==='uncertain'&&state.sent.length===1);assert.equal(state.engine.inspect(scope(),failed.id).outputs.length,1);assert.ok(!JSON.stringify(state.engine.inspect(scope(),failed.id)).includes('PRIVATE_FIXTURE_PROVIDER_DETAIL'))
 const cancelled=await state.engine.submit(request('cancel',scope('group-b')),signal());await started.promise;await state.engine.cancel(scope('group-b'),cancelled.id);finish.resolve();await until(()=>state.engine.inspect(scope('group-b'),cancelled.id).execution==='cancelled');assert.equal(lateError,'cancelled');assert.equal(state.engine.inspect(scope('group-b'),cancelled.id).outputs.length,1)
})

test('definitive producer rejection and unclassified exceptions have different recoverable states',async t=>{
 const state=await setup(t);state.engine.register({id:providerId('fixture'),maxConcurrent:1,async run(input){if(input.payload.reject)throw new TaskError('producer-rejected');throw Error('synthetic unknown request outcome')}})
 const a=await state.engine.submit(request('reject',scope(),{reject:true}),signal()),b=await state.engine.submit(request('unknown',scope('group-b'),{}),signal());await until(()=>state.engine.status().running===0&&state.engine.inspect(scope(),a.id).execution==='failed'&&state.engine.inspect(scope('group-b'),b.id).execution==='uncertain');state.engine.wake();assert.equal(state.engine.inspect(scope(),a.id).attempts,1);assert.equal(state.engine.inspect(scope('group-b'),b.id).attempts,1)
 assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));assert.notEqual(taskIdentity(request('id',scope())),taskIdentity(request('id',scope('group-a','private'))))
})
