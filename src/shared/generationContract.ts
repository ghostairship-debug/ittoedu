import { z } from 'zod'
import { authoringToolDestinationV1Schema, authoringToolCreateScopeV1Schema } from './authoringToolContract'
import { workspaceIdentityV1Schema } from './workspaceIdentity'

const identity = z.string().trim().min(1).max(200)
export const MAX_GENERATION_PROMPT_BYTES = 160_000
export const generationInputReferenceSchema = z.object({ $result: z.object({
  stepId: identity, kind: z.enum(['asset-id', 'package-id', 'item-id', 'location-id']), index: z.number().int().nonnegative().default(0),
}).strict() }).strict()
export function visitGenerationInputReferences(value: unknown, visit: (reference: z.infer<typeof generationInputReferenceSchema>['$result']) => void) {
  if (!value || typeof value !== 'object') return
  if ('$result' in value) { visit(generationInputReferenceSchema.parse(value).$result); return }
  for (const nested of Object.values(value)) visitGenerationInputReferences(nested, visit)
}
export const generationCarrierSchema = z.enum(['native', 'recipe', 'existing-component', 'generated-component', 'runtime'])
export const generationRequestSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), workspace: workspaceIdentityV1Schema,
  documentRevision: z.number().int().nonnegative(), sessionGeneration: z.number().int().nonnegative(),
  purpose: z.enum(['single-page', 'whole-course', 'local-edit']),
  expectedResult: z.enum(['auto', 'candidate']).optional(),
  repair: z.object({ logicalRequestId: z.uuid(), attempt: z.literal(1) }).strict().optional(),
  instruction: z.string().trim().min(1).max(20000),
  destinations: z.array(authoringToolDestinationV1Schema).min(1).max(1000),
  context: z.json(),
  confirmedDocuments: z.object({ teachingPlan: z.string().min(1), presentationScript: z.string().min(1) }).strict().optional(),
  allowedCarriers: z.array(generationCarrierSchema).min(1),
}).strict().superRefine((request, ctx) => {
  if (request.purpose === 'whole-course' && !request.confirmedDocuments) ctx.addIssue({ code: 'custom', message: '整课生成需要已确认的两份 Markdown', path: ['confirmedDocuments'] })
  request.destinations.forEach((destination, i) => {
    const target = destination.kind === 'update' ? destination.target : destination.scope
    if (target.projectId !== request.workspace.projectId || target.documentRevision !== request.documentRevision || target.sessionGeneration !== request.sessionGeneration) {
      ctx.addIssue({ code: 'custom', message: '请求目标身份、revision 或 generation 不一致', path: ['destinations', i] })
    }
  })
})

// New identities are resolved from earlier host results, never guessed by a CLI.
const resultDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created-item'), stepId: identity, index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('created-scope'), stepId: identity,
    parent: authoringToolCreateScopeV1Schema.shape.parent, insertion: authoringToolCreateScopeV1Schema.shape.insertion }).strict(),
])
export const generationCandidateSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), candidateId: z.uuid(),
  summary: z.string().trim().min(1).max(2000),
  steps: z.array(z.object({
    id: identity, tool: identity,
    carrier: generationCarrierSchema,
    lowerCarrierReason: z.string().trim().min(1).max(2000).optional(),
    destination: z.union([authoringToolDestinationV1Schema, resultDestinationSchema]),
    input: z.json(),
  }).strict()).min(1).max(1000),
}).strict().superRefine((candidate, ctx) => {
  const seen = new Set<string>()
  candidate.steps.forEach((step, i) => {
    if (seen.has(step.id)) ctx.addIssue({ code: 'custom', message: '重复 step ID', path: ['steps', i, 'id'] })
    if ('stepId' in step.destination && !seen.has(step.destination.stepId)) ctx.addIssue({ code: 'custom', message: '只能引用已完成的前序 step', path: ['steps', i, 'destination'] })
    try { visitGenerationInputReferences(step.input, reference => {
      if (!seen.has(reference.stepId)) ctx.addIssue({ code: 'custom', message: '输入只能引用前序宿主结果', path: ['steps', i, 'input'] })
    }) } catch { ctx.addIssue({ code: 'custom', message: '输入结果引用格式无效', path: ['steps', i, 'input'] }) }
    if (step.carrier !== 'native' && !step.lowerCarrierReason) ctx.addIssue({ code: 'custom', message: '高阶载体必须说明低阶载体不能满足的需求', path: ['steps', i, 'lowerCarrierReason'] })
    seen.add(step.id)
  })
})
export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type GenerationCandidate = z.infer<typeof generationCandidateSchema>
