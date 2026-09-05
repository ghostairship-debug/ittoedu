import { applyTextRunStyle, remapTextRuns } from '../../shared/textRuns'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { TextRunStyle } from '../../shared/contracts/native-v1'
import {
  BACKGROUND_MODES,
  type BackgroundMode,
  type CourseProjectDocument,
  type FlowBlock,
  type FlowHeadingBlock,
  type FlowListBlock,
  type FlowParagraphBlock,
  type FlowQuoteBlock,
  type FlowRichText,
} from '../../shared/courseProjectTypes'
import {
  LAYER_REJECT_STALE_REVISION,
  rejectIfStaleDocument,
} from './globalLayerCommands'
import {
  deleteEffectiveLayerItems,
  locateCourseLayer,
  makeEffectiveLayerAuthoringAddress,
} from './effectiveLayerCommands'
import { commitCourseProjectMutation } from './courseProjectMutation'
import {
  controllerTargetIdsForLocations,
  repairRemovedCourseReferences,
} from './courseReferenceCleanup'
import {
  FLOW_GLOBAL_STRUCTURE_REASON,
  FLOW_LAST_HEADING_REASON,
  FLOW_LAST_LOCATION_REASON,
  collectFlowBlockIds,
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
} from './flowDocumentModel'
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
  | { name: 'apply-text'; text: string; runs?: FlowRichText['runs'] }

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

function validateIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error('插入位置无效')
  }
}

function blocksAtParent(surfaceBlocks: FlowBlock[], parentId: string | null): FlowBlock[] {
  if (parentId === null) return surfaceBlocks
  const section = findFlowBlockRecursive(surfaceBlocks, parentId)
  if (!section || section.block.type !== 'section') {
    throw new Error(`找不到 Flow 分节：${parentId}`)
  }
  return section.block.blocks
}

function defaultInsertBlock(): FlowEditorBlockInput {
  return { type: 'paragraph', text: '' }
}

export function insertFlowEditorBlock(
  document: CourseProjectDocument,
  input: InsertFlowEditorBlockInput,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  const nextBlock = { ...input.block, id: stableFlowId('block', input.block.id) } as FlowBlock
  try {
    const surface = flowSurfaceIn(document, input.surfaceId)
    walkFlowBlocks(surface.blocks, (block) => {
      if (block.id === nextBlock.id) throw new Error(`Flow 块 ID 已存在：${nextBlock.id}`)
    })
    validateIndex(input.index, blocksAtParent(surface.blocks, input.parentId).length)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法插入 Flow 块')
  }
  return runMutation(document, (draft) => {
    const draftSurface = flowSurfaceIn(draft, input.surfaceId)
    const targetBlocks = blocksAtParent(draftSurface.blocks, input.parentId)
    targetBlocks.splice(input.index, 0, nextBlock)
    syncFlowCourseLocations(draft, input.surfaceId)
    return [nextBlock.id]
  }, '已插入内容块', options)
}

export function updateFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  update: ((block: FlowBlock) => void) | object,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    resolveFlowBlock(document, target)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法更新 Flow 块')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    if (typeof update === 'function') update(found.block)
    else {
      const patch = structuredClone(update) as Record<string, unknown>
      delete patch.id
      Object.assign(found.block, patch)
    }
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已更新内容块', options)
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

