import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MIN_NODE_SIZE,
} from '@/shared/constants'

/** Same canvas batch cap as V8 `MAX_BATCH_CANVAS_ITEMS`; MediaTab UI stays on R3-Z. */
export const MEDIA_BATCH_CANVAS_LIMIT = 12

export interface MediaBatchImportPlan {
  destination: 'canvas' | 'library'
  overflowToLibrary: boolean
}

export type MediaBatchLibraryFallback = 'batch-size' | 'scene-capacity'

export interface MediaBatchCommitResult {
  destination: 'canvas' | 'library'
  completedCount: number
  placedNodeIds: string[]
  libraryFallback?: MediaBatchLibraryFallback
}

/** Keeps oversized element imports useful without producing an unreadable canvas. */
export function planMediaBatchImport(
  mode: 'add' | 'library',
  placementCount: number,
  maximumCanvasItems: number,
): MediaBatchImportPlan {
  const overflowToLibrary =
    mode === 'add' && placementCount > maximumCanvasItems
  return {
    destination: mode === 'add' && !overflowToLibrary ? 'canvas' : 'library',
    overflowToLibrary,
  }
}

/**
 * Commits the route selected above and degrades atomically rejected canvas
 * placement to a library-only import. Store placement methods return either
 * the complete node-id set or an empty array when capacity is insufficient.
 */
export function commitMediaBatchImport<T>(input: {
  plan: MediaBatchImportPlan
  placements: T[]
  additions: T[]
  placeOnCanvas(items: T[]): string[]
  importIntoLibrary(items: T[]): void
}): MediaBatchCommitResult {
  if (input.plan.destination === 'library') {
    input.importIntoLibrary(input.additions)
    return {
      destination: 'library',
      completedCount: input.additions.length,
      placedNodeIds: [],
      ...(input.plan.overflowToLibrary
        ? { libraryFallback: 'batch-size' as const }
        : {}),
    }
  }

  const placedNodeIds = input.placeOnCanvas(input.placements)
  if (placedNodeIds.length === input.placements.length) {
    return {
      destination: 'canvas',
      completedCount: placedNodeIds.length,
      placedNodeIds,
    }
  }

  input.importIntoLibrary(input.additions)
  return {
    destination: 'library',
    completedCount: input.additions.length,
    placedNodeIds,
    libraryFallback: 'scene-capacity',
  }
}

export interface MediaBatchFrameInput {
  width: number
  height: number
  x?: number
  y?: number
}

export interface MediaBatchFrame {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Command-side copy of V8 `layoutMediaBatchNodes`. MediaTab still owns the
 * visual grid; R3-Z should keep calling this instead of a second layout.
 */
export function layoutMediaBatchFrames(
  items: ReadonlyArray<MediaBatchFrameInput>,
  canvas: { width: number; height: number } = {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  },
): MediaBatchFrame[] {
  if (items.length <= 1) {
    return items.map((item) => ({
      x: item.x ?? 0,
      y: item.y ?? 0,
      width: item.width,
      height: item.height,
    }))
  }
  const margin = 24
  const gap = 20
  const columns = Math.min(
    4,
    Math.max(1, Math.ceil(Math.sqrt(items.length * (canvas.width / canvas.height)))),
  )
  const rows = Math.ceil(items.length / columns)
  const availableWidth = canvas.width - margin * 2 - gap * (columns - 1)
  const availableHeight = canvas.height - margin * 2 - gap * (rows - 1)
  const cellWidth = availableWidth / columns
  const cellHeight = availableHeight / rows
  return items.map((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const scale = Math.min(1, cellWidth / item.width, cellHeight / item.height)
    const width = Math.max(MIN_NODE_SIZE, item.width * scale)
    const height = Math.max(MIN_NODE_SIZE, item.height * scale)
    return {
      x: margin + column * (cellWidth + gap) + (cellWidth - width) / 2,
      y: margin + row * (cellHeight + gap) + (cellHeight - height) / 2,
      width,
      height,
    }
  })
}

/** Same canvas batch cap as V8 `MAX_BATCH_CANVAS_ITEMS`. */
export const MAX_BATCH_CANVAS_ITEMS = MEDIA_BATCH_CANVAS_LIMIT

/**
 * Deterministic, non-overlapping layout for a small import batch.
 * Every returned node stays inside the fixed canvas.
 */
export function layoutMediaBatchNodes<T extends MediaBatchFrameInput>(nodes: T[]): T[] {
  if (nodes.length <= 1) return nodes
  const frames = layoutMediaBatchFrames(nodes)
  return nodes.map((node, index) => ({
    ...node,
    ...frames[index]!,
  }))
}
