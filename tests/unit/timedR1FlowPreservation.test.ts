// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { DocumentHostService } from '@/main/workbench/DocumentHostService'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { SHAPE_DEFINITION, defaultShapeData } from '@/components/shape'
import { TEXT_DEFINITION } from '@/components/text/adapters'
import { DOCUMENT_BLOCK_DEFINITION } from '@/components/document-block'
import { createTextComponentData, textComponentDataSchema } from '@/components/text/data'
import { IMAGE_DEFINITION, createImageData } from '@/components/image'
import type { ImportedImageAsset } from '@/renderer/project/assetManager'
import { buildFlowPropertiesOwner } from '@/renderer/ui/properties/FlowPropertiesContextBuilder'
import { selectPropertiesAuthoringReadModel } from '@/renderer/composition/properties/PropertiesAuthoringReadModel'
import { flushPropertiesDrafts } from '@/renderer/ui/properties/PropertyControls'
import { FlowWorkspace } from '@/renderer/ui/FlowWorkspace'
import { drainFlowWorkspace } from '@/renderer/document/flowWorkspaceRegistry'
import { flowBodyIds } from '@/core/components/document/flowDocumentProjection'
import * as sessions from '@/renderer/document/editorSession'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform/project'
import type { ComponentEdit } from '@/shared/contracts/component-platform/operations'
import type { DocumentHostAPI } from '@/shared/workbench/desktop'

