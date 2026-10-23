import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { settleCourseComponentInput } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

afterEach(() => { useEditorStore.getState().courseBridge.dispose(); vi.restoreAllMocks() })
it('removes only an ended projection-owned error and preserves an independently reported file error', async () => {
  const h = await createV10StoreHost(createBlankCourseProjectV10('反馈归属'), undefined, false)
  const state = () => useEditorStore.getState()
  await state().connectCourseDocuments(h.api)
  vi.spyOn(h.api, 'dispatch').mockImplementation(async operation => ({ status: 'failed', documentId: operation.documentId,
    operationId: operation.operationId, code: 'explicit-refusal', message: '这次提交被拒绝', applied: false }))
  const first = await state().courseBridge.edit([{ type: 'project.title.set', title: 'requested' }]).catch(error => error)
  expect(state().errorMessage).toBe(state().courseView.error)
  expect(state().errorMessage).toContain('这次提交被拒绝')
  expect(await settleCourseComponentInput(first)).toBe('ready')
  expect(state().errorMessage).toBeNull()
  const second = await state().courseBridge.edit([{ type: 'project.title.set', title: 'again' }]).catch(error => error)
  state().setError('保存位置当前无法写入')
  expect(await settleCourseComponentInput(second)).toBe('ready')
  expect(state().errorMessage).toBe('保存位置当前无法写入')
})
