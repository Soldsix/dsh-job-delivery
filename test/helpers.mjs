/** Synthetic native-storage fixture; no production profile or messaging provider is imported. */
import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {Context} from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonBackend from '@deepseek-ai/dsh-storage-json'
import {DomainFacility} from '@deepseek-ai/dsh-storage-domain'
import {identifier,ImRuntime} from 'dsh-im-kit'
import {DeliveryEngine} from '../dist/engine.js'
import {Config} from '../dist/config.js'
import {providerId} from '../dist/wire.js'

export const signal=()=>new AbortController().signal
export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
export async function until(check){const limit=Date.now()+10000;while(!await check()){assert.ok(Date.now()<limit,'Synthetic observation timed out');await delay(5)}}
export function scope(peer='group-a',kind='group',account='bot-a'){return{account:{tenantId:identifier('im.tenant','synthetic-tenant'),networkId:identifier('im.network','synthetic'),accountId:identifier('im.account',account)},kind,peerId:identifier('im.peer',peer)}}
export function request(operationId='op-a',destination=scope(),payload={text:'synthetic original\nsecond line'}){return{scope:destination,actorId:identifier('im.user','synthetic-actor'),operationId,provider:providerId('fixture'),payload}}
export class FixtureJobs{
 records=new Map();seen=[];serial=0;refuse=false
 listeners=new Set();events={subscribe:(_filter,listener)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)}}
 emitSettled(){for(const listener of this.listeners)listener({type:'settled'})}
 start(spec){if(this.refuse)throw Error('synthetic native job refusal');const id='im-task-'+(++this.serial),done=deferred(),record={id,status:'running',done};this.records.set(id,record);this.seen.push({kind:spec.kind,label:spec.label});const hooks=spec.run({id,append(){},updateProgress(){}});hooks.done.then(outcome=>{record.status=outcome.status;done.resolve();this.emitSettled()},error=>{record.status='failed';done.resolve();this.emitSettled()});return id}
 async wait(id){const record=this.records.get(id);if(!record)throw Error('unknown fixture job');await record.done.promise;return{id,status:record.status}}
 remove(id){const record=this.records.get(id);assert.ok(record&&!['running','stopping'].includes(record.status));this.records.delete(id)}
}
export async function setup(t,patch={},options={}){
 const runs=fileURLToPath(new URL('../.test-artifacts/unit/',import.meta.url));await mkdir(runs,{recursive:true});const area=await mkdtemp(join(runs,'case-')),ctx=new Context(),storage=ctx.plugin(Storage);await storage.await();const backend=ctx.plugin(JsonBackend,{root:join(area,'storage')});await backend.await();const releaseBackend=options.backend?ctx.storage.backend.register('fault_fixture',options.backend(ctx.storage.backend.get('json'))):()=>{},domains=new DomainFacility(ctx,{backend:options.backend?'fault_fixture':'json'}),jobs=new FixtureJobs(),im=new ImRuntime(),sent=[]
 let availability='available',send=async(message)=>{sent.push(structuredClone(message));return{status:'accepted',messageIds:[identifier('im.message','fixture-receipt-'+sent.length)]}}
 const release=im.register({account:scope().account,availability:async(destination,abort)=>options.availability?options.availability(destination,abort):availability,send:(message,abort)=>send(message,abort),async dispose(){}})
 const config=Config({enabled:true,namespace:'fixture_tasks',...patch});let engine=await DeliveryEngine.open(config,options.facility?options.facility(domains):domains,jobs,()=>im)
 t.after(async()=>{await engine.close();await im.close();await domains.closeAll();releaseBackend();await backend.dispose();await storage.dispose()})
 return{area,ctx,domains,jobs,im,sent,config,get engine(){return engine},async reopen(){await engine.close();engine=await DeliveryEngine.open(config,domains,jobs,()=>im);return engine},setAvailability(value){availability=value},setSend(value){send=value},release}
}
