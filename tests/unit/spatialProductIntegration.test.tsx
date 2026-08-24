import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { stageResizeHandleWorldPoint, worldToClient } from '@/renderer/authoring/stageViewportTransform'
import { createSpatialWorldAuthoringController } from '@/renderer/authoring/spatialWorldAuthoring'
import { openSpatialAuthoringSession } from '@/renderer/course/spatialEditorCommands'
import { createSpatialWorldViewTransform } from '@/renderer/course/spatialEditorView'
import { addSpatialPathInSession } from '@/renderer/course/spatialPathCommands'
import { addSpatialRelationInSession } from '@/renderer/course/spatialRelationCommands'
import {
  selectActiveCourseProjectDocument,
  selectEditingNodes,
  selectEffectiveLayerProjection,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { TopToolbar } from '@/renderer/ui/TopToolbar'
import type { SpatialAuthoringSession } from '@/renderer/course/spatialEditorCommands'

const VIEWPORT = { x: 0, y: 0, width: 800, height: 450 }

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
})
