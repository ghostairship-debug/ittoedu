import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { SelectionQuickBar } from '../../src/renderer/editing/quickbar/SelectionQuickBar'
import { ElementAiButton } from '../../src/renderer/workbench/elementCards/ElementAiCard'
import { captureCompositionSelection, captureCourseObjectSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { elementCardKey, elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import { executionDocumentReferenceSchema, type ExecutionSelectionTarget, type ExecutionSendInput } from '../../src/shared/workbench/executionDesktop'
import { currentCompositionGatewayFixture, currentFragmentPrompt } from '../helpers/currentCompositionGatewayFixture'

const openDocuments: string[] = []
const roots: HTMLElement[] = []
afterEach(() => {
  cleanup()
  for (const id of openDocuments.splice(0)) { elementCards.forgetDocument(id); workbenchSelection.setManual(id, null) }
  for (const root of roots.splice(0)) root.remove()
  elementCards.setWorkspace(null)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('sends selected component text and image from current AI cards, preserves narrow writes and returns to the original card after a late canvas read', async () => {
  const source = currentCompositionGatewayFixture({ professionalText: true }), driver = new CourseV10Driver()
  const persistence: DocumentPersistence = { async append() {}, async save() { throw new Error('Not saving in this UI check') } }
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(source.model, 'selected-content.glx')
  openDocuments.push(session.documentId)
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { prepareImage: prepareImageResource })
  const conversations = new Map<string, ConversationRecord>(), requests: ExecutionSendInput[] = []
  const execution = {
    createConversation: vi.fn(async (workspaceId: string, title: string) => {
      const record: ConversationRecord = { workspaceId, conversationId: randomUUID(), title, messages: [], attachmentIds: [],
        runIndex: { builtinRunIds: [], externalRunIds: [], externalPortIds: [] }, inputDraft: '', inputAttachments: [], frozenContextRefs: [],
        revision: 1, createdAt: 1, updatedAt: 1 }
      conversations.set(record.conversationId, record); return record
    }),
    conversation: vi.fn(async (_workspace: string, id: string) => conversations.get(id)),
    send: vi.fn(async (input: ExecutionSendInput) => {
      requests.push(structuredClone(input))
      return { conversation: conversations.get(input.conversationId)!, submission: {
        ...input, state: 'queued', model: { provider: 'fixture', model: 'fixture-model', accountId: 'account', billing: 'token-plan' }, createdAt: 1, updatedAt: 1 } }
    }),
    subscribe: () => () => {},
  }
  vi.stubGlobal('desktopAPI', { execution, documents: { read: async () => session.read(), subscribe: () => () => {} }, executionSettings: {
    read: async () => ({ secureStorageAvailable: true, connections: [{ connection: {
      id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'account',
      auth: { kind: 'api-key', credentialRef: 'private' }, billing: { kind: 'token-plan' }, capabilities: {} }, hasCredential: true, revoked: false }],
      profile: { revision: 1, updatedAt: '2026-10-03T00:00:00.000Z', roles: {
        conversation: { connectionId: 'fixture', model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } } }) } })
  elementCards.setWorkspace('workspace'); elementCards.setPermission('workspace')

  const rootId = source.target.instanceId, surfaceId = source.target.surfaceId
  const capture = (id: string) => captureCompositionSelection(session.read(), surfaceId, rootId, id, null,
    id === 'paragraph' ? '所选文字' : '所选图片')
  const textTarget: ExecutionSelectionTarget = { ...source.instanceTarget('paragraph'), stateId: null }
  const imageTarget: ExecutionSelectionTarget = { ...source.instanceTarget('native-picture'), stateId: null }
  const selected = (id: string) => <SelectionQuickBar key={id} label="选中内容快捷工具"
    anchor={{ left: 100, top: 120, width: 330, height: 90 }} bounds={{ left: 0, top: 0, right: 1000, bottom: 700 }} selectionKey={id}>
    <ElementAiButton documentId={session.documentId} target={source.instanceTarget(id)}
      label={id === 'paragraph' ? '所选文字' : '所选图片'} capture={async () => capture(id)} />
  </SelectionQuickBar>
  await act(async () => { workbenchSelection.setManual(session.documentId, capture('paragraph')) })
  const ui = render(selected('paragraph'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 修改' })).toBeEnabled())
  expect(workbenchSelection.getManual(session.documentId)?.targets).toEqual([textTarget])
  const submit = async (instruction: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    await waitFor(() => expect(screen.getByLabelText('AI 修改要求')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('AI 修改要求'), { target: { value: instruction } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('AI 修改要求').closest('form')!) })
  }
  await submit('把这句话改为先预测再比较证据')
  expect(requests).toHaveLength(1)
  expect(executionDocumentReferenceSchema.parse(requests[0]!.documents[0]).writable).toEqual([textTarget])
  expect(requests[0]!.documents[0]!.selection).toEqual([textTarget])

  const current = () => { const model = session.read().model; if (model.kind !== 'course-v10') throw new Error('Current component model required'); return model }
  const before = session.read()
  const applyFromCard = async (request: ExecutionSendInput, kind: 'text' | 'image') => {
    const reference = request.documents[0]!, runId = randomUUID(), selected = reference.selection![0]!
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: reference.documentId, writable: reference.writable }] })
    // Read visibility never widens the selected child's frozen write grant.
    const untouched = session.read()
    const sibling = await gateway.issueTarget(runId, reference.documentId, { ...source.instanceTarget('heading'), dataPath: ['content'] })
    expect(await gateway.execute(runId, randomUUID(), { name: 'text.replace', input: { target: sibling, content: 'Unauthorized sibling edit' } }))
      .toMatchObject({ kind: 'error' })
    expect(session.read()).toEqual(untouched)
    const handle = await gateway.issueTarget(runId, reference.documentId, kind === 'text'
      ? { ...source.instanceTarget('paragraph'), dataPath: ['content'] } : selected)
    const input = kind === 'text' ? { target: handle, content: '先预测，再比较证据。' } : { target: handle,
      resource: await gateway.provideImage(runId, reference.documentId, { filename: 'replacement.png', mimeType: 'image/png',
        bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#246ab0' } }).png().toBuffer()) }) }
    const applied = await gateway.execute(runId, randomUUID(), { name: kind === 'text' ? 'text.replace' : 'media.apply', input })
    expect(applied, JSON.stringify(applied)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await gateway.stop(runId)
  }
  await applyFromCard(requests[0]!, 'text')
  expect(JSON.stringify(current().project.instances.paragraph.data)).toContain('先预测，再比较证据。')
  expect(JSON.stringify(current().project.instances.paragraph.data)).not.toContain(currentFragmentPrompt)
  expect(current().project.instances.heading).toEqual(source.project.instances.heading)
  ui.rerender(selected('native-picture'))
  await submit('只替换这张图片')
  expect(requests).toHaveLength(2)
  expect(requests[1]!.documents[0]!.writable).toEqual([imageTarget])
  expect(elementCardKey(session.documentId, imageTarget)).not.toBe(elementCardKey(session.documentId, textTarget))
  await applyFromCard(requests[1]!, 'image')
  expect(current().project.instances['native-picture'].data).toMatchObject({ alt: '原生图片', assetId: expect.not.stringMatching(/^source-photo$/) })
  for (const id of ['heading', 'picture', 'shared-picture', 'interaction', 'chart'])
    expect(current().project.instances[id]).toEqual(source.project.instances[id])
  expect(current().resources.components).toEqual(before.model.resources.components)
  expect(session.read().undoDepth).toBe(2)
  ui.rerender(<></>)
  await act(async () => { workbenchSelection.setManual(session.documentId, null) })
  expect(workbenchSelection.getManual(session.documentId)).toBeNull()
  expect(screen.queryByRole('button', { name: 'AI 修改' })).toBeNull()

  // The current indicator opens the same persistent card after canvas navigation.
  // A late read of the prior parent selection cannot replace that explicit child selection.
  const snapshot = session.read(), restored = capture('paragraph')
  let finishOldRead!: (snapshot: DocumentSnapshot) => void
  vi.spyOn(window.desktopAPI!.documents!, 'read').mockReturnValueOnce(new Promise<DocumentSnapshot>(resolve => { finishOldRead = resolve }))
  const oldRead = workbenchSelection.observe(session.documentId, snapshot.revision,
    value => captureCourseObjectSelection(value, surfaceId, [rootId]))
  await act(async () => {
    workbenchSelection.setManual(session.documentId, restored)
    elementCards.requestOpen(elementCardKey(session.documentId, textTarget))
  })
  await act(async () => { finishOldRead(snapshot); await oldRead })
  expect(workbenchSelection.getManual(session.documentId)?.targets).toEqual([textTarget])
  ui.rerender(selected('paragraph'))
  await waitFor(() => expect(screen.getByLabelText('AI 修改要求')).toBeTruthy())
  expect(screen.getByText('把这句话改为先预测再比较证据')).toBeTruthy()
  expect(requests).toHaveLength(2)
})
