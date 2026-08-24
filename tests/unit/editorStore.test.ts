import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { MAX_PROJECT_SCENES, MAX_SCENE_NODES } from '@/shared/constants'
import type { AssetMeta } from '@/shared/projectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { materializeScene } from '@/shared/presentation'
import {
  createExternalComponentNode,
  createImageNode,
  createProject,
  createTextNode,
} from '@/renderer/project/createProject'
import { createProjectArchive } from '@/renderer/project/projectArchive'
import {
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import { openDefaultCourseProject } from '@/renderer/project/courseProjectIo'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { COURSE_PROJECT_SCHEMA_VERSION } from '@/shared/courseProjectTypes'
import {
  selectActiveScene,
  selectEditingNodes,
  selectMediaAssetFiles,
  selectSlideBackendKind,
  selectSlideAuthoringDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'

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

function sampleComponent(): ComponentPackageData {
  return {
    manifest: {
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
    },
    runtimeSource:
      "window.CoursewareComponent.define({id:'com.example.counter',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})",
    files: {
      'manifest.json': new Uint8Array([1]),
      'runtime.js': new Uint8Array([2]),
    },
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

beforeEach(() => {
  delete (window as Partial<Window>).desktopAPI
  useEditorStore.getState().createNewProject()
})

describe('default Course Project V9 persistence', () => {
  it('creates a schemaVersion 9 document on the V9 authoring backend', () => {
    const state = useEditorStore.getState()
    expect(selectSlideBackendKind(state)).toBe('slide-authoring')
    expect(selectSlideAuthoringDocument(state)?.schemaVersion).toBe(
      COURSE_PROJECT_SCHEMA_VERSION,
    )
    expect(state.project.schemaVersion).toBe(8)
  })

  it('saves a zip that openCourseProjectArchive can reopen', () => {
    const store = useEditorStore.getState()
    store.addTextNode(40, 50)
    const document = selectSlideAuthoringDocument(useEditorStore.getState())
    expect(document?.schemaVersion).toBe(9)
    const bytes = store.exportV9SlideCandidateArchive()
    expect(bytes).toBeInstanceOf(Uint8Array)
    const opened = openCourseProjectArchive(bytes!)
    expect(opened.project.schemaVersion).toBe(9)
    expect(opened.project.id).toBe(document!.id)
    expect(detectCourseProjectArchiveFormat(bytes!).kind).toBe('v9')
  })

  it('does not silently open a V8 zip as V9', () => {
    const v8Bytes = createProjectArchive({
      project: createProject(),
      assetFiles: {},
      componentFiles: {},
    })
    expect(detectCourseProjectArchiveFormat(v8Bytes).kind).toBe('unsupported')
    expect(() => openCourseProjectArchive(v8Bytes)).toThrow(/格式版本|版本不支持/)
    expect(() => openDefaultCourseProject(v8Bytes)).toThrow(/格式版本|版本不支持/)
  })
})

describe('Spatial command failure diagnostics', () => {
  it('keeps a structured reason out of teacher feedback and preserves failed-command state', () => {
    const reportDiagnostic = vi.fn(async (
      _input: Parameters<Window['desktopAPI']['reportDiagnostic']>[0],
    ) => undefined)
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: { reportDiagnostic },
    })
    useEditorStore.getState().createNewSpatialProject()
    const before = useEditorStore.getState()
    const sessionBefore = before.spatialSession
    if (!sessionBefore) throw new Error('expected Spatial session')
    const documentBefore = sessionBefore.history.present
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
    expect(after.errorMessage).toBe('课件内容格式不正确。请检查刚才的输入后重试。')
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
    expect(after.spatialSession).toBe(sessionBefore)
    expect(after.spatialSession?.history).toBe(sessionBefore.history)
    expect(after.spatialSession?.history.present).toBe(documentBefore)
    expect(after.spatialSession?.history.present.revision).toBe(documentBefore.revision)
    expect(after.spatialSession?.selection).toBe(sessionBefore.selection)
    expect(after.history).toBe(before.history)
    expect(after.selectedNodeIds).toBe(before.selectedNodeIds)
    expect(after.selectedNodeId).toBe(before.selectedNodeId)
    expect(after.dirty).toBe(before.dirty)
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
    useEditorStore.getState().createNewSpatialProject()
    const before = useEditorStore.getState()
    const sessionBefore = before.spatialSession
    if (!sessionBefore) throw new Error('expected Spatial session')

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
    expect(after.spatialSession).toBe(sessionBefore)
    expect(after.spatialSession?.history).toBe(sessionBefore.history)
    expect(after.spatialSession?.selection).toBe(sessionBefore.selection)
    expect(after.history).toBe(before.history)
    expect(after.selectedNodeIds).toBe(before.selectedNodeIds)
  })
})

describe('Spatial canonical property updates', () => {
  it('commits common and whole-node text properties atomically with undo and redo', () => {
    useEditorStore.getState().createNewSpatialProject()
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
    const before = useEditorStore.getState().spatialSession!

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

    const changed = useEditorStore.getState().spatialSession!
    expect(changed.history.present.revision).toBe(before.history.present.revision + 1)
    expect(changed.history.past).toHaveLength(before.history.past.length + 1)
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

    useEditorStore.getState().undo()
    const undone = useEditorStore.getState().spatialSession!
    const undoneSurface = undone.history.present.surfaces.find(
      (candidate) => candidate.id === undone.selection.surfaceId,
    )
    if (!undoneSurface || undoneSurface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    expect(undoneSurface.world.layerItems.find((item) => item.layerItemId === first.id)?.label)
      .toBe(first.name)
    expect(undoneSurface.world.layerItems.find((item) => item.layerItemId === second.id))
      .toMatchObject({ kind: 'native', content: { nativeType: 'text', data: { style: second.style } } })

    useEditorStore.getState().redo()
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

  it('keeps no-op, locked, and unsupported batches at zero document and history writes', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const [first, second] = selectEditingNodes(useEditorStore.getState()).filter(
      (node) => node.type === 'text',
    )
    if (!first || !second || first.type !== 'text' || second.type !== 'text') {
      throw new Error('expected two Spatial text nodes')
    }
    useEditorStore.getState().selectNodes([first.id, second.id])

    const beforeNoop = useEditorStore.getState().spatialSession!
    useEditorStore.getState().updateNodes([{
      nodeId: second.id,
      patch: { opacity: second.opacity, style: { bold: second.style.bold } },
    }])
    expect(useEditorStore.getState().spatialSession).toBe(beforeNoop)
    expect(useEditorStore.getState().spatialSession?.history).toBe(beforeNoop.history)

    useEditorStore.getState().updateNode(first.id, { locked: true })
    const beforeLocked = useEditorStore.getState().spatialSession!
    const secondOpacity = beforeLocked.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])
      .find((item) => item.layerItemId === second.id)?.opacity
    useEditorStore.getState().updateNodes([
      { nodeId: first.id, patch: { name: '不应部分写入' } },
      { nodeId: second.id, patch: { opacity: 0.25 } },
    ])
    const afterLocked = useEditorStore.getState()
    expect(afterLocked.spatialSession).toBe(beforeLocked)
    expect(afterLocked.spatialSession?.history).toBe(beforeLocked.history)
    expect(afterLocked.errorMessage).toBe('当前内容已锁定。请先解锁后重试。')
    expect(afterLocked.spatialSession?.history.present.surfaces
      .flatMap((surface) => surface.type === 'spatial-2d' ? surface.world.layerItems : [])
      .find((item) => item.layerItemId === second.id)?.opacity).toBe(secondOpacity)

    useEditorStore.getState().updateNode(second.id, {
      fit: 'cover',
    } as never)
    const afterUnsupported = useEditorStore.getState()
    expect(afterUnsupported.spatialSession).toBe(beforeLocked)
    expect(afterUnsupported.errorMessage).toBe(
      '当前元素不支持这项属性，未保存任何更改。',
    )
  })

  it('keeps geometry and presentation properties selection-bound', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const [selected, unselected] = selectEditingNodes(useEditorStore.getState()).filter(
      (node) => node.type === 'text',
    )
    if (!selected || !unselected) throw new Error('expected two Spatial text nodes')
    useEditorStore.getState().selectNode(selected.id)
    const before = useEditorStore.getState().spatialSession!

    useEditorStore.getState().updateNode(unselected.id, {
      name: '不得借直接行属性绕过选择',
      opacity: 0.25,
    })

    const after = useEditorStore.getState()
    expect(after.spatialSession).toBe(before)
    expect(after.spatialSession?.history).toBe(before.history)
    expect(after.errorMessage).toBe('所选内容已失效。请重新选择后再试。')
    const located = locateCourseLayer(before.history.present, unselected.id)
    expect(located?.item.label).toBe(unselected.name)
    expect(located?.item.opacity).toBe(unselected.opacity)
  })
})

describe('scene operations', () => {
  it('adds scenes, switches to the new scene, and records each addition', () => {
    const store = useEditorStore.getState()
    store.addScene()
    store.addScene()

    const state = useEditorStore.getState()
    expect(state.project.scenes.map((scene) => scene.name)).toEqual([
      '场景 1',
      '场景 2',
      '场景 3',
    ])
    expect(state.activeSceneId).toBe(state.project.scenes[2]!.id)
    expect(state.history.past).toHaveLength(2)
    expect(state.dirty).toBe(true)
  })

  it('never deletes the final scene and does not create a no-op history entry', () => {
    const initial = useEditorStore.getState()
    const onlySceneId = initial.project.scenes[0]!.id

    expect(initial.deleteScene(onlySceneId)).toBe(false)
    expect(useEditorStore.getState().project.scenes).toHaveLength(1)
    expect(useEditorStore.getState().history.past).toHaveLength(0)
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('renames, recolours, reorders, and deletes scenes with undoable commits', () => {
    const store = useEditorStore.getState()
    const firstId = store.project.scenes[0]!.id
    store.addScene()
    const secondId = useEditorStore.getState().project.scenes[1]!.id
    store.addScene()
    const thirdId = useEditorStore.getState().project.scenes[2]!.id

    store.updateScene(secondId, {
      name: '  练习场景  ',
      backgroundColor: '#f3f4f6',
    })
    expect(
      useEditorStore.getState().project.scenes.find((scene) => scene.id === secondId),
    ).toMatchObject({
      name: '练习场景',
      backgroundColor: '#f3f4f6',
    })

    store.reorderScenes([thirdId, firstId, secondId])
    expect(useEditorStore.getState().project.scenes.map((scene) => scene.id)).toEqual([
      thirdId,
      firstId,
      secondId,
    ])

    store.setActiveScene(thirdId)
    expect(store.deleteScene(thirdId)).toBe(true)
    const state = useEditorStore.getState()
    expect(state.project.scenes.map((scene) => scene.id)).toEqual([firstId, secondId])
    expect(state.activeSceneId).toBe(firstId)
  })

  it('ignores invalid reorder requests without changing history', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const historyLength = useEditorStore.getState().history.past.length
    const sceneIds = useEditorStore
      .getState()
      .project.scenes.map((scene) => scene.id)

    store.reorderScenes([sceneIds[0]!, sceneIds[0]!])
    expect(useEditorStore.getState().project.scenes.map((scene) => scene.id)).toEqual(
      sceneIds,
    )
    expect(useEditorStore.getState().history.past).toHaveLength(historyLength)
  })

  it('keeps a high defensive scene limit without the former 30-scene product cap', () => {
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
    store.loadCourseProject(document, null)
    store.addScene()

    const state = useEditorStore.getState()
    expect(state.project.scenes).toHaveLength(MAX_PROJECT_SCENES)
    expect(state.errorMessage).toContain(`${MAX_PROJECT_SCENES} 个场景上限`)
  })

  it('duplicates a scene with independent scene and node identities', () => {
    const store = useEditorStore.getState()
    const sourceId = store.project.scenes[0]!.id
    store.addTextNode(80, 90)
    store.addRectangleNode(320, 240)
    const sourceNodes = activeScene().nodes.map((node) => structuredClone(node))
    const historyBeforeDuplicate = useEditorStore.getState().history.past.length

    store.duplicateScene(sourceId)

    const state = useEditorStore.getState()
    const source = state.project.scenes[0]!
    const copy = state.project.scenes[1]!
    expect(copy).toMatchObject({ name: `${source.name} 副本` })
    expect(copy.id).not.toBe(source.id)
    expect(copy.nodes.map((node) => node.id)).not.toEqual(
      source.nodes.map((node) => node.id),
    )
    expect(copy.nodes.map(({ id: _id, ...node }) => node)).toEqual(
      sourceNodes.map(({ id: _id, ...node }) => node),
    )
    expect(state.activeSceneId).toBe(copy.id)
    expect(state.selectedNodeIds).toEqual([])
    expect(state.history.past).toHaveLength(historyBeforeDuplicate + 1)

    const copiedText = copy.nodes.find((node) => node.type === 'text')
    expect(copiedText).toBeDefined()
    store.updateNode(copiedText!.id, { text: '副本独立修改' })
    expect(
      useEditorStore.getState().project.scenes[0]!.nodes.find(
        (node) => node.type === 'text',
      ),
    ).toMatchObject({ text: '双击编辑文字' })
  })

  it('rewrites a duplicated scene self-entry while preserving its valid state target', () => {
    const store = useEditorStore.getState()
    const sourceSceneId = activeScene().id
    store.addPresentationState('完成')
    const targetStateId = useEditorStore.getState().activePresentationStateId!
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
  it('duplicates with fresh ids, reorders within rule kind, and undoes both', () => {
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
    store.undo()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'first',
      copyId,
      'click',
      'second',
    ])
    store.undo()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'first',
      'click',
      'second',
    ])
  })
})

