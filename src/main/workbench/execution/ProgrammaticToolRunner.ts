import type { ModelToolDefinition } from '../../../shared/workbench/modelProvider'
import type { ModelToolCall, ToolResult } from '../../../shared/workbench/tools'
import { programmaticReadInputSchema, type ProgrammaticChildReceipt, type ProgrammaticFailure,
  type ProgrammaticJournalEntry, type ProgrammaticReadInput, type ProgrammaticReceipt } from '../../../shared/workbench/programmatic'
import type { ProgrammaticRuntime } from './ProgrammaticToolRuntime'
import { isIndependentReadTool } from './ReadOnlyToolScheduler'
import { serviceToolOutcome, toolFailed } from '../../../core/tools/modelToolResult'

export interface ProgrammaticToolExecution {
  runId: string
  callId: string
  code: string
  definitions: readonly ModelToolDefinition[]
  signal?: AbortSignal
  /** Must be Engine.executeHost, preserving its preflight, grants and receipts. */
  executeTool(callId: string, call: ModelToolCall): Promise<ToolResult>
}

function failureOf(name: string, result: ToolResult): { code: string; message: string } | null {
  if (result.kind === 'error') return result
  if (result.kind === 'document-operation' && 'code' in result.result)
    return result.result
  if (result.kind === 'read' && result.data && typeof result.data === 'object'
    && (result.data as { status?: unknown }).status === 'not-started')
    return { code: 'programmatic-child-cancelled',
      message: typeof (result.data as { reason?: unknown }).reason === 'string'
        ? (result.data as { reason: string }).reason : '用户已调整任务，旧调用未开始' }
  const outcome = serviceToolOutcome(name, result)
  // Starting or polling a job is valid control flow. Terminal failures and
  // unknown effects use the same interpretation as direct Engine calls.
  if (outcome?.status !== 'pending' && toolFailed(name, result))
    return { code: `tool-${outcome?.status ?? 'failed'}`, message: outcome?.message ?? '工具未得到正确成果；请回读原始回执' }
  return null
}
function statusOf(name: string, result: ToolResult): ProgrammaticChildReceipt['status'] {
  const failure = failureOf(name, result)
  if (!failure) return 'completed'
  if (failure.code === 'tool-unknown' || /outcome-unknown/.test(failure.code)) return 'unknown'
  if (/cancel|stop|abort/.test(failure.code)) return 'cancelled'
  return 'failed'
}

/** Runs control flow only. All application effects remain owned by the Engine. */
export class ProgrammaticToolRunner {
  constructor(private readonly runtime?: ProgrammaticRuntime) {}

