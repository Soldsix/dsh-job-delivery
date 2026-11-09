/** Owner-facing metadata excludes source payloads, message bodies and media locations. */
import type {ConversationScope} from 'dsh-im-kit'
import type {Settings} from './fields.ts'
import type {DeliveryStatus,TaskView,OutputState} from './types.ts'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
/** Saved settings and the independently observed runtime. */
export interface Snapshot{readonly config:Settings;readonly revision:string;readonly appliedRevision:string|null;readonly active:boolean;readonly entryDisabled:boolean;readonly refreshMs:number;readonly status:DeliveryStatus|null}
/** An explicit saved-settings revision prevents overwriting another owner edit. */
export interface SaveRequest{readonly revision:string;readonly patch:Partial<Settings>}
/** Bounded scope catalog reports truncation instead of silently hiding records. */
export interface Catalog{readonly scopes:readonly ConversationScope[];readonly omitted:number}
/** Exact scope and bounded list page. */
export interface ListRequest{readonly scope:ConversationScope;readonly offset:number}
/** Scalar rows and total, sorted by creation time. */
export interface TaskPage{readonly tasks:readonly TaskView[];readonly total:number;readonly offset:number;readonly nextOffset:number|null}
/** Exact retained record selection. */
export interface Selection{readonly scope:ConversationScope;readonly id:string}
/** Metadata for an output, without its text, references or transport exception. */
export interface OutputPreview{readonly id:string;readonly state:OutputState;readonly attempts:number;readonly digest:string;readonly partTypes:readonly string[];readonly messageIds:readonly string[];readonly omittedMessageIds:number}
/** Revision-checked task inspection; output truncation is explicit. */
export interface Detail{readonly task:TaskView;readonly revision:string;readonly outputs:readonly OutputPreview[];readonly omittedOutputs:number}
/** All owner state changes name the observed task revision. */
export interface TaskEdit extends Selection{readonly revision:string}
/** Reconciliation must carry a fresh, explicit external-observation confirmation. */
export type Decision=TaskEdit&{readonly confirmed:true}&({readonly kind:'execution';readonly state:'not-started'|'completed'|'failed'}|{readonly kind:'delivery';readonly outputId:string;readonly state:'not-sent'}|{readonly kind:'delivery';readonly outputId:string;readonly state:'accepted';readonly messageIds:readonly string[]})
/** Sanitized control failures never contain input or provider exceptions. */
export type Failure='forbidden'|'cancelled'|'invalid'|'conflict'|'unavailable'|'busy'|'apply-failed'|'capacity'|'storage'|'not-found'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface RemoteErrorDetailsMap{
 /** Native task-management error without source, outputs or backend details. */
 'job-delivery/control':{readonly reason:Failure}
}}
