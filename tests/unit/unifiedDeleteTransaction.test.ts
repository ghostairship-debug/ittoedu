import { beforeEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'
import { allocateCourseLayerOrder } from '@/renderer/course/globalLayerCommands'
import { insertFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'

function activeDocument(): CourseProjectDocument {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected active Course Project V9 document')
  return document
}

function firstSlideScene(document = activeDocument()): SlideSceneDocument {
  const surface = document.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide' ? surface.scenes[0] : undefined
  if (!scene) throw new Error('expected slide scene')
  return scene
}

function flowLayerIds(document = activeDocument()): {
  surface: Set<string>
  global: Set<string>
} {
  const surface = document.surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
  return {
    surface: new Set(surface.surfaceLayerItems.map((entry) => entry.item.layerItemId)),
    global: new Set(document.globalLayerItems.map((entry) => entry.item.layerItemId)),
  }
}

function spatialWorldIds(document = activeDocument()): Set<string> {
  const surface = document.surfaces.find((candidate) => candidate.type === 'spatial-2d')
  if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
  return new Set(surface.world.layerItems.map((item) => item.layerItemId))
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('unified Delete transaction', () => {
  it('deletes a Slide multi-selection in one revision and one undo step', () => {
    const store = useEditorStore.getState()
    store.addTextNode(80, 90)
    store.addRectangleNode(320, 240)
    const ids = firstSlideScene().layerItems.map((item) => item.layerItemId)
    store.selectNodes(ids)
    const before = activeDocument()
    const historyCount = useEditorStore.getState().history.past.length

    const result = useEditorStore.getState().routeEditorAction('delete')

    const after = activeDocument()
    expect(result.ok).toBe(true)
    const remainingIds = new Set(firstSlideScene(after).layerItems.map((item) => item.layerItemId))
    ids.forEach((id) => expect(remainingIds.has(id)).toBe(false))
    expect(after.revision).toBe(before.revision + 1)
    expect(useEditorStore.getState().history.past).toHaveLength(historyCount + 1)
    expect(useEditorStore.getState().selectedNodeIds).toEqual([])

    useEditorStore.getState().undo()
    expect(firstSlideScene().layerItems.map((item) => item.layerItemId))
      .toEqual(expect.arrayContaining(ids))
  })

  it('rejects a stale selection snapshot without changing document, history, or selection', () => {
    const store = useEditorStore.getState()
    store.addTextNode(80, 90)
    const nodeId = firstSlideScene().layerItems[0]!.layerItemId
    store.selectNodes([nodeId])
    const stale = store.createLiveEditorSelectionSnapshot('layer')
    if (!stale) throw new Error('expected selection snapshot')
    store.updateNode(nodeId, { x: 420 })
    const beforeDocument = activeDocument()
    const beforeHistory = useEditorStore.getState().history.past
    const beforeSelection = useEditorStore.getState().selectedNodeIds

    const result = useEditorStore.getState().routeEditorAction('delete', stale)

    expect(result).toMatchObject({ ok: false, adapter: 'none' })
    expect(activeDocument()).toBe(beforeDocument)
    expect(useEditorStore.getState().history.past).toBe(beforeHistory)
    expect(useEditorStore.getState().selectedNodeIds).toBe(beforeSelection)
    expect(firstSlideScene().layerItems.some((item) => item.layerItemId === nodeId)).toBe(true)
  })

  it('keeps an unlocked plus locked Slide selection fully unchanged on failure', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const ids = firstSlideScene().layerItems.map((item) => item.layerItemId)
    store.updateNode(ids[1]!, { locked: true })
    store.selectNodes(ids)
    const beforeDocument = activeDocument()
    const beforeHistory = useEditorStore.getState().history.past
    const beforeSelection = useEditorStore.getState().selectedNodeIds

    const result = useEditorStore.getState().routeEditorAction('delete')

    expect(result.ok).toBe(false)
    expect(activeDocument()).toBe(beforeDocument)
    expect(useEditorStore.getState().history.past).toBe(beforeHistory)
    expect(useEditorStore.getState().selectedNodeIds).toBe(beforeSelection)
    expect(firstSlideScene().layerItems.map((item) => item.layerItemId))
      .toEqual(expect.arrayContaining(ids))
  })

  it('rejects an old Flow text-focus snapshot after the live selection becomes block focus', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected Flow session')
    const surface = flow.history.present.surfaces.find((candidate) => candidate.type === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('expected Flow paragraph')
    const textSelection = selectFlowEditorBlocks(
      flow.history.present,
      flow.selection.locationId,
      [paragraph.id],
      {
        focus: 'text',
        textRange: { blockId: paragraph.id, start: 0, end: 0 },
      },
    )
    store.applyFlowSelection(textSelection)
    const stale = useEditorStore.getState().createLiveEditorSelectionSnapshot()
    if (!stale) throw new Error('expected Flow selection snapshot')
    useEditorStore.getState().applyFlowSelection(selectFlowEditorBlocks(
      activeDocument(),
      textSelection.locationId,
      [paragraph.id],
    ))
    const beforeDocument = activeDocument()
    const beforeHistory = useEditorStore.getState().flowSession!.history.past
    const beforeSelection = useEditorStore.getState().flowSession!.selection

    const result = useEditorStore.getState().routeEditorAction('delete', stale)

    expect(result).toMatchObject({ ok: false, adapter: 'none' })
    expect(activeDocument()).toBe(beforeDocument)
    expect(useEditorStore.getState().flowSession!.history.past).toBe(beforeHistory)
    expect(useEditorStore.getState().flowSession!.selection).toBe(beforeSelection)
    const remainingSurface = activeDocument().surfaces.find((candidate) => candidate.type === 'flow')
    expect(remainingSurface?.type === 'flow'
      && remainingSurface.blocks.some((block) => block.id === paragraph.id)).toBe(true)
  })

  it('rejects an old Flow text range after the live caret moves within the same block', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected Flow session')
    const surface = flow.history.present.surfaces.find((candidate) => candidate.type === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
    const heading = surface.blocks.find((block) => block.type === 'heading')
    if (!heading || heading.type !== 'heading') throw new Error('expected Flow heading')
    const atStart = selectFlowEditorBlocks(
      flow.history.present,
      flow.selection.locationId,
      [heading.id],
      {
        focus: 'text',
        textRange: { blockId: heading.id, start: 0, end: 0 },
      },
    )
    store.applyFlowSelection(atStart)
    const stale = useEditorStore.getState().createLiveEditorSelectionSnapshot()
    if (!stale) throw new Error('expected Flow text snapshot')
    useEditorStore.getState().applyFlowSelection(selectFlowEditorBlocks(
      activeDocument(),
      atStart.locationId,
      [heading.id],
      {
        focus: 'text',
        textRange: { blockId: heading.id, start: 1, end: 1 },
      },
    ))
    const beforeDocument = activeDocument()
    const beforeHistory = useEditorStore.getState().flowSession!.history.past
    const beforeSelection = useEditorStore.getState().flowSession!.selection

    const result = useEditorStore.getState().routeEditorAction('delete', stale)

    expect(result).toMatchObject({ ok: false, adapter: 'none' })
    expect(activeDocument()).toBe(beforeDocument)
    expect(useEditorStore.getState().flowSession!.history.past).toBe(beforeHistory)
    expect(useEditorStore.getState().flowSession!.selection).toBe(beforeSelection)
    const remaining = activeDocument().surfaces.find((candidate) => candidate.type === 'flow')
    expect(remaining?.type === 'flow'
      && remaining.blocks.some((block) => (
        block.type === 'heading' && block.id === heading.id && block.text === heading.text
      )))
      .toBe(true)
  })

  it('rebases the course authoring session when deleting the active Flow heading anchor', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const initial = useEditorStore.getState().flowSession
    if (!initial) throw new Error('expected Flow session')
    const initialSurface = initial.history.present.surfaces.find((candidate) => candidate.type === 'flow')
    if (!initialSurface || initialSurface.type !== 'flow') throw new Error('expected Flow surface')
    const inserted = insertFlowEditorBlock(initial.history.present, {
      surfaceId: initialSurface.id,
      parentId: null,
      index: initialSurface.blocks.length,
      block: { type: 'heading', level: 1, text: '第二节' },
    }, { expectedRevision: initial.history.present.revision })
    expect(inserted.ok).toBe(true)
    store.applyFlowCommand(inserted)
    const ready = useEditorStore.getState().flowSession
    if (!ready) throw new Error('expected updated Flow session')
    const readySurface = ready.history.present.surfaces.find((candidate) => candidate.type === 'flow')
    if (!readySurface || readySurface.type !== 'flow') throw new Error('expected updated Flow surface')
    const heading = readySurface.blocks.find((block) => block.type === 'heading' && block.text === '第二节')
    if (!heading) throw new Error('expected inserted Flow heading')
    const location = ready.history.present.locations.find((candidate) => (
      candidate.kind === 'flow-block' && candidate.blockId === heading.id
    ))
    if (!location) throw new Error('expected inserted heading location')
    store.applyFlowSelection(selectFlowEditorBlocks(
      ready.history.present,
      location.id,
      [heading.id],
    ))
    const selected = useEditorStore.getState().flowSession!.selection

    const result = useEditorStore.getState().deleteFlowSelection({
      selection: selected,
      expectedRevision: activeDocument().revision,
    })

    expect(result.ok).toBe(true)
    const after = useEditorStore.getState()
    const nextLocationId = after.flowSession!.selection.locationId
    expect(nextLocationId).not.toBe(location.id)
    expect(activeDocument().locations.some((candidate) => candidate.id === nextLocationId)).toBe(true)
    expect(after.courseAuthoringSession?.token).toMatchObject({
      locationId: nextLocationId,
      revision: activeDocument().revision,
    })
    expect(after.courseAuthoringSession?.itemIds).toEqual([])
  })

  it.each([
    ['surface then global', false],
    ['global then surface', true],
  ] as const)('deletes a mixed Flow overlay selection atomically: %s', (_label, globalFirst) => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    useEditorStore.getState().addRectangleNode(80, 90)
    const surfaceId = useEditorStore.getState().flowSession?.selection.selectedOverlayIds[0]
    if (!surfaceId) throw new Error('expected surface overlay')
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().addRectangleNode(320, 240)
    const globalId = useEditorStore.getState().flowSession?.selection.selectedOverlayIds[0]
    if (!globalId) throw new Error('expected global overlay')
    const selectedIds = globalFirst ? [globalId, surfaceId] : [surfaceId, globalId]
    useEditorStore.getState().selectNodes(selectedIds)
    const before = activeDocument()
    const historyCount = useEditorStore.getState().history.past.length

    const result = useEditorStore.getState().routeEditorAction('delete')

    const after = activeDocument()
    const remaining = flowLayerIds(after)
    expect(result.ok).toBe(true)
    expect(remaining.surface.has(surfaceId)).toBe(false)
    expect(remaining.global.has(globalId)).toBe(false)
    expect(after.revision).toBe(before.revision + 1)
    expect(useEditorStore.getState().history.past).toHaveLength(historyCount + 1)
    expect(useEditorStore.getState().flowSession?.selection).toMatchObject({
      focus: 'idle',
      selectedOverlayIds: [],
    })

    useEditorStore.getState().undo()
    const restored = flowLayerIds()
    expect(restored.surface.has(surfaceId)).toBe(true)
    expect(restored.global.has(globalId)).toBe(true)
  })

  it('deletes a Spatial world multi-selection in one revision and one undo step', () => {
    const store = useEditorStore.getState()
    store.createNewSpatialProject()
    useEditorStore.getState().addTextNode(40, 60)
    useEditorStore.getState().addTextNode(360, 260)
    const ids = [...spatialWorldIds()]
    useEditorStore.getState().selectNodes(ids)
    const before = activeDocument()
    const historyCount = useEditorStore.getState().history.past.length

    const result = useEditorStore.getState().routeEditorAction('delete')

    const after = activeDocument()
    expect(result.ok).toBe(true)
    const remainingIds = spatialWorldIds(after)
    ids.forEach((id) => expect(remainingIds.has(id)).toBe(false))
    expect(after.revision).toBe(before.revision + 1)
    expect(useEditorStore.getState().history.past).toHaveLength(historyCount + 1)
    expect(useEditorStore.getState().spatialSession?.selection.selectionIds).toEqual([])

    useEditorStore.getState().undo()
    expect([...spatialWorldIds()]).toEqual(expect.arrayContaining(ids))
  })

  it('repairs interactions and Runtime bindings before a deleted Slide document is saved and reopened', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const document = structuredClone(activeDocument())
    const scene = firstSlideScene(document)
    const targetId = scene.layerItems[0]!.layerItemId
    const runtimeId = 'runtime-delete-reference'
    const runtimeItem = {
      layerItemId: runtimeId,
      label: '删除引用运行时',
      frame: { mode: 'absolute', x: 420, y: 120, width: 320, height: 180 },
      order: allocateCourseLayerOrder(document, scene.layerItems.at(-1)!.order + 1),
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      kind: 'runtime',
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        enabled: true,
        renderMode: 'dom',
        source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime"})',
        content: { values: { title: '引用运行时' } },
        assets: {},
        nodeBindings: { target: targetId },
      },
    } satisfies LayerItem
    scene.layerItems.push(runtimeItem)
    document.globalInteractions.push(
      {
        id: 'delete-root-rule',
        enabled: true,
        trigger: { type: 'node.click', nodeId: targetId },
        conditions: [],
        actions: [{
          id: 'delete-root-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
      {
        id: 'delete-dependent-rule',
        enabled: true,
        trigger: { type: 'animation.completed', actionId: 'delete-root-action' },
        conditions: [],
        actions: [{
          id: 'delete-dependent-action',
          start: 'after-previous',
          delayMs: 0,
          action: { type: 'scene.next' },
        }],
      },
    )
    courseProjectDocumentSchema.parse(document)
    store.loadCourseProject(document, null)
    useEditorStore.getState().selectNodes([targetId])

    const result = useEditorStore.getState().routeEditorAction('delete')

    expect(result.ok).toBe(true)
    const after = courseProjectDocumentSchema.parse(activeDocument())
    const runtime = firstSlideScene(after).layerItems.find((item) => item.layerItemId === runtimeId)
    expect(runtime).toMatchObject({ kind: 'runtime' })
    if (runtime?.kind !== 'runtime') throw new Error('expected remaining Runtime')
    expect(runtime.runtime.nodeBindings).toBeUndefined()
    expect(after.globalInteractions).toEqual([])

    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(archive).toBeTruthy()
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(archive!)).toBe(true)
    courseProjectDocumentSchema.parse(activeDocument())
    const reopenedRuntime = firstSlideScene().layerItems.find((item) => item.layerItemId === runtimeId)
    expect(reopenedRuntime).toMatchObject({ kind: 'runtime' })
    if (reopenedRuntime?.kind !== 'runtime') throw new Error('expected reopened Runtime')
    expect(reopenedRuntime.runtime.nodeBindings).toBeUndefined()
  })
})
