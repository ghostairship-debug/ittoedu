import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { setRootContainers } from '../helpers/glxWorkFixture'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { selectPropertiesAuthoringReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'
import { PropertiesPanelRouter } from '../../src/renderer/ui/properties/PropertiesPanelRouter'
import { NodesTab } from '../../src/renderer/ui/NodesTab'
import { AUTHOR_FIELD_ACTION_EVENT } from '../../src/renderer/editing/commands/objectContextMenu'
import { authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'

const disposers: Array<() => void> = []
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); useEditorStore.getState().courseBridge.dispose(); vi.restoreAllMocks() })
const store = () => useEditorStore.getState()
function spot(authorKey: string, initialValue: string): ComponentAuthorSpot {
  return { id: `live-${authorKey}`, instanceId: 'component', mountGeneration: 1, kind: 'text', authorKey,
    dataPath: [authorKey], initialValue, localBounds: { width: 240, height: 60, transform: [1, 0, 0, 1, 0, 0] } }
}
async function fieldFixture() {
  const project = createBlankCourseProjectV10('精确属性')
  project.definitions.custom = { id: 'custom', role: 'content', title: '图文组件', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.component = { id: 'component', definitionId: 'custom', name: '图文组件', data: { title: '标题', caption: '图注' } }
  project.instances[project.rootIds[0]].childIds!.push('component')
  const host = await createV10StoreHost(project, undefined, false); disposers.push(() => host.bridge.dispose())
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene')
  return host
}

it('keeps a field inspector precise across A/B changes and refuses an old field command', async () => {
  await fieldFixture()
  const bridge = store().courseBridge, id = bridge.read().activeDocumentId!
  act(() => bridge.selectAuthorSpot(id, spot('title', '标题')))
  const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage: vi.fn() }))
  const first = hook.result.current
  expect(first.kind).toBe('author-field')
  if (first.kind !== 'author-field') throw new Error('Expected precise field context')
  const ui = render(<PropertiesPanelRouter context={first} />)
  expect(screen.getByRole('heading', { name: '所选内部文字' })).toBeInTheDocument()
  expect(screen.queryByLabelText('位置 X')).not.toBeInTheDocument()
  act(() => bridge.selectAuthorSpot(id, spot('caption', '图注')))
  const second = hook.result.current
  expect(second.kind).toBe('author-field')
  if (second.kind !== 'author-field') throw new Error('Expected precise field context')
  expect(second.draftBindingKey).not.toBe(first.draftBindingKey)
  const events: string[] = []
  const observe = (event: Event) => { events.push((event as CustomEvent).detail.selectionIdentity); event.preventDefault() }
  window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, observe)
  disposers.push(() => window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, observe))
  act(() => first.commands.edit())
  expect(events).toEqual([])
  act(() => second.commands.edit())
  expect(events).toEqual([authorFieldIdentity('component', spot('caption', '图注'))])
  ui.rerender(<PropertiesPanelRouter context={second} />)
  fireEvent.click(screen.getByRole('button', { name: '选择整体：图文组件' }))
  await waitFor(() => expect(bridge.read().interactionSelection).toMatchObject({ kind: 'objects', instanceIds: ['component'] }))
})

it('reuses the property read model for unrelated UI state while retaining professional selection dependencies', async () => {
  await fieldFixture()
  const bridge = store().courseBridge
  bridge.selectAuthorSpot(bridge.read().activeDocumentId!, spot('title', '标题'))
  const initial = store(), read = selectPropertiesAuthoringReadModel(initial)
  expect(selectPropertiesAuthoringReadModel({ ...initial, statusMessage: '无关状态' })).toBe(read)
  expect(read.selectedField?.field.authorKey).toBe('title')
  expect(read.selectedView).toBeNull()
  expect(selectPropertiesAuthoringReadModel({ ...initial, flowContextSelection: { revision: '0', kind: 'object', blockId: 'component' } })).not.toBe(read)
})

it('lists Flow body children in reading order and selects a nested image without free-layer ordering', async () => {
  const project = createBlankCourseProjectV10('正文树')
  setRootContainers(project, [{ id: 'reading', kind: 'flow', title: '阅读', childIds: ['group', 'behavior'], flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 } } }])
  project.definitions.group = { id: 'group', role: 'content', title: '图文组', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.definitions.behavior = { id: 'behavior', role: 'behavior', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } }
  project.instances.behavior = { id: 'behavior', definitionId: 'behavior', name: '非正文行为', data: {} }
  project.instances.nestedBehavior = { id: 'nestedBehavior', definitionId: 'behavior', name: '组内行为', data: {} }
  project.instances.group = { id: 'group', definitionId: 'group', name: '正文图文组', data: {}, childIds: ['heading', 'photo', 'nestedBehavior'] }
  project.instances.heading = { id: 'heading', definitionId: 'custom', name: '组内标题', data: {} }
  project.instances.photo = { id: 'photo', definitionId: 'custom', name: '组内照片', data: {} }
  const host = await createV10StoreHost(project, undefined, false); disposers.push(() => host.bridge.dispose())
  await store().connectCourseDocuments(host.api)
  store().setEditingScope('scene'); store().setActiveTab('layers')
  const before = store().courseView.snapshot!.undoDepth
  const scrollHeading = vi.fn(), scrollPhoto = vi.fn()
  const canvas = document.createElement('div')
  canvas.dataset.flowProjectId = project.id; canvas.dataset.flowSurfaceId = 'reading'
  const heading = document.createElement('div'); heading.dataset.flowBlockId = 'heading'; heading.scrollIntoView = scrollHeading
  const photo = document.createElement('div'); photo.dataset.componentInstance = 'photo'; photo.scrollIntoView = scrollPhoto
  canvas.append(heading, photo); document.body.append(canvas); disposers.push(() => canvas.remove())
  render(<NodesTab />)
  const rows = screen.getAllByRole('treeitem')
  expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['正文图文组', '组内标题', '组内照片'])
  expect(screen.queryByRole('treeitem', { name: '非正文行为' })).not.toBeInTheDocument()
  expect(screen.queryByRole('treeitem', { name: '组内行为' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('treeitem', { name: '组内标题' }))
  expect(scrollHeading).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  await waitFor(() => expect(store().courseView.selectedInstanceIds).toEqual(['heading']))
  fireEvent.click(screen.getByRole('treeitem', { name: '组内照片' }))
  expect(scrollPhoto).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  await waitFor(() => expect(store().courseView.selectedInstanceIds).toEqual(['photo']))
  expect(store().courseView.interactionSelection).toMatchObject({ kind: 'objects', instanceIds: ['photo'] })
  expect(screen.queryByLabelText('调整“组内照片”层级')).not.toBeInTheDocument()
  expect(store().courseView.snapshot!.undoDepth).toBe(before)
})
