import { z } from 'zod'
import { lessonDocumentRoleSchema, lessonIdentitySchema, lessonRelativePathSchema } from './lessonWorkspace'

export const LESSON_AUTHORING_STAGES = ['teaching-brief', 'teaching-plan', 'presentation-brief', 'presentation-script'] as const
export type LessonAuthoringStage = typeof LESSON_AUTHORING_STAGES[number]
export const lessonAuthoringModeSchema = z.enum(['manual', 'automatic'])
export const lessonDocumentVersionSchema = z.object({ contentVersion: z.string().min(1), attachments: z.array(z.object({ relativePath: lessonRelativePathSchema, contentVersion: z.string().min(1) }).strict()) }).strict()
export const lessonAuthoringDocumentBaselineSchema = z.object({ role: lessonDocumentRoleSchema, relativePath: lessonRelativePathSchema, version: lessonDocumentVersionSchema }).strict()
export const lessonAuthoringMaterialSelectionSchema = z.object({ id: z.uuid(), extractionVersion: z.string().min(1), fragmentIds: z.array(z.string().min(1)).min(1) }).strict()
export const lessonAuthoringMaterialBaselineSchema = lessonAuthoringMaterialSelectionSchema.extend({ sourceVersion: z.string().min(1) }).strict()
export const lessonAuthoringStateSchema = z.object({ schemaVersion: z.literal(1), lessonId: z.uuid(), mode: lessonAuthoringModeSchema, epoch: z.number().int().nonnegative(), controlEpoch: z.number().int().nonnegative(),
  documents: z.partialRecord(lessonDocumentRoleSchema, z.object({ relativePath: lessonRelativePathSchema, version: lessonDocumentVersionSchema, confirmedAt: z.number().int().nonnegative().optional(), needsReview: z.boolean() }).strict()),
  materials: z.array(lessonAuthoringMaterialBaselineSchema),
}).strict()
export const lessonAuthoringTicketSchema = z.object({ schemaVersion: z.literal(1), id: z.uuid(), lesson: lessonIdentitySchema, epoch: z.number().int().nonnegative(), controlEpoch: z.number().int().nonnegative(),
  stage: z.enum([...LESSON_AUTHORING_STAGES, 'build']), mode: lessonAuthoringModeSchema,
  inputs: z.array(lessonAuthoringDocumentBaselineSchema), materials: z.array(lessonAuthoringMaterialBaselineSchema),
}).strict()
export type LessonAuthoringState = z.infer<typeof lessonAuthoringStateSchema>
export type LessonAuthoringTicket = z.infer<typeof lessonAuthoringTicketSchema>
export type LessonAuthoringMaterialSelection = z.infer<typeof lessonAuthoringMaterialSelectionSchema>
export interface LessonAuthoringView {
  state: LessonAuthoringState
  currentStage: LessonAuthoringStage | 'build'
  documents: (z.infer<typeof lessonAuthoringDocumentBaselineSchema> & { status: 'draft' | 'confirmed' | 'review' })[]
  issues: string[]
}
export interface LessonAuthoringBuildValidation {
  allowed: boolean
  epoch: number
  mode: LessonAuthoringState['mode']
  documents: z.infer<typeof lessonAuthoringDocumentBaselineSchema>[]
  materials: LessonAuthoringState['materials']
  issues: string[]
}