describe('animation completion dependency cleanup', () => {
  it('cascades through second-order completion rules when the source rule is deleted', () => {
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
    store.undo()
    expect(activeScene().interactions.map((rule) => rule.id)).toEqual([
      'motion-source',
      'first-dependent',
      'second-dependent',
      'unrelated',
    ])
  })
})

describe('node operations', () => {
  it('adds text, rectangle, and image nodes with their required defaults', () => {
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
    expect(useEditorStore.getState().selectedNodeId).toBe(nodes[2]!.id)
  })

  it('keeps newly dropped nodes at least 20px inside the visible canvas edge', () => {
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

  it('keeps a high defensive node limit without the former 100-node product cap', () => {
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
    store.loadCourseProject(document, null)
    store.addRectangleNode()

    expect(activeScene().nodes).toHaveLength(MAX_SCENE_NODES)
    expect(useEditorStore.getState().errorMessage).toContain(`${MAX_SCENE_NODES} 个节点上限`)
  })

  it('deletes a selected node and undo restores it', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.deleteNode(nodeId)
    expect(activeScene().nodes).toHaveLength(0)
    expect(useEditorStore.getState().selectedNodeId).toBeNull()

    store.undo()
    expect(activeScene().nodes).toHaveLength(1)
    expect(activeScene().nodes[0]!.id).toBe(nodeId)
  })

  it('commits a completed drag/resize as exactly one history step', () => {
    const store = useEditorStore.getState()
    store.addRectangleNode()
    const nodeId = activeScene().nodes[0]!.id
    const historyBeforeCommit = useEditorStore.getState().history.past.length

    // Phaser pointermove is view-only; pointerup supplies one final Store patch.
    store.updateNode(nodeId, {
      x: 123.5,
      y: 234.5,
      width: 456,
      height: 222,
    })

    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeCommit + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({
      x: 123.5,
      y: 234.5,
      width: 456,
      height: 222,
    })
  })

  it('keeps a live text draft in the project and commits it as exactly one history step', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    const historyBeforeCommit = useEditorStore.getState().history.past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '中', [], 80)
    store.updateTextEditDraft(nodeId, '中文文本', [], 80)
    store.updateTextEditDraft(nodeId, '中文文本\n第二行', [], 120)

    expect(activeScene().nodes[0]).toMatchObject({
      text: '中文文本\n第二行',
      height: 120,
    })
    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeCommit,
    )

    store.commitTextEdit()

    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeCommit + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({
      text: '中文文本\n第二行',
      height: 120,
    })

    store.undo()
    expect(activeScene().nodes[0]).toMatchObject({ text: '双击编辑文字' })
    store.redo()
    expect(activeScene().nodes[0]).toMatchObject({ text: '中文文本\n第二行' })
  })

  it('commits a canvas text draft before switching to properties so undo restores the draft', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    const historyBefore = useEditorStore.getState().history.past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '画布编辑中的草稿', [], 80)
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('canvas')

    store.beginTextEdit(nodeId, 'canvas')
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('canvas')
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })

    store.beginTextEdit(nodeId, 'properties')
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().v9ContentEdit?.source).toBe('properties')
    expect(useEditorStore.getState().editingTextNodeId).toBeNull()
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })

    store.updateTextEditDraft(nodeId, '属性栏最终文字', [], 80)
    store.commitTextEdit()
    expect(activeScene().nodes[0]).toMatchObject({ text: '属性栏最终文字' })
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 2)

    store.undo()
    expect(activeScene().nodes[0]).toMatchObject({ text: '画布编辑中的草稿' })
  })

  it('keeps auto-width changes inside the same vertical text transaction', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.updateNode(nodeId, {
      style: { writingMode: 'vertical-lr', overflow: 'auto-height' },
    })
    const originalWidth = activeScene().nodes[0]!.width
    const historyBeforeCommit = useEditorStore.getState().history.past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '竖排内容', [], 180, 96)
    store.updateTextEditDraft(nodeId, '竖排内容增加', [], 180, 128)

    expect(activeScene().nodes[0]).toMatchObject({
      text: '竖排内容增加',
      width: 128,
      height: 180,
    })
    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeCommit,
    )

    store.commitTextEdit()
    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeCommit + 1,
    )
    store.undo()
    expect(activeScene().nodes[0]).toMatchObject({
      text: '双击编辑文字',
      width: originalWidth,
    })
  })

  it('cancels a text transaction without adding history or leaving the project dirty', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.markSaved('lesson.h5lesson')
    const historyBefore = useEditorStore.getState().history.past.length

    store.beginTextEdit(nodeId, 'properties')
    store.updateTextEditDraft(nodeId, '应被取消', [], 96)
    expect(activeScene().nodes[0]).toMatchObject({ text: '应被取消' })
    store.cancelTextEdit()

    expect(activeScene().nodes[0]).toMatchObject({
      text: '双击编辑文字',
      height: 80,
    })
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore)
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().textEditSession).toBeNull()
  })

  it('deterministically commits text before switching nodes or scenes', () => {
    const store = useEditorStore.getState()
    const firstSceneId = store.activeSceneId
    store.addTextNode()
    const textId = activeScene().nodes[0]!.id
    store.addRectangleNode()
    const rectangleId = activeScene().nodes[1]!.id
    const historyBeforeNodeSwitch = useEditorStore.getState().history.past.length

    store.selectNode(textId)
    store.beginTextEdit(textId, 'canvas')
    store.updateTextEditDraft(textId, '切换后仍保留', [], 80)
    store.selectNode(rectangleId)

    expect(useEditorStore.getState().history.past).toHaveLength(
      historyBeforeNodeSwitch + 1,
    )
    expect(activeScene().nodes[0]).toMatchObject({ text: '切换后仍保留' })
    expect(useEditorStore.getState().textEditSession).toBeNull()

    store.addScene()
    const secondSceneId = useEditorStore.getState().activeSceneId
    store.setActiveScene(firstSceneId)
    store.selectNode(textId)
    store.beginTextEdit(textId, 'properties')
    store.updateTextEditDraft(textId, '切场景前提交', [], 80)
    store.setActiveScene(secondSceneId)

    expect(
      useEditorStore.getState().project.scenes[0]!.nodes[0],
    ).toMatchObject({ text: '切场景前提交' })
    expect(useEditorStore.getState().textEditSession).toBeNull()
  })

  it('finalizes the current text draft when a save is marked complete', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    const historyBefore = useEditorStore.getState().history.past.length

    store.beginTextEdit(nodeId, 'canvas')
    store.updateTextEditDraft(nodeId, '保存时的当前文字', [], 80)
    store.markSaved('saved-draft.h5lesson')

    expect(activeScene().nodes[0]).toMatchObject({ text: '保存时的当前文字' })
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().textEditSession).toBeNull()
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('reorders nodes using scene.nodes as the only layer order', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const [text, rectangle] = activeScene().nodes
    store.reorderNodes([rectangle!.id, text!.id])

    expect(activeScene().nodes.map((node) => node.id)).toEqual([
      rectangle!.id,
      text!.id,
    ])
    store.undo()
    expect(activeScene().nodes.map((node) => node.id)).toEqual([
      text!.id,
      rectangle!.id,
    ])
  })

  it('rolls back and restores a new image node, metadata, and bytes atomically', () => {
    const store = useEditorStore.getState()
    store.addImageNode(imageMeta, new Uint8Array([1, 2, 3, 4]))
    store.undo()

    expect(activeScene().nodes).toHaveLength(0)
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()

    store.redo()
    expect(activeScene().nodes).toHaveLength(1)
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([1, 2, 3, 4])
  })

  it('undoes a reused asset node without deleting pre-existing bytes', () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    store.addImageNode(imageMeta, bytes)
    store.undo()

    expect(activeScene().nodes).toHaveLength(0)
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
  })

  it('deletes an unused asset through history and restores its bytes on undo', () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    expect(store.deleteAsset(imageMeta.id)).toBe(true)
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()

    store.undo()
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
    store.redo()
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()
  })

  it('undoes and redoes an asset imported only into the media library', () => {
    const store = useEditorStore.getState()
    const bytes = new Uint8Array([1, 2, 3, 4])
    store.importAsset(imageMeta, bytes)
    expect(store.project.scenes[0]!.nodes).toHaveLength(0)
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toEqual(imageMeta)

    store.undo()
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toBeUndefined()
    expect(mediaFiles()[imageMeta.id]).toBeUndefined()
    store.redo()
    expect(useEditorStore.getState().project.assets[imageMeta.id]).toEqual(imageMeta)
    expect([...mediaFiles()[imageMeta.id]!]).toEqual([...bytes])
  })

  it('keeps component import and later node placement as separate undo steps', () => {
    const store = useEditorStore.getState()
    const component = sampleComponent()
    store.importComponentPackage(component)
    expect(useEditorStore.getState().history.past).toHaveLength(1)

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

    store.undo()
    expect(activeScene().nodes).toHaveLength(0)
    expect(
      useEditorStore.getState().project.componentPackages['com.example.counter'],
    ).toBeDefined()
    expect(
      useEditorStore.getState().componentPackages['com.example.counter'],
    ).toBeDefined()

    store.undo()
    expect(
      useEditorStore.getState().project.componentPackages['com.example.counter'],
    ).toBeUndefined()
    expect(
      useEditorStore.getState().componentPackages['com.example.counter'],
    ).toBeUndefined()
  })

  it('rejects a second version of the same component ID without corrupting references', () => {
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
  it('normalizes legacy scenes and enters the authored initial state when run mode starts', () => {
    const presentation = activeScene().presentation
    expect(presentation).toBeDefined()
    const initialId = presentation!.initialStateId
    expect(presentation?.states.length).toBeGreaterThanOrEqual(1)
    expect(useEditorStore.getState().activePresentationStateId).toBeNull()

    useEditorStore.getState().setCanvasMode('run')
    expect(useEditorStore.getState()).toMatchObject({
      canvasMode: 'run',
      activePresentationStateId: initialId,
    })
    useEditorStore.getState().setCanvasMode('edit')
    expect(useEditorStore.getState().activePresentationStateId).toBe(initialId)
    useEditorStore.getState().setActivePresentationState(null)
    expect(useEditorStore.getState()).toMatchObject({
      canvasMode: 'edit',
      activePresentationStateId: null,
    })
  })

  it('stores state edits as overrides while keeping the canonical base editable', () => {
    const store = useEditorStore.getState()
    store.addTextNode(80, 90)
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('答错')
    const stateId = useEditorStore.getState().activePresentationStateId!
    const historyBeforeEdit = useEditorStore.getState().history.past.length

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
    expect(materializeScene(scene, stateId).nodes[0]).toMatchObject({
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
    expect(useEditorStore.getState().history.past).toHaveLength(historyBeforeEdit + 1)

    useEditorStore.getState().undo()
    expect(materializeScene(activeScene(), stateId).nodes[0]).toMatchObject({
      x: 80,
      text: '双击编辑文字',
    })
  })

  it('never lets base or state property patches rewrite stable node identity', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id

    store.updateNode(nodeId, { id: 'replacement', type: 'image' } as never)
    expect(activeScene().nodes[0]).toMatchObject({ id: nodeId, type: 'text' })

    store.addPresentationState('状态')
    const stateId = useEditorStore.getState().activePresentationStateId!
    useEditorStore.getState().updateNode(nodeId, {
      id: 'state-replacement',
      type: 'shape',
      x: 404,
    } as never)
    expect(materializeScene(activeScene(), stateId).nodes[0]).toMatchObject({
      id: nodeId,
      type: 'text',
      x: 404,
    })
  })

  it('adds and deletes nodes locally in a state without destroying the base identity', () => {
    const store = useEditorStore.getState()
    store.addPresentationState('反馈')
    const stateId = useEditorStore.getState().activePresentationStateId!
    useEditorStore.getState().addRectangleNode(120, 140)
    const sceneAfterAdd = activeScene()
    const nodeId = sceneAfterAdd.nodes[0]!.id

    expect(sceneAfterAdd.nodes[0]).toMatchObject({ visible: false })
    expect(materializeScene(sceneAfterAdd, stateId).nodes[0]).toMatchObject({
      visible: true,
      x: 120,
      y: 140,
    })

    useEditorStore.getState().deleteNode(nodeId)
    expect(activeScene().nodes).toHaveLength(1)
    expect(materializeScene(activeScene(), stateId).nodes[0]).toMatchObject({
      visible: false,
    })

    useEditorStore.getState().setActivePresentationState(null)
    useEditorStore.getState().deleteNode(nodeId)
    expect(activeScene().nodes).toHaveLength(0)
    expect(Object.values(activeScene().presentation?.states[1]?.nodeOverrides ?? {}))
      .toHaveLength(0)
  })

  it('commits text editing in a state as one undoable override transaction', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id
    store.addPresentationState('完成')
    const stateId = useEditorStore.getState().activePresentationStateId!
    const historyBefore = useEditorStore.getState().history.past.length

    useEditorStore.getState().beginTextEdit(nodeId, 'properties')
    useEditorStore.getState().updateTextEditDraft(nodeId, '状态文字', [], 96)
    expect(selectEditingNodes(useEditorStore.getState())[0]).toMatchObject({
      text: '状态文字',
      height: 96,
    })
    expect(activeScene().nodes[0]).toMatchObject({ text: '双击编辑文字', height: 80 })
    useEditorStore.getState().commitTextEdit()

    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
    expect(materializeScene(activeScene(), stateId).nodes[0]).toMatchObject({
      text: '状态文字',
      height: 96,
    })
    useEditorStore.getState().undo()
    expect(materializeScene(activeScene(), stateId).nodes[0]).toMatchObject({
      text: '双击编辑文字',
      height: 80,
    })
  })

  it('rewrites override node ids when duplicating a scene', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    const sourceSceneId = activeScene().id
    const [sourceNodeId, sourceBackNodeId] = activeScene().nodes.map((node) => node.id)
    store.addPresentationState('正确')
    const stateId = useEditorStore.getState().activePresentationStateId!
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

  it('keeps state ordering local, undoable, and cleans it when a base node is deleted', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    store.addShapeNode('ellipse')
    const baseOrder = activeScene().nodes.map((node) => node.id)
    store.addPresentationState('分层')
    const stateId = useEditorStore.getState().activePresentationStateId!
    const stateOrder = [baseOrder[2]!, baseOrder[0]!, baseOrder[1]!]

    useEditorStore.getState().updateNode(baseOrder[0]!, { x: 777 })
    useEditorStore.getState().reorderNodes(stateOrder)
    expect(activeScene().nodes.map((node) => node.id)).toEqual(baseOrder)
    expect(materializeScene(activeScene(), stateId).nodes.map((node) => node.id))
      .toEqual(stateOrder)

    useEditorStore.getState().undo()
    expect(materializeScene(activeScene(), stateId).nodes.map((node) => node.id))
      .toEqual(baseOrder)
    useEditorStore.getState().redo()
    expect(materializeScene(activeScene(), stateId).nodes.map((node) => node.id))
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
    useEditorStore.getState().undo()
    expect(activeScene().nodes.map((node) => node.id)).toEqual(baseOrder)
    expect(activeScene().presentation?.states.find((state) => state.id === stateId))
      .toMatchObject({
        nodeOverrides: { [baseOrder[0]!]: { x: 777 } },
        nodeOrder: stateOrder,
      })
  })

  it('falls back to the runtime initial state when the active thumbnail state is deleted', () => {
    const store = useEditorStore.getState()
    store.addPresentationState('运行初始')
    const initialId = useEditorStore.getState().activePresentationStateId!
    useEditorStore.getState().addPresentationState('缩略图')
    const thumbnailId = useEditorStore.getState().activePresentationStateId!
    useEditorStore.getState().setInitialPresentationState(initialId)
    useEditorStore.getState().setThumbnailPresentationState(thumbnailId)

    expect(useEditorStore.getState().deletePresentationState(thumbnailId)).toBe(true)
    expect(useEditorStore.getState().activePresentationStateId).toBe(initialId)
    expect(activeScene().presentation).toMatchObject({
      initialStateId: initialId,
      thumbnailStateId: initialId,
    })

    useEditorStore.getState().undo()
    expect(activeScene().presentation?.states.some((state) => state.id === thumbnailId))
      .toBe(true)
    useEditorStore.getState().redo()
    expect(activeScene().presentation?.states.some((state) => state.id === thumbnailId))
      .toBe(false)
  })

  it('falls cross-scene entry rules back to the target initial state when a state is deleted', () => {
    const store = useEditorStore.getState()
    const sourceSceneId = activeScene().id
    store.addScene()
    const targetSceneId = activeScene().id
    store.addPresentationState('详情')
    const targetStateId = useEditorStore.getState().activePresentationStateId!
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
    const sourceRule = useEditorStore.getState().project.scenes.find(
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

    store.undo()
    const restoredRule = useEditorStore.getState().project.scenes.find(
      (scene) => scene.id === sourceSceneId,
    )!.interactions[0]!
    expect(restoredRule.actions[0]!.action).toMatchObject({ targetStateId })
  })
})

describe('multi-selection operations', () => {
  it('duplicates each selected node with its own click mappings exactly once', () => {
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

    const copiedIds = useEditorStore.getState().selectedNodeIds
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

    store.undo()
    expect(activeScene().nodes.map((node) => node.id)).toEqual(sourceIds)
    expect(activeScene().interactions.filter(
      (rule) => rule.trigger.type === 'node.click',
    )).toHaveLength(2)
  })

  it('supports additive toggling and filters invalid or duplicate selection IDs', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addRectangleNode()
    store.addShapeNode('ellipse')
    const [text, rectangle, ellipse] = activeScene().nodes

    store.selectNode(text!.id)
    store.selectNode(rectangle!.id, true)
    expect(useEditorStore.getState().selectedNodeIds).toEqual([
      text!.id,
      rectangle!.id,
    ])
    expect(useEditorStore.getState().selectedNodeId).toBe(rectangle!.id)

    store.selectNode(text!.id, true)
    expect(useEditorStore.getState().selectedNodeIds).toEqual([rectangle!.id])
    store.selectNodes([text!.id, 'missing-node', ellipse!.id, text!.id])
    expect(useEditorStore.getState().selectedNodeIds).toEqual([
      text!.id,
      ellipse!.id,
    ])
    expect(useEditorStore.getState().selectedNodeId).toBe(ellipse!.id)
  })

  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)(
    'aligns the selected nodes to %s in one history step',
    (mode) => {
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
      const historyBefore = useEditorStore.getState().history.past.length

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
      expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)
    },
  )

  it.each(['horizontal', 'vertical'] as const)(
    'distributes three selected nodes with equal %s gaps',
    (axis) => {
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
    (mode) => {
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
    (axis) => {
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

  it('copies a multi-selection snapshot and pastes independent unlocked nodes', () => {
    const store = useEditorStore.getState()
    store.addTextNode(100, 120)
    store.addRectangleNode(360, 280)
    const [text, shape] = activeScene().nodes
    store.updateNode(text!.id, { locked: true })
    store.selectNodes([text!.id, shape!.id])
    const historyBeforeCopy = useEditorStore.getState().history.past.length

    store.copySelectedNodes()
    expect(useEditorStore.getState().history.past).toHaveLength(historyBeforeCopy)
    expect(useEditorStore.getState().slideCandidateClipboard?.items).toHaveLength(2)
    expect(useEditorStore.getState().clipboardNodes).toHaveLength(0)

    store.updateNode(text!.id, { x: 600, text: '原节点已修改' })
    const historyBeforePaste = useEditorStore.getState().history.past.length
    store.pasteNodes()

    const state = useEditorStore.getState()
    const pastedIds = state.selectedNodeIds
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
    expect(state.history.past).toHaveLength(historyBeforePaste + 1)
  })
})

describe('history semantics', () => {
  it('records V9 history as capped snapshot steps instead of V8 immer patches', () => {
    expect(selectSlideBackendKind(useEditorStore.getState())).toBe('slide-authoring')
    const store = useEditorStore.getState()
    const sceneId = store.project.scenes[0]!.id
    const originalName = store.project.scenes[0]!.name
    store.updateScene(sceneId, { name: '修改后的第一课' })

    const entry = useEditorStore.getState().history.past[0]!
    expect(entry.patches).toHaveLength(1)
    expect(entry.inversePatches).toHaveLength(1)
    expect(useEditorStore.getState().project.scenes[0]!.name).toBe('修改后的第一课')
    store.undo()
    expect(useEditorStore.getState().project.scenes[0]!.name).toBe(originalName)
  })

  it('undoes an addition and redo restores it', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const nodeId = activeScene().nodes[0]!.id

    store.undo()
    expect(activeScene().nodes).toHaveLength(0)
    expect(useEditorStore.getState().history.future).toHaveLength(1)

    store.redo()
    expect(activeScene().nodes[0]!.id).toBe(nodeId)
    expect(useEditorStore.getState().history.future).toHaveLength(0)
  })

  it('limits undo history to 100 V9 entries and clears redo after a new commit', () => {
    const store = useEditorStore.getState()
    const sceneId = store.project.scenes[0]!.id
    for (let index = 0; index < 110; index += 1) {
      store.updateScene(sceneId, {
        backgroundColor: `#${index.toString(16).padStart(6, '0')}`,
      })
    }
    expect(useEditorStore.getState().history.past).toHaveLength(100)

    store.undo()
    store.undo()
    expect(useEditorStore.getState().history.future).toHaveLength(2)
    store.updateScene(sceneId, { name: '新提交' })
    expect(useEditorStore.getState().history.future).toHaveLength(0)
    expect(useEditorStore.getState().history.past).toHaveLength(99)
  })

  it('new and opened projects clear history while save keeps it', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    const documentToLoad = structuredClone(selectSlideAuthoringDocument(useEditorStore.getState())!)
    expect(useEditorStore.getState().history.past).toHaveLength(1)

    store.markSaved('C:\\course.h5lesson')
    expect(useEditorStore.getState().history.past).toHaveLength(1)
    expect(useEditorStore.getState().dirty).toBe(false)

    store.loadCourseProject(documentToLoad, 'C:\\course.h5lesson')
    expect(useEditorStore.getState().history.past).toHaveLength(0)
    store.addRectangleNode()
    store.createNewProject()
    expect(useEditorStore.getState().history.past).toHaveLength(0)
    expect(useEditorStore.getState().dirty).toBe(false)
  })
})

describe('factory compatibility', () => {
  it('supports the Store positional factory forms and protects component props', () => {
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
