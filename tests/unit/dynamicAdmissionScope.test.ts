import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { dynamicAdmissionScope } from '@/renderer/authoring/tools/dynamicAdmissionScope'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

describe('admission location scope', () => {
  it('keeps the real target and global environment, removes inactive resource needs without changing identities or the document', () => {
    const project = createBlankCourseProject()
    const surface = project.surfaces[0]
    if (surface.type !== 'slide') throw new Error('fixture must be slide')
    const first = surface.scenes[0], location = project.locations[0]
    const inactive = { ...structuredClone(first), id: 'inactive', backgroundAssetId: 'unavailable-image' }
    surface.scenes.push(inactive)
    project.locations.push({ ...location, id: 'inactive-location', sceneId: inactive.id } as typeof location)
    const before = structuredClone(project)
    const result = dynamicAdmissionScope(project, [location.id])
    const scoped = result.surfaces[0]
    if (scoped.type !== 'slide') throw new Error('fixture must be slide')
    expect(scoped.scenes[0]).toEqual(first)
    expect(result.globalLayerItems).toEqual(project.globalLayerItems)
    expect(result.locations).toEqual(project.locations)
    expect(scoped.scenes[1].id).toBe(inactive.id)
    expect(scoped.scenes[1].presentation?.states.map(state => state.id)).toEqual(inactive.presentation?.states.map(state => state.id))
    expect(scoped.scenes[1].backgroundAssetId).toBeNull()
    expect(courseProjectDocumentSchema.safeParse(result).success).toBe(true)
    expect(project).toEqual(before)
    const both = dynamicAdmissionScope(project, project.locations.map(item => item.id))
    expect(both).toEqual(project)
  })
})
