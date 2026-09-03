import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ComponentManifestV4,
  ComponentPackageData,
} from '@/shared/componentTypes'
import type {
  CourseRuntimeDefinition,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import { captureCourseRuntimeContentTextTarget } from '@/renderer/runtime/runtimeContentTextAuthoringCommands'
import { allocateCourseLayerOrder } from '@/renderer/course/globalLayerCommands'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
  selectCandidateGlobalLayerItems,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'

import { courseLayerItemToEditorCanvasNode } from '@/renderer/store/slideEditorProjection'

function activeHistory() {
  const state = useEditorStore.getState()
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active slideBackend')
  return backend.getSession().history
}

function projectedGlobalLayer(state: Parameters<typeof selectCandidateGlobalLayerItems>[0]) {
  return (selectCandidateGlobalLayerItems(state) ?? []).map((entry) => ({
    ...entry,
    layer: entry.plane ?? 'overlay',
    visibility: {
      mode: entry.visibility.mode,
      sceneIds: entry.visibility.locationIds,
    },
    node: courseLayerItemToEditorCanvasNode(entry.item)!,
  }))
}


function componentPackage(
  id: string,
  supportedScopes: ComponentManifestV4['supportedScopes'],
): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      supportedScopes,
      renderMode: 'phaser',
      id,
      name: id === 'com.example.global' ? '全局控制条' : '场景练习',
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 480, height: 120 },
      minSize: { width: 160, height: 60 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        content: {
          title: '课程导航',
          buttons: { replay: '重播', next: '下一页' },
        },
      },
    },
    runtimeSource:
      "window.CoursewareComponent.define({id:'placeholder',runtimeApiVersion:4,create:function(){return {destroy:function(){}}}})",
    files: {
      'manifest.json': new Uint8Array([1]),
      'runtime.js': new Uint8Array([2]),
    },
  }
}

function runtime(title: string): CourseRuntimeDefinition {
  return {
    protocol: 'canvas-runtime',
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'hybrid',
    source: `CoursewareRuntime.define({runtimeApiVersion:2,create(){/* ${title} */return{destroy(){}}}})`,
    content: {
      values: {
        title,
        'feedback.success': '回答正确',
      },
      metadata: {
        title: { label: '标题' },
      },
    },
    assets: {},
  }
}

function runtimeItem(
  layerItemId: string,
  label: string,
  order: number,
  definition: CourseRuntimeDefinition,
): RuntimeLayerItem {
  return {
    layerItemId,
    label,
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: structuredClone(definition),
  }
}

function installRuntimeDefinitions(
  sceneId: string,
  sceneRuntime: CourseRuntimeDefinition,
  globalRuntime: CourseRuntimeDefinition,
): void {
  const store = useEditorStore.getState()
  const current = selectActiveCourseProjectDocument(store)
  if (!current) throw new Error('缺少当前 Course Project')
  const project = structuredClone(current)
  const surface = project.surfaces.find((candidate) => (
    candidate.type === 'slide'
    && candidate.scenes.some((scene) => scene.id === sceneId)
  ))
  if (!surface || surface.type !== 'slide') throw new Error('缺少当前 Slide Surface')
  const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) throw new Error('缺少当前 Slide 场景')
  const sceneOrder = allocateCourseLayerOrder(project, 0)
  scene.layerItems.push(runtimeItem(
    `test-scene-runtime-${sceneId}`,
    '场景运行时',
    sceneOrder,
    sceneRuntime,
  ))
  const globalOrder = allocateCourseLayerOrder(project, sceneOrder + 1)
  project.globalLayerItems.push({
    item: runtimeItem(
      `test-global-runtime-${project.id}`,
      '全局运行时',
      globalOrder,
      globalRuntime,
    ),
    visibility: { mode: 'all', locationIds: [] },
  })
  store.loadCourseProject(
    project,
    null,
    store.assetFiles,
    store.componentPackages,
  )
}

