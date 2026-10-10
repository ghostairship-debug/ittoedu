import { useSyncExternalStore } from 'react'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { DocumentHostAPI } from '../../../shared/workbench/desktop'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { disclosedExecutionSettings, type ElementChangeView, type ElementRevertResult, type ExecutionDesktopAPI, type ExecutionSelectionTarget, type ExecutionSendInput, type ExecutionSendResult, type ExecutionSubmissionRecord } from '../../../shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent, type ExecutionProjection } from '../../../shared/workbench/executionEvents'
import { DEFAULT_PERMISSION_MODE, type ApprovalDecision, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { ExecutionSettingsAPI } from '../../../shared/workbench/executionSettingsDesktop'
import type { UserAnswer } from '../../../shared/workbench/userQuestion'
import { pendingApproval, pendingQuestion, type PendingApproval, type PendingQuestion } from '../executionTimelineModel'
import { captureSelection, selectionReference, workbenchSelection, type SelectionCapture } from '../SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { isExecutionInputError } from '../../../shared/workbench/executionInputMessages'

/**
 * Element AI cards (M15): every element has its own card with its requests and replies. A card is backed by an
 * unlisted conversation that Main clears when the document closes; requests to one element queue in that
 * conversation, different elements run side by side. A card's AI may change only its element.
 */
export type ElementCardEntryState = 'sending' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped' | 'cancelled'
export interface ElementCardEntry {
  submissionId: string
  text: string
  state: ElementCardEntryState
  runId?: string
  reply?: string
  failure?: string
  /** What the request changed on the object, once it ended (M15). */
  change?: ElementChangeView
  queuePausedReason?: ExecutionSubmissionRecord['queuePausedReason']
}
/** The request the card's undo (or redo) would take back (or repeat), and what it changed. */
export interface ElementCardStep { submissionId: string; fields: readonly string[] }
export interface ElementCardView {
  key: string
  /** An element's card lives while its document is open; a text card while it is open on screen. */
  kind: 'element' | 'text'
  /** Unsent cards may be folded without ending their conversation or discarding input. */
  dismissed: boolean
  /** Where a text card floats (viewport coordinates). */
  anchor: { left: number; top: number } | null
  /** Why a text card cannot send again: its text is no longer where the card left it. */
  textLost: string | null
  documentId: string
  workspaceId: string | null
  epoch?: string
  label: string
  target: ExecutionSelectionTarget
  entries: readonly ElementCardEntry[]
  /** Something is queued or running. */
  busy: boolean
  question: PendingQuestion | null
  approval: PendingApproval | null
  error: string
  draft: string
  closing: boolean
  unconfirmed: boolean
  undo: ElementCardStep | null
  redo: ElementCardStep | null
  projection: ExecutionProjection
  /** Why the latest request cannot be undone in the card (components and Runtime); the editor's undo still can. */
  undoUnavailable: string | null
}
export interface ElementCardPorts {
  execution(): ExecutionDesktopAPI | undefined
  settings(): ExecutionSettingsAPI | undefined
  documents?(): Pick<DocumentHostAPI, 'subscribe'> | undefined
  /** The document as it is now, for a text card's next request. */
  snapshot?(documentId: string): Promise<DocumentSnapshot>
}

interface PendingSend { cancelled: boolean; invoked: boolean; request?: ExecutionSendInput; done: Promise<void>; settle(): void }
interface CardRecord {
  key: string
  kind: 'element' | 'text'
  anchor: { left: number; top: number } | null
  /** A text card: what its range held after the last request (undefined before the first check, null once lost). */
  content?: string | null
  capture?: SelectionCapture
  contentOutput?: ExecutionSendInput['contentOutput']
  dismissed?: boolean
  documentId: string
  label: string
  target: ExecutionSelectionTarget
  workspaceId: string | null
  conversation: ConversationRecord | null
  entries: ElementCardEntry[]
  /** Requests before an explicit re-selection must never restore that older selection. */
  textStart: number
  projection: ExecutionProjection
  error: string
  draft: string
  closing: boolean
  unconfirmed?: ExecutionSendInput
  sends: Map<string, PendingSend>
  sending: Promise<void>
  catchUp: Promise<void>
  catchingUp?: boolean
  catchUpPending?: boolean
  refreshTicket?: number
}

/** One card per element: an object, or a document block, of one document. */
export function elementCardKey(documentId: string, target: ExecutionSelectionTarget): string {
  if (target.kind === 'course-instance') return `${documentId}:instance:${target.instanceId}:state:${target.stateId ?? ''}${target.dataPath ? `:${target.fieldScope ?? 'data'}:${JSON.stringify(target.dataPath)}` : ''}`
  if (target.kind === 'course-object') return `${documentId}:object:${target.itemId}${target.compositionNodeId ? `:composition:${target.compositionNodeId}` : ''}`
  if (target.kind === 'flow-block') return `${documentId}:block:${target.surfaceId}:${target.blockId}`
  throw new Error('元素 AI 卡只针对对象或文档块。')
}

/** Undo takes back the latest applied request; redo repeats the earliest undone one after it. */
function steps(entries: readonly ElementCardEntry[]): Pick<ElementCardView, 'undo' | 'redo' | 'undoUnavailable'> {
  let lastApplied = -1, latest: ElementCardEntry | undefined
  entries.forEach((entry, index) => {
    if (entry.change?.state === 'applied') lastApplied = index
    if (entry.change && entry.change.state !== 'pending') latest = entry
  })
  const undone = entries.find((entry, index) => index > lastApplied && entry.change?.state === 'undone')
  const step = (entry: ElementCardEntry | undefined) => entry?.change ? { submissionId: entry.submissionId, fields: entry.change.fields } : null
  return { undo: step(entries[lastApplied]), redo: step(undone), undoUnavailable: latest?.change?.unavailable ?? null }
}
/**
 * A request's reply: what the conversation records, or, until Main has recorded it there (just after the run ends),
 * the last text its run showed.
 */
const TERMINAL: ReadonlySet<ElementCardEntryState> = new Set(['completed', 'partial', 'failed', 'stopped', 'cancelled'])
const TEXT_LOST = '这段文字已找不到，请重新选中后再打开 AI 卡。'

const RUN_STATE: Partial<Record<ExecutionRunRecord['status'], ElementCardEntryState>> = {
  queued: 'running', running: 'running', stopping: 'running', completed: 'completed', partial: 'partial',
  failed: 'failed', interrupted: 'failed', stopped: 'stopped',
}

export class ElementCardController {
  private readonly cards = new Map<string, CardRecord>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private workspace: { workspaceId: string } | null = null
  private permission: ExecutionPermissionMode = DEFAULT_PERMISSION_MODE
  private events: { api: ExecutionDesktopAPI; stop(): void } | null = null
  private documents: { api: Pick<DocumentHostAPI, 'subscribe'>; stop(): void } | null = null
  private views = new Map<string, ElementCardView>()
  private readonly openRequests = new Set<string>()
  private readonly captures = new Map<string, () => Promise<SelectionCapture>>()
  private preserving?: Promise<void>
  private focus: { documentId: string | null; surfaceId: string | null } = { documentId: null, surfaceId: null }

  constructor(private readonly ports: ElementCardPorts) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readVersion = () => this.version
  private notify() { this.version += 1; this.views.clear(); for (const listener of this.listeners) listener() }

  /** The space the cards' conversations belong to and the permission level the assistant shows (the same for cards). */
  setWorkspace(workspaceId: string | null) { if (this.workspace?.workspaceId === workspaceId) return; this.workspace = workspaceId ? { workspaceId } : null; this.notify() }
  setFocus(documentId: string | null, surfaceId: string | null) {
    if (this.focus.documentId === documentId && this.focus.surfaceId === surfaceId) return
    this.focus = { documentId, surfaceId }; this.notify()
  }
  inFocus(card: ElementCardView) {
    const target = card.target
    const surfaceId = 'surfaceId' in target ? target.surfaceId : target.kind === 'course-object' ? target.locationId : null
    return (!card.workspaceId || card.workspaceId === this.workspace?.workspaceId)
      && (this.focus.documentId === null || this.focus.documentId === card.documentId)
      && (!surfaceId || !this.focus.surfaceId || surfaceId === this.focus.surfaceId)
  }
  setPermission(mode: ExecutionPermissionMode) { this.permission = mode }

  view(key: string): ElementCardView | null {
    const card = this.cards.get(key)
    if (!card) return null
    const cached = this.views.get(key)
    if (cached) return cached
    const view: ElementCardView = {
      key, kind: card.kind, dismissed: Boolean(card.dismissed), anchor: card.anchor, textLost: card.kind === 'text' && card.content === null ? TEXT_LOST : null, documentId: card.documentId, workspaceId: card.workspaceId, epoch: card.capture?.epoch, label: card.label, target: card.target,
      entries: card.entries, projection: card.projection,
      busy: Boolean(card.sends.size || card.closing || card.unconfirmed || card.entries.some(entry => entry.state === 'sending' || entry.state === 'queued' || entry.state === 'running')),
      question: pendingQuestion(card.projection), approval: pendingApproval(card.projection), error: card.error, draft: card.draft, closing: card.closing, unconfirmed: Boolean(card.unconfirmed), ...steps(card.entries),
    }
    this.views.set(key, view)
    return view
  }
  /** Element cards with work to show in the top bar: running, or waiting for an answer or an approval. */
  active(): ElementCardView[] {
    return [...this.cards.keys()].map(key => this.view(key)!).filter(view => view.kind === 'element' && (view.busy || view.question || view.approval))
  }
  texts(): ElementCardView[] { return [...this.cards.keys()].map(key => this.view(key)!).filter(view => view.kind === 'text') }
  visible(): ElementCardView[] { return [...this.cards.keys()].map(key => this.view(key)!).filter(view => (!view.dismissed || view.draft.trim()) && this.inFocus(view)) }
  reveal(key: string) { const card = this.cards.get(key); if (card) { card.dismissed = false; this.notify() } }
  registerCapture(key: string, capture?: () => Promise<SelectionCapture>) { if (capture) this.captures.set(key, capture); else this.captures.delete(key) }
  async captureCurrent(key: string) {
    const registered = this.captures.get(key); if (registered) return registered()
    const card = this.cards.get(key), snapshot = card && await this.ports.snapshot?.(card.documentId)
    if (!card || !snapshot) throw new Error('原文档尚未就绪，请重新打开目标后发送。')
    return captureSelection(snapshot, [card.target], card.label)
  }
  dismiss(key: string) {
    const card = this.cards.get(key), view = this.view(key)
    if (!card || !view || view.busy || view.question || view.approval) return
    card.dismissed = true; this.notify(); void this.flushDrafts().catch(error => { card.error = String(error); this.notify() })
  }

  /** Opens (or finds) the card of an element; its label and place follow the element. Call it outside rendering. */
  ensure(input: { documentId: string; target: ExecutionSelectionTarget; label: string }): string {
    const key = elementCardKey(input.documentId, input.target)
    const card = this.cards.get(key)
    if (card) {
      if (card.label !== input.label || JSON.stringify(card.target) !== JSON.stringify(input.target)) {
        card.label = input.label; card.target = structuredClone(input.target); this.notify()
      }
      return key
    }
    this.cards.set(key, { key, kind: 'element', anchor: null, dismissed: true, documentId: input.documentId, label: input.label, target: structuredClone(input.target), workspaceId: this.workspace?.workspaceId ?? null,
      conversation: null, entries: [], textStart: 0, projection: emptyExecutionProjection(''), error: '', draft: '', closing: false, sends: new Map(), sending: Promise.resolve(), catchUp: Promise.resolve() })
    this.observeDocuments()
    this.notify()
    return key
  }
  /** A folded text card has the same document lifetime as an element card. */
  private observeDocuments() {
    const documents = this.ports.documents?.()
    if (documents && this.documents?.api !== documents) {
      this.documents?.stop()
      this.documents = { api: documents, stop: documents.subscribe(event => { if (event.type === 'closed') this.forgetDocument(event.documentId) }) }
    }
  }

  /**
   * Opens a card from the input owner's confirmed capture. Existing submitted cards keep their controls;
   * an unsent card folds and keeps its draft in the same record.
   */
  openText(input: { documentId: string; target: ExecutionSelectionTarget; capture: SelectionCapture;
    contentOutput?: ExecutionSendInput['contentOutput']; label: string; anchor: { left: number; top: number }; content: string | null }): string {
    for (const card of [...this.cards.values()]) if (card.kind === 'text') this.dismissText(card.key)
    const key = `${input.documentId}:text:${crypto.randomUUID()}`
    this.cards.set(key, { key, kind: 'text', anchor: input.anchor, content: input.content ?? undefined, documentId: input.documentId, label: input.label,
      target: structuredClone(input.target), capture: structuredClone(input.capture), contentOutput: structuredClone(input.contentOutput), workspaceId: this.workspace?.workspaceId ?? null, conversation: null, entries: [], textStart: 0, projection: emptyExecutionProjection(''), error: '', draft: '', closing: false, sends: new Map(), sending: Promise.resolve(), catchUp: Promise.resolve() })
    this.observeDocuments()
    this.notify()
    return key
  }
  /** Explicit user re-selection keeps this card's draft and conversation while replacing only its live text target. */
  rebindText(key: string, input: { documentId: string; target: ExecutionSelectionTarget; capture: SelectionCapture;
    contentOutput?: ExecutionSendInput['contentOutput']; label: string;
    anchor: { left: number; top: number }; content: string | null }): void {
    const card = this.cards.get(key)
    if (!card || card.kind !== 'text') throw new Error('原文字卡已关闭，请重新打开。')
    if (card.documentId !== input.documentId) throw new Error('只能在原文档中重新选择文字。')
    if (card.entries.some(entry => entry.state === 'sending' || entry.state === 'queued' || entry.state === 'running')
      || pendingQuestion(card.projection) || pendingApproval(card.projection)) throw new Error('当前请求尚未结束，请稍后重新选择。')
    if (input.content === null) throw new Error('新选区内容无法确认，请重新选中后再试。')
    card.target = structuredClone(input.target)
    card.capture = structuredClone(input.capture)
    card.contentOutput = structuredClone(input.contentOutput)
    card.dismissed = false
    card.content = input.content
    card.label = input.label
    card.anchor = { ...input.anchor }
    card.textStart = card.entries.length
    card.error = ''
    this.notify()
  }
  /** Folding is only for an unsent card; submitted work keeps its controls visible. */
  dismissText(key: string): void {
    const card = this.cards.get(key)
    if (!card || card.kind !== 'text') return
    this.dismiss(key)
  }
  revealText(key: string, anchor: { left: number; top: number }): void {
    const card = this.cards.get(key)
    if (!card || card.kind !== 'text') return
    card.dismissed = false; card.anchor = { ...anchor }; this.notify()
  }
  matchesTextCapture(key: string, capture: SelectionCapture): boolean {
    const card = this.cards.get(key), original = card?.capture
    return Boolean(original && original.documentId === capture.documentId && original.epoch === capture.epoch
      && original.revision === capture.revision && JSON.stringify(original.targets) === JSON.stringify(capture.targets))
  }
  setDraft(key: string, draft: string): void {
    const card = this.cards.get(key)
    if (card) { card.draft = draft; this.notify() }
  }
  /** Window exit preserves unsent input in the existing conversation store, without sending or clearing it. */
  flushDrafts(): Promise<void> {
    if (this.preserving) return this.preserving
    const work = Promise.allSettled([...this.cards.values()].map(async card => {
      await card.sending
      if (this.cards.get(card.key) !== card || card.closing || !card.draft && !card.conversation?.inputDraft) return
      const api = this.ports.execution(), workspaceId = card.workspaceId ?? this.workspace?.workspaceId
      if (!api || !workspaceId) throw new Error('AI 卡草稿尚未保存：执行服务或工作空间尚未就绪。')
      if (!card.conversation) {
        card.conversation = await api.createConversation(workspaceId, card.label, undefined,
          { kind: 'element', documentId: card.documentId, label: card.label })
        card.workspaceId = workspaceId
        card.projection = emptyExecutionProjection(card.conversation.conversationId); this.listen(api)
      }
      const snapshot = card.draft && !card.capture ? await this.ports.snapshot?.(card.documentId) : undefined
      const capture = card.capture ?? (snapshot ? { documentId: card.documentId, epoch: snapshot.epoch,
        revision: snapshot.revision, targets: [structuredClone(card.target)], label: card.label } : undefined)
      const documents = capture ? [selectionReference(capture, this.permission !== 'read-only')] : []
      for (let attempt = 0; ; attempt++) {
        const current = await api.conversation(workspaceId, card.conversation.conversationId) ?? card.conversation
        const sameContext = current.frozenContextRefs.length === documents.length && current.frozenContextRefs.every((ref, index) => {
          const document = documents[index]!
          return ref.documentId === document.documentId && ref.epoch === document.epoch && ref.revision === document.revision
            && JSON.stringify(ref.selection) === JSON.stringify(document.selection) && JSON.stringify(ref.writeScope) === JSON.stringify(document.writable)
        })
        if (current.inputDraft === card.draft && sameContext) {
          card.conversation = current; return
        }
        try {
          card.conversation = await api.draft({ workspaceId, conversationId: current.conversationId,
            expectedRevision: current.revision, text: card.draft, documents, attachments: [] })
          if (card.conversation.inputDraft === card.draft) return
        } catch (error) {
          if (!isExecutionInputError(error, 'conversation-draft-changed') || attempt >= 3) throw error
        }
      }
    })).then(results => { for (const result of results) if (result.status === 'rejected') throw result.reason })
    this.preserving = work.finally(() => { this.preserving = undefined })
    return this.preserving
  }
  private cancelPreparing(card: CardRecord): void {
    for (const [id, pending] of card.sends) {
      pending.cancelled = true
      if (!pending.invoked) this.patchEntry(card, id, { state: 'cancelled' }, false)
    }
    this.notify()
  }
  private async deleteCardConversation(card: CardRecord): Promise<void> {
    const api = this.ports.execution(), conversation = card.conversation
    if (!api || !conversation) return
    const latest = await api.conversation(conversation.workspaceId, conversation.conversationId)
    if (latest) await api.deleteConversation({ workspaceId: latest.workspaceId, conversationId: latest.conversationId, expectedRevision: latest.revision })
  }
  /** Preparation can be cancelled immediately; an invoked request keeps its control until settled. */
  async closeText(key: string): Promise<void> {
    const card = this.cards.get(key)
    if (card?.kind !== 'text') return
    card.closing = true; this.cancelPreparing(card)
    const invoked = [...card.sends.values()].some(value => value.invoked)
    if (!invoked && !card.conversation && !this.preserving) { this.cards.delete(key); this.notify(); return }
    try {
      await this.preserving
      await Promise.all([...card.sends.values()].map(value => value.done))
      if (card.unconfirmed) throw new Error('发送结果尚未确认，请先核对原提交再关闭。')
      await this.deleteCardConversation(card)
      if (this.cards.get(key) === card) this.cards.delete(key)
      this.notify()
    } catch (error) {
      card.closing = false
      card.error = error instanceof Error ? error.message : '关闭尚未完成，请重试；任务入口保留。'
      this.notify(); throw error
    }
  }

  /** All asynchronous preparation stays inside the card's cancellation lifetime. */
  async send(key: string, instruction: string, selected?: SelectionCapture | (() => Promise<SelectionCapture>)): Promise<void> {
    const card = this.cards.get(key), text = instruction.trim(), api = this.ports.execution()
    const workspaceId = card?.workspaceId ?? this.workspace?.workspaceId
    if (!card || !text) return
    if (card.closing) throw new Error('这张卡正在关闭。')
    if (card.unconfirmed) throw new Error('请先核对上次发送结果；原请求和输入仍保留。')
    if (!api || !workspaceId) throw new Error('AI 执行服务或工作空间尚未就绪。')
    card.workspaceId = workspaceId
    if (card.kind === 'text' && this.view(key)?.busy) throw new Error('请等 AI 改完这一次再继续追问。')
    const submissionId = crypto.randomUUID(), previous = card.sending, permission = this.permission
    let settle!: () => void
    const done = new Promise<void>(resolve => { settle = resolve })
    const pending: PendingSend = { cancelled: false, invoked: false, done, settle }
    card.sends.set(submissionId, pending); card.sending = done
    card.entries = [...card.entries, { submissionId, text, state: 'sending' }]; card.error = ''; this.notify()
    const alive = () => {
      if (this.cards.get(key) !== card || card.closing || pending.cancelled) throw new Error('发送已取消；未发送的输入保留。')
    }
    // Capture now, before another send finishes. Queuing and subsequent browsing never retarget this request.
    const prepared = (async (): Promise<(SelectionCapture & { contentOutput?: ExecutionSendInput['contentOutput'] }) | undefined> => card.kind === 'text' ? this.textCapture(card)
      : typeof selected === 'function' ? selected() : selected)()
      .then(capture => ({ capture }), error => ({ error }))
    try {
      await previous; alive()
      const preparation = await prepared
      if ('error' in preparation) throw preparation.error
      const capture = preparation.capture
      alive()
      if (!capture || capture.documentId !== card.documentId || capture.targets.length !== 1
        || card.kind === 'element' && elementCardKey(capture.documentId, capture.targets[0]!) !== key)
        throw new Error('选中的对象已改变，请重新选择后发送。')
      const settings = await this.ports.settings()?.read(); alive()
      const role = settings?.profile.roles.conversation
      const connection = settings?.connections.find(value => value.connection.id === role?.connectionId)
      if (!settings || !role || !connection?.hasCredential || connection.revoked) throw new Error('尚未配置可用的对话模型。请先在模型设置中选择连接、模型和账号。')
      card.target = structuredClone(capture.targets[0]!)
      card.capture = structuredClone(capture)
      let current = card.conversation
      if (!current) {
        current = await api.createConversation(workspaceId, card.label, undefined, { kind: 'element', documentId: card.documentId, label: card.label })
        card.conversation = current
        card.projection = emptyExecutionProjection(current.conversationId); this.listen(api); alive()
      }
      const contentOutput = card.kind === 'text' ? capture.contentOutput : undefined
      const request = { workspaceId, conversationId: current.conversationId, submissionId, text,
        documents: [selectionReference(capture, permission !== 'read-only')], attachments: [], mode: 'queue' as const,
        ...(contentOutput ? { contentOutput } : {}),
        permission, disclosedSettings: disclosedExecutionSettings(settings) }
      let result: ExecutionSendResult
      for (let attempt = 0; ; attempt++) {
        current = await api.conversation(current.workspaceId, current.conversationId) ?? current; alive()
        try { pending.request = { ...request, expectedRevision: current.revision }; pending.invoked = true; result = await api.send(pending.request); break }
        catch (error) {
          // Known draft-CAS rejection happened before a task was accepted.
          if (!isExecutionInputError(error, 'conversation-draft-changed') || attempt >= 3) throw error
          pending.invoked = false; alive()
        }
      }
      card.conversation = result.conversation
      this.applySubmission(card, result.submission, result.run)
      if (pending.cancelled && !card.closing) {
        if (result.submission.runId) await api.stop(result.submission.runId)
        else if (result.submission.state === 'queued') this.applySubmission(card, await api.deleteSubmission(request))
      }
      if (card.draft.trim() === text && result.submission.state !== 'failed') card.draft = ''
      this.notify()
    } catch (error) {
      // A lost send ACK is queried with the original submission identity, never resent with a new one.
      const current = card.conversation
      const known = pending.invoked && current && api.submission
        ? await api.submission({ workspaceId: current.workspaceId, conversationId: current.conversationId, submissionId }).catch(() => null) : null
      if (known) {
        this.applySubmission(card, known, known.runId ? await api.run(known.runId).catch(() => null) : undefined)
        if (pending.cancelled && !card.closing) {
          if (known.runId) await api.stop(known.runId)
          else if (known.state === 'queued') this.applySubmission(card, await api.deleteSubmission({ workspaceId: known.workspaceId, conversationId: known.conversationId, submissionId }))
        }
        if (known.state !== 'failed' && card.draft.trim() === text) card.draft = ''
        this.notify(); return
      }
      if (pending.invoked && pending.request) card.unconfirmed = pending.request
      this.patchEntry(card, submissionId, { state: pending.cancelled && !pending.invoked ? 'cancelled' : 'failed',
        failure: pending.invoked ? '发送结果尚未确认；请核对原提交，勿重复发送。' : error instanceof Error ? error.message : '请求没有发送。' })
      throw error
    } finally {
      card.sends.delete(submissionId); settle(); this.notify()
      // The document/card can close during createConversation. It may leave an empty conversation, never an orphan run.
      if (this.cards.get(key) !== card && card.conversation) void this.deleteCardConversation(card).catch(() => undefined)
    }
  }

  /** User-requested confirmation reuses the original idempotent submission, including a lost ACK. */
  async confirmSend(key: string): Promise<void> {
    const card = this.cards.get(key), api = this.ports.execution(), request = card?.unconfirmed
    if (!card || !api || !request) return
    if (card.closing) throw new Error('卡片正在关闭，请等待。')
    card.error = ''; this.notify()
    try {
      const known = await api.submission(request)
      if (known) this.applySubmission(card, known, known.runId ? await api.run(known.runId) : undefined)
      else {
        // Main either finds the existing acceptance or accepts the original payload once.
        const result = await api.send(request)
        card.conversation = result.conversation; this.applySubmission(card, result.submission, result.run)
      }
      if (card.unconfirmed === request) card.unconfirmed = undefined
      if (card.draft.trim() === request.text) card.draft = ''
      this.notify()
    } catch (error) {
      if (isExecutionInputError(error, 'conversation-draft-changed')) card.unconfirmed = undefined
      card.error = error instanceof Error ? error.message : '原发送仍未确认，请稍后核对。'; this.notify(); throw error
    }
  }

  /** A text card's range as it is now; refused while a request runs or when the text is no longer where the card left it. */
  private async textCapture(card: CardRecord): Promise<SelectionCapture & { contentOutput?: ExecutionSendInput['contentOutput'] }> {
    const latest = this.latestTextEntry(card), api = this.ports.execution()
    if (latest && api?.elementChange) {
      const start = card.textStart, change = await api.elementChange(latest.submissionId)
      if (start === card.textStart && this.latestTextEntry(card)?.submissionId === latest.submissionId) {
        this.followText(card, change); this.patchEntry(card, latest.submissionId, { change })
      }
    }
    if (card.content === null) throw new Error(TEXT_LOST)
    const snapshot = await this.ports.snapshot?.(card.documentId)
    if (!snapshot) throw new Error('文档尚未就绪，请稍后再发送。')
    const capture = card.capture
    if (!capture || snapshot.epoch !== capture.epoch) throw new Error('原文档身份已改变，请重新选中文字后再发送。')
    // The input owner has drained above. Offsets remain tied to the captured revision; Main maps them through
    // that Session's commits. Equal text at today's old offset is not proof of the original selection.
    return { ...structuredClone(capture), ...(card.contentOutput ? { contentOutput: structuredClone(card.contentOutput) } : {}) }
  }
  /** A text card follows its text: each ended request, undo or redo says where it is now. */
  private followText(card: CardRecord, change: ElementChangeView) {
    if (card.kind !== 'text' || change.state === 'pending') return
    if (!change.unavailable && change.target && change.content !== undefined && change.epoch !== undefined && change.revision !== undefined) {
      card.target = structuredClone(change.target); card.content = change.content
      card.capture = { documentId: card.documentId, epoch: change.epoch, revision: change.revision,
        targets: [structuredClone(change.target)], label: card.label }
      if (card.contentOutput) card.contentOutput = { ...card.contentOutput, target: structuredClone(change.target) as typeof card.contentOutput.target }
    }
    else card.content = null
  }
  private latestTextEntry(card: CardRecord): ElementCardEntry | undefined {
    return [...card.entries.slice(card.textStart)].reverse().find(entry => entry.runId && TERMINAL.has(entry.state))
  }

  async answer(key: string, runId: string, callId: string, answer: UserAnswer): Promise<void> {
    const api = this.ports.execution()
    if (!api?.answer) throw new Error('当前版本不能在卡片中回答。')
    const question = this.view(key)?.question?.question
    const currentDraft = question?.currentDraft ? await workbenchSelection.prepareQuestion(question) : undefined
    await api.answer({ runId, callId, answer, ...(currentDraft ? { currentDraft } : {}) })
    this.refresh(key)
  }
  async approve(key: string, runId: string, callId: string, decision: ApprovalDecision): Promise<void> {
    const api = this.ports.execution()
    if (!api?.approve) throw new Error('当前版本不能在卡片中批准。')
    await api.approve({ runId, callId, decision })
    this.refresh(key)
  }
  /**
   * Undoes or redoes one request on the object as one ordinary edit. A `conflict` names the fields changed again
   * since; nothing was written, and `force` overwrites them.
   */
  async revert(key: string, submissionId: string, direction: 'undo' | 'redo', force = false): Promise<ElementRevertResult> {
    const api = this.ports.execution(), card = this.cards.get(key)
    if (!api?.revertElement || !card) throw new Error('当前版本不能在卡片中撤销。')
    const result = await api.revertElement({ submissionId, direction, ...(force ? { force } : {}) })
    if (result.status === 'applied') {
      if (card.entries.findIndex(entry => entry.submissionId === submissionId) >= card.textStart) this.followText(card, result.change)
      this.patchEntry(card, submissionId, { change: result.change })
    }
    return result
  }
  /** Stops the element's running request; queued ones stay. */
  async stop(key: string, pauseFollowing = false): Promise<void> {
    const api = this.ports.execution(), card = this.cards.get(key)
    if (!api || !card) return
    if (pauseFollowing && card.conversation) {
      await api.pauseQueue({ workspaceId: card.conversation.workspaceId, conversationId: card.conversation.conversationId, reason: 'user' })
      this.cancelPreparing(card)
    }
    const running = card.entries.find(entry => entry.state === 'running' && entry.runId)
    if (running?.runId) { await api.stop(running.runId); this.refresh(key); return }
    if (pauseFollowing) { this.refresh(key); return }
    if (card.sends.size) { this.cancelPreparing(card); return }
    const queued = card.entries.find(entry => entry.state === 'queued')
    if (queued && card.conversation) this.applySubmission(card, await api.deleteSubmission({ workspaceId: card.conversation.workspaceId,
      conversationId: card.conversation.conversationId, submissionId: queued.submissionId }))
  }

  async resumeQueue(key: string): Promise<void> {
    const api = this.ports.execution(), card = this.cards.get(key)
    if (!api || !card?.conversation) return
    await api.resumeQueue({ workspaceId: card.conversation.workspaceId, conversationId: card.conversation.conversationId })
    this.refresh(key)
  }

  /** The top bar asks for a card to be shown when its element's quick bar appears (a jump to it). */
  requestOpen(key: string) { this.openRequests.add(key); this.notify() }
  /** One-shot: true once after a request, for the button that shows the card. */
  takeOpenRequest(key: string): boolean { return this.openRequests.delete(key) }

  /** The document closed: Main clears its cards' conversations; nothing of them stays here either. */
  forgetDocument(documentId: string) {
    let changed = false
    for (const [key, card] of this.cards) if (card.documentId === documentId) { this.cancelPreparing(card); this.cards.delete(key); changed = true }
    if (changed) this.notify()
  }

  private listen(api: ExecutionDesktopAPI) {
    if (this.events?.api === api) return
    this.events?.stop()
    this.events = { api, stop: api.subscribe(event => this.onEvent(event)) }
  }
  private cardFor(conversationId: string): CardRecord | undefined {
    for (const card of this.cards.values()) if (card.conversation?.conversationId === conversationId) return card
    return undefined
  }
  private onEvent(event: ExecutionEvent) {
    const card = this.cardFor(event.conversationId)
    if (!card) return
    this.catchUp(card)
    if (event.type === 'run.state' || event.type === 'run.end') this.refresh(card.key, event.runId)
  }
  /** Folds the conversation's new events into the card, one page after another. */
  private catchUp(card: CardRecord) {
    const api = this.ports.execution(), conversationId = card.conversation?.conversationId
    if (!api || !conversationId) return
    card.catchUpPending = true
    if (card.catchingUp) return
    card.catchingUp = true
    card.catchUp = (async () => {
      while (card.catchUpPending && this.cards.get(card.key) === card) {
        card.catchUpPending = false
        for (;;) {
        const page = await api.events(conversationId, card.projection.cursor, 5000)
        if (this.cards.get(card.key) !== card || card.conversation?.conversationId !== conversationId) return
        card.projection = foldExecutionEvents(card.projection, page.events)
        if (!page.hasMore) break
        }
      }
      this.notify()
    })().catch(() => { card.error = '任务过程暂不可读取，已有内容保留。'; this.notify() }).finally(() => { card.catchingUp = false; if (card.catchUpPending) this.catchUp(card) })
  }
  /** Re-reads the card's submissions, runs and replies after a run changed. */
  private refresh(key: string, changedRunId?: string) {
    const api = this.ports.execution(), card = this.cards.get(key)
    const conversation = card?.conversation
    if (!api || !card || !conversation) return
    const ticket = (card.refreshTicket ?? 0) + 1; card.refreshTicket = ticket
    void (async () => {
      const [submissions, latest] = await Promise.all([
        api.submissions({ workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }),
        api.conversation(conversation.workspaceId, conversation.conversationId),
      ])
      if (this.cards.get(key) !== card || card.refreshTicket !== ticket || card.conversation?.conversationId !== conversation.conversationId) return
      if (latest && latest.revision >= card.conversation.revision) card.conversation = latest
      for (const submission of submissions) {
        const previous = card.entries.find(entry => entry.submissionId === submission.submissionId)
        if (changedRunId && submission.runId !== changedRunId && previous) continue
        const run = submission.runId ? await api.run(submission.runId) : null
        if (this.cards.get(key) !== card || card.refreshTicket !== ticket) return
        this.applySubmission(card, submission, run ?? undefined, false)
      }
      this.notify()
      await this.readChanges(card)
    })().catch(() => undefined)
  }
  /** Asks Main what each ended request changed; Main records it just after the run ends, so a pending answer is asked again. */
  private async readChanges(card: CardRecord, attempt = 0): Promise<void> {
    const api = this.ports.execution()
    if (!api?.elementChange) return
    let pending = false
    for (const entry of card.entries) {
      if (!TERMINAL.has(entry.state) || entry.change && entry.change.state !== 'pending') continue
      const change = await api.elementChange(entry.submissionId)
      pending ||= change.state === 'pending'
      if (this.latestTextEntry(card)?.submissionId === entry.submissionId) this.followText(card, change)
      this.patchEntry(card, entry.submissionId, { change }, false)
    }
    this.notify()
    if (pending && attempt < 20 && this.cards.get(card.key) === card) setTimeout(() => { void this.readChanges(card, attempt + 1).catch(() => undefined) }, 150)
  }
  private applySubmission(card: CardRecord, submission: ExecutionSubmissionRecord, run?: ExecutionRunRecord | null, notify = true) {
    const state: ElementCardEntryState = submission.state === 'failed' ? 'failed' : submission.state === 'cancelled' ? 'cancelled'
      : submission.state === 'queued' || submission.state === 'starting' ? 'queued'
        : run ? RUN_STATE[run.status] ?? 'running' : 'running'
    const reply = run && card.conversation?.messages.find(message => message.role === 'assistant' && message.runId === run.runId)?.text
    this.patchEntry(card, submission.submissionId, {
      state, queuePausedReason: submission.queuePausedReason, ...(submission.runId ? { runId: submission.runId } : {}), ...(reply ? { reply } : {}),
      ...(submission.failure ? { failure: submission.failure.message } : run?.failure ? { failure: run.failure.message } : {}),
    }, notify)
  }
  private patchEntry(card: CardRecord, submissionId: string, patch: Partial<ElementCardEntry>, notify = true) {
    card.entries = card.entries.map(entry => entry.submissionId === submissionId ? { ...entry, ...patch,
      ...(TERMINAL.has(entry.state) && patch.state && ['sending', 'queued', 'running'].includes(patch.state) ? { state: entry.state } : {}),
    } : entry)
    if (notify) this.notify()
  }
}

export const elementCards = new ElementCardController({
  execution: () => window.desktopAPI?.execution,
  settings: () => window.desktopAPI?.executionSettings,
  documents: () => window.desktopAPI?.documents,
  snapshot: documentId => workbenchSelection.prepare(documentId),
})
/** The open text cards, for the layer that floats them. */
export function useTextCards(): ElementCardView[] {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return elementCards.texts()
}
export function useVisibleCards(): ElementCardView[] {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return elementCards.visible()
}

export function useElementCard(key: string | null): ElementCardView | null {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return key ? elementCards.view(key) : null
}
export function useActiveElementCards(): ElementCardView[] {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return elementCards.active()
}
