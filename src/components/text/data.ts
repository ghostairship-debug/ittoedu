import { z } from 'zod'
import { documentInlineSchema, documentTextContentSchema, documentTextStyleSchema, normalizeDocumentText, type FlowInline, type FlowTextContent } from '../../shared/document/content'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'

export const textSizingSchema = z.object({
  mode: z.enum(['grow-height', 'fixed', 'shrink-text']).default('grow-height'),
  minHeight: z.number().finite().nonnegative().default(0),
  overflow: z.enum(['visible', 'clip']).default('visible'),
}).strict()
export const textAppearanceSchema = z.object({
  fontFamily: z.string().min(1).default('sans-serif'),
  fontSize: z.number().finite().positive().default(24),
  color: z.string().default('#000000'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** CSS normal uses the actual font metrics in the shared renderer, without guessing a multiplier. */
  lineHeight: z.union([z.number().finite().positive(), z.literal('normal')]).default(1.4),
  /** Native professional line gap in px. Absent retains the existing lineHeight multiplier API. */
  lineSpacing: z.number().finite().min(0).max(200).optional(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  strike: z.boolean().default(false),
  emphasis: z.boolean().default(false),
  highlightColor: z.string().nullable().default(null),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
  writingMode: z.enum(['horizontal', 'vertical-rl', 'vertical-lr']).default('horizontal'),
  letterSpacing: z.number().finite().default(0),
  padding: z.number().finite().nonnegative().default(0),
  backgroundColor: z.string().default('#ffffff'),
  backgroundOpacity: z.number().finite().min(0).max(1).default(0),
  borderColor: z.string().default('#000000'),
  borderOpacity: z.number().finite().min(0).max(1).default(0),
  borderWidth: z.number().finite().nonnegative().default(0),
  cornerRadius: z.number().finite().nonnegative().default(0),
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
}).strict()
const defaultTextAppearance = textAppearanceSchema.parse({})
export const textComponentDataSchema = z.object({
  content: documentTextContentSchema,
  appearance: textAppearanceSchema.default(defaultTextAppearance),
  sizing: textSizingSchema.default({ mode: 'grow-height', minHeight: 0, overflow: 'visible' }),
}).strict()
export type TextComponentData = z.infer<typeof textComponentDataSchema>
export type TextSizing = z.infer<typeof textSizingSchema>
export type TextAppearance = z.infer<typeof textAppearanceSchema>
export type InlineStyle = z.infer<typeof documentTextStyleSchema>
const mathInlineSchema = documentInlineSchema.transform((inline, context) => {
  if (inline.type === 'math') return inline
  context.addIssue({ code: 'custom', message: '需要公式内容' })
  return z.NEVER
})
export const formulaComponentDataSchema = z.object({
  formula: mathInlineSchema,
  appearance: textAppearanceSchema.default(defaultTextAppearance),
  sizing: textSizingSchema.default({ mode: 'grow-height', minHeight: 0, overflow: 'visible' }),
}).strict()
export type FormulaComponentData = z.infer<typeof formulaComponentDataSchema>

export function createTextComponentData(source: string | FlowTextContent = ''): TextComponentData {
  return textComponentDataSchema.parse({ content: typeof source === 'string' ? { inlines: [{ type: 'text', text: source }] } : source })
}
/** The caller supplies the software-owned formula identity; source is the sole formula representation. */
export function createFormulaComponentData(formulaId: string, latex: string): FormulaComponentData {
  return formulaComponentDataSchema.parse({ formula: { type: 'math', formulaId, latex, accessibleText: describeDocumentMath(parseDocumentMath(latex)) } }) as FormulaComponentData
}

function split(content: FlowTextContent, offset: number): [FlowInline[], FlowInline[]] {
  const before: FlowInline[] = [], after: FlowInline[] = []
  let cursor = 0
  for (const original of content.inlines) {
    const inline = structuredClone(original)
    const length = inline.type === 'math' ? 1 : Array.from(inline.text).length
    if (cursor + length <= offset) before.push(inline)
    else if (cursor >= offset) after.push(inline)
    else if (inline.type === 'text') {
      const chars = Array.from(inline.text), cut = offset - cursor
      before.push({ ...inline, text: chars.slice(0, cut).join('') })
      after.push({ ...inline, text: chars.slice(cut).join('') })
    }
    cursor += length
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > cursor) throw new RangeError('文字范围超出正文')
  return [before, after]
}
/** Code point offsets; inline math counts as one atom. Unselected style and formula identity survive. */
export function replaceTextComponentRange(data: TextComponentData, from: number, to: number, replacement: FlowTextContent): TextComponentData {
  if (to < from) throw new RangeError('文字范围顺序错误')
  const [before] = split(data.content, from), [, after] = split(data.content, to)
  return textComponentDataSchema.parse({ ...data, content: normalizeDocumentText({ inlines: [...before, ...replacement.inlines, ...after] }) })
}
export function formatTextComponentRange(data: TextComponentData, from: number, to: number, style: InlineStyle): TextComponentData {
  if (to < from) throw new RangeError('文字范围顺序错误')
  const parsed = documentTextStyleSchema.parse(style)
  if (!Object.keys(parsed).length) return data
  const [, tail] = split(data.content, from), [selected] = split({ inlines: tail }, to - from)
  const inlines = selected.map(inline => {
    const applicable = inline.type === 'math'
      ? { ...(parsed.fontSize === undefined ? {} : { fontSize: parsed.fontSize }), ...(parsed.color === undefined ? {} : { color: parsed.color }) } : parsed
    return Object.keys(applicable).length ? { ...inline, style: { ...inline.style, ...applicable } } : inline
  })
  return replaceTextComponentRange(data, from, to, { inlines })
}
export function editFormulaComponentSource(data: FormulaComponentData, latex: string): FormulaComponentData {
  return formulaComponentDataSchema.parse({ ...data, formula: { ...data.formula, latex, accessibleText: describeDocumentMath(parseDocumentMath(latex)) } }) as FormulaComponentData
}
