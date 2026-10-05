import type { ComponentImplementation } from '../../../shared/contracts/component-platform/project'
import type { LibraryIdentityMap } from './types'
import { sourceModuleBindings } from './references'

/** Rebind software identities. Source text, logical file paths and import specifiers remain authored content. */
export function rebindComponentLibraryImplementation(original: Extract<ComponentImplementation, { kind: 'source' }>,
  identities: LibraryIdentityMap, assetIds: readonly string[]): Extract<ComponentImplementation, { kind: 'source' }> {
  const moduleBindings = Object.fromEntries(Object.entries(sourceModuleBindings(original)).map(([specifier, id]) => {
    const mapped = identities.definitions.get(id)
    if (!mapped) throw new Error(`库条目缺少源码依赖定义：${id}`)
    return [specifier, mapped]
  }))
  const resourceBindings = Object.fromEntries(Object.entries({
    ...Object.fromEntries(assetIds.map(id => [id, id])), ...original.resourceBindings,
  }).map(([name, id]) => [name, identities.assets.get(id) ?? id]))
  const implementation = structuredClone(original)
  delete implementation.dependencies
  implementation.moduleBindings = moduleBindings
  implementation.resourceBindings = resourceBindings
  if (implementation.workspace) {
    const ownerId = identities.components.get(implementation.workspace.ownerId)
    if (!ownerId) throw new Error(`库条目缺少源码文件：${implementation.workspace.ownerId}`)
    implementation.workspace = { ...implementation.workspace, ownerId }
  }
  return implementation
}
