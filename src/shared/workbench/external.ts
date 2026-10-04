import { z } from 'zod'
import { executionSelectionTargetSchema } from './executionDesktop'
import { DEFAULT_PERMISSION_MODE, executionPermissionModeSchema, type ExecutionPermissionMode } from './executionPermission'

/** Owner 2026-10-04: one fixed local endpoint for the explicitly started app; the user may change the port. */
export const EXTERNAL_MCP_DEFAULT_PORT = 45123
export const externalMcpPortSchema = z.number().int().min(1024).max(65535)
export const externalCloseActionSchema = z.enum(['ask', 'tray', 'quit'])
export type ExternalCloseAction = z.infer<typeof externalCloseActionSchema>
export const externalMcpSettingsSchema = z.object({
  enabled: z.boolean(), port: externalMcpPortSchema,
  /** Frozen into each external session when it connects and enforced by Main, like the built-in AI's levels. */
  permission: executionPermissionModeSchema,
  /** What the window close button does; 'ask' shows the hide-to-tray prompt. */
  closeAction: externalCloseActionSchema,
}).strict()
export type ExternalMcpSettings = z.infer<typeof externalMcpSettingsSchema>
export const DEFAULT_EXTERNAL_MCP_SETTINGS: ExternalMcpSettings = { enabled: true, port: EXTERNAL_MCP_DEFAULT_PORT, permission: DEFAULT_PERMISSION_MODE, closeAction: 'ask' }
/** running: listening; disabled: turned off in settings; port-in-use: the port could not be bound and nothing was started. */
export type ExternalMcpState = 'running' | 'disabled' | 'port-in-use' | 'failed'
export function externalMcpEndpoint(port: number): string { return `http://127.0.0.1:${port}/mcp` }

/** One connected external client. No credential appears in listings, events or conversation metadata. */
export interface ExternalSessionView {
  sessionId: string
  clientName: string
  workspaceId: string
  workspaceName: string
  permission: ExecutionPermissionMode
  connectedAt: number
  lastCallAt?: number
  pendingCalls: number
  stopped: boolean
}
export interface ExternalMcpStatus {
  state: ExternalMcpState
  /** Why the service is not running and how to fix it. */
  message?: string
  settings: ExternalMcpSettings
  endpoint: string
  sessions: ExternalSessionView[]
}
/** Renderer-reported foreground state, read by the external read-only `workbench.state` tool. */
export const externalUiStateSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  activeDocumentId: z.string().min(1).optional(),
  selection: z.object({ documentId: z.string().min(1), targets: z.array(executionSelectionTargetSchema).min(1) }).strict().optional(),
}).strict()
export type ExternalUiState = z.infer<typeof externalUiStateSchema>

export const externalRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status') }).strict(),
  z.object({ type: z.literal('configure'), patch: externalMcpSettingsSchema.partial() }).strict(),
  z.object({ type: z.literal('token') }).strict(),
  z.object({ type: z.literal('regenerate-token') }).strict(),
  z.object({ type: z.literal('stop-session'), sessionId: z.string().min(1) }).strict(),
])
export type ExternalRequest = z.infer<typeof externalRequestSchema>
export interface ExternalMcpAPI {
  status(): Promise<ExternalMcpStatus>
  configure(patch: Partial<ExternalMcpSettings>): Promise<ExternalMcpStatus>
  /** Shown only on explicit request in settings, for copying into a client's environment. */
  revealToken(): Promise<string>
  /** The old token stops working immediately and every external session is disconnected. */
  regenerateToken(): Promise<{ token: string; status: ExternalMcpStatus }>
  stopSession(sessionId: string): Promise<ExternalMcpStatus>
  /** The renderer answers Main's foreground-state queries; returns an unsubscribe function. */
  serveUiState?(provider: () => Promise<ExternalUiState>): () => void
}

/** Copyable client configurations, per each client's current official docs (checked 2026-10-04). Nothing is written to client files. */
export interface ExternalClientConfigs { environment: string; claude: string; codex: string; opencode: string; gemini: string }
export function externalClientConfigs(endpoint: string, token?: string): ExternalClientConfigs {
  const value = token ?? '<先在上方显示令牌>'
  return {
    // Windows PowerShell: persists for new terminals and applies to the current one.
    environment: `[Environment]::SetEnvironmentVariable('GUOLING_MCP_TOKEN', '${value}', 'User')\n$env:GUOLING_MCP_TOKEN = '${value}'`,
    // `claude mcp add` stores header values literally, so PowerShell expands the variable when the command runs.
    claude: `claude mcp add --transport http --scope user guoling ${endpoint} --header "Authorization: Bearer $env:GUOLING_MCP_TOKEN"`,
    codex: `[mcp_servers.guoling]\nurl = ${JSON.stringify(endpoint)}\nbearer_token_env_var = "GUOLING_MCP_TOKEN"\n`,
    // OpenCode does not reliably expand {env:...} inside remote headers; the token is written as its docs show.
    opencode: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { guoling: { type: 'remote', url: endpoint, enabled: true,
      headers: { Authorization: `Bearer ${value}` } } } }, null, 2),
    gemini: JSON.stringify({ mcpServers: { guoling: { httpUrl: endpoint, headers: { Authorization: 'Bearer ${GUOLING_MCP_TOKEN}' } } } }, null, 2),
  }
}
