import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { createComponentReferenceCapture, interactionReferenceTargets, sourceModuleBindings, type ComponentReferenceCapture } from './references'
import { componentDefinitionBuiltinKey, componentSurface } from '../../../shared/contracts/component-platform/project'
import { associatedComponentInteractionRules, componentInteractionDataSchema } from '../../../shared/componentInteractionData'
import type { LibraryDiagnostic, LibraryExtractResult, LibraryReferenceAdapter } from './types'
import { resolveComponentBackground, resolveComponentPresentation, isComponentVisibleAtSurface, owningContainer } from '../../../shared/contracts/component-platform/project'
import { courseThemeStyleText, courseThemeVariables } from '../../../shared/contracts/design-v1/theme'
import { componentBackgroundAssetIds, mergeComponentBackground } from '../../../shared/componentBackgroundPaint'
import { componentInputStateReferences } from '../../../components/input/authoring'

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
export function extractComponentLibraryEntry(project: CourseProjectV10, resources: ComponentLibraryEntry['resources'], options: ExtractLibraryOptions,
  references: ComponentReferenceCapture = createComponentReferenceCapture(project, resources)): LibraryExtractResult {
  const diagnostics: LibraryDiagnostic[] = []
  const instances: Record<string, ComponentInstance> = Object.create(null)
  const definitions: Record<string, ComponentDefinition> = Object.create(null)
  const assetIds = new Set<string>()
  const components: ComponentLibraryEntry['resources']['components'] = Object.create(null)
  const selectedSurfaces = (options.surfaceIds ?? []).flatMap(id => { const surface = componentSurface(project, id); return surface ? [surface] : [] })
  if (options.surfaceIds?.some(id => !selectedSurfaces.some(surface => surface.id === id))) throw new Error('提炼页面已不存在')
  if (options.kind === 'page' && selectedSurfaces.length !== 1) throw new Error('页面模板需要选择一个页面')
  let surfaces: ComponentSurface[] = selectedSurfaces.map(surface => ({ ...structuredClone(surface), background: mergeComponentBackground(undefined, { mode: 'own', ...structuredClone(resolveComponentBackground(project, surface)) }) }))
  const selectedSurfaceIds = new Set(surfaces.map(surface => surface.id))
  const global = { underlay: [] as string[], overlay: [] as string[] }
  for (const plane of ['underlay', 'overlay'] as const) global[plane] = project.global[plane].filter(id =>
    componentDefinitionBuiltinKey(project.definitions[project.instances[id].definitionId]) !== 'guoling.interactions' && selectedSurfaces.some(surface => isComponentVisibleAtSurface(project.instances[id], surface.id)
      || surface.presentation?.states.some(state => isComponentVisibleAtSurface(resolveComponentPresentation(project, surface.id, state.id).instances[id], surface.id))))
  if (global.underlay.length) for (const surface of surfaces) {
    const original = selectedSurfaces.find(value => value.id === surface.id)!
    if (original.background?.mode === 'own') continue
    surface.background = structuredClone(original.background)
    if (project.background) diagnostics.push({ code: 'background-host-inherited',
      message: '模板保留全局背景对象和页面继承关系；基础底色/底图使用插入目标作品背景，避免把作品底图提升为遮挡动态层的页面背景。' })
  }
  const implementation = (original: ComponentImplementation): ComponentImplementation => {
    if (original.kind !== 'source') return structuredClone(original)
    const sourceReferences = references.sourceResourceReferences(original)
    const resourceBindings = { ...Object.fromEntries(sourceReferences.assetIds.map(id => [id, id])), ...original.resourceBindings }
    if (sourceReferences.dynamic) diagnostics.push({ code: 'dynamic-resource-scope-retained', message: '此源码的动态资源访问无法闭合，已保留当前可访问资源范围。' })
    for (const id of Object.values(resourceBindings)) assetIds.add(id)
    if (original.workspace) {
      const { ownerId, entry } = original.workspace, files = resources.components[ownerId]
      if (files) components[ownerId] = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]))
      if (!files || !Object.hasOwn(files, entry)) diagnostics.push({ code: 'missing-component-files',
        message: `源码文件尚未提供：${ownerId}/${entry}；源码归属已保留` })
    }
    const source = structuredClone(original)
    delete source.dependencies
    const live = references.sourceOwners(original).modules.get(original)
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
    instances[id] = { ...structuredClone(original), ...(selectedSurfaces.length && [...global.underlay, ...global.overlay].includes(id) ? { visibility: { mode: 'include' as const, surfaceIds: selectedSurfaces.filter(surface => isComponentVisibleAtSurface({ ...original, visible: true }, surface.id)).map(surface => surface.id) } } : {}), ...(original.implementationOverride
      ? { implementationOverride: implementation(original.implementationOverride) } : {}) }
    if (instances[id].container) {
      // A detached page template retains its one root appearance; nested containers keep authored inheritance.
      const selected = surfaces.find(surface => surface.id === id)
      if (selected) instances[id].container!.background = selected.background
      selectedSurfaceIds.add(id)
    }
    definition(original.definitionId)
    for (const dependency of instances[id].implementationOverride?.kind === 'source' ? Object.values(sourceModuleBindings(instances[id].implementationOverride)) : []) {
      if (!Object.hasOwn(project.definitions,dependency) || project.definitions[dependency].implementation.kind !== 'source') {diagnostics.push({code:'missing-source-dependency',message:`保留待修复的模块声明：${dependency}；实际导入由编译器诊断`});continue}
      definition(dependency)
    }
    for (const assetId of references.componentAssetIds(original, project.definitions[original.definitionId])) assetIds.add(assetId)
    for (const assetId of options.adapters?.[original.definitionId]?.references(original, project.definitions[original.definitionId]).assetIds ?? []) assetIds.add(assetId)
    for (const childId of original.childIds ?? []) visit(childId)
    for (const attachment of original.attachments ?? []) visit(attachment.instanceId)
  }
  const requestedRoots = [...options.rootIds ?? [], ...surfaces.map(surface => surface.id), ...global.underlay, ...global.overlay]
  requestedRoots.forEach(visit)
  // These descriptors share only this detached entry's container configuration, never the live project.
  surfaces = Object.values(instances).flatMap(instance => instance.container
    ? [{ ...instance.container, id: instance.id, title: instance.name ?? instance.id, childIds: instance.childIds ?? [] }] : [])
  const selected=new Set(Object.keys(instances))
  const familySnapshots = [associatedComponentInteractionRules(project, selected), ...surfaces.flatMap(surface => (surface.presentation?.states ?? [])
    .map(state => associatedComponentInteractionRules(project, selected, new Set(), Object.fromEntries(Object.entries(state.overrides)
      .flatMap(([id, override]) => override.data === undefined ? [] : [[id, override.data]])))))]
  const externalIds = new Set(familySnapshots.flat().filter(family => !selected.has(family.instance.id)).map(family => family.instance.id))
  for (const id of externalIds) {
    visit(id)
    instances[id].data = { rules: familySnapshots[0].find(family => family.instance.id === id)?.rules ?? [] } as unknown as ComponentInstance['data']
    const family = familySnapshots.flat().find(family => family.instance.id === id)!
    if (family.target.kind === 'project') {
      let owner = owningContainer(project, id)
      while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
      const plane = owner?.kind === 'global' ? owner.plane : 'underlay'
      if (!global[plane].includes(id)) global[plane].push(id)
    }
  }
  // A local rule's excluded container scope is an external host binding, not an ordinary missing object target.
  for (const instance of Object.values(instances)) if (componentDefinitionBuiltinKey(definitions[instance.definitionId]) === 'guoling.interactions') {
    instance.attachments = instance.attachments?.map(attachment => attachment.target.kind === 'instance'
      && !instances[attachment.target.instanceId] && (project.instances[attachment.target.instanceId]?.container || project.rootIds.includes(attachment.target.instanceId))
      ? { ...attachment, target: { kind: 'surface', surfaceId: attachment.target.instanceId } } : attachment)
  }
  let snapshot = 1
  for (const surface of surfaces) for (const state of surface.presentation?.states ?? []) {
    const families = familySnapshots[snapshot++]
    for (const id of externalIds) {
      const rules = families.find(family => family.instance.id === id)?.rules ?? []
      const base = familySnapshots[0].find(family => family.instance.id === id)?.rules ?? []
      if (state.overrides[id]?.data !== undefined || JSON.stringify(rules) !== JSON.stringify(base)) state.overrides[id] = { ...state.overrides[id],
        data: { rules } as unknown as ComponentInstance['data'] }
    }
  }
  if (!Object.keys(instances).length && !surfaces.length) throw new Error('请选择至少一个提炼对象或页面')
  const children = new Set(Object.values(instances).flatMap(instance => instance.childIds ?? []))
  const globalIds = new Set([...global.underlay, ...global.overlay])
  const rootIds = [...new Set([...requestedRoots, ...Object.keys(instances)])].filter(id => !children.has(id) && !globalIds.has(id))
  for (const surface of surfaces) {
    componentBackgroundAssetIds(surface.background).forEach(id => assetIds.add(id))
    for (const state of surface.presentation?.states ?? []) {
      componentBackgroundAssetIds(state.background).forEach(id => assetIds.add(id))
      const effective = resolveComponentPresentation(project, surface.id, state.id)
      for (const id of Object.keys(state.overrides)) if (instances[id]) {
        for (const assetId of references.componentAssetIds(effective.instances[id], definitions[instances[id].definitionId], effective)) assetIds.add(assetId)
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
  const referencedStateKeys = new Set<string>()
  for (const instance of Object.values(instances)) {
    Object.values(instance.stateBindings ?? {}).forEach(key => referencedStateKeys.add(key))
    const key = componentDefinitionBuiltinKey(definitions[instance.definitionId])
    if (key === 'guoling.input') {
      for (const reference of componentInputStateReferences(instance.data)) referencedStateKeys.add(reference.key)
    } else if (key === 'guoling.interactions') for (const rule of componentInteractionDataSchema.parse(instance.data).rules) {
      for (const condition of rule.conditions) if (condition.type === 'course-state.exists' || condition.type === 'course-state.compare') referencedStateKeys.add(condition.key)
      for (const { action } of rule.actions) if (action.type === 'course-state.set') referencedStateKeys.add(action.key)
    }
  }
  const declarations = project.logic?.courseState.filter(state => referencedStateKeys.has(state.key)) ?? []
  const logic = surfaces.length ? project.logic && structuredClone(project.logic)
    : declarations.length ? { courseState: structuredClone(declarations), navigationGuards: [] } : undefined
  return { entry: { schemaVersion: 2, id: options.id, title: options.title, definitions,
    example: { instances, rootIds }, assets, resources: { assets: bytes, components },
    ...(global.underlay.length || global.overlay.length ? { global } : {}),
    ...(surfaces.length ? { kind: options.kind ?? (selectedSurfaces.length ? selectedSurfaces.length === 1 ? 'page' : 'structure' : 'objects'),
      ...(project.theme ? { theme: structuredClone(project.theme) } : {}), ...(project.designTokens ? { designTokens: structuredClone(project.designTokens) } : {}),
    } : {}),
    ...(logic ? { logic } : {}),
    ...(options.inputs ? { inputs: structuredClone(options.inputs) } : {}) }, diagnostics }
}
