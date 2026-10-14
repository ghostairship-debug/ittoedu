// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { TEXT_DEFINITION, createTextData, textDataSchema } from '../../src/components/text'
import { INPUT_DEFINITION, createInputData } from '../../src/components/input/data'
import { componentInputRuleEdits, inspectComponentInputRules } from '../../src/components/input/authoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { discardPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'

afterEach(() => { cleanup(); const store = useEditorStore.getState(); if (store.courseView.activeDocumentId) discardPropertiesDrafts(store.courseView.activeDocumentId); useEditorStore.setState({ slideContentEdit: null }); store.courseBridge.dispose() })
function textProject(flow = false) {
  const project = createBlankCourseProjectV10()
  if (flow) { project.surfaces[0].kind = 'flow'; delete project.surfaces[0].designSize }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('original'))),
    frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces[0].childIds.push('text')
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
  const project = textProject(); project.surfaces[0].presentation = { states: [{ id: 'A', title: 'A', overrides: {} }, { id: 'B', title: 'B', overrides: {} }] }
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

it('CA338 plans repeated grading changes against the effective named state and preserves untouched state fields', async () => {
  const project = textProject(); project.definitions[INPUT_DEFINITION.id] = INPUT_DEFINITION
  project.instances.input = { id: 'input', definitionId: INPUT_DEFINITION.id, data: JSON.parse(JSON.stringify(createInputData({ placeholder: 'base hint' }))), frame: { width: 200, height: 50, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces[0].childIds.push('input'); project.surfaces[0].presentation = { states: [{ id: 'B', title: 'B', overrides: {} }] }
  const h = await createV10StoreHost(project); h.bridge.selectInstances(h.first.documentId, ['input']); h.bridge.selectPresentationState(h.first.documentId, 'B')
  await h.kernel.edit([{ type: 'data.set', instanceId: 'input', path: ['placeholder'], value: 'B hint' }])
  const configure = async (answer: string) => {
    const target = h.kernel.captureTarget(), edits = componentInputRuleEdits(target, { mode: 'apply', config: { answerType: 'text', answers: [answer],
      correct: [{ type: 'node.enter', nodeId: 'text', effect: 'none', durationMs: 0, easing: 'linear' }], error: [{ type: 'node.exit', nodeId: 'text', effect: 'none', durationMs: 0, easing: 'linear' }] } })
    await h.kernel.editCaptured(h.kernel.capture(edits, target))
  }
  await configure('first'); await configure('second')
  const effective = h.kernel.readEditingDocument(), inspection = inspectComponentInputRules(effective, project.surfaces[0].id, 'input')
  expect(inspection.conflict).toBe(false); expect(inspection.config).toMatchObject({ answers: ['second'] })
  expect(effective.instances.input.data).toMatchObject({ placeholder: 'B hint' }); expect(h.model().project.instances.input.data).toMatchObject({ placeholder: 'base hint', acceptedAnswers: [] })
  h.bridge.dispose()
})
