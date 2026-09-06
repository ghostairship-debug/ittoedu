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

export const authoringToolRequestV1Schema = z.object({
  version: z.literal(1),
  requestId: identity,
  tool: identity,
  destination: authoringToolDestinationV1Schema,
  input: z.unknown(),
}).strict()

export const authoringToolSelectionV1Schema = z.object({
  kind: z.literal('authoring-tool-selection'),
  locationId: identity,
  stateId: identity.nullable(),
  owner: scopeFields.owner,
  itemIds: z.array(identity),
  flowCarrier: z.enum(['block', 'overlay']).optional(),
  graphSelection: z.object({ kind: z.enum(['path', 'relation']), id: identity }).strict().nullable().optional(),
}).strict()

export type AuthoringToolSelectionV1 = z.infer<typeof authoringToolSelectionV1Schema>

export function readAuthoringToolSelection(value: unknown): AuthoringToolSelectionV1 | null {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'authoring-tool-selection') return null
  return authoringToolSelectionV1Schema.parse(value)
}

export const authoringToolReceiptV1Schema = z.object({
  version: z.literal(1),
  requestId: identity,
  tool: identity,
  destination: authoringToolDestinationV1Schema.nullable(),
  status: z.enum(['committed', 'unchanged', 'stale', 'rejected', 'failed']),
  beforeRevision: revision,
  afterRevision: revision,
  selection: authoringToolSelectionV1Schema.optional(),
  affected: z.array(z.object({
    id: identity,
    operation: z.enum(['created', 'updated', 'deleted']),
    ownerKey: identity,
    authoringAddress: identity.nullable(),
  }).strict()),
  resources: z.object({
    assetIds: z.array(identity),
    packageIds: z.array(identity),
  }).strict(),
  diagnostics: z.array(z.object({
    code: identity,
    message: identity,
    path: z.array(z.union([z.string(), z.number()])),
  }).strict()),
}).strict()

export type AuthoringToolReceiptV1 = z.infer<typeof authoringToolReceiptV1Schema>

export function serializeAuthoringToolTargetV1(target: AuthoringToolTargetWireV1): string {
  return JSON.stringify(authoringToolTargetWireV1Schema.parse(target))
}

export function parseAuthoringToolTargetV1(value: string): AuthoringToolTargetWireV1 {
  return authoringToolTargetWireV1Schema.parse(JSON.parse(value))
}
