/** Publication gates reject private dependencies, unshipped exports and local evidence. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {verifyManifest,verifyFiles,verifyPair,verifyText,verifyUpgradeGuide} from '../scripts/verify-package.mjs'

test('public metadata refuses private dependency references and a standalone launcher',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));verifyManifest(manifest)
 for(const change of[{bin:{job:'./dist/index.js'}},{dependencies:{...manifest.dependencies,private:'file:../private'}},{exports:{...manifest.exports,'./client':{default:'./src/client/index.ts'}}}])assert.throws(()=>verifyManifest({...manifest,...change}))
})

test('publication allowlist refuses test evidence and source even with all entry points present',()=>{
 const files=['LICENSE','README.md','README.zh.md','README.i18n.yaml','package.json','cordis.patch.yml','dist/index.js','dist/index.d.ts','dist/control.js','dist/control.d.ts','dist/client.js','dist/client/index.d.ts'];verifyFiles(files)
 for(const extra of['.test-artifacts/output.json','src/engine.ts','credentials.json','dist/client/style.css'])assert.throws(()=>verifyFiles([...files,extra]))
 assert.throws(()=>verifyFiles(files.filter(file=>file!=='dist/control.d.ts')))
})

test('paired pages and source text refuse broken alignment, credential literals and extra endings',async()=>{
 const en=await readFile(new URL('../README.md',import.meta.url),'utf8'),zh=await readFile(new URL('../README.zh.md',import.meta.url),'utf8');verifyPair(en,zh)
 assert.throws(()=>verifyPair(en,zh+'extra\n'));assert.throws(()=>verifyText('sk-'+ 'x'.repeat(24)+'\n','synthetic credential'));assert.throws(()=>verifyText('double\n\n','synthetic ending'));verifyText('one newline\n','synthetic safe text')
})

test('upgrade steps require paired files, migration sections and bounded complete text',async()=>{
 const directory=new URL('../docs/upgrade-guide/v0.1.0-development/task-observation/',import.meta.url),en=await readFile(new URL('guide.md',directory),'utf8'),zh=await readFile(new URL('guide.zh.md',directory),'utf8'),pair={en:'guide.md',zh:'guide.zh.md'}
 verifyUpgradeGuide(en,zh,pair);assert.throws(()=>verifyUpgradeGuide(en.replace('## Migration','## Notes'),zh,pair));assert.throws(()=>verifyUpgradeGuide(en,zh+'extra\n',pair));assert.throws(()=>verifyUpgradeGuide(en,zh,{en:'other.md',zh:'guide.zh.md'}))
})
