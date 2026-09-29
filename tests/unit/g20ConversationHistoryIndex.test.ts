// @vitest-environment node
import { expect, it } from 'vitest'
import { conversationHistoryIndex } from '../../src/main/workbench/execution/ConversationHistoryIndex'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

function conversation(messages: ConversationRecord['messages']): ConversationRecord {
  return { conversationId: 'c', workspaceId: 'w', title: 'History fixture', messages, attachmentIds: [],
    runIndex: { builtinRunIds: ['r'], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [],
    frozenContextRefs: [], revision: 0, createdAt: 0, updatedAt: 0 }
}

it('M27 indexes repeated assistant wording by the actual chronological source message', async () => {
  const run = { runId: 'r', input: { conversationId: 'c' }, initialMessageCount: 1,
    initialPayload: { userText: { messageIndex: 0 }, explicitAttachments: [] },
    messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: 'same answer' },
      { role: 'assistant', content: 'same answer' }] } as unknown as ExecutionRunRecord
  const current = conversation([
    { messageId: 'u', role: 'user', text: 'question', attachmentIds: [], runId: 'r', createdAt: 0 },
    { messageId: 'a1', role: 'assistant', text: 'same answer', attachmentIds: [], runId: 'r', createdAt: 1 },
    { messageId: 'a2', role: 'assistant', text: 'same answer', attachmentIds: [], runId: 'r', createdAt: 2 },
  ])
  const readRun = async (runId: string) => runId === 'r' ? run : null
  const indexed = await conversationHistoryIndex(current, readRun)
  expect(indexed.context.map(item => item.provenance.id)).toEqual(['run:r:0', 'run:r:1', 'run:r:2'])
  expect(indexed.context.every(item => item.message.content && !String(item.message.content).includes('data:image/'))).toBe(true)
})

it('M27 indexes many old attachment names without copying their provenance into every later model request', async () => {
  const attachments = Array.from({ length: 200 }, (_, index) => ({ name: `material-${index}.pdf`,
    representationId: `extracted-${index}`, mediaType: 'application/pdf', provenance: { privateMarker: 'not-in-index' } }))
  const run = { runId: 'r', input: { conversationId: 'c' }, initialMessageCount: 1,
    initialPayload: { userText: { messageIndex: 0 }, explicitAttachments: attachments },
    messages: [{ role: 'user', content: 'materials' }] } as unknown as ExecutionRunRecord
  const current = conversation([
    { messageId: 'u', role: 'user', text: 'materials', attachmentIds: [], runId: 'r', createdAt: 0 },
  ])
  const indexed = await conversationHistoryIndex(current, async () => run)
  const content = indexed.context[0]!.message.content as string
  expect(JSON.parse(content)).toMatchObject({ attachmentCount: 200, attachmentNames: attachments.slice(0, 8).map(item => item.name),
    attachmentsTruncated: true })
  expect(content).not.toContain('privateMarker')
  expect(Buffer.byteLength(content)).toBeLessThan(2000)
})
