import { controllerTargetIdsForLocations, repairRemovedCourseReferences } from './courseReferenceCleanup'
import { collectFlowBlockIds, removeBlocksById, wouldLeaveSurfaceWithoutAnchor, FLOW_LAST_HEADING_REASON, FLOW_LAST_LOCATION_REASON } from './flowDocumentModel'
import type { CourseProjectDocument, FlowBlock } from '../../shared/courseProjectTypes'
import { plainDocumentText, type FlowTextContent } from '../../shared/document/content'
import { commitCourseProjectMutation } from './courseProjectMutation'
import { flowSurfaceIn, findFlowBlockRecursive, walkFlowBlocks, stableFlowId, syncFlowCourseLocations, resolveFlowBlock, isRichTextFlowBlock } from './flowDocumentModel'

export interface FlowContentOptions { now?: string; expectedRevision?: number }
export interface FlowBlockTarget { surfaceId: string; blockId: string; parentId: string | null }
export type FlowBlockInput = FlowBlock extends infer Block ? Block extends FlowBlock ? Omit<Block, 'id'> & { id?: string } : never : never
export interface FlowContentResult { ok: boolean; reason?: string; nextDocument?: CourseProjectDocument; historyEntry?: boolean; createdBlockIds?: readonly string[] }
export interface InsertFlowBlockInput { surfaceId: string; parentId: string | null; index: number; block: FlowBlockInput }
function failCommand(reason: string): FlowContentResult { return { ok: false, reason, historyEntry: false } }
function staleOrGlobal(document: CourseProjectDocument, options: FlowContentOptions): FlowContentResult | null {
  return options.expectedRevision !== undefined && options.expectedRevision !== document.revision ? failCommand('stale-revision') : null
}
function runMutation(document: CourseProjectDocument, mutate: (draft: CourseProjectDocument) => string[] | void, reason: string, options: FlowContentOptions): FlowContentResult {
  try {
    let createdBlockIds: string[] = []
    const nextDocument = commitCourseProjectMutation(document, draft => { createdBlockIds = mutate(draft) ?? [] }, options.now)
    return { ok: true, nextDocument, historyEntry: true, reason, ...(createdBlockIds.length ? { createdBlockIds } : {}) }
  } catch (error) { return failCommand(error instanceof Error ? error.message : reason) }
}

export function validateFlowInsertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error('插入位置无效')
  }
}

export function flowBlocksAtParent(surfaceBlocks: FlowBlock[], parentId: string | null): FlowBlock[] {
  if (parentId === null) return surfaceBlocks
  const section = findFlowBlockRecursive(surfaceBlocks, parentId)
  if (!section || section.block.type !== 'section') {
    throw new Error(`找不到 Flow 分节：${parentId}`)
  }
  return section.block.blocks
}

export function planInsertFlowBlock(
  document: CourseProjectDocument,
  input: InsertFlowBlockInput,
  options: FlowContentOptions = {},
): FlowContentResult {
  const blocked = staleOrGlobal(document, options)
  if (blocked) return blocked
  const nextBlock = { ...input.block, id: stableFlowId('block', input.block.id) } as FlowBlock
  try {
    const surface = flowSurfaceIn(document, input.surfaceId)
    walkFlowBlocks(surface.blocks, (block) => {
      if (block.id === nextBlock.id) throw new Error(`Flow 块 ID 已存在：${nextBlock.id}`)
    })
    validateFlowInsertIndex(input.index, flowBlocksAtParent(surface.blocks, input.parentId).length)
  } catch (error) {
    return failCommand(error instanceof Error ? error.message : '无法插入 Flow 块')
  }
  return runMutation(document, (draft) => {
    const draftSurface = flowSurfaceIn(draft, input.surfaceId)
    const targetBlocks = flowBlocksAtParent(draftSurface.blocks, input.parentId)
    targetBlocks.splice(input.index, 0, nextBlock)
    syncFlowCourseLocations(draft, input.surfaceId)
    return [nextBlock.id]
  }, '已插入内容块', options)
}


export function planUpdateFlowBlock(
  document: CourseProjectDocument,
  target: FlowBlockTarget,
  update: ((block: FlowBlock) => void) | object,
  options: FlowContentOptions = {},
): FlowContentResult {
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


export function planFlowCommittedText(
  document: CourseProjectDocument,
  target: FlowBlockTarget,
  nextContent: FlowTextContent,
  options: FlowContentOptions = {},
): FlowContentResult {
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
      found.block.body = structuredClone(nextContent)
      return
    }
    if (found.block.type === 'code') {
      found.block.code = plainDocumentText(nextContent)
      return
    }
    if (!isRichTextFlowBlock(found.block)) throw new Error('当前块不能写入正文')
    found.block.content = structuredClone(nextContent)
    syncFlowCourseLocations(draft, target.surfaceId)
  }, '已更新文字', options)
}

export interface MoveFlowBlockDestination { parentId: string | null; index: number; surfaceId?: string }
export function planDeleteFlowBlocks(
  document: CourseProjectDocument,
  targets: readonly FlowBlockTarget[],
  options: FlowContentOptions = {},
): FlowContentResult {
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
  const bySurface = new Map<string, FlowBlockTarget[]>()
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

export function planMoveFlowBlock(
  document: CourseProjectDocument,
  target: FlowBlockTarget,
  destination: MoveFlowBlockDestination,
  options: FlowContentOptions = {},
): FlowContentResult {
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
    const destinationBlocks = flowBlocksAtParent(draftSurface.blocks, destination.parentId)
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
