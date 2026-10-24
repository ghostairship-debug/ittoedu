import { equalComponentValue } from '../../shared/componentValue'
import { componentTextRelationshipEdits, type TextRelationshipPlanOptions } from '../course/componentTextRelationshipEdits'
import { canonicalNavigationGuard, removeNavigationGuardSurfaces } from '../../shared/courseNavigationGuards'
import { allDocumentTextSlots, documentComponentDataVersions, inlineComponentIds } from '../../shared/document/textInteraction'
import { createComponentReferenceCapture } from '../components/library/references'
import { componentBackgroundAssetIds } from '../../shared/componentBackgroundPaint'
import type { DocumentResources } from '../../shared/workbench/document'
import type { ComponentAppliedChanges, ComponentEdit, ComponentExpectation, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, resolveComponentPresentation, containerChildIds, owningContainer, componentSurfaces, componentSurface, componentContainers, componentContainerBuiltinKey, createComponentContainerInstance, type ComponentContainer, type ComponentSurface, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import { componentOperationBatchSchema, componentAuthoringSchema, componentInstanceSchema, courseProjectV10Schema, jsonValueSchema } from '../../shared/contracts/component-platform/schema'
import { componentInteractionDataSchema } from '../../shared/componentInteractionData'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { DEFAULT_SLIDE_CANVAS, sharedSlideFrameMapping } from '../../shared/slideCanvas'
import { IDENTITY_MATRIX, multiplyMatrices, type AffineMatrix } from '../components/geometry'
import { isNativeFlowLayoutGroup } from '../../shared/flowNativeLayout'

/** The formal parent chain defines coordinates for every authoring entry. */
export function componentParentMatrix(project: CourseProjectV10, id: string): AffineMatrix {
  const owner = owningContainer(project, id)
  if (owner?.kind !== 'instance') return IDENTITY_MATRIX
  const parent = project.instances[owner.instanceId]
  return multiplyMatrices(componentParentMatrix(project, parent.id), parent.frame?.transform ?? IDENTITY_MATRIX)
}

export class ComponentOperationConflict extends Error {
  readonly code = 'component-field-conflict'
  constructor(readonly path: string[], message = `目标内容或归属已变化：${path.join('.')}`) { super(message) }
}

/** Legacy surface addresses resolve once to the canonical container instance. */
function surfacePath(project: CourseProjectV10, id: string, path: readonly string[]): string[] {
  if (path[0] === 'id') return ['instances', id, 'id', ...path.slice(1)]
  if (path[0] === 'title') return ['instances', id, 'name', ...path.slice(1)]
  if (path[0] === 'childIds') return ['instances', id, 'childIds', ...path.slice(1)]
  return ['instances', id, 'container', ...path]
}

function writeSurfaceField(project: CourseProjectV10, id: string, path: string[], value: JsonValue): void {
  writeField(project, surfacePath(project, id, path), value)
}

function containingSurfaceId(project: CourseProjectV10, instanceId: string): string | undefined {
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') {
    if (project.instances[owner.instanceId]?.container) return owner.instanceId
    owner = owningContainer(project, owner.instanceId)
  }
  return owner?.kind === 'surface' ? owner.surfaceId : undefined
}

function surfaceDefinitionId(project: CourseProjectV10, kind: ComponentSurface['kind']): string {
  const key = componentContainerBuiltinKey(kind)
  const existing = Object.values(project.definitions).find(definition => definition.implementation.kind === 'builtin' && definition.implementation.key === key)
  if (existing) return existing.id
  const base = `builtin:${key}`
  let id = base, suffix = 1
  while (Object.hasOwn(project.definitions, id)) id = `${base}:${suffix++}`
  return id
}

function insertSurface(project: CourseProjectV10, surface: ComponentSurface, index: number): void {
  if (Object.hasOwn(project.instances, surface.id)) throw new Error('容器实例身份已存在')
  const roots = componentSurfaces(project)
  if (index > roots.length) throw new Error('表面插入位置已不存在')
  const definitionId = surfaceDefinitionId(project, surface.kind)
  if (!Object.hasOwn(project.definitions, definitionId)) Object.defineProperty(project.definitions, definitionId,
    { value: { id: definitionId, role: 'mixed', implementation: { kind: 'builtin', key: componentContainerBuiltinKey(surface.kind) } }, enumerable: true, configurable: true, writable: true })
  Object.defineProperty(project.instances, surface.id,
    { value: createComponentContainerInstance(surface, definitionId), enumerable: true, configurable: true, writable: true })
  const rootIndex = roots[index] ? project.rootIds.indexOf(roots[index].id) : project.rootIds.length
  const wasEmpty = project.rootIds.length === 0
  project.rootIds.splice(rootIndex, 0, surface.id)
  if (wasEmpty && !project.entry) project.entry = { rootInstanceId: surface.id }
}

export function componentValueAt(project: CourseProjectV10, path: string[]): { exists: boolean; value?: JsonValue } {
  if (path[0] === '@surfaceOrder') return { exists: true, value: componentSurfaces(project).map(surface => surface.id) }
  if (path[0] === '@surface') {
    const surface = componentSurface(project, path[1])
    if (!surface) return { exists: false }
    if (path.length === 2) return { exists: true, value: surface as unknown as JsonValue }
    let value: unknown = surface
    for (const part of path.slice(2)) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return { exists: false }
      value = (value as Record<string, unknown>)[part]
    }
    return { exists: true, value: value as JsonValue }
  }
  if (path[0] === '@owner' && path.length === 2) {
    const owner = owningContainer(project, path[1])
    return owner ? { exists: true, value: owner as unknown as JsonValue } : { exists: false }
  }
  let value: unknown = project
  for (const part of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return { exists: false }
    value = (value as Record<string, unknown>)[part]
  }
  return { exists: true, value: value as JsonValue }
}

/** Array indexes locate a field; authored row/item/cell identities keep that field on its original object. */
export function componentFieldIdentityPaths(project: CourseProjectV10, path: readonly string[]): string[][] {
  const identities: string[][] = []
  // An internal authorKey is local to its instance; rebinding it changes the selected object.
  if (path[0] === 'instances' && path[2] === 'authoring' && path[3] === 'records' && path.length > 5) {
    const record = path.slice(0, 5)
    identities.push(...['kind', 'scope', 'binding'].map(field => [...record, field]))
  }
  for (let length = 3; length < path.length; length++) {
    const parent = path.slice(0, length), field = componentValueAt(project, parent)
    if (!field.exists || !field.value || typeof field.value !== 'object' || Array.isArray(field.value)) continue
    for (const name of ['id', 'columnId']) if (typeof field.value[name] === 'string') identities.push([...parent, name])
  }
  return identities
}

export function containerPath(project: CourseProjectV10, container: ComponentContainer): string[] {
  if (container.kind === 'project') return ['rootIds']
  if (container.kind === 'global') return ['global', container.plane]
  if (container.kind === 'instance') return ['instances', container.instanceId, 'childIds']
  return surfacePath(project, container.surfaceId, ['childIds'])
}

function descendantIds(project: CourseProjectV10, instanceId: string): string[] {
  const instance = project.instances[instanceId]
  if (!instance) throw new ComponentOperationConflict(['instances', instanceId], '目标对象已不存在')
  return [instanceId, ...(instance.childIds ?? []).flatMap(id => descendantIds(project, id))]
}


/** Only references actually touched by deletion join its captured baseline. */
function removalReferencePaths(project: CourseProjectV10, removed: ReadonlySet<string>, removedSurface?: string): string[][] {
  const paths: string[][] = []
  for (const change of deletedObjectInteractionData(project, removed)) {
    paths.push(change.path)
    if (change.path[0] === '@surface') paths.push([...change.path.slice(0, 5), 'id'])
  }
  for (const surface of componentContainers(project)) {
    const spatial = surface.spatial
    if (spatial && (spatial.frames.some(frame => frame.targetInstanceId && removed.has(frame.targetInstanceId))
      || spatial.paths?.some(path => path.instanceIds?.some(id => removed.has(id)))
      || spatial.relations?.some(relation => removed.has(relation.sourceInstanceId) || removed.has(relation.targetInstanceId))
      || spatial.semanticZoom?.some(rule => rule.instanceIds.some(id => removed.has(id))))) paths.push(['@surface', surface.id, 'spatial'])
    if (surface.presentation?.states.some(state => Object.keys(state.overrides).some(id => removed.has(id))
      || state.order?.some(id => removed.has(id)))) paths.push(['@surface', surface.id, 'presentation'])
  }
  for (const instance of Object.values(project.instances)) {
    if (instance.flowPlacement?.paragraphAnchor && removed.has(instance.flowPlacement.paragraphAnchor.blockId)) paths.push(['instances', instance.id, 'flowPlacement'])
    if (removedSurface && instance.visibility?.surfaceIds.includes(removedSurface)) paths.push(['instances', instance.id, 'visibility'])
  }
  if (removedSurface && project.logic?.navigationGuards.some(guard => guard.fromSurfaceIds?.includes(removedSurface) || guard.toSurfaceIds.includes(removedSurface))) paths.push(['logic'])
  return paths
}

