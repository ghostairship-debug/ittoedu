import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useLessonWorkspaceController, type LessonWorkspaceControllerProps } from '../../src/renderer/lessonWorkspace/controller/useLessonWorkspaceController'

afterEach(() => { cleanup(); localStorage.clear() })

function mount() {
  const openTab = vi.fn<LessonWorkspaceControllerProps['tabs']['openTab']>(async () => {})
  const lessonOperation = vi.fn<LessonWorkspaceControllerProps['lessonOperation']>(async input => input.operation === 'recent-workspaces' ? { recent: [] } : { opened: true })
  const props: LessonWorkspaceControllerProps = {
    lessonOperation, projectPath: null, onOpenProject: async () => false, onNewProject: async () => false,
    tabs: { openTab, cancelNavigation: vi.fn() } as unknown as LessonWorkspaceControllerProps['tabs'],
  }
  const hook = renderHook(() => useLessonWorkspaceController(props))
  const open = async (name: string) => { await act(async () => { await hook.result.current.actions.openFile({ name, path: `/workspace/${name}`, kind: 'file' }) }) }
  return { ...hook, open, openTab, lessonOperation }
}

it.each(['settings.json', 'comments.jsonc', 'main.ts', 'config.yaml', '.env', 'README', 'start.cmd', 'notes.custom'])('opens %s through the formal document session', async name => {
  const { open, openTab, lessonOperation, result } = mount()
  await open(name)
  expect(openTab).toHaveBeenCalledWith({ path: `/workspace/${name}`, name, kind: 'document', lesson: null })
  expect(lessonOperation.mock.calls.some(([request]) => request.operation === 'open-external')).toBe(false)
  expect(result.current.state.error).toBeNull()
})

it('retains the existing media preview', async () => {
  const { open, openTab } = mount()
  await open('diagram.svg')
  expect(openTab).toHaveBeenCalledWith({ path: '/workspace/diagram.svg', name: 'diagram.svg', kind: 'media', lesson: null })
})

it.each(['app.exe', 'shortcut.lnk'])('does not execute %s from the file tree', async name => {
  const { open, openTab, lessonOperation, result } = mount()
  await open(name)
  expect(openTab).not.toHaveBeenCalled()
  expect(lessonOperation.mock.calls.some(([request]) => request.operation === 'open-external')).toBe(false)
  expect(result.current.state.error).toContain('不能从果铃运行')
})

it('reports external association failures for binary documents', async () => {
  const { open, openTab, lessonOperation, result } = mount()
  lessonOperation.mockImplementation(async input => input.operation === 'recent-workspaces' ? { recent: [] } : { opened: false, openError: '未找到关联程序' })
  await open('book.docx')
  expect(openTab).not.toHaveBeenCalled()
  expect(lessonOperation).toHaveBeenCalledWith({ operation: 'open-external', path: '/workspace/book.docx' })
  expect(result.current.state.error).toContain('无法用系统应用打开 book.docx：未找到关联程序')
})

it.each(['script.cmd', 'README', 'data.jsonc'])('keeps invalid text in %s out of the automatic external execution path', async name => {
  const { open, openTab, lessonOperation, result } = mount()
  openTab.mockRejectedValueOnce(Object.assign(new Error('不是 UTF-8 编码的文本文件'), { code: 'TEXT_ENCODING_UNSUPPORTED' }))
  await open(name)
  expect(lessonOperation.mock.calls.some(([request]) => request.operation === 'open-external')).toBe(false)
  expect(result.current.state.error).toContain('不是 UTF-8')
})
