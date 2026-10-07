import { z } from 'zod'
import type { ComponentDefinition } from '../../shared/contracts/component-platform'
import type { ComponentAuthorRecord } from '../../shared/contracts/component-platform/runtime'

const bindingStepSchema = z.object({ tag: z.string().min(1), index: z.number().int().nonnegative(),
  attributes: z.record(z.string(), z.string()).optional() }).strict()
export const webAuthoringRecordSchema = z.object({ kind: z.enum(['text', 'image']),
  scope: z.record(z.string(), z.string()).optional(),
  binding: z.object({ kind: z.literal('dom'), path: z.array(bindingStepSchema), textIndex: z.number().int().nonnegative().optional(),
    baseline: z.string(), context: z.array(z.object({ path: z.array(bindingStepSchema), value: z.string() }).strict()).optional() }).strict(),
  overrides: z.object({ text: z.string().optional(), src: z.string().optional(), style: z.record(z.string(), z.string()).optional(),
    geometry: z.object({ translateX: z.number().finite().optional(), translateY: z.number().finite().optional(),
      scaleX: z.number().finite().positive().optional(), scaleY: z.number().finite().positive().optional(),
      width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional(),
      rotation: z.number().finite().optional() }).strict().optional() }).strict(),
}).strict() satisfies z.ZodType<ComponentAuthorRecord>
export const webAuthoringRecordsSchema = z.record(z.string().min(1), webAuthoringRecordSchema)

export const webDataSchema = z.object({ html: z.string(), css: z.string().optional(),
  /** Persistent local author values; runtime bindings and mount generations are observations only. */
  authoringRecords: webAuthoringRecordsSchema.optional(),
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
