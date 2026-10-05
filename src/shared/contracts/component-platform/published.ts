import { z } from 'zod'
import { courseProjectDesignTokensSchema, courseThemeSchema } from '../design-v1/schema'
import { projectPlaybackSettingsSchema } from '../playback-v1/schema'
import { projectMediaSettingsSchema } from '../media-v1/schema'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentSurface, ComponentAsset, CourseProjectV10 } from './project'
import { componentDefinitionSchema, componentBuiltinImplementationSchema, componentSourceImplementationSchema, componentInstanceSchema, componentSurfaceSchema, componentAssetSchema, componentBackgroundSchema, courseProjectLogicSchema, courseProjectV10Schema } from './schema'

export type PublishedImplementation =
  | Extract<ComponentImplementation, { kind: 'builtin' }>
  | (Extract<ComponentImplementation, { kind: 'source' }> & { compiled?: { code: string; css?: string } })
export type PublishedDefinition = Omit<ComponentDefinition, 'dataSchema' | 'implementation'> & { implementation: PublishedImplementation }
export type PublishedInstance = Omit<ComponentInstance, 'implementationOverride'> & { implementationOverride?: PublishedImplementation }
export interface PublishedAsset extends Omit<ComponentAsset, 'path'> { url?: string }
/** Runtime data only. Compiled source is derived from the author's implementation. */
export interface PublishedCourseV3 extends Pick<CourseProjectV10, 'background' | 'designTokens' | 'theme' | 'playback' | 'media' | 'logic'> {
  schemaVersion: 3
  id: string
  title: string
  definitions: Record<string, PublishedDefinition>
  instances: Record<string, PublishedInstance>
  surfaces: ComponentSurface[]
  global: { underlay: string[]; overlay: string[] }
  assets: Record<string, PublishedAsset>
}
export const publishedImplementationSchema: z.ZodType<PublishedImplementation> = z.union([
  componentBuiltinImplementationSchema,
  componentSourceImplementationSchema.safeExtend({ compiled: z.object({ code: z.string(), css: z.string().optional() }).strict().optional() }),
]) as z.ZodType<PublishedImplementation>
export const publishedCourseV3Schema: z.ZodType<PublishedCourseV3> = z.object({
  schemaVersion: z.literal(3), id: z.string().min(1), title: z.string(),
  background: componentBackgroundSchema.optional(), designTokens: courseProjectDesignTokensSchema.optional(), theme: courseThemeSchema.optional(),
  playback: projectPlaybackSettingsSchema.optional(), media: projectMediaSettingsSchema.optional(), logic: courseProjectLogicSchema.optional(),
  definitions: z.record(z.string(), componentDefinitionSchema.omit({ dataSchema: true, implementation: true }).extend({ implementation: publishedImplementationSchema })),
  instances: z.record(z.string(), componentInstanceSchema.omit({ implementationOverride: true }).extend({ implementationOverride: publishedImplementationSchema.optional() })),
  surfaces: z.array(componentSurfaceSchema), global: z.object({ underlay: z.array(z.string()), overlay: z.array(z.string()) }).strict(),
  assets: z.record(z.string(), componentAssetSchema.omit({ path: true }).extend({ url: z.string().optional().refine(value => !value || !/^(blob:|file:|[a-z]:[\\/])/i.test(value), '发布资源不能依赖预览或本机路径') }).strict()),
}).strict().superRefine((published, context) => {
  const plainImplementation = (implementation: PublishedImplementation): ComponentImplementation => {
    if (implementation.kind === 'builtin') return implementation
    const { compiled: _compiled, ...source } = implementation
    return source
  }
  const result = courseProjectV10Schema.safeParse({ ...published, schemaVersion: 10, revision: 0,
    definitions: Object.fromEntries(Object.entries(published.definitions).map(([id, value]) => [id, { ...value, implementation: plainImplementation(value.implementation) }])),
    instances: Object.fromEntries(Object.entries(published.instances).map(([id, value]) => [id, { ...value,
      ...(value.implementationOverride ? { implementationOverride: plainImplementation(value.implementationOverride) } : {}) }])),
    assets: Object.fromEntries(Object.entries(published.assets).map(([id, value]) => [id, { id: value.id, path: `assets/${encodeURIComponent(id)}`, ...(value.mimeType ? { mimeType: value.mimeType } : {}) }])),
  })
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})
