import { z } from 'zod'
import type { CourseRuntimeDefinition, NativeElementContent } from '../courseProjectTypes'
import { webCompositionSchema } from '../contracts/course-project-v9/schema'
import { courseProjectAssetMetaSchema } from '../contracts/media-v1/schema'
import type { CourseAssetMeta } from '../courseProjectTypes'
import type { DocumentBlock, FlowInline, FlowTextContent } from '../document/content'
import { walkComposition, type WebComposition } from './content'
import { visitCompositionReferences } from './references'

/** Portable content stored in the existing component package file owner. */
export interface CompositionFragment {
  format: 'guoling-composition-fragment'
  version: 1
  sourceLayerItemId: string
  content: WebComposition<CourseRuntimeDefinition>
  assets: Record<string, { meta: CourseAssetMeta; path: string }>
  components: Record<string, { version: string; root: string }>
  connectOrigins?: string[]
}

const relativePath = z.string().min(1).refine(value => {
  const parts = value.replaceAll('\\', '/').split('/')
  return !/^(?:[a-zA-Z]:|[\\/])/.test(value) && parts.every(part => part !== '' && part !== '.' && part !== '..')
}, '片段依赖必须使用包内相对路径')

export const compositionFragmentSchema: z.ZodType<CompositionFragment> = z.object({
  format: z.literal('guoling-composition-fragment'), version: z.literal(1),
  sourceLayerItemId: z.string().trim().min(1), content: webCompositionSchema,
  assets: z.record(z.string(), z.object({ meta: courseProjectAssetMetaSchema, path: relativePath }).strict()),
  components: z.record(z.string(), z.object({ version: z.string().min(1), root: relativePath }).strict()),
  connectOrigins: z.array(z.string().url()).optional(),
}).strict()

function setPath(root: unknown, path: readonly (string | number)[], value: string): void {
  let target = root as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>
  target[path[path.length - 1]!] = value
}

/** Each instance owns its author identities; authored CSS/DOM IDs retain their original meaning. */
export function instantiateCompositionFragment(input: {
  fragment: CompositionFragment
  layerItemId: string
  assetIds: Readonly<Record<string, string>>
  idFactory(): string
  rebuildNative?(content: NativeElementContent): NativeElementContent
}): WebComposition<CourseRuntimeDefinition> {
  const content = structuredClone(input.fragment.content)
  const formulaIds = new Map<string, string>()
  const formulaId = (id: string) => {
    if (!formulaIds.has(id)) formulaIds.set(id, input.idFactory())
    return formulaIds.get(id)!
  }
  const text = (value: FlowTextContent | undefined) => value?.inlines.forEach((inline: FlowInline) => {
    if (inline.type === 'math') inline.formulaId = formulaId(inline.formulaId)
  })
  const blocks = (values: DocumentBlock[]) => values.forEach(block => {
    block.id = input.idFactory()
    if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote') {
      text(block.content); if (block.type === 'quote') text(block.citation)
    } else if (block.type === 'list') block.items.forEach(item => { item.id = input.idFactory(); text(item.content) })
    else if (block.type === 'formula') block.formulaId = formulaId(block.formulaId)
    else if (block.type === 'chart' && input.rebuildNative) {
      const chart = input.rebuildNative({ nativeType: 'chart', data: block.chart })
      if (chart.nativeType === 'chart') block.chart = chart.data
    }
    else if (block.type === 'media') text(block.caption)
    else if (block.type === 'callout') { text(block.title); text(block.body) }
    else if (block.type === 'section') { text(block.title); blocks(block.blocks) }
    else if (block.type === 'table') {
      const columns = new Map(block.columns.map(column => [column.id, input.idFactory()]))
      const rows = new Map(block.rows.map(row => [row.id, input.idFactory()]))
      block.columns.forEach(column => { column.id = columns.get(column.id)!; text(column.header) })
      block.rows.forEach(row => {
        row.id = rows.get(row.id)!
        row.cells = Object.fromEntries(Object.entries(row.cells).map(([id, cell]) => { text(cell); return [columns.get(id)!, cell] }))
      })
      block.merges?.forEach(merge => {
        merge.rowIds = merge.rowIds.map(id => rows.get(id) ?? id)
        merge.columnIds = merge.columnIds.map(id => columns.get(id) ?? id)
      })
      text(block.caption)
    }
  })
  walkComposition(content.root, node => {
    node.id = input.idFactory()
    if (node.kind === 'document') blocks(node.content.blocks)
    else if (node.kind === 'native') {
      if (input.rebuildNative) node.content = input.rebuildNative(node.content)
      if (node.content.nativeType === 'formula') node.content.data.formulaId = formulaId(node.content.data.formulaId)
    }
  })
  visitCompositionReferences(content, reference => {
    if (reference.kind === 'asset') {
      const id = input.assetIds[reference.id]
      if (!id) throw new Error(`结构片段缺少素材：${reference.id}`)
      setPath(content, reference.path, id)
    } else if (reference.kind === 'layer-item') {
      if (reference.id !== input.fragment.sourceLayerItemId) {
        throw new Error('片段依赖其它画布对象，请一并选择相关对象后再提取。')
      }
      setPath(content, reference.path, input.layerItemId)
    }
  })
  return content
}
