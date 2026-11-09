/** Download fixed public release inputs and verify their exact published hashes. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const directory=new URL('../.test-artifacts/release-inputs/',import.meta.url);await mkdir(directory,{recursive:true})
const inputs=[['dsh-im-kit','48686023b7307e3296d403994ad5cfb5cc7bfa7e4be5ef423af934b5286c40f0']]
for(const [name,sha256] of inputs){
 const target=new URL(name+'-0.2.1.tgz',directory);let bytes
 try{bytes=await readFile(target)}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch('https://github.com/Soldsix/'+name+'/releases/download/v0.2.1/'+name+'-0.2.1.tgz',{signal:AbortSignal.timeout(90000)});assert.equal(response.ok,true,'Public release input download failed');bytes=new Uint8Array(await response.arrayBuffer())}
 assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,'Public release input hash mismatch')
 await writeFile(target,bytes);console.log(JSON.stringify({name,sha256,file:fileURLToPath(target)}))
}
