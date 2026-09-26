import { useSyncExternalStore } from 'react'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { DocumentHostAPI } from '../../../shared/workbench/desktop'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { disclosedExecutionSettings, type ExecutionDesktopAPI, type ExecutionSelectionTarget, type ExecutionSubmissionRecord } from '../../../shared/workbench/executionDesktop'
import { emptyExecutionProjection, foldExecutionEvents, type ExecutionEvent, type ExecutionProjection } from '../../../shared/workbench/executionEvents'
import { DEFAULT_PERMISSION_MODE, type ApprovalDecision, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { ExecutionSettingsAPI } from '../../../shared/workbench/executionSettingsDesktop'
import type { UserAnswer } from '../../../shared/workbench/userQuestion'
import { pendingApproval, pendingQuestion, type PendingApproval, type PendingQuestion } from '../executionTimelineModel'
import { selectionReference, type SelectionCapture } from '../SelectionContextController'

/**
 * Element AI cards (M15): every element has its own card with its requests and replies. A card is backed by an
 * unlisted conversation that Main clears when the document closes; requests to one element queue in that
 * conversation, different elements run side by side. A card's AI may change only its element.
 */
export type ElementCardEntryState = 'sending' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'cancelled'
export interface ElementCardEntry {
  submissionId: string
  text: string
  state: ElementCardEntryState
  runId?: string
  reply?: string
  failure?: string
}
export interface ElementCardView {
  key: string
  documentId: string
  label: string
  target: ExecutionSelectionTarget
  entries: readonly ElementCardEntry[]
  /** Something is queued or running. */
  busy: boolean
  question: PendingQuestion | null
  approval: PendingApproval | null
  error: string
}
export interface ElementCardPorts {
  execution(): ExecutionDesktopAPI | undefined
  settings(): ExecutionSettingsAPI | undefined
  documents?(): Pick<DocumentHostAPI, 'subscribe'> | undefined
}

interface CardRecord {
  key: string
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

const RUN_STATE: Partial<Record<ExecutionRunRecord['status'], ElementCardEntryState>> = {
  queued: 'running', running: 'running', stopping: 'running', completed: 'completed', partial: 'completed',
  failed: 'failed', interrupted: 'failed', stopped: 'stopped',
}

export class ElementCardController {
  private readonly cards = new Map<string, CardRecord>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private workspace: { workspaceId: string } | null = null
  private permission: ExecutionPermissionMode = DEFAULT_PERMISSION_MODE
  private stopEvents: (() => void) | null = null
  private stopDocuments: (() => void) | null = null
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
      key, documentId: card.documentId, label: card.label, target: card.target, entries: card.entries,
      busy: card.entries.some(entry => entry.state === 'sending' || entry.state === 'queued' || entry.state === 'running'),
      question: pendingQuestion(card.projection), approval: pendingApproval(card.projection), error: card.error,
    }
    this.views.set(key, view)
    return view
  }
  /** Cards with work to show in the top bar: running, or waiting for an answer or an approval. */
  active(): ElementCardView[] {
    return [...this.cards.keys()].map(key => this.view(key)!).filter(view => view.busy || view.question || view.approval)
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
    this.cards.set(key, { key, documentId: input.documentId, label: input.label, target: structuredClone(input.target), workspaceId: null,
      conversation: null, entries: [], projection: emptyExecutionProjection(''), error: '', catchUp: Promise.resolve() })
    // A card ends with its document (Main deletes its conversation at the same time).
    this.stopDocuments ??= this.ports.documents?.()?.subscribe(event => { if (event.type === 'closed') this.forgetDocument(event.documentId) }) ?? null
    this.notify()
    return key
  }

  /**
   * Sends one request about the card's element. Requests to a busy element wait in its queue. `capture` is the
   * element as selected now; only it is writable.
   */
  async send(key: string, instruction: string, capture: SelectionCapture): Promise<void> {
    const card = this.cards.get(key)
    const text = instruction.trim()
    if (!card || !text) return
    const api = this.ports.execution()
    if (!api) throw new Error('AI 执行服务尚未就绪。')
    const workspace = this.workspace
    if (!workspace) throw new Error('工作空间尚未就绪，请稍后再发送。')
    if (capture.documentId !== card.documentId || capture.targets.length !== 1 || elementCardKey(capture.documentId, capture.targets[0]!) !== key)
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
      const result = await api.send({ workspaceId: workspace.workspaceId, conversationId: current.conversationId, submissionId,
        expectedRevision: current.revision, text, documents: [selectionReference(capture, writable)], attachments: [], mode: 'queue',
        permission: this.permission, disclosedSettings: disclosedExecutionSettings(settings) })
      card.conversation = result.conversation
      this.applySubmission(card, result.submission, result.run)
    } catch (error) {
      this.patchEntry(card, submissionId, { state: 'failed', failure: error instanceof Error ? error.message : '请求没有发送。' })
      throw error
    }
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
    this.stopEvents ??= api.subscribe(event => this.onEvent(event))
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
    })().catch(() => undefined)
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
})

export function useElementCard(key: string | null): ElementCardView | null {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return key ? elementCards.view(key) : null
}
export function useActiveElementCards(): ElementCardView[] {
  useSyncExternalStore(elementCards.subscribe, elementCards.readVersion)
  return elementCards.active()
}
