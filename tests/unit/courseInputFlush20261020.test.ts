import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'

it('flushes real pending course input before Main reads, preserves active IME, and avoids a snapshot refresh for clean input', async () => {
  const project = createBlankCourseProjectV10('Input-only preparation')
  project.definitions.box = { id: 'box', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } }
  project.instances.box = { id: 'box', definitionId: 'box', data: { html: 'before' }, frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  testContainerInstance(project, 0).childIds = ['box']
  const h = await createV10StoreHost(project)
  await useEditorStore.getState().connectCourseDocuments(h.api)
  useEditorStore.getState().beginSlideDataEdit('box')
  useEditorStore.getState().updateSlideDataDraft({ html: 'human pending' }, true)
  await expect(useEditorStore.getState().flushAllCourseDocuments([h.first.documentId])).rejects.toThrow('请先完成正在输入的文字')
  expect(h.model().project.instances.box.data).toEqual({ html: 'before' })
  expect(useEditorStore.getState().slideContentEdit?.composing).toBe(true)
  useEditorStore.getState().setSlideTextEditComposing(false)
  const gate = deferred(), entered = deferred()
  h.controls.before = async () => { entered.resolve(); await gate.promise }
  let settled = false
  const preparing = useEditorStore.getState().flushAllCourseDocuments([h.first.documentId]).then(() => { settled = true })
  await entered.promise
  expect(settled).toBe(false)
  expect(h.model().project.instances.box.data).toEqual({ html: 'before' })
  gate.resolve()
  await preparing
  expect(h.first.read()).toMatchObject({ revision: 1, model: { kind: 'course-v10', project: { instances: { box: { data: { html: 'human pending' } } } } } })
  const read = vi.spyOn(h.api, 'read')
  await useEditorStore.getState().flushAllCourseDocuments([h.first.documentId])
  expect(read).not.toHaveBeenCalled()
  // A real snapshot consumer still refreshes from authority.
  await useEditorStore.getState().drainAllCourseDocuments([h.first.documentId])
  expect(read).toHaveBeenCalledWith(h.first.documentId)
  read.mockRestore()
})
