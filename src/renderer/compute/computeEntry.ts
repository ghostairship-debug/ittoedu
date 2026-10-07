import type { ComputeWorkerInput, ComputeWorkerReply } from '../../main/workbench/compute/ComputeBackend'

declare global { interface Window { computeWorkerAPI: { run(execute: (input: ComputeWorkerInput) => Promise<ComputeWorkerReply>): void } } }

window.computeWorkerAPI.run(input => new Promise((resolve, reject) => {
  // User Python can reach the worker's JS realm, which has no preload bridge, DOM or Node.
  const worker = new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<ComputeWorkerReply>) => { worker.terminate(); resolve(event.data) }
  worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Python worker 启动失败')) }
  worker.postMessage(input)
}))