/** Keep surviving rules useful and remove every completion follower of a deleted action. */
function deletedObjectInteractionData(project: CourseProjectV10, removed: ReadonlySet<string>): { path: string[]; value: JsonValue; instanceId: string }[] {
  const changes: { path: string[]; value: JsonValue; instanceId: string }[] = []
  const clean = (data: JsonValue): JsonValue => {
    const parsed = componentInteractionDataSchema.parse(data), removedActions = new Set<string>()
    let rules = parsed.rules.flatMap(rule => {
      if ('nodeId' in rule.trigger && removed.has(rule.trigger.nodeId)) {
        rule.actions.forEach(step => removedActions.add(step.id)); return []
      }
      const actions = rule.actions.filter(step => {
        if (!('nodeId' in step.action) || !removed.has(step.action.nodeId)) return true
        removedActions.add(step.id); return false
      })
      if (!actions.length) return []
      if (actions[0].id !== rule.actions[0].id) actions[0] = { ...actions[0], start: 'after-previous' }
      return [{ ...rule, actions }]
    })
    let changed = true
    while (changed) {
      changed = false
      rules = rules.filter(rule => {
        if (rule.trigger.type !== 'animation.completed' || !removedActions.has(rule.trigger.actionId)) return true
        rule.actions.forEach(step => removedActions.add(step.id)); changed = true; return false
      })
    }
    return equalComponentValue(parsed.rules, rules) ? data : jsonValueSchema.parse({ ...parsed, rules })
  }
  for (const instance of Object.values(project.instances)) {
    if (removed.has(instance.id) || componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) !== 'guoling.interactions') continue
    const update = (data: JsonValue, path: string[]) => {
      const value = clean(data)
      if (!equalComponentValue(value, data)) changes.push({ instanceId: instance.id, path, value })
    }
    update(instance.data, ['instances', instance.id, 'data'])
    for (const surface of componentContainers(project)) for (const [index, state] of (surface.presentation?.states ?? []).entries()) {
      const data = state.overrides[instance.id]?.data
      if (data !== undefined) update(data, ['@surface', surface.id, 'presentation', 'states', String(index), 'overrides', instance.id, 'data'])
    }
  }
  return changes
}

function removeDeletedReferences(project: CourseProjectV10, removed: ReadonlySet<string>, removedSurfaces: ReadonlySet<string>): void {
  for (const change of deletedObjectInteractionData(project, removed)) {
    if (componentIsLocked(project, change.instanceId)) throw new Error('关联互动已锁定，请先解锁')
    if (change.path[0] === '@surface') writeSurfaceField(project, change.path[1], change.path.slice(2), change.value)
    else writeField(project, change.path, change.value)
  }
  for (const instance of Object.values(project.instances)) {
    const configuration = instance.container
    if (!configuration) continue
    const spatial = configuration.spatial
    if (spatial) {
      for (const frame of spatial.frames) if (frame.targetInstanceId && removed.has(frame.targetInstanceId)) delete frame.targetInstanceId
      for (const path of spatial.paths ?? []) if (path.instanceIds) path.instanceIds = path.instanceIds.filter(id => !removed.has(id))
      if (spatial.relations) spatial.relations = spatial.relations.filter(relation => !removed.has(relation.sourceInstanceId) && !removed.has(relation.targetInstanceId))
      if (spatial.semanticZoom) spatial.semanticZoom = spatial.semanticZoom.map(rule => ({ ...rule, instanceIds: rule.instanceIds.filter(id => !removed.has(id)) })).filter(rule => rule.instanceIds.length)
    }
    for (const state of configuration.presentation?.states ?? []) {
      for (const id of removed) delete state.overrides[id]
      if (state.order) state.order = state.order.filter(id => !removed.has(id))
    }
  }
  for (const instance of Object.values(project.instances)) {
    if (instance.flowPlacement?.paragraphAnchor && removed.has(instance.flowPlacement.paragraphAnchor.blockId)) delete instance.flowPlacement.paragraphAnchor
    if (instance.visibility && removedSurfaces.size) instance.visibility.surfaceIds = instance.visibility.surfaceIds.filter(id => !removedSurfaces.has(id))
  }
  if (project.logic && removedSurfaces.size) project.logic.navigationGuards = project.logic.navigationGuards.flatMap(guard => {
    const remaining = removeNavigationGuardSurfaces(guard, removedSurfaces)
    return remaining ? [remaining] : []
  })
}

/** Remove only references whose destination state was deleted, keeping scene jumps useful. */
function deletedPresentationData(project: CourseProjectV10, surfaceId: string, removed: ReadonlySet<string>): { path: string[]; value: JsonValue; instanceId: string }[] {
  if (!removed.size) return []
  const changes: { path: string[]; value: JsonValue; instanceId: string }[] = []
  const clean = (instanceId: string, data: JsonValue, local: boolean): JsonValue => {
    const instance = project.instances[instanceId], key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
    if (key === 'guoling.interactions') {
      const parsed = componentInteractionDataSchema.parse(data), removedActions = new Set<string>()
      let rules = parsed.rules.flatMap(rule => {
        const drop = () => { rule.actions.forEach(step => removedActions.add(step.id)); return [] }
        if (local && rule.trigger.type === 'presentation.enter' && removed.has(rule.trigger.stateId)) return drop()
        const conditions = rule.conditions.map(condition => local && condition.type === 'presentation.in'
          ? { ...condition, stateIds: condition.stateIds.filter(id => !removed.has(id)) } : condition)
        if (conditions.some(condition => condition.type === 'presentation.in' && !condition.stateIds.length)) return drop()
        const actions = rule.actions.flatMap(step => {
          const action = step.action
          if (action.type === 'presentation.set'
            && (action.containerId !== undefined ? action.containerId === surfaceId : local)
            && removed.has(action.stateId)) { removedActions.add(step.id); return [] }
          if (action.type === 'scene.go' && action.sceneId === surfaceId && action.targetStateId && removed.has(action.targetStateId)) {
            const { targetStateId: _, ...destination } = action
            return [{ ...step, action: destination }]
          }
          return [step]
        })
        if (!actions.length) return drop()
        if (actions[0]!.id !== rule.actions[0]?.id) actions[0] = { ...actions[0]!, start: 'after-previous' }
        return [{ ...rule, conditions, actions }]
      })
      let changed = true
      while (changed) {
        changed = false
        rules = rules.filter(rule => {
          if (rule.trigger.type !== 'animation.completed' || !removedActions.has(rule.trigger.actionId)) return true
          rule.actions.forEach(step => removedActions.add(step.id)); changed = true; return false
        })
      }
      return equalComponentValue(parsed.rules, rules) ? data : { ...parsed, rules } as unknown as JsonValue
    }
    if (key !== 'guoling.navigation' || !data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.buttons)) return data
    return { ...data, buttons: data.buttons.map(button => {
      if (!button || typeof button !== 'object' || Array.isArray(button)) return button
      const action = button.action
      if (!action || typeof action !== 'object' || Array.isArray(action) || action.type !== 'scene.go' || action.sceneId !== surfaceId
        || typeof action.targetStateId !== 'string' || !removed.has(action.targetStateId)) return button
      const { targetStateId: _, ...destination } = action
      return { ...button, action: destination }
    }) }
  }
  for (const instance of Object.values(project.instances)) {
    const target = instance.attachments?.find(attachment => attachment.instanceId === instance.id)?.target
    const boundContainerId = target?.kind === 'surface' ? target.surfaceId
      : target?.kind === 'instance' || target?.kind === 'text-range'
        ? project.instances[target.instanceId]?.container ? target.instanceId : containingSurfaceId(project, target.instanceId)
        : target?.kind === 'project' ? undefined : instance.container ? instance.id : containingSurfaceId(project, instance.id)
    const local = boundContainerId === surfaceId
    const update = (data: JsonValue, path: string[], localState: boolean) => {
      const value = clean(instance.id, data, localState)
      if (!equalComponentValue(value, data)) changes.push({ path, value, instanceId: instance.id })
    }
    update(instance.data, ['instances', instance.id, 'data'], Boolean(local))
    for (const surface of componentContainers(project)) for (const state of surface.presentation?.states ?? []) {
      const data = state.overrides[instance.id]?.data
      if (data !== undefined) update(data, ['@surface', surface.id, 'presentation', 'states', String(surface.presentation!.states.indexOf(state)), 'overrides', instance.id, 'data'], local)
    }
  }
  return changes
}

