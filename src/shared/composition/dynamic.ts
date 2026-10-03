import type { ComponentLayerItem, CompositionLayerItem, CourseProjectDocument, CourseRuntimeDefinition, LayerItem } from '../courseProjectTypes'
import type { DocumentBlock } from '../document/content'
import { visitCourseFlowBlocks, visitCourseLayerItems, type CourseLayerVisit } from '../courseProjectHealth/internal'
import type { CompositionNode } from './content'

type ComponentBlock = Extract<DocumentBlock, { type: 'component' }>
type DynamicOwner = CourseLayerVisit['owner'] | { kind: 'flow'; surfaceId: string }
interface DynamicContext {
  instanceId: string
  owner: DynamicOwner
  path: Array<string | number>
  layerItemId?: string
  layerItem?: LayerItem
  composition?: CompositionLayerItem
}

/** References to the existing author fields, using the instance IDs rendered by Player. */
export type ProjectDynamicInstance = DynamicContext & (
  | { kind: 'runtime'; runtime: CourseRuntimeDefinition }
  | { kind: 'component'; componentItem: ComponentLayerItem | ComponentBlock }
)

function visitLayer(item: LayerItem, owner: DynamicOwner, path: Array<string | number>, visit: (entry: ProjectDynamicInstance) => void): void {
  const context = { owner, layerItemId: item.layerItemId, layerItem: item }
  if (item.kind === 'runtime') visit({ ...context, path: [...path, 'runtime'], instanceId: item.layerItemId, kind: 'runtime', runtime: item.runtime })
  else if (item.kind === 'component') visit({ ...context, path, instanceId: item.layerItemId, kind: 'component', componentItem: item })
  else if (item.kind === 'composition') {
    const blocks = (nodes: readonly DocumentBlock[], prefix: string, blockPath: Array<string | number>): void => nodes.forEach((block, index) => {
      const ownPath = [...blockPath, index]
      if (block.type === 'component') visit({ ...context, composition: item, path: ownPath, instanceId: `${prefix}/${block.id}`, kind: 'component', componentItem: block })
      else if (block.type === 'section') blocks(block.blocks, prefix, [...ownPath, 'blocks'])
    })
    const node = (value: CompositionNode<CourseRuntimeDefinition>, nodePath: Array<string | number>): void => {
      if (value.kind === 'runtime') visit({ ...context, composition: item, path: [...nodePath, 'runtime'],
        instanceId: `${item.layerItemId}/${value.id}`, kind: 'runtime', runtime: value.runtime })
      else if (value.kind === 'document') blocks(value.content.blocks, `${item.layerItemId}/${value.id}`, [...nodePath, 'content', 'blocks'])
      else if (value.kind === 'element') value.children.forEach((child, index) => node(child, [...nodePath, 'children', index]))
    }
    node(item.content.root, [...path, 'content', 'root'])
  }
}

export function visitProjectDynamicInstances(project: CourseProjectDocument, visit: (entry: ProjectDynamicInstance) => void): void {
  visitCourseLayerItems(project, ({ item, owner, path }) => visitLayer(item, owner, path, visit))
  visitCourseFlowBlocks(project, ({ block, surfaceId, path }) => {
    if (block.type === 'component') visit({ instanceId: block.id, owner: { kind: 'flow', surfaceId }, path,
      kind: 'component', componentItem: block })
  })
}

export function layerDynamicInstanceIds(item: LayerItem): string[] {
  const ids: string[] = []
  visitLayer(item, { kind: 'global' }, [], entry => ids.push(entry.instanceId))
  return ids
}

/** A leaf's containing Web structure owns its actual CSS layout and resource map. */
export function projectDynamicInstanceInput(entry: ProjectDynamicInstance): unknown {
  return { owner: entry.owner, ...(entry.kind === 'runtime' ? { runtime: entry.runtime } : { component: entry.componentItem }),
    ...(entry.composition ? { composition: entry.composition } : entry.layerItem ? { layerItem: entry.layerItem } : {}) }
}
