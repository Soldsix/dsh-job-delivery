/** Owner-only native controls remain mounted while execution is disabled. */
import type {Context} from '@deepseek-ai/cordis'
import type {Entry} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from './index.ts'
import z from '@deepseek-ai/schemastery'
import {Remote,RemoteError,TypertRemoteService,principalOf} from '@deepseek-ai/dsh-typert-protocol'
import {Config as RuntimeConfig,validateConfig,type Config as RuntimeSettings} from './config.ts'
import {DeliveryEngine} from './engine.ts'
import {TaskStore} from './store.ts'
import {FIELDS} from './fields.ts'
import {configRevision,taskRevision} from './revision.ts'
import {TaskError,view} from './wire.ts'
import {saveSchema,revisionSchema,listSchema,selectionSchema,editSchema,decisionSchema,wakeSchema} from './control-codecs.ts'
import type {Snapshot,Catalog,TaskPage,Detail,Failure} from './control-types.ts'
/** Explicit UI polling and metadata response limits. */
export interface ControlConfig{targetEntryId:string;statusRefreshMs:number;pageSize:number;maxScopeOptions:number;maxOutputPreviews:number;maxPreviewMessageIds:number}
/** Runtime and owner-page bounds have independent lifetimes. */
export const Config:z<ControlConfig>=z.object({targetEntryId:z.string().default('job-delivery'),statusRefreshMs:z.number().min(250).max(60000).step(1).default(3000),pageSize:z.number().min(1).max(500).step(1).default(50),maxScopeOptions:z.number().min(1).max(100000).step(1).default(1000),maxOutputPreviews:z.number().min(1).max(1000).step(1).default(100),maxPreviewMessageIds:z.number().min(1).max(1000).step(1).default(20)})
declare module '@deepseek-ai/cordis'{interface Context{readonly jobDeliveryControl:DeliveryControl}}
const fail=(reason:Failure)=>new RemoteError('job-delivery/control','Task management operation could not complete',{reason})
function parsed(value:unknown):RuntimeSettings{try{if(typeof value!=='object'||!value||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(FIELDS,key)))throw fail('invalid');return validateConfig(z.resolve(value,RuntimeConfig,{})[0])}catch(error){throw fail('invalid')}}
function decode<T>(schema:{parse(value:unknown):T},value:unknown):T{try{return schema.parse(value)}catch(error){throw fail('invalid')}}
function safe(error:unknown):never{if(error instanceof RemoteError){if(error.code==='job-delivery/control')throw fail(error.details.reason);throw fail('unavailable')};if(error instanceof TaskError){const code=error.code;throw fail(code==='capacity'||code==='storage'||code==='conflict'||code==='busy'||code==='invalid'||code==='not-found'?code:'unavailable')}throw fail('unavailable')}
/** Every Remote is independently owner-gated; task sources are never returned. */
export class DeliveryControl extends TypertRemoteService{
 static inject=['configEditor','storageDomain']
 static Config=Config
 private readonly lifetime=new AbortController()
 private tail:Promise<void>=Promise.resolve()
 constructor(ctx:Context,private readonly config:ControlConfig){super(ctx,'jobDeliveryControl');if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(config.targetEntryId))throw new Error('Invalid task entry');ctx.effect(()=>async()=>{this.lifetime.abort();await this.tail})}
 private owner():AbortSignal|undefined{if(principalOf(this.ctx.invocation))throw fail('forbidden');const signal=this.ctx.invocation?.signal;if(this.lifetime.signal.aborted||signal?.aborted)throw fail('cancelled');return signal}
 private serial<T>(operation:()=>Promise<T>):Promise<T>{const signal=this.owner(),task=this.tail.then(async()=>{if(this.lifetime.signal.aborted||signal?.aborted)throw fail('cancelled');try{return await operation()}catch(error){safe(error)}});this.tail=task.then(()=>{},()=>{});return task}
 private target():Entry{const all=this.ctx.configEditor.entries(),entry=all.find(value=>value.options.id===this.config.targetEntryId);if(!entry||entry.options.name!=='dsh-job-delivery'||all.some(value=>value!==entry&&value.options.name==='dsh-job-delivery'))throw fail('unavailable');return entry}
 private engine():DeliveryEngine{const entry=this.target(),settings=parsed(entry.fiber?.effectiveConfig??entry.options.config),engine=this.ctx.get('jobDelivery');if(!(engine instanceof DeliveryEngine)||entry.disabled||!settings.enabled||entry.fiber?.state!==2||engine.configRevision!==configRevision(settings))throw fail('unavailable');return engine}
 private snapshot():Snapshot{const entry=this.target(),config=parsed(entry.fiber?.effectiveConfig??entry.options.config),engine=this.ctx.get('jobDelivery'),runtime=engine instanceof DeliveryEngine?engine:undefined,status=runtime?.status()??null,revision=configRevision(config);return{config,revision,appliedRevision:runtime?.configRevision??null,active:config.enabled&&!entry.disabled&&entry.fiber?.state===2&&runtime?.configRevision===revision&&!status?.stopping,entryDisabled:entry.disabled,refreshMs:this.config.statusRefreshMs,status}}
 /** @returns settings and body-free runtime counters. */
 @Remote
 describe():Promise<Snapshot>{return this.serial(async()=>this.snapshot())}
 private async replace(revision:string,patch:Partial<RuntimeSettings>,restart:boolean):Promise<Snapshot>{
  const entry=this.target(),current=parsed(entry.fiber?.effectiveConfig??entry.options.config);if(configRevision(current)!==revision)throw fail('conflict');const next=parsed({...current,...patch}),service=this.ctx.get('jobDelivery'),engine=service instanceof DeliveryEngine?service:undefined,release=engine?.acquireMaintenance();let conflict=false
  try{
   if(engine)engine.validateReplacement(next);else{const store=await TaskStore.open(next,this.ctx.storageDomain);await store.close()}
   if(restart){if(this.target()!==entry||configRevision(parsed(entry.fiber?.effectiveConfig??entry.options.config))!==revision)throw fail('conflict');if(!entry.fiber)throw fail('unavailable');await entry.fiber.restart()}
   else await this.ctx.configEditor.edit(entry,raw=>{if(configRevision(parsed(entry.fiber?.effectiveConfig??entry.options.config))!==revision){conflict=true;throw fail('conflict')}return{...raw,...patch}})
  }catch(error){if(error instanceof TaskError||error instanceof RemoteError&&error.code==='job-delivery/control')throw error;throw fail(conflict?'conflict':'apply-failed')}finally{release?.()}
  return this.snapshot()
 }
 /** @param request - expected settings revision and validated fields. @returns saved and applied state after an idle reload. */
 @Remote
 save(request:unknown):Promise<Snapshot>{this.owner();const edit=decode(saveSchema,request);return this.serial(()=>this.replace(edit.revision,edit.patch,false))}
 /** @param request - observed settings revision. @returns runtime state after an explicit idle restart; retained records are preserved. */
 @Remote
 restart(request:unknown):Promise<Snapshot>{this.owner();const edit=decode(revisionSchema,request);return this.serial(()=>this.replace(edit.revision,{},true))}
 /** @returns exact retained scope identities, with an explicit omitted count. */
 @Remote
 scopes():Promise<Catalog>{return this.serial(async()=>{const all=this.engine().scopes();return{scopes:all.slice(0,this.config.maxScopeOptions),omitted:Math.max(0,all.length-this.config.maxScopeOptions)}})}
 /** @param request - exact conversation and page offset. @returns bounded scalar task rows. */
 @Remote
 list(request:unknown):Promise<TaskPage>{this.owner();const value=decode(listSchema,request);return this.serial(async()=>{const all=[...this.engine().list(value.scope)].reverse(),end=value.offset+this.config.pageSize;return{tasks:all.slice(value.offset,end),total:all.length,offset:value.offset,nextOffset:end<all.length?end:null}})}
 /** @param request - exact scoped task. @returns safe revision and output metadata; bodies are omitted. */
 @Remote
 inspect(request:unknown):Promise<Detail>{this.owner();const value=decode(selectionSchema,request);return this.serial(async()=>{const record=this.engine().inspect(value.scope,value.id);return{task:view(record),revision:taskRevision(record),outputs:record.outputs.slice(0,this.config.maxOutputPreviews).map(output=>{const ids=output.receipt?.status==='accepted'?output.receipt.messageIds:[];return{id:output.id,state:output.state,attempts:output.attempts,digest:output.digest,partTypes:[...new Set(output.parts.map(part=>part.type))],messageIds:ids.slice(0,this.config.maxPreviewMessageIds),omittedMessageIds:Math.max(0,ids.length-this.config.maxPreviewMessageIds)}}),omittedOutputs:Math.max(0,record.outputs.length-this.config.maxOutputPreviews)}})}
 /** @param request - exact task with its observed revision. @returns metadata after the durable stop request. */
 @Remote
 async cancel(request:unknown):Promise<void>{this.owner();const value=decode(editSchema,request);return this.serial(async()=>{await this.engine().cancel(value.scope,value.id,value.revision)})}
 /** @param request - confirmed external outcome and current task revision. @returns durability before any explicitly requeued saved output can send. */
 @Remote
 reconcile(request:unknown):Promise<void>{this.owner();const value=decode(decisionSchema,request);return this.serial(async()=>{const engine=this.engine();if(value.kind==='execution')await engine.resolveExecution(value.scope,value.id,{state:value.state},value.revision);else await engine.resolveDelivery(value.scope,value.id,value.outputId,value.state==='accepted'?{state:'accepted',messageIds:value.messageIds}:{state:'not-sent'},value.revision)})}
 /** @param request - exact destination whose transport availability changed. @returns completion after transient holds are released. */
 @Remote
 wake(request:unknown):Promise<void>{this.owner();const value=decode(wakeSchema,request);return this.serial(async()=>{this.engine().wake(value.scope)})}
}
export default DeliveryControl
