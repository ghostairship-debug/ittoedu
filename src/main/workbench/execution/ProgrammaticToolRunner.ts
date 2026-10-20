import type { ModelToolDefinition } from '../../../shared/workbench/modelProvider'
import type { ModelToolCall, ToolResult } from '../../../shared/workbench/tools'
import { programmaticReadInputSchema, type ProgrammaticChildReceipt, type ProgrammaticFailure,
  type ProgrammaticJournalEntry, type ProgrammaticReadInput, type ProgrammaticReceipt } from '../../../shared/workbench/programmatic'
import type { ProgrammaticRuntime } from './ProgrammaticToolRuntime'
import { isIndependentReadTool } from './ReadOnlyToolScheduler'
import { contentApplyFact, exportFact, modelToolResult, operationFact, saveFact, serviceToolOutcome, toolFailed } from '../../../core/tools/modelToolResult'
import { boundedModelValue, MODEL_DELIVERY_BYTES, modelJsonBytes } from '../../../core/tools/modelDeliveryBudget'
import { waitForReadOnly } from './ReadOnlyToolWait'

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
    const attempts: { receipt: ProgrammaticChildReceipt; independent: boolean; invoked: boolean; settled: boolean }[] = []
    const reads = new Set<Promise<unknown>>()
    const controller = new AbortController()
    const readController = new AbortController()
    let cancellationReason: string | undefined
    const stop = () => { controller.abort(input.signal?.reason); readController.abort(input.signal?.reason) }
    input.signal?.addEventListener('abort', stop, { once: true })
    if (input.signal?.aborted) stop()
    let barrier: Promise<unknown> = Promise.resolve(), sequence = 0, accepting = true, starting = true, reporting = true
    const call = (name: string, parameters: unknown): Promise<ToolResult> => {
      if (!accepting || controller.signal.aborted) return Promise.reject(new Error(cancellationReason ?? '运行已停止，后续子调用未开始'))
      if (name === 'programmatic.execute')
        return Promise.reject(new Error('代码编排不能递归启动自身；请直接使用当前变量'))
      const callId = `${input.callId}:ptc:${++sequence}`
      const receipt: ProgrammaticChildReceipt = { callId, name, status: 'unknown', read: { runId: input.runId, callId } }
      children.push(receipt)
      const independent = isIndependentReadTool(name)
      const attempt = { receipt, independent, invoked: false, settled: false }
      attempts.push(attempt)
      const start = async (): Promise<ToolResult> => {
        if (!starting || controller.signal.aborted) {
          if (reporting) receipt.status = 'cancelled'
          throw new Error('运行已停止，排队子调用未开始')
        }
        let result: ToolResult
        attempt.invoked = true
        try { result = independent
          ? await waitForReadOnly(() => input.executeTool(callId, { name, input: parameters }), { signal: readController.signal })
          : await input.executeTool(callId, { name, input: parameters }) }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!reporting) throw error
          receipt.status = independent && readController.signal.aborted ? 'cancelled' : 'unknown'
          failures.push({ callId, name, code: receipt.status === 'cancelled'
            ? controller.signal.aborted ? 'run-stopped' : 'programmatic-read-retired' : 'programmatic-child-unknown', message })
          throw new Error(`${callId}: ${message}`)
        }
        if (!reporting) return result
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
      const scheduled = independent ? barrier.then(start) : Promise.all([barrier, ...reads]).then(start)
      const operation = scheduled.catch(error => {
        if (!reporting) throw error
        if (!attempt.invoked) {
          receipt.status = 'cancelled'
          failures.push({ callId, name, code: 'programmatic-child-not-started',
            message: cancellationReason ?? '前序调用失败或运行停止，排队子调用未开始' })
        }
        throw error
      })
      if (independent) reads.add(operation)
      else { reads.clear(); barrier = operation.catch(() => undefined) }
      void operation.then(() => { attempt.settled = true; reads.delete(operation) },
        () => { attempt.settled = true; reads.delete(operation) })
      return operation
    }
    let outcome: Awaited<ReturnType<ProgrammaticRuntime['execute']>>
    try { outcome = await runtime.execute({ code: input.code, definitions: input.definitions, signal: controller.signal, call }) }
    catch (error) { outcome = { status: input.signal?.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error) } }
    accepting = false
    starting = false
    // A script may return without awaiting calls. Pure reads can retire locally;
    // started writes remain unknown here and settle in the original Engine
    // journal. The parent cannot replay or roll back those operations.
    for (const attempt of attempts) {
      if (attempt.settled) continue
      if (!attempt.invoked || attempt.independent) {
        attempt.receipt.status = 'cancelled'
        failures.push({ callId: attempt.receipt.callId, name: attempt.receipt.name,
          code: !attempt.invoked ? 'programmatic-child-not-started' : controller.signal.aborted ? 'run-stopped' : 'programmatic-read-retired',
          message: !attempt.invoked ? '代码编排已结束，排队子调用未开始'
            : '代码编排的纯读等待已结束；底层读取可能仍在原尝试收尾，不重放调用' })
      }
    }
    // A queued read may still be waiting behind a started write's barrier, so
    // awaiting the read promise here would reintroduce an unbounded write wait.
    reporting = false
    readController.abort('代码编排已结束，未等待的纯读取已退役')
    input.signal?.removeEventListener('abort', stop)
    const status: ProgrammaticReceipt['status'] = controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled'
      : outcome.status === 'failed' ? children.some(child => child.status === 'completed') ? 'partial' : 'failed'
        : failures.length || children.some(child => child.status !== 'completed') ? 'partial' : 'completed'
    const error = cancellationReason ?? (outcome.status === 'completed' ? '代码编排包含失败子调用；已完成回执保留，可精确回读后接续' : outcome.error)
    const data: ProgrammaticReceipt = { status, atomic: false, read: { runId: input.runId, callId: input.callId },
      children: children.map(child => ({ ...child, read: { ...child.read } })), failures: failures.map(failure => ({ ...failure })),
      ...(outcome.status === 'completed' && status !== 'cancelled' ? { value: outcome.value } : { error }) }
    return status === 'completed' ? { kind: 'read', data }
      : { kind: 'error', code: status === 'cancelled' ? 'programmatic-cancelled' : 'programmatic-failed',
        message: error, data }
  }
}

