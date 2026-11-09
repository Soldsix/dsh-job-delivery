/** Create owned build destinations without deleting previous evidence. */
import {mkdir} from 'node:fs/promises'
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true})
