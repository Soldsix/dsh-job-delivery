/** Publish the synthetic IM provider before a separate consumer starts native job checks. */
import {ImRuntime,identifier} from 'dsh-im-kit'
export const name='synthetic-job-im'
export function apply(ctx,config){
 const im=new ImRuntime();let enter;const fixture={calls:0,entered:new Promise(resolve=>{enter=resolve})},account={tenantId:identifier('im.tenant','native-fixture'),networkId:identifier('im.network','synthetic'),accountId:identifier('im.account','fixture-bot')}
 ctx.effect(()=>()=>im.close());ctx.effect(()=>ctx.provide('im',im));ctx.effect(()=>ctx.provide('jobFixtureIm',fixture))
 ctx.effect(()=>im.register({account,availability:async destination=>destination.peerId.endsWith('/muted')?'muted':'available',async send(message,signal){fixture.calls++;if(config.phase==='crash'&&message.parts.some(part=>part.type==='text'&&part.text==='INTERRUPTED_ORIGINAL')){enter();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return{status:'uncertain',code:'cancelled-after-dispatch'}}return{status:'accepted',messageIds:[identifier('im.message',config.prefix+'/receipt-'+fixture.calls)]}},async dispose(){}}))
}
