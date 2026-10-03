import type { DocumentContent } from '../document/content'
import type { NativeElementContent } from '../contracts/course-project-v9/types'

/** Formal author content. Browser DOM and measured frames are projections. */
export type CompositionNode<TRuntime> =
  | { id: string; kind: 'element'; tagName: string; namespace?: string; attributes: Record<string, string>; children: CompositionNode<TRuntime>[] }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'comment'; text: string }
  | { id: string; kind: 'document'; content: DocumentContent }
  | { id: string; kind: 'native'; content: NativeElementContent }
  | { id: string; kind: 'runtime'; runtime: TRuntime }

export interface WebComposition<TRuntime> {
  doctype?: string
  root: CompositionNode<TRuntime>
  /** Source resource key -> existing managed asset. */
  assets: Record<string, { assetId: string }>
}

export function walkComposition<TRuntime>(root: CompositionNode<TRuntime>, visit: (node: CompositionNode<TRuntime>) => void): void {
  visit(root)
  if (root.kind === 'element') root.children.forEach(child => walkComposition(child, visit))
}

export function findCompositionNode<TRuntime>(root: CompositionNode<TRuntime>, id: string): CompositionNode<TRuntime> | undefined {
  if (root.id === id) return root
  if (root.kind === 'element') {
    for (const child of root.children) {
      const found = findCompositionNode(child, id)
      if (found) return found
    }
  }
  return undefined
}
