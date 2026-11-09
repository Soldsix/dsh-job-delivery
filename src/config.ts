/** Explicit queue, storage and execution capacities; this plugin installs no polling schedule. */
import z from '@deepseek-ai/schemastery'
import {UNIT_NAME_RE} from '@deepseek-ai/dsh-storage'
/** Native operator settings. */
export interface Config{enabled:boolean;namespace:string;maxTasks:number;maxRecordBytes:number;maxPayloadBytes:number;maxReceiptBytes:number;maxRetainedBytes:number;maxOutputsPerTask:number;maxPartsPerOutput:number;maxTextChars:number;maxConcurrentExecutions:number;maxConcurrentDeliveries:number;maxExecutionsPerScope:number;maxDeliveriesPerScope:number;maxPendingMutations:number;executionTimeoutMs:number;deliveryTimeoutMs:number}
/** Disabled by default; the domain backend is selected through native DSH storage routing. */
export const Config:z<Config>=z.object({enabled:z.boolean().default(false),namespace:z.string().default('job_delivery'),maxTasks:z.number().min(1).max(100000).step(1).default(1000),maxRecordBytes:z.number().min(1024).max(16777216).step(1).default(4194304),maxPayloadBytes:z.number().min(1).max(8388608).step(1).default(524288),maxReceiptBytes:z.number().min(128).max(1048576).step(1).default(65536),maxRetainedBytes:z.number().min(1024).max(1073741824).step(1).default(16777216),maxOutputsPerTask:z.number().min(1).max(1000).step(1).default(32),maxPartsPerOutput:z.number().min(1).max(1000).step(1).default(32),maxTextChars:z.number().min(1).max(1000000).step(1).default(65536),maxConcurrentExecutions:z.number().min(1).max(128).step(1).default(4),maxConcurrentDeliveries:z.number().min(1).max(128).step(1).default(4),maxExecutionsPerScope:z.number().min(1).max(128).step(1).default(1),maxDeliveriesPerScope:z.number().min(1).max(128).step(1).default(1),maxPendingMutations:z.number().min(1).max(65536).step(1).default(256),executionTimeoutMs:z.number().min(100).max(86400000).step(1).default(300000),deliveryTimeoutMs:z.number().min(100).max(3600000).step(1).default(60000)})
/** @param config - parsed operator fields. @returns validated configuration without IO or hidden defaults. */
export function validateConfig(config:Config):Config{
 if(!UNIT_NAME_RE.test(config.namespace))throw new Error('Invalid task domain namespace')
 if(config.maxPayloadBytes>=config.maxRecordBytes)throw new Error('Task payload limit must leave space for record metadata and outputs')
 if(config.maxReceiptBytes>=config.maxRecordBytes)throw new Error('Receipt capacity must leave space for task metadata')
 if(config.maxRecordBytes>config.maxRetainedBytes)throw new Error('Task record limit exceeds retained data capacity')
 if(config.maxExecutionsPerScope>config.maxConcurrentExecutions||config.maxDeliveriesPerScope>config.maxConcurrentDeliveries)throw new Error('Per-scope concurrency exceeds the global limit')
 return config
}