/** The same dependency description is used for capture and host coverage checks. */
function dependencyPaths(project: CourseProjectV10, edits: ComponentEdit[]): string[][] {
  const paths: string[][] = []
  // Read later structural dependencies from the batch's current ownership. Expectations
  // are still captured exclusively from the original project, including absent new IDs.
  const structure = edits.some(edit => edit.type === 'surface.insert' || edit.type === 'surface.remove'
    || edit.type === 'instance.insert' || edit.type === 'instance.remove' || edit.type === 'instance.move'
    || edit.type === 'instance.definition.set') ? structuredClone(project) : project
  const children = (container: ComponentContainer) => {
    if (container.kind === 'instance' && structure.instances[container.instanceId]) structure.instances[container.instanceId].childIds ??= []
    return containerChildIds(structure, container)
  }
  const instanceDependency = (id: string) => { paths.push(['instances', id, 'id'], ['instances', id, 'definitionId'], ['@owner', id]) }
  for (const edit of edits) {
    if (edit.type === 'project.title.set') { paths.push(['title']); continue }
    if (edit.type === 'project.entry.set') {
      paths.push(['entry'], ['rootIds'])
      if (edit.entry) paths.push(['instances', edit.entry.rootInstanceId, 'id'])
      continue
    }
    if (edit.type === 'project.background.set' || edit.type === 'project.designTokens.set' || edit.type === 'project.theme.set'
      || edit.type === 'project.playback.set' || edit.type === 'project.media.set' || edit.type === 'project.logic.set') {
      paths.push([edit.type.split('.')[1]]); continue
    }
    if (edit.type === 'surface.insert') {
      paths.push(['rootIds'], ['entry'], ['instances', edit.surface.id], ['definitions', surfaceDefinitionId(structure, edit.surface.kind)])
      insertSurface(structure, edit.surface, edit.index); continue
    }
    if (edit.type === 'surface.title.set' || edit.type === 'surface.designSize.set') {
      paths.push(['@surface', edit.surfaceId, 'id'], ['@surface', edit.surfaceId, edit.type === 'surface.title.set' ? 'title' : 'designSize']); continue
    }
    if (edit.type === 'surface.move') { paths.push(['rootIds'], ['@owner', edit.surfaceId], ['@surface', edit.surfaceId, 'id']); continue }
    if (edit.type === 'surface.remove') {
      paths.push(['rootIds'], ['entry'], ['@surface', edit.surfaceId])
      const surface = componentContainers(structure).find(value => value.id === edit.surfaceId)
      const removed = new Set(surface ? descendantIds(structure, surface.id) : [])
      for (const id of removed) paths.push(['instances', id])
      for (const id of removed) if (structure.instances[id]?.container) paths.push(...removalReferencePaths(project, removed, id))
      for (const instance of Object.values(project.instances)) if (instance.attachments?.some(attachment => removed.has(attachment.instanceId)
        || (attachment.target.kind === 'instance' || attachment.target.kind === 'text-range') && removed.has(attachment.target.instanceId)
        || attachment.target.kind === 'surface' && attachment.target.surfaceId === edit.surfaceId)) paths.push(['instances', instance.id, 'attachments'])
      const owner = owningContainer(structure, edit.surfaceId)
      if (owner) { const ids = children(owner); ids.splice(ids.indexOf(edit.surfaceId), 1) }
      for (const id of removed) delete structure.instances[id]
      continue
    }
    if (edit.type === 'spatial.set' || edit.type === 'flow.set' || edit.type === 'surface.background.set' || edit.type === 'surface.presentation.set') {
      const field = edit.type === 'spatial.set' ? 'spatial' : edit.type === 'flow.set' ? 'flow' : edit.type.split('.')[1]
      if (edit.type === 'surface.presentation.set') {
        const removed = new Set(componentContainers(project).find(surface => surface.id === edit.surfaceId)?.presentation?.states
          .filter(state => !edit.presentation?.states.some(value => value.id === state.id)).map(state => state.id))
        paths.push(...deletedPresentationData(project, edit.surfaceId, removed).map(change => change.path))
      }
      paths.push(['@surface', edit.surfaceId, 'id'], ['@surface', edit.surfaceId, field]); continue
    }
    if (edit.type === 'definition.set') {
      paths.push(['definitions', edit.definition.id])
      if (edit.sourceOriginId) paths.push(['definitions', edit.sourceOriginId])
      continue
    }
    if (edit.type === 'definition.remove') { paths.push(['definitions', edit.definitionId], ['instances'], ['definitions']); continue }
    if (edit.type === 'asset.remove') { paths.push(['assets', edit.assetId], ['instances'], ['background'], ['media'], ['theme']); continue }
    if (edit.type === 'asset.add' || edit.type === 'asset.replace') { paths.push(['assets', edit.asset.id]); continue }
    // Resource bytes carry their own owner-scoped baseline on this edit.
    if (edit.type === 'component.files.set') continue
    if (edit.type === 'instance.insert') {
      paths.push(containerPath(project, edit.container))
      for (const instance of edit.instances) paths.push(['instances', instance.id], ['definitions', instance.definitionId])
      for (const instance of edit.instances) Object.defineProperty(structure.instances, instance.id,
        { value: structuredClone(instance), enumerable: true, configurable: true, writable: true })
      children(edit.container).splice(edit.index, 0, ...edit.rootIds)
      continue
    }
    instanceDependency(edit.instanceId)
    if (edit.type === 'container.patch') {
      paths.push(['instances', edit.instanceId, 'container', 'kind'])
      for (const field of Object.keys(edit.patch)) paths.push(['instances', edit.instanceId, 'container', field])
      if (Object.hasOwn(edit.patch, 'presentation')) {
        const previous = structure.instances[edit.instanceId]?.container?.presentation
        const removed = new Set(previous?.states.filter(state => !edit.patch.presentation?.states.some(value => value.id === state.id)).map(state => state.id))
        paths.push(...deletedPresentationData(project, edit.instanceId, removed).map(change => change.path))
      }
    } else if (edit.type === 'data.set' || edit.type === 'style.set' || edit.type === 'authoring.set') {
      const field = ['instances', edit.instanceId, edit.type === 'data.set' ? 'data' : edit.type === 'authoring.set' ? 'authoring' : 'style', ...edit.path]
      paths.push(field)
      if (edit.type === 'data.set' || edit.type === 'authoring.set') paths.push(...componentFieldIdentityPaths(project, field))
    }
    else if (edit.type === 'frame.set') paths.push(['instances', edit.instanceId, 'frame'])
    else if (edit.type === 'instance.patch') for (const key of Object.keys(edit.patch)) paths.push(['instances', edit.instanceId, key])
    else if (edit.type === 'instance.definition.set') {
      paths.push(['instances', edit.instanceId, 'definitionId'], ['definitions', edit.definitionId])
      if (structure.instances[edit.instanceId]) structure.instances[edit.instanceId].definitionId = edit.definitionId
    }
    else if (edit.type === 'instance.flowLayout.set') paths.push(['instances', edit.instanceId, 'flowLayout'])
    else if (edit.type === 'instance.flowPlacement.set') paths.push(['instances', edit.instanceId, 'flowPlacement'])
    else if (edit.type === 'implementation.set') {
      paths.push(['instances', edit.instanceId, 'implementationOverride'], ['instances', edit.instanceId, 'definitionId'])
      if (!structure.instances[edit.instanceId]?.implementationOverride && structure.instances[edit.instanceId]) paths.push(['definitions', structure.instances[edit.instanceId].definitionId, 'implementation'])
    }
    else if (edit.type === 'attachments.set') paths.push(['instances', edit.instanceId, 'attachments'])
    else {
      const source = owningContainer(structure, edit.instanceId)
      if (!source) throw new ComponentOperationConflict(['@owner', edit.instanceId])
      paths.push(containerPath(project, source))
      if (edit.type === 'instance.move') {
        paths.push(containerPath(project, edit.container), ['instances', edit.instanceId, 'frame'])
        if (structure.entry?.rootInstanceId === edit.instanceId && edit.container.kind !== 'project') paths.push(['entry'])
        const sourceChildren = children(source)
        sourceChildren.splice(sourceChildren.indexOf(edit.instanceId), 1)
        children(edit.container).splice(edit.index, 0, edit.instanceId)
      }
      else {
        const removed = new Set(descendantIds(structure, edit.instanceId))
        if (removed.has(structure.entry?.rootInstanceId ?? '')) paths.push(['entry'], ['rootIds'])
        for (const id of removed) paths.push(['instances', id])
        paths.push(...removalReferencePaths(project, removed))
        for (const id of removed) if (structure.instances[id]?.container) paths.push(...removalReferencePaths(project, removed, id))
        for (const instance of Object.values(project.instances)) if (instance.attachments?.some(attachment => removed.has(attachment.instanceId)
          || (attachment.target.kind === 'instance' || attachment.target.kind === 'text-range') && removed.has(attachment.target.instanceId))) paths.push(['instances', instance.id, 'attachments'])
        const sourceChildren = children(source)
        sourceChildren.splice(sourceChildren.indexOf(edit.instanceId), 1)
        for (const id of removed) delete structure.instances[id]
      }
    }
  }
  return [...new Map(paths.map(path => [JSON.stringify(path), path])).values()]
}

