/**
 * Durable space and conversation metadata.  Document contents, provider settings,
 * execution facts and run checkpoints deliberately have separate owners.
 */
export const CONVERSATION_STORE_SCHEMA_VERSION = 1 as const

export interface WorkspaceRecord {
  workspaceId: string
  /** Mutable location binding; it is never used as the workspace identity. */
  rootPath: string
  managed: boolean
  authorization: 'user-selected' | 'managed'
  revision: number
  createdAt: number
  updatedAt: number
}

export type ConversationMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ConversationMessage {
  messageId: string
  role: ConversationMessageRole
  text: string
  createdAt: number
  attachmentIds: string[]
  runId?: string
}

/** A frozen, explicit document/selection reference. Paths and live renderer state are not stored here. */
export interface FrozenConversationContextRef {
  contextRefId: string
  documentId: string
  revision: number
  epoch: string
  selectionId?: string
  /** Read-only context; never an implied grant to write the selected objects. */
  selection?: import('./tools').ToolTarget[]
  writeScope?: import('./tools').ToolTarget[]
}

/** Run checkpoints remain owned by ExecutionRunStore; this is only the conversation index. */
export interface ConversationRunIndex {
  builtinRunIds: string[]
  externalRunIds: string[]
  /** Revocable bridge grants, never provider credentials or external private thread IDs. */
  externalPortIds: string[]
}

/**
 * Optional place a conversation belongs to inside its workspace (Owner 2026-09-24). It only groups the session
 * list: it grants nothing and follows in-app rename/move. It is advisory metadata, so changing it never bumps
 * the conversation revision that guards drafts and messages.
 */
export interface ConversationHome {
  kind: 'folder' | 'file'
  /** Workspace-relative, `/`-separated, never empty (the workspace itself is "no home"). */
  path: string
  /** Set by Main only when the owned file moved into another space; conversation ownership stays put. */
  workspaceId?: string
  /** The folder or file was removed; the conversation is kept and labelled. */
  missing?: true
}

export interface ConversationRecord {
  conversationId: string
  workspaceId: string
  title: string
  messages: ConversationMessage[]
  attachmentIds: string[]
  runIndex: ConversationRunIndex
  inputDraft: string
  inputAttachments: import('./attachments').InputAttachmentReference[]
  frozenContextRefs: FrozenConversationContextRef[]
  home?: ConversationHome
  revision: number
  createdAt: number
  updatedAt: number
}

const HOME_PATH_LIMIT = 1024
/** A safe workspace-relative home path: no root, drive, backslash, empty, `.` or `..` segment. */
export function validHomePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= HOME_PATH_LIMIT && !path.includes('\\') && !path.startsWith('/')
    && !/^[a-zA-Z]:/.test(path) && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}
export function validConversationHome(home: unknown): home is ConversationHome {
  if (!home || typeof home !== 'object') return false
  const value = home as Record<string, unknown>
  return Object.keys(value).every(key => key === 'kind' || key === 'path' || key === 'workspaceId' || key === 'missing')
    && (value.kind === 'folder' || value.kind === 'file') && validHomePath(value.path)
    && (value.workspaceId === undefined || typeof value.workspaceId === 'string' && value.workspaceId.length > 0 && value.workspaceId.length <= 256)
    && (value.missing === undefined || value.missing === true)
}
/** Whether a conversation's home lies in this explorer scope: a folder includes everything below it; a file only itself. */
export function homeInScope(scope: Pick<ConversationHome, 'kind' | 'path'> & { workspaceId?: string }, home: ConversationHome | undefined): boolean {
  if (!home || home.workspaceId && home.workspaceId !== scope.workspaceId) return false
  const a = home.path.toLocaleLowerCase(), b = scope.path.toLocaleLowerCase()
  return scope.kind === 'file' ? home.kind === 'file' && a === b : a === b || a.startsWith(`${b}/`)
}
/** The home after `from` moved to `to` (a rename or move), or null when the home is not affected. */
export function rebaseHome(home: ConversationHome, from: string, to: string): ConversationHome | null {
  const lower = home.path.toLocaleLowerCase(), prefix = from.toLocaleLowerCase()
  if (lower !== prefix && !lower.startsWith(`${prefix}/`)) return null
  return { ...home, path: to + home.path.slice(from.length) }
}
/** Display name of a home: its last path segment. */
export function homeName(home: Pick<ConversationHome, 'path'>): string { return home.path.split('/').at(-1) ?? home.path }

export interface ConversationStoreState {
  schemaVersion: typeof CONVERSATION_STORE_SCHEMA_VERSION
  workspaces: Record<string, WorkspaceRecord>
  conversations: Record<string, ConversationRecord>
}

export interface ConversationPatch {
  /** Homes change through `setConversationHome` / relocation, never through a revisioned patch. */
  title?: string
  messages?: ConversationMessage[]
  attachmentIds?: string[]
  runIndex?: ConversationRunIndex
  inputDraft?: string
  inputAttachments?: import('./attachments').InputAttachmentReference[]
  frozenContextRefs?: FrozenConversationContextRef[]
}

export interface ReleasedConversationReferences {
  attachmentIds: string[]
  contextRefIds: string[]
  builtinRunIds: string[]
  externalRunIds: string[]
  externalPortIds: string[]
}

export interface ConversationDeletionPorts {
  stopBuiltinRuns(input: { workspaceId: string; conversationId: string; runIds: readonly string[] }): Promise<void>
  revokeExternalPorts(input: { workspaceId: string; conversationId: string; portIds: readonly string[] }): Promise<void>
  /** Durable release intent must precede deletion so a crash can resume resource cleanup. */
  prepareResourceRelease?(input: { workspaceId: string; conversationId: string; runIds: readonly string[] }): Promise<void>
}
