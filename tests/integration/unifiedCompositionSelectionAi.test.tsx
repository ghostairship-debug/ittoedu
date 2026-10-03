import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { CompositionSelectionContext } from '../../src/renderer/workbench/CompositionSelectionContext'
import { captureCompositionSelection, captureCourseObjectSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { elementCardKey, elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'
import { findCompositionNode } from '../../src/shared/composition/content'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'
import { executionDocumentReferenceSchema, type ExecutionSelectionTarget, type ExecutionSendInput } from '../../src/shared/workbench/executionDesktop'
import { compositionFragmentFixture, fragmentPrompt } from '../helpers/compositionFragmentFixture'

const openDocuments: string[] = []
const roots: HTMLElement[] = []
afterEach(() => {
  cleanup()
  for (const id of openDocuments.splice(0)) { elementCards.forgetDocument(id); workbenchSelection.setManual(id, null) }
  for (const root of roots.splice(0)) root.remove()
  elementCards.setWorkspace(null)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('sends selected composition text and image from their canvas AI cards with narrow writable targets and applies only those targets through the real Gateway', async () => {
  const source = compositionFragmentFixture(), driver = new CourseV9Driver()
  const picture = findCompositionNode(source.item.content.root, 'picture')
  const right = findCompositionNode(source.item.content.root, 'right')
  if (picture?.kind !== 'element' || right?.kind !== 'element') throw new Error('Fixture required')
  right.children.push({ ...structuredClone(picture), id: 'unselected-picture' })
  const persistence: DocumentPersistence = { async append() {}, async save() { throw new Error('Not saving in this UI check') } }
  const registry = new DocumentRegistry({ drivers: [driver], persistence, createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create({ kind: 'course-v9', project: source.project,
    resources: { assets: source.assetFiles, components: {} } }, 'selected-content.h5lesson')
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

  const canvasRoot = document.createElement('div'), frame = document.createElement('iframe')
  canvasRoot.append(frame); document.body.append(canvasRoot); roots.push(canvasRoot)
  frame.dataset.webComposition = source.item.layerItemId
  Object.defineProperties(frame, { clientWidth: { value: 800 }, clientHeight: { value: 900 } })
  frame.contentDocument!.body.innerHTML = '<p data-composition-node="paragraph"></p><img data-composition-node="picture">'
  const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height,
    right: left + width, bottom: top + height, toJSON() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === frame) return rect(120, 100, 400, 450)
    return rect(0, 0, 800, 600)
  })
  const paragraphElement = frame.contentDocument!.querySelector<HTMLElement>('[data-composition-node="paragraph"]')!
  const imageElement = frame.contentDocument!.querySelector<HTMLElement>('[data-composition-node="picture"]')!
  vi.spyOn(paragraphElement, 'getBoundingClientRect').mockReturnValue(rect(40, 20, 600, 40))
  vi.spyOn(imageElement, 'getBoundingClientRect').mockReturnValue(rect(40, 100, 32, 32))
  const locationId = source.project.locations[0]!.id
  const props = { documentId: session.documentId, revision: session.read().revision, locationId, canvasRoot,
    selection: { layerItemId: source.item.layerItemId, nodeId: 'paragraph', bounds: { x: 40, y: 20, width: 600, height: 40 } } }
  const ui = render(<CompositionSelectionContext {...props} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 修改' })).toBeEnabled())
  const textTarget: ExecutionSelectionTarget = { kind: 'course-object', locationId, itemId: source.item.layerItemId, compositionNodeId: 'paragraph' }
  expect(workbenchSelection.getManual(session.documentId)?.targets).toEqual([textTarget])
  const submit = async (instruction: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
    fireEvent.change(screen.getByLabelText('AI 修改要求'), { target: { value: instruction } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('AI 修改要求').closest('form')!) })
  }
  await submit('把这句话改为先预测再比较证据')
  expect(requests).toHaveLength(1)
  expect(executionDocumentReferenceSchema.parse(requests[0]!.documents[0]).writable).toEqual([textTarget])
  expect(requests[0]!.documents[0]!.selection).toEqual([textTarget])

  const applyFromCard = async (request: ExecutionSendInput, kind: 'text' | 'image') => {
    const reference = request.documents[0]!, runId = randomUUID(), selected = reference.selection![0]!
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: reference.documentId, writable: reference.writable }] })
    const handle = await gateway.issueTarget(runId, reference.documentId, selected)
    const discovered = await gateway.execute(runId, randomUUID(), { name: 'content.targets', input: { target: handle } })
    if (discovered.kind !== 'read') throw new Error(JSON.stringify(discovered))
    const targets = (discovered.data as { targets: { target: string; kind: string; text?: string }[] }).targets
    const found = targets.find(target => target.kind === kind)
    if (!found) throw new Error('Selected target missing')
    if (kind === 'text') expect(targets.filter(target => target.kind === 'text').map(target => target.text)).toEqual([fragmentPrompt])
    else expect(targets.filter(target => target.kind === 'image')).toHaveLength(1)
    const input = kind === 'text' ? { target: found.target, text: '先预测，再比较证据。' } : { target: found.target,
      resource: await gateway.provideImage(runId, reference.documentId, { filename: 'replacement.png', mimeType: 'image/png',
        bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#246ab0' } }).png().toBuffer()) }) }
    const applied = await gateway.execute(runId, randomUUID(), { name: 'content.update', input })
    expect(applied).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await gateway.stop(runId)
  }
  await applyFromCard(requests[0]!, 'text')
  const composition = (): CompositionLayerItem => {
    const model = session.read().model
    if (model.kind !== 'course-v9') throw new Error('Course fixture required')
    const item = locateCourseLayer(model.project, source.item.layerItemId)?.item
    if (item?.kind !== 'composition') throw new Error('Composition required')
    return item
  }
  expect(findCompositionNode(composition().content.root, 'paragraph-text')).toMatchObject({ text: '先预测，再比较证据。' })
  expect(findCompositionNode(composition().content.root, 'heading-text')).toMatchObject({ text: '用观察解释变化' })
  ui.rerender(<CompositionSelectionContext {...props} revision={session.read().revision}
    selection={{ ...props.selection, nodeId: 'picture' }} />)
  await waitFor(() => expect(screen.getByText('所选图片')).toBeTruthy())
  await submit('只替换这张图片')
  expect(requests).toHaveLength(2)
  const imageTarget: ExecutionSelectionTarget = { ...textTarget, compositionNodeId: 'picture' }
  expect(requests[1]!.documents[0]!.writable).toEqual([imageTarget])
  expect(elementCardKey(session.documentId, imageTarget)).not.toBe(elementCardKey(session.documentId, textTarget))
  await applyFromCard(requests[1]!, 'image')
  const currentPicture = findCompositionNode(composition().content.root, 'picture')
  expect(currentPicture).toMatchObject({ kind: 'element', attributes: { alt: '资源闭包示例' } })
  if (currentPicture?.kind !== 'element') throw new Error('Image required')
  expect(currentPicture.attributes.src).not.toBe('cw-resource:photo')
  expect(findCompositionNode(composition().content.root, 'unselected-picture')).toMatchObject({ attributes: { src: 'cw-resource:photo' } })
  expect(findCompositionNode(composition().content.root, 'counter')).toEqual(findCompositionNode(source.item.content.root, 'counter'))
  expect(session.read().undoDepth).toBe(2)
  ui.rerender(<CompositionSelectionContext {...props} revision={session.read().revision} selection={null} />)
  expect(workbenchSelection.getManual(session.documentId)).toBeNull()
  expect(screen.queryByRole('button', { name: 'AI 修改' })).toBeNull()

  const restore = vi.fn()
  ui.rerender(<CompositionSelectionContext {...props} revision={session.read().revision} selection={null} onRestoreSelection={restore} />)
  // The indicator jump reuses the same manual selection projection; the iframe supplies only fresh geometry.
  const current = session.read(), restored = captureCompositionSelection(current, locationId, source.item.layerItemId, 'paragraph')
  let finishOldRead!: (snapshot: DocumentSnapshot) => void
  vi.spyOn(window.desktopAPI!.documents!, 'read').mockReturnValueOnce(new Promise<DocumentSnapshot>(resolve => { finishOldRead = resolve }))
  const oldRead = workbenchSelection.observe(session.documentId, current.revision,
    snapshot => captureCourseObjectSelection(snapshot, locationId, [source.item.layerItemId]))
  await act(async () => {
    workbenchSelection.setManual(session.documentId, restored)
    elementCards.requestOpen(elementCardKey(session.documentId, textTarget))
  })
  expect(restore).toHaveBeenCalledTimes(1)
  expect(restore.mock.calls[0]![0]).toEqual(props.selection)
  await act(async () => { finishOldRead(current); await oldRead })
  expect(workbenchSelection.getManual(session.documentId)?.targets).toEqual([textTarget])
  ui.rerender(<CompositionSelectionContext {...props} revision={session.read().revision}
    selection={restore.mock.calls[0]![0]} onRestoreSelection={restore} />)
  await waitFor(() => expect(screen.getByLabelText('AI 修改要求')).toBeTruthy())
  expect(screen.getByText('把这句话改为先预测再比较证据')).toBeTruthy()
  expect(restore).toHaveBeenCalledTimes(1)
  expect(requests).toHaveLength(2)
})