export function prepareComponentTextRelationships(project: CourseProjectV10, edits: ComponentEdit[], options: TextRelationshipPlanOptions = {}): ComponentEdit[] {
  if (!edits.some(edit => edit.type === 'data.set' || edit.type === 'instance.insert' || edit.type === 'instance.remove'
    || edit.type === 'instance.move' || edit.type === 'surface.remove' || edit.type === 'surface.presentation.set'
    || edit.type === 'container.patch' && Object.hasOwn(edit.patch, 'presentation') || edit.type === 'attachments.set')) return edits
  const inline = (data: unknown) => allDocumentTextSlots(data).some(slot => inlineComponentIds(slot.content).length)
  if (!Object.values(project.instances).some(instance => instance.attachments?.some(attachment => attachment.target.kind === 'text-range')
    || instance.childIds?.length && documentComponentDataVersions(project, instance.id).some(inline)) && !edits.some(edit => edit.type === 'attachments.set' && edit.attachments.some(attachment => attachment.target.kind === 'text-range')
      || edit.type === 'data.set' && inline(edit.value) || edit.type === 'instance.insert' && edit.instances.some(instance => inline(instance.data)
        || instance.attachments?.some(attachment => attachment.target.kind === 'text-range'))
      || edit.type === 'surface.presentation.set' && edit.presentation?.states.some(state => Object.values(state.overrides).some(override => inline(override.data))))) return edits
  const final = applyComponentOperationCandidate(project, { type: 'component-platform.apply', edits,
    expected: dependencyPaths(project, edits).map(path => ({ path, ...structuredClone(componentValueAt(project, path)) })) }, undefined, localComponentEdits(edits))
  const attachmentSources = new Map(Object.values(project.instances).flatMap(instance => instance.attachments ? [[instance.id, instance.attachments] as const] : []))
  const affectedInstanceIds = new Set<string>()
  const insertedInstances = new Map<string, { instance: CourseProjectV10['instances'][string]; owner?: ComponentContainer }>()
  for (const edit of edits) {
    if ('instanceId' in edit) {
      affectedInstanceIds.add(edit.instanceId)
      if ((edit.type === 'instance.remove' || edit.type === 'instance.move') && project.instances[edit.instanceId]) descendantIds(project, edit.instanceId).forEach(id => affectedInstanceIds.add(id))
    }
    if (edit.type === 'surface.remove' && project.instances[edit.surfaceId]) descendantIds(project, edit.surfaceId).forEach(id => affectedInstanceIds.add(id))
    if (edit.type === 'surface.presentation.set' || edit.type === 'container.patch' && Object.hasOwn(edit.patch, 'presentation')) {
      const surfaceId = edit.type === 'surface.presentation.set' ? edit.surfaceId : edit.instanceId
      for (const version of [project.instances[surfaceId]?.container?.presentation, final.instances[surfaceId]?.container?.presentation])
        for (const state of version?.states ?? []) for (const id of Object.keys(state.overrides)) affectedInstanceIds.add(id)
    }
    if (edit.type === 'attachments.set') attachmentSources.set(edit.instanceId, edit.attachments)
    if (edit.type === 'instance.insert') for (const instance of edit.instances) {
      affectedInstanceIds.add(instance.id)
      insertedInstances.set(instance.id, { instance, ...(edit.rootIds.includes(instance.id) ? { owner: edit.container } : {}) })
      if (instance.attachments) attachmentSources.set(instance.id, instance.attachments)
    }
  }
  for (const { instance } of insertedInstances.values()) for (const child of instance.childIds ?? []) {
    const source = insertedInstances.get(child)
    if (source) source.owner = { kind: 'instance', instanceId: instance.id }
  }
  const relationships = componentTextRelationshipEdits(project, final, { ...options, attachmentSources, affectedInstanceIds, insertedInstances,
    explicitlyRemoved: new Set(edits.flatMap(edit => edit.type === 'instance.remove' ? [edit.instanceId] : [])) })
  if (!relationships.length) return edits
  const moves = relationships.filter((edit): edit is Extract<ComponentEdit, { type: 'instance.move' }> => edit.type === 'instance.move')
  const result: ComponentEdit[] = []
  const pending = new Set(moves)
  // A relationship can enter a soon-to-be-removed group earlier in this batch.
  // Track ownership and current frames here; authored data remains the final planner's input.
  const structure: CourseProjectV10 = { ...project, rootIds: [...project.rootIds], definitions: { ...project.definitions },
    global: { underlay: [...project.global.underlay], overlay: [...project.global.overlay] },
    instances: Object.fromEntries(Object.entries(project.instances).map(([id, instance]) => [id,
      { ...instance, ...(instance.childIds ? { childIds: [...instance.childIds] } : {}) }])) }
  const children = (container: ComponentContainer) => {
    if (container.kind === 'instance') structure.instances[container.instanceId].childIds ??= []
    return containerChildIds(structure, container)
  }
  const moveOwnership = (edit: Extract<ComponentEdit, { type: 'instance.move' }>) => {
    const owner = owningContainer(structure, edit.instanceId)
    if (owner) { const ids = children(owner); ids.splice(ids.indexOf(edit.instanceId), 1) }
    children(edit.container).splice(edit.index, 0, edit.instanceId)
    if (edit.frame) structure.instances[edit.instanceId].frame = edit.frame
  }
  for (const edit of edits) {
    if (edit.type === 'instance.remove' || edit.type === 'surface.remove') {
      const root = edit.type === 'instance.remove' ? edit.instanceId : edit.surfaceId
      const removed = structure.instances[root] ? descendantIds(structure, root) : []
      for (const move of pending) if (removed.includes(move.instanceId)) {
        const { frame: _previousFrame, ...placement } = move
        const frame = structure.instances[move.instanceId]?.frame
        const rescue = { ...placement, index: 0, ...(frame ? { frame } : {}) }
        result.push(rescue); moveOwnership(rescue); pending.delete(move)
      }
      const owner = owningContainer(structure, root)
      if (owner) { const ids = children(owner); ids.splice(ids.indexOf(root), 1) }
      for (const id of structure.instances[root] ? descendantIds(structure, root) : []) delete structure.instances[id]
    } else if (edit.type === 'surface.insert') insertSurface(structure, edit.surface, edit.index)
    else if (edit.type === 'instance.insert') {
      for (const instance of edit.instances) structure.instances[instance.id] = { ...instance,
        ...(instance.childIds ? { childIds: [...instance.childIds] } : {}) }
      children(edit.container).splice(edit.index, 0, ...edit.rootIds)
    }
    else if (edit.type === 'instance.move') moveOwnership(edit)
    else if (edit.type === 'frame.set') {
      if (edit.frame) structure.instances[edit.instanceId].frame = edit.frame
      else delete structure.instances[edit.instanceId].frame
    }
    result.push(edit)
  }
  return [...result, ...[...pending].map(move => ({ ...move, index: 0 })), ...relationships.filter(edit => edit.type !== 'instance.move')]
}

export function captureComponentOperation(project: CourseProjectV10, edits: ComponentEdit[], readPaths: readonly string[][] = [],
  options: { deferTextRelationships?: boolean } = {}): ComponentOperationBatch {
  const prepared = options.deferTextRelationships ? edits : prepareComponentTextRelationships(project, edits)
  return { type: 'component-platform.apply', edits: structuredClone(prepared), expected: [...new Map([...dependencyPaths(project, prepared), ...readPaths].map(path => [JSON.stringify(path), path])).values()]
    .map(path => ({ path, ...structuredClone(componentValueAt(project, path)) })) }
}

export function checkComponentExpectations(project: CourseProjectV10, command: ComponentOperationBatch): void {
  const captured = new Map(command.expected.map(expected => [JSON.stringify(expected.path), expected]))
  for (const expected of command.expected) {
    const actual = componentValueAt(project, expected.path)
    if (actual.exists !== expected.exists || actual.exists && !equalComponentValue(actual.value, expected.value)) throw new ComponentOperationConflict(expected.path)
  }
  for (const path of dependencyPaths(project, command.edits)) if (!captured.has(JSON.stringify(path))) {
    throw new ComponentOperationConflict(path, `局部操作缺少已捕获基线：${path.join('.')}`)
  }
}

function writeField(root: unknown, path: string[], value: JsonValue): void {
  let current = root
  for (const part of path.slice(0, -1)) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) throw new Error('字段父级已不存在')
    current = (current as Record<string, unknown>)[part]
  }
  if (!current || typeof current !== 'object') throw new Error('字段目标不是对象')
  if (Array.isArray(current) && (!/^(0|[1-9]\d*)$/.test(path.at(-1)!) || !Object.hasOwn(current, path.at(-1)!))) throw new Error('数组元素已不存在')
  Object.defineProperty(current, path.at(-1)!, { value: structuredClone(value), writable: true, enumerable: true, configurable: true })
}

/** Explicit author resize: viewport fitting remains a read-only display concern. */
export function resizeComponentSurfacesEdits(project: CourseProjectV10, input: {
  surfaceIds: readonly string[]
  designSize: { width: number; height: number } | null
  mode: 'preserve' | 'contain'
  /** Shared author objects move once, using this captured page as their reference. HUD is independent. */
  globalReferenceSurfaceId?: string
}): ComponentEdit[] {
  const surfaces = [...new Set(input.surfaceIds)].map(id => {
    const surface = componentContainers(project).find(value => value.id === id)
    if (!surface || surface.kind !== 'slide') throw new Error('尺寸修改目标演示页已不存在')
    return surface
  })
  const edits: ComponentEdit[] = surfaces.filter(surface => !equalComponentValue(surface.designSize ?? null, input.designSize))
    .map(surface => ({ type: 'surface.designSize.set', surfaceId: surface.id, designSize: input.designSize }))
  if (input.mode === 'preserve' || !surfaces.length) return edits
  const nextSize = input.designSize ?? DEFAULT_SLIDE_CANVAS
  const matrix = (surface: ComponentSurface): AffineMatrix => {
    const mapping = sharedSlideFrameMapping(surface.designSize ?? DEFAULT_SLIDE_CANVAS, nextSize)
    return [mapping.scale, 0, 0, mapping.scale, mapping.offsetX, mapping.offsetY]
  }
  const transforms = new Map(surfaces.map(surface => [surface.id, matrix(surface)]))
  const reference = input.globalReferenceSurfaceId ? componentContainers(project).find(surface => surface.id === input.globalReferenceSurfaceId) : undefined
  if (input.globalReferenceSurfaceId && !reference) throw new Error('共享层参考演示页已不存在')
  const globalMatrix = reference ? matrix(reference) : undefined
  const globalRoots = [...project.global.underlay, ...project.global.overlay].filter(id =>
    componentDefinitionBuiltinKey(project.definitions[project.instances[id]?.definitionId]) !== 'guoling.navigation')
  // Transform the first framed ancestor of each branch. Descendants remain in that ancestor's coordinates.
  const frames = (view: CourseProjectV10, roots: readonly string[], transform: AffineMatrix) => {
    const result = new Map<string, ComponentFrame | undefined>()
    const visit = (id: string, transformed: boolean) => {
      const instance = view.instances[id]
      if (!instance) return
      const frame = instance.frame
      result.set(id, frame && !transformed ? { ...frame, transform: [...multiplyMatrices(transform, frame.transform)] } : frame)
      instance.childIds?.forEach(child => visit(child, transformed || Boolean(frame)))
    }
    roots.forEach(id => visit(id, false))
    return result
  }
  const baseFrames = new Map<string, ComponentFrame | undefined>()
  for (const surface of surfaces) for (const pair of frames(project, surface.childIds, transforms.get(surface.id)!)) baseFrames.set(...pair)
  if (globalMatrix) for (const pair of frames(project, globalRoots, globalMatrix)) baseFrames.set(...pair)
  for (const [instanceId, frame] of baseFrames) if (frame && !equalComponentValue(frame, project.instances[instanceId].frame))
    edits.push({ type: 'frame.set', instanceId, frame })
  for (const surface of componentContainers(project)) {
    const transform = transforms.get(surface.id)
    if (!surface.presentation || !transform && !globalMatrix) continue
    const presentation = structuredClone(surface.presentation)
    for (const state of presentation.states) {
      const view = resolveComponentPresentation(project, surface.id, state.id)
      const desired = transform ? frames(view, surface.childIds, transform) : new Map<string, ComponentFrame | undefined>()
      if (globalMatrix) for (const pair of frames(view, globalRoots, globalMatrix)) desired.set(...pair)
      for (const [id, frame] of desired) {
        const base = baseFrames.has(id) ? baseFrames.get(id) : project.instances[id].frame
        // State parents may add/remove a frame; compensate their children against the resized base once.
        if (state.overrides[id]?.frame !== undefined || !equalComponentValue(frame, base))
          (state.overrides[id] ??= {}).frame = frame ?? null
      }
    }
    if (!equalComponentValue(presentation, surface.presentation)) edits.push({ type: 'surface.presentation.set', surfaceId: surface.id, presentation })
  }
  return edits
}

