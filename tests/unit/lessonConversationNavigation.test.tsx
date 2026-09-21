import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonConversationNavigation, type LessonConversationNavigationProps } from '../../src/renderer/lessonWorkspace/LessonConversationNavigation'
import type { LessonConversation } from '../../src/shared/lessonWorkspace'
afterEach(cleanup)
const identity = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: '/lesson' }
const record = (id: string, title: string): LessonConversation => ({ schemaVersion: 1, conversationId: id, lesson: identity, title, createdAt: 0, updatedAt: 0, sessionIds: [], epoch: 0 })
const usage = (currentScopeBytes: number, applicationBytes: number) => ({ version: 1 as const, currentScopeBytes, applicationBytes, measuredAt: 1 })
function props(overrides: Partial<LessonConversationNavigationProps> = {}): LessonConversationNavigationProps { return { owner: { kind: 'lesson', lesson: identity }, ownerLabel: '电路', conversations: [record('a', '主讨论'), record('b', '实验')], currentId: 'a', operation: vi.fn(async request => request.operation === 'read-application-record-usage' ? { recordUsage: usage(1024, 2048) } : {}), onSelect: vi.fn(async () => undefined), onRecordsChange: vi.fn(), onDeleted: vi.fn(), ...overrides } }
describe('lesson conversation navigation', () => {
  it('searches through the record service and creates a distinct discussion branch', async () => {
    const branch = { ...record('branch', '讨论分支：主讨论'), parentConversationId: 'a' }
    const input = props({ operation: vi.fn(async request => request.operation === 'read-application-record-usage' ? { recordUsage: usage(1024, 2048) } : request.operation === 'search-conversations' ? { matches: [{ conversationId: 'a', excerpt: '电流处处相等' }] } : { conversation: branch }) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索对话' }), { target: { value: '电流' } })
    await screen.findByText('电流处处相等')
    expect(screen.queryByRole('button', { name: /^实验$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '从主讨论创建讨论分支' }))
    await waitFor(() => expect(input.onSelect).toHaveBeenCalledWith(branch))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'branch-conversation', owner: { kind: 'lesson', lesson: identity }, conversationId: 'a' })
  })
  it('shows the deletion scope before calling the service and preserves navigation on cancellation', async () => {
    const input = props({ operation: vi.fn(async request => request.operation === 'read-application-record-usage' ? { recordUsage: usage(512, 1536) } : { conversations: [record('b', '实验')] }) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '删除主讨论的应用记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('课例文件、附件、工程和未保存恢复稿保留')
    expect(input.operation).not.toHaveBeenCalledWith({ operation: 'delete-conversation', owner: { kind: 'lesson', lesson: identity }, conversationId: 'a' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(input.onDeleted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除主讨论的应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(input.onDeleted).toHaveBeenCalledWith(['a']))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'delete-conversation', owner: { kind: 'lesson', lesson: identity }, conversationId: 'a' })
  })
  it('sends the explicit whole-application scope without a lesson alias', async () => {
    const input = props({ operation: vi.fn(async request => request.operation === 'read-application-record-usage' ? { recordUsage: usage(0, 0) } : { conversations: [] }) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '删除全部应用对话记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('全部课例和独立工程')
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(input.onDeleted).toHaveBeenCalledWith(['a', 'b']))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'delete-all-application-records' })
  })
  it('shows current and whole-application usage and refreshes after selective deletion', async () => {
    let reads = 0
    const input = props({ owner: { kind: 'project', workspaceRoot: '/workspace', projectPath: '/workspace/project' }, operation: vi.fn(async request => {
      if (request.operation === 'read-application-record-usage') return { recordUsage: reads++ === 0 ? usage(1536, 3 * 1024 * 1024) : usage(0, 2 * 1024 * 1024) }
      return { conversations: [] }
    }) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.click(screen.getByText('管理对话记录'))
    expect(await screen.findByText('当前项目：1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('全应用：3.0 MB')).toBeInTheDocument()
    expect(screen.getByText(/外部 CLI 历史需在对应 CLI 中单独处理/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除本项目对话记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(screen.getByText('当前项目：0 B')).toBeInTheDocument())
    expect(screen.getByText('全应用：2.0 MB')).toBeInTheDocument()
    expect(input.operation).toHaveBeenCalledWith({ operation: 'delete-conversation', owner: input.owner })
    expect(input.operation).toHaveBeenLastCalledWith({ operation: 'read-application-record-usage', owner: input.owner })
  })
  it('reads usage only when record management opens and closes deletion before a refresh failure', async () => {
    let failRefresh = false
    let rejectRefresh!: (reason?: unknown) => void
    const refreshFailure = new Promise<never>((_resolve, reject) => { rejectRefresh = reject })
    let usageReads = 0
    const createOperation = () => vi.fn(async request => {
      if (request.operation === 'read-application-record-usage') {
        usageReads++
        if (failRefresh) return refreshFailure
        return { recordUsage: usage(1024, 2048) }
      }
      if (request.operation === 'delete-conversation') { failRefresh = true; return { conversations: [] } }
      return {}
    })
    const firstOperation = createOperation()
    const input = props({ operation: firstOperation })
    const view = render(<LessonConversationNavigation {...input} />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(firstOperation).not.toHaveBeenCalledWith({ operation: 'read-application-record-usage', owner: input.owner })
    fireEvent.click(screen.getByText('管理对话记录'))
    await waitFor(() => expect(firstOperation).toHaveBeenCalledWith({ operation: 'read-application-record-usage', owner: input.owner }))
    expect(usageReads).toBe(1)
    const replacementOperation = createOperation()
    view.rerender(<LessonConversationNavigation {...input} operation={replacementOperation} />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(usageReads).toBe(1)
    expect(replacementOperation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除主讨论的应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rejectRefresh(new Error('统计暂时不可用'))
    expect(await screen.findByRole('alert')).toHaveTextContent('统计暂时不可用')
    expect(screen.getByText(/点击“刷新占用”重试/)).toBeInTheDocument()
  })
})
