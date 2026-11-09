/** Native configuration page keeps local drafts through polling and failed saves. */
import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {Button,Input,Switch,Toast} from '@deepseek-ai/dsh-client-ui-primitives'
import type {HostObservable,InjectFace,PropsLocale,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {ConversationScope} from 'dsh-im-kit'
import {FIELDS,type Settings,type Field} from '../fields.ts'
import type {Snapshot,SaveRequest,Failure,Catalog,ListRequest,TaskPage,Selection,Detail,TaskEdit,Decision} from '../control-types.ts'
import {Queue} from './queue.tsx'
/** Localized error without remote diagnostics. */
export class PageProblem extends Error{constructor(readonly reason:Failure){super(reason)}}
/** Native owner operations. */
export interface PageFace{readonly read:()=>Promise<Snapshot>;readonly save:(request:SaveRequest)=>Promise<Snapshot>;readonly restart:(request:{revision:string})=>Promise<Snapshot>;readonly scopes:()=>Promise<Catalog>;readonly list:(request:ListRequest)=>Promise<TaskPage>;readonly inspect:(request:Selection)=>Promise<Detail>;readonly cancel:(request:TaskEdit)=>Promise<void>;readonly reconcile:(request:Decision)=>Promise<void>;readonly wake:(request:{scope:ConversationScope})=>Promise<void>;readonly notify:(text:string,success:boolean)=>void}
/** App-wide transient operation result. */
export interface Notice{readonly id:number;readonly text:string;readonly success:boolean}
/** Observable toast survives the settings page closing. */
export interface NoticeFace{readonly hooks:{readonly notice:HostObservable<Notice|null>};readonly dismiss:(id:number)=>void}
/** @param props - native notification subscription. @returns app-wide result toast. */
export function NoticeHost({useNotice,dismiss}:InjectFace<NoticeFace>):ReactNode{const value=useNotice(item=>item);return value?<Toast key={value.id} text={value.text} {...value.success?{tone:'success' as const}:{}} onDone={()=>dismiss(value.id)}/>:null}
/** @param props - native bundle slot and owner operations. @returns the full-page configuration view. */
export function Page({view,...props}:PropsRuntime<'plugins.bundle.config'>&PropsLocale<'jobDelivery'>&PageFace):ReactNode{return view==='page'?<Form {...props}/>:null}
function Form({t,...face}:PropsLocale<'jobDelivery'>&PageFace):ReactNode{
 const {read,save,restart,notify}=face,id=useId(),alive=useRef(true),editing=useRef(false),writing=useRef(false),sequence=useRef(0)
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[baseline,setBaseline]=useState<Snapshot|null>(null),[draft,setDraft]=useState<Partial<Record<Field,string|boolean>>>({}),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const dirty=Object.keys(draft).length>0;editing.current=dirty
 function accept(value:Snapshot,reset:boolean){setSnapshot(value);if(reset||!editing.current&&!writing.current){setBaseline(value);setDraft({})}}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++}},[])
 useEffect(()=>{let current=true,timer:ReturnType<typeof setTimeout>|undefined
  const poll=async()=>{const turn=++sequence.current;try{const value=await read();if(current&&turn===sequence.current){accept(value,false);setFailed(false)}if(current)timer=setTimeout(()=>{void poll()},value.refreshMs)}catch(error){if(current&&turn===sequence.current)setFailed(true)}}
  void poll();return()=>{current=false;sequence.current++;clearTimeout(timer)}
 },[read,refresh])
 async function submit(reload:boolean):Promise<void>{
  if(!baseline||writing.current||!reload&&!dirty)return
  const patch:Partial<Settings>={}
  for(const key of Object.keys(FIELDS) as Field[]){const raw=draft[key];if(raw===undefined)continue
   if(key==='enabled'){if(typeof raw!=='boolean'){notify(t('invalid'),false);return}patch.enabled=raw}
   else if(key==='namespace'){if(typeof raw!=='string'){notify(t('invalid'),false);return}patch.namespace=raw}
   else{if(typeof raw!=='string'||!/^\d+$/.test(raw.trim())||!Number.isSafeInteger(Number(raw))){notify(t('invalid'),false);return}patch[key]=Number(raw)}
  }
  writing.current=true;sequence.current++;setBusy(true)
  try{const value=await(reload?restart({revision:baseline.revision}):save({revision:baseline.revision,patch}));notify(t(reload?'restarted':'saved'),true);if(alive.current){accept(value,true);setRefresh(value=>value+1)}}catch(error){notify(error instanceof PageProblem?t(error.reason):t('unavailable'),false)}finally{writing.current=false;if(alive.current)setBusy(false)}
 }
 if(!snapshot||!baseline)return<section className="jobdelivery-page">{failed?<div role="alert"><p>{t('load')}</p><Button onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div>:<span className="jobdelivery-spinner" role="status" aria-label={t('loading')}/>}</section>
 const field=(key:Exclude<Field,'enabled'>)=><div className="jobdelivery-field" key={key}><label htmlFor={`${id}-${key}`}>{t(key)}</label><Input id={`${id}-${key}`} type={FIELDS[key]==='number'?'number':'text'} disabled={busy} value={String(draft[key]??baseline.config[key])} onChange={event=>{const next=event.currentTarget.value;setDraft(value=>({...value,[key]:next}))}}/></div>
 const advanced=(Object.keys(FIELDS) as Field[]).filter((key):key is Exclude<Field,'enabled'|'namespace'|'maxConcurrentExecutions'|'maxConcurrentDeliveries'>=>!['enabled','namespace','maxConcurrentExecutions','maxConcurrentDeliveries'].includes(key))
 return<section className="jobdelivery-page"><p className="jobdelivery-help">{t('intro')}</p><div className="jobdelivery-summary" aria-live="polite"><span>{t(snapshot.active?'active':'inactive')}</span>{snapshot.status&&<><span>{t('retained')}: {snapshot.status.tasks??'—'}</span><span>{t('running')}: {snapshot.status.running}</span><span>{t('sending')}: {snapshot.status.sending}</span><span>{t('producers')}: {snapshot.status.producers}</span><span>{t('blocked')}: {snapshot.status.blockedScopes}</span></>}</div>{snapshot.entryDisabled&&<p className="jobdelivery-help">{t('entryDisabled')}</p>}{snapshot.status?.fault&&<p role="alert">{t('faulted')}</p>}{snapshot.status&&!snapshot.status.imAvailable&&<p className="jobdelivery-help">{t('imMissing')}</p>}{failed&&<p role="alert">{t('load')}</p>}<form onSubmit={event=>{event.preventDefault();void submit(false)}}><h3>{t('settings')}</h3><div className="jobdelivery-field"><span>{t('enabled')}</span><Switch label={t('enabled')} disabled={busy} checked={(draft.enabled??baseline.config.enabled)===true} onChange={value=>setDraft(previous=>({...previous,enabled:value}))}/></div>{field('namespace')}{field('maxConcurrentExecutions')}{field('maxConcurrentDeliveries')}<details><summary>{t('advanced')}</summary><div className="jobdelivery-fields">{advanced.map(field)}</div></details><p className="jobdelivery-help">{t('reloadHelp')}</p>{dirty&&<p role="status">{t(snapshot.revision===baseline.revision?'dirty':'stale')}</p>}<div className="jobdelivery-actions"><Button type="submit" variant="primary" disabled={busy||!dirty}>{t('save')}</Button><Button type="button" disabled={busy||!dirty} onClick={()=>accept(snapshot,true)}>{t('discard')}</Button><Button type="button" disabled={busy||dirty} onClick={()=>{void submit(true)}}>{t('restart')}</Button><Button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div></form><Queue {...face} t={t} active={snapshot.active} refreshMs={snapshot.refreshMs}/></section>
}
