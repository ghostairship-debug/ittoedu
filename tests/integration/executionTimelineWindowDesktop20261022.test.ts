// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'
import type { ExecutionTimelineEntryPage, ExecutionTimelineGroupPage } from '../../src/shared/workbench/executionTimelineWindow'

const roots: string[] = [], services: ExecutionDesktopService[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const service of services.splice(0)) { await service.shutdown(); await service.events.flushMaintenance() }
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-window-')); roots.push(root)
  const workspaceRoot = path.join(root, 'workspace'); await fs.mkdir(workspaceRoot)
  const documents = new DocumentHostService(path.join(root, 'journals'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: value => Buffer.from(value).toString(),
  } })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }) }); services.push(service)
  const workspace = await service.operate({ type: 'workspace', root: workspaceRoot }) as { workspace: { workspaceId: string } }
  let conversation = await service.conversations.createConversation({ workspaceId: workspace.workspace.workspaceId })
  conversation = await service.conversations.updateConversation({ ...conversation, expectedRevision: conversation.revision, patch: {
    messages: Array.from({ length: 45 }, (_, index) => ({ messageId: `message-${index}`, role: 'user', text: `user ${index}`, createdAt: index, attachmentIds: [] })),
  } })
  const client = { id: 'window:fixture', isCurrent: () => true }
  const input = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId, consumerId: 'view', userHistoryRevision: conversation.revision }
  const event = (index: number, extra: Partial<ExecutionEventInput> = {}): ExecutionEventInput => ({ eventId: `event-${index}`,
    conversationId: conversation.conversationId, taskId: 'task', runId: 'run', itemId: `item-${index}`, time: index + 100,
    source: 'builtin', type: 'reasoning', update: 'append', data: { text: `reasoning ${index}` }, ...extra })
  service.events.retain(conversation.conversationId, 'run:fixture')
  return { service, conversation, client, input, event }
}
describe('actual Desktop timeline windows', () => {
  it('transports an entry/group/body window while retaining complete global interaction facts and history', async () => {
    const { service, conversation, client, input, event } = await fixture()
    await service.events.batchAppend(Array.from({ length: 1200 }, (_, index) => event(index)))
    await service.events.append(event(1200, { itemId: 'question', time: 0, type: 'tool', data: { toolName: 'ask_user', status: 'waiting', question: { text: '真实选择？', multiple: false, options: [{ label: '保留' }] } } }))
    const answer = '正文内容'.repeat(60_000)
    await service.events.batchAppend(Array.from({ length: 60 }, (_, index) => event(1201 + index, { itemId: 'answer', time: 3000, type: 'text', data: { text: answer.slice(index * 4_000, (index + 1) * 4_000) } })))
    await service.events.batchAppend(Array.from({ length: 230 }, (_, index) => event(1300 + index, { runId: 'tools', type: 'tool', time: 4000 + index, data: { toolName: 'document.read', status: 'completed', label: `read ${index}` } })))
    const page = await service.operate({ type: 'timeline-window', ...input, includeEndedRuns: true }, client) as ExecutionTimelineEntryPage
    expect(page.entries).toHaveLength(100)
    expect(page.total).toBeGreaterThan(1200)
    expect(page.pendingQuestion?.question.text).toBe('真实选择？')
    expect(page.activity.busy).toBe(true)
    const reply = page.entries.find(entry => entry.kind === 'item' && entry.item.itemId === 'answer')
    expect(reply?.kind).toBe('item')
    if (reply?.kind !== 'item') throw new Error('Missing reply')
    expect(reply.item.body.parts[0]).toMatchObject({ kind: 'text', text: answer.slice(0, 12000), total: answer.length, hasMore: true })
    const group = page.entries.find(entry => entry.kind === 'tools')
    if (group?.kind !== 'tools') throw new Error('Missing group')
    expect(group.itemCount).toBe(230); expect(group.items).toHaveLength(100)
    const next = await service.operate({ type: 'timeline-group', ...input, key: group.key, itemStart: 100 }, client) as ExecutionTimelineGroupPage
    expect(next.itemStart).toBe(100); expect(next.items).toHaveLength(100); expect(next.cursor).toBe(page.cursor)
    const body = await service.operate({ type: 'timeline-body', ...input, runId: 'run', itemId: 'answer', part: 0, complete: true }, client) as { text: string; total: number }
    expect(body.text).toBe(answer); expect(body.total).toBe(answer.length)
    const complete = await service.events.snapshot(conversation.conversationId)
    expect(JSON.stringify(page).length).toBeLessThan(JSON.stringify(complete).length / 2)
    expect(complete.items).toHaveLength(1432)
    expect((await service.events.readPage({ conversationId: conversation.conversationId, limit: 5000 })).events).toHaveLength(1491)
  })
  it('keeps two real view message selections independent and avoids rereading the full conversation on each delta', async () => {
    const { service, client, input, event } = await fixture()
    await service.events.batchAppend(Array.from({ length: 100 }, (_, index) => event(index)))
    const reads = vi.spyOn(service.conversations, 'readConversation')
    const first = await service.operate({ type: 'timeline-window', ...input, userHistoryRevision: 0, start: 0 }, client) as ExecutionTimelineEntryPage
    expect(first.userHistoryRevision).toBeGreaterThan(0)
    const ids = (page: ExecutionTimelineEntryPage) => page.entries.flatMap(entry => entry.kind === 'message' ? [entry.message.messageId] : [])
    expect(ids(first)).toEqual(Array.from({ length: 20 }, (_, index) => `message-${25 + index}`))
    const second = await service.operate({ type: 'timeline-window', ...input, consumerId: 'older', userHistoryOffset: 1, start: 0 }, client) as ExecutionTimelineEntryPage
    expect(second.userHistoryOffset).toBe(1)
    expect(ids(second)).toEqual(Array.from({ length: 20 }, (_, index) => `message-${5 + index}`))
    const clamped = await service.operate({ type: 'timeline-window', ...input, consumerId: 'clamped', userHistoryOffset: 99, start: 0 }, client) as ExecutionTimelineEntryPage
    expect(clamped.userHistoryOffset).toBe(2)
    expect(ids(clamped)).toEqual(Array.from({ length: 5 }, (_, index) => `message-${index}`))
    await service.operate({ type: 'release-timeline', conversationId: input.conversationId, consumerId: 'clamped' }, client)
    const count = reads.mock.calls.length
    await service.events.append(event(100, { itemId: 'item-99', data: { text: ' increment' } }))
    const again = await service.operate({ type: 'timeline-window', ...input, userHistoryRevision: 0, start: 0 }, client) as ExecutionTimelineEntryPage
    expect(ids(again)).toEqual(ids(first)); expect(reads).toHaveBeenCalledTimes(count)
    await service.operate({ type: 'release-timeline', conversationId: input.conversationId, consumerId: 'view' }, client)
    const loaded = (service.events as unknown as { loaded: Map<string, { readers: Map<string, unknown> }> }).loaded.get(input.conversationId)!
    expect(loaded.readers.size).toBe(1)
  })
  it('does not publish or retain a late view after its renderer closes during authoritative history loading', async () => {
    const { service, input } = await fixture()
    let current = true, entered!: () => void, resume!: () => void
    const arrived = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { resume = resolve })
    const read = service.conversations.readConversation.bind(service.conversations)
    vi.spyOn(service.conversations, 'readConversation').mockImplementation(async value => { entered(); await blocked; return read(value) })
    const client = { id: 'closing', isCurrent: () => current }
    const pending = service.operate({ type: 'timeline-window', ...input }, client), rejected = expect(pending).rejects.toThrow()
    await arrived; current = false; await service.releaseTimelineClient(client.id); resume(); await rejected
    const consumers = (service.events as unknown as { consumers: Map<string, Set<string>> }).consumers.get(input.conversationId)!
    expect([...consumers]).toEqual(['run:fixture'])
  })
})
