import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { executionDesktopRequestSchema, matchesDisclosedSelection, type ConversationHomeInput, type ExecutionDocumentReference, type ExecutionSendInput, type ExecutionSendResult, type ExecutionSubmissionRecord, type RendererTimingStamp } from '../../../shared/workbench/executionDesktop'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ExecutionEvent, ExecutionEventInput } from '../../../shared/workbench/executionEvents'
import type { EditEvent } from '../../../shared/workbench/editSession'
import type { ModelChatMessage, ModelProvider } from '../../../shared/workbench/modelProvider'
import { EXECUTION_NO_PROGRESS, MODEL_REQUEST_BUDGET_EXHAUSTED, TOOL_CALL_BUDGET_EXHAUSTED, type ExecutionRunRecord } from '../../../shared/workbench/execution'
import { PayloadCompiler } from '../../../core/execution/PayloadCompiler'
import { AttachmentError, AttachmentService, type AttachmentLiveConversation } from '../attachments/AttachmentService'
import { ExecutionSettingsError, type ExecutionSettingsStore } from '../providers/ExecutionSettingsStore'
import type { DocumentHostService } from '../DocumentHostService'
import { ConversationStore } from '../conversations/ConversationStore'
import { ExecutionEngine } from './ExecutionEngine'
import { ExecutionRunStore } from './ExecutionRunStore'
import { captureMainTiming, ExecutionEventStore, type ExecutionTimingMark, type ExecutionTimingStage } from './ExecutionEventStore'
import { ExecutionSubmissionStore, type StoredExecutionSubmission } from './ExecutionSubmissionStore'
import { EditSessionService } from './EditSessionService'
import { OpenAIChatProvider, serializeModelRequest } from '../providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, serializeChatGPTResponsesRequest } from '../providers/ChatGPTResponsesProvider'
import { DesktopOperationError } from '../../errors'
import { DEFAULT_PERMISSION_MODE } from '../../../shared/workbench/executionPermission'
import { executionInputError } from './executionInputErrors'
import { AgentFileService } from './AgentFileService'
import { diagnosticLog } from '../../diagnosticLog'

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
/** Main owns spaces, task freezes and runs. Mounting a view only reads/subscribes. */
export class ExecutionDesktopService {
  readonly conversations: ConversationStore
  readonly engine: ExecutionEngine
  readonly runs: ExecutionRunStore
  readonly events: ExecutionEventStore
  readonly submissions: ExecutionSubmissionStore
  readonly edits: EditSessionService
  readonly attachments: AttachmentService
  private readonly queues = new Map<string, Promise<unknown>>()
  private eventSink?: (event: ExecutionEvent) => void
  private editSink?: (event: EditEvent) => void
  private externalRevoker?: (input: { workspaceId: string; conversationId: string; portIds: string[] }) => Promise<void>
  private imageRetention?: {
    prepare(input: { workspaceId: string; conversationId: string; runIds: readonly string[] }): Promise<void>
    abort(input: { workspaceId: string; conversationId: string }): void
    collect(): void
  }
  private initialization?: Promise<void>
  constructor(private readonly options: ExecutionDesktopServiceOptions) {
    this.conversations = new ConversationStore({ directory: path.join(options.directory, 'conversations') })
    this.runs = new ExecutionRunStore(path.join(options.directory, 'runs'))
    this.events = new ExecutionEventStore({ directory: path.join(options.directory, 'events') })
    this.submissions = new ExecutionSubmissionStore(path.join(options.directory, 'submissions'))
    this.edits = new EditSessionService(options.documents.registry, options.documents.tools)
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
    const provider: ModelProvider = { stream: (request, callOptions) => (request.selection.connection.protocol === 'chatgpt-responses' ? oauth : chat).stream(request, callOptions) }
    const serializePayload: typeof serializeModelRequest = input => input.selection.connection.protocol === 'chatgpt-responses' ? serializeChatGPTResponsesRequest(input) : serializeModelRequest(input)
    this.engine = new ExecutionEngine({ registry: options.documents.registry, gateway: options.documents.tools, runs: this.runs, events: this.events,
      edits: this.edits, provider, serializePayload, initialCompiler: new PayloadCompiler({ attachments: this.attachments, serializePayload }),
      files: new AgentFileService(options.documents),
      readImageTiming: async jobId => (await import('../workbenchToolServices.js')).workbenchImageService().readTiming(jobId),
      observeBodyStreaming: (selection, observation) => options.settings.recordBodyStreaming(selection, observation) })
    this.engine.subscribe(event => {
      this.eventSink?.(event)
      if (event.type === 'run.end') void this.afterRunEnd(event.runId).catch(() => undefined)
    })
    this.edits.subscribe(event => this.editSink?.(event))
  }
  setSinks(events?: (event: ExecutionEvent) => void, edits?: (event: EditEvent) => void) { this.eventSink = events; this.editSink = edits }
  withConversation<T>(conversationId: string, action: () => Promise<T>): Promise<T> { return this.serial(conversationId, action) }
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
    return this.initialization ??= (async () => {
      let runs = await this.runs.list()
      for (const record of runs.filter(run => ['queued', 'running', 'stopping'].includes(run.status))) {
        for (const reference of record.input.documents) {
          if (!this.options.documents.registry.list().some(document => document.documentId === reference.documentId)) {
            // Preserve the durable identity needed for receipt lookup. A conflicting open binding remains an explicit gap.
            await this.options.documents.internalAPI.restore(reference.documentId).catch(() => undefined)
          }
        }
      }
      await this.engine.recover()
      runs = await this.runs.list()
      const submissions = await this.submissions.list()
      for (let record of submissions.filter(value => value.state === 'starting' || value.state === 'accepted')) {
        const run = runs.find(value => value.input.taskId === record.submissionId)
        if (run) await this.bindRun(record, run)
        else if (record.state === 'starting') await this.submissions.update(record.submissionId, { updatedAt: Date.now(),
          failure: { code: 'submission-outcome-unknown', message: '应用中断时启动结果未知；未自动重发，请核对后重试新消息。' } })
      }
      const queuedConversations = [...new Set(submissions.filter(value => value.state === 'queued').map(value => value.conversationId))]
      for (const conversationId of queuedConversations) await this.serial(conversationId, () => this.startNext(conversationId))
      // A release intent written before a prior crash is reconciled only after run and
      // submission recovery has rebuilt the current conversation references.
      await this.collectAttachmentReleases().catch(() => undefined)
    })()
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
    if (!record) throw new Error('会话已不存在')
    return record
  }
  private async workspace(root: string | null) {
    const rootPath = root ? (await this.options.authorizeWorkspaceRoot(root)).resolvedPath : path.join(this.options.directory, 'space')
    if (!root) await fs.mkdir(rootPath, { recursive: true })
    const canonical = await fs.realpath(rootPath), key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
    const existing = (await this.conversations.listWorkspaces()).find(space => key(space.rootPath) === key(canonical))
    const workspace = existing ?? await this.conversations.registerWorkspace({ workspaceId: randomUUID(), rootPath: canonical, managed: root === null, authorization: root === null ? 'managed' : 'user-selected' })
    return { workspace, conversations: await this.conversations.listConversations(workspace.workspaceId) }
  }
  private async validateHome(workspaceId: string, home: ConversationHomeInput): Promise<ConversationHomeInput> {
    const space = await this.conversations.readWorkspace(workspaceId)
    if (!space) throw new Error('会话工作空间不存在')
    const root = await fs.realpath(space.rootPath)
    const candidate = await fs.realpath(path.join(root, ...home.path.split('/')))
    const relative = path.relative(root, candidate)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('会话所属位置不在工作空间内')
    const stat = await fs.stat(candidate)
    if (home.kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw new Error('会话所属位置类型已改变')
    return { kind: home.kind, path: relative.split(path.sep).join('/') }
  }
  private refs(documents: ExecutionDocumentReference[]) {
    return documents.map(document => ({ contextRefId: document.documentId, documentId: document.documentId, epoch: document.epoch, revision: document.revision, writeScope: document.writable, ...(document.selection?.length ? { selection: document.selection } : {}) }))
  }
  private digest(input: ExecutionSendInput): string {
    return createHash('sha256').update(JSON.stringify({ workspaceId: input.workspaceId, conversationId: input.conversationId,
      text: input.text, documents: input.documents, attachments: input.attachments ?? [], mode: input.mode ?? 'queue',
      retryOfRunId: input.retryOfRunId ?? null, permission: input.permission ?? DEFAULT_PERMISSION_MODE })).digest('hex')
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
  private async prepareSubmission(input: ExecutionSendInput, current: ConversationRecord, digest: string): Promise<StoredExecutionSubmission> {
    const attachments = input.attachments ?? []
    // Main owns the permission level: read-only tasks receive no writable scope whatever the renderer sent.
    const permission = input.permission ?? DEFAULT_PERMISSION_MODE
    const space = await this.conversations.readWorkspace(current.workspaceId)
    if (!space) throw new Error('会话工作空间不存在')
    const homeWorkspaceId = current.home?.workspaceId ?? current.workspaceId
    const homeSpace = homeWorkspaceId === current.workspaceId ? space : await this.conversations.readWorkspace(homeWorkspaceId)
    if (!homeSpace) throw new Error('会话所属位置的工作空间不存在')
    // A file home is the default document context only when the teacher did not pin another reference.
    // The binding is resolved by Main through the formal DocumentHost; home metadata itself grants no write.
    if (!input.documents.length && current.home?.kind === 'file' && !current.home.missing) {
      const candidate = path.join(homeSpace.rootPath, ...current.home.path.split('/'))
      let resolved: string | undefined
      try { resolved = await fs.realpath(candidate) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // A move may be between its disk mutation and home-index update. Do not
        // mark the old path missing here: that would race the successful rebase.
        throw executionInputError('home-file-missing', error)
      }
      if (resolved) {
        const relative = path.relative(homeSpace.rootPath, resolved)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error('会话所属文件已移出获准的工作空间')
        const snapshot = await this.options.documents.internalAPI.open(resolved)
        input = { ...input, documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
          writable: permission === 'read-only' ? [] : [{ kind: 'document' }] }] }
      }
    }
    if (permission === 'read-only') input = { ...input, documents: input.documents.map(document => ({ ...document, writable: [] })) }
    if (!input.text.trim() && !attachments.length) throw executionInputError('empty-input')
    let hasImages = false, imageCount = 0, representationBytes = 0
    this.timing(input.conversationId, input.submissionId, `${input.submissionId}:attachments:start`, 'submission.attachments.started',
      { detail: { attachmentCount: attachments.length } })
    try {
      for (const reference of attachments) {
        const read = await this.attachments.readRepresentation(reference.attachmentId, reference.representationId).catch(error => {
          if (error instanceof AttachmentError && ['representation-unavailable', 'corrupt-snapshot', 'corrupt-blob'].includes(error.code)
            || (error as NodeJS.ErrnoException)?.code === 'ENOENT') throw executionInputError('attachment-unavailable', error)
          throw error
        })
        representationBytes += read.bytes.byteLength
        if (read.representation.kind === 'image') { hasImages = true; imageCount++ }
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
      if (snapshot.revision !== reference.revision && (reference.selection?.length || reference.writable.some(target => target.kind !== 'document'))) throw executionInputError('document-range-changed')
      documents.push({ documentId: reference.documentId, writable: reference.writable, ...(reference.selection?.length ? { selection: reference.selection } : {}) })
    }
    const history = current.messages.filter(message => message.role === 'user' || message.role === 'assistant')
    const context: ModelChatMessage[] = []
    for (const message of history) {
      if (message.role === 'user' && message.attachmentIds.length) {
        const previous = message.runId ? await this.engine.read(message.runId) : null
        const index = previous?.initialPayload?.explicitAttachments[0]?.messageIndex
        const payload = previous && index !== undefined ? previous.messages[index] : undefined
        if (!payload || payload.role !== 'user') throw executionInputError('history-attachment-missing')
        context.push(structuredClone(payload))
        if (Array.isArray(payload.content) && payload.content.some(part => part && typeof part === 'object' && !Array.isArray(part) && part.type === 'image_url')) hasImages = true
      } else context.push({ role: message.role, content: message.text })
    }
    const select = async (role: 'conversation' | 'vision') => this.options.settings.snapshot(role).catch(error => {
      if (error instanceof ExecutionSettingsError && error.code === 'role-unconfigured') throw executionInputError(role === 'vision' ? 'vision-unconfigured' : 'conversation-unconfigured', error)
      if (error instanceof ExecutionSettingsError && error.code === 'credential-unavailable') throw executionInputError('model-connection-unavailable', error)
      throw error
    })
    let selection = await select('conversation')
    if (input.disclosedSettings && !matchesDisclosedSelection(input.disclosedSettings, selection)) throw executionInputError('disclosed-settings-changed')
    let selectionReason = '使用接受提交时配置的会话角色'
    if (hasImages && selection.connection.capabilities.vision !== 'supported') {
      // A separately configured vision role remains the explicit override. Without it,
      // an unknown capability stays on the selected conversation model; the provider
      // can then report its real support instead of forcing another role to be set up.
      if ((await this.options.settings.read()).profile.roles.vision) {
        selection = await select('vision')
        if (input.disclosedSettings && !matchesDisclosedSelection(input.disclosedSettings, selection)) throw executionInputError('disclosed-settings-changed')
        selectionReason = '当前或历史输入含图片，使用接受提交时配置的视觉角色'
      } else if (selection.connection.capabilities.vision === 'unknown') {
        selectionReason = '当前或历史输入含图片，未单独配置视觉角色；沿用接受提交时选择的会话模型，其图片能力尚待实际请求确认'
      }
      if (selection.connection.capabilities.vision === 'unsupported') throw executionInputError('vision-unsupported')
    }
    const now = Date.now(), attachmentIds = [...new Set(attachments.map(reference => reference.attachmentId))]
    return { schemaVersion: 1, submissionId: input.submissionId, workspaceId: input.workspaceId, conversationId: input.conversationId,
      state: 'queued', mode: input.mode ?? 'queue', text: input.text, documents: structuredClone(input.documents), attachments: structuredClone(attachments), permission,
      model: { provider: selection.connection.provider, model: selection.model, accountId: selection.connection.accountId, billing: selection.connection.billing.kind },
      createdAt: now, updatedAt: now, digest, attachmentIds,
      start: { conversationId: current.conversationId, taskId: input.submissionId, instruction: input.text, selection, documents,
        permission, workspaceRoot: space.rootPath,
        ...(current.home ? { conversationHome: structuredClone(current.home), conversationHomeRoot: homeSpace.rootPath } : {}),
        ...(input.disclosedSettings ? { disclosedSettings: input.disclosedSettings } : {}),
        selectionSource: { role: selection.role as 'conversation' | 'vision', reason: selectionReason, profileRevision: selection.profileRevision },
        inputContext: { id: `${input.submissionId}:input`, capturedAt: now, instruction: input.text, attachments,
          context: context.map((message, index) => ({ message, provenance: { kind: 'history' as const, id: history[index]!.messageId } })) } } }
  }
  private async acceptSubmission(record: StoredExecutionSubmission, current: ConversationRecord): Promise<StoredExecutionSubmission> {
    const conversation = await this.conversations.updateConversation({ workspaceId: record.workspaceId, conversationId: record.conversationId, expectedRevision: current.revision,
      patch: { inputDraft: '', inputAttachments: [], frozenContextRefs: this.refs(record.documents),
        title: current.title || record.text.slice(0, 30) || '附件会话', attachmentIds: [...new Set([...current.attachmentIds, ...record.attachmentIds])] } })
    return this.submissions.update(record.submissionId, { conversationRevision: conversation.revision, updatedAt: Date.now() })
  }
  private async bindRun(record: StoredExecutionSubmission, run: ExecutionRunRecord): Promise<ConversationRecord> {
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
    const current = records[0] ? await this.required(records[0].workspaceId, conversationId) : null
    if (!current || await this.activeRun(current)) return
    if (!explicit) {
      const latestRunId = current.runIndex.builtinRunIds.at(-1)
      const latest = latestRunId ? await this.engine.read(latestRunId) : null
      const kind = latest?.requests.at(-1)?.failure?.kind
      if (latest && ['failed', 'partial', 'interrupted'].includes(latest.status)
        && ([MODEL_REQUEST_BUDGET_EXHAUSTED, TOOL_CALL_BUDGET_EXHAUSTED, EXECUTION_NO_PROGRESS].includes(latest.failure?.code ?? '')
          || kind && ['auth', 'quota', 'rate-limit', 'transport', 'timeout'].includes(kind))) return
    }
    const next = records.find(record => record.state === 'queued')
    if (!next) return
    const continuation = previous ? this.continuation(previous) : next.continuation
    await this.startSubmission(next, continuation)
  }
  private async continuationDocuments(previous: ExecutionRunRecord, documents: ExecutionDocumentReference[]): Promise<ExecutionDocumentReference[]> {
    const lineage: ExecutionRunRecord[] = [], seen = new Set<string>()
    let cursor: ExecutionRunRecord | null = previous
    while (cursor) {
      if (seen.has(cursor.runId)) throw new Error('运行接续链存在循环')
      seen.add(cursor.runId); lineage.unshift(cursor)
      cursor = cursor.continuedFrom ? await this.engine.read(cursor.continuedFrom) : null
      if (lineage[0]!.continuedFrom && !cursor) throw new Error('先前运行记录缺失，不能安全继续')
    }
    const refreshed: ExecutionDocumentReference[] = []
    for (const reference of documents) {
      let expected = reference.revision
      const scopedTargets = [...reference.writable, ...(reference.selection ?? [])]
      const localRanges = scopedTargets.filter(target => target.kind === 'markdown-range')
        .filter((target, index, ranges) => ranges.findIndex(other => other.from === target.from && other.to === target.to) === index)
      const flowRanges = scopedTargets.some(target => target.kind === 'flow-range')
      for (const run of lineage) {
        // The frozen system message records the exact Gateway handles issued for
        // writable targets. A separately issued child handle has no proven extent.
        const knownRanges = new Map<string, { from: number; to: number }>()
        if (localRanges.length) {
          const prefix = '本次固定文档与权限（切换界面不改变它们）：'
          const message = run.messages.slice(0, run.initialMessageCount).find(value => value.role === 'system'
            && typeof value.content === 'string' && value.content.startsWith(prefix))
          const frozenDocument = run.input.documents.find(value => value.documentId === reference.documentId)
          if (!message || typeof message.content !== 'string' || !frozenDocument) throw executionInputError('document-range-changed')
          let issued: unknown
          try { issued = JSON.parse(message.content.slice(prefix.length)) }
          catch { throw executionInputError('document-range-changed') }
          const frozenIndex = run.input.documents.indexOf(frozenDocument)
          const issuedDocument = Array.isArray(issued) ? issued[frozenIndex] as { documentId?: unknown;
            writable?: Array<{ kind?: unknown; target?: unknown }> } | undefined : undefined
          if (issuedDocument?.documentId !== reference.documentId || !Array.isArray(issuedDocument.writable)
            || issuedDocument.writable.length !== frozenDocument.writable.length) throw executionInputError('document-range-changed')
          for (const [index, target] of frozenDocument.writable.entries()) {
            const handle = issuedDocument.writable[index]
            if (handle?.kind !== target.kind || typeof handle.target !== 'string') throw executionInputError('document-range-changed')
            if (target.kind === 'markdown-range') knownRanges.set(handle.target, target)
          }
        }
        for (const tool of run.tools) {
          const callInput = tool.call.input && typeof tool.call.input === 'object' && !Array.isArray(tool.call.input)
            ? tool.call.input as { target?: unknown; content?: unknown } : null
          if (localRanges.length && (tool.call.name === 'read' || tool.call.name === 'inspect')
            && typeof callInput?.target === 'string' && knownRanges.has(callInput.target)
            && tool.result?.kind === 'read' && tool.result.data && typeof tool.result.data === 'object' && !Array.isArray(tool.result.data)) {
            const refreshedHandle = (tool.result.data as { target?: unknown }).target
            if (typeof refreshedHandle === 'string') knownRanges.set(refreshedHandle, knownRanges.get(callInput.target)!)
          }
          const result = tool.result?.kind === 'document-operation' ? tool.result.result : null
          if (!result || result.documentId !== reference.documentId
            || result.status !== 'applied' && result.status !== 'unchanged') continue
          if (result.beforeRevision !== expected) throw executionInputError('document-range-changed')
          if (result.status === 'applied' && flowRanges) throw executionInputError('document-range-changed')
          if (result.status === 'applied' && localRanges.length) {
            const actual = typeof callInput?.target === 'string' ? knownRanges.get(callInput.target) : undefined
            // Equal width on the parent grant cannot prove equal width on a child.
            if (tool.call.name !== 'text.replace' || typeof callInput?.content !== 'string' || localRanges.length !== 1
              || !actual || actual.from !== localRanges[0]!.from || actual.to !== localRanges[0]!.to
              || callInput.content.length !== actual.to - actual.from) throw executionInputError('document-range-changed')
            if (tool.result?.kind === 'document-operation' && typeof tool.result.affected[0] === 'string')
              knownRanges.set(tool.result.affected[0], actual)
          }
          expected = result.revision
        }
      }
      const snapshot = await this.options.documents.registry.get(reference.documentId).drain()
      if (snapshot.epoch !== reference.epoch || snapshot.revision !== expected) throw executionInputError('document-range-changed')
      refreshed.push({ ...reference, revision: expected })
    }
    return refreshed
  }
  /** Caller holds the conversation serial barrier during external grant/handoff. */
  pauseQueueForExternal(conversationId: string): Promise<void> { return this.submissions.pause(conversationId) }
  /** Explicit only. The caller revokes active external grants before entering the conversation barrier. */
  async resumeBuiltinQueue(conversationId: string): Promise<void> {
    await this.submissions.resume(conversationId)
    await this.startNext(conversationId, undefined, true)
  }
  private async send(input: ExecutionSendInput): Promise<ExecutionSendResult> {
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
        throw new Error('原任务尚不可继续，请先核对运行状态')
      if (input.text !== source.text || JSON.stringify(input.documents) !== JSON.stringify(source.documents)
        || JSON.stringify(input.attachments ?? []) !== JSON.stringify(source.attachments)
        || (input.permission ?? DEFAULT_PERMISSION_MODE) !== (source.permission ?? DEFAULT_PERMISSION_MODE))
        throw new Error('继续运行必须使用原任务冻结的文字、目标和附件')
      const child = (await this.submissions.list()).find(record => record.retryOfRunId === previous!.runId
        && (record.state !== 'failed' || Boolean(record.runId)))
      if (child) return this.submissionResult(child)
    }
    const current = await this.required(input.workspaceId, input.conversationId)
    if (current.revision !== input.expectedRevision) throw executionInputError('conversation-draft-changed')
    if (previous && await this.activeRun(current)) throw new Error('当前会话仍有运行中的任务，请等待结束后继续原任务')
    if (previous && (current.inputDraft && current.inputDraft !== input.text
      || current.inputAttachments.length && JSON.stringify(current.inputAttachments) !== JSON.stringify(input.attachments ?? [])
      || JSON.stringify(current.frozenContextRefs) !== JSON.stringify(this.refs(input.documents))))
      throw new Error('输入框已有另一份草稿，请先处理后再继续原任务')
    this.timing(input.conversationId, input.submissionId, `${input.submissionId}:prepare:start`, 'submission.prepare.started')
    let record: StoredExecutionSubmission
    try {
      const preparedInput = previous ? { ...input, documents: await this.continuationDocuments(previous, input.documents) } : input
      record = await this.prepareSubmission(preparedInput, current, digest)
      if (previous) {
        // The public submission remains the user's original frozen payload so
        // lost ACK confirmation computes the same digest with the same ID.
        record.documents = structuredClone(input.documents)
        record.retryOfRunId = previous.runId
        record.continuation = this.continuation(previous)
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
      if (!stopped || ['queued', 'running', 'stopping'].includes(stopped.status)) throw new Error('当前任务尚未停止，立即调整仍在等待')
      record = await this.submissions.update(record.submissionId, { continuation: this.continuation(stopped), updatedAt: Date.now() })
      record = await this.startSubmission(record, record.continuation)
      return this.submissionResult(record)
    }
    await this.startNext(record.conversationId, undefined, true)
    return this.submissionResult((await this.submissions.read(record.submissionId))!)
  }
  private async collectReply(runId: string) {
    const run = await this.engine.read(runId)
    if (!run) return
    for (const workspace of await this.conversations.listWorkspaces()) {
      const found = await this.conversations.readConversation({ workspaceId: workspace.workspaceId, conversationId: run.input.conversationId })
      if (!found) continue
      await this.serial(found.conversationId, async () => {
        const current = await this.conversations.readConversation({ workspaceId: workspace.workspaceId, conversationId: found.conversationId })
        if (!current || current.messages.some(message => message.role === 'assistant' && message.runId === runId)) return
        const last = [...run.messages].reverse().find(message => message.role === 'assistant' && typeof message.content === 'string' && message.content)
        if (!last || typeof last.content !== 'string') return
        await this.conversations.updateConversation({ workspaceId: workspace.workspaceId, conversationId: found.conversationId, expectedRevision: current.revision,
          patch: { messages: [...current.messages, { messageId: randomUUID(), role: 'assistant', text: last.content, createdAt: Date.now(), attachmentIds: [], runId }] } })
      })
    }
  }
  private async afterRunEnd(runId: string): Promise<void> {
    const run = await this.engine.read(runId)
    if (!run) return
    if (['failed', 'partial', 'interrupted'].includes(run.status)) {
      const record = await this.submissions.read(run.input.taskId)
      if (record?.runId === runId && record.state === 'accepted')
        await this.serial(run.input.conversationId, () => this.restoreFailedDraft(record))
    }
    await this.collectReply(runId)
    await this.serial(run.input.conversationId, () => this.startNext(run.input.conversationId, run))
  }
  async writableTasksForDocument(documentId: string): Promise<{ runIds: string[]; submissionIds: string[] }> {
    await this.ready()
    const submissions = await this.submissions.list()
    const submissionIds = submissions.filter(record => record.state === 'queued'
      && record.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(record => record.submissionId)
    const runIds: string[] = []
    for (const run of await this.runs.list()) if (['queued', 'running', 'stopping'].includes((await this.engine.read(run.runId) ?? run).status)
      && run.input.documents.some(document => document.documentId === documentId && document.writable.length > 0)) runIds.push(run.runId)
    return { runIds, submissionIds }
  }
  async stopTasksForDocument(documentId: string): Promise<{ runIds: string[]; submissionIds: string[] }> {
    await this.ready()
    const records = await this.submissions.list(), runs = await this.runs.list()
    const conversationIds = [...new Set([
      ...records.filter(record => record.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(record => record.conversationId),
      ...runs.filter(run => run.input.documents.some(document => document.documentId === documentId && document.writable.length > 0)).map(run => run.input.conversationId),
    ])]
    const cancelled: string[] = [], stopped: string[] = []
    for (const conversationId of conversationIds) await this.serial(conversationId, async () => {
      for (const record of await this.submissions.list()) if (record.conversationId === conversationId && record.state === 'queued'
        && record.documents.some(document => document.documentId === documentId && document.writable.length > 0)) {
        await this.submissions.update(record.submissionId, { state: 'cancelled', updatedAt: Date.now(),
          failure: { code: 'document-close-cancelled', message: '已取消：关联文档正在关闭。' } })
        cancelled.push(record.submissionId)
      }
      for (const run of await this.runs.list()) {
        if (run.input.conversationId !== conversationId || !run.input.documents.some(document => document.documentId === documentId && document.writable.length > 0)) continue
        const live = await this.engine.read(run.runId)
        if (!live || !['queued', 'running', 'stopping'].includes(live.status)) continue
        await this.engine.stop(run.runId)
        stopped.push(run.runId)
      }
    })
    return { runIds: stopped, submissionIds: cancelled }
  }
  async operate(raw: unknown): Promise<unknown> {
    const received = captureMainTiming()
    try {
      await this.ready()
      const input = executionDesktopRequestSchema.parse(raw)
      switch (input.type) {
        case 'workspace': return this.serial('workspace', () => this.workspace(input.root))
        case 'conversations': return this.conversations.listConversations(input.workspaceId)
        case 'create-conversation': return this.conversations.createConversation({ ...input,
          ...(input.home ? { home: await this.validateHome(input.workspaceId, input.home) } : {}) })
        case 'set-conversation-home': return this.serial(input.conversationId, async () => this.conversations.setConversationHome({ ...input,
          home: input.home ? await this.validateHome(input.workspaceId, input.home) : null }))
        case 'conversation': return this.conversations.readConversation(input)
        case 'draft': return this.serial('attachment-lifecycle', () => this.serial(input.conversationId, async () => {
          for (const ref of input.attachments) await this.attachments.readRepresentation(ref.attachmentId, ref.representationId)
          return this.conversations.updateConversation({ ...input, patch: { inputDraft: input.text, inputAttachments: input.attachments, frozenContextRefs: this.refs(input.documents) } })
        }))
        case 'rename-conversation': return this.serial(input.conversationId, () => this.conversations.updateConversation({ ...input, patch: { title: input.title } }))
        case 'delete-conversation': return this.serial('attachment-lifecycle', () => this.serial(input.conversationId, async () => {
          let prepared = false
          try {
            const record = await this.required(input.workspaceId, input.conversationId)
            await this.conversations.deleteConversation({ ...input, ports: {
              stopBuiltinRuns: async ({ runIds }) => { await Promise.all(runIds.map(runId => this.engine.stop(runId))) },
              revokeExternalPorts: async ({ workspaceId, conversationId, portIds }) => {
                if (portIds.length && !this.externalRevoker) throw new Error('外部授权尚未撤销，会话已保留')
                if (portIds.length) await this.externalRevoker!({ workspaceId, conversationId, portIds: [...portIds] })
              },
              prepareResourceRelease: async owner => {
                await this.imageRetention?.prepare(owner); prepared = !!this.imageRetention
                await this.attachments.prepareConversationRelease({ version: 1, workspaceId: owner.workspaceId, conversationId: owner.conversationId,
                  attachmentIds: conversationAttachmentIds(record) })
              },
            } })
            this.imageRetention?.collect()
            // Deletion is already durable. A failed sweep keeps its intent for startup retry.
            await this.collectAttachmentReleases().catch(() => undefined)
          } catch (error) {
            if (prepared) this.imageRetention?.abort(input)
            throw error
          }
        }))
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
          return this.serial('attachment-lifecycle', () => this.serial(input.conversationId, () => this.send(input)))
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
          return record && record.workspaceId === input.workspaceId && record.conversationId === input.conversationId ? this.publicSubmission(record) : null
        }
        case 'submissions': return Promise.all((await this.submissions.list()).filter(record => record.workspaceId === input.workspaceId && record.conversationId === input.conversationId).map(record => this.publicSubmission(record)))
        case 'delete-submission': return this.serial(input.conversationId, async () => {
          const record = await this.submissions.read(input.submissionId)
          if (!record || record.workspaceId !== input.workspaceId || record.conversationId !== input.conversationId) throw new Error('排队消息不存在')
          if (record.state !== 'queued') throw new Error('只有尚未启动的排队消息可以删除')
          return this.publicSubmission(await this.submissions.update(record.submissionId, { state: 'cancelled', updatedAt: Date.now(),
            failure: { code: 'cancelled-by-user', message: '已从队列移除。' } }))
        })
        case 'pause-queue': return this.serial(input.conversationId, async () => {
          await this.required(input.workspaceId, input.conversationId)
          await this.pauseQueueForExternal(input.conversationId)
        })
        case 'resume-queue': return this.serial(input.conversationId, async () => {
          await this.required(input.workspaceId, input.conversationId)
          await this.resumeBuiltinQueue(input.conversationId)
        })
        case 'run': return this.engine.read(input.runId)
        case 'stop': return this.engine.stop(input.runId)
        case 'approve': try { return await this.engine.decide(input) }
          catch (error) { throw new DesktopOperationError('execution-approval-rejected', '决定没有提交', error instanceof Error ? error.message : '这次修改暂时不能处理。', '修改仍在等待时可以重新选择；任务已停止或结束时，需要重新发送任务。', { cause: error }) }
        case 'answer': try { return await this.engine.answer(input) }
          catch (error) { throw new DesktopOperationError('execution-answer-rejected', '回答没有提交', error instanceof Error ? error.message : '这个问题暂时不能回答。', '问题仍在等待时可以重新选择；任务已停止或结束时，需要重新发送任务。', { cause: error }) }
        case 'events': return this.events.readPage(input)
        case 'search-events': return this.events.search(input)
        case 'timeline': return this.events.snapshot(input.conversationId)
        case 'blob': return Buffer.from(await this.events.readBlob(input.conversationId, input.ref)).toString('utf8')
        case 'edits': return this.edits.list(input.documentId)
      }
    } catch (error) {
      if (error instanceof DesktopOperationError) throw error
      throw new DesktopOperationError('execution-operation-failed', '会话操作未完成', '会话服务暂时无法完成操作。', '请重试；若仍失败，请查看诊断记录。当前输入、附件和已应用的修改已保留。', { cause: error })
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
