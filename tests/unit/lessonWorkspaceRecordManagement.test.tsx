import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectorySessionList } from '../../src/renderer/lessonWorkspace/view/LessonWorkspaceView'
import { RecordManagement } from '../../src/renderer/lessonWorkspace/RecordManagement'
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

  it('cannot start a record read that the deletion gate would reject while a deletion runs', async () => {
    // 主进程在删除期间拒绝一切记录读取（src/main/localAgent/service.ts:37-39 的
    // assertLocalAgentRecordsAvailable，由 src/main/lessonDesktopService.ts:74 调用）。
    // 展开请求必须在本地收回，否则用户看到的是自造的「正在删除应用对话记录，请稍后重试」。
    let resolveDelete!: (result: LessonDesktopResult) => void
    const deletion = new Promise<LessonDesktopResult>(resolve => { resolveDelete = resolve })
    const operation = vi.fn(async (request: LessonDesktopRequest) => {
      if (request.operation === 'read-application-record-usage') return { recordUsage: usage }
      if (request.operation === 'delete-conversation') return deletion
      return {}
    })
    renderList(operation)
    const summary = screen.getByText('管理对话记录')
    const disclosure = summary.closest('details')!
    const reads = () => operation.mock.calls.filter(([request]) => request.operation === 'read-application-record-usage').length

    // 非删除状态下展开确实会读取占用：证明下面的断言不是因为展开本来就无效。
    fireEvent.click(summary)
    expect(await screen.findByText('当前目录：1.5 KB')).toBeInTheDocument()
    expect(reads()).toBe(1)
    fireEvent.click(summary)
    expect(disclosure.open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '删除应用记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: 'delete-conversation', owner, conversationId: conversation.conversationId }))

    expect(disclosure).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '删除全部应用对话记录' })).toBeDisabled()
    fireEvent.click(summary)
    await waitFor(() => expect(disclosure.open).toBe(false))
    expect(reads()).toBe(1)
    expect(screen.queryByText(/占用统计失败/)).not.toBeInTheDocument()

    await act(async () => { resolveDelete({ conversations: [] }); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // 删除结束后恢复可展开：删除后刷新占用是第 2 次读取，重新展开是第 3 次。
    expect(disclosure).not.toHaveAttribute('aria-disabled')
    await waitFor(() => expect(reads()).toBe(2))
    fireEvent.click(summary)
    expect(disclosure.open).toBe(true)
    await waitFor(() => expect(reads()).toBe(3))
  })
})

describe('课例归属的记录管理分支', () => {
  const lesson = { schemaVersion: 1 as const, lessonId: 'lesson', normalizedDirectory: '/lesson' }
  const lessonOwner = { kind: 'lesson' as const, lesson }
  const lessonRecord: LessonConversation = { schemaVersion: 1, conversationId: '855f88a9-3f89-4513-baea-25cbe2d14598',
    lesson, title: '课例讨论', createdAt: 1, updatedAt: 1, sessionIds: [], epoch: 0 }

  function renderManagement(ownerLabel?: string) {
    const operation = vi.fn(async (request: LessonDesktopRequest): Promise<LessonDesktopResult> => {
      if (request.operation === 'read-application-record-usage') return { recordUsage: usage }
      if (request.operation === 'delete-conversation') return { conversations: [] }
      return {}
    })
    const onRecordsChange = vi.fn()
    const onDeleted = vi.fn()
    render(<RecordManagement owner={lessonOwner} ownerLabel={ownerLabel} conversations={[lessonRecord]} operation={operation}
      onRecordsChange={onRecordsChange} onDeleted={onDeleted}>{state => <div>{state.management}</div>}</RecordManagement>)
    return { operation, onRecordsChange, onDeleted }
  }

  it('reads and deletes the lesson scope with the lesson owner and lesson-specific wording', async () => {
    const callbacks = renderManagement()
    fireEvent.click(screen.getByText('管理对话记录'))
    expect(await screen.findByText('当前课例：1.5 KB')).toBeInTheDocument()
    expect(screen.getByText('全应用：3.0 MB')).toBeInTheDocument()
    expect(callbacks.operation).toHaveBeenCalledWith({ operation: 'read-application-record-usage', owner: lessonOwner })

    fireEvent.click(screen.getByRole('button', { name: '删除本课例对话记录' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('删除“课例”的全部对话、任务与日志？')
    expect(dialog).toHaveTextContent('课例文件、附件、工程和未保存恢复稿保留')
    expect(dialog).not.toHaveTextContent('不会删除工作空间或项目中的任何文件')
    fireEvent.click(screen.getByRole('button', { name: '确认删除记录' }))
    await waitFor(() => expect(callbacks.onRecordsChange).toHaveBeenCalledWith([]))
    expect(callbacks.operation).toHaveBeenCalledWith({ operation: 'delete-conversation', owner: lessonOwner })
    expect(callbacks.onDeleted).toHaveBeenCalledWith([lessonRecord.conversationId])
  })

  it('names the lesson by its explicit label when one is provided', async () => {
    renderManagement('电路')
    fireEvent.click(screen.getByRole('button', { name: '删除本课例对话记录' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('删除“电路”的全部对话、任务与日志？')
  })
})
