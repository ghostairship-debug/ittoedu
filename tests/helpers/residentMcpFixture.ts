import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ConversationStore } from '../../src/main/workbench/conversations/ConversationStore'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExternalMcpService, type ExternalApproval, type ExternalFilePort } from '../../src/main/workbench/external/ExternalMcpService'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, type ExternalMcpSettings, type ExternalUiState } from '../../src/shared/workbench/external'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

/** A started resident MCP service over a real DocumentHost, a registered workspace and an in-memory explicitly enabled settings store. */
export async function residentMcpFixture(input: {
  host: DocumentHostService
  directory: string
  workspaceRoot: string
  settings?: Partial<ExternalMcpSettings>
  conversations?: ConversationStore
  appendEvent?(event: ExecutionEventInput): Promise<unknown>
  confirm?(request: ExternalApproval): boolean | Promise<boolean>
  files?: (files: AgentFileService) => ExternalFilePort
}) {
  const conversations = input.conversations ?? new ConversationStore({ directory: path.join(input.directory, 'conversations') })
  const root = await realpath(input.workspaceRoot)
  if (!await conversations.readWorkspace('space')) await conversations.registerWorkspace({ workspaceId: 'space', rootPath: root, managed: false, authorization: 'user-selected' })
  let settings: ExternalMcpSettings = { ...DEFAULT_EXTERNAL_MCP_SETTINGS, enabled: true, port: 0, ...input.settings }
  const ui: { state: ExternalUiState | null } = { state: { workspaceId: 'space' } }
  const approvals: ExternalApproval[] = []
  const files = new AgentFileService(input.host)
  const service = new ExternalMcpService({
    settings: { read: async () => ({ ...settings }), update: async patch => (settings = { ...settings, ...patch }) },
    conversations, registry: input.host.registry, gateway: input.host.tools, files: input.files?.(files) ?? files,
    workspaceRoot: rootPath => realpath(rootPath), uiState: async () => ui.state,
    appendEvent: event => input.appendEvent?.(event) ?? Promise.resolve(),
    confirm: async request => { approvals.push(request); return input.confirm ? input.confirm(request) : true },
  })
  const clients: Client[] = []
  const started = await service.start()
  const connect = async (name = 'resident-test-client') => {
    const client = new Client({ name, version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(service.server.listeningPort ? `http://127.0.0.1:${service.server.listeningPort}/mcp` : started.endpoint)))
    clients.push(client)
    return client
  }
  const close = async () => { await Promise.allSettled(clients.map(client => client.close())); await service.close() }
  return { service, conversations, root, ui, approvals, connect, close, settings: () => settings }
}

/** Tool reply envelope as returned by the resident server. */
export interface ResidentToolReply { content: { type: string; text?: string }[]; structuredContent: { result: any; ticket?: string; operationScope?: { runId: string; workspaceId: string; workspaceRoot: string }; replayed?: boolean }; isError: boolean }
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}, ticket?: string): Promise<ResidentToolReply> {
  return await client.callTool({ name, arguments: args, ...(ticket ? { _meta: { 'guoling/ticket': ticket } } : {}) }) as unknown as ResidentToolReply
}