/** A model working view only. Script values and exact journal records keep their original data. */
export function projectProgrammaticModelResult(parent: ProgrammaticJournalEntry, records: readonly ProgrammaticJournalEntry[]): ToolResult | undefined {
  const result = parent.result
  if (parent.call.name !== 'programmatic.execute' || !result || result.kind !== 'read' && result.kind !== 'error'
    || !result.data || typeof result.data !== 'object' || modelJsonBytes(result) <= MODEL_DELIVERY_BYTES) return result
  const data = result.data as ProgrammaticReceipt
  if (!data.read || data.read.callId !== parent.callId || !Array.isArray(data.children)) return result
  const journal = new Map(records.map(record => [record.callId, record]))
  const children = data.children.map(child => {
    const entry = journal.get(child.callId)
    // Interpret only actual child tools, never tool-shaped JSON authored by a script.
    if (!entry?.result || entry.call.name !== child.name || !child.callId.startsWith(`${parent.callId}:ptc:`)
      || !(contentApplyFact(entry.call.name, entry.result) || operationFact(entry.call.name, entry.result)
        || saveFact(entry.call.name, entry.result) || exportFact(entry.call.name, entry.result))) return child
    return { ...child, result: modelToolResult(entry.call.name, entry.result) }
  })
  const { value, ...receipt } = data
  const hasValue = Object.prototype.hasOwnProperty.call(data, 'value')
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : undefined
  const projected = { ...receipt, children, ...(hasValue ? {
    valueInfo: { type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value, serializedBytes: modelJsonBytes(value),
      ...(typeof value === 'string' || Array.isArray(value) ? { length: value.length } : {}),
      ...(keys ? { keys: keys.slice(0, 32), keyCount: keys.length } : {}) },
    valueRead: { tool: 'programmatic.read', input: { ...data.read, path: ['data', 'value'] },
      notice: '完整返回值保留在原运行回执；按 path 选择字段，字符串、数组或对象键可用 offset/limit 分页。已完成子调用不要重放。' },
  } : {}) }
  const page = boundedModelValue(projected, { path: ['data'], maxBytes: MODEL_DELIVERY_BYTES - 1000 })
  const { value: preview, ...delivery } = page
  return { ...result, data: { ...(preview as object), ...(!page.complete ? { modelDelivery: { ...delivery,
    read: { tool: 'programmatic.read', input: { ...data.read, path: ['data'] } },
    notice: '仅交付有界工作视图；children/failures 的未展示项保留在原回执，按精确路径或范围回读。' } } : {}) } }
}

/** Exact readback from existing durable child/parent records, with optional paging. */
export function readProgrammaticResult(input: ProgrammaticReadInput, records: readonly ProgrammaticJournalEntry[], options: { internal?: boolean } = {}): ToolResult {
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
  if ((request.offset !== undefined || request.limit !== undefined) && (value === null || typeof value !== 'string' && typeof value !== 'object'))
    return { kind: 'error', code: 'programmatic-result-range', message: 'offset/limit 仅适用于字符串、数组或对象键' }
  if (typeof value === 'string' && request.offset && /[\uD800-\uDBFF]/.test(value[request.offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(value[request.offset] ?? ''))
    return { kind: 'error', code: 'programmatic-result-range', message: 'offset 切断了一个字符，请使用回执给出的 nextOffset' }
  if (options.internal && request.offset === undefined && request.limit === undefined)
    return { kind: 'read', data: { ...reference, path, value } }
  const page = boundedModelValue(value, { path, offset: request.offset, limit: request.limit,
    ...(options.internal ? { maxBytes: Number.MAX_SAFE_INTEGER } : {}) })
  return { kind: 'read', data: { ...reference, ...page, ...(!page.complete || page.omitted?.length ? {
    read: { tool: 'programmatic.read', input: { ...reference, path } },
    notice: '这是原回执的有界片段；omitted 中的 path 与 nextOffset 精确指向未展示部分，完整原值仍保留。',
  } : {}) } }
}
