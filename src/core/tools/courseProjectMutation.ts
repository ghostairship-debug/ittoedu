import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'

export function commitCourseProjectMutation(
  project: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => void,
  now = new Date().toISOString(),
): CourseProjectDocument {
  const draft = structuredClone(project)
  mutate(draft)
  draft.revision = project.revision + 1
  draft.updatedAt = now
  return courseProjectDocumentSchema.parse(draft)
}
