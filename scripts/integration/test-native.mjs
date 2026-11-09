/** Install the fixed archive in an isolated SDK profile and test actual process interruption recovery. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath,statfs} from 'node:fs/promises'
import {join,basename,relative,isAbsolute,delimiter} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {pnpmScript} from './pnpm.mjs'
import {requiredProfilePeers} from './profile-peers.mjs'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv,index=args.indexOf('--im-kit-archive');assert.ok(index>=0&&args[index+1],'Pass --im-kit-archive PATH')
const budgetIndex=args.indexOf('--minimum-free-bytes'),minimum=Number(args[budgetIndex+1]);assert.ok(budgetIndex>=0&&Number.isSafeInteger(minimum)&&minimum>0,'Pass an explicit --minimum-free-bytes budget before installation');const disk=await statfs(root);assert.ok(disk.bavail*disk.bsize>=minimum,'Not enough free disk space for the selected isolated installation budget')
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),runs=join(root,'.test-artifacts','native');await mkdir(runs,{recursive:true});const resume=args.indexOf('--resume-run'),area=resume>=0?await realpath(args[resume+1]):await mkdtemp(join(runs,'install-')),owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Unowned profile resume')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='job-delivery-native',profileRoot=join(home,'profiles',profile),archives=[]
for(const source of[await realpath(args[index+1]),join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const target=join(attempt,basename(source));await copyFile(source,target);archives.push({path:target,sha256:createHash('sha256').update(await readFile(target)).digest('hex')})}
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)));await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{NPM_CONFIG_CACHE:join(root,'.npm-cache'),DSH_HOME:home,TEMP:join(attempt,'temp'),TMP:join(attempt,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic task acceptance. No private persona or skills.'})
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path'),originalPath=pathKey?env[pathKey]:'';for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=join(root,'node_modules','.bin')+delimiter+originalPath
const dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'),commands=[]
async function run(argv,cwd){
 const timeout=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',failure
 child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error});const done=new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 try{await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n')}catch(error){child.kill('SIGKILL');await done;throw error}
 const [code,signal]=await done;commands.push({argv,code,signal,stdout,stderr});await writeFile(join(attempt,'installation.json'),JSON.stringify(commands,null,2)+'\n');if(failure)throw failure;assert.equal(code,0,stderr.slice(-1400));return stdout
}
const reuse=args.includes('--installed-profile-only');assert.ok(!reuse||resume>=0,'Installed profile reuse requires an owned --resume-run')
if(resume<0)await run([dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));profileManifest.pnpm={...profileManifest.pnpm,overrides:manifest.overrides};await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n');await writeFile(join(profileRoot,'.npmrc'),'package-import-method=hardlink\nstore-dir='+join(root,'..','.pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'..','.pnpm-cache').replaceAll('\\','/')+'\n')
if(!reuse){const pnpm=await pnpmScript(root),peerNames=Object.entries(manifest.peerDependencies).map(([name,version])=>name+'@'+version);assert.equal((await run([pnpm,'--version'],root)).trim(),manifest.devDependencies.pnpm,'Unexpected QA package manager');await run([pnpm,'add',archives[0].path,'@deepseek-ai/dsh@0.2.2-rc.1',...peerNames,'--ignore-scripts'],profileRoot);await run([dsh,'plugin','--profile',profile,'add',archives[1].path,'--ignore-scripts'],area);for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}}
const selected=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));let repairedInterruptedSelection=false
if(!selected.dsh?.profile?.bundles?.includes(manifest.name)){
 assert.ok(resume>=0,'A fresh CLI installation did not select the candidate bundle');assert.ok(selected.dependencies?.[manifest.name],'The resumed candidate dependency is absent')
 selected.dsh={...selected.dsh,profile:{...selected.dsh?.profile,bundles:[...(selected.dsh?.profile?.bundles??[]),manifest.name]}};await writeFile(join(profileRoot,'package.json'),JSON.stringify(selected,null,2)+'\n');repairedInterruptedSelection=true
}
const installedFiles=await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-job-delivery'),join(attempt,'installed-files.json'));await copyFile(fileURLToPath(new URL('./native-probe.mjs',import.meta.url)),join(profileRoot,'job-native-probe.mjs'));await copyFile(fileURLToPath(new URL('./native-im-provider.mjs',import.meta.url)),join(profileRoot,'job-native-im.mjs'))
const phases=[]
for(const phase of['crash','recover']){
 const resultPath=join(attempt,phase+'.json'),overlay=[{id:'job-delivery',config:{enabled:true,namespace:'native_'+basename(attempt).toLowerCase().replaceAll('-','_'),maxConcurrentExecutions:2,maxConcurrentDeliveries:2,executionTimeoutMs:60000,deliveryTimeoutMs:60000}},{id:'jobs',config:{maxConcurrentJobsPerOwner:4}},{id:'session-telemetry-otel',disabled:true},{insert:[{id:'job-native-im',name:pathToFileURL(join(profileRoot,'job-native-im.mjs')).href,config:{phase,prefix:basename(attempt)}},{id:'job-native-probe',name:pathToFileURL(join(profileRoot,'job-native-probe.mjs')).href,config:{phase,prefix:basename(attempt),resultPath,holderCount:4}}]}];await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
 const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',exitCode;child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}});await writeFile(join(attempt,phase+'-live.json'),JSON.stringify({pid:child.pid,phase,profile,startedAt:new Date().toISOString()})+'\n')
 try{
  let result;const limit=Date.now()+90000
  while(Date.now()<limit){try{result=JSON.parse(await readFile(resultPath,'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}assert.equal(exitCode,undefined,'Native SDK exited before result: '+stderr.slice(-1800));await delay(20)}
  assert.ok(result,'Native probe timed out: '+stderr.slice(-1800));assert.equal(result.passed,true,JSON.stringify(result.error));phases.push(result)
  if(phase==='crash'){assert.equal(result.execution,'running');assert.equal(result.output,'sending');assert.equal(result.nativeLiveJobs,1);assert.equal(child.kill('SIGKILL'),true,'Owned SDK process was not running');await exit}else{const deadline=new AbortController();try{child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n');const stopped=await Promise.race([exit,delay(15000,undefined,{signal:deadline.signal}).then(()=>{throw Error('Native task SDK shutdown timed out')})]);assert.deepEqual(stopped,{code:0,signal:null})}finally{deadline.abort()}}
 }finally{if(exitCode===undefined){child.kill('SIGKILL');await exit}await writeFile(join(attempt,phase+'-process.json'),JSON.stringify({exitCode,stdout,stderr},null,2)+'\n')}
}
const result={passed:true,checks:phases.flatMap(value=>value.checks),phases:phases.map(({phase,producerCalls,sendCalls})=>({phase,producerCalls,sendCalls})),forcedOwnedProcessInterruption:true,installedProfileReused:reuse,repairedInterruptedSelection,installedFiles,archives,realQqMessages:0,realModelCalls:0};await writeFile(join(attempt,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({area,attempt,...result}))
