import { isControllerFixture } from '../fixtures/teacherController'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bootCourseStore, courseStoreHost, formalHistory, formalReceipt, redoCourse, settleCourse, undoCourse } from '../helpers/triage-t1-editorDocument'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import { MAX_PROJECT_SCENES, MAX_SCENE_NODES } from '@/shared/constants'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { selectEffectiveSlideSceneNodes } from '../helpers/selectEffectiveSlideSceneNodes'
import {
  createExternalComponentNode,
  createImageNode,
  createTextNode,
} from '@/core/tools/nativeNodeFactories'
import {
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
} from '../../src/core/drivers/codecs/courseProjectArchive'
import { openDefaultCourseProject } from '@/renderer/project/courseProjectIo'
import { COURSE_PROJECT_REJECTION_INPUTS } from '../fixtures/course-project-v9'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { addSpatialRelationInSession } from '@/renderer/course/spatialRelationCommands'
import { addSpatialCameraFrameFromSession } from '@/renderer/course/spatialCameraCommands'
import { COURSE_PROJECT_SCHEMA_VERSION, type LayerItem } from '@/shared/courseProjectTypes'
import { allocateCourseLayerOrder } from '@/renderer/course/globalLayerCommands'
import {
  selectActiveScene,
  selectActiveSceneId,
  selectActivePresentationStateId,
  selectEditingNodes,
  selectEffectiveLayerProjection,
  selectMediaAssetFiles,
  selectHasUnsavedCourseChanges,
  selectSelectedNodeId,
  selectSelectedNodeIds,
  selectSlideBackendKind,
  selectSlideWorkspaceSource,
  selectSlideAuthoringDocument,
  selectSlideSceneList,
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'

function activeHistory() {
  return formalHistory()
}

/**
 * 2.0 的 renderer 每次 render 都会重建投影对象，所以“这次操作没有写入任何状态”不能用对象同一性
 * 证明。这里改用正式文档回执（revision、撤销/重做深度、文档内容）加投影内容快照。
 */
function formalWriteReceipt() {
  const snapshot = formalReceipt()
  if (snapshot.model.kind !== 'course-v9') throw new Error('expected Course Project V9')
  return {
    revision: snapshot.revision,
    undoDepth: snapshot.undoDepth,
    redoDepth: snapshot.redoDepth,
    project: structuredClone(snapshot.model.project),
  }
}

function captureWriteState() {
  return {
    receipt: formalWriteReceipt(),
    session: structuredClone(useEditorStore.getState().spatialSession),
  }
}

function expectNoWriteSince(before: ReturnType<typeof captureWriteState>): void {
  expect(formalWriteReceipt()).toEqual(before.receipt)
  expect(useEditorStore.getState().spatialSession).toEqual(before.session)
}

const imageMeta: AssetMeta = {
  id: 'asset_lesson_image',
  filename: 'lesson.png',
  mimeType: 'image/png',
  kind: 'image',
  path: 'assets/asset_lesson_image.png',
  byteLength: 4,
  width: 1920,
  height: 1080,
}

/**
 * 2.0 的正式文档保存/校验会重新解析组件包内文件，所以夹具必须给出与 manifest
 * 一致的真实字节，而不是占位字节。
 */
function sampleComponent(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: 'com.example.counter',
    name: '计数器',
    version: '4.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 480, height: 280 },
    minSize: { width: 160, height: 100 },
    preserveAspectRatio: true,
    assets: {},
    defaultProps: { initialValue: 3 },
    supportedScopes: ['scene'],
    renderMode: 'phaser',
  }
  const runtimeSource =
    "window.CoursewareComponent.define({id:'com.example.counter',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})"
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
  }
}

function activeScene() {
  return selectActiveScene(useEditorStore.getState())
}

function visualBounds(node: {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}) {
  const radians = (node.rotation * Math.PI) / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const width = node.width * cosine + node.height * sine
  const height = node.width * sine + node.height * cosine
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  return {
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: centerY - height / 2,
    bottom: centerY + height / 2,
    centerX,
    centerY,
  }
}

function mediaFiles() {
  return selectMediaAssetFiles(useEditorStore.getState())
}

async function acknowledgeCurrentSave(path: string) {
  await settleCourse()
  const documentId = useEditorStore.getState().courseDocument.documentId
  if (!documentId) throw new Error('expected active Surface session')
  await courseStoreHost().api.save(documentId, path)
  await settleCourse()
  const preparation = useEditorStore.getState().prepareCourseProjectPersistence()
  expect(preparation.ok).toBe(true)
  if (!preparation.ok) throw new Error(preparation.reason)
  expect(
    useEditorStore.getState().acknowledgeCourseProjectSaved(path, preparation.token),
  ).toBe(true)
  expect(useEditorStore.getState().dirty).toBe(false)
  return preparation
}

beforeEach(async () => {
  delete (window as Partial<Window>).desktopAPI
  await bootCourseStore()
})

describe('default Course Project V9 persistence', () => {
  it('creates a schemaVersion 9 document on the V9 authoring backend', async () => {
    const state = useEditorStore.getState()
    expect(selectSlideBackendKind(state)).toBe('slide-authoring')
    expect(selectSlideAuthoringDocument(state)?.schemaVersion).toBe(
      COURSE_PROJECT_SCHEMA_VERSION,
    )
    expect(selectActiveCourseProjectDocument(state)?.schemaVersion).toBe(
      COURSE_PROJECT_SCHEMA_VERSION,
    )
  })

  it('saves a zip that openCourseProjectArchive can reopen', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(40, 50)
    const document = selectSlideAuthoringDocument(useEditorStore.getState())
    expect(document?.schemaVersion).toBe(9)
    await settleCourse()
    const bytes = store.exportV9SlideCandidateArchive()
    expect(bytes).toBeInstanceOf(Uint8Array)
    const opened = openCourseProjectArchive(bytes!)
    expect(opened.project.schemaVersion).toBe(9)
    expect(opened.project.id).toBe(document!.id)
    expect(detectCourseProjectArchiveFormat(bytes!).kind).toBe('v9')
  })

  it('does not silently open a V8 zip as V9', async () => {
    const v8Bytes = COURSE_PROJECT_REJECTION_INPUTS['v8-unsupported']
    expect(detectCourseProjectArchiveFormat(v8Bytes).kind).toBe('unsupported')
    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(/格式版本|版本不支持/)
    expect(() => openDefaultCourseProject(v8Bytes)).toThrow(/格式版本|版本不支持/)
  })

  it('keeps the V8 preview and effective layer selection aligned through Slide history and page changes', async () => {
    const store = useEditorStore.getState()
    const firstSceneId = selectActiveSceneId(store)

    store.addTextNode(40, 50)
    const nodeId = selectEditingNodes(useEditorStore.getState())[0]!.id
    let state = useEditorStore.getState()
    expect(selectSlideSceneList(state).find((scene) => scene.id === firstSceneId)?.nodes)
      .toContainEqual(expect.objectContaining({ id: nodeId }))
    expect(selectEffectiveLayerProjection(state)?.unifiedRows.map((row) => row.id))
      .toContain(nodeId)

    await undoCourse()
    state = useEditorStore.getState()
    expect(selectSlideSceneList(state).find((scene) => scene.id === firstSceneId)?.nodes)
      .not.toContainEqual(expect.objectContaining({ id: nodeId }))
    expect(selectEffectiveLayerProjection(state)?.unifiedRows.map((row) => row.id))
      .not.toContain(nodeId)

    await redoCourse()
    state = useEditorStore.getState()
    expect(selectSlideSceneList(state).find((scene) => scene.id === firstSceneId)?.nodes)
      .toContainEqual(expect.objectContaining({ id: nodeId }))
    expect(selectEffectiveLayerProjection(state)?.unifiedRows.map((row) => row.id))
      .toContain(nodeId)

    store.addScene()
    state = useEditorStore.getState()
    const secondSceneId = selectActiveSceneId(state)
    expect(selectSlideSceneList(state).find((scene) => scene.id === secondSceneId)?.nodes)
      .toEqual([])
    expect(selectSlideSceneList(state).find((scene) => scene.id === secondSceneId)?.nodes)
      .toEqual([])

    store.setActiveScene(firstSceneId)
    state = useEditorStore.getState()
    expect(selectActiveSceneId(state)).toBe(firstSceneId)
    expect(selectSlideSceneList(state).find((scene) => scene.id === firstSceneId)?.nodes)
      .toContainEqual(expect.objectContaining({ id: nodeId }))
    expect(selectEffectiveLayerProjection(state)?.unifiedRows.map((row) => row.id))
      .toContain(nodeId)
  })
})

describe('Spatial command failure diagnostics', () => {
  it('keeps a structured reason out of teacher feedback and preserves failed-command state', async () => {
    const reportDiagnostic = vi.fn(async (
      _input: Parameters<Window['desktopAPI']['reportDiagnostic']>[0],
    ) => undefined)
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: { reportDiagnostic },
    })
    await useEditorStore.getState().createCourseDocument('spatial')
    await settleCourse()
    const before = useEditorStore.getState()
    const sessionBefore = before.spatialSession
    if (!sessionBefore) throw new Error('expected Spatial session')
    const documentBefore = sessionBefore.history.present
    const receiptBefore = formalReceipt()
    const selectionBefore = [...sessionBefore.selection.selectionIds]
    const rawReason = JSON.stringify([
      {
        code: 'invalid_type',
        path: ['surfaces', 0, 'world', 'layerItems', 0, 'order'],
        message: 'Invalid input: expected number, received string',
      },
    ], null, 2)

    const result = before.runSpatialCommand((session) => ({
      ok: false,
      reason: rawReason,
      nextSession: session,
      historyEntry: false,
      selection: session.selection,
    }))

    const after = useEditorStore.getState()
    expect(result.reason).toBe(rawReason)
    expect(after.errorMessage).toBe('内容格式不正确。请检查刚才的输入后重试。')
    expect(after.errorMessage).not.toMatch(/invalid_type|surfaces|code|path|[\[\]{}]/)
    expect(reportDiagnostic).toHaveBeenCalledTimes(1)
    expect(reportDiagnostic.mock.calls[0]?.[0]).toMatchObject({
      source: 'renderer',
      stack: rawReason,
    })
    expect(reportDiagnostic.mock.calls[0]?.[0]?.message).toContain(
      `"sessionId":"${sessionBefore.sessionId}"`,
    )
    expect(reportDiagnostic.mock.calls[0]?.[0]?.message).toContain(
      `"revision":${documentBefore.revision}`,
    )
    expect(after.spatialSession?.history.present.revision).toBe(documentBefore.revision)
    expect(after.dirty).toBe(before.dirty)
    // A failed command never reaches Main: the formal document, history and selection stay untouched.
    expect(formalReceipt()).toEqual(receiptBefore)
    expect(after.spatialSession?.history.present).toEqual(documentBefore)
    expect(selectSelectedNodeIds(after)).toEqual(selectionBefore)
    expect(selectSelectedNodeIds(after).at(-1) ?? null).toBe(selectionBefore.at(-1) ?? null)
  })

  it('maps an ordinary reason even when the local diagnostic write rejects', async () => {
    const reportDiagnostic = vi.fn(async (
      _input: Parameters<Window['desktopAPI']['reportDiagnostic']>[0],
    ) => {
      throw new Error('diagnostic disk unavailable')
    })
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: { reportDiagnostic },
    })
    await useEditorStore.getState().createCourseDocument('spatial')
    await settleCourse()
    const before = useEditorStore.getState()
    const sessionBefore = before.spatialSession
    if (!sessionBefore) throw new Error('expected Spatial session')
    const receiptBefore = formalReceipt()
    const selectionBefore = [...sessionBefore.selection.selectionIds]

    const result = before.runSpatialCommand((session) => ({
      ok: false,
      reason: 'locked',
      nextSession: session,
      historyEntry: false,
      selection: session.selection,
    }))
    await Promise.resolve()

    const after = useEditorStore.getState()
    expect(result.reason).toBe('locked')
    expect(after.errorMessage).toBe('当前内容已锁定。请先解锁后重试。')
    expect(after.errorMessage).not.toContain('locked')
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      source: 'renderer',
      stack: 'locked',
    }))
    expect(formalReceipt()).toEqual(receiptBefore)
    expect(selectSelectedNodeIds(after)).toEqual(selectionBefore)
  })
})

