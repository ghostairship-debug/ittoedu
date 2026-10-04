import { selectionReference, workbenchSelection, type ContextualEditRequest } from './SelectionContextController'
import { elementCards } from './elementCards/elementCardController'
import './selectionContext.css'
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { File, Folder } from 'lucide-react'
import { dispatchRevealInExplorer } from './revealInExplorer'
import { useDismissableDetails } from '../ui/useDismissableDetails'
import { homeInScope, type ConversationRecord } from '../../shared/workbench/conversations'
import { type ExecutionRunRecord, type ExecutionContentOutput } from '../../shared/workbench/execution'
import { captureRendererTiming, disclosedExecutionSettings, type ExecutionDesktopAPI, type ExecutionDocumentReference, type ExecutionSendInput, type ExecutionSubmissionMode, type ExecutionSubmissionRecord } from '../../shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionProjection } from '../../shared/workbench/executionEvents'
import type { InputAttachmentReference } from '../../shared/workbench/attachments'
import type { ExecutionRoleSelection, ExecutionSettingsView } from '../../shared/workbench/executionSettings'
import type { DiscoveredModel, DiscoveredModels, DiscoveredReasoningEffort, ExecutionSettingsAPI } from '../../shared/workbench/executionSettingsDesktop'
import { readModelReasoningEffort, resolveModelReasoning, withModelReasoning, withoutManagedModelReasoning } from '../../shared/workbench/modelReasoning'
import { ModelThinkingBudgetControl } from './ModelThinkingBudgetControl'
import { ModelReferencePicker } from './ModelReferencePicker'
import { findModelKnowledgeReference, type ModelKnowledgeEntry } from '../../shared/workbench/modelKnowledge'
import { effectiveModelProtocol } from '../../shared/workbench/modelRouting'
import type { ExternalMcpAPI } from '../../shared/workbench/external'
import { ExecutionSettingsPanel } from './ExecutionSettingsPanel'
import { ExternalMcpPanel } from './ExternalMcpPanel'
import { ExecutionTimeline, type ExecutionTimelineProps } from './ExecutionTimeline'
import { ExecutionChangeReview, type ExecutionChangeReviewProps } from './ExecutionChangeReview'
import type { UserCheckpointIndex } from '../../shared/workbench/executionReview'
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
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { TaskBrowserViewport } from './browserEmbedded/TaskBrowserViewport'

export interface ExecutionAssistantHandle { preserveDraft(): Promise<void> }
type BrowserControlState = Awaited<ReturnType<NonNullable<ExecutionDesktopAPI['browserControl']>>>

export interface ExecutionAssistantProps {
  root: string | null
  captureDocuments(writable: boolean): Promise<ExecutionDocumentReference[]>
  prepareSend(documentIds?: readonly string[]): Promise<boolean>
  api?: ExecutionDesktopAPI
  settingsAPI?: ExecutionSettingsAPI
  externalAPI?: ExternalMcpAPI
  onLocateDocument?(documentId: string): void
}

