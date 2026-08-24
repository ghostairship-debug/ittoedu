import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import type { AssetMeta } from '@/shared/projectTypes'
import { constrainTeacherControllerAuthoringFrame } from '@/shared/teacherControllerLayout'
import { stageResizeHandleWorldPoint, worldToClient } from '@/renderer/authoring/stageViewportTransform'
import { createSpatialWorldAuthoringController } from '@/renderer/authoring/spatialWorldAuthoring'
import {
  openSpatialAuthoringSession,
  setSpatialEditingScope,
} from '@/renderer/course/spatialEditorCommands'
import { createSpatialWorldViewTransform } from '@/renderer/course/spatialEditorView'
import { addSpatialPathInSession } from '@/renderer/course/spatialPathCommands'
import { addSpatialRelationInSession } from '@/renderer/course/spatialRelationCommands'
import {
  addSpatialCameraFrameFromSession,
  deleteSpatialCameraFrameInSession,
} from '@/renderer/course/spatialCameraCommands'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import {
  selectActiveCourseProjectDocument,
  selectEditingNodes,
  selectEffectiveLayerProjection,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { MediaTab } from '@/renderer/ui/MediaTab'
import { ComponentsTab } from '@/renderer/ui/ComponentsTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { TopToolbar } from '@/renderer/ui/TopToolbar'
import type { SpatialAuthoringSession } from '@/renderer/course/spatialEditorCommands'
import App from '@/renderer/App'

vi.mock('@/renderer/export/loadPlayerBundle', () => ({
  loadPlayerBundle: () => 'window.__coursePlayerTestBundle = true',
}))
vi.mock('@/renderer/export/renderSceneImages', () => ({
  renderProjectSceneImages: vi.fn(async () => []),
  renderProjectSceneImagesWithRuntime: vi.fn(async () => []),
}))
vi.mock('@/renderer/ui/Workspace', () => ({
  Workspace: () => null,
}))

const VIEWPORT = { x: 0, y: 0, width: 800, height: 450 }
const IMAGE_ASSET: AssetMeta = {
  id: 'spatial-owner-image',
  filename: 'owner.png',
  mimeType: 'image/png',
  kind: 'image',
  path: 'assets/owner.png',
  byteLength: 4,
  width: 640,
  height: 360,
}
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4])
const VIDEO_ASSET: AssetMeta = {
  id: 'spatial-owner-video',
  filename: 'owner.mp4',
  mimeType: 'video/mp4',
  kind: 'video',
  path: 'assets/owner.mp4',
  byteLength: 4,
  width: 640,
  height: 360,
  duration: 12,
}
const VIDEO_BYTES = new Uint8Array([5, 6, 7, 8])

function spatialComponentPackage(
  packageId: string,
  supportedScopes: Array<'scene' | 'global'>,
): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: packageId,
      name: packageId.endsWith('scene') ? '世界组件' : '全局组件',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 360, height: 220 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: true,
      assets: {},
      defaultProps: { label: '默认' },
      supportedScopes,
      renderMode: 'phaser',
      ...(supportedScopes.includes('scene')
        ? { presets: [{ id: 'ready', label: '即用', props: { label: '预设' } }] }
        : {}),
    },
    runtimeSource: 'window.CoursewareComponent.define({ runtimeApiVersion: 4 })',
    files: {},
  }
}

function setSpatialScope(scope: 'world' | 'surface' | 'global') {
  act(() => {
    useEditorStore.getState().runSpatialCommand((session) => setSpatialEditingScope(session, scope))
  })
}

function spatialDocument() {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected course document')
  return document
}

function spatialSurface() {
  const surface = spatialDocument().surfaces.find((candidate) => candidate.type === 'spatial-2d')
  if (!surface || surface.type !== 'spatial-2d') throw new Error('expected spatial surface')
  return surface
}

function storeHost() {
  return {
    getSession: () => {
      const session = useEditorStore.getState().spatialSession
      if (!session) throw new Error('not-spatial-session')
      return session
    },
    setSession: (next: SpatialAuthoringSession) => {
      const previous = useEditorStore.getState().spatialSession
      useEditorStore.getState().applySpatialAuthoringSession(next, {
        historyEntry: Boolean(
          previous && next.history.present.revision !== previous.history.present.revision,
        ),
      })
    },
  }
}

