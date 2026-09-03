import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type {
  CourseRuntimeDefinition,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import { ComponentsTab } from '@/renderer/ui/ComponentsTab'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { selectRuntimeInspectorAuthoringView } from '@/renderer/runtime/runtimeInspectorAuthoringView'
import { allocateCourseLayerOrder } from '@/renderer/course/globalLayerCommands'
import { clearFlowEditorSelection } from '@/renderer/course/flowEditorSlice'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectSlideAuthoringBackend,
  selectSlideAuthoringDocument,
  useEditorStore,
  selectCandidateGlobalLayerItems,
  selectSlideSceneList,
} from '@/renderer/store/editorStore'

import { courseLayerItemToEditorCanvasNode } from '@/renderer/store/slideEditorProjection'

function projectedGlobalLayer(state: Parameters<typeof selectCandidateGlobalLayerItems>[0]) {
  return (selectCandidateGlobalLayerItems(state) ?? []).flatMap((entry) => {
    const node = courseLayerItemToEditorCanvasNode(entry.item)
    if (!node) return []
    return [{
      ...entry,
      layer: entry.plane ?? 'overlay',
      visibility: {
        mode: entry.visibility.mode,
        sceneIds: entry.visibility.locationIds,
      },
      node,
    }]
  })
}


function componentPackage(
  id: string,
  scopes: Array<'scene' | 'global'>,
): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      supportedScopes: scopes,
      renderMode: 'phaser',
      id,
      name: id.endsWith('global') ? '全局导航' : '场景组件',
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 600, height: 100 },
      minSize: { width: 200, height: 60 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        content: {
          title: '课程导航',
          buttons: { replay: '重播本页', next: '进入下一页' },
        },
      },
      editor: {
        properties: [
          { key: 'content.title', label: '导航标题', type: 'text' },
          { key: 'content.buttons.next', label: '下一页按钮', type: 'text' },
        ],
      },
    },
    runtimeSource: '',
    files: {},
  }
}

