/**
 * HTML preview request / page-message contracts (M23).
 *
 * Main recognises this request family through the existing strict
 * `workspaceFiles` union and routes it to `HtmlPreviewService`. Two rules hold
 * throughout:
 *
 * 1. Requests describe *which* document and *which* tab, never a path. Main
 *    resolves the file path and the text model from the open document session,
 *    so a renderer cannot name a root directory or an arbitrary file.
 * 2. Page messages are a separate strict envelope from Main requests. They
 *    report targets, geometry, pagination intent and key intent only — never a
 *    document write command, never replacement body text, never a save request.
 *    The value written always originates from the workbench's own edit input
 *    and its real commit action.
 */
import { z } from 'zod'
import { htmlSourceEditCommandSchema, type HtmlSourceEditOutcome } from '../html/sourceEditCommands'
import { componentAuthorGeometryObservationSchema, componentAuthorRecordSchema, componentAuthorRecordsSchema } from '../contracts/component-platform/schema'
import type { ComponentAuthorRecord } from '../contracts/component-platform/runtime'

const id = z.string().min(1)
const revision = z.number().int().nonnegative()
const bindingVersion = z.number().int().positive()
const coordinate = z.number().finite()
const extent = z.number().finite().nonnegative()

/** Bounded number of targets one page report may carry. */
export const HTML_PREVIEW_TARGET_MAX = 64

const text = z.string()

export const htmlPreviewTargetKindSchema = z.enum(['text', 'image'])

const span = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).strict()

const rect = z.object({ x: coordinate, y: coordinate, width: extent, height: extent }).strict()

/** A transient UI handle chosen by the workbench; never a persistent identity. */
const targetHandle = id

/**
 * The page's description of what it believes it is pointing at. Main never
 * trusts this: it re-resolves against the current canonical source and rejects
 * a mismatch rather than writing to a guessed position.
 */
export const htmlPreviewTargetReportSchema = z.object({
  handle: targetHandle,
  kind: htmlPreviewTargetKindSchema,
  /** Source context the page observed, used to disambiguate identical text. */
  domPath: z.array(z.object({ name: z.string(), index: z.number().int().nonnegative() }).strict()),
  sectionOrder: z.number().int().nonnegative().nullable(),
  /** Raw (entity-encoded) source text or attribute value the page displayed. */
  rawText: text,
  attributeName: z.string().nullable(),
  rect,
  /** True when the page created this node at runtime rather than parsing it. */
  scriptCreated: z.boolean(),
  authoring: z.object({ authorKey: id, record: componentAuthorRecordSchema }).strict().optional(),
  bindingStatus: z.enum(['bound', 'unmounted', 'unresolved', 'source-required']).optional(),
  geometry: componentAuthorGeometryObservationSchema.optional(),
}).strict()

export const htmlPreviewRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('html-preview.edit-source'), operationId: id, documentId: id, epoch: id, baseRevision: revision, bindingVersion, leaseId: id, loadId: id, command: htmlSourceEditCommandSchema }).strict(),
  /** Open a preview lease for an already-open HTML document in a given tab. */
  z.object({
    type: z.literal('html-preview.open'),
    documentId: id,
    epoch: id,
    expectedBindingVersion: bindingVersion,
    tabId: id,
  }).strict(),
  /** Idempotent release; releasing an unknown or already-released lease succeeds. */
  z.object({ type: z.literal('html-preview.release'), leaseId: id, tabId: id }).strict(),
  /** Resolve a page-reported target against the current canonical source. */
  z.object({
    type: z.literal('html-preview.resolve-target'),
    leaseId: id,
    loadId: id,
    revision,
    targets: z.array(htmlPreviewTargetReportSchema).max(HTML_PREVIEW_TARGET_MAX),
  }).strict(),
  /**
   * Apply one human edit. `text` carries the new value; `image` carries real
   * bytes from the existing picker. Neither carries a disk path.
   */
  z.object({
    type: z.literal('html-preview.edit'),
    operationId: id,
    documentId: id,
    epoch: id,
    baseRevision: revision,
    bindingVersion,
    leaseId: id,
    loadId: id,
    target: targetHandle,
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), value: text }).strict(),
      z.object({ kind: z.literal('style'), patch: z.record(z.string().min(1), z.string().nullable()) }).strict(),
      z.object({ kind: z.literal('geometry'), geometry: componentAuthorRecordSchema.shape.overrides.shape.geometry.unwrap() }).strict(),
      z.object({
        kind: z.literal('image'),
        name: z.string().min(1),
        mimeType: z.string().min(1),
        bytes: z.instanceof(Uint8Array)
          .refine(bytes => bytes.byteLength > 0, '图片字节不能为空'),
      }).strict(),
    ]),
  }).strict(),
])

export type HtmlPreviewRequest = z.infer<typeof htmlPreviewRequestSchema>

/** Source locator Main derived for one resolved target. */
export interface HtmlPreviewSourceLocator {
  documentId: string
  epoch: string
  revision: number
  bindingVersion: number
  targetKind: z.infer<typeof htmlPreviewTargetKindSchema>
  elementSpan: { start: number; end: number }
  valueSpan: { start: number; end: number } | null
  attributeName: string | null
  expectedRaw: string
  authoring?: { authorKey: string; record: ComponentAuthorRecord }
}

