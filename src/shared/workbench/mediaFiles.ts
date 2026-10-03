import { z } from 'zod'

/** Issued by the existing file owner. A changed path/binding or disk version invalidates it. */
export interface FileArtifactBinding { path: string; fileVersion: string; bindingVersion: number }

const fraction = z.number().finite().min(0).max(1)
const point = z.object({ x: fraction, y: fraction }).strict()
const rectangle = z.object({ x: fraction, y: fraction, width: fraction.positive(), height: fraction.positive() }).strict()
  .refine(value => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, '选区超出页面')
const color = z.string().regex(/^#[\da-f]{6}$/i)
const quarterTurn = z.union([z.literal(90), z.literal(180), z.literal(270)])
const pageIndex = z.number().int().nonnegative()
export const mediaFileOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image.crop'), rectangle }).strict(),
  z.object({ type: z.literal('image.rotate'), degrees: quarterTurn }).strict(),
  z.object({ type: z.literal('image.rectangle'), rectangle, color, strokeWidth: z.number().finite().positive().max(0.1) }).strict(),
  z.object({ type: z.literal('image.ink'), points: z.array(point).min(2), color, strokeWidth: z.number().finite().positive().max(0.1) }).strict(),
  z.object({ type: z.literal('pdf.move-page'), from: pageIndex, to: pageIndex }).strict(),
  z.object({ type: z.literal('pdf.delete-page'), page: pageIndex }).strict(),
  z.object({ type: z.literal('pdf.rotate-page'), page: pageIndex, degrees: quarterTurn }).strict(),
  z.object({ type: z.literal('pdf.highlight'), page: pageIndex, rectangle, color }).strict(),
  z.object({ type: z.literal('pdf.ink'), page: pageIndex, points: z.array(point).min(2), color,
    strokeWidth: z.number().finite().positive().max(0.1) }).strict(),
])
/** Coordinates refer to the visible image/page after all preceding draft operations. */
export type MediaFileOperation = z.infer<typeof mediaFileOperationSchema>
export type MediaPoint = z.infer<typeof point>
export type MediaRectangle = z.infer<typeof rectangle>

export type MediaFileContent =
  | { kind: 'image'; bytes: Uint8Array; mimeType: string; width: number; height: number; editable: boolean; editReason?: string }
  | { kind: 'pdf'; bytes: Uint8Array; mimeType: 'application/pdf'; pages: Array<{ width: number; height: number; rotation: number }>; editable: true }
export interface MediaFileSnapshot { binding: FileArtifactBinding; content: MediaFileContent }

export const fileArtifactBindingSchema = z.object({ path: z.string().min(1), fileVersion: z.string().min(1), bindingVersion: z.number().int().positive() }).strict()
const edit = { binding: fileArtifactBindingSchema, operations: z.array(mediaFileOperationSchema) }
export const mediaFilesRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('media-file.open'), workspaceId: z.string().min(1), entryId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('media-file.open-path'), path: z.string().min(1) }).strict(),
  z.object({ type: z.literal('media-file.preview'), ...edit }).strict(),
  z.object({ type: z.literal('media-file.save'), ...edit }).strict(),
  z.object({ type: z.literal('media-file.reload'), binding: fileArtifactBindingSchema }).strict(),
])
export type MediaFilesRequest = z.infer<typeof mediaFilesRequestSchema>
export interface MediaFileEditorPort {
  preview(binding: FileArtifactBinding, operations: readonly MediaFileOperation[]): Promise<MediaFileSnapshot>
  save(binding: FileArtifactBinding, operations: readonly MediaFileOperation[]): Promise<MediaFileSnapshot>
  /** Explicit discard/reload must obtain a fresh binding from the file owner. */
  reload(binding: FileArtifactBinding): Promise<MediaFileSnapshot>
}
