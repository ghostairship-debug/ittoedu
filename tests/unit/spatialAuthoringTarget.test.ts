import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SpatialEditorAuthoringTargetInput } from '@/renderer/course/spatialEditorView'
import {
  buildSpatialEditorView,
  captureSpatialEditorAuthoringTarget,
} from '@/renderer/course/spatialEditorView'
import { addSpatialCameraFrameFromSession } from '@/renderer/course/spatialCameraCommands'
import { addSpatialPathInSession } from '@/renderer/course/spatialPathCommands'
import { addSpatialRelationInSession } from '@/renderer/course/spatialRelationCommands'
import { addSpatialSemanticZoomRuleInSession } from '@/renderer/course/spatialSemanticZoom'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { markSpatialWorldContentComposing } from '@/renderer/authoring/spatialWorldAuthoring'
import { createSpatialWorldTargetAuthoringController } from '@/renderer/authoring/spatialWorldTargetAuthoring'
import { controllerDisplayFrame } from '@/renderer/authoring/controllerDisplayBounds'
import { worldToClient } from '@/renderer/authoring/stageViewportTransform'
import {
  buildSpatialAuthoringSnapshot,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
} from '@/renderer/course/spatialEditorCommands'
import {
  selectActiveSceneId,
  selectSelectedNodeId,
  selectSelectedNodeIds,
  useEditorStore,
} from '@/renderer/store/editorStore'
import {
  activeDocumentId,
  connectCourseHost,
  courseContent,
  formalCourse,
  settleCourse,
  undoSettled,
  type CourseHost,
} from '../helpers/triage-t2-course'

const VIEWPORT = { x: 0, y: 0, width: 800, height: 450 }

function captureSpatialTarget(input: SpatialEditorAuthoringTargetInput) {
  const state = useEditorStore.getState()
  const session = state.spatialSession
  const authoringSession = state.courseAuthoringSession
  if (!session || !authoringSession) throw new Error('expected Spatial authoring session')
  return captureSpatialEditorAuthoringTarget({
    view: buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    }),
    sessionToken: authoringSession.token,
    target: input,
  })
}

// 2.0: every authoritative submit re-projects the session (fresh references,
// history reset to an empty cursor), so "nothing changed" must be proven by
// content. Formal History depth is asserted separately on the document session.
function expectPersistentStateUnchanged(before: ReturnType<typeof useEditorStore.getState>) {
  const after = useEditorStore.getState()
  expect(courseContent(after.spatialSession!.history.present))
    .toEqual(courseContent(before.spatialSession!.history.present))
  expect(after.spatialSession?.selection).toEqual(before.spatialSession?.selection)
  expect(after.spatialSession?.sessionCamera).toEqual(before.spatialSession?.sessionCamera)
  expect(after.spatialSession?.scope).toBe(before.spatialSession?.scope)
  expect(after.assetFiles).toBe(before.assetFiles)
  expect(after.courseAssetSidecar).toEqual(before.courseAssetSidecar)
  expect(after.componentPackages).toEqual(before.componentPackages)
  expect(after.courseAuthoringSession?.token).toEqual(before.courseAuthoringSession?.token)
  expect(after.courseAuthoringSession?.itemIds).toEqual(before.courseAuthoringSession?.itemIds)
  // Editing session state is not re-projected: exact identity still applies.
  expect(after.spatialContentEdit).toBe(before.spatialContentEdit)
  expect(after.spatialGraphSelection).toBe(before.spatialGraphSelection)
  expect(selectActiveSceneId(after)).toBe(selectActiveSceneId(before))
  expect(after.dirty).toBe(before.dirty)
}

let host: CourseHost
let documentId: string

beforeEach(async () => {
  const connected = await connectCourseHost()
  host = connected.host
  await useEditorStore.getState().createCourseDocument('spatial')
  await settleCourse()
  documentId = activeDocumentId()
})

