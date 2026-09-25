/** Position a media block in document order; null means before the first block. */
export function flowMediaDropAfterBlock(paper: HTMLElement, orderedBlockIds: readonly string[], clientY: number): string | null {
  const visible = new Map<string, HTMLElement>()
  for (const element of paper.querySelectorAll<HTMLElement>('[data-flow-block-id]')) {
    const id = element.dataset.flowBlockId
    if (id && orderedBlockIds.includes(id) && !visible.has(id)) visible.set(id, element)
  }
  let after: string | null = null
  for (const id of orderedBlockIds) {
    const element = visible.get(id)
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) break
    after = id
  }
  return after
}
