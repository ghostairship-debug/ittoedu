import { expect, it, vi } from 'vitest'
import { ElementCardController } from '../../src/renderer/workbench/elementCards/elementCardController'
import { captureSelection, captureFlowSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { prepareDocumentTextEdit } from '../../src/renderer/document/documentSelectionCommands'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { prepareExecutionContentOutput } from '../../src/core/tools/ToolTargets'
import type { DocumentSnapshot, DocumentEvent } from '../../src/shared/workbench/document'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDesktopAPI, ExecutionSendInput } from '../../src/shared/workbench/executionDesktop'
import type { ExecutionSettingsAPI } from '../../src/shared/workbench/executionSettingsDesktop'

function fixture() {
  let snapshot: DocumentSnapshot = { binding: { kind: 'untitled', suggestedName: 'card.md' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0, documentId: 'doc', epoch: 'original', revision: 1,
    model: { kind: 'markdown', source: 'same END', resources: { assets: {}, components: {} } } }
  let conversation: ConversationRecord | undefined
  let closed: ((event: DocumentEvent) => void) | undefined
  const api = {
    createConversation: vi.fn(async () => conversation = { conversationId: 'card', workspaceId: 'workspace', title: 'text',
      revision: 1, inputDraft: '', frozenContextRefs: [], messages: [], inputAttachments: [], attachmentIds: [],
      runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, createdAt: 1, updatedAt: 1 }),
    conversation: vi.fn(async () => conversation ?? null),
    draft: vi.fn(async (input: ExecutionSendInput) => conversation = { ...conversation!, inputDraft: input.text,
      revision: conversation!.revision + 1, frozenContextRefs: input.documents.map(ref => ({ contextRefId: 'doc',
        documentId: ref.documentId, epoch: ref.epoch, revision: ref.revision, selection: ref.selection, writeScope: ref.writable })) }),
    send: vi.fn(async (input: ExecutionSendInput) => ({ conversation: conversation!, submission: {
      ...input, state: 'queued', createdAt: 1, updatedAt: 1,
      model: { provider: 'stub', model: 'stub', accountId: 'stub', billing: 'token-plan' } } })),
    subscribe: vi.fn(() => () => {}), deleteConversation: vi.fn(),
  }
  const settings = { read: async () => ({ connections: [{ connection: { id: 'stub', billing: { kind: 'token-plan' } }, hasCredential: true }],
    profile: { roles: { conversation: { connectionId: 'stub', model: 'stub' } } } }) } as unknown as ExecutionSettingsAPI
  const cards = new ElementCardController({ execution: () => api as unknown as ExecutionDesktopAPI,
    settings: () => settings, snapshot: async () => snapshot,
    documents: () => ({ subscribe: listener => { closed = listener; return () => { closed = undefined } } }) })
  cards.setWorkspace('workspace')
  const target = { kind: 'markdown-range' as const, from: 0, to: 4 }
  const capture = captureSelection(snapshot, [target], 'text', snapshot.model.kind === 'markdown' ? snapshot.model.source : undefined)
  const key = cards.openText({ documentId: 'doc', target, capture,
    contentOutput: prepareExecutionContentOutput(snapshot, target), content: 'same', label: 'text', anchor: { left: 10, top: 10 } })
  return { cards, api, key, capture, setSnapshot: (next: DocumentSnapshot) => { snapshot = next },
    closeDocument: () => closed?.({ type: 'closed', documentId: 'doc', epoch: snapshot.epoch }), move: (source: string, epoch = 'original') => {
    snapshot = { ...snapshot, epoch, revision: snapshot.revision + 1, model: { kind: 'markdown', source, resources: { assets: {}, components: {} } } }
  } }
}

it.each(['same same END', 'prefix same END'])('sends the original card baseline after unrelated insertion: %s', async source => {
  const f = fixture()
  f.move(source)
  await f.cards.send(f.key, 'replace the selected word')
  const sent = f.api.send.mock.calls[0]![0]
  expect(sent.documents).toEqual([{ documentId: 'doc', epoch: 'original', revision: 1,
    selection: [{ kind: 'markdown-range', from: 0, to: 4 }], writable: [{ kind: 'markdown-range', from: 0, to: 4 }] }])
  expect(sent.contentOutput).toMatchObject({ documentId: 'doc', target: { from: 0, to: 4 } })
})

it('captures a visible Flow range across two text instances through the production preparation and card send', async () => {
  const project = createBlankCourseProjectV10('continuous Flow')
  project.surfaces[0] = { id: 'flow', kind: 'flow', title: '正文', childIds: ['first', 'second'] }
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  for (const [id, source] of [['first', 'LEFT alpha'], ['second', 'bravo RIGHT']] as const) {
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id,
      data: JSON.parse(JSON.stringify(createTextComponentData(source))), frame: { width: 400, height: 40, transform: [1, 0, 0, 1, 0, 0] } }
  }
  const snapshot: DocumentSnapshot = { binding: { kind: 'untitled', suggestedName: 'card.glx' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0, documentId: 'doc', epoch: 'original', revision: 0,
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }
  const f = fixture(); f.setSnapshot(snapshot)
  const unregister = workbenchSelection.register('doc', async () => snapshot)
  try {
    const start = await prepareDocumentTextEdit('doc', { mode: 'layout', revision: '0', source: '', ranges: null, label: '连续正文',
      selection: { kind: 'text', revision: '0', anchor: { blockId: 'first', slot: { kind: 'field', field: 'content' }, offset: 5, affinity: 'after' },
        head: { blockId: 'second', slot: { kind: 'field', field: 'content' }, offset: 5, affinity: 'before' } } },
    (current, selection) => captureFlowSelection(current, 'flow', selection))
    expect(start.capture.targets).toHaveLength(1)
    expect(start.target).toMatchObject({ kind: 'text-selection', fragments: [
      { target: { kind: 'course-instance', instanceId: 'first', dataPath: ['content'], from: 5, to: 10 } },
      { target: { kind: 'course-instance', instanceId: 'second', dataPath: ['content'], from: 0, to: 5 } },
    ] })
    expect(start.content).toContain('alpha')
    expect(start.content).toContain('bravo')
    expect(start.content).not.toMatch(/LEFT|RIGHT/)
    const key = f.cards.openText({ documentId: 'doc', ...start, anchor: { left: 10, top: 10 } })
    await f.cards.send(key, '只改所选的连续文字')
    const sent = f.api.send.mock.calls[0]![0]
    expect(sent.documents[0]).toMatchObject({ epoch: 'original', revision: 0,
      selection: [start.target], writable: [start.target] })
    expect(sent.contentOutput?.target).toEqual(start.target)
  } finally { unregister() }
})

it('refuses a replaced Session even when the same text occupies the old offsets', async () => {
  const f = fixture()
  f.move('same END', 'replacement')
  await expect(f.cards.send(f.key, 'replace')).rejects.toThrow('身份已改变')
  expect(f.api.send).not.toHaveBeenCalled()
})

it('folds unsent input through existing drafts and restores the same card without deleting its conversation', async () => {
  const f = fixture()
  f.cards.setDraft(f.key, 'keep this draft')
  f.cards.dismissText(f.key)
  await f.cards.flushDrafts()
  expect(f.cards.view(f.key)).toMatchObject({ dismissed: true, draft: 'keep this draft' })
  expect(f.api.draft).toHaveBeenCalledWith(expect.objectContaining({ text: 'keep this draft',
    documents: [expect.objectContaining({ epoch: 'original', revision: 1 })] }))
  expect(f.api.send).not.toHaveBeenCalled()
  expect(f.api.deleteConversation).not.toHaveBeenCalled()
  f.cards.revealText(f.key, { left: 20, top: 20 })
  expect(f.cards.view(f.key)).toMatchObject({ dismissed: false, draft: 'keep this draft' })
  await f.cards.send(f.key, 'keep this draft')
  f.cards.dismissText(f.key)
  expect(f.cards.view(f.key)).toMatchObject({ dismissed: false, entries: [{ state: 'queued' }] })
  expect(f.api.createConversation).toHaveBeenCalledTimes(1)
  expect(f.api.deleteConversation).not.toHaveBeenCalled()
  f.closeDocument()
  expect(f.cards.view(f.key)).toBeNull()
})
