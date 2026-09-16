import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { LessonWorkspaceShell, type LessonWorkspaceShellProps, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { LessonWorkspace, LessonConversation } from '../../src/shared/lessonWorkspace'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import type { LessonDocumentAiAPI } from '../../src/shared/lessonDocumentAiTask'

afterEach(cleanup)

describe('LessonWorkspaceShell', () => {
  it('creates a named real lesson before opening its conversation and keeps course content mounted', async () => {
    const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'lesson-a', normalizedDirectory: '/workspace/电路' }, manifest: { schemaVersion: 1, lessonId: 'lesson-a', title: '电路', documents: {} } }
    const conversation: LessonConversation = { schemaVersion: 1, conversationId: 'chat-a', lesson: lesson.identity, title: '主对话', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [] }
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-directory': return { entries: [] }
        case 'create-lesson': return { lesson }
        case 'list-conversations': return { conversations: [] }
        case 'create-conversation': return { conversation }
        default: return {}
      }
    })
    const onActive = vi.fn(), onNewProject = vi.fn(async () => true)
    const props: LessonWorkspaceShellProps = { lessonOperation: operation, documentPort: {} as LessonWorkspaceShellProps['documentPort'], projectId: 'project', projectPath: null, onOpenProject: async () => true, onNewProject, onActiveLesson: onActive, renderChat: active => <div>当前课例：{active.manifest.title}</div>, children: <div data-testid="course">工程保持挂载</div> }
    render(<LessonWorkspaceShell {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '新建课例' }))
    fireEvent.change(screen.getByRole('textbox', { name: '课例名称' }), { target: { value: '电路' } })
    expect(screen.getByText('将创建：/workspace/电路')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建课例' }))
    await screen.findByText('当前课例：电路')
    expect(operation).toHaveBeenCalledWith({ operation: 'create-lesson', directory: '/workspace', name: '电路' })
    expect(screen.getByTestId('course')).toBeInTheDocument()
    expect(onNewProject).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '新建独立课件' }))
    await waitFor(() => expect(onActive).toHaveBeenLastCalledWith(null, null))
    expect(screen.queryByText('当前课例：电路')).not.toBeInTheDocument()
  })
  it('blocks closeAll on a document conflict and preserves all drafts before closing tabs', async () => {
    const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'a', normalizedDirectory: '/workspace/a' }, manifest: { schemaVersion: 1, lessonId: 'a', title: '课例A', documents: {} } }
    const conversation: LessonConversation = { schemaVersion: 1, conversationId: 'c', lesson: lesson.identity, title: '对话A', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [] }
    const operation: LessonWorkspaceShellProps['lessonOperation'] = async request => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [lesson] }
        case 'list-directory': return { entries: [{ kind: 'file', name: 'plan.md', path: '/workspace/a/plan.md' }] }
        case 'list-conversations': return { conversations: [conversation] }
        default: return {}
      }
    }
    let failRecovery = true
    const port: RecoverableDocumentFilePort = {
      openDocument: async ref => ({ ref, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] }, diagnostics: [] }),
      readRecovery: async () => ({ source: '教师稿', expectedVersion: { contentVersion: 'v1', attachments: [] }, baseSource: '原稿' }),
      preserveDraft: async () => { if (failRecovery) throw new Error('disk full') }, watchDocument: () => () => {}, saveDocument: vi.fn(), prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    const handle = createRef<LessonWorkspaceShellHandle>()
    render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={port} projectId="p" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <p>对话内容</p>}>课件内容</LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: /课例A/ }))
    await screen.findByText('对话内容')
    fireEvent.click(screen.getByRole('button', { name: 'plan.md' }))
    await screen.findByRole('button', { name: '此处保留当前稿' })
    expect(await handle.current!.closeAll()).toBe(false)
    expect(await handle.current!.preserveAll()).toBe(false)
    expect(screen.getByRole('tab', { name: /plan.md/ })).toBeInTheDocument()
    failRecovery = false
    expect(await handle.current!.preserveAll()).toBe(true)
    expect(port.saveDocument).not.toHaveBeenCalled()
  })
  it('keeps the active document mounted when a lesson switch cannot flush it, while narrow-pane selection only changes visibility', async () => {
    const first: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'a', normalizedDirectory: '/workspace/a' }, manifest: { schemaVersion: 1, lessonId: 'a', title: '课例A', documents: {} } }
    const second: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'b', normalizedDirectory: '/workspace/b' }, manifest: { schemaVersion: 1, lessonId: 'b', title: '课例B', documents: {} } }
    const conversation = (lesson: LessonWorkspace): LessonConversation => ({ schemaVersion: 1, conversationId: `chat-${lesson.identity.lessonId}`, lesson: lesson.identity, title: '主对话', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [] })
    const operation: LessonWorkspaceShellProps['lessonOperation'] = async request => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [first, second] }
        case 'list-conversations': return { conversations: [conversation(request.lesson!.lessonId === 'a' ? first : second)] }
        case 'list-directory': return { entries: [{ kind: 'file', name: 'plan.md', path: '/workspace/a/plan.md' }] }
        default: return {}
      }
    }
    const port: RecoverableDocumentFilePort = {
      openDocument: async ref => ({ ref, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] }, diagnostics: [] }),
      readRecovery: async () => ({ source: '教师稿', expectedVersion: { contentVersion: 'v1', attachments: [] }, baseSource: '原稿' }),
      preserveDraft: vi.fn(), watchDocument: () => () => {}, saveDocument: vi.fn(), prepareAiEdit: vi.fn(), applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={port} projectId="p" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={lesson => <p>当前对话：{lesson.manifest.title}</p>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: /课例A/ }))
    await screen.findByText('当前对话：课例A')
    fireEvent.click(screen.getByRole('button', { name: 'plan.md' }))
    await screen.findByRole('button', { name: '此处保留当前稿' })
    fireEvent.click(screen.getByRole('button', { name: /课例B/ }))
    await screen.findByText('请先在文档标签处理未保存稿或文件冲突，再切换课例。')
    expect(screen.getByRole('tab', { name: /plan.md/ })).toBeInTheDocument()
    expect(screen.getByText('当前对话：课例A')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '文档与课件' }))
    expect(screen.getByLabelText('课例工作台').parentElement).toHaveAttribute('data-active-pane', 'workbench')
    expect(screen.getByTestId('course')).toBeInTheDocument()
  })
  it('shows a standalone course and reuses an already-open document despite slash or casing differences', async () => {
    const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'a', normalizedDirectory: '/workspace/a' }, manifest: { schemaVersion: 1, lessonId: 'a', title: '课例A', documents: {} } }
    const conversation: LessonConversation = { schemaVersion: 1, conversationId: 'c', lesson: lesson.identity, title: '主对话', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [] }
    const operation: LessonWorkspaceShellProps['lessonOperation'] = async request => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [lesson] }
        case 'list-conversations': return { conversations: [conversation] }
        case 'list-directory': return { entries: [{ kind: 'file', name: 'plan.md', path: '/workspace/a/plan.md' }] }
        default: return {}
      }
    }
    const port: RecoverableDocumentFilePort = { openDocument: async ref => ({ ref, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] }, diagnostics: [] }), watchDocument: () => () => {}, saveDocument: vi.fn(), prepareAiEdit: async (ref, ranges, epoch) => ({ status: 'ready', document: { ref, source: '磁盘稿', version: { contentVersion: 'v2', attachments: [] }, diagnostics: [] }, epoch, ranges }), applyAiEdit: vi.fn(), revertAiEdit: vi.fn() }
    const documentAiOperation = vi.fn(async () => ({ taskId: '00000000-0000-4000-8000-000000000001', sessionId: 'session-a', status: 'stopped' as const, message: 'sentinel document port reached' })) as unknown as LessonDocumentAiAPI
    const handle = createRef<LessonWorkspaceShellHandle>()
    render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={port} documentAiOperation={documentAiOperation} projectId="p" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <p>对话内容</p>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    handle.current!.showProject()
    await waitFor(() => expect(screen.getByTestId('course')).toBeVisible())
    expect(screen.getByLabelText('课例工作台').parentElement).toHaveAttribute('data-active-pane', 'workbench')
    fireEvent.click(screen.getByRole('button', { name: '切换工作空间' }))
    fireEvent.click(await screen.findByRole('button', { name: /课例A/ }))
    await screen.findByText('对话内容')
    fireEvent.click(screen.getByRole('button', { name: 'plan.md' }))
    await screen.findByRole('region', { name: '教学文档 plan.md' })
    await expect(handle.current!.editDocument('/WORKSPACE\\A\\PLAN.MD', { version: 1, kind: 'lesson', lessonId: 'a', normalizedDirectory: '/workspace/a', conversationId: 'c' }, 'codex', '改写标题')).resolves.toBeUndefined()
    expect(documentAiOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'start', ref: expect.objectContaining({ relativePath: 'plan.md' }) }))
  })
})
