import type { ComponentDefinition, ComponentImplementation, ComponentInstance, JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { componentInteractionDataSchema, remapComponentInteractionData } from '../../../shared/componentInteractionData'
import type { LibraryIdentityMap } from './types'

function isWebInstance(instance: ComponentInstance, definition: ComponentDefinition): boolean {
  const implementation = instance.implementationOverride ?? definition.implementation
  return implementation.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
}

export function webAssetIds(instance: ComponentInstance, definition: ComponentDefinition): string[] {
  if (!isWebInstance(instance, definition)) return []
  const data = instance.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const bindings = data.resourceBindings
  return bindings && typeof bindings === 'object' && !Array.isArray(bindings)
    ? Object.values(bindings).filter((value): value is string => typeof value === 'string') : []
}

/** The reference token stays in HTML/CSS. Only the formal binding value is an asset identity. */
export function rebindWebAssets(instance: ComponentInstance, definition: ComponentDefinition, identities: LibraryIdentityMap): ComponentInstance {
  if (!isWebInstance(instance, definition)) return instance
  const data = instance.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return instance
  const bindings = data.resourceBindings
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return instance
  return { ...instance, data: { ...data, resourceBindings: Object.fromEntries(Object.entries(bindings)
    .map(([token, id]) => [token, typeof id === 'string' ? identities.assets.get(id) ?? id : id])) } }
}

/** Formal declarations remain references even when their resource bytes are unavailable. */
export function sourceAssetIds(implementation: ComponentImplementation): string[] {
  return implementation.kind === 'source' ? Object.values(implementation.resourceBindings ?? {}) : []
}

/** Shared by library/clipboard closure and the Driver's live resource consumer. */
export function componentAssetIds(instance: ComponentInstance, definition: ComponentDefinition): string[] {
  return [...new Set([...professionalAssetIds(instance.data), ...webAssetIds(instance, definition),
    ...sourceAssetIds(instance.implementationOverride ?? definition.implementation)])]
}

/** Declared native interaction fields use the professional rule parser, never string substitution. */
export function interactionReferenceTargets(instance: ComponentInstance, definition: ComponentDefinition): ReturnType<typeof declaredTargets> {
  if (componentDefinitionBuiltinKey(definition) !== 'guoling.interactions') return []
  const targets: ReturnType<typeof declaredTargets> = []
  for (const rule of componentInteractionDataSchema.parse(instance.data).rules) {
    if ('nodeId' in rule.trigger) targets.push({ kind: 'instance', instanceId: rule.trigger.nodeId })
    for (const condition of rule.conditions) if (condition.type === 'scene.in') {
      targets.push(...condition.sceneIds.map(surfaceId => ({ kind: 'surface' as const, surfaceId })))
    }
    for (const { action } of rule.actions) {
      if ('nodeId' in action) targets.push({ kind: 'instance', instanceId: action.nodeId })
      if (action.type === 'scene.go') targets.push({ kind: 'surface', surfaceId: action.sceneId })
      if (action.type === 'location.go') targets.push({ kind: 'surface', surfaceId: action.locationId })
    }
  }
  return targets
}

export function rebindInteractionReferences(instance: ComponentInstance, definition: ComponentDefinition,
  instanceTarget: (id: string) => string, surfaceTarget: (id: string) => string): ComponentInstance {
  if (componentDefinitionBuiltinKey(definition) !== 'guoling.interactions') return instance
  const references = interactionReferenceTargets(instance, definition)
  const instances = new Map(references.filter(target => target.kind === 'instance').map(target => [target.instanceId, instanceTarget(target.instanceId)]))
  const surfaces = new Map(references.filter(target => target.kind === 'surface').map(target => [target.surfaceId, surfaceTarget(target.surfaceId)]))
  return { ...instance, data: remapComponentInteractionData(instance.data, { instances, surfaces }) }
}

/** Declared professional asset fields only; ordinary strings are never identity references. */
export function professionalAssetIds(value: JsonValue): string[] {
  const ids = new Set<string>()
  const visit = (current: JsonValue) => {
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (!current || typeof current !== 'object') return
    for (const [key, item] of Object.entries(current)) {
      if ((key === 'assetId' || key === 'originalAssetId') && typeof item === 'string' && item.length > 0) ids.add(item)
      else visit(item)
    }
  }
  visit(value)
  return [...ids]
}

export function rebindProfessionalAssets(value: JsonValue, identities: LibraryIdentityMap): JsonValue {
  if (Array.isArray(value)) return value.map(item => rebindProfessionalAssets(item, identities))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    (key === 'assetId' || key === 'originalAssetId') && typeof item === 'string'
      ? identities.assets.get(item) ?? item : rebindProfessionalAssets(item, identities)]))
}

export function declaredTargets(value: JsonValue): Array<{ kind: 'instance'; instanceId: string } | { kind: 'surface'; surfaceId: string }> {
  if (Array.isArray(value)) return value.flatMap(declaredTargets)
  if (!value || typeof value !== 'object') return []
  if (value.kind === 'instance' && typeof value.instanceId === 'string') return [{ kind: 'instance', instanceId: value.instanceId }]
  if (value.kind === 'surface' && typeof value.surfaceId === 'string') return [{ kind: 'surface', surfaceId: value.surfaceId }]
  return Object.values(value).flatMap(declaredTargets)
}

export function rebindDeclaredTargets(value: JsonValue, instanceId: (id: string) => string, surfaceId: (id: string) => string): JsonValue {
  if (Array.isArray(value)) return value.map(item => rebindDeclaredTargets(item, instanceId, surfaceId))
  if (!value || typeof value !== 'object') return value
  if (value.kind === 'instance' && typeof value.instanceId === 'string') return { ...value, instanceId: instanceId(value.instanceId) }
  if (value.kind === 'surface' && typeof value.surfaceId === 'string') return { ...value, surfaceId: surfaceId(value.surfaceId) }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebindDeclaredTargets(item, instanceId, surfaceId)]))
}

export function sourceDependencyIds(instance: ComponentInstance): string[] {
  return instance.implementationOverride?.kind === 'source'
    ? Object.values(sourceModuleBindings(instance.implementationOverride)) : []
}

/** Author specifiers are scoped to this source owner; only values are software identities. */
export function sourceModuleBindings(implementation: Extract<ComponentImplementation, { kind: 'source' }>): Record<string, string> {
  return implementation.moduleBindings ?? Object.fromEntries((implementation.dependencies ?? []).map(id => [id, id]))
}
