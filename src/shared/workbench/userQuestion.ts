import { z } from 'zod'
import type { ModelToolDefinition } from './modelProvider'

/** Built-in executor tool. It is not a document tool: never in ToolCatalog, the Gateway or the external MCP surface. */
export const USER_QUESTION_TOOL = 'ask_user'
export const USER_QUESTION_LIMITS = { question: 500, label: 80, description: 300, minOptions: 2, maxOptions: 6, other: 2000 } as const

const optionSchema = z.object({
  label: z.string().trim().min(1).max(USER_QUESTION_LIMITS.label),
  description: z.string().trim().max(USER_QUESTION_LIMITS.description).optional(),
}).strict()
const options = z.array(optionSchema).min(USER_QUESTION_LIMITS.minOptions).max(USER_QUESTION_LIMITS.maxOptions)
  .refine(value => new Set(value.map(option => option.label)).size === value.length, '选项名称不能重复')
/** Model arguments. Invalid input is returned to the model as a tool error; nothing is shown as a question. */
export const userQuestionInputSchema = z.object({
  question: z.string().trim().min(1).max(USER_QUESTION_LIMITS.question), options, multiple: z.boolean().optional(),
}).strict()
export type UserQuestionInput = z.infer<typeof userQuestionInputSchema>
/** What the timeline and the option card show. */
export const userQuestionViewSchema = z.object({ text: z.string().min(1).max(USER_QUESTION_LIMITS.question), options, multiple: z.boolean() }).strict()
export type UserQuestionView = z.infer<typeof userQuestionViewSchema>
export const userAnswerSchema = z.object({
  choices: z.array(z.number().int().nonnegative()).max(USER_QUESTION_LIMITS.maxOptions),
  other: z.string().trim().min(1).max(USER_QUESTION_LIMITS.other).optional(),
}).strict()
export type UserAnswer = z.infer<typeof userAnswerSchema>

export const userQuestionView = (input: UserQuestionInput): UserQuestionView => ({
  text: input.question, multiple: input.multiple === true,
  options: input.options.map(option => ({ label: option.label, ...(option.description ? { description: option.description } : {}) })),
})
/** Null when the answer fits the question; otherwise a user-facing reason. */
export function answerProblem(question: UserQuestionView, answer: UserAnswer): string | null {
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

export const userQuestionToolDefinition: ModelToolDefinition = {
  name: USER_QUESTION_TOOL,
  description: '向用户提一个需要其决定的问题，并给出 2–6 个可点选的选项；界面会弹出选项卡，另有“其他”供用户自己填写，选项里不要再写“其他”。'
    + '只在确实需要用户在几个明确方案中做决定、且无法从用户原话和文档推断时使用；每次只问一个问题，不用于寒暄或确认已经明确的要求。'
    + '调用后任务会等待用户回答，工具结果只含用户实际的选择（selected）和补充文字（other）；随后按用户的选择继续完成任务。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['question', 'options'],
    properties: {
      question: { type: 'string', description: '一句话说明需要用户决定什么' },
      options: { type: 'array', minItems: 2, maxItems: 6, description: '互不重复的备选方案',
        items: { type: 'object', additionalProperties: false, required: ['label'], properties: {
          label: { type: 'string', description: '简短的选项名称' },
          description: { type: 'string', description: '可选：这个选项意味着什么' },
        } } },
      multiple: { type: 'boolean', description: '是否允许多选，默认单选' },
    },
  },
}
