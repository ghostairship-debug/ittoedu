import { planDeleteFlowBlocks, planMoveFlowBlock, planInsertFlowBlock, planUpdateFlowBlock, planFlowCommittedText, validateFlowInsertIndex as validateIndex, flowBlocksAtParent as blocksAtParent } from '../../core/tools/flowContent'
import { updateBodySurfaceBackground } from '../../core/tools/courseBackground'
import { resolveFlowContextSelection, flowTextSlot } from '../../core/tools/flowTextSlot'
import { documentContentSchema, documentTextLength, normalizeDocumentText, plainDocumentText, type FlowTextContent } from '../../shared/document/content'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { TextRunStyle } from '../../shared/contracts/native-v1'
import {
  type BackgroundMode,
  type CourseProjectDocument,
  type FlowBlock,
  type FlowHeadingBlock,
  type FlowListBlock,
  type FlowParagraphBlock,
  type FlowQuoteBlock,
  type FlowRichText,
} from '../../shared/courseProjectTypes'
import { LAYER_REJECT_STALE_REVISION, rejectIfStaleDocument } from '../../core/tools/globalLayers'
import { deleteEffectiveLayerItems, makeEffectiveLayerAuthoringAddress } from '../../core/tools/layerCommands'
import { locateCourseLayer } from './effectiveLayerCommands'
import { commitCourseProjectMutation } from '../../core/tools/courseProjectMutation'
import {
  controllerTargetIdsForLocations,
  repairRemovedCourseReferences,
} from '../../core/tools/courseReferenceCleanup'
import {
  FLOW_GLOBAL_STRUCTURE_REASON,
  FLOW_LAST_HEADING_REASON,
  FLOW_LAST_LOCATION_REASON,
  deleteFlowRichTextRange,
  findFlowBlockRecursive,
  flowSurfaceIn,
  isRichTextFlowBlock,
  listFlowCourseAnchors,
  mergeFlowRichText,
  regenerateFlowIdentities,
  removeBlocksById,
  resolveFlowBlock,
  sliceFlowRichText,
  stableFlowId,
  syncFlowCourseLocations,
  walkFlowBlocks,
  wouldLeaveSurfaceWithoutAnchor,
} from '../../core/tools/flowDocumentModel'
import {
  classifyFlowDeleteIntent,
  clearFlowEditorSelection,
  flowBlockTargetFromSelection,
  type FlowEditorBlockTarget,
  type FlowEditorSelection,
} from './flowEditorSlice'

export type FlowEditorBlockInput = FlowBlock extends infer Block
  ? Block extends FlowBlock
    ? Omit<Block, 'id'> & { id?: string }
    : never
  : never

export interface FlowDeleteRequest {
  readonly selection: FlowEditorSelection
  readonly expectedRevision: number
  readonly direction?: 'backward' | 'forward'
  /** Toolbar delete promotes a text selection to the selected block set after freshness validation. */
  readonly deleteSelectedBlocks?: boolean
}

export interface FlowCommandOptions {
  readonly now?: string
  readonly expectedRevision?: number
}

export interface FlowCommandResult {
  readonly ok: boolean
  readonly reason?: string
  readonly nextDocument?: CourseProjectDocument
  readonly historyEntry?: boolean
  readonly selection?: FlowEditorSelection
  readonly clipboard?: readonly FlowBlock[]
  readonly createdBlockIds?: readonly string[]
}

export interface InsertFlowEditorBlockInput {
  readonly surfaceId: string
  readonly parentId: string | null
  readonly index: number
  readonly block: FlowEditorBlockInput
}

export interface MoveFlowEditorBlockDestination {
  readonly parentId: string | null
  readonly index: number
  readonly surfaceId?: string
}

export type FlowEditorCommandName =
  | 'insert'
  | 'split'
  | 'merge'
  | 'move'
  | 'delete'
  | 'indent'
  | 'outdent'
  | 'format'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'apply-text'

export type FlowBlockFormatSpec =
  | { kind: 'heading-level'; level: FlowHeadingBlock['level'] }
  | { kind: 'convert-heading'; level: FlowHeadingBlock['level'] }
  | { kind: 'convert-paragraph' }
  | { kind: 'convert-quote' }
  | { kind: 'list-ordered'; ordered: boolean }
  | { kind: 'text-style'; style: TextRunStyle; range?: 'all' | { start: number; end: number } }

