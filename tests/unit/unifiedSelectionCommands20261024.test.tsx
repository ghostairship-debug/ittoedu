import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAuthorFieldTarget } from '../../src/core/tools/ToolTargets'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createCrossSurfaceCommands } from '../../src/renderer/composition/crossSurfaceCommands'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { createCourseLifecycleSlice } from '../../src/renderer/store/slices/courseLifecycleSlice'
import { useEditorKeyboardRouter } from '../../src/renderer/app/useEditorKeyboardRouter'
import { authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'
import { AUTHOR_FIELD_ACTION_EVENT, type AuthorFieldActionRequest } from '../../src/renderer/editing/commands/objectContextMenu'
import { createComponentElementCardNavigation } from '../../src/renderer/workbench/elementCards/ElementCardIndicator'
import { selectElementCardField } from '../../src/renderer/workbench/elementCards/elementCardSelection'
import { elementCards, type ElementCardView } from '../../src/renderer/workbench/elementCards/elementCardController'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

const hosts: Awaited<ReturnType<typeof createV10StoreHost>>[] = []
afterEach(() => {
  cleanup()
  for (const host of hosts.splice(0)) {
    workbenchSelection.setManual(host.first.documentId, null)
    host.bridge.dispose()
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function fixture() {
  const project = createBlankCourseProjectV10('同一目标命令')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextData('当前正文'))),
    frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 20, 30] } }
  project.instances[project.rootIds[0]].childIds!.push('text')
  const host = await createV10StoreHost(project)
  hosts.push(host)
  const feedback = vi.fn(), kernel = { ...host.kernel, setFeedback: feedback }
  const commands = createCrossSurfaceCommands({ kernel, slide: {}, flow: {}, spatial: {},
    shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch() {} },
    structure: createCourseStructureSlice(kernel, { readActiveLocationId: () => kernel.readView().surfaceId }),
    lifecycle: createCourseLifecycleSlice(kernel, { bridge: host.bridge, read: () => ({ projectPath: null, dirty: false }), patch() {} }) })
  return { ...host, commands, feedback }
}

function field(): ComponentAuthorSpot {
  return { id: 'native:text:content', instanceId: 'text', mountGeneration: 1, kind: 'text', dataPath: ['content'],
    initialValue: { inlines: [{ type: 'text', text: '当前正文' }] },
    localBounds: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] } }
}

function keyboard(host: Awaited<ReturnType<typeof fixture>>) {
  renderHook(() => useEditorKeyboardRouter({ isReadOnly: () => false,
    captureDeleteSnapshot: vi.fn(), routeEditorAction: vi.fn(), deleteSelectedNodes: vi.fn(), copySelection: vi.fn(),
    pasteClipboard: vi.fn(), duplicateSelection: vi.fn(), nudgeSelection: host.commands.nudgeSelection,
    undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn(), clearSelection: vi.fn(),
    selectedCount: () => host.bridge.read().selectedInstanceIds.length,
    saveProject: vi.fn(), newProject: vi.fn(), openProject: vi.fn() }))
}

function arrow(key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event
}

it('diagnoses a field without an independent geometry owner instead of moving its carrying component', async () => {
  const host = await fixture(), documentId = host.first.documentId
  host.bridge.selectAuthorSpot(documentId, field())
  keyboard(host)
  expect(arrow('ArrowRight').defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(host.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('没有可独立移动') })))
  expect(host.model().project.instances.text.frame!.transform).toEqual([1, 0, 0, 1, 20, 30])
  expect(host.bridge.read().interactionSelection?.kind).toBe('author-field')
  expect(host.first.read().undoDepth).toBe(0)
  expect(host.operations).toHaveLength(0)
})

it('sends field arrow movement only to the exact current field owner', async () => {
  const host = await fixture(), spot = field(), received: AuthorFieldActionRequest[] = []
  host.bridge.selectAuthorSpot(host.first.documentId, spot)
  const accept = (event: Event) => { received.push((event as CustomEvent<AuthorFieldActionRequest>).detail); event.preventDefault() }
  window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, accept)
  try {
    keyboard(host)
    arrow('ArrowUp', true)
    await Promise.resolve()
    expect(received).toEqual([{ documentId: host.first.documentId, epoch: host.first.read().epoch,
      selectionIdentity: authorFieldIdentity('text', spot), action: 'nudge', dx: 0, dy: -10 }])
    expect(host.feedback).not.toHaveBeenCalled()
    expect(host.operations).toHaveLength(0)
  } finally { window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, accept) }
})

it('keeps document selections out of frame movement while whole objects still nudge normally', async () => {
  const host = await fixture()
  host.bridge.selectInteraction(host.first.documentId,
    { kind: 'document', selection: { revision: 'current', kind: 'object', blockId: 'text' } })
  keyboard(host)
  arrow('ArrowDown')
  await vi.waitFor(() => expect(host.feedback).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: expect.stringContaining('正文范围') })))
  expect(host.operations).toHaveLength(0)
  host.kernel.selectInstances(['text'])
  arrow('ArrowRight', true)
  await vi.waitFor(() => expect(host.model().project.instances.text.frame!.transform).toEqual([1, 0, 0, 1, 30, 30]))
  expect(host.first.read().undoDepth).toBe(1)
})

it('restores a real rich-field AI card address to formal selection without opening input or writing content', async () => {
  const host = await fixture(), documentId = host.first.documentId, surfaceId = host.bridge.read().surfaceId!
  const spot = field(), target = courseAuthorFieldTarget(surfaceId, spot), errors = vi.fn()
  // This is the actual ToolTargets encoding: rich native fields travel through
  // dataPath, while authorField remains the string-only source/record contract.
  expect(target.dataPath).toEqual(['content']); expect(target.authorField).toBeUndefined()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.spyOn(elementCards, 'requestOpen').mockImplementation(() => {})
  const actions = vi.fn()
  window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, actions)
  try {
    const card = { key: 'rich-result', documentId, target, label: '当前正文', epoch: host.first.read().epoch } as ElementCardView
    createComponentElementCardNavigation({ kernel: host.kernel, reportError: errors }).jump(card)
    await vi.waitFor(() => expect(elementCards.requestOpen).toHaveBeenCalledWith(card.key))
    expect(errors).not.toHaveBeenCalled()
    expect(host.bridge.read().interactionSelection).toEqual({ kind: 'author-field', instanceId: 'text',
      field: { kind: 'text', dataPath: ['content'], fieldScope: 'data', initialValue: spot.initialValue } })
    expect(workbenchSelection.getManual(documentId)?.targets).toEqual([target])
    expect(actions).not.toHaveBeenCalled()
    expect(host.operations).toHaveLength(0)
  } finally { window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, actions) }
})

it('does not pretend arbitrary JSON data is a rich author field or absorb range targets', async () => {
  const host = await fixture(), surfaceId = host.bridge.read().surfaceId!, snapshot = host.first.read()
  const target = { kind: 'course-instance' as const, surfaceId, instanceId: 'text', dataPath: ['appearance'] }
  expect(() => selectElementCardField(host.bridge, snapshot, target)).toThrow('没有可独立选择的文字内容')
  expect(selectElementCardField(host.bridge, snapshot, { ...target, dataPath: ['content'], from: 0, to: 2 })).toBe(false)
  expect(host.bridge.read().interactionSelection).toBeNull()
  expect(host.operations).toHaveLength(0)
})
