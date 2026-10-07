import { contextBridge, ipcRenderer } from 'electron'
import type { ComputeWorkerInput, ComputeWorkerReply } from '../main/workbench/compute/ComputeBackend'

let started = false
contextBridge.exposeInMainWorld('computeWorkerAPI', {
  run(execute: (input: ComputeWorkerInput) => Promise<ComputeWorkerReply>): void {
    if (started) throw new Error('计算 worker 已启动')
    started = true
    ipcRenderer.once('compute:input', async (_event, input: ComputeWorkerInput) => {
      try { ipcRenderer.send('compute:result', await execute(input)) }
      catch (error) { ipcRenderer.send('compute:result', { executionId: input.executionId, exitCode: 1,
        stdout: '', stderr: error instanceof Error ? error.message : String(error), truncated: false, cancelled: false }) }
    })
    ipcRenderer.send('compute:ready')
  },
})
