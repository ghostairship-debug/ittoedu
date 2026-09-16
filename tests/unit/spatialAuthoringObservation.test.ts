import { withDefaultComponentController } from '@/renderer/components/teacherControllerComponent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import {
  authoringObservationCameraToken, authoringObservationDraftToken, createAuthoringObservationController,
  registerAuthoringObservationHost, type AuthoringObservationState,
} from '@/renderer/authoring/generation/authoringObservation'
import { authoringObservationSpatialViewSchema } from '@/shared/authoringObservation'
import { aiObservationSchema } from '@/shared/localAgentTaskContract'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { createSpatialWorldViewTransform } from '@/renderer/course/spatialEditorView'
import { worldToClient } from '@/renderer/authoring/stageViewportTransform'

const disposers: Array<() => void> = []
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iKisAAAAASUVORK5CYII='
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); document.body.replaceChildren(); vi.restoreAllMocks() })

function harness() {
  const project = createBlankSpatialCourseProject(), surface = project.surfaces[0]!
  if (surface.type !== 'spatial-2d') throw new Error('Spatial fixture required')
  surface.camera.home = { x: 240, y: -120, zoom: 0.8 }
  Object.assign(surface.camera.frames[0]!, surface.camera.home)
  let state: AuthoringObservationState = { document: project, sessionGeneration: 3, surfaceId: surface.id,
    locationId: project.startLocationId, stateId: null, selectedIds: [], draft: null, assetFiles: {},
    spatialCamera: { x: -420, y: 360, zoom: 1.25 } }
  const root = document.createElement('main'); document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, left: 20, top: 30, right: 720, bottom: 430,
    width: 700, height: 400, toJSON: () => ({}) })
  const sync = () => {
    Object.assign(root.dataset, { observationSource: 'authoring', observationProjectId: project.id,
      observationSessionGeneration: String(state.sessionGeneration), observationRevision: String(project.revision),
      observationSurfaceId: surface.id, observationLocationId: state.locationId, observationStateId: '', observationReady: 'true',
      observationDraftToken: String(authoringObservationDraftToken(state.draft)) })
    if (state.spatialCamera) root.dataset.observationSpatialCamera = authoringObservationCameraToken(state.spatialCamera)
    else delete root.dataset.observationSpatialCamera
  }
  sync()
  const captureImage = vi.fn(async () => ({ dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 400 }))
  const controller = createAuthoringObservationController({ read: () => state, prepareForEdit: () => ({ ok: true }),
    materializeDraft: () => ({ ok: true, snapshot: { project } }), captureImage, waitForPaint: async () => undefined })
  disposers.push(controller.dispose)
  return { root, project, surface, controller, captureImage, get state() { return state },
    replace(camera: AuthoringObservationState['spatialCamera'], paint = true) { state = { ...state, spatialCamera: camera }; if (paint) sync() } }
}