function runtime(label: string, value: string): CourseRuntimeDefinition {
  return {
    protocol: 'canvas-runtime',
    runtimeApiVersion: 2,
    enabled: true,
    renderMode: 'dom',
    source: `CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})/*${value}*/`,
    content: {
      values: {
        title: value,
        action: '开始',
      },
      metadata: {
        title: { label },
        action: { label: `${label}操作` },
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

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => cleanup())

describe('Project V8 global-layer editor UI', () => {
  it('switches explicitly between the fixed global entry and a scene', () => {
    const sceneId = useEditorStore.getState().activeSceneId
    render(<ScenePanel />)

    fireEvent.click(screen.getByTestId('global-layer-entry'))
    expect(useEditorStore.getState().editingScope).toBe('global')
    expect(screen.getByTestId('global-layer-entry')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByTestId(`scene-item-${sceneId}`))
    expect(useEditorStore.getState().editingScope).toBe('scene')
  })

  it('shows native elements and only enables global-compatible component packages', () => {
    const globalPackage = componentPackage('com.example.global', ['scene', 'global'])
    const scenePackage = componentPackage('com.example.scene', ['scene'])
    const store = useEditorStore.getState()
    store.importComponentPackage(globalPackage)
    store.importComponentPackage(scenePackage)
    store.setEditingScope('global')

    render(<ElementsTab onAddImage={vi.fn()} />)

    expect(screen.getByTestId('add-text')).toBeInTheDocument()
    expect(screen.getByTestId('global-elements-notice')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('add-text'))
    cleanup()

    render(<ComponentsTab />)
    expect(
      screen.getByTestId(`component-${globalPackage.manifest.id}`),
    ).toBeEnabled()
    expect(
      screen.getByTestId(`component-${scenePackage.manifest.id}`),
    ).toBeDisabled()

    fireEvent.click(
      screen.getByTestId(`component-${globalPackage.manifest.id}`),
    )
    expect(projectedGlobalLayer(useEditorStore.getState())).toHaveLength(3)
    expect(
      projectedGlobalLayer(useEditorStore.getState()).map((item) => item.node.type),
    ).toEqual(['teacher-controller', 'text', 'external-component'])
  })

  it('edits global placement, every component copy field, and both runtime content tables', () => {
    const globalPackage = componentPackage('com.example.global', ['global'])
    const store = useEditorStore.getState()
    store.importComponentPackage(globalPackage)
    store.addScene()
    const [firstScene, secondScene] = selectSlideSceneList(useEditorStore.getState())
    const sceneRuntime = runtime('场景运行时标题', '场景原文')
    const globalRuntime = runtime('全局运行时标题', '全局原文')
    installRuntimeDefinitions(firstScene!.id, sceneRuntime, globalRuntime)
    store.setEditingScope('global')
    useEditorStore.getState().addExternalComponentNode(globalPackage.manifest.id)
    const globalNode = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'external-component',
    )!.node
    const locationId = selectActiveCourseLocationId(useEditorStore.getState())
    if (!locationId) throw new Error('缺少当前课程位置')
    store.activateCourseLocation(locationId)
    store.setEditingScope('global')
    store.selectNode(globalNode.id)
    const refreshed = useEditorStore.getState()
    const canonicalProject = selectActiveCourseProjectDocument(refreshed)
    if (!canonicalProject || !refreshed.courseAuthoringSession) {
      throw new Error('缺少当前 Course Project 作者会话')
    }
    expect(selectRuntimeInspectorAuthoringView({
      project: canonicalProject,
      locationId,
      editingScope: 'global',
      activeStateId: null,
      sessionToken: refreshed.courseAuthoringSession.token,
    })).toMatchObject({ availability: 'available' })

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByTestId('global-layer-settings')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('场景可见范围'), {
      target: { value: 'include' },
    })
    expect(projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === globalNode.id,
    )?.visibility).toEqual({ mode: 'all', sceneIds: [] })
    expect(screen.getByText('选择至少一个场景后，可见范围才会生效。'))
      .toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByLabelText(new RegExp(secondScene!.name)))
    fireEvent.change(screen.getByLabelText('导航标题'), {
      target: { value: '教师全局导航' },
    })
    fireEvent.change(screen.getByLabelText('下一页按钮'), {
      target: { value: '继续课程' },
    })
    fireEvent.change(screen.getByLabelText('buttons / replay'), {
      target: { value: '重新讲解' },
    })

    const placement = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === globalNode.id,
    )!
    expect(placement).toMatchObject({
      layer: 'overlay',
      visibility: { mode: 'include', sceneIds: [secondScene!.id] },
      node: {
        id: globalNode.id,
        props: {
          content: {
            title: '教师全局导航',
            buttons: { replay: '重新讲解', next: '继续课程' },
          },
        },
      },
    })

    act(() => useEditorStore.getState().selectNode(null))
    expect(screen.getByTestId('global-runtime-inspector')).toBeInTheDocument()
    const globalRuntimeBefore = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )?.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    if (globalRuntimeBefore?.kind !== 'runtime') {
      throw new Error('缺少 canonical 全局 Runtime')
    }
    const visibleBefore = globalRuntimeBefore.visible
    fireEvent.click(screen.getByLabelText('启用运行时'))
    const disabledGlobalRuntime = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )?.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    expect(disabledGlobalRuntime).toMatchObject({
      kind: 'runtime',
      visible: visibleBefore,
      runtime: { enabled: false, renderMode: 'dom' },
    })
    fireEvent.change(screen.getByLabelText('渲染能力声明'), {
      target: { value: 'hybrid' },
    })
    const hybridGlobalRuntime = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )?.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    expect(hybridGlobalRuntime).toMatchObject({
      kind: 'runtime',
      visible: visibleBefore,
      runtime: {
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        enabled: false,
        renderMode: 'hybrid',
      },
    })
    fireEvent.change(screen.getByLabelText('全局运行时标题'), {
      target: { value: '全局新标题' },
    })
    fireEvent.blur(screen.getByLabelText('全局运行时标题'))
    fireEvent.change(screen.getByLabelText('全局运行时标题操作'), {
      target: { value: '统一开始' },
    })
    fireEvent.blur(screen.getByLabelText('全局运行时标题操作'))
    const updatedGlobalRuntime = selectActiveCourseProjectDocument(useEditorStore.getState())
      ?.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    if (updatedGlobalRuntime?.kind !== 'runtime') throw new Error('缺少全局 Runtime')
    expect(updatedGlobalRuntime.runtime.content.values).toEqual({
      title: '全局新标题',
      action: '统一开始',
    })
    expect(updatedGlobalRuntime.runtime.source).toBe(globalRuntime.source)

    const projectAfterGlobalEdit = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )
    const firstSceneLocation = projectAfterGlobalEdit?.locations.find(
      (location) => location.kind === 'slide-scene'
        && location.sceneId === firstScene!.id,
    )
    if (!firstSceneLocation) throw new Error('缺少首场景课程位置')
    act(() => {
      useEditorStore.getState().activateCourseLocation(firstSceneLocation.id)
      useEditorStore.getState().setEditingScope('scene')
    })
    expect(screen.getByTestId('scene-runtime-inspector')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('场景运行时标题'), {
      target: { value: '场景新标题' },
    })
    fireEvent.blur(screen.getByLabelText('场景运行时标题'))
    fireEvent.change(screen.getByLabelText('场景运行时标题操作'), {
      target: { value: '进入互动' },
    })
    fireEvent.blur(screen.getByLabelText('场景运行时标题操作'))
    const updatedSceneRuntime = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )?.surfaces.flatMap((surface) => (
      surface.type === 'slide' ? surface.scenes : []
    )).find((scene) => scene.id === firstScene!.id)
      ?.layerItems.find((item) => item.kind === 'runtime')
    if (!updatedSceneRuntime || updatedSceneRuntime.kind !== 'runtime') {
      throw new Error('缺少场景 Runtime')
    }
    expect(updatedSceneRuntime.runtime.content.values).toEqual({
      title: '场景新标题',
      action: '进入互动',
    })
    expect(updatedSceneRuntime.runtime.source).toBe(sceneRuntime.source)
  })

  it('keeps an API 3 global Runtime exact and reachable from a Flow location', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    const canonical = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!canonical) throw new Error('缺少 Flow Course Project')
    const api3Project = structuredClone(canonical)
    const source = 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return{destroy(){}}}})'
    api3Project.globalLayerItems.push({
      item: {
        kind: 'runtime',
        layerItemId: 'flow-global-api-3-runtime',
        label: 'Flow 全局 API 3 Runtime',
        frame: { mode: 'absolute', x: 120, y: 80, width: 640, height: 360 },
        order: 99,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'surface',
        playbackInitialVisibility: 'inherit',
        runtime: {
          protocol: 'surface-runtime',
          runtimeApiVersion: 3,
          enabled: false,
          renderMode: 'dom',
          source,
          content: {
            values: { title: '曲面运行时', action: '开始' },
            metadata: {
              title: { label: 'API 3 全局标题' },
              action: { label: 'API 3 全局操作' },
            },
          },
          assets: {},
        },
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    const visibleBefore = true

    useEditorStore.getState().loadCourseProject(api3Project, null, {}, {})
    useEditorStore.getState().activateCourseLocation(api3Project.startLocationId)
    useEditorStore.getState().selectNode(null)
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.setState({ editorMode: 'professional' })
    const flowSession = useEditorStore.getState().flowSession
    if (!flowSession) throw new Error('缺少 Flow session')
    useEditorStore.getState().applyFlowSelection(
      clearFlowEditorSelection(
        flowSession.history.present,
        flowSession.selection.locationId,
        'global',
      ),
    )
    expect(useEditorStore.getState().flowSession?.selection.authoringScope)
      .toBe('global')

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByTestId('global-runtime-inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('scene-runtime-inspector')).not.toBeInTheDocument()
    expect(screen.getByText('surface-runtime · API 3')).toBeInTheDocument()
    expect(screen.getByLabelText('启用运行时')).not.toBeChecked()
    const renderMode = screen.getByLabelText<HTMLSelectElement>('渲染能力声明')
    expect(renderMode).toBeDisabled()
    expect(renderMode).toHaveValue('dom')
    expect(renderMode.options).toHaveLength(1)
    expect(screen.getByLabelText('API 3 全局标题')).toHaveValue('曲面运行时')

    fireEvent.click(screen.getByLabelText('启用运行时'))

    const updated = selectActiveCourseProjectDocument(
      useEditorStore.getState(),
    )?.globalLayerItems.find((entry) => entry.item.kind === 'runtime')?.item
    expect(updated).toMatchObject({
      kind: 'runtime',
      visible: visibleBefore,
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        enabled: true,
        renderMode: 'dom',
        source,
        content: {
          values: {
            title: '曲面运行时',
            action: '开始',
          },
        },
      },
    })
  })

  it('keeps the global Runtime inspector above a retained Spatial graph selection', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addTextNode()
    useEditorStore.getState().addTextNode()
    const canonical = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!canonical) throw new Error('缺少 Spatial Course Project')
    const spatialProject = structuredClone(canonical)
    const spatialSurface = spatialProject.surfaces.find(
      (surface) => surface.type === 'spatial-2d',
    )
    if (spatialSurface?.type !== 'spatial-2d') {
      throw new Error('缺少 Spatial surface')
    }
    const waypointIds = spatialSurface.world.layerItems.map((item) => item.layerItemId)
    if (waypointIds.length < 2) throw new Error('缺少可组成路径的 world 图层项')
    spatialSurface.world.paths = [{
      id: 'retained-spatial-path',
      name: '保留路线',
      layerItemIds: waypointIds,
    }]
    spatialProject.globalLayerItems.push({
      item: {
        kind: 'runtime',
        layerItemId: 'spatial-global-runtime',
        label: 'Spatial 全局 Runtime',
        frame: { mode: 'absolute', x: 80, y: 60, width: 640, height: 360 },
        order: 100001,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'surface',
        playbackInitialVisibility: 'inherit',
        runtime: {
          protocol: 'canvas-runtime',
          runtimeApiVersion: 2,
          enabled: true,
          renderMode: 'hybrid',
          source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
          content: { values: {} },
          assets: {},
        },
      },
      visibility: { mode: 'all', locationIds: [] },
    })

    useEditorStore.getState().loadCourseProject(spatialProject, null, {}, {})
    useEditorStore.getState().activateCourseLocation(spatialProject.startLocationId)
    useEditorStore.getState().setEditingScope('global')
    useEditorStore.getState().setSpatialGraphSelection({
      kind: 'path',
      id: 'retained-spatial-path',
    })
    useEditorStore.setState({ editorMode: 'professional' })
    useEditorStore.getState().selectNode(null)
    expect(useEditorStore.getState()).toMatchObject({
      editingScope: 'global',
      spatialGraphSelection: {
        kind: 'path',
        id: 'retained-spatial-path',
      },
    })

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    expect(screen.getByTestId('global-runtime-inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('scene-runtime-inspector')).not.toBeInTheDocument()
    expect(screen.getByText('canvas-runtime · API 2')).toBeInTheDocument()
  })

  it('offers a state-free scene directory and keeps fixed scene targets as an advanced action', () => {
    const store = useEditorStore.getState()
    store.addScene()
    const targetSceneId = useEditorStore.getState().activeSceneId
    store.addPresentationState('反馈')
    const targetStateId = useEditorStore.getState().activePresentationStateId!
    store.setEditingScope('global')
    const controller = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.type === 'teacher-controller',
    )!.node
    store.selectNode(controller.id)

    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    const actionSelects = screen.getAllByLabelText<HTMLSelectElement>('点击动作')
    expect(actionSelects.some((select) => select.value === 'scene.open-picker')).toBe(true)
    expect(screen.queryByLabelText('目标场景')).not.toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: '打开场景目录' }).length)
      .toBeGreaterThan(0)
    expect(screen.getAllByRole('option', {
      name: '跳转到指定场景（高级）',
    }).length).toBeGreaterThan(0)

    const defaultCollapsedCheckbox = screen.getByLabelText<HTMLInputElement>(
      '打开课件时默认折叠',
    )
    expect(defaultCollapsedCheckbox).toBeChecked()
    fireEvent.click(defaultCollapsedCheckbox)
    expect(defaultCollapsedCheckbox).not.toBeChecked()
    fireEvent.change(screen.getAllByLabelText('点击动作')[0]!, {
      target: { value: 'scene.go' },
    })
    fireEvent.change(screen.getByLabelText('目标场景'), {
      target: { value: targetSceneId },
    })
    fireEvent.change(screen.getByLabelText('进入状态'), {
      target: { value: targetStateId },
    })
    fireEvent.click(screen.getByRole('button', { name: /添加按钮/ }))

    const updated = projectedGlobalLayer(useEditorStore.getState()).find(
      (item) => item.node.id === controller.id,
    )!.node
    if (updated.type !== 'teacher-controller') throw new Error('缺少教师控制器')
    expect(updated).toMatchObject({
      collapsible: true,
      defaultCollapsed: false,
    })
    expect(updated.buttons?.[0]?.action).toEqual({
      type: 'scene.go',
      sceneId: targetSceneId,
      targetStateId,
    })
    expect(updated.buttons?.at(-1)?.action).toEqual({
      type: 'scene.open-picker',
    })
    expect(updated.buttons).toHaveLength(8)
    expect(new Set((updated.buttons ?? []).map((button) => button.id)).size).toBe(8)
  })

  it('writes 图层位置 as one undoable global plane without changing authored order', () => {
    const store = useEditorStore.getState()
    store.setEditingScope('global')
    store.addTextNode()
    const before = selectSlideAuthoringDocument(useEditorStore.getState())!
    const text = before.globalLayerItems.find(
      (entry) => entry.item.kind === 'native' && entry.item.content.nativeType === 'text',
    )
    if (!text) throw new Error('missing global text')
    expect(text.plane).toBe('overlay')
    const beforeOrders = JSON.stringify({
      global: before.globalLayerItems.map((entry) => [entry.item.layerItemId, entry.item.order]),
      surfaces: before.surfaces.map((surface) => ({
        surface: surface.surfaceLayerItems.map((entry) => [entry.item.layerItemId, entry.item.order]),
        local: surface.type === 'slide'
          ? surface.scenes.map((scene) => scene.layerItems.map((item) => [item.layerItemId, item.order]))
          : surface.type === 'spatial-2d'
            ? surface.world.layerItems.map((item) => [item.layerItemId, item.order])
            : [],
      })),
    })
    const historyBefore = selectSlideAuthoringBackend(useEditorStore.getState())!
      .getSession().history.past.length
    store.selectNode(text.item.layerItemId)

    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    expect(screen.getByTestId('global-layer-settings')).toBeInTheDocument()
    expect(screen.getByLabelText('图层位置')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('图层位置'), {
      target: { value: 'underlay' },
    })

    const after = selectSlideAuthoringDocument(useEditorStore.getState())!
    const updated = after.globalLayerItems.find(
      (entry) => entry.item.layerItemId === text.item.layerItemId,
    )
    expect(updated?.plane).toBe('underlay')
    expect(after.surfaces.some((surface) => (
      surface.type === 'slide'
      && surface.scenes.some((scene) => (
        scene.layerItems.some((item) => item.layerItemId === text.item.layerItemId)
      ))
    ))).toBe(false)
    expect(JSON.stringify({
      global: after.globalLayerItems.map((entry) => [entry.item.layerItemId, entry.item.order]),
      surfaces: after.surfaces.map((surface) => ({
        surface: surface.surfaceLayerItems.map((entry) => [entry.item.layerItemId, entry.item.order]),
        local: surface.type === 'slide'
          ? surface.scenes.map((scene) => scene.layerItems.map((item) => [item.layerItemId, item.order]))
          : surface.type === 'spatial-2d'
            ? surface.world.layerItems.map((item) => [item.layerItemId, item.order])
            : [],
      })),
    })).toBe(beforeOrders)
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!
      .getSession().history.past.length).toBe(historyBefore + 1)

    store.undo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === text.item.layerItemId,
    )?.plane).toBe('overlay')
    store.redo()
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === text.item.layerItemId,
    )?.plane).toBe('underlay')
    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(archive).not.toBeNull()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(archive!)).toBe(true)
    expect(selectSlideAuthoringDocument(useEditorStore.getState())?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === text.item.layerItemId,
    )?.plane).toBe('underlay')
    expect(useEditorStore.getState().errorMessage).toBeNull()
  })
})
