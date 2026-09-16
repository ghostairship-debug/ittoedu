import type { LessonConversation, LessonWorkspace } from '../../shared/lessonWorkspace'
const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
export function lessonProjectPath(lesson: LessonWorkspace) {
  return lesson.manifest.coursePath ? `${lesson.identity.normalizedDirectory.replace(/[\\/]$/, '')}/${lesson.manifest.coursePath}` : null
}
export function selectLessonConversation(lesson: LessonWorkspace, available: LessonConversation[], preferred?: LessonConversation): LessonConversation | undefined {
  const target = lessonProjectPath(lesson)
  const matches = (item: LessonConversation) => item.lesson.lessonId === lesson.identity.lessonId
    && normalize(item.lesson.normalizedDirectory) === normalize(lesson.identity.normalizedDirectory)
    && (target ? item.projectTarget && normalize(item.projectTarget.normalizedPath) === normalize(target) : !item.projectTarget)
  if (preferred && matches(preferred)) return preferred
  return [...available].filter(matches).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}
