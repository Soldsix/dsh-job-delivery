/** Strict JSON codecs shared by the Host and native Web client. */
import * as z from 'zod/mini'
import type {ConversationScope} from 'dsh-im-kit'
import type {Settings} from './fields.ts'
import type {DeliveryStatus,TaskView} from './types.ts'
import type {Snapshot,SaveRequest,Catalog,ListRequest,TaskPage,Selection,Detail,TaskEdit,Decision} from './control-types.ts'
const text=z.string().check(z.minLength(1),z.maxLength(256)),integer=z.int().check(z.minimum(0)),revision=z.string().check(z.regex(/^[a-f0-9]{64}$/)),id=z.string().check(z.regex(/^task-[a-f0-9]{64}$/)),output=z.string().check(z.regex(/^[a-z0-9][a-z0-9._-]{0,79}$/))
const config=z.strictObject({enabled:z.boolean(),namespace:z.string(),maxTasks:z.int(),maxRecordBytes:z.int(),maxPayloadBytes:z.int(),maxReceiptBytes:z.int(),maxRetainedBytes:z.int(),maxOutputsPerTask:z.int(),maxPartsPerOutput:z.int(),maxTextChars:z.int(),maxConcurrentExecutions:z.int(),maxConcurrentDeliveries:z.int(),maxExecutionsPerScope:z.int(),maxDeliveriesPerScope:z.int(),maxPendingMutations:z.int(),executionTimeoutMs:z.int(),deliveryTimeoutMs:z.int()} satisfies {[K in keyof Settings]:z.ZodMiniType<Settings[K]>})
const scope=z.pipe(z.strictObject({account:z.strictObject({tenantId:text,networkId:text,accountId:text}),kind:z.enum(['group','private']),peerId:text}),z.transform(value=>value as ConversationScope))
const execution=z.enum(['queued','running','completed','failed','uncertain','cancelled']),state=z.enum(['pending','sending','accepted','failed','uncertain','cancelled'])
const status:z.ZodMiniType<DeliveryStatus>=z.strictObject({tasks:z.nullable(integer),running:integer,sending:integer,producers:integer,blockedScopes:integer,stopping:z.boolean(),fault:z.nullable(text),imAvailable:z.boolean(),maintenance:z.boolean(),pendingMutations:integer})
const task:z.ZodMiniType<TaskView>=z.pipe(z.strictObject({id,provider:output,actorId:text,scope,createdAt:integer,updatedAt:integer,execution,attempts:integer,cancelRequested:z.boolean(),outputCounts:z.strictObject({pending:integer,sending:integer,accepted:integer,failed:integer,uncertain:integer,cancelled:integer}),failure:z.nullable(text)}),z.transform(value=>value as TaskView))
/** Settings changes accept only known fields. */
export const saveSchema:z.ZodMiniType<SaveRequest>=z.strictObject({revision,patch:z.pipe(z.partial(config),z.transform(value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined)) as Partial<Settings>))})
/** Saved and applied runtime settings are separate observations. */
export const snapshotSchema:z.ZodMiniType<Snapshot>=z.strictObject({config,revision,appliedRevision:z.nullable(revision),active:z.boolean(),entryDisabled:z.boolean(),refreshMs:integer,status:z.nullable(status)})
/** Revision used for an explicit restart. */
export const revisionSchema=z.strictObject({revision})
/** Bounded exact scope identities. */
export const catalogSchema:z.ZodMiniType<Catalog>=z.strictObject({scopes:z.array(scope),omitted:integer})
/** Exact scoped page selection. */
export const listSchema:z.ZodMiniType<ListRequest>=z.strictObject({scope,offset:integer})
/** Body-free task rows. */
export const pageSchema:z.ZodMiniType<TaskPage>=z.strictObject({tasks:z.array(task),total:integer,offset:integer,nextOffset:z.nullable(integer)})
/** Exact task selection, never an ambient group. */
export const selectionSchema:z.ZodMiniType<Selection>=z.strictObject({scope,id})
/** Metadata revision is checked again inside the durable mutation. */
export const editSchema:z.ZodMiniType<TaskEdit>=z.strictObject({scope,id,revision})
/** Bounded task detail. */
export const detailSchema:z.ZodMiniType<Detail>=z.strictObject({task,revision,outputs:z.array(z.strictObject({id:output,state,attempts:integer,digest:revision,partTypes:z.array(text),messageIds:z.array(text),omittedMessageIds:integer})),omittedOutputs:integer})
const edit={scope,id,revision,confirmed:z.literal(true)}
/** A server-confirmed external observation is mandatory; no automatic retry is represented. */
export const decisionSchema:z.ZodMiniType<Decision>=z.union([z.strictObject({...edit,kind:z.literal('execution'),state:z.enum(['not-started','completed','failed'])}),z.strictObject({...edit,kind:z.literal('delivery'),outputId:output,state:z.literal('not-sent')}),z.strictObject({...edit,kind:z.literal('delivery'),outputId:output,state:z.literal('accepted'),messageIds:z.array(text).check(z.minLength(1),z.maxLength(1000))})])
/** A wake always identifies its complete destination. */
export const wakeSchema=z.strictObject({scope})
