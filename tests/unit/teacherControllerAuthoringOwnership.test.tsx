import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseProjectDocument, LayerItem } from '@/shared/courseProjectTypes'
import { teacherControllerAuthoringRecoveryBounds } from '@/shared/teacherControllerLayout'
import {
  openSpatialAuthoringSession,
  setSpatialEditingScope,
  type SpatialAuthoringSession,
} from '@/renderer/course/spatialEditorCommands'
import {
  createV9TeacherControllerAuthoringController,
} from '@/renderer/authoring/v9TeacherControllerAuthoring'
import {
  createSpatialWorldAuthoringController,
  type SpatialWorldAuthoringHost,
} from '@/renderer/authoring/spatialWorldAuthoring'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import { selectFlowEditorBlocks, selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { selectSlideAuthoringBackend, useEditorStore } from '@/renderer/store/editorStore'
import { FlowWorkspaceTestHarness as FlowWorkspace } from '../helpers/FlowWorkspaceTestHarness'
import {
  TeacherControllerAuthoringChrome,
  teacherControllerAuthoringPreviewCollapsed,
} from '@/renderer/ui/TeacherControllerAuthoringChrome'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const VIEWPORT = { x: 0, y: 0, width: 1280, height: 720 }

function fixture(
  id: 'global-layer-teacher-controller' | 'flow' | 'spatial' | 'mixed',
): CourseProjectDocument {
  const found = listCourseProjectV9Fixtures().find((entry) => entry.id === id)
  if (!found) throw new Error(`missing ${id} fixture`)
  return structuredClone(found.data.project)
}

function globalController(project: CourseProjectDocument): LayerItem {
  const item = project.globalLayerItems.find((entry) => (
    entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
  ))?.item
  if (!item) throw new Error('missing global teacher controller')
  return item
}

function spatialHost(project: CourseProjectDocument, locationId?: string) {
  let session = openSpatialAuthoringSession(project, {
    sessionId: 'controller-ownership',
    ...(locationId ? { locationId } : {}),
  })
  const host: SpatialWorldAuthoringHost & { session(): SpatialAuthoringSession } = {
    getSession: () => session,
    setSession: (next) => {
      session = next
    },
    session: () => session,
  }
  return host
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useEditorStore.getState().clearV9SlideCandidateBackend()
})

