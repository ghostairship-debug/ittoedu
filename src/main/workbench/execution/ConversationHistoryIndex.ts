import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { InputContext } from '../../../shared/workbench/attachments'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { contextMessageId } from './ExecutionContextProjection'

/** One index entry per real conversation message; original run payloads never recursively copy into new tasks. */
export async function conversationHistoryIndex(conversation: ConversationRecord,
  readRun: (runId: string) => Promise<ExecutionRunRecord | null>): Promise<{ context: InputContext['context']; hasImages: boolean }> {
  const history = conversation.messages.filter(message => message.role === 'user' || message.role === 'assistant')
  let hasImages = false
  const cache = new Map<string, ExecutionRunRecord | null>(), entries: InputContext['context'][number][] = []
  const lastAssistantIndex = new Map<string, number>()
  for (const [position, message] of history.entries()) {
    if (message.runId && !cache.has(message.runId)) cache.set(message.runId, await readRun(message.runId))
    const run = message.runId ? cache.get(message.runId) : null
    let index = -1
    if (run?.input.conversationId === conversation.conversationId) {
      if (message.role === 'user') index = run.initialPayload?.userText?.messageIndex ?? run.initialPayload?.explicitAttachments[0]?.messageIndex ?? -1
      else for (let i = (lastAssistantIndex.get(run.runId) ?? (run.initialMessageCount - 1)) + 1; i < run.messages.length; i++) {
        if (run.messages[i]!.role === 'assistant' && run.messages[i]!.content === message.text) {
          index = i; lastAssistantIndex.set(run.runId, i); break
        }
      }
    }
    const original = index >= 0 ? run?.messages[index] : null
    if (!run || !original || original.role !== message.role) {
      entries.push({ message: { role: message.role, content: message.text + (message.attachmentIds.length ? '\n历史附件原始运行不可回读；未再次发送或声称已读。' : '') },
        provenance: { kind: 'history', id: message.messageId } })
      continue
    }
    if (Array.isArray(original.content) && original.content.some(part => part && typeof part === 'object' && !Array.isArray(part) && part.type === 'image_url')) hasImages = true
    const sourceId = contextMessageId(run.runId, index), maxChars = position >= history.length - 2 ? 8000 : 600
    const attachments = message.role === 'user' ? run.initialPayload?.explicitAttachments ?? [] : []
    entries.push({ message: { role: message.role, content: JSON.stringify({ sourceId, text: message.text.slice(0, maxChars),
      characters: message.text.length, truncated: message.text.length > maxChars, attachmentCount: attachments.length,
      attachmentNames: attachments.slice(0, 8).map(item => item.name), attachmentsTruncated: attachments.length > 8,
      notice: '历史索引，不是重新发送的附件或原文。用 context.read 按 sourceId 取回原消息、分页文本和所选图片；material.list 可列出原附件来源；仅当前显式输入自动发送原件。' }) },
      provenance: { kind: 'history', id: sourceId } })
  }
  return { context: entries, hasImages }
}
