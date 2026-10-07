/**
 * Host-service ports for the five B18 tools (M24 C1–C4), frozen here so the
 * four slices implement against one shape instead of inventing their own.
 *
 * Effect classification uses the mechanisms this codebase actually has, not a
 * separate effect enum:
 *
 * - `ToolDefinition.manual.group` ('read' | 'edit') decides the UI grouping.
 * - `ToolRunGrant.documents[].writable` decides which targets may be written.
 * - A missing service group means the tool is unavailable, never "read-only".
 *
 * A tool that writes a file outside any document (Skill reading is pure read;
 * save/export touch the disk) must still present a document-write or file-write
 * receipt, because Main re-validates authority at the service boundary.
 */
import type { DocumentOperationResult, DocumentSnapshot } from './document'
import type { ModelChatMessage, ModelFailure, ModelUsage } from './modelProvider'

/** Capabilities that may read bundled authoring Skills. */
export interface SkillServicePort {
  /** Read one manifest-registered file of a bundled skill, paged. */
  read(input: { skill: string; path: string; offset: number; limit: number; version?: string }, runId?: string): Promise<SkillReadResult>
  list?(runId: string, refresh?: boolean): Promise<{ entries: readonly { name: string; description: string }[]; warnings: readonly string[]; scripts: string }>
  /** Names and one-line purposes only; never skill body text. */
  catalog(runId?: string): Promise<readonly { name: string; description: string }[]>
}

export type SkillReadResult =
  | { status: 'read'; skill: string; path: string; version: string; content: string; nextOffset?: number; truncated: boolean }
  | { status: 'unknown-skill'; skill: string }
  | { status: 'unknown-path'; skill: string; path: string }

/** Where one imported page lands. Host owns page/section identity, not the model. */
export type HtmlImportDestination =
  | { kind: 'slide-new'; surface: string; after?: string }
  | { kind: 'slide-existing'; location: string }
  | { kind: 'flow-insert'; container: string }

export interface HtmlImportServicePort {
  /**
   * Split an authorized HTML source document and land its pages in one
   * transaction. `lookup` returns the recorded receipt for a repeat of the same
   * outer operation without re-creating pages or re-importing assets.
   */
  import(input: {
    runId: string
    operationId: string
    requestDigest: string
    sourceDocumentId: string
    sourceEpoch: string
    sourceRevision: number
    sourceBindingVersion: number | null
    targetDocumentId: string
    targetEpoch: string
    targetRevision: number
    mode: 'auto' | 'sections' | 'whole'
    destinations: readonly HtmlImportDestination[]
    signal?: AbortSignal
  }): Promise<HtmlImportReceipt>
  lookup(input: { runId: string; operationId: string; requestDigest: string }): Promise<HtmlImportReceipt | null>
  cancel(input: { runId: string; operationId: string }): Promise<void>
}

type HtmlImportPageReceipt = readonly { order: number; location: string; runtimeId: string }[]

export type HtmlImportReceipt =
  | { operationId: string; status: 'applied' | 'unchanged'; pages: HtmlImportPageReceipt; revision: number;
      commit: Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }>; warnings?: readonly { code: string; message: string }[] }
  | { operationId: string; status: 'rejected' | 'failed' | 'cancelled'; pages: HtmlImportPageReceipt; reason: string;
      revision?: never; commit?: never }

/** Observation image bytes live in the app's run resources, never in V9 assets. */
export interface ObservationImageResource {
  resourceId: string
  mimeType: string
  width: number
  height: number
  byteLength: number
}

export interface ObservationServicePort {
  /**
   * Capture the requested page. Reuses the live host only when its identity
   * matches exactly; otherwise loads a frozen Published snapshot in an isolated
   * hidden window and reports `isolated-published`.
   */
  observe(input: {
    runId: string
    requestId: string
    documentId: string
    epoch: string
    revision: number
    projectId: string
    locationId: string
    stateId?: string | null
    viewGeneration?: string
    signal?: AbortSignal
  }): Promise<ObservationResult>
  stopRun?(runId: string): Promise<void> | void
  /** Load real bytes for a previously captured observation resource. */
  readResource(input: { runId: string; resourceId: string }): Promise<{ mimeType: string; bytes: Uint8Array }>
}

