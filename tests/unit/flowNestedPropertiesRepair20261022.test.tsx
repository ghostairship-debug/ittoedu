import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import type { DocumentSelection } from '../../src/shared/document/ports'
import { discardPropertiesDrafts, flushPropertiesDrafts, hasPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { applyDocumentBlockCommand } from '../../src/renderer/document/documentBlockCommands'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { PropertiesPanelRouter } from '../../src/renderer/ui/properties/PropertiesPanelRouter'
import { NodesTab } from '../../src/renderer/ui/NodesTab'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'

const disposers: Array<() => void> = []
const store = () => useEditorStore.getState()
const onReplaceImage = () => {}
afterEach(() => {
  const documentId = store().courseView.activeDocumentId
  cleanup()
  if (documentId) discardPropertiesDrafts(documentId)
  for (const dispose of disposers.splice(0).reverse()) dispose()
  store().courseBridge.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Inspector() {
  return <PropertiesPanelRouter context={usePropertiesAuthoringBinding({ onReplaceImage })} />
}

async function fixture(opaque = false, kind: 'flow' | 'slide' | 'spatial' = 'flow') {
  const project = createBlankCourseProjectV10('原生嵌套属性')
  setRootContainers(project, [{ id: 'reading', kind, title: '阅读', childIds: ['outer', 'neighbor'],
    ...(kind === 'flow' ? { flow: { layout: { widthMode: 'reading' as const, readingWidth: 860, wideContentWidth: 1100 } } } : {}) }])
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.definitions.behavior = { id: 'behavior', role: 'behavior', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.outer = { id: 'outer', definitionId: 'group', name: '阅读外组', data: {}, childIds: ['group', 'outerPeer'],
    style: { display: 'flex', flexDirection: 'column', gap: 40 } }
  project.instances.group = { id: 'group', definitionId: 'group', name: '正文内容组', data: {}, childIds: ['first', 'second', 'behavior'],
    style: { display: 'grid', gridTemplateColumns: '1fr', gap: 'clamp(12px, 2vw, 24px)', padding: 'clamp(16px, 2vw, 32px) calc(1rem + 4px)' } }
  project.instances.behavior = { id: 'behavior', definitionId: 'behavior', name: '组内行为', data: {} }
  for (const [id, name, text] of [
    ['first', '原生首段', 'First paragraph'], ['second', '原生次段', 'Second paragraph'],
    ['outerPeer', '外组相邻段落', 'Outer peer'], ['neighbor', '页面相邻段落', 'Page neighbor'],
  ]) project.instances[id] = { id, definitionId: 'text', name, data: JSON.parse(JSON.stringify(createTextComponentData(text))) }
  if (opaque) {
    project.instances.group.frame = { width: 800, height: 400, transform: [1, 0, 0, 1, 0, 0] }
    project.instances.first.frame = { width: 300, height: 80, transform: [1, 0, 0, 1, 20, 20] }
  }
  const host = await createV10StoreHost(project, undefined, false)
  disposers.push(() => host.bridge.dispose())
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene')
  store().setActiveTab('layers')
  render(<><NodesTab /><Inspector /></>)
  return host
}

function select(name: string) {
  fireEvent.click(screen.getByRole('treeitem', { name }))
}

function unchangedInstances(before: CourseProjectV10, except: string[]) {
  const current = store().courseView.project!
  for (const [id, instance] of Object.entries(before.instances)) if (!except.includes(id)) expect(current.instances[id]).toEqual(instance)
}

function rejectNextCommit(host: Awaited<ReturnType<typeof fixture>>) {
  let reject: (() => void) | undefined
  // A definite refusal preserves the proposal for explicit resolution. The
  // formal host is unchanged; the renderer intentionally retains its preview.
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(operation => new Promise(resolve => {
    reject = () => resolve({ status: 'failed', documentId: operation.documentId, operationId: operation.operationId,
      code: 'fixture-property-rejected', message: '属性提交被拒绝', applied: false })
  }))
  return { ready: () => Boolean(reject), reject: () => reject!(), dispatch }
}

async function undo(before: CourseProjectV10, depth: number) {
  await act(async () => { await store().courseBridge.undo(store().courseView.activeDocumentId!) })
  expect(store().courseView.project!.instances).toEqual(before.instances)
  expect(store().courseView.project!.definitions).toEqual(before.definitions)
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)
}

it('selects real nested native text, exposes its semantic properties and applies only its format or type with Undo', async () => {
  await fixture()
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  select('原生首段')
  await waitFor(() => expect(store().courseView.selectedInstanceIds).toEqual(['first']))
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage }))
  const context = hook.result.current
  expect(context.kind).toBe('flow-block')
  if (context.kind !== 'flow-block') throw new Error('Expected semantic nested text properties')
  expect(context.view.blocks.map(({ blockId, parentId, index }) => [blockId, parentId, index])).toEqual([
    ['outer', null, 0], ['group', 'outer', 0], ['first', 'group', 0], ['second', 'group', 1], ['outerPeer', 'outer', 1], ['neighbor', null, 1],
  ])
  expect(screen.getByTestId('flow-block-properties')).toBeInTheDocument()
  expect(screen.queryByLabelText('页面标题')).not.toBeInTheDocument()
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)

  fireEvent.click(screen.getByTestId('flow-format-bold'))
  await waitFor(() => expect(store().courseView.snapshot!.undoDepth).toBe(depth + 1))
  expect(textComponentDataSchema.parse(store().courseView.project!.instances.first.data).content.inlines[0]).toMatchObject({ text: 'First paragraph', style: { bold: true } })
  unchangedInstances(before, ['first'])
  expect(store().courseView.selectedInstanceIds).toEqual(['first'])
  await undo(before, depth)

  fireEvent.change(screen.getByLabelText('块类型'), { target: { value: '2' } })
  await waitFor(() => expect(store().courseView.project!.instances.first.data).toMatchObject({ type: 'heading', level: 2 }))
  expect(store().courseView.snapshot!.undoDepth).toBe(depth + 1)
  unchangedInstances(before, ['first'])
  expect(store().courseView.selectedInstanceIds).toEqual(['first'])
  await undo(before, depth)
})

