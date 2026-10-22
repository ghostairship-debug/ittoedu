import { afterEach, expect, it, vi } from 'vitest'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { authorFieldFromSpot, authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'
import { capturedCourseViewIsCurrent } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createCrossSurfaceCommands } from '../../src/renderer/composition/crossSurfaceCommands'
import { createCourseStructureSlice } from '../../src/renderer/store/slices/courseStructureSlice'
import { createCourseLifecycleSlice } from '../../src/renderer/store/slices/courseLifecycleSlice'

afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const project = createBlankCourseProjectV10('选择范围')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('原文'))),
    frame: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances[project.rootIds[0]].childIds!.push('text')
  return createV10StoreHost(project)
}
function spot(authorKey: string): ComponentAuthorSpot {
  return { id: `mount:${authorKey}`, instanceId: 'text', mountGeneration: 1, kind: 'text', authorKey,
    dataPath: ['label'], initialValue: '原文', localBounds: { width: 200, height: 60, transform: [1, 0, 0, 1, 0, 0] } }
}

it('keeps precise fields in the existing Bridge and does not rebuild content for selection-only changes', async () => {
  const h = await fixture()
  try {
    const before = h.bridge.read(), changed = vi.fn(), stop = h.bridge.subscribe(changed)
    h.bridge.selectAuthorSpot(before.activeDocumentId!, spot('title'), before.surfaceId)
    const first = h.bridge.read(), captured = h.bridge.captureTarget()
    expect(first.selectedInstanceIds).toEqual(['text'])
    expect(first.interactionSelection).toMatchObject({ kind: 'author-field', instanceId: 'text', field: { authorKey: 'title' } })
    expect(first.documents).toBe(before.documents)
    expect(first.project).toBe(before.project)
    expect(first.runtimeProject).toBe(before.runtimeProject)
    h.bridge.selectAuthorSpot(before.activeDocumentId!, { ...spot('title'), id: 'remount', mountGeneration: 2 }, before.surfaceId)
    expect(changed).toHaveBeenCalledTimes(1)
    h.bridge.selectAuthorSpot(before.activeDocumentId!, spot('caption'), before.surfaceId)
    expect(capturedCourseViewIsCurrent(h.bridge.read(), captured)).toBe(false)
    expect(h.bridge.read().selectedInstanceIds).toEqual(['text'])
    h.kernel.selectInstances(['text'])
    expect(h.bridge.read().interactionSelection).toEqual({ kind: 'objects', instanceIds: ['text'] })
    h.kernel.selectInstances(['text'])
    expect(changed).toHaveBeenCalledTimes(3)
    expect(h.first.read().undoDepth).toBe(0)
    stop()
  } finally { h.bridge.dispose() }
})

it('refreshes a same-address field descriptor when its writable region changes', async () => {
  const h = await fixture()
  try {
    const before = h.bridge.read(), original = spot('title')
    h.bridge.selectAuthorSpot(before.activeDocumentId!, original)
    h.bridge.selectAuthorSpot(before.activeDocumentId!, { ...original, dataPath: undefined, sourceRegion: { kind: 'implementation', start: 10, end: 12 } })
    const target = h.bridge.read().interactionSelection
    expect(target).toMatchObject({ kind: 'author-field', field: { sourceRegion: { kind: 'implementation', start: 10, end: 12 } } })
    expect(target?.kind === 'author-field' ? target.field.dataPath : null).toBeUndefined()
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('does not promote field Delete/Copy to its owning component', async () => {
  const h = await fixture(), feedback = vi.fn(), requestClipboard = vi.fn()
  try {
    const kernel = { ...h.kernel, setFeedback: feedback }
    const commands = createCrossSurfaceCommands({ kernel, slide: {}, flow: {}, spatial: {}, requestClipboard,
      shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch() {} },
      structure: createCourseStructureSlice(kernel, { readActiveLocationId: () => kernel.readView().surfaceId }),
      lifecycle: createCourseLifecycleSlice(kernel, { bridge: h.bridge, read: () => ({ projectPath: null, dirty: false }), patch() {} }) })
    h.bridge.selectAuthorSpot(h.bridge.read().activeDocumentId!, spot('title'))
    expect(commands.routeEditorAction('delete')).toMatchObject({ ok: false, adapter: 'none' })
    commands.deleteSelectedNodes()
    commands.copySelectedNodes()
    await Promise.resolve()
    expect(feedback).toHaveBeenCalled()
    expect(requestClipboard).not.toHaveBeenCalled()
    expect(h.model().project.instances.text).toBeDefined()
    expect(h.first.read().undoDepth).toBe(0)
  } finally { h.bridge.dispose() }
})

it('separates persistent author addresses from value, geometry and registration identity', () => {
  const original = spot('title'), next = { ...original, id: 'new', mountGeneration: 9, initialValue: '新文', localBounds: { ...original.localBounds, width: 500 } }
  expect(authorFieldIdentity('text', original)).toBe(authorFieldIdentity('text', next))
  expect(authorFieldFromSpot(original)).not.toHaveProperty('id')
  expect(authorFieldFromSpot(original)).not.toHaveProperty('localBounds')
  expect(authorFieldIdentity('text', original)).not.toBe(authorFieldIdentity('text', spot('caption')))
})

it('routes menu clipboard commands to the focused text input while a field is selected', async () => {
  const h = await fixture(), requestClipboard = vi.fn(), input = document.createElement('textarea')
  document.body.append(input)
  try {
    const commands = createCrossSurfaceCommands({ kernel: h.kernel, slide: {}, flow: {}, spatial: {}, requestClipboard,
      shell: { read: () => ({ canvasMode: 'edit', editingTextNodeId: null }), patch() {} },
      structure: createCourseStructureSlice(h.kernel, { readActiveLocationId: () => h.kernel.readView().surfaceId }),
      lifecycle: createCourseLifecycleSlice(h.kernel, { bridge: h.bridge, read: () => ({ projectPath: null, dirty: false }), patch() {} }) })
    h.bridge.selectAuthorSpot(h.bridge.read().activeDocumentId!, spot('title'))
    input.value = '所选文字'; input.focus(); input.select()
    commands.copySelectedNodes()
    await Promise.resolve()
    expect(requestClipboard).toHaveBeenCalledWith('copy')
    expect(h.model().project.instances.text).toBeDefined()
    expect(h.first.read().undoDepth).toBe(0)
  } finally { input.remove(); h.bridge.dispose() }
})