function captureRuntimeTitleTarget(
  owner: 'scene' | 'global',
  initialValue: string,
) {
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state)
  const locationId = selectActiveCourseLocationId(state)
  const sessionToken = state.courseAuthoringSession?.token
  const location = project?.locations.find((candidate) => candidate.id === locationId)
  const surface = project?.surfaces.find(
    (candidate) => candidate.id === location?.surfaceId,
  )
  if (
    !project
    || !locationId
    || !sessionToken
    || location?.kind !== 'slide-scene'
    || surface?.type !== 'slide'
  ) {
    throw new Error('缺少 Slide Runtime 文字编辑会话')
  }
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  const item = owner === 'global'
    ? project.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    : scene?.layerItems.find((candidate) => candidate.kind === 'runtime')
  if (!item || item.kind !== 'runtime') {
    throw new Error(`缺少 ${owner} Runtime LayerItem`)
  }
  return captureCourseRuntimeContentTextTarget({
    sessionToken,
    projectId: project.id,
    surfaceId: surface.id,
    stateId: state.activePresentationStateId,
    owner,
    sceneId: owner === 'scene' ? scene!.id : null,
    itemId: item.layerItemId,
    contentKey: 'title',
    initialValue,
  })
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

describe('Project V8 global-layer editor store', () => {
  it('在隐藏、关闭与恢复教师控制器时始终维持双向一致', () => {
    const store = useEditorStore.getState()
    store.setEditingScope('global')
    const controller = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'teacher-controller',
    )!.node

    store.updateNode(controller.id, { visible: false })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.controls).toBe('none')

    useEditorStore.getState().ensureTeacherController()
    let project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(project.playback.controls).toBe('canvas')
    expect(projectedGlobalLayer(useEditorStore.getState()).find((item) => item.node.id === controller.id)?.node)
      .toMatchObject({ visible: true, playbackInitialVisibility: 'inherit' })

    useEditorStore.getState().updatePlayback({ controls: 'none' })
    project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(project.playback.controls).toBe('none')
    expect(projectedGlobalLayer(useEditorStore.getState()).find((item) => item.node.id === controller.id)?.node)
      .toMatchObject({ playbackInitialVisibility: 'hidden' })

    useEditorStore.getState().ensureTeacherController()
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.controls).toBe('canvas')

    const currentController = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === controller.id,
    )!.node
    if (currentController.type !== 'teacher-controller') throw new Error('缺少教师控制器')
    useEditorStore.getState().updateNode(controller.id, {
      x: 2000,
      opacity: 0,
      buttons: (currentController.buttons ?? []).map((button) => ({
        ...button,
        visible: false,
      })),
    })
    useEditorStore.getState().updateGlobalLayerSettings(controller.id, {
      layer: 'underlay',
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.playback.controls).toBe('none')

    useEditorStore.getState().ensureTeacherController()
    project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const repaired = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === controller.id,
    )!
    expect(project.playback.controls).toBe('canvas')
    expect(repaired).toMatchObject({
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
      node: { opacity: 1, visible: true },
    })
    if (repaired.node.type !== 'teacher-controller') throw new Error('缺少教师控制器')
    expect(repaired.node.x).toBeLessThan(1280)
    expect(repaired.node.buttons?.some((button) => button.visible)).toBe(true)
  })

  it('accepts only global-capable V4 packages and creates an undoable placement', () => {
    const store = useEditorStore.getState()
    const global = componentPackage('com.example.global', ['scene', 'global'])
    const sceneOnly = componentPackage('com.example.scene', ['scene'])
    store.importComponentPackage(global)
    store.importComponentPackage(sceneOnly)
    store.setEditingScope('global')
    const initialGlobalCount = projectedGlobalLayer(useEditorStore.getState()).length

    store.addExternalComponentNode(sceneOnly.manifest.id)
    expect(projectedGlobalLayer(useEditorStore.getState())).toHaveLength(
      initialGlobalCount,
    )
    expect(useEditorStore.getState().errorMessage).toContain('未声明支持全局层')

    store.addExternalComponentNode(global.manifest.id, 240, 90)
    const state = useEditorStore.getState()
    const placement = projectedGlobalLayer(state).find(
      (item) => item.node.type === 'external-component',
    )!
    expect(placement).toMatchObject({
      layer: 'overlay',
      visibility: { mode: 'all', sceneIds: [] },
      node: {
        type: 'external-component',
        x: 240,
        y: 90,
        component: { packageId: global.manifest.id },
      },
    })
    expect(state.selectedNodeId).toBe(placement.node.id)

    store.undo()
    expect(projectedGlobalLayer(useEditorStore.getState())).toHaveLength(
      initialGlobalCount,
    )
    store.redo()
    expect(
      projectedGlobalLayer(useEditorStore.getState()).some(
        (item) => item.node.id === placement.node.id,
      ),
    ).toBe(true)
  })

  it('moves, resizes, edits copy, and persists layer and stable scene visibility', () => {
    const store = useEditorStore.getState()
    const global = componentPackage('com.example.global', ['global'])
    store.importComponentPackage(global)
    store.addScene()
    const sceneIds = selectSlideSceneList(useEditorStore.getState()).map((scene) => scene.id)
    store.setEditingScope('global')
    store.addExternalComponentNode(global.manifest.id)
    const nodeId = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'external-component',
    )!.node.id

    store.updateNode(nodeId, {
      x: 80,
      y: 40,
      width: 720,
      height: 160,
      props: {
        content: {
          title: '教师控制台',
          buttons: { replay: '重新演示', next: '继续学习' },
        },
      },
    })
    store.updateGlobalLayerSettings(nodeId, {
      layer: 'underlay',
      visibility: {
        mode: 'include',
        sceneIds: [sceneIds[1]!, sceneIds[1]!, 'missing-scene'],
      },
    })

    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === nodeId,
    )).toMatchObject({
      layer: 'underlay',
      visibility: { mode: 'include', sceneIds: [sceneIds[1]] },
      node: {
        x: 80,
        y: 40,
        width: 720,
        height: 160,
        props: {
          content: {
            title: '教师控制台',
            buttons: { replay: '重新演示', next: '继续学习' },
          },
        },
      },
    })

    store.undo()
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === nodeId,
    )).toMatchObject({
      layer: 'underlay',
      visibility: { mode: 'all', sceneIds: [] },
    })
    store.redo()
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === nodeId,
    )).toMatchObject({
      layer: 'underlay',
      visibility: { mode: 'include', sceneIds: [sceneIds[1]] },
    })
  })

  it('keeps filtered global visibility schema-valid while the UI changes mode', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const firstSceneId = selectSlideSceneList(useEditorStore.getState())[0]!.id
    store.setEditingScope('global')
    store.addTextNode()
    const nodeId = projectedGlobalLayer(useEditorStore.getState())[0]!.node.id

    store.updateGlobalLayerSettings(nodeId, {
      visibility: { mode: 'include', sceneIds: [] },
    })

    expect(projectedGlobalLayer(useEditorStore.getState())[0]!.visibility)
      .toEqual({ mode: 'include', sceneIds: [firstSceneId] })
  })

  it('canonicalizes include/exclude visibility when its last referenced scene is deleted', () => {
    const store = useEditorStore.getState()
    store.addScene()
    let [firstScene, secondScene] = selectSlideSceneList(useEditorStore.getState())
    const controllerId = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'teacher-controller',
    )!.node.id

    store.updateGlobalLayerSettings(controllerId, {
      visibility: { mode: 'include', sceneIds: [secondScene!.id] },
    })
    expect(store.deleteScene(secondScene!.id)).toBe(true)
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === controllerId,
    )?.visibility).toEqual({ mode: 'include', sceneIds: [firstScene!.id] })

    useEditorStore.getState().addScene()
    ;[firstScene, secondScene] = selectSlideSceneList(useEditorStore.getState())
    useEditorStore.getState().updateGlobalLayerSettings(controllerId, {
      visibility: { mode: 'exclude', sceneIds: [secondScene!.id] },
    })
    expect(useEditorStore.getState().deleteScene(secondScene!.id)).toBe(true)
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === controllerId,
    )?.visibility).toEqual({ mode: 'all', sceneIds: [] })
  })

  it('authors native text, image, and shape nodes in the persistent global layer', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const secondSceneId = selectSlideSceneList(useEditorStore.getState())[1]!.id
    store.setEditingScope('global')

    store.addTextNode(80, 40)
    store.addShapeNode('rounded-rectangle', 20, 620)
    store.addImageNode({
      id: 'asset_global_logo',
      filename: 'logo.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/logo.png',
      byteLength: 4,
      width: 160,
      height: 80,
    }, new Uint8Array([1, 2, 3, 4]), 1080, 30)

    let layer = projectedGlobalLayer(useEditorStore.getState())
    expect(layer.map((item) => item.node.type)).toEqual([
      'teacher-controller',
      'text',
      'shape',
      'image',
    ])
    const text = layer.find((item) => item.node.type === 'text')!.node
    expect(text.type).toBe('text')
    if (text.type !== 'text') throw new Error('测试全局节点不是文字')

    store.beginTextEdit(text.id, 'canvas')
    store.updateTextEditDraft(text.id, '跨场景课程标题', [], 64)
    store.commitTextEdit()
    store.updateGlobalLayerSettings(text.id, {
      layer: 'underlay',
      visibility: { mode: 'exclude', sceneIds: [secondSceneId] },
    })

    layer = projectedGlobalLayer(useEditorStore.getState())
    expect(layer.find((item) => item.node.id === text.id)).toMatchObject({
      layer: 'underlay',
      visibility: { mode: 'exclude', sceneIds: [secondSceneId] },
      node: { type: 'text', text: '跨场景课程标题', height: 64 },
    })
    expect(selectMediaAssetFiles(useEditorStore.getState()).asset_global_logo).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )

    store.undo()
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === text.id,
    )!.layer).toBe('underlay')
  })

  it('edits scene and global runtime content without changing source and supports undo', () => {
    const sceneRuntime = runtime('场景标题')
    const globalRuntime = runtime('全局标题')
    const store = useEditorStore.getState()
    const sceneId = selectSlideSceneList(store)[0]!.id
    installRuntimeDefinitions(sceneId, sceneRuntime, globalRuntime)
    const locationId = selectActiveCourseLocationId(useEditorStore.getState())
    if (!locationId) throw new Error('缺少活动课程位置')
    store.activateCourseLocation(locationId)

    const sceneResult = useEditorStore.getState().updateRuntimeContentTextAtTarget(
      captureRuntimeTitleTarget('scene', '场景标题'),
      '修改后的场景标题',
    )
    expect(sceneResult).toMatchObject({ ok: true, status: 'updated' })
    useEditorStore.getState().setEditingScope('global')
    const globalResult = useEditorStore.getState().updateRuntimeContentTextAtTarget(
      captureRuntimeTitleTarget('global', '全局标题'),
      '修改后的全局标题',
    )
    expect(globalResult).toMatchObject({ ok: true, status: 'updated' })

    let project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const slideRuntime = project.surfaces.flatMap((surface) => (
      surface.type === 'slide' ? surface.scenes : []
    ))[0]?.layerItems.find((item) => item.kind === 'runtime')
    const globalRuntimeItem = project.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    if (!slideRuntime || slideRuntime.kind !== 'runtime' || globalRuntimeItem?.kind !== 'runtime') {
      throw new Error('expected scene and global runtime layers')
    }
    expect(slideRuntime.runtime.source).toBe(sceneRuntime.source)
    expect(globalRuntimeItem.runtime.source).toBe(globalRuntime.source)
    expect(slideRuntime.runtime.content.values).toEqual({
      title: '修改后的场景标题',
      'feedback.success': '回答正确',
    })
    expect(globalRuntimeItem.runtime.content.values.title).toBe('修改后的全局标题')

    store.undo()
    project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    const undoneGlobal = project.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    if (undoneGlobal?.kind !== 'runtime') throw new Error('expected global runtime')
    expect(undoneGlobal.runtime.content.values.title).toBe('全局标题')
    expect(undoneGlobal.runtime.source).toBe(globalRuntime.source)
    store.undo()
    const undoneScene = selectActiveCourseProjectDocument(useEditorStore.getState())
      ?.surfaces.flatMap((surface) => (surface.type === 'slide' ? surface.scenes : []))[0]
      ?.layerItems.find((item) => item.kind === 'runtime')
    if (!undoneScene || undoneScene.kind !== 'runtime') throw new Error('expected scene runtime')
    expect(undoneScene.runtime.content.values.title).toBe('场景标题')
  })

  it('keeps scene editing isolated when switching to and from the global layer', () => {
    const store = useEditorStore.getState()
    store.addTextNode(50, 60)
    const sceneNode = selectSlideSceneList(useEditorStore.getState())[0]!.nodes[0]!
    const global = componentPackage('com.example.global', ['scene', 'global'])
    store.importComponentPackage(global)

    store.setEditingScope('global')
    expect(useEditorStore.getState().selectedNodeIds).toEqual([])
    store.addExternalComponentNode(global.manifest.id)
    const globalNode = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'external-component',
    )!.node
    store.updateNode(globalNode.id, { x: 900 })

    store.setActiveScene(useEditorStore.getState().activeSceneId)
    expect(useEditorStore.getState().editingScope).toBe('scene')
    expect(selectSlideSceneList(useEditorStore.getState())[0]!.nodes[0]).toEqual(sceneNode)
    store.selectNode(sceneNode.id)
    store.updateNode(sceneNode.id, { x: 120 })
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === globalNode.id,
    )!.node.x).toBe(900)
  })

  it('authors, duplicates, copies, and cleans global node interactions', () => {
    const store = useEditorStore.getState()
    store.setEditingScope('global')
    store.addTextNode(120, 80)
    const original = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'text',
    )!.node
    store.addGlobalInteractionRule({
      id: 'global_click',
      name: '全局文字翻页',
      enabled: true,
      trigger: { type: 'node.click', nodeId: original.id },
      conditions: [],
      actions: [{
        id: 'global_click_step',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    })

    store.duplicateNode(original.id)
    let state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions).toHaveLength(2)
    const duplicate = projectedGlobalLayer(state).find(
      (item) => item.node.id === state.selectedNodeId,
    )!.node
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions.some((rule) => (
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === duplicate.id
    ))).toBe(true)

    store.deleteNode(duplicate.id)
    state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions).toHaveLength(1)
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions[0]!.trigger).toEqual({
      type: 'node.click',
      nodeId: original.id,
    })

    store.selectNode(original.id)
    store.copySelectedNodes()
    store.pasteNodes()
    state = useEditorStore.getState()
    const pastedId = state.selectedNodeId!
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions).toHaveLength(2)
    expect(selectActiveCourseProjectDocument(state)!.globalInteractions.some((rule) => (
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === pastedId
    ))).toBe(true)
  })

  it('keeps scene copies in global scopes and removes deleted controller targets', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const targetSceneId = useEditorStore.getState().activeSceneId
    store.addPresentationState('目标状态')
    const targetStateId = useEditorStore.getState().activePresentationStateId!
    const controller = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'teacher-controller',
    )!.node
    if (controller.type !== 'teacher-controller') throw new Error('缺少教师控制器')
    store.setEditingScope('global')
    store.updateNode(controller.id, {
      buttons: (controller.buttons ?? []).map((button, index) => index === 0
        ? {
            ...button,
            action: {
              type: 'scene.go',
              sceneId: targetSceneId,
              targetStateId,
            },
          }
        : button),
    })
    store.addGlobalInteractionRule({
      id: 'target-scene-scope',
      enabled: true,
      trigger: { type: 'scene.enter' },
      conditions: [{ type: 'scene.in', sceneIds: [targetSceneId] }],
      actions: [{
        id: 'target_scene_step',
        start: 'after-previous',
        delayMs: 0,
        action: { type: 'scene.next' },
      }],
    })

    store.duplicateScene(targetSceneId)
    const copiedSceneId = useEditorStore.getState().activeSceneId
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())!.globalInteractions[0]?.conditions)
      .toEqual([{ type: 'scene.in', sceneIds: [targetSceneId, copiedSceneId] }])

    expect(store.deleteScene(targetSceneId)).toBe(true)
    const project = selectActiveCourseProjectDocument(useEditorStore.getState())!
    expect(project.globalInteractions[0]?.conditions).toEqual([
      { type: 'scene.in', sceneIds: [copiedSceneId] },
    ])
    const nextController = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'teacher-controller',
    )!.node
    if (nextController.type !== 'teacher-controller') throw new Error('缺少教师控制器')
    expect((nextController.buttons ?? []).some((button) => (
      button.action.type === 'scene.go' && button.action.sceneId === targetSceneId
    ))).toBe(false)
  })
})