it('keeps reading moves and adjacent insertion inside the nested group through the existing formal owner', async () => {
  await fixture()
  select('原生首段')
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage }))
  const context = hook.result.current
  if (context.kind !== 'flow-block') throw new Error('Expected nested paragraph')
  act(() => context.commands.moveSelectedBlock('down'))
  await waitFor(() => expect(store().courseView.project!.instances.group.childIds).toEqual(['second', 'first', 'behavior']))
  unchangedInstances(before, ['group'])
  expect(store().courseView.project!.instances.group.style).toEqual(before.instances.group.style)
  await undo(before, depth)

  const target = store().courseKernel.captureTarget()
  const content = projectFlowDocument(target.editingProject, 'reading').content
  const inserted = applyDocumentBlockCommand(content, { action: 'insert-below', blockId: 'first', kind: 'paragraph' }, () => 'inserted-paragraph')
  await act(async () => {
    const receipt = await store().runFlowAuthoringIntent(target, { kind: 'replace-document-content', blocks: inserted.blocks, historyGroup: 'nested-property-insert' })
    expect(receipt.ok).toBe(true)
  })
  expect(store().courseView.project!.instances.group.childIds).toEqual(['first', 'inserted-paragraph', 'second', 'behavior'])
  expect(store().courseView.project!.instances.group.style).toEqual(before.instances.group.style)
  expect(store().courseView.project!.instances.group.definitionId).toBe(before.instances.group.definitionId)
  unchangedInstances(before, ['group'])
  expect(store().courseView.snapshot!.undoDepth).toBe(depth + 1)
  await undo(before, depth)
})

it('edits parent gap and padding as isolated style fields while preserving complex CSS, children and Undo', async () => {
  await fixture()
  select('正文内容组')
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  expect(screen.getByLabelText('子项间距')).toHaveValue(String(before.instances.group.style!.gap))
  expect(screen.getByLabelText('内边距')).toHaveValue(String(before.instances.group.style!.padding))
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)

  for (const [label, field, value, expected] of [
    ['子项间距', 'gap', '36', 36],
    ['内边距', 'padding', 'calc(1rem + 2px) 4vw clamp(8px, 2vw, 24px) 0', 'calc(1rem + 2px) 4vw clamp(8px, 2vw, 24px) 0'],
    ['子项间距', 'gap', '', ''],
  ] as const) {
    const input = screen.getByLabelText(label)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    await waitFor(() => expect(store().courseView.project!.instances.group.style?.[field]).toBe(expected))
    expect(store().courseView.project!.instances.group).toEqual({ ...before.instances.group, style: { ...before.instances.group.style, [field]: expected } })
    unchangedInstances(before, ['group'])
    expect(store().courseView.selectedInstanceIds).toEqual(['group'])
    expect(store().courseView.snapshot!.undoDepth).toBe(depth + 1)
    await undo(before, depth)
  }
})

