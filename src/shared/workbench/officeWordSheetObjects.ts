import { z } from 'zod'

const index = z.number().int().nonnegative()
const fragment = z.string().trim().min(1)

export const docxObjectEditSchema = z.strictObject({
  format: z.literal('docx'),
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('paragraph'), paragraph: index }),
    z.strictObject({ kind: z.literal('run'), paragraph: index, run: index }),
    z.strictObject({ kind: z.literal('table'), table: index }),
    z.strictObject({ kind: z.literal('row'), table: index, row: index }),
    z.strictObject({ kind: z.literal('cell'), table: index, row: index, column: index }),
  ]).describe('段落、文字段、表格、行、单元格索引均从 0 开始，使用原件检查返回的位置。'),
  properties: z.array(fragment).min(1).describe('每项为一个 WordprocessingML 局部属性元素，使用 w: 前缀。例如 <w:spacing w:after="160"/>。保持编号、分节、修订和合并拓扑。'),
})

export const xlsxObjectEditSchema = z.strictObject({
  format: z.literal('xlsx'),
  target: z.strictObject({ sheet: z.string().min(1), cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]*$/i) }),
  style: z.strictObject({
    numberFormat: z.string().min(1).max(255).regex(/^[\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]+$/u).optional().describe('Excel 原生数字格式代码，例如 0.0%。'),
    alignment: fragment.optional().describe('SpreadsheetML alignment 元素，例如 <alignment wrapText="1"/>。'),
    protection: fragment.optional().describe('SpreadsheetML protection 元素。'),
    font: fragment.optional().describe('SpreadsheetML font 元素。只覆盖给定的属性子元素。'),
    fill: fragment.optional().describe('完整的 SpreadsheetML fill 元素。'),
    border: fragment.optional().describe('SpreadsheetML border 元素。只覆盖给定的边和属性。'),
  }).refine(style => Object.values(style).some(value => value !== undefined), '请提供至少一个单元格样式属性'),
})

export type DocxObjectPropertyEdit = z.infer<typeof docxObjectEditSchema>
export type XlsxObjectPropertyEdit = z.infer<typeof xlsxObjectEditSchema>
