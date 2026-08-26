import { describe, expect, it } from 'vitest'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import { projectCandidatePreviewDocument } from '@/renderer/store/editorStore'
import type { ScopedLayerItem } from '@/shared/courseProjectTypes'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

describe('projectCandidatePreviewDocument', () => {
  it('projects Mixed global visibility into the Slide-only V8 scene domain', () => {
    const source = listCourseProjectV9Fixtures().find(({ id }) => id === 'mixed')
    if (!source) throw new Error('missing mixed fixture')
    const project = structuredClone(source.data.project)
    const donor = project.globalLayerItems[0]
    if (!donor) throw new Error('missing mixed global layer donor')
    const scoped = (
      layerItemId: string,
      visibility: ScopedLayerItem['visibility'],
      order: number,
    ): ScopedLayerItem => ({
      item: {
        ...structuredClone(donor.item),
        layerItemId,
        label: layerItemId,
        order,
      },
      visibility,
    })
    project.globalLayerItems = [
      scoped('include-flow-only', {
        mode: 'include',
        locationIds: ['location-flow'],
      }, 900),
      scoped('exclude-flow-only', {
        mode: 'exclude',
        locationIds: ['location-flow'],
      }, 901),
      scoped('include-mixed', {
        mode: 'include',
        locationIds: ['location-slide', 'location-flow'],
      }, 902),
      scoped('exclude-mixed', {
        mode: 'exclude',
        locationIds: ['location-slide', 'location-spatial'],
      }, 903),
    ]

    const preview = projectCandidatePreviewDocument({
      slideBackend: createSlideAuthoringBackend(openSlideAuthoringSession(project)),
      slideCandidateUi: null,
      slideCandidateSidecar: null,
      v9ContentEdit: null,
    })

    expect(preview?.project.globalLayer.map((entry) => ({
      id: entry.node.id,
      visibility: entry.visibility,
    }))).toEqual([
      {
        id: 'exclude-flow-only',
        visibility: { mode: 'all', sceneIds: [] },
      },
      {
        id: 'include-mixed',
        visibility: { mode: 'include', sceneIds: ['scene-1'] },
      },
      {
        id: 'exclude-mixed',
        visibility: { mode: 'exclude', sceneIds: ['scene-1'] },
      },
    ])
  })
})
