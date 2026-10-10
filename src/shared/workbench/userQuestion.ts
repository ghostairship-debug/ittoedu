import { z } from 'zod'
import type { ModelToolDefinition } from './modelProvider'
import type { ToolTarget } from './tools'

/** Built-in executor tool. It is not a document tool: never in ToolCatalog, the Gateway or the external MCP surface. */
export const USER_QUESTION_TOOL = 'ask_user'
const responseKind = z.enum(['choice', 'free-text', 'confirm'])

const optionSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().optional(),
}).strict()
const options = z.array(optionSchema)
  .refine(value => new Set(value.map(option => option.label)).size === value.length, '选项名称不能重复')
const draftRequest = z.object({ target: z.string().min(1), label: z.string().min(1).optional(), candidateId: z.string().min(1).optional() }).strict()
const questionShape = { question: z.string().trim().min(1),
  options, multiple: z.boolean().optional(), responseKind: responseKind.optional(), currentDraft: z.array(draftRequest).min(1).optional() }
const validQuestion = (value: { options: readonly { label: string }[]; multiple?: boolean; responseKind?: z.infer<typeof responseKind> },
  ctx: z.RefinementCtx) => {
  const kind = value.responseKind ?? 'choice'
  const valid = kind === 'choice' ? value.options.length >= 2
    : kind === 'free-text' ? value.options.length === 0 && value.multiple !== true
      : value.options.length === 1 && value.multiple !== true
  if (!valid) ctx.addIssue({ code: 'custom', message: kind === 'choice' ? '选择题需要至少两个选项'
    : kind === 'free-text' ? '自由回答不需要选项或多选' : '确认题需要一个确认按钮且不能多选' })
}
/** Model arguments. Invalid input is returned to the model as a tool error; nothing is shown as a question. */
export const userQuestionInputSchema = z.object(questionShape).strict().superRefine(validQuestion)
export type UserQuestionInput = z.infer<typeof userQuestionInputSchema>
/** What the timeline and the option card show. */
export const userQuestionViewSchema = z.object({ text: z.string().min(1), options,
  multiple: z.boolean(), responseKind: responseKind.optional(), currentDraft: z.array(z.object({
    documentId: z.string().min(1), epoch: z.string().min(1), revision: z.number().int().nonnegative(),
    target: z.custom<ToolTarget>().optional(), label: z.string().min(1).optional(), candidateId: z.string().min(1).optional(),
  }).strict()).min(1).optional() }).strict().superRefine(validQuestion)
export type UserQuestionView = z.infer<typeof userQuestionViewSchema>
export const userAnswerSchema = z.object({
  choices: z.array(z.number().int().nonnegative()),
  other: z.string().trim().min(1).optional(),
}).strict()
export type UserAnswer = z.infer<typeof userAnswerSchema>

export const userQuestionView = (input: UserQuestionInput): UserQuestionView => ({
  text: input.question, multiple: input.multiple === true,
  ...(input.responseKind ? { responseKind: input.responseKind } : {}),
  options: input.options.map(option => ({ label: option.label, ...(option.description ? { description: option.description } : {}) })),
})
/** Null when the answer fits the question; otherwise a user-facing reason. */
export function answerProblem(question: UserQuestionView, answer: UserAnswer): string | null {
  const kind = question.responseKind ?? 'choice'
  if (kind === 'free-text') return answer.choices.length === 0 && !!answer.other ? null : '请填写文字回答'
  if (kind === 'confirm') return answer.choices.length === 1 && answer.choices[0] === 0 && !answer.other ? null : '请点击确认按钮'
  if (new Set(answer.choices).size !== answer.choices.length) return '同一选项不能重复选择'
  if (answer.choices.some(choice => choice >= question.options.length)) return '所选项不属于这个问题'
  if (!question.multiple && answer.choices.length > 1) return '这个问题只能选一项'
  if (answer.choices.length === 0 && !answer.other) return '请选择一项，或在“其他”中填写回答'
  return null
}
/** The only fact the model receives: what the user actually chose or wrote. */
export const answerForModel = (question: UserQuestionView, answer: UserAnswer) => ({
  status: 'answered' as const,
  selected: [...answer.choices].sort((a, b) => a - b).map(index => ({ index, label: question.options[index]!.label })),
  ...(answer.other ? { other: answer.other } : {}),
})
export const sameAnswer = (a: UserAnswer, b: UserAnswer) =>
  JSON.stringify([...a.choices].sort((x, y) => x - y)) === JSON.stringify([...b.choices].sort((x, y) => x - y)) && (a.other ?? '') === (b.other ?? '')

export const USER_QUESTION_USAGE_GUIDANCE = `需要用户在几个明确方案中做决定且无法从用户原话和文档推断，或正在执行的 Skill 明确要求用户审阅并确认当前阶段的新产物时，调用 ${USER_QUESTION_TOOL} 并等待回答。普通选择用 choice，自由输入用 free-text，单步确认用 confirm；不要为了满足选项数量编造假选项。`
  + '阶段确认前先提供当前产物供用户审阅，并在 currentDraft 中引用实际作品的 target；确认后读取用户眼前的当前稿，包含其人工修改，不要求先保存。普通问题不附 currentDraft。用户已明确选择跳过确认的自动模式或免去该确认时，不再追加确认。每次只问一个问题，不用于寒暄或重复确认已明确的输入要求，不自行增加阶段确认。'

export const userQuestionToolDefinition: ModelToolDefinition = {
  name: USER_QUESTION_TOOL,
  description: '向用户提一个需要其决定的问题。choice 给出至少两个选项，free-text 让用户填写文字且 options=[]，confirm 提供一个确认按钮。选择题另有“其他”输入，选项里不要再写“其他”。'
    + USER_QUESTION_USAGE_GUIDANCE
    + '调用后任务会等待用户回答，工具结果只含用户实际的选择（selected）和补充文字（other）；随后按用户的选择继续完成任务。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['question', 'options'],
    properties: {
      question: { type: 'string', description: '一句话说明需要用户决定什么' },
      responseKind: { type: 'string', enum: ['choice', 'free-text', 'confirm'], description: '默认 choice；free-text 时 options=[]，confirm 时只有一个按钮' },
      options: { type: 'array', minItems: 0, description: '选择题至少两项；自由回答 0 项；确认题 1 项',
        items: { type: 'object', additionalProperties: false, required: ['label'], properties: {
          label: { type: 'string', description: '简短的选项名称' },
          description: { type: 'string', description: '可选：这个选项意味着什么' },
        } } },
      multiple: { type: 'boolean', description: '是否允许多选，默认单选' },
      currentDraft: { type: 'array', minItems: 1, description: '仅用于确认当前作品；引用已取得的 target。普通问题省略。',
        items: { type: 'object', additionalProperties: false, required: ['target'], properties: {
          target: { type: 'string', description: '当前作品或范围的 target 句柄' }, label: { type: 'string' }, candidateId: { type: 'string' },
        } } },
    },
  },
}
