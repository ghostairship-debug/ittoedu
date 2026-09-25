import type { LessonWorkspace } from '../../shared/lessonWorkspace'
export function lessonProjectPath(lesson: LessonWorkspace) {
  return lesson.manifest.coursePath ? `${lesson.identity.normalizedDirectory.replace(/[\\/]$/, '')}/${lesson.manifest.coursePath}` : null
}

