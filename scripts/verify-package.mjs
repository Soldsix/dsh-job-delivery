/** Check portable metadata, paired documentation and a deliberate publication allowlist. */
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFile,readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'

/**
 * Refuse private dependencies and standalone application launchers.
 * @param manifest - candidate public package metadata.
 */
export function verifyManifest(manifest){
 assert.equal(manifest.name,'dsh-job-delivery');assert.equal(manifest.type,'module');assert.equal(manifest.license,'MIT');assert.ok(!manifest.bin)
 assert.equal(manifest.engines?.dsh,'0.2.2-rc.1');assert.equal(manifest.dependencies?.['dsh-im-kit'],'https://github.com/Soldsix/dsh-im-kit/releases/download/v0.2.1/dsh-im-kit-0.2.1.tgz');assert.equal(manifest.dsh?.bundle?.patch,'./cordis.patch.yml')
 assert.equal(manifest.exports?.['.']?.import,'./dist/index.js');assert.equal(manifest.exports?.['./control']?.import,'./dist/control.js');assert.equal(manifest.exports?.['./client']?.default,'./dist/client.js');assert.equal(manifest.dsh?.client?.platform,'web')
 for(const section of ['dependencies','peerDependencies','devDependencies'])for(const [key,value]of Object.entries(manifest[section]??{}))assert.ok(!/^(?:file:|link:|workspace:|[a-z]:[\\/]|[\\/])/i.test(value),'Nonportable dependency '+key)
}
/**
 * Check line-aligned package pages and their shared explicit anchors.
 * @param english - English package reference.
 * @param chinese - Chinese counterpart.
 */
export function verifyPair(english,chinese){
 for(const text of [english,chinese]){assert.match(text,/^kind: "package-bundle"$/m);assert.match(text,/^description: ".+"$/m)}
 const en=english.split(/\r?\n/u),zh=chinese.split(/\r?\n/u);assert.equal(en.length,zh.length)
 const summary=en.join('\n').split('## Summary\n')[1];assert.ok(summary,'Missing summary');assert.ok(summary.split('\n## ')[0].trim().split(/\s+/).length<=100)
 const anchors=text=>[...text.matchAll(/<a id="([^"]+)">/g)].map(item=>item[1]);assert.deepEqual(anchors(english),anchors(chinese))
}
/**
 * Exclude fixture evidence, local data and uncompiled source from the published archive.
 * @param paths - npm's actual dry-run file list.
 */
export function verifyFiles(paths){
 const exact=['LICENSE','README.md','README.zh.md','README.i18n.yaml','package.json','cordis.patch.yml']
 for(const path of paths)assert.ok(exact.includes(path)||/^dist\/(?:client\/)?[a-z][a-z-]*\.(?:js|d\.ts)$/.test(path),'Unexpected public file '+path)
 for(const path of [...exact,'dist/index.js','dist/index.d.ts','dist/control.js','dist/control.d.ts','dist/client.js','dist/client/index.d.ts'])assert.ok(paths.includes(path),'Missing public file '+path)
}
/**
 * Refuse machine locations, credential-like literals and unsafe cast shortcuts without printing them.
 * @param text - UTF-8 source or publication text.
 * @param label - safe file identity for failures.
 */
export function verifyText(text,label){
 assert.ok(!/[c-f]:[\\/](?:users|个人|项目工作区)[\\/]/i.test(text),'Private machine path in '+label)
 assert.ok(!/\bsk-[a-z0-9]{20,}\b/i.test(text),'Credential-like literal in '+label);assert.ok(!/\bas unknown\b/.test(text),'Unknown assertion in '+label)
 assert.ok(/\r?\n$/u.test(text)&&!/(?:\r?\n){2}$/u.test(text),'Trailing newline in '+label)
}
/** @param english - owner upgrade steps. @param chinese - paired steps. @param pairing - explicit filenames. */
export function verifyUpgradeGuide(english,chinese,pairing){
 assert.deepEqual(pairing,{en:'guide.md',zh:'guide.zh.md'});assert.equal(english.split(/\r?\n/).length,chinese.split(/\r?\n/).length)
 for(const text of[english,chinese]){assert.match(text,/^kind: upgrade-guide$/m);assert.match(text,/^description: ".+"$/m);assert.equal([...text.matchAll(/^# /gm)].length,1);verifyText(text,'upgrade guide')}
 assert.deepEqual([...english.matchAll(/^## (.+)$/gm)].map(value=>value[1]),['Change','Migration']);assert.deepEqual([...chinese.matchAll(/^## (.+)$/gm)].map(value=>value[1]),['变更','迁移']);assert.ok(english.trim().split(/\s+/).length<=500)
}
async function sources(directory){const paths=[];for(const item of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,item.name);if(item.isDirectory())paths.push(...await sources(path));else if(/\.tsx?$/.test(item.name))paths.push(path)}return paths}
async function main(){
 const root=fileURLToPath(new URL('../',import.meta.url)),manifest=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));verifyManifest(manifest)
 verifyPair(await readFile(resolve(root,'README.md'),'utf8'),await readFile(resolve(root,'README.zh.md'),'utf8'))
 const guide=resolve(root,'docs/upgrade-guide/v0.1.0-development/task-observation');verifyUpgradeGuide(await readFile(resolve(guide,'guide.md'),'utf8'),await readFile(resolve(guide,'guide.zh.md'),'utf8'),parse(await readFile(resolve(guide,'guide.i18n.yaml'),'utf8')))
 const patch=parse(await readFile(resolve(root,'cordis.patch.yml'),'utf8'));assert.deepEqual(patch,[{insert:[{id:'job-delivery-control',name:'dsh-job-delivery/control'},{id:'job-delivery',name:'dsh-job-delivery',config:{enabled:false}}]}])
 for(const path of await sources(resolve(root,'src'))){const text=await readFile(path,'utf8');verifyText(text,path);assert.ok(text.startsWith('/**'),'Module documentation missing')}
 assert.match(await readFile(resolve(root,'dist/client.js'),'utf8'),/Copyright \(c\) 2025 Colin McDonnell/)
 assert.ok(process.env.npm_execpath,'Run through npm run check')
 const deadline=AbortSignal.timeout(60000),child=spawn(process.execPath,[process.env.npm_execpath,'pack','--dry-run','--ignore-scripts','--json'],{cwd:root,signal:deadline,windowsHide:true,stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='',failure;child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)));if(failure)throw failure;assert.equal(deadline.aborted,false);assert.equal(signal,null);assert.equal(code,0,stderr)
 const pack=JSON.parse(stdout);assert.equal(pack.length,1);const paths=pack[0].files.map(file=>file.path);verifyFiles(paths)
 for(const path of paths){verifyText(await readFile(resolve(root,path),'utf8'),path);if(path.startsWith('dist/')&&path!=='dist/client.js'){const source=path.replace(/^dist\//,'src/').replace(/(?:\.d\.ts|\.js)$/,'.ts');let exists=false;for(const candidate of[source,source.replace(/\.ts$/,'.tsx')]){try{await readFile(resolve(root,candidate));exists=true;break}catch(error){if(error.code!=='ENOENT')throw error}}assert.ok(exists,'Stale build output: '+path)}}
 console.log(JSON.stringify({package:manifest.name,passed:true,packedFiles:paths.length,checks:['portable-manifest','paired-documents','disabled-bundle','source-and-artifact-hygiene','artifact-allowlist']}))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
