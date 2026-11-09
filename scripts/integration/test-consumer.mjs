/** Verify packed runtime and strict declarations without borrowing ancestor dependencies. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath,statfs} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute,basename,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import {parse as parseYaml} from 'yaml'
import {pnpmScript} from './pnpm.mjs'
import {verifyInstalledArchive} from './verify-installed.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv
const argument=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],'Pass '+name);return args[index+1]}
const minimum=Number(argument('--minimum-free-bytes')),disk=await statfs(root);assert.ok(Number.isSafeInteger(minimum)&&minimum>0&&disk.bavail*disk.bsize>=minimum,'Consumer installation space budget not met')
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),runs=join(root,'.test-artifacts','consumer');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),area=resume>=0?await realpath(args[resume+1]):await mkdtemp(join(runs,'run-')),owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Unowned consumer directory')
const attempt=await mkdtemp(join(area,'attempt-')),archives=[]
for(const source of[await realpath(argument('--im-kit-archive')),join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const path=join(attempt,basename(source));await copyFile(source,path);archives.push(path)}
await writeFile(join(area,'package.json'),JSON.stringify({name:'isolated-job-delivery-consumer',private:true,type:'module',pnpm:{overrides:manifest.overrides}},null,2)+'\n')
let store=join(root,'..','.pnpm-store')
if(resume>=0){const modules=parseYaml(await readFile(join(area,'node_modules','.modules.yaml'),'utf8'));assert.equal(typeof modules.storeDir,'string');const retained=await realpath(modules.storeDir),allowed=[join(root,'.test-artifacts'),join(root,'..','.pnpm-store')];assert.ok(allowed.some(directory=>{const part=relative(directory,retained);return !part.startsWith('..')&&!isAbsolute(part)}),'Previous consumer store is not owned');assert.equal(basename(retained),'v10');store=dirname(retained)}
await writeFile(join(area,'.npmrc'),'node-linker=hoisted\npackage-import-method=hardlink\nstore-dir='+store.replaceAll('\\','/')+'\ncache-dir='+join(root,'..','.pnpm-cache').replaceAll('\\','/')+'\n')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|^NPM_CONFIG_/i.test(key)));await mkdir(join(attempt,'temp'),{recursive:true});Object.assign(env,{TEMP:join(attempt,'temp'),TMP:join(attempt,'temp'),NPM_CONFIG_CACHE:join(root,'.npm-cache')})
const commands=[]
async function run(argv){const deadline=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd:area,env,windowsHide:true,signal:deadline,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',failure;child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error});const done=new Promise(resolve=>child.once('close',(...values)=>resolve(values)));try{await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid})+'\n')}catch(error){child.kill('SIGKILL');await done;throw error}const [code,signal]=await done;commands.push({argv,code,signal,timedOut:deadline.aborted,stdout,stderr});await writeFile(join(attempt,'commands.json'),JSON.stringify(commands,null,2)+'\n');if(failure)throw failure;assert.equal(deadline.aborted,false);assert.equal(signal,null);assert.equal(code,0,stderr.slice(-1800));return stdout}
const pnpm=await pnpmScript(root);assert.equal((await run([pnpm,'--version'])).trim(),manifest.devDependencies.pnpm)
await run([pnpm,'add','--ignore-scripts',...archives,...Object.entries(manifest.peerDependencies).map(([name,version])=>name+'@'+version),'@deepseek-ai/dsh@0.2.2-rc.1','@types/node@24.0.0','@types/react@18.3.28','@types/react-dom@18.3.7'])
const installedFiles=await verifyInstalledArchive(archives[1],join(area,'node_modules',manifest.name),join(attempt,'installed-files.json')),consumer=join(attempt,'consumer.ts')
await writeFile(consumer,`import z from '@deepseek-ai/schemastery'
import type {Context} from '@deepseek-ai/cordis'
import {Config,providerId,outputId} from 'dsh-job-delivery'
import type {TaskProducer,TaskRequest} from 'dsh-job-delivery'
import type {DeliveryControl} from 'dsh-job-delivery/control'
import type * as Client from 'dsh-job-delivery/client'
const config=z.resolve({enabled:false},Config,{})[0]
const enabled:boolean=config.enabled
const producer:TaskProducer={id:providerId('consumer'),maxConcurrent:1,async run(request,context){await context.checkpoint(outputId('original'),[{type:'text',text:request.operationId}])}}
type Service=Context['jobDelivery']
type Inspect=DeliveryControl['inspect']
type NativeClient=typeof Client
async function observe(service:Service,request:TaskRequest,id:string){const release=service.subscribe(request.scope,()=>{});try{const result=await service.wait(request.scope,id,new AbortController().signal);await service.join(request.scope,id);return result}finally{release()}}
void enabled;void producer;void observe
export type {Service,Inspect,NativeClient,TaskRequest}
`)
const program=ts.createProgram([consumer],{strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,types:['node','react'],typeRoots:[join(area,'node_modules','@types')],lib:['lib.es2023.d.ts','lib.esnext.disposable.d.ts','lib.dom.d.ts'],skipLibCheck:false,allowImportingTsExtensions:true,jsx:ts.JsxEmit.ReactJSX}),diagnostics=ts.getPreEmitDiagnostics(program)
await writeFile(join(attempt,'type-diagnostics.txt'),ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>area,getCanonicalFileName:file=>file,getNewLine:()=> '\n'}));assert.equal(diagnostics.length,0,'Strict consumer declarations failed; see owned diagnostics')
const compiler=await realpath(resolve(root,'node_modules','typescript','lib')),inputs=program.getSourceFiles().map(value=>resolve(value.fileName))
for(const path of inputs){const local=relative(area,path),compilerPath=relative(compiler,path);assert.ok(!local.startsWith('..')&&!isAbsolute(local)||!compilerPath.startsWith('..')&&!isAbsolute(compilerPath),'Consumer borrowed an ancestor dependency')}
await writeFile(join(attempt,'runtime.mjs'),`import assert from 'node:assert/strict'
import {name,Config,providerId,outputId} from 'dsh-job-delivery'
import Control from 'dsh-job-delivery/control'
assert.equal(name,'job-delivery');assert.equal(Config({}).enabled,false);assert.equal(providerId('consumer'),'consumer');assert.equal(outputId('result'),'result');assert.equal(typeof Control,'function')
console.log(JSON.stringify({passed:true,startedApplications:0,openedStores:0}))
`)
const runtime=JSON.parse((await run([join(attempt,'runtime.mjs')])).trim());assert.equal(runtime.passed,true)
const result={passed:true,installedFiles,declarationInputs:inputs.length,ancestorDependenciesBorrowed:false,strictDeclarationErrors:0,runtime,realModelCalls:0,qqMessages:0,bilibiliWrites:0}
await writeFile(join(attempt,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({area,attempt,...result}))
