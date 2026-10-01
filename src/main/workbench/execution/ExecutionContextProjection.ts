import type { ModelChatMessage } from '../../../shared/workbench/modelProvider'

const imagePart = (part: unknown): part is { type: 'image_url'; image_url: { url: string } } => !!part && typeof part === 'object'
  && (part as { type?: unknown }).type === 'image_url' && typeof (part as { image_url?: { url?: unknown } }).image_url?.url === 'string'
export const contextMessageId = (runId: string, index: number) => `run:${runId}:${index}`
export function contextSourceIndex(sourceId: string): { runId: string; index: number } | null {
  const matched = /^run:([^:]+):(\d+)$/.exec(sourceId), index = matched ? Number(matched[2]) : -1
  return matched && Number.isSafeInteger(index) && index >= 0 ? { runId: matched[1], index } : null
}

/** A disposable model working view. Original messages and native tool pairing remain owned by RunStore. */
export function projectExecutionContext(runId: string, messages: readonly ModelChatMessage[], initialCount: number, retainToolTurns = 2) {
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
  const assistantTurns = messages.flatMap((message, index) => index >= initialCount && message.role === 'assistant'
    && Array.isArray(message.tool_calls) && message.tool_calls.length ? [index] : [])
  const recentStart = retainToolTurns > 0 ? assistantTurns.at(-retainToolTurns) ?? initialCount : messages.length
  let imagesArchived = 0, encodedImageBytesRemoved = 0, toolBytesRemoved = 0
  const projected = messages.map((message, index): ModelChatMessage => {
    if (index < initialCount && !(Array.isArray(message.content) && message.content.some(imagePart))) return message
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
    if (index < recentStart && message.role === 'tool' && typeof message.content === 'string' && message.content.length > 8000) {
      let receipt: unknown
      try {
        const original = JSON.parse(message.content)
        const result = original?.result
        receipt = { kind: original?.kind, ...(result && typeof result === 'object' ? { operation: {
          operationId: result.operationId, documentId: result.documentId, status: result.status, revision: result.revision,
        } } : {}) }
      } catch { /* The complete source remains readable even when a diagnostic wasn't JSON. */ }
      const content = JSON.stringify({ archivedContext: sourceId, receipt, characters: message.content.length,
        excerpt: message.content.slice(0, 1200), notice: '工作上下文片段，非完整结果；context.read 可按原位置重读。' })
      toolBytesRemoved += Buffer.byteLength(message.content, 'utf8') - Buffer.byteLength(content, 'utf8')
      return { ...message, content }
    }
    if (index < recentStart && message.role === 'assistant') {
      const tool_calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(call => {
        if (!call || typeof call !== 'object' || Array.isArray(call) || !call.function || typeof call.function !== 'object'
          || Array.isArray(call.function) || typeof call.function.arguments !== 'string' || call.function.arguments.length <= 8000) return call
        const argumentsText = JSON.stringify({ archivedArguments: sourceId, toolCallId: call.id, characters: call.function.arguments.length })
        toolBytesRemoved += Buffer.byteLength(call.function.arguments, 'utf8') - Buffer.byteLength(argumentsText, 'utf8')
        return { ...call, function: { ...call.function, arguments: argumentsText } }
      }) : undefined
      const content = typeof message.content === 'string' && message.content.length > 8000
        ? `历史过程文本（${message.content.length}字符）已保留于 ${sourceId}；context.read 可重读，当前以正式回执和目标为准。` : message.content
      if (typeof message.content === 'string' && typeof content === 'string') toolBytesRemoved += Buffer.byteLength(message.content) - Buffer.byteLength(content)
      return { ...message, content, ...(tool_calls ? { tool_calls } : {}) }
    }
    return message
  })
  return { messages: projected, imagesArchived, encodedImageBytesRemoved, toolBytesRemoved }
}
