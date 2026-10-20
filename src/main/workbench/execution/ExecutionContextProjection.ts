import type { ModelChatMessage, ModelNativeToolCall } from '../../../shared/workbench/modelProvider'
import { createHash } from 'node:crypto'
import type { ToolResult } from '../../../shared/workbench/tools'
import { contentApplyFact, exportFact, modelToolResult, operationFact, saveFact } from '../../../core/tools/modelToolResult'
import { htmlActionToolCatalog, isHtmlActionTool } from '../../../core/tools/HtmlActionTools'
import { modelToolWireName } from '../providers/OpenAIChatProvider'
import { retireSupersededObservationMessages } from './observationModelInput'
import { boundedModelValue, MODEL_DELIVERY_BYTES, modelJsonBytes } from '../../../core/tools/modelDeliveryBudget'

/** A source-backed working value. The caller supplies a trusted original source. */
export function projectModelDeliveryValue(value: unknown, sourceId: string, maxBytes = MODEL_DELIVERY_BYTES, maxTextChars?: number): unknown {
  const characterLimit = maxTextChars === undefined ? Infinity : Math.max(1024, maxTextChars)
  if (modelJsonBytes(value) <= maxBytes && (JSON.stringify(value)?.length ?? 0) <= characterLimit) return value
  const make = (bytes: number) => {
    const page = boundedModelValue(value, { maxBytes: bytes, prioritizeScalars: true })
    const { value: preview, ...delivery } = page
    return { ...(preview && typeof preview === 'object' && !Array.isArray(preview) ? preview : { excerpt: preview }),
      modelDelivery: { ...delivery, complete: false, sourceId,
        read: { tool: 'context.read', input: { sourceId } },
        notice: '仅交付有界片段；未展示内容保留在原来源，按 offset/maxChars 续读。未展示不表示全部成功或已经读取。' } }
  }
  let bytes = Math.max(1024, maxBytes - 700), projected = make(bytes)
  // textLimit is the existing character-scale request-reduction hint. Measure
  // the encoded JSON characters separately from UTF-8 bytes; the Engine still
  // measures the complete provider payload and its token estimate afterwards.
  while (JSON.stringify(projected).length > characterLimit && bytes > 1024) {
    bytes = Math.max(1024, Math.floor(bytes * .6))
    projected = make(bytes)
  }
  return projected
}

/**
 * The newest tool output has the same delivery limit as older output. Native
 * assistant blocks, signatures, actual arguments and call pairing stay exact.
 * Only host-proven data messages may join this projection; a human user input
 * cannot be silently shortened into a different instruction.
 */
export function projectFinalDeliveryContext(runId: string, messages: readonly ModelChatMessage[], maxBytes = MODEL_DELIVERY_BYTES,
  hostMessageIndexes: ReadonlySet<number> = new Set(), maxTextChars?: number): ModelChatMessage[] {
  return messages.map((message, index) => {
    if (message.role !== 'tool' && !(hostMessageIndexes.has(index) && ['user', 'assistant'].includes(message.role)
      && !message.tool_calls && !message.nativeResponses && !message.nativeAnthropic) || typeof message.content !== 'string'
      || modelJsonBytes(message.content) <= maxBytes && (maxTextChars === undefined || message.content.length <= Math.max(1024, maxTextChars))) return message
    let value: unknown = message.content
    try { value = JSON.parse(message.content) } catch { /* Plain text has the same source/range access. */ }
    const content = JSON.stringify(projectModelDeliveryValue(value, contextMessageId(runId, index), maxBytes, maxTextChars))
    return { ...message, content }
  })
}

