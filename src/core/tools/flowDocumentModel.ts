import { rebuildChartItemIds } from './chartIdentity'
import { nanoid } from 'nanoid'
import { makeAuthoringAddress } from '../../shared/authoringAddress'
import { DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR } from '../../shared/courseProjectModel'
import { plainDocumentText, normalizeDocumentText, documentTextLength, documentTextSlots } from '../../shared/document/content'
import type {
  CourseLocation,
  CourseProjectDocument,
  FlowBlock,
  FlowHeadingBlock,
  FlowParagraphBlock,
  FlowRichText,
  FlowSurfaceDocument,
} from '../../shared/courseProjectTypes'

export const BLANK_FLOW_HEADING_PLACEHOLDER = '无标题'
export const DEFAULT_FLOW_LAYOUT = {
  widthMode: 'fluid',
  readingWidth: 760,
  wideContentWidth: 1120,
} as const
export const FLOW_GLOBAL_STRUCTURE_REASON = '全局层选择不能改动 Flow 页面目录'
export const FLOW_LAST_LOCATION_REASON = '课程至少需要一个位置'
export const FLOW_LAST_HEADING_REASON = '本页至少需要一个可导航标题'

export type FlowCourseAnchorBlock = Extract<FlowBlock, { type: 'heading' | 'section' }>

export interface FlowBlockLocation {
  blocks: FlowBlock[]
  index: number
  block: FlowBlock
  parentId: string | null
}

export function stableFlowId(prefix: string, preferred?: string): string {
  if (preferred !== undefined) {
    if (typeof preferred !== 'string' || preferred.trim() === '') {
      throw new Error('Flow 块 ID 不能为空')
    }
    return preferred
  }
  return `${prefix}-${nanoid(10)}`
}

export function createBlankFlowPageBlocks(ids?: {
  headingId?: string
  paragraphId?: string
}): [FlowHeadingBlock, FlowParagraphBlock] {
  return [
    {
      id: stableFlowId('block', ids?.headingId),
      type: 'heading',
      level: 1,
      content: { inlines: [{ type: 'text', text: BLANK_FLOW_HEADING_PLACEHOLDER }] },
    },
    {
      id: stableFlowId('block', ids?.paragraphId),
      type: 'paragraph',
      content: { inlines: [] },
    },
  ]
}

export function createBlankFlowSurface(input: {
  id: string
  title: string
  headingId?: string
  paragraphId?: string
}): {
  surface: FlowSurfaceDocument
  location: Extract<CourseLocation, { kind: 'flow-block' }>
} {
  const [heading, paragraph] = createBlankFlowPageBlocks({
    headingId: input.headingId,
    paragraphId: input.paragraphId,
  })
  return {
    surface: {
      id: input.id,
      type: 'flow',
      title: input.title,
      backgroundColor: DEFAULT_COURSE_SURFACE_BACKGROUND_COLOR,
      surfaceLayerItems: [],
      layout: { ...DEFAULT_FLOW_LAYOUT },
      blocks: [heading, paragraph],
    },
    location: {
      id: heading.id,
      label: plainDocumentText(heading.content),
      kind: 'flow-block',
      surfaceId: input.id,
      blockId: heading.id,
    },
  }
}

export function flowSurfaceIn(
  project: CourseProjectDocument,
  surfaceId: string,
): FlowSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'flow') {
    throw new Error(`找不到 Flow 表面：${surfaceId}`)
  }
  return surface
}

export function findFlowBlockRecursive(
  blocks: FlowBlock[],
  blockId: string,
  parentId: string | null = null,
): FlowBlockLocation | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    if (block.id === blockId) return { blocks, index, block, parentId }
    if (block.type === 'section') {
      const nested = findFlowBlockRecursive(block.blocks, blockId, block.id)
      if (nested) return nested
    }
  }
  return null
}

export function walkFlowBlocks(
  blocks: readonly FlowBlock[],
  visit: (block: FlowBlock, parentId: string | null, index: number, depth: number) => void,
  parentId: string | null = null,
  depth = 0,
): void {
  blocks.forEach((block, index) => {
    visit(block, parentId, index, depth)
    if (block.type === 'section') walkFlowBlocks(block.blocks, visit, block.id, depth + 1)
  })
}

export function collectFlowBlockIds(block: FlowBlock): string[] {
  return [block.id, ...(block.type === 'section' ? block.blocks.flatMap(collectFlowBlockIds) : [])]
}

export function isFlowCourseAnchor(block: FlowBlock): block is FlowCourseAnchorBlock {
  return block.type === 'heading' || block.type === 'section'
}

export function isFlowCourseBlockLocation(
  location: CourseLocation,
): location is Extract<CourseLocation, { kind: 'flow-block' }> {
  return location.kind === 'flow-block'
}