it('rejects an old parent spacing command after selection changes without writing either group', async () => {
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage }))
  const context = hook.result.current
  if (context.kind !== 'flow-component' || !context.native) throw new Error('Expected native group properties')
  select('阅读外组')
  const count = host.operations.length
  await act(async () => {
    await expect(context.native!.commands.patch({ layoutStyle: { gap: 99 } })).rejects.toThrow('编辑目标已经改变')
  })
  expect(host.operations).toHaveLength(count)
  expect(store().courseView.project!.instances).toEqual(before.instances)
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)
  expect(store().courseView.selectedInstanceIds).toEqual(['outer'])
})

it('retains a spacing proposal after refusal, blocks automatic retry and explicitly retries exactly once', async () => {
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  const rejection = rejectNextCommit(host), documentId = store().courseView.activeDocumentId!
  const input = screen.getByLabelText('子项间距')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '48' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  const proposal = structuredClone(store().courseView.project!)
  expect(proposal.instances.group.style?.gap).toBe(48)
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(input).toHaveValue('48')
  expect(host.model().project.instances).toEqual(before.instances)
  expect(host.first.read().undoDepth).toBe(depth)
  expect(store().courseView.project!.instances).toEqual(proposal.instances)
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)
  await act(async () => { expect(await flushPropertiesDrafts(documentId)).toBe(false) })
  fireEvent.focus(input)
  fireEvent.blur(input)
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)
  expect(store().courseView.pending).toBe(1)

  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  expect(store().courseView.project!.instances.group.style?.gap).toBe(48)
  expect(store().courseView.project!.instances).toEqual(host.model().project.instances)
  expect(store().courseView.selectedInstanceIds).toEqual(['group'])
  unchangedInstances(before, ['group'])
  await undo(before, depth)
})

it.each(['字号', '行距', '字体'] as const)('retains rejected nested native %s input until a successful formal retry', async label => {
  const host = await fixture()
  select('原生首段')
  const before = structuredClone(store().courseView.project!), depth = store().courseView.snapshot!.undoDepth
  const rejection = rejectNextCommit(host), value = label === '字号' ? '38' : label === '行距' ? '16' : 'Property Retry Font'
  const input = screen.getByLabelText(label)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  const proposal = structuredClone(store().courseView.project!)
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  expect(input).toHaveValue(value)
  expect(host.model().project.instances).toEqual(before.instances)
  expect(host.first.read().undoDepth).toBe(depth)
  expect(store().courseView.project!.instances).toEqual(proposal.instances)
  expect(store().courseView.snapshot!.undoDepth).toBe(depth)
  expect(store().courseView.selectedInstanceIds).toEqual(['first'])
  await act(async () => { expect(await flushPropertiesDrafts(store().courseView.activeDocumentId!)).toBe(false) })
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)

  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  const data = textComponentDataSchema.parse(store().courseView.project!.instances.first.data)
  if (label === '字号') expect(data.content.inlines[0]).toMatchObject({ style: { fontSize: 38 } })
  else if (label === '行距') expect(data.appearance.lineSpacing).toBe(16)
  else expect(data.content.inlines[0]).toMatchObject({ style: { fontFamily: value } })
  unchangedInstances(before, ['first'])
  expect(host.model().project.instances.first).toEqual(store().courseView.project!.instances.first)
  await undo(before, depth)
})

it('retries a changed refused spacing value on blur without mistaking its retained preview for an external edit', async () => {
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const rejection = rejectNextCommit(host), input = screen.getByLabelText('子项间距')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '48' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '32' } })
  fireEvent.blur(input)
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  expect(host.model().project.instances.group.style?.gap).toBe(32)
  expect(input).toHaveValue('32')
  unchangedInstances(before, ['group'])
  await undo(before, depth)
})

it('explicitly cancels only a refused field proposal and leaves the field ready for a subsequent normal edit', async () => {
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const rejection = rejectNextCommit(host), input = screen.getByLabelText('子项间距')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '48' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(store().courseView.pending).toBe(0))
  await waitFor(() => expect(input).toHaveValue(String(before.instances.group.style!.gap)))
  expect(input).not.toHaveAttribute('aria-invalid', 'true')
  expect(host.model().project.instances).toEqual(before.instances)
  expect(store().courseView.project!.instances).toEqual(before.instances)
  expect(host.first.read().undoDepth).toBe(depth)
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '28' } })
  fireEvent.blur(input)
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  expect(host.model().project.instances.group.style?.gap).toBe(28)
  await undo(before, depth)
})

