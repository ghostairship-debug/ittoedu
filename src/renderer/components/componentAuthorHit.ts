import type { GeometryPoint } from '../../core/components/geometry'

export const COMPONENT_AUTHOR_HIT = 'component-author-hit-test'
export interface ComponentAuthorHitResult {
  authorKey: string | null
  /** A realm can paint a foreground object without exposing an author field. */
  painted: boolean
}
export interface ComponentAuthorHitRequest {
  point: GeometryPoint
  resolve(result: ComponentAuthorHitResult): void
}

/** Source realms own CSS paint order. A builtin with no realm keeps its geometric hit. */
export function requestComponentAuthorHit(root: HTMLElement | null, point: GeometryPoint): Promise<ComponentAuthorHitResult | undefined> {
  if (!root) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const event = new CustomEvent<ComponentAuthorHitRequest>(COMPONENT_AUTHOR_HIT, { cancelable: true, detail: { point, resolve } })
    root.dispatchEvent(event)
    if (!event.defaultPrevented && root.dataset.componentRender) {
      // World owns the stable slot; Host owns its current private mount root.
      // Follow only these direct software nodes, never authored descendants.
      const worldRoot = [...root.children].find((element): element is HTMLElement => element instanceof HTMLElement
        && element.dataset.componentRuntimeRoot === root.dataset.componentRender)
      const realmRoot = worldRoot && [...worldRoot.children].find((element): element is HTMLElement => element instanceof HTMLElement
        && element.dataset.componentInstanceId === root.dataset.componentRender)
      realmRoot?.dispatchEvent(event)
    }
    if (!event.defaultPrevented) resolve(undefined)
  })
}