export function applyFlowCommittedText(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  nextText: string,
  options: FlowCommandOptions & { runs?: FlowRichText['runs'] } = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  try {
    const found = resolveFlowBlock(document, target)
    if (!isRichTextFlowBlock(found.block) && found.block.type !== 'callout' && found.block.type !== 'code') {
      return failCommand('当前块不能写入正文')
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法写入正文')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    if (found.block.type === 'callout') {
      found.block.body = nextText
      return
    }
    if (found.block.type === 'code') {
      found.block.code = nextText
      return
    }
    if (!isRichTextFlowBlock(found.block)) throw new Error('当前块不能写入正文')
    const previous = found.block.text
    found.block.text = nextText
    if (options.runs) found.block.runs = options.runs
    else if (found.block.runs) {
      const remapped = remapTextRuns(previous, nextText, found.block.runs)
      if (remapped.length > 0) found.block.runs = remapped
      else delete found.block.runs
    }
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已更新文字', options)
}

export function deleteFlowEditorBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowEditorBlockTarget[],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  if (targets.length === 0) return failCommand('没有可删除的选择')
  const deletedIdsBySurface = new Map<string, Set<string>>()
  try {
    for (const target of targets) {
      const source = resolveFlowBlock(document, target)
      const deletedIds = deletedIdsBySurface.get(target.surfaceId) ?? new Set<string>()
      collectFlowBlockIds(source.block).forEach((id) => deletedIds.add(id))
      deletedIdsBySurface.set(target.surfaceId, deletedIds)
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法删除 Flow 块')
  }
  const removedFlowLocations = document.locations.filter((location) => (
    location.kind === 'flow-block'
    && deletedIdsBySurface.get(location.surfaceId)?.has(location.blockId)
  ))
  const removedLocationIds = new Set(removedFlowLocations.map((location) => location.id))
  const removedControllerTargetIds = controllerTargetIdsForLocations(removedFlowLocations)
  if (
    document.locations.length > 0 &&
    document.locations.every((location) => removedLocationIds.has(location.id))
  ) {
    return failCommand(FLOW_LAST_LOCATION_REASON)
  }
  const bySurface = new Map<string, FlowEditorBlockTarget[]>()
  for (const target of targets) {
    const list = bySurface.get(target.surfaceId) ?? []
    list.push(target)
    bySurface.set(target.surfaceId, list)
  }
  for (const [surfaceId] of bySurface) {
    const surface = flowSurfaceIn(document, surfaceId)
    if (wouldLeaveSurfaceWithoutAnchor(surface, deletedIdsBySurface.get(surfaceId)!)) {
      return failCommand(FLOW_LAST_HEADING_REASON)
    }
  }
  return runMutation(document, (draft) => {
    for (const [surfaceId, surfaceTargets] of bySurface) {
      const draftSurface = flowSurfaceIn(draft, surfaceId)
      const ids = new Set<string>()
      for (const target of surfaceTargets) {
        const found = findFlowBlockRecursive(draftSurface.blocks, target.blockId)
        if (!found || (found.parentId ?? null) !== (target.parentId ?? null)) {
          throw new Error('所选 Flow 块位置已变化，请重新选择')
        }
        collectFlowBlockIds(found.block).forEach((id) => ids.add(id))
      }
      draftSurface.blocks = removeBlocksById(draftSurface.blocks, ids)
      syncFlowCourseLocations(draft, surfaceId)
    }
    if (draft.locations.length === 0) throw new Error(FLOW_LAST_LOCATION_REASON)
    repairRemovedCourseReferences(draft, {
      removedLocationIds,
      removedControllerTargetIds,
    })
  }, '已删除当前选择', options)
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
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  if (destination.surfaceId !== undefined && destination.surfaceId !== target.surfaceId) {
    return failCommand('暂不支持跨表面移动 Flow 块')
  }
  if (!Number.isInteger(destination.index) || destination.index < 0) {
    return failCommand('移动位置无效')
  }
  try {
    const source = resolveFlowBlock(document, target)
    const surface = flowSurfaceIn(document, target.surfaceId)
    if (destination.parentId !== null) {
      const destinationSection = findFlowBlockRecursive(surface.blocks, destination.parentId)
      if (!destinationSection || destinationSection.block.type !== 'section') {
        throw new Error(`找不到 Flow 分节：${destination.parentId}`)
      }
      if (source.block.type === 'section') {
        let cursor: string | null = destination.parentId
        while (cursor !== null) {
          if (cursor === source.block.id) throw new Error('不能将分节移动到自身内部')
          cursor = findFlowBlockRecursive(surface.blocks, cursor)?.parentId ?? null
        }
      }
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法移动 Flow 块')
  }
  return runMutation(document, (draft) => {
    const draftSurface = flowSurfaceIn(draft, target.surfaceId)
    const from = findFlowBlockRecursive(draftSurface.blocks, target.blockId)
    if (!from || (from.parentId ?? null) !== (target.parentId ?? null)) {
      throw new Error('所选 Flow 块位置已变化，请重新选择')
    }
    const destinationBlocks = blocksAtParent(draftSurface.blocks, destination.parentId)
    if (from.blocks === destinationBlocks) {
      const [moved] = from.blocks.splice(from.index, 1)
      const clamped = Math.max(0, Math.min(destination.index, destinationBlocks.length))
      destinationBlocks.splice(clamped, 0, moved!)
    } else {
      const [moved] = from.blocks.splice(from.index, 1)
      const clamped = Math.max(0, Math.min(destination.index, destinationBlocks.length))
      destinationBlocks.splice(clamped, 0, moved!)
    }
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已移动内容块', options)
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
    const length = Array.from(found.block.text).length
    if (!Number.isInteger(offset) || offset < 0 || offset > length) {
      return failCommand('拆分位置无效')
    }
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法拆分')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    if (!isRichTextFlowBlock(found.block)) throw new Error('当前块不能从文字中间拆分')
    const left = sliceFlowRichText(found.block, 0, offset)
    const right = sliceFlowRichText(found.block, offset, Array.from(found.block.text).length)
    found.block.text = left.text
    if (left.runs) found.block.runs = left.runs
    else delete found.block.runs
    const nextParagraph: FlowParagraphBlock = {
      id: stableFlowId('block'),
      type: 'paragraph',
      text: right.text,
      ...(right.runs ? { runs: right.runs } : {}),
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
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法合并')
  }
  return runMutation(document, (draft) => {
    const found = resolveFlowBlock(draft, target)
    const previous = found.blocks[found.index - 1]
    if (!isRichTextFlowBlock(found.block) || !previous || !isRichTextFlowBlock(previous)) {
      throw new Error('当前块不能合并')
    }
    const merged = mergeFlowRichText(previous, found.block)
    previous.text = merged.text
    if (merged.runs) previous.runs = merged.runs
    else delete previous.runs
    found.blocks.splice(found.index, 1)
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已合并段落', options)
}

function applyStyleToRichText(
  content: FlowRichText,
  style: TextRunStyle,
  range: { start: number; end: number } | 'all',
): FlowRichText {
  const length = Array.from(content.text).length
  const start = range === 'all' ? 0 : range.start
  const end = range === 'all' ? length : range.end
  const from = Math.max(0, Math.min(length, start))
  const to = Math.max(from, Math.min(length, end === from ? length : end))
  if (to <= from) return content
  const runs = applyTextRunStyle(content.text, content.runs ?? [], from, to, style)
  return runs.length > 0 ? { text: content.text, runs } : { text: content.text }
}

export function formatFlowEditorBlock(
  document: CourseProjectDocument,
  target: FlowEditorBlockTarget,
  spec: FlowBlockFormatSpec,
  options: FlowCommandOptions & { textRange?: { start: number; end: number } } = {},
): FlowCommandResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
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
          text: block.text,
          ...(block.runs ? { runs: block.runs } : {}),
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
          text: block.text,
          ...(block.runs ? { runs: block.runs } : {}),
        }
        found.blocks[found.index] = next
      } else if (block.type === 'quote') {
        const next: FlowParagraphBlock = {
          id: block.id,
          type: 'paragraph',
          text: block.text,
          ...(block.runs ? { runs: block.runs } : {}),
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
          text: block.text,
          ...(block.runs ? { runs: block.runs } : {}),
        }
        found.blocks[found.index] = next
      } else if (block.type === 'paragraph') {
        const next: FlowQuoteBlock = {
          id: block.id,
          type: 'quote',
          text: block.text,
          ...(block.runs ? { runs: block.runs } : {}),
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
        const next = applyStyleToRichText(block, spec.style, range)
        block.text = next.text
        if (next.runs) block.runs = next.runs
        else delete block.runs
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
  if (!selection.selectedBlockId || !selection.textRange) {
    return failCommand('没有可删除的文字')
  }
  const target = flowBlockTargetFromSelection(document, selection)
  try {
    const found = resolveFlowBlock(document, target)
    if (!isRichTextFlowBlock(found.block)) return failCommand('当前块不能删除文字')
    const length = Array.from(found.block.text).length
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
      const next = deleteFlowRichTextRange(draftFound.block, start, end)
      draftFound.block.text = next.text
      if (next.runs) draftFound.block.runs = next.runs
      else delete draftFound.block.runs
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
          ? { start: selection.textRange.start, end: selection.textRange.end }
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
      return applyFlowCommittedText(document, primary, command.text, {
        ...options,
        runs: command.runs,
      })
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
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return failCommand(stale.reason ?? LAYER_REJECT_STALE_REVISION)
  if (patch.backgroundMode !== undefined && !BACKGROUND_MODES.includes(patch.backgroundMode)) {
    return failCommand('背景模式无效')
  }
  if (
    patch.backgroundColor !== undefined
    && (typeof patch.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(patch.backgroundColor.trim()))
  ) {
    return failCommand('颜色格式无效')
  }
  const color = patch.backgroundColor !== undefined
    ? patch.backgroundColor.trim().toLowerCase()
    : undefined
  let surface: ReturnType<typeof flowSurfaceIn>
  try {
    surface = flowSurfaceIn(document, surfaceId)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法更新 Flow 页面背景')
  }
  const modeChanges = patch.backgroundMode !== undefined
    && patch.backgroundMode !== (surface.backgroundMode ?? 'own')
  const colorChanges = color !== undefined && color !== surface.backgroundColor
  const assetChanges = patch.backgroundAssetId !== undefined
    && patch.backgroundAssetId !== (surface.backgroundAssetId ?? null)
  if (!modeChanges && !colorChanges && !assetChanges) {
    return succeedNoop(document, '背景未变')
  }
  return runMutation(document, (draft) => {
    const target = flowSurfaceIn(draft, surfaceId)
    if (modeChanges) target.backgroundMode = patch.backgroundMode
    if (colorChanges) target.backgroundColor = color
    if (assetChanges) target.backgroundAssetId = patch.backgroundAssetId ?? null
  }, '已修改稿纸背景', options)
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
} from './flowDocumentModel'