// A draft left open (dirty or composing) would otherwise leak into the next
// beforeEach: drainCourseDocument commits a dirty draft and throws on a composing one.
afterEach(() => {
  useEditorStore.setState({ spatialContentEdit: null, editingTextNodeId: null })
})

describe('Spatial canonical authoring targets', () => {
  it('constrains a teacher viewport drag by its launcher at fitted Spatial scale and preserves author dimensions', () => {
    const item = useEditorStore.getState().spatialSession!.history.present.globalLayerItems
      .find(entry => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')!.item
    const mount = document.createElement('div')
    mount.dataset.controllerAuthoringId = item.layerItemId
    mount.dataset.controllerAuthoringBounds = `${item.frame.width - 52},${item.frame.height - 52},52,52`
    document.body.append(mount)
    try {
      const controller = createSpatialWorldTargetAuthoringController({
        readSnapshot: () => {
          const state = useEditorStore.getState(), session = state.spatialSession!
          return {
            view: buildSpatialEditorView({ project: session.history.present, locationId: session.selection.locationId, sessionCamera: session.sessionCamera }),
            selectionIds: session.selection.selectionIds,
            scope: session.scope,
            contentEdit: state.spatialContentEdit,
            worldTarget: captureSpatialTarget({ kind: 'world', field: 'world' }),
            layerTargets: new Map([[item.layerItemId, captureSpatialTarget({ kind: 'layer', layerItemId: item.layerItemId, field: 'frame' })]]),
          }
        },
        commands: { run: (target, intent) => useEditorStore.getState().runSpatialAuthoringIntent(target, intent) },
      })
      const visible = controllerDisplayFrame(item)
      const center = worldToClient(createSpatialViewportOverlayTransform(VIEWPORT), { x: visible.x + 26, y: visible.y + 26 })
      expect(controller.pointerDown(center, VIEWPORT).hit?.layerItemId).toBe(item.layerItemId)
      const moved = controller.pointerMove({ x: -50, y: -50 }, VIEWPORT)
      expect(moved.preview?.[0]).toMatchObject({ x: 52 - item.frame.width, y: 52 - item.frame.height, width: item.frame.width, height: item.frame.height })
      expect(controller.pointerUp({ x: -50, y: -50 }, VIEWPORT).command?.ok).toBe(true)
      const saved = useEditorStore.getState().spatialSession!.history.present.globalLayerItems
        .find(entry => entry.item.layerItemId === item.layerItemId)!.item
      expect(controllerDisplayFrame(saved)).toEqual({ x: 0, y: 0, width: 52, height: 52 })
      expect(saved.frame.width).toBe(item.frame.width)
      expect(saved.frame.height).toBe(item.frame.height)
    } finally { mount.remove() }
  })

  it('nudges the selected Spatial layer through the active Surface owner', async () => {
    useEditorStore.getState().addTextNode(120, 160)
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const before = useEditorStore.getState().spatialSession!
    const layerItemId = before.selection.selectionIds[0]
    if (!layerItemId) throw new Error('expected selected Spatial text')
    const original = locateCourseLayer(before.history.present, layerItemId)?.item
    if (!original) throw new Error('expected Spatial layer')

    useEditorStore.getState().nudgeSelection(4, -3)

    const after = useEditorStore.getState().spatialSession!
    const moved = locateCourseLayer(after.history.present, layerItemId)?.item
    expect(moved?.frame).toMatchObject({
      x: original.frame.x + 4,
      y: original.frame.y - 3,
    })
    expect(useEditorStore.getState().errorMessage).toBeNull()
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore + 1)
  })

  it('rejects a revision-stale property callback with zero document, History, or resource writes', async () => {
    const target = captureSpatialTarget({ kind: 'surface', field: 'backgroundColor' })
    useEditorStore.getState().addTextNode()
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const before = useEditorStore.getState()

    const receipt = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'set-surface-background',
      backgroundColor: '#112233',
      expectedContentEdit: null,
    })

    expect(receipt).toMatchObject({ ok: false, historyEntry: false })
    expectPersistentStateUnchanged(before)
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('guards same-revision camera callbacks with the exact session camera', async () => {
    const target = captureSpatialTarget({ kind: 'world', field: 'session.camera' })
    const depthBefore = formalCourse(host, documentId).undoDepth
    const initial = useEditorStore.getState().spatialSession!
    const first = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'pan-session-camera',
      delta: { x: 80, y: -30 },
      expectedCamera: initial.sessionCamera,
      expectedContentEdit: null,
    })
    expect(first).toMatchObject({ ok: true, historyEntry: false })
    const afterPan = useEditorStore.getState()
    expect(afterPan.spatialSession?.sessionCamera).toEqual({ x: 80, y: -30, zoom: 1 })
    expect(afterPan.spatialSession?.history.present).toBe(initial.history.present)

    const stale = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'zoom-session-camera',
      zoom: 2,
      expectedCamera: initial.sessionCamera,
      expectedContentEdit: null,
    })
    expect(stale).toMatchObject({ ok: false, historyEntry: false })
    expectPersistentStateUnchanged(afterPan)
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('switches cameras without Project or History writes, synchronizes the Course token, and expires the old target', async () => {
    useEditorStore.getState().runSpatialCommand((session) => (
      addSpatialCameraFrameFromSession(session, { name: '远景' })
    ))
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const initial = useEditorStore.getState()
    const session = initial.spatialSession!
    const surface = session.history.present.surfaces.find((candidate) => (
      candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d'
    ))
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const frame = surface.camera.frames.find((candidate) => (
      candidate.id !== surface.camera.frames.find((entry) => (
        session.history.present.locations.some((location) => (
          location.kind === 'spatial-camera'
          && location.id === session.selection.locationId
          && location.cameraFrameId === entry.id
        ))
      ))?.id
    ))
    if (!frame) throw new Error('expected an inactive camera frame')
    const location = session.history.present.locations.find((candidate) => (
      candidate.kind === 'spatial-camera'
      && candidate.surfaceId === surface.id
      && candidate.cameraFrameId === frame.id
    ))
    if (!location) throw new Error('expected camera location')
    const target = captureSpatialTarget({
      kind: 'camera-frame',
      frameId: frame.id,
      field: 'session.activeCameraFrameId',
    })
    const tokenBefore = initial.courseAuthoringSession!.token

    const receipt = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'activate-camera-frame',
      expectedContentEdit: null,
    })
    expect(receipt).toMatchObject({ ok: true, historyEntry: false })
    const after = useEditorStore.getState()
    expect(after.spatialSession?.selection.locationId).toBe(location.id)
    expect(after.courseAuthoringSession?.token).toMatchObject({
      locationId: location.id,
      revision: tokenBefore.revision,
      generation: tokenBefore.generation + 1,
    })
    expect(after.spatialSession?.history.present).toBe(session.history.present)
    expect(after.assetFiles).toBe(initial.assetFiles)
    expect(after.spatialSession?.sessionCamera).toEqual({
      x: frame.x,
      y: frame.y,
      zoom: frame.zoom,
    })
    expect(after.spatialSession ? buildSpatialAuthoringSnapshot(after.spatialSession).activeCameraFrameId : null).toBe(frame.id)
    expect(after.courseAssetSidecar).toEqual(initial.courseAssetSidecar)
    expect(after.componentPackages).toEqual(initial.componentPackages)
    expect(after.dirty).toBe(initial.dirty)

    const stale = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'activate-camera-frame',
      expectedContentEdit: null,
    })
    expect(stale).toMatchObject({ ok: false, historyEntry: false })
    expectPersistentStateUnchanged(after)
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('rejects a callback bound to an older exact content-edit object', async () => {
    useEditorStore.getState().addTextNode()
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const session = useEditorStore.getState().spatialSession!
    const layerItemId = session.selection.selectionIds[0]
    if (!layerItemId) throw new Error('expected selected Spatial text')
    const located = locateCourseLayer(session.history.present, layerItemId)
    if (
      !located
      || located.item.kind !== 'native'
      || located.item.content.nativeType !== 'text'
    ) throw new Error('expected Spatial text layer')
    const target = captureSpatialTarget({ kind: 'layer', layerItemId, field: 'content.text' })
    const begun = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'begin-content-edit',
      source: 'properties',
      expectedEdit: null,
      expectedContentEdit: null,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected content edit')
    const firstEdit = begun.edit
    const updated = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'update-text-content-edit',
      expectedEdit: firstEdit,
      expectedContentEdit: firstEdit,
      text: '当前草稿',
      runs: [],
    })
    if (!updated.ok || !updated.edit) throw new Error('expected updated content edit')
    const before = useEditorStore.getState()

    const stale = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'commit-text-content-edit',
      expectedEdit: firstEdit,
      expectedContentEdit: firstEdit,
      text: '旧回调覆盖内容',
      runs: [],
    })
    expect(stale).toMatchObject({ ok: false, historyEntry: false })
    expect(useEditorStore.getState().spatialContentEdit).toBe(updated.edit)
    expectPersistentStateUnchanged(before)
    // No settle: the open dirty draft would be committed by drain. The rejection
    // queued nothing, so the formal depth read is already authoritative.
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('keeps path, relation, and semantic targets distinct across valid ID collisions and preserves no-op identity', async () => {
    useEditorStore.getState().addTextNode()
    const firstId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    useEditorStore.getState().addTextNode()
    const secondId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    if (!firstId || !secondId) throw new Error('expected two Spatial world layers')

    const sharedId = 'shared-spatial-entity-id'
    useEditorStore.getState().runSpatialCommand((session) => addSpatialCameraFrameFromSession(session, {
      id: sharedId,
      name: '共享 ID 镜头',
    }))
    useEditorStore.getState().runSpatialCommand((session) => addSpatialPathInSession(session, {
      id: sharedId,
      name: '共享 ID 路径',
      layerItemIds: [firstId, secondId],
    }))
    useEditorStore.getState().runSpatialCommand((session) => addSpatialRelationInSession(session, {
      id: sharedId,
      sourceLayerItemId: firstId,
      targetLayerItemId: secondId,
      kind: 'arrow',
      label: '共享 ID 关系',
    }))
    useEditorStore.getState().runSpatialCommand((session) => addSpatialSemanticZoomRuleInSession(session, {
      id: sharedId,
      layerItemIds: [firstId],
      minZoom: 0.5,
      maxZoom: 2,
      visible: true,
    }))
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth

    const cameraTarget = captureSpatialTarget({
      kind: 'camera-frame',
      frameId: sharedId,
      field: 'camera.frames',
    })
    const pathTarget = captureSpatialTarget({ kind: 'path', pathId: sharedId, field: 'world.paths' })
    const relationTarget = captureSpatialTarget({
      kind: 'relation',
      relationId: sharedId,
      field: 'world.relations',
    })
    const semanticTarget = captureSpatialTarget({
      kind: 'semantic-rule',
      ruleId: sharedId,
      field: 'semanticZoom',
    })
    expect(new Set([
      cameraTarget.authoringAddress,
      pathTarget.authoringAddress,
      relationTarget.authoringAddress,
      semanticTarget.authoringAddress,
    ])).toHaveLength(4)

    let before = useEditorStore.getState()
    expect(useEditorStore.getState().runSpatialAuthoringIntent(cameraTarget, {
      kind: 'rename-camera-frame',
      name: '共享 ID 镜头',
      expectedContentEdit: null,
    })).toMatchObject({ ok: true, historyEntry: false })
    expectPersistentStateUnchanged(before)
    before = useEditorStore.getState()
    expect(useEditorStore.getState().runSpatialAuthoringIntent(pathTarget, {
      kind: 'rename-path',
      name: '共享 ID 路径',
      expectedContentEdit: null,
    })).toMatchObject({ ok: true, historyEntry: false })
    expectPersistentStateUnchanged(before)
    before = useEditorStore.getState()
    expect(useEditorStore.getState().runSpatialAuthoringIntent(relationTarget, {
      kind: 'update-relation-label',
      label: '共享 ID 关系',
      expectedContentEdit: null,
    })).toMatchObject({ ok: true, historyEntry: false })
    expectPersistentStateUnchanged(before)
    before = useEditorStore.getState()
    expect(useEditorStore.getState().runSpatialAuthoringIntent(semanticTarget, {
      kind: 'update-semantic-rule',
      patch: { layerItemIds: [firstId], minZoom: 0.5, maxZoom: 2, visible: true },
      expectedContentEdit: null,
    })).toMatchObject({ ok: true, historyEntry: false })
    expectPersistentStateUnchanged(before)
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('rejects beginning a second text edit while a different dirty draft is open', async () => {
    useEditorStore.getState().addTextNode()
    const firstId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    useEditorStore.getState().addTextNode()
    const secondId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    if (!firstId || !secondId) throw new Error('expected two Spatial text layers')
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const firstTarget = captureSpatialTarget({ kind: 'layer', layerItemId: firstId, field: 'content.data.text' })
    const secondTarget = captureSpatialTarget({ kind: 'layer', layerItemId: secondId, field: 'content.data.text' })
    const begun = useEditorStore.getState().runSpatialAuthoringIntent(firstTarget, {
      kind: 'begin-content-edit',
      source: 'properties',
      expectedEdit: null,
      expectedContentEdit: null,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected first content edit')
    const updated = useEditorStore.getState().runSpatialAuthoringIntent(firstTarget, {
      kind: 'update-text-content-edit',
      expectedEdit: begun.edit,
      expectedContentEdit: begun.edit,
      text: '不能被覆盖的草稿',
      runs: [],
    })
    if (!updated.ok || !updated.edit) throw new Error('expected updated draft')
    const before = useEditorStore.getState()

    const rejected = useEditorStore.getState().runSpatialAuthoringIntent(secondTarget, {
      kind: 'begin-content-edit',
      source: 'properties',
      expectedEdit: updated.edit,
      expectedContentEdit: updated.edit,
    })
    expect(rejected).toMatchObject({ ok: false, historyEntry: false })
    expect(useEditorStore.getState().spatialContentEdit).toBe(updated.edit)
    expectPersistentStateUnchanged(before)
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('commits an open text draft and a layer transform as one logical History entry', async () => {
    useEditorStore.getState().addTextNode()
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const initial = useEditorStore.getState()
    const session = initial.spatialSession!
    const layerItemId = session.selection.selectionIds[0]
    if (!layerItemId) throw new Error('expected selected Spatial text')
    const located = locateCourseLayer(session.history.present, layerItemId)
    if (!located) throw new Error('expected Spatial layer')
    const contentTarget = captureSpatialTarget({
      kind: 'layer',
      layerItemId,
      field: 'content.data.text',
    })
    const frameTarget = captureSpatialTarget({ kind: 'layer', layerItemId, field: 'frame' })
    const begun = useEditorStore.getState().runSpatialAuthoringIntent(contentTarget, {
      kind: 'begin-content-edit',
      source: 'canvas',
      expectedEdit: null,
      expectedContentEdit: null,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected content edit')
    const updated = useEditorStore.getState().runSpatialAuthoringIntent(contentTarget, {
      kind: 'update-text-content-edit',
      expectedEdit: begun.edit,
      expectedContentEdit: begun.edit,
      text: '原子草稿',
      runs: [],
    })
    if (!updated.ok || !updated.edit) throw new Error('expected updated draft')

    const result = useEditorStore.getState().runSpatialAuthoringIntent(frameTarget, {
      kind: 'transform-layers',
      coordinateSpace: 'world',
      layers: [{
        layerItemId,
        x: located.item.frame.x + 40,
        y: located.item.frame.y + 20,
        width: located.item.frame.width,
        height: located.item.frame.height,
        rotation: located.item.rotation,
      }],
      expectedSelectionIds: [...session.selection.selectionIds],
      expectedCamera: session.sessionCamera,
      targets: [frameTarget],
      expectedContentEdit: updated.edit,
    })
    expect(result).toMatchObject({ ok: true, historyEntry: true, edit: null })
    const after = useEditorStore.getState()
    expect(after.spatialContentEdit).toBeNull()
    expect(locateCourseLayer(after.spatialSession!.history.present, layerItemId)).toMatchObject({
      item: {
        frame: { x: located.item.frame.x + 40, y: located.item.frame.y + 20 },
        content: { data: { text: '原子草稿' } },
      },
    })
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore + 1)

    await undoSettled(host, documentId)
    expect(courseContent(useEditorStore.getState().spatialSession!.history.present))
      .toEqual(courseContent(session.history.present))
  })

  it('commits a dirty text draft and graph selection as one logical History entry', async () => {
    useEditorStore.getState().addTextNode()
    const firstId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    useEditorStore.getState().addTextNode()
    const secondId = useEditorStore.getState().spatialSession?.selection.selectionIds[0]
    if (!firstId || !secondId) throw new Error('expected two Spatial text layers')
    const pathId = 'draft-selection-path'
    useEditorStore.getState().runSpatialCommand((session) => addSpatialPathInSession(session, {
      id: pathId,
      name: '草稿切换路径',
      layerItemIds: [firstId, secondId],
    }))
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth

    const worldTarget = captureSpatialTarget({ kind: 'world', field: 'world' })
    const contentTarget = captureSpatialTarget({
      kind: 'layer',
      layerItemId: firstId,
      field: 'content.data.text',
    })
    const begun = useEditorStore.getState().runSpatialAuthoringIntent(contentTarget, {
      kind: 'begin-content-edit',
      source: 'properties',
      expectedEdit: null,
      expectedContentEdit: null,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected content edit')
    const updated = useEditorStore.getState().runSpatialAuthoringIntent(contentTarget, {
      kind: 'update-text-content-edit',
      expectedEdit: begun.edit,
      expectedContentEdit: begun.edit,
      text: '随图谱选择原子提交的草稿',
      runs: [],
    })
    if (!updated.ok || !updated.edit) throw new Error('expected updated draft')
    const beforeSession = useEditorStore.getState().spatialSession!

    const result = useEditorStore.getState().runSpatialAuthoringIntent(worldTarget, {
      kind: 'set-graph-selection',
      selection: { kind: 'path', id: pathId },
      expectedSelection: null,
      expectedContentEdit: updated.edit,
    })

    expect(result).toMatchObject({ ok: true, historyEntry: true, edit: null })
    const after = useEditorStore.getState()
    expect(after.spatialContentEdit).toBeNull()
    expect(after.spatialGraphSelection).toEqual({ kind: 'path', id: pathId })
    expect(after.spatialSession?.selection.selectionIds).toEqual([])
    expect(selectSelectedNodeIds(after)).toEqual([])
    expect(selectSelectedNodeId(after)).toBeNull()
    expect(locateCourseLayer(after.spatialSession!.history.present, firstId)).toMatchObject({
      item: { content: { data: { text: '随图谱选择原子提交的草稿' } } },
    })
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore + 1)

    await undoSettled(host, documentId)
    expect(courseContent(useEditorStore.getState().spatialSession!.history.present))
      .toEqual(courseContent(beforeSession.history.present))
  })

  it('keeps a composing Spatial draft intact when run mode or camera navigation asks to commit it', async () => {
    useEditorStore.getState().runSpatialCommand((session) => (
      addSpatialCameraFrameFromSession(session, { name: '第二镜头' })
    ))
    useEditorStore.getState().addTextNode()
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const session = useEditorStore.getState().spatialSession!
    const layerItemId = session.selection.selectionIds[0]
    if (!layerItemId) throw new Error('expected selected Spatial text')
    const target = captureSpatialTarget({ kind: 'layer', layerItemId, field: 'content.text' })
    const begun = useEditorStore.getState().runSpatialAuthoringIntent(target, {
      kind: 'begin-content-edit',
      source: 'canvas',
      expectedEdit: null,
      expectedContentEdit: null,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected content edit')
    const composing = markSpatialWorldContentComposing(begun.edit, true)
    useEditorStore.setState({ spatialContentEdit: composing })
    const beforeRun = useEditorStore.getState()

    useEditorStore.getState().setCanvasMode('run')
    expect(useEditorStore.getState().canvasMode).toBe('edit')
    expectPersistentStateUnchanged(beforeRun)

    const otherLocation = session.history.present.locations.find((candidate) => (
      candidate.kind === 'spatial-camera'
      && candidate.surfaceId === session.selection.surfaceId
      && candidate.id !== session.selection.locationId
    ))
    if (!otherLocation) throw new Error('expected another Spatial camera location')
    const beforeNavigation = useEditorStore.getState()
    useEditorStore.getState().activateCourseLocation(otherLocation.id)
    expect(useEditorStore.getState().spatialSession?.selection.locationId)
      .toBe(session.selection.locationId)
    expectPersistentStateUnchanged(beforeNavigation)
    // No settle: drainCourseDocument throws while a composing draft is open. The
    // blocked run-mode and navigation requests queued nothing, so the formal
    // depth read is already authoritative.
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })

  it('keeps a pointer gesture bound to its pointer-down target after a concurrent revision change', async () => {
    useEditorStore.getState().addTextNode()
    await settleCourse()
    const session = useEditorStore.getState().spatialSession!
    const layerItemId = session.selection.selectionIds[0]
    if (!layerItemId) throw new Error('expected selected Spatial text')
    const view = buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    })
    const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
    if (!layer) throw new Error('expected Spatial layer view')
    const snapshot = {
      view,
      selectionIds: [...session.selection.selectionIds],
      scope: session.scope,
      contentEdit: useEditorStore.getState().spatialContentEdit,
      worldTarget: captureSpatialTarget({ kind: 'world', field: 'world' }),
      layerTargets: new Map([[
        layerItemId,
        captureSpatialTarget({ kind: 'layer', layerItemId, field: 'frame' }),
      ]]),
    } as const
    const controller = createSpatialWorldTargetAuthoringController({
      readSnapshot: () => snapshot,
      commands: {
        run: (target, intent) => useEditorStore.getState().runSpatialAuthoringIntent(target, intent),
      },
    })
    const transform = createSpatialWorldViewTransform(VIEWPORT, view.sessionCamera)
    const center = worldToClient(transform, {
      x: layer.item.frame.x + layer.item.frame.width / 2,
      y: layer.item.frame.y + layer.item.frame.height / 2,
    })
    controller.pointerDown(center, VIEWPORT)
    controller.pointerMove({ x: center.x + 40, y: center.y + 20 }, VIEWPORT)

    useEditorStore.getState().runSpatialCommand((current) => (
      addSpatialCameraFrameFromSession(current, { name: '并发新增镜头' })
    ))
    await settleCourse()
    const depthBefore = formalCourse(host, documentId).undoDepth
    const beforePointerUp = useEditorStore.getState()
    const result = controller.pointerUp({ x: center.x + 40, y: center.y + 20 }, VIEWPORT)

    expect(result.command).toMatchObject({ ok: false, historyEntry: false })
    expectPersistentStateUnchanged(beforePointerUp)
    await settleCourse()
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBefore)
  })
})
