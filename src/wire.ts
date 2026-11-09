/** Validation of queued requests, retained records and operator reconciliation. */
import {createHash} from 'node:crypto'
import {brandString} from '@deepseek-ai/dsh-brand'
import {identifier,scopeKey,type ConversationScope,type MessagePart,type DeliveryReceipt} from 'dsh-im-kit'
import {z} from 'zod'
import type {Config} from './config.ts'
import type {TaskId,ProviderId,OutputId,TaskRequest,TaskRecord,TaskOutput,TaskView} from './types.ts'
/** Safe failures never contain a provider exception, input or backend location. */
export type TaskFailure='invalid'|'capacity'|'conflict'|'not-found'|'closed'|'cancelled'|'storage'|'producer-failed'|'producer-rejected'|'timeout'|'unavailable'
/** Classified local error; provider-rejected certifies a definitive refusal before external work. */
export class TaskError extends Error{constructor(readonly code:TaskFailure){super('Task operation could not complete: '+code);this.name='TaskError'}}
const short=z.string().min(1).max(256),name=z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)
/** @param value - installed provider name. @returns branded executor identity. */
export function providerId(value:string):ProviderId{return brandString<ProviderId>(name.parse(value))}
/** @param value - producer checkpoint name. @returns branded output identity. */
export function outputId(value:string):OutputId{return brandString<OutputId>(name.parse(value))}
/** Wire scope includes the full account and privacy kind. */
export const scopeSchema:z.ZodType<ConversationScope>=z.object({account:z.object({tenantId:short.transform(v=>identifier('im.tenant',v)),networkId:short.transform(v=>identifier('im.network',v)),accountId:short.transform(v=>identifier('im.account',v))}).strict(),kind:z.enum(['group','private']),peerId:short.transform(v=>identifier('im.peer',v))}).strict()
/** Record identity is a scoped operation hash, never a path supplied by a caller. */
export const taskIdSchema=z.string().regex(/^task-[a-f0-9]{64}$/).transform(v=>brandString<TaskId>(v))
/** @param value - safe JSON data. @returns deterministic comparison text while preserving strings and array order. */
export function canonical(value:unknown):string{if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(typeof value!=='object')throw new TaskError('invalid');return'{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}'}
/** @param value - UTF-8 comparison text. @returns complete SHA256. */
export function digest(value:string):string{return createHash('sha256').update(value).digest('hex')}
/** @param request - validated retained operation. @returns stable identity independent of payload. */
export function taskIdentity(request:TaskRequest):TaskId{return brandString<TaskId>('task-'+digest(JSON.stringify([scopeKey(request.scope),request.operationId])))}
/** @param config - record capacities. @returns strict request decoder. */
export function requestSchema(config:Config):z.ZodType<TaskRequest>{return z.object({scope:scopeSchema,actorId:short.transform(v=>identifier('im.user',v)),operationId:short.transform(v=>identifier('im.operation',v)),provider:name.transform(providerId),payload:z.json().refine(value=>Buffer.byteLength(JSON.stringify(value))<=config.maxPayloadBytes)}).strict()}
/** @param config - output capacities. @returns original structured part decoder without rewriting strings. */
export function partsSchema(config:Config):z.ZodType<readonly MessagePart[]>{return z.array(z.discriminatedUnion('type',[
 z.object({type:z.literal('text'),text:z.string().max(config.maxTextChars)}).strict(),z.object({type:z.literal('mention'),userId:short.transform(v=>identifier('im.user',v))}).strict(),z.object({type:z.literal('reply'),messageId:short.transform(v=>identifier('im.message',v))}).strict(),
 z.object({type:z.literal('image'),attachmentId:short.transform(v=>identifier('im.attachment',v))}).strict(),z.object({type:z.literal('audio'),attachmentId:short.transform(v=>identifier('im.attachment',v))}).strict(),z.object({type:z.literal('video'),attachmentId:short.transform(v=>identifier('im.attachment',v))}).strict(),z.object({type:z.literal('file'),attachmentId:short.transform(v=>identifier('im.attachment',v)),name:short}).strict(),z.object({type:z.literal('forward'),resourceId:short.transform(v=>identifier('im.forward',v))}).strict(),z.object({type:z.literal('card'),format:z.enum(['json','xml']),content:z.string().max(config.maxTextChars)}).strict(),z.object({type:z.literal('unsupported'),segmentType:short}).strict()
 ])).min(1).max(config.maxPartsPerOutput)}
