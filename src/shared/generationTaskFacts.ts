import { z } from 'zod'
import { authoringToolTargetWireV1Schema } from './authoringToolContract'

const identity = z.string().min(1)
/** Facts are produced from one renderer snapshot. Main only transports/projects them. */
export const generationTaskFactsSchema = z.object({
  version: z.literal(1), projectId: identity, documentRevision: z.number().int().nonnegative(),
  sessionGeneration: z.number().int().nonnegative(), source: z.literal('frozen-project'),
  indexes: z.array(z.object({
    locationId: identity, surfaceId: identity, stateId: identity.nullable(),
    scope: z.literal('applicable-location-items'), completeness: z.enum(['complete', 'partial']),
    items: z.array(z.object({ id: identity, label: z.string().optional() }).strict()),
  }).strict()),
  components: z.array(z.object({
    target: authoringToolTargetWireV1Schema, packageId: identity,
    source: z.literal('componentProps'), scope: z.literal('instance'),
    writable: z.boolean(), reason: z.string(),
    fields: z.array(z.object({ descriptor: z.json(), value: z.json().optional() }).strict()),
    contentMerge: z.literal('recursive-index-merge'),
  }).strict()),
  relations: z.array(z.object({
    target: authoringToolTargetWireV1Schema, plane: z.string(),
    frame: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict(),
    rotation: z.number(), order: z.number().int(), locked: z.boolean(),
    label: z.string().optional(), text: z.string().optional(),
  }).strict()),
}).strict()
export type GenerationTaskFacts = z.infer<typeof generationTaskFactsSchema>