describe('Spatial canonical property updates', () => {
  it('commits common and whole-node text properties atomically with undo and redo', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const nodes = selectEditingNodes(useEditorStore.getState()).filter(
      (node) => node.type === 'text',
    )
    const [first, second] = nodes
    if (!first || !second || first.type !== 'text' || second.type !== 'text') {
      throw new Error('expected two Spatial text nodes')
    }
    useEditorStore.getState().selectNodes([first.id, second.id])
    await settleCourse()
    const before = useEditorStore.getState().spatialSession!
    const historyBefore = formalHistory().past.length

    useEditorStore.getState().updateNodes([
      {
        nodeId: first.id,
        patch: {
          name: '原子标题',
          x: first.x + 37,
          y: first.y + 19,
          width: first.width + 23,
          height: first.height + 11,
          rotation: 17,
          opacity: 0.42,
          visible: false,
          locked: true,
          playbackInitialVisibility: 'hidden',
        },
      },
      {
        nodeId: second.id,
        patch: {
          style: {
            fontFamily: 'SimHei',
            fontSize: 36,
            color: '#123456',
            bold: true,
            lineSpacing: 1.8,
          },
        },
      },
    ])
    await settleCourse()

    const changed = useEditorStore.getState().spatialSession!
    expect(changed.history.present.revision).toBe(before.history.present.revision + 1)
    expect(formalHistory().past).toHaveLength(historyBefore + 1)
    const surface = changed.history.present.surfaces.find(
      (candidate) => candidate.id === changed.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const firstItem = surface.world.layerItems.find((item) => item.layerItemId === first.id)
    const secondItem = surface.world.layerItems.find((item) => item.layerItemId === second.id)
    expect(firstItem).toMatchObject({
      label: '原子标题',
      frame: {
        x: first.x + 37,
        y: first.y + 19,
        width: first.width + 23,
        height: first.height + 11,
      },
      rotation: 17,
      opacity: 0.42,
      visible: false,
      locked: true,
      playbackInitialVisibility: 'hidden',
    })
    expect(secondItem).toMatchObject({
      kind: 'native',
      content: {
        nativeType: 'text',
        data: {
          style: {
            fontFamily: 'SimHei',
            fontSize: 36,
            color: '#123456',
            bold: true,
            lineSpacing: 1.8,
          },
        },
      },
    })

    await undoCourse()
    const undone = useEditorStore.getState().spatialSession!
    const undoneSurface = undone.history.present.surfaces.find(
      (candidate) => candidate.id === undone.selection.surfaceId,
    )
    if (!undoneSurface || undoneSurface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    expect(undoneSurface.world.layerItems.find((item) => item.layerItemId === first.id)?.label)
      .toBe(first.name)
    expect(undoneSurface.world.layerItems.find((item) => item.layerItemId === second.id))
      .toMatchObject({ kind: 'native', content: { nativeType: 'text', data: { style: second.style } } })

    await redoCourse()
    const redone = useEditorStore.getState().spatialSession!
    expect(redone.history.present.surfaces
      .find((candidate) => candidate.id === redone.selection.surfaceId))
      .toMatchObject({
        type: 'spatial-2d',
        world: {
          layerItems: expect.arrayContaining([
            expect.objectContaining({ layerItemId: first.id, label: '原子标题' }),
            expect.objectContaining({
              layerItemId: second.id,
              content: expect.objectContaining({
                data: expect.objectContaining({
                  style: expect.objectContaining({ bold: true, color: '#123456' }),
                }),
              }),
            }),
          ]),
        },
      })
  })

  it('keeps no-op, locked, and unsupported batches at zero document and history writes', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const [first, second] = selectEditingNodes(useEditorStore.getState()).filter(
      (node) => node.type === 'text',
    )
    if (!first || !second || first.type !== 'text' || second.type !== 'text') {
      throw new Error('expected two Spatial text nodes')
    }
    useEditorStore.getState().selectNodes([first.id, second.id])
    await settleCourse()

    const receiptBefore = formalReceipt()
    const selectionBefore = selectSelectedNodeIds(useEditorStore.getState())
    useEditorStore.getState().updateNodes([{
      nodeId: second.id,
      patch: { opacity: second.opacity, style: { bold: Boolean(second.style?.bold) } },
    }])
    await settleCourse()
    expect(formalReceipt()).toEqual(receiptBefore)
    expect(selectSelectedNodeIds(useEditorStore.getState())).toEqual(selectionBefore)

    useEditorStore.getState().updateNodes([{
      nodeId: second.id,
      patch: { width: second.width, style: { ...second.style } },
    }])
    await settleCourse()
    expect(formalReceipt()).toEqual(receiptBefore)
    expect(selectSelectedNodeIds(useEditorStore.getState())).toEqual(selectionBefore)

    useEditorStore.getState().updateNode(first.id, { locked: true })
    await settleCourse()
    const lockedReceipt = formalReceipt()
    const secondOpacity = useEditorStore.getState().spatialSession!.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])
      .find((item) => item.layerItemId === second.id)?.opacity
    useEditorStore.getState().updateNodes([
      { nodeId: first.id, patch: { name: '不应部分写入' } },
      { nodeId: second.id, patch: { opacity: 0.25 } },
    ])
    await settleCourse()
    const afterLocked = useEditorStore.getState()
    expect(formalReceipt()).toEqual(lockedReceipt)
    expect(afterLocked.errorMessage).toBe('当前内容已锁定。请先解锁后重试。')
    expect(afterLocked.spatialSession?.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])
      .find((item) => item.layerItemId === second.id)?.opacity).toBe(secondOpacity)

    useEditorStore.getState().updateNode(second.id, {
      fit: 'cover',
    } as never)
    await settleCourse()
    const afterUnsupported = useEditorStore.getState()
    expect(formalReceipt()).toEqual(lockedReceipt)
    expect(afterUnsupported.errorMessage).toBe(
      '当前元素不支持这项属性，未保存任何更改。',
    )
  })

  it('keeps geometry and presentation properties selection-bound', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const [selected, unselected] = selectEditingNodes(useEditorStore.getState()).filter(
      (node) => node.type === 'text',
    )
    if (!selected || !unselected) throw new Error('expected two Spatial text nodes')
    useEditorStore.getState().selectNode(selected.id)
    await settleCourse()
    const before = useEditorStore.getState().spatialSession!
    const receiptBefore = formalReceipt()
    const selectionBefore = selectSelectedNodeIds(useEditorStore.getState())

    useEditorStore.getState().updateNode(unselected.id, {
      name: '不得借直接行属性绕过选择',
      opacity: 0.25,
    })
    await settleCourse()

    const after = useEditorStore.getState()
    expect(formalReceipt()).toEqual(receiptBefore)
    expect(selectSelectedNodeIds(after)).toEqual(selectionBefore)
    expect(after.errorMessage).toBe('所选内容已失效。请重新选择后再试。')
    const located = locateCourseLayer(before.history.present, unselected.id)
    expect(located?.item.label).toBe(unselected.name)
    expect(located?.item.opacity).toBe(unselected.opacity)
  })
})

