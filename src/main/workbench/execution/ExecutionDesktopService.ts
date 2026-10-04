import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { executionDesktopRequestSchema, matchesDisclosedSelection, type ConversationHomeInput, type ExecutionDocumentReference, type ExecutionSendInput, type ExecutionSendResult, type ExecutionSubmissionRecord, type RendererTimingStamp } from '../../../shared/workbench/executionDesktop'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ExecutionEvent, ExecutionEventInput } from '../../../shared/workbench/executionEvents'
import type { EditEvent } from '../../../shared/workbench/editSession'
import type { ModelChatMessage, ModelSelection } from '../../../shared/workbench/modelProvider'
import { type ExecutionRunRecord } from '../../../shared/workbench/execution'
import { conversationHistoryIndex } from './ConversationHistoryIndex'
import { PayloadCompiler } from '../../../core/execution/PayloadCompiler'
import { AttachmentError, AttachmentService, type AttachmentLiveConversation } from '../attachments/AttachmentService'
import { ExecutionSettingsError, type ExecutionSettingsStore } from '../providers/ExecutionSettingsStore'
import type { DocumentHostService } from '../DocumentHostService'
import { ConversationStore, ConversationStoreError } from '../conversations/ConversationStore'
import { ExecutionEngine, trustedRunDocumentIds } from './ExecutionEngine'
import { VisualAnalysisService } from './VisualAnalysisService'
import { ExecutionRunStore } from './ExecutionRunStore'
import { captureMainTiming, ExecutionEventStore, type ExecutionTimingMark, type ExecutionTimingStage } from './ExecutionEventStore'
import { ExecutionSubmissionStore, type StoredExecutionSubmission } from './ExecutionSubmissionStore'
import { EditSessionService } from './EditSessionService'
import { OpenAIChatProvider } from '../providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider } from '../providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider } from '../providers/AnthropicMessagesProvider'
import { routeModelProviders, serializeModelPayload } from '../providers/ModelProviderRouter'
import { DesktopOperationError } from '../../errors'
import { DEFAULT_PERMISSION_MODE } from '../../../shared/workbench/executionPermission'
import { executionInputError } from './executionInputErrors'
import { AgentFileService } from './AgentFileService'
import { ExecutionChangeReviewService } from '../review/ExecutionChangeReviewService'
import { HostArtifactDeliveryService } from './HostArtifactDeliveryService'
import type { HtmlActionService } from '../observation/HtmlActionService'
import { forkDraftFromCheckpoint, indexUserCheckpoint } from './CheckpointForkService'
import { fileCreated } from './executionOutcome'
import { sourceFileKind } from '../../../shared/workbench/sourceFileKind'
import { continueDocumentTargets } from './continuationTargets'
import { ElementChangeTracker } from './ElementChangeTracker'
import { diagnosticLog } from '../../diagnosticLog'
import { readTarget } from '../../../core/tools/ToolTargets'
import { isSourceDocumentModel } from '../../../shared/workbench/document'
import type { ElementChangeView, ElementRevertResult } from '../../../shared/workbench/executionDesktop'