export type FlowEditorCommandRequest =
  | { name: 'insert'; input: InsertFlowEditorBlockInput }
  | { name: 'split'; offset?: number }
  | { name: 'merge' }
  | { name: 'move'; destination: MoveFlowEditorBlockDestination }
  | { name: 'delete'; direction?: 'backward' | 'forward' }
  | { name: 'indent' }
  | { name: 'outdent' }
  | { name: 'format'; spec: FlowBlockFormatSpec }
  | { name: 'cut' }
  | { name: 'copy' }
  | { name: 'paste'; clipboard?: readonly FlowBlock[] }
  | { name: 'duplicate' }
  | { name: 'apply-text'; content: FlowTextContent }

function failCommand(reason: string): FlowCommandResult {
  return { ok: false, reason, historyEntry: false }
}

function succeedNoop(
  document: CourseProjectDocument,
  reason: string,
): FlowCommandResult {
  return { ok: true, reason, nextDocument: document, historyEntry: false }
}

function succeedMutation(
  nextDocument: CourseProjectDocument,
  reason: string,
  extra: Partial<FlowCommandResult> = {},
): FlowCommandResult {
  return {
    ok: true,
    reason,
    nextDocument,
    historyEntry: true,
    ...extra,
  }
}

function staleOrGlobal(
  document: CourseProjectDocument,
  options: FlowCommandOptions,
  selection?: FlowEditorSelection,
): FlowCommandResult | null {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return failCommand(stale.reason ?? LAYER_REJECT_STALE_REVISION)
  if (selection?.authoringScope === 'global') return failCommand(FLOW_GLOBAL_STRUCTURE_REASON)
  return null
}

function runMutation(
  document: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => string[] | void,
  reason: string,
  options: FlowCommandOptions,
): FlowCommandResult {
  try {
    let createdBlockIds: string[] = []
    const next = commitCourseProjectMutation(document, (draft) => {
      createdBlockIds = mutate(draft) ?? []
    }, options.now)
    return succeedMutation(next, reason, createdBlockIds.length > 0 ? { createdBlockIds } : {})
  } catch (error) {
    return failCommand(error instanceof Error && error.message.trim() ? error.message : reason.replace(/成功.*/, '失败'))
  }
}

function defaultInsertBlock(): FlowEditorBlockInput {
  return { type: 'paragraph', content: { inlines: [] } }
}

export function insertFlowEditorBlock(
  document: CourseProjectDocument,
  input: InsertFlowEditorBlockInput,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return planInsertFlowBlock(document, input, options)
}

export function updateFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  update: ((block: FlowBlock) => void) | object,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return planUpdateFlowBlock(document, target, update, options)
}

export function replaceFlowMediaBlockAsset(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  assetId: string,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const found = resolveFlowBlock(document, target)
    if (found.block.type !== 'media') {
      return failCommand('当前块不是媒体块')
    }
    const asset = document.assets[assetId]
    if (!asset) return failCommand('找不到素材')
    if (asset.kind !== found.block.mediaKind) {
      return failCommand('素材类型与当前块不符')
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法替换素材')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    if (found.block.type !== 'media') throw new Error('当前块不是媒体块')
    found.block.assetId = assetId
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已替换素材', options)
}

export function importAndReplaceFlowMediaBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  asset: AssetMeta,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const found = resolveFlowBlock(document, target)
    if (found.block.type !== 'media') {
      return failCommand('当前块不是媒体块')
    }
    if (asset.kind !== found.block.mediaKind) {
      return failCommand('素材类型与当前块不符')
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法替换素材')
  }
  return runMutation(document, (draft) => {
    draft.assets[asset.id] = structuredClone(asset)
    const found = resolveFlowBlock(draft, target)
    if (found.block.type !== 'media') throw new Error('当前块不是媒体块')
    found.block.assetId = asset.id
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已替换素材', options)
}

export function replaceFlowDocumentContent(
  document: CourseProjectDocument,
  surfaceId: string,
  blocks: FlowBlock[],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  const parsed = documentContentSchema.safeParse({ blocks })
  if (!parsed.success) return failCommand(parsed.error.issues[0]?.message ?? '正文无效')
  if (listFlowCourseAnchors(parsed.data.blocks).length === 0) return failCommand(FLOW_LAST_HEADING_REASON)
  const retained = new Set<string>()
  for (const block of listFlowCourseAnchors(parsed.data.blocks)) retained.add(block.id)
  const removed = document.locations.filter(location => location.kind === 'flow-block' && location.surfaceId === surfaceId && !retained.has(location.blockId))
  return runMutation(document, draft => {
    flowSurfaceIn(draft, surfaceId).blocks = structuredClone(parsed.data.blocks)
    syncFlowCourseLocations(draft, surfaceId)
    repairRemovedCourseReferences(draft, { removedLocationIds: new Set(removed.map(location => location.id)), removedControllerTargetIds: controllerTargetIdsForLocations(removed) })
  }, '已更新正文', options)
}

export function applyFlowCommittedText(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  nextContent: FlowTextContent,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return planFlowCommittedText(document, target, nextContent, options)
}

export function deleteFlowEditorBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowEditorBlockTarget[],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return planDeleteFlowBlocks(document, targets, options)
}

export function deleteFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return deleteFlowEditorBlocks(document, [target], options)
}