describe('Spatial canonical clipboard commands', () => {
  it('copies and pastes one owner batch, then duplicates it with one history entry each', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode(40, 60)
    useEditorStore.getState().addTextNode(260, 180)
    const initial = useEditorStore.getState().spatialSession!
    const surface = initial.history.present.surfaces.find(
      (candidate) => candidate.id === initial.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const sourceIds = surface.world.layerItems.map((item) => item.layerItemId)
    expect(sourceIds).toHaveLength(2)
    useEditorStore.getState().runSpatialCommand((session) => addSpatialRelationInSession(session, {
      sourceLayerItemId: sourceIds[0]!,
      targetLayerItemId: sourceIds[1]!,
      kind: 'arrow',
      label: '成对复制',
    }))
    useEditorStore.getState().selectNodes(sourceIds)
    await settleCourse()

    const beforeCopy = useEditorStore.getState()
    const copySession = beforeCopy.spatialSession!
    beforeCopy.copySelectedNodes()
    const copied = useEditorStore.getState()
    expect(copied.spatialSession).toBe(copySession)
    expect(copied.spatialSession?.history).toBe(copySession.history)
    expect(copied.spatialSession?.selection).toBe(copySession.selection)
    expect(copied.spatialClipboard).toMatchObject({
      projectId: copySession.history.present.id,
      sessionId: copySession.sessionId,
      locationId: copySession.selection.locationId,
      surfaceId: copySession.selection.surfaceId,
      owner: 'world',
      ownerKey: `world:${copySession.selection.surfaceId}`,
    })
    expect(copied.spatialClipboard?.items).toHaveLength(2)

    const pasteBase = copied.spatialSession!
    const pasteBaseHistory = activeHistory().past.length
    copied.pasteNodes()
    await settleCourse()
    const pasted = useEditorStore.getState().spatialSession!
    const pastedIds = [...pasted.selection.selectionIds]
    expect(pastedIds).toHaveLength(2)
    expect(pasted.history.present.revision).toBe(pasteBase.history.present.revision + 1)
    expect(activeHistory().past).toHaveLength(pasteBaseHistory + 1)
    expect(pasted.scope).toBe('world')
    const pastedSurface = pasted.history.present.surfaces.find(
      (candidate) => candidate.id === pasted.selection.surfaceId,
    )
    if (!pastedSurface || pastedSurface.type !== 'spatial-2d') {
      throw new Error('expected Spatial surface')
    }
    const sourceById = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
    pastedIds.forEach((pastedId, index) => {
      const source = sourceById.get(sourceIds[index]!)!
      const item = pastedSurface.world.layerItems.find((candidate) => candidate.layerItemId === pastedId)
      expect(item).toMatchObject({
        locked: false,
        label: `${source.label} 副本`,
        frame: {
          x: source.frame.x + 20,
          y: source.frame.y + 20,
          width: source.frame.width,
          height: source.frame.height,
        },
      })
    })
    expect(new Set(pastedSurface.world.layerItems.map((item) => item.order)).size)
      .toBe(pastedSurface.world.layerItems.length)
    expect(pastedSurface.world.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLayerItemId: pastedIds[0],
        targetLayerItemId: pastedIds[1],
        label: '成对复制',
      }),
    ]))

    const duplicateBase = pasted
    const duplicateBaseHistory = activeHistory().past.length
    useEditorStore.getState().duplicateSelectedNodes()
    await settleCourse()
    const duplicated = useEditorStore.getState().spatialSession!
    const duplicatedIds = [...duplicated.selection.selectionIds]
    expect(duplicatedIds).toHaveLength(2)
    expect(duplicated.history.present.revision).toBe(duplicateBase.history.present.revision + 1)
    expect(activeHistory().past).toHaveLength(duplicateBaseHistory + 1)
    const duplicatedSurface = duplicated.history.present.surfaces.find(
      (candidate) => candidate.id === duplicated.selection.surfaceId,
    )
    expect(duplicatedSurface).toMatchObject({
      type: 'spatial-2d',
      world: {
        relations: expect.arrayContaining([
          expect.objectContaining({
            sourceLayerItemId: duplicatedIds[0],
            targetLayerItemId: duplicatedIds[1],
          }),
        ]),
      },
    })

    await undoCourse()
    const undone = useEditorStore.getState().spatialSession!
    expect(undone.selection.selectionIds).toEqual([])
    expect(duplicatedIds.every((id) => locateCourseLayer(undone.history.present, id) === null)).toBe(true)
    await redoCourse()
    const redone = useEditorStore.getState().spatialSession!
    expect(redone.selection.selectionIds).toEqual([])
    expect(duplicatedIds.every((id) => locateCourseLayer(redone.history.present, id) !== null)).toBe(true)
  })

  it('clears the clipboard on a camera location transition and does not revive it on return', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    const sourceId = useEditorStore.getState().spatialSession!.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])[0]
      ?.layerItemId
    if (!sourceId) throw new Error('expected Spatial source item')
    useEditorStore.getState().selectNode(sourceId)
    useEditorStore.getState().copySelectedNodes()
    const captured = useEditorStore.getState().spatialClipboard
    expect(captured).not.toBeNull()

    useEditorStore.getState().runSpatialCommand((session) => (
      addSpatialCameraFrameFromSession(session, { name: '剪贴板转换镜头' })
    ))
    expect(useEditorStore.getState().spatialClipboard).toBe(captured)
    const session = useEditorStore.getState().spatialSession!
    const surface = session.history.present.surfaces.find(
      (candidate) => candidate.id === session.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const activeLocation = session.history.present.locations.find(
      (location) => location.id === session.selection.locationId,
    )
    if (!activeLocation || activeLocation.kind !== 'spatial-camera') {
      throw new Error('expected active Spatial location')
    }
    const otherFrame = surface.camera.frames.find(
      (frame) => frame.id !== activeLocation.cameraFrameId,
    )
    if (!otherFrame) throw new Error('expected second camera frame')

    useEditorStore.getState().setActiveScene(otherFrame.id)
    expect(useEditorStore.getState().spatialClipboard).toBeNull()
    useEditorStore.getState().setActiveScene(activeLocation.cameraFrameId)
    expect(useEditorStore.getState().spatialClipboard).toBeNull()
  })

  it('rejects locked, wrong-owner, removed-source, and empty operations without partial state writes', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const items = useEditorStore.getState().spatialSession!.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])
    const [first, second] = items
    if (!first || !second) throw new Error('expected Spatial items')

    useEditorStore.getState().selectNode(first.layerItemId)
    useEditorStore.getState().copySelectedNodes()
    const validClipboard = useEditorStore.getState().spatialClipboard
    expect(validClipboard).not.toBeNull()

    useEditorStore.getState().updateNode(first.layerItemId, { locked: true })
    await settleCourse()
    const beforeLockedPaste = useEditorStore.getState()
    const beforeLockedPasteState = captureWriteState()
    beforeLockedPaste.pasteNodes()
    const afterLockedPaste = useEditorStore.getState()
    expectNoWriteSince(beforeLockedPasteState)
    expect(afterLockedPaste.spatialClipboard).toBe(validClipboard)
    expect(afterLockedPaste.errorMessage).toMatch(/锁定/)
    await undoCourse()
    expect(locateCourseLayer(
      useEditorStore.getState().spatialSession!.history.present,
      first.layerItemId,
    )?.item.locked).toBe(false)
    expect(useEditorStore.getState().spatialClipboard).toBe(validClipboard)

    useEditorStore.getState().selectNode(second.layerItemId)
    useEditorStore.getState().updateNode(second.layerItemId, { locked: true })
    await settleCourse()
    const beforeLocked = useEditorStore.getState()
    const beforeLockedState = captureWriteState()
    beforeLocked.copySelectedNodes()
    const afterLockedCopy = useEditorStore.getState()
    expectNoWriteSince(beforeLockedState)
    expect(afterLockedCopy.spatialClipboard).toBe(validClipboard)
    expect(afterLockedCopy.errorMessage).toMatch(/锁定/)

    const beforeLockedDuplicate = useEditorStore.getState()
    const beforeLockedDuplicateState = captureWriteState()
    beforeLockedDuplicate.duplicateSelectedNodes()
    expectNoWriteSince(beforeLockedDuplicateState)

    useEditorStore.getState().selectNode(first.layerItemId)
    useEditorStore.getState().copySelectedNodes()
    useEditorStore.getState().setEditingScope('global')
    const beforeWrongOwner = useEditorStore.getState()
    const beforeWrongOwnerState = captureWriteState()
    beforeWrongOwner.pasteNodes()
    const afterWrongOwner = useEditorStore.getState()
    expectNoWriteSince(beforeWrongOwnerState)
    expect(afterWrongOwner.errorMessage).toMatch(/编辑范围/)

    const controllerId = beforeWrongOwner.spatialSession?.history.present.globalLayerItems.find(
      (entry) => isControllerFixture(entry.item),
    )?.item.layerItemId
    if (!controllerId) throw new Error('expected teacher controller')
    const beforeController = useEditorStore.getState()
    const beforeControllerState = captureWriteState()
    beforeController.duplicateNode(controllerId)
    const afterController = useEditorStore.getState()
    expectNoWriteSince(beforeControllerState)
    expect(afterController.errorMessage).toMatch(/教师控制器/)

    useEditorStore.getState().setEditingScope('scene')
    useEditorStore.getState().selectNode(first.layerItemId)
    useEditorStore.getState().copySelectedNodes()
    useEditorStore.getState().deleteNode(first.layerItemId)
    await settleCourse()
    const beforeRemoved = useEditorStore.getState()
    const beforeRemovedState = captureWriteState()
    beforeRemoved.pasteNodes()
    const afterRemoved = useEditorStore.getState()
    expectNoWriteSince(beforeRemovedState)
    expect(afterRemoved.errorMessage).toMatch(/失效/)

    useEditorStore.setState({ spatialClipboard: null })
    const beforeEmpty = useEditorStore.getState()
    const beforeEmptyState = captureWriteState()
    beforeEmpty.pasteNodes()
    const afterEmpty = useEditorStore.getState()
    expectNoWriteSince(beforeEmptyState)
    expect(afterEmpty.errorMessage).toMatch(/剪贴板为空/)

    await useEditorStore.getState().createCourseDocument('slide')
    expect(useEditorStore.getState().spatialClipboard).toBeNull()
  })

  it('remaps runtime, interaction follower, and relation references across later edits and repeated paste', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode(20, 30)
    useEditorStore.getState().addTextNode(500, 300)
    const session = useEditorStore.getState().spatialSession!
    const document = structuredClone(session.history.present)
    const surface = document.surfaces.find(
      (candidate) => candidate.id === session.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const [triggerItem, outsideItem] = surface.world.layerItems
    if (!triggerItem || !outsideItem) throw new Error('expected Spatial world items')
    const runtimeId = 'runtime-spatial-clipboard'
    const runtimeItem = {
      layerItemId: runtimeId,
      label: '引用运行时',
      frame: { mode: 'absolute', x: 180, y: 120, width: 320, height: 180 },
      order: allocateCourseLayerOrder(document, triggerItem.order + 1),
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
        nodeBindings: {
          peer: triggerItem.layerItemId,
          self: runtimeId,
          outside: outsideItem.layerItemId,
        },
      },
    } satisfies LayerItem
    surface.world.layerItems.push(runtimeItem)
    surface.world.relations = [
      {
        id: 'relation-runtime-peer',
        sourceLayerItemId: triggerItem.layerItemId,
        targetLayerItemId: runtimeId,
        label: '运行时关系',
        kind: 'line',
      },
      {
        id: 'relation-runtime-outside',
        sourceLayerItemId: triggerItem.layerItemId,
        targetLayerItemId: outsideItem.layerItemId,
        label: '外部关系',
        kind: 'arrow',
      },
    ]
    surface.world.paths = [{
      id: 'path-runtime-outside',
      name: '原路径',
      layerItemIds: [triggerItem.layerItemId, outsideItem.layerItemId],
    }]
    surface.semanticZoom = [{
      id: 'zoom-runtime-outside',
      layerItemIds: [runtimeId, outsideItem.layerItemId],
      minZoom: 0.5,
      maxZoom: 2,
      visible: true,
    }]
    const originalPaths = structuredClone(surface.world.paths)
    const originalSemanticZoom = structuredClone(surface.semanticZoom)
    document.globalInteractions.push(
      {
        id: 'rule-spatial-copy-root',
        enabled: true,
        trigger: { type: 'node.click', nodeId: triggerItem.layerItemId },
        conditions: [],
        actions: [{
          id: 'action-spatial-copy-motion',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.enter',
            nodeId: runtimeId,
            effect: 'fade',
            durationMs: 240,
            easing: 'ease-out',
          },
        }],
      },
      {
        id: 'rule-spatial-copy-follower',
        enabled: true,
        trigger: {
          type: 'animation.completed',
          actionId: 'action-spatial-copy-motion',
        },
        conditions: [],
        actions: [{
          id: 'action-spatial-copy-follower',
          start: 'after-previous',
          delayMs: 0,
          action: {
            type: 'node.exit',
            nodeId: triggerItem.layerItemId,
            effect: 'fade',
            durationMs: 180,
            easing: 'ease-in',
          },
        }],
      },
    )
    await courseStoreHost().open(document)
    useEditorStore.getState().selectNodes([triggerItem.layerItemId, runtimeId])
    useEditorStore.getState().copySelectedNodes()
    const capturedRevision = useEditorStore.getState().spatialClipboard?.capturedRevision

    useEditorStore.getState().pasteNodes()
    await settleCourse()
    const firstPaste = useEditorStore.getState().spatialSession!
    const [newTriggerId, newRuntimeId] = firstPaste.selection.selectionIds
    expect(capturedRevision).toBeLessThan(firstPaste.history.present.revision)
    const newRuntime = locateCourseLayer(firstPaste.history.present, newRuntimeId!)?.item
    expect(newRuntime).toMatchObject({
      kind: 'runtime',
      runtime: {
        nodeBindings: {
          peer: newTriggerId,
          self: newRuntimeId,
          outside: outsideItem.layerItemId,
        },
      },
    })
    const copiedRoot = firstPaste.history.present.globalInteractions.find(
      (rule) => 'nodeId' in rule.trigger && rule.trigger.nodeId === newTriggerId,
    )
    const copiedMotionId = copiedRoot?.actions[0]?.id
    expect(copiedRoot?.actions[0]?.action).toMatchObject({ nodeId: newRuntimeId })
    expect(firstPaste.history.present.globalInteractions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger: { type: 'animation.completed', actionId: copiedMotionId },
      }),
    ]))
    const firstSurface = firstPaste.history.present.surfaces.find(
      (candidate) => candidate.id === firstPaste.selection.surfaceId,
    )
    expect(firstSurface).toMatchObject({
      type: 'spatial-2d',
      world: {
        relations: expect.arrayContaining([
          expect.objectContaining({
            sourceLayerItemId: newTriggerId,
            targetLayerItemId: newRuntimeId,
            label: '运行时关系',
          }),
        ]),
      },
    })
    if (firstSurface?.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    expect(firstSurface.world.relations).toHaveLength(3)
    expect(firstSurface.world.relations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLayerItemId: newTriggerId,
        targetLayerItemId: outsideItem.layerItemId,
      }),
    ]))
    expect(firstSurface.world.paths).toEqual(originalPaths)
    expect(firstSurface.semanticZoom).toEqual(originalSemanticZoom)

    useEditorStore.getState().selectNode(outsideItem.layerItemId)
    useEditorStore.getState().updateNode(outsideItem.layerItemId, { name: '普通后续编辑' })
    await settleCourse()
    const editedRevision = useEditorStore.getState().spatialSession!.history.present.revision
    expect(editedRevision).toBeGreaterThan(firstPaste.history.present.revision)
    useEditorStore.getState().pasteNodes()
    await settleCourse()
    const repeated = useEditorStore.getState().spatialSession!
    expect(repeated.history.present.revision).toBe(editedRevision + 1)
    expect(repeated.selection.selectionIds).toHaveLength(2)

    const validClipboard = useEditorStore.getState().spatialClipboard
    if (!validClipboard) throw new Error('expected Spatial clipboard')
    const danglingClipboard = structuredClone(validClipboard)
    const runtimeClipboardItem = danglingClipboard.items.find(
      (entry) => entry.item.kind === 'runtime',
    )
    if (!runtimeClipboardItem || runtimeClipboardItem.item.kind !== 'runtime') {
      throw new Error('expected Runtime clipboard item')
    }
    runtimeClipboardItem.item.runtime.nodeBindings = { missing: 'removed-layer-reference' }
    useEditorStore.setState({ spatialClipboard: danglingClipboard })
    const beforeDangling = useEditorStore.getState()
    const beforeDanglingState = captureWriteState()
    beforeDangling.pasteNodes()
    const afterDangling = useEditorStore.getState()
    expectNoWriteSince(beforeDanglingState)
    expect(afterDangling.errorMessage).toMatch(/资源|引用/)
  })

  it('rejects an owner at capacity without changing document, history, or selection', async () => {
    await useEditorStore.getState().createCourseDocument('spatial')
    useEditorStore.getState().addTextNode()
    const initial = useEditorStore.getState().spatialSession!
    const document = structuredClone(initial.history.present)
    const surface = document.surfaces.find(
      (candidate) => candidate.id === initial.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const source = surface.world.layerItems[0]
    if (!source) throw new Error('expected source item')
    const allOrders = [
      ...document.globalLayerItems.map((entry) => entry.item.order),
      ...surface.surfaceLayerItems.map((entry) => entry.item.order),
      ...surface.world.layerItems.map((item) => item.order),
    ]
    let order = Math.max(...allOrders) + 1
    while (surface.world.layerItems.length < MAX_SCENE_NODES) {
      const item = structuredClone(source)
      item.layerItemId = `capacity-spatial-${surface.world.layerItems.length}`
      item.label = `容量 ${surface.world.layerItems.length}`
      item.order = order
      order += 1
      surface.world.layerItems.push(item)
    }
    await courseStoreHost().open(document)
    useEditorStore.getState().selectNode(source.layerItemId)
    await settleCourse()
    const before = useEditorStore.getState()
    const beforeState = captureWriteState()
    before.duplicateSelectedNodes()
    const after = useEditorStore.getState()
    expectNoWriteSince(beforeState)
    expect(after.errorMessage).toMatch(/上限/)
  })
})