describe('teacher controller authoring ownership', () => {
  it('renders a focus-free inert page preview in the saved defaultCollapsed state', () => {
    const project = fixture('global-layer-teacher-controller')
    const collapsedItem = globalController(project)
    if (collapsedItem.kind !== 'native' || collapsedItem.content.nativeType !== 'teacher-controller') {
      throw new Error('expected teacher controller')
    }
    collapsedItem.content.data.collapsible = true
    collapsedItem.content.data.defaultCollapsed = true

    const props = {
      frame: collapsedItem.frame,
      rotation: collapsedItem.rotation,
      canvas: { width: 1280, height: 720 },
      getRenderedStageBounds: () => ({ width: 1280, height: 720 }),
      scenes: [{ id: 'scene-1', name: '场景 1' }],
      currentSceneId: 'scene-1',
    }
    const view = render(
      <TeacherControllerAuthoringChrome item={collapsedItem} {...props} />,
    )

    const chrome = screen.getByTestId('teacher-controller-authoring-chrome')
    const nav = chrome.querySelector<HTMLElement>('nav')
    if (!nav) throw new Error('missing controller preview nav')
    expect(teacherControllerAuthoringPreviewCollapsed(collapsedItem)).toBe(true)
    expect(chrome).toHaveAttribute('aria-hidden', 'true')
    expect(chrome).toHaveAttribute('data-controller-preview-collapsed', 'true')
    expect(chrome).toHaveStyle({ pointerEvents: 'none' })
    expect(nav).toHaveAttribute('inert')
    expect(nav).toHaveAttribute('aria-hidden', 'true')
    expect(nav).toHaveAttribute('tabindex', '-1')
    expect(nav).not.toHaveAttribute('aria-label')
    expect(nav).not.toHaveAttribute('aria-keyshortcuts')
    expect(nav).toHaveStyle({ pointerEvents: 'none' })
    expect(nav.querySelector('.slide-teacher-controller-background')).toBeNull()
    expect(nav.querySelector('.slide-teacher-controller-collapse')).toHaveTextContent('展')

    const expandedItem = structuredClone(collapsedItem)
    if (expandedItem.content.nativeType !== 'teacher-controller') {
      throw new Error('expected cloned teacher controller')
    }
    expandedItem.content.data.defaultCollapsed = false
    view.rerender(
      <TeacherControllerAuthoringChrome item={expandedItem} {...props} />,
    )
    expect(chrome).toHaveAttribute('data-controller-preview-collapsed', 'false')
    expect(nav.querySelector('.slide-teacher-controller-background')).not.toBeNull()
    expect(nav.querySelector('.slide-teacher-controller-collapse')).toHaveTextContent('收')
  })

  it('keeps Spatial page hits away from the global controller until Global Layer scope is explicit', () => {
    const host = spatialHost(fixture('spatial'))
    const controller = createSpatialWorldAuthoringController(host)
    const pageDown = controller.pointerDown({ x: 640, y: 670 }, VIEWPORT)

    expect(host.session().scope).toBe('world')
    expect(pageDown.hit?.nativeType).not.toBe('teacher-controller')
    expect(pageDown.targets?.some((target) => (
      target.layerItemId === 'global-teacher-controller'
    ))).not.toBe(true)
    controller.pointerUp({ x: 640, y: 670 }, VIEWPORT)

    const global = setSpatialEditingScope(host.session(), 'global')
    if (!global.ok || !global.nextSession) throw new Error(global.reason ?? 'global scope failed')
    host.setSession(global.nextSession)
    const globalDown = controller.pointerDown({ x: 640, y: 670 }, VIEWPORT)
    expect(globalDown.hit).toMatchObject({
      layerItemId: 'global-teacher-controller',
      nativeType: 'teacher-controller',
      coordinateSpace: 'viewport',
    })
    const beforeCancel = structuredClone(host.session().history)
    const moved = controller.pointerMove({ x: 50_000, y: -50_000 }, VIEWPORT)
    const movedController = moved.preview?.find(
      (entry) => entry.layerItemId === 'global-teacher-controller',
    )
    if (!movedController) throw new Error('missing Spatial controller preview')
    const spatialItem = globalController(host.session().history.present)
    if (spatialItem.kind !== 'native' || spatialItem.content.nativeType !== 'teacher-controller') {
      throw new Error('missing Spatial controller')
    }
    const movedBounds = teacherControllerAuthoringRecoveryBounds(
      spatialItem.content.data,
      movedController,
      movedController.rotation,
    )
    expect(movedBounds.left).toBeGreaterThanOrEqual(-0.001)
    expect(movedBounds.top).toBeGreaterThanOrEqual(-0.001)
    expect(movedBounds.right).toBeLessThanOrEqual(1280.001)
    expect(movedBounds.bottom).toBeLessThanOrEqual(720.001)
    const cancelled = controller.pointerCancel({ x: 50_000, y: -50_000 }, VIEWPORT)
    expect(cancelled.command).toBeUndefined()
    expect(controller.previewTransforms()).toBeNull()
    expect(host.session().history).toEqual(beforeCancel)

    const mixedHost = spatialHost(fixture('mixed'), 'location-spatial')
    const bannerDown = createSpatialWorldAuthoringController(mixedHost).pointerDown(
      { x: 80, y: 32 },
      VIEWPORT,
    )
    expect(bannerDown.hit).toMatchObject({
      layerItemId: 'global-banner',
      coordinateSpace: 'viewport',
    })
    expect(bannerDown.preview).toEqual([
      expect.objectContaining({ layerItemId: 'global-banner' }),
    ])
    expect(mixedHost.session().scope).toBe('global')
  })

  it('keeps the Slide controller kernel inert on a page and activates it only in Global Layer', () => {
    const project = fixture('global-layer-teacher-controller')
    const item = globalController(project)
    const backend = createSlideAuthoringBackend(openSlideAuthoringSession(project, {
      sessionId: 'slide-controller-page-inert',
    }))
    useEditorStore.getState().injectV9SlideCandidateBackend(backend)
    useEditorStore.getState().setEditingScope('scene')
    const controller = createV9TeacherControllerAuthoringController({
      readBackend: () => selectSlideAuthoringBackend(useEditorStore.getState()),
      commit: (run) => useEditorStore.getState().applySlideCandidateCommand(run),
    })
    const point = {
      x: item.frame.x + item.frame.width / 2,
      y: item.frame.y + item.frame.height / 2,
    }
    const before = selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()
    const pageDown = controller.pointerDown(point, {
      viewport: VIEWPORT,
      zoom: 1,
      pan: { x: 0, y: 0 },
    })
    if (pageDown.kind !== 'v9-controller-candidate') throw new Error('expected V9 controller')
    expect(pageDown.overlay).toBeNull()
    expect(pageDown.target).toBeUndefined()
    expect(controller.overlayGeometry({ viewport: VIEWPORT, zoom: 1 })).toBeNull()
    expect(selectSlideAuthoringBackend(useEditorStore.getState())!.getSession()).toEqual(before)

    useEditorStore.getState().setEditingScope('global')
    const globalDown = controller.pointerDown(point, {
      viewport: VIEWPORT,
      zoom: 1,
      pan: { x: 0, y: 0 },
    })
    if (globalDown.kind !== 'v9-controller-candidate') throw new Error('expected V9 controller')
    expect(globalDown.target?.layerItemId).toBe(item.layerItemId)
    expect(globalDown.overlay).not.toBeNull()
    controller.pointerCancel(point, { viewport: VIEWPORT, zoom: 1 })
  })

  it('renders the Flow page controller as pass-through and cancels Global Layer preview without a write', () => {
    const project = fixture('flow')
    const controllerSource = fixture('global-layer-teacher-controller')
    const controllerEntry = controllerSource.globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (!controllerEntry) throw new Error('missing controller entry')
    project.globalLayerItems.push(structuredClone(controllerEntry))
    const locationId = project.startLocationId
    const view = buildFlowEditorView({ project, locationId })
    const blockId = view.blocks[0]?.blockId
    if (!blockId) throw new Error('missing Flow block')
    const pageSelection = selectFlowEditorBlocks(project, locationId, [blockId])
    const onProjectChange = vi.fn()
    const onSelectionChange = vi.fn()
    const rendered = render(
      <FlowWorkspace
        project={project}
        view={view}
        selection={pageSelection}
        assetFiles={{}}
        componentPackages={{}}
        onProjectChange={onProjectChange}
        onSelectionChange={onSelectionChange}
      />,
    )
    const controllerId = controllerEntry.item.layerItemId
    const pageCard = screen.getByTestId(`flow-layer-card-${controllerId}`)
    expect(pageCard).toHaveAttribute('data-controller-page-preview', 'true')
    expect(pageCard).toHaveAttribute('aria-hidden', 'true')
    expect(pageCard).not.toHaveAttribute('role')
    expect(pageCard).not.toHaveAttribute('tabindex')
    expect(pageCard).toHaveStyle({ pointerEvents: 'none' })
    expect(pageCard.querySelector('[data-handle]')).toBeNull()
    fireEvent.pointerDown(pageCard, { button: 0, pointerId: 1, clientX: 640, clientY: 670 })
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(onProjectChange).not.toHaveBeenCalled()

    const globalSelection = selectFlowOverlay(project, locationId, [controllerId], 'global')
    rendered.rerender(
      <FlowWorkspace
        project={project}
        view={view}
        selection={globalSelection}
        assetFiles={{}}
        componentPackages={{}}
        onProjectChange={onProjectChange}
        onSelectionChange={onSelectionChange}
      />,
    )
    const globalVisual = screen.getByTestId(`flow-layer-card-${controllerId}`)
    expect(globalVisual.parentElement).toHaveAttribute('data-flow-layer-plane', 'global-overlay')
    const globalCard = screen.getByTestId(`flow-layer-selection-${controllerId}`)
    const overlay = screen.getByTestId('flow-authoring-layer-overlay')
    overlay.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    })
    globalCard.setPointerCapture = vi.fn()
    globalCard.hasPointerCapture = () => true
    globalCard.releasePointerCapture = vi.fn()
    expect(globalCard).toHaveAttribute('role', 'button')
    expect(globalCard).toHaveAttribute('tabindex', '0')
    expect(globalCard.querySelector('[data-handle]')).not.toBeNull()

    fireEvent.pointerDown(globalCard, { button: 0, pointerId: 2, clientX: 640, clientY: 670 })
    fireEvent.pointerMove(globalCard, { pointerId: 2, clientX: 50_000, clientY: -50_000 })
    fireEvent.pointerCancel(globalCard, { pointerId: 2, clientX: 50_000, clientY: -50_000 })
    expect(onProjectChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(globalCard, { button: 0, pointerId: 3, clientX: 640, clientY: 670 })
    fireEvent.pointerUp(globalCard, { pointerId: 3, clientX: 50_000, clientY: -50_000 })
    expect(onProjectChange).toHaveBeenCalledTimes(1)
    const result = onProjectChange.mock.calls[0]?.[0]
    const next = result?.nextDocument as CourseProjectDocument | undefined
    if (!next) throw new Error('Flow controller transform did not write')
    const nextController = globalController(next)
    if (nextController.kind !== 'native' || nextController.content.nativeType !== 'teacher-controller') {
      throw new Error('missing transformed controller')
    }
    const bounds = teacherControllerAuthoringRecoveryBounds(
      nextController.content.data,
      nextController.frame,
      nextController.rotation,
    )
    expect(bounds.left).toBeGreaterThanOrEqual(-0.001)
    expect(bounds.top).toBeGreaterThanOrEqual(-0.001)
    expect(bounds.right).toBeLessThanOrEqual(1280.001)
    expect(bounds.bottom).toBeLessThanOrEqual(720.001)
  })
})
