import type { ComponentDefinition, ComponentImplementation, ComponentInstance, CourseProjectV10, JsonValue } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import { liveSourceOwners, parseSourceSyntax, type SourceSyntaxNode } from '../compilation/liveSourceReferences'
import { componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { componentInteractionDataSchema, remapComponentInteractionData } from '../../../shared/componentInteractionData'
import type { LibraryIdentityMap } from './types'
import { isWebDocumentDeclaration } from '../source/sourceDocumentDeclaration'

type SourceResources = { assetIds: string[]; dynamic: boolean }
type ResourceSyntax = { names: string[]; dynamic: boolean }

/** Resource names are syntax facts; each source owner resolves its own bindings. */
function sourceResourceSyntax(ast: SourceSyntaxNode | undefined): ResourceSyntax {
  const names = new Set<string>()
  let dynamic = !ast
  type Node = { type: string; [key: string]: unknown }
  const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && typeof (value as Node).type === 'string'
  const member = (node: Node, key: string) => node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression'
    ? isNode(node.property) && (node.computed ? node.property.value === key : node.property.name === key) : false
  const resourceObject = (node: Node) => node.type === 'Identifier' && node.name === 'resources' || member(node, 'resources')
  const visit = (node: Node, parent?: Node) => {
    // The explicit document consumer may resolve HTML assets through the host,
    // even when the author's mount never calls resources.url itself.
    if (isWebDocumentDeclaration(node)) dynamic = true
    if (['ObjectProperty', 'Property'].includes(node.type) && isNode(node.key)
      && (node.key.name === 'resources' || node.key.value === 'resources')
      && (!isNode(node.value) || node.value.type !== 'Identifier' || node.value.name !== 'resources')) dynamic = true
    if (member(node, 'url') && isNode(node.object) && resourceObject(node.object)
      && !(parent && ['CallExpression', 'OptionalCallExpression'].includes(parent.type) && parent.callee === node)) dynamic = true
    if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && isNode(node.callee)
      && member(node.callee, 'url') && isNode(node.callee.object) && resourceObject(node.callee.object)) {
      const argument = (node.arguments as unknown[])[0]
      const name = isNode(argument) && (argument.type === 'StringLiteral' || argument.type === 'Literal') && typeof argument.value === 'string' ? argument.value
        : isNode(argument) && argument.type === 'TemplateLiteral' && !(argument.expressions as unknown[]).length
          ? ((argument.quasis as Node[])[0]?.value as { cooked?: string })?.cooked : undefined
      if (name === undefined) dynamic = true
      else names.add(name)
    }
    if (member(node, 'resources') && !(parent && member(parent, 'url') && parent.object === node)) dynamic = true
    // An aliased or destructured resources capability cannot be closed by literal-call inspection.
    if (node.type === 'Identifier' && node.name === 'resources' && parent
      && !(member(parent, 'url') && parent.object === node) && !(member(parent, 'resources') && parent.property === node)
      && !['ObjectProperty', 'Property', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) dynamic = true
    for (const value of Object.values(node)) {
      if (isNode(value)) visit(value, node)
      else if (Array.isArray(value)) for (const child of value) if (isNode(child)) visit(child, node)
    }
  }
  if (isNode(ast)) visit(ast)
  return { names: [...names], dynamic }
}

export interface ComponentReferenceCapture {
  sourceOwners(implementation: ComponentImplementation, project?: CourseProjectV10): ReturnType<typeof liveSourceOwners>
  sourceResourceReferences(implementation: ComponentImplementation, project?: CourseProjectV10): SourceResources
  componentAssetIds(instance: ComponentInstance, definition: ComponentDefinition, project?: CourseProjectV10): string[]
}

/** Fixed project/resources preparation only. Recreate after edits or resource changes.
 * Presentation snapshots share syntax, while each project and source keeps its own identities. */
export function createComponentReferenceCapture(project: CourseProjectV10, resources?: DocumentResources): ComponentReferenceCapture {
  const syntax = new Map<string, SourceSyntaxNode | undefined>()
  const imports = new Map<string, string[] | undefined>()
  const resourceSyntax = new Map<string, ResourceSyntax>()
  const projects = new Map<CourseProjectV10['definitions'], {
    owners: Map<ComponentImplementation, ReturnType<typeof liveSourceOwners>>
    resources: Map<CourseProjectV10['assets'], Map<ComponentImplementation, SourceResources>>
  }>()
  const capture = (current: CourseProjectV10) => {
    let value = projects.get(current.definitions)
    if (!value) { value = { owners: new Map(), resources: new Map() }; projects.set(current.definitions, value) }
    let references = value.resources.get(current.assets)
    if (!references) { references = new Map(); value.resources.set(current.assets, references) }
    return { owners: value.owners, resources: references }
  }
  const readSyntax = (text: string) => {
    if (!syntax.has(text)) syntax.set(text, parseSourceSyntax(text))
    return syntax.get(text)
  }
  const sourceOwners: ComponentReferenceCapture['sourceOwners'] = (implementation, current = project) => {
    const values = capture(current).owners
    let owners = values.get(implementation)
    if (!owners) { owners = liveSourceOwners(current, implementation, resources, imports, readSyntax); values.set(implementation, owners) }
    return owners
  }
  const resourceReferences: ComponentReferenceCapture['sourceResourceReferences'] = (implementation, current = project) => {
    const values = capture(current).resources
    let result = values.get(implementation)
    if (result) return result
    if (implementation.kind !== 'source') result = { assetIds: [], dynamic: false }
    else {
      const ids = new Set<string>(), owners = sourceOwners(implementation, current)
      let dynamic = !owners.sources.has(implementation)
      for (const [owner, texts] of owners.sources) {
        Object.values(owner.resourceBindings ?? {}).forEach(id => ids.add(id))
        for (const text of texts) {
          let analyzed = resourceSyntax.get(text)
          if (!analyzed) { analyzed = sourceResourceSyntax(readSyntax(text)); resourceSyntax.set(text, analyzed) }
          for (const name of analyzed.names) ids.add(owner.resourceBindings?.[name] ?? name)
          dynamic ||= analyzed.dynamic
        }
      }
      if (dynamic) Object.keys(current.assets).forEach(id => ids.add(id))
      result = { assetIds: [...ids], dynamic }
    }
    values.set(implementation, result)
    return result
  }
  return { sourceOwners, sourceResourceReferences: resourceReferences,
    componentAssetIds(instance, definition, current = project) {
      const implementation = instance.implementationOverride ?? definition.implementation
      const dependencies = [...sourceOwners(implementation, current).definitions].flatMap(id => Object.hasOwn(current.definitions, id)
        ? sourceAssetIds(current.definitions[id].implementation) : [])
      return [...new Set([...componentAssetIds(instance, definition), ...dependencies, ...resourceReferences(implementation, current).assetIds])]
    },
  }
}

/** Literal resource lookups are closed; computed/aliased API access keeps its existing fallback range. */
export function sourceResourceReferences(implementation: ComponentImplementation, project: CourseProjectV10, resources?: DocumentResources): SourceResources {
  return createComponentReferenceCapture(project, resources).sourceResourceReferences(implementation)
}

function isWebInstance(instance: ComponentInstance, definition: ComponentDefinition): boolean {
  const implementation = instance.implementationOverride ?? definition.implementation
  // A Web-derived source still consumes its formal Web data bindings. Its
  // professional identity does not replace the effective custom renderer.
  const key = implementation.kind === 'builtin' ? implementation.key : componentDefinitionBuiltinKey(definition)
  return key === 'guoling.web' || key === 'guoling.html-program'
}

/** Author records keep tokens; only the author's declared binding values are identities. */
export function authoringAssetIds(authoring: ComponentInstance['authoring']): string[] {
  return Object.values(authoring?.resourceBindings ?? {})
}

export function rebindAuthoringAssets(authoring: ComponentInstance['authoring'], identities: LibraryIdentityMap): ComponentInstance['authoring'] {
  if (!authoring?.resourceBindings) return authoring
  return { ...authoring, resourceBindings: Object.fromEntries(Object.entries(authoring.resourceBindings)
    .map(([token, id]) => [token, identities.assets.get(id) ?? id])) }
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
  if (instance.authoring) instance = { ...instance, authoring: rebindAuthoringAssets(instance.authoring, identities) }
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
export function componentAssetIds(instance: ComponentInstance, definition: ComponentDefinition,project?:CourseProjectV10,resources?:DocumentResources): string[] {
  if (project) return createComponentReferenceCapture(project, resources).componentAssetIds(instance, definition)
  const implementation=instance.implementationOverride ?? definition.implementation,key=componentDefinitionBuiltinKey(definition)
  return [...new Set([...(key ? professionalAssetIds(instance.data,key):[]), ...webAssetIds(instance, definition), ...authoringAssetIds(instance.authoring),
    ...sourceAssetIds(implementation)])]
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
  instanceTarget: (id: string) => string, surfaceTarget: (id: string) => string,
  ruleIdentities?: { rules?: ReadonlyMap<string, string>; actions?: ReadonlyMap<string, string>; stateKeys?: ReadonlyMap<string, string> }): ComponentInstance {
  if (componentDefinitionBuiltinKey(definition) !== 'guoling.interactions') return instance
  const references = interactionReferenceTargets(instance, definition)
  const instances = new Map(references.filter(target => target.kind === 'instance').map(target => [target.instanceId, instanceTarget(target.instanceId)]))
  const surfaces = new Map(references.filter(target => target.kind === 'surface').map(target => [target.surfaceId, surfaceTarget(target.surfaceId)]))
  return { ...instance, data: remapComponentInteractionData(instance.data, { instances, surfaces, ...ruleIdentities }) }
}

/** Declared professional asset fields only; ordinary strings are never identity references. */
export function professionalAssetIds(value: JsonValue,builtinKey?:string): string[] {
  const ids = new Set<string>()
  const visit = (current: JsonValue) => {
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (!current || typeof current !== 'object') return
    for (const [key, item] of Object.entries(current)) {
      if ((key === 'assetId' || key === 'originalAssetId' || builtinKey==='guoling.navigation' && key==='backgroundAssetId') && typeof item === 'string' && item.length > 0) ids.add(item)
      else visit(item)
    }
  }
  visit(value)
  return [...ids]
}

export function rebindProfessionalAssets(value: JsonValue, identities: LibraryIdentityMap,builtinKey?:string): JsonValue {
  if (Array.isArray(value)) return value.map(item => rebindProfessionalAssets(item, identities,builtinKey))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    (key === 'assetId' || key === 'originalAssetId' || builtinKey==='guoling.navigation' && key==='backgroundAssetId') && typeof item === 'string'
      ? identities.assets.get(item) ?? item : rebindProfessionalAssets(item, identities,builtinKey)]))
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
