/** Native DSH domain persistence; every mutation resolves after the backend accepts it. */
import {defineDomain,domainTable,type DomainFacility,type Domain,type KvTable} from '@deepseek-ai/dsh-storage-domain'
import type {Config} from './config.ts'
import {recordSchema,reservedBytes,TaskError} from './wire.ts'
import type {TaskId,TaskRecord} from './types.ts'
function definition(config:Config){return defineDomain({name:config.namespace,version:1,layout:'single' as const,tables:{tasks:domainTable<TaskId,TaskRecord>(recordSchema(config))}})}
type TaskDomain=Domain<ReturnType<typeof definition>>
/** One exclusive domain and bounded mutation admission, without a second storage backend. */
export class TaskStore{
 private tail:Promise<void>=Promise.resolve()
 private pending=0
 private stopping:Promise<void>|undefined
 private failure:string|null=null
 private retainedBytes=0
 private readonly recordBytes=new Map<TaskId,number>()
 private onFault:(()=>void)|undefined
 private readonly table:KvTable<TaskId,TaskRecord>
 private constructor(private readonly config:Config,private readonly domain:TaskDomain){this.table=domain.table('tasks')}
 /** @param config - validated capacities and domain name. @param facility - native storage provider. @returns opened authoritative records; invalid data is never skipped or repaired. */
 static async open(config:Config,facility:DomainFacility):Promise<TaskStore>{
  const domain=await facility.open(definition(config)).catch((_error:unknown)=>{throw new TaskError('storage')}),store=new TaskStore(config,domain)
  try{if(store.table.size>config.maxTasks)throw new TaskError('capacity');for(const [key,record]of store.table.entries()){if(key!==record.id)throw new TaskError('invalid');const bytes=reservedBytes(record,config);if(bytes>config.maxRecordBytes)throw new TaskError('capacity');store.recordBytes.set(key,bytes);store.retainedBytes+=bytes}if(store.retainedBytes>config.maxRetainedBytes)throw new TaskError('capacity');return store}catch(error){await domain.close();throw error instanceof TaskError?error:new TaskError('storage')}
 }
 /** @param listener - runtime cancellation on storage failure. */
 faultListener(listener:()=>void):void{this.onFault=listener}
 /** @returns safe storage fault, if any. */
 fault():string|null{return this.failure}
 /** @returns the current count, or null when the native domain is quarantined. */
 count():number|null{if(this.failure)return null;try{return this.table.size}catch(error){this.poison();return null}}
 /** @returns admitted mutation count. */
 pendingCount():number{return this.pending}
 /** @returns immutable retained snapshots; caller must not mutate their records. */
 entries():readonly TaskRecord[]{try{return[...this.table.entries()].map(([,record])=>record)}catch(error){throw this.poison()}}
 /** @param id - exact retained identity. @returns current immutable record, when present. */
 get(id:TaskId):TaskRecord|undefined{try{return this.table.get(id)}catch(error){throw this.poison()}}
 private poison():TaskError{this.failure='storage';this.onFault?.();return new TaskError('storage')}
 private serial<T>(operation:()=>Promise<T>):Promise<T>{
  if(this.stopping)return Promise.reject(new TaskError('closed'));if(this.failure)return Promise.reject(new TaskError('storage'));if(this.pending>=this.config.maxPendingMutations)return Promise.reject(new TaskError('capacity'));this.pending++
  const done=this.tail.then(()=>{if(this.failure)throw new TaskError('storage');return operation()});this.tail=done.then(()=>{this.pending--},()=>{this.pending--});return done
 }
 private async put(value:TaskRecord):Promise<void>{
  const bytes=reservedBytes(value,this.config),next=this.retainedBytes-(this.recordBytes.get(value.id)??0)+bytes
  if(bytes>this.config.maxRecordBytes||next>this.config.maxRetainedBytes)throw new TaskError('capacity')
  try{await this.table.put(value.id,value)}catch(error){throw this.poison()}
  this.recordBytes.set(value.id,bytes);this.retainedBytes=next
 }
 /** @param value - complete new durable input. @returns existing identical operation, or persistence of this new record. */
 admit(value:TaskRecord):Promise<{record:TaskRecord;replayed:boolean}>{return this.serial(async()=>{const existing=this.get(value.id);if(existing){if(existing.digest!==value.digest)throw new TaskError('conflict');return{record:existing,replayed:true}}if(this.table.size>=this.config.maxTasks)throw new TaskError('capacity');await this.put(value);return{record:value,replayed:false}})}
 /** @param id - retained identity. @param transform - pure synchronous transition. @returns persisted next record. */
 update(id:TaskId,transform:(record:TaskRecord)=>TaskRecord):Promise<TaskRecord>{return this.serial(async()=>{const current=this.get(id);if(!current)throw new TaskError('not-found');const next=transform(current);if(next===current)return current;await this.put(next);return next})}
 /** @returns completion after admitted mutations and native unit release. */
 close():Promise<void>{return this.stopping??=(async()=>{await this.tail;await this.domain.close()})()}
}
