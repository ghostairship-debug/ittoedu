import type { CompositionNode, WebComposition } from './content'
import type { DocumentBlock } from '../document/content'

export interface CompositionReference {
  kind: 'asset' | 'component' | 'layer-item'
  id: string
  version?: string
  path: (string | number)[]
}
type RuntimeReferences = { assets: Record<string, { assetId: string }>; nodeBindings?: Record<string, string>; staticFallback?: { assetId: string } }

/** Shared by author validation, publication and real resource consumers. */
export function visitCompositionReferences<TRuntime extends RuntimeReferences>(content: WebComposition<TRuntime>, emit: (reference: CompositionReference) => void): void {
  const asset = (id: string | undefined | null, path: (string | number)[]) => { if (id) emit({ kind: 'asset', id, path }) }
  const blocks = (items: readonly DocumentBlock[], path: (string | number)[]) => items.forEach((block, index) => {
    const at = [...path, index]
    if (block.type === 'media') asset(block.assetId, [...at, 'assetId'])
    else if (block.type === 'component') {
      asset(block.staticFallbackAssetId, [...at, 'staticFallbackAssetId'])
      emit({ kind: 'component', id: block.component.packageId, version: block.component.version, path: [...at, 'component'] })
    } else if (block.type === 'section') blocks(block.blocks, [...at, 'blocks'])
  })
  const node = (current: CompositionNode<TRuntime>, path: (string | number)[]) => {
    if (current.kind === 'element') current.children.forEach((child, index) => node(child, [...path, 'children', index]))
    else if (current.kind === 'document') blocks(current.content.blocks, [...path, 'content', 'blocks'])
    else if (current.kind === 'native') {
      if (current.content.nativeType === 'image' || current.content.nativeType === 'video') {
        asset(current.content.data.assetId, [...path, 'content', 'data', 'assetId'])
        if (current.content.nativeType === 'video') asset(current.content.data.poster.assetId, [...path, 'content', 'data', 'poster', 'assetId'])
      }
    } else if (current.kind === 'runtime') {
      Object.entries(current.runtime.assets).forEach(([key, binding]) => asset(binding.assetId, [...path, 'runtime', 'assets', key, 'assetId']))
      asset(current.runtime.staticFallback?.assetId, [...path, 'runtime', 'staticFallback', 'assetId'])
      Object.entries(current.runtime.nodeBindings ?? {}).forEach(([key, id]) => emit({ kind: 'layer-item', id, path: [...path, 'runtime', 'nodeBindings', key] }))
    }
  }
  Object.entries(content.assets).forEach(([key, binding]) => asset(binding.assetId, ['assets', key, 'assetId']))
  node(content.root, ['root'])
}
