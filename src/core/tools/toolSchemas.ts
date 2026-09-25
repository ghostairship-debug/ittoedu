import { tableMergeRegionSchema } from '../../shared/tableMerge'
import { z } from 'zod'
import { backgroundModeSchema } from '../../shared/courseProjectSchema'
import { flowBlockSchema } from '../../shared/courseProjectSchema'
import { nanoid } from 'nanoid'
import { nativeTextToolStyleSchema } from './nativeInsertionSchema'

const coordinate = z.number().finite()
/** Shared wrapper fields still commit through patchEffectiveLayerPropertiesAtTarget. */
export const layerItemPropertiesInputSchema = z.object({
  frame: z.object({ x: coordinate.optional(), y: coordinate.optional(), width: coordinate.positive().optional(), height: coordinate.positive().optional() }).strict().optional(),
  rotation: coordinate.optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), locked: z.boolean().optional(), label: z.string().min(1).optional(),
}).strict()

/** Public whole-node Native text style only; raw nativeData remains a host-only patch. */
// The shared tool-facing style stays a sparse patch for both insertion and update.
const nativeTextStylePatchSchema = nativeTextToolStyleSchema
export const objectUpdatePropertiesInputSchema = layerItemPropertiesInputSchema.extend({
  nativeTextStyle: nativeTextStylePatchSchema.optional(),
}).strict()

/** Flow-only coordinate semantics; other carriers keep the shared strict input. */
export const nativeLayerItemPropertiesInputSchema = layerItemPropertiesInputSchema.extend({
  paperSpace: z.enum(['paper', 'viewport']).optional(),
}).strict()

export const backgroundToolInputSchema = z.object({
  backgroundMode: backgroundModeSchema.optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundAssetId: z.string().min(1).nullable().optional(),
}).strict()

/** Keep the formal Flow parser authoritative; root identity is always host generated. */
export const newFlowBlockInputSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
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
  z.object({ kind: z.literal('delete-row'), id }).strict(),
  z.object({ kind: z.literal('delete-column'), id }).strict(),
  z.object({ kind: z.literal('move-row'), id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ kind: z.literal('move-column'), id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
])
