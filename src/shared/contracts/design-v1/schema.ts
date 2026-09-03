import { z } from 'zod'

import type { ProjectDesignTokens } from './types'

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const designTokenIdSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/, 'Token ID 必须以小写字母开头，并只含小写字母、数字、点、横线或下划线')

export const projectDesignTokensSchema: z.ZodType<ProjectDesignTokens> = z.object({
  fonts: z.array(z.object({
    id: designTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    fontFamily: z.string().trim().min(1).max(300),
  }).strict()).max(16),
  colors: z.array(z.object({
    id: designTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    color: colorSchema,
  }).strict()).max(32),
}).strict().superRefine((tokens, context) => {
  ;(['fonts', 'colors'] as const).forEach((kind) => {
    const ids = new Set<string>()
    tokens[kind].forEach((token, index) => {
      if (ids.has(token.id)) {
        context.addIssue({
          code: 'custom',
          path: [kind, index, 'id'],
          message: '同类设计 Token 的 ID 不能重复',
        })
      }
      ids.add(token.id)
    })
  })
}).default({
  fonts: [{
    id: 'body',
    label: '正文',
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
  }],
  colors: [
    { id: 'background', label: '背景', color: '#ffffff' },
    { id: 'text', label: '正文', color: '#1f2937' },
    { id: 'accent', label: '强调', color: '#2563eb' },
  ],
})

const courseProjectDesignTokenIdSchema = z.string().regex(/^[a-z][a-z0-9._-]*$/)

/**
 * Course Project V9 validation profile.
 *
 * V9 intentionally has wider collection limits than the frozen V8 profile and
 * does not inject defaults or reject duplicate IDs at parse time. Keep this
 * profile in the Design owner so authoring and Published contracts share one
 * exact definition without changing the accepted V9 wire.
 */
export const courseProjectDesignTokensSchema: z.ZodType<ProjectDesignTokens> = z.object({
  fonts: z.array(z.object({
    id: courseProjectDesignTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    fontFamily: z.string().trim().min(1).max(300),
  }).strict()).max(64),
  colors: z.array(z.object({
    id: courseProjectDesignTokenIdSchema,
    label: z.string().trim().min(1).max(80),
    color: colorSchema,
  }).strict()).max(256),
}).strict()
