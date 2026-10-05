import { z } from 'zod'
import { nativeInputStyleSchema } from '../../shared/contracts/native-v1/schema'
import type { NativeInputContent } from '../../shared/contracts/native-v1/types'
import { interactionDefinition } from './shared'

export const INPUT_DEFINITION = interactionDefinition('guoling.input', '填空')
export const DEFAULT_INPUT_STYLE = {
  fontFamily: 'Microsoft YaHei', fontSize: 24, textColor: '#172033', fillColor: '#ffffff', fillOpacity: 1,
  borderColor: '#94a3b8', borderOpacity: 1, borderWidth: 1, cornerRadius: 8, horizontalAlign: 'left' as const, padding: 10,
}
export const inputDataSchema = z.object({
  label: z.string(), placeholder: z.string().default(''), initialValue: z.string().default(''), submitLabel: z.string().default('提交'),
  acceptedAnswers: z.array(z.string()).default([]), trim: z.boolean().default(true), caseSensitive: z.boolean().default(false),
  /** Existing feedback record key; the answer's scalar keys are separate professional values. */
  stateKey: z.string().optional(),
  answer: z.object({ type: z.enum(['text', 'number']), stateKey: z.string().min(1), validityKey: z.string().min(1), ruleFamilyRuleIds: z.array(z.string().min(1)) }).strict().optional(),
  style: nativeInputStyleSchema.default(DEFAULT_INPUT_STYLE),
}).strict().superRefine((data, context) => {
  if (data.answer && new Set([data.answer.stateKey, data.answer.validityKey, data.stateKey]).size !== 3) context.addIssue({ code: 'custom', path: ['answer'], message: '答案、有效性与反馈结果必须使用不同状态键' })
})
export type InputData = z.infer<typeof inputDataSchema>
export const createInputData = (data: Partial<InputData> = {}) => inputDataSchema.parse({ label: '填写答案', ...data })
export function inputAnswerContent(instanceId: string, data: InputData): NativeInputContent {
  const resultKey = data.stateKey ?? `interaction:${instanceId}`
  if (data.answer && [data.answer.stateKey, data.answer.validityKey].includes(resultKey)) throw new Error('答案状态键不能覆盖输入反馈结果。')
  return { answerType: data.answer?.type ?? 'text', stateKey: data.answer?.stateKey ?? `input:${instanceId}:value`,
    validityKey: data.answer?.validityKey ?? `input:${instanceId}:valid`, ruleFamilyRuleIds: [...(data.answer?.ruleFamilyRuleIds ?? [])],
    placeholder: data.placeholder, style: { ...data.style } }
}