export function duplicateFlowEditorBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowEditorBlockTarget[],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  if (targets.length === 0) return failCommand('没有可重复的选择')
  try {
    for (const target of targets) resolveFlowBlock(document, target)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法重复 Flow 块')
  }
  return runMutation(document, (draft) => {
    const created: string[] = []
    const ordered = [...targets]
      .map((target) => ({
        target,
        location: findFlowBlockRecursive(flowSurfaceIn(draft, target.surfaceId).blocks, target.blockId),
      }))
      .sort((left, right) => (right.location?.index ?? 0) - (left.location?.index ?? 0))
    for (const item of ordered) {
      const found = item.location
      if (!found || (found.parentId ?? null) !== (item.target.parentId ?? null)) {
        throw new Error('所选 Flow 块位置已变化，请重新选择')
      }
      const duplicate = regenerateFlowIdentities(found.block)
      found.blocks.splice(found.index + 1, 0, duplicate)
      created.push(duplicate.id)
      syncFlowCourseLocations(draft, item.target.surfaceId)
    }
    return created
  }, '已重复当前选择', options)
}

export function duplicateFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return duplicateFlowEditorBlocks(document, [target], options)
}

export function reorderFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  toIndex: number,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return moveFlowEditorBlock(document, target, {
    parentId: target.parentId,
    index: toIndex,
    surfaceId: target.surfaceId,
  }, options)
}

export function moveFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  destination: MoveFlowEditorBlockDestination,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return planMoveFlowBlock(document, target, destination, options)
}

export function indentFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const source = resolveFlowBlock(document, target)
    if (source.index === 0) return failCommand('当前块不能再缩进')
    const previous = source.blocks[source.index - 1]
    if (!previous || previous.type !== 'section') return failCommand('当前块不能再缩进')
    return moveFlowEditorBlock(document, target, {
      parentId: previous.id,
      index: previous.blocks.length,
      surfaceId: target.surfaceId,
    }, options)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法缩进')
  }
}

export function outdentFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const source = resolveFlowBlock(document, target)
    if (source.parentId === null) return failCommand('当前块不能再取消缩进')
    const surface = flowSurfaceIn(document, target.surfaceId)
    const parent = findFlowBlockRecursive(surface.blocks, source.parentId)
    if (!parent) throw new Error(`找不到 Flow 分节：${source.parentId}`)
    return moveFlowEditorBlock(document, target, {
      parentId: parent.parentId,
      index: parent.index + 1,
      surfaceId: target.surfaceId,
    }, options)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法取消缩进')
  }
}

export function splitFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  offset: number,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const found = resolveFlowBlock(document, target)
    if (!isRichTextFlowBlock(found.block)) return failCommand('当前块不能从文字中间拆分')
    const length = documentTextLength(found.block.content)
    if (!Number.isInteger(offset) || offset < 0 || offset > length) {
      return failCommand('拆分位置无效')
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法拆分')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    if (!isRichTextFlowBlock(found.block)) throw new Error('当前块不能从文字中间拆分')
    const left = sliceFlowRichText(found.block.content, 0, offset)
    const right = sliceFlowRichText(found.block.content, offset, documentTextLength(found.block.content))
    found.block.content = left
    const nextParagraph: FlowParagraphBlock = {
      id: stableFlowId('block'),
      type: 'paragraph',
      content: right,
      ...(found.block.textAlign === undefined ? {} : { textAlign: found.block.textAlign }),
      ...(found.block.lineSpacing === undefined ? {} : { lineSpacing: found.block.lineSpacing }),
    }
    found.blocks.splice(found.index + 1, 0, nextParagraph)
    syncFlowCourseLocations(draft, target.surfaceId)
    return [nextParagraph.id]
  }, '已拆分段落', options)
}

