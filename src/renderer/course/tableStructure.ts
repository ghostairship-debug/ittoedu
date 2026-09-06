/** Stable identity operations shared by Native and document-flow tables. */
export function reorderTableItems<T extends { readonly id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]))
  if (ids.length !== items.length || new Set(ids).size !== items.length) throw new Error('行列重排 ID 列表长度或唯一性无效')
  return ids.map(id => {
    const item = byId.get(id)
    if (!item) throw new Error(`行列 ID 不存在：${id}`)
    return item
  })
}

export function moveTableItem<T extends { readonly id: string }>(items: readonly T[], id: string, direction: -1 | 1): T[] {
  const ids = items.map(item => item.id)
  const index = ids.indexOf(id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= ids.length) return [...items]
  ids.splice(index, 1)
  ids.splice(next, 0, id)
  return reorderTableItems(items, ids)
}
