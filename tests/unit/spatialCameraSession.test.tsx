import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zoomSpatialSessionCamera } from '@/renderer/course/spatialEditorCommands'
import {
  buildSpatialEditorView,
  isSpatialEditorLocationKind,
  SPATIAL_SESSIONLESS_ERROR,
} from '@/renderer/course/spatialEditorView'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { Workspace } from '@/renderer/ui/Workspace'
import { mountSpatialLocationTryRun } from '@/renderer/ui/spatialLocationTryRun'

vi.mock('@/renderer/phaser/createEditorGame', () => ({
  createEditorGame: () => ({
    bridge: {},
    game: { scale: { refresh: () => undefined } },
    destroy: () => undefined,
  }),
}))

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().createNewProject()
  document.body.replaceChildren()
})

describe('Spatial camera session and try-run host', () => {
  it('changes sessionCamera without writing revision', () => {
    useEditorStore.getState().createNewSpatialProject()
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(before).toBeTruthy()
    const revision = before!.revision
    const zoomed = useEditorStore.getState().runSpatialCommand((session) => (
      zoomSpatialSessionCamera(session, 1.6)
    ))
    expect(zoomed.ok).toBe(true)
    expect(zoomed.historyEntry).toBe(false)
    expect(useEditorStore.getState().spatialSession?.sessionCamera.zoom).toBe(1.6)
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.revision).toBe(revision)
  })

  it('mounts SpatialSurfaceHost for location try-run and resumes without editor sessionCamera', async () => {
    useEditorStore.getState().createNewSpatialProject()
    useEditorStore.getState().runSpatialCommand((session) => zoomSpatialSessionCamera(session, 2.4))
    expect(useEditorStore.getState().spatialSession?.sessionCamera.zoom).toBe(2.4)

    const container = document.createElement('div')
    container.style.width = '640px'
    container.style.height = '360px'
    document.body.append(container)
    const session = useEditorStore.getState().spatialSession
    expect(session).toBeTruthy()
    const host = await mountSpatialLocationTryRun({
      container,
      project: session!.history.present,
      locationId: session!.selection.locationId,
      width: 640,
      height: 360,
    })
    expect(host.rootElement?.classList.contains('spatial-surface')).toBe(true)
    expect(host.rootElement?.dataset.worldBoundsMode).toBe('infinite')
    expect(host.camera?.zoom).toBe(session!.history.present.surfaces.find((surface) => (
      surface.type === 'spatial-2d'
    ))?.camera.home.zoom)
    expect(host.camera?.zoom).not.toBe(2.4)

    await host.suspend()
    expect(host.camera).toBeNull()
    await host.resume()
    expect(host.camera?.zoom).toBe(session!.history.present.surfaces.find((surface) => (
      surface.type === 'spatial-2d'
    ))?.camera.home.zoom)
    expect(host.camera?.zoom).not.toBe(2.4)
    await host.destroy()
  })

  it('copies sessionCamera onto the typed view without writing Course Project revision', () => {
    useEditorStore.getState().createNewSpatialProject()
    const session = useEditorStore.getState().spatialSession
    expect(session).toBeTruthy()
    const revision = session!.history.present.revision
    const zoomed = useEditorStore.getState().runSpatialCommand((current) => (
      zoomSpatialSessionCamera(current, 1.6)
    ))
    expect(zoomed.historyEntry).toBe(false)
    const live = useEditorStore.getState().spatialSession!
    const view = buildSpatialEditorView({
      project: live.history.present,
      locationId: live.selection.locationId,
      sessionCamera: live.sessionCamera,
    })
    expect(view.sessionCamera).toEqual({ x: live.sessionCamera.x, y: live.sessionCamera.y, zoom: 1.6 })
    expect(live.history.present.revision).toBe(revision)
    expect(view.camera.home.zoom).not.toBe(1.6)
    expect(isSpatialEditorLocationKind('spatial-camera')).toBe(true)
    expect(isSpatialEditorLocationKind('spatial-frames')).toBe(false)
    expect(SPATIAL_SESSIONLESS_ERROR).toMatch(/没有活动的 Spatial/)
  })

  it('rejects a typed Spatial view without an active session camera', () => {
    useEditorStore.getState().createNewSpatialProject()
    const session = useEditorStore.getState().spatialSession
    expect(session).toBeTruthy()

    expect(() => buildSpatialEditorView({
      project: session!.history.present,
      locationId: session!.selection.locationId,
      sessionCamera: null as never,
    })).toThrow(SPATIAL_SESSIONLESS_ERROR)
  })

  it('keeps the root Workspace on the Spatial fail-loud shell when its session is missing', () => {
    useEditorStore.getState().createNewSpatialProject()
    expect(useEditorStore.getState().courseAuthoringSession?.token.surfaceType).toBe('spatial-2d')
    useEditorStore.setState({ spatialSession: null })

    render(
      <Workspace
        onAddImage={() => undefined}
        onAddVideo={() => undefined}
        onSelectImageAsset={async () => null}
      />,
    )

    expect(screen.getByTestId('spatial-workspace-sessionless')).toHaveTextContent(
      SPATIAL_SESSIONLESS_ERROR,
    )
    expect(screen.queryByTestId('slide-workspace')).not.toBeInTheDocument()
  })
})
