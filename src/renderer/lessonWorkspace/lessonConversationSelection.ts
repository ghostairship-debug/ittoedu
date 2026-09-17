import { conversationOwnerOf, type LessonConversation, type LessonIdentity, type LessonWorkspace } from '../../shared/lessonWorkspace'
const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
export function lessonProjectPath(lesson: LessonWorkspace) {
  return lesson.manifest.coursePath ? `${lesson.identity.normalizedDirectory.replace(/[\\/]$/, '')}/${lesson.manifest.coursePath}` : null
}

/** 会话归属的课例身份；非课例归属或身份不完整的旧记录返回 null。 */
function lessonOwnerOf(item: LessonConversation): LessonIdentity | null {
  if (item.owner) {
    return item.owner.kind === 'lesson' ? item.owner.lesson : null
  }
  try {
    const owner = conversationOwnerOf(item)
    return owner.kind === 'lesson' ? owner.lesson : null
  } catch {
    // 旧记录缺少 owner 且 lesson 身份不完整（如历史非 UUID 数据）时退回原始字段比较。
    return item.lesson ?? null
  }
}

export function selectLessonConversation(lesson: LessonWorkspace, available: LessonConversation[], preferred?: LessonConversation): LessonConversation | undefined {
  const target = lessonProjectPath(lesson)
  const matches = (item: LessonConversation) => {
    const owner = lessonOwnerOf(item)
    if (!owner) return false
    return owner.lessonId === lesson.identity.lessonId
      && normalize(owner.normalizedDirectory) === normalize(lesson.identity.normalizedDirectory)
      && (target ? item.projectTarget && normalize(item.projectTarget.normalizedPath) === normalize(target) : !item.projectTarget)
  }
  if (preferred && matches(preferred)) return preferred
  return [...available].filter(matches).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}
