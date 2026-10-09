import type { DocumentOperation, DocumentOperationResult } from './document'
import type { DocumentSlot } from '../document/ports'
import type { DisclosedExecutionSettings } from './executionDesktop'
import type { ExecutionPermissionMode } from './executionPermission'
import type { ConversationHome } from './conversations'
import type { ComponentAuthorRecord } from '../contracts/component-platform/runtime'

/** Host-only addresses. A model sees opaque handles, never these coordinates. */
export type ToolTarget =
  | { kind: 'document' }
  | { kind: 'markdown-range'; from: number; to: number }
  /** One visible selection may span disjoint source ranges or ordered Flow text slots. */
  | { kind: 'text-selection'; fragments: { target: TextFragmentTarget; separatorBefore?: string }[] }
  | { kind: 'html-author-field'; authorKey: string; field: 'text' | 'src'; record: ComponentAuthorRecord;
    source?: { from: number; to: number; quote?: '"' | "'" | '' } }
  /** V10 instance/subtree or a data field. Text offsets count code points; math is one atom. */
  | { kind: 'course-instance'; surfaceId: string; instanceId: string; stateId?: string | null; fieldScope?: 'data' | 'flowLayout'; dataPath?: string[]; from?: number; to?: number }
  | { kind: 'course-audio' }
  | { kind: 'course-sound'; soundId: string }
  | { kind: 'course-asset'; assetId: string }
  | { kind: 'spatial-graph'; surfaceId: string; graph: 'path' | 'relation'; graphId: string }
  | { kind: 'course-surface'; surfaceId: string; stateId?: string | null }
  | { kind: 'course-location'; locationId: string }
  | { kind: 'course-owner'; locationId: string; owner: 'scene' | 'global' | 'surface' | 'world'; stateId?: string; insertionOrigin?: { x: number; y: number } }
  | { kind: 'course-state'; locationId: string; stateId: string }
  | { kind: 'course-interaction'; locationId: string; ruleId: string; stateId?: string }
  | { kind: 'course-object'; locationId: string; itemId: string; stateId?: string; compositionNodeId?: string }
  | { kind: 'flow-container'; surfaceId: string; parentId: string | null; index?: number }
  | { kind: 'flow-block'; surfaceId: string; blockId: string; parentId: string | null }
  | { kind: 'flow-range'; surfaceId: string; blockId: string; parentId: string | null; slot: DocumentSlot; from: number; to: number }
  | { kind: 'course-background'; owner: 'course' | 'surface' | 'scene'; surfaceId?: string; sceneId?: string; stateId?: string }

export type TextFragmentTarget = Extract<ToolTarget, { kind: 'markdown-range' }>
  | (Extract<ToolTarget, { kind: 'course-instance' }> & { dataPath: string[]; from: number; to: number })

export interface ToolRunGrant {
  runId: string
  actor: DocumentOperation['actor']
  documents: readonly { documentId: string; writable: readonly ToolTarget[]; selection?: readonly ToolTarget[] }[]
  disclosedSettings?: DisclosedExecutionSettings
  /** Main-frozen file scope for built-in task delivery tools; external MCP grants use their bound documents. */
  fileAccess?: { permission: ExecutionPermissionMode; workspaceRoot?: string; conversationHomeRoot?: string; conversationHome?: ConversationHome; boundPaths?: Record<string, string> }
  /** Explicit user result authorization, frozen by Main; methods and observations cannot extend it. */
  webAuthorization?: { origins: readonly string[]; actions: readonly ('submit' | 'upload' | 'download')[] }
  materialIds?: readonly string[]
  /** Frozen by the visible content action; omitted model targets resolve only here. */
  contentOutput?: { kind: 'replace-text'; documentId: string; target: ToolTarget }
}

/** Transport assigns callId outside the model arguments. */
export interface ModelToolCall { name: string; input: unknown }
export interface ToolDefinition {
  name: string
  description: string
  schema: Record<string, unknown>
  manual: { label: string; group: 'read' | 'edit'; targetKinds: readonly ToolTarget['kind'][] }
}
/** Non-blocking feedback about the committed result; it never changes the receipt status. */
export interface ToolAdvisory { step: number; code: 'native-text-shrink' | 'native-text-transparent-background' | 'native-text-low-contrast' | 'html-import-warning' | 'authoring-preserved'; message: string }
/** Host-owned image references; transports prepare these through the resource owner. */
export interface ToolResultImage {
  kind: 'image'
  source: 'preview' | 'observation' | 'mcp'
  resourceId: string
  mimeType: string
  byteLength?: number
  label?: string
  detail?: 'auto' | 'low' | 'high'
}
export interface PreparedToolImage {
  kind: 'image'
  /** Stable host-owned provenance used when settling diagnostics for this exact image. */
  source?: string
  bytes: Uint8Array
  mimeType: string
  label?: string
  detail?: 'auto' | 'low' | 'high'
}
export type ToolResult =
  | { kind: 'document-operation'; result: DocumentOperationResult; affected: readonly string[]; advisories?: readonly ToolAdvisory[] }
  | { kind: 'read'; data: unknown; nextCursor?: string; images?: readonly ToolResultImage[] }
  | { kind: 'error'; code: string; message: string; data?: unknown }

export interface ToolGateway {
  /** Host recovery query; this is not a model tool. */
  lookup(runId: string, callId: string, call: ModelToolCall): Promise<ToolResult | null>
  describe(names?: readonly string[]): Promise<readonly ToolDefinition[]>
  execute(runId: string, callId: string, call: ModelToolCall): Promise<ToolResult>
}