export interface ExecutionDesktopServiceOptions {
  directory: string
  documents: DocumentHostService
  settings: ExecutionSettingsStore
  authorizeWorkspaceRoot(root: string): Promise<{ resolvedPath: string }>
  /** A separate transport can be supplied by deterministic real-host fixtures. Production uses fetch. */
  fetch?: typeof fetch
  attachments?: AttachmentService
}
function conversationAttachmentIds(record: ConversationRecord): string[] {
  return [...new Set([...record.attachmentIds, ...record.inputAttachments.map(reference => reference.attachmentId),
    ...record.messages.flatMap(message => message.attachmentIds)])]
}
/** A refusal Main words itself: its fixed text is the reason the teacher sees. */
const refused = (message: string) => new DesktopOperationError('execution-operation-refused', '会话操作未完成', message, '当前输入、附件和已应用的修改已保留。')
/** Fixed reasons for the conversation record's own refusals. */
const conversationStoreReasons: Record<ConversationStoreError['code'], readonly [message: string, suggestion: string]> = {
  'revision-conflict': ['会话刚被另一项操作更新（例如任务结束时写入的回复），这次操作没有生效。', '请再操作一次，会按最新记录处理；当前输入和已应用的修改已保留。'],
  'conversation-not-found': ['会话已不存在。', '请选择现有会话或新建会话；文件与已应用的修改没有删除。'],
  'workspace-not-found': ['会话所在的工作空间记录已不存在。', '请重新打开工作空间；文件与已应用的修改没有删除。'],
  'home-conflict': ['已有内容或已设定所属位置的会话不会改变归属。', '可以新建会话，再为它选择所属位置。'],
  'store-corrupt': ['会话记录无法读取或不符合当前格式，本次没有写入。', '请查看诊断记录；文件与已应用的修改没有改变。'],
  'identity-conflict': ['会话或工作空间身份与已有记录冲突，本次没有写入。', '请重试；若仍失败，请查看诊断记录。'],
}
const operationTitles: Partial<Record<string, string>> = { draft: '草稿未保存', 'rename-conversation': '会话名称未保存' }
/** Every operation failure leaves with one fixed, specific reason; other exception text (paths, provider payloads) never crosses IPC. */
function operationFailure(error: unknown, type: unknown): DesktopOperationError {
  const title = typeof type === 'string' ? operationTitles[type] : undefined
  if (error instanceof DesktopOperationError)
    return title ? new DesktopOperationError(error.code, title, error.message, error.suggestion, { cause: error.cause }) : error
  if (error instanceof ConversationStoreError) {
    const [message, suggestion] = conversationStoreReasons[error.code]
    return new DesktopOperationError(`execution-store-${error.code}`, title ?? '会话操作未完成', message, suggestion, { cause: error })
  }
  return new DesktopOperationError('execution-operation-failed', title ?? '会话操作未完成', '会话服务暂时无法完成操作。',
    '请重试；若仍失败，请查看诊断记录。当前输入、附件和已应用的修改已保留。', { cause: error })
}
/** The space's session list leaves out the conversations behind element AI cards (M15). */
function listed(records: ConversationRecord[]): ConversationRecord[] { return records.filter(record => !record.element) }
/** An object or document block that still exists is the same target after other edits; a text range never is. */
function targetStillExists(snapshot: DocumentSnapshot, target: ExecutionDocumentReference['writable'][number]): boolean {
  if (target.kind !== 'course-object' && target.kind !== 'flow-block') return false
  try { readTarget(snapshot.model, target); return true } catch { return false }
}
/** Main owns spaces, task freezes and runs. Mounting a view only reads/subscribes. */
export class ExecutionDesktopService {
  readonly conversations: ConversationStore
  readonly engine: ExecutionEngine
  readonly runs: ExecutionRunStore
  readonly events: ExecutionEventStore
  readonly submissions: ExecutionSubmissionStore
  readonly edits: EditSessionService
  readonly attachments: AttachmentService
  readonly changeReview: ExecutionChangeReviewService
  readonly artifacts: HostArtifactDeliveryService
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly elementChanges = new Map<string, ElementChangeTracker>()
  private eventSink?: (event: ExecutionEvent) => void
  private editSink?: (event: EditEvent) => void
  private externalRevoker?: (input: { workspaceId: string; conversationId: string; portIds: string[] }) => Promise<void>
  private imageRetention?: {
    prepare(input: { workspaceId: string; conversationId: string; runIds: readonly string[] }): Promise<void>
    abort(input: { workspaceId: string; conversationId: string }): void
    collect(): void
  }
  private initialization?: Promise<void>
  private recoveryAndRebindPromise?: Promise<void>
  private readonly recoveryIssues = new Map<string, string>()
  constructor(private readonly options: ExecutionDesktopServiceOptions) {
    this.conversations = new ConversationStore({ directory: path.join(options.directory, 'conversations') })
    this.runs = new ExecutionRunStore(path.join(options.directory, 'runs'))
    this.events = new ExecutionEventStore({ directory: path.join(options.directory, 'events') })
    this.submissions = new ExecutionSubmissionStore(path.join(options.directory, 'submissions'))
    this.edits = new EditSessionService(options.documents.registry, options.documents.tools)
    this.changeReview = new ExecutionChangeReviewService(options.documents, path.join(options.directory, 'change-review'))
    this.artifacts = new HostArtifactDeliveryService({ journalDirectory: path.join(options.directory, 'artifact-deliveries'),
      withFileOperation: work => options.documents.fileCoordinator.withFileOperation(work),
      assertTarget: filename => options.documents.assertFileAvailable(filename) })
    this.attachments = options.attachments ?? new AttachmentService({ directory: path.join(options.directory, 'attachments') })
    const chat = new OpenAIChatProvider({ credentialResolver: connection => options.settings.resolveCredential(connection), fetch: options.fetch,
      onTransportDiagnostic: diagnostic => diagnosticLog.append({ source: 'main', message: 'OpenAI Chat transport failure', details: {
        chatTransportPhase: diagnostic.phase, chatTransportClass: diagnostic.errorClass,
        chatHttpResponseReceived: diagnostic.httpResponseReceived,
        ...(diagnostic.errorCode ? { code: diagnostic.errorCode } : {}),
        ...(diagnostic.httpStatus !== undefined ? { httpStatus: diagnostic.httpStatus } : {}),
      } }),
      onProtocolShape: shape => diagnosticLog.append({ source: 'main', message: 'OpenAI Chat tool fragment protocol', details: {
        chatToolCode: shape.code, chatToolType: shape.type, chatToolIndex: shape.index, chatToolHasFunction: shape.hasFunction } }) })
    const oauth = new ChatGPTResponsesProvider({ credentialResolver: async connection => (await import('../providers/executionSettingsService.js')).resolveOAuthCredential(connection), fetch: options.fetch })
    const responses = new OpenAIResponsesProvider({ credentialResolver: connection => options.settings.resolveCredential(connection), fetch: options.fetch })
    const anthropic = new AnthropicMessagesProvider({ credentialResolver: connection => options.settings.resolveCredential(connection), fetch: options.fetch })
    const provider = routeModelProviders({ 'openai-chat': chat, 'chatgpt-responses': oauth, 'openai-responses': responses, 'anthropic-messages': anthropic })
    const serializePayload = serializeModelPayload
    const visualAnalysis = new VisualAnalysisService({
      frozenSelection: async runId => (await this.runs.read(runId))?.input.visionSelection ?? null,
      provider, observation: { readResource: input => options.documents.tools.readObservationResource(input.runId, input.resourceId) },
    })
    this.engine = new ExecutionEngine({ registry: options.documents.registry, gateway: options.documents.tools, runs: this.runs, events: this.events,
      edits: this.edits, provider, serializePayload, initialCompiler: new PayloadCompiler({ attachments: this.attachments, serializePayload }),
      files: new AgentFileService(options.documents), materials: this.attachments, visualAnalysis, changeReview: this.changeReview,
      artifacts: this.artifacts,
      readImageTiming: async jobId => (await import('../workbenchToolServices.js')).workbenchImageService().readTiming(jobId),
      approveBrowserAction: async input => (await import('../workbenchToolServices.js')).approveWorkbenchBrowserAction(input),
      browserApprovalContext: async runId => (await import('../workbenchToolServices.js')).workbenchBrowserApprovalContext(runId),
      observeBodyStreaming: (selection, observation) => options.settings.recordBodyStreaming(selection, observation) })
    this.engine.subscribe(event => {
      this.eventSink?.(event)
      if (event.type !== 'run.end') return
      visualAnalysis.clearRun(event.runId)
      // Before the object's next queued request can start.
      this.recordElementResult(event.taskId)
      // Queued on the conversation as the end is published, ahead of any read a view makes after seeing it.
      void this.serial(event.conversationId, () => this.afterRunEnd(event.runId)).catch(() => undefined)
    })
    this.edits.subscribe(event => this.editSink?.(event))
  }
  setSinks(events?: (event: ExecutionEvent) => void, edits?: (event: EditEvent) => void) { this.eventSink = events; this.editSink = edits }
  setHtmlActions(service: HtmlActionService): void { this.engine.setHtmlActions(service) }
  private timing(conversationId: string, taskId: string, markId: string, stage: ExecutionTimingStage,
    extra: Pick<ExecutionTimingMark, 'sourceWallTimeMs' | 'detail'> = {},
    stamp = captureMainTiming()): void {
    void this.events.recordTiming({ conversationId, taskId, markId, stage, ...stamp, ...extra }).catch(() => undefined)
  }
  private rendererTiming(conversationId: string, taskId: string, markId: string,
    stage: Extract<ExecutionTimingStage, `renderer.${string}`>, stamp: RendererTimingStamp,
    detail?: ExecutionTimingMark['detail']): void {
    void this.events.recordTiming({ conversationId, taskId, markId, stage, process: 'renderer', clock: 'performance.now',
      ...stamp, ...(detail ? { detail } : {}) }).catch(() => undefined)
  }
  async appendExternalEvent(input: ExecutionEventInput): Promise<ExecutionEvent> {
    const event = await this.events.append(input)
    // This observes a terminal save fact entering the timeline. It does not measure DocumentHost save completion.
    if (event.type === 'document.save' && (event.data.saveStatus === 'saved' || event.data.saveStatus === 'failed'))
      this.timing(event.conversationId, event.taskId, `${event.eventId}:save-fact`, 'save.fact-observed', {
        sourceWallTimeMs: event.time, detail: { documentId: event.data.documentId, saveStatus: event.data.saveStatus },
      })
    this.eventSink?.(event)
    return event
  }
  setExternalRevoker(revoker?: (input: { workspaceId: string; conversationId: string; portIds: string[] }) => Promise<void>) { this.externalRevoker = revoker }
  setImageRetention(retention?: ExecutionDesktopService['imageRetention']) { this.imageRetention = retention }
  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const operation = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(action)
    this.queues.set(id, operation)
    void operation.finally(() => { if (this.queues.get(id) === operation) this.queues.delete(id) }).catch(() => undefined)
    return operation
  }
  private ready(): Promise<void> {
    if (this.initialization) return this.initialization
    const initialization = (async () => {
      // Fast segment: restore the durable identity any operation may reference by id.
      // The slow segment below (engine.recover + submission rebind + queue drain) must not block the UI or
      // a first create-conversation; it is still awaited by every submit path through recoveryAndRebindPromise.
      const runs = await this.runs.list()
      for (const record of runs.filter(run => ['queued', 'running', 'stopping'].includes(run.status))) {
        for (const reference of record.input.documents) {
          if (!this.options.documents.registry.list().some(document => document.documentId === reference.documentId)) {
            // Preserve the durable identity needed for receipt lookup. A conflicting open binding remains an explicit gap.
            await this.options.documents.internalAPI.restore(reference.documentId).catch(() => undefined)
          }
        }
      }
      // Reading the submissions records unreadable files, so the first workspace read reports them with the runs.
      await this.submissions.list().catch(() => undefined)
      // Cards are transient; unsubmitted input survives as an ordinary recoverable conversation draft. This
      // changes which conversations exist, so the fast conversation list must already see it.
      await this.clearElementCards().catch(() => undefined)
      // Slow segment: engine.recover walks every run and can take hundreds of ms per run with large checkpoints.
      const recoveryAndRebind = (async () => {
        await this.engine.recover()
        const refreshed = await this.runs.list()
        const submissions = await this.submissions.list()
        for (const record of submissions.filter(value => ['queued', 'starting', 'accepted'].includes(value.state))) {
          try {
          const run = refreshed.find(value => value.input.taskId === record.submissionId)
          const conversation = await this.conversations.readConversation(record)
          if (!conversation) { await this.retireOrphanedSubmission(record, run); continue }
          if (run) await this.bindRun(record, run)
          else if (record.state === 'starting') await this.submissions.update(record.submissionId, { updatedAt: Date.now(),
            failure: { code: 'submission-outcome-unknown', message: '应用中断时启动结果未知；未自动重发，请核对后重试新消息。' } })
          } catch { this.recoveryIssues.set(record.submissionId, '一项旧提交无法恢复，已保留；其他会话仍可使用。') }
        }
        const queuedConversations = [...new Set(submissions.filter(value => value.state === 'queued').map(value => value.conversationId))]
        for (const conversationId of queuedConversations) await this.serial(conversationId, () => this.startNext(conversationId))
          .catch(() => { this.recoveryIssues.set(conversationId, '一项旧会话队列未恢复，已保留且未重新发出。') })
        // A release intent written before a prior crash is reconciled only after run and
        // submission recovery has rebuilt the current conversation references.
        await this.collectAttachmentReleases().catch(() => undefined)
      })()
      this.recoveryAndRebindPromise = recoveryAndRebind
      // A recovery failure poisons nothing: submit paths surface it, and it never blocks ready() again.
      void recoveryAndRebind.catch(() => undefined)
    })()
    this.initialization = initialization
    // A real initialization failure is retryable on the next explicit operation, not cached forever.
    void initialization.catch(() => { if (this.initialization === initialization) this.initialization = undefined })
    return initialization
  }
  /** Submit paths and any code that touches an active run must wait for background recovery to finish. */
  private async awaitRecoveryAndRebind(): Promise<void> {
    await (this.recoveryAndRebindPromise ?? Promise.resolve())
  }
  private async retireOrphanedSubmission(record: StoredExecutionSubmission, run?: ExecutionRunRecord): Promise<void> {
    // Deleting a conversation retires its dispatch, not its durable receipts or unknown outcomes.
    if (run && ['queued', 'running', 'stopping'].includes(run.status)) await this.engine.stop(run.runId)
    if (record.failure?.code === 'conversation-deleted' && record.state !== 'queued') return
    await this.submissions.update(record.submissionId, {
      ...(record.state === 'queued' ? { state: 'cancelled' as const } : {}),
      ...(run ? { runId: run.runId } : {}), updatedAt: Date.now(),
      failure: { code: 'conversation-deleted', message: '原会话已删除；此提交仅保留历史和回执，不会恢复会话或重新执行。未确认的请求结果仍为未知。' },
    })
  }
  private async collectAttachmentReleases(): Promise<void> {
    const live: AttachmentLiveConversation[] = []
    for (const workspace of await this.conversations.listWorkspaces())
      for (const conversation of await this.conversations.listConversations(workspace.workspaceId))
        live.push({ workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
          attachmentIds: conversationAttachmentIds(conversation) })
    await this.attachments.collectConversationReleases(live)
  }
  private async required(workspaceId: string, conversationId: string): Promise<ConversationRecord> {
    const record = await this.conversations.readConversation({ workspaceId, conversationId })
    if (!record) throw new DesktopOperationError('conversation-deleted', '会话已不存在', '原会话已删除或无法找到。', '请选择现有会话或新建会话；文件与已应用的修改没有删除。')
    return record
  }
  private async changeReviewSource(input: { workspaceId: string; conversationId: string; runId: string }): Promise<{ run: ExecutionRunRecord; workspaceRoot: string }> {
    const run = await this.engine.read(input.runId)
    if (!run) throw refused('本次运行记录不存在')
    if (run.input.conversationId !== input.conversationId) throw refused('运行不属于当前会话')
    const conversation = await this.required(input.workspaceId, input.conversationId)
    if (!conversation.runIndex.builtinRunIds.includes(input.runId)) throw refused('运行不属于当前工作空间会话')
    const workspace = await this.conversations.readWorkspace(input.workspaceId)
    if (!workspace) throw refused('当前工作空间不存在')
    const root = (await this.options.authorizeWorkspaceRoot(workspace.rootPath)).resolvedPath
    return { run, workspaceRoot: root }
  }
  private async checkpointSource(input: { workspaceId: string; conversationId: string; runId: string }) {
    const { run } = await this.changeReviewSource(input)
    const conversation = await this.required(input.workspaceId, input.conversationId)
    const ids = [...new Set([...run.input.documents.map(document => document.documentId), ...Object.keys(run.documentPaths ?? {})])]
    const contentVersions = await Promise.all(ids.map(async documentId => {
      try { return { documentId, revision: (await this.options.documents.registry.get(documentId).drain()).revision } }
      catch { return { documentId, revision: null } }
    }))
    return { run, conversation, checkpoint: indexUserCheckpoint({ run, conversation, contentVersions }) }
  }
  private async workspace(root: string | null) {
    const rootPath = root ? (await this.options.authorizeWorkspaceRoot(root)).resolvedPath : path.join(this.options.directory, 'space')
    if (!root) await fs.mkdir(rootPath, { recursive: true })
    const canonical = await fs.realpath(rootPath), key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    const existing = (await this.conversations.listWorkspaces()).find(space => key(space.rootPath) === key(canonical))
    const workspace = existing ?? await this.conversations.registerWorkspace({ workspaceId: randomUUID(), rootPath: canonical, managed: root === null, authorization: root === null ? 'managed' : 'user-selected' })
    return { workspace, conversations: listed(await this.conversations.listConversations(workspace.workspaceId)),
      recoveryIssues: [...this.runs.recoveryIssues, ...this.submissions.recoveryIssues, ...this.engine.recoveryIssues.values(), ...this.recoveryIssues.values(), ...this.options.documents.recoveryIssues] }
  }
  private async validateHome(workspaceId: string, home: ConversationHomeInput): Promise<ConversationHomeInput> {
    const space = await this.conversations.readWorkspace(workspaceId)
    if (!space) throw refused('会话工作空间不存在')
    const root = await fs.realpath(space.rootPath)
    const candidate = await fs.realpath(path.join(root, ...home.path.split('/')))
    const relative = path.relative(root, candidate)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw refused('会话所属位置不在工作空间内')
    const stat = await fs.stat(candidate)
    if (home.kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw refused('会话所属位置类型已改变')
    return { kind: home.kind, path: relative.split(path.sep).join('/') }
  }
  private refs(documents: ExecutionDocumentReference[]) {
    return documents.map(document => ({ contextRefId: document.documentId, documentId: document.documentId, epoch: document.epoch, revision: document.revision, writeScope: document.writable, ...(document.selection?.length ? { selection: document.selection } : {}) }))
  }
  private digest(input: ExecutionSendInput): string {
    return createHash('sha256').update(JSON.stringify({ workspaceId: input.workspaceId, conversationId: input.conversationId,
      text: input.text, documents: input.documents, attachments: input.attachments ?? [], mode: input.mode ?? 'queue',
      retryOfRunId: input.retryOfRunId ?? null, permission: input.permission ?? DEFAULT_PERMISSION_MODE,
      ...(input.contentOutput ? { contentOutput: input.contentOutput } : {}) })).digest('hex')
  }
  private async publicSubmission(record: StoredExecutionSubmission): Promise<ExecutionSubmissionRecord> {
    const { schemaVersion: _schemaVersion, digest: _digest, start: _start, attachmentIds: _attachmentIds,
      conversationRevision: _conversationRevision, continuation: _continuation, ...value } = structuredClone(record)
    if (record.state === 'queued') {
      const queued = (await this.submissions.list()).filter(item => item.conversationId === record.conversationId && item.state === 'queued')
      value.position = queued.findIndex(item => item.submissionId === record.submissionId) + 1
      value.queuePausedReason = await this.submissions.pausedReason(record.conversationId)
    }
    return value
  }
  private async submissionResult(record: StoredExecutionSubmission): Promise<ExecutionSendResult> {
    const conversation = await this.required(record.workspaceId, record.conversationId)
    const run = record.runId ? await this.engine.read(record.runId) ?? undefined : undefined
    return { submission: await this.publicSubmission(record), conversation, ...(run ? { run } : {}) }
  }
  private async activeRun(conversation: ConversationRecord): Promise<ExecutionRunRecord | null> {
    for (const runId of [...conversation.runIndex.builtinRunIds].reverse()) {
      const run = await this.engine.read(runId)
      if (run && ['queued', 'running', 'stopping'].includes(run.status)) return run
    }
    return null
  }
  private continuation(run: ExecutionRunRecord): { runId: string; facts: string } {
    return { runId: run.runId, facts: JSON.stringify({ originalGoal: run.input.instruction,
      completed: run.tools.filter(tool => tool.state === 'returned').map(tool => ({ name: tool.call.name,
        result: tool.result?.kind === 'read' ? { kind: 'read', note: '先前读取过；当前内容须重新读取' } : tool.result ?? { kind: 'error', code: 'missing-result', message: '先前工具未确认结果' } })),
      pending: run.tools.filter(tool => tool.state !== 'returned').map(tool => ({ name: tool.call.name, state: tool.state })),
      previousFailure: run.failure ?? null }) }
  }
  private async resolveHomeFile(root: string, home: NonNullable<ConversationRecord['home']>): Promise<string | null> {
    if (home.kind !== 'file' || home.missing) return null
    const base = await fs.realpath(root)
    let filename: string
    try { filename = await fs.realpath(path.join(base, ...home.path.split('/'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw executionInputError('home-file-missing', error); throw error }
    const relative = path.relative(base, filename)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw refused('会话所属文件已移出获准的工作空间')
    return filename
  }
  private async prepareDocuments(input: Pick<ExecutionSendInput, 'workspaceId' | 'conversationId' | 'documents' | 'permission'>) {
    const current = await this.required(input.workspaceId, input.conversationId)
    if (input.documents.length || !current.home) return structuredClone(input.documents)
    const space = await this.conversations.readWorkspace(current.home.workspaceId ?? current.workspaceId)
    if (!space) throw refused('会话所属位置的工作空间不存在')
    const filename = await this.resolveHomeFile(space.rootPath, current.home)
    if (!filename) return []
    try { sourceFileKind(filename) } catch { return [] }
    const snapshot = await this.options.documents.internalAPI.open(filename)
    return [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      writable: input.permission === 'read-only' ? [] : [{ kind: 'document' as const }] }]
  }

  private async prepareSubmission(input: ExecutionSendInput, current: ConversationRecord, digest: string): Promise<StoredExecutionSubmission> {
    const attachments = [...input.attachments ?? []]
    // Main owns the permission level: read-only tasks receive no writable scope whatever the renderer sent.
    const permission = input.permission ?? DEFAULT_PERMISSION_MODE
    const space = await this.conversations.readWorkspace(current.workspaceId)
    if (!space) throw refused('会话工作空间不存在')
    const homeWorkspaceId = current.home?.workspaceId ?? current.workspaceId
    const homeSpace = homeWorkspaceId === current.workspaceId ? space : await this.conversations.readWorkspace(homeWorkspaceId)
    if (!homeSpace) throw refused('会话所属位置的工作空间不存在')
    // A file home is the default document context only when the teacher did not pin another reference.
    // The binding is resolved by Main through the formal DocumentHost; home metadata itself grants no write.
    if (!input.documents.length && current.home?.kind === 'file' && !current.home.missing) {
      const resolved = await this.resolveHomeFile(homeSpace.rootPath, current.home)
      if (resolved) {
        let editable = true
        try { sourceFileKind(resolved) } catch { editable = false }
        if (editable) {
          const snapshot = await this.options.documents.internalAPI.open(resolved)
          input = { ...input, documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
            writable: permission === 'read-only' ? [] : [{ kind: 'document' }] }] }
        } else {
          const material = await this.attachments.receiveAuthorizedFile({ path: resolved, kind: 'workspace', authorizationId: `home:${input.submissionId}` })
          const first = material.representations[0]
          if (!first) throw executionInputError('attachment-unavailable')
          attachments.push({ attachmentId: material.id, representationId: first.id, role: 'reference', delivery: 'source' })
        }
      }
    }
    if (permission === 'read-only') input = { ...input, documents: input.documents.map(document => ({ ...document, writable: [] })) }
    if (!input.text.trim() && !attachments.length) throw executionInputError('empty-input')
    let explicitImages = false, imageCount = 0, representationBytes = 0
    this.timing(input.conversationId, input.submissionId, `${input.submissionId}:attachments:start`, 'submission.attachments.started',
      { detail: { attachmentCount: attachments.length } })
    try {
      for (const reference of attachments) {
        if (reference.delivery === 'source') {
          const source = await this.attachments.readSnapshot(reference.attachmentId)
          if (!source.representations.some(rep => rep.id === reference.representationId)) throw executionInputError('attachment-unavailable')
          continue
        }
        const read = await this.attachments.readRepresentation(reference.attachmentId, reference.representationId).catch(error => {
          if (error instanceof AttachmentError && ['representation-unavailable', 'corrupt-snapshot', 'corrupt-blob'].includes(error.code)
            || (error as NodeJS.ErrnoException)?.code === 'ENOENT') throw executionInputError('attachment-unavailable', error)
          throw error
        })
        representationBytes += read.bytes.byteLength
        if (read.representation.kind === 'image') { explicitImages = true; imageCount++ }
      }
      this.timing(input.conversationId, input.submissionId, `${input.submissionId}:attachments:end`, 'submission.attachments.finished',
        { detail: { outcome: 'completed', attachmentCount: attachments.length, imageCount, representationBytes } })
    } catch (error) {
      this.timing(input.conversationId, input.submissionId, `${input.submissionId}:attachments:failed`, 'submission.attachments.finished',
        { detail: { outcome: 'failed', attachmentCount: attachments.length, imageCount, representationBytes } })
      throw error
    }
    const documents = []
    for (const reference of input.documents) {
      let snapshot: DocumentSnapshot
      try { snapshot = await this.options.documents.registry.get(reference.documentId).drain() }
      catch (error) { throw executionInputError('document-session-changed', error) }
      if (snapshot.epoch !== reference.epoch) throw executionInputError('document-session-changed')
      // M15: an object or a document block stays the same target while it exists; a text range only while nothing changed.
      if (snapshot.revision !== reference.revision && [...(reference.selection ?? []), ...reference.writable.filter(target => target.kind !== 'document')]
        .some(target => !targetStillExists(snapshot, target))) throw executionInputError('document-range-changed')
      documents.push({ documentId: reference.documentId, writable: reference.writable, ...(reference.selection?.length ? { selection: reference.selection } : {}) })
    }
    if (input.contentOutput) {
      const output = input.contentOutput
      if (permission === 'read-only') throw refused('只读任务不能应用正文改写，请切换到可修改模式。')
      if (!documents.some(document => document.documentId === output.documentId
        && document.selection?.some(target => JSON.stringify(target) === JSON.stringify(output.target))))
        throw refused('正文改写目标与本次固定选区不一致，请重新选择。')
    }
    const historyIndex = await conversationHistoryIndex(current, runId => this.engine.read(runId))
    const context = historyIndex.context
    // History is an index of sources that may be reread later. It contributes no
    // image bytes to this first request and must not select the vision role for
    // an otherwise text-only submission. The separately frozen visionSelection
    // below remains available if a tool explicitly rereads a historical image.
    const select = async (role: 'conversation' | 'vision') => this.options.settings.snapshot(role).catch(error => {
      if (error instanceof ExecutionSettingsError && error.code === 'role-unconfigured') throw executionInputError(role === 'vision' ? 'vision-unconfigured' : 'conversation-unconfigured', error)
      if (error instanceof ExecutionSettingsError && error.code === 'credential-unavailable') throw executionInputError('model-connection-unavailable', error)
      throw error
    })
    let selection = await select('conversation')
    if (input.disclosedSettings && !matchesDisclosedSelection(input.disclosedSettings, selection)) throw executionInputError('disclosed-settings-changed')
    let selectionReason = '使用接受提交时配置的会话角色'
    if (explicitImages && selection.connection.capabilities.vision !== 'supported') {
      // A separately configured vision role remains the explicit override. Without it,
      // an unknown capability stays on the selected conversation model; the provider
      // can then report its real support instead of forcing another role to be set up.
      if ((await this.options.settings.read()).profile.roles.vision) {
        selection = await select('vision')
        if (input.disclosedSettings && !matchesDisclosedSelection(input.disclosedSettings, selection)) throw executionInputError('disclosed-settings-changed')
        selectionReason = '当前输入含图片，使用接受提交时配置的视觉角色'
      } else if (selection.connection.capabilities.vision === 'unknown') {
        selectionReason = '当前输入含图片，未单独配置视觉角色；沿用接受提交时选择的会话模型，其图片能力尚待实际请求确认'
      }
      if (selection.connection.capabilities.vision === 'unsupported') throw executionInputError('vision-unsupported')
    }
    let visionSelection: ModelSelection | undefined
    let visionUnavailableReason: string | undefined
    if (selection.role === 'vision') visionSelection = selection
    else if ((await this.options.settings.read()).profile.roles.vision) {
      try { visionSelection = await select('vision') }
      catch (error) { visionUnavailableReason = error instanceof Error ? error.message : '视觉模型连接不可用' }
    } else visionUnavailableReason = '任务接受时未配置视觉模型角色'
    const now = Date.now(), attachmentIds = [...new Set(attachments.map(reference => reference.attachmentId))]
    return { schemaVersion: 1, submissionId: input.submissionId, workspaceId: input.workspaceId, conversationId: input.conversationId,
      state: 'queued', mode: input.mode ?? 'queue', text: input.text, documents: structuredClone(input.documents), attachments: structuredClone(attachments), permission,
      ...(input.contentOutput ? { contentOutput: structuredClone(input.contentOutput) } : {}),
      model: { provider: selection.connection.provider, model: selection.model, accountId: selection.connection.accountId, billing: selection.connection.billing.kind },
      createdAt: now, updatedAt: now, digest, attachmentIds,
      start: { conversationId: current.conversationId, taskId: input.submissionId, instruction: input.text, selection, documents,
        ...(input.contentOutput ? { contentOutput: structuredClone(input.contentOutput) } : {}),
        ...(visionSelection ? { visionSelection } : {}), ...(visionUnavailableReason ? { visionUnavailableReason } : {}),
        permission, workspaceRoot: space.rootPath,
        ...(current.home ? { conversationHome: structuredClone(current.home), conversationHomeRoot: homeSpace.rootPath } : {}),
        ...(input.disclosedSettings ? { disclosedSettings: input.disclosedSettings } : {}),
        selectionSource: { role: selection.role as 'conversation' | 'vision', reason: selectionReason, profileRevision: selection.profileRevision },
        inputContext: { id: `${input.submissionId}:input`, capturedAt: now, instruction: input.text, attachments,
          context } } }
  }
  private async acceptSubmission(record: StoredExecutionSubmission, current: ConversationRecord): Promise<StoredExecutionSubmission> {
    const conversation = await this.conversations.updateConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId, expectedRevision: current.revision,
      patch: { inputDraft: '', inputAttachments: [], frozenContextRefs: this.refs(record.documents),
        title: current.title || record.text.slice(0, 30) || '附件会话', attachmentIds: [...new Set([...current.attachmentIds, ...record.attachmentIds])] } })
    return this.submissions.update(record.submissionId, { conversationRevision: conversation.revision, updatedAt: Date.now() })
  }
  private async bindRun(record: StoredExecutionSubmission, run: ExecutionRunRecord): Promise<ConversationRecord> {
    this.elementChanges.get(record.submissionId)?.bindRun(run.runId)
    let current = await this.required(record.workspaceId, record.conversationId)
    const prior = current.messages.find(message => message.messageId === record.submissionId)
    if (prior && prior.runId !== run.runId) throw new Error('执行提交已绑定到不同运行')
    const indexed = current.runIndex.builtinRunIds.includes(run.runId)
    if (!prior || !indexed) current = await this.conversations.updateConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId, expectedRevision: current.revision,
      patch: { messages: prior || record.retryOfRunId ? current.messages : [...current.messages, { messageId: record.submissionId, role: 'user', text: record.text,
          createdAt: record.createdAt, attachmentIds: record.attachmentIds, runId: run.runId }],
        runIndex: indexed ? current.runIndex : { ...current.runIndex, builtinRunIds: [...current.runIndex.builtinRunIds, run.runId] } } })
    await this.submissions.update(record.submissionId, { state: 'accepted', runId: run.runId, conversationRevision: current.revision, updatedAt: Date.now(), failure: undefined })
    return current
  }
  private async restoreFailedDraft(record: StoredExecutionSubmission): Promise<void> {
    const current = await this.required(record.workspaceId, record.conversationId)
    if (record.runId && current.runIndex.builtinRunIds.at(-1) !== record.runId) return
    if (current.inputDraft || current.inputAttachments.length) return
    await this.conversations.updateConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId, expectedRevision: current.revision,
      patch: { inputDraft: record.text, inputAttachments: record.attachments, frozenContextRefs: this.refs(record.documents) } })
  }
  private async startSubmission(record: StoredExecutionSubmission, continuation = record.continuation): Promise<StoredExecutionSubmission> {
    record = await this.submissions.update(record.submissionId, { state: 'starting', continuation, updatedAt: Date.now(), failure: undefined })
    await this.recordElementBaseline(record)
    try {
      const run = await this.engine.start(record.start, continuation, prepared => this.bindRun(record, prepared).then(() => undefined))
      return (await this.submissions.read(record.submissionId)) ?? { ...record, state: 'accepted', runId: run.runId }
    } catch (error) {
      const checkpoint = (await this.runs.list()).find(run => run.input.taskId === record.submissionId)
      if (checkpoint) {
        await this.engine.recover()
        const recovered = await this.engine.read(checkpoint.runId) ?? checkpoint
        await this.bindRun(record, recovered)
        return (await this.submissions.read(record.submissionId))!
      }
      record = await this.submissions.update(record.submissionId, { state: 'failed', updatedAt: Date.now(),
        failure: { code: 'submission-start-failed', message: error instanceof Error ? error.message : '执行提交未启动' } })
      await this.restoreFailedDraft(record).catch(() => undefined)
      return record
    }
  }
  private async startNext(conversationId: string, previous?: ExecutionRunRecord, explicit = false): Promise<void> {
    if (await this.submissions.pausedReason(conversationId)) return
    const records = (await this.submissions.list()).filter(record => record.conversationId === conversationId)
    if (records.some(record => record.state === 'starting')) return
    const current = records[0] ? await this.conversations.readConversation({ workspaceId: records[0].workspaceId, conversationId }) : null
    if (!current) {
      for (const record of records.filter(item => item.state === 'queued')) await this.retireOrphanedSubmission(record)
      return
    }
    if (await this.activeRun(current)) return
    if (!explicit) {
      const latestRunId = current.runIndex.builtinRunIds.at(-1)
      const latest = latestRunId ? await this.engine.read(latestRunId) : null
      const kind = latest?.requests.at(-1)?.failure?.kind
      if (latest && ['failed', 'partial', 'interrupted'].includes(latest.status)
        && kind && ['auth', 'quota', 'rate-limit', 'transport', 'timeout'].includes(kind)) return
    }
    const next = records.find(record => record.state === 'queued')
    if (!next) return
    const continuation = previous ? this.continuation(previous) : next.continuation
    await this.startSubmission(next, continuation)
  }
  private async continuationLineage(previous: ExecutionRunRecord): Promise<ExecutionRunRecord[]> {
    const lineage: ExecutionRunRecord[] = [], seen = new Set<string>()
    let cursor: ExecutionRunRecord | null = previous
    while (cursor) {
      if (seen.has(cursor.runId)) throw new Error('运行接续链存在循环')
      seen.add(cursor.runId); lineage.unshift(cursor)
      cursor = cursor.continuedFrom ? await this.engine.read(cursor.continuedFrom) : null
      if (lineage[0]!.continuedFrom && !cursor) throw refused('先前运行记录缺失，不能安全继续')
    }
    return lineage
  }
  /** Restore the same dirty session before preparation or a new file.open can bind its old disk image. */
  private async restoreContinuationDocuments(lineage: readonly ExecutionRunRecord[]): Promise<void> {
    const trusted = new Set(lineage.flatMap(trustedRunDocumentIds))
    const pathKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
    const conflict = () => new DesktopOperationError('execution-recovery-binding-conflict', '恢复稿与已打开文件冲突',
      '上次任务的未保存修改仍在恢复稿中，但同一文件已被另一个文档会话打开。',
      '请先处理已打开文件和恢复稿，再继续原任务；未保存修改未被覆盖。')
    const recoverable = await this.options.documents.internalAPI.recoverable()
    for (const recovery of recoverable.filter(snapshot => trusted.has(snapshot.documentId))) {
      const live = this.options.documents.registry.list()
      const recoveryPath = recovery.binding.kind === 'file' ? recovery.binding.path : null
      if (recoveryPath && live.some(snapshot => snapshot.documentId !== recovery.documentId
        && snapshot.binding.kind === 'file' && pathKey(snapshot.binding.path) === pathKey(recoveryPath))) throw conflict()
      if (!live.some(snapshot => snapshot.documentId === recovery.documentId)) {
        try { await this.options.documents.internalAPI.restore(recovery.documentId) }
        catch (error) { throw new DesktopOperationError('execution-recovery-failed', '恢复稿无法打开',
          '上次任务的未保存修改尚未恢复，原任务不能安全继续。', '请先处理文档恢复问题，再继续原任务。', { cause: error }) }
      }
    }
  }
  private async continuationDocuments(lineage: readonly ExecutionRunRecord[], documents: ExecutionDocumentReference[]): Promise<ExecutionDocumentReference[]> {
    const byId = new Map(lineage.map(run => [run.runId, run]))
    const ownRuns = new Set<string>()
    let source = lineage.at(-1)
    while (source && !ownRuns.has(source.runId)) { ownRuns.add(source.runId); source = source.taskContinuedFrom ? byId.get(source.taskContinuedFrom) : undefined }
    try {
      return await Promise.all(documents.map(reference => continueDocumentTargets(this.options.documents.registry.get(reference.documentId), reference, ownRuns)))
    } catch (error) { throw executionInputError('document-range-changed', error) }
  }

  /** Explicit resume of a user-paused queue; runs inside the conversation's serial barrier. */
  private async resumeBuiltinQueue(conversationId: string): Promise<void> {
    await this.awaitRecoveryAndRebind()
    await this.submissions.resume(conversationId)
    await this.startNext(conversationId, undefined, true)
  }
  private async send(input: ExecutionSendInput): Promise<ExecutionSendResult> {
    // Submit paths consult durable run state and the engine; they must see the recovery of any prior run.
    await this.awaitRecoveryAndRebind()
    const digest = this.digest(input), existing = await this.submissions.read(input.submissionId)
    if (existing) {
      if (existing.digest !== digest || existing.workspaceId !== input.workspaceId || existing.conversationId !== input.conversationId) throw executionInputError('submission-conflict')
      return this.submissionResult(existing)
    }
    let previous: ExecutionRunRecord | null = null
    if (input.retryOfRunId) {
      previous = await this.engine.read(input.retryOfRunId)
      const source = previous ? await this.submissions.read(previous.input.taskId) : null
      if (!previous || !source || source.runId !== previous.runId || source.workspaceId !== input.workspaceId
        || source.conversationId !== input.conversationId || !['failed', 'partial', 'interrupted'].includes(previous.status))
        throw refused('原任务尚不可继续，请先核对运行状态')
      if (input.text !== source.text || JSON.stringify(input.documents) !== JSON.stringify(source.documents)
        || JSON.stringify(input.contentOutput ?? null) !== JSON.stringify(source.contentOutput ?? null)
        || JSON.stringify(input.attachments ?? []) !== JSON.stringify(source.attachments)
        || (input.permission ?? DEFAULT_PERMISSION_MODE) !== (source.permission ?? DEFAULT_PERMISSION_MODE))
        throw refused('继续运行必须使用原任务冻结的文字、目标和附件')
      const child = (await this.submissions.list()).find(record => record.retryOfRunId === previous!.runId
        && (record.state !== 'failed' || Boolean(record.runId)))
      if (child) return this.submissionResult(child)
    }
    const current = await this.required(input.workspaceId, input.conversationId)
    if (current.revision !== input.expectedRevision) throw executionInputError('conversation-draft-changed')
    if (previous && await this.activeRun(current)) throw refused('当前会话仍有运行中的任务，请等待结束后继续原任务')
    if (previous && (current.inputDraft && current.inputDraft !== input.text
      || current.inputAttachments.length && JSON.stringify(current.inputAttachments) !== JSON.stringify(input.attachments ?? [])
      || JSON.stringify(current.frozenContextRefs) !== JSON.stringify(this.refs(input.documents))))
      throw refused('输入框已有另一份草稿，请先处理后再继续原任务')
    this.timing(input.conversationId, input.submissionId, `${input.submissionId}:prepare:start`, 'submission.prepare.started')
    let record: StoredExecutionSubmission
    try {
      const lineage = previous ? await this.continuationLineage(previous) : null
      if (lineage) await this.restoreContinuationDocuments(lineage)
      const preparedInput = lineage ? { ...input, documents: await this.continuationDocuments(lineage, input.documents) } : input
      if (lineage && input.contentOutput) {
        const output = input.contentOutput
        const original = input.documents.find(document => document.documentId === output.documentId)
        const index = original?.selection?.findIndex(target => JSON.stringify(target) === JSON.stringify(output.target)) ?? -1
        const target = preparedInput.documents.find(document => document.documentId === output.documentId)?.selection?.[index]
        if (!target) throw refused('原正文改写范围无法继续，请重新选择。')
        preparedInput.contentOutput = { ...output, target: structuredClone(target) }
      }
      record = await this.prepareSubmission(preparedInput, current, digest)
      if (previous) {
        // The public submission remains the user's original frozen payload so
        // lost ACK confirmation computes the same digest with the same ID.
        record.documents = structuredClone(input.documents)
        if (input.contentOutput) record.contentOutput = structuredClone(input.contentOutput)
        record.retryOfRunId = previous.runId
        record.continuation = { ...this.continuation(previous), sameTask: true }
        if (previous.input.inputContext && record.start.inputContext)
          record.start.inputContext.context = structuredClone(previous.input.inputContext.context)
        record.start.workspaceRoot = previous.input.workspaceRoot
        record.start.conversationHome = previous.input.conversationHome
        record.start.conversationHomeRoot = previous.input.conversationHomeRoot
      }
      this.timing(input.conversationId, input.submissionId, `${input.submissionId}:prepare:end`, 'submission.prepare.finished', { detail: { outcome: 'completed' } })
    } catch (error) {
      this.timing(input.conversationId, input.submissionId, `${input.submissionId}:prepare:failed`, 'submission.prepare.finished', { detail: { outcome: 'failed' } })
      throw error
    }
    record = (await this.submissions.create(record)).record
    try { record = await this.acceptSubmission(record, current) }
    catch (error) {
      record = await this.submissions.update(record.submissionId, { state: 'failed', updatedAt: Date.now(),
        failure: { code: 'submission-accept-failed', message: error instanceof Error ? error.message : '提交未接受' } })
      return this.submissionResult(record)
    }
    if (previous) {
      record = await this.startSubmission(record, record.continuation)
      return this.submissionResult(record)
    }
    const active = await this.activeRun(await this.required(input.workspaceId, input.conversationId))
    if (active && record.mode === 'queue') return this.submissionResult(record)
    if (active && record.mode === 'adjust') {
      const stopped = await this.engine.stop(active.runId)
      if (!stopped || ['queued', 'running', 'stopping'].includes(stopped.status)) throw refused('当前任务尚未停止，立即调整仍在等待')
      record = await this.submissions.update(record.submissionId, { continuation: this.continuation(stopped), updatedAt: Date.now() })
      record = await this.startSubmission(record, record.continuation)
      return this.submissionResult(record)
    }
    await this.startNext(record.conversationId, undefined, true)
    return this.submissionResult((await this.submissions.read(record.submissionId))!)
  }
  private async collectReply(run: ExecutionRunRecord) {
    const runId = run.runId
    for (const workspace of await this.conversations.listWorkspaces()) {
      const current = await this.conversations.readConversation({ workspaceId: workspace.workspaceId, conversationId: run.input.conversationId })
      if (!current || current.messages.some(message => message.role === 'assistant' && message.runId === runId)) continue
      const last = [...run.messages].reverse().find(message => message.role === 'assistant' && typeof message.content === 'string' && message.content)
      if (!last || typeof last.content !== 'string') return
      await this.conversations.updateConversation({ workspaceId: workspace.workspaceId, conversationId: current.conversationId, expectedRevision: current.revision,
        patch: { messages: [...current.messages, { messageId: randomUUID(), role: 'assistant', text: last.content, createdAt: Date.now(), attachmentIds: [], runId }] } })
    }
  }
  /**
   * Runs in the conversation's serial queue, entered when the end is published. Conversation reads wait in the same
   * queue, so a view reading the record after it saw run.end gets everything written here: the restored input, the
   * reply and the next queued request.
   */
  private async afterRunEnd(runId: string): Promise<void> {
    const run = await this.engine.read(runId)
    if (!run) return
    if (['failed', 'partial', 'interrupted'].includes(run.status)) {
      const record = await this.submissions.read(run.input.taskId)
      if (record?.runId === runId && record.state === 'accepted') await this.restoreFailedDraft(record)
    }
    await this.collectReply(run)
    await this.startNext(run.input.conversationId, run)
  }
  private runWritesDocument(run: ExecutionRunRecord, documentId: string): boolean {
    if (run.input.documents.some(document => document.documentId === documentId && document.writable.length > 0)) return true
    // Only host-returned file receipts count; model parameters never confer write authority.
    return run.tools.some(tool => {
      if (tool.state !== 'returned') return false
      if (tool.result?.kind === 'document-operation') return tool.result.result.documentId === documentId
      if (tool.call.name !== 'file.open' && !fileCreated(tool.call.name, tool.result)) return false
      const data = tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object'
        ? tool.result.data as { documentId?: unknown; writable?: unknown } : null
      return data?.documentId === documentId && data.writable === true
    })
  }
  async writableTasksForDocument(documentId: string): Promise<{ runIds: string[]; submissionIds: string[] }> {
    // Closing one document must not initialize/rebind every conversation in the profile.
    await this.awaitRecoveryAndRebind()
    const submissions = await this.submissions.list()
    const submissionIds = submissions.filter(record => ['queued', 'starting'].includes(record.state)
      && record.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(record => record.submissionId)
    const runIds = new Set(this.options.documents.tools.writableRunIdsForDocument(documentId))
    for (const stored of await this.runs.list()) {
      const run = await this.engine.read(stored.runId) ?? stored
      if (['queued', 'running', 'stopping'].includes(run.status) && this.runWritesDocument(run, documentId)) runIds.add(run.runId)
    }
    return { runIds: [...runIds], submissionIds }
  }
  async stopTasksForDocument(documentId: string): Promise<{ runIds: string[]; submissionIds: string[] }> {
    await this.awaitRecoveryAndRebind()
    const records = await this.submissions.list(), runs = await this.runs.list()
    const activeIds = this.options.documents.tools.writableRunIdsForDocument(documentId)
    for (const runId of activeIds) if (!runs.some(run => run.runId === runId)) {
      const run = await this.engine.read(runId)
      if (run) runs.push(run)
    }
    const conversationIds = [...new Set([
      ...records.filter(record => record.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(record => record.conversationId),
      ...runs.filter(run => activeIds.includes(run.runId) || this.runWritesDocument(run, documentId)).map(run => run.input.conversationId),
    ])]
    const cancelled: string[] = [], stopped: string[] = []
    for (const conversationId of conversationIds) await this.serial(conversationId, async () => {
      for (const record of await this.submissions.list()) if (record.conversationId === conversationId && record.state === 'queued'
        && record.documents.some(document => document.documentId === documentId && document.writable.length > 0)) {
        await this.submissions.update(record.submissionId, { state: 'cancelled', updatedAt: Date.now(),
          failure: { code: 'document-close-cancelled', message: '已取消：关联文档正在关闭。' } })
        cancelled.push(record.submissionId)
      }
      const granted = new Set(this.options.documents.tools.writableRunIdsForDocument(documentId))
      for (const stored of await this.runs.list()) {
        const live = await this.engine.read(stored.runId) ?? stored
        if (live.input.conversationId !== conversationId || !['queued', 'running', 'stopping'].includes(live.status)) continue
        if (!granted.has(live.runId) && !this.runWritesDocument(live, documentId)) continue
        await this.engine.stop(live.runId)
        stopped.push(live.runId)
      }
    })
    return { runIds: stopped, submissionIds: cancelled }
  }
  /** Deletes a conversation with everything it holds (runs stopped, external grants revoked, resources released). */
  private async removeConversation(input: { workspaceId: string; conversationId: string; expectedRevision: number }): Promise<void> {
    let prepared = false
    try {
      const record = await this.required(input.workspaceId, input.conversationId)
      await this.conversations.deleteConversation({ ...input, ports: {
        stopBuiltinRuns: async ({ runIds }) => { await Promise.all(runIds.map(runId => this.engine.stop(runId))) },
        // Resident external sessions only log into the conversation; without the service there is nothing live to release.
        revokeExternalPorts: async ({ workspaceId, conversationId, portIds }) => {
          if (portIds.length) await this.externalRevoker?.({ workspaceId, conversationId, portIds: [...portIds] })
        },
        prepareResourceRelease: async owner => {
          await this.imageRetention?.prepare(owner); prepared = !!this.imageRetention
          await this.attachments.prepareConversationRelease({ version: 1, workspaceId: owner.workspaceId, conversationId: owner.conversationId,
            attachmentIds: conversationAttachmentIds(record) })
        },
      } })
      this.imageRetention?.collect()
      for (const [submissionId, change] of this.elementChanges) if (change.conversationId === input.conversationId) { change.dispose(); this.elementChanges.delete(submissionId) }
      // Deletion is already durable. A failed sweep keeps its intent for startup retry.
      await this.collectAttachmentReleases().catch(() => undefined)
    } catch (error) {
      if (prepared) this.imageRetention?.abort(input)
      throw error
    }
  }
  /**
   * M15: element AI cards live only while their document is open. Clears the cards of one document (all of them
   * without an id, at startup); their queued requests are cancelled first so nothing starts afterwards.
   */
  async clearElementConversations(documentId?: string): Promise<void> {
    await this.ready()
    await this.awaitRecoveryAndRebind()
    await this.clearElementCards(documentId)
  }
  private async clearElementCards(documentId?: string): Promise<void> {
    for (const workspace of await this.conversations.listWorkspaces())
      for (const record of await this.conversations.listConversations(workspace.workspaceId)) {
        if (!record.element || (documentId !== undefined && record.element.documentId !== documentId)) continue
        await this.serial('attachment-lifecycle', () => this.serial(record.conversationId, async () => {
          for (const submission of await this.submissions.list())
            if (submission.conversationId === record.conversationId && submission.state === 'queued')
              await this.submissions.update(submission.submissionId, { state: 'cancelled', updatedAt: Date.now(),
                failure: { code: 'element-card-closed', message: '已取消：元素 AI 卡已随文件关闭。' } })
          const current = await this.conversations.readConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId })
          if (current?.inputDraft.trim() || current?.inputAttachments.length) {
            for (const runId of current.runIndex.builtinRunIds) await this.engine.stop(runId)
            const latest = await this.conversations.readConversation(current)
            if (latest) await this.conversations.recoverElementDraft({ workspaceId: latest.workspaceId,
              conversationId: latest.conversationId, expectedRevision: latest.revision })
          } else if (current) await this.removeConversation({ workspaceId: current.workspaceId, conversationId: current.conversationId, expectedRevision: current.revision })
        }))
      }
  }
  /** Subscribe before the run starts; only durable commits with that run identity count. */
  private async recordElementBaseline(record: StoredExecutionSubmission): Promise<void> {
    this.elementChanges.get(record.submissionId)?.dispose()
    try {
      const conversation = await this.conversations.readConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId })
      const reference = conversation?.element && record.documents.find(value => value.documentId === conversation.element!.documentId)
      const target = reference?.writable.length === 1 ? reference.writable[0] : undefined
      if (!reference || !target || target.kind === 'document') return
      const session = this.options.documents.registry.get(reference.documentId), snapshot = await session.drain()
      this.elementChanges.set(record.submissionId, new ElementChangeTracker(record.conversationId, reference.documentId, target, session, snapshot))
    } catch { /* A card's optional inverse never blocks the actual task. */ }
  }
  private recordElementResult(submissionId: string): void { this.elementChanges.get(submissionId)?.finish() }
  private elementChangeView(submissionId: string): ElementChangeView {
    return this.elementChanges.get(submissionId)?.view(submissionId) ?? { submissionId, state: 'none', fields: [] }
  }
  private async revertElement(input: { submissionId: string; direction: 'undo' | 'redo'; force?: boolean }): Promise<ElementRevertResult> {
    return this.elementChanges.get(input.submissionId)?.revert(input.submissionId, input.direction, input.force)
      ?? { status: 'unavailable', message: '没有可定位的卡片修改，请查看文档历史。' }
  }
  async operate(raw: unknown): Promise<unknown> {
    const received = captureMainTiming()
    try {
      await this.ready()
      const input = executionDesktopRequestSchema.parse(raw)
      // Cold-start ready may return while background recovery is still walking the run history. The fast
      // bootstrap cases below do not consult recovered state and may proceed; every other operation awaits
      // recovery so it observes the same durable truth as before the async split.
      if (!['workspace', 'conversations', 'create-conversation'].includes(input.type)) await this.awaitRecoveryAndRebind()
      switch (input.type) {
        case 'workspace': return await this.serial('workspace', () => this.workspace(input.root))
        case 'conversations': return listed(await this.conversations.listConversations(input.workspaceId))
        case 'create-conversation': return await this.conversations.createConversation({ ...input,
          ...(input.home ? { home: await this.validateHome(input.workspaceId, input.home) } : {}),
          ...(input.element ? { element: input.element } : {}) })
        case 'set-conversation-home': return await this.serial(input.conversationId, async () => this.conversations.setConversationHome({ ...input,
          home: input.home ? await this.validateHome(input.workspaceId, input.home) : null }))
        // Behind Main's own writes queued on this conversation (a task's end, a send), so the record read is final.
        case 'conversation': return await this.serial(input.conversationId, () => this.conversations.readConversation(input))
        case 'prepare-documents': return await this.serial(input.conversationId, () => this.prepareDocuments(input))
        case 'draft': return await this.serial('attachment-lifecycle', () => this.serial(input.conversationId, async () => {
          for (const ref of input.attachments) {
            if (ref.delivery === 'source') {
              const snapshot = await this.attachments.readSnapshot(ref.attachmentId)
              if (!snapshot.representations.some(rep => rep.id === ref.representationId)) throw executionInputError('attachment-unavailable')
            } else await this.attachments.readRepresentation(ref.attachmentId, ref.representationId)
          }
          // An older revision is the same refusal as at send time; its fixed reason lets the composer re-read and save again.
          return this.conversations.updateConversation({ ...input, patch: { inputDraft: input.text, inputAttachments: input.attachments, frozenContextRefs: this.refs(input.documents) } })
            .catch(error => { throw error instanceof ConversationStoreError && error.code === 'revision-conflict' ? executionInputError('conversation-draft-changed', error) : error })
        }))
        case 'rename-conversation': return await this.serial(input.conversationId, () => this.conversations.updateConversation({ ...input, patch: { title: input.title } }))
        case 'delete-conversation': return await this.serial('attachment-lifecycle', () => this.serial(input.conversationId, () => this.removeConversation(input)))
        case 'send': {
          if (input.clientTiming) {
            this.rendererTiming(input.conversationId, input.submissionId, `${input.submissionId}:renderer:click`,
              'renderer.submit.clicked', input.clientTiming.click)
            this.rendererTiming(input.conversationId, input.submissionId, `${input.submissionId}:renderer:invoke`,
              'renderer.send.invoked', input.clientTiming.invoke)
          }
          // Each process keeps its own monotonic axis. timeOrigin only estimates their zero-point offset;
          // never subtract raw renderer/Main performance.now values as an exact latency.
          this.timing(input.conversationId, input.submissionId, `${input.submissionId}:received`, 'submit.received',
            input.clientTiming ? { detail: { clockOffsetEstimateMs: performance.timeOrigin - input.clientTiming.invoke.timeOriginMs,
              clockOffsetMethod: 'timeOrigin' } } : {}, received)
          return await this.serial('attachment-lifecycle', () => this.serial(input.conversationId, () => this.send(input)))
        }
        case 'timing': {
          const record = await this.submissions.read(input.submissionId)
          if (record?.workspaceId === input.workspaceId && record.conversationId === input.conversationId && record.runId)
            this.rendererTiming(input.conversationId, input.submissionId, `${input.submissionId}:renderer:first-visible`,
              input.stage, input.stamp, { itemId: input.itemId })
          return
        }
        case 'submission': {
          const record = await this.submissions.read(input.submissionId)
          return record && record.workspaceId === input.workspaceId && record.conversationId === input.conversationId ? await this.publicSubmission(record) : null
        }
        case 'submissions': return await Promise.all((await this.submissions.list()).filter(record => record.workspaceId === input.workspaceId && record.conversationId === input.conversationId).map(record => this.publicSubmission(record)))
        case 'run-queued': return await this.serial(input.conversationId, async () => {
          await this.awaitRecoveryAndRebind()
          let record = await this.submissions.read(input.submissionId)
          if (!record || record.workspaceId !== input.workspaceId || record.conversationId !== input.conversationId) throw refused('排队消息不属于当前会话')
          if (record.state !== 'queued') return this.submissionResult(record)
          const current = await this.required(input.workspaceId, input.conversationId), active = await this.activeRun(current)
          if (active) {
            const stopped = await this.engine.stop(active.runId)
            if (!stopped || ['queued', 'running', 'stopping'].includes(stopped.status)) throw refused('当前任务尚未停止，排队消息仍保留')
            record = await this.submissions.update(record.submissionId, { continuation: this.continuation(stopped), updatedAt: Date.now() })
          }
          // The accepted payload and identity are reused. The user's newer composer draft is not touched.
          return this.submissionResult(await this.startSubmission(record, record.continuation))
        })
        case 'delete-submission': return await this.serial(input.conversationId, async () => {
          const record = await this.submissions.read(input.submissionId)
          if (!record || record.workspaceId !== input.workspaceId || record.conversationId !== input.conversationId) throw refused('排队消息不存在')
          if (record.state !== 'queued') throw refused('只有尚未启动的排队消息可以删除')
          return this.publicSubmission(await this.submissions.update(record.submissionId, { state: 'cancelled', updatedAt: Date.now(),
            failure: { code: 'cancelled-by-user', message: '已从队列移除。' } }))
        })
        case 'pause-queue': return await this.serial(input.conversationId, async () => {
          await this.required(input.workspaceId, input.conversationId)
          await this.submissions.pause(input.conversationId)
        })
        case 'resume-queue': return await this.serial(input.conversationId, async () => {
          await this.required(input.workspaceId, input.conversationId)
          await this.resumeBuiltinQueue(input.conversationId)
        })
        case 'browser-viewport': {
          const owner = await this.required(input.workspaceId, input.conversationId)
          const record = await this.engine.read(input.runId)
          if (!owner.runIndex.builtinRunIds.includes(input.runId) || record?.input.conversationId !== owner.conversationId)
            throw refused('浏览器不属于当前会话')
          const { viewportWorkbenchBrowser } = await import('../workbenchToolServices.js')
          return await viewportWorkbenchBrowser(input.runId, { visible: input.visible, ...(input.bounds ? { bounds: input.bounds } : {}) })
        }
        case 'browser-control': {
          const owner = await this.required(input.workspaceId, input.conversationId)
          const record = await this.engine.read(input.runId)
          if (!owner.runIndex.builtinRunIds.includes(input.runId) || record?.input.conversationId !== owner.conversationId)
            throw refused('浏览器不属于当前会话')
          const { controlWorkbenchBrowser } = await import('../workbenchToolServices.js')
          try {
            if (input.action === 'status') return await controlWorkbenchBrowser(input.runId, 'status')
            const state = await controlWorkbenchBrowser(input.runId, 'status')
            if (input.action === 'takeover' && state.state === 'agent' && !state.pageUrl)
              throw new Error('本任务尚未打开可接管的网页。')
            await this.engine.pauseForBrowser(input.runId, true)
            const result = await controlWorkbenchBrowser(input.runId, input.action)
            if (input.action === 'resume') await this.engine.pauseForBrowser(input.runId, false)
            return result
          } catch (cause) {
            if (input.action === 'takeover') {
              const state = await controlWorkbenchBrowser(input.runId, 'status').catch(() => null)
              if (state?.state === 'agent') await this.engine.pauseForBrowser(input.runId, false)
            }
            throw new DesktopOperationError('browser-control-failed', '浏览器控制未完成',
              input.action === 'resume' ? '浏览器暂未返回助手控制。' : '受管浏览器暂时无法接管或读取。',
              '任务和输入已保留，可重试接管或继续任务，也可停止任务。', { cause })
          }
        }
        case 'run': return await this.engine.read(input.runId)
        case 'change-review': {
          const { run } = await this.changeReviewSource(input)
          return await this.changeReview.inspect(run, { offset: input.offset, limit: input.limit })
        }
        case 'change-rollback': return await this.serial(`change-review:${input.runId}`, async () => {
          const { run, workspaceRoot } = await this.changeReviewSource(input)
          if (!['completed', 'partial', 'failed', 'stopped'].includes(run.status))
            throw refused('任务仍在运行，请先等待结束或停止后再回退')
          return this.changeReview.rollback(run, input.entryId, { workspaceRoot, permission: DEFAULT_PERMISSION_MODE })
        })
        case 'checkpoint': return (await this.checkpointSource(input)).checkpoint
        case 'fork-checkpoint': return await this.serial(input.conversationId, async () => {
          const { run, checkpoint } = await this.checkpointSource(input)
          const fork = forkDraftFromCheckpoint({ source: checkpoint, run, instruction: input.instruction })
          const conversation = await this.conversations.createConversation({ workspaceId: input.workspaceId,
            title: fork.title, inputDraft: fork.inputDraft })
          return { conversation, fork }
        })
        case 'stop': await this.awaitRecoveryAndRebind(); return await this.engine.stop(input.runId)
        case 'approve': try { return await this.engine.decide(input) }
          catch (error) { throw new DesktopOperationError('execution-approval-rejected', '决定没有提交', error instanceof Error ? error.message : '这次修改暂时不能处理。', '修改仍在等待时可以重新选择；任务已停止或结束时，需要重新发送任务。', { cause: error }) }
        case 'answer': try { return await this.engine.answer(input) }
          catch (error) { throw new DesktopOperationError('execution-answer-rejected', '回答没有提交', error instanceof Error ? error.message : '这个问题暂时不能回答。', '问题仍在等待时可以重新选择；任务已停止或结束时，需要重新发送任务。', { cause: error }) }
        case 'events': return await this.events.readPage(input)
        case 'search-events': return await this.events.search(input)
        case 'timeline': return await this.events.snapshot(input.conversationId)
        case 'blob': return Buffer.from(await this.events.readBlob(input.conversationId, input.ref)).toString('utf8')
        case 'edits': return await this.edits.list(input.documentId)
        case 'element-change': return this.elementChangeView(input.submissionId)
        case 'element-revert': return await this.revertElement(input)
      }
    } catch (error) {
      // Each branch above awaits its result (most settle later in a serial queue), so every failure reaches this mapping.
      throw operationFailure(error, raw && typeof raw === 'object' ? (raw as { type?: unknown }).type : undefined)
    }
  }
}

let singleton: Promise<ExecutionDesktopService> | undefined
export function executionDesktopService(): Promise<ExecutionDesktopService> {
  return singleton ??= (async () => {
    const [{ app }, { documentHost }, { executionSettingsStore }, { operateWorkspaceFiles }, { attachmentsDesktopService }] = await Promise.all([
      import('electron'), import('../documentHost.js'), import('../providers/executionSettingsService.js'), import('../workspaceFilesDesktopService.js'), import('../attachments/attachmentsDesktopService.js'),
    ])
    await app.whenReady()
    return new ExecutionDesktopService({ directory: path.join(app.getPath('userData'), 'workbench-v2'), documents: documentHost(), settings: await executionSettingsStore(),
      attachments: (await attachmentsDesktopService()).attachments, authorizeWorkspaceRoot: root => operateWorkspaceFiles({ type: 'root', directory: root }) })
  })().catch(error => { singleton = undefined; throw error })
}
