import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { deriveCourseEditorLayout } from '@/renderer/course/courseEditorLayout'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import {
  addCourseFlowPage,
  addCourseSlidePage,
  addCourseSpatialPage,
} from '@/core/tools/courseLocations'

const NOW = '2026-08-17T12:00:00.000Z'

function slideSurfaceId(project: CourseProjectDocument): string {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  if (!surface) throw new Error('expected slide surface')
  return surface.id
}

function buildMixedProject(
  kinds: Array<'slide' | 'flow' | 'spatial'>,
): CourseProjectDocument {
  const kindSet = new Set(kinds)
  let project: CourseProjectDocument
  if (kindSet.size === 1 && kindSet.has('slide')) {
    project = createBlankCourseProject({ now: NOW })
  } else if (kindSet.size === 1 && kindSet.has('flow')) {
    project = createBlankFlowCourseProject({ now: NOW })
  } else if (kindSet.size === 1 && kindSet.has('spatial')) {
    project = createBlankSpatialCourseProject({ now: NOW })
  } else if (!kindSet.has('slide')) {
    project = createBlankFlowCourseProject({ now: NOW })
  } else {
    project = createBlankCourseProject({ now: NOW })
  }
  if (kindSet.has('flow') && !project.surfaces.some((surface) => surface.type === 'flow')) {
    const added = addCourseFlowPage(project, { now: NOW })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  if (kindSet.has('spatial') && !project.surfaces.some((surface) => surface.type === 'spatial-2d')) {
    const added = addCourseSpatialPage(project, { now: NOW })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  if (kindSet.has('slide') && kindSet.size > 1 && !project.surfaces.some((surface) => surface.type === 'slide')) {
    const added = addCourseSlidePage(project, { now: NOW })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  return courseProjectDocumentSchema.parse(project)
}

describe('deriveCourseEditorLayout', () => {
  it.each([
    {
      name: 'slide only',
      kinds: ['slide'] as const,
      kind: 'slide',
      primary: { action: 'scene' as const },
      dropdown: ['flow-page', 'spatial-page'],
    },
    {
      name: 'flow only',
      kinds: ['flow'] as const,
      kind: 'flow',
      primary: { action: 'flow-page' as const },
      dropdown: ['slide-page', 'spatial-page'],
    },
    {
      name: 'spatial only',
      kinds: ['spatial'] as const,
      kind: 'spatial',
      primary: { action: 'spatial-page' as const },
      dropdown: ['slide-page', 'flow-page'],
    },
    {
      name: 'slide + flow',
      kinds: ['slide', 'flow'] as const,
      kind: 'mixed',
      primary: { action: 'scene' as const },
      dropdown: ['flow-page', 'spatial-page'],
    },
    {
      name: 'slide + spatial',
      kinds: ['slide', 'spatial'] as const,
      kind: 'mixed',
      primary: { action: 'scene' as const },
      dropdown: ['flow-page', 'spatial-page'],
    },
    {
      name: 'flow + spatial',
      kinds: ['flow', 'spatial'] as const,
      kind: 'mixed',
      primary: { action: 'slide-page' as const },
      dropdown: ['flow-page', 'spatial-page'],
    },
    {
      name: 'slide + flow + spatial',
      kinds: ['slide', 'flow', 'spatial'] as const,
      kind: 'mixed',
      primary: { action: 'scene' as const },
      dropdown: ['flow-page', 'spatial-page'],
    },
  ])('$name -> kind $kind / primary $primary.action', ({
    kinds,
    kind,
    primary,
    dropdown,
  }) => {
    const project = buildMixedProject([...kinds])
    const activeLocationId = project.locations[0]?.id
    const activeLocation = project.locations.find((location) => location.id === activeLocationId)
    const layout = deriveCourseEditorLayout(project, activeLocationId)

    expect(layout.kind).toBe(kind)
    expect(layout.primary.action).toBe(primary.action)
    if (primary.action === 'scene') {
      expect(layout.primary.surfaceId).toBeTruthy()
    } else {
      expect(layout.primary.surfaceId).toBeUndefined()
    }
    expect([...layout.dropdown]).toEqual(dropdown)
    expect(layout.dropdown).not.toContain(
      primary.action === 'scene' ? 'slide-page' : primary.action,
    )
    expect(layout.activeSurfaceId).toBe(activeLocation?.surfaceId ?? null)
  })
})

describe('deriveCourseEditorLayout pure factories', () => {
  it('derives slide layout from blank slide project', () => {
    const project = createBlankCourseProject({ now: NOW })
    const layout = deriveCourseEditorLayout(project, project.startLocationId)
    expect(layout).toMatchObject({
      kind: 'slide',
      primary: { action: 'scene', surfaceId: slideSurfaceId(project) },
      dropdown: ['flow-page', 'spatial-page'],
    })
  })

  it('derives flow layout from blank flow project', () => {
    const project = createBlankFlowCourseProject({ now: NOW })
    const layout = deriveCourseEditorLayout(project, project.startLocationId)
    expect(layout).toMatchObject({
      kind: 'flow',
      primary: { action: 'flow-page' },
      dropdown: ['slide-page', 'spatial-page'],
    })
  })

  it('derives spatial layout from blank spatial project', () => {
    const project = createBlankSpatialCourseProject({ now: NOW })
    const layout = deriveCourseEditorLayout(project, project.startLocationId)
    expect(layout).toMatchObject({
      kind: 'spatial',
      primary: { action: 'spatial-page' },
      dropdown: ['slide-page', 'flow-page'],
    })
  })
})
