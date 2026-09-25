import { z } from 'zod'
import type { ModelChatMessage, ModelSelection, ModelToolDefinition } from './modelProvider'
import type { ToolTarget } from './tools'
import type { MaterialExtraction } from '../materialExtraction'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const nonnegative = z.number().int().nonnegative()
export const attachmentBlobRefSchema = z.object({ digest, byteLength: nonnegative }).strict()
export type AttachmentBlobRef = z.infer<typeof attachmentBlobRefSchema>
export const attachmentSourceSchema = z.object({
  kind: z.enum(['paste', 'drop', 'file', 'workspace']), authorizationId: z.string().min(1).max(512).optional(),
  pathHint: z.string().max(32767).optional(), readOnly: z.literal(true),
}).strict()
export const attachmentProvenanceSchema = z.object({
  originalDigest: digest, originalByteLength: nonnegative, producer: z.enum(['original-v1', 'utf8-v1', 'sharp-verified-v1', 'pdfjs-v1', 'office-xml-v1']),
  complete: z.boolean(), downsampled: z.boolean(),
  locator: z.object({ part: z.string(), page: z.number().int().positive().optional(), paragraph: z.number().int().positive().optional() }).strict().optional(),
  range: z.object({ unit: z.enum(['characters', 'pages']), from: nonnegative, to: nonnegative, total: nonnegative }).strict().optional(),
}).strict()
export type AttachmentProvenance = z.infer<typeof attachmentProvenanceSchema>
const representation = { id: z.string().min(1).max(512), mediaType: z.string().min(1).max(100), blobRef: attachmentBlobRefSchema, provenance: attachmentProvenanceSchema }
export const attachmentRepresentationSchema = z.discriminatedUnion('kind', [
  z.object({ ...representation, kind: z.literal('file') }).strict(),
  z.object({ ...representation, kind: z.literal('image'), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  z.object({ ...representation, kind: z.literal('text'), characters: nonnegative }).strict(),
])
export const attachmentSnapshotSchema = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), name: z.string().min(1).max(300), capturedAt: nonnegative,
  derivedFrom: z.uuid().optional(),
  state: z.literal('added'), source: attachmentSourceSchema, mediaType: z.string().min(1).max(100), byteLength: nonnegative,
  digest, blobRef: attachmentBlobRefSchema, representations: z.array(attachmentRepresentationSchema),
  coverage: z.object({ format: z.enum(['pdf', 'docx', 'pptx']), complete: z.boolean(), totalPages: z.number().int().positive().optional(), selectedPages: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict().optional() }).strict().optional(),
  gaps: z.array(z.object({ code: z.enum(['extraction-unavailable', 'extraction-gap', 'scanned-page', 'unsupported-image']), message: z.string().min(1), locator: z.object({ part: z.string(), page: z.number().int().positive().optional(), paragraph: z.number().int().positive().optional() }).strict().optional(), resolutionRepresentationId: z.string().optional() }).strict()),
}).strict()
export type AttachmentSnapshot = z.infer<typeof attachmentSnapshotSchema>
export type AttachmentRepresentation = z.infer<typeof attachmentRepresentationSchema>
export const inputAttachmentReferenceSchema = z.object({ attachmentId: z.uuid(), representationId: z.string().min(1).max(512), role: z.enum(['reference', 'target']).optional() }).strict()
export type InputAttachmentReference = z.infer<typeof inputAttachmentReferenceSchema>
export interface AttachmentReader {
  readRepresentation(attachmentId: string, representationId: string): Promise<{ snapshot: AttachmentSnapshot; representation: AttachmentRepresentation; bytes: Uint8Array }>
}
export interface InputContextProvenance {
  kind: 'history' | 'document' | 'selection' | 'runtime'
  id: string
  documentId?: string
  revision?: number
  range?: { from: number; to: number }
}
/** Frozen by the input owner from actual user actions. Paths and attachment roles never grant write authority. */
export interface InputContext {
  id: string
  capturedAt: number
  instruction: string
  context: readonly { message: ModelChatMessage; provenance: InputContextProvenance }[]
  attachments: readonly InputAttachmentReference[]
  writeScope?: readonly { documentId: string; targets: readonly ToolTarget[] }[]
}
export interface PayloadBudget {
  maxSerializedBytes: number
  maxOriginalBytes?: number
  maxRepresentationBytes?: number
  maxImagePixels?: number
  maxTextCharacters?: number
}
export interface PayloadManifest {
  schemaVersion: 1
  inputContextId: string
  scope: 'initial-payload'
  laterDynamicReads: 'separately-recorded'
  provider: { connectionId: string; revision: number; provider: string; model: string; authKind: string; billingKind: string }
  selectionSource?: { role: 'conversation' | 'vision'; reason: string; profileRevision?: number }
  payloadDigest: string
  totals: { serializedBytes: number; originalBytes: number; representationBytes: number; imageBytes: number; textCharacters: number; base64Characters: number }
  userText: { messageIndex: number; characters: number; digest: string } | null
  automaticContext: { messageIndex: number; provenance: InputContextProvenance; digest: string; serializedBytes: number }[]
  explicitAttachments: { messageIndex: number; contentIndex: number; attachmentId: string; representationId: string; name: string; role?: 'reference' | 'target'; originalDigest: string; representationDigest: string; mediaType: string; provenance: AttachmentProvenance }[]
  tools: { name: string; digest: string }[]
  delivery: { status: 'prepared' } | { status: 'sent'; requestId: string; acceptedAt: number }
  readStatus: 'unknown'
}
export interface CompiledPayload { messages: ModelChatMessage[]; tools: ModelToolDefinition[]; serialized: string; manifest: PayloadManifest }
export interface PayloadSerializerInput { selection: ModelSelection; messages: readonly ModelChatMessage[]; tools: readonly ModelToolDefinition[] }

export interface AttachmentPageRange { from: number; to: number }
export interface AttachmentExtractionInput { bytes: Uint8Array; filename: string; pages?: AttachmentPageRange }
export interface AttachmentExtractionResult {
  material: MaterialExtraction
  totalPages?: number
  selectedPages?: AttachmentPageRange
  pageImages: { assetId: string; width: number; height: number; downsampled: boolean }[]
}
export interface AttachmentExtractor {
  extract(input: AttachmentExtractionInput, options?: { signal?: AbortSignal }): Promise<AttachmentExtractionResult>
}
