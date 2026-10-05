import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { componentAssetIds, declaredTargets, interactionReferenceTargets, sourceDependencyIds, sourceModuleBindings } from './references'
import type { LibraryDiagnostic, LibraryExtractResult, LibraryReferenceAdapter } from './types'

export interface ExtractLibraryOptions {
  id: string
  title: string
  rootIds: string[]
  inputs?: ComponentLibraryEntry['inputs']
  adapters?: Readonly<Record<string, LibraryReferenceAdapter>>
}

/** Reads an author snapshot. The library owns copies; no live instance or byte buffer is retained. */
export function extractComponentLibraryEntry(project: CourseProjectV10, resources: ComponentLibraryEntry['resources'], options: ExtractLibraryOptions): LibraryExtractResult {
  const diagnostics: LibraryDiagnostic[] = []
  const instances: Record<string, ComponentInstance> = {}
  const definitions: Record<string, ComponentDefinition> = {}
  const assetIds = new Set<string>()
  const components: ComponentLibraryEntry['resources']['components'] = {}
  const implementation = (original: ComponentImplementation): ComponentImplementation => {
    if (original.kind !== 'source') return structuredClone(original)
    // Source may compute resource names. Preserve its current accessible resource set without guessing source text.
    const resourceBindings = { ...Object.fromEntries(Object.keys(project.assets).map(id => [id, id])), ...original.resourceBindings }
    for (const id of Object.values(resourceBindings)) assetIds.add(id)
    if (original.workspace) {
      const { ownerId, entry } = original.workspace, files = resources.components[ownerId]
      if (files) components[ownerId] = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]))
      if (!files || !Object.hasOwn(files, entry)) diagnostics.push({ code: 'missing-component-files',
        message: `源码文件尚未提供：${ownerId}/${entry}；源码归属已保留` })
    }
    const source = structuredClone(original)
    delete source.dependencies
    source.moduleBindings = { ...sourceModuleBindings(original) }
    source.resourceBindings = resourceBindings
    return source
  }
  const definition = (id: string) => {
    if (Object.hasOwn(definitions, id)) return
    const original = project.definitions[id]
    if (!original) throw new Error(`组件定义不存在：${id}`)
    definitions[id] = { ...structuredClone(original), implementation: implementation(original.implementation) }
    if (original.implementation.kind === 'source') for (const dependency of Object.values(sourceModuleBindings(original.implementation))) {
      if (project.definitions[dependency]?.implementation.kind !== 'source') throw new Error(`源码依赖不是可导入源码定义：${dependency}`)
      definition(dependency)
    }
  }
  const visit = (id: string) => {
    if (Object.hasOwn(instances, id)) return
    const original = project.instances[id]
    if (!original) throw new Error(`提炼对象不存在：${id}`)
    instances[id] = { ...structuredClone(original), ...(original.implementationOverride
      ? { implementationOverride: implementation(original.implementationOverride) } : {}) }
    definition(original.definitionId)
    for (const dependency of sourceDependencyIds(original)) {
      if (project.definitions[dependency]?.implementation.kind !== 'source') throw new Error(`源码依赖不是可导入源码定义：${dependency}`)
      definition(dependency)
    }
    for (const assetId of componentAssetIds(original, project.definitions[original.definitionId])) assetIds.add(assetId)
    for (const assetId of options.adapters?.[original.definitionId]?.references(original, project.definitions[original.definitionId]).assetIds ?? []) assetIds.add(assetId)
    for (const childId of original.childIds ?? []) visit(childId)
    for (const attachment of original.attachments ?? []) visit(attachment.instanceId)
  }
  options.rootIds.forEach(visit)
  if (!Object.keys(instances).length) throw new Error('请选择至少一个提炼对象')
  const children = new Set(Object.values(instances).flatMap(instance => instance.childIds ?? []))
  const rootIds = [...new Set([...options.rootIds, ...Object.keys(instances)])].filter(id => !children.has(id))
  const assets: ComponentLibraryEntry['assets'] = {}
  const bytes: ComponentLibraryEntry['resources']['assets'] = {}
  for (const id of assetIds) {
    if (project.assets[id]) assets[id] = structuredClone(project.assets[id])
    if (!project.assets[id] || !resources.assets[id]) {
      diagnostics.push({ code: 'missing-asset', message: `保留了待修复的素材引用：${id}` })
      continue
    }
    bytes[id] = Uint8Array.from(resources.assets[id])
  }
  for (const instance of Object.values(instances)) for (const target of [...declaredTargets(instance.data),
    ...interactionReferenceTargets(instance, definitions[instance.definitionId]),
    ...(instance.visibility?.mode !== 'all' ? instance.visibility?.surfaceIds ?? [] : []).map(surfaceId => ({ kind: 'surface' as const, surfaceId })),
    ...(instance.flowPlacement?.paragraphAnchor ? [{ kind: 'instance' as const, instanceId: instance.flowPlacement.paragraphAnchor.blockId }] : []),
    ...(instance.attachments ?? []).map(attachment => attachment.target)]) {
    if (target.kind === 'surface' || target.kind === 'instance' && !instances[target.instanceId]) diagnostics.push({
      code: 'target-binding-required', instanceId: instance.id, message: '跨工程插入需要绑定外部行为目标',
    })
  }
  for (const input of options.inputs ?? []) if (!instances[input.instanceId]) throw new Error(`输入角色不属于提炼对象：${input.instanceId}`)
  return { entry: { schemaVersion: 1, id: options.id, title: options.title, definitions,
    example: { instances, rootIds }, assets, resources: { assets: bytes, components },
    ...(options.inputs ? { inputs: structuredClone(options.inputs) } : {}) }, diagnostics }
}
