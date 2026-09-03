import { z } from 'zod'

import type { ProjectPlaybackSettings, ProjectPresenterSettings } from './types'

const presenterKeyBindingSchema = z.object({
  id: z.string().trim().min(1).max(200),
  command: z.enum(['next', 'previous']),
  key: z.string().min(1).max(64),
  altKey: z.boolean(),
  ctrlKey: z.boolean(),
  shiftKey: z.boolean(),
  metaKey: z.boolean(),
}).strict()

export const projectPresenterSettingsSchema: z.ZodType<ProjectPresenterSettings> = z.object({
  enabled: z.boolean(),
  strategy: z.enum(['scene-navigation', 'authored-command']),
  additionalBindings: z.array(presenterKeyBindingSchema).max(32),
}).strict().superRefine((presenter, context) => {
  const ids = presenter.additionalBindings.map((binding) => binding.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: 'custom',
      path: ['additionalBindings'],
      message: '翻页笔附加按键 ID 不能重复',
    })
  }

  const signatures = new Map<string, number>()
  presenter.additionalBindings.forEach((binding, index) => {
    const isUnmodifiedStandardBinding =
      (binding.key === 'PageDown' || binding.key === 'PageUp') &&
      !binding.altKey &&
      !binding.ctrlKey &&
      !binding.shiftKey &&
      !binding.metaKey
    if (isUnmodifiedStandardBinding) {
      context.addIssue({
        code: 'custom',
        path: ['additionalBindings', index, 'key'],
        message: 'PageDown/PageUp 是内建标准绑定，不能作为附加按键重复配置',
      })
    }
    const signature = [
      binding.key,
      binding.altKey,
      binding.ctrlKey,
      binding.shiftKey,
      binding.metaKey,
    ].join('\0')
    const existingIndex = signatures.get(signature)
    if (existingIndex !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['additionalBindings', index],
        message: `翻页笔附加按键与第 ${existingIndex + 1} 项重复`,
      })
    } else {
      signatures.set(signature, index)
    }
  })
})

export const projectPlaybackSettingsSchema: z.ZodType<ProjectPlaybackSettings> = z.object({
  controls: z.enum(['canvas', 'none']),
  keyboardNavigation: z.boolean(),
  presenter: projectPresenterSettingsSchema,
}).strict()

const courseProjectPresenterKeyBindingSchema = z.object({
  id: z.string().trim().min(1).max(240),
  command: z.enum(['next', 'previous']),
  key: z.string().min(1).max(64),
  altKey: z.boolean(),
  ctrlKey: z.boolean(),
  shiftKey: z.boolean(),
  metaKey: z.boolean(),
}).strict()

/**
 * Exact Course Project V9 playback profile. V9 currently treats duplicate or
 * built-in key bindings as authoring policy, not parse-time invalid wire.
 */
export const courseProjectPlaybackSettingsSchema: z.ZodType<ProjectPlaybackSettings> = z.object({
  controls: z.enum(['canvas', 'none']),
  keyboardNavigation: z.boolean(),
  presenter: z.object({
    enabled: z.boolean(),
    strategy: z.enum(['scene-navigation', 'authored-command']),
    additionalBindings: z.array(courseProjectPresenterKeyBindingSchema).max(32),
  }).strict(),
}).strict()
