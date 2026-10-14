import type { GeometryPoint } from '../../core/components/geometry'

export const COMPONENT_AUTHOR_HIT = 'component-author-hit-test'
export interface ComponentAuthorHitRequest {
  point: GeometryPoint
  resolve(authorKey: string | null): void
}

/** Source realms own CSS paint order. A builtin with no realm keeps its geometric hit. */
export function requestComponentAuthorHit(root: HTMLElement | null, point: GeometryPoint): Promise<string | null | undefined> {
  if (!root) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const event = new CustomEvent<ComponentAuthorHitRequest>(COMPONENT_AUTHOR_HIT, { cancelable: true, detail: { point, resolve } })
    root.dispatchEvent(event)
    if (!event.defaultPrevented) resolve(undefined)
  })
}
