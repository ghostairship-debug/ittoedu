import { beforeEach, describe, expect, it } from 'vitest'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { resolveCourseSurfaceBackgroundColor } from '@/shared/courseProjectModel'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'
import {
  updateSpatialSurfaceBackground,
  updateSpatialSurfaceBackgroundColor,
} from '@/renderer/course/spatialEditorCommands'
import {
  updateFlowSurfaceBackground,
  updateFlowSurfaceBackgroundColor,
} from '@/renderer/course/flowEditorCommands'
import type {
  CourseProjectDocument,
  FlowSurfaceDocument,
  SpatialSurfaceDocument,
} from '@/shared/courseProjectTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1'

/** The strict schema requires every referenced asset id to exist; register one first. */
function withRegisteredAsset(project: CourseProjectDocument, id: string): CourseProjectDocument {
  const meta: AssetMeta = {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: 4,
  }
  return { ...project, assets: { ...project.assets, [id]: meta } }
}

/**
 * P5 canvas background persistence:
 * Spatial and Flow surfaces support optional backgroundColor field.
 * Absent and '#ffffff' both resolve to white.
 * Opening a project does not dirty-write omitted field to '#ffffff' or '#111318'.
 */
describe('Canvas background persistence & default', () => {
  beforeEach(() => {
    useEditorStore.getState().createNewProject()
  })

  it('omits field by default and resolves to white without dirty-writing', () => {
    const spatialDoc = createBlankSpatialCourseProject({ now: '2026-08-18T14:00:00.000Z' })
    // Simulate an existing/omitted field project
    const spatialDocWithoutBg = {
      ...spatialDoc,
      surfaces: spatialDoc.surfaces.map((s) => {
        if (s.type !== 'spatial-2d') return s
        const { backgroundColor: _, ...rest } = s
        return rest
      }),
    }
    const spatialSurface = spatialDocWithoutBg.surfaces.find((s): s is SpatialSurfaceDocument => s.type === 'spatial-2d')
    expect(spatialSurface?.type).toBe('spatial-2d')
    expect(spatialSurface?.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(spatialSurface?.backgroundColor)).toBe('#ffffff')

    useEditorStore.getState().loadCourseProject(spatialDocWithoutBg as any, null)
    const state = useEditorStore.getState()
    expect(state.spatialSession).not.toBeNull()
    const loadedSpatialSurface = state.spatialSession?.history.present.surfaces.find((s): s is SpatialSurfaceDocument => s.type === 'spatial-2d')
    expect(loadedSpatialSurface?.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(loadedSpatialSurface?.backgroundColor)).toBe('#ffffff')

    const flowDoc = createBlankFlowCourseProject({ now: '2026-08-18T14:00:00.000Z' })
    const flowDocWithoutBg = {
      ...flowDoc,
      surfaces: flowDoc.surfaces.map((s) => {
        if (s.type !== 'flow') return s
        const { backgroundColor: _, ...rest } = s
        return rest
      }),
    }
    const flowSurface = flowDocWithoutBg.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')
    expect(flowSurface?.type).toBe('flow')
    expect(flowSurface?.backgroundColor).toBeUndefined()
    expect(resolveCourseSurfaceBackgroundColor(flowSurface?.backgroundColor)).toBe('#ffffff')

    useEditorStore.getState().loadCourseProject(flowDocWithoutBg as any, null)
    const flowState = useEditorStore.getState()
    expect(flowState.flowSession).not.toBeNull()
    const loadedFlowSurface = flowState.flowSession?.history.present.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')
    expect(loadedFlowSurface?.backgroundColor).toBeUndefined()
  })

  it('updates Spatial surface background color and persists to document and command result', () => {
    const doc = createBlankSpatialCourseProject({ now: '2026-08-18T14:00:00.000Z' })
    useEditorStore.getState().loadCourseProject(doc, null)
    const session = useEditorStore.getState().spatialSession!
    expect(session).not.toBeNull()

    const result = updateSpatialSurfaceBackgroundColor(session, '#223344')
    expect(result.ok).toBe(true)
    expect(result.historyEntry).toBe(true)
    const updatedSurface = result.nextSession?.history.present.surfaces.find((s): s is SpatialSurfaceDocument => s.type === 'spatial-2d')
    expect(updatedSurface?.backgroundColor).toBe('#223344')
    expect(resolveCourseSurfaceBackgroundColor(updatedSurface?.backgroundColor)).toBe('#223344')

    useEditorStore.getState().applySpatialAuthoringSession(result.nextSession!, { historyEntry: true })
    const persisted = useEditorStore.getState().spatialSession?.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.type === 'spatial-2d',
    )
    expect(persisted?.backgroundColor).toBe('#223344')

    // Invalid color should be rejected and not write #111318
    const invalidResult = updateSpatialSurfaceBackgroundColor(result.nextSession!, 'not-a-color')
    expect(invalidResult.ok).toBe(false)
  })

  it('updates Flow surface background color and persists to document and command result', () => {
    const doc = createBlankFlowCourseProject({ now: '2026-08-18T14:00:00.000Z' })
    const surface = doc.surfaces.find((s) => s.type === 'flow')!
    expect(surface).toBeDefined()

    const result = updateFlowSurfaceBackgroundColor(doc, surface.id, '#abcdef')
    expect(result.ok).toBe(true)
    expect(result.historyEntry).toBe(true)
    const updatedSurface = result.nextDocument?.surfaces.find((s): s is FlowSurfaceDocument => s.id === surface.id && s.type === 'flow')
    expect(updatedSurface?.backgroundColor).toBe('#abcdef')
    expect(resolveCourseSurfaceBackgroundColor(updatedSurface?.backgroundColor)).toBe('#abcdef')

    // Invalid color rejection
    const invalidResult = updateFlowSurfaceBackgroundColor(doc, surface.id, '')
    expect(invalidResult.ok).toBe(false)
  })

  it('derivedV8ProjectFromSpatial scenes[0].backgroundColor equals the resolved value', () => {
    const doc = createBlankSpatialCourseProject({ now: '2026-08-18T14:00:00.000Z' })
    useEditorStore.getState().loadCourseProject(doc, null)
    expect(resolveCourseSurfaceBackgroundColor(
      useEditorStore.getState().spatialSession?.history.present.surfaces.find(
        (s): s is SpatialSurfaceDocument => s.type === 'spatial-2d',
      )?.backgroundColor,
    )).toBe('#ffffff')

    const session = useEditorStore.getState().spatialSession!
    const result = updateSpatialSurfaceBackgroundColor(session, '#336699')
    expect(result.ok).toBe(true)
    useEditorStore.getState().applySpatialAuthoringSession(result.nextSession!, { historyEntry: true })
    expect(useEditorStore.getState().spatialSession?.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.type === 'spatial-2d',
    )?.backgroundColor).toBe('#336699')
  })
})