describe('Spatial current camera observation', () => {
  it('carries the actual non-home camera through the strict request and structure with the painter coordinate system', async () => {
    const h = harness(), before = structuredClone(h.project)
    const captured = await h.controller.capture({ intent: 'edit' })
    const view = captured.observation.spatialView!
    expect(view.camera).toEqual(h.state.spatialCamera)
    expect(view.camera).not.toEqual(h.surface.camera.home)
    expect(view.viewport).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
    expect(view).toMatchObject({ coordinateSpace: 'world', cameraAnchor: 'viewport-center', globalCoordinateSpace: 'viewport' })
    expect(worldToClient(createSpatialWorldViewTransform(view.viewport, view.camera), view.camera)).toEqual({ x: 640, y: 360 })
    const structure = JSON.parse(captured.resourceFiles.find(file => file.role === 'structure')!.content)
    expect(structure.spatialView).toEqual(view)
    const request = captureGenerationSnapshot({ document: h.project, componentPackages: withDefaultComponentController(h.project).componentPackages, observation: captured.observation,
      workspace: { version: 1, projectId: h.project.id, normalizedPath: '/fixtures/current-spatial.h5lesson' },
      sessionToken: { locationId: h.state.locationId, surfaceType: 'spatial-2d', generation: 3, revision: h.project.revision },
      projection: projectEffectiveLayers({ project: h.project, locationId: h.state.locationId }),
      selectedIds: [], scope: 'page', instruction: '移到镜头中央', purpose: 'local-edit' })
    expect(request.observation?.spatialView).toEqual(view)
    const persistedObservation = aiObservationSchema.parse({ version: 1, taskId: crypto.randomUUID(), epoch: 0,
      workspace: request.workspace, observationId: crypto.randomUUID(), ...request.observation,
      readScope: { kind: 'location', surfaceId: h.surface.id, locationId: h.state.locationId }, files: request.observation!.files })
    expect(persistedObservation.spatialView).toEqual(view)
    expect(h.project).toEqual(before)
  })

  it('refreshes viewEpoch for a camera-only pan and zoom without changing the document revision', async () => {
    const h = harness(), first = await h.controller.capture({ intent: 'discuss' })
    h.replace({ x: 850, y: -620, zoom: 2 })
    const next = await h.controller.capture({ intent: 'discuss' })
    expect(next.observation.spatialView?.camera).toEqual({ x: 850, y: -620, zoom: 2 })
    expect(next.observation.viewEpoch).toBeGreaterThan(first.observation.viewEpoch)
    expect(next.observation.documentRevision).toBe(first.observation.documentRevision)
    expect(next.observation.draftEpoch).toBe(first.observation.draftEpoch)
  })

  it('rejects missing camera facts and a camera that has not reached the painter', async () => {
    const h = harness()
    h.replace(undefined)
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('当前镜头尚未绘制')
    h.replace({ x: 1, y: 2, zoom: 1 })
    h.replace({ x: 3, y: 4, zoom: 2 }, false)
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('当前镜头尚未绘制')
    expect(h.captureImage).not.toHaveBeenCalled()
  })

  it('rejects a camera that moves during capture even after the new camera has painted', async () => {
    const h = harness()
    h.captureImage.mockImplementation(async () => {
      h.replace({ x: 900, y: 430, zoom: 0.5 })
      return { dataUrl: `data:image/png;base64,${png}`, capturedAt: Date.now(), width: 700, height: 400 }
    })
    await expect(h.controller.capture({ intent: 'edit' })).rejects.toThrow('捕获期间')
  })

  it('does not label the background authoring camera as a trial or preview camera', async () => {
    const h = harness()
    disposers.push(registerAuthoringObservationHost({ root: h.root, source: 'preview', read: () => ({
      projectId: h.project.id, documentRevision: h.project.revision, surfaceId: h.surface.id,
      locationId: h.state.locationId, stateId: null, ready: true, stateVersion: 1, publicState: null,
    }) }))
    const captured = await h.controller.capture({ intent: 'discuss' })
    expect(captured.observation.source).toBe('preview')
    expect(captured.observation.spatialView).toBeUndefined()
    expect(JSON.parse(captured.resourceFiles.find(file => file.role === 'structure')!.content).spatialView).toBeUndefined()
  })

  it('rejects malformed and non-finite geometry in the strict observation contract', async () => {
    const h = harness(), captured = await h.controller.capture({ intent: 'discuss' }), view = captured.observation.spatialView!
    expect(authoringObservationSpatialViewSchema.safeParse({ ...view, camera: { ...view.camera, zoom: 0 } }).success).toBe(false)
    expect(authoringObservationSpatialViewSchema.safeParse({ ...view, camera: { ...view.camera, x: Infinity } }).success).toBe(false)
    expect(authoringObservationSpatialViewSchema.safeParse({ ...view, home: view.camera }).success).toBe(false)
  })
})
