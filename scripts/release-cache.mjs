/** Verify one immutable artifact before caching bytes obtained from normal GitHub download routes. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {access} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
/** @param input - fixed public artifact metadata. @param primary - one ordinary download attempt. @param fallback - one authorized alternate download of the same asset. @returns verified bytes and route, without retrying corrupt content. */
export async function verifiedDownload(input,primary,fallback){
 let bytes,route='public-url',status
 try{const result=await primary();status=result.status;if(result.ok)bytes=result.bytes}catch(error){status='request-failed'}
 if(!bytes){bytes=await fallback(status);route='github-release-cli'}
 assert.equal(createHash('sha256').update(bytes).digest('hex'),input.sha256,'Immutable release input hash differs')
 return{bytes,route,primaryStatus:status}
}
/** @param executable - running Node executable. @returns the bundled npm CLI for maintained cache operations. */
export async function npmCli(executable=process.execPath){
 const directory=dirname(executable),candidates=[process.env.npm_execpath,join(directory,'node_modules/npm/bin/npm-cli.js'),resolve(directory,'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean)
 for(const candidate of candidates)try{await access(candidate);return candidate}catch(error){if(error.code!=='ENOENT')throw error}
 throw Error('The Node installation has no available npm CLI')
}
