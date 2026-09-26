import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowSurface, findFlowBlockRecursive } from '@/core/tools/flowDocumentModel'
import { planFlowMenuDocumentInsertion, type FlowMenuDocumentKind, type FlowMenuDocumentTarget } from '@/core/tools/flowMenuDocumentInsertion'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'

function fixture() {
  const project = createBlankCourseProject({ id: 'menu-course', title: 'Menu', controls: 'none', includeDefaultController: false, now: '2026-09-27T00:00:00.000Z' })
  const slide = project.surfaces[0]!
  if (slide.type !== 'slide') throw new Error('Expected Slide')
  const flow = createBlankFlowSurface({ id: 'flow-page', title: 'Flow', headingId: 'flow-heading', paragraphId: 'flow-paragraph' })
  flow.surface.blocks.push({ id: 'outer-section', type: 'section', title: { inlines: [{ type: 'text', text: 'Outer' }] }, collapsedByDefault: false,
    blocks: [{ id: 'nested-paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Nested' }] } }] })
  const other = createBlankFlowSurface({ id: 'other-flow', title: 'Other', headingId: 'other-heading', paragraphId: 'other-paragraph' })
  project.surfaces.push(flow.surface, other.surface)
  project.locations.push(flow.location, other.location)
  project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: [
    { id: 'print-slide', kind: 'slide-scenes', surfaceId: slide.id, sceneIds: slide.scenes.map(scene => scene.id) },
    { id: 'print-flow', kind: 'flow-document', surfaceId: flow.surface.id },
    { id: 'print-other', kind: 'flow-document', surfaceId: other.surface.id },
  ] }
  const target: FlowMenuDocumentTarget = { projectId: project.id, revision: project.revision, locationId: flow.location.id,
    surfaceId: flow.surface.id, selectedBlockId: null }
  return { project, target }
}

const kinds: FlowMenuDocumentKind[] = ['heading', 'list', 'table', 'formula', 'divider', 'callout', 'section']

describe('M16 Flow menu document insertion', () => {
  it.each(kinds)('inserts a strict %s at the root tail in one candidate revision', kind => {
    const { project, target } = fixture()
    const before = structuredClone(project)
    const result = planFlowMenuDocumentInsertion(project, target, kind)
    expect(result.ok, result.reason).toBe(true)
    expect(result.historyEntry).toBe(true)
    expect(result.createdBlockIds).toHaveLength(1)
    expect(result.nextDocument!.revision).toBe(project.revision + 1)
    expect(project).toEqual(before)
    const surface = result.nextDocument!.surfaces.find(item => item.id === 'flow-page')!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    expect(surface.blocks.at(-1)).toMatchObject({ id: result.createdBlockIds![0], type: kind })
    expect(courseProjectDocumentSchema.safeParse(result.nextDocument).success).toBe(true)
    expect(result.nextDocument!.assets).toEqual(project.assets)
    expect(result.nextDocument!.componentPackages).toEqual(project.componentPackages)
  })

  it('places a block after the selected nested block inside the same section', () => {
    const { project, target } = fixture()
    const result = planFlowMenuDocumentInsertion(project, { ...target, selectedBlockId: 'nested-paragraph' }, 'callout')
    expect(result.ok, result.reason).toBe(true)
    const surface = result.nextDocument!.surfaces.find(item => item.id === 'flow-page')!
    if (surface.type !== 'flow') throw new Error('Expected Flow')
    const found = findFlowBlockRecursive(surface.blocks, result.createdBlockIds![0]!)!
    expect(found.parentId).toBe('outer-section')
    expect(found.index).toBe(1)
    expect(found.block.type).toBe('callout')
    expect(surface.blocks.map(block => block.id)).toEqual(project.surfaces.find(item => item.id === 'flow-page')!.type === 'flow'
      ? (project.surfaces.find(item => item.id === 'flow-page') as typeof surface).blocks.map(block => block.id) : [])
  })

  it('rejects unknown type, missing and cross-page selection, wrong location and stale target without a candidate', () => {
    const { project, target } = fixture()
    const invalid = [
      { target, kind: 'image' as FlowMenuDocumentKind },
      { target: { ...target, selectedBlockId: 'missing' }, kind: 'list' as const },
      { target: { ...target, selectedBlockId: 'other-paragraph' }, kind: 'list' as const },
      { target: { ...target, locationId: 'missing' }, kind: 'list' as const },
      { target: { ...target, revision: target.revision - 1 }, kind: 'list' as const },
      { target: { ...target, projectId: 'other' }, kind: 'list' as const },
      { target: { ...target, surfaceId: 'other-flow' }, kind: 'list' as const },
    ]
    const before = structuredClone(project)
    for (const input of invalid) {
      const result = planFlowMenuDocumentInsertion(project, input.target, input.kind)
      expect(result.ok).toBe(false)
      expect(result.historyEntry).toBe(false)
      expect(result.nextDocument).toBeUndefined()
    }
    expect(project).toEqual(before)
  })
})
