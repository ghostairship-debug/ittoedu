import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonWorkspaceHost, type LessonWorkspaceHostProps } from '../../src/renderer/app/LessonWorkspaceHost'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

vi.mock('../../src/renderer/lessonWorkspace/LessonWorkspaceShell', () => ({ LessonWorkspaceShell: () => null }))
vi.mock('../../src/renderer/lessonMaterials/LessonMaterialBrowser', () => ({ LessonMaterialBrowser: () => null }))
vi.mock('../../src/renderer/workbench/ExecutionAssistant', () => ({ ExecutionAssistant: () => null }))
vi.mock('../../src/renderer/workbench/WorkspaceRecoveryPanel', () => ({ WorkspaceRecoveryPanel: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('prepares only Renderer-owned course input before reading, and directly reads a new Main-only session', async () => {
  const document = (documentId: string): DocumentSnapshot => ({ documentId, epoch: 'epoch', revision: 0,
    model: { kind: 'course-v10', project: createBlankCourseProjectV10(documentId), resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: documentId },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 })
  const mounted = document('mounted'), created = document('created')
  const read = vi.fn(async (id: string) => {
    if (id === mounted.documentId) return mounted
    if (id === created.documentId) return created
    throw new Error('文档已关闭')
  })
  vi.stubGlobal('desktopAPI', { documents: { read } })
  let acknowledge!: () => void
  const pending = new Promise<void>(resolve => { acknowledge = resolve })
  const prepare = vi.fn(async (ids?: readonly string[]) => {
    if (!ids?.every(id => id === mounted.documentId)) throw new Error('保全输入时文档已关闭')
    await pending
    mounted.revision = 1
  })
  const props: LessonWorkspaceHostProps = { projectPath: null, children: null,
    onOpenProject: async () => true, onNewProject: async () => true, prepareCourseDocuments: prepare,
    courseDocuments: { documents: [mounted], activeDocumentId: mounted.documentId, activate: async () => {}, close: async () => true } }
  const ui = render(<LessonWorkspaceHost {...props} />)
  const prepared = workbenchSelection.prepare(mounted.documentId)
  expect(prepare).toHaveBeenCalledWith([mounted.documentId])
  expect(read).not.toHaveBeenCalled()
  await expect(workbenchSelection.prepare(created.documentId)).resolves.toBe(created)
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalledWith(mounted.documentId)
  acknowledge()
  await expect(prepared).resolves.toMatchObject({ documentId: mounted.documentId, revision: 1 })

  // Updated ownership must replace the effect closure, without restoring a removed input owner.
  await act(async () => ui.rerender(<LessonWorkspaceHost {...props} courseDocuments={{ ...props.courseDocuments!, documents: [] }} />))
  await expect(workbenchSelection.prepare(mounted.documentId)).resolves.toBe(mounted)
  expect(prepare).toHaveBeenCalledTimes(1)
  const unregister = workbenchSelection.register(created.documentId, async () => { throw new Error('输入尚未提交') })
  read.mockClear()
  await expect(workbenchSelection.prepare(created.documentId)).rejects.toThrow('输入尚未提交')
  expect(read).not.toHaveBeenCalled()
  unregister()
  await expect(workbenchSelection.prepare('closed')).rejects.toThrow('文档已关闭')
})
