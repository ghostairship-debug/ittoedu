// @vitest-environment jsdom
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { TEXT_DEFINITION, createTextData, textDataSchema } from '../../src/components/text'
import { INPUT_DEFINITION, createInputData } from '../../src/components/input/data'
import { componentInputRuleEdits, inspectComponentInputRules } from '../../src/components/input/authoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { discardPropertiesDrafts, PropertyDraftBoundary } from '../../src/renderer/ui/properties/PropertyControls'
import { NativeTableProperties } from '../../src/renderer/ui/properties/NativeTableProperties'
import { createTableData, TABLE_DEFINITION } from '../../src/components/table'
import { parseTableData, tableCellContent } from '../../src/components/table/data'

afterEach(() => { cleanup(); const store = useEditorStore.getState(); if (store.courseView.activeDocumentId) discardPropertiesDrafts(store.courseView.activeDocumentId); useEditorStore.setState({ slideContentEdit: null }); store.courseBridge.dispose() })
function textProject(flow = false) {
  const project = createBlankCourseProjectV10()
  if (flow) { testContainerInstance(project, 0).container.kind = 'flow'; delete testContainerInstance(project, 0).container.designSize }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('original'))),
    frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  testContainerInstance(project, 0).childIds.push('text')
  return project
}
function drafts(h: Awaited<ReturnType<typeof createV10StoreHost>>) {
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  return { slice, read: () => owned }
}
const data = (text: string) => JSON.parse(JSON.stringify(createTextData(text)))
const text = (value: unknown) => textDataSchema.parse(value).content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join('')

it('CA016 retains composing text and its state, then commits before selecting another state', async () => {
  const project = textProject(); testContainerInstance(project, 0).container.presentation = { states: [{ id: 'A', title: 'A', overrides: {} }, { id: 'B', title: 'B', overrides: {} }] }
  const h = await createV10StoreHost(project), d = drafts(h)
  h.bridge.selectPresentationState(h.first.documentId, 'A'); d.slice.beginSlideDataEdit('text'); d.slice.updateSlideDataDraft(data('A input'), true)
  await expect(d.slice.setActivePresentationState('B')).rejects.toThrow('完成正在输入')
  expect(h.bridge.read().activeStateId).toBe('A'); expect(text(d.read().slideContentEdit?.data)).toBe('A input')
  d.slice.setSlideTextEditComposing(false); await d.slice.setActivePresentationState('B')
  expect(h.bridge.read().activeStateId).toBe('B'); expect(d.read().slideContentEdit).toBeNull()
  h.bridge.selectPresentationState(h.first.documentId, 'A'); expect(text(h.bridge.read().editingProject?.instances.text.data)).toBe('A input')
  h.bridge.selectPresentationState(h.first.documentId, 'B'); expect(text(h.bridge.read().editingProject?.instances.text.data)).toBe('original')
  h.bridge.dispose()
})

it('CA017 advances a successor only through its own ACK and continues rejecting external text changes', async () => {
  const h = await createV10StoreHost(textProject()), d = drafts(h), gate = deferred()
  let first = true
  h.controls.after = async () => { if (first) { first = false; await gate.promise } }
  d.slice.beginSlideDataEdit('text'); d.slice.updateSlideDataDraft(data('first'))
  const accepted = d.slice.commitTextEdit(); await Promise.resolve(); await Promise.resolve()
  d.slice.updateSlideDataDraft(data('first plus typing')); gate.resolve(); await accepted
  expect(text(d.read().slideContentEdit?.originalData)).toBe('first')
  await d.slice.commitTextEdit(); expect(text(h.model().project.instances.text.data)).toBe('first plus typing')
  d.slice.beginSlideDataEdit('text'); d.slice.updateSlideDataDraft(data('human input'))
  await h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['content'], value: { inlines: [{ type: 'text', text: 'external' }] } }])
  await expect(d.slice.commitTextEdit()).rejects.toThrow()
  expect(text(d.read().slideContentEdit?.data)).toBe('human input'); expect(text(h.model().project.instances.text.data)).toBe('external')
  h.bridge.dispose()
})

it('CA069 Esc uses the last own ACK and does not overwrite accepted external Flow text', async () => {
  const h = await createV10StoreHost(textProject(true), undefined, false)
  const store = () => useEditorStore.getState(); await store().connectCourseDocuments(h.api); store().selectNode('text')
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage() {} }))
  const commands = () => { const context = hook.result.current; if (!('native' in context) || !context.native) throw new Error('Expected Flow native'); return context.native.commands.text }
  await act(async () => { commands().beginEdit('properties'); commands().updateDraft('local'); await store().drainCourseDocument() })
  expect(text(h.model().project.instances.text.data)).toBe('local')
  await act(async () => { await store().courseKernel.edit([{ type: 'data.set', instanceId: 'text', path: ['content'], value: { inlines: [{ type: 'text', text: 'AI revision' }] } }]) })
  await act(async () => { commands().cancelEdit(); await store().drainCourseDocument(); await Promise.resolve() })
  expect(text(h.model().project.instances.text.data)).toBe('AI revision')
  expect(store().errorMessage).toBeTruthy()
})

it('CA097 uses the selected effective inline style when the same local range is toggled twice', async () => {
  const h = await createV10StoreHost(textProject(), undefined, false)
  const store = () => useEditorStore.getState(); await store().connectCourseDocuments(h.api); store().selectNode('text')
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage() {} }))
  const commands = () => { const context = hook.result.current; if (context.kind !== 'slide-native') throw new Error('Expected slide'); return context.commands.text }
  await act(async () => { commands().toggleStyle('bold', { start: 1, end: 3 }); await store().drainCourseDocument() })
  expect(textDataSchema.parse(h.model().project.instances.text.data).content.inlines.some(inline => inline.type === 'text' && inline.style?.bold)).toBe(true)
  await act(async () => { commands().toggleStyle('bold', { start: 1, end: 3 }); await store().drainCourseDocument() })
  expect(textDataSchema.parse(h.model().project.instances.text.data).content.inlines.some(inline => inline.type === 'text' && inline.style?.bold)).toBe(false)
})

