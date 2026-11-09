/** Revision identity covers parsed operator fields without environment or data-body inputs. */
import {createHash} from 'node:crypto'
import {FIELDS,type Settings} from './fields.ts'
import type {TaskRecord} from './types.ts'
/** @param value - complete parsed settings. @returns deterministic revision independent of property order. */
export function configRevision(value:Settings):string{return createHash('sha256').update(JSON.stringify(Object.keys(FIELDS).map(key=>[key,value[key as keyof Settings]]))).digest('hex')}
/** @param record - retained task. @returns a body-free revision checked inside each owner mutation. */
export function taskRevision(record:TaskRecord):string{return createHash('sha256').update(JSON.stringify([record.id,record.digest,record.updatedAt,record.execution,record.attempts,record.failure,record.cancelRequested,record.outputs.map(value=>[value.id,value.digest,value.state,value.attempts,value.updatedAt,value.receipt])])).digest('hex')}
