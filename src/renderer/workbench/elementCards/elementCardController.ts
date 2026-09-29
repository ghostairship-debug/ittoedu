import { useSyncExternalStore } from 'react'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { DocumentHostAPI } from '../../../shared/workbench/desktop'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { disclosedExecutionSettings, type ElementChangeView, type ElementRevertResult, type ExecutionDesktopAPI, type ExecutionSelectionTarget, type ExecutionSendResult, type ExecutionSubmissionRecord } from '../../../shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent, type ExecutionProjection } from '../../../shared/workbench/executionEvents'
import { DEFAULT_PERMISSION_MODE, type ApprovalDecision, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { ExecutionSettingsAPI } from '../../../shared/workbench/executionSettingsDesktop'
import type { UserAnswer } from '../../../shared/workbench/userQuestion'
import { pendingApproval, pendingQuestion, type PendingApproval, type PendingQuestion } from '../executionTimelineModel'
import { selectionReference, workbenchSelection, type SelectionCapture } from '../SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { isExecutionInputError } from '../../../shared/workbench/executionInputMessages'
import { textTargetContent } from '../../../core/drivers/course/elementFields'

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
}
/** The request the card's undo (or redo) would take back (or repeat), and what it changed. */
export interface ElementCardStep { submissionId: string; fields: readonly string[] }
export interface ElementCardView {
  key: string
  /** An element's card lives while its document is open; a text card while it is open on screen. */
  kind: 'element' | 'text'
  /** Where a text card floats (viewport coordinates). */
  anchor: { left: number; top: number } | null
  /** Why a text card cannot send again: its text is no longer where the card left it. */
  textLost: string | null
  documentId: string
  label: string
  target: ExecutionSelectionTarget
  entries: readonly ElementCardEntry[]
  /** Something is queued or running. */
  busy: boolean
  question: PendingQuestion | null
  approval: PendingApproval | null
  error: string
  undo: ElementCardStep | null
  redo: ElementCardStep | null
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

interface CardRecord {
  key: string
  kind: 'element' | 'text'
  anchor: { left: number; top: number } | null
  /** A text card: what its range held after the last request (undefined before the first check, null once lost). */
  content?: string | null
  documentId: string
  label: string
  target: ExecutionSelectionTarget
  workspaceId: string | null
  conversation: ConversationRecord | null
  entries: ElementCardEntry[]
  projection: ExecutionProjection
  error: string
  catchUp: Promise<void>
}

/** One card per element: an object, or a document block, of one document. */
export function elementCardKey(documentId: string, target: ExecutionSelectionTarget): string {
  if (target.kind === 'course-object') return `${documentId}:object:${target.itemId}`
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
function withReply(entry: ElementCardEntry, projection: ExecutionProjection): ElementCardEntry {
  if (entry.reply || !entry.runId) return entry
  const item = [...projection.items].reverse().find(value => value.runId === entry.runId && value.type === 'text')
  const reply = item?.content.map(part => part.kind === 'text' ? part.text : '').join('').trim()
  return reply ? { ...entry, reply } : entry
}
const TERMINAL: ReadonlySet<ElementCardEntryState> = new Set(['completed', 'partial', 'failed', 'stopped'])
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

  constructor(private readonly ports: ElementCardPorts) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readVersion = () => this.version
  private notify() { this.version += 1; this.views.clear(); for (const listener of this.listeners) listener() }

  /** The space the cards' conversations belong to and the permission level the assistant shows (the same for cards). */
  setWorkspace(workspaceId: string | null) { this.workspace = workspaceId ? { workspaceId } : null }
  setPermission(mode: ExecutionPermissionMode) { this.permission = mode }

  view(key: string): ElementCardView | null {
    const card = this.cards.get(key)
    if (!card) return null
    const cached = this.views.get(key)
    if (cached) return cached
    const view: ElementCardView = {
      key, kind: card.kind, anchor: card.anchor, textLost: card.kind === 'text' && card.content === null ? TEXT_LOST : null, documentId: card.documentId, label: card.label, target: card.target,
      entries: card.entries.map(entry => withReply(entry, card.projection)),
      busy: card.entries.some(entry => entry.state === 'sending' || entry.state === 'queued' || entry.state === 'running'),
      question: pendingQuestion(card.projection), approval: pendingApproval(card.projection), error: card.error, ...steps(card.entries),
    }
    this.views.set(key, view)
    return view
  }
  /** Element cards with work to show in the top bar: running, or waiting for an answer or an approval. */
  active(): ElementCardView[] {
    return [...this.cards.keys()].map(key => this.view(key)!).filter(view => view.kind === 'element' && (view.busy || view.question || view.approval))
  }
  texts(): ElementCardView[] { return [...this.cards.keys()].map(key => this.view(key)!).filter(view => view.kind === 'text') }

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
    this.cards.set(key, { key, kind: 'element', anchor: null, documentId: input.documentId, label: input.label, target: structuredClone(input.target), workspaceId: null,
      conversation: null, entries: [], projection: emptyExecutionProjection(''), error: '', catchUp: Promise.resolve() })
    // A card ends with its document (Main deletes its conversation at the same time).
    const documents = this.ports.documents?.()
    if (documents && this.documents?.api !== documents) {
      this.documents?.stop()
      this.documents = { api: documents, stop: documents.subscribe(event => { if (event.type === 'closed') this.forgetDocument(event.documentId) }) }
    }
    this.notify()
    return key
  }

