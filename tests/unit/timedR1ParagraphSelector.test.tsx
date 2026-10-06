// @vitest-environment jsdom
import { createRef, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TextSelection } from 'prosemirror-state'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { SharedDocumentEditor, type SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'
import * as sessions from '../../src/renderer/document/editorSession'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { MarkdownDocument } from '../../src/shared/document/markdown'
import type { DocumentBlock } from '../../src/shared/document/content'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { flowDocumentEdits, projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'

const geometry = ['getClientRects', 'getBoundingClientRect'] as const
const descriptors = geometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => geometry.forEach((key, index) => {
  const descriptor = descriptors[index]
  if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
  else Reflect.deleteProperty(Range.prototype, key)
}))

it('projects the actual heading caret into the paragraph selector, commits body once and restores the heading through formal undo', async () => {
  const heading: DocumentBlock = { id: 'heading', type: 'heading', level: 2,
    content: { inlines: [{ type: 'text', text: '原生标题', style: { italic: true, color: '#123456' } }] } }
  const project: CourseProjectV10 = {
    schemaVersion: 10, id: 'paragraph-selector', revision: 0, title: '段落类型',
    definitions: { [DOCUMENT_BLOCK_DEFINITION.id]: DOCUMENT_BLOCK_DEFINITION, [TEXT_DEFINITION.id]: TEXT_DEFINITION },
    instances: {
      heading: { id: 'heading', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: documentBlockData(heading) },
      body: { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('保留正文'))) },
    },
    surfaces: [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['heading', 'body'] }],
    global: { underlay: [], overlay: [] }, assets: {},
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-r1-paragraph-'))
  const host = new DocumentHostService(path.join(directory, 'recovery')), bridge = new CourseV10DocumentBridge()
  const created = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '段落类型')
  const unavailable = async (): Promise<never> => { throw new Error('This focused editor case has no dialogs') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(), saveWithDialog: unavailable,
    close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => host.subscribeEvents(listener) }
  try {
    await bridge.connect(api); await bridge.activate(created.documentId)
    const originalBody = structuredClone(bridge.read().project!.instances.body)
    const handle = createRef<SharedDocumentEditorHandle>(), factory = vi.spyOn(sessions, 'createLayoutEditor')
    const commit = vi.fn(async (next: MarkdownDocument, operation: sessions.DocumentOperation) => {
      const target = bridge.captureTarget(created.documentId)
      await bridge.editCaptured(bridge.capture(flowDocumentEdits(target.project, 'flow', next.content.blocks), target), operation.historyGroup)
      return true
    })
    const undo = vi.fn(async () => { await bridge.undo(created.documentId) })
    function Editor() {
      const state = useSyncExternalStore(bridge.subscribe, bridge.read, bridge.read)
      return <SharedDocumentEditor ref={handle} document={projectFlowDocument(state.editingProject!, 'flow')}
        revision={`${state.snapshot!.epoch}:${state.snapshot!.revision}`} target="flow"
        onChange={commit} onDraft={() => {}} onUndo={undo} onRedo={async () => { await bridge.redo(created.documentId) }} />
    }
    const ui = render(<Editor />), editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    const selector = ui.getByRole('combobox', { name: '段落类型' })
    await act(async () => {
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2)))
      editor.view.focus()
    })
    expect(selector).toHaveValue('2')
    expect(commit).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.change(selector, { target: { value: 'paragraph' } })
      expect((await handle.current!.drain()).ready).toBe(true)
    })
    expect(selector).toHaveValue('paragraph')
    expect(editor.view.state.selection.head).toBe(2)
    expect(editor.view.state.selection.$head.parent.attrs.id).toBe('heading')
    expect(commit).toHaveBeenCalledTimes(1)
    expect(projectFlowDocument(bridge.read().project!, 'flow').content.blocks[0]).toMatchObject({ id: 'heading', type: 'paragraph', content: heading.content })
    expect(bridge.read().project!.surfaces[0].childIds).toEqual(['heading', 'body'])
    expect(bridge.read().project!.instances.body).toEqual(originalBody)
    expect((await host.internalAPI.read(created.documentId)).undoDepth).toBe(1)
    await act(async () => { editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })) })
    await waitFor(() => expect(selector).toHaveValue('2'))
    expect(editor.view.state.selection.head).toBe(2)
    expect(editor.view.state.selection.$head.parent.attrs.id).toBe('heading')
    expect(undo).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(projectFlowDocument(bridge.read().project!, 'flow').content.blocks[0]).toEqual(heading)
    expect(bridge.read().project!.instances.body).toEqual(originalBody)
    expect((await host.internalAPI.read(created.documentId)).undoDepth).toBe(0)
  } finally {
    cleanup(); vi.restoreAllMocks(); bridge.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