export function flowBlockLabel(block: FlowBlock): string {
  if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') {
    return plainDocumentText(block.content).trim() || (block.type === 'heading' ? BLANK_FLOW_HEADING_PLACEHOLDER : block.type)
  }
  if (block.type === 'callout') return (block.title ? plainDocumentText(block.title).trim() : undefined) || plainDocumentText(block.body).trim().slice(0, 48) || '提示'
  if (block.type === 'section') return plainDocumentText(block.title).trim() || '分节'
  if (block.type === 'media') return (block.caption ? plainDocumentText(block.caption).trim() : undefined) || block.altText?.trim() || '媒体'
  if (block.type === 'code') return block.language ? `代码·${block.language}` : '代码'
  if (block.type === 'formula') return block.accessibleText.trim() || '公式'
  if (block.type === 'component') return `组件·${block.component.packageId}`
  if (block.type === 'list') return (block.items[0] ? plainDocumentText(block.items[0].content).trim().slice(0, 48) : '') || '列表'
  if (block.type === 'chart') return block.chart.title?.trim() || '图表'
  if (block.type === 'table') return (block.caption ? plainDocumentText(block.caption).trim() : undefined) || '表格'
  return '分隔线'
}

export function flowCourseAnchorLabel(block: FlowCourseAnchorBlock): string {
  if (block.type === 'heading') return plainDocumentText(block.content).trim() || BLANK_FLOW_HEADING_PLACEHOLDER
  return plainDocumentText(block.title).trim() || '分节'
}

export function makeFlowBlockAuthoringAddress(input: {
  projectId: string
  surfaceId: string
  blockId: string
  field?: string
  carrier?: 'native' | 'component'
}): string {
  return makeAuthoringAddress({
    projectId: input.projectId,
    scope: 'surface',
    surfaceId: input.surfaceId,
    carrier: input.carrier ?? 'native',
    layerItemId: input.blockId,
    field: input.field ?? 'block',
  })
}

export function carrierForFlowBlock(block: FlowBlock): 'native' | 'component' {
  return block.type === 'component' ? 'component' : 'native'
}

export function listFlowCourseAnchors(blocks: readonly FlowBlock[]): FlowCourseAnchorBlock[] {
  const anchors: FlowCourseAnchorBlock[] = []
  walkFlowBlocks(blocks, (block) => {
    if (isFlowCourseAnchor(block)) anchors.push(block)
  })
  return anchors
}

export function syncFlowCourseLocations(
  project: CourseProjectDocument,
  surfaceId: string,
): void {
  const surface = flowSurfaceIn(project, surfaceId)
  const anchors = listFlowCourseAnchors(surface.blocks)
  const existing = new Map<string, Extract<CourseLocation, { kind: 'flow-block' }>>()
  for (const location of project.locations) {
    if (isFlowCourseBlockLocation(location) && location.surfaceId === surfaceId) {
      existing.set(location.blockId, location)
    }
  }
  const usedLocationIds = new Set(
    project.locations
      .filter((location) => !(location.kind === 'flow-block' && location.surfaceId === surfaceId))
      .map((location) => location.id),
  )
  const nextSurfaceLocations: Extract<CourseLocation, { kind: 'flow-block' }>[] = anchors.map((block) => {
    const previous = existing.get(block.id)
    const label = flowCourseAnchorLabel(block)
    if (previous) {
      usedLocationIds.add(previous.id)
      return { ...previous, label, blockId: block.id, surfaceId }
    }
    let id = block.id
    if (usedLocationIds.has(id)) id = stableFlowId('location')
    usedLocationIds.add(id)
    return {
      id,
      label,
      kind: 'flow-block',
      surfaceId,
      blockId: block.id,
    }
  })

  const insertAt = project.locations.findIndex(
    (location) => location.kind === 'flow-block' && location.surfaceId === surfaceId,
  )
  const others = project.locations.filter(
    (location) => !(location.kind === 'flow-block' && location.surfaceId === surfaceId),
  )
  if (insertAt < 0) {
    project.locations = [...others, ...nextSurfaceLocations]
  } else {
    const before = project.locations.slice(0, insertAt).filter(
      (location) => !(location.kind === 'flow-block' && location.surfaceId === surfaceId),
    )
    const after = project.locations.slice(insertAt).filter(
      (location) => !(location.kind === 'flow-block' && location.surfaceId === surfaceId),
    )
    project.locations = [...before, ...nextSurfaceLocations, ...after]
  }

  if (project.locations.length === 0) throw new Error(FLOW_LAST_LOCATION_REASON)
  if (!project.locations.some((location) => location.id === project.startLocationId)) {
    const sameSurface = nextSurfaceLocations[0]
    project.startLocationId = sameSurface?.id ?? project.locations[0]!.id
  }
}

