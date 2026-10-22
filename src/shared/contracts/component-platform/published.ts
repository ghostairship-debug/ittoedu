import { z } from 'zod'
import { courseProjectDesignTokensSchema, courseThemeSchema } from '../design-v1/schema'
import { projectPlaybackSettingsSchema } from '../playback-v1/schema'
import { projectMediaSettingsSchema } from '../media-v1/schema'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentAsset, CourseProjectV10, WorkEntry } from './project'
import { componentDefinitionSchema, componentBuiltinImplementationSchema, componentSourceImplementationSchema, componentInstanceSchema, componentAssetSchema, componentBackgroundSchema, courseProjectLogicSchema, courseProjectV11Schema, workEntrySchema } from './schema'

export type PublishedImplementation =
  | Extract<ComponentImplementation, { kind: 'builtin' }>
  | (Extract<ComponentImplementation, { kind: 'source' }> & { compiled?: { code: string; css?: string } })
export type PublishedDefinition = Omit<ComponentDefinition, 'dataSchema' | 'implementation'> & { implementation: PublishedImplementation }
export type PublishedInstance = Omit<ComponentInstance, 'implementationOverride'> & { implementationOverride?: PublishedImplementation }
export interface PublishedAsset extends Omit<ComponentAsset, 'path'> { url?: string }
/** Runtime data only. Compiled source is derived from the author's implementation. */
export interface PublishedCourseV4 extends Pick<CourseProjectV10, 'background' | 'designTokens' | 'theme' | 'playback' | 'media' | 'logic'> {
  schemaVersion: 4
  id: string
  title: string
  definitions: Record<string, PublishedDefinition>
  instances: Record<string, PublishedInstance>
  rootIds: string[]
  entry?: WorkEntry
  global: { underlay: string[]; overlay: string[] }
  assets: Record<string, PublishedAsset>
}
/** Stable internal import names; this alias does not accept the old Published 3 wire. */
export type PublishedCourseV3 = PublishedCourseV4
export const publishedImplementationSchema: z.ZodType<PublishedImplementation> = z.union([
  componentBuiltinImplementationSchema,
  componentSourceImplementationSchema.safeExtend({ compiled: z.object({ code: z.string(), css: z.string().optional() }).strict().optional() }),
]) as z.ZodType<PublishedImplementation>
export const publishedCourseV4Schema: z.ZodType<PublishedCourseV4> = z.object({
  schemaVersion: z.literal(4), id: z.string().min(1), title: z.string(),
  background: componentBackgroundSchema.optional(), designTokens: courseProjectDesignTokensSchema.optional(), theme: courseThemeSchema.optional(),
  playback: projectPlaybackSettingsSchema.optional(), media: projectMediaSettingsSchema.optional(), logic: courseProjectLogicSchema.optional(),
  definitions: z.record(z.string(), componentDefinitionSchema.omit({ dataSchema: true, implementation: true }).extend({ implementation: publishedImplementationSchema })),
  instances: z.record(z.string(), componentInstanceSchema.omit({ implementationOverride: true }).extend({ implementationOverride: publishedImplementationSchema.optional() })),
  rootIds: z.array(z.string().min(1)), entry: workEntrySchema.optional(), global: z.object({ underlay: z.array(z.string()), overlay: z.array(z.string()) }).strict(),
  assets: z.record(z.string(), componentAssetSchema.omit({ path: true }).extend({ url: z.string().optional().refine(value => !value || !/^(blob:|file:|[a-z]:[\\/])/i.test(value), '发布资源不能依赖预览或本机路径') }).strict()),
}).strict().superRefine((published, context) => {
  const plainImplementation = (implementation: PublishedImplementation): ComponentImplementation => {
    if (implementation.kind === 'builtin') return implementation
    const { compiled: _compiled, ...source } = implementation
    return source
  }
  const result = courseProjectV11Schema.safeParse({ ...published, schemaVersion: 11, revision: 0,
    definitions: Object.fromEntries(Object.entries(published.definitions).map(([id, value]) => [id, { ...value, implementation: plainImplementation(value.implementation) }])),
    instances: Object.fromEntries(Object.entries(published.instances).map(([id, value]) => [id, { ...value,
      ...(value.implementationOverride ? { implementationOverride: plainImplementation(value.implementationOverride) } : {}) }])),
    assets: Object.fromEntries(Object.entries(published.assets).map(([id, value]) => [id, { id: value.id, path: `assets/${encodeURIComponent(id)}`, ...(value.mimeType ? { mimeType: value.mimeType } : {}) }])),
  })
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

export const publishedCourseV3Schema = publishedCourseV4Schema
