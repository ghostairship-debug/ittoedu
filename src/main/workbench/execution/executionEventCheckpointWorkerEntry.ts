import { parentPort } from 'node:worker_threads'
import { restoreExecutionEvents, writeExecutionCheckpoint } from './executionEventCheckpoint'
import { ExecutionEventStoreError } from './executionEventLog'
import type { ExecutionEventCheckpointRequest, ExecutionEventCheckpointReply } from './executionEventCheckpointWorker'

const port = parentPort
if (!port) throw new Error('事件恢复入口只能由 worker 运行')
port.once('message', async (request: ExecutionEventCheckpointRequest) => {
  try {
    const result = request.type === 'restore' ? await restoreExecutionEvents(request.input) : await writeExecutionCheckpoint(request.input, request.temporary)
    port.postMessage({ ok: true, result } satisfies ExecutionEventCheckpointReply)
  } catch (value) {
    const error = value instanceof Error ? value : new Error(String(value))
    port.postMessage({ ok: false, error: { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}),
      ...(error instanceof ExecutionEventStoreError ? { code: error.code } : {}) } } satisfies ExecutionEventCheckpointReply)
  } finally { port.close() }
})
