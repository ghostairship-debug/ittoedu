import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonWorkspaceShell, type LessonWorkspaceShellProps } from '@/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { LessonDesktopRequest } from '@/shared/lessonDesktopContract'
import type { LessonConversation, LessonWorkspace } from '@/shared/lessonWorkspace'

afterEach(cleanup)
const original: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'original', normalizedDirectory: '/workspace/original' }, manifest: { schemaVersion: 1, lessonId: 'original', title: '原课例', documents: {} } }
const copied: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'copy', normalizedDirectory: '/workspace/copy' }, manifest: { schemaVersion: 1, lessonId: 'copy', title: '独立副本', documents: {}, coursePath: 'course.h5lesson' } }
function conversation(lesson: LessonWorkspace): LessonConversation { return { schemaVersion: 1, conversationId: `${lesson.identity.lessonId}-chat`, lesson: lesson.identity, title: '新对话', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [], ...(lesson.manifest.coursePath ? { projectTarget: { version: 1 as const, projectId: 'saved-project', normalizedPath: `${lesson.identity.normalizedDirectory}/${lesson.manifest.coursePath}` } } : {}) } }
async function fixture() {
  let outcome: 'copy' | 'cancel' | 'self' = 'copy'
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'choose-workspace': return { directory: '/workspace' }
      case 'list-lessons': return { lessons: [original] }
      case 'list-directory': return { entries: [] }
      case 'list-conversations': return { conversations: [conversation(request.lesson?.lessonId === 'copy' ? copied : original)] }
      case 'open-lesson': {
        if (!request.asCopy) throw new Error('LESSON_COPY_REQUIRED: 原课例仍存在，请作为副本打开')
        if (outcome === 'cancel') return { cancelled: true }
        if (outcome === 'self') throw new Error('不能把原课例作为自身副本打开')
        return { lesson: copied, conversation: conversation(copied) }
      }
      default: return {}
    }
  })
  const onActive = vi.fn(), onNewProject = vi.fn(async () => true)
  render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={onNewProject} onActiveLesson={onActive} renderChat={lesson => <p>当前：{lesson.manifest.title}</p>}>原工程仍挂载</LessonWorkspaceShell>)
  fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
  fireEvent.click(await screen.findByRole('button', { name: /原课例/ }))
  await screen.findByText('当前：原课例')
  onActive.mockClear(); onNewProject.mockClear()
  return { operation, onActive, onNewProject, setOutcome(value: typeof outcome) { outcome = value } }
}

function openIndependentCopyDialog() {
  const summary = screen.getByText('课例操作')
  const details = summary.closest('details')
  if (!details?.open) fireEvent.click(summary)
  fireEvent.click(screen.getByRole('button', { name: '作为独立副本打开' }))
}

it('offers an explicit independent copy action after duplicate identity rejection and activates only the new conversation', async () => {
  const f = await fixture()
  fireEvent.click(screen.getByRole('button', { name: '打开课例' }))
  await screen.findByText(/原课例仍存在/)
  openIndependentCopyDialog()
  const copyDialog = screen.getByRole('dialog', { name: '作为独立课例副本打开' })
  expect(copyDialog).toHaveTextContent('副本会取得新的课例身份和对话')
  expect(copyDialog).toHaveTextContent('不继承原会话、候选或执行记录')
  fireEvent.click(screen.getByRole('button', { name: '选择副本目录并打开' }))
  await screen.findByText('当前：独立副本')
  expect(f.operation).toHaveBeenCalledWith({ operation: 'open-lesson', asCopy: true })
  expect(f.onActive).toHaveBeenCalledExactlyOnceWith(copied, conversation(copied))
  expect(f.onNewProject).not.toHaveBeenCalled()
  expect(f.operation.mock.calls.some(([request]) => request.operation === 'create-conversation')).toBe(false)
})

it('cancels the explanation without IPC and cancels the directory picker without replacing the active lesson', async () => {
  const f = await fixture()
  openIndependentCopyDialog()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(f.operation.mock.calls.some(([request]) => request.operation === 'open-lesson')).toBe(false)
  f.setOutcome('cancel')
  openIndependentCopyDialog()
  fireEvent.click(screen.getByRole('button', { name: '选择副本目录并打开' }))
  await waitFor(() => expect(f.operation).toHaveBeenCalledWith({ operation: 'open-lesson', asCopy: true }))
  expect(screen.getByText('当前：原课例')).toBeInTheDocument()
  expect(f.onActive).not.toHaveBeenCalled()
  expect(f.onNewProject).not.toHaveBeenCalled()
})

it('keeps the current lesson when the service rejects selecting the original directory as its own copy', async () => {
  const f = await fixture(); f.setOutcome('self')
  openIndependentCopyDialog()
  fireEvent.click(screen.getByRole('button', { name: '选择副本目录并打开' }))
  await screen.findByText('不能把原课例作为自身副本打开')
  expect(screen.getByText('当前：原课例')).toBeInTheDocument()
  expect(f.onActive).not.toHaveBeenCalled()
  expect(f.onNewProject).not.toHaveBeenCalled()
})
