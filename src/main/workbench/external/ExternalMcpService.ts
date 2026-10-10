import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { DocumentRegistry } from '../../../core/documents/DocumentRegistry'
import { documentSnapshotFacts, type DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import { applicationEventFacts, committedFact, contentApplyFact, currentSave, modelToolResult,
  operationFact, saveFact, serviceToolOutcome, toolFailed } from '../../../core/tools/modelToolResult'
import { AgentFileMissingParent, agentFileMutationNames, agentFileTools, isAgentFileTool, type AgentFileContext, type AgentFileMutationName,
  type AgentFileOutcome, type AgentFileToolName } from '../../../core/tools/AgentFileTools'
import { createCourseFromHtmlInputSchema, createCourseFromHtmlTool } from '../../../core/tools/HtmlImportTools'
import { toolFamilies, toolRegistration } from '../../../core/tools/ToolCatalog'
import { isInsideRoot, permissionLabels, type ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { ExecutionEventInput } from '../../../shared/workbench/executionEvents'
import { externalMcpEndpoint, type ExternalMcpSettings, type ExternalMcpState, type ExternalMcpStatus,
  type ExternalSessionView, type ExternalUiState } from '../../../shared/workbench/external'
import type { ModelToolCall, ToolResult } from '../../../shared/workbench/tools'
import type { ConversationStore } from '../conversations/ConversationStore'
import { loadToolsDefinition } from '../execution/ExecutionEngine'
import { createCourseFromHtml } from '../htmlImport/CreateCourseFromHtml'
import { McpProtocolError, ResidentMcpServer, type ResidentMcpCall, type ResidentMcpClientInfo, type ResidentMcpHandler } from './ResidentMcpServer'
import type { ResidentMcpSettingsStore } from './ResidentMcpSettings'
import type { ExecutionEventPendingState } from '../execution/ExecutionEventStore'

export interface ExternalApproval { clientName: string; label: string; reason: 'ask' | 'outside-workspace'; paths?: readonly string[] }
export interface ExternalFilePort {
  execute(context: AgentFileContext, name: AgentFileToolName, raw: unknown, operationId: string): Promise<AgentFileOutcome>
  preflightMutation(context: AgentFileContext, name: AgentFileMutationName, raw: unknown): Promise<{ paths: string[]; outside: boolean }>
  releaseRun(runId: string): void
}
export interface ExternalMcpServiceOptions {
  settings: Pick<ResidentMcpSettingsStore, 'read' | 'update'>
  conversations: Pick<ConversationStore, 'listWorkspaces' | 'readWorkspace' | 'listConversations' | 'createConversation' | 'updateConversation'>
  registry: DocumentRegistry
  gateway: DocumentToolGateway
  /** The same file service the built-in AI uses; permission and workspace checks stay inside it. */
  files: ExternalFilePort
  /** Canonical authorized root of a registered workspace. */
  workspaceRoot(rootPath: string): Promise<string>
  /** The app's current space and foreground selection; null when no window can answer. */
  uiState(): Promise<ExternalUiState | null>
  appendEvent(event: ExecutionEventInput): Promise<unknown>
  /** Host confirmation for a modification the session's frozen permission asks about. */
  confirm(request: ExternalApproval): Promise<boolean>
  /** Same non-authoritative record queue shown by the GUI and normal quit. */
  recordingState?(): ExecutionEventPendingState
  now?: () => number
}
type ToolKind = 'gateway' | 'file' | 'course' | 'load' | 'service'
interface HostTool { name: string; description: string; schema: Record<string, unknown>; read: boolean; label: string; kind: ToolKind }
interface CallScope {
  runId: string; taskId: string; workspaceId: string; workspaceRoot: string; permission: ExecutionPermissionMode
  boundPaths: readonly string[]; boundDocumentIds: readonly string[]; children: Map<string, ToolResult>
}
interface OperationScope { runId: string; workspaceId: string; workspaceRoot: string }
interface OperationSummary {
  status: 'applied' | 'unchanged' | 'completed' | 'pending' | 'failed'; documentId?: string; revision?: number; operationId?: string; message?: string
  commit?: string; usability?: string; delivery?: string
  save?: { savedRevision: number; currentRevision: number; dirty: boolean; current: boolean }
}
interface Operation {
  ticket: string; runId: string; workspaceId: string; workspaceRoot: string; tool: string; label: string; digest: string; time: number
  /** Existing in-memory receipt retained for exact-identity retries until the session ends; never a persistent ledger. */
  result?: Promise<ToolResult>
  summary?: OperationSummary
  delivered?: boolean
}
interface Session {
  sessionId: string; clientName: string; permission: ExecutionPermissionMode
  connectedAt: number; lastCallAt?: number; pending: number; stopped: boolean
  workspaceId: string; workspaceName: string; workspaceRoot: string
  runId: string; taskId: string
  conversation?: Promise<string>; conversationId?: string
  operations: Operation[]
  /** Child receipts of composite calls (course.createFromHtml), keyed by their host-assigned call id. */
  children: Map<string, ToolResult>
  notices: string[]; listChanged: boolean
  authority: Promise<void>; transitioning: boolean; boundDocumentIds: readonly string[]
}

const STOPPED = '此外部会话已被用户在果铃中停止，后续调用不会执行。如需继续，请在客户端重新连接（重新初始化 MCP 会话）。'
const loadToolsSchema = z.object({ families: z.array(z.enum(toolFamilies)).min(1) }).strict()
const serviceSchemas = {
  'workspace.list': z.object({}).strict(),
  'workspace.switch': z.object({ workspaceId: z.string().min(1) }).strict(),
  'workbench.state': z.object({}).strict(),
  'operation.recent': z.object({ limit: z.number().int().min(1).optional() }).strict(),
}
const serviceTools: HostTool[] = [
  { name: 'workspace.list', label: '列出工作空间', description: '列出果铃中已登记的工作空间及本会话当前绑定的空间。', read: true },
  { name: 'workspace.switch', label: '切换工作空间', description: '把本会话切换到另一个已登记的工作空间。之前打开的文档句柄随之失效，需在新空间按路径重新打开。', read: true },
  { name: 'workbench.state', label: '查看当前界面', description: '只读：用户在果铃中当前打开的文档、前台文档和选中内容。选中内容带可用的目标句柄，不修改任何内容。', read: true },
  { name: 'operation.recent', label: '最近操作结果', description: '只读：本会话最近的修改、资源获取和新发起任务的正式结果及回复是否送达。用于连接中断后核对，不会执行或重放工具。', read: true },
].map(tool => ({ ...tool, kind: 'service' as const, schema: z.toJSONSchema(serviceSchemas[tool.name as keyof typeof serviceSchemas]) as Record<string, unknown> }))
const fileLabels: Record<AgentFileToolName, string> = { 'file.list': '列出文件', 'file.search': '搜索文件', 'file.open': '打开文件', 'file.create': '新建文件',
  'file.observe': '比较磁盘版本', 'file.reconcile': '处理文件变化',
  'file.read': '读取文件', 'file.grep': '搜索正文', 'file.write': '写入文件', 'file.patch': '修改文件', 'file.mkdir': '新建文件夹', 'file.copy': '复制文件',
  'file.move': '移动文件', 'file.rename': '重命名', 'file.trash': '移入回收站' }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const callDigest = (name: string, input: unknown) => createHash('sha256').update(JSON.stringify([name, canonical(input)])).digest('hex')
const failure = (code: string, message: string, data?: unknown): ToolResult => ({ kind: 'error', code, message, ...(data !== undefined ? { data } : {}) })
function summarize(name: string, result: ToolResult): OperationSummary {
  const receipt = operationFact(name, result), apply = contentApplyFact(name, result), saved = saveFact(name, result)
  const outcome = serviceToolOutcome(name, result)
  return { status: receipt?.status === 'applied' || receipt?.status === 'unchanged' ? receipt.status
    : outcome?.status === 'pending' ? 'pending' : toolFailed(name, result) ? 'failed' : 'completed',
    ...(receipt ? { documentId: receipt.documentId, operationId: receipt.operationId,
      ...('revision' in receipt ? { revision: receipt.revision } : { message: receipt.message }) } : {}),
    ...(result.kind === 'error' ? { message: result.message } : outcome ? { message: outcome.message } : {}),
    ...(apply ? { commit: apply.commit, usability: apply.usability, delivery: apply.delivery } : {}),
    ...(saved && saved.savedRevision !== undefined ? { save: { savedRevision: saved.savedRevision, currentRevision: saved.currentRevision,
      dirty: saved.dirty, current: currentSave(saved) } } : {}) }
}
const workspaceName = (rootPath: string) => path.basename(rootPath) || rootPath

/** Resident external sessions over the shared Gateway: one workspace-bound run per session, the built-in AI's tool selection and permission levels. */
export class ExternalMcpService implements ResidentMcpHandler {
  readonly server = new ResidentMcpServer(this)
  private readonly sessions = new Map<string, Session>()
  private state: ExternalMcpState = 'disabled'
  private message?: string
  private lifecycle: Promise<unknown> = Promise.resolve()
  private initialWorkspaceId?: string
  private lastWorkspaceId?: string
  private readonly requests = new Set<Promise<unknown>>()
  private sessionGeneration = 0
  private detachCatalog?: () => void
  private readonly now: () => number
  constructor(private readonly options: ExternalMcpServiceOptions) { this.now = options.now ?? Date.now }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.catch(() => undefined).then(work)
    this.lifecycle = next
    return next
  }
  /** Starts listening when enabled. An occupied port leaves the service stopped with a visible reason. */
  start(): Promise<ExternalMcpStatus> { return this.serial(async () => { await this.restart(); return this.status() }) }
  private async restart(): Promise<void> {
    await this.server.stop()
    await this.closeSessions()
    const settings = await this.options.settings.read()
    this.message = undefined
    if (!settings.enabled) { this.state = 'disabled'; return }
    this.detachCatalog ??= this.options.gateway.subscribeCatalogChanges(runId => {
      for (const session of this.sessions.values()) if (session.runId === runId) session.listChanged = true
    })
    const started = await this.server.start(settings.port)
    this.state = started.state
    if (started.state !== 'running') this.message = started.message
  }
  async status(): Promise<ExternalMcpStatus> {
    const settings = await this.options.settings.read()
    const recording = this.options.recordingState?.(), pending = recording ? recording.pendingEvents + recording.pendingTiming : 0
    const message = [this.message, pending ? `还有 ${pending} 条运行记录正在写入；文档修改的提交与保存结果独立保留。` : undefined,
      recording?.lastFailure ? `运行记录曾出现写入失败：${recording.lastFailure.message}。记录失败不会重新执行操作。` : undefined].filter(Boolean).join('\n')
    return { state: this.state, ...(message ? { message } : {}), settings,
      endpoint: externalMcpEndpoint(this.server.listeningPort ?? settings.port), sessions: [...this.sessions.values()].map(session => this.view(session)) }
  }
  configure(patch: Partial<ExternalMcpSettings>): Promise<ExternalMcpStatus> {
    return this.serial(async () => {
      const before = await this.options.settings.read(), after = await this.options.settings.update(patch)
      // This preference sets new connections; host-only configureSession rotates the selected live connection.
      if (before.enabled !== after.enabled || before.port !== after.port || after.enabled && this.state !== 'running') await this.restart()
      return this.status()
    })
  }
  /** Host/UI authority change for one live connection, without transport reinitialization. */
  configureSession(sessionId: string, permission: ExecutionPermissionMode): Promise<ExternalMcpStatus> {
    return this.serial(async () => {
      const session = this.sessions.get(sessionId)
      if (!session || session.stopped) throw new Error('外部会话已停止或不存在')
      await this.bind(session, session.workspaceId, permission)
      return this.status()
    })
  }
  /** Revokes one session: its run is stopped and later calls are refused with an explanation. */
  async stopSession(sessionId: string): Promise<ExternalMcpStatus> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('外部会话已不存在')
    if (!session.stopped) { session.stopped = true; await this.stopRun(session.runId) }
    return this.status()
  }
  /** Only currently pending calls count as work, not idle long-lived connections. */
  activity(): { clientName: string; pendingCalls: number }[] {
    return [...this.sessions.values()].filter(session => session.pending > 0)
      .map(session => ({ clientName: session.clientName, pendingCalls: session.pending }))
  }
  writableSessionsForDocument(documentId: string): string[] {
    const runs = new Set(this.options.gateway.writableRunIdsForDocument(documentId))
    return [...this.sessions.values()].filter(session => !session.stopped && runs.has(session.runId)).map(session => session.sessionId)
  }
  /** Close/trash stops only the affected document; the session's other documents keep their handles. */
  async stopForDocument(documentId: string): Promise<void> {
    await Promise.all(this.writableSessionsForDocument(documentId).map(async id => {
      const session = this.sessions.get(id)!
      await this.options.gateway.stopRunDocument(session.runId, documentId)
      session.listChanged = true
      session.notices.push('用户在果铃中关闭或移走了你正在修改的一份文档；该文档的句柄已失效，其他文档可继续编辑。需要该文档时请按路径重新打开。')
    }))
  }
  /** Called inside ConversationStore's delete transaction: never read that store here. Sessions log into a new conversation next time. */
  releaseConversation(input: { workspaceId: string; conversationId: string }): void {
    for (const session of this.sessions.values()) if (session.workspaceId === input.workspaceId && session.conversationId === input.conversationId) {
      session.conversation = undefined; session.conversationId = undefined
    }
  }
  close(): Promise<void> { return this.serial(async () => {
    this.state = 'disabled'; await this.server.stop(); await this.closeSessions()
    // Transport disposal is not completion of the received tool calls or their event/journal ACKs.
    await Promise.allSettled([...this.requests])
    this.detachCatalog?.(); this.detachCatalog = undefined
  }) }

  /** Startup chooses a registered, already-authorized root; it grants no extra authority. */
  async setInitialWorkspace(workspaceId: string): Promise<void> {
    if (!await this.options.conversations.readWorkspace(workspaceId)) throw new Error('后台工作空间未登记')
    this.initialWorkspaceId = workspaceId
    this.lastWorkspaceId = workspaceId
  }

  async connectionInfo(): Promise<{ endpoint: string; workspace: string; workspaceId: string; permission: ExecutionPermissionMode }> {
    const status = await this.status()
    if (status.state !== 'running') throw new Error(status.message ?? '外部 MCP 未在监听')
    const workspaceId = await this.currentWorkspace(), workspace = await this.options.conversations.readWorkspace(workspaceId)
    if (!workspace) throw new Error('宿主工作空间已移除')
    return { endpoint: status.endpoint, workspaceId, workspace: await this.options.workspaceRoot(workspace.rootPath), permission: status.settings.permission }
  }

  private view(session: Session): ExternalSessionView {
    return { sessionId: session.sessionId, clientName: session.clientName, workspaceId: session.workspaceId, workspaceName: session.workspaceName,
      permission: session.permission, connectedAt: session.connectedAt, ...(session.lastCallAt !== undefined ? { lastCallAt: session.lastCallAt } : {}),
      pendingCalls: session.pending, stopped: session.stopped }
  }
  private async closeSessions(): Promise<void> {
    this.sessionGeneration++
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map(session => this.stopRun(session.runId)))
  }
  private async stopRun(runId: string): Promise<void> {
    try { await this.options.gateway.stop(runId) } finally { this.options.files.releaseRun(runId) }
  }
  private async currentWorkspace(): Promise<string> {
    // A CLI launch owns its default root even after the same host gains a GUI.
    // Session workspace.switch changes only that session, not this startup choice.
    if (this.initialWorkspaceId) return this.initialWorkspaceId
    const ui = await this.options.uiState().catch(() => null)
    for (const id of [ui?.workspaceId, this.lastWorkspaceId]) if (id && await this.options.conversations.readWorkspace(id)) return id
    // No window answered: fall back to the most recently used registered space.
    const recent = (await this.options.conversations.listWorkspaces()).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (recent) return recent.workspaceId
    throw new McpProtocolError(-32000, '果铃还没有打开任何工作空间。请先在果铃中打开工作空间，再重新连接。')
  }
  /** Serialize only authority changes; nonconflicting tool calls remain concurrent. */
  private bind(session: Session, workspaceId: string, permission?: ExecutionPermissionMode): Promise<void> {
    const pending = session.authority.then(() => this.rebind(session, workspaceId, permission ?? session.permission))
    session.authority = pending.catch(() => undefined)
    return pending
  }
  /** The same connection gets a fresh frozen run; old uncommitted work stops before the new grant exists. */
  private async rebind(session: Session, workspaceId: string, permission: ExecutionPermissionMode): Promise<void> {
    const workspace = await this.options.conversations.readWorkspace(workspaceId)
    if (!workspace) throw new Error('工作空间不存在或已移除')
    const root = await this.options.workspaceRoot(workspace.rootPath), runId = randomUUID(), previous = session.runId
    if (previous) this.assertActive(session, previous)
    if (session.workspaceId === workspaceId && session.workspaceRoot === root && session.permission === permission && previous) return
    const ui = await this.options.uiState().catch(() => null)
    // Foreground identities come only from trusted host/renderer state, never client-supplied paths.
    const boundDocumentIds = [...new Set([ui?.activeDocumentId, ui?.selection?.documentId].filter((id): id is string => !!id))]
    const boundPaths = Object.fromEntries(this.options.registry.list().filter(snapshot => boundDocumentIds.includes(snapshot.documentId)
      && snapshot.binding.kind === 'file').map(snapshot => [snapshot.documentId, snapshot.binding.kind === 'file' ? snapshot.binding.path : '']))
    session.transitioning = true
    try {
      if (previous) await this.stopRun(previous)
      if (session.stopped || previous && !this.sessions.has(session.sessionId)) throw new Error('外部会话已停止')
      await this.options.gateway.beginRun({ runId, actor: 'agent', documents: [], fileAccess: { permission, workspaceRoot: root, boundPaths } })
      if (session.stopped || previous && !this.sessions.has(session.sessionId)) { await this.stopRun(runId); throw new Error('外部会话已停止') }
      session.conversation = undefined; session.conversationId = undefined
      Object.assign(session, { runId, taskId: randomUUID(), workspaceId, workspaceRoot: root, permission,
        workspaceName: workspaceName(root), listChanged: true, boundDocumentIds, children: new Map<string, ToolResult>() })
      this.lastWorkspaceId = workspaceId
    } catch (cause) {
      if (previous) session.stopped = true
      throw cause
    } finally { session.transitioning = false }
  }

  initialize(client: ResidentMcpClientInfo): Promise<{ sessionId: string; instructions: string }> {
    const pending = this.serial(() => this.openSession(client, this.sessionGeneration))
    this.requests.add(pending)
    void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending))
    return pending
  }
  private async openSession(client: ResidentMcpClientInfo, generation: number): Promise<{ sessionId: string; instructions: string }> {
    if (this.state !== 'running') throw new McpProtocolError(-32001, '外部连接尚未启动或已停止')
    const settings = await this.options.settings.read()
    const session: Session = { sessionId: randomUUID(), clientName: client.title ?? client.name, permission: settings.permission,
      connectedAt: this.now(), pending: 0, stopped: false, workspaceId: '', workspaceName: '', workspaceRoot: '', runId: '', taskId: randomUUID(),
      operations: [], children: new Map(), notices: [], listChanged: false, authority: Promise.resolve(), transitioning: false, boundDocumentIds: [] }
    await this.bind(session, await this.currentWorkspace())
    // Revocation while initialization awaits disk/workspace facts must not leave a late, live run behind.
    if (generation !== this.sessionGeneration || this.state !== 'running') {
      await this.stopRun(session.runId)
      throw new McpProtocolError(-32001, '外部连接已停止或更新，请重新连接')
    }
    session.listChanged = false
    this.sessions.set(session.sessionId, session)
    return { sessionId: session.sessionId, instructions: [
      `已连接到正在运行的果铃。本会话绑定工作空间「${session.workspaceName}」（${session.workspaceRoot}），权限为「${permissionLabels[session.permission]}」，由果铃主进程执行。`,
      '用 file.* 按路径在空间内打开、新建、读写文件与文档；打开后用返回的 target 句柄调用读取和编辑工具。宿主按当前文档接入可用能力；tools.load 可用于手动浏览其他工具族。',
      'workspace.list / workspace.switch 查看和切换空间；workbench.state 只读查看用户当前打开的文档与选中内容。',
      '操作票据由果铃自动编号，不需要填写 ticket。同一授权范围内，未送达修改可原样重发取回回执。切空间/调权后重试原操作须带原 ticket 与 _meta[guoling/operation]=operationScope；普通新调用在新范围执行。operation.recent 可核对最近事实。',
      '果铃只记录收到的工具调用；你自己的对话、用量与磁盘操作不由果铃管理。',
    ].join('\n') }
  }
  terminate(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.stopped = true
    this.sessions.delete(sessionId)
    const stopping = this.stopRun(session.runId).catch(() => undefined)
    this.requests.add(stopping)
    void stopping.finally(() => this.requests.delete(stopping))
  }
  async request(sessionId: string, call: ResidentMcpCall): Promise<unknown> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new McpProtocolError(-32001, '外部会话已结束，请重新连接')
    if (session.stopped) throw new McpProtocolError(-32000, STOPPED)
    if (call.method === 'tools/list') {
      session.listChanged = false
      await session.authority
      return { tools: (await this.catalog(this.scope(session))).map(tool => ({ name: tool.name, title: tool.label, description: tool.description,
        inputSchema: tool.schema,
        ...(tool.read ? { annotations: { readOnlyHint: true } } : {}) })) }
    }
    if (call.method !== 'tools/call') throw new McpProtocolError(-32601, '不支持此 MCP 方法')
    session.pending++; session.lastCallAt = this.now()
    const pending = this.callTool(session, call)
    this.requests.add(pending)
    let result: unknown
    try { result = await pending } finally { session.pending--; this.requests.delete(pending) }
    if (session.listChanged) { session.listChanged = false; call.notify('notifications/tools/list_changed') }
    return result
  }

  /** Same selection as a built-in task in this space: Gateway catalog for the run, file tools by permission, family loading. */
  private async catalog(scope: CallScope): Promise<HostTool[]> {
    const domain = await this.options.gateway.describeRun(scope.runId)
    const families = await this.options.gateway.availableToolFamilies(scope.runId)
    const tools: HostTool[] = domain.map(tool => ({ name: tool.name, description: tool.description, schema: tool.schema, read: tool.manual.group === 'read', label: tool.manual.label, kind: 'gateway' }))
    for (const tool of agentFileTools) {
      const mutation = (agentFileMutationNames as readonly string[]).includes(tool.name)
      if (!mutation || scope.permission !== 'read-only') tools.push({ name: tool.name, description: tool.description, schema: tool.inputSchema, read: !mutation, label: fileLabels[tool.name], kind: 'file' })
    }
    if (scope.permission !== 'read-only') tools.push({ name: createCourseFromHtmlTool.name, description: createCourseFromHtmlTool.description,
      schema: z.toJSONSchema(createCourseFromHtmlInputSchema) as Record<string, unknown>, read: false, label: createCourseFromHtmlTool.manual.label, kind: 'course' })
    if (families.length) tools.push({ name: loadToolsDefinition.name, label: '展开工具', read: true, kind: 'load', schema: z.toJSONSchema(loadToolsSchema) as Record<string, unknown>,
      description: `${loadToolsDefinition.description} 展开后请重新获取工具列表。当前可展开：${families.map(item => `${item.family} ${item.description}`).join('；')}。` })
    return [...tools, ...serviceTools]
  }

  private async callTool(session: Session, call: ResidentMcpCall): Promise<unknown> {
    await session.authority
    const scope = this.scope(session)
    const name = typeof call.params.name === 'string' ? call.params.name : ''
    const input = call.params.arguments ?? {}
    if (!record(input)) throw new McpProtocolError(-32602, '工具 arguments 必须是对象')
    // Optional explicit replay identity is transport metadata, never part of a tool's input schema.
    const supplied = record(call.params._meta) ? call.params._meta['guoling/ticket'] : undefined
    // Client correlation text is not the host's operation identity. Non-string metadata carries no identity.
    const clientTicket = typeof supplied === 'string' && supplied.length > 0 ? supplied : undefined
    const original = record(call.params._meta) ? call.params._meta['guoling/operation'] : undefined
    if (original !== undefined) {
      if (!clientTicket || !record(original) || typeof original.runId !== 'string' || typeof original.workspaceId !== 'string' || typeof original.workspaceRoot !== 'string')
        return this.reply(session, failure('invalid-retry', '原操作重试需要原 ticket 和完整 operationScope；未执行。'))
      const prior = session.operations.find(item => item.ticket === clientTicket && item.runId === original.runId
        && item.workspaceId === original.workspaceId && item.workspaceRoot === original.workspaceRoot)
      if (!prior) return this.reply(session, failure('unknown-operation', '本连接没有该原范围的操作回执；未执行。'))
      if (prior.tool !== name || prior.digest !== callDigest(name, input))
        return this.reply(session, failure('operation-payload-mismatch', '原操作身份已用于其他参数；未执行。'))
      this.track(prior, call.delivery)
      return this.reply(session, await prior.result!, prior.ticket, true, prior.tool, prior.runId, prior)
    }
    let tool = (await this.catalog(scope)).find(item => item.name === name)
    if (!tool) {
      const definition = await this.options.gateway.resolveRunTool(scope.runId, name)
      if (definition) tool = { name: definition.name, description: definition.description, schema: definition.schema,
        read: definition.manual.group === 'read', label: definition.manual.label, kind: 'gateway' }
    }
    this.assertActive(session, scope.runId)
    if (!tool) return this.reply(session, failure('unknown-tool', '工具不存在，或在本会话的权限与已打开的文档下不可用。可先打开文档，或用 tools.load 展开工具族。'))
    const registration = toolRegistration(tool.name)
    let effectful = !tool.read
    if (registration) {
      try { effectful = (typeof registration.effect === 'function' ? registration.effect(input) : registration.effect) !== null }
      catch { effectful = true } // Invalid arguments retain one operation identity; the owner returns the precise error.
    }
    if (!effectful) {
      const ticket = randomUUID()
      return this.reply(session, await this.traced(session, scope, tool, ticket, input, () => this.execute(session, scope, tool, ticket, input)), ticket, false, tool.name, scope.runId)
    }
    const digest = callDigest(tool.name, input)
    // The previous identical call's reply never reached the client: answer with its receipt instead of executing again.
    const undelivered = clientTicket === undefined ? [...session.operations].reverse()
      .find(item => item.runId === scope.runId && item.tool === tool.name && item.digest === digest && item.delivered === false && item.result) : undefined
    if (undelivered) {
      undelivered.delivered = undefined
      this.track(undelivered, call.delivery)
      return this.reply(session, await undelivered.result!, undelivered.ticket, true, tool.name, scope.runId, undelivered)
    }
    const ticket = clientTicket === undefined ? randomUUID() : /^[A-Za-z0-9_.:-]{1,200}$/.test(clientTicket)
      ? clientTicket : `client:${createHash('sha256').update(clientTicket).digest('hex')}`
    const prior = clientTicket ? session.operations.find(item => item.ticket === ticket && item.runId === scope.runId) : undefined
    if (prior) {
      if (prior.tool !== tool.name || prior.digest !== digest) return this.reply(session, failure('operation-payload-mismatch', '操作身份已用于其他参数；未执行。'))
      this.track(prior, call.delivery)
      return this.reply(session, await prior.result!, prior.ticket, true, tool.name, prior.runId, prior)
    }
    const operation: Operation = { ticket, runId: scope.runId, workspaceId: scope.workspaceId, workspaceRoot: scope.workspaceRoot, tool: tool.name, label: tool.label, digest, time: this.now() }
    operation.result = this.traced(session, scope, tool, ticket, input, () => this.execute(session, scope, tool, ticket, input))
      .then(result => { operation.summary = summarize(tool.name, result); return result })
    session.operations.push(operation)
    this.track(operation, call.delivery)
    return this.reply(session, await operation.result, ticket, false, tool.name, scope.runId, operation)
  }
  private track(operation: Operation, delivery: Promise<boolean>): void {
    void delivery.then(delivered => { operation.delivered = delivered })
  }
  private async reply(session: Session, result: ToolResult, ticket?: string, replayed = false, toolName = '', runId = session.runId, operation?: OperationScope) {
    const publicResult = modelToolResult(toolName, result)
    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [{ type: 'text', text: JSON.stringify(publicResult) }]
    if (replayed) content.push({ type: 'text', text: '这是原范围同一调用的正式回执，本次未重复执行。' })
    let imageMissing = false
    if (result.kind === 'read' && result.images?.length) {
      try {
        const images = await this.options.gateway.prepareResultImages(runId, result)
        this.assertActive(session, runId)
        for (const image of images) content.push({ type: 'image', data: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType })
      } catch {
        imageMissing = true
        content.push({ type: 'text', text: '图片资源未能读取或授权已失效；本次结果只有身份元数据，不能据此声称已看见画面。' })
      }
    }
    for (const notice of session.notices.splice(0)) content.push({ type: 'text', text: notice })
    // An accepted background job is unfinished, but its MCP call succeeded. The
    // client must keep the session and query that job instead of treating it as a failed call.
    const pending = serviceToolOutcome(toolName, result)?.status === 'pending'
    return { content, structuredContent: { result: publicResult, ...(ticket ? { ticket } : {}), ...(operation ? { operationScope: { runId: operation.runId, workspaceId: operation.workspaceId, workspaceRoot: operation.workspaceRoot } } : {}), ...(replayed ? { replayed: true } : {}) }, isError: !pending && toolFailed(toolName, result) || imageMissing }
  }
  private scope(session: Session): CallScope {
    this.assertActive(session, session.runId)
    const access = this.options.gateway.runFileAccess(session.runId)
    return { runId: session.runId, taskId: session.taskId, workspaceId: session.workspaceId, workspaceRoot: session.workspaceRoot,
      permission: session.permission, boundPaths: Object.values(access?.boundPaths ?? {}), boundDocumentIds: [...session.boundDocumentIds], children: session.children }
  }
  private assertActive(session: Session, runId: string): void {
    if (session.stopped || session.transitioning || session.runId !== runId || !this.sessions.has(session.sessionId)) throw new Error('外部会话已停止或已切换，操作未提交')
  }
  private async execute(session: Session, scope: CallScope, tool: HostTool, ticket: string, input: unknown): Promise<ToolResult> {
    const { runId } = scope
    try {
      this.assertActive(session, runId)
      if (tool.kind === 'service') return { kind: 'read', data: await this.service(session, scope, tool.name, input) }
      if (tool.kind === 'load') {
        const families = loadToolsSchema.parse(input).families
        const available = await this.options.gateway.loadToolFamilies(runId, families)
        session.listChanged = true
        return { kind: 'read', data: { loaded: families.filter(family => available.some(item => item.family === family)), available } }
      }
      const artifact = tool.name === 'artifact.save' ? await this.options.gateway.preflightArtifactSave(runId, input) : undefined
      if (artifact?.approvalRequired) {
        const reason = artifact.outsideWorkspace ? 'outside-workspace' : 'ask'
        if (!await this.options.confirm({ clientName: session.clientName, label: tool.label, reason, paths: [artifact.path] }))
          return failure('approval-denied', '用户未批准此次修改，未执行。')
        this.assertActive(session, runId)
        this.options.gateway.authorizeOperationPaths(runId, ticket, [artifact.path])
      }
      const registration = toolRegistration(tool.name)
      const effect = registration && (typeof registration.effect === 'function' ? registration.effect(input) : registration.effect)
      const modifies = registration ? registration.capability === 'write' || registration.capability === 'save' || effect === 'document-edit' : !tool.read
      if (!artifact && modifies && scope.permission === 'ask' && tool.kind !== 'file' && tool.kind !== 'course'
        && !await this.options.confirm({ clientName: session.clientName, label: tool.label, reason: 'ask' })) return failure('approval-denied', '用户未批准此次修改，未执行。')
      this.assertActive(session, runId)
      if (tool.kind === 'gateway') return await this.options.gateway.execute(runId, ticket, { name: tool.name, input })
      if (tool.kind === 'file') return await this.file(session, scope, ticket, tool, input, true)
      const children = scope.children
      return await createCourseFromHtml(createCourseFromHtmlInputSchema.parse(input), { callId: ticket, permission: scope.permission,
        assertActive: () => this.assertActive(session, runId) }, {
        lookupChild: async callId => children.get(callId) ?? null,
        executeChild: async (callId, child: ModelToolCall) => {
          const result = isAgentFileTool(child.name)
            ? await this.file(session, scope, callId, { name: child.name, label: tool.label, kind: 'file', read: false, description: '', schema: {} }, child.input, true)
            : await this.options.gateway.execute(runId, callId, child)
          children.set(callId, result)
          return result
        },
        documentTarget: documentId => this.options.gateway.issueTarget(runId, documentId, { kind: 'document' }),
      })
    } catch (cause) { return failure('tool-failed', cause instanceof Error ? cause.message : String(cause),
      cause instanceof AgentFileMissingParent ? { pendingCreationPath: cause.pendingCreationPath } : undefined) }
  }
  private async file(session: Session, scope: CallScope, ticket: string, tool: HostTool, input: unknown, approve: boolean): Promise<ToolResult> {
    const { runId } = scope
    const name = tool.name as AgentFileToolName
    const context: AgentFileContext = { runId, workspaceRoot: scope.workspaceRoot, permission: scope.permission, boundPaths: scope.boundPaths, assertActive: () => this.assertActive(session, runId) }
    if (approve && (agentFileMutationNames as readonly string[]).includes(name)) {
      const preflight = await this.options.files.preflightMutation(context, name as AgentFileMutationName, input)
      this.assertActive(session, runId)
      const reason = scope.permission === 'ask' ? 'ask' : scope.permission === 'workspace' && preflight.outside ? 'outside-workspace' : null
      if (reason && !await this.options.confirm({ clientName: session.clientName, label: tool.label, reason, paths: preflight.paths }))
        return failure('approval-denied', '用户未批准此次修改，未执行。')
      if (reason && preflight.outside) context.approvedOutsidePaths = preflight.paths
    }
    this.assertActive(session, runId)
    const outcome = await this.options.files.execute(context, name, input, this.options.gateway.operationIdentity(runId, ticket))
    if (!outcome.opened) return { kind: 'read', data: outcome.data }
    const opened = await this.options.gateway.completeOpenedDocument(runId, outcome.opened, { selection: 'select' })
    session.listChanged = true
    return { kind: 'read', data: { ...outcome.data as object, target: opened.target, writable: opened.writable,
      ...(opened.kind === 'markdown' ? { markdown: opened.source } : opened.kind === 'text' ? { text: opened.source } : {}) } }
  }
  private async service(session: Session, scope: CallScope, name: string, raw: unknown): Promise<unknown> {
    if (name === 'workspace.list') {
      serviceSchemas['workspace.list'].parse(raw)
      return { current: scope.workspaceId, workspaces: (await this.options.conversations.listWorkspaces()).map(workspace => ({
        workspaceId: workspace.workspaceId, name: workspaceName(workspace.rootPath), rootPath: workspace.rootPath, current: workspace.workspaceId === scope.workspaceId })) }
    }
    if (name === 'workspace.switch') {
      const input = serviceSchemas['workspace.switch'].parse(raw)
      await this.bind(session, input.workspaceId)
      return { workspaceId: session.workspaceId, name: session.workspaceName, rootPath: session.workspaceRoot, permission: permissionLabels[session.permission] }
    }
    if (name === 'operation.recent') {
      const input = serviceSchemas['operation.recent'].parse(raw)
      return { operations: session.operations.slice(-(input.limit ?? 20)).reverse().map(item => ({ ticket: item.ticket, tool: item.tool, label: item.label,
        runId: item.runId, workspaceId: item.workspaceId, workspaceRoot: item.workspaceRoot, time: new Date(item.time).toISOString(), ...(item.summary ?? { status: 'running' }),
        delivered: item.delivered === undefined ? 'pending' : item.delivered })) }
    }
    serviceSchemas['workbench.state'].parse(raw)
    return this.workbenchState(session, scope)
  }
  /** Read-only view of the user's foreground. Handles follow the same path rule as file.open in this session. */
  private async workbenchState(session: Session, scope: CallScope): Promise<unknown> {
    const { runId } = scope
    const ui = await this.options.uiState().catch(() => null)
    this.assertActive(session, runId)
    const writableFor = (filePath?: string) => scope.permission !== 'read-only'
      && (scope.permission === 'full' || !filePath || isInsideRoot(scope.workspaceRoot, filePath))
    const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
    const readable = (snapshot: ReturnType<DocumentRegistry['list']>[number]) => scope.permission === 'full'
      || (snapshot.binding.kind === 'file' ? isInsideRoot(scope.workspaceRoot, snapshot.binding.path)
        || scope.boundPaths.some(bound => normalize(bound) === normalize(snapshot.binding.kind === 'file' ? snapshot.binding.path : ''))
        : scope.boundDocumentIds.includes(snapshot.documentId))
    const allowed = this.options.registry.list().filter(readable)
    const documents = allowed.map(snapshot => ({ ...documentSnapshotFacts(snapshot),
      name: snapshot.binding.kind === 'file' ? path.basename(snapshot.binding.path) : snapshot.binding.suggestedName,
      active: snapshot.documentId === ui?.activeDocumentId }))
    const handles = async (documentId: string) => {
      const snapshot = allowed.find(item => item.documentId === documentId)
      if (!snapshot) return null
      const opened = await this.options.gateway.completeOpenedDocument(runId, { documentId,
        writable: writableFor(snapshot.binding.kind === 'file' ? snapshot.binding.path : undefined) },
        { selection: documentId === ui?.activeDocumentId ? 'initialize' : 'preserve' })
      session.listChanged = true
      return { writable: opened.writable, target: opened.target }
    }
    const active = ui?.activeDocumentId ? await handles(ui.activeDocumentId) : null
    let selection: unknown = null
    if (ui?.selection) {
      const owner = ui.selection.documentId === ui.activeDocumentId ? active : await handles(ui.selection.documentId)
      if (owner) selection = { documentId: ui.selection.documentId, targets: await Promise.all(ui.selection.targets.map(async target => ({ kind: target.kind,
        target: await this.options.gateway.issueTarget(runId, ui.selection!.documentId, target, { readOnly: !owner.writable }) }))) }
    }
    return { workspace: { workspaceId: scope.workspaceId, name: session.workspaceName, rootPath: scope.workspaceRoot,
      appWorkspaceId: ui?.workspaceId ?? null }, documents, activeDocument: ui?.activeDocumentId && active ? { documentId: ui.activeDocumentId, ...active } : null, selection,
      ...(ui ? {} : { note: '果铃窗口暂未回报前台状态；文档列表来自主进程。' }) }
  }

  /** Visible as "外部 AI · <client>" in the bound space; created at the first tool call, not on health-check connects. */
  private conversation(session: Session, scope: CallScope): Promise<string> {
    const { workspaceId, runId } = scope
    if (session.conversation) return session.conversation
    const pending = (async () => {
      const title = `外部 AI · ${session.clientName}`
      const existing = (await this.options.conversations.listConversations(workspaceId)).find(item => item.title === title)
      const created = existing ?? await this.options.conversations.createConversation({ workspaceId, title })
      const updated = await this.options.conversations.updateConversation({ workspaceId, conversationId: created.conversationId, expectedRevision: created.revision,
        patch: { runIndex: { ...created.runIndex, externalRunIds: [...created.runIndex.externalRunIds, runId], externalPortIds: [...created.runIndex.externalPortIds, session.sessionId] } } })
      if (session.workspaceId === workspaceId && session.runId === runId) session.conversationId = updated.conversationId
      return updated.conversationId
    })().catch(cause => { if (session.conversation === pending) session.conversation = undefined; throw cause })
    session.conversation = pending
    return pending
  }
  private async emit(scope: CallScope, conversationId: string | undefined, itemId: string, type: ExecutionEventInput['type'], data: ExecutionEventInput['data'], update: ExecutionEventInput['update'] = 'snapshot') {
    if (!conversationId) return
    try {
      await this.options.appendEvent({ eventId: randomUUID(), conversationId, taskId: scope.taskId, runId: scope.runId,
        itemId, time: this.now(), source: 'external-mcp', type, update, data })
    } catch { /* The timeline is a projection; a failed event never changes the tool outcome. */ }
  }
  private async traced(session: Session, scope: CallScope, tool: HostTool, ticket: string, input: unknown, run: () => Promise<ToolResult>): Promise<ToolResult> {
    if (tool.kind === 'service') return run()
    const conversationId = await this.conversation(session, scope).catch(() => undefined)
    await this.emit(scope, conversationId, ticket, 'tool', { toolName: tool.name, label: tool.label, status: 'running', text: '已收到外部工具请求。' }, 'append')
    await this.emit(scope, conversationId, ticket, 'tool', { status: 'running', text: '正在调用正式工具。' }, 'append')
    const result = await run()
    const receipt = committedFact(tool.name, result), saved = saveFact(tool.name, result)
    const outcome = serviceToolOutcome(tool.name, result)
    const pending = outcome?.status === 'pending'
    await this.emit(scope, conversationId, ticket, 'tool', { toolName: tool.name, label: tool.label, status: pending ? 'pending' : toolFailed(tool.name, result) ? 'failed' : 'completed',
      input: JSON.stringify(input), output: JSON.stringify(result),
      ...(pending ? { text: outcome.message } : result.kind === 'error' ? { error: result.message } : toolFailed(tool.name, result) && outcome ? { error: outcome.message } : {}),
      ...applicationEventFacts(tool.name, result),
      ...(saved ? { saveStatus: currentSave(saved) ? 'saved' : 'failed' } : {}) })
    if (receipt) await this.emit(scope, conversationId, `${ticket}:commit`, 'document.commit', {
      documentId: receipt.documentId, operationId: receipt.operationId, revision: receipt.revision, status: receipt.status, label: '外部工具修改已应用' })
    return result
  }
}