const receiptSchema:z.ZodType<DeliveryReceipt>=z.discriminatedUnion('status',[z.object({status:z.literal('accepted'),messageIds:z.array(short.transform(v=>identifier('im.message',v))).max(1000)}).strict(),z.object({status:z.literal('failed'),code:z.enum(['offline','muted','disabled','cancelled','missing-transport','unavailable','rejected','permission-denied'])}).strict(),z.object({status:z.literal('uncertain'),code:z.enum(['timeout','cancelled-after-dispatch','provider-error'])}).strict()])
/** @param config - explicit supported receipt capacity. @param value - complete transport result at the persistence boundary. @returns detached receipt, or a safe failure before recording acceptance. */
export function persistedReceipt(config:Config,value:unknown):DeliveryReceipt{const parsed=receiptSchema.safeParse(value);if(!parsed.success||Buffer.byteLength(JSON.stringify(value))>config.maxReceiptBytes)throw new TaskError('invalid');return parsed.data}
/** @param record - candidate durable transition. @param config - record and receipt capacities. @returns reserved bytes for complete supported receipts and terminal metadata. */
export function reservedBytes(record:TaskRecord,config:Config):number{
 const mutable=(output:TaskOutput)=>output.state==='sending'||!record.cancelRequested&&!['accepted','cancelled'].includes(output.state),reserved=record.outputs.filter(mutable).length
 const worst={...record,execution:'uncertain',attempts:Number.MAX_SAFE_INTEGER,cancelRequested:false,failure:'x'.repeat(80),updatedAt:Number.MAX_SAFE_INTEGER,outputs:record.outputs.map(output=>({...output,state:'uncertain',attempts:Number.MAX_SAFE_INTEGER,receipt:mutable(output)?null:output.receipt,updatedAt:Number.MAX_SAFE_INTEGER}))}
 return Buffer.byteLength(JSON.stringify(worst))+reserved*(config.maxReceiptBytes-4)
}
function validOutput(value:TaskOutput,config:Config):boolean{
 const receipt=value.receipt
 if(receipt&&Buffer.byteLength(JSON.stringify(receipt))>config.maxReceiptBytes)return false
 switch(value.state){
  case'accepted':return receipt?.status==='accepted'&&value.attempts>0
  case'uncertain':return receipt?.status==='uncertain'&&value.attempts>0
  case'failed':return receipt?.status==='failed'&&value.attempts>0
  case'sending':return receipt===null&&value.attempts>0
  case'pending':return receipt===null||receipt.status==='failed'&&['offline','muted','disabled','missing-transport','unavailable','cancelled'].includes(receipt.code)
  case'cancelled':return receipt===null||receipt.status==='failed'
 }
}
/** @param config - operator limits applied to restored authoritative records. @returns strict record decoder. */
export function recordSchema(config:Config):z.ZodType<TaskRecord>{
 const output:z.ZodType<TaskOutput>=z.object({id:name.transform(outputId),digest:z.string().regex(/^[a-f0-9]{64}$/),parts:partsSchema(config),state:z.enum(['pending','sending','accepted','failed','uncertain','cancelled']),attempts:z.number().int().nonnegative(),receipt:receiptSchema.nullable(),updatedAt:z.number().int().nonnegative()}).strict().superRefine((value,ctx)=>{if(digest(canonical(value.parts))!==value.digest)ctx.addIssue({code:'custom',message:'Output fingerprint differs'});if(!validOutput(value,config))ctx.addIssue({code:'custom',message:'Receipt classification differs'})})
 return z.object({version:z.literal(1),id:taskIdSchema,digest:z.string().regex(/^[a-f0-9]{64}$/),request:requestSchema(config),createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),execution:z.enum(['queued','running','completed','failed','uncertain','cancelled']),attempts:z.number().int().nonnegative(),cancelRequested:z.boolean(),failure:z.string().max(80).nullable(),outputs:z.array(output).max(config.maxOutputsPerTask)}).strict().superRefine((value,ctx)=>{if(value.id!==taskIdentity(value.request)||value.digest!==digest(canonical(value.request)))ctx.addIssue({code:'custom',message:'Task fingerprint differs'});if(new Set(value.outputs.map(item=>item.id)).size!==value.outputs.length)ctx.addIssue({code:'custom',message:'Duplicate output identity'});if(Buffer.byteLength(JSON.stringify(value))>config.maxRecordBytes)ctx.addIssue({code:'custom',message:'Record capacity exceeded'})})
}
/** @param value - durable record. @returns detached owner-visible scalar metadata. */
export function view(value:TaskRecord):TaskView{const outputCounts={pending:0,sending:0,accepted:0,failed:0,uncertain:0,cancelled:0};for(const output of value.outputs)outputCounts[output.state]++;return{id:value.id,provider:value.request.provider,scope:structuredClone(value.request.scope),createdAt:value.createdAt,updatedAt:value.updatedAt,execution:value.execution,attempts:value.attempts,cancelRequested:value.cancelRequested,outputCounts,failure:value.failure}}
