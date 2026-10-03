import { z } from 'zod'

/** Fixed product observations, never an assertion language or candidate code. */
export const dynamicBehaviorFrameSchema = z.object({
  phase: z.enum(['running', 'paused', 'resumed', 'before-button-click', 'after-button-click']),
  elapsedMs: z.number().finite().nonnegative(), capturedAt: z.number().int().nonnegative(),
  stateVersion: z.number().int().nonnegative(), publicState: z.record(z.string(), z.json()),
  width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
  dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
}).strict()
export const dynamicButtonCheckSchema = z.object({ version: z.literal(1),
  instanceId: z.string().trim().min(1), label: z.string().trim().min(1),
  /** Optional destination expectations checked against the real session after the click. */
  expectLocationId: z.string().trim().min(1).optional(),
  expectStateId: z.string().trim().min(1).nullable().optional() }).strict()
export const dynamicButtonObservationSchema = z.object({
  version: z.literal(1), instanceId: z.string().min(1), label: z.string().min(1),
  input: z.literal('electron-mouse'), x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  beforeText: z.string().max(8000), afterText: z.string().max(8000), textTruncated: z.boolean(),
  clickedAt: z.number().int().nonnegative(), observedAt: z.number().int().nonnegative(),
  destination: z.object({
    expectedLocationId: z.string().min(1).optional(),
    expectedStateId: z.string().min(1).nullable().optional(),
    actualLocationId: z.string().min(1),
    actualStateId: z.string().min(1).nullable(),
    matched: z.boolean(),
  }).strict().optional(),
  functionalResult: z.literal('requires-review'),
}).strict()
export type DynamicButtonCheck = z.infer<typeof dynamicButtonCheckSchema>
export type DynamicButtonObservation = z.infer<typeof dynamicButtonObservationSchema>
export const dynamicBehaviorObservationSchema = z.object({
  version: z.literal(1), status: z.literal('observed'), mode: z.enum(['full-admission', 'public-props']),
  projectId: z.string().min(1), documentRevision: z.number().int().nonnegative(),
  locationId: z.string().min(1), stateId: z.string().nullable(), instanceIds: z.array(z.string().min(1)).min(1),
  sourceIdentities: z.record(z.string(), z.string().min(1)),
  actions: z.array(z.enum(['update-inputs', 'resize-and-restore', 'suspend', 'resume', 'click-button'])).max(5),
  frames: z.array(dynamicBehaviorFrameSchema).min(1).max(8), elapsedMs: z.number().finite().nonnegative(),
  buttonClick: dynamicButtonObservationSchema.optional(),
  semanticVerdict: z.literal('requires-review'),
}).strict()
export const dynamicBehaviorEvidenceSchema = z.array(dynamicBehaviorObservationSchema)
export type DynamicBehaviorFrame = z.infer<typeof dynamicBehaviorFrameSchema>
export type DynamicBehaviorObservation = z.infer<typeof dynamicBehaviorObservationSchema>

/** Fixed observation sample points; these do not limit admission or task duration. */
export const DYNAMIC_BEHAVIOR_SAMPLING = Object.freeze({ runningAtMs: [0, 250, 750] as const, pausedForMs: 250, resumedForMs: 250, buttonObserveForMs: 500, sampleCount: 6, actionCount: 4 })