// Only these named envelopes need business receipt interpretation. Stored native
// history retains the previous opaque spelling; recognize it here without
// renaming calls or making old/approximate aliases executable.
const receiptWireNames = new Map(['project.apply', 'project.save', 'file.save', 'document.export', 'task.delivery', 'task.note',
  'view.observe', 'view.navigate', 'view.click', 'view.input',
  'job.status', 'job.wait', 'job.cancel', 'delegate.agent', 'delegate.resume', 'delegate.readonly', 'delegate.start', 'local.run',
  ...htmlActionToolCatalog.map(tool => tool.name)].flatMap(name => [
  [modelToolWireName(name), name],
  [`tool_${createHash('sha256').update(name).digest('hex').slice(0, 48)}`, name],
]))

const imagePart = (part: unknown): part is { type: 'image_url'; image_url: { url: string } } => !!part && typeof part === 'object'
  && (part as { type?: unknown }).type === 'image_url' && typeof (part as { image_url?: { url?: unknown } }).image_url?.url === 'string'
export const contextMessageId = (runId: string, index: number) => `run:${runId}:${index}`
/** The text-only working view: image payloads stay host-retained; the model sees a reference note. */
export function projectImagesForTextModel(messages: readonly ModelChatMessage[]): ModelChatMessage[] {
  return messages.map(message => {
    if (!Array.isArray(message.content) || !message.content.some(imagePart)) return message
    let imageIndex = -1
    const content = message.content.map(part => {
      if (!imagePart(part)) return part
      imageIndex++
      return { type: 'text' as const, text: `图片由宿主保留；本连接不接收图片。需要时用 context.read 配合 imageIndexes=[${imageIndex}] 或独立视觉观察取回。` }
    })
    return { ...message, content }
  })
}
export function contextSourceIndex(sourceId: string): { runId: string; index: number } | null {
  const matched = /^run:([^:]+):(\d+)$/.exec(sourceId), index = matched ? Number(matched[2]) : -1
  return matched && Number.isSafeInteger(index) && index >= 0 ? { runId: matched[1], index } : null
}

