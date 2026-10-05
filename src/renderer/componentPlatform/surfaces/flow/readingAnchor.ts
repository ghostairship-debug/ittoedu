export interface FlowReadingAnchor { instanceId: string; offset: number }
export type FlowReadingPosition = readonly FlowReadingAnchor[]

function visibleBlocks(viewport: HTMLElement): HTMLElement[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>('[data-component-flow-id]')).filter(element => element.getClientRects().length > 0)
}

/** Keep fallback neighbors so removing/collapsing the current block preserves a nearby reading point. */
export function captureFlowReadingPosition(viewport: HTMLElement): FlowReadingPosition {
  const top = viewport.getBoundingClientRect().top
  const blocks = visibleBlocks(viewport).map(element => ({ element, rect: element.getBoundingClientRect() }))
  const crossing = blocks.filter(({ rect }) => rect.top <= top && rect.bottom > top).sort((a, b) => b.rect.top - a.rect.top)
  const below = blocks.filter(({ rect }) => rect.top > top).sort((a, b) => a.rect.top - b.rect.top)
  const above = blocks.filter(({ rect }) => rect.bottom <= top).reverse()
  return [...crossing, ...below, ...above].map(({ element, rect }) => ({ instanceId: element.dataset.componentFlowId!, offset: rect.top - top }))
}

export function restoreFlowReadingPosition(viewport: HTMLElement, position: FlowReadingPosition): boolean {
  const blocks = visibleBlocks(viewport)
  for (const anchor of position) {
    const element = blocks.find(value => value.dataset.componentFlowId === anchor.instanceId)
    if (!element) continue
    const offset = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    viewport.scrollTop += offset - anchor.offset
    return true
  }
  return false
}

export function jumpToFlowInstance(viewport: HTMLElement, instanceId: string): boolean {
  const element = visibleBlocks(viewport).find(value => value.dataset.componentFlowId === instanceId)
  if (!element) return false
  viewport.scrollTop += element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  return true
}