describe('scene operations', () => {
  it('adds scenes, switches to the new scene, and records each addition', async () => {
    const store = useEditorStore.getState()
    store.addScene()
    store.addScene()

    const state = useEditorStore.getState()
    expect(selectSlideSceneList(state).map((scene) => scene.name)).toEqual([
      '场景 1',
      '场景 2',
      '场景 3',
    ])
    expect(selectActiveSceneId(state)).toBe(selectSlideSceneList(state)[2]!.id)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(2)
    expect(state.dirty).toBe(true)
  })

  it.each(['scene', 'scene-from-flow', 'surface', 'only-scene-on-first-surface'] as const)('deletes the original %s with later content and restores it in one undo', async (kind) => {
    const store = useEditorStore.getState()
    const initial = selectActiveCourseProjectDocument(store)!
    const firstScene = selectSlideSceneList(store)[0]!.id
    const firstSurface = initial.locations[0]!.surfaceId
    if (kind === 'scene' || kind === 'scene-from-flow') store.addScene()
    else store.addCourseContent('slide-page')
    if (kind === 'scene-from-flow') store.addCourseContent('flow-page')
    const before = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!)
    await settleCourse()
    const historyCount = activeHistory().past.length
    if (kind !== 'surface') store.deleteScene(firstScene)
    else store.deleteCourseSurface(firstSurface)
    const after = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(after.locations.some(location => location.id === initial.startLocationId), useEditorStore.getState().errorMessage ?? '').toBe(false)
    expect(after.startLocationId).toBe(after.locations[0]!.id)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyCount + 1)
    await undoCourse()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.locations).toEqual(before.locations)
  })

  it('never deletes the final scene and does not create a no-op history entry', async () => {
    const initial = useEditorStore.getState()
    const onlySceneId = selectSlideSceneList(initial)[0]!.id

    expect(initial.deleteScene(onlySceneId)).toBe(false)
    expect(selectSlideSceneList(useEditorStore.getState())).toHaveLength(1)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(0)
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('renames, recolours, reorders, and deletes scenes with undoable commits', async () => {
    const store = useEditorStore.getState()
    const firstId = selectSlideSceneList(store)[0]!.id
    store.addScene()
    const secondId = selectSlideSceneList(useEditorStore.getState())[1]!.id
    store.addScene()
    const thirdId = selectSlideSceneList(useEditorStore.getState())[2]!.id

    store.updateScene(secondId, {
      name: '  练习场景  ',
    })
    store.updateSceneBackground(secondId, {
      backgroundColor: '#f3f4f6',
    })
    expect(
      selectSlideSceneList(useEditorStore.getState()).find((scene) => scene.id === secondId),
    ).toMatchObject({
      name: '练习场景',
      backgroundColor: '#f3f4f6',
    })

    store.reorderScenes([thirdId, firstId, secondId])
    expect(selectSlideSceneList(useEditorStore.getState()).map((scene) => scene.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ])

    store.setActiveScene(thirdId)
    expect(store.deleteScene(thirdId)).toBe(true)
    const state = useEditorStore.getState()
    expect(selectSlideSceneList(state).map((scene) => scene.id)).toEqual([firstId, secondId])
    expect(selectActiveSceneId(state)).toBe(firstId)
  })

  it('ignores invalid reorder requests without changing history', async () => {
    const store = useEditorStore.getState()
    store.addScene()
    await settleCourse()
    const historyLength = activeHistory().past.length
    const sceneIds = selectSlideSceneList(useEditorStore.getState()).map((scene) => scene.id)

    store.reorderScenes([sceneIds[0]!, sceneIds[0]!])
    expect(selectSlideSceneList(useEditorStore.getState()).map((scene) => scene.id)).toEqual(
      sceneIds,
    )
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyLength)
  })

  it('keeps a high defensive scene limit without the former 30-scene product cap', async () => {
    const store = useEditorStore.getState()
    const document = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState())!)
    const surface = document.surfaces.find((item) => item.type === 'slide')
    if (!surface || surface.type !== 'slide') throw new Error('missing slide surface')
    const template = surface.scenes[0]!
    const templateLocation = document.locations.find((location) => (
      location.kind === 'slide-scene' && location.sceneId === template.id
    ))
    surface.scenes = Array.from({ length: MAX_PROJECT_SCENES }, (_, index) => ({
      ...structuredClone(template),
      id: index === 0 ? template.id : `scene_pad_${index}`,
      name: `场景 ${index + 1}`,
    }))
    document.locations = [
      ...document.locations.filter((location) => location.kind !== 'slide-scene'),
      ...surface.scenes.map((scene, index) => ({
        id: index === 0 && templateLocation ? templateLocation.id : `location_pad_${index}`,
        label: `${surface.title} · ${scene.name}`,
        kind: 'slide-scene' as const,
        surfaceId: surface.id,
        sceneId: scene.id,
      })),
    ]
    await courseStoreHost().open(document)
    store.addScene()

    const state = useEditorStore.getState()
    expect(selectSlideSceneList(state)).toHaveLength(MAX_PROJECT_SCENES)
    expect(state.errorMessage).toContain(`${MAX_PROJECT_SCENES} 个场景上限`)
  })

  it('duplicates a scene with independent scene and node identities', async () => {
    const store = useEditorStore.getState()
    const sourceId = selectSlideSceneList(store)[0]!.id
    store.addTextNode(80, 90)
    store.addRectangleNode(320, 240)
    const sourceNodes = activeScene().nodes.map((node) => structuredClone(node))
    await settleCourse()
    const historyBeforeDuplicate = activeHistory().past.length

    store.duplicateScene(sourceId)

    const state = useEditorStore.getState()
    const source = selectSlideSceneList(state)[0]!
    const copy = selectSlideSceneList(state)[1]!
    expect(copy).toMatchObject({ name: `${source.name} 副本` })
    expect(copy.id).not.toBe(source.id)
    expect(copy.nodes.map((node) => node.id)).not.toEqual(
      source.nodes.map((node) => node.id),
    )
    expect(copy.nodes.map(({ id: _id, ...node }) => node)).toEqual(
      sourceNodes.map(({ id: _id, ...node }) => node),
    )
    expect(selectActiveSceneId(state)).toBe(copy.id)
    expect(selectSelectedNodeIds(state)).toEqual([])
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBeforeDuplicate + 1)

    const copiedText = copy.nodes.find((node) => node.type === 'text')
    expect(copiedText).toBeDefined()
    store.updateNode(copiedText!.id, { text: '副本独立修改' })
    expect(
      selectSlideSceneList(useEditorStore.getState())[0]!.nodes.find(
        (node) => node.type === 'text',
      ),
    ).toMatchObject({ text: '双击编辑文字' })
  })

  it('rewrites a duplicated scene self-entry while preserving its valid state target', async () => {
    const store = useEditorStore.getState()
    const sourceSceneId = activeScene().id
    store.addPresentationState('完成')
    const targetStateId = selectActivePresentationStateId(useEditorStore.getState())!
    store.addInteractionRule(sourceSceneId, {
      id: 'reenter-complete',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'reenter-complete-step',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'scene.go',
          sceneId: sourceSceneId,
          targetStateId,
        },
      }],
    })

    store.duplicateScene(sourceSceneId)

    const copy = activeScene()
    const copiedComplete = copy.presentation?.states.find((state) => state.name === '完成')
    expect(copiedComplete?.id).toBeDefined()
    expect(copy.interactions[0]!.actions[0]).toEqual({
      id: expect.stringMatching(/^action[-_]/),
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'scene.go',
        sceneId: copy.id,
        targetStateId: copiedComplete!.id,
      },
    })
    expect(copy.presentation?.states.some((state) => state.id === copiedComplete!.id))
      .toBe(true)
  })
})