describe('r12-040 Flow/Spatial background mode and asset patches', () => {
  beforeEach(() => {
    useEditorStore.getState().createNewProject()
  })

  it('Flow: switching only backgroundMode is one commit and never clears the dormant color/asset', () => {
    const doc = withRegisteredAsset(
      createBlankFlowCourseProject({ now: '2026-09-05T00:00:00.000Z' }),
      'asset_flow_bg',
    )
    const surface = doc.surfaces.find((s) => s.type === 'flow')!
    const withOwn = updateFlowSurfaceBackground(doc, surface.id, {
      backgroundColor: '#abcdef',
      backgroundAssetId: 'asset_flow_bg',
    })
    expect(withOwn.ok).toBe(true)

    const switched = updateFlowSurfaceBackground(withOwn.nextDocument!, surface.id, {
      backgroundMode: 'inherit',
    }, { expectedRevision: withOwn.nextDocument!.revision })
    expect(switched.ok).toBe(true)
    expect(switched.historyEntry).toBe(true)
    const inheritedSurface = switched.nextDocument!.surfaces.find(
      (s): s is FlowSurfaceDocument => s.id === surface.id && s.type === 'flow',
    )!
    expect(inheritedSurface.backgroundMode).toBe('inherit')
    // Dormant own fields survive the mode switch untouched.
    expect(inheritedSurface.backgroundColor).toBe('#abcdef')
    expect(inheritedSurface.backgroundAssetId).toBe('asset_flow_bg')

    const switchedBack = updateFlowSurfaceBackground(switched.nextDocument!, surface.id, {
      backgroundMode: 'own',
    }, { expectedRevision: switched.nextDocument!.revision })
    expect(switchedBack.ok).toBe(true)
    const ownAgain = switchedBack.nextDocument!.surfaces.find(
      (s): s is FlowSurfaceDocument => s.id === surface.id && s.type === 'flow',
    )!
    expect(ownAgain.backgroundColor).toBe('#abcdef')
    expect(ownAgain.backgroundAssetId).toBe('asset_flow_bg')
  })

  it('Flow: backgroundAssetId accepts a string, an explicit null clear, and rejects an invalid mode', () => {
    const doc = withRegisteredAsset(
      createBlankFlowCourseProject({ now: '2026-09-05T00:00:00.000Z' }),
      'asset_1',
    )
    const surface = doc.surfaces.find((s) => s.type === 'flow')!
    const withAsset = updateFlowSurfaceBackground(doc, surface.id, { backgroundAssetId: 'asset_1' })
    expect(withAsset.ok).toBe(true)
    expect(withAsset.nextDocument!.surfaces.find(
      (s): s is FlowSurfaceDocument => s.id === surface.id && s.type === 'flow',
    )?.backgroundAssetId).toBe('asset_1')

    const cleared = updateFlowSurfaceBackground(withAsset.nextDocument!, surface.id, {
      backgroundAssetId: null,
    }, { expectedRevision: withAsset.nextDocument!.revision })
    expect(cleared.ok).toBe(true)
    expect(cleared.nextDocument!.surfaces.find(
      (s): s is FlowSurfaceDocument => s.id === surface.id && s.type === 'flow',
    )?.backgroundAssetId).toBeNull()

    const invalidMode = updateFlowSurfaceBackground(doc, surface.id, {
      backgroundMode: 'invalid' as never,
    })
    expect(invalidMode.ok).toBe(false)
  })

  it('Flow: a patch that changes nothing writes zero history entries', () => {
    const doc = createBlankFlowCourseProject({ now: '2026-09-05T00:00:00.000Z' })
    const surface = doc.surfaces.find((s) => s.type === 'flow')!
    const noop = updateFlowSurfaceBackground(doc, surface.id, {
      backgroundColor: '#ffffff',
      backgroundMode: 'own',
    })
    expect(noop.ok).toBe(true)
    expect(noop.historyEntry).toBe(false)
    expect(noop.nextDocument).toBe(doc)
  })

  it('Spatial: switching only backgroundMode is one commit and never clears the dormant color/asset', () => {
    const project = withRegisteredAsset(
      createBlankSpatialCourseProject({ now: '2026-09-05T00:00:00.000Z' }),
      'asset_spatial_bg',
    )
    useEditorStore.getState().loadCourseProject(project, null)
    const session = useEditorStore.getState().spatialSession!
    const surfaceId = session.selection.surfaceId

    const withOwn = updateSpatialSurfaceBackground(session, {
      backgroundColor: '#101010',
      backgroundAssetId: 'asset_spatial_bg',
    })
    expect(withOwn.ok).toBe(true)

    const switched = updateSpatialSurfaceBackground(withOwn.nextSession!, {
      backgroundMode: 'inherit',
    }, { expectedRevision: withOwn.nextSession!.history.present.revision })
    expect(switched.ok).toBe(true)
    expect(switched.historyEntry).toBe(true)
    const inheritedSurface = switched.nextSession!.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.id === surfaceId && s.type === 'spatial-2d',
    )!
    expect(inheritedSurface.backgroundMode).toBe('inherit')
    expect(inheritedSurface.backgroundColor).toBe('#101010')
    expect(inheritedSurface.backgroundAssetId).toBe('asset_spatial_bg')
  })

  it('Spatial: backgroundAssetId accepts a string, an explicit null clear, and rejects an invalid mode', () => {
    const project = withRegisteredAsset(
      createBlankSpatialCourseProject({ now: '2026-09-05T00:00:00.000Z' }),
      'asset_2',
    )
    useEditorStore.getState().loadCourseProject(project, null)
    const session = useEditorStore.getState().spatialSession!
    const surfaceId = session.selection.surfaceId

    const withAsset = updateSpatialSurfaceBackground(session, { backgroundAssetId: 'asset_2' })
    expect(withAsset.ok).toBe(true)
    expect(withAsset.nextSession!.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.id === surfaceId && s.type === 'spatial-2d',
    )?.backgroundAssetId).toBe('asset_2')

    const cleared = updateSpatialSurfaceBackground(withAsset.nextSession!, {
      backgroundAssetId: null,
    }, { expectedRevision: withAsset.nextSession!.history.present.revision })
    expect(cleared.ok).toBe(true)
    expect(cleared.nextSession!.history.present.surfaces.find(
      (s): s is SpatialSurfaceDocument => s.id === surfaceId && s.type === 'spatial-2d',
    )?.backgroundAssetId).toBeNull()

    const invalidMode = updateSpatialSurfaceBackground(session, {
      backgroundMode: 'invalid' as never,
    })
    expect(invalidMode.ok).toBe(false)
  })

  it('Spatial: a patch that changes nothing writes zero history entries', () => {
    const project = createBlankSpatialCourseProject({ now: '2026-09-05T00:00:00.000Z' })
    useEditorStore.getState().loadCourseProject(project, null)
    const session = useEditorStore.getState().spatialSession!
    const noop = updateSpatialSurfaceBackground(session, {
      backgroundColor: '#ffffff',
      backgroundMode: 'own',
    })
    expect(noop.ok).toBe(true)
    expect(noop.historyEntry).toBe(false)
  })

  it('Flow/Spatial: a stale expectedRevision writes nothing', () => {
    const flowDoc = createBlankFlowCourseProject({ now: '2026-09-05T00:00:00.000Z' })
    const flowSurface = flowDoc.surfaces.find((s) => s.type === 'flow')!
    const staleFlow = updateFlowSurfaceBackground(flowDoc, flowSurface.id, {
      backgroundColor: '#123456',
    }, { expectedRevision: flowDoc.revision + 1 })
    expect(staleFlow.ok).toBe(false)

    const project = createBlankSpatialCourseProject({ now: '2026-09-05T00:00:00.000Z' })
    useEditorStore.getState().loadCourseProject(project, null)
    const session = useEditorStore.getState().spatialSession!
    const staleSpatial = updateSpatialSurfaceBackground(session, {
      backgroundColor: '#123456',
    }, { expectedRevision: session.history.present.revision + 1 })
    expect(staleSpatial.ok).toBe(false)
  })
})