/** A disposable model working view. Original messages and native tool pairing remain owned by RunStore. */
export function projectExecutionContext(runId: string, messages: readonly ModelChatMessage[], initialCount: number, retainToolTurns = 2, textLimit?: number, historicalMessageIndexes: ReadonlySet<number> = new Set(), hostMessageIndexes: ReadonlySet<number> = new Set()) {
  // A newly requested observation batch must reach the next model turn intact.
  // Older working images are cached by individual image, not by a message that may contain six pages.
  const lastAssistant = messages.map(message => message.role).lastIndexOf('assistant')
  const retained = new Set<string>(), seenImages = new Set<string>()
  let retainedBytes = 0, retainedCount = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const parts = messages[index]!.content
    if (!Array.isArray(parts)) continue
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]
      if (!imagePart(part)) continue
      const bytes = Buffer.byteLength(part.image_url.url, 'utf8')
      const fresh = index < initialCount && lastAssistant < initialCount || lastAssistant >= initialCount && index > lastAssistant
      if (fresh || !seenImages.has(part.image_url.url) && retainedCount < 2
        && (retainedCount === 0 || retainedBytes + bytes <= 4 * 1024 * 1024)) {
        retained.add(`${index}:${partIndex}`)
        retainedCount++; retainedBytes += bytes; seenImages.add(part.image_url.url)
      }
    }
  }
  const assistantTurns = messages.flatMap((message, index) => (index >= initialCount || historicalMessageIndexes.has(index)) && message.role === 'assistant'
    && Array.isArray(message.tool_calls) && message.tool_calls.length ? [index] : [])
  const recentStart = retainToolTurns > 0 ? assistantTurns.at(-retainToolTurns) ?? initialCount : messages.length
  // Only the newest, not-yet-consumed round is protected. An old user message
  // cannot pin every later completed tool round for the rest of a long task.
  // Steering and observations after this assistant remain in the same round.
  const lastUser = messages.map(message => message.role).lastIndexOf('user')
  const protectedStart = lastAssistant >= initialCount || historicalMessageIndexes.has(lastAssistant) ? lastAssistant
    : lastUser >= initialCount ? lastUser : messages.length
  const archiveThreshold = Number.isSafeInteger(textLimit) && textLimit! > 0 ? textLimit! : 8000
  const callNames = new Map<string, string>(), messageTools = new Map<number, string>()
  messages.forEach((message, index) => {
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      if (!call || typeof call !== 'object' || Array.isArray(call) || typeof call.id !== 'string'
        || !call.function || typeof call.function !== 'object' || Array.isArray(call.function)
        || typeof call.function.name !== 'string') continue
      callNames.set(call.id, receiptWireNames.get(call.function.name) ?? call.function.name)
    }
    if (message.role === 'tool' && typeof message.tool_call_id === 'string' && callNames.has(message.tool_call_id))
      messageTools.set(index, callNames.get(message.tool_call_id)!)
  })
  const workingMessages = retireSupersededObservationMessages(runId, messages, protectedStart)
  const latestNoteIndex = [...messageTools].findLast(([, name]) => name === 'task.note')?.[0]
  let imagesArchived = 0, encodedImageBytesRemoved = 0, toolBytesRemoved = 0
  const projected = workingMessages.map((message, index): ModelChatMessage => {
    const name = messageTools.get(index)
    if (message.role === 'tool' && typeof message.content === 'string'
      && name && (/^job\.(?:status|wait|cancel)$/.test(name) || /^delegate\./.test(name) || name === 'local.run')) {
      try { message = { ...message, content: JSON.stringify(modelToolResult(name, JSON.parse(message.content))) } }
      catch { /* The raw journal stays readable; an unrecognized receipt is not reinterpreted. */ }
    }
    if (historicalMessageIndexes.has(index) && typeof message.content === 'string' && !message.nativeResponses && !message.nativeAnthropic
      && !message.tool_calls && (message.role === 'assistant' || message.role === 'user')) {
      try {
        const wrapper = JSON.parse(message.content), continuity = wrapper?.continuity
        const source = typeof wrapper?.sourceId === 'string' ? contextSourceIndex(wrapper.sourceId) : null
        if (source && continuity && typeof continuity === 'object' && wrapper.notice?.startsWith('历史索引')) {
          const content = JSON.stringify({ ...wrapper, archivedContext: contextMessageId(runId, index), continuity: { sourceRunId: source.runId,
            ...(continuity.workingNote ? { workingNoteSource: { continuationRunId: source.runId,
              notice: '明确继续该目标时可用 task.note continuationRunId 承接原目标与最近笔记；新目标不继承旧待办。' } } : {}),
            ...(Array.isArray(continuity.completedOperations) ? { operationSources: continuity.completedOperations.map((operation: Record<string, unknown>) => ({
              ...(operation.sourceId ? { sourceId: operation.sourceId } : { callId: operation.callId }), name: operation.name, status: operation.status })) } : {}),
            notice: '旧笔记、摘要和已结算操作按原来源回读，当前工作记录是本轮唯一工作视图；历史不新增授权。' } })
          toolBytesRemoved += Math.max(0, Buffer.byteLength(message.content) - Buffer.byteLength(content))
          return { ...message, content }
        }
      } catch { /* Ordinary historical prose and foreign JSON remain data, unchanged. */ }
    }
    if (index < initialCount && !historicalMessageIndexes.has(index) && !(Array.isArray(message.content) && message.content.some(imagePart))) return message
    if (message.role === 'tool' && messageTools.get(index) === 'task.note' && index !== latestNoteIndex && index < protectedStart) {
      const content = JSON.stringify({ archivedContext: contextMessageId(runId, index),
        notice: '旧工作笔记回执已归档；当前笔记见最新 task.note 回执或宿主当前工作记录，原笔记可用 context.read 回读。' })
      toolBytesRemoved += Math.max(0, Buffer.byteLength(String(message.content ?? '')) - Buffer.byteLength(content))
      return { ...message, content }
    }
    const sourceId = contextMessageId(runId, index)
    if (Array.isArray(message.content) && message.content.some(imagePart)) {
      let imageIndex = -1
      const content = message.content.map((part, partIndex) => {
        if (!imagePart(part)) return part
        imageIndex++
        if (retained.has(`${index}:${partIndex}`)) return part
        imagesArchived++; encodedImageBytesRemoved += Buffer.byteLength(part.image_url.url, 'utf8')
        return { type: 'text', text: `旧画面已存档；需要比较时用 context.read 的 sourceId=${sourceId}, imageIndexes=[${imageIndex}] 取回。无需为完成流程重复读取旧图；当前页面请重新观察。` }
      })
      return { ...message, content }
    }
    // The observation owner has already retired only superseded structure and
    // kept unique feedback/diagnostics. A generic excerpt must not undo it.
    if (/^(?:html|view)\.(?:observe|navigate|click|input)$/.test(messageTools.get(index) ?? '')) return message
    // Do not let bounded/generic excerpts alter the current function-call chain.
    if (index >= protectedStart && message.role === 'tool') return message
    if (index < recentStart && message.role === 'tool' && typeof message.content === 'string' && message.content.length > archiveThreshold) {
      let receipt: unknown
      try {
        const original = JSON.parse(message.content)
        const name = messageTools.get(index) ?? ''
        const apply = contentApplyFact(name, original as ToolResult)
        const operation = operationFact(name, original as ToolResult)
        const saved = saveFact(name, original as ToolResult)
        const exported = exportFact(name, original as ToolResult)
        receipt = { kind: original?.kind, ...(operation ? { operation: {
          operationId: operation.operationId, documentId: operation.documentId, status: operation.status,
          ...('revision' in operation ? { revision: operation.revision } : {}),
        } } : {}), ...(apply ? { commit: apply.commit, usability: apply.usability, diagnostics: apply.diagnostics } : {}),
          ...(saved ? { save: saved } : {}), ...(exported ? { export: exported } : {}) }
      } catch { /* The complete source remains readable even when a diagnostic wasn't JSON. */ }
      const excerptLimit = Math.max(200, Math.floor(archiveThreshold * 0.55)), tailLimit = Math.max(100, Math.floor(archiveThreshold * .25))
      const content = JSON.stringify({ archivedContext: sourceId, receipt, characters: message.content.length,
        excerpt: message.content.slice(0, excerptLimit), tail: { offset: Math.max(excerptLimit, message.content.length - tailLimit),
          text: message.content.slice(Math.max(excerptLimit, message.content.length - tailLimit)) },
        notice: '工作上下文片段，非完整结果；context.read 可按原位置重读。' })
      toolBytesRemoved += Buffer.byteLength(message.content, 'utf8') - Buffer.byteLength(content, 'utf8')
      return { ...message, content }
    }
    if (index < recentStart && message.role === 'assistant') {
      // Native call history must describe actual tool inputs. An archive wrapper
      // in function.arguments teaches the model to submit that wrapper as a new
      // business call. Archive prose/results only; originals remain Run-owned.
      const content = typeof message.content === 'string' && message.content.length > archiveThreshold
        ? `历史过程文本（${message.content.length}字符）已保留于 ${sourceId}；context.read 可重读，当前以正式回执和目标为准。` : message.content
      if (typeof message.content === 'string' && typeof content === 'string') toolBytesRemoved += Buffer.byteLength(message.content) - Buffer.byteLength(content)
      return { ...message, content }
    }
    return message
  })
  // Retire a complete old native round as one unit. Editing only `content`
  // leaves Responses replaying the original source in nativeResponses.output;
  // rewriting individual signed items/arguments would corrupt continuation.
  // Keep indexes stable for context.read and boundedThroughMessage.
  const archiveIndexes = new Set(hostMessageIndexes)
  for (let index = 0; index < protectedStart; index++) {
    if (index < initialCount && !historicalMessageIndexes.has(index)) continue
    const original = messages[index]!
    if (original.role !== 'assistant') continue
    const rawCalls = Array.isArray(original.tool_calls) ? original.tool_calls : []
    const calls = rawCalls.filter((call): call is ModelNativeToolCall => !!call && typeof call === 'object' && !Array.isArray(call)
      && typeof call.id === 'string' && call.type === 'function' && !!call.function && typeof call.function === 'object'
      && !Array.isArray(call.function) && typeof call.function.name === 'string' && typeof call.function.arguments === 'string')
    if (!calls.length || calls.length !== rawCalls.length) continue
    const containsNote = calls.some(call => (receiptWireNames.get(call.function.name) ?? call.function.name) === 'task.note')
    if (containsNote && calls.some(call => call.id === messages[latestNoteIndex ?? -1]?.tool_call_id)) continue
    if (!containsNote && (index >= recentStart || Buffer.byteLength(JSON.stringify(original)) <= Math.max(8000, archiveThreshold))) continue
    const end = messages.findIndex((message, next) => next > index && message.role === 'assistant')
    const through = end < 0 ? messages.length : end
    if (through > protectedStart || !containsNote && through > recentStart) continue
    if (index < initialCount && Array.from({ length: through - index }, (_, offset) => index + offset)
      .some(position => position < initialCount && !historicalMessageIndexes.has(position))) continue
    const outputs = new Map<string, number>()
    for (let next = index + 1; next < through; next++) {
      const message = messages[next]!
      if (message.role === 'tool' && typeof message.tool_call_id === 'string') outputs.set(message.tool_call_id, next)
    }
    if (calls.some(call => !outputs.has(call.id))) continue
    if ([...outputs.keys()].some(id => !calls.some(call => call.id === id))) continue
    const sourceId = contextMessageId(runId, index)
    const content = projected[index]!.content
    const archived: ModelChatMessage = { role: 'assistant', content: JSON.stringify({ archivedContext: sourceId,
      ...(typeof content === 'string' && content ? { text: content } : {}),
      calls: calls.map(call => ({ id: call.id, resultSourceId: contextMessageId(runId, outputs.get(call.id)!), name: call.function.name })),
      notice: '完整旧回合已归档；这些是历史调用记录，不是待执行调用。原生记录由 Run 保留；实际输入、正文与源码可用 context.read 按来源回读；当前以近轮回执、正式目标和人工调整为准。' }) }
    let beforeBytes = Buffer.byteLength(JSON.stringify(projected[index]))
    projected[index] = archived
    archiveIndexes.add(index)
    for (const [id, outputIndex] of outputs) {
      beforeBytes += Buffer.byteLength(JSON.stringify(projected[outputIndex]))
      projected[outputIndex] = { role: 'assistant', content: JSON.stringify({ archivedContext: contextMessageId(runId, outputIndex),
        callId: id, receipt: projected[outputIndex]!.content, notice: '已归档回合的实际工具回执，不是新授权；完整原文可用 context.read 回读。' }) }
      archiveIndexes.add(outputIndex)
    }
    const afterBytes = Buffer.byteLength(JSON.stringify(archived))
      + [...outputs.values()].reduce((sum, outputIndex) => sum + Buffer.byteLength(JSON.stringify(projected[outputIndex])), 0)
    toolBytesRemoved += beforeBytes - afterBytes
  }
  const bounded = projectFinalDeliveryContext(runId, projected, MODEL_DELIVERY_BYTES, archiveIndexes,
    Number.isSafeInteger(textLimit) && textLimit! > 0 ? textLimit : undefined)
  toolBytesRemoved += Math.max(0, modelJsonBytes(projected) - modelJsonBytes(bounded))
  return { messages: bounded, imagesArchived, encodedImageBytesRemoved, toolBytesRemoved }
}