/** Convert only explicitly overridable properties at the captured editing state. */
export function presentationComponentEdits(project: CourseProjectV10, surfaceId: string | null, stateId: string | null, edits: ComponentEdit[],
  options: { deferTextRelationships?: boolean } = {}): ComponentEdit[] {
  if (!surfaceId || !stateId) return edits
  const surface = componentContainers(project).find(value => value.id === surfaceId)
  const original = surface?.presentation
  if (!original || !original.states.some(value => value.id === stateId)) throw new Error('捕获的展示状态已不存在')
  const presentation = structuredClone(original), state = presentation.states.find(value => value.id === stateId)!
  const effective = resolveComponentPresentation(project, surfaceId, stateId)
  const result: ComponentEdit[] = []
  let changed = false
  for (const edit of edits) {
    if (edit.type === 'surface.background.set' && edit.surfaceId === surfaceId) {
      if (edit.background === null) delete state.background
      else state.background = structuredClone(edit.background)
      changed = true; continue
    }
    if (edit.type === 'instance.insert') {
      const targetSurfaceId = edit.container.kind === 'surface' ? edit.container.surfaceId
        : edit.container.kind === 'instance' ? project.instances[edit.container.instanceId]?.container
          ? edit.container.instanceId : containingSurfaceId(project, edit.container.instanceId) : undefined
      if (targetSurfaceId === surfaceId) {
        const roots = new Set(edit.rootIds)
        for (const instance of edit.instances) if (roots.has(instance.id)) state.overrides[instance.id] = { visible: instance.visible !== false }
        result.push({ ...edit, instances: edit.instances.map(instance => roots.has(instance.id) ? { ...instance, visible: false } : instance) })
        if ((edit.container.kind === 'surface' || edit.container.kind === 'instance' && edit.container.instanceId === surfaceId) && state.order) state.order.splice(edit.index, 0, ...edit.rootIds)
        changed = true; continue
      }
    }
    if (edit.type === 'instance.move' && (edit.container.kind === 'surface' && edit.container.surfaceId === surfaceId
      || edit.container.kind === 'instance' && edit.container.instanceId === surfaceId)) {
      const owner = owningContainer(project, edit.instanceId)
      if (owner?.kind === 'surface' && owner.surfaceId === surfaceId || owner?.kind === 'instance' && owner.instanceId === surfaceId) {
        const order = state.order ?? componentContainers(effective).find(value => value.id === surfaceId)!.childIds
        state.order = order.filter(id => id !== edit.instanceId)
        if (edit.index > state.order.length) throw new Error('状态层序位置已不存在')
        state.order.splice(edit.index, 0, edit.instanceId)
        if (edit.frame) (state.overrides[edit.instanceId] ??= {}).frame = structuredClone(edit.frame)
        changed = true; continue
      }
    }
    if (!(edit.type === 'data.set' || edit.type === 'authoring.set' || edit.type === 'style.set' || edit.type === 'frame.set' || edit.type === 'instance.patch') || !project.instances[edit.instanceId]) {
      result.push(edit); continue
    }
    if (edit.type === 'instance.patch' && edit.patch.visible === undefined && edit.patch.playbackInitialVisibility === undefined) { result.push(edit); continue }
    if (containingSurfaceId(project, edit.instanceId) !== surfaceId) { result.push(edit); continue }
    const override = state.overrides[edit.instanceId] ??= {}
    if (edit.type === 'data.set') {
      if (!edit.path.length) override.data = structuredClone(edit.value)
      else { override.data ??= structuredClone(effective.instances[edit.instanceId].data); writeField(override.data, edit.path, edit.value) }
    } else if (edit.type === 'authoring.set') {
      if (!edit.path.length) override.authoring = componentAuthoringSchema.parse(edit.value)
      else { override.authoring ??= structuredClone(effective.instances[edit.instanceId].authoring ?? {}); writeField(override.authoring, edit.path, edit.value) }
    } else if (edit.type === 'style.set') {
      if (!edit.path.length) {
        if (!edit.value || typeof edit.value !== 'object' || Array.isArray(edit.value)) throw new Error('样式必须是对象')
        override.style = structuredClone(edit.value)
      } else { override.style ??= structuredClone(effective.instances[edit.instanceId].style ?? {}); writeField(override.style, edit.path, edit.value) }
    } else if (edit.type === 'frame.set') override.frame = structuredClone(edit.frame)
    else {
      if (edit.patch.visible !== undefined) override.visible = edit.patch.visible
      if (edit.patch.playbackInitialVisibility !== undefined) override.playbackInitialVisibility = edit.patch.playbackInitialVisibility
      const { visible: _visible, playbackInitialVisibility: _initialVisibility, ...patch } = edit.patch
      if (Object.keys(patch).length) result.push({ ...edit, patch })
    }
    changed = true
  }
  if (changed) result.push({ type: 'surface.presentation.set', surfaceId, presentation })
  return options.deferTextRelationships ? result : prepareComponentTextRelationships(project, result)
}

function isFlowBody(project: CourseProjectV10, id: string): boolean {
  let instance = project.instances[id]
  if (!instance || instance.flowPlacement || project.definitions[instance.definitionId]?.role === 'behavior') return false
  let owner = owningContainer(project, id)
  while (owner?.kind === 'instance') {
    instance = project.instances[owner.instanceId]
    if (instance.container) return instance.container.kind === 'flow'
    const section = componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.document-block'
      && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) && instance.data.type === 'section'
    if (instance.flowPlacement || !section && !isNativeFlowLayoutGroup(instance, project.definitions[instance.definitionId])) return false
    owner = owningContainer(project, instance.id)
  }
  return owner?.kind === 'surface' && componentContainers(project).some(surface => surface.id === owner.surfaceId && surface.kind === 'flow')
}

/** A document insertion may shift numeric slots without moving a locked paragraph past an existing reading neighbor. */
function passiveFlowMoves(project: CourseProjectV10, edits: readonly ComponentEdit[]): Set<ComponentEdit> {
  const key = (container: ComponentContainer) => container.kind === 'surface' ? `instance:${container.surfaceId}`
    : container.kind === 'instance' ? `instance:${container.instanceId}` : container.kind === 'project' ? 'project' : `global:${container.plane}`
  const children = new Map<string, string[]>([
    ...Object.values(project.instances).map(instance => [`instance:${instance.id}`, [...instance.childIds ?? []]] as [string, string[]]),
    ['project', [...project.rootIds]],
    ['global:underlay', [...project.global.underlay]], ['global:overlay', [...project.global.overlay]],
  ])
  const remove = (id: string) => { for (const ids of children.values()) { const index = ids.indexOf(id); if (index >= 0) ids.splice(index, 1) } }
  for (const edit of edits) {
    if (edit.type === 'instance.insert') {
      for (const instance of edit.instances) children.set(`instance:${instance.id}`, [...instance.childIds ?? []])
      edit.rootIds.forEach(remove)
      const ids = children.get(key(edit.container)) ?? []; ids.splice(edit.index, 0, ...edit.rootIds); children.set(key(edit.container), ids)
    } else if (edit.type === 'instance.move') {
      remove(edit.instanceId)
      const ids = children.get(key(edit.container)) ?? []; ids.splice(edit.index, 0, edit.instanceId); children.set(key(edit.container), ids)
    } else if (edit.type === 'instance.remove') descendantIds(project, edit.instanceId).forEach(remove)
  }
  const permitted = new Set<ComponentEdit>()
  for (const edit of edits) {
    if (edit.type !== 'instance.move' || !isFlowBody(project, edit.instanceId)) continue
    const owner = owningContainer(project, edit.instanceId)!, before = containerChildIds(project, owner), after = children.get(key(owner)) ?? []
    if (key(owner) !== key(edit.container) || edit.frame && !equalComponentValue(edit.frame, project.instances[edit.instanceId].frame) || !after.includes(edit.instanceId)) continue
    if (before.every(id => id === edit.instanceId || !isFlowBody(project, id) || !after.includes(id)
      || (before.indexOf(id) < before.indexOf(edit.instanceId)) === (after.indexOf(id) < after.indexOf(edit.instanceId)))) permitted.add(edit)
  }
  return permitted
}

function flowBodyContentEdit(project: CourseProjectV10, edit: ComponentEdit): boolean {
  if (edit.type !== 'data.set' || !isFlowBody(project, edit.instanceId)
    || componentDefinitionBuiltinKey(project.definitions[project.instances[edit.instanceId].definitionId]) !== 'guoling.text') return false
  if (edit.path[0] === 'content') return true
  const before = project.instances[edit.instanceId].data, after = edit.value
  if (edit.path.length || !before || typeof before !== 'object' || Array.isArray(before) || !after || typeof after !== 'object' || Array.isArray(after)) return false
  const { content: _oldContent, ...oldFields } = before, { content: _newContent, ...newFields } = after
  return equalComponentValue(oldFields, newFields)
}

