import { z } from 'zod'
import type { ModelToolDefinition } from './modelProvider'
import type { ToolTarget } from './tools'
import { executionAdvancementModeSchema, type ExecutionAdvancementMode } from './conversations'

/** Built-in executor tool. It is not a document tool: never in ToolCatalog, the Gateway or the external MCP surface. */
export const USER_QUESTION_TOOL = 'ask_user'
const responseKind = z.enum(['choice', 'free-text', 'confirm'])

const optionSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().optional(),
  value: executionAdvancementModeSchema.optional(),
}).strict()
const options = z.array(optionSchema)
  .refine(value => new Set(value.map(option => option.label)).size === value.length, '选项名称不能重复')
const draftRequest = z.object({ target: z.string().min(1), label: z.string().min(1).optional(), candidateId: z.string().min(1).optional() }).strict()
const purpose = z.literal('advancement-mode').optional()
const questionShape = { question: z.string().trim().min(1),
  options, multiple: z.boolean().optional(), responseKind: responseKind.optional(), purpose, currentDraft: z.array(draftRequest).min(1).optional() }
/** Model arguments. Invalid input is returned to the model as a tool error; nothing is shown as a question. */
export const userQuestionInputSchema = z.object(questionShape).strict()
export type UserQuestionInput = z.infer<typeof userQuestionInputSchema>
/** What the timeline and the option card show. */
export const userQuestionViewSchema = z.object({ text: z.string().min(1), options,
  multiple: z.boolean(), responseKind: responseKind.optional(), purpose, currentDraft: z.array(z.object({
    documentId: z.string().min(1), epoch: z.string().min(1), revision: z.number().int().nonnegative(),
    target: z.custom<ToolTarget>().optional(), label: z.string().min(1).optional(), candidateId: z.string().min(1).optional(),
  }).strict()).min(1).optional() }).strict()
export type UserQuestionView = z.infer<typeof userQuestionViewSchema>
export const userAnswerSchema = z.object({
  choices: z.array(z.number().int().nonnegative()),
  other: z.string().trim().min(1).optional(),
}).strict()
export type UserAnswer = z.infer<typeof userAnswerSchema>

export const userQuestionView = (input: UserQuestionInput): UserQuestionView => ({
  text: input.question, multiple: input.multiple === true,
  ...(input.responseKind ? { responseKind: input.responseKind } : {}),
  ...(input.purpose ? { purpose: input.purpose } : {}),
  options: input.options.map(option => ({ label: option.label, ...(option.description ? { description: option.description } : {}), ...(option.value ? { value: option.value } : {}) })),
})
/** Null when the answer fits the question; otherwise a user-facing reason. */
export function answerProblem(question: UserQuestionView, answer: UserAnswer): string | null {
  if (new Set(answer.choices).size !== answer.choices.length) return '同一选项不能重复选择'
  if (answer.choices.some(choice => choice >= question.options.length)) return '所选项不属于这个问题'
  if (!question.multiple && answer.choices.length > 1) return '这个问题只能选一项'
  if (answer.choices.length > 0 && answer.other) return '请单独提交选项或“其他想法”文字'
  if (answer.choices.length === 0 && !answer.other) return '请选择一项，或填写“其他想法”'
  return null
}
/** The only fact the model receives: what the user actually chose or wrote. */
export const answerForModel = (question: UserQuestionView, answer: UserAnswer) => ({
  status: 'answered' as const,
  ...(question.purpose ? { purpose: question.purpose } : {}),
  selected: [...answer.choices].sort((a, b) => a - b).map(index => ({ index, label: question.options[index]!.label,
    ...(question.options[index]!.value ? { value: question.options[index]!.value } : {}) })),
  ...(answer.other ? { other: answer.other } : {}),
})
/** Free text stays free text: only an actual mode choice changes the host preference. */
export function advancementModeForAnswer(question: UserQuestionView, answer: UserAnswer): ExecutionAdvancementMode | undefined {
  return question.purpose === 'advancement-mode' && answer.choices.length === 1 && !answer.other
    ? question.options[answer.choices[0]!]?.value : undefined
}
export const sameAnswer = (a: UserAnswer, b: UserAnswer) =>
  JSON.stringify([...a.choices].sort((x, y) => x - y)) === JSON.stringify([...b.choices].sort((x, y) => x - y)) && (a.other ?? '') === (b.other ?? '')

export const USER_QUESTION_USAGE_GUIDANCE = `需要用户在明确方案中做决定且无法从用户原话和文档推断，或当前逐步推进偏好需要审阅关键产物时，调用 ${USER_QUESTION_TOOL} 并等待回答。选项可为零个、一个或多个，不为满足数量编造选项；所有问题的软件界面固定提供独立“其他想法”，无需模型另写这个选项。`
  + '阶段确认前先提供当前产物供用户审阅，并在 currentDraft 中引用实际作品的 target；确认后读取用户眼前的当前稿，包含其人工修改，不要求先保存。普通问题不附 currentDraft。用户已明确选择跳过确认的自动模式或免去该确认时，不再追加确认。每次只问一个问题，不用于寒暄或重复确认已明确的输入要求，不自行增加阶段确认。'

export const userQuestionToolDefinition: ModelToolDefinition = {
  name: USER_QUESTION_TOOL,
  description: '向用户提一个需要其决定的问题。选项可为零个、一个或多个，所有问题都固定提供独立“其他想法”文字框；点击选项只提交选择，提交文字只提交文字，选项里不要再写“其他”。'
    + USER_QUESTION_USAGE_GUIDANCE
    + '调用后任务会等待用户回答，工具结果只含用户实际的选择（selected）或文字（other）；随后按用户回答继续完成任务。首次模式选择用 purpose=advancement-mode，选项 value 为 automatic 或 stepwise，用户尚未选择或自由文字未明确模式时不替用户决定。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['question', 'options'],
    properties: {
      question: { type: 'string', description: '一句话说明需要用户决定什么' },
      responseKind: { type: 'string', enum: ['choice', 'free-text', 'confirm'], description: '可选文案提示，不限制选项数量或文字回答' },
      purpose: { type: 'string', enum: ['advancement-mode'], description: '仅首次选择或显式切换任务推进方式时使用' },
      options: { type: 'array', minItems: 0, description: '真实方案；可为零个、一个或多个',
        items: { type: 'object', additionalProperties: false, required: ['label'], properties: {
          label: { type: 'string', description: '简短的选项名称' },
          description: { type: 'string', description: '可选：这个选项意味着什么' },
          value: { type: 'string', enum: ['automatic', 'stepwise'], description: '仅推进方式选项的稳定值' },
        } } },
      multiple: { type: 'boolean', description: '是否允许多选，默认单选' },
      currentDraft: { type: 'array', minItems: 1, description: '仅用于确认当前作品；引用已取得的 target。普通问题省略。',
        items: { type: 'object', additionalProperties: false, required: ['target'], properties: {
          target: { type: 'string', description: '当前作品或范围的 target 句柄' }, label: { type: 'string' }, candidateId: { type: 'string' },
        } } },
    },
  },
}
