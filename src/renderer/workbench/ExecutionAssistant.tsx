import { selectionReference, workbenchSelection, type ContextualEditRequest } from './SelectionContextController'
import './selectionContext.css'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { homeInScope, type ConversationRecord } from '../../shared/workbench/conversations'
import { EXECUTION_NO_PROGRESS, MODEL_REQUEST_BUDGET_EXHAUSTED, TOOL_CALL_BUDGET_EXHAUSTED, type ExecutionRunRecord } from '../../shared/workbench/execution'
import { captureRendererTiming, disclosedExecutionSettings, type ExecutionDesktopAPI, type ExecutionDocumentReference, type ExecutionSendInput, type ExecutionSubmissionMode, type ExecutionSubmissionRecord } from '../../shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionProjection } from '../../shared/workbench/executionEvents'
import type { InputAttachmentReference } from '../../shared/workbench/attachments'
import type { ExecutionRoleSelection, ExecutionSettingsView } from '../../shared/workbench/executionSettings'
import type { DiscoveredModel, DiscoveredModels, DiscoveredReasoningEffort, ExecutionSettingsAPI } from '../../shared/workbench/executionSettingsDesktop'
import type { ExternalMcpAPI } from '../../shared/workbench/external'
import { ExecutionSettingsPanel } from './ExecutionSettingsPanel'
import { ExternalMcpPanel } from './ExternalMcpPanel'
import { ExecutionTimeline } from './ExecutionTimeline'
import { ExecutionQuestionCard } from './ExecutionQuestionCard'
import { ExecutionApprovalCard } from './ExecutionApprovalCard'
import { pendingApproval, pendingQuestion } from './executionTimelineModel'
import { DEFAULT_PERMISSION_MODE, executionPermissionModes, permissionDescriptions, permissionLabels, permissionShortLabels, type ExecutionPermissionMode } from '../../shared/workbench/executionPermission'
import { AttachmentComposer } from './attachments/AttachmentComposer'
import { userMessageWindow } from './userMessageWindow'
import { isExecutionInputError } from '../../shared/workbench/executionInputMessages'
import './executionAssistant.css'
import { bodyStreamingLabel, bodyStreamingRecord, configuredBodyStreamingAlternatives } from '../../shared/workbench/bodyStreaming'
import { useWorkbenchSessionDock } from './WorkbenchSessionPortal'

export interface ExecutionAssistantProps {
  root: string | null
  captureDocuments(writable: boolean): Promise<ExecutionDocumentReference[]>
  prepareSend(): Promise<boolean>
  api?: ExecutionDesktopAPI
  settingsAPI?: ExecutionSettingsAPI
  externalAPI?: ExternalMcpAPI
  onLocateDocument?(documentId: string): void
}

const billingLabels = { metered: '按量付费', 'token-plan': 'Token Plan', subscription: '订阅', prepaid: '预付费', unknown: '计费未知' }
const effortLabels: Record<DiscoveredReasoningEffort, string> = { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }
// Official model pages document these exact IDs. ChatGPT OAuth account support is
// separate, so provider directory declarations take priority and this remains labelled unverified.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6-sol
// https://developers.openai.com/api/docs/models/gpt-6-astra
const documentedOAuthEfforts: Record<string, readonly DiscoveredReasoningEffort[]> = {
  'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-sol': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
}
const knownModelGuidance: Record<string, string> = {
  'gpt-6-sol': '日常创作与开发',
  'gpt-6-luna': '简单、快速的任务',
  'gpt-6-astra': '复杂任务与架构分析',
}
const isKnownOAuthModel = (value: { selection: ExecutionRoleSelection; connection: ExecutionSettingsView['connections'][number] }) =>
  value.connection.connection.provider === 'openai' && value.connection.connection.protocol === 'chatgpt-responses'
    && value.connection.connection.auth.kind === 'oauth'
    && Object.hasOwn(knownModelGuidance, value.selection.model)
const accountLabel = (entry: ExecutionSettingsView['connections'][number]) => {
  const id = entry.connection.accountId
  if (entry.connection.auth.kind !== 'oauth') return id
  if (id.includes('@')) return id
  const compact = id.replace(/[^a-zA-Z0-9]/g, '')
  return compact.length > 12 ? `ChatGPT 账号 · 尾号 ${compact.slice(-4)}` : `ChatGPT 账号 · ${id}`
}
const updateConversation = (list: ConversationRecord[], next: ConversationRecord) => list.map(value => value.conversationId === next.conversationId ? next : value)
const allowedScopeKinds = new Set<ExecutionDocumentReference['writable'][number]['kind']>(['document', 'markdown-range', 'course-object', 'flow-block', 'flow-range'])
const restoredDocuments = (conversation: ConversationRecord): ExecutionDocumentReference[] => conversation.frozenContextRefs.map(value => ({
  documentId: value.documentId, epoch: value.epoch, revision: value.revision,
  ...(value.selection?.length ? { selection: value.selection as ExecutionDocumentReference['selection'] } : {}),
  writable: (value.writeScope ?? []).filter((scope): scope is ExecutionDocumentReference['writable'][number] => allowedScopeKinds.has(scope.kind as ExecutionDocumentReference['writable'][number]['kind'])),
}))
// Structural equality: Main returns schema-ordered keys while the composer builds its own
// order, so object keys are sorted; array order (documents, ranges) stays significant.
const canonicalJSON = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)
const sameDocuments = (a: readonly ExecutionDocumentReference[], b: readonly ExecutionDocumentReference[]) => canonicalJSON(a) === canonicalJSON(b)
const sameAttachments = (a: readonly InputAttachmentReference[], b: readonly InputAttachmentReference[]) => canonicalJSON(a) === canonicalJSON(b)
const connectionFailure = (run: ExecutionRunRecord | null): string | null => {
  if (!run || !['failed', 'partial', 'interrupted'].includes(run.status)) return null
  const failure = run.requests.at(-1)?.failure
  if (!failure) return null
  const status = failure.httpStatus ? `（HTTP ${failure.httpStatus}）` : ''
  if (failure.kind === 'auth') return `模型连接认证失败${status}。请重新登录或检查密钥，连接恢复后可继续此任务。`
  if (failure.kind === 'quota') return `模型服务拒绝本次额度或付款${status}。请检查额度与计费设置，恢复后可继续此任务。`
  if (failure.kind === 'rate-limit') return `模型服务暂时限制请求${status}。请按连接提示稍后继续此任务。`
  if (failure.kind === 'transport' || failure.kind === 'timeout') return '模型连接中断，本次请求结果尚未确认；不会自动重发。请检查网络后显式继续此任务。'
  return null
}
const stopReason = (run: ExecutionRunRecord | null): string | null => {
  if (!run || !['failed', 'partial'].includes(run.status)) return null
  const code = run.failure?.code
  if (code === MODEL_REQUEST_BUDGET_EXHAUSTED) return `本次已达到 ${run.budget.maxRequests} 次模型请求上限，剩余工作尚未完成。已提交的修改会保留；继续此任务将使用当前连接发起新一段运行。`
  if (code === TOOL_CALL_BUDGET_EXHAUSTED) return `本次已达到 ${run.budget.maxToolCalls} 次工具调用上限，剩余工作尚未完成。已提交的修改会保留；检查后可手动继续此任务。`
  if (code === EXECUTION_NO_PROGRESS) return '工具结果持续重复，任务已暂停。已提交的修改会保留；检查后可手动继续此任务。'
  return null
}

const permissionKey = (workspaceId: string) => `guoling.execution.permission.v1:${workspaceId}`
function readPermission(workspaceId: string): ExecutionPermissionMode {
  try {
    const value = window.localStorage.getItem(permissionKey(workspaceId))
    return (executionPermissionModes as readonly string[]).includes(value ?? '') ? value as ExecutionPermissionMode : DEFAULT_PERMISSION_MODE
  } catch { return DEFAULT_PERMISSION_MODE }
}
/** Owner 2026-09-24: the level decides writes at send time. A selection is also a writable target, so a local
 * edit can go straight to the selected words; an inline "edit here" keeps exactly its selection. Main re-checks. */
export function documentsForPermission(documents: readonly ExecutionDocumentReference[], permission: ExecutionPermissionMode): ExecutionDocumentReference[] {
  return documents.map(document => {
    if (permission === 'read-only') return { ...structuredClone(document), writable: [] }
    if (document.writable.some(scope => scope.kind !== 'document')) return structuredClone(document)
    return { ...structuredClone(document), writable: [{ kind: 'document' as const }, ...structuredClone(document.selection ?? [])] }
  })
}

function defaultExecutionAPI(): ExecutionDesktopAPI | undefined {
  return (window.desktopAPI as typeof window.desktopAPI & { execution?: ExecutionDesktopAPI }).execution
}

