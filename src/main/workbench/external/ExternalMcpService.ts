import { randomUUID } from 'node:crypto'
import type { DocumentRegistry } from '../../../core/documents/DocumentRegistry'
import type { DocumentToolGateway } from '../../../core/tools/DocumentToolGateway'
import type { AttachmentReader, InputAttachmentReference } from '../../../shared/workbench/attachments'
import type { ConversationRecord } from '../../../shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import type { ExecutionEventInput } from '../../../shared/workbench/executionEvents'
import { externalGrantSchema, externalRequestSchema, type ExternalMcpAPI, type ExternalOwner, type ExternalGrantInput, type ExternalGrantResult,
  type ExternalGrantView, type ExternalHandoff, type ExternalConnection, type ExternalClientConfig } from '../../../shared/workbench/external'
import type { ConversationStore } from '../conversations/ConversationStore'
import type { ExecutionEngine } from '../execution/ExecutionEngine'
import { McpDocumentServer, type ExternalResource } from './McpDocumentServer'

export interface ExternalMcpServiceOptions {
  conversations: ConversationStore
  registry: DocumentRegistry
  gateway: DocumentToolGateway
  engine: Pick<ExecutionEngine, 'read' | 'stop' | 'wait'>
  appendEvent(event: ExecutionEventInput): Promise<unknown>
  attachments?: AttachmentReader
  now?: () => number
}

export function externalClientConfig(connection: ExternalConnection): ExternalClientConfig {
  return {
    transport: 'streamable-http', endpoint: connection.endpoint, authorization: `Bearer ${connection.bearer}`,
    codex: `[mcp_servers.guoling]\nurl = ${JSON.stringify(connection.endpoint)}\nbearer_token_env_var = "GUOLING_MCP_TOKEN"\n`,
    claude: JSON.stringify({ mcpServers: { guoling: { type: 'http', url: connection.endpoint, headers: { Authorization: 'Bearer ${GUOLING_MCP_TOKEN}' } } } }, null, 2),
    opencode: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { guoling: { type: 'remote', url: connection.endpoint,
      enabled: true, oauth: false, headers: { Authorization: 'Bearer {env:GUOLING_MCP_TOKEN}' } } } }, null, 2),
  }
}
const ongoing = (record: ExecutionRunRecord) => ['queued', 'running', 'stopping'].includes(record.status)
const draftIdentity = (record: ConversationRecord) => JSON.stringify({ title: record.title, inputDraft: record.inputDraft,
  inputAttachments: record.inputAttachments, frozenContextRefs: record.frozenContextRefs, runIndex: record.runIndex })

