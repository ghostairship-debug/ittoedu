import type { GeometryPoint } from '../../core/components/geometry'
import { invertMatrix, transformPoint } from '../../core/components/geometry'
import { componentClientMatrix } from '../../player/components/runtime/componentClientMatrix'
import { componentPaintStack } from '../../components/web/paintHit'
import { componentInlineChildAt, type ComponentInlineChildHit } from '../authoring/nativeInlineAuthoring'

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

const authorChrome = '[data-slide-authoring-hit-plane],.canvas-authoring-targets,.author-field-affordances,.canvas-line-overlay,[data-handle],[data-line-handle],.teacher-controller-overlay,.selection-quick-bar,.text-edit-toolbar,[data-component-professional-editor],.text-edit-overlay,.image-safe-area-guides'
export interface VisibleComponentAuthorHit { instanceId: string; authorKey?: string | null; inlineChild?: ComponentInlineChildHit }

/** Resolve outer paint first, then ask that same Source realm about its content.
 * A Surface background can stop the search without becoming a selectable object.
 */
export async function visibleComponentAuthorHit(root: HTMLElement | null, point: GeometryPoint,
  contentElement: (id: string) => HTMLElement | null | undefined): Promise<VisibleComponentAuthorHit | null> {
  if (!root) return null
  const elements = componentPaintStack(root, point.x, point.y, authorChrome), realmHits = new Map<string, ComponentAuthorHitResult | undefined>()
  for (const element of elements) {
    const owner = element.closest<HTMLElement>('[data-component-instance]'), id = owner?.dataset.componentInstance
    const inlineChild = componentInlineChildAt(element)
    if (inlineChild) return { instanceId: id ?? inlineChild.ownerId, authorKey: null, inlineChild }
    if (!id) return null
    const content = contentElement(id), matrix = content && componentClientMatrix(content)
    if (!content?.contains(element)) return { instanceId: id, authorKey: null }
    if (!realmHits.has(id)) realmHits.set(id, matrix ? await requestComponentAuthorHit(content, transformPoint(invertMatrix(matrix), point)) : undefined)
    const hit = realmHits.get(id)
    if (hit && !hit.painted && !hit.authorKey) continue
    return { instanceId: id, ...(hit ? { authorKey: hit.authorKey } : {}) }
  }
  return null
}
