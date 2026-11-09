/** Download immutable inputs through normal public or authorized GitHub routes and seed npm's content cache. */
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {imKitInput} from './release-spec.mjs'
import {verifiedDownload,npmCli} from './release-cache.mjs'
const run=promisify(execFile),directory=fileURLToPath(new URL('../.test-artifacts/release-inputs/',import.meta.url));await mkdir(directory,{recursive:true})
const input=imKitInput,target=directory+'/'+input.file;let bytes,route='verified-local',primaryStatus
try{bytes=await readFile(target)}catch(error){if(error.code!=='ENOENT')throw error}
if(!bytes){
 const ghIndex=process.argv.indexOf('--gh-cli'),gh=ghIndex>=0?process.argv[ghIndex+1]:'gh'
 const result=await verifiedDownload(input,async()=>{const response=await fetch(input.url,{signal:AbortSignal.timeout(90000)});return{ok:response.ok,status:response.status,bytes:response.ok?new Uint8Array(await response.arrayBuffer()):undefined}},async status=>{
  const temporary=await mkdtemp(directory+'/github-');try{await run(gh,['release','download',input.tag,'--repo',input.repository,'--pattern',input.file,'--dir',temporary],{windowsHide:true,signal:AbortSignal.timeout(90000),maxBuffer:1024*1024,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!(/KEY|SECRET|TOKEN|PASSWORD/i.test(key))||['GH_TOKEN','GITHUB_TOKEN'].includes(key)))})}catch(error){throw Error('GitHub release download failed after public route status '+status)}return readFile(temporary+'/'+input.file)
 });bytes=result.bytes;route=result.route;primaryStatus=result.primaryStatus
}
assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256,'Public release input hash differs');await writeFile(target,bytes)
if(process.argv.includes('--seed-npm-cache'))await run(process.execPath,[await npmCli(),'cache','add',target,'--ignore-scripts'],{cwd:fileURLToPath(new URL('../',import.meta.url)),windowsHide:true,signal:AbortSignal.timeout(90000),maxBuffer:1024*1024,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))})
console.log(JSON.stringify({name:input.name,sha256:input.sha256,route,primaryStatus,npmCacheSeeded:process.argv.includes('--seed-npm-cache')}))
