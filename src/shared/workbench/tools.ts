import type { DocumentOperation, DocumentOperationResult } from './document'
import type { DocumentSlot } from '../document/ports'
import type { DisclosedExecutionSettings } from './executionDesktop'

/** Host-only addresses. A model sees opaque handles, never these coordinates. */
export type ToolTarget =
  | { kind: 'document' }
  | { kind: 'markdown-range'; from: number; to: number }
  | { kind: 'course-audio' }
  | { kind: 'course-sound'; soundId: string }
  | { kind: 'course-asset'; assetId: string }
  | { kind: 'spatial-graph'; surfaceId: string; graph: 'path' | 'relation'; graphId: string }
  | { kind: 'course-surface'; surfaceId: string }
  | { kind: 'course-location'; locationId: string }
  | { kind: 'course-owner'; locationId: string; owner: 'scene' | 'global' | 'surface' | 'world'; stateId?: string; insertionOrigin?: { x: number; y: number } }
  | { kind: 'course-state'; locationId: string; stateId: string }
  | { kind: 'course-interaction'; locationId: string; ruleId: string; stateId?: string }
  | { kind: 'course-object'; locationId: string; itemId: string; stateId?: string }
  | { kind: 'flow-container'; surfaceId: string; parentId: string | null; index?: number }
  | { kind: 'flow-block'; surfaceId: string; blockId: string; parentId: string | null }
  | { kind: 'flow-range'; surfaceId: string; blockId: string; parentId: string | null; slot: DocumentSlot; from: number; to: number }
  | { kind: 'course-background'; owner: 'course' | 'surface' | 'scene'; surfaceId?: string; sceneId?: string; stateId?: string }

export interface ToolRunGrant {
  runId: string
  actor: DocumentOperation['actor']
  documents: readonly { documentId: string; writable: readonly ToolTarget[] }[]
  disclosedSettings?: DisclosedExecutionSettings
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
export interface ToolAdvisory { step: number; code: 'native-text-shrink' | 'native-text-transparent-background' | 'native-text-low-contrast'; message: string }
export type ToolResult =
  | { kind: 'document-operation'; result: DocumentOperationResult; affected: readonly string[]; advisories?: readonly ToolAdvisory[] }
  | { kind: 'read'; data: unknown; nextCursor?: string }
  | { kind: 'error'; code: string; message: string }

export interface ToolGateway {
  /** Host recovery query; this is not a model tool. */
  lookup(runId: string, callId: string, call: ModelToolCall): Promise<ToolResult | null>
  describe(names?: readonly string[]): Promise<readonly ToolDefinition[]>
  execute(runId: string, callId: string, call: ModelToolCall): Promise<ToolResult>
}
