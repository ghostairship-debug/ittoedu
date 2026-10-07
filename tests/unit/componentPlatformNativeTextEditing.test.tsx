import { createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { act, fireEvent, within } from '@testing-library/react'
import type { EditorView } from 'prosemirror-view'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { createFormulaComponentData, type FormulaComponentData, type TextComponentData } from '../../src/components/text/data'
import { FormulaComponentEditor, TextComponentEditor } from '../../src/components/text/editor'
import type { CourseProjectV10, JsonValue } from '../../src/shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { useSlideNativeTextEditor } from '../../src/renderer/ui/workspaces/useSlideNativeTextEditor'
import type { SharedDocumentEditorHandle } from '../../src/renderer/document/SharedDocumentEditor'

const probe = vi.hoisted(() => ({ view: null as EditorView | null }))
// jsdom does not lay out ranges. Keep PM's real selection observer running with
// the same geometry API a browser supplies; these tests assert author data, not pixels.
const rangeGeometry = ['getClientRects', 'getBoundingClientRect'] as const
const originalRangeGeometry = rangeGeometry.map(key => Object.getOwnPropertyDescriptor(Range.prototype, key))
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => rangeGeometry.forEach((key, index) => {
  const descriptor = originalRangeGeometry[index]
  if (descriptor) Object.defineProperty(Range.prototype, key, descriptor)
  else Reflect.deleteProperty(Range.prototype, key)
}))
vi.mock('../../src/renderer/document/editorSession', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/document/editorSession')>()
  return { ...actual, createLayoutEditor: (...args: Parameters<typeof actual.createLayoutEditor>) => {
    const editor = actual.createLayoutEditor(...args)
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => {
      // Before the toolbar portal mounts, its inline toolbar moves this editor below the double-click point.
      const overlay = editor.view.dom.closest('.text-edit-overlay')
      return overlay?.querySelector('.shared-document-toolbar') ? null : { pos: 2, inside: 0 }
    })
    probe.view = editor.view
    return editor
  } }
})

