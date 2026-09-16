import { z } from 'zod'
import { chartNativeContentObjectSchema } from '../contracts/native-v1/schema'
import type { NativeChartContent, TextRunStyle } from '../contracts/native-v1/types'
import { tableCellSpan, tableMergeIssues, tableMergeRegionSchema, type TableMergeRegion } from '../tableMerge'
import { parseDocumentMath } from './math'

// The 048 root switch will consume these definitions; no legacy Flow writer uses them.
export interface InlineLink { href: string; title?: string }
export type MathStyle = { fontSize?: number; color?: string }
export type FlowInline =
  | { type: 'text'; text: string; style?: TextRunStyle; code?: boolean; link?: InlineLink }
  | { type: 'math'; formulaId: string; latex: string; accessibleText: string; style?: MathStyle; link?: InlineLink }
export interface FlowTextContent { inlines: FlowInline[] }
type ParagraphStyle = { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number }
export type DocumentBlock = { id: string } & (
  | ({ type: 'paragraph'; content: FlowTextContent } & ParagraphStyle)
  | ({ type: 'heading'; content: FlowTextContent; level: 1 | 2 | 3 | 4 | 5 | 6 } & ParagraphStyle)
  | ({ type: 'quote'; content: FlowTextContent; citation?: FlowTextContent } & ParagraphStyle)
  | { type: 'list'; ordered: boolean; items: { id: string; content: FlowTextContent }[] }
  | { type: 'divider' }
  | { type: 'media'; assetId: string; mediaKind: 'image' | 'audio' | 'video'; altText?: string; caption?: FlowTextContent; layout: 'content-width' | 'wide' | 'full-width'; wrap?: 'none' | 'left' | 'right' }
  | { type: 'table'; caption?: FlowTextContent; columns: { id: string; header: FlowTextContent }[]; rows: { id: string; cells: Record<string, FlowTextContent> }[]; merges?: TableMergeRegion[] }
  | { type: 'chart'; chart: NativeChartContent; height: number }
  | { type: 'formula'; formulaId: string; latex: string; accessibleText: string; style?: MathStyle }
  | { type: 'code'; code: string; language?: string }
  | { type: 'callout'; tone: 'note' | 'example' | 'warning' | 'conclusion'; title?: FlowTextContent; body: FlowTextContent }
  | { type: 'section'; title: FlowTextContent; collapsedByDefault: boolean; blocks: DocumentBlock[] }
  | { type: 'component'; component: { packageId: string; version: string }; props: Record<string, unknown>; staticFallbackAssetId: string; wrap?: 'none' | 'left' | 'right' }
)

export const documentIdSchema = z.string().min(1).max(240).refine(s => s === s.trim(), '身份不得含首尾空白')
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const documentTextStyleSchema = z.object({
  baseline: z.number().finite().min(-1).max(1).optional(), color: color.optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  strike: z.boolean().optional(), emphasis: z.boolean().optional(), highlightColor: color.nullable().optional(),
  fontFamily: z.string().trim().min(1).max(300).optional(), fontSize: z.number().finite().min(8).max(400).optional(),
}).strict()
export const documentMathStyleSchema = documentTextStyleSchema.pick({ fontSize: true, color: true })
export const inlineLinkSchema = z.object({ href: z.string().min(1), title: z.string().optional() }).strict()
const latexSchema = z.string().min(1).max(16384).superRefine((value, ctx) => {
  try { parseDocumentMath(value) } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '无效公式' }) }
})
const mathFields = { formulaId: documentIdSchema, latex: latexSchema, accessibleText: z.string().trim().min(1).max(4000), style: documentMathStyleSchema.optional() }
export const documentInlineSchema: z.ZodType<FlowInline> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string(), style: documentTextStyleSchema.optional(), code: z.boolean().optional(), link: inlineLinkSchema.optional() }).strict(),
  z.object({ type: z.literal('math'), ...mathFields, link: inlineLinkSchema.optional() }).strict(),
])
export const documentTextContentSchema = z.object({ inlines: z.array(documentInlineSchema) }).strict()
const base = { id: documentIdSchema }
const paragraph = { content: documentTextContentSchema, textAlign: z.enum(['left', 'center', 'right']).optional(), lineSpacing: z.number().finite().min(0).max(200).optional() }
const table = z.object({
  ...base, type: z.literal('table'), caption: documentTextContentSchema.optional(),
  columns: z.array(z.object({ id: documentIdSchema, header: documentTextContentSchema }).strict()).min(1).max(256),
  rows: z.array(z.object({ id: documentIdSchema, cells: z.record(z.string(), documentTextContentSchema) }).strict()).max(100000),
  merges: z.array(tableMergeRegionSchema).max(10000).optional(),
}).strict().superRefine((block, ctx) => {
  for (const message of tableMergeIssues(block)) ctx.addIssue({ code: 'custom', path: ['merges'], message })
  const columns = new Set(block.columns.map(c => c.id))
  if (columns.size !== block.columns.length) ctx.addIssue({ code: 'custom', path: ['columns'], message: '列身份重复' })
  if (new Set(block.rows.map(r => r.id)).size !== block.rows.length) ctx.addIssue({ code: 'custom', path: ['rows'], message: '行身份重复' })
  block.rows.forEach((r, index) => {
    if (Object.keys(r.cells).length !== columns.size || Object.keys(r.cells).some(c => !columns.has(c))) ctx.addIssue({ code: 'custom', path: ['rows', index, 'cells'], message: '每行必须包含全部列且无额外列' })
    for (const [column, cell] of Object.entries(r.cells)) {
      if (cell.inlines.some(i => i.type === 'math' || i.text.length > 0) && tableCellSpan(block, r.id, column).covered) ctx.addIssue({ code: 'custom', path: ['rows', index, 'cells', column], message: '合并覆盖格必须为空' })
    }
  })
})
export const documentBlockSchema: z.ZodType<DocumentBlock> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('paragraph'), ...paragraph }).strict(),
  z.object({ ...base, type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), ...paragraph }).strict(),
  z.object({ ...base, type: z.literal('quote'), ...paragraph, citation: documentTextContentSchema.optional() }).strict(),
  z.object({ ...base, type: z.literal('list'), ordered: z.boolean(), items: z.array(z.object({ id: documentIdSchema, content: documentTextContentSchema }).strict()).min(1).max(10000) }).strict(),
  z.object({ ...base, type: z.literal('divider') }).strict(),
  z.object({ ...base, type: z.literal('media'), assetId: documentIdSchema, mediaKind: z.enum(['image', 'audio', 'video']), altText: z.string().max(4000).optional(), caption: documentTextContentSchema.optional(), layout: z.enum(['content-width', 'wide', 'full-width']), wrap: z.enum(['none', 'left', 'right']).optional() }).strict(),
  table,
  z.object({ ...base, type: z.literal('chart'), chart: chartNativeContentObjectSchema, height: z.number().finite().min(160).max(1600) }).strict(),
  z.object({ ...base, type: z.literal('formula'), ...mathFields }).strict(),
  z.object({ ...base, type: z.literal('code'), code: z.string().max(5000000), language: z.string().trim().min(1).max(100).optional() }).strict(),
  z.object({ ...base, type: z.literal('callout'), tone: z.enum(['note', 'example', 'warning', 'conclusion']), title: documentTextContentSchema.optional(), body: documentTextContentSchema }).strict(),
  z.object({ ...base, type: z.literal('section'), title: documentTextContentSchema, collapsedByDefault: z.boolean(), blocks: z.array(documentBlockSchema).max(100000) }).strict(),
  z.object({ ...base, type: z.literal('component'), component: z.object({ packageId: documentIdSchema, version: z.string().trim().min(1).max(100) }).strict(), props: z.record(z.string(), z.json()), staticFallbackAssetId: documentIdSchema, wrap: z.enum(['none', 'left', 'right']).optional() }).strict(),
]))