export function mergeFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const found = resolveFlowBlock(document, target)
    if (!isRichTextFlowBlock(found.block)) return failCommand('当前块不能合并')
    if (found.index === 0) return failCommand('没有可合并的上一段')
    const previous = found.blocks[found.index - 1]
    if (!previous || !isRichTextFlowBlock(previous)) return failCommand('上一段不能与当前块合并')
    if (wouldLeaveSurfaceWithoutAnchor(flowSurfaceIn(document, target.surfaceId), new Set([found.block.id]))) return failCommand(FLOW_LAST_HEADING_REASON)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法合并')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    const previous = found.blocks[found.index - 1]
    if (!isRichTextFlowBlock(found.block) || !previous || !isRichTextFlowBlock(previous)) {
      throw new Error('当前块不能合并')
    }
    const removedLocations = draft.locations.filter(location => location.kind === 'flow-block' && location.surfaceId === target.surfaceId && location.blockId === found.block.id)
    const merged = mergeFlowRichText(previous.content, found.block.content)
    previous.content = merged
    found.blocks.splice(found.index, 1)
    syncFlowCourseLocations(draft, target.surfaceId)
    repairRemovedCourseReferences(draft, { removedLocationIds: new Set(removedLocations.map(location => location.id)), removedControllerTargetIds: controllerTargetIdsForLocations(removedLocations) })
  }, '已合并段落', options)
}

function applyStyleToRichText(
  content: FlowRichText,
  style: TextRunStyle,
  range: { start: number; end: number } | 'all',
): FlowRichText {
  const length = documentTextLength(content)
  const start = range === 'all' ? 0 : range.start
  const end = range === 'all' ? length : range.end
  const middle = sliceFlowRichText(content, start, end)
  for (const inline of middle.inlines) {
    inline.style = inline.type === 'text' ? { ...inline.style, ...style } : { ...inline.style, ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }), ...(style.color === undefined ? {} : { color: style.color }) }
  }
  return normalizeDocumentText({ inlines: [...sliceFlowRichText(content, 0, start).inlines, ...middle.inlines, ...sliceFlowRichText(content, end, length).inlines] })
}

