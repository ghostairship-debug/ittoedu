import { z } from 'zod'
import type { ComponentDefinition } from '../../shared/contracts/component-platform'
import { componentAuthorRecordsSchema } from '../../shared/contracts/component-platform/schema'
export { componentAuthorRecordSchema as webAuthoringRecordSchema, componentAuthorRecordsSchema as webAuthoringRecordsSchema } from '../../shared/contracts/component-platform/schema'

export const webDataSchema = z.object({ html: z.string(), css: z.string().optional(),
  /** Persistent local author values; runtime bindings and mount generations are observations only. */
  authoringRecords: componentAuthorRecordsSchema.optional(),
  /** Editable local ES-module source, keyed relative to the HTML document. */
  modules: z.record(z.string(), z.string()).optional(),
  resourceSources: z.array(z.object({ url: z.string().min(1), usage: z.enum(['image', 'media', 'stylesheet', 'font']) }).strict()).optional(),
  resourceBindings: z.record(z.string(), z.string().min(1)).optional() }).strict()
export type WebData = z.infer<typeof webDataSchema>
const webDataPresentation = { type: 'object', properties: {
  html: { type: 'string', title: 'HTML 内容' }, css: { type: 'string', title: '样式' },
  resourceBindings: { type: 'object', title: '资源引用' },
} }
export const WEB_DEFINITION: ComponentDefinition = { id: 'guoling.web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' }, title: 'Web 内容', dataSchema: webDataPresentation }
export const HTML_PROGRAM_DEFINITION: ComponentDefinition = { id: 'guoling.html-program', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.html-program' }, title: 'HTML 程序', dataSchema: webDataPresentation }
