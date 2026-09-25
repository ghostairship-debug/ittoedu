import type { EffectiveLayerProjectionRow } from '../../course/read-model'

export type LayerOrderMove = 'forward' | 'backward' | 'front' | 'back'

/**
 * New back-to-front order of the moved item's reorder group (the list `reorderNodes` expects), or null when the
 * item cannot move that way. Only rows of the same owner group and Flow body plane move relative to each other.
 */
export function planLayerOrder(rows: readonly EffectiveLayerProjectionRow[], itemId: string, move: LayerOrderMove): string[] | null {
  const item = rows.find(row => row.id === itemId)
  if (!item) return null
  const group = rows.filter(row => row.reorderGroupKey === item.reorderGroupKey && row.flowBodyPlane === item.flowBodyPlane && !row.isTeacherController)
  const index = group.findIndex(row => row.id === itemId)
  if (index < 0) return null
  const target = move === 'forward' ? index + 1 : move === 'backward' ? index - 1 : move === 'front' ? group.length - 1 : 0
  if (target < 0 || target >= group.length || target === index) return null
  const ids = group.map(row => row.id)
  ids.splice(index, 1)
  ids.splice(target, 0, itemId)
  return ids
}
