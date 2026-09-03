import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

function activeHistory() {
  const state = useEditorStore.getState()
  const backend = state.slideBackend
  if (!backend) throw new Error('expected active slideBackend')
  return backend.getSession().history
}

describe('course logic authoring store persistence', () => {
  const sessionCases = [
    ['Slide', () => useEditorStore.getState().createNewProject()],
    ['Flow', () => useEditorStore.getState().createNewFlowProject()],
    ['Spatial', () => useEditorStore.getState().createNewSpatialProject()],
  ] as const

  it.each(sessionCases)('%s 会话通过自身 history 保存并撤销课程状态', (_name, open) => {
    open()
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!before) throw new Error('作者会话未建立')

    const result = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: before.id,
      baseRevision: before.revision,
      declaration: { key: 'attempts', valueType: 'number', defaultValue: 0 },
    })
    expect(result.ok).toBe(true)
    let current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState).toEqual([
      { key: 'attempts', valueType: 'number', defaultValue: 0 },
    ])
    expect(current?.revision).toBe(before.revision + 1)
    expect(useEditorStore.getState().dirty).toBe(true)

    useEditorStore.getState().undo()
    current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState).toEqual([])

    useEditorStore.getState().redo()
    current = selectActiveCourseProjectDocument(useEditorStore.getState())
    expect(current?.courseState[0]?.key).toBe('attempts')
  })

  it('失败命令保留当前 revision/history 并显示明确错误', () => {
    const before = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!before) throw new Error('作者会话未建立')
    const added = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: before.id,
      baseRevision: before.revision,
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: false },
    })
    if (!added.ok) throw new Error(added.reason)
    const historyBeforeFailure = activeHistory().past.length

    const rejected = useEditorStore.getState().applyCourseLogicAuthoringCommand({
      kind: 'course-state.add',
      projectId: added.project.id,
      baseRevision: added.project.revision,
      declaration: { key: 'ready', valueType: 'boolean', defaultValue: true },
    })
    expect(rejected).toMatchObject({ ok: false, code: 'state-key-exists' })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.revision)
      .toBe(added.project.revision)
    expect(activeHistory().past).toHaveLength(historyBeforeFailure)
    expect(useEditorStore.getState().errorMessage).toContain('已经存在')
    expect(useEditorStore.getState().statusMessage).toBeNull()
  })
})
