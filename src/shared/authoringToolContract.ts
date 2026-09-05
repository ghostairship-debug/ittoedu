import { z } from 'zod'

const identity = z.string().min(1).refine((value) => value.trim().length > 0, 'Identity cannot be blank')
const revision = z.number().int().nonnegative()

// A wire snapshot of the canonical authoring identity, never a persisted field.
const scopeFields = {
  projectId: identity,
  documentRevision: revision,
  revisionPolicy: z.object({ kind: z.literal('exact') }).strict(),
  sessionGeneration: revision,
  surfaceType: z.enum(['slide', 'flow', 'spatial-2d']),
  surfaceId: identity,
  locationId: identity,
  stateId: identity.nullable(),
  owner: z.enum(['global', 'surface', 'scene', 'world']),
  ownerKey: identity,
}

export const authoringToolTargetWireV1Schema = z.object({
  ...scopeFields,
  itemId: identity,
  authoringAddress: identity,
}).strict()

export type AuthoringToolTargetWireV1 = z.infer<typeof authoringToolTargetWireV1Schema>

// Creation identifies a real parent and placement; it cannot invent an item ID.
export const authoringToolCreateScopeV1Schema = z.object({
  ...scopeFields,
  parent: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('owner') }).strict(),
    z.object({ kind: z.literal('flow-body'), parentBlockId: identity.nullable() }).strict(),
    z.object({ kind: z.literal('course-locations') }).strict(),
  ]),
  insertion: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('append') }).strict(),
    z.object({ kind: z.literal('before'), siblingId: identity }).strict(),
    z.object({ kind: z.literal('after'), siblingId: identity }).strict(),
  ]),
}).strict()

export type AuthoringToolCreateScopeV1 = z.infer<typeof authoringToolCreateScopeV1Schema>

export const authoringToolDestinationV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('update'), target: authoringToolTargetWireV1Schema }).strict(),
  z.object({ kind: z.literal('create'), scope: authoringToolCreateScopeV1Schema }).strict(),
])

export type AuthoringToolDestinationV1 = z.infer<typeof authoringToolDestinationV1Schema>

export function serializeAuthoringToolTargetV1(target: AuthoringToolTargetWireV1): string {
  return JSON.stringify(authoringToolTargetWireV1Schema.parse(target))
}

export function parseAuthoringToolTargetV1(value: string): AuthoringToolTargetWireV1 {
  return authoringToolTargetWireV1Schema.parse(JSON.parse(value))
}