it('keeps unknown input and its original operation through flush, retry and cancel without redispatching', async () => {
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const dispatch = vi.spyOn(host.api, 'dispatch').mockRejectedValueOnce(new Error('属性传输中断'))
  const lookup = vi.spyOn(host.api, 'lookup').mockResolvedValue(null)
  const input = screen.getByLabelText('子项间距'), documentId = store().courseView.activeDocumentId!
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '48' } })
  fireEvent.blur(input)
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  const proposal = structuredClone(store().courseView.project!), operationId = dispatch.mock.calls[0]![0].operationId
  expect(store().courseView.pending).toBe(1)
  await act(async () => { expect(await flushPropertiesDrafts(documentId)).toBe(false) })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(lookup).toHaveBeenCalledWith(documentId, operationId))
  await act(async () => { expect(await flushPropertiesDrafts(documentId)).toBe(false) })
  const queries = lookup.mock.calls.length
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(lookup.mock.calls.length).toBeGreaterThan(queries))
  await act(async () => { expect(await flushPropertiesDrafts(documentId)).toBe(false) })
  expect(lookup.mock.calls.every(([id, operation]) => id === documentId && operation === operationId)).toBe(true)
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(store().courseView.pending).toBe(1)
  expect(input).toHaveValue('48')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(host.model().project.instances).toEqual(before.instances)
  expect(host.first.read().undoDepth).toBe(depth)
  expect(store().courseView.project!.instances).toEqual(proposal.instances)
})

it('restores a refused numeric field after object navigation and does not transfer its operation to another native text', async () => {
  const host = await fixture()
  select('原生首段')
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const rejection = rejectNextCommit(host), input = screen.getByLabelText('字号')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '38' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  select('原生次段')
  expect(screen.getByLabelText('字号')).not.toHaveValue('38')
  select('原生首段')
  const restored = screen.getByLabelText('字号')
  expect(restored).toHaveValue('38')
  expect(restored).toHaveAttribute('aria-invalid', 'true')
  await act(async () => { expect(await flushPropertiesDrafts(store().courseView.activeDocumentId!)).toBe(false) })
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(restored, { key: 'Enter' })
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  expect(textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines[0]).toMatchObject({ style: { fontSize: 38 } })
  expect(host.model().project.instances.second).toEqual(before.instances.second)
  await undo(before, depth)
})

it('retains unresolved ownership when a rejected input is changed back to its baseline and the panel unmounts', async () => {
  const host = await fixture()
  select('原生首段')
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const rejection = rejectNextCommit(host), input = screen.getByLabelText('字号') as HTMLInputElement
  const baseline = input.value
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '38' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: baseline } })
  // Navigation unmounts without authorizing a failed-input resolution.
  select('原生次段')
  expect(hasPropertiesDrafts(store().courseView.activeDocumentId!)).toBe(true)
  select('原生首段')
  const restored = screen.getByLabelText('字号')
  expect(restored).toHaveValue(baseline)
  expect(restored).toHaveAttribute('aria-invalid', 'true')
  fireEvent.keyDown(restored, { key: 'Escape' })
  await waitFor(() => expect(store().courseView.pending).toBe(0))
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)
  expect(host.first.read().undoDepth).toBe(depth)
  expect(host.model().project.instances).toEqual(before.instances)
  expect(store().courseView.project!.instances).toEqual(before.instances)
})

function selectText(blockId: string, from: number, to: number) {
  const view = store().courseView, point = { blockId, slot: { kind: 'field', field: 'content' } as const }
  const selection: DocumentSelection = { kind: 'text', revision: String(view.project!.revision),
    anchor: { ...point, offset: from, affinity: 'after' }, head: { ...point, offset: to, affinity: 'before' } }
  act(() => { store().setFlowContextSelection(selection); store().courseBridge.selectInteraction(view.activeDocumentId!, { kind: 'document', selection }, 'reading') })
}

it('binds refused text formatting to the same slot and range, including restoration after visiting another range', async () => {
  const host = await fixture()
  selectText('first', 0, 5)
  const before = structuredClone(host.model().project), depth = host.first.read().undoDepth
  const rejection = rejectNextCommit(host), input = screen.getByLabelText('字号')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '38' } })
  fireEvent.blur(input)
  await waitFor(() => expect(rejection.ready()).toBe(true))
  await act(async () => { rejection.reject() })
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
  selectText('first', 6, 15)
  const otherRange = screen.getByLabelText('字号')
  expect(otherRange).not.toHaveValue('38')
  fireEvent.keyDown(otherRange, { key: 'Enter' })
  expect(rejection.dispatch).toHaveBeenCalledTimes(1)
  expect(host.model().project.instances).toEqual(before.instances)
  selectText('first', 0, 5)
  const restored = screen.getByLabelText('字号')
  expect(restored).toHaveValue('38')
  expect(restored).toHaveAttribute('aria-invalid', 'true')
  fireEvent.keyDown(restored, { key: 'Enter' })
  await waitFor(() => expect(host.first.read().undoDepth).toBe(depth + 1))
  expect(rejection.dispatch).toHaveBeenCalledTimes(2)
  expect(textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines).toEqual([
    { type: 'text', text: 'First', style: { fontSize: 38 } }, { type: 'text', text: ' paragraph' },
  ])
  unchangedInstances(before, ['first'])
  await undo(before, depth)
})

