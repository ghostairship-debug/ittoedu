import type { CompositionNode, WebComposition } from './content'

/** Elements written with `class="fragment"` appear one per step (reveal.js convention). */
export const FRAGMENT_CLASS = 'fragment'

/** Host-owned attributes on the rendered copy of a composition; never stored in content. */
export const STEP_NODE_ATTRIBUTE = 'data-guoling-step'
export const STEP_HIDDEN_ATTRIBUTE = 'data-guoling-step-hidden'
export const STATE_NODE_ATTRIBUTE = 'data-guoling-state-node'
export const STATE_HIDDEN_ATTRIBUTE = 'data-guoling-state-hidden'

type CompositionItem = { layerItemId: string; kind: string; content?: unknown }
type StateLike = {
  layerItemOverrides: Record<string, { compositionNodes?: Record<string, { visible?: boolean }> }>
  fragmentStep?: number
}

export interface FragmentNodeReference {
  layerItemId: string
  nodeId: string
}

export function isFragmentNode(node: CompositionNode<unknown>): boolean {
  return node.kind === 'element' && (node.attributes.class ?? '').split(/\s+/).includes(FRAGMENT_CLASS)
}

function composition(item: CompositionItem): WebComposition<unknown> | null {
  return item.kind === 'composition' ? item.content as WebComposition<unknown> : null
}

/** A scene's in-page steps: its own composition items in stored order, then document order. */
export function sceneFragmentNodes(layerItems: readonly CompositionItem[]): FragmentNodeReference[] {
  const result: FragmentNodeReference[] = []
  for (const item of layerItems) {
    const content = composition(item)
    if (!content) continue
    const visit = (node: CompositionNode<unknown>): void => {
      if (isFragmentNode(node)) result.push({ layerItemId: item.layerItemId, nodeId: node.id })
      if (node.kind === 'element') node.children.forEach(visit)
    }
    visit(content.root)
  }
  return result
}

/**
 * Node visibility of one presentation state, as attributes on the rendered copy.
 * Steps hide the fragments after `fragmentStep`; an explicit node state wins.
 * Every node that any state of the scene can toggle carries a marker, so the
 * host can animate it in both directions.
 */
export function compositionStateNodeAttributes(
  scene: { readonly layerItems: readonly CompositionItem[]; readonly presentation?: { readonly states: readonly StateLike[] } },
  state: StateLike | undefined,
): Map<string, Map<string, Record<string, string>>> {
  const result = new Map<string, Map<string, Record<string, string>>>()
  const at = (layerItemId: string, nodeId: string): Record<string, string> => {
    let nodes = result.get(layerItemId)
    if (!nodes) { nodes = new Map(); result.set(layerItemId, nodes) }
    let attributes = nodes.get(nodeId)
    if (!attributes) { attributes = {}; nodes.set(nodeId, attributes) }
    return attributes
  }
  sceneFragmentNodes(scene.layerItems).forEach((fragment, index) => {
    const attributes = at(fragment.layerItemId, fragment.nodeId)
    attributes[STEP_NODE_ATTRIBUTE] = String(index + 1)
    if (state?.fragmentStep !== undefined && index >= state.fragmentStep) attributes[STEP_HIDDEN_ATTRIBUTE] = ''
  })
  for (const candidate of scene.presentation?.states ?? []) {
    for (const [layerItemId, override] of Object.entries(candidate.layerItemOverrides)) {
      for (const nodeId of Object.keys(override.compositionNodes ?? {})) at(layerItemId, nodeId)[STATE_NODE_ATTRIBUTE] = ''
    }
  }
  for (const [layerItemId, override] of Object.entries(state?.layerItemOverrides ?? {})) {
    for (const [nodeId, node] of Object.entries(override.compositionNodes ?? {})) {
      if (node.visible === false) at(layerItemId, nodeId)[STATE_HIDDEN_ATTRIBUTE] = ''
      else if (node.visible === true) delete at(layerItemId, nodeId)[STEP_HIDDEN_ATTRIBUTE]
    }
  }
  return result
}

/** Returns a copy of the composition with the given node attributes added. */
export function withCompositionNodeAttributes<T extends WebComposition<unknown>>(
  content: T,
  attributes: ReadonlyMap<string, Record<string, string>> | undefined,
): T {
  if (!attributes?.size) return content
  const visit = (node: CompositionNode<unknown>): CompositionNode<unknown> => {
    if (node.kind !== 'element') return node
    const extra = attributes.get(node.id)
    return { ...node, ...(extra ? { attributes: { ...node.attributes, ...extra } } : {}), children: node.children.map(visit) }
  }
  return { ...content, root: visit(content.root) } as T
}
