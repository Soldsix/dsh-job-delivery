/** Strict native Client descriptors for independently owner-gated operations. */
import type {RemoteResult,TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol/types'
import * as z from 'zod/mini'
import type {ConversationScope} from 'dsh-im-kit'
import type {Snapshot,SaveRequest,Catalog,ListRequest,TaskPage,Selection,Detail,TaskEdit,Decision} from '../control-types.ts'
import {saveSchema,snapshotSchema,revisionSchema,catalogSchema,listSchema,pageSchema,selectionSchema,detailSchema,editSchema,decisionSchema,wakeSchema} from '../control-codecs.ts'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface TypertRemoteNamespaceMap{
 /** Owner task settings and metadata; no model-facing task inspection is installed. */
 jobDeliveryControl:{describe():Promise<RemoteResult<Snapshot>>;save(request:SaveRequest):Promise<RemoteResult<Snapshot>>;restart(request:{revision:string}):Promise<RemoteResult<Snapshot>>;scopes():Promise<RemoteResult<Catalog>>;list(request:ListRequest):Promise<RemoteResult<TaskPage>>;inspect(request:Selection):Promise<RemoteResult<Detail>>;cancel(request:TaskEdit):Promise<RemoteResult<void>>;reconcile(request:Decision):Promise<RemoteResult<void>>;wake(request:{scope:ConversationScope}):Promise<RemoteResult<void>>}
}}
function descriptor(method:string,request:z.ZodMiniType|undefined,result:z.ZodMiniType){return{id:`jobDeliveryControl/${method}`,service:'jobDeliveryControl',namespace:'jobDeliveryControl',method,invocation:{kind:'direct' as const},parameters:request?[{name:'request',wire:'request',source:'json' as const,codec:{mode:'strict' as const,typeSymbol:`dsh-job-delivery#${method}Request`,create:()=>request}}]:[],result:{mode:'strict' as const,typeSymbol:`dsh-job-delivery#${method}Result`,create:()=>result}}}
/** Native operations use matching request and result codecs. */
export const remote:TypertRemoteContribution={package:'dsh-job-delivery',descriptors:[descriptor('describe',undefined,snapshotSchema),descriptor('save',saveSchema,snapshotSchema),descriptor('restart',revisionSchema,snapshotSchema),descriptor('scopes',undefined,catalogSchema),descriptor('list',listSchema,pageSchema),descriptor('inspect',selectionSchema,detailSchema),descriptor('cancel',editSchema,z.void()),descriptor('reconcile',decisionSchema,z.void()),descriptor('wake',wakeSchema,z.void())]}
