export interface FlowRuntimePaperBlock {
  blockId: string
  top: number
  bottom: number
}

export interface FlowRuntimePaperItem {
  id: string
  blockId: string
  order: number
  observedHeight: number
  offsetY?: number
}

export interface FlowRuntimePaperSlot {
  id: string
  blockId: string
  top: number
  height: number
  bottom: number
}

export interface FlowRuntimePaperLayout {
  slots: FlowRuntimePaperSlot[]
  addedAfterBlock: Record<string, number>
  totalAddedHeight: number
}

export function resolveFlowRuntimePaperSlots(
  blocks: readonly FlowRuntimePaperBlock[],
  runtimes: readonly FlowRuntimePaperItem[],
): FlowRuntimePaperLayout {
  const byBlock = new Map<string, FlowRuntimePaperItem[]>()
  for (const runtime of runtimes) {
    if (!Number.isFinite(runtime.observedHeight) || runtime.observedHeight < 0 || (runtime.offsetY !== undefined && !Number.isFinite(runtime.offsetY))) continue
    const group = byBlock.get(runtime.blockId) ?? []
    group.push(runtime)
    byBlock.set(runtime.blockId, group)
  }
  const slots: FlowRuntimePaperSlot[] = []
  const addedAfterBlock: Record<string, number> = Object.create(null) as Record<string, number>
  let totalAddedHeight = 0
  for (const block of blocks) {
    const group = byBlock.get(block.blockId)
    if (!group || !Number.isFinite(block.top) || !Number.isFinite(block.bottom)) continue
    group.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    let tail = Number.NEGATIVE_INFINITY
    for (const runtime of group) {
      const top = Math.max(block.top + totalAddedHeight + (runtime.offsetY ?? 0), tail)
      slots.push({ id: runtime.id, blockId: block.blockId, top, height: runtime.observedHeight, bottom: top + runtime.observedHeight })
      tail = top + runtime.observedHeight
    }
    const height = Math.max(0, tail - block.bottom - totalAddedHeight)
    addedAfterBlock[block.blockId] = height
    totalAddedHeight += height
  }
  return { slots, addedAfterBlock, totalAddedHeight }
}
