import { z } from 'zod'

/**
 * M15 light editing of text and images that a Runtime or Component renders on its own.
 * The host recognises visible text at run time and stores edits as rules; Runtime and
 * Component source code is never rewritten and never has to register anything.
 */
export const MAX_LIGHT_EDIT_TEXT_OVERRIDES = 2_000
export const MAX_LIGHT_EDIT_ORIGINAL_LENGTH = 2_000
export const MAX_LIGHT_EDIT_REGION_LENGTH = 500
export const MAX_LIGHT_EDIT_TEXT_LENGTH = 20_000

/** Visible text as the host compares it: whitespace runs collapse to one space, ends trimmed. */
export function normalizeLightEditText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface LightEditTextOverride {
  /** Rendered text before the edit, in `normalizeLightEditText` form. */
  original: string
  /** Host-computed signature of where the text appears; absent means every occurrence. */
  region?: string
  /** Text shown instead of `original`. */
  text: string
}

export const lightEditTextOverrideSchema = z.object({
  original: z.string().min(1).max(MAX_LIGHT_EDIT_ORIGINAL_LENGTH)
    .refine((value) => normalizeLightEditText(value) === value, '原文必须是去除多余空白后的可见文字'),
  region: z.string().min(1).max(MAX_LIGHT_EDIT_REGION_LENGTH).optional(),
  text: z.string().max(MAX_LIGHT_EDIT_TEXT_LENGTH),
}).strict() satisfies z.ZodType<LightEditTextOverride>

export const lightEditTextOverridesSchema = z.array(lightEditTextOverrideSchema)
  .max(MAX_LIGHT_EDIT_TEXT_OVERRIDES, `文字修改不能超过 ${MAX_LIGHT_EDIT_TEXT_OVERRIDES} 条`)
  .superRefine((overrides, context) => {
    const seen = new Set<string>()
    overrides.forEach((override, index) => {
      const key = lightEditOverrideKey(override)
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', path: [index], message: '同一原文与区域只能有一条文字修改' })
      }
      seen.add(key)
    })
  })

/** Identity of a rule: one replacement per original text and region. */
export function lightEditOverrideKey(override: Pick<LightEditTextOverride, 'original' | 'region'>): string {
  return JSON.stringify([override.original, override.region ?? null])
}

/** Component images are replaced per manifest asset key with a managed project asset. */
export const lightEditAssetOverridesSchema = z.record(
  z.string().min(1).max(200),
  z.object({ assetId: z.string().trim().min(1).max(240) }).strict(),
)
