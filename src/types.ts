/** Durable producer and delivery vocabulary; request authority belongs to trusted Host consumers. */
import type {Branded} from '@deepseek-ai/dsh-brand'
import type {ConversationScope,MessagePart,DeliveryReceipt,Availability,OperationId,UserId} from 'dsh-im-kit'
import type {z} from 'zod'
/** Stable record identity derived from the complete scoped operation. */
export type TaskId=Branded<'job-delivery.task'>
/** Installed executor registration identity. */
export type ProviderId=Branded<'job-delivery.provider'>
/** Producer-chosen output identity, unique inside one task. */
export type OutputId=Branded<'job-delivery.output'>
/** JSON input preserved before an executor starts. */
export type JsonValue=z.infer<ReturnType<typeof z.json>>
/** Complete immutable input; replay identity includes account, privacy scope and operation. */
export interface TaskRequest{readonly scope:ConversationScope;readonly actorId:UserId;readonly operationId:OperationId;readonly provider:ProviderId;readonly payload:JsonValue}
/** Computation and delivery have independent terminal states. */
export type ExecutionState='queued'|'running'|'completed'|'failed'|'uncertain'|'cancelled'
/** Unknown delivery is never automatically retried. */
export type OutputState='pending'|'sending'|'accepted'|'failed'|'uncertain'|'cancelled'
/** Durable output and its latest server-acceptance classification. */
export interface TaskOutput{readonly id:OutputId;readonly digest:string;readonly parts:readonly MessagePart[];readonly state:OutputState;readonly attempts:number;readonly receipt:DeliveryReceipt|null;readonly updatedAt:number}
/** Authoritative record; no model reasoning or backend credentials are added. */
export interface TaskRecord{readonly version:1;readonly id:TaskId;readonly digest:string;readonly request:TaskRequest;readonly createdAt:number;readonly updatedAt:number;readonly execution:ExecutionState;readonly attempts:number;readonly cancelRequested:boolean;readonly failure:string|null;readonly outputs:readonly TaskOutput[]}
/** Scalar metadata suitable for owner pages and the native job roster. */
export interface TaskView{readonly id:TaskId;readonly provider:ProviderId;readonly actorId:UserId;readonly scope:ConversationScope;readonly createdAt:number;readonly updatedAt:number;readonly execution:ExecutionState;readonly attempts:number;readonly cancelRequested:boolean;readonly outputCounts:Readonly<Record<OutputState,number>>;readonly failure:string|null}
/** A producer must checkpoint each ready output before reporting completion. */
export interface ProducerContext{readonly signal:AbortSignal;/** @param id - stable producer output identity. @param parts - complete output message; original media must already be durably stored. @returns persistence before delivery becomes eligible. */checkpoint(id:OutputId,parts:readonly MessagePart[]):Promise<void>}
/** Executors must settle after abort; unloading waits for their actual cleanup. */
export interface TaskProducer{readonly id:ProviderId;readonly maxConcurrent:number;/** @param request - retained immutable input. @param context - task lifetime and durable output writer. @returns completion after releasing owned resources. */run(request:TaskRequest,context:ProducerContext):Promise<void>}
/** Safe counters omit input bodies, output bodies and backend locations. */
export interface DeliveryStatus{readonly tasks:number|null;readonly running:number;readonly sending:number;readonly producers:number;readonly blockedScopes:number;readonly stopping:boolean;readonly fault:string|null;readonly imAvailable:boolean;readonly maintenance:boolean;readonly pendingMutations:number}
/** Scope-specific wake clears only transient offline or muted holds. */
export type BlockReason=Availability|'job-unavailable'
/** Owner-confirmed observations for an uncertain output. */
export type DeliveryResolution={readonly state:'accepted';readonly messageIds:readonly string[]}|{readonly state:'not-sent'}
/** Trusted Host service; no model tool or automatic schedule is installed. */
export interface JobDeliveryService{
 /** @param producer - installed executor, not a model-supplied module. @returns aborting and joined registration disposer. */register(producer:TaskProducer):()=>Promise<void>
 /** @param request - authenticated consumer input. @param signal - admission cancellation only. @returns retained identity after durability; execution is asynchronous. */submit(request:unknown,signal:AbortSignal):Promise<{readonly id:TaskId;readonly replayed:boolean}>
 /** @param scope - exact authorized conversation. @param id - task identity. @returns detached retained task, never another conversation's record. */inspect(scope:unknown,id:unknown):TaskRecord
 /** @param scope - exact authorized conversation. @returns bounded metadata in creation order. */list(scope:unknown):readonly TaskView[]
 /** @returns detached distinct retained scopes for trusted Host management. */scopes():readonly ConversationScope[]
 /** @returns runtime counters without request bodies. */status():DeliveryStatus
 /** @param scope - optional exact conversation; omission wakes all transient holds. */wake(scope?:unknown):void
 /** @param scope - exact authorized conversation. @param id - task identity. @param expectedRevision - optional revision checked inside the stored transition. @returns durable stop request before in-flight work is aborted. */cancel(scope:unknown,id:unknown,expectedRevision?:string):Promise<void>
 /** @param scope - exact authorized conversation. @param id - task identity. @param output - stable output identity. @param resolution - owner-confirmed delivery observation. @param expectedRevision - optional revision checked inside the stored transition. @returns durable classification, without regenerating output. */resolveDelivery(scope:unknown,id:unknown,output:unknown,resolution:unknown,expectedRevision?:string):Promise<void>
 /** @param scope - exact authorized conversation. @param id - task identity. @param resolution - confirmed producer outcome or proof no external execution started. @param expectedRevision - optional revision checked inside the stored transition. @returns persisted execution observation, preserving saved outputs. */resolveExecution(scope:unknown,id:unknown,resolution:unknown,expectedRevision?:string):Promise<void>
}
