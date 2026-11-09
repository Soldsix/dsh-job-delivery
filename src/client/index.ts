/** Native bundle settings, task browser and app-wide operation feedback. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store'
import type {RemoteResult} from '@deepseek-ai/dsh-typert-protocol/types'
import {remote} from './remote.ts'
import {en,zh,type LocaleKey} from './locales.ts'
import {Page,NoticeHost,PageProblem,type Notice,type NoticeFace,type PageFace} from './page.tsx'
import styles from './style.css'
declare module '@deepseek-ai/dsh-client-ui-slots'{interface LocaleNamespaceMap{/** Durable task controls. */jobDelivery:LocaleKey}}
/** Required native Client services. */
export const inject=['remote','locale','slots']
function unwrap<T>(result:RemoteResult<T>):T{if(result.ok)return result.value;throw new PageProblem(result.error.code==='job-delivery/control'?result.error.details.reason:'unavailable')}
/** @param ctx - native Client context. @returns completion after mounting strict owner operations. */
export async function apply(ctx:Context):Promise<void>{
 await ctx.remote.$mount(remote);ctx.effect(()=>ctx.locale.register('jobDelivery',{en,zh}))
 ctx.effect(()=>{const style=document.createElement('style');style.dataset['jobDelivery']='true';style.textContent=styles;document.head.append(style);return()=>style.remove()})
 const notice=createSnapshotStore<Notice|null>(null);let serial=0
 ctx.inject(['remote.jobDeliveryControl'],child=>{const api=child.remote.jobDeliveryControl,face:PageFace={read:async()=>unwrap(await api.describe()),save:async request=>unwrap(await api.save(request)),restart:async request=>unwrap(await api.restart(request)),scopes:async()=>unwrap(await api.scopes()),list:async request=>unwrap(await api.list(request)),inspect:async request=>unwrap(await api.inspect(request)),cancel:async request=>unwrap(await api.cancel(request)),reconcile:async request=>unwrap(await api.reconcile(request)),wake:async request=>unwrap(await api.wake(request)),notify:(text,success)=>notice.set({id:++serial,text,success})};child.slots.inject('plugins.bundle.config',()=>child.slots.register({name:'plugins.bundle.config',key:'dsh-job-delivery',locale:'jobDelivery',inject:()=>face},Page))})
 ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'job-delivery.notice',inject:():NoticeFace=>({hooks:{notice},dismiss:id=>{if(notice.getSnapshot()?.id===id)notice.set(null)}})},NoticeHost))
}
