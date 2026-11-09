/** Synthetic producer and transport for the installed native owner page. */
import {ImRuntime,identifier} from 'dsh-im-kit'
import {providerId,outputId} from 'dsh-job-delivery'
export const name='job-web-fixture'
export function apply(ctx){
 const im=new ImRuntime(),account={tenantId:identifier('im.tenant','owner-page-fixture'),networkId:identifier('im.network','synthetic'),accountId:identifier('im.account','fixture-bot')},sent=new Set()
 ctx.effect(()=>()=>im.close());ctx.effect(()=>ctx.provide('im',im))
 ctx.effect(()=>im.register({account,availability:async scope=>scope.peerId==='muted-room'?'muted':'available',async send(message){if(!sent.has(message.operationId)){sent.add(message.operationId);return{status:'uncertain',code:'provider-error'}}return{status:'accepted',messageIds:[identifier('im.message','synthetic-observed-receipt')]}},async dispose(){}}))
 ctx.inject(['jobDelivery'],child=>{
  child.effect(()=>child.jobDelivery.register({id:providerId('web-fixture'),maxConcurrent:2,async run(request,context){await context.checkpoint(outputId('result'),[{type:'text',text:'PRIVATE_SYNTHETIC_OUTPUT_NOT_FOR_PAGE'}])}}))
  const seed=(async()=>{for(const peer of['active-room','muted-room'])await child.jobDelivery.submit({scope:{account,kind:'group',peerId:identifier('im.peer',peer)},actorId:identifier('im.user','synthetic-alice'),operationId:identifier('im.operation','web-source-'+peer),provider:providerId('web-fixture'),payload:{text:'PRIVATE_SYNTHETIC_SOURCE_NOT_FOR_PAGE'}},new AbortController().signal)})()
  child.effect(()=>async()=>{await seed})
 })
}