const billingLabels = { metered: '按量付费', 'token-plan': 'Token Plan', subscription: '订阅', prepaid: '预付费', unknown: '计费未知' }
const checkpointStatusLabels: Record<ExecutionRunRecord['status'], string> = {
  queued: '等待中', running: '进行中', stopping: '正在停止', stopped: '已停止', partial: '部分完成',
  completed: '已完成', failed: '失败', interrupted: '已中断',
}
const effortLabels: Record<DiscoveredReasoningEffort, string> = { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' }
const knowledgeKey = (entry: ModelKnowledgeEntry) => entry.provider ? `${entry.provider}/${entry.id}` : entry.id
const knownModelGuidance: Record<string, string> = {
  'gpt-6-sol': '日常创作与开发',
  'gpt-6-luna': '简单、快速的任务',
  'gpt-6-astra': '复杂任务与架构分析',
}
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

export const ExecutionAssistant = forwardRef<ExecutionAssistantHandle, ExecutionAssistantProps>(function ExecutionAssistant({ root, captureDocuments, prepareSend, api: suppliedAPI, settingsAPI: suppliedSettingsAPI, externalAPI: suppliedExternalAPI, onLocateDocument }, ref) {
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
  const [reviewRunId, setReviewRunId] = useState<string | null>(null)
  const [reviewCheckpoint, setReviewCheckpoint] = useState<UserCheckpointIndex | null>(null)
  const [checkpointBusy, setCheckpointBusy] = useState(false)
  const [forkAdvisory, setForkAdvisory] = useState<{ conversationId: string; remaining: string[] } | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [allModelsOpen, setAllModelsOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState('')
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, DiscoveredModels>>({})
  const [modelCatalogErrors, setModelCatalogErrors] = useState<Record<string, string>>({})
  const [modelKnowledge, setModelKnowledge] = useState<ModelKnowledgeEntry[]>([])
  const [knowledgeError, setKnowledgeError] = useState('')
  const catalogRequested = useRef(new Set<string>())
  const [modelMenuPosition, setModelMenuPosition] = useState({ left: 0, bottom: 0, width: 320 })
  const moreRef = useRef<HTMLDetailsElement>(null)
  useDismissableDetails(moreRef)
  const plusRef = useRef<HTMLDivElement>(null), permissionRef = useRef<HTMLDivElement>(null), popupRef = useRef<HTMLDivElement>(null)
  const [popupPosition, setPopupPosition] = useState({ left: 8, bottom: 8 })
  const modelButtonRef = useRef<HTMLButtonElement>(null), modelSummaryId = useId()
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [submissions, setSubmissions] = useState<ExecutionSubmissionRecord[]>([])
  const [userHistoryOffsets, setUserHistoryOffsets] = useState<Record<string, number>>({})
  const [latestRequest, setLatestRequest] = useState<ExecutionTimelineProps['latestRequest']>()
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [documentNames, setDocumentNames] = useState<Record<string, string>>({})
  const [documentReferenceIssues, setDocumentReferenceIssues] = useState<Record<string, string>>({})
  const [pendingRestore, setPendingRestore] = useState<ExecutionSubmissionRecord | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [recoveryIssues, setRecoveryIssues] = useState<string[]>([])
  const [taskBrowser, setTaskBrowser] = useState<({ runId: string } & BrowserControlState) | null>(null)
  const [browserPanelOpen, setBrowserPanelOpen] = useState(false)
  const [browserViewportReady, setBrowserViewportReady] = useState(false)
  const browserObservation = useRef(0)
  const [busy, setBusy] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0), capturePromise = useRef<Promise<ExecutionDocumentReference[]> | null>(null)
  const fileOpenTicket = useRef(0)
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
  useEffect(() => { setReviewRunId(null); setReviewCheckpoint(null) }, [active?.conversationId])
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
      setAllModelsOpen(false)
      setFavoriteError('')
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
    setLatestRequest(undefined)
    setHistorySearchOpen(false)
    setPendingRestore(null)
    setModelMenuOpen(false)
    if (moreRef.current) moreRef.current.open = false
    setActive(conversation); activeRef.current = conversation
    setDraft(conversation.inputDraft); draftRef.current = conversation.inputDraft
    setAttachments(conversation.inputAttachments); attachmentsRef.current = conversation.inputAttachments
    setRun(null); setSubmissions([]); setProjection(emptyExecutionProjection(conversation.conversationId)); setError('')
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
    setLatestRequest(undefined)
    setContextFrozen(false); setRun(null); setError('')
    if (!api) { setError('当前环境没有统一执行服务。'); return }
    setBusy(true)
    void api.workspace(root).then(async value => {
      if (ticket !== generation.current) return
      setWorkspaceId(value.workspace.workspaceId); setConversations(value.conversations); setRecoveryIssues(value.recoveryIssues ?? [])
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
      if (!allModelsOpen && entry.connection.id !== settings.profile.roles.conversation?.connectionId
        && !(settings.modelFavorites ?? []).some(value => value.connectionId === entry.connection.id)) continue
      const key = `${entry.connection.id}:${entry.connection.revision}`
      if (modelCatalogs[key] || catalogRequested.current.has(key)) continue
      catalogRequested.current.add(key)
      void settingsAPI.discoverModels(entry.connection.id, entry.connection.revision).then(value => {
        if (value.connectionId !== entry.connection.id || value.connectionRevision !== entry.connection.revision) return
        setModelCatalogs(current => ({ ...current, [key]: value }))
        setModelCatalogErrors(current => { const next = { ...current }; delete next[key]; return next })
      }).catch(() => setModelCatalogErrors(current => ({ ...current, [key]: `${entry.connection.provider} 的模型目录暂不可读取。已有选择仍可使用。` })))
    }
  }, [modelMenuOpen, allModelsOpen, modelCatalogs, settings, settingsAPI])
  useEffect(() => {
    if (!modelMenuOpen || !settingsAPI) return
    let current = true
    setKnowledgeError('')
    void settingsAPI.knownModels().then(entries => {
      if (current) setModelKnowledge([...new Map(entries.map(entry => [knowledgeKey(entry), entry])).values()])
    }).catch(() => { if (current) setKnowledgeError('型号资料暂不可读取；已有模型与参数保留。') })
    return () => { current = false }
  }, [modelMenuOpen, settingsAPI])

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
    setTaskBrowser(null)
    if (!api?.browserControl || !active || !run || run.status !== 'running') return
    const { runId } = run, conversationId = active.conversationId
    let disposed = false
    const refresh = async () => {
      const observation = ++browserObservation.current
      const state = await api.browserControl!({ workspaceId, conversationId, runId, action: 'status' }).catch(() => null)
      if (!disposed && observation === browserObservation.current) setTaskBrowser(state ? { runId, ...state } : null)
    }
    void refresh()
    const unsubscribe = api.subscribe(event => {
      if (event.conversationId !== conversationId || event.runId !== runId) return
      if (event.type === 'run.state' || event.type === 'tool' && event.data.toolName === 'mcp.invoke') void refresh()
    })
    return () => { disposed = true; unsubscribe() }
  }, [api, workspaceId, active?.conversationId, run?.runId, run?.status])

  useEffect(() => { setBrowserPanelOpen(false); setBrowserViewportReady(false) }, [active?.conversationId, run?.runId])

  useEffect(() => {
    const documentsAPI = window.desktopAPI?.documents
    let disposed = false
    if (!documentsAPI || documents.length === 0) { setDocumentNames({}); setDocumentReferenceIssues({}); return }
    void Promise.all(documents.map(async reference => {
      try {
        const snapshot = await documentsAPI.read(reference.documentId)
        const name = snapshot.binding.kind === 'file' ? snapshot.binding.path.split(/[\\/]/).at(-1) || '已绑定文档' : snapshot.binding.suggestedName
        return { id: reference.documentId, name, issue: snapshot.epoch !== reference.epoch ? '原引用需要重新选择' : '' }
      } catch { return { id: reference.documentId, name: '原文档', issue: '原文档尚未打开' } }
    })).then(entries => { if (!disposed) {
      setDocumentNames(Object.fromEntries(entries.map(value => [value.id, value.name])))
      setDocumentReferenceIssues(Object.fromEntries(entries.filter(value => value.issue).map(value => [value.id, value.issue])))
    } })
    return () => { disposed = true }
  }, [documents])

  useEffect(() => {
    const conversationId = active?.conversationId
    if (!api || !conversationId) { setProjection(emptyExecutionProjection(conversationId ?? '')); return }
    let disposed = false
    let current = emptyExecutionProjection(conversationId)
    let published = current
    let initial = true, catchingUp = false, catchUpPending = false, refreshingConversation = false
    const observedEndedRuns = new Set<string>(), pendingEndedRuns = new Set<string>()
    // Main writes a task's reply, its restored input and the next queued request after run.end, and serves a
    // conversation read only after those writes, so one read per ended batch is its final record. The read must
    // never hold up the event cursor or repeat for old failures on every text update.
    const refreshConversation = () => {
      if (refreshingConversation || disposed || pendingEndedRuns.size === 0) return
      refreshingConversation = true
      void (async () => {
        while (!disposed && pendingEndedRuns.size > 0) {
          const endedRuns = [...pendingEndedRuns]
          pendingEndedRuns.clear()
          const selected = activeRef.current
          if (selected?.conversationId === conversationId) {
            const needsReply = endedRuns.some(runId => !selected.messages.some(message => message.role === 'assistant' && message.runId === runId))
            if (!needsReply) continue
            const latest = await api.conversation(selected.workspaceId, conversationId)
            const activeNow = activeRef.current
            if (latest && !disposed && activeNow?.conversationId === conversationId && latest.revision > activeNow.revision) {
              const hasLocalDraft = draftRef.current !== activeNow.inputDraft || !sameAttachments(attachmentsRef.current, activeNow.inputAttachments)
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
      })().catch(() => { if (!disposed) setError('任务过程暂不可读取，已保留会话内容。') })
        .finally(() => { refreshingConversation = false; refreshConversation() })
    }
    const observeEndedRun = (runId: string) => {
      if (observedEndedRuns.has(runId)) return
      observedEndedRuns.add(runId); pendingEndedRuns.add(runId)
    }
    const catchUp = () => {
      catchUpPending = true
      if (catchingUp || disposed) return
      catchingUp = true
      void (async () => {
        while (!disposed && catchUpPending) {
          catchUpPending = false
          if (initial) {
            current = await api.timeline(conversationId)
            initial = false
            current.items.filter(item => item.type === 'run.end').forEach(item => observeEndedRun(item.runId))
          }
          while (!disposed) {
            const page = await api.events(conversationId, current.cursor, 5000)
            if (page.events.length > 0) {
              const cursor = current.cursor
              const next = foldExecutionEvents(current, page.events)
              if (next.cursor !== cursor) current = next
              page.events.filter(event => event.sequence > cursor && event.type === 'run.end').forEach(event => observeEndedRun(event.runId))
            }
            if (!page.hasMore) break
          }
          if (!disposed) {
            if (current !== published) { setProjection(current); published = current }
            refreshConversation()
          }
        }
      })().catch(() => { if (!disposed) setError('任务过程暂不可读取，已保留会话内容。') })
        .finally(() => { catchingUp = false; if (catchUpPending && !disposed) catchUp() })
    }
    const unsubscribe = api.subscribe(event => {
      if (event.conversationId !== conversationId) return
      catchUp()
      if (event.type === 'run.end' || runRef.current?.runId !== event.runId) {
        if (event.type === 'run.end') void settingsAPI?.read().then(setSettings).catch(() => undefined)
        void api.run(event.runId).then(value => { if (!disposed) { setRun(value); runRef.current = value } })
        const selected = activeRef.current
        if (selected) void api.submissions({ workspaceId: selected.workspaceId, conversationId }).then(value => { if (!disposed) setSubmissions(value) })
      }
    })
    catchUp()
    const latestRunId = active.runIndex.builtinRunIds.at(-1)
    if (latestRunId) void api.run(latestRunId).then(value => { if (!disposed) { setRun(value); runRef.current = value } })
    return () => { disposed = true; unsubscribe() }
  }, [api, active?.conversationId])

  const openQuestion = useMemo(() => pendingQuestion(projection), [projection])
  const openApproval = useMemo(() => pendingApproval(projection), [projection])
  const reviewAPI = api
  const reviewLoader = useMemo(() => reviewAPI?.changeReview && active
    ? (input: Parameters<ExecutionChangeReviewProps['loadPage']>[0]) => reviewAPI.changeReview!({
      ...input, workspaceId: active.workspaceId, conversationId: active.conversationId }) : undefined,
  [api, active?.workspaceId, active?.conversationId])
  const reviewRollback = useMemo(() => reviewAPI?.changeRollback && active
    ? (input: Parameters<ExecutionChangeReviewProps['rollback']>[0]) => reviewAPI.changeRollback!({
      ...input, workspaceId: active.workspaceId, conversationId: active.conversationId }) : undefined,
  [api, active?.workspaceId, active?.conversationId])
  const readCheckpoint = async () => {
    if (!reviewAPI?.checkpoint || !active || !reviewRunId || checkpointBusy) return
    setCheckpointBusy(true); setError('')
    try {
      setReviewCheckpoint(await reviewAPI.checkpoint({ workspaceId: active.workspaceId,
        conversationId: active.conversationId, runId: reviewRunId }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '检查点暂不可读取') }
    finally { setCheckpointBusy(false) }
  }
  const forkFromCheckpoint = async () => {
    if (!reviewAPI?.forkCheckpoint || !active || !reviewRunId || busy || checkpointBusy) return
    setBusy(true); setError('')
    try {
      await persist()
      const result = await reviewAPI.forkCheckpoint({ workspaceId: active.workspaceId,
        conversationId: active.conversationId, runId: reviewRunId })
      setConversations(value => value.some(item => item.conversationId === result.conversation.conversationId)
        ? updateConversation(value, result.conversation) : [...value, result.conversation])
      setSessionSearch('')
      applyConversation(result.conversation)
      setForkAdvisory({ conversationId: result.conversation.conversationId, remaining: result.fork.advisoryRemaining })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法从检查点新建会话') }
    finally { setBusy(false) }
  }
  useEffect(() => { if (workspaceId) setPermissionState(readPermission(workspaceId)) }, [workspaceId])
  // Element AI cards (M15) belong to this space and use the permission level shown here.
  useEffect(() => { elementCards.setWorkspace(workspaceId || null); return () => elementCards.setWorkspace(null) }, [workspaceId])
  useEffect(() => { elementCards.setPermission(permission) }, [permission])
  const choosePermission = (value: ExecutionPermissionMode) => {
    setPermissionState(value); setPermissionOpen(false)
    permissionRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    try { if (workspaceId) window.localStorage.setItem(permissionKey(workspaceId), value) } catch { /* This session keeps the choice. */ }
  }
  const conversationSelection = settings?.profile.roles.conversation
  const connection = settings?.connections.find(value => value.connection.id === conversationSelection?.connectionId)
  const configured = Boolean(conversationSelection && connection?.hasCredential && !connection.revoked)
  const selectedModel = conversationSelection && connection ? { connection: connection.connection, model: conversationSelection.model,
    parameters: conversationSelection.parameters, capabilityModel: conversationSelection.capabilityModel } : undefined
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
    const options: { selection: ExecutionRoleSelection; connection?: ExecutionSettingsView['connections'][number]; catalogModel?: DiscoveredModel }[] = []
    const add = (selection: ExecutionRoleSelection | null, catalogModel?: DiscoveredModel) => {
      if (!selection) return
      const entry = settings.connections.find(value => value.connection.id === selection.connectionId)
      const existing = options.find(value => value.selection.connectionId === selection.connectionId && value.selection.model === selection.model)
      if (existing) { if (catalogModel) existing.catalogModel = catalogModel; return }
      options.push({ selection, connection: entry, catalogModel })
    }
    add(settings.profile.roles.conversation)
    for (const favorite of settings.modelFavorites ?? []) add(favorite)
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
      if (!catalog) continue
      for (const model of catalog.models) {
        const reasoning = resolveModelReasoning(entry.connection, model)
        const effort = model.defaultReasoningEffort
        add({ connectionId: entry.connection.id, model: model.id,
          ...(effort && reasoning.choices.some(choice => choice.effort === effort)
            ? { parameters: withModelReasoning({}, effort, reasoning) } : {}) }, model)
      }
    }
    return options
  }, [settings, streamingAlternatives, modelCatalogs])
  const favorites = settings?.modelFavorites ?? []
  const favoriteModelOptions = favorites.map(favorite => modelOptions.find(value => value.selection.connectionId === favorite.connectionId
    && value.selection.model === favorite.model)).filter((value): value is typeof modelOptions[number] => value !== undefined)
  const query = modelQuery.trim().toLocaleLowerCase()
  const connectionDescription = (entry: ExecutionSettingsView['connections'][number]) =>
    `${entry.connection.provider} · ${accountLabel(entry)} · ${billingLabels[entry.connection.billing.kind]}`
  const modelGroups: { id: string; entry?: ExecutionSettingsView['connections'][number]; label: string; options: typeof modelOptions }[] = (settings?.connections ?? []).map(entry => ({
    id: entry.connection.id, entry, label: connectionDescription(entry),
    options: modelOptions.filter(value => value.selection.connectionId === entry.connection.id),
  }))
  for (const value of modelOptions) {
    if (value.connection) continue
    const existing = modelGroups.find(group => group.id === value.selection.connectionId)
    if (existing) existing.options.push(value)
    else modelGroups.push({ id: value.selection.connectionId, label: `${value.selection.connectionId} · 连接不可用`, options: [value] })
  }
  const matchingModelGroups = modelGroups.map(group => ({ ...group,
    options: group.options.filter(value => !query || `${group.label} ${group.id} ${value.selection.model} ${value.catalogModel?.displayName ?? ''} ${value.catalogModel?.description ?? ''}`.toLocaleLowerCase().includes(query)),
  })).filter(group => !query || group.options.length > 0 || `${group.label} ${group.id}`.toLocaleLowerCase().includes(query))
  const toggleFavorite = async (selection: ExecutionRoleSelection, favorite: boolean) => {
    if (!settingsAPI || favoriteBusy) return
    setFavoriteBusy(true); setFavoriteError('')
    try {
      const modelFavorites = await settingsAPI.setModelFavorite({ connectionId: selection.connectionId, model: selection.model, favorite })
      setSettings(current => current ? { ...current, modelFavorites } : current)
    } catch { setFavoriteError('收藏未保存；原偏好保留，请重试。') }
    finally { setFavoriteBusy(false) }
  }
  const modelChoice = ({ selection, connection: entry, catalogModel }: typeof modelOptions[number]) => {
    const current = conversationSelection?.connectionId === selection.connectionId && conversationSelection.model === selection.model
    const available = entry?.hasCredential && !entry.revoked && entry.connection.capabilities.tools !== 'unsupported'
    const favorite = favorites.some(value => value.connectionId === selection.connectionId && value.model === selection.model)
    const label = entry ? connectionDescription(entry) : `${selection.connectionId} · 连接不可用`
    const guidance = knownModelGuidance[selection.model]
    return <div className="execution-assistant__model-row" key={`${selection.connectionId}:${selection.model}`}>
      <button type="button" className="execution-assistant__model-option"
      aria-pressed={current} disabled={busy || !available} onClick={() => void switchConversationModel(selection)}>
      <span>{catalogModel?.displayName ?? selection.model}</span>
      <small>{label}{!available && entry ? ' · 连接不可用' : current ? ' · 当前' : ''}{catalogModel ? ' · 目录能力未验证' : ''}</small>
      {guidance ? <small>建议 · {guidance}</small> : catalogModel?.description && <small>{catalogModel.description}</small>}
      </button>
      <button type="button" className="execution-assistant__model-star" aria-label={`${favorite ? '取消收藏' : '收藏'} ${selection.model} · ${label}`}
        aria-pressed={favorite} disabled={favoriteBusy || busy} onClick={() => void toggleFavorite(selection, !favorite)}
        title={favorite ? '取消收藏' : '收藏模型'}><span aria-hidden="true">{favorite ? '★' : '☆'}</span></button>
    </div>
  }
  const activeCatalogModel = connection && conversationSelection
    ? modelCatalogs[`${connection.connection.id}:${connection.connection.revision}`]?.models.find(value => value.id === conversationSelection.model)
    : undefined
  const referenceModel = findModelKnowledgeReference(modelKnowledge, conversationSelection?.capabilityModel)
  const refreshedMetadata = activeCatalogModel?.metadataSource === 'models.dev' && activeCatalogModel.metadata
    ? findModelKnowledgeReference(modelKnowledge, knowledgeKey(activeCatalogModel.metadata)) : undefined
  const reasoningModel = conversationSelection ? { ...(activeCatalogModel ?? { id: conversationSelection.model }),
    ...(referenceModel || refreshedMetadata ? { metadata: referenceModel ?? refreshedMetadata } : {}) } : undefined
  const resolvedReasoning = connection && conversationSelection
    ? resolveModelReasoning(connection.connection, reasoningModel!) : undefined
  const effortOptions = resolvedReasoning?.choices ?? []
  const effortSource = resolvedReasoning?.source ?? 'unknown'
  const selectedEffort = resolvedReasoning ? readModelReasoningEffort(conversationSelection?.parameters, resolvedReasoning) : undefined
  const reasoningToolsNeedResponses = selectedModel && effectiveModelProtocol(selectedModel) === 'openai-chat'
    && (resolvedReasoning?.toolRequirement === 'responses'
      || resolvedReasoning?.toolRequirement === 'responses-when-thinking' && selectedEffort !== 'none')
  const chooseEffort = (effort?: DiscoveredReasoningEffort) => {
    if (!conversationSelection || !resolvedReasoning) return
    const parameters = withModelReasoning(conversationSelection.parameters ?? {}, effort, resolvedReasoning)
    void switchConversationModel({ ...conversationSelection, parameters })
  }
  const chooseReferenceModel = (key: string) => {
    if (!conversationSelection) return
    const { capabilityModel: _previous, ...selection } = conversationSelection
    void switchConversationModel({ ...selection, parameters: withoutManagedModelReasoning(selection.parameters ?? {}),
      ...(key ? { capabilityModel: key } : {}) }, true)
  }
  const switchConversationModel = async (choice: ExecutionRoleSelection, keepMenuOpen = false) => {
    if (!settingsAPI || !settings || busy) return
    const selected = settings.profile.roles.conversation
    if (selected && selected.connectionId === choice.connectionId && selected.model === choice.model
      && selected.capabilityModel === choice.capabilityModel
      && JSON.stringify(selected.parameters ?? {}) === JSON.stringify(choice.parameters ?? {})) {
      if (!keepMenuOpen) { setModelMenuOpen(false); modelButtonRef.current?.focus() }
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
        || actual.capabilityModel !== choice.capabilityModel
        || JSON.stringify(actual.parameters ?? {}) !== JSON.stringify(choice.parameters ?? {})) {
        setError('模型配置在切换时发生变化，请查看当前模型后重试。')
      } else if (!keepMenuOpen) { setModelMenuOpen(false); modelButtonRef.current?.focus() }
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
      const write = (base: ConversationRecord) => api.draft({ workspaceId: base.workspaceId, conversationId: base.conversationId,
        expectedRevision: base.revision, text: localDraft, documents: refs, attachments: inputAttachments })
      // Main also writes this record after a task ends (its reply, a restored input, the next queued run). The unsaved
      // composer stays the newer teacher draft, so it is saved once more on the latest record instead of failing every later save.
      const saved = await write(selected).catch(async error => {
        if (!isExecutionInputError(error, 'conversation-draft-changed')) throw error
        const latest = await api.conversation(selected.workspaceId, selected.conversationId).catch(() => null)
        if (!latest || latest.revision === selected.revision) throw error
        return write(latest)
      })
      if (ticket !== generation.current) return saved
      documentsByConversation.current.set(saved.conversationId, refs)
      setConversations(value => updateConversation(value, saved)); setActive(saved); activeRef.current = saved
      return saved
    })
    persistQueue.current = task.catch(() => undefined)
    return task
  }

  useImperativeHandle(ref, () => ({ preserveDraft: async () => { await persist() } }))

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
      if (!latest) throw new Error('会话名称未保存：会话已不存在。')
      const saved = await api.renameConversation({ workspaceId: latest.workspaceId, conversationId: latest.conversationId,
        expectedRevision: latest.revision, title: title.trim() })
      setConversations(value => updateConversation(value, saved))
      if (activeRef.current?.conversationId === saved.conversationId) { setActive(saved); activeRef.current = saved }
      setRenamingId(null); setSessionMenuId(null)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '会话名称未保存，请重试。') }
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
  const revealSubmission = (submission: ExecutionSubmissionRecord) => {
    if (submission.state !== 'queued' && submission.state !== 'accepted') return
    setUserHistoryOffsets(value => ({ ...value, [submission.conversationId]: 0 }))
    setLatestRequest({ conversationId: submission.conversationId, submissionId: submission.submissionId })
  }
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
    revealSubmission(result.submission)
  }
  const submit = async (mode: ExecutionSubmissionMode = 'queue', retry?: ExecutionSubmissionRecord, continueRun?: ExecutionRunRecord, permissionOverride?: ExecutionPermissionMode, contentOutput?: ExecutionContentOutput) => {
    const clicked = !retry ? captureRendererTiming() : undefined
    const selected = activeRef.current
    if (!api || !selected || submittingRef.current || attachmentBusy || !retry && !continueRun && !draftRef.current.trim() && attachmentsRef.current.length === 0) return
    if (!configured) { setError('尚未配置可用的对话模型。请先在模型设置中选择连接、模型和账号。'); return }
    submittingRef.current = true; setBusy(true); setError('')
    let request: ExecutionSendInput | undefined, sendInvoked = false
    try {
      if (retry) request = { workspaceId: retry.workspaceId, conversationId: retry.conversationId, submissionId: retry.submissionId,
        expectedRevision: selected.revision, text: retry.text, documents: structuredClone(retry.documents), attachments: structuredClone(retry.attachments),
        mode: retry.mode, ...(retry.retryOfRunId ? { retryOfRunId: retry.retryOfRunId } : {}), ...(retry.permission ? { permission: retry.permission } : {}), ...(retry.contentOutput ? { contentOutput: retry.contentOutput } : {}) }
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
          ...(source.permission ? { permission: source.permission } : {}), ...(source.contentOutput ? { contentOutput: source.contentOutput } : {}) }
      }
      else {
        const pinned = await (capturePromise.current ?? Promise.resolve(documentsRef.current))
        const preparedDocuments = api.prepareDocuments ? await api.prepareDocuments({ workspaceId: selected.workspaceId,
          conversationId: selected.conversationId, documents: pinned, permission: permissionOverride ?? permission }) : pinned
        const ready = await prepareSend(preparedDocuments.map(document => document.documentId))
        if (!ready) { setError('引用文档的输入尚未同步；请处理对应文档后重试。'); return }
        // A click blurs the textarea first. Wait for that CAS, then freeze one exact payload.
        await persist()
        const current = activeRef.current
        if (!current || current.conversationId !== selected.conversationId) throw new Error('会话已切换，消息没有发送。')
        const captured = preparedDocuments
        const level = permissionOverride ?? permission
        request = { workspaceId: current.workspaceId, conversationId: current.conversationId, submissionId: crypto.randomUUID(),
          expectedRevision: current.revision, text: draftRef.current, documents: documentsForPermission(captured, level), attachments: structuredClone(attachmentsRef.current), mode, permission: level, ...(contentOutput ? { contentOutput } : {}) }
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
          ...(request.contentOutput ? { contentOutput: request.contentOutput } : {}),
          ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}), ...(request.permission ? { permission: request.permission } : {}),
          model: { provider: connection?.connection.provider ?? '当前连接', model: conversationSelection?.model ?? '当前模型',
            accountId: connection?.connection.accountId ?? '', billing: connection?.connection.billing.kind ?? 'unknown' }, createdAt: now, updatedAt: now })
      }
      if (clicked) {
        request.clientTiming = { click: clicked, invoke: captureRendererTiming() }
        timedSubmissions.current.set(request.submissionId, { workspaceId: request.workspaceId, conversationId: request.conversationId })
      }
      const sent = request
      sendInvoked = true
      const result = await api.send(sent).catch(async failure => {
        // Refused before acceptance: Main wrote this conversation after this view last read it (a reply, the next queued run).
        // The same payload is sent once more on that revision only when the stored draft is exactly this payload; any other
        // stored draft stays for the teacher to check, and the next send starts from the latest record.
        if (!isExecutionInputError(failure, 'conversation-draft-changed')) throw failure
        const latest = await api.conversation(sent.workspaceId, sent.conversationId).catch(() => null)
        if (!latest || latest.revision === sent.expectedRevision) throw failure
        if (activeRef.current?.conversationId === latest.conversationId) {
          setConversations(value => updateConversation(value, latest)); setActive(latest); activeRef.current = latest
        }
        if (latest.inputDraft !== sent.text || !sameAttachments(latest.inputAttachments, sent.attachments ?? [])) throw failure
        const { clientTiming: _clientTiming, ...again } = sent
        return api.send({ ...again, expectedRevision: latest.revision })
      })
      applySendResult(result)
      if (result.submission.state === 'failed') setError(result.submission.failure?.message ?? '消息未启动，输入和附件已恢复。')
    } catch (failure) {
      let known: ExecutionSubmissionRecord | null = null, lookedUp = false
      if (request) try { known = await api.submission({ workspaceId: request.workspaceId, conversationId: request.conversationId, submissionId: request.submissionId }); lookedUp = true } catch { /* keep the exact local pending card */ }
      if (known) {
        replaceSubmission(known)
        const latest = await api.conversation(known.workspaceId, known.conversationId).catch(() => null)
        if (latest) { setConversations(value => updateConversation(value, latest)); setActive(latest); activeRef.current = latest }
        if (known.state === 'accepted' || known.state === 'queued') {
          setDraft(''); draftRef.current = ''; setAttachments([]); attachmentsRef.current = []
          revealSubmission(known)
        }
        setError(known.state === 'starting' ? '提交状态尚在确认中；再次确认会复用同一提交，不会创建第二次运行。' : known.failure?.message ?? '')
      } else if (request) {
        const closedDocument = isExecutionInputError(failure, 'document-session-changed')
        // Main records a submission before anything runs: holding no record after the send settled, it refused this one
        // and nothing ran. Only a send whose record cannot be read leaves the outcome unknown.
        const reason = failure instanceof Error ? failure.message : '消息没有发送。'
        replaceSubmission({ submissionId: request.submissionId, workspaceId: request.workspaceId, conversationId: request.conversationId,
          state: 'failed', mode: request.mode ?? 'queue', text: request.text, documents: request.documents, attachments: request.attachments ?? [],
          ...(request.contentOutput ? { contentOutput: request.contentOutput } : {}),
          ...(request.retryOfRunId ? { retryOfRunId: request.retryOfRunId } : {}),
          model: { provider: connection?.connection.provider ?? '当前连接', model: conversationSelection?.model ?? '当前模型', accountId: connection?.connection.accountId ?? '', billing: connection?.connection.billing.kind ?? 'unknown' },
          createdAt: Date.now(), updatedAt: Date.now(), failure: closedDocument
            ? { code: 'document-session-changed', message: '目标文档已关闭或重新打开；本次未发送。可移除文档引用，核对草稿后重新发送。' }
            : !sendInvoked ? { code: 'not-sent', message: `未发送：${reason}` }
            : lookedUp ? { code: 'not-accepted', message: `已拒绝，未执行：${reason}` }
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
    void submit('queue', undefined, undefined, undefined, request.contentOutput)
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
  const applyRestoredSubmission = (submission: ExecutionSubmissionRecord) => {
    setDraft(submission.text); draftRef.current = submission.text
    setAttachments(submission.attachments); attachmentsRef.current = submission.attachments
    setDocuments(submission.documents); documentsRef.current = submission.documents
    setContextFrozen(true); contextFrozenRef.current = true
    if (activeRef.current) {
      documentsByConversation.current.set(activeRef.current.conversationId, submission.documents)
      frozenByConversation.current.set(activeRef.current.conversationId, true)
    }
    setPendingRestore(null)
    composerRef.current?.focus()
  }
  // The dialog focuses its own button after it opens; the composer takes focus back only once the dialog is gone
  // (confirm, cancel or Escape), so an early click cannot leave focus on a button that is about to be removed.
  const cancelRestore = useCallback(() => setPendingRestore(null), [])
  const restoreDialogOpen = pendingRestore !== null, restoreDialogWasOpen = useRef(false)
  useLayoutEffect(() => {
    if (restoreDialogWasOpen.current && !restoreDialogOpen) composerRef.current?.focus()
    restoreDialogWasOpen.current = restoreDialogOpen
  }, [restoreDialogOpen])
  const restoreSubmission = async (submission: ExecutionSubmissionRecord) => {
    await capturePromise.current
    if (activeRef.current?.conversationId !== submission.conversationId) return
    const hasInput = draftRef.current.length > 0 || attachmentsRef.current.length > 0
    if (hasInput && (draftRef.current !== submission.text || !sameAttachments(attachmentsRef.current, submission.attachments)
      || !sameDocuments(documentsRef.current, submission.documents))) { setPendingRestore(submission); return }
    applyRestoredSubmission(submission)
  }
  /** A queued message runs now: stop the current task and continue with it ("立即执行"). */
  const runQueuedNow = async (submission: ExecutionSubmissionRecord) => {
    if (!api || busy) return
    setBusy(true); setError('')
    try {
      if (!api.runQueued) throw new Error('当前执行服务需要更新，排队消息和输入均保留。')
      const result = await api.runQueued({ workspaceId: submission.workspaceId, conversationId: submission.conversationId, submissionId: submission.submissionId })
      replaceSubmission(result.submission)
      if (activeRef.current?.conversationId === submission.conversationId) {
        setActive(result.conversation); activeRef.current = result.conversation
        if (result.run) setRun(result.run)
        revealSubmission(result.submission)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '排队消息未能立即执行，原输入仍保留。') }
    finally { setBusy(false) }
  }
  const openExternal = async () => {
    if (!api || !externalAPI || !active || busy) return
    setBusy(true); setError('')
    try {
      const refs = await (capturePromise.current ?? Promise.resolve(documentsRef.current))
      if (!await prepareSend(refs.map(document => document.documentId))) throw new Error('引用文档的输入尚未同步，未打开外部交接。')
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

  const controlBrowser = async (action: 'takeover' | 'resume') => {
    if (!api?.browserControl || !active || !run || busy) return
    if (action === 'takeover' && api.browserViewport && !browserViewportReady) return
    const { runId } = run, conversationId = active.conversationId
    const applyState = (state: BrowserControlState | null) => {
      if (activeRef.current?.conversationId !== conversationId || runRef.current?.runId !== runId) return
      browserObservation.current++
      setTaskBrowser(state ? { runId, ...state } : null)
    }
    browserObservation.current++
    setBusy(true); setError('')
    try {
      const state = await api.browserControl({ workspaceId, conversationId: active.conversationId, runId: run.runId, action })
      applyState(state)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '浏览器接管未完成')
      const state = await api.browserControl({ workspaceId, conversationId: active.conversationId, runId: run.runId, action: 'status' }).catch(() => null)
      applyState(state)
    } finally { setBusy(false) }
  }

  const stop = async (pauseFollowing = false) => {
    if (!api || !run || !['queued', 'running', 'stopping'].includes(run.status)) return
    setBusy(true); setError('')
    try {
      if (pauseFollowing && active) await api.pauseQueue({ workspaceId, conversationId: active.conversationId, reason: 'user' })
      setRun(await api.stop(run.runId))
    }
    catch { setError('停止请求没有到达执行器，请重试。') }
    finally { setBusy(false) }
  }

  const userHistoryOffset = active ? userHistoryOffsets[active.conversationId] ?? 0 : 0
  const userHistory = useMemo(() => userMessageWindow(active?.messages ?? [], userHistoryOffset), [active?.messages, userHistoryOffset])
  const readTimelineBlob = useMemo<ExecutionTimelineProps['readBlob']>(() => api && active
    ? ref => api.blob(active.conversationId, ref) : undefined, [api, active?.conversationId])
  const searchTimelineEvents = useMemo<ExecutionTimelineProps['searchEvents']>(() => api && active
    ? input => api.searchEvents({ conversationId: active.conversationId, ...input }) : undefined, [api, active?.conversationId])
  const openSavedFile = useMemo<ExecutionTimelineProps['onOpenSavedFile']>(() => api && active ? (runId, itemId) => {
    const conversationId = active.conversationId, ticket = generation.current, openTicket = ++fileOpenTicket.current
    void api.run(runId).then(record => {
      if (ticket !== generation.current || openTicket !== fileOpenTicket.current || activeRef.current?.conversationId !== conversationId) return
      const tool = record?.input.conversationId === conversationId ? record.tools.find(value => value.callId === itemId) : undefined
      const receipt = tool?.state === 'returned' && tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
        ? tool.result.data as { path?: unknown; saved?: unknown; status?: unknown; dirty?: unknown } : null
      const saved = tool?.call.name === 'file.write' && receipt?.saved === true
        || tool?.call.name === 'file.save' && receipt?.status === 'saved' && receipt.dirty === false
      if (!saved || typeof receipt?.path !== 'string') throw new Error('这份文件的保存位置暂不可读取。')
      dispatchRevealInExplorer({ path: receipt.path, kind: 'file', open: true })
    }).catch(() => {
      if (ticket === generation.current && openTicket === fileOpenTicket.current && activeRef.current?.conversationId === conversationId) setError('保存结果暂不可打开，请在项目文件中查找。')
    })
  } : undefined, [api, active?.conversationId])
  const moveUserHistory = (offsetFromLatest: number) => {
    if (!active) return
    setUserHistoryOffsets(value => ({ ...value, [active.conversationId]: offsetFromLatest }))
  }

  const filteredConversations = conversations.filter(conversation =>
    (!conversationScope || homeInScope(conversationScope, conversation.home))
    && `${conversation.title || '新会话'} ${conversation.home?.path ?? ''}`.toLocaleLowerCase().includes(sessionSearch.trim().toLocaleLowerCase()))
  const sessionList = <aside className="execution-assistant__sessions" aria-label="会话列表">
    <header><strong>会话列表</strong><button type="button" onClick={() => void create()} disabled={busy || !workspaceId}>新建会话</button></header>
    {sessionScope && <div className="execution-assistant__session-filter" aria-label="会话筛选">
      <span title={sessionScope.path}>{sessionScope.kind === 'file' ? '文件' : '文件夹'} · {sessionScope.path}</span>
      <button type="button" onClick={() => sessionDock.setScope?.(null)}>显示全部会话</button>
    </div>}
    <input aria-label="搜索会话" value={sessionSearch} onChange={event => { setSessionSearch(event.target.value); setSessionMenuId(null) }} placeholder="搜索会话" />
    <nav aria-label="工作空间会话">
      {filteredConversations.length === 0 && <div className="execution-assistant__session-empty">
        <p>{sessionSearch.trim() ? '没有匹配的会话。' : sessionScope ? '这个位置还没有会话，可以新建或查看全部。' : '还没有会话，点击“新建会话”开始。'}</p>
        {sessionSearch.trim() && <button type="button" onClick={() => setSessionSearch('')}>清除搜索</button>}
      </div>}
      {filteredConversations.map(conversation => <div className="execution-assistant__session-row" key={conversation.conversationId}>
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
  </aside>

  const isEmptySession = Boolean(
    active &&
    active.messages.length === 0 &&
    !draft &&
    !active.inputDraft &&
    attachments.length === 0 &&
    active.inputAttachments.length === 0 &&
    (active.attachmentIds?.length ?? 0) === 0 &&
    active.frozenContextRefs.length === 0 &&
    active.runIndex.builtinRunIds.length === 0 &&
    active.runIndex.externalRunIds.length === 0
  )
  const workspaceName = root ? (root.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || '工作空间') : '工作空间'
  const homePath = active?.home?.path ? active.home.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''
  const pathSegments = homePath ? homePath.split('/') : []
  const isOtherWorkspace = Boolean(active?.home?.workspaceId && active?.workspaceId && active.home.workspaceId !== active.workspaceId)
  // A home in another workspace must not be shown under this workspace's name or root.
  const formattedPath = isOtherWorkspace ? pathSegments.join(' › ') : pathSegments.length > 0 ? [workspaceName, ...pathSegments].join(' › ') : workspaceName
  const isMissing = Boolean(active?.home?.missing)
  const locationKind = active?.home?.kind ?? 'folder'
  const locationIcon = locationKind === 'file' ? <File size={13} className="execution-assistant__location-icon" /> : <Folder size={13} className="execution-assistant__location-icon" />
  const fullPath = isOtherWorkspace ? homePath : [root?.replace(/[/\\]+$/, ''), homePath].filter(Boolean).join('/')
  const locationTitle = `${fullPath ? `${fullPath}\n` : ''}所属位置只决定默认引用和新建文件的位置，不限制可修改的范围`
  const handleLocationClick = () => {
    if (!active) return
    const path = active.home?.path ?? ''
    const kind = active.home?.kind ?? 'folder'
    const workspaceId = active.home?.workspaceId ?? active.workspaceId
    // Explorer roots get new ids on every run; a home in this session's own space is revealed in the current root.
    dispatchRevealInExplorer(isOtherWorkspace ? { workspaceId, path, kind } : { path, kind })
  }

  return <section className={`execution-assistant${sessionDock.inWorkspace ? ' execution-assistant--docked' : ''}`} aria-label="创作助手">
    {recoveryIssues.length > 0 && <details className="execution-assistant__notice"><summary>{recoveryIssues.length} 项历史恢复需处理；其他会话可继续使用</summary>{recoveryIssues.map((message, index) => <p key={index}>{message}</p>)}</details>}
    {sessionDock.inWorkspace ? sessionDock.target && createPortal(sessionList, sessionDock.target) : sessionList}
    <div className="execution-assistant__main">
      <header className="execution-assistant__header">
        <div className="execution-assistant__heading">
          <div className="execution-assistant__title"><span>当前会话</span><strong title={active?.title || '新会话'}>{active?.title || '新会话'}</strong></div>
          <details className="execution-assistant__more" ref={moreRef}>
            <summary aria-label="会话更多操作">更多</summary>
            <div className="execution-assistant__more-menu" aria-label="会话次级操作">
              <button type="button" onClick={() => { moreRef.current!.open = false; setHistorySearchOpen(value => !value) }} disabled={!active || !api}>搜索历史</button>
              <button type="button" onClick={() => { moreRef.current!.open = false; setReviewRunId(value => value ? null : active?.runIndex.builtinRunIds.at(-1) ?? null) }}
                disabled={!active?.runIndex.builtinRunIds.length || !reviewLoader || !reviewRollback}>审阅本次变更</button>
              <button type="button" onClick={() => { moreRef.current!.open = false; void openExternal() }} disabled={!active || busy || !externalAPI}>外部客户端</button>
            </div>
          </details>
        </div>
        <div className="execution-assistant__location-bar">
          <button type="button" className="execution-assistant__location" title={locationTitle} onClick={handleLocationClick}>
            <span className="execution-assistant__location-path">
              {locationIcon}
              <span className="execution-assistant__location-text">
                {isOtherWorkspace && <span className="execution-assistant__location-prefix">其他工作空间 · </span>}
                {formattedPath}
                {isMissing && <span className="execution-assistant__location-missing"> · 已删除</span>}
              </span>
            </span>
            {isEmptySession && <small className="execution-assistant__location-hint">发送首条消息后固定</small>}
          </button>
        </div>
      </header>
      {forkAdvisory && forkAdvisory.conversationId === active?.conversationId && <section aria-label="新会话继续提示" className="execution-assistant__submission-note">
        <p>已从检查点创建新会话。先检查并修改下方目标草稿；发送时会重新读取当前文件，原任务操作不会自动重做。</p>
        {forkAdvisory.remaining.length > 0 && <><strong>原计划提示（请核对）</strong><ul>{forkAdvisory.remaining.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      </section>}
      {error && <p className="execution-assistant__error" role="alert">{error}</p>}
      {active?.home?.missing && <p className="execution-assistant__home-notice" role="status">所属文件已删除，本条消息不会自动引用该文件；可重新引用文件。</p>}
      <div className="execution-assistant__history">
        {isEmptySession && projection.items.length === 0 && submissions.length === 0 && !historySearchOpen ? <section className="execution-assistant__welcome" aria-label="开始创作">
          <span className="execution-assistant__welcome-mark" aria-hidden="true">✦</span>
          <h2>告诉我想做什么</h2>
          <p>描述目标，或拖入材料，我们一起完善内容。</p>
          {!configured && <div className="execution-assistant__welcome-connect"><p>连接模型后即可开始对话。</p>
            <button type="button" className="primary-button" onClick={() => { setSettingsEntry('default'); setSettingsOpen(true) }}>连接模型</button></div>}
          <div className="execution-assistant__welcome-examples" aria-label="试试这些任务">
            {['帮我整理材料，提炼重点并给出清晰的结构。', '帮我制作一份演示，先和我确认主题与内容。'].map((text, index) => <button type="button" key={text} disabled={!active || busy}
              onClick={() => { setDraft(text); draftRef.current = text; freezeDocuments(text); composerRef.current?.focus() }}>{index === 0 ? '整理材料' : '制作演示'}<span aria-hidden="true">↗</span></button>)}
          </div>
        </section> : <>
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
        <ExecutionTimeline projection={projection} userMessages={userHistory.messages} latestRequest={latestRequest} imageResults={active?.conversationId === projection.conversationId ? window.desktopAPI?.imageResults : undefined} workspaceId={active?.workspaceId} onLocateDocument={onLocateDocument} onOpenSavedFile={openSavedFile} readBlob={readTimelineBlob} searchEvents={searchTimelineEvents} historySearchOpen={historySearchOpen} onHistorySearchClose={() => setHistorySearchOpen(false)}
          onFirstVisible={api?.timing ? (taskId, itemId, stamp) => {
            const owner = timedSubmissions.current.get(taskId)
            if (!owner) return
            timedSubmissions.current.delete(taskId)
            void api.timing!({ ...owner, submissionId: taskId, stage: 'renderer.first-visible', stamp, itemId }).catch(() => undefined)
          } : undefined} />
        </>}
        {reviewRunId && active?.runIndex.builtinRunIds.includes(reviewRunId) && reviewLoader && reviewRollback && <section aria-label="会话变更审阅">
          <header><strong>审阅任务变更</strong>
            <label>任务 <select value={reviewRunId} onChange={event => { setReviewRunId(event.currentTarget.value); setReviewCheckpoint(null) }}>
              {active.runIndex.builtinRunIds.map((id, index) => <option key={id} value={id}>第 {index + 1} 次任务</option>)}
            </select></label>
            {reviewAPI?.checkpoint && <button type="button" disabled={checkpointBusy || busy} onClick={() => void readCheckpoint()}>
              {checkpointBusy ? '正在读取…' : '查看检查点'}</button>}
            {reviewAPI?.forkCheckpoint && <button type="button" disabled={checkpointBusy || busy} onClick={() => void forkFromCheckpoint()}>从此新建会话</button>}
            <button type="button" onClick={() => setReviewRunId(null)}>关闭审阅</button>
          </header>
          {reviewCheckpoint?.runId === reviewRunId && <p role="status">当前检查点：任务{checkpointStatusLabels[reviewCheckpoint.runStatus]}，
            关联内容 {reviewCheckpoint.contentVersions.length} 份。从此继续会创建新会话；文档内容需在变更审阅中另行选择回退。</p>}
          <ExecutionChangeReview key={`${active.conversationId}:${reviewRunId}`} runId={reviewRunId}
            loadPage={reviewLoader} rollback={reviewRollback} onLocateDocument={onLocateDocument} />
        </section>}
        {connectionFailure(run) && <div className="execution-assistant__submission-note" role="alert">
          <p>{connectionFailure(run)}</p>
          <button type="button" disabled={busy || !submissions.some(item => item.runId === run!.runId)} onClick={() => void submit('queue', undefined, run!)}>连接恢复后继续此任务</button>
        </div>}

        {submissions.filter(item => item.state !== 'accepted' && item.state !== 'cancelled').map(item => <article className={`execution-assistant__submission execution-assistant__submission--${item.state}`} key={item.submissionId} aria-label="待处理消息">
          <header><strong>{item.state === 'queued' ? `排队中${item.position ? ` · 第 ${item.position} 条` : ''}` : item.state === 'starting' ? '正在确认' : '未发送'}</strong>
            <small>{item.model.provider} · {item.model.model}</small></header>
          <p>{item.text || `附件 ${item.attachments.length} 个`}</p>
          {item.queuePausedReason === 'external-handoff' && <p className="execution-assistant__submission-note">外部交接后内置队列保持暂停；接回任务会先结束外部授权。
            <button type="button" disabled={busy} onClick={() => { void api?.resumeQueue({ workspaceId: item.workspaceId, conversationId: item.conversationId }).catch(cause => setError(String(cause))) }}>接回并继续排队任务</button></p>}
          {item.queuePausedReason === 'user' && <p className="execution-assistant__submission-note">后续任务已暂停，消息和草稿仍保留。
            <button type="button" disabled={busy} onClick={() => { void api?.resumeQueue({ workspaceId: item.workspaceId, conversationId: item.conversationId }).catch(cause => setError(String(cause))) }}>继续排队任务</button></p>}
          {item.failure && <p className="execution-assistant__submission-note">{item.failure.message}</p>}
          <div className="execution-assistant__submission-actions">
            {item.state === 'queued' && <button type="button" onClick={() => void runQueuedNow(item)} disabled={busy}>{item.queuePausedReason === 'external-handoff' ? '接回并立即执行' : '立即执行（先停止当前任务）'}</button>}
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
      {browserPanelOpen && api?.browserViewport && active && run?.status === 'running' && taskBrowser?.runId === run.runId && taskBrowser.pageUrl
        && !settingsOpen && !externalOpen && !pendingRestore && !openApproval && <div style={{ flexShrink: 0, height: 290, borderTop: '1px solid var(--border-color)' }}>
          <TaskBrowserViewport workspaceId={workspaceId} conversationId={active.conversationId} runId={run.runId}
            pageUrl={taskBrowser.pageUrl} viewport={api.browserViewport} onReady={setBrowserViewportReady} />
        </div>}
      <footer className="execution-assistant__composer">
        {Object.keys(documentReferenceIssues).length > 0 && <div className="execution-assistant__reference-notice" role="status">
          <p>{Object.entries(documentReferenceIssues).map(([id, issue]) => `${documentNames[id] ?? '原文档'}：${issue}`).join('；')}。文字和附件仍保留。</p>
          <div><button type="button" disabled={busy} onClick={() => void changeSelection(false)}>重新引用当前文档</button>
            <button type="button" disabled={busy} onClick={() => void changeSelection(true)}>重新引用当前选区</button></div>
        </div>}
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
            <textarea ref={composerRef} aria-label="给创作助手发消息" aria-describedby="assistant-composer-hint" data-attachment-paste-target value={draft} disabled={!active} readOnly={busy} placeholder="描述你要讨论或完成的内容"
              onFocus={() => { setPlusOpen(false); setPermissionOpen(false) }}
              onCompositionStart={() => { composingRef.current = true }} onCompositionEnd={() => { composingRef.current = false }} onKeyDown={onComposerKeyDown}
              onChange={event => { setDraft(event.target.value); draftRef.current = event.target.value; freezeDocuments(event.target.value) }} onBlur={() => { void persist().catch(failure => setError(failure instanceof Error ? failure.message : '草稿未保存，请重试。')) }} />
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
            {modelMenuOpen && createPortal(<div ref={modelMenuRef} id="assistant-model-choices" className={`execution-assistant__model-menu${!allModelsOpen && favoriteModelOptions.length === 0 ? ' execution-assistant__model-menu--empty' : ''}`} role="group" aria-label="对话模型选择"
              style={{ left: modelMenuPosition.left, bottom: modelMenuPosition.bottom, width: modelMenuPosition.width }}>
              <strong>下次任务使用</strong>
              {conversationSelection && <div className="execution-assistant__model-effort" role="group" aria-label="推理强度">
                <strong>{resolvedReasoning?.kind === 'toggle' ? '思考模式' : '推理强度'}</strong>
                {resolvedReasoning?.kind !== 'budget' && resolvedReasoning?.kind !== 'fixed' && <div>
                  <button type="button" aria-pressed={selectedEffort === undefined} disabled={busy} onClick={() => chooseEffort()}>默认</button>
                  {effortOptions.map(choice => <button type="button" key={choice.effort}
                    aria-pressed={selectedEffort === choice.effort} disabled={busy} title={'description' in choice && typeof choice.description === 'string' ? choice.description : undefined}
                    onClick={() => chooseEffort(choice.effort)}>{choice.label ?? effortLabels[choice.effort]}</button>)}
                </div>}
                {resolvedReasoning?.kind === 'fixed' && <small>该模型固定启用思考，没有可调档位。</small>}
                {resolvedReasoning?.format === 'anthropic-budget' && <ModelThinkingBudgetControl
                  key={`${conversationSelection.model}:${conversationSelection.capabilityModel ?? ''}`}
                  parameters={conversationSelection.parameters ?? {}} resolved={resolvedReasoning} disabled={busy}
                  onChange={parameters => void switchConversationModel({ ...conversationSelection, parameters }, true)} />}
                {resolvedReasoning?.kind === 'budget' && resolvedReasoning.format !== 'anthropic-budget'
                  && <small>该型号使用数值控制思考；当前连接的参数格式尚未识别。</small>}
                {effortSource === 'documented' && <small>模型文档补充；当前连接目录未声明，实际支持尚未验证。</small>}
                {effortSource === 'models.dev' && <small>根据型号资料提供选项；当前连接的实际执行以服务商为准。</small>}
                {effortSource === 'directory' && effortOptions.length === 0 && <small>此连接目录未提供可选强度，使用模型默认值。</small>}
                {reasoningToolsNeedResponses && <small>该模型上游的工具调用在此模式下要求 Responses；当前使用 Chat 兼容连接，中转兼容性需以实际服务为准。</small>}
                {effortSource === 'unknown' && <small>尚未识别这个型号。若供应商使用别名，可选择对应参考型号后直接设置思考。</small>}
                {(effortSource === 'unknown' || conversationSelection.capabilityModel) && <div className="execution-assistant__model-reference">
                  <ModelReferencePicker models={modelKnowledge} value={referenceModel ? knowledgeKey(referenceModel) : conversationSelection.capabilityModel ?? ''}
                    disabled={busy} onChange={chooseReferenceModel} />
                  <small>只用于识别能力；仍请求 {conversationSelection.model}，使用当前连接。</small>
                </div>}
                {knowledgeError && <small>{knowledgeError}</small>}
              </div>}
              <div className="execution-assistant__model-list" role="group" aria-label={allModelsOpen ? '全部连接与模型' : '收藏模型'}>
                {allModelsOpen ? <>
                  <input aria-label="搜索模型" value={modelQuery} onChange={event => setModelQuery(event.target.value)} placeholder="搜索模型或连接" />
                  {matchingModelGroups.map(group => {
                    const key = group.entry ? `${group.id}:${group.entry.connection.revision}` : undefined
                    const available = group.entry?.hasCredential && !group.entry.revoked
                    return <div className="execution-assistant__model-group" key={group.id} role="group" aria-label={`连接 ${group.label}`}>
                      <strong>{group.label}</strong>
                      {!available && <small>连接不可用</small>}
                      {group.options.map(modelChoice)}
                      {group.options.length === 0 && <p>{!available ? '该连接当前不可用。'
                        : key && !modelCatalogs[key] && !modelCatalogErrors[key] ? '正在读取模型目录…' : '暂无匹配的模型。'}</p>}
                      {key && modelCatalogErrors[key] && <div className="execution-assistant__catalog-error"><p>{modelCatalogErrors[key]}</p>
                        <button type="button" onClick={() => {
                          catalogRequested.current.delete(key)
                          setModelCatalogErrors(current => { const next = { ...current }; delete next[key]; return next })
                          setModelCatalogs(current => ({ ...current }))
                        }}>重试目录</button></div>}
                    </div>
                  })}
                  {matchingModelGroups.length === 0 && <p>{query ? '没有匹配的模型或连接。' : '还没有连接。可以接入 API 或登录 ChatGPT。'}</p>}
                </> : <>
                  <strong className="execution-assistant__model-list-heading">已收藏</strong>
                  {favoriteModelOptions.map(modelChoice)}
                  {favoriteModelOptions.length === 0 && <p>还没有收藏模型。点击“更多模型”，选择连接并收藏常用模型。</p>}
                </>}
              </div>
              {favoriteError && <p role="alert">{favoriteError}</p>}
              <button type="button" className="execution-assistant__more-models" onClick={() => { setAllModelsOpen(value => !value); setModelQuery('') }}>
                {allModelsOpen ? '返回收藏' : '更多模型'}</button>
              <p>{bodyStreamingLabel(bodyStreaming)}</p>
              <button type="button" className="execution-assistant__manage-models" onClick={() => { setModelMenuOpen(false); setSettingsEntry('chatgpt-oauth'); setSettingsOpen(true) }}>登录 ChatGPT（OAuth）…</button>
              <button type="button" className="execution-assistant__manage-models" onClick={() => { setModelMenuOpen(false); setSettingsEntry('default'); setSettingsOpen(true) }}>管理模型与连接…</button>
            </div>, document.body)}
          </div>
          <div className="execution-assistant__actions">
            {run && run.status === 'running' && api?.browserControl && taskBrowser?.runId === run.runId
              && taskBrowser.state !== 'stopped' && (taskBrowser.pageUrl || taskBrowser.state === 'human' || taskBrowser.state === 'transition')
              && <>{api.browserViewport && <button type="button" disabled={busy || taskBrowser.state === 'human' || taskBrowser.state === 'transition'}
                onClick={() => setBrowserPanelOpen(value => !value)}>{browserPanelOpen ? '收起任务网页' : '查看任务网页'}</button>}
              <button type="button" disabled={busy || taskBrowser.state === 'transition' || (taskBrowser.state !== 'human' && !!api.browserViewport && !browserViewportReady)} title={taskBrowser.pageUrl}
                onClick={() => void controlBrowser(taskBrowser.state === 'human' ? 'resume' : 'takeover')}>
                {taskBrowser.state === 'human' ? '完成操作，继续任务' : taskBrowser.state === 'transition' ? '正在切换浏览器…' : '接管当前网页'}</button></>}
            {run && ['queued', 'running', 'stopping'].includes(run.status) && <button type="button" onClick={() => void stop()} disabled={busy || run.status === 'stopping'}>{run.status === 'stopping' ? '正在停止…' : '停止当前'}</button>}
            {run?.status === 'running' && submissions.some(item => item.state === 'queued') && <button type="button" disabled={busy} onClick={() => void stop(true)}>停止并暂停后续</button>}
            <button type="button" className="primary-button" onClick={() => { composerRef.current?.focus(); void submit('queue') }} disabled={!active || busy || attachmentBusy || (!draft.trim() && attachments.length === 0)}>{run && ['queued', 'running', 'stopping'].includes(run.status) ? '加入队列' : '发送'}</button>
          </div>
        </div>
        <small id="assistant-composer-hint" className="execution-assistant__composer-hint">Enter 发送 · Shift + Enter 换行</small>
      </footer>
    </div>
    <ExecutionSettingsPanel open={settingsOpen} entry={settingsEntry} onClose={() => setSettingsOpen(false)} api={settingsAPI}
      onSaved={value => setSettings(value)} />
    <ConfirmDialog open={pendingRestore !== null} title="输入框已有另一份草稿" message="恢复这条消息会替换当前文字、附件和引用。可以先保留当前输入，原消息仍在历史中。"
      confirmLabel="替换为这条消息" cancelLabel="保留当前输入"
      details={pendingRestore && <pre className="execution-assistant__restore-preview">{pendingRestore.text || `附件 ${pendingRestore.attachments.length} 个`}</pre>}
      onCancel={cancelRestore}
      onConfirm={() => { if (pendingRestore) applyRestoredSubmission(pendingRestore) }} />
    {externalAPI && active && <ExternalMcpPanel open={externalOpen} onClose={() => setExternalOpen(false)} api={externalAPI}
      workspaceId={workspaceId} conversation={active} documents={documents} instruction={draft} documentNames={documentNames}
      onConversationChange={conversation => {
        setConversations(value => updateConversation(value, conversation)); setActive(conversation); activeRef.current = conversation
      }} />}
  </section>
})