/** Conversation ownership and revocable transport lifecycle. Domain authorization remains in the shared Gateway. */
export class ExternalMcpService implements ExternalMcpAPI {
  readonly server: McpDocumentServer
  private readonly grants = new Map<string, ExternalGrantView>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private closed = false
  constructor(private readonly options: ExternalMcpServiceOptions) {
    this.server = new McpDocumentServer(options)
  }
  private async required(input: ExternalOwner) {
    const record = await this.options.conversations.readConversation(input)
    if (!record) throw new Error('会话已不存在或不属于当前空间')
    return record
  }
  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(action)
    this.queues.set(id, next)
    void next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id) }).catch(() => undefined)
    return next
  }
  private async settle(current: ConversationRecord, runId?: string): Promise<ExecutionRunRecord | null> {
    if (runId && !current.runIndex.builtinRunIds.includes(runId)) throw new Error('交接运行不属于当前会话')
    let source: ExecutionRunRecord | null = null
    for (const id of current.runIndex.builtinRunIds) {
      let record = await this.options.engine.read(id)
      if (!record || record.input.conversationId !== current.conversationId) throw new Error('运行记录缺失或不属于当前会话，无法确认交接事实')
      if (ongoing(record)) { await this.options.engine.stop(id); record = await this.options.engine.wait(id) }
      if (ongoing(record)) throw new Error('旧运行尚未结算，未创建外部授权')
      if (id === runId) source = record
    }
    return source
  }
  private facts(record: ExecutionRunRecord | null, instruction: string, remainingWork?: string): ExternalHandoff {
    const handoff: ExternalHandoff = {
      originalGoal: record?.input.instruction ?? instruction,
      ...(record ? { previousRun: record.runId } : {}),
      originalTargets: structuredClone(record?.input.documents ?? []).map(item => ({ ...item })),
      committedFacts: [], unresolvedTools: [], uncertainRequests: [],
      remainingWork: remainingWork?.trim() || '根据原始目标和已提交事实继续；先重新观察，不重复已提交的操作。',
      attachments: structuredClone(record?.input.inputContext?.attachments ?? []).map(item => ({ ...item })),
      observe: 'guoling://task/context',
    }
    for (const tool of record?.tools ?? []) {
      const result = tool.result
      if (result?.kind === 'document-operation' && (result.result.status === 'applied' || result.result.status === 'unchanged')) {
        handoff.committedFacts.push({ operationId: result.result.operationId, documentId: result.result.documentId,
          revision: result.result.revision, status: result.result.status, tool: tool.call.name })
      } else if (tool.state !== 'returned' || result?.kind !== 'read') {
        handoff.unresolvedTools.push({ callId: tool.callId, tool: tool.call.name, state: tool.state,
          reason: result?.kind === 'error' ? result.message : result?.kind === 'document-operation' ? result.result.status : '未取得正式回执' })
      }
    }
    handoff.uncertainRequests = (record?.requests ?? []).filter(item => item.state === 'sending' || item.failure?.outcome === 'unknown').map(item => item.requestId)
    return handoff
  }
  async handoff(input: ExternalOwner & { runId: string; remainingWork?: string }): Promise<ExternalHandoff> {
    return this.serial(input.conversationId, async () => {
      const current = await this.required(input), source = await this.settle(current, input.runId)
      await this.required(input) // A deleted conversation cannot publish a new handoff.
      return this.facts(source, '', input.remainingWork)
    })
  }
  private async resources(references: readonly InputAttachmentReference[]): Promise<ExternalResource[]> {
    if (references.length && !this.options.attachments) throw new Error('附件读取服务未接通，未创建外部授权')
    const resources: ExternalResource[] = []
    for (const reference of references) {
      const read = await this.options.attachments!.readRepresentation(reference.attachmentId, reference.representationId)
      resources.push({ uri: `guoling://attachment/${randomUUID()}`, name: read.snapshot.name, mimeType: read.representation.mediaType,
        provenance: read.representation.provenance, gaps: read.snapshot.gaps.map(gap => gap.message),
        content: read.representation.kind === 'text' ? { text: new TextDecoder('utf-8', { fatal: true }).decode(read.bytes) } : { blob: Buffer.from(read.bytes).toString('base64') } })
    }
    return resources
  }
  grant(raw: ExternalGrantInput): Promise<ExternalGrantResult> {
    const input = externalGrantSchema.parse(raw)
    return this.serial(input.conversationId, () => this.createGrant(input))
  }
  private async createGrant(input: ExternalGrantInput): Promise<ExternalGrantResult> {
    if (this.closed) throw new Error('外部连接服务已关闭')
    const before = await this.required(input)
    if (before.revision !== input.expectedRevision) throw new Error('会话已改变，请刷新后重新授权')
    if (!input.instruction.trim() && !input.sourceRunId) throw new Error('请填写本次外部任务要求')
    const source = await this.settle(before, input.sourceRunId)
    const current = await this.required(input)
    // The built-in run may append its final assistant reply during stop; that alone does not change user intent.
    if (draftIdentity(current) !== draftIdentity(before)) throw new Error('交接期间会话或目标已改变，请重新授权')
    for (const reference of input.documents) {
      const snapshot = await this.options.registry.get(reference.documentId).drain()
      if (snapshot.epoch !== reference.epoch || snapshot.revision !== reference.revision) throw new Error('所选文档或范围已改变，请重新选择')
    }
    const handoff = this.facts(source, input.instruction, input.remainingWork)
    if (!source) handoff.originalTargets = structuredClone(input.documents).map(({ documentId, writable }) => ({ documentId, writable }))
    const refs = new Map([...handoff.attachments, ...current.inputAttachments].map(ref => [`${ref.attachmentId}:${ref.representationId}`, ref]))
    handoff.attachments = [...refs.values()]
    const resources = await this.resources(handoff.attachments)
    if (this.closed) throw new Error('外部连接服务已关闭')
    const connection = await this.server.grant({ workspaceId: input.workspaceId, conversationId: input.conversationId,
      taskId: randomUUID(), instruction: input.instruction, documents: input.documents, expectedDocuments: input.documents,
      lifetimeMs: input.lifetimeMs, handoff }, resources)
    this.grants.set(connection.connectionId, { workspaceId: input.workspaceId, conversationId: input.conversationId,
      connectionId: connection.connectionId, runId: connection.runId, expiresAt: connection.expiresAt,
      status: 'active', documents: structuredClone(input.documents) })
    try {
      if (this.closed) throw new Error('外部连接服务已关闭')
      const conversation = await this.options.conversations.updateConversation({ workspaceId: input.workspaceId, conversationId: input.conversationId,
        expectedRevision: current.revision, patch: { runIndex: { ...current.runIndex,
          externalRunIds: [...current.runIndex.externalRunIds, connection.runId], externalPortIds: [...current.runIndex.externalPortIds, connection.connectionId] } } })
      return { conversation, connection, handoff, config: externalClientConfig(connection) }
    } catch (cause) { await this.server.revoke(connection.connectionId); throw cause }
  }
  async list(input: ExternalOwner): Promise<ExternalGrantView[]> {
    await this.required(input)
    return [...this.grants.values()].filter(grant => grant.workspaceId === input.workspaceId && grant.conversationId === input.conversationId)
      .map(grant => ({ ...structuredClone(grant), status: this.server.status(grant.connectionId) }))
  }
  async revoke(input: ExternalOwner & { connectionId: string }): Promise<void> {
    await this.required(input)
    const grant = this.grants.get(input.connectionId)
    if (!grant || grant.workspaceId !== input.workspaceId || grant.conversationId !== input.conversationId) throw new Error('授权不属于当前空间和会话')
    await this.server.revoke(input.connectionId)
  }
  writableConnectionsForDocument(documentId: string): (ExternalOwner & { connectionId: string })[] {
    return [...this.grants.values()].filter(grant => this.server.status(grant.connectionId) === 'active'
      && grant.documents.some(document => document.documentId === documentId && document.writable.length > 0))
      .map(({ workspaceId, conversationId, connectionId }) => ({ workspaceId, conversationId, connectionId }))
  }
  async stopForDocument(documentId: string): Promise<void> {
    await Promise.all(this.writableConnectionsForDocument(documentId).map(grant => this.server.revoke(grant.connectionId)))
  }
  /** Called inside ConversationStore's delete transaction: do not read that store again and deadlock its queue. */
  async revokeConversation(input: ExternalOwner & { portIds: readonly string[] }): Promise<void> {
    for (const id of input.portIds) {
      const grant = this.grants.get(id)
      if (grant && (grant.workspaceId !== input.workspaceId || grant.conversationId !== input.conversationId)) throw new Error('外部授权与待删除会话不匹配')
    }
    // Includes a grant awaiting durable registration, so deletion cannot leave an unindexed live capability.
    await Promise.all([...this.grants.values()].filter(grant => grant.workspaceId === input.workspaceId && grant.conversationId === input.conversationId)
      .map(grant => this.server.revoke(grant.connectionId)))
  }
  async operate(raw: unknown): Promise<unknown> {
    const input = externalRequestSchema.parse(raw)
    switch (input.type) {
      case 'grant': { const { type: _, ...grant } = input; return this.grant(grant) }
      case 'list': return this.list(input)
      case 'revoke': return this.revoke(input)
      case 'handoff': return this.handoff(input)
    }
  }
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.queues.values()])
    await this.server.close()
  }
}