describe('interaction rule authoring order', () => {
  it('duplicates with fresh ids, reorders within rule kind, and undoes both', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const sceneId = activeScene().id
    const nodeId = activeScene().nodes[0]!.id
    const makeRule = (
      id: string,
      trigger: { type: 'scene.enter' } | { type: 'node.click'; nodeId: string },
    ) => ({
      id,
      name: id,
      enabled: true,
      trigger,
      conditions: [],
      actions: [{
        id: `${id}-action`,
        start: 'after-previous' as const,
        delayMs: 0,
        action: { type: 'scene.next' as const },
      }],
    })
    store.addInteractionRule(sceneId, makeRule('first', { type: 'scene.enter' }))
    store.addInteractionRule(sceneId, makeRule('click', {
      type: 'node.click',
      nodeId,
    }))
    store.addInteractionRule(sceneId, makeRule('second', { type: 'scene.enter' }))

    const copyId = store.duplicateInteractionRule(sceneId, 'first')!
    let rules = activeScene().interactions
    expect(rules.map((rule) => rule.id)).toEqual([
      'first',
      copyId,
      'click',
      'second',
    ])
    expect(rules[1]!.actions[0]!.id).not.toBe('first-action')

    store.moveInteractionRule(sceneId, 'second', -1)
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'first',
      'second',
      copyId,
      'click',
    ])
    await undoCourse()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'first',
      copyId,
      'click',
      'second',
    ])
    await undoCourse()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'first',
      'click',
      'second',
    ])
  })
})

describe('animation completion dependency cleanup', () => {
  it('cascades through second-order completion rules when the source rule is deleted', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const sceneId = activeScene().id
    const nodeId = activeScene().nodes[0]!.id
    store.addInteractionRule(sceneId, {
      id: 'motion-source',
      name: '显示标题',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'motion-source-action',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId,
          effect: 'fade',
          durationMs: 320,
          easing: 'ease-out',
        },
      }],
    })
    store.addInteractionRule(sceneId, {
      id: 'first-dependent',
      name: '入场完成后退出',
      enabled: true,
      trigger: {
        type: 'animation.completed',
        actionId: 'motion-source-action',
      },
      conditions: [],
      actions: [{
        id: 'first-dependent-action',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.exit',
          nodeId,
          effect: 'fade',
          durationMs: 240,
          easing: 'ease-in',
        },
      }],
    })
    store.addInteractionRule(sceneId, {
      id: 'second-dependent',
      name: '退场完成后翻页',
      enabled: true,
      trigger: {
        type: 'animation.completed',
        actionId: 'first-dependent-action',
      },
      conditions: [],
      actions: [{
        id: 'second-dependent-action',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    })
    store.addInteractionRule(sceneId, {
      id: 'unrelated',
      name: '无关规则',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'unrelated-action',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'audio.toggle-mute', target: { kind: 'all' } },
      }],
    })

    store.deleteInteractionRule(sceneId, 'motion-source')

    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'unrelated',
    ])
    await undoCourse()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'motion-source',
      'first-dependent',
      'second-dependent',
      'unrelated',
    ])
  })
})

describe('node operations', () => {
  it('adds text, rectangle, and image nodes with their required defaults', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(100, 120)
    store.addRectangleNode(220, 240)
    store.addImageNode(imageMeta, new Uint8Array([1, 2, 3, 4]), 30, 40)

    const nodes = activeScene().nodes
    expect(nodes.map((node) => node.type)).toEqual(['text', 'shape', 'image'])
    expect(nodes[0]).toMatchObject({ x: 100, y: 120, text: '双击编辑文字' })
    expect(nodes[1]).toMatchObject({
      type: 'shape',
      shapeType: 'rectangle',
      x: 220,
      y: 240,
    })
    expect(nodes[2]).toMatchObject({
      x: 30,
      y: 40,
      width: 640,
      height: 360,
      assetId: imageMeta.id,
      preserveAspectRatio: true,
    })
    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(nodes[2]!.id)
  })

  it('keeps newly dropped nodes at least 20px inside the visible canvas edge', async () => {
    const store = useEditorStore.getState()
    store.addRectangleNode(1279, 719)
    store.addTextNode(-900, -900)

    const [rectangle, text] = activeScene().nodes
    expect(rectangle).toMatchObject({ x: 1260, y: 700 })
    expect(text).toMatchObject({
      x: -380,
      y: -60,
      width: 400,
      height: 80,
    })
  })

  it('keeps a high defensive node limit without the former 100-node product cap', async () => {
    const store = useEditorStore.getState()
    const document = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState())!)
    const surface = document.surfaces.find((item) => item.type === 'slide')
    if (!surface || surface.type !== 'slide') throw new Error('missing slide surface')
    const scene = surface.scenes[0]!
    const occupiedOrders = [
      ...document.globalLayerItems.map((entry) => entry.item.order),
      ...surface.surfaceLayerItems.map((entry) => entry.item.order),
    ]
    const startOrder = Math.max(-1, ...occupiedOrders) + 1
    scene.layerItems = Array.from({ length: MAX_SCENE_NODES }, (_, index) => (
      sceneNodeToCourseLayerItem(createTextNode(), startOrder + index)
    ))
    await courseStoreHost().open(document)
    store.addRectangleNode()

    expect(activeScene().nodes).toHaveLength(MAX_SCENE_NODES)
    expect(useEditorStore.getState().errorMessage).toContain(`${MAX_SCENE_NODES} 个节点上限`)
  })

  it('deletes a selected node and undo restores it', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.deleteNode(nodeId)
    expect(activeScene().nodes).toHaveLength(0)
    expect(selectSelectedNodeId(useEditorStore.getState())).toBeNull()

    await undoCourse()
    expect(activeScene().nodes).toHaveLength(1)
    expect(activeScene().nodes[0]!.id).toBe(nodeId)
  })

  it('commits a completed drag/resize as exactly one history step', async () => {
    const store = useEditorStore.getState()
    store.addRectangleNode()
    const nodeId = activeScene().nodes[0]!.id
    await settleCourse()
    const historyBeforeCommit = activeHistory().past.length

    // Phaser pointermove is view-only; pointerup supplies one final Store patch.
    store.updateNode(nodeId, {
      x: 123.5,
      y: 234.5,
      width: 456,
      height: 222,
    })

    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeCommit + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({
      x: 123.5,
      y: 234.5,
      width: 456,
      height: 222,
    })
  })

  it('keeps a live text draft in the project and commits it as exactly one history step', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    await settleCourse()
    const historyBeforeCommit = activeHistory().past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '中', [], 80)
    store.updateTextEditDraft(nodeId, '中文文本', [], 80)
    store.updateTextEditDraft(nodeId, '中文文本\n第二行', [], 120)

    expect(activeScene().nodes[0]).toMatchObject({
      text: '中文文本\n第二行',
      height: 120,
    })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeCommit,
    )

    store.commitTextEdit()

    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeCommit + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({
      text: '中文文本\n第二行',
      height: 120,
    })

    await undoCourse()
    expect(activeScene().nodes[0]).toMatchObject({ text: '双击编辑文字' })
    await redoCourse()
    expect(activeScene().nodes[0]).toMatchObject({ text: '中文文本\n第二行' })
  })

  it('commits a canvas text draft before switching to properties so undo restores the draft', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    await settleCourse()
    const historyBefore = activeHistory().past.length

    store.beginTextEdit(nodeId, 'canvas')
    expect(selectSlideWorkspaceSource(useEditorStore.getState())[7]).toBe(nodeId)
    store.updateTextEditDraft(nodeId, '画布编辑中的草稿', [], 80)
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('canvas')

    store.beginTextEdit(nodeId, 'canvas')
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('canvas')
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })

    store.beginTextEdit(nodeId, 'properties')
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('properties')
    expect(useEditorStore.getState().editingTextNodeId).toBeNull()
    expect(selectSlideWorkspaceSource(useEditorStore.getState())[7]).toBeNull()
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })

    store.updateTextEditDraft(nodeId, '属性栏最终文字', [], 80)
    store.commitTextEdit()
    expect(activeScene().nodes[0]).toMatchObject({ text: '属性栏最终文字' })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore + 2)

    await undoCourse()
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })
  })

  it('keeps auto-width changes inside the same vertical text transaction', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.updateNode(nodeId, {
      style: { writingMode: 'vertical-lr', overflow: 'auto-height' },
    })
    const originalWidth = activeScene().nodes[0]!.width
    await settleCourse()
    const historyBeforeCommit = activeHistory().past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '竖排内容', [], 180, 96)
    store.updateTextEditDraft(nodeId, '竖排内容增加', [], 180, 128)

    expect(activeScene().nodes[0]).toMatchObject({
      text: '竖排内容增加',
      width: 128,
      height: 180,
    })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeCommit,
    )

    store.commitTextEdit()
    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeCommit + 1,
    )
    await undoCourse()
    expect(activeScene().nodes[0]).toMatchObject({
      text: '双击编辑文字',
      width: originalWidth,
    })
  })

  it('cancels a text transaction without adding history or leaving the project dirty', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    await acknowledgeCurrentSave('lesson.h5lesson')
    await settleCourse()
    const historyBefore = activeHistory().past.length

    store.beginTextEdit(nodeId, 'properties')
    store.updateTextEditDraft(nodeId, '应被取消', [], 96)
    expect(activeScene().nodes[0]).toMatchObject({ text: '应被取消' })
    store.cancelTextEdit()

    expect(activeScene().nodes[0]).toMatchObject({
      text: '双击编辑文字',
      height: 80,
    })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('deterministically commits text before switching nodes or scenes', async () => {
    const store = useEditorStore.getState()
    const firstSceneId = selectActiveSceneId(store)
    store.addTextNode()
    const textId = activeScene().nodes[0]!.id
    store.addRectangleNode()
    const rectangleId = activeScene().nodes[1]!.id
    await settleCourse()
    const historyBeforeNodeSwitch = activeHistory().past.length

    store.selectNode(textId)
    store.beginTextEdit(textId, 'canvas')
    store.updateTextEditDraft(textId, '切换后仍保留', [], 80)
    store.selectNode(rectangleId)

    await settleCourse()
    expect(activeHistory().past).toHaveLength(
      historyBeforeNodeSwitch + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({ text: '切换后仍保留' })

    store.addScene()
    const secondSceneId = selectActiveSceneId(useEditorStore.getState())
    store.setActiveScene(firstSceneId)
    store.selectNode(textId)
    store.beginTextEdit(textId, 'properties')
    store.updateTextEditDraft(textId, '切场景前提交', [], 80)
    store.setActiveScene(secondSceneId)

    expect(
      selectSlideSceneList(useEditorStore.getState())[0]!.nodes[0],
    ).toMatchObject({ text: '切场景前提交' })
  })

  it('commits the current text draft before save acknowledgement', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    await acknowledgeCurrentSave('before-draft.h5lesson')
    await settleCourse()
    const historyBefore = activeHistory().past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '保存时的当前文字', [], 80)
    expect(selectHasUnsavedCourseChanges(useEditorStore.getState())).toBe(true)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore)

    const preparation = store.prepareCourseProjectPersistence()
    expect(preparation.ok).toBe(true)
    if (!preparation.ok) throw new Error(preparation.reason)

    expect(activeScene().nodes[0]).toMatchObject({ text: '保存时的当前文字' })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().v9ContentEdit).toBeNull()
    expect(useEditorStore.getState().dirty).toBe(true)

    const secondPreparation = store.prepareCourseProjectPersistence()
    expect(secondPreparation.ok).toBe(true)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore + 1)

    // 2.0 由主进程持有保存状态：renderer 只有在草稿已提交且主进程真的落盘后才能确认保存。
    const documentId = useEditorStore.getState().courseDocument.documentId
    if (!documentId) throw new Error('expected active Surface session')
    await courseStoreHost().api.save(documentId, 'saved-draft.h5lesson')
    await settleCourse()
    expect(
      store.acknowledgeCourseProjectSaved('saved-draft.h5lesson', preparation.token),
    ).toBe(true)
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('reorders nodes using scene.nodes as the only layer order', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const [text, rectangle] = activeScene().nodes
    store.reorderNodes([rectangle!.id, text!.id])

    expect(activeScene().nodes.map((node) => node.id)).toEqual([
      rectangle!.id,
      text!.id,
    ])
    await undoCourse()
    expect(activeScene().nodes.map((node) => node.id)).toEqual([
      text!.id,
      rectangle!.id,
    ])
  })

  it('rolls back and restores a new image node, metadata, and bytes atomically', async () => {
    const store = useEditorStore.getState()
    store.addImageNode(imageMeta, new Uint8Array([1, 2, 3, 4]))
    await undoCourse()

    expect(activeScene().nodes).toHaveLength(0)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()

    await redoCourse()
    expect(activeScene().nodes).toHaveLength(1)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([1, 2, 3, 4])
  })

  it('undoes a reused asset node without deleting pre-existing bytes', async () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    store.addImageNode(imageMeta, bytes)
    await undoCourse()

    expect(activeScene().nodes).toHaveLength(0)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
  })

  it('deletes an unused asset through history and restores its bytes on undo', async () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    const deleted = store.deleteAsset(imageMeta.id)
    expect(deleted, useEditorStore.getState().errorMessage ?? undefined).toBe(true)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()

    await undoCourse()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
    await redoCourse()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()
  })

  it('undoes and redoes an asset imported only into the media library', async () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    expect(selectSlideSceneList(store)[0]!.nodes).toHaveLength(0)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toEqual(imageMeta)

    await undoCourse()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()
    await redoCourse()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
  })

  it('keeps component import and later node placement as separate undo steps', async () => {
    const store = useEditorStore.getState()
    const component = sampleComponent()
    store.importComponentPackage(component)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(1)

    store.addExternalComponentNode(component.manifest.id, 350, 210)
    const node = activeScene().nodes[0]
    expect(node).toMatchObject({
      type: 'external-component',
      x: 350,
      y: 210,
      width: 480,
      height: 280,
      component: {
        packageId: 'com.example.counter',
        version: '4.0.0',
      },
      props: { initialValue: 3 },
    })

    await undoCourse()
    expect(activeScene().nodes).toHaveLength(0)
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.componentPackages['com.example.counter'],
    ).toBeDefined()
    expect(
      useEditorStore.getState().componentPackages['com.example.counter'],
    ).toBeDefined()

    await undoCourse()
    expect(
      selectActiveCourseProjectDocument(useEditorStore.getState())!.componentPackages['com.example.counter'],
    ).toBeUndefined()
    expect(
      useEditorStore.getState().componentPackages['com.example.counter'],
    ).toBeUndefined()
  })

  it('rejects a second version of the same component ID without corrupting references', async () => {
    const store = useEditorStore.getState()
    const first = sampleComponent()
    store.importComponentPackage(first)
    store.addExternalComponentNode(first.manifest.id)

    const second = sampleComponent()
    second.manifest.version = '2.0.0'
    expect(() => store.importComponentPackage(second)).toThrow(
      '不能再加入同 ID',
    )

    const state = useEditorStore.getState()
    expect(state.componentPackages[first.manifest.id]?.manifest.version).toBe(
      '4.0.0',
    )
    expect(activeScene().nodes[0]).toMatchObject({
      component: { packageId: first.manifest.id, version: '4.0.0' },
    })
  })
})

