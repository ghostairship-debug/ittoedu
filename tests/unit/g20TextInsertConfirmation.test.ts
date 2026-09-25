// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { selectActiveCourseProjectDocument, selectSelectedNodeId, useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

it('retains the newly selected text target after the authoritative revision advances', async () => {
  const h = await createCourseStoreHost()
  await h.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const before = selectActiveCourseProjectDocument(useEditorStore.getState())?.revision
  useEditorStore.getState().addTextNode()
  await useEditorStore.getState().drainCourseDocument()
  expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.revision).toBeGreaterThan(before ?? -1)
  expect(selectSelectedNodeId(useEditorStore.getState())).toBeTruthy()
  useEditorStore.getState().addCourseContent('flow-page')
  await useEditorStore.getState().drainCourseDocument()
  const beforeFlow = selectActiveCourseProjectDocument(useEditorStore.getState())?.revision
  const oldBlock = useEditorStore.getState().flowSession?.selection.selectedBlockId
  useEditorStore.getState().addTextNode()
  await useEditorStore.getState().drainCourseDocument()
  expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.revision).toBeGreaterThan(beforeFlow ?? -1)
  expect(useEditorStore.getState().flowSession?.selection.selectedBlockId).not.toBe(oldBlock)
})
