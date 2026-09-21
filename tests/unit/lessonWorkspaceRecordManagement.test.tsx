import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectorySessionList } from '../../src/renderer/lessonWorkspace/view/LessonWorkspaceView'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../src/shared/lessonDesktopContract'
import type { LessonConversation } from '../../src/shared/lessonWorkspace'

afterEach(cleanup)

const owner = { kind: 'workspace' as const, workspaceRoot: '/workspace' }
const conversation: LessonConversation = {
  schemaVersion: 1,
  conversationId: '4e33635f-81fe-4c2e-a55c-32c942d53e6c',
  owner,
  title: '目录讨论',
  createdAt: 1,
  updatedAt: 1,
  sessionIds: [],
  epoch: 0,
}
const usage = { version: 1 as const, currentScopeBytes: 1536, applicationBytes: 3 * 1024 * 1024, measuredAt: 1 }

function renderList(operation: (request: LessonDesktopRequest) => Promise<LessonDesktopResult>) {
  const onRecordsChange = vi.fn()
  const onDeleted = vi.fn()
  const onAllDeleted = vi.fn()
  render(<DirectorySessionList
    owner={owner}
    conversations={[conversation]}
    currentId={conversation.conversationId}
    operation={operation}
    onRecordsChange={onRecordsChange}
    onDeleted={onDeleted}
    onAllDeleted={onAllDeleted}
    onSelect={vi.fn()}
  />)
  return { onRecordsChange, onDeleted, onAllDeleted }
}

describe('workspace directory record management', () => {
  it('uses the shared usage and selective-delete flow in the real directory list', async () => {
    let reads = 0
    const operation = vi.fn(async request => {
      if (request.operation === 'read-application-record-usage') {
        reads++
        return { recordUsage: reads === 1 ? usage : { ...usage, currentScopeBytes: 0, applicationBytes: 1024 } }
      }
      if (request.operation === 'delete-conversation') return { conversations: [] }
      return {}
    })
    const callbacks = renderList(operation)
    expect(operation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('管理对话记录'))
    expect(await screen.findByText('当前目录：1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('全应用：3.0 MB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除应用记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('不会删除工作空间或项目中的任何文件')
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(callbacks.onRecordsChange).toHaveBeenCalledWith([])
    expect(callbacks.onDeleted).toHaveBeenCalledWith([conversation.conversationId])
    expect(await screen.findByText('当前目录：0 B')).toBeInTheDocument()
  })

  it('keeps confirmation open and does not publish success when deletion fails', async () => {
    const operation = vi.fn(async request => {
      if (request.operation === 'delete-conversation') throw new Error('删除服务暂时不可用')
      if (request.operation === 'read-application-record-usage') return { recordUsage: usage }
      return {}
    })
    const callbacks = renderList(operation)
    fireEvent.click(screen.getByRole('button', { name: '删除应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除未确认完成：删除服务暂时不可用')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(callbacks.onRecordsChange).not.toHaveBeenCalled()
    expect(callbacks.onDeleted).not.toHaveBeenCalled()
  })

  it('reports whole-application deletion so every rendered directory list can be cleared', async () => {
    const operation = vi.fn(async request => request.operation === 'read-application-record-usage'
      ? { recordUsage: { ...usage, currentScopeBytes: 0, applicationBytes: 0 } }
      : request.operation === 'delete-all-application-records' ? { conversations: [] } : {})
    const callbacks = renderList(operation)
    fireEvent.click(screen.getByText('管理对话记录'))
    await screen.findByText('当前目录：0 B')
    fireEvent.click(screen.getByRole('button', { name: '删除全部应用对话记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(callbacks.onAllDeleted).toHaveBeenCalledOnce())
    expect(operation).toHaveBeenCalledWith({ operation: 'delete-all-application-records' })
  })

  it('focuses cancel, closes on Escape, and returns focus to the delete trigger', async () => {
    const operation = vi.fn(async request => request.operation === 'read-application-record-usage' ? { recordUsage: usage } : {})
    renderList(operation)
    const trigger = screen.getByRole('button', { name: '删除应用记录' })
    trigger.focus()
    fireEvent.click(trigger)
    const cancel = await screen.findByRole('button', { name: '取消' })
    await waitFor(() => expect(cancel).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('ignores late usage and deletion results after an A to B to A scope cycle', async () => {
    let resolveUsage!: (result: LessonDesktopResult) => void
    let resolveDelete!: (result: LessonDesktopResult) => void
    const lateUsage = new Promise<LessonDesktopResult>(resolve => { resolveUsage = resolve })
    const lateDelete = new Promise<LessonDesktopResult>(resolve => { resolveDelete = resolve })
    const ownerB = { kind: 'workspace' as const, workspaceRoot: '/workspace-b' }
    const conversationB: LessonConversation = { ...conversation, conversationId: '855f88a9-3f89-4513-baea-25cbe2d14598', owner: ownerB }
    const operation = vi.fn(async request => {
      if (request.operation === 'read-application-record-usage') return lateUsage
      if (request.operation === 'delete-conversation') return lateDelete
      return {}
    })
    const onRecordsChange = vi.fn()
    const onDeleted = vi.fn()
    const list = (currentOwner: typeof owner | typeof ownerB, currentConversation: LessonConversation) => <DirectorySessionList
      owner={currentOwner}
      conversations={[currentConversation]}
      currentId={currentConversation.conversationId}
      operation={operation}
      onRecordsChange={onRecordsChange}
      onDeleted={onDeleted}
      onSelect={vi.fn()}
    />
    const view = render(list(owner, conversation))
    fireEvent.click(screen.getByText('管理对话记录'))
    fireEvent.click(screen.getByRole('button', { name: '删除应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: 'delete-conversation', owner, conversationId: conversation.conversationId }))
    view.rerender(list(ownerB, conversationB))
    view.rerender(list(owner, conversation))
    await waitFor(() => expect(screen.getByText('当前目录：未读取')).toBeInTheDocument())
    await act(async () => {
      resolveUsage({ recordUsage: usage })
      resolveDelete({ conversations: [] })
      await Promise.resolve()
    })
    expect(screen.getByText('当前目录：未读取')).toBeInTheDocument()
    expect(screen.queryByText('当前目录：1.5 KB')).not.toBeInTheDocument()
    expect(onRecordsChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
