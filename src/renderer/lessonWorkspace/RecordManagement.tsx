import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'
import type { LocalAgentRecordUsage } from '../../shared/localAgentRecordUsage'
import { conversationOwnerKey, type ConversationOwner, type LessonConversation } from '../../shared/lessonWorkspace'

type DeleteTarget = LessonConversation | 'owner' | 'all'

export interface RecordManagementRenderState {
  busy: boolean
  requestDelete(target: DeleteTarget): void
  management: ReactNode
}

export interface RecordManagementProps {
  owner: ConversationOwner
  ownerLabel?: string
  conversations: LessonConversation[]
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  onRecordsChange(records: LessonConversation[]): void
  onDeleted?(ids: string[]): void
  onAllDeleted?(): void
  children(state: RecordManagementRenderState): ReactNode
}

const ownerName = (owner: ConversationOwner, label?: string) => {
  if (label?.trim()) return label.trim()
  const basename = (value: string) => value.replace(/[\\/]$/, '').split(/[\\/]/).pop() || value
  return owner.kind === 'lesson' ? '课例' : owner.kind === 'workspace' ? basename(owner.workspaceRoot) : basename(owner.projectPath)
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function RecordManagement(props: RecordManagementProps) {
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null)
  const [usage, setUsage] = useState<LocalAgentRecordUsage | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const latest = useRef(props)
  latest.current = props
  const scopeKey = conversationOwnerKey(props.owner)
  const renderedScopeKey = useRef(scopeKey)
  const lifecycleEpoch = useRef(0)
  if (renderedScopeKey.current !== scopeKey) {
    renderedScopeKey.current = scopeKey
    lifecycleEpoch.current++
  }
  const usageRequest = useRef(0)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dialogTitleId = useId()
  const dialogMessageId = useId()
  const isLessonOwner = props.owner.kind === 'lesson'

  useEffect(() => {
    usageRequest.current++
    setPendingDelete(null)
    setUsage(null)
    setUsageError(null)
    setUsageLoading(false)
    setDeleting(false)
    setDeleteError(null)
  }, [scopeKey])

  useEffect(() => () => { lifecycleEpoch.current++ }, [])

  useEffect(() => {
    if (!pendingDelete) return
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    cancelButtonRef.current?.focus()
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close()
      else dialog?.removeAttribute('open')
      const returnFocus = returnFocusRef.current
      returnFocusRef.current = null
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [pendingDelete])

  async function readUsage(captured = latest.current, capturedEpoch = lifecycleEpoch.current) {
    const request = ++usageRequest.current
    setUsageError(null)
    setUsageLoading(true)
    try {
      const result = await captured.operation({ operation: 'read-application-record-usage', owner: captured.owner })
      if (!result.recordUsage) throw new Error('应用记录占用尚未读取')
      if (lifecycleEpoch.current === capturedEpoch && usageRequest.current === request) setUsage(result.recordUsage)
    } catch (reason) {
      if (lifecycleEpoch.current === capturedEpoch && usageRequest.current === request) setUsageError((reason as Error).message)
    } finally {
      if (lifecycleEpoch.current === capturedEpoch && usageRequest.current === request) setUsageLoading(false)
    }
  }

  function openDelete(target: DeleteTarget) {
    if (deleting) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDeleteError(null)
    setPendingDelete(target)
  }

  function closeDelete() {
    if (deleting) return
    setPendingDelete(null)
    setDeleteError(null)
  }

  async function remove() {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    const captured = latest.current
    const capturedEpoch = lifecycleEpoch.current
    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await captured.operation(target === 'all'
        ? { operation: 'delete-all-application-records' }
        : { operation: 'delete-conversation', owner: captured.owner, ...(target === 'owner' ? {} : { conversationId: target.conversationId }) })
      if (lifecycleEpoch.current !== capturedEpoch) return
      const records = result.conversations ?? []
      const deletedIds = captured.conversations
        .filter(record => !records.some(next => next.conversationId === record.conversationId))
        .map(record => record.conversationId)
      captured.onRecordsChange(records)
      captured.onDeleted?.(deletedIds)
      if (target === 'all') captured.onAllDeleted?.()
      setPendingDelete(null)
      setDeleteError(null)
      setDeleting(false)
      await readUsage(captured, capturedEpoch)
    } catch (reason) {
      if (lifecycleEpoch.current === capturedEpoch) setDeleteError((reason as Error).message)
    } finally {
      if (lifecycleEpoch.current === capturedEpoch) setDeleting(false)
    }
  }

  const scopeLabel = isLessonOwner ? '当前课例' : props.owner.kind === 'workspace' ? '当前目录' : '当前项目'
  const usageValue = (value: number | undefined) => value === undefined ? usageLoading ? '读取中' : '未读取' : formatBytes(value)
  const deleteNotice = isLessonOwner
    ? '运行中的任务将停止。课例文件、附件、工程和未保存恢复稿保留；外部 CLI 历史不受影响。'
    : '运行中的任务将停止。删除对话不会删除工作空间或项目中的任何文件；未保存恢复稿保留；外部 CLI 历史不受影响。'
  const management = <>
    <details className="lesson-conversation-records" aria-disabled={deleting || undefined} onToggle={event => {
      // 删除进行中主进程会拒绝一切记录读取（src/main/localAgent/service.ts:37-39 的
      // assertLocalAgentRecordsAvailable），所以这里直接收回展开请求：否则用户会在删除
      // 途中看到「正在删除应用对话记录，请稍后重试」这种自造的失败。
      if (deleting) {
        event.currentTarget.open = false
        return
      }
      if (event.currentTarget.open) void readUsage()
    }}>
      <summary>管理对话记录</summary>
      <p>{scopeLabel}：{usageValue(usage?.currentScopeBytes)}</p>
      <p>全应用：{usageValue(usage?.applicationBytes)}</p>
      <button type="button" disabled={usageLoading || deleting} onClick={() => { void readUsage() }}>刷新占用</button>
      {usageError && <p role="alert">占用统计失败：{usageError}。可以点击“刷新占用”重试。</p>}
      <button type="button" disabled={deleting} onClick={() => openDelete('owner')}>{isLessonOwner ? '删除本课例对话记录' : props.owner.kind === 'workspace' ? '删除本工作空间对话记录' : '删除本项目对话记录'}</button>
      <button type="button" disabled={deleting} onClick={() => openDelete('all')}>删除全部应用对话记录</button>
      <p>这里只统计并清理本应用保存的对话、任务和日志；外部 CLI 历史需在对应 CLI 中单独处理。</p>
    </details>
    {pendingDelete && <dialog ref={dialogRef} aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogMessageId}
      onCancel={event => { event.preventDefault(); closeDelete() }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeDelete() } }}>
      <h2 id={dialogTitleId}>确认删除对话记录</h2>
      <p id={dialogMessageId}>{pendingDelete === 'all' ? '删除全部课例和独立工程的应用对话、任务与日志？' : pendingDelete === 'owner' ? `删除“${ownerName(props.owner, props.ownerLabel)}”的全部对话、任务与日志？` : `删除“${pendingDelete.title}”的对话、任务与日志？`}</p>
      <p>{deleteNotice}</p>
      {deleteError && <p role="alert">删除未确认完成：{deleteError}</p>}
      <button ref={cancelButtonRef} autoFocus type="button" disabled={deleting} onClick={closeDelete}>取消</button>
      <button type="button" disabled={deleting} onClick={() => { void remove() }}>确认删除记录</button>
    </dialog>}
  </>

  return <>{props.children({
    busy: deleting,
    requestDelete: openDelete,
    management,
  })}</>
}
