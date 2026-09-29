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
  const imageMessages = messages.flatMap((message, index) => index >= initialCount && Array.isArray(message.content)
    && message.content.some(imagePart) ? [index] : [])
  const retained = new Set(imageMessages.slice(-2))
  const assistantTurns = messages.flatMap((message, index) => index >= initialCount && message.role === 'assistant'
    && Array.isArray(message.tool_calls) && message.tool_calls.length ? [index] : [])
  const recentStart = retainToolTurns > 0 ? assistantTurns.at(-retainToolTurns) ?? initialCount : messages.length
  let imagesArchived = 0, encodedImageBytesRemoved = 0, toolBytesRemoved = 0
  const projected = messages.map((message, index): ModelChatMessage => {
    if (index < initialCount) return message
    const sourceId = contextMessageId(runId, index)
    if (Array.isArray(message.content) && !retained.has(index) && message.content.some(imagePart)) {
      const content = message.content.map(part => {
        if (!imagePart(part)) return part
        imagesArchived++; encodedImageBytesRemoved += Buffer.byteLength(part.image_url.url, 'utf8')
        return { type: 'text', text: `画面已存档（不是当前画面）；完整内容仍在原运行。用 context.read 的 sourceId=${sourceId} 列出并按图片索引重读。` }
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
