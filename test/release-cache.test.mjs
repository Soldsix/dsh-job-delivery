/** Cache setup cannot bypass integrity checks and can satisfy an unchanged URL lock offline. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {verifiedDownload,npmCli} from '../scripts/release-cache.mjs'

test('a failed public route permits one authorized download but corrupt successful bytes never fall through',async()=>{
 const bytes=Buffer.from('synthetic immutable bytes'),input={sha256:createHash('sha256').update(bytes).digest('hex')};let fallback=0
 const result=await verifiedDownload(input,async()=>({ok:false,status:504}),async status=>{assert.equal(status,504);fallback++;return bytes});assert.equal(result.route,'github-release-cli');assert.equal(fallback,1)
 await assert.rejects(verifiedDownload(input,async()=>({ok:true,status:200,bytes:Buffer.from('corrupt')}),async()=>{fallback++;return bytes}),/hash differs/);assert.equal(fallback,1)
 await assert.rejects(verifiedDownload(input,async()=>({ok:false,status:504}),async()=>Buffer.from('corrupt')),/hash differs/)
})

test('npm uses a verified tarball by integrity while preserving the original locked URL in offline mode',async()=>{
 const parent=fileURLToPath(new URL('../.test-artifacts/cache-proof/',import.meta.url));await mkdir(parent,{recursive:true});const area=await mkdtemp(join(parent,'case-')),cache=join(area,'cache'),fixture=join(area,'fixture'),packageRoot=join(fixture,'package'),consumer=join(area,'consumer');await mkdir(packageRoot,{recursive:true});await mkdir(consumer)
 await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'synthetic-offline-input',version:'1.0.0',type:'module'})+'\n');await writeFile(join(packageRoot,'index.js'),'export const synthetic=true\n')
 const run=promisify(execFile),archive=join(area,'input.tgz'),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|TOKEN|SECRET|PASSWORD|^NPM_CONFIG_/i.test(key)));Object.assign(env,{NPM_CONFIG_CACHE:cache,TEMP:area,TMP:area})
 await run('tar',['-czf',archive,'-C',fixture,'package'],{windowsHide:true,env})
 const integrity='sha512-'+createHash('sha512').update(await readFile(archive)).digest('base64'),url='http://127.0.0.1:1/not-contacted.tgz',manifest={name:'synthetic-offline-consumer',version:'1.0.0',private:true,dependencies:{'synthetic-offline-input':url}}
 await writeFile(join(consumer,'package.json'),JSON.stringify(manifest)+'\n');await writeFile(join(consumer,'package-lock.json'),JSON.stringify({name:manifest.name,version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:manifest.name,version:'1.0.0',dependencies:manifest.dependencies},'node_modules/synthetic-offline-input':{version:'1.0.0',resolved:url,integrity}}})+'\n')
 const cli=await npmCli();await run(process.execPath,[cli,'cache','add',archive,'--ignore-scripts'],{cwd:consumer,env,windowsHide:true,signal:AbortSignal.timeout(60000)});await run(process.execPath,[cli,'ci','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:consumer,env,windowsHide:true,signal:AbortSignal.timeout(60000)})
 assert.equal(await readFile(join(consumer,'node_modules/synthetic-offline-input/index.js'),'utf8'),'export const synthetic=true\n');assert.equal(JSON.parse(await readFile(join(consumer,'package-lock.json'),'utf8')).packages['node_modules/synthetic-offline-input'].resolved,url)
})
