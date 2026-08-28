import { z } from 'zod'
import type {
  CourseStateCondition,
  CourseStateDeclaration,
  CourseStateScalar,
} from './types'

export const courseStateKeySchema = z.string().trim().min(1).max(240)
export const courseStateScalarSchema: z.ZodType<CourseStateScalar> = z.union([
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.null(),
])
export const courseStateCompareOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
])

export const courseStateDeclarationSchema: z.ZodType<CourseStateDeclaration> =
  z.discriminatedUnion('valueType', [
    z.object({
      key: courseStateKeySchema,
      valueType: z.literal('boolean'),
      defaultValue: z.boolean(),
    }).strict(),
    z.object({
      key: courseStateKeySchema,
      valueType: z.literal('number'),
      defaultValue: z.number().finite(),
    }).strict(),
    z.object({
      key: courseStateKeySchema,
      valueType: z.literal('string'),
      defaultValue: z.string(),
    }).strict(),
    z.object({
      key: courseStateKeySchema,
      valueType: z.literal('null'),
      defaultValue: z.null(),
    }).strict(),
  ])

export const courseStateExistsConditionSchema = z.object({
  type: z.literal('exists'),
  key: courseStateKeySchema,
  exists: z.boolean(),
}).strict()

export const courseStateCompareConditionSchema = z.object({
  type: z.literal('compare'),
  key: courseStateKeySchema,
  operator: courseStateCompareOperatorSchema,
  value: courseStateScalarSchema,
}).strict()

export const courseStateConditionSchema: z.ZodType<CourseStateCondition> =
  z.discriminatedUnion('type', [
    courseStateExistsConditionSchema,
    courseStateCompareConditionSchema,
  ])
