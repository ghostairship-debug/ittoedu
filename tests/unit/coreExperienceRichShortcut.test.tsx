// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EditorView } from 'prosemirror-view'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const probe = vi.hoisted(() => ({ view: null as EditorView | null }))
vi.mock('../../src/renderer/document/editorSession', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/document/editorSession')>()
  return { ...actual, createLayoutEditor: (...args: Parameters<typeof actual.createLayoutEditor>) => {
    const editor = actual.createLayoutEditor(...args); probe.view = editor.view; return editor
  } }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); probe.view = null })

it('commits the real rich field with Ctrl/Meta Enter, blocks IME and preserves the same draft when its owner refuses completion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rich-shortcut-'))
  const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  try {
    const host = new DocumentHostService(root), project = createBlankCourseProjectV10()
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('原文'))),
      frame: { transform: [1, 0, 0, 1, 20, 20], width: 300, height: 80 } }
    project.surfaces[0]!.childIds.push('text')
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'shortcut.h5lesson')
    const unavailable = async (): Promise<never> => { throw new Error('Outside shortcut fixture') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => snapshot, subscribe: host.subscribeEvents.bind(host),
      saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable, discardRecovery: unavailable }
    await useEditorStore.getState().connectCourseDocuments(api)
    useEditorStore.getState().selectNode('text'); useEditorStore.getState().beginSlideDataEdit('text')
    let refused = true
    const report = vi.fn(), commit = vi.fn(async () => {
      if (refused) throw new Error('当前输入尚未完成')
      await useEditorStore.getState().commitSlideContentEdit()
    })
    function RichField() {
      const state = useEditorStore()
      return useSlideNativeTextEditor({ project: state.courseView.project!, surfaceId: state.courseView.surfaceId!, edit: state.slideContentEdit,
        begin: state.beginSlideDataEdit, update: state.updateSlideDataDraft, setComposing: state.setSlideTextEditComposing,
        commit, cancel: state.cancelTextEdit, undo() {}, redo() {}, host: () => document.body, report }, snapshot.documentId).editor
    }
    const ui = render(<RichField />), view = probe.view!
    await act(async () => view.dispatch(view.state.tr.insertText('新', 1)))
    const sameDraft = useEditorStore.getState().slideContentEdit!
    const text = view.state.doc.textContent
    expect(text).toBe('新原文')
    await act(async () => fireEvent.compositionStart(view.dom))
    await act(async () => fireEvent.keyDown(view.dom, { key: 'Enter', ctrlKey: true, isComposing: true }))
    expect(commit).not.toHaveBeenCalled()
    await act(async () => fireEvent.compositionEnd(view.dom))
    await act(async () => fireEvent.keyDown(view.dom, { key: 'Enter', ctrlKey: true }))
    expect(commit).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledWith('当前输入尚未完成')
    expect(useEditorStore.getState().slideContentEdit?.data).toEqual(sameDraft.data)
    expect(probe.view).toBe(view); expect(view.state.doc.textContent).toBe(text)
    expect((await host.internalAPI.read(snapshot.documentId)).undoDepth).toBe(0)
    refused = false
    await act(async () => fireEvent.keyDown(view.dom, { key: 'Enter', metaKey: true }))
    await waitFor(() => expect(useEditorStore.getState().slideContentEdit).toBeNull())
    expect(commit).toHaveBeenCalledTimes(2); expect(ui.container.querySelector('.ProseMirror')).toBeNull()
    const current = await host.internalAPI.read(snapshot.documentId)
    expect(current.undoDepth).toBe(1)
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(current.model.project.instances.text!.data).toMatchObject({ content: { inlines: [{ type: 'text', text }] } })
  } finally {
    cleanup(); useEditorStore.getState().courseBridge.dispose()
    if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect); else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects); else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    await fs.rm(root, { recursive: true, force: true })
  }
})
