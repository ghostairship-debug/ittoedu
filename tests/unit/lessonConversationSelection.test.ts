import { describe, expect, it } from 'vitest'
import { selectLessonConversation } from '../../src/renderer/lessonWorkspace/lessonConversationSelection'
import type { LessonConversation, LessonWorkspace } from '../../src/shared/lessonWorkspace'

describe('lesson conversation target across first save and Save As', () => {
  const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'lesson', normalizedDirectory: 'c:/lessons/circuit' }, manifest: { schemaVersion: 1, lessonId: 'lesson', title: '电路', documents: {} } }
  const draft: LessonConversation = { schemaVersion: 1, conversationId: 'draft', lesson: lesson.identity, title: '初始对话', createdAt: 1, updatedAt: 1, epoch: 0, sessionIds: [] }
  it('reopens the saved target conversation after first save and Save As', () => {
    expect(selectLessonConversation(lesson, [draft])).toBe(draft)
    const first = { ...draft, projectTarget: { version: 1 as const, projectId: 'a', normalizedPath: 'c:/lessons/circuit/a.h5lesson' } }
    const saved = { ...lesson, manifest: { ...lesson.manifest, coursePath: 'a.h5lesson' } }
    expect(selectLessonConversation(saved, [first])).toBe(first)
    const saveAs = { ...first, conversationId: 'save-as', updatedAt: 2, projectTarget: { version: 1 as const, projectId: 'b', normalizedPath: 'c:/lessons/circuit/b.h5lesson' } }
    const second = { ...lesson, manifest: { ...lesson.manifest, coursePath: 'b.h5lesson' } }
    expect(selectLessonConversation(second, [first, saveAs], first)).toBe(saveAs)
    expect(selectLessonConversation(second, [first])).toBeUndefined()
  })
  it('chooses latest updated matching conversation without rebinding a different target', () => {
    const saved = { ...lesson, manifest: { ...lesson.manifest, coursePath: 'a.h5lesson' } }
    const one = { ...draft, projectTarget: { version: 1 as const, projectId: 'a', normalizedPath: 'c:/lessons/circuit/a.h5lesson' } }
    const two = { ...one, conversationId: 'newer', updatedAt: 10 }
    expect(selectLessonConversation(saved, [one, two])).toBe(two)
  })
})