/** Body locks protect layout; their own text edits may maintain that text's actual relations. */
function flowTextRelationEdit(project: CourseProjectV10, current: CourseProjectV10, edit: ComponentEdit, textBodies: ReadonlySet<string>): boolean {
  if (!('instanceId' in edit) || !['attachments.set', 'instance.move', 'instance.remove'].includes(edit.type)) return false
  const instance = project.instances[edit.instanceId]
  if (!instance || !textBodies.size) return false
  const rangeBodies = instance.attachments?.flatMap(attachment => attachment.target.kind === 'text-range' && textBodies.has(attachment.target.instanceId)
    ? [attachment.target.instanceId] : []) ?? []
  const inlineBodies = [...textBodies].filter(id => documentComponentDataVersions(project, id)
    .some(data => allDocumentTextSlots(data).some(slot => inlineComponentIds(slot.content).includes(instance.id))))
  if (!rangeBodies.length && !inlineBodies.length) return false
  if (edit.type !== 'instance.move') return true
  if (edit.container.kind !== 'instance') return false
  const destinationId = edit.container.instanceId
  return inlineBodies.length > 0 && isFlowBody(current, destinationId)
    && documentComponentDataVersions(current, destinationId).some(data => allDocumentTextSlots(data)
      .some(slot => inlineComponentIds(slot.content).includes(instance.id)))
    || rangeBodies.some(id => containingSurfaceId(project, id) === destinationId
      && project.instances[destinationId]?.container?.kind === 'flow')
}

function hasOnlyBodyInheritedLocks(project: CourseProjectV10, id: string, bodyOwner = false): boolean {
  if (project.instances[id]?.locked && !(bodyOwner && isFlowBody(project, id)
    && componentDefinitionBuiltinKey(project.definitions[project.instances[id].definitionId]) === 'guoling.text')) return false
  let owner = owningContainer(project, id)
  while (owner?.kind === 'instance') {
    const parent = project.instances[owner.instanceId]
    if (parent.locked && !(isFlowBody(project, parent.id)
      && componentDefinitionBuiltinKey(project.definitions[parent.definitionId]) === 'guoling.text')) return false
    owner = owningContainer(project, parent.id)
  }
  return true
}

export function applyComponentOperation(project: CourseProjectV10, raw: ComponentOperationBatch, resources?:DocumentResources): CourseProjectV10 {
  return courseProjectV10Schema.parse(applyComponentOperationCandidate(project, raw, resources))
}

/** These edits cannot change the schema's ownership, definition, entry or attachment
 * invariants. Relationship/structural edits in the same batch use the full path. */
function localComponentEdits(edits: readonly ComponentEdit[]): boolean {
  return edits.every(edit => edit.type === 'project.title.set' || edit.type === 'data.set' || edit.type === 'authoring.set'
    || edit.type === 'style.set' || edit.type === 'frame.set' || edit.type === 'instance.patch'
    || edit.type === 'instance.flowLayout.set' || edit.type === 'instance.flowPlacement.set')
}

/** Canonical/validated input only. The original mutator and its lock/reference
 * checks still run. Only unchanged, previously validated fields avoid parsing. */
export function applyValidatedComponentOperation(project: CourseProjectV10, raw: ComponentOperationBatch, resources?: DocumentResources): CourseProjectV10 {
  const local = localComponentEdits(raw.edits)
  const next = applyComponentOperationCandidate(project, raw, resources, local)
  if (!local) return courseProjectV10Schema.parse(next)
  for (const [id, instance] of Object.entries(next.instances)) {
    const before = project.instances[id]
    if (before === instance) continue
    for (const field of new Set([...Object.keys(before), ...Object.keys(instance)])) {
      const key = field as keyof typeof componentInstanceSchema.shape
      if (Object.is(before[key], instance[key]) && Object.hasOwn(before, key) === Object.hasOwn(instance, key)) continue
      // Batch parsing already validated every replacement JSON value. Replacing
      // a value on a validated data/style path preserves that JSON invariant;
      // professional data is checked by the driver, without cloning its siblings.
      if (key !== 'data' && key !== 'style') componentInstanceSchema.shape[key].parse(instance[key])
    }
  }
  return next
}

/** Provisional commands still capture/check the current candidate and run the same
 * edit semantics. Only the final full-project parse belongs to the Session commit. */
export function beginComponentOperationPlanning(project: CourseProjectV10) {
  let current = project
  return { apply(command: ComponentOperationBatch, resources: DocumentResources): CourseProjectV10 {
    const next = applyComponentOperationCandidate(current, command, resources, localComponentEdits(command.edits))
    current = next
    return next
  } }
}

