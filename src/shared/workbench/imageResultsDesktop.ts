import { z } from 'zod'
import type { ImageJobSnapshot } from './images'
import type { DocumentOperationResult } from './document'
const id = z.string().min(1).max(512), index = z.number().int().nonnegative()
const owner = { workspaceId: id, conversationId: id, runId: id, jobId: id }
export const imageApplyTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('course-owner'), locationId: id, owner: z.enum(['scene', 'global', 'surface', 'world']), stateId: id.optional() }).strict(),
  z.object({ kind: z.literal('course-object'), locationId: id, itemId: id, stateId: id.optional() }).strict(),
  z.object({ kind: z.literal('flow-block'), surfaceId: id, blockId: id, parentId: id.nullable() }).strict(),
  z.object({ kind: z.literal('course-background'), owner: z.enum(['course', 'surface', 'scene']), surfaceId: id.optional(), sceneId: id.optional(), stateId: id.optional() }).strict(),
])
export const imageApplyCaptureSchema = z.object({ documentId: id, epoch: id, revision: index, address: imageApplyTargetSchema, label: z.string().min(1).max(1024) }).strict()
export type ImageApplyCapture = z.infer<typeof imageApplyCaptureSchema>
export const imageInsertionFrameSchema = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
}).strict()
export type ImageInsertionFrame = z.infer<typeof imageInsertionFrameSchema>
export const imageResultsRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), workspaceId: id, conversationId: id }).strict(),
  z.object({ type: z.literal('read'), ...owner }).strict(),
  z.object({ type: z.literal('stop'), ...owner }).strict(),
  z.object({ type: z.literal('preview'), ...owner, resourceId: id }).strict(),
  z.object({ type: z.literal('apply'), ...owner, actionId: z.uuid(), resourceId: id, target: imageApplyCaptureSchema, frame: imageInsertionFrameSchema.optional() }).strict(),
  z.object({ type: z.literal('edit'), ...owner, actionId: z.uuid(), resourceId: id, prompt: z.string().trim().min(1).max(32000) }).strict(),
])
export type ImageResultOwner = Omit<Extract<z.infer<typeof imageResultsRequestSchema>, { type: 'read' }>, 'type'>
export interface ImageResultEvent { workspaceId: string; conversationId: string; runId: string; job: ImageJobSnapshot; source: 'builtin' | 'external-mcp'; userRequested?: boolean }
export interface ImageResultView extends ImageResultEvent { applications: { actionId: string; documentId: string; result: DocumentOperationResult }[] }
export interface ImageResultsDesktopAPI {
  list(input: Pick<ImageResultOwner, 'workspaceId' | 'conversationId'>): Promise<ImageResultView[]>
  read(input: ImageResultOwner): Promise<ImageResultView>
  stop(input: ImageResultOwner): Promise<ImageResultView>
  preview(input: ImageResultOwner & { resourceId: string }): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }>
  apply(input: ImageResultOwner & { actionId: string; resourceId: string; target: ImageApplyCapture; frame?: ImageInsertionFrame }): Promise<DocumentOperationResult>
  edit(input: ImageResultOwner & { actionId: string; resourceId: string; prompt: string }): Promise<ImageResultView>
  subscribe(listener: (event: ImageResultEvent) => void): () => void
}