  /**
   * Opens a card for selected text (M15): it stays on screen until closed, and closing it ends it. Only one text
   * card is open at a time; `content` is what the range holds now.
   */
  openText(input: { documentId: string; target: ExecutionSelectionTarget; label: string; anchor: { left: number; top: number }; content: string | null }): string {
    for (const card of [...this.cards.values()]) if (card.kind === 'text') void this.closeText(card.key).catch(() => undefined)
    const key = `${input.documentId}:text:${crypto.randomUUID()}`
    this.cards.set(key, { key, kind: 'text', anchor: input.anchor, content: input.content ?? undefined, documentId: input.documentId, label: input.label,
      target: structuredClone(input.target), workspaceId: null, conversation: null, entries: [], projection: emptyExecutionProjection(''), error: '', catchUp: Promise.resolve() })
    this.notify()
    return key
  }
  /** Explicit user re-selection keeps this card's draft and conversation while replacing only its live text target. */
  rebindText(key: string, input: { documentId: string; target: ExecutionSelectionTarget; label: string;
    anchor: { left: number; top: number }; content: string | null }): void {
    const card = this.cards.get(key)
    if (!card || card.kind !== 'text') throw new Error('原文字卡已关闭，请重新打开。')
    if (card.documentId !== input.documentId) throw new Error('只能在原文档中重新选择文字。')
    if (card.entries.some(entry => entry.state === 'sending' || entry.state === 'queued' || entry.state === 'running')
      || pendingQuestion(card.projection) || pendingApproval(card.projection)) throw new Error('当前请求尚未结束，请稍后重新选择。')
    if (input.content === null) throw new Error('新选区内容无法确认，请重新选中后再试。')
    card.target = structuredClone(input.target)
    card.content = input.content
    card.label = input.label
    card.anchor = { ...input.anchor }
    card.error = ''
    this.notify()
  }
  /** Closes a text card: its running request stops, its conversation goes; what it changed stays in the document. */
  async closeText(key: string): Promise<void> {
    const card = this.cards.get(key)
    if (card?.kind !== 'text') return
    this.cards.delete(key)
    this.notify()
    const api = this.ports.execution(), conversation = card.conversation
    const latest = api && conversation ? await api.conversation(conversation.workspaceId, conversation.conversationId) : null
    if (api && latest) await api.deleteConversation({ workspaceId: latest.workspaceId, conversationId: latest.conversationId, expectedRevision: latest.revision })
  }

  /**
   * Sends one request about the card's element. Requests to a busy element wait in its queue. `capture` is the
   * element as selected now; only it is writable. A text card sends to where its text is now and waits for the
   * previous request to end.
   */
  async send(key: string, instruction: string, selected?: SelectionCapture): Promise<void> {
    const card = this.cards.get(key)
    const text = instruction.trim()
    if (!card || !text) return
    const api = this.ports.execution()
    if (!api) throw new Error('AI 执行服务尚未就绪。')
    const workspace = this.workspace
    if (!workspace) throw new Error('工作空间尚未就绪，请稍后再发送。')
    const capture = card.kind === 'text' ? await this.textCapture(card) : selected
    if (!capture || capture.documentId !== card.documentId || capture.targets.length !== 1
      || card.kind === 'element' && elementCardKey(capture.documentId, capture.targets[0]!) !== key)
      throw new Error('选中的对象已改变，请重新选择后发送。')
    const settings = await this.ports.settings()?.read()
    const conversation = settings?.profile.roles.conversation
    const connection = settings?.connections.find(value => value.connection.id === conversation?.connectionId)
    if (!settings || !conversation || !connection?.hasCredential || connection.revoked) throw new Error('尚未配置可用的对话模型。请先在模型设置中选择连接、模型和账号。')
    const submissionId = crypto.randomUUID()
    const entry: ElementCardEntry = { submissionId, text, state: 'sending' }
    card.entries = [...card.entries, entry]; card.error = ''; card.target = structuredClone(capture.targets[0]!)
    this.notify()
    try {
      let current = card.conversation
      if (!current || card.workspaceId !== workspace.workspaceId) {
        current = await api.createConversation(workspace.workspaceId, card.label, undefined, { kind: 'element', documentId: card.documentId, label: card.label })
        card.workspaceId = workspace.workspaceId; card.conversation = current; card.projection = emptyExecutionProjection(current.conversationId)
        this.listen(api)
      }
      const writable = this.permission !== 'read-only'
      const request = { workspaceId: workspace.workspaceId, conversationId: current.conversationId, submissionId, text,
        documents: [selectionReference(capture, writable)], attachments: [], mode: 'queue' as const,
        permission: this.permission, disclosedSettings: disclosedExecutionSettings(settings) }
      // The conversation moves on while the element's requests run, so each send goes against its latest revision. A
      // card keeps no draft there: a newer revision is only its own requests' progress, and sending again is safe.
      let result: ExecutionSendResult
      for (let attempt = 0; ; attempt += 1) {
        current = await api.conversation(current.workspaceId, current.conversationId) ?? current
        try { result = await api.send({ ...request, expectedRevision: current.revision }); break }
        catch (error) { if (attempt >= 3 || !isExecutionInputError(error, 'conversation-draft-changed')) throw error }
      }
      card.conversation = result.conversation
      this.applySubmission(card, result.submission, result.run)
    } catch (error) {
      this.patchEntry(card, submissionId, { state: 'failed', failure: error instanceof Error ? error.message : '请求没有发送。' })
      throw error
    }
  }

