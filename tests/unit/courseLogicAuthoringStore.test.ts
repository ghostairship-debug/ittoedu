import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import {
  activeDocumentId,
  connectCourseHost,
  formalCourse,
  redoSettled,
  settleCourse,
  undoSettled,
  type CourseHost,
} from '../helpers/triage-t2-course'

let host: CourseHost

beforeEach(async () => {
  const connected = await connectCourseHost()
  host = connected.host
})

describe('course logic authoring store persistence', () => {
  const sessionCases = [
    ['Slide', () => useEditorStore.getState().createCourseDocument('slide')],
    ['Flow', () => useEditorStore.getState().createCourseDocument('flow')],
    ['Spatial', () => useEditorStore.getState().createCourseDocument('spatial')],
  ] as const

  it.each(sessionCases)('%s 会话通过自身 history 保存并撤销课程状态', async (_name, open) => {
    await open()
    await settleCourse()
    const documentId = activeDocumentId()
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!before) throw new Error('作者会话未建立')

    const result = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: before.id,
      baseRevision: before.revision,
      declaration: { key: 'attempts', valueType: 'number', defaultValue: 0 },
    })
    expect(result.ok).toBe(true)
    await settleCourse()
    let current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState).toEqual([
      { key: 'attempts', valueType: 'number', defaultValue: 0 },
    ])
    expect(current?.revision).toBe(before.revision + 1)
    expect(useEditorStore.getState().dirty).toBe(true)

    const depth = formalCourse(host, documentId).undoDepth
    await undoSettled(host, documentId)
    expect(formalCourse(host, documentId).undoDepth).toBe(depth - 1)
    current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState).toEqual([])

    await redoSettled(host, documentId)
    expect(formalCourse(host, documentId).undoDepth).toBe(depth)
    current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState[0]?.key).toBe('attempts')
  })

  it('失败命令保留当前 revision/history 并显示明确错误', async () => {
    const documentId = activeDocumentId()
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!before) throw new Error('作者会话未建立')
    const added = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: before.id,
      baseRevision: before.revision,
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: false },
    })
    if (!added.ok) throw new Error(added.reason)
    await settleCourse()
    const depthBeforeFailure = formalCourse(host, documentId).undoDepth

    const rejected = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: added.project.id,
      baseRevision: added.project.revision,
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: true },
    })
    expect(rejected).toMatchObject({ ok: false, code: 'state-key-exists' })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.revision)
      .toBe(added.project.revision)
    expect(formalCourse(host, documentId).undoDepth).toBe(depthBeforeFailure)
    expect(useEditorStore.getState().errorMessage).toContain('已经存在')
    expect(useEditorStore.getState().statusMessage).toBeNull()
  })
})