it('commits property table navigation after live updates instead of cancelling the edited cell baseline', async () => {
  const project = createBlankCourseProjectV10()
  project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
  project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTableData({ rows: 2, columns: 2 }))),
    frame: { width: 400, height: 160, transform: [1, 0, 0, 1, 0, 0] } }
  testContainerInstance(project, 0).childIds.push('table')
  const h = await createV10StoreHost(project, undefined, false)
  const store = () => useEditorStore.getState()
  await store().connectCourseDocuments(h.api); store().selectNode('table')
  function TablePanel() {
    const context = usePropertiesAuthoringBinding({ onReplaceImage() {} })
    if (context.kind !== 'slide-native' || context.view.type !== 'table' || !context.commands.table)
      throw new Error('Expected real table properties binding')
    return <PropertyDraftBoundary bindingKey={context.draftBindingKey} onStale={() => {}}>
      <NativeTableProperties node={context.view} bindingKey={context.draftBindingKey} commands={context.commands.table}/>
    </PropertyDraftBoundary>
  }
  render(<TablePanel/>)
  const table = () => parseTableData(h.model().project.instances.table.data)
  const originalRows = table().rows.map(row => row.id), originalColumns = table().columns.map(column => column.id)
  const cellText = (row: number, column: number) => tableCellContent(table().rows[row]!.cells[column]!).inlines
    .map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('')
  const input = (row: number, column: number) => screen.getByLabelText(`单元格 第 ${row + 1} 行，第 ${column + 1} 列`)
  const edit = async (row: number, column: number, value: string, key: string, shiftKey = false) => {
    const field = input(row, column)
    act(() => field.focus())
    await act(async () => {
      fireEvent.change(field, { target: { value } })
    })
    // The formal/live projection already equals the draft before navigation.
    await waitFor(() => expect(cellText(row, column)).toBe(value))
    await act(async () => {
      fireEvent.keyDown(field, { key, shiftKey })
      await store().drainCourseDocument()
    })
    expect(cellText(row, column)).toBe(value)
    expect(input(row, column)).toHaveValue(value)
  }
  await edit(0, 0, '测试123', 'Tab')
  expect(input(0, 1)).toHaveFocus()
  await edit(0, 1, '保留450', 'Enter')
  expect(input(1, 0)).toHaveFocus()
  await edit(1, 0, '第二行内容', 'Tab', true)
  expect(input(0, 1)).toHaveFocus()
  await edit(1, 1, '末格内容', 'Tab')
  expect(table().rows).toHaveLength(3)
  await edit(2, 0, '追加行文字', 'Tab')
  expect(table().rows.slice(0, 2).map(row => row.id)).toEqual(originalRows)
  expect(table().columns.map(column => column.id)).toEqual(originalColumns)

  const first = input(0, 0)
  act(() => first.focus())
  await act(async () => {
    fireEvent.change(first, { target: { value: '应放弃的输入' } })
  })
  await waitFor(() => expect(cellText(0, 0)).toBe('应放弃的输入'))
  await act(async () => {
    fireEvent.keyDown(first, { key: 'Escape' })
    await store().drainCourseDocument()
  })
  await waitFor(() => {
    expect(cellText(0, 0)).toBe('测试123')
    expect(input(0, 0)).toHaveValue('测试123')
  })
  expect(cellText(0, 1)).toBe('保留450')
  expect(cellText(2, 0)).toBe('追加行文字')
})

it('CA338 plans repeated grading changes against the effective named state and preserves untouched state fields', async () => {
  const project = textProject(); project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: JSON.parse(JSON.stringify(createInputData({ placeholder: 'base hint' }))), frame: { width: 200, height: 50, transform: [1, 0, 0, 1, 0, 0] } }
  testContainerInstance(project, 0).childIds.push('input'); testContainerInstance(project, 0).container.presentation = { states: [{ id: 'B', title: 'B', overrides: {} }] }
  const h = await createV10StoreHost(project); h.bridge.selectInstances(h.first.documentId, ['input']); h.bridge.selectPresentationState(h.first.documentId, 'B')
  await h.kernel.edit([{ type: 'data.set', instanceId: 'input', path: ['placeholder'], value: 'B hint' }])
  const configure = async (answer: string) => {
    const target = h.kernel.captureTarget(), edits = componentInputRuleEdits(target, { mode: 'apply', config: { answerType: 'text', answers: [answer],
      correct: [{ type: 'node.enter', nodeId: 'text', effect: 'none', durationMs: 0, easing: 'linear' }], error: [{ type: 'node.exit', nodeId: 'text', effect: 'none', durationMs: 0, easing: 'linear' }] } })
    await h.kernel.editCaptured(h.kernel.capture(edits, target))
  }
  await configure('first'); await configure('second')
  const effective = h.kernel.readEditingDocument(), inspection = inspectComponentInputRules(effective, componentSurfaces(project)[0].id, 'input')
  expect(inspection.conflict).toBe(false); expect(inspection.config).toMatchObject({ answers: ['second'] })
  expect(effective.instances.input.data).toMatchObject({ placeholder: 'B hint' }); expect(h.model().project.instances.input.data).toMatchObject({ placeholder: 'base hint', acceptedAnswers: [] })
  h.bridge.dispose()
})