export function formatFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  spec: FlowBlockFormatSpec,
  options: FlowCommandOptions & { textRange?: { start: number; end: number; listItemId?: string; tableRowId?: string; tableColumnId?: string } } = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  const textRange = spec.kind === 'text-style' ? spec.range ?? options.textRange : undefined
  if (textRange && textRange !== 'all' && textRange.end <= textRange.start) return succeedNoop(document, '没有选中的文字')
  try {
    resolveFlowBlock(document, target)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法设置格式')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    const block = found.block
    if (spec.kind === 'heading-level') {
      if (block.type !== 'heading') throw new Error('只有标题可以改级别')
      block.level = spec.level
    } else if (spec.kind === 'convert-heading') {
      if (block.type === 'heading') block.level = spec.level
      else if (block.type === 'paragraph' || block.type === 'quote') {
        const next: FlowHeadingBlock = {
          id: block.id,
          type: 'heading',
          level: spec.level,
          content: block.content,
          ...(block.textAlign === undefined ? {} : { textAlign: block.textAlign }),
          ...(block.lineSpacing === undefined ? {} : { lineSpacing: block.lineSpacing }),
        }
        found.blocks[found.index] = next
      } else {
        throw new Error('当前块不能转为标题')
      }
    } else if (spec.kind === 'convert-paragraph') {
      if (block.type === 'heading') {
        const remaining = listFlowCourseAnchors(
          removeBlocksById(flowSurfaceIn(draft, target.surfaceId).blocks, new Set([block.id])),
        )
        if (remaining.length === 0) throw new Error(FLOW_LAST_HEADING_REASON)
        const next: FlowParagraphBlock = {
          id: block.id,
          type: 'paragraph',
          content: block.content,
          ...(block.textAlign === undefined ? {} : { textAlign: block.textAlign }),
          ...(block.lineSpacing === undefined ? {} : { lineSpacing: block.lineSpacing }),
        }
        found.blocks[found.index] = next
      } else if (block.type === 'quote') {
        const next: FlowParagraphBlock = {
          id: block.id,
          type: 'paragraph',
          content: block.content,
          ...(block.textAlign === undefined ? {} : { textAlign: block.textAlign }),
          ...(block.lineSpacing === undefined ? {} : { lineSpacing: block.lineSpacing }),
        }
        found.blocks[found.index] = next
      } else if (block.type !== 'paragraph') {
        throw new Error('当前块不能转为段落')
      }
    } else if (spec.kind === 'convert-quote') {
      if (block.type === 'heading') {
        const remaining = listFlowCourseAnchors(
          removeBlocksById(flowSurfaceIn(draft, target.surfaceId).blocks, new Set([block.id])),
        )
        if (remaining.length === 0) throw new Error(FLOW_LAST_HEADING_REASON)
        const next: FlowQuoteBlock = {
          id: block.id,
          type: 'quote',
          content: block.content,
          ...(block.textAlign === undefined ? {} : { textAlign: block.textAlign }),
          ...(block.lineSpacing === undefined ? {} : { lineSpacing: block.lineSpacing }),
        }
        found.blocks[found.index] = next
      } else if (block.type === 'paragraph') {
        const next: FlowQuoteBlock = {
          id: block.id,
          type: 'quote',
          content: block.content,
          ...(block.textAlign === undefined ? {} : { textAlign: block.textAlign }),
          ...(block.lineSpacing === undefined ? {} : { lineSpacing: block.lineSpacing }),
        }
        found.blocks[found.index] = next
      } else if (block.type !== 'quote') {
        throw new Error('当前块不能转为引用')
      }
    } else if (spec.kind === 'list-ordered') {
      if (block.type !== 'list') throw new Error('只有列表可以改有序/无序')
      ;(block as FlowListBlock).ordered = spec.ordered
    } else if (spec.kind === 'text-style') {
      const range = spec.range ?? options.textRange ?? 'all'
      if (isRichTextFlowBlock(block)) {
        const next = applyStyleToRichText(block.content, spec.style, range)
        block.content = next
      } else if (block.type === 'list' && options.textRange?.listItemId) {
        const item = block.items.find(item => item.id === options.textRange!.listItemId)
        if (!item) throw new Error('列表项已失效')
        item.content = applyStyleToRichText(item.content, spec.style, range)
      } else if (block.type === 'table' && options.textRange?.tableRowId && options.textRange.tableColumnId) {
        const row = block.rows.find(row => row.id === options.textRange!.tableRowId)
        const content = row?.cells[options.textRange.tableColumnId]
        if (!content || !row) throw new Error('表格单元格已失效')
        row.cells[options.textRange.tableColumnId] = applyStyleToRichText(content, spec.style, range)
      } else {
        throw new Error('此类块不支持选区级文字格式')
      }
    }
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已更新格式', options)
}

function deleteFlowText(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  direction: 'backward' | 'forward',
  options: FlowCommandOptions,
): FlowCommandResult {
  if (selection.documentSelectionIssue) return failCommand(selection.documentSelectionIssue)
  if (selection.documentSelection) {
    try {
      const surface = flowSurfaceIn(document, selection.surfaceId)
      const exact = resolveFlowContextSelection(surface.blocks, document.revision, selection.documentSelection, { allowCaret: true })
      if (exact?.kind !== 'text') return failCommand('没有可删除的正文选区')
      const found = findFlowBlockRecursive(surface.blocks, exact.blockId)!
      const block = structuredClone(found.block), slot = flowTextSlot(block, exact.textRange.slot)
      let { start, end } = exact.textRange
      if (start === end) {
        if (direction === 'backward') start = Math.max(0, start - 1)
        else end = Math.min(documentTextLength(slot.get()), end + 1)
        if (start === end) return succeedNoop(document, '没有可删除的文字')
      }
      slot.set(deleteFlowRichTextRange(slot.get(), start, end))
      return updateFlowEditorBlock(document, { surfaceId: surface.id, blockId: block.id, parentId: found.parentId }, block, options)
    } catch (error) { return failCommand(error instanceof Error ? error.message : '正文选区已失效') }
  }
  if (!selection.selectedBlockId || !selection.textRange) {
    return failCommand('没有可删除的文字')
  }
  const target = flowBlockTargetFromSelection(document, selection)
  try {
    const found = resolveFlowBlock(document, target)
    if (!isRichTextFlowBlock(found.block)) return failCommand('当前块不能删除文字')
    const length = documentTextLength(found.block.content)
    let start = selection.textRange.start
    let end = selection.textRange.end
    if (start === end) {
      if (direction === 'backward') {
        if (start <= 0) return succeedNoop(document, '没有可删除的文字')
        start -= 1
      } else {
        if (end >= length) return succeedNoop(document, '没有可删除的文字')
        end += 1
      }
    }
    return runMutation(document, (draft) => {
      const draftFound = resolveFlowBlock(draft, target)
      if (!isRichTextFlowBlock(draftFound.block)) throw new Error('当前块不能删除文字')
      const next = deleteFlowRichTextRange(draftFound.block.content, start, end)
      draftFound.block.content = next
      syncFlowCourseLocations(draft, target.surfaceId)
    }, '已删除文字', options)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法删除文字')
  }
}

