import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { addCourseFlowPage } from '@/core/tools/courseLocations'
import { createCoursewareBuilderV2 } from '@/renderer/course/coursewareBuilderV2'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'


describe('Flow width mode compatibility contract', () => {
  it('uses the fluid default in new projects, shared add-page commands and Builder without migrating existing reading content', () => {
    const project = createBlankFlowCourseProject()
    const initial = project.surfaces.find(surface => surface.type === 'flow')!
    expect(initial.layout.widthMode).toBe('fluid')
    delete initial.layout.widthMode
    const added = addCourseFlowPage(project, { expectedRevision: project.revision })
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error('Expected a successful Flow page command')
    expect(added.project.surfaces.find(surface => surface.id === initial.id)).toEqual(initial)
    expect(added.project.surfaces.filter(surface => surface.type === 'flow').filter(surface => surface.id !== initial.id).map(surface => surface.layout.widthMode)).toEqual(['fluid'])
    const built = createCoursewareBuilderV2({ surfaceType: 'flow', title: 'New Flow' }).finish()
    expect(built.project.surfaces.find(surface => surface.type === 'flow')!.layout.widthMode).toBe('fluid')
  })
  it.each([undefined, 'reading', 'fluid'] as const)('round trips %s through V9 and Published without migration', (widthMode) => {
    const project = createBlankFlowCourseProject()
    const surface = project.surfaces.find(s => s.type === 'flow')!
    if (widthMode) surface.layout.widthMode = widthMode
    else delete surface.layout.widthMode
    expect(courseProjectDocumentSchema.parse(project)).toEqual(project)
    const published = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const flow = publishedCourseV2Schema.parse(published).surfaces.find(s => s.type === 'flow')!
    expect(flow.layout).toEqual(surface.layout)
  })

  it('rejects unknown fields, invalid modes and fails loudly in the previous strict reader', () => {
    const project = createBlankFlowCourseProject()
    const flow = project.surfaces.find(s => s.type === 'flow')!
    Object.assign(flow.layout, { widthMode: 'automatic' })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
    flow.layout.widthMode = 'fluid'
    const published = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
    const publishedFlow = published.surfaces.find(s => s.type === 'flow')!
    Object.assign(publishedFlow.layout, { widthMode: 'automatic' })
    expect(publishedCourseV2Schema.safeParse(published).success).toBe(false)
    Object.assign(flow.layout, { widthMode: 'fluid', unknownLayoutField: true })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
    const previousLayoutReader = z.object({ readingWidth: z.number(), wideContentWidth: z.number() }).strict()
    expect(previousLayoutReader.safeParse({ readingWidth: 760, wideContentWidth: 1120, widthMode: 'fluid' }).success).toBe(false)
  })
})