function applyComponentOperationCandidate(project: CourseProjectV10, raw: ComponentOperationBatch, resources?:DocumentResources, local = false): CourseProjectV10 {
  const command = componentOperationBatchSchema.parse(raw)
  checkComponentExpectations(project, command)
  const next = local ? { ...project } : structuredClone(project)
  const owned = new WeakSet<object>([next])
  const detach = (path: readonly string[]) => {
    let parent: unknown = next
    for (const key of path) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return
      const record = parent as Record<string, unknown>, value = record[key]
      if (!value || typeof value !== 'object') return
      if (!owned.has(value)) {
        const copy = Array.isArray(value) ? [...value] : Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value))
        Object.defineProperty(record, key, { value: copy, enumerable: true, configurable: true, writable: true })
        owned.add(copy)
      }
      parent = record[key]
    }
  }
  const passive = command.edits.some(edit => edit.type === 'instance.move' && componentIsLocked(project, edit.instanceId))
    ? passiveFlowMoves(project, command.edits) : new Set<ComponentEdit>()
  const removedInBatch = new Set<string>()
  const textBodies = new Set(command.edits.filter(edit => flowBodyContentEdit(project, edit))
    .flatMap(edit => 'instanceId' in edit ? [edit.instanceId] : []))
  for (const edit of command.edits) {
    if (local && 'instanceId' in edit) {
      const path = ['instances', edit.instanceId]
      if ((edit.type === 'data.set' || edit.type === 'authoring.set' || edit.type === 'style.set') && edit.path.length)
        path.push(edit.type === 'data.set' ? 'data' : edit.type === 'authoring.set' ? 'authoring' : 'style', ...edit.path.slice(0, -1))
      detach(path)
    }
    // Earlier edits can change definitions, bindings or asset scope on `next`.
    const references = createComponentReferenceCapture(next, resources)
    // Every author entry reaches this application boundary. Runtime state/animation never does.
    const relationEdit = flowTextRelationEdit(project, next, edit, textBodies)
    const requireUnlocked = (id: string, allowBodyLock = false, bodyOwner = false) => {
      if (project.instances[id] && componentIsLocked(next, id) && !(allowBodyLock && hasOnlyBodyInheritedLocks(next, id, bodyOwner))) throw new Error('对象已锁定，请先解锁')
    }
    if ('instanceId' in edit && !(edit.type === 'instance.patch' && Object.keys(edit.patch).every(key => key === 'locked'))
      && !(edit.type === 'instance.move' && passive.has(edit)) && !flowBodyContentEdit(next, edit))
      requireUnlocked(edit.instanceId, relationEdit)
    if (edit.type === 'instance.insert' && edit.container.kind === 'instance') requireUnlocked(edit.container.instanceId)
    if (edit.type === 'instance.insert' && edit.container.kind === 'surface') requireUnlocked(edit.container.surfaceId)
    if (edit.type === 'instance.move' && edit.container.kind === 'instance') requireUnlocked(edit.container.instanceId, relationEdit, true)
    if (edit.type === 'instance.move' && edit.container.kind === 'surface') requireUnlocked(edit.container.surfaceId)
    if ('surfaceId' in edit && next.instances[edit.surfaceId]) requireUnlocked(edit.surfaceId)
    if (edit.type === 'instance.remove') descendantIds(next, edit.instanceId).forEach(id => requireUnlocked(id, relationEdit))
    if (edit.type === 'surface.remove' && next.instances[edit.surfaceId]) descendantIds(next, edit.surfaceId).forEach(id => requireUnlocked(id))
    if (edit.type === 'definition.set' || edit.type === 'definition.remove') {
      const id = edit.type === 'definition.set' ? edit.definition.id : edit.definitionId
      const before=next.definitions[id]
      const implementationOnly=edit.type==='definition.set' && before && equalComponentValue({...before,implementation:null},{...edit.definition,implementation:null})
      const changed=edit.type==='definition.remove' || !equalComponentValue(before,edit.definition)
      if(changed)for(const instance of Object.values(next.instances)) {
        if (!project.instances[instance.id] || !componentIsLocked(next, instance.id)) continue
        const implementation=instance.implementationOverride ?? next.definitions[instance.definitionId]?.implementation
        if(!implementation)continue
        const direct=instance.definitionId===id && (!implementationOnly || !instance.implementationOverride)
        if(direct || references.sourceOwners(implementation).definitions.has(id))requireUnlocked(instance.id)
      }
    }
    if (edit.type === 'component.files.set') for (const instance of Object.values(next.instances)) {
      if (!project.instances[instance.id] || !componentIsLocked(next, instance.id)) continue
      const implementation = instance.implementationOverride ?? next.definitions[instance.definitionId]?.implementation
      if (implementation && references.sourceOwners(implementation).owners.has(edit.ownerId)) requireUnlocked(instance.id)
    }
    if (edit.type === 'asset.replace') for (const instance of Object.values(next.instances)) {
      if (!project.instances[instance.id] || !componentIsLocked(next, instance.id)) continue
      const versions = [instance, ...componentContainers(next).flatMap(surface => surface.presentation?.states.flatMap(state => {
        const override = state.overrides[instance.id]
        return override ? [{ ...instance, ...(override.data !== undefined ? { data: override.data } : {}),
          ...(override.authoring !== undefined ? { authoring: override.authoring } : {}) }] : []
      }) ?? [])]
      if (versions.some(value => references.componentAssetIds(value, next.definitions[instance.definitionId]).includes(edit.asset.id))) requireUnlocked(instance.id)
    }
    if (edit.type === 'surface.presentation.set' || edit.type === 'container.patch' && Object.hasOwn(edit.patch, 'presentation')) {
      const surfaceId = edit.type === 'surface.presentation.set' ? edit.surfaceId : edit.instanceId
      const presentation = edit.type === 'surface.presentation.set' ? edit.presentation : edit.patch.presentation
      const old = next.instances[surfaceId]?.container?.presentation
      for (const state of [...(old?.states ?? []), ...(presentation?.states ?? [])]) {
        const before = old?.states.find(value => value.id === state.id), after = presentation?.states.find(value => value.id === state.id)
        for (const id of new Set([...Object.keys(before?.overrides ?? {}), ...Object.keys(after?.overrides ?? {})])) {
          if (!equalComponentValue(before?.overrides[id], after?.overrides[id])) requireUnlocked(id)
        }
      }
    }
    if (edit.type === 'component.files.set') continue
    if (edit.type === 'project.title.set') { next.title = edit.title; continue }
    if (edit.type === 'project.entry.set') {
      if (edit.entry === null) delete next.entry
      else next.entry = structuredClone(edit.entry)
      continue
    }
    if (edit.type === 'project.background.set') { if (edit.background == null) delete next.background; else next.background = structuredClone(edit.background); continue }
    if (edit.type === 'project.designTokens.set') { if (edit.designTokens == null) delete next.designTokens; else next.designTokens = structuredClone(edit.designTokens); continue }
    if (edit.type === 'project.theme.set') { if (edit.theme == null) delete next.theme; else next.theme = structuredClone(edit.theme); continue }
    if (edit.type === 'project.playback.set') { if (edit.playback == null) delete next.playback; else next.playback = structuredClone(edit.playback); continue }
    if (edit.type === 'project.media.set') { if (edit.media == null) delete next.media; else next.media = structuredClone(edit.media); continue }
    if (edit.type === 'project.logic.set') {
      if (edit.logic == null) delete next.logic
      else { next.logic = structuredClone(edit.logic); next.logic.navigationGuards = next.logic.navigationGuards.map(canonicalNavigationGuard) }
      continue
    }
    if (edit.type === 'surface.insert') {
      insertSurface(next, edit.surface, edit.index); continue
    }
    if (edit.type === 'surface.title.set' || edit.type === 'surface.designSize.set' || edit.type === 'surface.move' || edit.type === 'surface.remove') {
      const instance = next.instances[edit.surfaceId]
      if (!instance?.container) throw new Error('表面容器已不存在')
      if (edit.type === 'surface.title.set') instance.name = edit.title
      else if (edit.type === 'surface.designSize.set') { if (edit.designSize === null) delete instance.container.designSize; else instance.container.designSize = structuredClone(edit.designSize) }
      else if (edit.type === 'surface.move') {
        const roots = componentSurfaces(next)
        if (edit.index >= roots.length || !next.rootIds.includes(edit.surfaceId)) throw new Error('表面移动位置已不存在')
        next.rootIds.splice(next.rootIds.indexOf(edit.surfaceId), 1)
        const remaining = componentSurfaces(next)
        const index = remaining[edit.index] ? next.rootIds.indexOf(remaining[edit.index].id) : next.rootIds.length
        next.rootIds.splice(index, 0, edit.surfaceId)
      } else {
        const removed = new Set(descendantIds(next, instance.id))
        const owner = owningContainer(next, instance.id)
        if (!owner) throw new Error('表面容器已失去归属')
        const siblings = containerChildIds(next, owner)
        siblings.splice(siblings.indexOf(instance.id), 1)
        for (const id of removed) { delete next.instances[id]; removedInBatch.add(id) }
        for (const other of Object.values(next.instances)) if (other.attachments) other.attachments = other.attachments.filter(attachment => !removed.has(attachment.instanceId)
          && !((attachment.target.kind === 'instance' || attachment.target.kind === 'text-range') && removed.has(attachment.target.instanceId))
          && !(attachment.target.kind === 'surface' && attachment.target.surfaceId === edit.surfaceId))
      }
      continue
    }
    if (edit.type === 'surface.background.set' || edit.type === 'surface.presentation.set' || edit.type === 'flow.set') {
      const configuration = next.instances[edit.surfaceId]?.container
      if (!configuration) throw new Error('目标表面容器已不存在')
      if (edit.type === 'surface.background.set') { if (edit.background === null) delete configuration.background; else configuration.background = structuredClone(edit.background) }
      else if (edit.type === 'surface.presentation.set') { if (edit.presentation === null) delete configuration.presentation; else configuration.presentation = structuredClone(edit.presentation) }
      else configuration.flow = structuredClone(edit.flow)
      continue
    }
    if (edit.type === 'spatial.set') {
      const configuration = next.instances[edit.surfaceId]?.container
      if (!configuration || configuration.kind !== 'spatial') throw new Error('目标不是Spatial容器')
      configuration.spatial = structuredClone(edit.spatial); continue
    }
    if (edit.type === 'definition.set') {
      Object.defineProperty(next.definitions, edit.definition.id, { value: structuredClone(edit.definition), enumerable: true, configurable: true, writable: true })
      continue
    }
    if (edit.type === 'definition.remove') {
      if (!Object.hasOwn(next.definitions, edit.definitionId)) throw new Error('组件定义已不存在')
      if (Object.values(next.instances).some(instance => instance.definitionId === edit.definitionId
        || instance.implementationOverride?.kind === 'source' && (instance.implementationOverride.moduleBindings === undefined
          ? instance.implementationOverride.dependencies ?? [] : Object.values(instance.implementationOverride.moduleBindings)).includes(edit.definitionId))
        || Object.values(next.definitions).some(definition => definition.id !== edit.definitionId && definition.implementation.kind === 'source'
          && (definition.implementation.moduleBindings === undefined ? definition.implementation.dependencies ?? []
            : Object.values(definition.implementation.moduleBindings)).includes(edit.definitionId))) throw new Error('组件定义仍被工程使用')
      delete next.definitions[edit.definitionId]; continue
    }
    if (edit.type === 'asset.remove') {
      if (!Object.hasOwn(next.assets, edit.assetId)) throw new Error('素材已不存在')
      const referenced = Object.values(next.instances).some(instance => references.componentAssetIds(instance, next.definitions[instance.definitionId]).includes(edit.assetId))
        || componentBackgroundAssetIds(next.background).includes(edit.assetId) || componentContainers(next).some(surface => componentBackgroundAssetIds(surface.background).includes(edit.assetId)
          || surface.presentation?.states.some(state => componentBackgroundAssetIds(state.background).includes(edit.assetId) || Object.entries(state.overrides).some(([instanceId, override]) => {
            if (override.data === undefined && override.authoring === undefined) return false
            const instance = next.instances[instanceId]
            return instance && references.componentAssetIds({ ...instance, ...(override.data !== undefined ? { data: override.data } : {}),
              ...(override.authoring !== undefined ? { authoring: override.authoring } : {}) }, next.definitions[instance.definitionId]).includes(edit.assetId)
          })))
        || Object.values(next.media?.audio.sounds ?? {}).some(sound => sound.assetId === edit.assetId)
        || Object.values(next.theme?.assets ?? {}).some(asset => asset.assetId === edit.assetId)
      if (referenced) throw new Error('素材仍被工程内容使用')
      delete next.assets[edit.assetId]; continue
    }
    if (edit.type === 'asset.add') {
      if (Object.hasOwn(next.assets, edit.asset.id)) throw new Error('素材身份已存在；派生素材需要新身份')
      Object.defineProperty(next.assets, edit.asset.id, { value: structuredClone(edit.asset), enumerable: true, configurable: true, writable: true })
      continue
    }
    if (edit.type === 'asset.replace') {
      if (!Object.hasOwn(next.assets, edit.asset.id)) throw new Error('替换素材已不存在')
      Object.defineProperty(next.assets, edit.asset.id, { value: structuredClone(edit.asset), enumerable: true, configurable: true, writable: true })
      continue
    }
    if (edit.type === 'instance.insert') {
      if (edit.container.kind === 'instance' && next.instances[edit.container.instanceId]) next.instances[edit.container.instanceId].childIds ??= []
      const children = containerChildIds(next, edit.container)
      if (edit.index > children.length) throw new Error('插入位置已不存在')
      for (const instance of edit.instances) {
        if (Object.hasOwn(next.instances, instance.id)) throw new Error('插入对象身份已存在')
        Object.defineProperty(next.instances, instance.id, { value: structuredClone(instance), enumerable: true, configurable: true, writable: true })
      }
      children.splice(edit.index, 0, ...edit.rootIds)
      continue
    }
    const instance = next.instances[edit.instanceId]
    if (!instance) throw new Error('目标对象已不存在')
    if (edit.type === 'container.patch') {
      if (!instance.container) throw new Error('目标不是布局容器')
      for (const [key, value] of Object.entries(edit.patch)) {
        if (value === null) delete (instance.container as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(instance.container, key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true })
      }
    } else if (edit.type === 'data.set') {
      if (!edit.path.length) instance.data = structuredClone(edit.value)
      else writeField(instance.data, edit.path, edit.value)
    } else if (edit.type === 'authoring.set') {
      if (!edit.path.length) instance.authoring = componentAuthoringSchema.parse(edit.value)
      else { instance.authoring ??= {}; writeField(instance.authoring, edit.path, edit.value) }
    } else if (edit.type === 'style.set') {
      if (!edit.path.length) {
        if (!edit.value || typeof edit.value !== 'object' || Array.isArray(edit.value)) throw new Error('样式必须是对象')
        instance.style = structuredClone(edit.value)
      } else { instance.style ??= {}; writeField(instance.style, edit.path, edit.value) }
    }
    else if (edit.type === 'frame.set') { if (edit.frame === null) delete instance.frame; else instance.frame = structuredClone(edit.frame) }
    else if (edit.type === 'instance.patch') {
      const { visibility, name, viewportPinned, stateBindings, ...patch } = edit.patch
      Object.assign(instance, patch)
      if (stateBindings === null) delete instance.stateBindings
      else if (stateBindings !== undefined) instance.stateBindings = structuredClone(stateBindings)
      if (viewportPinned === null) delete instance.viewportPinned
      else if (viewportPinned !== undefined) instance.viewportPinned = viewportPinned
      if (name === null) delete instance.name
      else if (name !== undefined) instance.name = name
      if (visibility === null) delete instance.visibility
      else if (visibility !== undefined) instance.visibility = structuredClone(visibility)
    }
    else if (edit.type === 'instance.definition.set') {
      if (!next.definitions[edit.definitionId]) throw new Error('组件定义已不存在')
      instance.definitionId = edit.definitionId
    } else if (edit.type === 'instance.flowLayout.set') {
      if (edit.flowLayout === null) delete instance.flowLayout
      else instance.flowLayout = structuredClone(edit.flowLayout)
    } else if (edit.type === 'instance.flowPlacement.set') {
      if (edit.flowPlacement === null) delete instance.flowPlacement
      else instance.flowPlacement = structuredClone(edit.flowPlacement)
    }
    else if (edit.type === 'implementation.set') {
      if (edit.implementation === null) delete instance.implementationOverride
      else instance.implementationOverride = structuredClone(edit.implementation)
    } else if (edit.type === 'attachments.set') instance.attachments = structuredClone(edit.attachments)
    else {
      const owner = owningContainer(next, edit.instanceId)
      if (!owner) throw new Error('对象已失去归属')
      if (edit.type === 'instance.move' && edit.container.kind === 'instance' && descendantIds(next, edit.instanceId).includes(edit.container.instanceId)) throw new Error('不能将对象移入自身子树')
      const source = containerChildIds(next, owner)
      source.splice(source.indexOf(edit.instanceId), 1)
      if (edit.type === 'instance.move') {
        if (edit.container.kind === 'instance' && next.instances[edit.container.instanceId]) next.instances[edit.container.instanceId].childIds ??= []
        const destination = containerChildIds(next, edit.container)
        if (edit.index > destination.length) throw new Error('移动位置已不存在')
        if (instance.frame && !equalComponentValue(containerPath(next, owner), containerPath(next, edit.container)) && !edit.frame) throw new Error('跨父移动需要保持视觉位置的局部 frame')
        destination.splice(edit.index, 0, edit.instanceId)
        if (edit.frame) instance.frame = structuredClone(edit.frame)
      } else {
        const removed = new Set(descendantIds(next, edit.instanceId))
        for (const id of removed) { delete next.instances[id]; removedInBatch.add(id) }
        for (const other of Object.values(next.instances)) if (other.attachments) other.attachments = other.attachments.filter(attachment => !removed.has(attachment.instanceId)
          && !((attachment.target.kind === 'instance' || attachment.target.kind === 'text-range') && removed.has(attachment.target.instanceId)))
      }
    }
  }
  const removed = new Set([...removedInBatch, ...Object.keys(project.instances).filter(id => !next.instances[id])].filter(id => !next.instances[id]))
  const removedSurfaces = new Set(componentContainers(project).filter(surface => !componentContainers(next).some(value => value.id === surface.id)).map(surface => surface.id))
  if (removed.size || removedSurfaces.size) removeDeletedReferences(next, removed, removedSurfaces)
  for (const surface of componentContainers(project)) {
    const current = componentContainers(next).find(value => value.id === surface.id)
    if (!current) continue
    const deletedStates = new Set(surface.presentation?.states.filter(state => !current.presentation?.states.some(value => value.id === state.id)).map(state => state.id))
    for (const change of deletedPresentationData(next, surface.id, deletedStates)) {
      if (componentIsLocked(next, change.instanceId)) throw new Error('状态引用对象已锁定，请先解锁')
      if (change.path[0] === '@surface') {
        writeSurfaceField(next, change.path[1], change.path.slice(2), change.value)
      } else writeField(next, change.path, change.value)
    }
  }
  for (const id of new Set([...Object.keys(project.instances), ...Object.keys(next.instances)])) {
    const before = project.instances[id], after = next.instances[id]
    if (componentDefinitionBuiltinKey(next.definitions[after?.definitionId] ?? project.definitions[before?.definitionId]) !== 'guoling.interactions'
      || equalComponentValue(before?.data, after?.data)) continue
    const oldRules = before ? componentInteractionDataSchema.parse(before.data).rules : []
    const newRules = after ? componentInteractionDataSchema.parse(after.data).rules : []
    for (const rule of [...oldRules, ...newRules]) {
      if (equalComponentValue(oldRules.find(value => value.id === rule.id), newRules.find(value => value.id === rule.id))) continue
      const targets = [...('nodeId' in rule.trigger ? [rule.trigger.nodeId] : []),
        ...rule.actions.flatMap(step => 'nodeId' in step.action ? [step.action.nodeId] : [])]
      if (targets.some(target => project.instances[target] && componentIsLocked(next, target))) throw new Error('互动关联对象已锁定，请先解锁')
    }
  }
  if (next.entry && !next.rootIds.includes(next.entry.rootInstanceId)) {
    if (command.edits.some(edit => edit.type === 'project.entry.set')) throw new Error('作品入口必须指向现有顶层实例')
    if (next.rootIds.length) next.entry = { rootInstanceId: next.rootIds[0] }
    else delete next.entry
  }
  return next
}