const probe = vi.hoisted(() => ({ runtime: {} as Record<string, unknown> }))
vi.mock('@/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('@/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
const manualFrame = { width: 384, height: 172, transform: [.8, .6, -.6, .8, 41, 67] as [number, number, number, number, number, number] }
const directories: string[] = []
const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  // Main's v8 recovery round trip returns Node byte arrays, even in this renderer DOM fixture.
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterAll(() => {
  geometry.forEach((key, index) => { if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!); else Reflect.deleteProperty(Range.prototype, key) })
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 30))
})
afterEach(async () => {
  cleanup(); await useEditorStore.getState().courseBridge.drain(); vi.restoreAllMocks(); useEditorStore.getState().courseBridge.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 })
})
function initial(locked = false): CourseProjectV10 {
  return { schemaVersion: 10, id: 'timed-r1-flow', revision: 0, title: '讲义',
    definitions: { [SHAPE_DEFINITION.id]: SHAPE_DEFINITION, [TEXT_DEFINITION.id]: TEXT_DEFINITION,
      private: { id: 'private', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'files', entry: 'main.js' } } } },
    instances: { shape: { id: 'shape', definitionId: SHAPE_DEFINITION.id, data: JSON.parse(JSON.stringify(defaultShapeData())), locked, frame: structuredClone(manualFrame) },
      seed: { id: 'seed', definitionId: SHAPE_DEFINITION.id, data: JSON.parse(JSON.stringify(defaultShapeData())) },
      body: { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('原正文'))), locked: true },
      private: { id: 'private', definitionId: 'private', data: { title: '保留私有数据' } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['shape', 'body', 'seed', 'private'] }], global: { underlay: [], overlay: [] }, assets: {} }
}
async function harness(project = initial()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-r1-flow-')); directories.push(directory)
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  const resources = { assets: Object.fromEntries(Object.keys(project.assets).map(id => [id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')])), components: { files: { 'main.js': new TextEncoder().encode('export default () => {}') } } }
  const first = await service.internalAPI.create({ kind: 'course-v10', project, resources }, '讲义')
  const unavailable = async (): Promise<never> => { throw new Error('no dialogs') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable,
    close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  await useEditorStore.getState().connectCourseDocuments(api)
  await useEditorStore.getState().courseBridge.activate(first.documentId)
  useEditorStore.getState().selectNode('shape')
  return { service, first, resources, project }
}

it('preserves authored frames through Flow Properties conversion and undo, and keeps a rejected native width draft until the actual ACK', async () => {
  const h = await harness()
  render(createElement(PropertiesTab, { onReplaceImage: () => {} }))
  fireEvent.click(screen.getByRole('button', { name: '转为浮层' }))
  await waitFor(() => expect(useEditorStore.getState().courseView.project!.instances.shape.flowPlacement).toBeDefined())
  const snapshot = await h.service.internalAPI.read(h.first.documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(snapshot.model.project.instances.shape.frame).toEqual(manualFrame)
  expect(snapshot.model.project.instances.shape.data).toEqual(h.project.instances.shape.data)
  expect(snapshot.model.project.definitions.private).toEqual(h.project.definitions.private)
  expect(snapshot.model.resources).toEqual(h.resources)
  expect(snapshot.undoDepth).toBe(1)
  await act(async () => useEditorStore.getState().courseBridge.undo(h.first.documentId))
  expect(useEditorStore.getState().courseView.project!.instances.shape.flowPlacement).toBeUndefined()
  expect(useEditorStore.getState().courseView.project!.instances.shape.frame).toEqual(manualFrame)
  await act(async () => useEditorStore.getState().courseBridge.redo(h.first.documentId))
  expect(useEditorStore.getState().courseView.project!.instances.shape.frame).toEqual(manualFrame)
  act(() => useEditorStore.getState().selectNode('seed'))
  fireEvent.click(screen.getByRole('button', { name: '转为浮层' }))
  await waitFor(() => expect(useEditorStore.getState().courseView.project!.instances.seed.flowPlacement).toBeDefined())
  expect(useEditorStore.getState().courseView.project!.instances.seed.frame).toEqual({ width: 240, height: 120, transform: [1, 0, 0, 1, 80, 80] })
  act(() => useEditorStore.getState().selectNode('shape'))
  let reject!: (error: Error) => void
  const ack = new Promise<never>((_resolve, fail) => { reject = fail })
  const commit = vi.spyOn(useEditorStore.getState().courseKernel, 'editCaptured').mockImplementationOnce(() => ack)
  const width = screen.getByRole('spinbutton', { name: '宽' })
  fireEvent.focus(width); fireEvent.change(width, { target: { value: '420' } })
  let flushed = false, pending!: Promise<boolean>
  act(() => { pending = flushPropertiesDrafts().then(result => { flushed = true; return result }) })
  await act(async () => { await Promise.resolve() })
  expect(commit).toHaveBeenCalledTimes(1); expect(flushed).toBe(false)
  expect(width).toHaveValue('420')
  await act(async () => { reject(new Error('正式宽度提交被拒绝')); expect(await pending).toBe(false) })
  expect(width).toHaveValue('420'); expect(width).toHaveAttribute('aria-invalid', 'true')
  const unchanged = await h.service.internalAPI.read(h.first.documentId)
  expect(unchanged.revision).toBe(useEditorStore.getState().courseView.project!.revision)
  expect(unchanged.undoDepth).toBe(2)
  expect(unchanged.model.kind === 'course-v10' && unchanged.model.project.instances.shape.frame).toEqual(manualFrame)
})

it('disables locked Flow structural controls and rejects their direct owners atomically while preserving selection and unlock', async () => {
  const project = initial(true)
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  project.instances.section = { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, locked: true, childIds: [],
    data: { type: 'section', title: { inlines: [{ type: 'text', text: '锁定组' }] }, collapsedByDefault: false } }
  project.instances.float = { ...structuredClone(project.instances.shape), id: 'float', flowPlacement: { space: 'paper', plane: 'overlay' } }
  project.instances.seed.flowPlacement = { space: 'paper', plane: 'overlay' }
  project.surfaces[0].childIds.push('section', 'float')
  const h = await harness(project)
  render(createElement(PropertiesTab, { onReplaceImage: () => {} }))
  expect(screen.getByRole('button', { name: '转为浮层' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()
  const state = useEditorStore.getState(), target = state.courseKernel.captureTarget(h.first.documentId)
  const commit = vi.spyOn(state.courseKernel, 'editCaptured')
  const intents = [
    { kind: 'convert-block-to-overlay' as const },
    { kind: 'delete-blocks' as const, blockIds: ['seed', 'shape'] },
    { kind: 'transform-overlay-frame' as const, frame: { x: 0, y: 0, width: 240, height: 120 } },
    { kind: 'move-block' as const, direction: 'down' as const },
  ]
  for (const intent of intents) expect(await state.runFlowAuthoringIntent(target, intent)).toMatchObject({ ok: false, reason: expect.stringContaining('对象已锁定，请先解锁'), historyEntry: false })
  act(() => useEditorStore.getState().selectNode('float'))
  const floatingTarget = state.courseKernel.captureTarget(h.first.documentId)
  const owner = buildFlowPropertiesOwner({ read: selectPropertiesAuthoringReadModel(useEditorStore.getState()), kernel: state.courseKernel,
    actions: state, documentSelection: null, selectedContext: null, assets: {}, liveTarget: () => floatingTarget,
    submit: () => {}, preview: () => {}, report: () => {} })!
  await expect(owner.commands.convertOverlayToDocument()).rejects.toThrow('对象已锁定，请先解锁')
  act(() => useEditorStore.getState().selectNode('seed'))
  const destinationTarget = state.courseKernel.captureTarget(h.first.documentId)
  const destinationOwner = buildFlowPropertiesOwner({ read: selectPropertiesAuthoringReadModel(useEditorStore.getState()), kernel: state.courseKernel,
    actions: state, documentSelection: null, selectedContext: null, assets: {}, liveTarget: () => destinationTarget,
    submit: () => {}, preview: () => {}, report: () => {} })!
  await expect(destinationOwner.commands.convertOverlayToDocument({ parentBlockId: 'section', index: 0, wrap: 'none' })).rejects.toThrow('对象已锁定，请先解锁')
  act(() => useEditorStore.getState().selectNode('shape'))
  expect(commit).not.toHaveBeenCalled()
  const snapshot = await h.service.internalAPI.read(h.first.documentId)
  expect(snapshot.undoDepth).toBe(0); expect(snapshot.revision).toBe(0)
  expect(snapshot.model.kind === 'course-v10' && snapshot.model.project.instances.shape).toEqual(h.project.instances.shape)
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(['shape'])
  fireEvent.click(screen.getByRole('button', { name: '解锁图层' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(useEditorStore.getState().courseView.project!.instances.shape).toBeUndefined())
})

it('keeps locked floating controls disabled while permitting adjacent PM insertion and locked body text edits through the real Flow owner', async () => {
  const project = initial(true)
  project.instances.shape.flowPlacement = { space: 'paper', plane: 'overlay' }
  project.surfaces[0].childIds = ['body', 'shape', 'seed', 'private']
  for (const kind of ['slide', 'spatial'] as const) {
    const id = `${kind}-locked`
    project.instances[id] = { ...structuredClone(project.instances.body), id }
    project.surfaces.push({ id: kind, kind, title: kind, childIds: [id] })
  }
  const h = await harness(project)
  probe.runtime = { resources: h.resources, selectedInstanceIds: ['shape'], selectInstances: (ids: string[]) => useEditorStore.getState().selectNodes(ids),
    onElement: () => {}, onTargetElement: () => {}, renderInstance: () => null,
    world: { beforeProjectionMutation: () => {}, afterProjectionMutation: () => {} }, registerObservation: () => () => {}, navigation: { changed: () => {} } }
  const factory = vi.spyOn(sessions, 'createLayoutEditor')
  function Workspace() {
    const view = useEditorStore(state => state.courseView)
    return createElement(FlowWorkspace, { documentId: h.first.documentId, project: view.editingProject!, surfaceId: 'flow', onSelectImageAsset: async () => null })
  }
  const ui = render(createElement(Workspace))
  const overlay = ui.container.querySelector<HTMLElement>('[data-flow-overlay-id="shape"]')!
  expect([...overlay.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['移动', '移到正文下方', '转为正文', '删除', '调整浮层大小'])
  for (const button of overlay.querySelectorAll('button')) expect(button).toBeDisabled()
  fireEvent.click(overlay.querySelector<HTMLButtonElement>('button')!)
  expect((await h.service.internalAPI.read(h.first.documentId)).undoDepth).toBe(0)
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
  act(() => { editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1))); editor.view.focus() })
  fireEvent.click(screen.getByRole('button', { name: '插入段落' }))
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: '上方插入段落' })))
  expect(ui.queryAllByRole('alert').map(element => element.textContent)).toEqual([])
  await act(async () => expect(await drainFlowWorkspace(h.first.documentId)).toEqual({ ok: true }))
  const inserted = flowBodyIds(useEditorStore.getState().courseView.project!, 'flow')[0]
  expect(inserted).not.toBe('body')
  expect(flowBodyIds(useEditorStore.getState().courseView.project!, 'flow').slice(1)).toEqual(['body', 'seed', 'private'])
  let bodyAt = -1
  editor.view.state.doc.descendants((node, position) => { if (node.attrs.id === 'body') bodyAt = position; return bodyAt < 0 })
  await act(async () => editor.view.dispatch(editor.view.state.tr.insertText('保留锁定文字编辑', bodyAt + 1)))
  await act(async () => expect(await drainFlowWorkspace(h.first.documentId)).toEqual({ ok: true }))
  const snapshot = await h.service.internalAPI.read(h.first.documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(textComponentDataSchema.parse(snapshot.model.project.instances.body.data).content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')).toBe('保留锁定文字编辑原正文')
  expect(snapshot.model.project.instances.body.locked).toBe(true)
  expect(snapshot.model.project.instances.shape).toEqual(project.instances.shape)
  expect(snapshot.model.project.definitions.private).toEqual(project.definitions.private)
  expect(snapshot.model.resources).toEqual(h.resources)
  // The formal Main boundary still refuses structural/appearance edits and locks on other surfaces.
  const rejected: ComponentEdit[][] = [
    [{ type: 'data.set', instanceId: 'body', path: ['appearance', 'color'], value: '#123456' }],
    [{ type: 'frame.set', instanceId: 'body', frame: manualFrame }],
    [{ type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'flow' }, index: 4 }],
    [{ type: 'instance.insert', container: { kind: 'surface', surfaceId: 'flow' }, index: 0,
      instances: [{ id: 'forged-neighbor', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('不能借插入重排'))) }], rootIds: ['forged-neighbor'] },
      { type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'flow' }, index: 4 }],
    [{ type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'flow' }, index: 1, frame: manualFrame },
      { type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'flow' }, index: 1 }],
    [{ type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'slide' }, index: 0 },
      { type: 'instance.move', instanceId: 'body', container: { kind: 'surface', surfaceId: 'flow' }, index: 1 }],
    ...['slide-locked', 'spatial-locked'].map(instanceId => [{ type: 'data.set' as const, instanceId, path: ['content'], value: { inlines: [{ type: 'text' as const, text: '不允许改锁定对象' }] } }]),
  ]
  for (const edits of rejected) await expect(useEditorStore.getState().courseKernel.edit(edits)).rejects.toThrow('对象已锁定，请先解锁')
  const unchanged = await h.service.internalAPI.read(h.first.documentId)
  expect(unchanged.model).toEqual(snapshot.model); expect(unchanged.undoDepth).toBe(snapshot.undoDepth)
})

