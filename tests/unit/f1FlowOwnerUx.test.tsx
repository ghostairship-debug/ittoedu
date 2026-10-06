import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { createTableData } from '../../src/components/table/data'
import { flowBodyIds, projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { DOCUMENT_BLOCK_DRAG_MIME } from '../../src/renderer/document/DocumentBlockHandle'
import * as sessions from '../../src/renderer/document/editorSession'

const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: (select: (state: typeof probe.state) => unknown) => select(probe.state) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
import { FlowLocationWorkspace } from '../../src/renderer/ui/workspaces/FlowLocationWorkspace'
import { drainFlowWorkspace } from '../../src/renderer/document/flowWorkspaceRegistry'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('DragEvent', MouseEvent)
})
afterAll(() => {
  geometry.forEach((key, index) => {
    if (descriptors[index]) Object.defineProperty(Range.prototype, key, descriptors[index]!)
    else Reflect.deleteProperty(Range.prototype, key)
  })
  vi.unstubAllGlobals()
})

it('uses the Flow toolbar, inserts at the selected middle block, drags through formal history and continues after a table or divider', async () => {
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))) })
  const initial: CourseProjectV10 = {
    schemaVersion: 10, id: 'owner-ux', revision: 0, title: '讲义',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [TABLE_DEFINITION.id]: TABLE_DEFINITION },
    instances: {
      a: text('a'), b: text('b'), c: text('c'),
      table: { id: 'table', definitionId: TABLE_DEFINITION.id, data: JSON.parse(JSON.stringify(createTableData({ rows: 1, columns: 1 }))) },
      float: { ...text('float'), flowPlacement: { space: 'paper', plane: 'overlay' }, frame: { width: 270, height: 85, transform: [1, .2, .3, 1, 17, 29] } },
    },
    surfaces: [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['a', 'float', 'b', 'c', 'table'] }],
    global: { underlay: [], overlay: [] }, assets: {},
  }
  const resources = { assets: {}, components: {} }
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-flow-owner-ux-'))
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  const created = await service.internalAPI.create({ kind: 'course-v10', project: initial, resources }, '讲义')
  const unavailable = async (): Promise<never> => { throw new Error('no dialogs') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable,
    close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge()
  try {
    await bridge.connect(api); await bridge.activate(created.documentId)
    probe.state = { courseBridge: bridge, courseKernel: bridge, flowDocumentDrafts: {}, setFlowDocumentDraft: () => {},
      setFlowContextSelection: () => {}, flowEditingInstance: null, slideContentEdit: null }
    probe.runtime = { resources, selectedInstanceIds: [], selectInstances: () => {}, onElement: () => {}, onTargetElement: () => {},
      world: { beforeProjectionMutation: () => {}, afterProjectionMutation: () => {} }, renderInstance: () => null,
      registerObservation: () => () => {}, navigation: { changed: () => {} } }
    function Workspace() {
      const state = useSyncExternalStore(bridge.subscribe, bridge.read, bridge.read)
      return <FlowLocationWorkspace documentId={created.documentId} project={state.editingProject!} surfaceId="flow"
        canvasMode="edit" editingScope="scene" onCanvasModeChange={() => {}} onSelectImageAsset={async () => null} />
    }
    const factory = vi.spyOn(sessions, 'createLayoutEditor')
    const ui = render(<Workspace />)
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    const current = () => bridge.read().project!
    const body = () => flowBodyIds(current(), 'flow')
    const position = (id: string) => {
      let at = -1
      editor.view.state.doc.descendants((node, offset) => { if (at < 0 && node.attrs.id === id) at = offset; return at < 0 })
      if (at < 0) throw new Error(`Missing PM block ${id}`)
      return at + 1
    }
    const focus = (id: string) => act(() => {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position(id))))
      editor.view.focus()
    })
    const settle = async () => { await act(async () => { expect(await drainFlowWorkspace(created.documentId)).toEqual({ ok: true }) }) }

    expect(ui.getByTestId('flow-workspace-toolbar-host')).toContainElement(ui.getByRole('button', { name: '粗体', exact: true }))
    expect(ui.queryByRole('button', { name: '撤销', exact: true })).toBeNull()
    expect(ui.queryByRole('button', { name: '重做', exact: true })).toBeNull()
    fireEvent.click(ui.getByLabelText('更多正文操作'))
    expect(ui.getByRole('button', { name: '源文', exact: true })).toBeInTheDocument()
    fireEvent.click(ui.getByLabelText('更多正文操作'))

    focus('a')
    fireEvent.click(ui.getByRole('button', { name: '插入段落', exact: true }))
    await act(async () => fireEvent.click(ui.getByRole('menuitem', { name: '下方插入正文', exact: true })))
    await settle()
    const inserted = body()[1]
    expect(body()).toEqual(['a', inserted, 'b', 'c', 'table'])
    expect(inserted).not.toBe('b')
    await act(async () => editor.view.dispatch(editor.view.state.tr.insertText('中间正文', position(inserted))))
    await settle()

    focus('b')
    const values = new Map<string, string>()
    const transfer = { types: [DOCUMENT_BLOCK_DRAG_MIME], effectAllowed: 'none', dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value), getData: (type: string) => values.get(type) ?? '' }
    fireEvent.dragStart(ui.getByRole('button', { name: '段落操作', exact: true }), { dataTransfer: transfer })
    expect(transfer.getData(DOCUMENT_BLOCK_DRAG_MIME)).toBe('b')
    const beforeDrag = (await service.internalAPI.read(created.documentId)).undoDepth
    const destination = ui.container.querySelector<HTMLElement>('[data-flow-block-id="a"]')!
    destination.getBoundingClientRect = () => new DOMRect(100, 100, 400, 30)
    await act(async () => fireEvent.drop(destination, { dataTransfer: transfer, clientY: 101 }))
    await settle()
    expect(body()).toEqual(['b', 'a', inserted, 'c', 'table'])
    expect((await service.internalAPI.read(created.documentId)).undoDepth).toBe(beforeDrag + 1)
    expect(current().instances.float).toEqual(initial.instances.float)
    await act(async () => fireEvent.keyDown(editor.view.dom, { key: 'z', ctrlKey: true }))
    await waitFor(() => expect(body()).toEqual(['a', inserted, 'b', 'c', 'table']))

    await act(async () => fireEvent.click(ui.getByTestId('flow-paper')))
    const afterTable = editor.view.state.doc.lastChild!.attrs.id as string
    expect(editor.view.state.doc.lastChild!.type.name).toBe('paragraph')
    await act(async () => editor.view.dispatch(editor.view.state.tr.insertText('表格后的正文')))
    await settle()
    expect(body().at(-1)).toBe(afterTable)
    expect(textComponentDataSchema.parse(current().instances[afterTable].data).content.inlines).toEqual([{ type: 'text', text: '表格后的正文' }])

    focus(afterTable)
    fireEvent.click(ui.getByRole('button', { name: '插入段落', exact: true }))
    await act(async () => fireEvent.click(ui.getByRole('menuitem', { name: '下方插入分隔线', exact: true })))
    await settle()
    expect(projectFlowDocument(current(), 'flow').content.blocks.at(-1)!.type).toBe('divider')
    await act(async () => fireEvent.click(ui.getByRole('button', { name: '继续输入正文', exact: true })))
    await act(async () => editor.view.dispatch(editor.view.state.tr.insertText('分隔线后的正文')))
    await settle()
    const finalBody = projectFlowDocument(current(), 'flow').content.blocks
    expect(finalBody.at(-1)).toMatchObject({ type: 'paragraph', content: { inlines: [{ type: 'text', text: '分隔线后的正文' }] } })
    expect(current().instances.float).toEqual(initial.instances.float)
    expect(ui.queryByRole('alert')).toBeNull()
  } finally {
    cleanup(); vi.restoreAllMocks(); bridge.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