export function describeComponentChanges(before: CourseProjectV10, after: CourseProjectV10): ComponentAppliedChanges {
  const changes: ComponentAppliedChanges['changes'] = []
  const targets = new Set<string>()
  const add = (path: string[], previous: unknown, current: unknown, exists: boolean) => {
    if (!equalComponentValue(previous, current)) changes.push({ path, exists, ...(exists ? { value: structuredClone(current) as JsonValue } : {}) })
  }
  for (const id of new Set([...Object.keys(before.instances), ...Object.keys(after.instances)])) {
    const previous = before.instances[id], current = after.instances[id]
    if (equalComponentValue(previous, current)) continue
    targets.add(id)
    if (!previous || !current) add(['instances', id], previous, current, Boolean(current))
    else for (const field of new Set([...Object.keys(previous), ...Object.keys(current)])) add(['instances', id, field],
      (previous as unknown as Record<string, unknown>)[field], (current as unknown as Record<string, unknown>)[field], Object.hasOwn(current, field))
  }
  for (const field of ['definitions', 'rootIds', 'entry', 'global', 'assets', 'title', 'background', 'designTokens', 'theme', 'playback', 'media', 'logic'] as const) add([field], before[field], after[field], Object.hasOwn(after, field))
  for (const instance of Object.values(after.instances)) if (!equalComponentValue(before.definitions[instance.definitionId], after.definitions[instance.definitionId])) targets.add(instance.id)
  return { changes, affectedTargets: [...targets] }
}

/** The local command's actual addresses are already known in this same apply.
 * Do not turn one data leaf back into a full instance-data History/IPC value. */
export function describeComponentOperationChanges(before: CourseProjectV10, after: CourseProjectV10, command: ComponentOperationBatch): ComponentAppliedChanges {
  if (!localComponentEdits(command.edits)) return describeComponentChanges(before, after)
  const paths: string[][] = []
  for (const edit of command.edits) {
    if (edit.type === 'project.title.set') paths.push(['title'])
    else if (edit.type === 'data.set' || edit.type === 'style.set' || edit.type === 'authoring.set')
      paths.push(['instances', edit.instanceId, edit.type === 'data.set' ? 'data' : edit.type === 'style.set' ? 'style' : 'authoring', ...edit.path])
    else if (edit.type === 'frame.set') paths.push(['instances', edit.instanceId, 'frame'])
    else if (edit.type === 'instance.patch') for (const field of Object.keys(edit.patch)) paths.push(['instances', edit.instanceId, field])
    else if (edit.type === 'instance.flowLayout.set') paths.push(['instances', edit.instanceId, 'flowLayout'])
    else if (edit.type === 'instance.flowPlacement.set') paths.push(['instances', edit.instanceId, 'flowPlacement'])
  }
  const actualPaths = paths.map(path => {
    // A nested style/authoring set can create its optional field. Retain that
    // whole new field so inverse removes it instead of leaving an empty owner.
    for (let length = 1; length < path.length; length++) if (!componentValueAt(before, path.slice(0, length)).exists) return path.slice(0, length)
    return path
  })
  const distinct = [...new Map(actualPaths.map(path => [JSON.stringify(path), path])).values()]
    .filter(path => !actualPaths.some(parent => parent.length < path.length && parent.every((key, index) => key === path[index])))
  const changes: ComponentAppliedChanges['changes'] = [], targets = new Set<string>()
  for (const path of distinct) {
    const previous = componentValueAt(before, path), current = componentValueAt(after, path)
    if (previous.exists === current.exists && equalComponentValue(previous.value, current.value)) continue
    changes.push({ path, exists: current.exists, ...(current.exists ? { value: structuredClone(current.value) } : {}) })
    if (path[0] === 'instances') targets.add(path[1])
  }
  return { changes, affectedTargets: [...targets] }
}