export function executeFlowDelete(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  options: FlowCommandOptions & { direction?: 'backward' | 'forward' } = {},
): FlowCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return failCommand(stale.reason ?? LAYER_REJECT_STALE_REVISION)
  const classified = classifyFlowDeleteIntent(selection)
  if (classified.intent === 'refuse') return failCommand(classified.reason ?? '没有可删除的选择')
  if (classified.intent === 'text-delete') {
    return deleteFlowText(document, selection, options.direction ?? 'backward', options)
  }
  if (classified.intent === 'overlay-delete') {
    if (selection.selectedOverlayIds.length === 0) return failCommand('没有可删除的浮层')
    const targets: Array<{ authoringAddress: string; locationId: string }> = []
    try {
      for (const overlayId of selection.selectedOverlayIds) {
        const located = locateCourseLayer(document, overlayId)
        if (
          !located
          || (located.source !== 'global' && located.source !== 'surface')
          || (located.source === 'surface' && located.surfaceId !== selection.surfaceId)
        ) {
          throw new Error(`找不到当前页面浮层：${overlayId}`)
        }
        targets.push({
          authoringAddress: makeEffectiveLayerAuthoringAddress(document.id, located),
          locationId: selection.locationId,
        })
      }
    } catch (error) {
      return failCommand(error instanceof Error ? error.message : '无法解析所选浮层')
    }
    const overlay = deleteEffectiveLayerItems(document, targets, options)
    if (!overlay.ok) return failCommand(overlay.reason ?? '无法删除浮层')
    const nextDocument = overlay.nextDocument ?? document
    return {
      ok: true,
      reason: overlay.reason,
      nextDocument,
      historyEntry: overlay.historyEntry,
      selection: clearFlowSelectionAfterDelete(nextDocument, selection),
    }
  }
  const targets = selection.selectedBlockIds.map((blockId) =>
    flowBlockTargetFromSelection(document, selection, blockId),
  )
  const deleted = deleteFlowEditorBlocks(document, targets, options)
  if (!deleted.ok || !deleted.nextDocument) return deleted
  return {
    ...deleted,
    selection: clearFlowSelectionAfterDelete(deleted.nextDocument, selection),
  }
}

function clearFlowSelectionAfterDelete(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
): FlowEditorSelection {
  const locationId = document.locations.some((location) => location.id === selection.locationId)
    ? selection.locationId
    : document.locations.find((location) => (
      location.kind === 'flow-block' && location.surfaceId === selection.surfaceId
    ))?.id ?? document.locations.find((location) => location.kind === 'flow-block')?.id
  if (!locationId) throw new Error('删除后找不到可继续编辑的 Flow 位置')
  return clearFlowEditorSelection(document, locationId, selection.authoringScope)
}

export function copyFlowEditorBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowEditorBlockTarget[],
): FlowCommandResult {
  if (targets.length === 0) return failCommand('没有可复制的选择')
  try {
    const clipboard = targets.map((target) => structuredClone(resolveFlowBlock(document, target).block))
    return {
      ok: true,
      reason: '已复制当前选择',
      nextDocument: document,
      historyEntry: false,
      clipboard,
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法复制')
  }
}

export function pasteFlowEditorBlocks(
  document: CourseProjectDocument,
  input: {
    readonly surfaceId: string
    readonly parentId: string | null
    readonly index: number
    readonly blocks: readonly FlowBlock[]
  },
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  if (input.blocks.length === 0) return failCommand('剪贴板为空，无法粘贴')
  return runMutation(document, (draft) => {
    const draftSurface = flowSurfaceIn(draft, input.surfaceId)
    const targetBlocks = blocksAtParent(draftSurface.blocks, input.parentId)
    const clones = input.blocks.map(regenerateFlowIdentities)
    const insertAt = Math.max(0, Math.min(input.index, targetBlocks.length))
    targetBlocks.splice(insertAt, 0, ...clones)
    syncFlowCourseLocations(draft, input.surfaceId)
    return clones.map((block) => block.id)
  }, `已粘贴 ${input.blocks.length} 项`, options)
}

export function cutFlowEditorBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowEditorBlockTarget[],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const copied = copyFlowEditorBlocks(document, targets)
  if (!copied.ok) return copied
  const deleted = deleteFlowEditorBlocks(document, targets, options)
  if (!deleted.ok) return deleted
  return { ...deleted, clipboard: copied.clipboard, reason: '已剪切当前选择' }
}

