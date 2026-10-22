import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { ExtractHtmlResourcesInput, ExtractHtmlResourcesResult } from './types'

type Job = { input: ExtractHtmlResourcesInput; resolve(result: ExtractHtmlResourcesResult): void; reject(error: Error): void }
type Slot = { worker: Worker; job?: Job }
const slots: Slot[] = []
const waiting: Job[] = []

function createWorker(): Worker {
  const entry = path.join(__dirname, `htmlResourceAnalysisWorker${path.extname(__filename)}`)
  // Source tests use the installed TS loader. Built Electron loads its ordinary
  // compiled JS entry and has no runtime dependency on that development loader.
  return entry.endsWith('.ts')
    ? new Worker('const {workerData}=require("node:worker_threads"); require(workerData.loader); require(workerData.entry)', { eval: true, execArgv: [],
      workerData: { loader: require.resolve('tsx/cjs'), entry } })
    : new Worker(entry, { execArgv: [] })
}

function drain(): void {
  while (waiting.length) {
    let slot = slots.find(value => !value.job)
    if (!slot && slots.length < 2) {
      let worker: Worker
      try { worker = createWorker() }
      catch (error) { waiting.shift()!.reject(new Error(`HTML 资源分析未能启动：${error instanceof Error ? error.message : String(error)}`)); continue }
      slot = { worker }
      slots.push(slot)
      const current = slot
      worker.on('message', (reply: { ok: boolean; result: ExtractHtmlResourcesResult; error?: { message: string; name?: string } }) => {
        const job = current.job
        if (!job) return
        current.job = undefined
        worker.unref()
        if (reply.ok) job.resolve(reply.result)
        else job.reject(new Error(`HTML 资源分析未完成：${reply.error?.message ?? '分析进程没有返回结果'}`))
        drain()
      })
      const failed = (error: Error) => {
        const index = slots.indexOf(current)
        if (index < 0) return
        slots.splice(index, 1)
        current.job?.reject(new Error(`HTML 资源分析进程已退出：${error.message}`))
        current.job = undefined
        void worker.terminate()
        drain()
      }
      worker.on('error', failed)
      worker.on('exit', code => failed(new Error(`exit ${code}`)))
    }
    if (!slot) return
    const job = waiting.shift()!
    slot.job = job
    slot.worker.ref()
    try { slot.worker.postMessage(job.input) }
    catch (error) {
      slot.job = undefined
      slot.worker.unref()
      job.reject(new Error(`HTML 资源分析未能开始：${error instanceof Error ? error.message : String(error)}`))
    }
  }
}

/** Pure dependency analysis runs outside Main. Two reusable workers keep an
 * ordinary document responsive while another document's large script is read. */
export function analyzeHtmlResources(input: ExtractHtmlResourcesInput): Promise<ExtractHtmlResourcesResult> {
  return new Promise((resolve, reject) => { waiting.push({ input, resolve, reject }); drain() })
}