it('does not report a remounted field ready when an earlier ACK completes while newer raw input remains', async () => {
  const host = await fixture()
  select('原生首段')
  const before = structuredClone(host.model().project), initial = host.first.read()
  const depth = initial.undoDepth, revision = initial.revision, documentId = store().courseView.activeDocumentId!
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  host.controls.before = () => gate
  const input = screen.getByLabelText('字号')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '38' } })
  fireEvent.blur(input)
  await waitFor(() => expect(host.operations).toHaveLength(1))
  select('原生次段')
  select('原生首段')
  const restored = screen.getByLabelText('字号')
  expect(restored).toHaveValue('38')
  fireEvent.focus(restored)
  fireEvent.change(restored, { target: { value: '42' } })
  let ready = true
  await act(async () => {
    const flushing = flushPropertiesDrafts(documentId)
    release()
    ready = await flushing
  })
  expect(ready).toBe(false)
  expect(restored).toHaveValue('42')
  expect(host.operations).toHaveLength(1)
  expect(host.first.read().undoDepth).toBe(depth + 1)
  expect(textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines[0]).toMatchObject({ style: { fontSize: 38 } })
  fireEvent.keyDown(restored, { key: 'Enter' })
  await waitFor(() => expect(host.first.read().revision).toBe(revision + 2))
  expect(host.operations).toHaveLength(2)
  expect(new Set(host.operations.map(operation => operation.operationId)).size).toBe(2)
  expect(host.operations.map(operation => operation.historyGroup)).toEqual(['flow-property-format', 'flow-property-format'])
  expect(textComponentDataSchema.parse(host.model().project.instances.first.data).content.inlines[0]).toMatchObject({ style: { fontSize: 42 } })
  expect(restored).not.toHaveAttribute('aria-invalid', 'true')
  unchangedInstances(before, ['first'])
  // Consecutive explicit edits use the existing formatting History group. Both
  // operations must be accepted, and one Undo/Redo traverses both effects.
  expect(host.first.read().undoDepth).toBe(depth + 1)
  const applied = structuredClone(host.model().project)
  await undo(before, depth)
  await act(async () => { await store().courseBridge.redo(documentId) })
  expect(host.model().project.instances).toEqual(applied.instances)
  expect(store().courseView.project!.instances).toEqual(applied.instances)
  expect(host.first.read().undoDepth).toBe(depth + 1)
})

it('keeps invalid CSS in the spacing input without dispatching a formal operation', async () => {
  vi.stubGlobal('CSS', { supports: vi.fn((_property: string, value: string) => value !== 'invalid spacing') })
  const host = await fixture()
  select('正文内容组')
  const before = structuredClone(store().courseView.project!), count = host.operations.length
  const input = screen.getByLabelText('子项间距')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: 'invalid spacing' } })
  fireEvent.blur(input)
  expect(input).toHaveValue('invalid spacing')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(host.operations).toHaveLength(count)
  expect(store().courseView.project!.instances).toEqual(before.instances)
})

it.each(['slide', 'spatial'] as const)('does not expose Flow spacing controls for an unframed native group on %s', async kind => {
  await fixture(false, kind)
  act(() => store().courseBridge.selectInstances(store().courseView.activeDocumentId!, ['group'], 'reading'))
  expect(screen.getByLabelText('名称')).toHaveValue('正文内容组')
  expect(screen.queryByLabelText('子项间距')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('内边距')).not.toBeInTheDocument()
})

it('keeps text inside an atomic framed group on its native inspector without falling back to page properties', async () => {
  await fixture(true)
  select('原生首段')
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage }))
  const context = hook.result.current
  expect(context.kind).toBe('flow-component')
  if (context.kind !== 'flow-component') throw new Error('Expected native object inspector')
  expect(context.native?.view.type).toBe('text')
  expect(context.view.blocks.map(block => block.blockId)).toEqual(['outer', 'neighbor'])
  expect(screen.getByLabelText('文字内容')).toHaveValue('First paragraph')
  expect(screen.queryByLabelText('页面标题')).not.toBeInTheDocument()
  expect(screen.queryByTestId('flow-block-properties')).not.toBeInTheDocument()
})