export function executeFlowEditorCommand(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  command: FlowEditorCommandRequest,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  if (selection.documentSelectionIssue) return failCommand(selection.documentSelectionIssue)
  // SharedDocumentEditor owns clipboard/text transforms. A logical range must
  // never fall through to these legacy whole-block operations.
  if (selection.documentSelection && selection.documentSelection.kind !== 'object'
    && ['copy', 'cut', 'split', 'merge', 'move', 'indent', 'outdent'].includes(command.name)) return failCommand('请在正文编辑器中操作所选文字，不扩大到整块。')
  if (selection.documentSelection && selection.documentSelection.kind !== 'object' && command.name === 'format' && command.spec.kind === 'text-style') {
    try {
      const surface = flowSurfaceIn(document, selection.surfaceId)
      const exact = resolveFlowContextSelection(surface.blocks, document.revision, selection.documentSelection, { allowCaret: true })
      if (exact?.kind !== 'text') return failCommand('没有可设置格式的正文选区')
      const found = findFlowBlockRecursive(surface.blocks, exact.blockId)!
      const block = structuredClone(found.block), slot = flowTextSlot(block, exact.textRange.slot)
      slot.set(applyStyleToRichText(slot.get(), command.spec.style, exact.textRange))
      return updateFlowEditorBlock(document, { surfaceId: surface.id, blockId: block.id, parentId: found.parentId }, block, options)
    } catch (error) { return failCommand(error instanceof Error ? error.message : '正文选区已失效') }
  }
  if (command.name === 'copy') {
    if (selection.authoringScope === 'global' && selection.focus !== 'overlay') {
      return failCommand(FLOW_GLOBAL_STRUCTURE_REASON)
    }
    if (selection.focus === 'overlay') return failCommand('浮层复制请走图层命令')
    const targets = selection.selectedBlockIds.map((blockId) =>
      flowBlockTargetFromSelection(document, selection, blockId),
    )
    return copyFlowEditorBlocks(document, targets)
  }
  if (command.name === 'delete') {
    return executeFlowDelete(document, selection, {
      ...options,
      direction: command.direction,
    })
  }
  const blocked = staleOrGlobal(document, options, selection)
  if (blocked) return blocked
  if (!selection.selectedBlockId && command.name !== 'insert' && command.name !== 'paste') {
    return failCommand('没有可操作的 Flow 块')
  }
  const primary = selection.selectedBlockId
    ? flowBlockTargetFromSelection(document, selection)
    : null
  switch (command.name) {
    case 'insert':
      return insertFlowEditorBlock(document, command.input, options)
    case 'split': {
      if (!primary || !selection.textRange) return failCommand('请先进入文字编辑再拆分')
      return splitFlowEditorBlock(document, primary, command.offset ?? selection.textRange.start, options)
    }
    case 'merge':
      if (!primary) return failCommand('没有可合并的 Flow 块')
      return mergeFlowEditorBlock(document, primary, options)
    case 'move':
      if (!primary) return failCommand('没有可移动的 Flow 块')
      return moveFlowEditorBlock(document, primary, command.destination, options)
    case 'indent':
      if (!primary) return failCommand('没有可缩进的 Flow 块')
      return indentFlowEditorBlock(document, primary, options)
    case 'outdent':
      if (!primary) return failCommand('没有可取消缩进的 Flow 块')
      return outdentFlowEditorBlock(document, primary, options)
    case 'format':
      if (!primary) return failCommand('没有可设置格式的 Flow 块')
      return formatFlowEditorBlock(document, primary, command.spec, {
        ...options,
        textRange: selection.textRange
          ? { ...selection.textRange }
          : undefined,
      })
    case 'cut': {
      if (!primary) return failCommand('没有可剪切的选择')
      const targets = selection.selectedBlockIds.map((blockId) =>
        flowBlockTargetFromSelection(document, selection, blockId),
      )
      return cutFlowEditorBlocks(document, targets, options)
    }
    case 'paste': {
      const clipboard = command.clipboard
      if (!clipboard || clipboard.length === 0) return failCommand('剪贴板为空，无法粘贴')
      if (primary) {
        const found = resolveFlowBlock(document, primary)
        return pasteFlowEditorBlocks(document, {
          surfaceId: primary.surfaceId,
          parentId: primary.parentId,
          index: found.index + 1,
          blocks: clipboard,
        }, options)
      }
      const surface = flowSurfaceIn(document, selection.surfaceId)
      return pasteFlowEditorBlocks(document, {
        surfaceId: selection.surfaceId,
        parentId: null,
        index: surface.blocks.length,
        blocks: clipboard,
      }, options)
    }
    case 'duplicate': {
      if (!primary) return failCommand('没有可重复的选择')
      const targets = selection.selectedBlockIds.map((blockId) =>
        flowBlockTargetFromSelection(document, selection, blockId),
      )
      return duplicateFlowEditorBlocks(document, targets, options)
    }
    case 'apply-text':
      if (!primary) return failCommand('没有可写入的 Flow 块')
      return applyFlowCommittedText(document, primary, command.content, options)
    default:
      return failCommand('Flow 不支持该动作')
  }
}

