import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { componentAssetIds, interactionReferenceTargets, sourceModuleBindings,associatedInteractionRules, sourceResourceReferences } from './references'
import { liveSourceOwners } from '../compilation/liveSourceReferences'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { componentInteractionDataSchema } from '../../../shared/componentInteractionData'
import type { LibraryDiagnostic, LibraryExtractResult, LibraryReferenceAdapter } from './types'
import { resolveComponentBackground, resolveComponentPresentation, isComponentVisibleAtSurface } from '../../../shared/contracts/component-platform/project'
import { courseThemeStyleText, courseThemeVariables } from '../../../shared/contracts/design-v1/theme'

export interface ExtractLibraryOptions {
  id: string
  title: string
  rootIds?: string[]
  surfaceIds?: string[]
  kind?: ComponentLibraryEntry['kind']
  inputs?: ComponentLibraryEntry['inputs']
  adapters?: Readonly<Record<string, LibraryReferenceAdapter>>
}

/** Reads an author snapshot. The library owns copies; no live instance or byte buffer is retained. */
export function extractComponentLibraryEntry(project: CourseProjectV10, resources: ComponentLibraryEntry['resources'], options: ExtractLibraryOptions): LibraryExtractResult {
  const diagnostics: LibraryDiagnostic[] = []
  const instances: Record<string, ComponentInstance> = Object.create(null)
  const definitions: Record<string, ComponentDefinition> = Object.create(null)
  const assetIds = new Set<string>()
  const components: ComponentLibraryEntry['resources']['components'] = Object.create(null)
  const selectedSurfaces = options.surfaceIds?.length ? project.surfaces.filter(surface => options.surfaceIds!.includes(surface.id)) : []
  if (options.surfaceIds?.some(id => !selectedSurfaces.some(surface => surface.id === id))) throw new Error('提炼页面已不存在')
  if (options.kind === 'page' && selectedSurfaces.length !== 1) throw new Error('页面模板需要选择一个页面')
  const surfaces = selectedSurfaces.map(surface => ({ ...structuredClone(surface), background: { mode: 'own' as const, ...resolveComponentBackground(project, surface) } }))
  const selectedSurfaceIds = new Set(surfaces.map(surface => surface.id))
  const global = { underlay: [] as string[], overlay: [] as string[] }
  for (const plane of ['underlay', 'overlay'] as const) global[plane] = project.global[plane].filter(id =>
    selectedSurfaces.some(surface => isComponentVisibleAtSurface(project.instances[id], surface.id)
      || surface.presentation?.states.some(state => isComponentVisibleAtSurface(resolveComponentPresentation(project, surface.id, state.id).instances[id], surface.id))))
  const implementation = (original: ComponentImplementation): ComponentImplementation => {
    if (original.kind !== 'source') return structuredClone(original)
    const references = sourceResourceReferences(original, project, resources)
    const resourceBindings = { ...Object.fromEntries(references.assetIds.map(id => [id, id])), ...original.resourceBindings }
    if (references.dynamic) diagnostics.push({ code: 'dynamic-resource-scope-retained', message: '此源码的动态资源访问无法闭合，已保留当前可访问资源范围。' })
    for (const id of Object.values(resourceBindings)) assetIds.add(id)
    if (original.workspace) {
      const { ownerId, entry } = original.workspace, files = resources.components[ownerId]
      if (files) components[ownerId] = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]))
      if (!files || !Object.hasOwn(files, entry)) diagnostics.push({ code: 'missing-component-files',
        message: `源码文件尚未提供：${ownerId}/${entry}；源码归属已保留` })
    }
    const source = structuredClone(original)
    delete source.dependencies
    const live = liveSourceOwners(project, original, resources).modules.get(original)
    source.moduleBindings = Object.fromEntries(Object.entries(sourceModuleBindings(original)).filter(([, id]) => !live || live.has(id)))
    source.resourceBindings = resourceBindings
    return source
  }
  const definition = (id: string) => {
    if (Object.hasOwn(definitions, id)) return
    const original = Object.hasOwn(project.definitions,id) ? project.definitions[id] : undefined
    if (!original) throw new Error(`组件定义不存在：${id}`)
    definitions[id] = { ...structuredClone(original), implementation: implementation(original.implementation) }
    if (original.implementation.kind === 'source') for (const dependency of Object.values(sourceModuleBindings(definitions[id].implementation as Extract<ComponentImplementation, { kind: 'source' }>))) {
      if (!Object.hasOwn(project.definitions,dependency) || project.definitions[dependency].implementation.kind !== 'source') {diagnostics.push({code:'missing-source-dependency',message:`保留待修复的模块声明：${dependency}；实际导入由编译器诊断`});continue}
      definition(dependency)
    }
  }
  const visit = (id: string) => {
    if (Object.hasOwn(instances, id)) return
    const original = Object.hasOwn(project.instances,id) ? project.instances[id] : undefined
    if (!original) throw new Error(`提炼对象不存在：${id}`)
    instances[id] = { ...structuredClone(original), ...(selectedSurfaces.length && original.visibility ? { visibility: { mode: 'include' as const, surfaceIds: selectedSurfaces.filter(surface => isComponentVisibleAtSurface({ ...original, visible: true }, surface.id)).map(surface => surface.id) } } : {}), ...(original.implementationOverride
      ? { implementationOverride: implementation(original.implementationOverride) } : {}) }
    definition(original.definitionId)
    for (const dependency of instances[id].implementationOverride?.kind === 'source' ? Object.values(sourceModuleBindings(instances[id].implementationOverride)) : []) {
      if (!Object.hasOwn(project.definitions,dependency) || project.definitions[dependency].implementation.kind !== 'source') {diagnostics.push({code:'missing-source-dependency',message:`保留待修复的模块声明：${dependency}；实际导入由编译器诊断`});continue}
      definition(dependency)
    }
    for (const assetId of componentAssetIds(original, project.definitions[original.definitionId],project,resources)) assetIds.add(assetId)
    for (const assetId of options.adapters?.[original.definitionId]?.references(original, project.definitions[original.definitionId]).assetIds ?? []) assetIds.add(assetId)
    for (const childId of original.childIds ?? []) visit(childId)
    for (const attachment of original.attachments ?? []) visit(attachment.instanceId)
  }
  const requestedRoots = [...options.rootIds ?? [], ...surfaces.flatMap(surface => surface.childIds), ...global.underlay, ...global.overlay]
  requestedRoots.forEach(visit)
  const selected=new Set(Object.keys(instances))
  for(const original of Object.values(project.instances)) {
    if(selected.has(original.id) || componentDefinitionBuiltinKey(project.definitions[original.definitionId])!=='guoling.interactions')continue
    const data=componentInteractionDataSchema.parse(original.data),rules=associatedInteractionRules(data.rules,selected)
    if(!rules.length)continue
    visit(original.id);instances[original.id].data={...data,rules} as unknown as ComponentInstance['data']
  }
  if (!Object.keys(instances).length && !surfaces.length) throw new Error('请选择至少一个提炼对象或页面')
  const children = new Set(Object.values(instances).flatMap(instance => instance.childIds ?? []))
  const rootIds = [...new Set([...requestedRoots, ...Object.keys(instances)])].filter(id => !children.has(id))
  for (const surface of surfaces) {
    if (surface.background?.assetId) assetIds.add(surface.background.assetId)
    for (const state of surface.presentation?.states ?? []) {
      if (state.background?.assetId) assetIds.add(state.background.assetId)
      const effective = resolveComponentPresentation(project, surface.id, state.id)
      for (const id of Object.keys(state.overrides)) if (instances[id]) {
        for (const assetId of componentAssetIds(effective.instances[id], definitions[instances[id].definitionId], effective, resources)) assetIds.add(assetId)
      }
    }
  }
  if (surfaces.length) for (const asset of Object.values(project.theme?.assets ?? {})) if (asset.assetId) assetIds.add(asset.assetId)
  if (surfaces.length && (project.theme || project.designTokens)) {
    const tokens = project.designTokens ?? { fonts: [], colors: [] }
    const bindings: Record<string, string> = {}
    let themeResource = 0
    const css = courseThemeStyleText({ designTokens: tokens, theme: project.theme }, id => {
      const token = `cw-resource:library-theme-${themeResource++}`; bindings[token] = id; return token
    })
    for (const instance of Object.values(instances)) {
      const key = componentDefinitionBuiltinKey(definitions[instance.definitionId])
      instance.style = { ...courseThemeVariables(tokens), ...instance.style }
      if (['guoling.web', 'guoling.html-program'].includes(key ?? '') && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)) {
        const data = instance.data
        const originalBindings = data.resourceBindings && typeof data.resourceBindings === 'object' && !Array.isArray(data.resourceBindings) ? data.resourceBindings : {}
        instance.data = { ...data, css: css + '\n' + (typeof data.css === 'string' ? data.css : ''), resourceBindings: { ...bindings, ...originalBindings } }
      }
    }
  }
  const assets: ComponentLibraryEntry['assets'] = Object.create(null)
  const bytes: ComponentLibraryEntry['resources']['assets'] = Object.create(null)
  for (const id of assetIds) {
    if (project.assets[id]) assets[id] = structuredClone(project.assets[id])
    if (!project.assets[id] || !resources.assets[id]) {
      diagnostics.push({ code: 'missing-asset', message: `保留了待修复的素材引用：${id}` })
      continue
    }
    bytes[id] = Uint8Array.from(resources.assets[id])
  }
  for (const instance of Object.values(instances)) for (const target of [...interactionReferenceTargets(instance, definitions[instance.definitionId]),
    ...(instance.visibility?.mode !== 'all' ? instance.visibility?.surfaceIds ?? [] : []).map(surfaceId => ({ kind: 'surface' as const, surfaceId })),
    ...(instance.flowPlacement?.paragraphAnchor ? [{ kind: 'instance' as const, instanceId: instance.flowPlacement.paragraphAnchor.blockId }] : []),
    ...(instance.attachments ?? []).map(attachment => attachment.target)]) {
    if (target.kind === 'surface' && !selectedSurfaceIds.has(target.surfaceId) || (target.kind === 'instance' || target.kind === 'text-range') && !instances[target.instanceId]) diagnostics.push({
      code: 'target-binding-required', instanceId: instance.id, message: '跨工程插入需要绑定外部行为目标',
    })
  }
  for (const input of options.inputs ?? []) if (!instances[input.instanceId]) throw new Error(`输入角色不属于提炼对象：${input.instanceId}`)
  return { entry: { schemaVersion: 1, id: options.id, title: options.title, definitions,
    example: { instances, rootIds }, assets, resources: { assets: bytes, components },
    ...(surfaces.length ? { kind: options.kind ?? (surfaces.length === 1 ? 'page' : 'structure'), surfaces, global,
      ...(project.theme ? { theme: structuredClone(project.theme) } : {}), ...(project.designTokens ? { designTokens: structuredClone(project.designTokens) } : {}),
      ...(project.logic ? { logic: structuredClone(project.logic) } : {}) } : {}),
    ...(options.inputs ? { inputs: structuredClone(options.inputs) } : {}) }, diagnostics }
}
