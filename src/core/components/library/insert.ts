import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentEdit, ComponentOperationBatch } from '../../../shared/contracts/component-platform/operations'
import type { ComponentContainer, ComponentImplementation, ComponentInstance, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import { captureComponentOperation, equalComponentValue } from '../../drivers/courseV10Operations'
import { componentAssetIds, rebindDeclaredTargets, rebindInteractionReferences, rebindProfessionalAssets, rebindWebAssets, sourceAssetIds, sourceModuleBindings } from './references'
import type { LibraryDiagnostic, LibraryIdentityMap, LibraryInputValues, LibraryReferenceAdapter } from './types'
import { rebindComponentLibraryImplementation } from './rebindSource'

export interface InsertLibraryOptions {
  container: ComponentContainer
  index: number
  createId?: (kind: 'instance' | 'definition' | 'asset' | 'component') => string
  definitionBindings?: Readonly<Record<string, string>>
  targetBindings?: Readonly<Record<string, string>>
  surfaceBindings?: Readonly<Record<string, string>>
  inputs?: LibraryInputValues
  adapters?: Readonly<Record<string, LibraryReferenceAdapter>>
}
export interface LibraryInsertion { command: ComponentOperationBatch; rootIds: string[]; identities: LibraryIdentityMap; diagnostics: LibraryDiagnostic[] }

function setInput(data: JsonValue, path: string[], value: JsonValue): JsonValue {
  if (!path.length) return structuredClone(value)
  let target: JsonValue = data
  for (const part of path.slice(0, -1)) {
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, part)) throw new Error('库输入字段已不存在')
    target = (target as Record<string, JsonValue>)[part]
  }
  if (!target || typeof target !== 'object' || path.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('库输入字段无效')
  Object.defineProperty(target, path.at(-1)!, { value: structuredClone(value), configurable: true, writable: true, enumerable: true })
  return data
}