describe('scene presentation states', () => {
  it('keeps a composing Slide draft in edit mode until IME composition finishes', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(80, 90)
    const nodeId = activeScene().nodes[0]!.id
    const original = locateCourseLayer(
      selectActiveCourseProjectDocument(useEditorStore.getState())!,
      nodeId,
    )?.item
    if (!original || original.kind !== 'native' || original.content.nativeType !== 'text') {
      throw new Error('expected text layer')
    }

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '输入法草稿', [])
    store.setSlideTextEditComposing(true)
    store.setCanvasMode('run')

    const blocked = useEditorStore.getState()
    expect(blocked.canvasMode).toBe('edit')
    expect(blocked.v9ContentEdit).toMatchObject({
      composing: true,
      draft: { text: '输入法草稿' },
    })
    expect((original.content.data as { text: string }).text).toBe('双击编辑文字')

    blocked.setSlideTextEditComposing(false)
    useEditorStore.getState().setCanvasMode('run')

    const committed = useEditorStore.getState()
    expect(committed.canvasMode).toBe('run')
    expect(committed.v9ContentEdit).toBeNull()
    const item = locateCourseLayer(selectActiveCourseProjectDocument(committed)!, nodeId)?.item
    expect(item?.kind === 'native' && item.content.nativeType === 'text'
      ? (item.content.data as { text: string }).text
      : null).toBe('输入法草稿')
  })

  it('normalizes legacy scenes, enters the authored initial state when run mode starts and returns to the master after it', async () => {
    const presentation = activeScene().presentation
    expect(presentation).toBeDefined()
    const initialId = presentation!.initialStateId
    expect(presentation?.states.length).toBeGreaterThanOrEqual(1)
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBeNull()

    useEditorStore.getState().setCanvasMode('run')
    expect(useEditorStore.getState().canvasMode).toBe('run')
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBe(initialId)
    // Leaving the try-run returns to the state edited before it (M19).
    useEditorStore.getState().setCanvasMode('edit')
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBeNull()
    useEditorStore.getState().setActivePresentationState(initialId)
    useEditorStore.getState().setActivePresentationState(null)
    expect(useEditorStore.getState().canvasMode).toBe('edit')
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBeNull()
  })

  it('stores state edits as overrides while keeping the canonical base editable', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(80, 90)
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('答错')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    await settleCourse()
    const historyBeforeEdit = activeHistory().past.length

    useEditorStore.getState().updateNode(nodeId, {
      x: 420,
      text: '请再试一次',
      style: { color: '#ef4444' },
    })

    const scene = activeScene()
    expect(scene.nodes[0]).toMatchObject({
      x: 80,
      text: '双击编辑文字',
      style: { color: '#1f2937' },
    })
    expect(selectEffectiveSlideSceneNodes(stateId)[0]).toMatchObject({
      x: 420,
      text: '请再试一次',
      style: { color: '#ef4444' },
    })
    expect(scene.presentation?.states.find((state) => state.id === stateId)
      ?.nodeOverrides[nodeId]).toMatchObject({
      x: 420,
      text: '请再试一次',
      style: { color: '#ef4444' },
    })
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBeforeEdit + 1)

    await undoCourse()
    expect(selectEffectiveSlideSceneNodes(stateId)[0]).toMatchObject({
      x: 80,
      text: '双击编辑文字',
    })
  })

  it('never lets base or state property patches rewrite stable node identity', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id

    store.updateNode(nodeId, { id: 'replacement', type: 'image' } as never)
    expect(activeScene().nodes[0]).toMatchObject({ id: nodeId, type: 'text' })

    store.addPresentationState('状态')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().updateNode(nodeId, {
      id: 'state-replacement',
      type: 'shape',
      x: 404,
    } as never)
    expect(selectEffectiveSlideSceneNodes(stateId)[0]).toMatchObject({
      id: nodeId,
      type: 'text',
      x: 404,
    })
  })

  it('deletes state-owned nodes structurally and hides inherited nodes in a named state', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(40, 60)
    const inheritedId = activeScene().nodes[0]!.id
    store.addPresentationState('反馈')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().addRectangleNode(120, 140)
    const sceneAfterAdd = activeScene()
    const stateOwnedId = sceneAfterAdd.nodes.find((node) => node.id !== inheritedId)!.id

    expect(sceneAfterAdd.nodes.find((node) => node.id === stateOwnedId)).toMatchObject({ visible: false })
    expect(selectEffectiveSlideSceneNodes(stateId).find((node) => node.id === stateOwnedId))
      .toMatchObject({
      visible: true,
      x: 120,
      y: 140,
    })

    useEditorStore.getState().deleteNode(stateOwnedId)
    expect(activeScene().nodes).toHaveLength(1)
    expect(activeScene().nodes[0]!.id).toBe(inheritedId)
    expect(activeScene().presentation?.states.every(
      (state) => !(stateOwnedId in state.nodeOverrides),
    )).toBe(true)

    useEditorStore.getState().deleteNode(inheritedId)
    expect(activeScene().nodes).toHaveLength(1)
    expect(selectEffectiveSlideSceneNodes(stateId).find((node) => node.id === inheritedId))
      .toMatchObject({
      visible: false,
    })

    useEditorStore.getState().setActivePresentationState(null)
    useEditorStore.getState().deleteNode(inheritedId)
    expect(activeScene().nodes).toHaveLength(0)
    expect(Object.values(activeScene().presentation?.states[1]?.nodeOverrides ?? {}))
      .toHaveLength(0)
  })

  it('keeps a named-state locked row and all edit state unchanged on delete', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('锁定')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().updateNode(nodeId, { locked: true })
    useEditorStore.getState().selectNode(nodeId)
    await settleCourse()
    const beforeDocument = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState()))
    const beforeHistory = activeHistory().past
    const beforeSelection = [...selectSelectedNodeIds(useEditorStore.getState())]
    const beforeState = captureWriteState()

    useEditorStore.getState().deleteNode(nodeId)

    expect(selectSlideAuthoringDocument(useEditorStore.getState())).toEqual(beforeDocument)
    await settleCourse()
    expectNoWriteSince(beforeState)
    expect(activeHistory().past).toBe(beforeHistory)
    expect([...selectSelectedNodeIds(useEditorStore.getState())]).toEqual(beforeSelection)
    expect(selectEffectiveSlideSceneNodes(stateId).find((node) => node.id === nodeId))
      .toMatchObject({ locked: true })
    expect(useEditorStore.getState().errorMessage).toBe('locked')
  })

  it('rejects a selection snapshot captured in another named state without writing', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('状态 A')
    const stateA = selectActivePresentationStateId(useEditorStore.getState())!
    store.addPresentationState('状态 B')
    const stateB = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().setActivePresentationState(stateA)
    useEditorStore.getState().selectNode(nodeId)
    const stale = useEditorStore.getState().createLiveEditorSelectionSnapshot('layer')
    if (!stale) throw new Error('expected named-state selection snapshot')
    expect(stale.stateId).toBe(stateA)
    useEditorStore.getState().setActivePresentationState(stateB)
    useEditorStore.getState().selectNode(nodeId)
    await settleCourse()
    const beforeDocument = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState()))
    const beforeHistory = activeHistory().past
    const beforeSelection = [...selectSelectedNodeIds(useEditorStore.getState())]
    const beforeState = captureWriteState()

    const result = useEditorStore.getState().routeEditorAction('delete', stale)

    expect(result).toMatchObject({ ok: false, adapter: 'none' })
    expect(selectSlideAuthoringDocument(useEditorStore.getState())).toEqual(beforeDocument)
    await settleCourse()
    expectNoWriteSince(beforeState)
    expect(activeHistory().past).toBe(beforeHistory)
    expect([...selectSelectedNodeIds(useEditorStore.getState())]).toEqual(beforeSelection)
    expect(activeScene().nodes.some((node) => node.id === nodeId)).toBe(true)
  })

  it('commits text editing in a state as one undoable override transaction', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('完成')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    await settleCourse()
    const historyBefore = activeHistory().past.length

    useEditorStore.getState().beginTextEdit(nodeId, 'properties')
    useEditorStore.getState().updateTextEditDraft(nodeId, '状态文字', [], 96)
    expect(selectEditingNodes(useEditorStore.getState())[0]).toMatchObject({
      text: '状态文字',
      height: 96,
    })
    expect(activeScene().nodes[0]).toMatchObject({ text: '双击编辑文字', height: 80 })
    useEditorStore.getState().commitTextEdit()

    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBefore + 1)
    expect(selectEffectiveSlideSceneNodes(stateId)[0]).toMatchObject({
      text: '状态文字',
      height: 96,
    })
    await undoCourse()
    expect(selectEffectiveSlideSceneNodes(stateId)[0]).toMatchObject({
      text: '双击编辑文字',
      height: 80,
    })
  })

  it('rewrites override node ids when duplicating a scene', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const sourceSceneId = activeScene().id
    const [sourceNodeId, sourceBackNodeId] = activeScene().nodes.map((node) => node.id)
    store.addPresentationState('正确')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().updateNode(sourceNodeId!, { x: 640, visible: false })
    useEditorStore.getState().reorderNodes([sourceBackNodeId!, sourceNodeId!])

    useEditorStore.getState().duplicateScene(sourceSceneId)
    const copy = activeScene()
    const [copyNodeId, copyBackNodeId] = copy.nodes.map((node) => node.id)
    const copiedState = copy.presentation?.states.find((state) => state.name === '正确')
    expect(copyNodeId).not.toBe(sourceNodeId)
    expect(copiedState?.nodeOverrides[copyNodeId!]).toMatchObject({
      x: 640,
      visible: false,
    })
    expect(copiedState?.nodeOverrides[sourceNodeId!]).toBeUndefined()
    expect(copiedState?.nodeOrder).toEqual([copyBackNodeId, copyNodeId])
  })

  it('keeps state ordering local, undoable, and cleans it when a base node is deleted', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    store.addShapeNode('ellipse')
    const baseOrder = activeScene().nodes.map((node) => node.id)
    store.addPresentationState('分层')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    const stateOrder = [baseOrder[2]!, baseOrder[0]!, baseOrder[1]!]

    useEditorStore.getState().updateNode(baseOrder[0]!, { x: 777 })
    useEditorStore.getState().reorderNodes(stateOrder)
    expect(activeScene().nodes.map((node) => node.id)).toEqual(baseOrder)
    expect(selectEffectiveSlideSceneNodes(stateId).map((node) => node.id))
      .toEqual(stateOrder)

    await undoCourse()
    expect(selectEffectiveSlideSceneNodes(stateId).map((node) => node.id))
      .toEqual(baseOrder)
    await redoCourse()
    expect(selectEffectiveSlideSceneNodes(stateId).map((node) => node.id))
      .toEqual(stateOrder)

    useEditorStore.getState().reorderNodes(baseOrder)
    expect(activeScene().presentation?.states.find((state) => state.id === stateId)
      ?.nodeOrder).toBeUndefined()
    useEditorStore.getState().reorderNodes(stateOrder)

    useEditorStore.getState().setActivePresentationState(null)
    useEditorStore.getState().deleteNode(baseOrder[0]!)
    const presentationState = activeScene().presentation?.states.find(
      (state) => state.id === stateId,
    )
    expect(presentationState?.nodeOverrides[baseOrder[0]!]).toBeUndefined()
    expect(presentationState?.nodeOrder).toEqual([baseOrder[2], baseOrder[1]])
    await undoCourse()
    expect(activeScene().nodes.map((node) => node.id)).toEqual(baseOrder)
    expect(activeScene().presentation?.states.find((state) => state.id === stateId))
      .toMatchObject({
        nodeOverrides: { [baseOrder[0]!]: { x: 777 } },
        nodeOrder: stateOrder,
      })
  })

  it('falls back to the runtime initial state when the active thumbnail state is deleted', async () => {
    const store = useEditorStore.getState()
    store.addPresentationState('运行初始')
    const initialId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().addPresentationState('缩略图')
    const thumbnailId = selectActivePresentationStateId(useEditorStore.getState())!
    useEditorStore.getState().setInitialPresentationState(initialId)
    useEditorStore.getState().setThumbnailPresentationState(thumbnailId)

    expect(useEditorStore.getState().deletePresentationState(thumbnailId)).toBe(true)
    expect(selectActivePresentationStateId(useEditorStore.getState())).toBe(initialId)
    expect(activeScene().presentation).toMatchObject({
      initialStateId: initialId,
      thumbnailStateId: initialId,
    })

    await undoCourse()
    expect(activeScene().presentation?.states.some((state) => state.id === thumbnailId))
      .toBe(true)
    await redoCourse()
    expect(activeScene().presentation?.states.some((state) => state.id === thumbnailId))
      .toBe(false)
  })

  it('falls cross-scene entry rules back to the target initial state when a state is deleted', async () => {
    const store = useEditorStore.getState()
    const sourceSceneId = activeScene().id
    store.addScene()
    const targetSceneId = activeScene().id
    store.addPresentationState('详情')
    const targetStateId = selectActivePresentationStateId(useEditorStore.getState())!
    store.setActiveScene(sourceSceneId)
    store.addInteractionRule(sourceSceneId, {
      id: 'go-to-detail',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'go-to-detail-step',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'scene.go',
          sceneId: targetSceneId,
          targetStateId,
        },
      }],
    })

    store.setActiveScene(targetSceneId)
    expect(store.deletePresentationState(targetStateId)).toBe(true)
    const sourceRule = selectSlideSceneList(useEditorStore.getState()).find(
      (scene) => scene.id === sourceSceneId,
    )!.interactions[0]!
    expect(sourceRule.actions[0]).toEqual({
      id: 'go-to-detail-step',
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'scene.go',
        sceneId: targetSceneId,
      },
    })

    await undoCourse()
    const restoredRule = selectSlideSceneList(useEditorStore.getState()).find(
      (scene) => scene.id === sourceSceneId,
    )!.interactions[0]!
    expect(restoredRule.actions[0]!.action).toMatchObject({ targetStateId })
  })
})