  async execute(input: ProgrammaticToolExecution): Promise<ToolResult> {
    const runtime = this.runtime ?? new (await import('./ProgrammaticToolRuntime.js')).ChromiumProgrammaticRuntime()
    const children: ProgrammaticChildReceipt[] = [], failures: ProgrammaticFailure[] = []
    const pending = new Set<Promise<unknown>>(), reads = new Set<Promise<unknown>>()
    const controller = new AbortController()
    let cancellationReason: string | undefined
    const stop = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', stop, { once: true })
    if (input.signal?.aborted) stop()
    let barrier: Promise<unknown> = Promise.resolve(), sequence = 0, accepting = true, starting = true
    const call = (name: string, parameters: unknown): Promise<ToolResult> => {
      if (!accepting || controller.signal.aborted) return Promise.reject(new Error(cancellationReason ?? '运行已停止，后续子调用未开始'))
      if (name === 'programmatic.execute')
        return Promise.reject(new Error('代码编排不能递归启动自身；请直接使用当前变量'))
      const callId = `${input.callId}:ptc:${++sequence}`
      const receipt: ProgrammaticChildReceipt = { callId, name, status: 'unknown', read: { runId: input.runId, callId } }
      children.push(receipt)
      let invoked = false
      const start = async (): Promise<ToolResult> => {
        if (!starting || controller.signal.aborted) {
          receipt.status = 'cancelled'
          throw new Error('运行已停止，排队子调用未开始')
        }
        let result: ToolResult
        invoked = true
        try { result = await input.executeTool(callId, { name, input: parameters }) }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          receipt.status = input.signal?.aborted ? 'cancelled' : 'unknown'
          failures.push({ callId, name, code: receipt.status === 'cancelled' ? 'run-stopped' : 'programmatic-child-unknown', message })
          throw new Error(`${callId}: ${message}`)
        }
        receipt.status = statusOf(name, result)
        const failure = failureOf(name, result)
        if (failure) {
          failures.push({ callId, name, code: failure.code, message: failure.message })
          if (failure.code === 'programmatic-child-cancelled') {
            cancellationReason = failure.message
            accepting = starting = false
            controller.abort()
          }
          throw new Error(`${callId} [${failure.code}]: ${failure.message}`)
        }
        return result
      }
      // Independent reads may overlap. Writes, approvals and unknown tools form
      // barriers, including reads requested after a write in Promise.all.
      const independent = isIndependentReadTool(name)
      const scheduled = independent ? barrier.then(start) : Promise.all([barrier, ...reads]).then(start)
      const operation = scheduled.catch(error => {
        if (!invoked) {
          receipt.status = 'cancelled'
          failures.push({ callId, name, code: 'programmatic-child-not-started',
            message: cancellationReason ?? '前序调用失败或运行停止，排队子调用未开始' })
        }
        throw error
      })
      if (independent) reads.add(operation)
      else { reads.clear(); barrier = operation.catch(() => undefined) }
      pending.add(operation)
      void operation.then(() => { pending.delete(operation); reads.delete(operation) },
        () => { pending.delete(operation); reads.delete(operation) })
      return operation
    }
    let outcome: Awaited<ReturnType<ProgrammaticRuntime['execute']>>
    try { outcome = await runtime.execute({ code: input.code, definitions: input.definitions, signal: controller.signal, call }) }
    catch (error) { outcome = { status: input.signal?.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error) } }
    accepting = false
    if (outcome.status !== 'completed') starting = false
    // A script may return without awaiting its calls. Already-started work still
    // settles and keeps its real receipt; no mutation is replayed or rolled back.
    await Promise.allSettled([...pending])
    input.signal?.removeEventListener('abort', stop)
    const status: ProgrammaticReceipt['status'] = controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled'
      : outcome.status === 'failed' ? children.some(child => child.status === 'completed') ? 'partial' : 'failed'
        : failures.length || children.some(child => child.status !== 'completed') ? 'partial' : 'completed'
    const error = cancellationReason ?? (outcome.status === 'completed' ? '代码编排包含失败子调用；已完成回执保留，可精确回读后接续' : outcome.error)
    const data: ProgrammaticReceipt = { status, atomic: false, read: { runId: input.runId, callId: input.callId }, children, failures,
      ...(outcome.status === 'completed' && status !== 'cancelled' ? { value: outcome.value } : { error }) }
    return status === 'completed' ? { kind: 'read', data }
      : { kind: 'error', code: status === 'cancelled' ? 'programmatic-cancelled' : 'programmatic-failed',
        message: error, data }
  }
}

/** Exact readback from existing durable child/parent records, with optional paging. */
export function readProgrammaticResult(input: ProgrammaticReadInput, records: readonly ProgrammaticJournalEntry[]): ToolResult {
  const parsed = programmaticReadInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'error', code: 'programmatic-read-invalid', message: '回读参数无效' }
  const request = parsed.data, entry = records.find(record => record.callId === request.callId)
  const parentId = entry?.call.name === 'programmatic.execute' ? request.callId : request.callId.replace(/:ptc:\d+$/, '')
  const parent = records.find(record => record.callId === parentId && record.call.name === 'programmatic.execute')
  if (!entry || !parent) return { kind: 'error', code: 'programmatic-result-missing', message: '当前运行没有该代码编排回执' }
  if (!entry.result) return { kind: 'error', code: 'programmatic-result-pending', message: '该调用尚无正式结果，未重放调用' }
  let value: unknown = entry.result
  const path = request.path ?? []
  const reference = { ...(request.runId ? { runId: request.runId } : {}), callId: request.callId }
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key))
      return { kind: 'error', code: 'programmatic-result-path', message: '回执中不存在指定字段' }
    value = (value as Record<string | number, unknown>)[key]
  }
  if (request.offset !== undefined || request.limit !== undefined) {
    if (typeof value !== 'string' && !Array.isArray(value))
      return { kind: 'error', code: 'programmatic-result-range', message: 'offset/limit 仅适用于字符串或数组' }
    const total = value.length, offset = request.offset ?? 0
    const end = request.limit === undefined ? total : Math.min(total, offset + request.limit)
    return { kind: 'read', data: { ...reference, path, value: value.slice(offset, end), offset, total,
      ...(end < total ? { nextOffset: end } : {}) } }
  }
  return { kind: 'read', data: { ...reference, path, value } }
}
