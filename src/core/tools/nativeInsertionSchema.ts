import { z } from 'zod'
import { nativeContentInputSchemaByType } from '../../shared/contracts/native-v1/schema'
import { SHAPE_TYPES } from '../../shared/contracts/native-v1/types'

const coordinate = z.number().finite()
const templateBase = { x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional(), label: z.string().optional(), paperSpace: z.enum(['paper', 'viewport']).optional(),
  placement: z.object({ kind: z.literal('center'), anchorItemId: z.string().min(1) }).strict().optional() }
const mediaFields = { assetId: z.string().min(1), width: coordinate.positive().optional(), height: coordinate.positive().optional() }
export const nativeShapeStyleSchema = nativeContentInputSchemaByType.shape.shape.style.partial().strict()
const textStyle = nativeContentInputSchemaByType.text.shape.style
/** Model-facing guidance stays on the same strict style fields used for execution. */
export const nativeTextToolStyleSchema = textStyle.partial().extend({
  emphasis: textStyle.shape.emphasis.removeDefault().optional(),
  padding: textStyle.shape.padding.optional().describe('四周各自占用的像素。固定高度减去两倍 padding 才是文字可用高度。'),
  overflow: textStyle.shape.overflow.optional().describe('shrink 会在框内高度不足时缩小实际字号；需要保持指定字号时扩大框或减小 padding。'),
  backgroundColor: textStyle.shape.backgroundColor.optional().describe('文字框底色；单独设置颜色不会使默认透明的底色可见。'),
  backgroundOpacity: textStyle.shape.backgroundOpacity.optional().describe('文字框底色不透明度，0 为透明、1 为不透明；需要可见底色时与 backgroundColor 一起设置。'),
}).strict()
export const nativeTemplateSchema = z.discriminatedUnion('nativeType', [
  z.object({ ...templateBase, height: coordinate.positive().optional().describe('文字框总高度；四周 padding 会占用内部空间，shrink 可能缩小实际字号。'), nativeType: z.literal('text'), text: z.string().optional(), style: nativeTextToolStyleSchema.optional() }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('formula'), ast: nativeContentInputSchemaByType.formula.shape.ast.optional(), accessibleText: z.string().optional(), style: nativeContentInputSchemaByType.formula.shape.style.partial().strict().optional() }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('shape'), shapeType: z.enum(SHAPE_TYPES), style: nativeShapeStyleSchema.optional() }).strict(),
  z.object({ ...templateBase, ...mediaFields, nativeType: z.literal('image'), fit: z.enum(['contain', 'cover', 'stretch']).optional() }).strict(),
  z.object({ ...templateBase, ...mediaFields, nativeType: z.literal('video') }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('chart'), ...nativeContentInputSchemaByType.chart.options[0].pick({ title: true, categories: true, series: true }).partial().shape, chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(), style: nativeContentInputSchemaByType.chart.options[0].shape.style.extend({ holeSize: nativeContentInputSchemaByType.chart.options[2].shape.style.shape.holeSize.optional() }).partial().strict().optional() }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('table'), ...z.object(nativeContentInputSchemaByType.table.shape).pick({ columns: true, rows: true, headerRowCount: true, merges: true }).partial().shape, style: nativeContentInputSchemaByType.table.shape.style.partial().strict().optional() }).strict(),
  z.object({ ...templateBase, nativeType: z.literal('input'), answerType: z.enum(['text', 'number']).optional() }).strict(),
])

export const basicNativeTemplateSchema = z.union([
  nativeTemplateSchema.options[0].omit({ placement: true }),
  nativeTemplateSchema.options[1].omit({ placement: true }),
  nativeTemplateSchema.options[2].omit({ placement: true }),
  nativeTemplateSchema.options[3].omit({ placement: true }),
  nativeTemplateSchema.options[4].omit({ placement: true }),
  nativeTemplateSchema.options[5].omit({ placement: true }),
  nativeTemplateSchema.options[6].omit({ placement: true }),
  nativeTemplateSchema.options[7].omit({ placement: true }),
])
