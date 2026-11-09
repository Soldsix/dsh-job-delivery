/** Optional durable IM producer queue using native DSH jobs and storage. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from 'dsh-im-kit/cordis'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {Config,validateConfig} from './config.ts'
import {DeliveryEngine} from './engine.ts'
import type {JobDeliveryService} from './types.ts'
export {Config,validateConfig}
export type * from './types.ts'
export {providerId,outputId,TaskError,type TaskFailure} from './wire.ts'
/** Native plugin identity. */
export const name='job-delivery'
/** Disabled plugin composition still requires the native service definitions. */
export const inject=['jobs','storageDomain']
declare module '@deepseek-ai/cordis'{interface Context{readonly jobDelivery:JobDeliveryService}}
/** @param ctx - profile-owned native capabilities. @param config - explicit queue settings. @returns installation after interrupted state recovery. */
export async function apply(ctx:Context,config:Config):Promise<void>{
 validateConfig(config);if(!config.enabled)return;if(ctx.get('jobDelivery'))throw new Error('Another task delivery service is installed')
 ctx.effect(()=>ctx.jobs.attachController('job-delivery'))
 const engine=await DeliveryEngine.open(config,ctx.storageDomain,ctx.jobs,()=>ctx.get('im'))
 ctx.effect(()=>()=>engine.close());ctx.effect(()=>ctx.provide('jobDelivery',engine))
 ctx.effect(()=>ctx.jobs.events.subscribe({owners:'scope'},event=>{if(event.type==='settled')engine.capacityAvailable()}))
 ctx.inject(['im'],child=>{engine.wake();child.effect(()=>child.im.subscribe(input=>{engine.wake(input.scope)},()=>true))})
}