export type ObservationResult = {
  source: 'live' | 'isolated-published'
  identity: { documentId: string; epoch: string; revision: number; locationId: string; stateId?: string | null; viewGeneration?: string }
  coverage: { width: number; height: number }
  structure: readonly string[]
  diagnostics: readonly string[]
  image: ObservationImageResource
  reason?: string
}

/** Provider facts from a separate visual request; the Engine journals them with the run. */
export type VisualAnalysisRequestEvent =
  | { type: 'sending'; requestId: string }
  | { type: 'started'; requestId: string; responseId: string; actualModel?: string }
  | { type: 'completed'; requestId: string; responseId: string; actualModel?: string; usage?: ModelUsage }
  | { type: 'failed'; requestId: string; failure: ModelFailure }

/** Vision fallback analysis, performed once against the task-frozen selection. */
export interface VisualAnalysisPort {
  analyze(input: {
    runId: string
    observation: ObservationResult
    question: string
    signal?: AbortSignal
    onRequestEvent?(event: VisualAnalysisRequestEvent): Promise<void>
  }): Promise<
    | { status: 'analyzed'; conclusion: string; actualModel?: string; selection: { model: string; connection: string; billing: string } }
    | { status: 'vision-unavailable'; reason: string; outcome?: 'not-sent' | 'rejected' | 'unknown'; code?: string }
  >
  /** Direct message-image analysis used when a tool returned an image to a text-only conversation model. */
  analyzeImage?(input: {
    runId: string
    sourceId: string
    source: ModelChatMessage
    question: string
    signal?: AbortSignal
    onRequestEvent?(event: VisualAnalysisRequestEvent): Promise<void>
  }): Promise<
    | { status: 'analyzed'; conclusion: string; actualModel?: string; selection: { model: string } }
    | { status: 'vision-unavailable'; reason: string }
  >
}

/** Document save/export producers. Renderer builds bytes; Main verifies and writes. */
export interface DocumentDeliveryServicePort {
  save(input: {
    runId: string
    operationId: string
    requestDigest: string
    documentId: string
    epoch: string
    baseRevision: number
    destination?: string
  }): Promise<SaveReceipt>
  export(input: {
    runId: string
    operationId: string
    requestDigest: string
    documentId: string
    epoch: string
    revision: number
    format: ExportFormat
    destination?: string
  }): Promise<ExportReceipt>
  lookup(input: { runId: string; operationId: string; requestDigest: string }): Promise<SaveReceipt | ExportReceipt | null>
}

export type ExportFormat = 'html-offline' | 'html-online' | 'web-package' | 'pptx' | 'pdf' | 'docx'

export type SaveReceipt = {
  status: 'saved' | 'rejected' | 'failed'
  path?: string
  documentId: string
  epoch: string
  savedRevision?: number
  currentRevision: number
  fileVersion?: string | null
  dirty: boolean
  warnings: readonly string[]
  reason?: string
}

export type ExportReceipt = {
  /** `generated` means bytes exist but nothing was written yet. */
  status: 'written' | 'generated' | 'rejected' | 'failed'
  path?: string
  documentId: string
  epoch: string
  format: ExportFormat
  fileVersion?: string | null
  exportedRevision?: number
  files?: readonly { path?: string; fileVersion?: string; suggestedName: string; byteLength: number }[]
  currentRevision: number
  warnings: readonly string[]
  reason?: string
}

/** Request/reply pair crossing to the renderer export producer. */
export interface ExportBuildRequest {
  requestId: string
  identity: { documentId: string; epoch: string; revision: number; projectId: string }
  format: ExportFormat
  /** Main requests local draft commit before capturing the immutable build snapshot. */
  phase?: 'drain'
  /** Immutable copy supplied by Main; never the renderer's live store. */
  snapshot: DocumentSnapshot
}

export interface ExportBuildReply {
  requestId: string
  identity: ExportBuildRequest['identity']
  status: 'generated' | 'drained' | 'failed' | 'cancelled'
  files?: readonly { relativePath: string; mimeType: string; bytes: Uint8Array }[]
  /** Existing Main print owner converts this renderer-built content to PDF bytes. */
  printHtml?: string
  warnings: readonly string[]
  reason?: string
}

export interface ExportBuildProgress {
  requestId: string
  identity: ExportBuildRequest['identity']
  sequence: number
  stage: 'preparing' | 'building' | 'compiling' | 'complete'
}
export interface ExportBuildCancel { requestId: string; identity: ExportBuildRequest['identity'] }