describe('Main native text editing', () => {
  it('forwards a delayed formal ACK and retains the professional text draft on rejection', async () => {
    const original = createTextComponentData('原文')
    const before = structuredClone(original)
    let reject!: (error: Error) => void
    const ack = new Promise<void>((_resolve, fail) => { reject = fail })
    const change = vi.fn((_data: TextComponentData) => ack), report = vi.fn()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const editorRef = createRef<SharedDocumentEditorHandle>()
    try {
      await act(async () => root.render(<TextComponentEditor data={original} revision="doc:instance"
        editorRef={editorRef}
        onChange={change} onUndo={() => {}} onRedo={() => {}} onDiagnostic={report} />))
      const view = probe.view!
      await act(async () => expect(editorRef.current!.focusAtClientPoint({ x: 60, y: 70 })).toBe(true))
      expect(view.state.selection.from).toBe(2)
      expect(change).not.toHaveBeenCalled()
      const composing = vi.spyOn(view, 'composing', 'get').mockReturnValue(true)
      expect(editorRef.current!.focusAtClientPoint({ x: 80, y: 70 })).toBe(false)
      composing.mockRestore()
      await act(async () => view.dispatch(view.state.tr.insertText('新', 1)))
      expect(change).toHaveBeenCalledTimes(1)
      expect(change.mock.calls[0][0].content.inlines[0]).toMatchObject({ type: 'text', text: '新原文' })
      expect(report).not.toHaveBeenCalled()
      await act(async () => { reject(new Error('目标已改变')) })
      expect(report).toHaveBeenCalledWith('目标已改变')
      expect(probe.view).toBe(view)
      expect(view.state.doc.textContent).toBe('新原文')
      expect(change).toHaveBeenCalledTimes(1)
      expect(original).toEqual(before)
    } finally {
      await act(async () => root.unmount()); host.remove(); probe.view = null
    }
  })

  it('edits a formula through its professional form and preserves its identity and authored styles', async () => {
    const original: FormulaComponentData = { ...createFormulaComponentData('force', 'F'),
      formula: { ...createFormulaComponentData('force', 'F').formula, style: { fontSize: 31, color: '#123456' } } }
    const change = vi.fn(async (_data: FormulaComponentData) => {}), report = vi.fn()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<FormulaComponentEditor data={original} revision="doc:formula"
        onChange={change} onUndo={() => {}} onRedo={() => {}} onDiagnostic={report} />))
      await act(async () => fireEvent.click(within(host).getByRole('button', { name: '编辑公式' })))
      await act(async () => fireEvent.change(within(host).getByLabelText('LaTeX'), { target: { value: 'F=ma' } }))
      await act(async () => fireEvent.click(within(host).getByRole('button', { name: '应用公式' })))
      expect(change).toHaveBeenCalledTimes(1)
      const data = change.mock.calls[0][0]
      expect(data.formula).toMatchObject({ formulaId: 'force', latex: 'F=ma', style: original.formula.style })
      expect(data.appearance).toEqual(original.appearance)
      expect(data.sizing).toEqual(original.sizing)
      expect(host.querySelector('select[aria-label="段落类型"]')).toBeNull()
      expect(report).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount()); host.remove(); probe.view = null
    }
  })

  it('uses the professional definition with a playback source override and preserves rich atoms in the captured draft', async () => {
    const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value))
    const original = createTextComponentData({ inlines: [
      { type: 'text', text: '人工', style: { bold: false, highlightColor: null } },
      { type: 'math', formulaId: 'force', latex: 'F', accessibleText: '浮力' },
      { type: 'text', text: '观察', style: { italic: true } },
    ] })
    const project: CourseProjectV10 = { schemaVersion: 10, id: 'native-edit', title: '文字编辑', revision: 0,
      definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION },
      instances: {
        text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: json(original),
          frame: { width: 300, height: 80, transform: [1, 0, 0, 1, 40, 50] },
          implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } },
        neighbor: { id: 'neighbor', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData('邻居')),
          frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 400, 50] } },
      }, surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: ['text', 'neighbor'] }],
      global: { underlay: [], overlay: [] }, assets: {} }
    const before = structuredClone(project)
    const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project,
      resources: { assets: {}, components: {} }, surfaceId: 'slide', activeStateId: null,
      instanceIds: ['text'], instanceId: 'text' }
    const update = vi.fn(), commit = vi.fn(async () => {}), report = vi.fn()
    const owner: { entry?: ReturnType<typeof useSlideNativeTextEditor>; draft?: SlideContentEdit | null; switchDocument?: () => void } = {}
    function MainNativeEditor() {
      const [edit, setEdit] = useState<SlideContentEdit | null>(null)
      const [documentId, setDocumentId] = useState('doc')
      owner.switchDocument = () => {
        setDocumentId('other-doc')
        setEdit(previous => previous && ({ ...previous, target: { ...target, documentId: 'other-doc' } }))
      }
      owner.draft = edit
      owner.entry = useSlideNativeTextEditor({ project, surfaceId: 'slide', edit,
        begin: instanceId => {
          const instance = project.instances[instanceId]
          const next: SlideContentEdit = { instanceId, definitionId: instance.definitionId, target,
            data: structuredClone(instance.data), originalData: structuredClone(instance.data), source: 'canvas', composing: false }
          setEdit(next)
          return next
        },
        update: (data, composing, height) => {
          update(data, composing, height)
          setEdit(previous => previous && ({ ...previous, data: json(data), composing: composing ?? previous.composing }))
        }, commit, cancel: () => setEdit(null), undo: () => {}, redo: () => {}, host: () => host, report,
      }, documentId + ':slide')
      return owner.entry.editor
    }
    const host = document.createElement('div'); document.body.append(host)
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<MainNativeEditor />) })
      await act(async () => { expect(owner.entry!.begin('text', { x: 60, y: 70 }, { x: 60, y: 70 })).toBe(true) })
      expect(probe.view).not.toBeNull()
      expect(host.querySelector('[data-component-professional-editor]')).not.toBeNull()
      expect(host.querySelector('select[aria-label="段落类型"]')).toBeNull()
      expect([...host.querySelectorAll('button')].some(button => button.textContent === '源文')).toBe(false)
      expect(probe.view!.posAtCoords).toHaveBeenCalledWith({ left: 60, top: 70 })
      expect(probe.view!.state.selection.from).toBe(2)
      await act(async () => { const view = probe.view!; view.dispatch(view.state.tr.insertText('新')) })
      const data = textComponentDataSchema.parse(owner.draft!.data)
      expect(data.content.inlines.find(atom => atom.type === 'math')).toEqual(original.content.inlines[1])
      expect(data.content.inlines.some(atom => atom.type === 'text' && atom.text.includes('人新工')
        && atom.style?.bold === false && atom.style?.highlightColor === null)).toBe(true)
      expect(data.content.inlines.some(atom => atom.type === 'text' && atom.text.includes('观察') && atom.style?.italic)).toBe(true)
      expect(update).toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
      expect(report).not.toHaveBeenCalled()
      expect(project).toEqual(before)
      expect(owner.draft!.target).toBe(target)
      // Navigation may replace the draft before the blur microtask runs.
      // That queued event must never commit the newly mounted document.
      await act(async () => {
        fireEvent.blur(probe.view!.dom, { relatedTarget: document.body })
        flushSync(() => owner.switchDocument!())
      })
      expect(owner.draft!.target.documentId).toBe('other-doc')
      expect(commit).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() }); host.remove(); probe.view = null
    }
  })
})