export type HtmlPreviewResolvedTarget =
  | { handle: string; status: 'editable'; locator: HtmlPreviewSourceLocator }
  | { handle: string; status: 'not-editable'; reason: 'script-created' | 'not-unique' | 'source-changed' | 'unsupported-target' }

export interface HtmlPreviewLease {
  leaseId: string
  documentId: string
  epoch: string
  revision: number
  bindingVersion: number
  loadId: string
  url: string
}

export type HtmlPreviewEditOutcome =
  | { status: 'applied'; revision: number; savedRevision: number | null; dirty: true; patch: { handle: string; kind: 'text' | 'image'; value: string; rewroteResponsive?: boolean; authoringRecords?: z.infer<typeof componentAuthorRecordsSchema>; authoringAnchor?: string } }
  | { status: 'unchanged'; revision: number }
  | { status: 'rejected'; reason: 'stale-epoch' | 'stale-revision' | 'stale-binding' | 'lease-released' | 'source-changed' | 'not-editable' | 'conflict' }

export type HtmlPreviewResponse<T extends HtmlPreviewRequest> =
  T extends { type: 'html-preview.open' } ? HtmlPreviewLease
  : T extends { type: 'html-preview.release' } ? { released: boolean }
  : T extends { type: 'html-preview.resolve-target' } ? { revision: number; targets: HtmlPreviewResolvedTarget[] }
  : T extends { type: 'html-preview.edit-source' } ? HtmlSourceEditOutcome
  : HtmlPreviewEditOutcome

/**
 * Page -> workbench envelope. Separate from Main requests on purpose: this is
 * untrusted page output that only ever produces editor-side UI state.
 */
export const htmlPreviewPageMessageSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('card-targets'), protocol: z.literal(1), leaseId: id, loadId: id,
    seq: z.number().int().nonnegative(), targets: z.array(htmlPreviewTargetReportSchema).max(HTML_PREVIEW_TARGET_MAX) }).strict(),
  z.object({
    event: z.literal('ready'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    sectionCount: z.number().int().min(0),
    sectionsAmbiguous: z.boolean(),
  }).strict(),
  z.object({
    event: z.literal('targets'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    targets: z.array(htmlPreviewTargetReportSchema).max(HTML_PREVIEW_TARGET_MAX),
  }).strict(),
  z.object({
    event: z.literal('edit-targets'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    scanId: id,
    targets: z.array(htmlPreviewTargetReportSchema).max(HTML_PREVIEW_TARGET_MAX),
  }).strict(),
  z.object({
    event: z.literal('edit-mode-ready'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    requestId: id,
    enabled: z.boolean(),
  }).strict(),
  z.object({
    event: z.literal('page'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    pageIndex: z.number().int().nonnegative(),
    perPageScroll: extent,
  }).strict(),
  z.object({
    event: z.literal('key'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    intent: z.enum(['next-page', 'previous-page', 'save', 'undo', 'redo']),
  }).strict(),
  z.object({
    event: z.literal('viewport'),
    protocol: z.literal(1),
    leaseId: id,
    loadId: id,
    seq: z.number().int().nonnegative(),
    width: extent,
    height: extent,
  }).strict(),
])

export type HtmlPreviewPageMessage = z.infer<typeof htmlPreviewPageMessageSchema>

/** Verify a page message belongs to the live lease/load and is in order. */
export function acceptHtmlPreviewPageMessage(
  message: HtmlPreviewPageMessage,
  current: { leaseId: string; loadId: string; lastSeq: number },
): { accept: boolean; reason?: string } {
  if (message.leaseId !== current.leaseId) return { accept: false, reason: 'stale-lease' }
  if (message.loadId !== current.loadId) return { accept: false, reason: 'stale-load' }
  if (message.event === 'ready') return { accept: true }
  if (message.seq <= current.lastSeq) return { accept: false, reason: 'out-of-order' }
  return { accept: true }
}

type HtmlPreviewOpenRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.open' }>
type HtmlPreviewReleaseRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.release' }>
type HtmlPreviewResolveRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }>
type HtmlPreviewEditRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>

/**
 * Main-side preview port, implemented by the preview service (B2). The
 * `workspaceFiles` channel routes the four preview requests here after the
 * strict union parse; the port owns leases, token validation, the readable file
 * closure and the edit transaction. Until a host is injected, preview requests
 * fail closed rather than falling back to any workspace mutation path.
 */
export interface HtmlPreviewHost {
  open(request: HtmlPreviewOpenRequest): Promise<HtmlPreviewLease>
  release(request: HtmlPreviewReleaseRequest): Promise<{ released: boolean }>
  resolveTarget(request: HtmlPreviewResolveRequest): Promise<{ revision: number; targets: HtmlPreviewResolvedTarget[] }>
  edit(request: HtmlPreviewEditRequest): Promise<HtmlPreviewEditOutcome>
  editSource(request: Extract<HtmlPreviewRequest, { type: 'html-preview.edit-source' }>): Promise<HtmlSourceEditOutcome>
}

/**
 * Classify an already-parsed request. The enclosing union has been validated by
 * the caller, so parsing again here only decides routing — it cannot admit a
 * request shape the workspace schema rejected.
 */
export function isHtmlPreviewRequest(value: unknown): value is HtmlPreviewRequest {
  return htmlPreviewRequestSchema.safeParse(value).success
}

export { span as htmlPreviewSpanSchema, rect as htmlPreviewRectSchema }