describe('multi-selection operations', () => {
  it('duplicates each selected node with its own click mappings exactly once', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const sceneId = activeScene().id
    const sourceIds = activeScene().nodes.map((node) => node.id)
    sourceIds.forEach((nodeId, index) => store.addInteractionRule(sceneId, {
      id: `click-rule-${index}`,
      name: `映射 ${index + 1}`,
      enabled: true,
      trigger: { type: 'node.click', nodeId },
      conditions: [],
      actions: [{
        id: `click-rule-step-${index}`,
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    }))
    store.addInteractionRule(sceneId, {
      id: 'scene-enter-rule',
      name: '场景自动化',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [],
      actions: [{
        id: 'scene-enter-step',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'audio.toggle-mute', target: { kind: 'all' } },
      }],
    })
    store.selectNodes(sourceIds)

    store.duplicateSelectedNodes()

    const copiedIds = selectSelectedNodeIds(useEditorStore.getState())
    const clickRules = activeScene().interactions.filter(
      (rule) => rule.trigger.type === 'node.click',
    )
    expect(copiedIds).toHaveLength(2)
    expect(clickRules).toHaveLength(4)
    copiedIds.forEach((nodeId, index) => {
      expect(clickRules).toContainEqual(expect.objectContaining({
        id: expect.stringMatching(/^rule[-_]/),
        name: `映射 ${index + 1}`,
        trigger: { type: 'node.click', nodeId },
      }))
    })
    expect(activeScene().interactions.filter(
      (rule) => rule.trigger.type === 'scene.enter',
    )).toHaveLength(1)

    await undoCourse()
    expect(activeScene().nodes.map((node) => node.id)).toEqual(sourceIds)
    expect(activeScene().interactions.filter(
      (rule) => rule.trigger.type === 'node.click',
    )).toHaveLength(2)
  })

  it('supports additive toggling and filters invalid or duplicate selection IDs', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    store.addShapeNode('ellipse')
    const [text, rectangle, ellipse] = activeScene().nodes

    store.selectNode(text!.id)
    store.selectNode(rectangle!.id, true)
    expect(selectSelectedNodeIds(useEditorStore.getState())).toEqual([
      text!.id,
      rectangle!.id,
    ])
    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(rectangle!.id)

    store.selectNode(text!.id, true)
    expect(selectSelectedNodeIds(useEditorStore.getState())).toEqual([rectangle!.id])
    store.selectNodes([text!.id, 'missing-node', ellipse!.id, text!.id])
    expect(selectSelectedNodeIds(useEditorStore.getState())).toEqual([
      text!.id,
      ellipse!.id,
    ])
    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(ellipse!.id)
    expect(useEditorStore.getState().courseAuthoringSession?.itemIds).toEqual([text!.id, ellipse!.id])
    store.selectNodes([])
    expect(useEditorStore.getState().courseAuthoringSession?.itemIds).toEqual([])
  })

  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)(
    'aligns the selected nodes to %s in one history step',
    async (mode) => {
      const store = useEditorStore.getState()
      store.addRectangleNode()
      store.addRectangleNode()
      store.addRectangleNode()
      const ids = activeScene().nodes.map((node) => node.id)
      store.updateNodes([
        { nodeId: ids[0]!, patch: { x: 40, y: 50, width: 100, height: 80 } },
        { nodeId: ids[1]!, patch: { x: 320, y: 190, width: 160, height: 120 } },
        { nodeId: ids[2]!, patch: { x: 760, y: 430, width: 200, height: 160 } },
      ])
      store.selectNodes(ids)
      await settleCourse()
      const historyBefore = activeHistory().past.length

      store.alignSelection(mode)

      const nodes = activeScene().nodes
      const alignedValues = nodes.map((node) => {
        if (mode === 'left') return node.x
        if (mode === 'center') return node.x + node.width / 2
        if (mode === 'right') return node.x + node.width
        if (mode === 'top') return node.y
        if (mode === 'middle') return node.y + node.height / 2
        return node.y + node.height
      })
      for (const value of alignedValues.slice(1)) {
        expect(value).toBeCloseTo(alignedValues[0]!)
      }
      await settleCourse()
      expect(activeHistory().past).toHaveLength(historyBefore + 1)
    },
  )

  it.each(['horizontal', 'vertical'] as const)(
    'distributes three selected nodes with equal %s gaps',
    async (axis) => {
      const store = useEditorStore.getState()
      store.addRectangleNode()
      store.addRectangleNode()
      store.addRectangleNode()
      const ids = activeScene().nodes.map((node) => node.id)
      store.updateNodes([
        { nodeId: ids[0]!, patch: { x: 20, y: 30, width: 100, height: 60 } },
        { nodeId: ids[1]!, patch: { x: 340, y: 260, width: 140, height: 100 } },
        { nodeId: ids[2]!, patch: { x: 940, y: 570, width: 200, height: 120 } },
      ])
      store.selectNodes(ids)
      const before = activeScene().nodes.map((node) => ({
        x: node.x,
        y: node.y,
      }))

      store.distributeSelection(axis)

      const [first, middle, last] = activeScene().nodes
      const firstGap = axis === 'horizontal'
        ? middle!.x - (first!.x + first!.width)
        : middle!.y - (first!.y + first!.height)
      const secondGap = axis === 'horizontal'
        ? last!.x - (middle!.x + middle!.width)
        : last!.y - (middle!.y + middle!.height)
      expect(firstGap).toBeCloseTo(secondGap)
      expect(axis === 'horizontal' ? first!.x : first!.y).toBe(
        axis === 'horizontal' ? before[0]!.x : before[0]!.y,
      )
      expect(axis === 'horizontal' ? last!.x : last!.y).toBe(
        axis === 'horizontal' ? before[2]!.x : before[2]!.y,
      )
    },
  )

  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)(
    'aligns 45-degree nodes by their visual %s boundary using translation only',
    async (mode) => {
      const store = useEditorStore.getState()
      store.addRectangleNode()
      store.addRectangleNode()
      store.addRectangleNode()
      const ids = activeScene().nodes.map((node) => node.id)
      store.updateNodes([
        { nodeId: ids[0]!, patch: { x: 80, y: 70, width: 100, height: 60, rotation: 45 } },
        { nodeId: ids[1]!, patch: { x: 360, y: 240, width: 180, height: 90, rotation: 45 } },
        { nodeId: ids[2]!, patch: { x: 780, y: 420, width: 120, height: 200, rotation: 45 } },
      ])
      const before = activeScene().nodes.map((node) => ({ ...node }))
      const beforeBounds = before.map(visualBounds)
      const expected = mode === 'left'
        ? Math.min(...beforeBounds.map((bounds) => bounds.left))
        : mode === 'center'
          ? (
              Math.min(...beforeBounds.map((bounds) => bounds.left)) +
              Math.max(...beforeBounds.map((bounds) => bounds.right))
            ) / 2
          : mode === 'right'
            ? Math.max(...beforeBounds.map((bounds) => bounds.right))
            : mode === 'top'
              ? Math.min(...beforeBounds.map((bounds) => bounds.top))
              : mode === 'middle'
                ? (
                    Math.min(...beforeBounds.map((bounds) => bounds.top)) +
                    Math.max(...beforeBounds.map((bounds) => bounds.bottom))
                  ) / 2
                : Math.max(...beforeBounds.map((bounds) => bounds.bottom))
      store.selectNodes(ids)

      store.alignSelection(mode)

      const after = activeScene().nodes
      const anchors = after.map((node) => {
        const bounds = visualBounds(node)
        if (mode === 'left') return bounds.left
        if (mode === 'center') return bounds.centerX
        if (mode === 'right') return bounds.right
        if (mode === 'top') return bounds.top
        if (mode === 'middle') return bounds.centerY
        return bounds.bottom
      })
      for (const anchor of anchors) expect(anchor).toBeCloseTo(expected)
      after.forEach((node, index) => {
        expect(node).toMatchObject({
          width: before[index]!.width,
          height: before[index]!.height,
          rotation: 45,
        })
        if (mode === 'left' || mode === 'center' || mode === 'right') {
          expect(node.y).toBe(before[index]!.y)
        } else {
          expect(node.x).toBe(before[index]!.x)
        }
      })
    },
  )

  it.each(['horizontal', 'vertical'] as const)(
    'distributes 45-degree nodes with equal visual %s gaps using translation only',
    async (axis) => {
      const store = useEditorStore.getState()
      store.addRectangleNode()
      store.addRectangleNode()
      store.addRectangleNode()
      const ids = activeScene().nodes.map((node) => node.id)
      store.updateNodes([
        { nodeId: ids[0]!, patch: { x: 60, y: 50, width: 100, height: 60, rotation: 45 } },
        { nodeId: ids[1]!, patch: { x: 380, y: 250, width: 180, height: 80, rotation: 45 } },
        { nodeId: ids[2]!, patch: { x: 900, y: 540, width: 120, height: 140, rotation: 45 } },
      ])
      store.selectNodes(ids)
      const before = activeScene().nodes.map((node) => ({ ...node }))
      const beforeSorted = [...before].sort((left, right) => {
        const leftBounds = visualBounds(left)
        const rightBounds = visualBounds(right)
        return axis === 'horizontal'
          ? leftBounds.left - rightBounds.left
          : leftBounds.top - rightBounds.top
      })

      store.distributeSelection(axis)

      const byId = new Map(activeScene().nodes.map((node) => [node.id, node]))
      const afterSorted = beforeSorted.map((node) => byId.get(node.id)!)
      const afterBounds = afterSorted.map(visualBounds)
      const gaps = afterBounds.slice(1).map((bounds, index) =>
        axis === 'horizontal'
          ? bounds.left - afterBounds[index]!.right
          : bounds.top - afterBounds[index]!.bottom,
      )
      expect(gaps[0]).toBeCloseTo(gaps[1]!)

      const firstBefore = beforeSorted[0]!
      const lastBefore = beforeSorted.at(-1)!
      const firstAfter = afterSorted[0]!
      const lastAfter = afterSorted.at(-1)!
      expect(axis === 'horizontal' ? firstAfter.x : firstAfter.y).toBeCloseTo(
        axis === 'horizontal' ? firstBefore.x : firstBefore.y,
      )
      expect(axis === 'horizontal' ? lastAfter.x : lastAfter.y).toBeCloseTo(
        axis === 'horizontal' ? lastBefore.x : lastBefore.y,
      )
      afterSorted.forEach((node) => {
        const original = before.find((item) => item.id === node.id)!
        expect(node).toMatchObject({
          width: original.width,
          height: original.height,
          rotation: 45,
        })
        if (axis === 'horizontal') expect(node.y).toBe(original.y)
        else expect(node.x).toBe(original.x)
      })
    },
  )

  it('copies a multi-selection snapshot and pastes independent unlocked nodes', async () => {
    const store = useEditorStore.getState()
    store.addTextNode(100, 120)
    store.addRectangleNode(360, 280)
    const [text, shape] = activeScene().nodes
    store.updateNode(text!.id, { locked: true })
    store.selectNodes([text!.id, shape!.id])
    await settleCourse()
    const historyBeforeCopy = activeHistory().past.length

    store.copySelectedNodes()
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBeforeCopy)
    expect(useEditorStore.getState().slideCandidateClipboard?.items).toHaveLength(2)

    store.updateNode(text!.id, { x: 600, text: '原节点已修改' })
    await settleCourse()
    const historyBeforePaste = activeHistory().past.length
    store.pasteNodes()

    const state = useEditorStore.getState()
    const pastedIds = selectSelectedNodeIds(state)
    expect(pastedIds).toHaveLength(2)
    const pasted = activeScene().nodes.filter((node) => pastedIds.includes(node.id))
    expect(pasted).toHaveLength(2)
    const pastedText = pasted.find((node) => node.type === 'text')
    const pastedShape = pasted.find((node) => node.type === 'shape')
    expect(pastedText).toMatchObject({
      type: 'text',
      name: `${text!.name} 副本`,
      x: 120,
      y: 140,
      text: '双击编辑文字',
      locked: false,
    })
    expect(pastedShape).toMatchObject({
      type: 'shape',
      name: `${shape!.name} 副本`,
      x: 380,
      y: 300,
      locked: false,
    })
    expect(new Set(activeScene().nodes.map((node) => node.id)).size).toBe(4)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(historyBeforePaste + 1)
  })
})