/** All editable body slots, including headers/captions that were formerly strings. */
export function documentTextSlots(block: DocumentBlock): { key: string; content: FlowTextContent }[] {
  switch (block.type) {
    case 'paragraph': case 'heading': return [{ key: 'content', content: block.content }]
    case 'quote': return [{ key: 'content', content: block.content }, ...(block.citation ? [{ key: 'citation', content: block.citation }] : [])]
    case 'list': return block.items.map(item => ({ key: `item:${item.id}`, content: item.content }))
    case 'table': return [...block.columns.map(c => ({ key: `column:${c.id}`, content: c.header })), ...block.rows.flatMap(r => Object.entries(r.cells).map(([c, content]) => ({ key: `cell:${JSON.stringify([r.id, c])}`, content }))), ...(block.caption ? [{ key: 'caption', content: block.caption }] : [])]
    case 'media': return block.caption ? [{ key: 'caption', content: block.caption }] : []
    case 'callout': return [...(block.title ? [{ key: 'title', content: block.title }] : []), { key: 'body', content: block.body }]
    case 'section': return [{ key: 'title', content: block.title }]
    default: return []
  }
}
export function walkDocument(blocks: readonly DocumentBlock[], visit: (block: DocumentBlock) => void): void {
  for (const block of blocks) { visit(block); if (block.type === 'section') walkDocument(block.blocks, visit) }
}
export const documentContentSchema = z.object({ blocks: z.array(documentBlockSchema).max(100000) }).strict().superRefine((doc, ctx) => {
  const ids = new Set<string>()
  const add = (id: string) => {
    if (ids.has(id)) ctx.addIssue({ code: 'custom', message: `重复身份：${id}` })
    ids.add(id)
  }
  walkDocument(doc.blocks, block => {
    add(block.id)
    if (block.type === 'formula') add(block.formulaId)
    if (block.type === 'list') block.items.forEach(i => add(i.id))
    if (block.type === 'table') { block.rows.forEach(r => add(r.id)); block.columns.forEach(c => add(c.id)) }
    for (const { content } of documentTextSlots(block)) for (const atom of content.inlines) if (atom.type === 'math') add(atom.formulaId)
  })
})
export type DocumentContent = z.infer<typeof documentContentSchema>
export const plainDocumentText = (content: FlowTextContent): string => content.inlines.map(i => i.type === 'text' ? i.text : i.accessibleText).join('')
export const documentTextLength = (content: FlowTextContent): number => content.inlines.reduce((n, i) => n + (i.type === 'math' ? 1 : Array.from(i.text).length), 0)

export function normalizeDocumentText(content: FlowTextContent): FlowTextContent {
  const result: FlowInline[] = []
  const key = (i: FlowInline) => JSON.stringify(i.type === 'text' ? { code: i.code ?? false, link: i.link, style: Object.fromEntries(Object.entries(i.style ?? {}).sort(([a], [b]) => a.localeCompare(b))) } : {})
  for (const inline of content.inlines) {
    if (inline.type === 'text' && inline.text === '') continue
    const last = result.at(-1)
    if (last?.type === 'text' && inline.type === 'text' && key(last) === key(inline)) last.text += inline.text
    else result.push(structuredClone(inline))
  }
  return { inlines: result }
}