it('rejects an old rendered Properties Delete and a late Flow media replacement without writing either document', async () => {
  const project = initial()
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.instances.picture = { id: 'picture', definitionId: IMAGE_DEFINITION.id, data: JSON.parse(JSON.stringify(createImageData('original-picture'))) }
  project.assets['original-picture'] = { id: 'original-picture', path: 'assets/original.svg', mimeType: 'image/svg+xml', kind: 'image' }
  project.surfaces[0].childIds.push('picture')
  const h = await harness(project)
  const properties = render(createElement(PropertiesTab, { onReplaceImage: () => {} }))
  const oldDelete = screen.getByRole('button', { name: '删除' })
  const beforeDelete = await h.service.internalAPI.read(h.first.documentId)
  // Selection changes synchronously; React still has the old rendered click handler in this event batch.
  act(() => {
    useEditorStore.getState().selectNode('body')
    fireEvent.click(oldDelete)
  })
  await useEditorStore.getState().courseKernel.drain()
  const afterDelete = await h.service.internalAPI.read(h.first.documentId)
  expect(afterDelete.model).toEqual(beforeDelete.model)
  expect(afterDelete.undoDepth).toBe(beforeDelete.undoDepth)
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(['body'])
  expect(useEditorStore.getState().errorMessage).toContain('编辑目标已经改变')
  properties.unmount()

  let choose!: (item: ImportedImageAsset) => void
  const selected = vi.fn(() => new Promise<ImportedImageAsset>(resolve => { choose = resolve }))
  probe.runtime = { resources: h.resources, selectedInstanceIds: [], selectInstances: (ids: string[]) => useEditorStore.getState().selectNodes(ids),
    onElement: (_id: string, host: HTMLElement | null) => { if (host) host.textContent = '图' }, onTargetElement: () => {}, renderInstance: () => null,
    world: { beforeProjectionMutation: () => {}, afterProjectionMutation: () => {} }, registerObservation: () => () => {}, navigation: { changed: () => {} } }
  const ui = render(createElement(FlowWorkspace, { documentId: h.first.documentId, project: useEditorStore.getState().courseView.editingProject!,
    surfaceId: 'flow', onSelectImageAsset: selected }))
  const picture = ui.container.querySelector<HTMLElement>('[data-flow-block-id="picture"]')!
  fireEvent.contextMenu(picture.querySelector<HTMLElement>('div > div')!, { clientX: 200, clientY: 150 })
  const replace = await screen.findByRole('menuitem', { name: '替换图片…' })
  await act(async () => fireEvent.click(replace))
  expect(selected).toHaveBeenCalledOnce()
  await act(async () => useEditorStore.getState().courseKernel.edit([{ type: 'data.set', instanceId: 'picture', path: ['alt'], value: '中间版本图片说明' }]))
  const other = await h.service.internalAPI.create({ kind: 'course-v10', project: { ...structuredClone(project), id: 'other-course' }, resources: h.resources }, '另一讲义')
  await act(async () => useEditorStore.getState().courseBridge.activate(other.documentId))
  const beforeLate = await h.service.internalAPI.read(h.first.documentId), otherBefore = await h.service.internalAPI.read(other.documentId)
  const selectionBefore = useEditorStore.getState().courseView.selectedInstanceIds
  await act(async () => choose({ meta: { id: 'late-picture', filename: 'late.png', path: 'assets/late.png', kind: 'image', mimeType: 'image/png', byteLength: 4, width: 2, height: 2 }, bytes: Uint8Array.from([1, 2, 3, 4]) }))
  await waitFor(() => expect(ui.getByRole('alert')).toHaveTextContent(/版本|revision|已变化|已改变/))
  const afterLate = await h.service.internalAPI.read(h.first.documentId), otherAfter = await h.service.internalAPI.read(other.documentId)
  expect(afterLate.model).toEqual(beforeLate.model); expect(afterLate.undoDepth).toBe(beforeLate.undoDepth)
  expect(otherAfter.model).toEqual(otherBefore.model); expect(otherAfter.undoDepth).toBe(otherBefore.undoDepth)
  expect(useEditorStore.getState().courseView.activeDocumentId).toBe(other.documentId)
  expect(useEditorStore.getState().courseView.selectedInstanceIds).toEqual(selectionBefore)
  expect(useEditorStore.getState().slideContentEdit).toBeNull()
})