function mixedOwnerSelectionFixture() {
  const store = useEditorStore.getState()
  store.createNewProject()
  store.setEditingScope('global')
  useEditorStore.getState().addTextNode()
  const slideDocument = spatialDocument()
  const globalTextId = slideDocument.globalLayerItems.find((entry) => (
    entry.item.kind === 'native' && entry.item.content.nativeType === 'text'
  ))?.item.layerItemId
  if (!globalTextId) throw new Error('expected global text')

  useEditorStore.getState().setEditingScope('scene')
  useEditorStore.getState().addCourseContent('spatial-page')
  useEditorStore.getState().addTextNode()
  useEditorStore.getState().addTextNode()
  const spatialSession = useEditorStore.getState().spatialSession
  if (!spatialSession) throw new Error('expected Spatial session')
  const locationId = spatialSession.selection.locationId
  const document = structuredClone(spatialSession.history.present)
  const surface = document.surfaces.find((candidate) => (
    candidate.type === 'spatial-2d' && candidate.id === spatialSession.selection.surfaceId
  ))
  if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
  const surfaceItem = surface.world.layerItems.pop()
  const worldItem = surface.world.layerItems[0]
  if (!surfaceItem || !worldItem) throw new Error('expected two Spatial world items')
  surface.surfaceLayerItems.push({
    item: surfaceItem,
    visibility: { mode: 'all', locationIds: [] },
  })
  const propertyTextItems = [
    document.globalLayerItems.find((entry) => entry.item.layerItemId === globalTextId)?.item,
    surfaceItem,
    worldItem,
  ]
  for (const item of propertyTextItems) {
    if (item?.kind === 'native' && item.content.nativeType === 'text') {
      item.content.data.style.overflow = 'fixed'
    }
  }
  useEditorStore.getState().applySpatialAuthoringSession(openSpatialAuthoringSession(document, {
    locationId,
  }))
  return {
    globalTextId,
    surfaceId: surface.id,
    surfaceItemId: surfaceItem.layerItemId,
    worldItemId: worldItem.layerItemId,
  }
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().createNewProject()
})

