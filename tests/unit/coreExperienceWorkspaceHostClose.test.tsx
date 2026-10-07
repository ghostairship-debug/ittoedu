import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonWorkspaceHost } from '../../src/renderer/app/LessonWorkspaceHost'
import type { LessonWorkspaceShellHandle, LessonWorkspaceShellProps } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import { useCourseProjectLifecycle, type CourseProjectLifecyclePorts } from '../../src/renderer/app/useCourseProjectLifecycle'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'

const inputOwners = vi.hoisted(() => ({
  preserveDraft: vi.fn(async () => undefined),
  preserveAll: vi.fn(async (_mode?: 'save' | 'preserve', _ids?: readonly string[]) => true),
  hasDirtyInputs: vi.fn((_ids?: readonly string[]) => false),
}))

vi.mock('../../src/renderer/lessonWorkspace/LessonWorkspaceShell', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { LessonWorkspaceShell: forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceShellProps>((props, ref) => {
    useImperativeHandle(ref, () => ({
      preserveAll: inputOwners.preserveAll, hasDirtyInputs: inputOwners.hasDirtyInputs,
      flushAll: async () => true, saveActiveDocument: async () => 'none', closeAll: async () => true,
      suspendForClose() {}, resumeAfterCloseCancelled() {}, openFile: async () => {}, focusDocument: async () => {},
      detachLesson() {}, showProject() {},
    }))
    return <>{props.children}{props.renderAssistant?.(null, undefined, true, async () => true, null)}</>
  }) }
})
vi.mock('../../src/renderer/workbench/ExecutionAssistant', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { ExecutionAssistant: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({ preserveDraft: inputOwners.preserveDraft }))
    return null
  }) }
})
vi.mock('../../src/renderer/app/lessonDocumentPort', () => ({ createDesktopDocumentPort: () => ({}) }))
vi.mock('../../src/renderer/workbench/WorkspaceRecoveryPanel', () => ({ WorkspaceRecoveryPanel: () => null }))
vi.mock('../../src/renderer/lessonMaterials/LessonMaterialBrowser', () => ({ LessonMaterialBrowser: () => null }))

const previousDesktop = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
afterEach(() => {
  cleanup(); vi.clearAllMocks()
  if (previousDesktop) Object.defineProperty(window, 'desktopAPI', previousDesktop)
  else Reflect.deleteProperty(window, 'desktopAPI')
})

it('returns a close preparation result through the actual outer Handle and forwards the document scope to its input owner', async () => {
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: {
    lesson: {}, workspaceFiles: {}, lessonFiles: {}, documents: {}, execution: {},
  } })
  const host = createRef<LessonWorkspaceShellHandle>()
  const course = await createCourseDocumentHost()
  let closeRequest!: (ids?: readonly string[]) => Promise<{ ready: boolean; dirty: boolean }>
  const reportError = vi.fn()
  const ports: CourseProjectLifecyclePorts = {
    documents: course.documents,
    captureIdentity: () => ({ projectId: 'course', documentId: 'course', epoch: 'epoch', revision: 0 }),
    hasUnsavedChanges: () => false, projectPath: () => null, runBusy: work => work(),
    commitStatus() {}, reportError, desktopAvailable: () => true,
    openProjectFile: async () => null, openRecentProjectFile: async () => { throw new Error('Unused') },
    confirmProjectOpen: async () => {}, listRecentProjects: async () => [], setWindowDirtyState: async () => {},
    subscribeSaveAndCloseRequest: () => () => {}, prepareBeforeClose: async () => true,
    preserveBeforeClose: (mode, ids) => host.current!.preserveAll(mode, ids),
    // This is the result adapter used by App after the lifecycle has prepared inputs.
    subscribePreserveAndCloseRequest: handler => {
      closeRequest = async ids => ({ ready: await handler(ids), dirty: Boolean(host.current?.hasDirtyInputs(ids)) })
      return () => {}
    },
  }
  function Scene() {
    useCourseProjectLifecycle(ports, {
      dirty: false, projectTitle: 'Course', projectPath: null, documentTrigger: null,
      sidecarTrigger: null, componentPackagesTrigger: null, slideDraftTrigger: null,
      spatialDraftTrigger: null, flowDraftTrigger: null, textEditTrigger: null,
    })
    return <LessonWorkspaceHost ref={host} projectPath={null} onOpenProject={async () => true} onNewProject={async () => true}>Course</LessonWorkspaceHost>
  }
  render(<Scene />)
  expect(typeof host.current?.hasDirtyInputs).toBe('function')
  const ids = ['document-to-close']
  inputOwners.hasDirtyInputs.mockReturnValueOnce(true)
  await act(async () => { expect(await closeRequest(ids)).toEqual({ ready: true, dirty: true }) })
  expect(inputOwners.preserveAll).toHaveBeenNthCalledWith(1, 'preserve', ids)
  expect(inputOwners.hasDirtyInputs).toHaveBeenNthCalledWith(1, ids)
  expect(inputOwners.preserveDraft).toHaveBeenCalledOnce()
  expect(inputOwners.preserveDraft.mock.invocationCallOrder[0]).toBeLessThan(inputOwners.preserveAll.mock.invocationCallOrder[0])

  await act(async () => { expect(await closeRequest()).toEqual({ ready: true, dirty: false }) })
  expect(inputOwners.preserveAll).toHaveBeenNthCalledWith(2, 'preserve', undefined)
  expect(inputOwners.hasDirtyInputs).toHaveBeenNthCalledWith(2, undefined)
  expect(inputOwners.preserveDraft).toHaveBeenCalledTimes(2)
  expect(reportError).not.toHaveBeenCalled()
})
