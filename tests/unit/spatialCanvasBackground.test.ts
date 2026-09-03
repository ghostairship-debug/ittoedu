import { beforeEach, describe, expect, it } from 'vitest'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { resolveCourseSurfaceBackgroundColor } from '@/shared/courseProjectModel'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'
import { updateSpatialSurfaceBackgroundColor } from '@/renderer/course/spatialEditorCommands'
import { updateFlowSurfaceBackgroundColor } from '@/renderer/course/flowEditorCommands'
import type { FlowSurfaceDocument, SpatialSurfaceDocument } from '@/shared/courseProjectTypes'

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
