import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { stableFlowId } from './flowDocumentModel'
import { reconcileFlowParagraphAnchors } from './flowAnchorReconciliation'

export function commitCourseProjectMutation(
  project: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => void,
  now = new Date().toISOString(),
): CourseProjectDocument {
  const draft = structuredClone(project)
  mutate(draft)
  for (const before of project.surfaces) {
    if (before.type !== 'flow') continue
    const after = draft.surfaces.find(surface => surface.id === before.id)
    if (after?.type !== 'flow') continue
    if (after.blocks.length === 0 && after.surfaceLayerItems.some(entry => entry.paragraphAnchor)) {
      after.blocks.push({ id: stableFlowId('block'), type: 'paragraph', content: { inlines: [] } })
    }
    after.surfaceLayerItems = reconcileFlowParagraphAnchors(before.blocks, after.blocks, after.surfaceLayerItems)
  }
  draft.revision = project.revision + 1
  draft.updatedAt = now
  return courseProjectDocumentSchema.parse(draft)
}