export interface FlowSurfaceBackgroundPatch {
  readonly backgroundMode?: BackgroundMode
  readonly backgroundColor?: string
  readonly backgroundAssetId?: string | null
}

/**
 * Typed, validated write for a Flow surface's background mode/color/asset.
 * One commit per call; a stale revision, an invalid mode/color, or a patch
 * that changes nothing writes zero history entries. Switching only
 * `backgroundMode` (an isolated single-field patch) never touches the
 * dormant `backgroundColor`/`backgroundAssetId` fields.
 */
export function updateFlowSurfaceBackground(
  document: CourseProjectDocument,
  surfaceId: string,
  patch: FlowSurfaceBackgroundPatch,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const planned = updateBodySurfaceBackground(document, surfaceId, 'flow', patch, options)
  return planned.ok ? { ok: true, nextDocument: planned.project, historyEntry: planned.historyEntry,
    reason: planned.historyEntry ? '已修改稿纸背景' : '背景未变' } : failCommand(planned.reason)
}

export function updateFlowWidthMode(
  document: CourseProjectDocument,
  surfaceId: string,
  widthMode: 'fluid' | 'reading',
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return failCommand(stale.reason ?? LAYER_REJECT_STALE_REVISION)
  if (widthMode !== 'fluid' && widthMode !== 'reading') return failCommand('不支持的 Flow 宽度模式')
  const surface = flowSurfaceIn(document, surfaceId)
  if ((surface.layout.widthMode ?? 'reading') === widthMode) return succeedNoop(document, '版式未变化')
  return runMutation(document, draft => {
    flowSurfaceIn(draft, surfaceId).layout.widthMode = widthMode
  }, '已修改讲义宽度模式', options)
}

export function updateFlowSurfaceBackgroundColor(
  document: CourseProjectDocument,
  surfaceId: string,
  backgroundColor: string,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return updateFlowSurfaceBackground(document, surfaceId, { backgroundColor }, options)
}

/** Imports a new image asset and assigns it as the Flow surface's background, in one commit. */
export function importFlowSurfaceBackgroundAsset(
  document: CourseProjectDocument,
  surfaceId: string,
  assetMeta: AssetMeta,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return failCommand(stale.reason ?? LAYER_REJECT_STALE_REVISION)
  try {
    flowSurfaceIn(document, surfaceId)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法更新 Flow 页面背景')
  }
  return runMutation(document, (draft) => {
    const target = flowSurfaceIn(draft, surfaceId)
    draft.assets[assetMeta.id] = assetMeta
    target.backgroundAssetId = assetMeta.id
  }, '已上传背景图片', options)
}

export {
  BLANK_FLOW_HEADING_PLACEHOLDER,
  FLOW_GLOBAL_STRUCTURE_REASON,
  FLOW_LAST_HEADING_REASON,
  FLOW_LAST_LOCATION_REASON,
  createBlankFlowPageBlocks,
  createBlankFlowSurface,
  makeFlowBlockAuthoringAddress,
} from '../../core/tools/flowDocumentModel'
