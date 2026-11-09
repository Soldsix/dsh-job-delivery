/** Fair independent producer and delivery queues over native jobs and durable storage. */
import {identifier,scopeKey,sameScope,type ImRuntime,type ConversationScope,type MessagePart,type DeliveryReceipt} from 'dsh-im-kit'
import type {JobRegistry,JobOutcome} from '@deepseek-ai/dsh-jobs'
import type {DomainFacility} from '@deepseek-ai/dsh-storage-domain'
import {z} from 'zod'
import {TaskStore} from './store.ts'
import {validateConfig,type Config} from './config.ts'
import {configRevision,taskRevision} from './revision.ts'
import type {TaskId,ProviderId,OutputId,TaskRecord,TaskProducer,TaskView,DeliveryStatus,JobDeliveryService,TaskOutput,BlockReason} from './types.ts'
import {TaskError,canonical,digest,requestSchema,partsSchema,recordSchema,reservedBytes,taskIdentity,taskIdSchema,scopeSchema,outputId,persistedReceipt,view} from './wire.ts'

declare module '@deepseek-ai/dsh-jobs/view'{interface JobKindMap{/** Internal producer execution with a durable IM task identity. */'im-task':'im-task'}}
/** Native operations used by this producer; no alternate execution registry is installed. */
export type JobHost=Pick<JobRegistry,'start'|'wait'|'remove'>
interface Active{readonly controller:AbortController;readonly done:Promise<void>;readonly scope:string;readonly provider:ProviderId}
interface Registration{readonly producer:TaskProducer;closing:boolean;disposal?:Promise<void>}
const resolutionSchema=z.discriminatedUnion('state',[z.object({state:z.literal('accepted'),messageIds:z.array(z.string().min(1).max(256)).min(1).max(1000)}).strict(),z.object({state:z.literal('not-sent')}).strict()])
const transient=new Set(['offline','muted','disabled','missing-transport','unavailable','cancelled'])
function parse<T>(schema:{parse(value:unknown):T},value:unknown):T{try{return schema.parse(value)}catch(error){throw new TaskError('invalid')}}
/** No clock loop, generation retry, implicit module loading or real messaging provider is created here. */
export class DeliveryEngine implements JobDeliveryService{
 private readonly lifetime=new AbortController()
 private readonly producers=new Map<ProviderId,Registration>()
 private readonly executions=new Map<TaskId,Active>()
 private readonly deliveries=new Map<string,Active>()
 private readonly blocked=new Map<string,BlockReason>()
 private readonly observers=new Map<string,Set<()=>void>>()
 private observerCount=0
 private executionCursor=''
 private deliveryCursor=''
 private scheduled=false
 private runtimeFault:string|null=null
 private maintenance=false
 private stopping:Promise<void>|undefined
 private constructor(private readonly config:Config,private readonly store:TaskStore,private readonly jobs:JobHost,private readonly im:()=>ImRuntime|undefined){store.faultListener(()=>{this.lifetime.abort();this.observers.clear();this.observerCount=0});store.changeListener(record=>this.notify(scopeKey(record.request.scope)))}
 /** @param config - validated deployment settings. @param storage - native storage domain facility. @param jobs - native process-local job registry. @param im - current optional IM service. @returns recovered queue; interrupted work becomes uncertain before new work is accepted. */
 static async open(config:Config,storage:DomainFacility,jobs:JobHost,im:()=>ImRuntime|undefined):Promise<DeliveryEngine>{
  validateConfig(config);const store=await TaskStore.open(config,storage),engine=new DeliveryEngine(config,store,jobs,im)
  try{for(const task of store.entries())if(task.execution==='running'||task.outputs.some(output=>output.state==='sending'))await store.update(task.id,value=>({...value,updatedAt:Date.now(),execution:value.execution==='running'?(value.cancelRequested?'cancelled':'uncertain'):value.execution,failure:'interrupted',outputs:value.outputs.map(output=>output.state==='sending'?{...output,state:'uncertain',receipt:{status:'uncertain',code:'provider-error'},updatedAt:Date.now()}:output)}));engine.pump();return engine}catch(error){await store.close();throw error}
 }
 private assertOpen():void{if(this.store.fault())throw new TaskError('storage');if(this.lifetime.signal.aborted)throw new TaskError('closed')}
 private assertMutable():void{this.assertOpen();if(this.maintenance)throw new TaskError('busy')}
 /** Parsed deployment revision currently owned by this runtime. */
 get configRevision():string{return configRevision(this.config)}
 /** @returns an idempotent maintenance release; new mutations and dispatch are refused until release or disposal. */
 acquireMaintenance():()=>void{if(this.maintenance||this.executions.size||this.deliveries.size||this.store.pendingCount())throw new TaskError('busy');this.maintenance=true;let released=false;return()=>{if(released)return;released=true;this.maintenance=false;this.pump()}}
 /** @param next - prospective parsed settings. @returns validation against all retained records without changing them. */
 validateReplacement(next:Config):void{
  validateConfig(next)
  if(next.namespace!==this.config.namespace){if(this.store.count()!==0)throw new TaskError('conflict');return}
  if(this.store.fault()){const {enabled:oldEnabled,...previous}=this.config,{enabled:nextEnabled,...candidate}=next;if(canonical(previous)!==canonical(candidate))throw new TaskError('storage');return}
  const records=this.store.entries(),schema=recordSchema(next);if(records.length>next.maxTasks)throw new TaskError('capacity');let total=0
  for(const record of records){if(!schema.safeParse(record).success)throw new TaskError('invalid');const bytes=reservedBytes(record,next);if(bytes>next.maxRecordBytes)throw new TaskError('capacity');total+=bytes}if(total>next.maxRetainedBytes)throw new TaskError('capacity')
 }
 private checkRevision(record:TaskRecord,expected?:string):void{if(expected!==undefined&&taskRevision(record)!==expected)throw new TaskError('conflict')}
 private scoped(scope:unknown,id:unknown):TaskRecord{const destination=parse(scopeSchema,scope),key=parse(taskIdSchema,id),record=this.store.get(key);if(!record||!sameScope(destination,record.request.scope))throw new TaskError('not-found');return record}
 /** @param producer - installed executor. @returns disposer that prevents new starts and joins current calls. */
 register(producer:TaskProducer):()=>Promise<void>{
  this.assertMutable();if(!Number.isSafeInteger(producer.maxConcurrent)||producer.maxConcurrent<1||this.producers.has(producer.id))throw new TaskError('conflict')
  const entry:Registration={producer,closing:false};this.producers.set(producer.id,entry);this.pump()
  return()=>entry.disposal??=(async()=>{entry.closing=true;this.producers.delete(producer.id);const active=[...this.executions.values()].filter(item=>item.provider===producer.id);for(const item of active)item.controller.abort();await Promise.allSettled(active.map(item=>item.done))})()
 }
 /** @param request - complete consumer-admitted input. @param signal - admission cancellation only. @returns durable task identity before asynchronous execution. */
 async submit(request:unknown,signal:AbortSignal):Promise<{id:TaskId;replayed:boolean}>{
  this.assertMutable();if(signal.aborted)throw new TaskError('cancelled');const parsed=parse(requestSchema(this.config),request),now=Date.now(),id=taskIdentity(parsed),record:TaskRecord={version:1,id,digest:digest(canonical(parsed)),request:structuredClone(parsed),createdAt:now,updatedAt:now,execution:'queued',attempts:0,cancelRequested:false,failure:null,outputs:[]}
  const admitted=await this.store.admit(record);this.blocked.delete(scopeKey(parsed.scope));this.pump();return{id:admitted.record.id,replayed:admitted.replayed}
 }
 /** @param scope - exact authorized conversation. @param id - task identity. @returns detached retained source and outputs. */
 inspect(scope:unknown,id:unknown):TaskRecord{return structuredClone(this.scoped(scope,id))}
 /** @param scope - exact authorized conversation. @returns retained scalar task projections. */
 list(scope:unknown):readonly TaskView[]{const destination=parse(scopeSchema,scope);return this.store.entries().filter(value=>sameScope(destination,value.request.scope)).map(view).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))}
 /** @returns exact scopes without source or output bodies. */
 scopes():readonly ConversationScope[]{const distinct=new Map<string,ConversationScope>();for(const record of this.store.entries())distinct.set(scopeKey(record.request.scope),record.request.scope);return structuredClone([...distinct.values()])}
 /** @param scope - exact authorized conversation. @param listener - body-free invalidation after durability or worker cleanup; exceptions are contained. @returns idempotent subscription release; no initial event is implied. */
 subscribe(scope:unknown,listener:()=>void):()=>void{
  this.assertOpen();const key=scopeKey(parse(scopeSchema,scope));if(this.observerCount>=this.config.maxObservers)throw new TaskError('capacity')
  const listeners=this.observers.get(key)??new Set<()=>void>(),callback=()=>listener();listeners.add(callback);this.observers.set(key,listeners);this.observerCount++;let released=false
  return()=>{if(released)return;released=true;if(listeners.delete(callback)&&this.observerCount>0)this.observerCount--;if(!listeners.size&&this.observers.get(key)===listeners)this.observers.delete(key)}
 }
 private notify(scope:string):void{const listeners=this.observers.get(scope);if(!listeners)return;for(const listener of [...listeners])void Promise.resolve().then(()=>{if(!this.lifetime.signal.aborted&&this.observers.get(scope)===listeners&&listeners.has(listener))return listener()}).catch((_error:unknown)=>{/* Observer failures cannot break persistence or other subscriptions. */})}
 private activeTask(id:TaskId):readonly Active[]{const execution=this.executions.get(id);return[...execution?[execution]:[],...[...this.deliveries].filter(([key])=>key.startsWith(id+'/')).map(([,active])=>active)]}
 /** @param scope - exact authorized conversation. @param id - retained task identity. @param signal - cancellation of observation only, not computation. @returns terminal metadata after that task's workers settle; uncertain outcomes remain uncertain. */
 wait(scope:unknown,id:unknown,signal:AbortSignal):Promise<TaskView>{
  const destination=parse(scopeSchema,scope),task=parse(taskIdSchema,id)
  return new Promise<TaskView>((resolve,reject)=>{
   let finished=false,release:(()=>void)|undefined
   const cleanup=()=>{release?.();signal.removeEventListener('abort',check);this.lifetime.signal.removeEventListener('abort',check)}
   const check=()=>{if(finished)return;try{this.assertOpen();if(signal.aborted)throw new TaskError('cancelled');const value=this.scoped(destination,task);if(this.activeTask(task).length||value.execution==='queued'||value.execution==='running'||value.outputs.some(output=>output.state==='pending'||output.state==='sending'))return;finished=true;cleanup();resolve(view(value))}catch(error){finished=true;cleanup();reject(error)}}
   try{if(signal.aborted)throw new TaskError('cancelled');release=this.subscribe(destination,check);signal.addEventListener('abort',check,{once:true});this.lifetime.signal.addEventListener('abort',check,{once:true});check()}catch(error){finished=true;cleanup();reject(error)}
  })
 }
 /** @param scope - authorized conversation. @param id - task identity. @returns cleanup of the currently owned task workers, including during shutdown; no work starts or retries. */
 async join(scope:unknown,id:unknown):Promise<void>{
  const key=scopeKey(parse(scopeSchema,scope)),task=parse(taskIdSchema,id)
  for(;;){const active=this.activeTask(task);if(active.some(value=>value.scope!==key))throw new TaskError('not-found');if(!active.length)return;await Promise.allSettled(active.map(value=>value.done))}
 }
 /** @returns source-free counters. */
 status():DeliveryStatus{return{tasks:this.store.count(),running:this.executions.size,sending:this.deliveries.size,producers:this.producers.size,blockedScopes:this.blocked.size,stopping:this.lifetime.signal.aborted,fault:this.store.fault()??this.runtimeFault,imAvailable:Boolean(this.im()),maintenance:this.maintenance,pendingMutations:this.store.pendingCount()}}
 /** @param scope - optional exact conversation; omitted wakes every transient hold. */
 wake(scope?:unknown):void{this.assertMutable();this.availabilityChanged(scope)}
 /** @param scope - changed transport scope. Incoming notifications remain harmless during owner maintenance. */
 availabilityChanged(scope?:unknown):void{if(this.lifetime.signal.aborted)return;if(scope===undefined)this.blocked.clear();else this.blocked.delete(scopeKey(parse(scopeSchema,scope)));this.pump()}
 /** Native settlement can release job admission without rechecking muted or offline destinations. */
 capacityAvailable():void{if(this.lifetime.signal.aborted)return;for(const [scope,reason]of this.blocked)if(reason==='job-unavailable')this.blocked.delete(scope);this.pump()}
 private pump():void{if(this.scheduled||this.lifetime.signal.aborted||this.maintenance)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;if(!this.lifetime.signal.aborted&&!this.maintenance)this.dispatch()})}
 private choose<T extends {scope:ConversationScope}>(items:readonly T[],cursor:string):T|undefined{const scopes=[...new Set(items.map(item=>scopeKey(item.scope)))].sort(),chosen=scopes.find(key=>key>cursor)??scopes[0];return items.find(item=>scopeKey(item.scope)===chosen)}
 private dispatch():void{
  if(this.store.fault()||this.maintenance)return
  try{
   while(this.executions.size<this.config.maxConcurrentExecutions){
    const items=this.store.entries().filter(task=>task.execution==='queued'&&!task.cancelRequested&&!this.executions.has(task.id)&&!this.blocked.has(scopeKey(task.request.scope))).filter(task=>{const entry=this.producers.get(task.request.provider);return entry&&!entry.closing&&[...this.executions.values()].filter(value=>value.provider===task.request.provider).length<entry.producer.maxConcurrent&&[...this.executions.values()].filter(value=>value.scope===scopeKey(task.request.scope)).length<this.config.maxExecutionsPerScope}).map(task=>({task,scope:task.request.scope}))
    const selected=this.choose(items,this.executionCursor);if(!selected)break;const {task}=selected,entry=this.producers.get(task.request.provider);if(!entry)break;const controller=new AbortController(),scope=scopeKey(task.request.scope);this.executionCursor=scope
    const done=Promise.resolve().then(()=>this.execute(task.id,entry,controller));this.executions.set(task.id,{controller,done,scope,provider:task.request.provider});void done.then(()=>{this.executions.delete(task.id);this.notify(scope);this.pump()},()=>{this.executions.delete(task.id);this.notify(scope);this.pump()})
   }
   while(this.deliveries.size<this.config.maxConcurrentDeliveries){
    const items=this.store.entries().filter(task=>!task.cancelRequested&&!this.blocked.has(scopeKey(task.request.scope))).flatMap(task=>task.outputs.filter(output=>output.state==='pending'&&!this.deliveries.has(task.id+'/'+output.id)).map(output=>({task,output,scope:task.request.scope}))).filter(item=>[...this.deliveries.values()].filter(value=>value.scope===scopeKey(item.scope)).length<this.config.maxDeliveriesPerScope)
    const selected=this.choose(items,this.deliveryCursor);if(!selected)break;const {task,output}=selected,key=task.id+'/'+output.id,controller=new AbortController(),scope=scopeKey(task.request.scope);this.deliveryCursor=scope
    const done=Promise.resolve().then(()=>this.deliver(task.id,output.id,controller));this.deliveries.set(key,{controller,done,scope,provider:task.request.provider});void done.then(()=>{this.deliveries.delete(key);this.notify(scope);this.pump()},()=>{this.deliveries.delete(key);this.notify(scope);this.pump()})
   }
  }catch(error){this.runtimeFault='dispatch';this.lifetime.abort()}
 }
 private async available(task:TaskRecord,signal:AbortSignal):Promise<ImRuntime|undefined>{
  const im=this.im(),availability=im?await im.availability(task.request.scope,signal):'offline'
  if(availability!=='available'){this.blocked.set(scopeKey(task.request.scope),availability);return undefined}return im
 }
 private async execute(id:TaskId,entry:Registration,controller:AbortController):Promise<void>{
  const signal=AbortSignal.any([controller.signal,this.lifetime.signal,AbortSignal.timeout(this.config.executionTimeoutMs)]),initial=this.store.get(id);if(!initial)return
  try{
   if(entry.closing||!await this.available(initial,signal)||signal.aborted)return
   let started=false
   const current=await this.store.update(id,value=>{if(value.cancelRequested||value.execution!=='queued')return value;started=true;return{...value,execution:'running',attempts:value.attempts+1,updatedAt:Date.now(),failure:null}});if(!started)return
   let completion:Promise<JobOutcome>|undefined
   try{
    const job=this.jobs.start({kind:'im-task',label:'Durable task '+id,run:()=>{completion=this.compute(current,entry.producer,signal);return{cancel:()=>controller.abort(),done:completion}}})
    if(!completion)throw new TaskError('unavailable');await completion;const result=await this.jobs.wait(job,this.config.executionTimeoutMs);if(result.status==='running'||result.status==='stopping')throw new TaskError('unavailable');this.jobs.remove(job)
   }catch(error){if(!completion){this.blocked.set(scopeKey(initial.request.scope),'job-unavailable');await this.store.update(id,value=>({...value,execution:value.cancelRequested?'cancelled':'queued',attempts:value.attempts-1,updatedAt:Date.now(),failure:'job-unavailable'}))}else{this.runtimeFault='jobs';this.lifetime.abort()}}
  }catch(error){if(this.store.fault())this.lifetime.abort();else this.blocked.set(scopeKey(initial.request.scope),'job-unavailable')}
 }
 private async compute(task:TaskRecord,producer:TaskProducer,signal:AbortSignal):Promise<JobOutcome>{
  let state:TaskRecord['execution']='completed',failure:string|null=null
  try{if(signal.aborted)throw new TaskError('cancelled');await producer.run(structuredClone(task.request),{signal,checkpoint:(id,parts)=>this.checkpoint(task.id,id,parts,signal)});if(signal.aborted){state='uncertain';failure='interrupted'}}
  catch(error){state=error instanceof TaskError&&error.code==='producer-rejected'?'failed':'uncertain';failure=error instanceof TaskError?error.code:signal.aborted?'interrupted':'producer-failed'}
  try{const record=await this.store.update(task.id,value=>({...value,execution:value.cancelRequested?'cancelled':state,failure,updatedAt:Date.now()}));return{status:record.execution==='completed'?'completed':record.execution==='cancelled'?'killed':'failed',detail:record.execution}}
  catch(error){return{status:'failed',detail:'storage'}}
 }
 private async checkpoint(task:TaskId,id:OutputId,parts:readonly MessagePart[],signal:AbortSignal):Promise<void>{
  if(signal.aborted)throw new TaskError('cancelled');const identity=parse(z.string().transform(outputId),id),parsed=parse(partsSchema(this.config),parts),fingerprint=digest(canonical(parsed))
  await this.store.update(task,value=>{if(signal.aborted||value.cancelRequested||value.execution!=='running')throw new TaskError('cancelled');const existing=value.outputs.find(item=>item.id===identity);if(existing){if(existing.digest!==fingerprint)throw new TaskError('conflict');return value}if(value.outputs.length>=this.config.maxOutputsPerTask)throw new TaskError('capacity');return{...value,updatedAt:Date.now(),outputs:[...value.outputs,{id:identity,digest:fingerprint,parts:structuredClone(parsed),state:'pending',attempts:0,receipt:null,updatedAt:Date.now()}]}});this.pump()
 }
 private async deliver(id:TaskId,outputId:OutputId,controller:AbortController):Promise<void>{
  const signal=AbortSignal.any([controller.signal,this.lifetime.signal,AbortSignal.timeout(this.config.deliveryTimeoutMs)]),initial=this.store.get(id);if(!initial)return
  try{
   const im=await this.available(initial,signal);if(!im||signal.aborted)return;let selected:TaskOutput|undefined
   const task=await this.store.update(id,value=>{if(value.cancelRequested)return value;return{...value,updatedAt:Date.now(),outputs:value.outputs.map(output=>{if(output.id!==outputId||output.state!=='pending')return output;selected={...output,state:'sending',attempts:output.attempts+1,receipt:null,updatedAt:Date.now()};return selected})}});if(!selected)return
   let receipt:DeliveryReceipt
   try{receipt=persistedReceipt(this.config,await im.send({scope:task.request.scope,operationId:identifier('im.operation','durable/'+id+'/'+outputId),parts:selected.parts},signal))}catch(error){this.runtimeFault='receipt-invalid';receipt={status:'uncertain',code:'provider-error'};this.lifetime.abort()}
   await this.store.update(id,value=>({...value,updatedAt:Date.now(),outputs:value.outputs.map(output=>{if(output.id!==outputId)return output;let state:TaskOutput['state']=receipt.status==='accepted'?'accepted':receipt.status==='uncertain'?'uncertain':'failed';if(receipt.status==='failed'&&transient.has(receipt.code)){state=value.cancelRequested?'cancelled':'pending';this.blocked.set(scopeKey(task.request.scope),receipt.code==='muted'?'muted':'offline')}return{...output,state,receipt,updatedAt:Date.now()}})}))
  }catch(error){if(!this.store.fault()){this.blocked.set(scopeKey(initial.request.scope),'offline');await this.store.update(id,value=>({...value,updatedAt:Date.now(),outputs:value.outputs.map(output=>output.id===outputId&&output.state==='sending'?{...output,state:'uncertain',receipt:{status:'uncertain',code:'provider-error'},updatedAt:Date.now()}:output)}))}else this.lifetime.abort()}
 }
 /** @param scope - exact authorized conversation. @param id - task identity. @param expectedRevision - optional body-free owner observation checked during the durable transition. @returns durable cancellation before in-flight abort. */
 async cancel(scope:unknown,id:unknown,expectedRevision?:string):Promise<void>{this.assertMutable();const task=this.scoped(scope,id);await this.store.update(task.id,value=>{this.checkRevision(value,expectedRevision);return{...value,cancelRequested:true,execution:value.execution==='queued'?'cancelled':value.execution,updatedAt:Date.now(),outputs:value.outputs.map(output=>output.state==='pending'?{...output,state:'cancelled',updatedAt:Date.now()}:output)}});this.executions.get(task.id)?.controller.abort();for(const [key,item]of this.deliveries)if(key.startsWith(task.id+'/'))item.controller.abort();if(!this.store.entries().some(value=>!value.cancelRequested&&sameScope(value.request.scope,task.request.scope)&&(value.execution==='queued'||value.outputs.some(output=>output.state==='pending'))))this.blocked.delete(scopeKey(task.request.scope));this.pump()}
 /** @param scope - exact authorized conversation. @param id - task identity. @param output - uncertain output identity. @param resolution - owner-confirmed external observation. @param expectedRevision - optional owner observation checked inside the stored transition. @returns persisted decision; not-sent only requeues the retained output. */
 async resolveDelivery(scope:unknown,id:unknown,output:unknown,resolution:unknown,expectedRevision?:string):Promise<void>{
  this.assertMutable();const task=this.scoped(scope,id),identity=parse(z.string().transform(outputId),output),decision=parse(resolutionSchema,resolution);if(this.deliveries.has(task.id+'/'+identity))throw new TaskError('capacity')
  await this.store.update(task.id,value=>{this.checkRevision(value,expectedRevision);const target=value.outputs.find(item=>item.id===identity);if(!target)throw new TaskError('not-found');if(value.cancelRequested&&decision.state!=='accepted'||!['uncertain','failed'].includes(target.state))throw new TaskError('conflict');const receipt:DeliveryReceipt|null=decision.state==='accepted'?persistedReceipt(this.config,{status:'accepted',messageIds:decision.messageIds.map(item=>identifier('im.message',item))}):null;return{...value,updatedAt:Date.now(),outputs:value.outputs.map(item=>item.id===identity?{...item,state:decision.state==='accepted'?'accepted':'pending',receipt,updatedAt:Date.now()}:item)}});this.blocked.delete(scopeKey(task.request.scope));this.pump()
 }
 /** @param scope - authorized conversation. @param id - retained task. @param resolution - externally confirmed execution observation. @param expectedRevision - optional owner observation checked inside the stored transition. @returns durability before a confirmed not-started execution can run again. */
 async resolveExecution(scope:unknown,id:unknown,resolution:unknown,expectedRevision?:string):Promise<void>{
  this.assertMutable();const task=this.scoped(scope,id),decision=parse(z.object({state:z.enum(['not-started','completed','failed'])}).strict(),resolution);if(this.executions.has(task.id))throw new TaskError('capacity')
  await this.store.update(task.id,value=>{this.checkRevision(value,expectedRevision);if(value.cancelRequested||!['uncertain','failed'].includes(value.execution)||decision.state==='not-started'&&value.outputs.length>0)throw new TaskError('conflict');return{...value,execution:decision.state==='not-started'?'queued':decision.state,updatedAt:Date.now(),failure:null}});this.blocked.delete(scopeKey(task.request.scope));this.pump()
 }
 /** @returns actual producer and transport cleanup before the native domain is released. */
 close():Promise<void>{if(this.stopping)return this.stopping;this.lifetime.abort();this.observers.clear();this.observerCount=0;for(const entry of this.producers.values())entry.closing=true;return this.stopping=(async()=>{await Promise.allSettled([...this.executions.values(),...this.deliveries.values()].map(item=>item.done));await this.store.close();this.producers.clear()})()}
}