/** Produces a single canonical batch. It never writes a project or owns history. */
export function prepareComponentLibraryInsertion(project: CourseProjectV10, entry: ComponentLibraryEntry, options: InsertLibraryOptions): LibraryInsertion {
  // Missing bytes remain unresolved in the new namespace instead of resolving to an unrelated destination asset.
  const assetIds = new Set(Object.keys(entry.assets))
  const implementations = [...Object.values(entry.definitions).map(value => value.implementation),
    ...Object.values(entry.example.instances).map(value => value.implementationOverride)]
  for (const implementation of implementations) if (implementation?.kind === 'source') {
    for (const id of sourceAssetIds(implementation)) assetIds.add(id)
  }
  for (const instance of Object.values(entry.example.instances)) {
    const definition = entry.definitions[instance.definitionId]
    if (definition) {
      for (const id of componentAssetIds(instance, definition)) assetIds.add(id)
      for (const id of options.adapters?.[instance.definitionId]?.references(instance, definition).assetIds ?? []) assetIds.add(id)
    }
  }
  const diagnostics: LibraryDiagnostic[] = [...assetIds].filter(id => !entry.assets[id] || !entry.resources.assets[id])
    .map(id => ({ code: 'missing-asset', message: `保留了待修复的素材引用：${id}` }))
  const occupied = new Set([...Object.keys(project.instances), ...Object.keys(project.definitions), ...Object.keys(project.assets), ...project.surfaces.map(surface => surface.id)])
  for (const implementation of [...Object.values(project.definitions).map(value => value.implementation),
    ...Object.values(project.instances).map(value => value.implementationOverride)]) {
    if (implementation?.kind === 'source' && implementation.workspace) occupied.add(implementation.workspace.ownerId)
  }
  const allocate = (kind: 'instance' | 'definition' | 'asset' | 'component') => {
    const id = options.createId?.(kind) ?? `${kind}_${globalThis.crypto.randomUUID()}`
    if (!id || occupied.has(id)) throw new Error(`软件生成了重复的组件库身份：${id}`)
    occupied.add(id)
    return id
  }
  const identities: LibraryIdentityMap = {
    instances: new Map(Object.keys(entry.example.instances).map(id => [id, allocate('instance')])),
    definitions: new Map(Object.keys(entry.definitions).map(id => {
      const bound = options.definitionBindings?.[id]
      if (bound !== undefined) {
        if (!project.definitions[bound]) throw new Error(`待替换组件定义不存在：${bound}`)
        return [id, bound]
      }
      const implementation = entry.definitions[id].implementation
      // Rebinding an equal source definition would also change the destination's existing instances.
      const ownsReboundReferences = implementation.kind === 'source' && (implementation.workspace
        || Object.keys(sourceModuleBindings(implementation)).length > 0 || assetIds.size > 0)
      return [id, !project.definitions[id] || !ownsReboundReferences
        && equalComponentValue(project.definitions[id], entry.definitions[id]) ? id : allocate('definition')]
    })),
    assets: new Map([...assetIds].map(id => [id, allocate('asset')])),
    components: new Map(Object.keys(entry.resources.components).map(id => [id, allocate('component')])),
    surfaces: new Map(Object.entries(options.surfaceBindings ?? {})),
  }
  const implementation = (original: ComponentImplementation): ComponentImplementation => {
    if (original.kind === 'builtin') return structuredClone(original)
    if (original.workspace && !Object.hasOwn(entry.resources.components[original.workspace.ownerId] ?? {}, original.workspace.entry)) {
      throw new Error(`库条目缺少源码入口文件：${original.workspace.ownerId}/${original.workspace.entry}`)
    }
    return rebindComponentLibraryImplementation(original, identities, Object.keys(entry.assets))
  }
  const edits: ComponentEdit[] = []
  for (const [ownerId, files] of Object.entries(entry.resources.components)) edits.push({
    type: 'component.files.set', ownerId: identities.components.get(ownerId)!, expectedFiles: null,
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)])),
  })
  for (const original of Object.values(entry.definitions)) {
    const definition = { ...structuredClone(original), id: identities.definitions.get(original.id)!, implementation: implementation(original.implementation) }
    if (!equalComponentValue(project.definitions[definition.id], definition)) edits.push({ type: 'definition.set', definition })
  }
  for (const original of Object.values(entry.assets)) {
    const bytes = entry.resources.assets[original.id]
    // Keep the declared metadata in the library original. The inserted reference
    // stays unresolved under a fresh identity until its bytes can be repaired.
    if (!bytes) continue
    const id = identities.assets.get(original.id)!
    const extension = /\.[a-zA-Z0-9]+$/.exec(original.path)?.[0] ?? ''
    edits.push({ type: 'asset.add', asset: { ...structuredClone(original), id, path: `assets/${encodeURIComponent(id)}${extension}` }, bytes: Uint8Array.from(bytes) })
  }
  const instanceTarget = (id: string) => {
    const mapped = identities.instances.get(id) ?? options.targetBindings?.[id]
    if (!mapped || !identities.instances.has(id) && !project.instances[mapped]) throw new Error(`请绑定实际行为目标：${id}`)
    return mapped
  }
  const surfaceTarget = (id: string) => {
    const mapped = identities.surfaces.get(id)
    if (!mapped || !project.surfaces.some(surface => surface.id === mapped)) throw new Error(`请绑定实际表面目标：${id}`)
    return mapped
  }
  const instances: ComponentInstance[] = Object.values(entry.example.instances).map(original => {
    let instance: ComponentInstance = { ...structuredClone(original), id: identities.instances.get(original.id)!, definitionId: identities.definitions.get(original.definitionId)! }
    if (!instance.definitionId) throw new Error(`库条目缺少定义：${original.definitionId}`)
    instance.data = rebindDeclaredTargets(rebindProfessionalAssets(instance.data, identities), instanceTarget, surfaceTarget)
    instance = rebindInteractionReferences(instance, entry.definitions[original.definitionId], id => {
      if (identities.instances.has(id) || options.targetBindings?.[id]) return instanceTarget(id)
      diagnostics.push({ code: 'target-binding-required', instanceId: instance.id, message: `互动尚未绑定目标对象：${id}` })
      return id
    }, id => {
      if (identities.surfaces.has(id)) return surfaceTarget(id)
      diagnostics.push({ code: 'surface-binding-required', instanceId: instance.id, message: `互动尚未绑定目标页面：${id}` })
      return id
    })
    instance = rebindWebAssets(instance, entry.definitions[original.definitionId], identities)
    if (original.visibility) instance.visibility = { ...original.visibility, surfaceIds: original.visibility.surfaceIds.map(id => {
      if (identities.surfaces.has(id)) return surfaceTarget(id)
      if (original.visibility!.mode !== 'all') diagnostics.push({ code: 'surface-binding-required', instanceId: instance.id,
        message: `可见范围尚未绑定目标页面：${id}` })
      return id
    }) }
    const anchor = original.flowPlacement?.paragraphAnchor
    if (anchor) {
      if (identities.instances.has(anchor.blockId) || options.targetBindings?.[anchor.blockId]) {
        instance.flowPlacement = { ...original.flowPlacement!, paragraphAnchor: { ...anchor, blockId: instanceTarget(anchor.blockId) } }
      } else diagnostics.push({ code: 'anchor-binding-required', instanceId: instance.id, message: `随段落对象尚未绑定目标段落：${anchor.blockId}` })
    }
    if (original.childIds) instance.childIds = original.childIds.map(id => {
      const mapped = identities.instances.get(id)
      if (!mapped) throw new Error(`库条目缺少子对象：${id}`)
      return mapped
    })
    if (original.implementationOverride) instance.implementationOverride = implementation(original.implementationOverride)
    if (original.attachments) instance.attachments = original.attachments.map(attachment => ({
      instanceId: instanceTarget(attachment.instanceId),
      target: attachment.target.kind === 'instance' ? { kind: 'instance', instanceId: instanceTarget(attachment.target.instanceId) }
        : attachment.target.kind === 'surface' ? { kind: 'surface', surfaceId: surfaceTarget(attachment.target.surfaceId) } : { kind: 'project' },
    }))
    // Definition-specific source/data references remain under their real consumer's adapter.
    instance = options.adapters?.[original.definitionId]?.rebind(instance, identities) ?? instance
    for (const input of entry.inputs ?? []) if (input.instanceId === original.id && options.inputs && Object.hasOwn(options.inputs, input.role)) instance.data = setInput(instance.data, input.path, options.inputs[input.role])
    return instance
  })
  const rootIds = entry.example.rootIds.map(id => {
    const mapped = identities.instances.get(id)
    if (!mapped) throw new Error(`库条目缺少根对象：${id}`)
    return mapped
  })
  edits.push({ type: 'instance.insert', container: structuredClone(options.container), index: options.index, instances, rootIds })
  return { command: captureComponentOperation(project, edits), rootIds, identities, diagnostics }
}

/** Await the host's existing Session dispatch receipt; constructing a batch is not a commit. */
export async function insertComponentLibraryEntry<Receipt>(project: CourseProjectV10, entry: ComponentLibraryEntry,
  options: InsertLibraryOptions, dispatch: (command: ComponentOperationBatch) => Receipt | Promise<Receipt>): Promise<{ insertion: LibraryInsertion; receipt: Receipt }> {
  const insertion = prepareComponentLibraryInsertion(project, entry, options)
  return { insertion, receipt: await dispatch(insertion.command) }
}
