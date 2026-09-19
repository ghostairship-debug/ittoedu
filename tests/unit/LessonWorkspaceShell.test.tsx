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
    fireEvent.click((await screen.findAllByRole('button', { name: '新建课件' }))[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: '课件名称' }), { target: { value: '电路' } })
    expect(screen.getByText('将创建：/workspace/电路')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建课件' }))
    await screen.findByText('当前课例：电路')
    expect(operation).toHaveBeenCalledWith({ operation: 'create-lesson', directory: '/workspace', name: '电路' })
    expect(screen.getByTestId('course')).toBeInTheDocument()
    expect(onNewProject).toHaveBeenCalledTimes(1)
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
    fireEvent.click(await screen.findByRole('button', { name: 'plan.md' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'plan.md' }))
    await screen.findByRole('button', { name: '此处保留当前稿' })
    expect(screen.getByRole('tab', { name: /plan.md/ })).toBeInTheDocument()
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
    fireEvent.click(screen.getByLabelText('切换工作空间'))
    fireEvent.click(screen.getByRole('button', { name: '选择其他工作空间文件夹…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'plan.md' }))
    await screen.findByRole('region', { name: '教学文档 plan.md' })
    await expect(handle.current!.editDocument('/WORKSPACE\\A\\PLAN.MD', { version: 1, kind: 'directory', normalizedDirectory: '/workspace', conversationId: 'c' }, 'codex', '改写标题')).resolves.toBeUndefined()
    expect(documentAiOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'start', ref: expect.objectContaining({ kind: 'file' }) }))
  })
  it('keeps the directory conversation when opening a course file', async () => {
    const directoryConversation: LessonConversation = {
      schemaVersion: 1, conversationId: '11111111-1111-4111-8111-111111111111',
      owner: { kind: 'workspace', workspaceRoot: '/workspace' },
      title: '空目录对话', createdAt: 1, updatedAt: 1, epoch: 0, sessionIds: [],
    }
    const onOpenProject = vi.fn(async () => true)
    const onActive = vi.fn()
    const handle = createRef<LessonWorkspaceShellHandle>()
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [] }
        case 'create-conversation': return { conversation: directoryConversation }
        case 'list-directory': return { entries: [{ kind: 'file' as const, name: '电路.h5lesson', path: '/workspace/电路.h5lesson' }] }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={onOpenProject} onNewProject={async () => true} onActiveLesson={onActive} renderChat={() => <div>课例对话不应出现</div>} renderDirectoryChat={(_root, conversation) => <div>目录会话：{conversation.title}</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click((await screen.findAllByRole('button', { name: '新建工作空间会话' }))[0]!)
    await screen.findByText('目录会话：空目录对话')
    fireEvent.click(await screen.findByRole('button', { name: '电路.h5lesson' }))
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('/workspace/电路.h5lesson'))
    expect(screen.getByText('目录会话：空目录对话')).toBeInTheDocument()
    handle.current!.detachLesson()
    expect(screen.getByText('目录会话：空目录对话')).toBeInTheDocument()
    expect(screen.queryByText('课例对话不应出现')).not.toBeInTheDocument()
    expect(onActive).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ conversationId: expect.anything() }))
  })
  it('keeps a single chat instance when stacked', async () => {
    localStorage.setItem('guoling-workbench-layout-v1', JSON.stringify({
      contentDock: 'bottom', navWidth: 264, navCollapsed: false, contentWidth: 46, contentHeight: 52,
      contentClosed: false, chatClosed: false, explorerOpen: true, conversationsOpen: true,
    }))
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [] }
        case 'list-directory': return { entries: [] }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <div>课例对话</div>} renderDirectoryChat={() => <div>目录会话</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    await screen.findByLabelText('课例对话')
    expect(screen.getAllByLabelText('课例对话')).toHaveLength(1)
    localStorage.removeItem('guoling-workbench-layout-v1')
  })
  it('keeps course and chat mounted when collapsing chat and entering editor focus', async () => {
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [] }
        case 'list-directory': return { entries: [] }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <div>课例对话</div>} renderDirectoryChat={() => <div>目录会话</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    const chat = await screen.findByLabelText('课例对话')
    const course = screen.getByTestId('course')
    fireEvent.click(screen.getByLabelText('布局'))
    fireEvent.click(screen.getByRole('button', { name: '收起对话区' }))
    expect(document.querySelector('[aria-label="课例对话"]')).toBe(chat)
    expect(screen.getByRole('button', { name: '展开对话' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在编辑器中打开' }))
    expect(document.querySelector('.lesson-workspace-shell')).toHaveAttribute('data-editor-focus', 'true')
    expect(screen.getByTestId('course')).toBe(course)
    expect(document.querySelector('[aria-label="课例对话"]')).toBe(chat)
    fireEvent.click(screen.getByRole('button', { name: '返回工作台' }))
    expect(document.querySelector('.lesson-workspace-shell')).not.toHaveAttribute('data-editor-focus')
    expect(screen.getByTestId('course')).toBe(course)
    expect(document.querySelector('[aria-label="课例对话"]')).toBe(chat)
  })
  it('reports a failed system-host open without claiming the file was edited', async () => {
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [] }
        case 'list-directory': return { entries: [{ kind: 'file' as const, name: 'notes.docx', path: '/workspace/notes.docx' }] }
        case 'open-external': return { opened: false, openError: 'There is no application associated with the given file name extension.' }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <div>课例对话</div>} renderDirectoryChat={() => <div>目录会话</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'notes.docx' }))
    await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: 'open-external', path: '/workspace/notes.docx' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('无法用系统应用打开 notes.docx')
    expect(screen.queryByRole('tab', { name: /notes.docx/ })).not.toBeInTheDocument()
  })
  it('picks a specified older directory conversation instead of the latest', async () => {
    const older: LessonConversation = {
      schemaVersion: 1, conversationId: '11111111-1111-4111-8111-111111111111',
      owner: { kind: 'workspace', workspaceRoot: '/workspace' },
      title: '较早的讨论', createdAt: 1, updatedAt: 1, epoch: 0, sessionIds: [],
    }
    const newer: LessonConversation = {
      schemaVersion: 1, conversationId: '22222222-2222-4222-8222-222222222222',
      owner: { kind: 'workspace', workspaceRoot: '/workspace' },
      title: '最近的讨论', createdAt: 2, updatedAt: 2, epoch: 0, sessionIds: [],
    }
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [older, newer] }
        case 'list-directory': return { entries: [] }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <div>课例对话</div>} renderDirectoryChat={(_root, conversation) => <div>当前会话：{conversation.title}</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: '较早的讨论' }))
    await screen.findByText('当前会话：较早的讨论')
    expect(screen.queryByText('当前会话：最近的讨论')).not.toBeInTheDocument()
  })
  it('opens Markdown as a file ref after switching from a lesson to a directory conversation', async () => {
    const lesson: LessonWorkspace = { identity: { schemaVersion: 1, lessonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', normalizedDirectory: '/workspace/电路' }, manifest: { schemaVersion: 1, lessonId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '电路', documents: {} } }
    const lessonConversation: LessonConversation = { schemaVersion: 1, conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lesson: lesson.identity, title: '课例主对话', createdAt: 0, updatedAt: 0, epoch: 0, sessionIds: [] }
    const older: LessonConversation = { schemaVersion: 1, conversationId: '11111111-1111-4111-8111-111111111111', owner: { kind: 'workspace', workspaceRoot: '/workspace' }, title: '较早的讨论', createdAt: 1, updatedAt: 1, epoch: 0, sessionIds: [] }
    const newer: LessonConversation = { schemaVersion: 1, conversationId: '22222222-2222-4222-8222-222222222222', owner: { kind: 'workspace', workspaceRoot: '/workspace' }, title: '最近的讨论', createdAt: 2, updatedAt: 2, epoch: 0, sessionIds: [] }
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return request.lesson ? { conversations: [lessonConversation] } : { conversations: [older, newer] }
        case 'create-lesson': return { lesson, conversation: lessonConversation }
        case 'create-conversation': return { conversation: lessonConversation }
        case 'list-directory': return request.directory === '/workspace/电路'
          ? { entries: [{ kind: 'file' as const, name: 'plan.md', path: '/workspace/电路/plan.md' }] }
          : { entries: [{ kind: 'directory' as const, name: '电路', path: '/workspace/电路' }] }
        default: return {}
      }
    })
    const port: RecoverableDocumentFilePort = {
      openDocument: async ref => ({ ref, source: '# 策划', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }),
      watchDocument: () => () => {}, saveDocument: vi.fn(),
      prepareAiEdit: async (ref, ranges, epoch) => ({ status: 'ready', document: { ref, source: '# 策划', version: { contentVersion: 'v1', attachments: [] }, diagnostics: [] }, epoch, ranges }),
      applyAiEdit: vi.fn(), revertAiEdit: vi.fn(),
    }
    const documentAiOperation = vi.fn(async () => ({ taskId: '00000000-0000-4000-8000-000000000001', sessionId: 'session-a', status: 'stopped' as const, message: 'file start' })) as unknown as LessonDocumentAiAPI
    const handle = createRef<LessonWorkspaceShellHandle>()
    const onActiveLesson = vi.fn()
    render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={port} documentAiOperation={documentAiOperation} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} onActiveLesson={onActiveLesson} renderChat={() => <div>课例对话面板</div>} renderDirectoryChat={(_root, conversation) => <div>目录会话：{conversation.title}</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    fireEvent.click((await screen.findAllByRole('button', { name: '新建课件' }))[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: '课件名称' }), { target: { value: '电路' } })
    fireEvent.click(screen.getByRole('button', { name: '创建课件' }))
    await screen.findByText('课例对话面板')
    fireEvent.click(await screen.findByRole('button', { name: '较早的讨论' }))
    await screen.findByText('目录会话：较早的讨论')
    expect(screen.queryByText('课例对话面板')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '电路' }))
    fireEvent.click(await screen.findByRole('button', { name: 'plan.md' }))
    await screen.findByRole('region', { name: '教学文档 plan.md' })
    await expect(handle.current!.editDocument('/workspace/电路/plan.md', { version: 1, kind: 'directory', normalizedDirectory: '/workspace', conversationId: older.conversationId }, 'codex', '改写标题')).resolves.toBeUndefined()
    expect(documentAiOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'start', ref: expect.objectContaining({ kind: 'file', path: '/workspace/电路/plan.md' }) }))
  })
  it('projects the same workbench chat in editor focus instead of unmounting it', async () => {
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      switch (request.operation) {
        case 'choose-workspace': return { directory: '/workspace' }
        case 'list-lessons': return { lessons: [] }
        case 'list-projects': return { projects: [] }
        case 'list-conversations': return { conversations: [] }
        case 'list-directory': return { entries: [] }
        default: return {}
      }
    })
    render(<LessonWorkspaceShell lessonOperation={operation} documentPort={{} as LessonWorkspaceShellProps['documentPort']} projectId="project" projectPath={null} onOpenProject={async () => true} onNewProject={async () => true} renderChat={() => <div>课例对话</div>} renderDirectoryChat={() => <div>目录会话</div>}><div data-testid="course">工程保持挂载</div></LessonWorkspaceShell>)
    fireEvent.click(screen.getAllByRole('button', { name: '打开工作空间' })[0]!)
    const chat = await screen.findByLabelText('课例对话')
    fireEvent.click(screen.getByRole('button', { name: '在编辑器中打开' }))
    expect(document.querySelector('.lesson-workspace-shell')).toHaveAttribute('data-editor-focus', 'true')
    expect(document.querySelector('[aria-label="课例对话"]')).toBe(chat)
    expect(screen.getByLabelText('课例对话')).toBeVisible()
  })
})