  /** A text card's range as it is now; refused while a request runs or when the text is no longer where the card left it. */
  private async textCapture(card: CardRecord): Promise<SelectionCapture> {
    if (this.view(card.key)?.busy) throw new Error('请等 AI 改完这一次再继续追问。')
    if (card.content === null) throw new Error(TEXT_LOST)
    const snapshot = await this.ports.snapshot?.(card.documentId)
    if (!snapshot) throw new Error('文档尚未就绪，请稍后再发送。')
    if (card.content !== undefined && textTargetContent(snapshot.model, card.target) !== card.content) throw new Error('这段文字已被改动，请重新选中后再打开 AI 卡。')
    return { documentId: card.documentId, epoch: snapshot.epoch, revision: snapshot.revision, targets: [structuredClone(card.target)], label: card.label }
  }
  /** A text card follows its text: each ended request, undo or redo says where it is now. */
  private followText(card: CardRecord, change: ElementChangeView) {
    if (card.kind !== 'text' || change.state === 'pending') return
    if (change.target && change.content !== undefined) { card.target = structuredClone(change.target); card.content = change.content }
    else card.content = null
  }

  async answer(key: string, runId: string, callId: string, answer: UserAnswer): Promise<void> {
    const api = this.ports.execution()
    if (!api?.answer) throw new Error('当前版本不能在卡片中回答。')
    await api.answer({ runId, callId, answer })
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
    if (result.status === 'applied') { this.followText(card, result.change); this.patchEntry(card, submissionId, { change: result.change }) }
    return result
  }
  /** Stops the element's running request; queued ones stay. */
  async stop(key: string): Promise<void> {
    const api = this.ports.execution(), card = this.cards.get(key)
    const running = card?.entries.find(entry => entry.state === 'running' && entry.runId)
    if (api && running?.runId) await api.stop(running.runId)
  }

  /** The top bar asks for a card to be shown when its element's quick bar appears (a jump to it). */
  requestOpen(key: string) { this.openRequests.add(key); this.notify() }
  /** One-shot: true once after a request, for the button that shows the card. */
  takeOpenRequest(key: string): boolean { return this.openRequests.delete(key) }

  /** The document closed: Main clears its cards' conversations; nothing of them stays here either. */
  forgetDocument(documentId: string) {
    let changed = false
    for (const [key, card] of this.cards) if (card.documentId === documentId) { this.cards.delete(key); changed = true }
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
    if (event.type === 'run.state' || event.type === 'run.end') this.refresh(card.key)
  }
  /** Folds the conversation's new events into the card, one page after another. */
  private catchUp(card: CardRecord) {
    const api = this.ports.execution(), conversationId = card.conversation?.conversationId
    if (!api || !conversationId) return
    card.catchUp = card.catchUp.then(async () => {
      for (;;) {
        const page = await api.events(conversationId, card.projection.cursor, 5000)
        card.projection = foldExecutionEvents(card.projection, page.events)
        if (!page.hasMore) break
      }
      this.notify()
    }).catch(() => undefined)
  }
  /** Re-reads the card's submissions, runs and replies after a run changed. */
  private refresh(key: string) {
    const api = this.ports.execution(), card = this.cards.get(key)
    const conversation = card?.conversation
    if (!api || !card || !conversation) return
    void (async () => {
      const [submissions, latest] = await Promise.all([
        api.submissions({ workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }),
        api.conversation(conversation.workspaceId, conversation.conversationId),
      ])
      if (latest) card.conversation = latest
      for (const submission of submissions) {
        const run = submission.runId ? await api.run(submission.runId) : null
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
      this.followText(card, change)
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
      state, ...(submission.runId ? { runId: submission.runId } : {}), ...(reply ? { reply } : {}),
      ...(submission.failure ? { failure: submission.failure.message } : run?.failure ? { failure: run.failure.message } : {}),
    }, notify)
  }
  private patchEntry(card: CardRecord, submissionId: string, patch: Partial<ElementCardEntry>, notify = true) {
    card.entries = card.entries.map(entry => entry.submissionId === submissionId ? { ...entry, ...patch } : entry)
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

export function useElementCard(key: string | null): ElementCardView | null {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return key ? elementCards.view(key) : null
}
export function useActiveElementCards(): ElementCardView[] {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return elementCards.active()
}