export function assertUniqueBlockId(surface: FlowSurfaceDocument, blockId: string): void {
  let count = 0
  walkFlowBlocks(surface.blocks, (block) => {
    if (block.id === blockId) count += 1
  })
  if (count === 0) throw new Error(`找不到 Flow 块：${blockId}`)
  if (count > 1) throw new Error(`Flow 块 ID 重复：${blockId}`)
}

export function resolveFlowBlock(
  project: CourseProjectDocument,
  target: { surfaceId: string; blockId: string; parentId: string | null },
): FlowBlockLocation {
  if (typeof target.surfaceId !== 'string' || target.surfaceId.trim() === '') {
    throw new Error('Flow 表面不能为空')
  }
  if (typeof target.blockId !== 'string' || target.blockId.trim() === '') {
    throw new Error('所选 Flow 块不能为空')
  }
  const surface = flowSurfaceIn(project, target.surfaceId)
  assertUniqueBlockId(surface, target.blockId)
  const found = findFlowBlockRecursive(surface.blocks, target.blockId)
  if (!found) throw new Error(`找不到 Flow 块：${target.blockId}`)
  if ((found.parentId ?? null) !== (target.parentId ?? null)) {
    throw new Error('所选 Flow 块位置已变化，请重新选择')
  }
  return found
}

export function isRichTextFlowBlock(
  block: FlowBlock,
): block is Extract<FlowBlock, { type: 'heading' | 'paragraph' | 'quote' }> {
  return block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote'
}

export function sliceFlowRichText(
  content: FlowRichText,
  start: number,
  end: number,
): FlowRichText {
  const from = Math.max(0, Math.min(documentTextLength(content), start))
  const to = Math.max(from, Math.min(documentTextLength(content), end))
  let cursor = 0
  return normalizeDocumentText({ inlines: content.inlines.flatMap(inline => {
    const size = inline.type === 'math' ? 1 : Array.from(inline.text).length
    const left = Math.max(0, from - cursor), right = Math.min(size, to - cursor)
    cursor += size
    if (right <= left) return []
    return [inline.type === 'math' ? structuredClone(inline) : { ...structuredClone(inline), text: Array.from(inline.text).slice(left, right).join('') }]
  }) })
}

export function mergeFlowRichText(left: FlowRichText, right: FlowRichText): FlowRichText {
  return normalizeDocumentText({ inlines: [...left.inlines, ...right.inlines] })
}

export function deleteFlowRichTextRange(content: FlowRichText, start: number, end: number): FlowRichText {
  return mergeFlowRichText(sliceFlowRichText(content, 0, start), sliceFlowRichText(content, end, documentTextLength(content)))
}

export function regenerateFlowIdentities(block: FlowBlock): FlowBlock {
  const next = structuredClone(block)
  next.id = stableFlowId('block')
  if (next.type === 'list') {
    next.items = next.items.map((item) => ({ ...item, id: stableFlowId('list-item') }))
  } else if (next.type === 'table') {
    const previousRows = next.rows.map(row => row.id)
    const previousColumns = block.type === 'table' ? block.columns : []
    next.columns = next.columns.map((column) => ({ ...column, id: stableFlowId('column') }))
    next.rows = next.rows.map((row) => ({
      ...row,
      id: stableFlowId('row'),
      cells: Object.fromEntries(
        next.columns.map((column, index) => {
          const previousId = previousColumns[index]?.id
          return [column.id, previousId ? row.cells[previousId] ?? { inlines: [] } : { inlines: [] }]
        }),
      ),
    }))
    if (next.merges) next.merges = next.merges.map(region => ({
      rowIds: region.rowIds.map(id => next.rows[previousRows.indexOf(id)]!.id),
      columnIds: region.columnIds.map(id => next.columns[previousColumns.findIndex(column => column.id === id)]!.id),
    }))
  } else if (next.type === 'chart') {
    next.chart = rebuildChartItemIds(next.chart)
  } else if (next.type === 'formula') {
    next.formulaId = stableFlowId('formula')
  } else if (next.type === 'section') {
    next.blocks = next.blocks.map(regenerateFlowIdentities)
  }
  for (const slot of documentTextSlots(next)) for (const inline of slot.content.inlines) if (inline.type === 'math') inline.formulaId = stableFlowId('formula')
  return next
}

export function removeBlocksById(blocks: FlowBlock[], deletedIds: ReadonlySet<string>): FlowBlock[] {
  return blocks.flatMap((block): FlowBlock[] => {
    if (deletedIds.has(block.id)) return []
    if (block.type !== 'section') return [block]
    return [{ ...block, blocks: removeBlocksById(block.blocks, deletedIds) }]
  })
}

export function wouldLeaveSurfaceWithoutAnchor(
  surface: FlowSurfaceDocument,
  deletedIds: ReadonlySet<string>,
): boolean {
  const remaining = removeBlocksById(surface.blocks, deletedIds)
  return listFlowCourseAnchors(remaining).length === 0
}