export function ExecutionAssistant({ root, captureDocuments, prepareSend, api: suppliedAPI, settingsAPI: suppliedSettingsAPI, externalAPI: suppliedExternalAPI, onLocateDocument }: ExecutionAssistantProps) {
  const sessionDock = useWorkbenchSessionDock()
  const sessionScope = sessionDock.scope
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  const api = suppliedAPI ?? defaultExecutionAPI()
  const settingsAPI = suppliedSettingsAPI ?? window.desktopAPI?.executionSettings
  const externalAPI = suppliedExternalAPI ?? window.desktopAPI?.externalMcp
  const [workspaceId, setWorkspaceId] = useState('')
  // WorkspaceFiles and conversations keep separate registries. Only the relative
  // explorer path/kind crosses this boundary; conversation homes use this ID.
  const conversationScope = sessionScope && workspaceId
    ? { kind: sessionScope.kind, path: sessionScope.path, workspaceId } : null
  const conversationHomeInput = conversationScope
    ? { kind: conversationScope.kind, path: conversationScope.path } : undefined
  const [conversations, setConversations] = useState<ConversationRecord[]>([])
  const [active, setActive] = useState<ConversationRecord | null>(null)
  const [draft, setDraft] = useState('')
  const [documents, setDocuments] = useState<ExecutionDocumentReference[]>([])
  const [attachments, setAttachments] = useState<InputAttachmentReference[]>([])
  const [permission, setPermissionState] = useState<ExecutionPermissionMode>(DEFAULT_PERMISSION_MODE)
  const [permissionOpen, setPermissionOpen] = useState(false), [plusOpen, setPlusOpen] = useState(false)
  const [contextFrozen, setContextFrozen] = useState(false)
  const [projection, setProjection] = useState<ExecutionProjection>(() => emptyExecutionProjection(''))
  const [run, setRun] = useState<ExecutionRunRecord | null>(null)
  const [settings, setSettings] = useState<ExecutionSettingsView | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsEntry, setSettingsEntry] = useState<'default' | 'chatgpt-oauth'>('default')
  const [externalOpen, setExternalOpen] = useState(false)
  const [historySearchOpen, setHistorySearchOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, DiscoveredModels>>({})
  const [modelCatalogErrors, setModelCatalogErrors] = useState<Record<string, string>>({})
  const catalogRequested = useRef(new Set<string>())
  const [modelMenuPosition, setModelMenuPosition] = useState({ left: 0, bottom: 0, width: 320 })
  const moreRef = useRef<HTMLDetailsElement>(null)
  const plusRef = useRef<HTMLDivElement>(null), permissionRef = useRef<HTMLDivElement>(null), popupRef = useRef<HTMLDivElement>(null)
  const [popupPosition, setPopupPosition] = useState({ left: 8, bottom: 8 })
  const modelButtonRef = useRef<HTMLButtonElement>(null), modelSummaryId = useId()
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [submissions, setSubmissions] = useState<ExecutionSubmissionRecord[]>([])
  const [userHistoryOffsets, setUserHistoryOffsets] = useState<Record<string, number>>({})
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [documentNames, setDocumentNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), capturePromise = useRef<Promise<ExecutionDocumentReference[]> | null>(null)
  const documentsByConversation = useRef(new Map<string, ExecutionDocumentReference[]>())
  const frozenByConversation = useRef(new Map<string, boolean>())
  const activeRef = useRef<ConversationRecord | null>(null), draftRef = useRef('')
  const timedSubmissions = useRef(new Map<string, { workspaceId: string; conversationId: string }>())
  const runRef = useRef<ExecutionRunRecord | null>(null)
  const documentsRef = useRef<ExecutionDocumentReference[]>([])
  const attachmentsRef = useRef<InputAttachmentReference[]>([])
  const contextFrozenRef = useRef(false)
  const persistQueue = useRef<Promise<unknown>>(Promise.resolve())
  const submittingRef = useRef(false), composingRef = useRef(false)

  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { runRef.current = run }, [run])
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { documentsRef.current = documents; workbenchSelection.setPinned(documents) }, [documents])
  useEffect(() => () => workbenchSelection.setPinned([]), [])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => {
    if (!modelMenuOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!modelButtonRef.current?.contains(target) && !modelMenuRef.current?.contains(target)) setModelMenuOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setModelMenuOpen(false); modelButtonRef.current?.focus() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [modelMenuOpen])
  useEffect(() => {
    if (!plusOpen && !permissionOpen) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!plusRef.current?.contains(target)) setPlusOpen(false)
      if (!permissionRef.current?.contains(target)) setPermissionOpen(false)
    }
    const close = () => { setPlusOpen(false); setPermissionOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const trigger = plusOpen ? plusRef.current?.querySelector<HTMLButtonElement>('button') : permissionRef.current?.querySelector<HTMLButtonElement>('button'); close(); trigger?.focus() } }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape); window.addEventListener('resize', close)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close) }
  }, [plusOpen, permissionOpen])
  useLayoutEffect(() => {
    if (plusOpen || permissionOpen) popupRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [plusOpen, permissionOpen])
  useLayoutEffect(() => {
    if (modelMenuOpen) modelMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [modelMenuOpen])
  // The composer scrolls, so its popups are fixed above their button; keep an open popup inside the window.
  useLayoutEffect(() => {
    const node = popupRef.current
    if (!node) return
    const left = Math.max(8, Math.min(popupPosition.left, window.innerWidth - node.offsetWidth - 8))
    if (left !== popupPosition.left) setPopupPosition(value => ({ ...value, left }))
  }, [plusOpen, permissionOpen, popupPosition.left])
  const togglePopup = (kind: 'plus' | 'permission', anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setPopupPosition({ left: rect.left, bottom: Math.max(8, window.innerHeight - rect.top + 6) })
    setModelMenuOpen(false)
    setPlusOpen(value => kind === 'plus' && !value); setPermissionOpen(value => kind === 'permission' && !value)
  }
  const toggleModelMenu = () => {
    setPlusOpen(false); setPermissionOpen(false)
    if (!modelMenuOpen) {
      setModelQuery('')
      const rect = modelButtonRef.current?.getBoundingClientRect()
      if (rect) {
        const width = Math.min(340, window.innerWidth - 16)
        setModelMenuPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
          bottom: Math.max(8, window.innerHeight - rect.top + 6), width })
      }
    }
    setModelMenuOpen(value => !value)
  }

  const applyConversation = (conversation: ConversationRecord) => {
    setHistorySearchOpen(false)
    setModelMenuOpen(false)
    if (moreRef.current) moreRef.current.open = false
    setActive(conversation); activeRef.current = conversation
    setDraft(conversation.inputDraft); draftRef.current = conversation.inputDraft
    setAttachments(conversation.inputAttachments); attachmentsRef.current = conversation.inputAttachments
    setRun(null); setError('')
    const remembered = documentsByConversation.current.get(conversation.conversationId)
    const restored = remembered ?? restoredDocuments(conversation)
    documentsByConversation.current.set(conversation.conversationId, restored)
    const frozen = frozenByConversation.current.get(conversation.conversationId) ?? Boolean(conversation.inputDraft || conversation.inputAttachments.length || conversation.frozenContextRefs.length)
    frozenByConversation.current.set(conversation.conversationId, frozen)
    setDocuments(restored); documentsRef.current = restored
    setContextFrozen(frozen); contextFrozenRef.current = frozen
  }

  useEffect(() => {
    const ticket = ++generation.current
    documentsByConversation.current.clear(); frozenByConversation.current.clear()
    activeRef.current = null; draftRef.current = ''; documentsRef.current = []; attachmentsRef.current = []; contextFrozenRef.current = false
    setWorkspaceId(''); setConversations([]); setActive(null); setDraft(''); setDocuments([]); setAttachments([]); setSubmissions([]); setUserHistoryOffsets({})
    setContextFrozen(false); setRun(null); setError('')
    if (!api) { setError('当前环境没有统一执行服务。'); return }
    setBusy(true)
    void api.workspace(root).then(async value => {
      if (ticket !== generation.current) return
      setWorkspaceId(value.workspace.workspaceId); setConversations(value.conversations)
      let selected = value.conversations[0]
      if (!selected) selected = await api.createConversation(value.workspace.workspaceId, undefined,
        sessionScope ? { kind: sessionScope.kind, path: sessionScope.path } : undefined)
      if (ticket !== generation.current) return
      setConversations(list => list.some(item => item.conversationId === selected!.conversationId) ? list : [...list, selected!])
      applyConversation(selected)
    }).catch(() => { if (ticket === generation.current) setError('会话空间暂不可读取，请稍后重试。') })
      .finally(() => { if (ticket === generation.current) setBusy(false) })
    return () => { ++generation.current }
  }, [api, root])

  // Explorer selection changes the list only. An empty, unhomed conversation may acquire
  // that place; Main checks this against the durable record so a draft cannot be reassigned.
  useEffect(() => {
    const selected = activeRef.current
    if (!api?.setConversationHome || !conversationScope || !selected || selected.home || selected.workspaceId !== workspaceId
      || draftRef.current || attachmentsRef.current.length || documentsRef.current.length
      || selected.messages.length || selected.inputDraft || selected.inputAttachments.length || selected.frozenContextRefs.length
      || selected.runIndex.builtinRunIds.length || selected.runIndex.externalRunIds.length) return
    let live = true
    void api.setConversationHome({ workspaceId, conversationId: selected.conversationId, home: conversationHomeInput! })
      .then(saved => {
        if (!live) return
        setConversations(value => updateConversation(value, saved))
        if (activeRef.current?.conversationId === saved.conversationId) { setActive(saved); activeRef.current = saved }
      }).catch(() => { /* Main may reject a raced draft; its existing home remains authoritative. */ })
    return () => { live = false }
  }, [api, workspaceId, sessionScope?.kind, sessionScope?.path, active?.conversationId])

  useEffect(() => {
    const subscribe = window.desktopAPI?.onWorkspaceFilesChanged
    if (!api || !workspaceId || !subscribe) return
    let live = true
    return subscribe(() => {
      void api.workspace(root).then(value => {
        if (!live || value.workspace.workspaceId !== workspaceId) return
        setConversations(value.conversations)
        const latest = value.conversations.find(item => item.conversationId === activeRef.current?.conversationId)
        if (latest && activeRef.current) {
          const current = activeRef.current
          const refreshed = { ...current, home: latest.home }
          setActive(refreshed); activeRef.current = refreshed
        }
      }).catch(() => undefined)
    })
  }, [api, root, workspaceId])

  useEffect(() => {
    if (!settingsAPI) { setSettings(null); return }
    let disposed = false
    void settingsAPI.read().then(value => { if (!disposed) setSettings(value) }).catch(() => { if (!disposed) setSettings(null) })
    return () => { disposed = true }
  }, [settingsAPI])
  useEffect(() => {
    if (!modelMenuOpen || !settingsAPI || !settings) return
    for (const entry of settings.connections) {
      if (!entry.hasCredential || entry.revoked) continue
      const key = `${entry.connection.id}:${entry.connection.revision}`
      if (modelCatalogs[key] || catalogRequested.current.has(key)) continue
      catalogRequested.current.add(key)
      void settingsAPI.discoverModels(entry.connection.id, entry.connection.revision).then(value => {
        if (value.connectionId !== entry.connection.id || value.connectionRevision !== entry.connection.revision) return
        setModelCatalogs(current => ({ ...current, [key]: value }))
        setModelCatalogErrors(current => { const next = { ...current }; delete next[key]; return next })
      }).catch(() => setModelCatalogErrors(current => ({ ...current, [key]: `${entry.connection.provider} 的模型目录暂不可读取。已有选择仍可使用。` })))
    }
  }, [modelMenuOpen, modelCatalogs, settings, settingsAPI])

  useEffect(() => {
    const selected = active
    if (!api || !selected) { setSubmissions([]); return }
    let disposed = false
    void api.submissions({ workspaceId: selected.workspaceId, conversationId: selected.conversationId })
      .then(value => { if (!disposed) setSubmissions(value) })
      .catch(() => { if (!disposed) setError('排队消息暂不可读取，已保留输入。') })
    return () => { disposed = true }
  }, [api, active?.conversationId])

  useEffect(() => {
    const documentsAPI = window.desktopAPI?.documents
    let disposed = false
    if (!documentsAPI || documents.length === 0) { setDocumentNames({}); return }
    void Promise.all(documents.map(async reference => {
      try {
        const snapshot = await documentsAPI.read(reference.documentId)
        const name = snapshot.binding.kind === 'file' ? snapshot.binding.path.split(/[\\/]/).at(-1) || '已绑定文档' : snapshot.binding.suggestedName
        return [reference.documentId, name] as const
      } catch { return [reference.documentId, '已绑定文档'] as const }
    })).then(entries => { if (!disposed) setDocumentNames(Object.fromEntries(entries)) })
    return () => { disposed = true }
  }, [documents])

  useEffect(() => {
    const conversationId = active?.conversationId
    if (!api || !conversationId) { setProjection(emptyExecutionProjection(conversationId ?? '')); return }
    let disposed = false
    let current = emptyExecutionProjection(conversationId)
    let chain = Promise.resolve()
    const catchUp = (initial: boolean) => {
      chain = chain.then(async () => {
        if (disposed) return
        if (initial) current = await api.timeline(conversationId)
        const endedRuns = new Set(current.items.filter(item => item.type === 'run.end').map(item => item.runId))
        while (!disposed) {
          const page = await api.events(conversationId, current.cursor, 5000)
          page.events.filter(event => event.type === 'run.end').forEach(event => endedRuns.add(event.runId))
          current = foldExecutionEvents(current, page.events)
          if (!page.hasMore) break
        }
        if (!disposed) setProjection(current)
        if (endedRuns.size > 0 && !disposed) {
          const selected = activeRef.current
          if (selected?.conversationId === conversationId) {
            const needsReply = [...endedRuns].some(runId => !selected.messages.some(message => message.role === 'assistant' && message.runId === runId))
            let latest: ConversationRecord | null = selected
            for (let attempt = 0; needsReply && attempt < 5 && !disposed; attempt += 1) {
              if (attempt > 0) await new Promise(resolve => setTimeout(resolve, attempt * 25))
              const value = await api.conversation(selected.workspaceId, conversationId)
              if (!value) { latest = null; break }
              latest = value
              if (value.revision > selected.revision) break
            }
            if (latest && !disposed) {
              const hasLocalDraft = draftRef.current !== selected.inputDraft || !sameAttachments(attachmentsRef.current, selected.inputAttachments)
              setActive(latest); activeRef.current = latest
              setConversations(value => updateConversation(value, latest))
              if (!hasLocalDraft) {
                setDraft(latest.inputDraft); draftRef.current = latest.inputDraft
                setAttachments(latest.inputAttachments); attachmentsRef.current = latest.inputAttachments
                if (latest.inputDraft || latest.inputAttachments.length) {
                  const restored = restoredDocuments(latest)
                  setDocuments(restored); documentsRef.current = restored
                  setContextFrozen(true); contextFrozenRef.current = true
                }
              }
            }
          }
        }
      }).catch(() => { if (!disposed) setError('任务过程暂不可读取，已保留会话内容。') })
    }
    const unsubscribe = api.subscribe(event => {
      if (event.conversationId !== conversationId) return
      catchUp(false)
      if (event.type === 'run.end' || runRef.current?.runId !== event.runId) {
        if (event.type === 'run.end') void settingsAPI?.read().then(setSettings).catch(() => undefined)
        void api.run(event.runId).then(value => { if (!disposed) { setRun(value); runRef.current = value } })
        const selected = activeRef.current
        if (selected) void api.submissions({ workspaceId: selected.workspaceId, conversationId }).then(value => { if (!disposed) setSubmissions(value) })
      }
    })
    catchUp(true)
    const latestRunId = active.runIndex.builtinRunIds.at(-1)
    if (latestRunId) void api.run(latestRunId).then(value => { if (!disposed) { setRun(value); runRef.current = value } })
    return () => { disposed = true; unsubscribe() }
  }, [api, active?.conversationId])

  const openQuestion = useMemo(() => pendingQuestion(projection), [projection])
  const openApproval = useMemo(() => pendingApproval(projection), [projection])
  useEffect(() => { if (workspaceId) setPermissionState(readPermission(workspaceId)) }, [workspaceId])
  const choosePermission = (value: ExecutionPermissionMode) => {
    setPermissionState(value); setPermissionOpen(false)
    permissionRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    try { if (workspaceId) window.localStorage.setItem(permissionKey(workspaceId), value) } catch { /* This session keeps the choice. */ }
  }
  const conversationSelection = settings?.profile.roles.conversation
  const connection = settings?.connections.find(value => value.connection.id === conversationSelection?.connectionId)
  const configured = Boolean(conversationSelection && connection?.hasCredential && !connection.revoked)
  const selectedModel = conversationSelection && connection ? { connection: connection.connection, model: conversationSelection.model, parameters: conversationSelection.parameters } : undefined
  const bodyStreaming = selectedModel ? bodyStreamingRecord(settings?.bodyStreamingObservations ?? [], selectedModel) : undefined
  const streamingAlternatives = settings ? configuredBodyStreamingAlternatives(settings, selectedModel) : []
  const modelDescription = useMemo(() => {
    if (!conversationSelection) return '未配置对话模型'
    if (!connection) return `模型 ${conversationSelection.model} · 连接不可用`
    return `对话与规划 · ${connection.connection.provider} · ${conversationSelection.model} · ${accountLabel(connection)} · ${billingLabels[connection.connection.billing.kind]}`
  }, [connection, conversationSelection])
  const modelSummary = conversationSelection
    ? `${connection?.connection.provider ?? '连接不可用'} · ${conversationSelection.model}`
    : '未配置对话模型'
  const modelOptions = useMemo(() => {
    if (!settings) return []
    const options: { selection: ExecutionRoleSelection; connection: ExecutionSettingsView['connections'][number]; catalogModel?: DiscoveredModel }[] = []
    const add = (selection: ExecutionRoleSelection | null, catalogModel?: DiscoveredModel) => {
      if (!selection) return
      const entry = settings.connections.find(value => value.connection.id === selection.connectionId)
      if (!entry) return
      const existing = options.find(value => value.selection.connectionId === selection.connectionId && value.selection.model === selection.model)
      if (existing) { if (catalogModel) existing.catalogModel = catalogModel; return }
      options.push({ selection, connection: entry, catalogModel })
    }
    add(settings.profile.roles.conversation)
    for (const value of streamingAlternatives) add(value)
    for (const record of settings.capabilityRecords ?? []) {
      const entry = settings.connections.find(value => value.connection.id === record.connectionId && value.connection.revision === record.connectionRevision)
      if (!entry?.hasCredential || entry.revoked || record.facts.tools?.status !== 'supported') continue
      try {
        const parsed: unknown = JSON.parse(record.parametersKey)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        add({ connectionId: record.connectionId, model: record.model, parameters: parsed as ExecutionRoleSelection['parameters'] })
      } catch { /* A malformed historical observation cannot become a route choice. */ }
    }
    for (const entry of settings.connections) {
      const catalog = modelCatalogs[`${entry.connection.id}:${entry.connection.revision}`]
      if (!entry.hasCredential || entry.revoked || !catalog) continue
      for (const model of catalog.models) add({ connectionId: entry.connection.id, model: model.id,
        ...(model.defaultReasoningEffort ? { parameters: { reasoning_effort: model.defaultReasoningEffort } } : {}) }, model)
    }
    const priority = (value: typeof options[number]) => {
      if (value.selection.connectionId === settings.profile.roles.conversation?.connectionId && value.selection.model === settings.profile.roles.conversation.model) return 0
      if (isKnownOAuthModel(value) && value.selection.model === 'gpt-6-sol') return 1
      if (isKnownOAuthModel(value) && value.selection.model === 'gpt-6-luna') return 2
      if (isKnownOAuthModel(value) && value.selection.model === 'gpt-6-astra') return 3
      return value.catalogModel ? 5 : 4
    }
    return options.sort((a, b) => priority(a) - priority(b))
  }, [settings, streamingAlternatives, modelCatalogs])
  const matchingModelOptions = modelOptions.filter(({ selection, connection: entry, catalogModel }) => !modelQuery.trim()
    || `${selection.model} ${catalogModel?.displayName ?? ''} ${catalogModel?.description ?? ''} ${entry.connection.provider}`.toLocaleLowerCase().includes(modelQuery.trim().toLocaleLowerCase()))
  const primaryModelOptions = matchingModelOptions.filter(value => !value.catalogModel || value.selection.model === conversationSelection?.model
    && value.selection.connectionId === conversationSelection.connectionId || isKnownOAuthModel(value))
  const otherModelOptions = matchingModelOptions.filter(value => !primaryModelOptions.includes(value))
  const modelChoice = ({ selection, connection: entry, catalogModel }: typeof modelOptions[number]) => {
    const current = conversationSelection?.connectionId === selection.connectionId && conversationSelection.model === selection.model
      && JSON.stringify(conversationSelection.parameters ?? {}) === JSON.stringify(selection.parameters ?? {})
    const available = entry.hasCredential && !entry.revoked && entry.connection.capabilities.tools !== 'unsupported'
    const guidance = isKnownOAuthModel({ selection, connection: entry }) ? knownModelGuidance[selection.model] : undefined
    return <button type="button" className="execution-assistant__model-option" key={`${selection.connectionId}:${selection.model}`}
      aria-pressed={current} disabled={busy || !available} onClick={() => void switchConversationModel(selection)}>
      <span>{catalogModel?.displayName ?? selection.model}</span>
      <small>{entry.connection.provider} · {accountLabel(entry)} · {billingLabels[entry.connection.billing.kind]}{!available ? ' · 连接不可用' : current ? ' · 当前' : ''}{catalogModel ? ' · 目录能力未验证' : ''}</small>
      {guidance ? <small>建议 · {guidance}</small> : catalogModel?.description && <small>{catalogModel.description}</small>}
    </button>
  }
  const activeCatalogModel = connection && conversationSelection
    ? modelCatalogs[`${connection.connection.id}:${connection.connection.revision}`]?.models.find(value => value.id === conversationSelection.model)
    : undefined
  const documentedEfforts = connection && conversationSelection
    && connection.connection.provider === 'openai' && connection.connection.protocol === 'chatgpt-responses'
    && connection.connection.auth.kind === 'oauth' && connection.connection.capabilities.reasoning !== 'unsupported'
    ? documentedOAuthEfforts[conversationSelection.model] : undefined
  const effortOptions = activeCatalogModel?.reasoningEfforts !== undefined ? activeCatalogModel.reasoningEfforts
    : documentedEfforts?.map(effort => ({ effort })) ?? []
  const effortSource = activeCatalogModel?.reasoningEfforts !== undefined ? 'directory' : documentedEfforts ? 'documented' : 'none'
  const nativeReasoning = conversationSelection?.parameters?.reasoning
  const nativeReasoningObject = nativeReasoning !== null && typeof nativeReasoning === 'object' && !Array.isArray(nativeReasoning)
    ? nativeReasoning : undefined
  const selectedEffort = nativeReasoningObject?.effort ?? conversationSelection?.parameters?.reasoning_effort
  const chooseEffort = (effort?: DiscoveredReasoningEffort) => {
    if (!conversationSelection) return
    if (nativeReasoning !== undefined && !nativeReasoningObject) {
      setError('当前模型的推理参数需要在高级设置中修正；强度没有改变。')
      return
    }
    const parameters = { ...conversationSelection.parameters }
    delete parameters.reasoning_effort
    if (nativeReasoningObject) {
      const reasoning = { ...nativeReasoningObject }
      if (effort) reasoning.effort = effort
      else delete reasoning.effort
      if (Object.keys(reasoning).length) parameters.reasoning = reasoning
      else delete parameters.reasoning
    } else if (effort) parameters.reasoning_effort = effort
    void switchConversationModel({ ...conversationSelection, parameters })
  }
  const switchConversationModel = async (choice: ExecutionRoleSelection) => {
    if (!settingsAPI || !settings || busy) return
    const selected = settings.profile.roles.conversation
    if (selected && selected.connectionId === choice.connectionId && selected.model === choice.model
      && JSON.stringify(selected.parameters ?? {}) === JSON.stringify(choice.parameters ?? {})) {
      setModelMenuOpen(false)
      modelButtonRef.current?.focus()
      return
    }
    const entry = settings.connections.find(value => value.connection.id === choice.connectionId)
    if (!entry?.hasCredential || entry.revoked || entry.connection.capabilities.tools === 'unsupported') {
      setError('这个模型的连接不可用；当前模型没有改变。')
      return
    }
    setBusy(true); setError('')
    try {
      await settingsAPI.saveProfile({ expectedRevision: settings.profile.revision,
        roles: { ...settings.profile.roles, conversation: choice } })
      const refreshed = await settingsAPI.read()
      setSettings(refreshed)
      const actual = refreshed.profile.roles.conversation
      if (!actual || actual.connectionId !== choice.connectionId || actual.model !== choice.model
        || JSON.stringify(actual.parameters ?? {}) !== JSON.stringify(choice.parameters ?? {})) {
        setError('模型配置在切换时发生变化，请查看当前模型后重试。')
      } else { setModelMenuOpen(false); modelButtonRef.current?.focus() }
    } catch {
      const refreshed = await settingsAPI.read().catch(() => null)
      if (refreshed) setSettings(refreshed)
      setError('模型切换未保存；原配置保留，请检查连接或重试。')
    } finally { setBusy(false) }
  }

  const freezeDocuments = (text: string) => {
    if (!active || !text || contextFrozenRef.current || capturePromise.current) return
    const conversationId = active.conversationId
    frozenByConversation.current.set(conversationId, true); setContextFrozen(true); contextFrozenRef.current = true
    // A file home is the default reference at send time. Browsing another tab must not
    // silently replace it; explicit "+" references still capture that tab below.
    if (active.home?.kind === 'file' && documentsRef.current.length === 0) return
    const pending = captureDocuments(true).then(value => {
      if (activeRef.current?.conversationId === conversationId) {
        documentsByConversation.current.set(conversationId, value); setDocuments(value); documentsRef.current = value
      }
      return value
    }).catch(() => { setError('当前文档引用未能冻结；你仍可在无引用会话中继续对话。'); return [] })
      .finally(() => { if (capturePromise.current === pending) capturePromise.current = null })
    capturePromise.current = pending
  }

  const persist = (documentOverride?: ExecutionDocumentReference[]) => {
    const ticket = generation.current
    const task = persistQueue.current.then(async () => {
      const selected = activeRef.current
      if (!api || !selected) return selected
      const captured = await (capturePromise.current ?? Promise.resolve(documentsRef.current))
      const refs = documentOverride ?? (captured.length > 0 ? captured : documentsRef.current)
      const localDraft = draftRef.current
      const inputAttachments = attachmentsRef.current
      if (localDraft === selected.inputDraft && sameAttachments(inputAttachments, selected.inputAttachments) && sameDocuments(refs, restoredDocuments(selected))) return selected
      const saved = await api.draft({ workspaceId: selected.workspaceId, conversationId: selected.conversationId,
        expectedRevision: selected.revision, text: localDraft, documents: refs, attachments: inputAttachments })
      if (ticket !== generation.current) return saved
      documentsByConversation.current.set(saved.conversationId, refs)
      setConversations(value => updateConversation(value, saved)); setActive(saved); activeRef.current = saved
      return saved
    })
    persistQueue.current = task.catch(() => undefined)
    return task
  }

  const select = async (conversation: ConversationRecord) => {
    if (!active || conversation.conversationId === active.conversationId || busy) return
    setBusy(true); setError('')
    try {
      await persist()
      const latest = await api?.conversation(conversation.workspaceId, conversation.conversationId)
      applyConversation(latest ?? conversation)
    } catch { setError('草稿未保存，已留在当前会话，请重试。') }
    finally { setBusy(false) }
  }

  const create = async () => {
    if (!api || !workspaceId || busy) return
    setBusy(true); setError('')
    try {
      await persist()
      const created = await api.createConversation(workspaceId, undefined, conversationHomeInput)
      setConversations(value => [...value, created]); setSessionSearch(''); applyConversation(created)
    } catch { setError('新会话暂未创建。') }
    finally { setBusy(false) }
  }

  const renameConversationItem = async (conversation: ConversationRecord, title: string) => {
    if (!api || !title.trim() || busy) return
    setBusy(true); setError('')
    try {
      if (activeRef.current?.conversationId === conversation.conversationId) await persist()
      const latest = await api.conversation(conversation.workspaceId, conversation.conversationId)
      if (!latest) throw new Error('Conversation no longer exists')
      const saved = await api.renameConversation({ workspaceId: latest.workspaceId, conversationId: latest.conversationId,
        expectedRevision: latest.revision, title: title.trim() })
      setConversations(value => updateConversation(value, saved))
      if (activeRef.current?.conversationId === saved.conversationId) { setActive(saved); activeRef.current = saved }
      setRenamingId(null); setSessionMenuId(null)
    } catch { setError('会话名称未保存，请重试。') }
    finally { setBusy(false) }
  }

  const removeConversationItem = async (conversation: ConversationRecord) => {
    if (!api || busy) return
    setBusy(true); setError('')
    try {
      const latest = await api.conversation(conversation.workspaceId, conversation.conversationId)
      if (!latest) throw new Error('Conversation no longer exists')
      await api.deleteConversation({ workspaceId: latest.workspaceId, conversationId: latest.conversationId, expectedRevision: latest.revision })
      documentsByConversation.current.delete(conversation.conversationId)
      frozenByConversation.current.delete(conversation.conversationId)
      setUserHistoryOffsets(value => {
        const next = { ...value }
        delete next[conversation.conversationId]
        return next
      })
      let remaining = conversations.filter(value => value.conversationId !== conversation.conversationId)
      if (remaining.length === 0) remaining = [await api.createConversation(workspaceId, undefined, conversationHomeInput)]
      setConversations(remaining)
      if (activeRef.current?.conversationId === conversation.conversationId) applyConversation(remaining[0]!)
      setRenamingId(null); setSessionMenuId(null)
    } catch { setError('会话未删除；关联文件没有改变。') }
    finally { setBusy(false) }
  }

  const replaceSubmission = (next: ExecutionSubmissionRecord) => setSubmissions(value => {
    const index = value.findIndex(item => item.submissionId === next.submissionId)
    return index < 0 ? [...value, next] : value.map(item => item.submissionId === next.submissionId ? next : item)
  })
  const applySendResult = (result: Awaited<ReturnType<ExecutionDesktopAPI['send']>>) => {
    replaceSubmission(result.submission)
    setConversations(value => updateConversation(value, result.conversation)); setActive(result.conversation); activeRef.current = result.conversation
    setDraft(result.conversation.inputDraft); draftRef.current = result.conversation.inputDraft
    setAttachments(result.conversation.inputAttachments); attachmentsRef.current = result.conversation.inputAttachments
    if (result.submission.state === 'queued' || result.submission.state === 'accepted') {
      documentsByConversation.current.delete(result.conversation.conversationId); frozenByConversation.current.delete(result.conversation.conversationId)
      setDocuments([]); documentsRef.current = []; setContextFrozen(false); contextFrozenRef.current = false
    }
    if (result.run) setRun(result.run)
  }
  const submit = async (mode: ExecutionSubmissionMode = 'queue', retry?: ExecutionSubmissionRecord, continueRun?: ExecutionRunRecord, permissionOverride?: ExecutionPermissionMode) => {
    const clicked = !retry ? captureRendererTiming() : undefined
    const selected = activeRef.current
    if (!api || !selected || submittingRef.current || attachmentBusy || !retry && !continueRun && !draftRef.current.trim() && attachmentsRef.current.length === 0) return
    if (!configured) { setError('尚未配置可用的对话模型。请先在模型设置中选择连接、模型和账号。'); return }
    submittingRef.current = true; setBusy(true); setError('')
    let request: ExecutionSendInput | undefined
    try {
      if (retry) request = { workspaceId: retry.workspaceId, conversationId: retry.conversationId, submissionId: retry.submissionId,
        expectedRevision: selected.revision, text: retry.text, documents: structuredClone(retry.documents), attachments: structuredClone(retry.attachments),
        mode: retry.mode, ...(retry.retryOfRunId ? { retryOfRunId: retry.retryOfRunId } : {}), ...(retry.permission ? { permission: retry.permission } : {}) }
      else if (continueRun) {
        const source = submissions.find(item => item.runId === continueRun.runId)
        if (!source) throw new Error('原任务提交记录不可读取，尚未重试。')
        // Blur may already be saving a newer teacher draft. Settle that queue
        // before deciding whether the old frozen task may consume the composer.
        const persisted = await persist()
        if (!persisted || persisted.conversationId !== selected.conversationId || activeRef.current?.conversationId !== selected.conversationId)
          throw new Error('会话已切换；新草稿已保留，原任务尚未继续。')
        // Same rule as Main: an empty composer or the restored original may be consumed;
        // any other text or attachment is a newer teacher draft and must stay untouched.
        const consumable = (text: string, attachments: readonly InputAttachmentReference[]) =>
          (!text || text === source.text) && (attachments.length === 0 || sameAttachments(attachments, source.attachments))
        if (!consumable(draftRef.current, attachmentsRef.current) || !consumable(persisted.inputDraft, persisted.inputAttachments)
          || !sameDocuments(restoredDocuments(persisted), source.documents))
          throw new Error('输入框已有新的文字、附件或文档引用；新草稿已保留。请先处理新草稿，再继续原任务。')
        request = { workspaceId: source.workspaceId, conversationId: source.conversationId, submissionId: crypto.randomUUID(),
          expectedRevision: persisted.revision, text: source.text, documents: structuredClone(source.documents),
          attachments: structuredClone(source.attachments), mode: 'queue', retryOfRunId: continueRun.runId,
          ...(source.permission ? { permission: source.permission } : {}) }
      }
      else {
        const ready = await prepareSend()
        if (!ready) { setError('当前文档输入尚未同步，消息没有发送。'); return }
        // A click blurs the textarea first. Wait for that CAS, then freeze one exact payload.
        await persist()
        const current = activeRef.current
        if (!current || current.conversationId !== selected.conversationId) throw new Error('会话已切换，消息没有发送。')
        const captured = await (capturePromise.current ?? Promise.resolve(documentsRef.current))
        const level = permissionOverride ?? permission
        request = { workspaceId: current.workspaceId, conversationId: current.conversationId, submissionId: crypto.randomUUID(),
          expectedRevision: current.revision, text: draftRef.current, documents: documentsForPermission(captured, level), attachments: structuredClone(attachmentsRef.current), mode, permission: level }
      }
      // Owner 2026-09-24: no service notice. The route shown in the model menu is frozen with the task.
      const shownSettings: ExecutionSettingsView | null = settingsAPI ? await settingsAPI.read() : settings
      if (!shownSettings) return
      request.disclosedSettings = disclosedExecutionSettings(shownSettings)
      setSettings(shownSettings)
      if (activeRef.current?.conversationId !== selected.conversationId || activeRef.current.workspaceId !== selected.workspaceId) {
        setError('会话已切换，消息没有发送；原草稿仍保留。'); return
      }
      if (!retry) {
        const now = Date.now()
        replaceSubmission({ submissionId: request.submissionId, workspaceId: request.workspaceId, conversationId: request.conversationId,
          state: 'starting', mode, text: request.text, documents: request.documents, attachments: request.attachments ?? [],
          ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}), ...(request.permission ? { permission: request.permission } : {}),
          model: { provider: connection?.connection.provider ?? '当前连接', model: conversationSelection?.model ?? '当前模型',
            accountId: connection?.connection.accountId ?? '', billing: connection?.connection.billing.kind ?? 'unknown' }, createdAt: now, updatedAt: now })
      }
      if (clicked) {
        request.clientTiming = { click: clicked, invoke: captureRendererTiming() }
        timedSubmissions.current.set(request.submissionId, { workspaceId: request.workspaceId, conversationId: request.conversationId })
      }
      const result = await api.send(request)
      applySendResult(result)
      if (result.submission.state === 'failed') setError(result.submission.failure?.message ?? '消息未启动，输入和附件已恢复。')
    } catch (failure) {
      let known: ExecutionSubmissionRecord | null = null
      if (request) try { known = await api.submission({ workspaceId: request.workspaceId, conversationId: request.conversationId, submissionId: request.submissionId }) } catch { /* keep the exact local pending card */ }
      if (known) {
        replaceSubmission(known)
        const latest = await api.conversation(known.workspaceId, known.conversationId).catch(() => null)
        if (latest) { setConversations(value => updateConversation(value, latest)); setActive(latest); activeRef.current = latest }
        if (known.state === 'accepted' || known.state === 'queued') {
          setDraft(''); draftRef.current = ''; setAttachments([]); attachmentsRef.current = []
        }
        setError(known.state === 'starting' ? '提交状态尚在确认中；再次确认会复用同一提交，不会创建第二次运行。' : known.failure?.message ?? '')
      } else if (request) {
        const closedDocument = isExecutionInputError(failure, 'document-session-changed')
        replaceSubmission({ submissionId: request.submissionId, workspaceId: request.workspaceId, conversationId: request.conversationId,
          state: 'failed', mode: request.mode ?? 'queue', text: request.text, documents: request.documents, attachments: request.attachments ?? [],
          ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}),
          model: { provider: connection?.connection.provider ?? '当前连接', model: conversationSelection?.model ?? '当前模型', accountId: connection?.connection.accountId ?? '', billing: connection?.connection.billing.kind ?? 'unknown' },
          createdAt: Date.now(), updatedAt: Date.now(), failure: closedDocument
            ? { code: 'document-session-changed', message: '目标文档已关闭或重新打开；本次未发送。可移除文档引用，核对草稿后重新发送。' }
            : { code: 'ack-unconfirmed', message: '未确认执行器是否收到；输入和附件仍保留，可用同一提交再次确认。' } })
        setError(failure instanceof Error ? failure.message : '消息状态未确认；输入和附件仍保留。')
      } else setError(failure instanceof Error ? failure.message : '消息尚未发送；草稿已保留。')
    } finally { submittingRef.current = false; setBusy(false) }
  }
  const contextualHandler = useRef<(request: ContextualEditRequest) => void>(() => {})
  contextualHandler.current = request => {
    if (!activeRef.current || busy || submittingRef.current) throw new Error('助手尚未就绪，请稍后再发送。')
    if (draftRef.current.trim() || attachmentsRef.current.length || contextFrozenRef.current) throw new Error('主输入框已有草稿或固定引用，请先发送或取消该草稿后再提交局部修改。')
    const refs = [selectionReference(request.selection, true)]
    documentsRef.current = refs; setDocuments(refs); workbenchSelection.setPinned(refs)
    capturePromise.current = null
    documentsByConversation.current.set(activeRef.current.conversationId, refs)
    frozenByConversation.current.set(activeRef.current.conversationId, true)
    contextFrozenRef.current = true; setContextFrozen(true)
    draftRef.current = request.instruction; setDraft(request.instruction)
    void submit('queue')
  }
  useEffect(() => workbenchSelection.onRequest(request => contextualHandler.current(request)), [])
  /** "+" menu: reference the current document, or its current selection, for this message. */
  const changeSelection = async (requireSelection = true) => {
    setPlusOpen(false)
    try {
      const captured = await captureDocuments(true)
      if (!captured.length) throw new Error('当前没有打开的文档，原引用仍保留。')
      if (requireSelection && !captured.some(value => value.selection?.length)) throw new Error('当前没有有效选区，原引用仍保留。')
      const refs = requireSelection ? captured : captured.map(({ selection: _selection, ...value }) => value)
      setDocuments(refs); documentsRef.current = refs; contextFrozenRef.current = true; setContextFrozen(true)
      if (activeRef.current) { documentsByConversation.current.set(activeRef.current.conversationId, refs); frozenByConversation.current.set(activeRef.current.conversationId, true) }
      await persist()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '选区未改变。') }
  }
  const unpinSelection = () => {
    const refs = documentsRef.current.map(({ selection, ...value }) => ({ ...value, writable: value.writable.filter(scope => scope.kind === 'document') }))
    setDocuments(refs); documentsRef.current = refs; workbenchSelection.setPinned(refs)
    if (activeRef.current) documentsByConversation.current.set(activeRef.current.conversationId, refs)
    void persist().catch(() => setError('引用草稿未保存，请重试。'))
  }
  /** Chip ×: drop one document reference (or all) from this message; the other references stay. */
  const removeDocumentReferences = async (documentId?: string) => {
    const selected = activeRef.current
    if (!selected || busy || !documentsRef.current.length) return
    setBusy(true); setError('')
    try {
      await (capturePromise.current ?? Promise.resolve())
      if (activeRef.current?.conversationId !== selected.conversationId) throw new Error('会话已切换')
      const remaining = documentId ? documentsRef.current.filter(value => value.documentId !== documentId) : []
      await persist(remaining)
      documentsByConversation.current.set(selected.conversationId, remaining)
      frozenByConversation.current.set(selected.conversationId, true)
      setDocuments(remaining); documentsRef.current = remaining
      setContextFrozen(true); contextFrozenRef.current = true
      workbenchSelection.setPinned(remaining)
      setSubmissions(value => value.filter(item => item.conversationId !== selected.conversationId || item.failure?.code !== 'document-session-changed'))
    } catch { setError('文档引用未移除；草稿和原引用已保留，请重试。') }
    finally { setBusy(false) }
  }
  const removeQueued = async (submission: ExecutionSubmissionRecord) => {
    if (!api || busy) return
    setBusy(true); setError('')
    try { replaceSubmission(await api.deleteSubmission({ workspaceId: submission.workspaceId, conversationId: submission.conversationId, submissionId: submission.submissionId })) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '排队消息未删除。') }
    finally { setBusy(false) }
  }
  const restoreSubmission = (submission: ExecutionSubmissionRecord) => {
    setDraft(submission.text); draftRef.current = submission.text
    setAttachments(submission.attachments); attachmentsRef.current = submission.attachments
    setDocuments(submission.documents); documentsRef.current = submission.documents
    setContextFrozen(true); contextFrozenRef.current = true
  }
  /** A queued message runs now: stop the current task and continue with it ("立即执行"). */
  const runQueuedNow = async (submission: ExecutionSubmissionRecord) => {
    if (!api || busy) return
    setBusy(true); setError('')
    try { replaceSubmission(await api.deleteSubmission({ workspaceId: submission.workspaceId, conversationId: submission.conversationId, submissionId: submission.submissionId })) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '排队消息已开始，未能立即执行。'); setBusy(false); return }
    setBusy(false)
    restoreSubmission(submission)
    await submit('adjust', undefined, undefined, submission.permission)
  }
  const openExternal = async () => {
    if (!api || !externalAPI || !active || busy) return
    setBusy(true); setError('')
    try {
      if (!await prepareSend()) throw new Error('当前文档输入尚未同步，未打开外部交接。')
      if (!contextFrozenRef.current) freezeDocuments(draftRef.current || '外部交接')
      await persist()
      await (capturePromise.current ?? Promise.resolve(documentsRef.current))
      setExternalOpen(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '外部交接暂不可用。') }
    finally { setBusy(false) }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return
    const composer = event.currentTarget.closest('.execution-assistant__composer')
    if (event.currentTarget.getAttribute('aria-expanded') === 'true'
      || composer?.querySelector('[role="listbox"]:not([hidden]),[role="menu"]:not([hidden])')) return
    event.preventDefault()
    void submit('queue')
  }

  const stop = async () => {
    if (!api || !run || !['queued', 'running', 'stopping'].includes(run.status)) return
    setBusy(true); setError('')
    try { setRun(await api.stop(run.runId)) }
    catch { setError('停止请求没有到达执行器，请重试。') }
    finally { setBusy(false) }
  }

  const userHistory = userMessageWindow(active?.messages ?? [], active ? userHistoryOffsets[active.conversationId] ?? 0 : 0)
  const moveUserHistory = (offsetFromLatest: number) => {
    if (!active) return
    setUserHistoryOffsets(value => ({ ...value, [active.conversationId]: offsetFromLatest }))
  }

  const filteredConversations = conversations.filter(conversation =>
    (!conversationScope || homeInScope(conversationScope, conversation.home))
    && `${conversation.title || '新会话'} ${conversation.home?.path ?? ''}`.toLocaleLowerCase().includes(sessionSearch.trim().toLocaleLowerCase()))
  const sessionList = <aside className="execution-assistant__sessions" aria-label="会话列表">
    <header><strong>会话列表{sessionScope ? ` · ${sessionScope.path}` : ''}</strong><button type="button" onClick={() => void create()} disabled={busy || !workspaceId}>新建会话</button></header>
    <input aria-label="搜索会话" value={sessionSearch} onChange={event => { setSessionSearch(event.target.value); setSessionMenuId(null) }} placeholder="搜索会话" />
    <nav aria-label="工作空间会话">{filteredConversations.map(conversation => <div className="execution-assistant__session-row" key={conversation.conversationId}>
      {renamingId === conversation.conversationId ? <form onSubmit={event => { event.preventDefault(); void renameConversationItem(conversation, renameDraft) }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null) } }}>
        <input aria-label={`重命名 ${conversation.title || '新会话'}`} autoFocus value={renameDraft} onChange={event => setRenameDraft(event.target.value)} />
        <button type="submit" disabled={busy || !renameDraft.trim()}>保存</button>
        <button type="button" onClick={() => setRenamingId(null)}>取消</button>
      </form> : <button type="button" className={conversation.conversationId === active?.conversationId ? 'is-active' : ''}
        aria-current={conversation.conversationId === active?.conversationId ? 'page' : undefined}
        onClick={() => void select(conversation)} disabled={busy} aria-label={conversation.title || '新会话'} title={conversation.title || '新会话'}><span className="execution-assistant__session-title">{conversation.title || '新会话'}</span><small className="execution-assistant__session-home">{conversation.home ? `${conversation.home.workspaceId && conversation.home.workspaceId !== conversation.workspaceId ? '其他工作空间 · ' : ''}${conversation.home.kind === 'folder' ? '文件夹' : '文件'} · ${conversation.home.path}${conversation.home.missing ? ' · 已删除' : ''}` : '工作空间'}</small></button>}
      <div className="execution-assistant__session-menu">
        <button type="button" aria-label={`管理会话 ${conversation.title || '新会话'}`} aria-expanded={sessionMenuId === conversation.conversationId}
          onClick={() => setSessionMenuId(value => value === conversation.conversationId ? null : conversation.conversationId)} disabled={busy}>⋯</button>
        {sessionMenuId === conversation.conversationId && <div role="menu" aria-label={`会话操作 ${conversation.title || '新会话'}`}>
          <button type="button" role="menuitem" onClick={() => { setRenameDraft(conversation.title || '新会话'); setRenamingId(conversation.conversationId); setSessionMenuId(null) }}>重命名</button>
          <button type="button" role="menuitem" onClick={() => void removeConversationItem(conversation)}>删除会话</button>
        </div>}
      </div>
    </div>)}</nav>
    {filteredConversations.length === 0 && <p className="execution-assistant__session-empty">没有匹配的会话。</p>}
  </aside>

  return <section className={`execution-assistant${sessionDock.inWorkspace ? ' execution-assistant--docked' : ''}`} aria-label="创作助手">
    {sessionDock.inWorkspace ? sessionDock.target && createPortal(sessionList, sessionDock.target) : sessionList}
    <div className="execution-assistant__main">
      <header className="execution-assistant__header">
        <div className="execution-assistant__heading">
          <div className="execution-assistant__title"><span>当前会话</span><strong title={active?.title || '新会话'}>{active?.title || '新会话'}</strong></div>
          <details className="execution-assistant__more" ref={moreRef}>
            <summary aria-label="会话更多操作">更多</summary>
            <div className="execution-assistant__more-menu" aria-label="会话次级操作">
              <button type="button" onClick={() => { moreRef.current!.open = false; setHistorySearchOpen(value => !value) }} disabled={!active || !api}>搜索历史</button>
              <button type="button" onClick={() => { moreRef.current!.open = false; void openExternal() }} disabled={!active || busy || !externalAPI}>外部客户端</button>
            </div>
          </details>
        </div>
      </header>
      {error && <p className="execution-assistant__error" role="alert">{error}</p>}
      {active?.home?.missing && <p className="execution-assistant__home-notice" role="status">所属文件已删除，本条消息不会自动引用该文件；可重新引用文件。</p>}
      <div className="execution-assistant__history">
        {userHistory.windowCount > 1 && <section aria-label="用户消息历史">
          <header>
            <span aria-live="polite">第 {userHistory.windowNumber} / {userHistory.windowCount} 组 · 共 {userHistory.total} 条</span>
            <nav aria-label="用户消息历史翻页">
              <button type="button" onClick={() => moveUserHistory(userHistory.offsetFromLatest + 1)} disabled={!userHistory.canShowOlder}>查看更早的用户消息</button>
              <button type="button" onClick={() => moveUserHistory(userHistory.offsetFromLatest - 1)} disabled={!userHistory.canShowNewer}>查看更新的用户消息</button>
              <button type="button" onClick={() => moveUserHistory(0)} disabled={userHistory.offsetFromLatest === 0}>跳到最新用户消息</button>
            </nav>
          </header>
        </section>}
        <ExecutionTimeline projection={projection} userMessages={userHistory.messages} imageResults={active?.conversationId === projection.conversationId ? window.desktopAPI?.imageResults : undefined} workspaceId={active?.workspaceId} onLocateDocument={onLocateDocument} readBlob={api && active ? ref => api.blob(active.conversationId, ref) : undefined} searchEvents={api && active ? input => api.searchEvents({ conversationId: active.conversationId, ...input }) : undefined} historySearchOpen={historySearchOpen} onHistorySearchClose={() => setHistorySearchOpen(false)}
          onFirstVisible={api?.timing ? (taskId, itemId, stamp) => {
            const owner = timedSubmissions.current.get(taskId)
            if (!owner) return
            timedSubmissions.current.delete(taskId)
            void api.timing!({ ...owner, submissionId: taskId, stage: 'renderer.first-visible', stamp, itemId }).catch(() => undefined)
          } : undefined} />
        {connectionFailure(run) && <div className="execution-assistant__submission-note" role="alert">
          <p>{connectionFailure(run)}</p>
          <button type="button" disabled={busy || !submissions.some(item => item.runId === run!.runId)} onClick={() => void submit('queue', undefined, run!)}>连接恢复后继续此任务</button>
        </div>}
        {stopReason(run) && <div className="execution-assistant__submission-note" role="alert">
          <p>{stopReason(run)}</p>
          <button type="button" disabled={busy || !submissions.some(item => item.runId === run!.runId)} onClick={() => void submit('queue', undefined, run!)}>继续此任务</button>
        </div>}
        {submissions.filter(item => item.state !== 'accepted' && item.state !== 'cancelled').map(item => <article className={`execution-assistant__submission execution-assistant__submission--${item.state}`} key={item.submissionId} aria-label="待处理消息">
          <header><strong>{item.state === 'queued' ? `排队中${item.position ? ` · 第 ${item.position} 条` : ''}` : item.state === 'starting' ? '正在确认' : '未发送'}</strong>
            <small>{item.model.provider} · {item.model.model}</small></header>
          <p>{item.text || `附件 ${item.attachments.length} 个`}</p>
          {item.queuePausedReason === 'external-handoff' && <p className="execution-assistant__submission-note">外部客户端已接手，内置队列保持暂停；撤销外部授权后可显式恢复。</p>}
          {item.failure && <p className="execution-assistant__submission-note">{item.failure.message}</p>}
          <div className="execution-assistant__submission-actions">
            {item.state === 'queued' && <button type="button" onClick={() => void runQueuedNow(item)} disabled={busy}>立即执行（先停止当前任务）</button>}
            {item.state === 'queued' && <button type="button" onClick={() => void removeQueued(item)} disabled={busy}>删除排队消息</button>}
            {(item.state === 'starting' || item.failure?.code === 'ack-unconfirmed') && <button type="button" onClick={() => void submit(item.mode, item)} disabled={busy}>用同一提交确认</button>}
            {(item.state === 'failed' || item.state === 'starting' && item.failure) && <button type="button" onClick={() => restoreSubmission(item)} disabled={busy}>恢复到输入框</button>}
          </div>
        </article>)}
      </div>
      {openQuestion && <ExecutionQuestionCard key={`${openQuestion.runId}:${openQuestion.callId}`} pending={openQuestion}
        onAnswer={api?.answer ? async answer => {
          const record = await api.answer!({ runId: openQuestion.runId, callId: openQuestion.callId, answer })
          if (runRef.current?.runId === record.runId) { setRun(record); runRef.current = record }
        } : undefined} />}
      {openApproval && <ExecutionApprovalCard key={`${openApproval.runId}:${openApproval.callId}`} pending={openApproval}
        onDecide={api?.approve ? async decision => {
          const record = await api.approve!({ runId: openApproval.runId, callId: openApproval.callId, decision })
          if (runRef.current?.runId === record.runId) { setRun(record); runRef.current = record }
        } : undefined} />}
      <footer className="execution-assistant__composer">
        {(documents.length > 0 || contextFrozen) && <div className="execution-assistant__references" aria-label="本条消息的引用">
          {documents.map(value => {
            const name = documentNames[value.documentId] ?? '已绑定文档'
            return <span className="execution-assistant__chip" key={value.documentId}>
              <span className="execution-assistant__chip-label" title={name}>{name}</span>
              <button type="button" aria-label={`移除引用 ${name}`} disabled={busy} onClick={() => void removeDocumentReferences(value.documentId)}>×</button>
            </span>
          })}
          {documents.some(value => value.selection?.length) && <span className="execution-assistant__chip">
            <span className="execution-assistant__chip-label">{`选区 ${documents.reduce((n, value) => n + (value.selection?.length ?? 0), 0)} 处`}</span>
            <button type="button" aria-label="移除选区引用" disabled={busy} onClick={unpinSelection}>×</button>
          </span>}
          {contextFrozen && documents.length === 0 && <span className="execution-assistant__chip is-muted">{active?.home?.kind === 'file' && !active.home.missing ? `默认引用 ${active.home.path}` : '本条消息不引用文档'}</span>}
        </div>}
        <AttachmentComposer workspaceDirectory={root ?? undefined} key={active?.conversationId ?? 'no-conversation'} value={attachments} disabled={!active || busy}
          onBusyChange={setAttachmentBusy} onChange={value => {
            setAttachments(value); attachmentsRef.current = value
            if (value.length > 0) freezeDocuments(draftRef.current || '附件')
            void persist().catch(() => setError('附件草稿未保存，请重试。'))
          }}>
          {actions => <div className="execution-assistant__input-row">
            <div className="execution-assistant__plus" ref={plusRef}>
              <button type="button" className="execution-assistant__plus-button" aria-label="添加" aria-haspopup="menu" aria-expanded={plusOpen}
                disabled={!active || busy} onClick={event => togglePopup('plus', event.currentTarget)}>+</button>
              {plusOpen && <div ref={popupRef} className="execution-assistant__popup" role="menu" aria-label="添加内容" style={{ left: popupPosition.left, bottom: popupPosition.bottom }}>
                <button type="button" role="menuitem" disabled={!actions.canAdd} onClick={() => { setPlusOpen(false); actions.addFiles() }}>添加附件（图片或文档）</button>
                <button type="button" role="menuitem" disabled={!actions.canReference} onClick={() => { setPlusOpen(false); actions.referenceWorkspace() }}>引用工作空间文件</button>
                <button type="button" role="menuitem" onClick={() => void changeSelection(false)}>引用当前文档</button>
                <button type="button" role="menuitem" onClick={() => void changeSelection(true)}>引用当前选区</button>
                <p>也可以直接粘贴或拖入图片、文档。</p>
              </div>}
            </div>
            <textarea aria-label="给创作助手发消息" data-attachment-paste-target value={draft} disabled={!active || busy} placeholder="描述你要讨论或完成的内容"
              onFocus={() => { setPlusOpen(false); setPermissionOpen(false) }}
              onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }} onKeyDown={onComposerKeyDown}
              onChange={event => { setDraft(event.target.value); draftRef.current = event.target.value; freezeDocuments(event.target.value) }} onBlur={() => { void persist().catch(() => setError('草稿未保存，请重试。')) }} />
          </div>}
        </AttachmentComposer>
        <div className="execution-assistant__toolbar">
          <div className="execution-assistant__permission" ref={permissionRef}>
            <button type="button" className="execution-assistant__permission-button" aria-label={`权限：${permissionLabels[permission]}`} aria-haspopup="menu" aria-expanded={permissionOpen}
              title={`${permissionLabels[permission]}：${permissionDescriptions[permission]}`} onClick={event => togglePopup('permission', event.currentTarget)}>
              <span aria-hidden="true">{permission === 'read-only' ? '👁' : permission === 'ask' ? '✋' : '✓'}</span>{permissionShortLabels[permission]}</button>
            {permissionOpen && <div ref={popupRef} className="execution-assistant__popup execution-assistant__popup--permission" role="menu" aria-label="权限模式"
              style={{ left: popupPosition.left, bottom: popupPosition.bottom }}>
              {executionPermissionModes.map(mode => <button type="button" role="menuitemradio" aria-checked={mode === permission} key={mode} onClick={() => choosePermission(mode)}>
                <span>{permissionLabels[mode]}</span><small>{permissionDescriptions[mode]}</small></button>)}
              <p>只影响之后发送的任务；正在运行的任务保持发送时的权限。</p>
            </div>}
          </div>
          <div className="execution-assistant__composer-model" aria-label="当前模型" title={modelDescription}>
            <span className={configured ? 'is-ready' : 'is-unavailable'} aria-hidden="true" />
            {/* Like common agents, the model summary itself opens the model menu. */}
            <button ref={modelButtonRef} type="button" aria-label="切换模型" aria-describedby={modelSummaryId} aria-expanded={modelMenuOpen} aria-controls="assistant-model-choices" onClick={toggleModelMenu}>
              <span id={modelSummaryId}>{modelSummary}{connection ? ` · ${billingLabels[connection.connection.billing.kind]}` : ''}{!configured && conversationSelection ? ' · 不可用' : ''}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {modelMenuOpen && createPortal(<div ref={modelMenuRef} id="assistant-model-choices" className="execution-assistant__model-menu" role="group" aria-label="对话模型选择"
              style={{ left: modelMenuPosition.left, bottom: modelMenuPosition.bottom, width: modelMenuPosition.width }}>
              <strong>下次任务使用</strong>
              {conversationSelection && <div className="execution-assistant__model-effort" role="group" aria-label="推理强度">
                <strong>推理强度</strong>
                <div>
                  <button type="button" aria-pressed={selectedEffort === undefined} disabled={busy} onClick={() => chooseEffort()}>默认</button>
                  {effortOptions.map(choice => <button type="button" key={choice.effort}
                    aria-pressed={selectedEffort === choice.effort} disabled={busy} title={'description' in choice && typeof choice.description === 'string' ? choice.description : undefined}
                    onClick={() => chooseEffort(choice.effort)}>{effortLabels[choice.effort]}</button>)}
                </div>
                {effortSource === 'documented' && <small>官方模型选项，当前连接未验证。默认档依模型官方设置；Luna、Sol 为中。</small>}
                {effortSource === 'directory' && effortOptions.length === 0 && <small>此连接目录未提供可选强度，使用模型默认值。</small>}
                {effortSource === 'none' && <small>此连接未声明可选强度，使用模型默认值。</small>}
              </div>}
              <div className="execution-assistant__model-list" role="group" aria-label="可用模型">
              {(modelOptions.length > 6 || otherModelOptions.length > 0) && <input aria-label="搜索模型" value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="搜索模型或连接" />}
              {(modelQuery ? matchingModelOptions : primaryModelOptions).map(modelChoice)}
              {!modelQuery && otherModelOptions.length > 0 && <details style={{ borderTop: '1px solid var(--border-color, #d9dfdb)', paddingTop: 6 }}>
                <summary style={{ cursor: 'pointer', padding: '6px 4px' }}>全部模型（另有 {otherModelOptions.length} 个）</summary>
                {otherModelOptions.map(modelChoice)}
              </details>}
              {Object.entries(modelCatalogErrors).filter(([key]) => settings?.connections.some(entry => key === `${entry.connection.id}:${entry.connection.revision}`)).map(([key, message]) =>
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><p>{message}</p><button type="button" onClick={() => {
                  catalogRequested.current.delete(key)
                  setModelCatalogErrors(current => { const next = { ...current }; delete next[key]; return next })
                  setModelCatalogs(current => ({ ...current }))
                }}>重试目录</button></div>)}
              {modelOptions.filter(value => value.connection.hasCredential && !value.connection.revoked).length === 0 && <p>连接模型目录读取中。请先接入 API 或登录 ChatGPT。</p>}
              </div>
              <p>{bodyStreamingLabel(bodyStreaming)}</p>
              <button type="button" className="execution-assistant__manage-models" onClick={() => { setModelMenuOpen(false); setSettingsEntry('chatgpt-oauth'); setSettingsOpen(true) }}>登录 ChatGPT（OAuth）…</button>
              <button type="button" className="execution-assistant__manage-models" onClick={() => { setModelMenuOpen(false); setSettingsEntry('default'); setSettingsOpen(true) }}>管理模型与连接…</button>
            </div>, document.body)}
          </div>
          <div className="execution-assistant__actions">
            {run && ['queued', 'running', 'stopping'].includes(run.status) && <button type="button" onClick={() => void stop()} disabled={busy || run.status === 'stopping'}>{run.status === 'stopping' ? '正在停止…' : '停止'}</button>}
            <button type="button" className="primary-button" onClick={() => void submit('queue')} disabled={!active || busy || attachmentBusy || (!draft.trim() && attachments.length === 0)}>{run && ['queued', 'running', 'stopping'].includes(run.status) ? '加入队列' : '发送'}</button>
          </div>
        </div>
      </footer>
    </div>
    <ExecutionSettingsPanel open={settingsOpen} entry={settingsEntry} onClose={() => setSettingsOpen(false)} api={settingsAPI}
      onSaved={value => setSettings(value)} />
    {externalAPI && active && <ExternalMcpPanel open={externalOpen} onClose={() => setExternalOpen(false)} api={externalAPI}
      workspaceId={workspaceId} conversation={active} documents={documents} instruction={draft} documentNames={documentNames}
      onConversationChange={conversation => {
        setConversations(value => updateConversation(value, conversation)); setActive(conversation); activeRef.current = conversation
      }} />}
  </section>
}
