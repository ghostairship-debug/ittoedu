import { z } from 'zod'

const semanticTarget = z.object({
  entity: z.enum(['project', 'surface', 'scene', 'state', 'layer-item', 'flow-block', 'location', 'interaction', 'navigation-guard', 'course-state', 'spatial-path', 'spatial-relation', 'camera-frame', 'semantic-zoom', 'print-entry', 'design-token', 'resource-asset', 'resource-package']),
  id: z.string(), owner: z.enum(['project', 'global', 'surface', 'scene', 'state', 'world', 'flow', 'resource']),
  ownerKey: z.string(), impact: z.enum(['instance', 'shared']), name: z.string().optional(),
  surfaceId: z.string().optional(), locationId: z.string().optional(), stateId: z.string().optional(),
}).strict()
export const generationSemanticChangesSchema = z.object({
  changes: z.array(z.object({ path: z.string(), before: z.string(), after: z.string(),
    kind: z.enum(['created', 'deleted', 'updated', 'reordered']), field: z.string().optional(), target: semanticTarget.optional(),
    truncated: z.object({ before: z.boolean(), after: z.boolean() }).strict().optional(),
  }).strict()),
  omitted: z.number().int().nonnegative(),
  comparison: z.object({ status: z.enum(['complete', 'partial']), scopes: z.array(z.object({
    scope: z.string(), status: z.enum(['complete', 'not-provided', 'incomparable']), reason: z.string().optional(),
  }).strict()) }).strict(),
  truncation: z.object({ changeLimit: z.number().int().nonnegative(), valueLengthLimit: z.number().int().nonnegative(),
    omittedChanges: z.number().int().nonnegative(), truncatedValues: z.number().int().nonnegative() }).strict(),
}).strict()
export type GenerationSemanticChanges = z.infer<typeof generationSemanticChangesSchema>