describe('Spatial product shell wiring', () => {
  it('keeps default new project on Slide and adds a visible blank Spatial entry', () => {
    const slide = spatialDocument()
    expect(slide.surfaces[0]?.type).toBe('slide')
    expect(useEditorStore.getState().spatialSession).toBeNull()

    render(
      <TopToolbar
        busy={false}
        onNew={() => useEditorStore.getState().createNewProject()}
        onNewSpatial={() => useEditorStore.getState().createNewSpatialProject()}
        onOpen={() => undefined}
        recentProjects={[]}
        onOpenRecent={() => undefined}
        onSave={() => undefined}
        healthSummary={{ error: 0, warning: 0, info: 0, total: 0, canExport: true }}
        onOpenHealth={() => undefined}
        onPreview={() => undefined}
        onExport={() => undefined}
      />,
    )
    fireEvent.click(screen.getByTestId('new-spatial-project'))
    const spatial = spatialDocument()
    expect(spatial.surfaces[0]?.type).toBe('spatial-2d')
    expect(useEditorStore.getState().spatialSession).not.toBeNull()
  })

  it('enables quick insertion only for the actual Spatial world owner', () => {
    useEditorStore.getState().createNewSpatialProject()
    const onAddImage = vi.fn()
    const onAddVideo = vi.fn()
    render(<ElementsTab onAddImage={onAddImage} onAddVideo={onAddVideo} />)

    const quickIds = ['add-text', 'add-formula', 'add-image', 'add-video', 'add-rectangle']
    for (const testId of quickIds) {
      const button = screen.getByTestId(testId)
      expect(button).toBeEnabled()
      expect(button).toHaveAttribute('draggable', 'false')
      expect(button).toHaveAttribute('data-insertion-carrier', 'world-item')
    }

    setSpatialScope('surface')
    expect(screen.getByTestId('surface-insertion-hint')).toHaveTextContent('表面共享层暂不支持插入')
    const surfaceSession = useEditorStore.getState().spatialSession
    for (const testId of quickIds) {
      const button = screen.getByTestId(testId)
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('draggable', 'false')
      expect(button).toHaveAttribute('data-insertion-carrier', 'unavailable')
      expect(button).toHaveAttribute('title', expect.stringContaining('表面共享层'))
      fireEvent.click(button)
    }
    expect(useEditorStore.getState().spatialSession).toBe(surfaceSession)
    expect(onAddImage).not.toHaveBeenCalled()
    expect(onAddVideo).not.toHaveBeenCalled()

    setSpatialScope('global')
    expect(screen.getByTestId('surface-insertion-hint')).toHaveTextContent('无限画布全局层暂不支持插入')
    const globalSession = useEditorStore.getState().spatialSession
    for (const testId of quickIds) {
      const button = screen.getByTestId(testId)
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('data-insertion-carrier', 'unavailable')
      expect(button).toHaveAttribute('title', expect.stringContaining('无限画布全局层'))
      fireEvent.click(button)
    }
    expect(useEditorStore.getState().spatialSession).toBe(globalSession)
  })

  it('keeps Spatial media management but prevents global and surface placement with zero writes', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().importAsset(IMAGE_ASSET, IMAGE_BYTES)
    useEditorStore.getState().importAsset(VIDEO_ASSET, VIDEO_BYTES)
    const onImportImage = vi.fn()
    const onImportAudio = vi.fn()
    const onImportVideo = vi.fn()
    render(
      <MediaTab
        onImportImage={onImportImage}
        onImportAudio={onImportAudio}
        onImportVideo={onImportVideo}
      />,
    )

    const insertImage = screen.getByTestId(`insert-flow-media-${IMAGE_ASSET.id}`)
    const insertVideo = screen.getByTestId(`insert-flow-media-${VIDEO_ASSET.id}`)
    const insertButtons = [insertImage, insertVideo]
    const beforeWorld = useEditorStore.getState().spatialSession!
    const beforeWorldCount = spatialSurface().world.layerItems.length
    insertButtons.forEach((button) => expect(button).toBeEnabled())
    fireEvent.click(insertImage)
    fireEvent.click(insertVideo)
    const afterWorld = useEditorStore.getState().spatialSession!
    expect(afterWorld.history.present.revision).toBe(beforeWorld.history.present.revision + 2)
    expect(afterWorld.history.past).toHaveLength(beforeWorld.history.past.length + 2)
    expect(spatialSurface().world.layerItems).toHaveLength(beforeWorldCount + 2)
    const insertedMedia = spatialSurface().world.layerItems.slice(-2)
    expect(insertedMedia[0]).toMatchObject({ kind: 'native', content: { nativeType: 'image' } })
    expect(insertedMedia[1]).toMatchObject({ kind: 'native', content: { nativeType: 'video' } })
    expect(afterWorld.selection.selectionIds).toEqual([insertedMedia[1]!.layerItemId])

    setSpatialScope('surface')
    const surfaceSession = useEditorStore.getState().spatialSession
    insertButtons.forEach((button) => {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', expect.stringContaining('表面共享层'))
      fireEvent.click(button)
    })
    expect(screen.getByTestId(`media-placement-reason-${IMAGE_ASSET.id}`))
      .toHaveTextContent('请切换到无限画布世界层')
    expect(useEditorStore.getState().spatialSession).toBe(surfaceSession)

    setSpatialScope('global')
    const globalSession = useEditorStore.getState().spatialSession
    insertButtons.forEach((button) => {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', expect.stringContaining('无限画布全局层'))
      fireEvent.click(button)
    })
    expect(useEditorStore.getState().spatialSession).toBe(globalSession)

    fireEvent.click(screen.getByRole('button', { name: '导入图片' }))
    fireEvent.click(screen.getByRole('button', { name: '导入声音' }))
    fireEvent.click(screen.getByRole('button', { name: '导入视频' }))
    expect(onImportImage).toHaveBeenCalledOnce()
    expect(onImportAudio).toHaveBeenCalledOnce()
    expect(onImportVideo).toHaveBeenCalledOnce()
  })

  it('inserts only scene-compatible components into the Spatial world and never exposes Spatial drag', () => {
    const scenePackageId = 'com.example.spatial.scene'
    const globalPackageId = 'com.example.spatial.global'
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().importComponentPackages([
      spatialComponentPackage(scenePackageId, ['scene']),
      spatialComponentPackage(globalPackageId, ['global']),
    ])
    const onImportExternalComponents = vi.fn()
    render(<ComponentsTab onImportExternalComponents={onImportExternalComponents} />)

    const sceneButton = screen.getByTestId(`component-${scenePackageId}`)
    const globalButton = screen.getByTestId(`component-${globalPackageId}`)
    const scenePreset = within(screen.getByLabelText('世界组件预设'))
      .getByRole('button', { name: '即用' })
    expect(sceneButton).toBeEnabled()
    expect(sceneButton).toHaveAttribute('draggable', 'false')
    expect(scenePreset).toBeEnabled()
    expect(scenePreset).toHaveAttribute('draggable', 'false')
    expect(globalButton).toBeDisabled()
    expect(globalButton).toHaveAttribute('draggable', 'false')
    expect(globalButton).toHaveAttribute('title', expect.stringContaining('未声明支持场景层'))

    const beforeWorld = useEditorStore.getState().spatialSession!
    fireEvent.click(sceneButton)
    const afterWorld = useEditorStore.getState().spatialSession!
    expect(afterWorld.history.present.revision).toBe(beforeWorld.history.present.revision + 1)
    expect(afterWorld.history.past).toHaveLength(beforeWorld.history.past.length + 1)
    const inserted = spatialSurface().world.layerItems.at(-1)!
    expect(inserted).toMatchObject({
      kind: 'component',
      component: { packageId: scenePackageId },
    })
    expect(afterWorld.selection.selectionIds).toEqual([inserted.layerItemId])

    setSpatialScope('surface')
    const surfaceSession = useEditorStore.getState().spatialSession
    expect(sceneButton).toBeDisabled()
    expect(scenePreset).toBeDisabled()
    expect(sceneButton).toHaveAttribute('title', expect.stringContaining('表面共享层'))
    fireEvent.click(sceneButton)
    fireEvent.click(scenePreset)
    expect(useEditorStore.getState().spatialSession).toBe(surfaceSession)

    setSpatialScope('global')
    const globalSession = useEditorStore.getState().spatialSession
    expect(sceneButton).toBeDisabled()
    expect(scenePreset).toBeDisabled()
    expect(sceneButton).toHaveAttribute('title', expect.stringContaining('无限画布全局层'))
    fireEvent.click(sceneButton)
    fireEvent.click(scenePreset)
    expect(useEditorStore.getState().spatialSession).toBe(globalSession)

    fireEvent.click(screen.getByTestId('import-external-components'))
    expect(onImportExternalComponents).toHaveBeenCalledOnce()
  })

  it('notifies Zustand after inserting world text and keeps cameras after archive reopen', () => {
    useEditorStore.getState().createNewSpatialProject()
    const startRevision = spatialDocument().revision
    let notifications = 0
    const unsubscribe = useEditorStore.subscribe(() => {
      notifications += 1
    })
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    fireEvent.click(screen.getByTestId('add-text'))
    unsubscribe()
    expect(useEditorStore.getState().errorMessage).toBeNull()
    expect(notifications).toBeGreaterThan(0)
    expect(spatialDocument().revision).toBe(startRevision + 2)
    expect(selectEditingNodes(useEditorStore.getState()).filter((node) => node.type === 'text')).toHaveLength(2)

    const firstFrameCount = spatialSurface().camera.frames.length
    fireEvent.click(screen.getByTestId('add-text'))
    render(<ScenePanel />)
    fireEvent.click(screen.getByTestId('add-spatial-camera'))
    fireEvent.click(screen.getByTestId('add-spatial-camera'))
    expect(spatialSurface().camera.frames.length).toBe(firstFrameCount + 2)

    const ids = spatialSurface().world.layerItems.map((item) => item.layerItemId)
    useEditorStore.getState().runSpatialCommand((session) => addSpatialPathInSession(session, {
      name: '食物网路径',
      layerItemIds: ids.slice(0, Math.min(2, ids.length)),
    }))
    const bytes = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(bytes).toBeTruthy()
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().spatialSession).toBeNull()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(bytes!)).toBe(true)
    expect(spatialSurface().camera.frames.length).toBe(firstFrameCount + 2)
    expect(spatialSurface().world.paths?.some((path) => path.name === '食物网路径')).toBe(true)
  })

  it('shows 本页镜头, page camera/path sections, hides path editor on text, and keeps paths out of Nodes', () => {
    useEditorStore.getState().createNewSpatialProject()
    render(<ScenePanel />)
    expect(screen.getByText('本页镜头')).toBeTruthy()
    expect(screen.queryByTestId('add-scene')).toBeNull()

    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByRole('heading', { name: '镜头调度' })).toBeTruthy()
    expect(screen.getByText('路径与关系')).toBeTruthy()
    expect(screen.getByText('语义缩放')).toBeTruthy()

    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    fireEvent.click(screen.getByTestId('add-text'))
    const textId = selectEditingNodes(useEditorStore.getState())[0]?.id
    expect(textId).toBeTruthy()
    useEditorStore.getState().selectNode(textId!)
    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByRole('heading', { name: '镜头调度' })).toBeNull()
    expect(screen.queryByText('路径与关系')).toBeNull()
    expect(screen.queryByLabelText('播放路径')).toBeNull()

    const ids = spatialSurface().world.layerItems.map((item) => item.layerItemId)
    useEditorStore.getState().runSpatialCommand((session) => addSpatialPathInSession(session, {
      name: '不应出现在图层',
      layerItemIds: ids.slice(0, 1),
    }))
    useEditorStore.getState().runSpatialCommand((session) => addSpatialRelationInSession(session, {
      sourceLayerItemId: ids[0]!,
      targetLayerItemId: ids[1] ?? ids[0]!,
      kind: 'arrow',
    }))
    const pathId = spatialSurface().world.paths?.[0]?.id
    render(<NodesTab />)
    expect(screen.queryByText('不应出现在图层')).toBeNull()
    if (pathId) expect(screen.queryByTestId(`node-item-${pathId}`)).toBeNull()
  })

  it('commits west resize once and does not write revision for G1 camera frames', () => {
    useEditorStore.getState().createNewSpatialProject()
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    const item = spatialSurface().world.layerItems[0]
    expect(item).toBeTruthy()
    useEditorStore.getState().selectNode(item!.layerItemId)
    const startRevision = spatialDocument().revision
    const controller = createSpatialWorldAuthoringController(storeHost())
    controller.zoomSession(2, VIEWPORT)
    expect(spatialDocument().revision).toBe(startRevision)
    expect(useEditorStore.getState().spatialSession?.sessionCamera.zoom).toBe(2)

    const west = stageResizeHandleWorldPoint({
      x: item!.frame.x,
      y: item!.frame.y,
      width: item!.frame.width,
      height: item!.frame.height,
    }, 'w')
    const westClient = worldToClient(
      createSpatialWorldViewTransform(VIEWPORT, useEditorStore.getState().spatialSession!.sessionCamera),
      west,
    )
    controller.pointerDown({ x: westClient.x, y: westClient.y }, VIEWPORT)
    expect(spatialDocument().revision).toBe(startRevision)
    controller.pointerMove({ x: westClient.x - 40, y: westClient.y }, VIEWPORT)
    expect(spatialDocument().revision).toBe(startRevision)
    controller.pointerUp({ x: westClient.x - 40, y: westClient.y }, VIEWPORT)
    expect(spatialDocument().revision).toBe(startRevision + 1)

    useEditorStore.getState().selectNode(null)
    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const framesToggle = screen.getByLabelText('显示镜头框')
    expect(useEditorStore.getState().spatialSession?.showCameraFrames).toBe(true)
    fireEvent.click(framesToggle)
    expect(useEditorStore.getState().spatialSession?.showCameraFrames).toBe(false)
    expect(spatialDocument().revision).toBe(startRevision + 1)
  })

  it('selects global, surface, and world layer rows in their canonical owner without history writes', () => {
    const fixture = mixedOwnerSelectionFixture()
    const initial = useEditorStore.getState().spatialSession
    if (!initial) throw new Error('expected Spatial session')
    const document = initial.history.present
    const revision = document.revision
    const past = initial.history.past
    const future = initial.history.future
    const locationId = initial.selection.locationId
    const dirty = useEditorStore.getState().dirty
    render(<NodesTab />)

    const clickRow = (
      layerItemId: string,
      options: { ctrlKey?: boolean; shiftKey?: boolean } = {},
    ) => {
      const label = screen.getByTestId(`node-item-${layerItemId}`).querySelector('.node-name')
      if (!label) throw new Error(`expected node label for ${layerItemId}`)
      fireEvent.click(label, { detail: 0, ...options })
    }
    const expectSelectionOnly = (scope: 'global' | 'surface' | 'world', layerItemId: string) => {
      const state = useEditorStore.getState()
      const session = state.spatialSession
      expect(session?.scope).toBe(scope)
      expect(session?.selection.locationId).toBe(locationId)
      expect(session?.selection.selectionIds).toEqual([layerItemId])
      expect(session?.history.present).toBe(document)
      expect(session?.history.present.revision).toBe(revision)
      expect(session?.history.past).toBe(past)
      expect(session?.history.future).toBe(future)
      expect(state.dirty).toBe(dirty)
    }

    clickRow(fixture.globalTextId)
    expectSelectionOnly('global', fixture.globalTextId)
    let projection = selectEffectiveLayerProjection(useEditorStore.getState())
    const globalRow = projection?.unifiedRows.find((row) => row.id === fixture.globalTextId)
    expect(globalRow).toMatchObject({ owner: 'global', ownerKey: 'global', selected: true })
    expect(globalRow?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: document.id,
      scope: 'global',
      carrier: 'native',
      layerItemId: fixture.globalTextId,
      field: 'item',
    }))

    clickRow(fixture.surfaceItemId)
    expectSelectionOnly('surface', fixture.surfaceItemId)
    projection = selectEffectiveLayerProjection(useEditorStore.getState())
    const surfaceRow = projection?.unifiedRows.find((row) => row.id === fixture.surfaceItemId)
    expect(surfaceRow).toMatchObject({
      owner: 'surface',
      ownerKey: `surface:${fixture.surfaceId}`,
      selected: true,
    })
    expect(surfaceRow?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: document.id,
      scope: 'surface',
      surfaceId: fixture.surfaceId,
      carrier: 'native',
      layerItemId: fixture.surfaceItemId,
      field: 'item',
    }))

    clickRow(fixture.worldItemId)
    expectSelectionOnly('world', fixture.worldItemId)
    projection = selectEffectiveLayerProjection(useEditorStore.getState())
    const worldRow = projection?.unifiedRows.find((row) => row.id === fixture.worldItemId)
    expect(worldRow).toMatchObject({
      owner: 'world',
      ownerKey: `world:${fixture.surfaceId}`,
      selected: true,
    })
    expect(worldRow?.authoringAddress).toBe(makeAuthoringAddress({
      projectId: document.id,
      scope: 'surface',
      surfaceId: fixture.surfaceId,
      carrier: 'native',
      layerItemId: fixture.worldItemId,
      field: 'item',
    }))

    const worldText = selectEditingNodes(useEditorStore.getState()).find(
      (node) => node.id === fixture.worldItemId,
    )
    if (!worldText || worldText.type !== 'text') throw new Error('expected Spatial text node')
    useEditorStore.getState().beginTextEdit(fixture.worldItemId, 'canvas')
    const openedEdit = useEditorStore.getState().spatialContentEdit
    if (!openedEdit || openedEdit.kind !== 'text') throw new Error('expected Spatial text edit')
    useEditorStore.getState().updateTextEditDraft(
      fixture.worldItemId,
      `${worldText.text} · 未提交草稿`,
      worldText.runs,
      worldText.height,
      worldText.width,
    )
    const beforeRejectedAdditive = useEditorStore.getState()
    const dirtyEdit = beforeRejectedAdditive.spatialContentEdit
    expect(dirtyEdit?.kind).toBe('text')
    expect(dirtyEdit?.draft).not.toEqual(dirtyEdit?.original)

    clickRow(fixture.globalTextId, { ctrlKey: true })
    expectSelectionOnly('world', fixture.worldItemId)
    const afterRejectedAdditive = useEditorStore.getState()
    expect(afterRejectedAdditive.errorMessage).toMatch(/跨范围多选/)
    expect(afterRejectedAdditive.spatialSession).toBe(beforeRejectedAdditive.spatialSession)
    expect(afterRejectedAdditive.spatialContentEdit).toBe(dirtyEdit)
    expect(afterRejectedAdditive.editingTextNodeId).toBe(fixture.worldItemId)
  })

  it('edits an unselected Spatial row in place without stealing its current selection', () => {
    const fixture = mixedOwnerSelectionFixture()
    act(() => useEditorStore.getState().selectNode(fixture.worldItemId))
    const initial = useEditorStore.getState().spatialSession!
    expect(initial.scope).toBe('world')
    expect(initial.selection.selectionIds).toEqual([fixture.worldItemId])
    render(<NodesTab />)

    const expectSelectionUnchanged = () => {
      const session = useEditorStore.getState().spatialSession!
      expect(session.scope).toBe('world')
      expect(session.selection.selectionIds).toEqual([fixture.worldItemId])
      expect(session.selection.locationId).toBe(initial.selection.locationId)
    }
    const targetBefore = locateCourseLayer(initial.history.present, fixture.surfaceItemId)
    if (!targetBefore) throw new Error('expected surface layer row')
    const originalName = targetBefore.item.label
    const renamed = '未选中共享行'
    const row = screen.getByTestId(`node-item-${fixture.surfaceItemId}`)
    const label = row.querySelector('.node-name')
    if (!label) throw new Error('expected row name')

    fireEvent.doubleClick(label)
    const nameInput = within(row).getByLabelText(`重命名“${originalName}”`)
    fireEvent.change(nameInput, { target: { value: renamed } })
    fireEvent.blur(nameInput)
    const afterRename = useEditorStore.getState().spatialSession!
    expect(afterRename.history.present.revision).toBe(initial.history.present.revision + 1)
    expect(afterRename.history.past).toHaveLength(initial.history.past.length + 1)
    expect(locateCourseLayer(afterRename.history.present, fixture.surfaceItemId)).toMatchObject({
      source: 'surface',
      item: { label: renamed, visible: true, locked: false },
    })
    expectSelectionUnchanged()

    fireEvent.click(within(screen.getByTestId(`node-item-${fixture.surfaceItemId}`))
      .getByRole('button', { name: `隐藏“${renamed}”` }))
    const afterVisible = useEditorStore.getState().spatialSession!
    expect(afterVisible.history.present.revision).toBe(afterRename.history.present.revision + 1)
    expect(afterVisible.history.past).toHaveLength(afterRename.history.past.length + 1)
    expect(locateCourseLayer(afterVisible.history.present, fixture.surfaceItemId)).toMatchObject({
      source: 'surface',
      item: { label: renamed, visible: false, locked: false },
    })
    expectSelectionUnchanged()

    fireEvent.click(within(screen.getByTestId(`node-item-${fixture.surfaceItemId}`))
      .getByRole('button', { name: `锁定“${renamed}”` }))
    const afterLocked = useEditorStore.getState().spatialSession!
    expect(afterLocked.history.present.revision).toBe(afterVisible.history.present.revision + 1)
    expect(afterLocked.history.past).toHaveLength(afterVisible.history.past.length + 1)
    expect(locateCourseLayer(afterLocked.history.present, fixture.surfaceItemId)).toMatchObject({
      source: 'surface',
      item: { label: renamed, visible: false, locked: true },
    })
    expectSelectionUnchanged()
  })

  it('writes visible Spatial common and whole-node text controls to each canonical owner', () => {
    const fixture = mixedOwnerSelectionFixture()
    const cases = [
      { id: fixture.globalTextId, owner: 'global' as const, name: '全课文字属性' },
      { id: fixture.surfaceItemId, owner: 'surface' as const, name: '页面共享文字属性' },
      { id: fixture.worldItemId, owner: 'world' as const, name: '世界文字属性' },
    ]

    for (const item of cases) {
      act(() => useEditorStore.getState().selectNode(item.id))
      cleanup()
      render(<PropertiesTab onReplaceImage={() => undefined} />)
      expect(screen.queryByTestId('simple-entrance-animation')).toBeNull()
      if (item.owner === 'world') {
        expect(screen.getByLabelText('文字内容')).toBeEnabled()
        expect(screen.queryByTestId('spatial-text-content-unavailable')).toBeNull()
      } else {
        expect(screen.queryByLabelText('文字内容')).toBeNull()
        expect(screen.getByTestId('spatial-text-content-unavailable')).toHaveTextContent(
          '只支持整节点文字样式',
        )
      }

      const beforeName = useEditorStore.getState().spatialSession!
      const nameInput = screen.getByLabelText('名称')
      fireEvent.change(nameInput, { target: { value: item.name } })
      fireEvent.blur(nameInput)
      const afterName = useEditorStore.getState().spatialSession!
      expect(afterName.history.present.revision).toBe(beforeName.history.present.revision + 1)
      expect(afterName.history.past).toHaveLength(beforeName.history.past.length + 1)
      expect(locateCourseLayer(afterName.history.present, item.id)).toMatchObject({
        source: item.owner,
        item: { label: item.name },
      })

      const beforeStyle = afterName
      fireEvent.click(screen.getByRole('button', { name: '加粗' }))
      const afterStyle = useEditorStore.getState().spatialSession!
      expect(afterStyle.history.present.revision).toBe(beforeStyle.history.present.revision + 1)
      expect(afterStyle.history.past).toHaveLength(beforeStyle.history.past.length + 1)
      const located = locateCourseLayer(afterStyle.history.present, item.id)
      expect(located?.source).toBe(item.owner)
      expect(located?.item).toMatchObject({
        kind: 'native',
        content: { nativeType: 'text', data: { style: { bold: true } } },
      })
    }
  })

  it('constrains an out-of-bounds global teacher controller Properties write once', () => {
    useEditorStore.getState().createNewSpatialProject()
    const initial = useEditorStore.getState().spatialSession!
    const document = structuredClone(initial.history.present)
    const controller = document.globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))?.item
    if (!controller || controller.kind !== 'native' || controller.content.nativeType !== 'teacher-controller') {
      throw new Error('expected global teacher controller')
    }
    controller.rotation = 37
    controller.locked = false
    act(() => useEditorStore.getState().applySpatialAuthoringSession(openSpatialAuthoringSession(
      document,
      { locationId: initial.selection.locationId },
    )))
    act(() => useEditorStore.getState().selectNode(controller.layerItemId))
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    const before = useEditorStore.getState().spatialSession!
    const locatedBefore = locateCourseLayer(before.history.present, controller.layerItemId)
    if (
      !locatedBefore ||
      locatedBefore.item.kind !== 'native' ||
      locatedBefore.item.content.nativeType !== 'teacher-controller'
    ) {
      throw new Error('expected selected global teacher controller')
    }
    const proposedFrame = { ...locatedBefore.item.frame, x: -5_000 }
    const expectedFrame = constrainTeacherControllerAuthoringFrame(
      locatedBefore.item.content.data,
      proposedFrame,
      locatedBefore.item.rotation,
      { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    )

    const xInput = screen.getByLabelText('X')
    fireEvent.change(xInput, { target: { value: String(proposedFrame.x) } })
    fireEvent.blur(xInput)

    const after = useEditorStore.getState().spatialSession!
    expect(after.history.present.revision).toBe(before.history.present.revision + 1)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(after.selection.selectionIds).toEqual([controller.layerItemId])
    expect(after.scope).toBe('global')
    expect(locateCourseLayer(after.history.present, controller.layerItemId)).toMatchObject({
      source: 'global',
      item: {
        frame: expectedFrame,
        rotation: 37,
      },
    })
    expect(expectedFrame.x).not.toBe(proposedFrame.x)
  })

  it('hides unsupported Spatial type controls and disables non-atomic multi actions', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addImageNode(IMAGE_ASSET, IMAGE_BYTES)
    const image = selectEditingNodes(useEditorStore.getState()).find((node) => node.type === 'image')
    if (!image) throw new Error('expected Spatial image')
    act(() => useEditorStore.getState().selectNode(image.id))
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByLabelText('名称')).toBeEnabled()
    expect(screen.getByTestId('spatial-type-properties-unavailable')).toHaveTextContent(
      '专属属性尚未接入 canonical 历史',
    )
    expect(screen.queryByRole('heading', { name: '图片' })).toBeNull()
    expect(screen.queryByTestId('simple-entrance-animation')).toBeNull()

    cleanup()
    useEditorStore.getState().addTextNode()
    const ids = selectEditingNodes(useEditorStore.getState()).map((node) => node.id)
    act(() => useEditorStore.getState().selectNodes(ids))
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByRole('button', { name: '复制所选' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除所选' })).toBeDisabled()
    expect(screen.getByTestId('spatial-multi-actions-unavailable')).toHaveTextContent(
      '不会执行部分写入',
    )
  })

  it('routes real App Ctrl+C/V/D/Z/Y through the canonical Spatial document', () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().addTextNode(40, 50)
    useEditorStore.getState().addTextNode(300, 220)
    const sourceIds = spatialSurface().world.layerItems.map((item) => item.layerItemId)
    act(() => useEditorStore.getState().selectNodes(sourceIds))
    const before = useEditorStore.getState().spatialSession!
    const { container } = render(<App />)
    const shortcutTarget = container.querySelector('.app-shell')
    if (!shortcutTarget) throw new Error('expected App shell')

    fireEvent.keyDown(shortcutTarget, { key: 'c', ctrlKey: true })
    const copied = useEditorStore.getState()
    expect(copied.spatialClipboard?.items.map((entry) => entry.item.layerItemId)).toEqual(sourceIds)
    expect(copied.spatialSession).toBe(before)
    expect(copied.spatialSession?.history).toBe(before.history)

    fireEvent.keyDown(shortcutTarget, { key: 'v', ctrlKey: true })
    const pasted = useEditorStore.getState().spatialSession!
    const pastedIds = [...pasted.selection.selectionIds]
    expect(pastedIds).toHaveLength(2)
    expect(pasted.history.present.revision).toBe(before.history.present.revision + 1)
    expect(pasted.history.past).toHaveLength(before.history.past.length + 1)
    expect(pastedIds.every((id) => locateCourseLayer(pasted.history.present, id) !== null)).toBe(true)

    fireEvent.keyDown(shortcutTarget, { key: 'd', ctrlKey: true })
    const duplicated = useEditorStore.getState().spatialSession!
    const duplicatedIds = [...duplicated.selection.selectionIds]
    expect(duplicatedIds).toHaveLength(2)
    expect(duplicated.history.present.revision).toBe(pasted.history.present.revision + 1)
    expect(duplicated.history.past).toHaveLength(pasted.history.past.length + 1)

    fireEvent.keyDown(shortcutTarget, { key: 'z', ctrlKey: true })
    const undone = useEditorStore.getState().spatialSession!
    expect(undone.selection.selectionIds).toEqual([])
    expect(duplicatedIds.every((id) => locateCourseLayer(undone.history.present, id) === null)).toBe(true)

    fireEvent.keyDown(shortcutTarget, { key: 'y', ctrlKey: true })
    const redone = useEditorStore.getState().spatialSession!
    expect(redone.selection.selectionIds).toEqual([])
    expect(duplicatedIds.every((id) => locateCourseLayer(redone.history.present, id) !== null)).toBe(true)
  })

  it('duplicates an unselected Nodes surface row into its exact canonical owner once', () => {
    const fixture = mixedOwnerSelectionFixture()
    act(() => useEditorStore.getState().selectNode(fixture.worldItemId))
    const before = useEditorStore.getState().spatialSession!
    const source = locateCourseLayer(before.history.present, fixture.surfaceItemId)
    if (!source?.scoped) throw new Error('expected surface scoped layer')
    const sourceVisibility = structuredClone(source.scoped.visibility)
    render(<NodesTab />)

    const row = screen.getByTestId(`node-item-${fixture.surfaceItemId}`)
    fireEvent.click(within(row).getByRole('button', { name: `复制“${source.item.label}”` }))

    const after = useEditorStore.getState().spatialSession!
    const duplicateId = after.selection.selectionIds[0]
    expect(duplicateId).toBeTruthy()
    expect(duplicateId).not.toBe(fixture.surfaceItemId)
    expect(after.scope).toBe('surface')
    expect(after.history.present.revision).toBe(before.history.present.revision + 1)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(locateCourseLayer(after.history.present, duplicateId!)).toMatchObject({
      source: 'surface',
      scoped: { visibility: sourceVisibility },
      item: {
        locked: false,
        label: `${source.item.label} 副本`,
        frame: {
          x: source.item.frame.x + 20,
          y: source.item.frame.y + 20,
        },
      },
    })
    expect(locateCourseLayer(after.history.present, fixture.worldItemId)).toMatchObject({
      source: 'world',
    })
  })

  it('rejects a clipboard visibility reference after its non-active location is removed', () => {
    const fixture = mixedOwnerSelectionFixture()
    useEditorStore.getState().runSpatialCommand((session) => (
      addSpatialCameraFrameFromSession(session, { name: '临时可见位置' })
    ))
    const withFrame = useEditorStore.getState().spatialSession!
    const surface = withFrame.history.present.surfaces.find(
      (candidate) => candidate.id === withFrame.selection.surfaceId,
    )
    if (!surface || surface.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const activeLocation = withFrame.history.present.locations.find(
      (location) => location.id === withFrame.selection.locationId,
    )
    if (!activeLocation || activeLocation.kind !== 'spatial-camera') {
      throw new Error('expected active Spatial location')
    }
    const temporaryFrame = surface.camera.frames.find(
      (frame) => frame.id !== activeLocation.cameraFrameId,
    )
    if (!temporaryFrame) throw new Error('expected temporary camera frame')

    useEditorStore.getState().setCandidateGlobalLayerLocationVisibility(
      fixture.globalTextId,
      { mode: 'include', locationIds: [temporaryFrame.id] },
    )
    useEditorStore.getState().selectNode(fixture.globalTextId)
    useEditorStore.getState().copySelectedNodes()
    const captured = useEditorStore.getState().spatialClipboard
    expect(captured?.items[0]?.visibility).toEqual({
      mode: 'include',
      locationIds: [temporaryFrame.id],
    })

    useEditorStore.getState().setCandidateGlobalLayerLocationVisibility(
      fixture.globalTextId,
      { mode: 'all', locationIds: [] },
    )
    useEditorStore.getState().runSpatialCommand((session) => (
      deleteSpatialCameraFrameInSession(session, temporaryFrame.id)
    ))
    expect(useEditorStore.getState().spatialClipboard).toBe(captured)
    const beforePaste = useEditorStore.getState()
    beforePaste.pasteNodes()
    const afterPaste = useEditorStore.getState()
    expect(afterPaste.spatialSession).toBe(beforePaste.spatialSession)
    expect(afterPaste.spatialSession?.history).toBe(beforePaste.spatialSession?.history)
    expect(afterPaste.spatialSession?.selection).toBe(beforePaste.spatialSession?.selection)
    expect(afterPaste.selectedNodeIds).toBe(beforePaste.selectedNodeIds)
    expect(afterPaste.spatialClipboard).toBe(captured)
    expect(afterPaste.errorMessage).toMatch(/引用|失效/)
  })
})
