// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../../../src/shared/workbench/conversations'
import type { ElementChangeView, ExecutionDocumentReference, ExecutionSendResult } from '../../../../src/shared/workbench/executionDesktop'

it('closing a drafted card retains its ordinary conversation raw input and releases only its tracker while an open card keeps undo until shutdown drains', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T10-desktop-cleanup-'))
  let desktop: ExecutionDesktopService | undefined
  try {
    const documents = new DocumentHostService(path.join(directory, 'documents'))
    for (const name of ['A', 'B']) await fs.writeFile(path.join(directory, `${name}.md`), `${name} original\n`)
    const a = await documents.open(path.join(directory, 'A.md')), b = await documents.open(path.join(directory, 'B.md'))
    const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: {
      isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString() } })
    const connection = await settings.saveConnection({ apiKey: 'local-fixture', connection: { provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } })
    await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'local-fixture' },
      vision: null, imageGenerate: null, imageEdit: null } })
    // Only the remote model is controlled. Each turn performs one real canonical commit tagged with its actual running identity.
    let modelTurns = 0
    const transport: typeof fetch = async () => {
      const run = (await desktop!.runs.list()).find(value => value.status === 'running')
      if (!run || run.input.documents.length !== 1) throw new Error('Missing actual card run')
      const session = documents.registry.get(run.input.documents[0].documentId), snapshot = await session.drain()
      if (snapshot.model.kind !== 'markdown') throw new Error('Expected Markdown')
      const name = snapshot.model.source.slice(0, 1)
      const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: randomUUID(), actor: 'agent', runId: run.runId,
        mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: snapshot.model.source.length, text: `${name} revised\n` } } })
      expect(result.status).toBe('applied'); modelTurns++
      return new Response(`data: ${JSON.stringify({ id: randomUUID(), model: 'local-fixture', choices: [{ index: 0,
        delta: { role: 'assistant', content: '已修改' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } })
    }
    desktop = new ExecutionDesktopService({ directory: path.join(directory, 'execution'), documents, settings, fetch: transport,
      authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
    const { workspace } = await desktop.operate({ type: 'workspace', root: directory }) as { workspace: { workspaceId: string } }
    const workspaceId = workspace.workspaceId
    const sendCard = async (documentId: string, label: string) => {
      const snapshot = await documents.registry.get(documentId).drain()
      if (snapshot.model.kind !== 'markdown') throw new Error('Expected Markdown')
      const target = { kind: 'markdown-range' as const, from: 0, to: snapshot.model.source.length }
      const refs: ExecutionDocumentReference[] = [{ documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [target], selection: [target] }]
      const card = await desktop!.operate({ type: 'create-conversation', workspaceId, element: { kind: 'element', documentId, label } }) as ConversationRecord
      const sent = await desktop!.operate({ type: 'send', workspaceId, conversationId: card.conversationId, expectedRevision: card.revision,
        submissionId: randomUUID(), text: `Revise ${label}`, documents: refs, attachments: [] }) as ExecutionSendResult
      expect(sent.run).toBeDefined()
      const finished = await desktop!.engine.wait(sent.run!.runId)
      expect(finished.status, JSON.stringify(finished)).toBe('completed')
      await vi.waitFor(async () => expect((await desktop!.conversations.readConversation(card))!.messages.some(message => message.role === 'assistant')).toBe(true))
      await vi.waitFor(async () => expect(await desktop!.operate({ type: 'element-change', submissionId: sent.submission.submissionId })).toMatchObject({ state: 'applied' }))
      return { card, sent }
    }
    const kept = await sendCard(a.documentId, 'A'), closed = await sendCard(b.documentId, 'B')
    expect(modelTurns).toBe(2)
    await vi.waitFor(() => expect(desktop!.runtimeCounts()).toMatchObject({ queues: 0, elementChanges: 2,
      engine: { activeRuns: 0, preparingRecords: 0, displayBuffers: 0, browserPauses: 0, streamingCalls: 0, contextMessages: 0, questions: 0, approvals: 0 } }))
    const latest = (await desktop.conversations.readConversation(closed.card))!
    const currentB = await documents.registry.get(b.documentId).drain()
    const target = { kind: 'markdown-range' as const, from: 0, to: 'B revised\n'.length }
    const refs: ExecutionDocumentReference[] = [{ documentId: b.documentId, epoch: currentB.epoch, revision: currentB.revision, writable: [target], selection: [target] }]
    const draft = await desktop.operate({ type: 'draft', workspaceId, conversationId: latest.conversationId, expectedRevision: latest.revision,
      text: '尚未发送的原始输入：保留 B，继续说明…', documents: refs, attachments: [] }) as ConversationRecord
    // This is the production Desktop card-close boundary, followed by the real document close.
    await desktop.clearElementConversations(b.documentId)
    await documents.operate({ type: 'close', documentId: b.documentId, discardDirty: true })
    const recovered = (await desktop.operate({ type: 'conversations', workspaceId }) as ConversationRecord[]).find(value => value.conversationId === latest.conversationId)!
    expect(recovered).toMatchObject({ inputDraft: draft.inputDraft, frozenContextRefs: draft.frozenContextRefs })
    expect(recovered.element).toBeUndefined()
    expect(desktop.runtimeCounts().elementChanges).toBe(1)
    expect(await desktop.operate({ type: 'element-change', submissionId: closed.sent.submission.submissionId })).toMatchObject({ state: 'none' })
    expect(await desktop.operate({ type: 'element-change', submissionId: kept.sent.submission.submissionId }) as ElementChangeView).toMatchObject({ state: 'applied' })
    expect(await desktop.operate({ type: 'element-revert', submissionId: kept.sent.submission.submissionId, direction: 'undo' })).toMatchObject({ status: 'applied' })
    expect((await documents.registry.get(a.documentId).drain()).model).toMatchObject({ kind: 'markdown', source: 'A original\n' })
    expect(await desktop.operate({ type: 'element-revert', submissionId: kept.sent.submission.submissionId, direction: 'redo' })).toMatchObject({ status: 'applied' })
    await desktop.shutdown()
    expect(desktop.runtimeCounts()).toMatchObject({ queues: 0, elementChanges: 0,
      engine: { activeRuns: 0, preparingRecords: 0, displayBuffers: 0, browserPauses: 0, streamingCalls: 0, contextMessages: 0, questions: 0, approvals: 0 } })
    expect((await desktop.conversations.readConversation(recovered))!.inputDraft).toBe(draft.inputDraft)
    expect((await documents.registry.get(a.documentId).drain()).model).toMatchObject({ kind: 'markdown', source: 'A revised\n' })
    expect(modelTurns).toBe(2)
  } finally {
    await desktop?.shutdown()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
