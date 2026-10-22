import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { ExecutionEventStoreError } from './executionEventLog'
import type { ExecutionEventCheckpointMeta, ExecutionEventRestoreInput, RestoredExecutionEvents } from './executionEventCheckpoint'

export type ExecutionEventCheckpointRequest =
  | { type: 'restore'; input: ExecutionEventRestoreInput }
  | { type: 'checkpoint'; input: ExecutionEventRestoreInput; temporary: string }
export type ExecutionEventCheckpointReply =
  | { ok: true; result: RestoredExecutionEvents | ExecutionEventCheckpointMeta }
  | { ok: false; error: { name: string; message: string; code?: ExecutionEventStoreError['code']; stack?: string } }

/** One fixed prefix owns a short-lived worker. Main keeps log repair/publication. */
function run<T>(request: ExecutionEventCheckpointRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const entry = path.join(__dirname, `executionEventCheckpointWorkerEntry${path.extname(__filename)}`)
    let worker: Worker
    try {
      worker = entry.endsWith('.ts')
        ? new Worker('const {workerData}=require("node:worker_threads"); require(workerData.loader); require(workerData.entry)', { eval: true, execArgv: [],
          workerData: { loader: require.resolve('tsx/cjs'), entry } })
        : new Worker(entry, { execArgv: [] })
    } catch (error) { reject(error); return }
    let settled = false
    const finish = (complete: () => void) => {
      if (settled) return
      settled = true; complete(); void worker.terminate().catch(() => undefined)
    }
    worker.once('message', (reply: ExecutionEventCheckpointReply) => finish(() => {
      if (reply.ok) resolve(reply.result as T)
      else {
        const error = reply.error.code ? new ExecutionEventStoreError(reply.error.code, reply.error.message) : new Error(reply.error.message)
        error.name = reply.error.name
        if (reply.error.stack) error.stack = reply.error.stack
        reject(error)
      }
    }))
    worker.once('error', error => finish(() => reject(error)))
    worker.once('exit', code => finish(() => reject(new Error(`事件恢复进程未返回结果（exit ${code}）`))))
    try { worker.postMessage(request) } catch (error) { finish(() => reject(error)) }
  })
}
export const restoreExecutionEventsInWorker = (input: ExecutionEventRestoreInput) => run<RestoredExecutionEvents>({ type: 'restore', input })
export const createExecutionCheckpointInWorker = (input: ExecutionEventRestoreInput, temporary: string) => run<ExecutionEventCheckpointMeta>({ type: 'checkpoint', input, temporary })