describe('history semantics', () => {
  it('records V9 history as capped snapshot steps instead of V8 immer patches', async () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    const store = useEditorStore.getState()
    const sceneId = selectSlideSceneList(store)[0]!.id
    const originalName = selectSlideSceneList(store)[0]!.name
    store.updateScene(sceneId, { name: '修改后的第一课' })

    await settleCourse()
    const entry = activeHistory().past[0]!
    expect('patches' in entry).toBe(false)
    expect('inversePatches' in entry).toBe(false)
    expect(selectSlideSceneList(useEditorStore.getState())[0]!.name).toBe('修改后的第一课')
    await undoCourse()
    expect(selectSlideSceneList(useEditorStore.getState())[0]!.name).toBe(originalName)
  })

  it('undoes an addition and redo restores it', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id

    await undoCourse()
    expect(activeScene().nodes).toHaveLength(0)
    await settleCourse()
    expect(activeHistory().future).toHaveLength(1)

    await redoCourse()
    expect(activeScene().nodes[0]!.id).toBe(nodeId)
    await settleCourse()
    expect(activeHistory().future).toHaveLength(0)
  })

  it('keeps each document history step and clears redo after a new commit', async () => {
    const store = useEditorStore.getState()
    const sceneId = selectSlideSceneList(store)[0]!.id
    for (let index = 0; index < 110; index += 1) {
      store.updateSceneBackground(sceneId, {
        backgroundColor: `#${index.toString(16).padStart(6, '0')}`,
      })
    }
    await settleCourse()
    expect(activeHistory().past).toHaveLength(110)

    await undoCourse()
    await undoCourse()
    await settleCourse()
    expect(activeHistory().future).toHaveLength(2)
    store.updateScene(sceneId, { name: '新提交' })
    await settleCourse()
    expect(activeHistory().future).toHaveLength(0)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(109)
  }, 60_000)

  it('new and opened projects clear history while save keeps it', async () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const documentToLoad = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState())!)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(1)

    await acknowledgeCurrentSave('C:\\course.h5lesson')
    await settleCourse()
    expect(activeHistory().past).toHaveLength(1)
    expect(useEditorStore.getState().dirty).toBe(false)

    await courseStoreHost().open(documentToLoad)
    await settleCourse()
    expect(activeHistory().past).toHaveLength(0)
    store.addRectangleNode()
    await useEditorStore.getState().createCourseDocument('slide')
    await settleCourse()
    expect(activeHistory().past).toHaveLength(0)
    // 2.0 的保存状态属于主进程：新建工程从未落盘，因此在第一次保存前就是 dirty。
    expect(useEditorStore.getState().dirty).toBe(true)
  })
})

describe('factory compatibility', () => {
  it('supports the Store positional factory forms and protects component props', async () => {
    const text = createTextNode(12, 34)
    const image = createImageNode('asset_large', 1920, 1080)
    const componentData = sampleComponent()
    const component = createExternalComponentNode(componentData.manifest)
    componentData.manifest.defaultProps.initialValue = 99

    expect(text).toMatchObject({ x: 12, y: 34, type: 'text' })
    expect(image).toMatchObject({
      width: 640,
      height: 360,
      x: 320,
      y: 180,
    })
    expect(component).toMatchObject({
      width: 480,
      height: 280,
      x: 400,
      y: 220,
      props: { initialValue: 3 },
    })
  })
})
