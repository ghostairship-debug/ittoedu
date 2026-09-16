import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LessonConversationNavigation, type LessonConversationNavigationProps } from '../../src/renderer/lessonWorkspace/LessonConversationNavigation'
import type { LessonConversation } from '../../src/shared/lessonWorkspace'
afterEach(cleanup)
const identity = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: '/lesson' }
const record = (id: string, title: string): LessonConversation => ({ schemaVersion: 1, conversationId: id, lesson: identity, title, createdAt: 0, updatedAt: 0, sessionIds: [], epoch: 0 })
function props(overrides: Partial<LessonConversationNavigationProps> = {}): LessonConversationNavigationProps { return { lesson: { identity, manifest: { schemaVersion: 1, lessonId: 'lesson', title: '电路', documents: {} } }, conversations: [record('a', '主讨论'), record('b', '实验')], currentId: 'a', operation: vi.fn(async () => ({})), onSelect: vi.fn(async () => undefined), onRecordsChange: vi.fn(), onDeleted: vi.fn(), ...overrides } }
describe('lesson conversation navigation', () => {
  it('searches through the record service and creates a distinct discussion branch', async () => {
    const branch = { ...record('branch', '讨论分支：主讨论'), parentConversationId: 'a' }
    const input = props({ operation: vi.fn(async request => request.operation === 'search-conversations' ? { matches: [{ conversationId: 'a', excerpt: '电流处处相等' }] } : { conversation: branch }) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索对话' }), { target: { value: '电流' } })
    await screen.findByText('电流处处相等')
    expect(screen.queryByRole('button', { name: /^实验$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '从主讨论创建讨论分支' }))
    await waitFor(() => expect(input.onSelect).toHaveBeenCalledWith(branch))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'branch-conversation', lesson: identity, conversationId: 'a' })
  })
  it('shows the deletion scope before calling the service and preserves navigation on cancellation', async () => {
    const input = props({ operation: vi.fn(async () => ({ conversations: [record('b', '实验')] })) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '删除主讨论的应用记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('课例文件、附件、工程和未保存恢复稿保留')
    expect(input.operation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(input.onDeleted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除主讨论的应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(input.onDeleted).toHaveBeenCalledWith(['a']))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'delete-conversation', lesson: identity, conversationId: 'a' })
  })
  it('sends the explicit whole-application scope without a lesson alias', async () => {
    const input = props({ operation: vi.fn(async () => ({ conversations: [] })) })
    render(<LessonConversationNavigation {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '删除全部应用对话记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('全部课例和独立工程')
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(input.onDeleted).toHaveBeenCalledWith(['a', 'b']))
    expect(input.operation).toHaveBeenCalledWith({ operation: 'delete-all-application-records' })
  })
})
