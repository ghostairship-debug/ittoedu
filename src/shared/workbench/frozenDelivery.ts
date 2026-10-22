import { z } from 'zod'

export type ComponentDeliveryFormat = 'single-html' | 'web-package' | 'pptx' | 'pdf' | 'docx'
export interface ComponentDeliveryFinding {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  surfaceId?: string
  instanceId?: string
  path?: readonly (string | number)[]
}
export interface ComponentDeliveryReport {
  reportVersion: 1
  schemaVersion: 11
  projectId: string
  target: ComponentDeliveryFormat
  generatedAt: string
  items: ComponentDeliveryFinding[]
  summary: { error: number; warning: number; info: number; total: number; canExport: boolean }
}
export interface ComponentDeliveryArtifact {
  suggestedName: string
  extension: 'html' | 'zip' | 'pptx' | 'pdf' | 'docx'
  bytes?: Uint8Array
  html?: string
}
export interface BuiltComponentDelivery { artifacts: ComponentDeliveryArtifact[]; report: ComponentDeliveryReport }

const identity = z.object({ documentId: z.string().min(1), epoch: z.string().min(1),
  revision: z.number().int().nonnegative(), projectId: z.string().min(1) }).strict()
const format = z.enum(['single-html', 'web-package', 'pptx', 'pdf', 'docx'])
export const frozenDeliveryBuildSchema = z.object({
  requestId: z.uuid(), identity, format,
  singleHtmlMode: z.enum(['offline-portable', 'online-lightweight']).optional(),
  options: z.object({ pageIds: z.array(z.string().min(1)).readonly().optional(),
    pageSize: z.enum(['A4', 'letter', 'surface-native']).optional(),
    orientation: z.enum(['auto', 'portrait', 'landscape']).optional() }).strict().optional(),
}).strict()
export type FrozenDeliveryBuildInput = z.infer<typeof frozenDeliveryBuildSchema>
export const frozenDeliveryCancelSchema = z.object({ requestId: z.uuid() }).strict()

/** The existing delivery output, moved to a process-neutral data boundary. */
export const builtComponentDeliverySchema = z.object({
  artifacts: z.array(z.object({ suggestedName: z.string(), extension: z.enum(['html', 'zip', 'pptx', 'pdf', 'docx']),
    bytes: z.custom<Uint8Array>(value => value instanceof Uint8Array).optional(), html: z.string().optional() }).strict()),
  report: z.object({ reportVersion: z.literal(1), schemaVersion: z.literal(11), projectId: z.string(), target: format,
    generatedAt: z.string(), items: z.array(z.object({ severity: z.enum(['error', 'warning', 'info']), code: z.string(),
      message: z.string(), surfaceId: z.string().optional(), instanceId: z.string().optional(),
      path: z.array(z.union([z.string(), z.number()])).readonly().optional() }).strict()),
    summary: z.object({ error: z.number(), warning: z.number(), info: z.number(), total: z.number(), canExport: z.boolean() }).strict(),
  }).strict(),
}).strict()
