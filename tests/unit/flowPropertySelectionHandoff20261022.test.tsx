import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import type { DocumentSelection } from '../../src/shared/document/ports'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { PropertiesPanelRouter } from '../../src/renderer/ui/properties/PropertiesPanelRouter'
import { NodesTab } from '../../src/renderer/ui/NodesTab'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'

const store = () => useEditorStore.getState()
const onReplaceImage = () => {}
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); store().courseBridge.dispose(); for (const dispose of disposers.splice(0)) dispose() })
function Inspector() { return <PropertiesPanelRouter context={usePropertiesAuthoringBinding({ onReplaceImage })} /> }
async function fixture() {
  const project = createBlankCourseProjectV10('文字范围到图层选择')
  setRootContainers(project, [{ id: 'reading', kind: 'flow', title: '阅读', childIds: ['group'],
    flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 } } }])
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.group = { id: 'group', definitionId: 'group', name: '阅读组', data: {}, childIds: ['first', 'second'], style: { display: 'flex', flexDirection: 'column', gap: 24 } }
  for (const [id, name, text] of [['first', '原生标题', 'First title'], ['second', '原生正文', 'Second paragraph']]) {
    project.instances[id] = { id, definitionId: 'text', name, data: JSON.parse(JSON.stringify(createTextComponentData(text))) }
  }
  const host = await createV10StoreHost(project, undefined, false)
  disposers.push(() => host.bridge.dispose())
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene')
  render(<><NodesTab /><Inspector /></>)
  return host
}
function selectText(blockId: string, from: number, to: number) {
  const view = store().courseView
  const point = { blockId, slot: { kind: 'field', field: 'content' } as const }
  const selection: DocumentSelection = { kind: 'text', revision: String(view.project!.revision),
    anchor: { ...point, offset: from, affinity: 'after' }, head: { ...point, offset: to, affinity: 'before' } }
  // This is the same public selection handoff used by FlowWorkspace's PM onSelection.
  act(() => {
    store().setFlowContextSelection(selection)
    store().courseBridge.selectInteraction(view.activeDocumentId!, { kind: 'document', selection }, 'reading')
  })
}
function setFontSize(value: string) {
  const input = screen.getByLabelText('字号')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

it('changes a nested native title after a real old paragraph range is replaced by layer object selection', async () => {
  const host = await fixture()
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  selectText('second', 0, 6)
  expect(store().flowContextSelection?.kind).toBe('text')
  fireEvent.click(screen.getByRole('treeitem', { name: '原生标题' }))
  expect(store().flowContextSelection).toBeNull()
  expect(screen.getByTestId('flow-selection-format-properties')).toHaveAttribute('data-flow-format-mode', 'whole-block')
  setFontSize('46')
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines).toEqual([
    { type: 'text', text: 'First title', style: { fontSize: 46 } },
  ])
  expect(host.model().project.instances.second).toEqual(before.instances.second)
  expect(host.model().project.instances.group).toEqual(before.instances.group)
  expect(store().courseView.selectedInstanceIds).toEqual(['first'])
  await act(async () => { await store().courseBridge.undo(store().courseView.activeDocumentId!) })
  expect(host.model().project.instances).toEqual(before.instances)
})

it('preserves a current native text range while editing its properties and returns to whole-block intent on explicit object selection', async () => {
  const host = await fixture()
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  selectText('first', 0, 5)
  expect(screen.getByTestId('flow-selection-format-properties')).toHaveAttribute('data-flow-format-mode', 'range')
  setFontSize('38')
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  const inlines = textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines
  expect(inlines).toEqual([{ type: 'text', text: 'First', style: { fontSize: 38 } }, { type: 'text', text: ' title' }])
  expect(host.model().project.instances.second).toEqual(before.instances.second)
  expect(store().flowContextSelection?.kind).toBe('text')
  await act(async () => { await store().courseBridge.undo(store().courseView.activeDocumentId!) })
  expect(host.model().project.instances).toEqual(before.instances)
  fireEvent.click(screen.getByRole('treeitem', { name: '原生标题' }))
  expect(store().flowContextSelection).toBeNull()
  expect(screen.getByTestId('flow-selection-format-properties')).toHaveAttribute('data-flow-format-mode', 'whole-block')
})
