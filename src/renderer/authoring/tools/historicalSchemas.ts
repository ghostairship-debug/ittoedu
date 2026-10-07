/** Historical V9 Renderer facade schemas. Current Gateway uses V10 toolSchemas. */
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { backgroundModeSchema, flowBlockSchema } from '../../../shared/courseProjectSchema'
import { tableMergeRegionSchema } from '../../../shared/tableMerge'

const coordinate = z.number().finite()
export const layerItemPropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
}).strict()
export const nativeLayerItemPropertiesInputSchema = layerItemPropertiesInputSchema.extend({ paperSpace: z.enum(['paper', 'viewport']).optional() }).strict()
export const backgroundToolInputSchema = z.object({
  backgroundMode: backgroundModeSchema.optional(), backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundAssetId: z.string().min(1).nullable().optional(),
}).strict()
const newFlowBlockInputSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if ('id' in value) { context.addIssue({ code: 'custom', path: ['id'], message: '创建块的 ID 由工具生成' }); return }
  const parsed = flowBlockSchema.safeParse({ ...value, id: 'host-generated-block' })
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})
export const newFlowBlockSchema = newFlowBlockInputSchema.transform(value => flowBlockSchema.parse({ ...value, id: `block-${nanoid(10)}` }))
const id = z.string().min(1)
export const flowTableStructureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('merge'), region: tableMergeRegionSchema }).strict(),
  z.object({ kind: z.literal('split'), rowId: id, columnId: id }).strict(),
  z.object({ kind: z.literal('insert-row'), afterId: id.optional() }).strict(),
  z.object({ kind: z.literal('insert-column'), afterId: id.optional() }).strict(),
  z.object({ kind: z.literal('delete-row'), id }).strict(), z.object({ kind: z.literal('delete-column'), id }).strict(),
  z.object({ kind: z.literal('move-row'), id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ kind: z.literal('move-column'), id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
])