describe('Course Project V9 cross-surface playback controls', () => {
  it('keeps a locked Slide controller history-free and locked while restoring it', () => {
    const store = useEditorStore.getState()
    store.createNewProject()
    const initial = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!initial) throw new Error('缺少 Slide Course Project')
    const controller = initial.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )
    if (!controller) throw new Error('缺少 Slide 教师控制器')
    const initialPastCount = activeHistory().past.length

    useEditorStore.getState().ensureTeacherController()

    let state = useEditorStore.getState()
    expect(activeHistory().past).toHaveLength(initialPastCount)
    expect(state.selectedNodeId).toBe(controller.item.layerItemId)
    expect(state.statusMessage).toBe('教师控制器已可用')

    state.updateNode(controller.item.layerItemId, { locked: true })
    state = useEditorStore.getState()
    const lockedPastCount = activeHistory().past.length
    expect(selectActiveCourseProjectDocument(state)?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller.item.layerItemId,
    )?.item.locked).toBe(true)

    state.ensureTeacherController()
    state = useEditorStore.getState()
    expect(activeHistory().past).toHaveLength(lockedPastCount)
    expect(selectActiveCourseProjectDocument(state)?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller.item.layerItemId,
    )?.item.locked).toBe(true)

    state.updatePlayback({ controls: 'none' })
    state = useEditorStore.getState()
    expect(activeHistory().past).toHaveLength(lockedPastCount + 1)
    expect(selectActiveCourseProjectDocument(state)?.playback.controls).toBe('none')

    state.ensureTeacherController()
    state = useEditorStore.getState()
    expect(activeHistory().past).toHaveLength(lockedPastCount + 2)
    expect(selectActiveCourseProjectDocument(state)?.playback.controls).toBe('canvas')
    expect(selectActiveCourseProjectDocument(state)?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller.item.layerItemId,
    )?.item.locked).toBe(true)
    expect(state.statusMessage).toBe('已恢复教师控制器')

    state.undo()
    let document = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(document?.playback.controls).toBe('none')
    expect(document?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller.item.layerItemId,
    )?.item.locked).toBe(true)
    useEditorStore.getState().redo()
    document = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(document?.playback.controls).toBe('canvas')
    expect(document?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === controller.item.layerItemId,
    )?.item.locked).toBe(true)
  })

  it('restores the Flow global teacher controller in one undoable history step', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const initial = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!initial) throw new Error('缺少 Flow Course Project')
    const hidden = structuredClone(initial)
    const controller = hidden.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )
    if (!controller) throw new Error('缺少 Flow 教师控制器')
    controller.item.playbackInitialVisibility = 'hidden'
    hidden.playback.controls = 'none'
    store.loadCourseProject(hidden, null, store.assetFiles, store.componentPackages)
    const before = useEditorStore.getState().flowSession!.history

    useEditorStore.getState().ensureTeacherController()

    let state = useEditorStore.getState()
    let document = state.flowSession!.history.present
    expect(document.playback.controls).toBe('canvas')
    expect(document.globalLayerItems).toHaveLength(hidden.globalLayerItems.length)
    expect(document.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )?.item.playbackInitialVisibility).toBe('inherit')
    expect(state.flowSession!.history.past).toHaveLength(before.past.length + 1)
    expect(state.statusMessage).toBe('已恢复教师控制器')
    expect(state.errorMessage).toBeNull()

    state.undo()
    document = useEditorStore.getState().flowSession!.history.present
    expect(document.playback.controls).toBe('none')
    expect(document.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )?.item.playbackInitialVisibility).toBe('hidden')

    useEditorStore.getState().redo()
    document = useEditorStore.getState().flowSession!.history.present
    expect(document.playback.controls).toBe('canvas')
  })

  it('updates Flow controls, keyboard and presenter settings in one history step', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const before = useEditorStore.getState().flowSession!.history
    const patch = {
      controls: 'none' as const,
      keyboardNavigation: false,
      presenter: {
        enabled: false,
        strategy: 'authored-command' as const,
        additionalBindings: [],
      },
    }

    useEditorStore.getState().updatePlayback(patch)

    let state = useEditorStore.getState()
    let document = state.flowSession!.history.present
    expect(document.playback).toEqual(patch)
    expect(document.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )?.item.playbackInitialVisibility).toBe('hidden')
    expect(state.flowSession!.history.past).toHaveLength(before.past.length + 1)
    expect(state.statusMessage).toBe('成品控制设置已更新')
    expect(state.errorMessage).toBeNull()

    useEditorStore.getState().updatePlayback(patch)
    state = useEditorStore.getState()
    expect(state.flowSession!.history.past).toHaveLength(before.past.length + 1)
    expect(state.statusMessage).toBe('成品控制设置未变化')

    state.undo()
    document = useEditorStore.getState().flowSession!.history.present
    expect(document.playback.controls).toBe('canvas')
    expect(document.playback.keyboardNavigation).toBe(true)
    expect(document.playback.presenter).toMatchObject({
      enabled: true,
      strategy: 'scene-navigation',
    })

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().flowSession!.history.present.playback).toEqual(patch)
  })

  it('updates Spatial controls, keyboard and presenter settings in one history step', () => {
    const store = useEditorStore.getState()
    store.createNewSpatialProject()
    const before = useEditorStore.getState().spatialSession!.history
    const patch = {
      controls: 'none' as const,
      keyboardNavigation: false,
      presenter: {
        enabled: false,
        strategy: 'authored-command' as const,
        additionalBindings: [],
      },
    }

    useEditorStore.getState().updatePlayback(patch)

    let state = useEditorStore.getState()
    let document = state.spatialSession!.history.present
    expect(document.playback).toEqual(patch)
    expect(document.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller',
    )?.item.playbackInitialVisibility).toBe('hidden')
    expect(state.spatialSession!.history.past).toHaveLength(before.past.length + 1)
    expect(state.statusMessage).toBe('成品控制设置已更新')
    expect(state.errorMessage).toBeNull()

    state.undo()
    document = useEditorStore.getState().spatialSession!.history.present
    expect(document.playback.controls).toBe('canvas')
    expect(document.playback.keyboardNavigation).toBe(true)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().spatialSession!.history.present.playback).toEqual(patch)
  })
})
