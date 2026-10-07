import { componentAssetIds } from '../components/library/references'
import type { ComponentAppliedChanges, ComponentEdit, ComponentExpectation, ComponentOperationBatch } from '../../shared/contracts/component-platform/operations'
import { componentDefinitionBuiltinKey, componentIsLocked, resolveComponentPresentation, containerChildIds, owningContainer, type ComponentContainer, type CourseProjectV10, type JsonValue } from '../../shared/contracts/component-platform/project'
import { componentOperationBatchSchema, courseProjectV10Schema } from '../../shared/contracts/component-platform/schema'
import { componentInteractionDataSchema } from '../../shared/componentInteractionData'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import { DEFAULT_SLIDE_CANVAS, sharedSlideFrameMapping } from '../../shared/slideCanvas'
import { multiplyMatrices, type AffineMatrix } from '../components/geometry'

export class ComponentOperationConflict extends Error {
  readonly code = 'component-field-conflict'
  constructor(readonly path: string[], message = `目标内容或归属已变化：${path.join('.')}`) { super(message) }
}

export function equalComponentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => equalComponentValue(value, right[index]))
  const leftRecord = left as Record<string, unknown>, rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return keys.length === Object.keys(rightRecord).length && keys.every(key => Object.hasOwn(rightRecord, key) && equalComponentValue(leftRecord[key], rightRecord[key]))
}

export function componentValueAt(project: CourseProjectV10, path: string[]): { exists: boolean; value?: JsonValue } {
  if (path[0] === '@surfaceOrder') return { exists: true, value: project.surfaces.map(surface => surface.id) }
  if (path[0] === '@surface') {
    const surface = project.surfaces.find(value => value.id === path[1])
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
  if (path[0] === 'instances' && path[2] === 'data' && path[3] === 'authoringRecords' && path.length > 5) {
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
  if (container.kind === 'global') return ['global', container.plane]
  if (container.kind === 'instance') return ['instances', container.instanceId, 'childIds']
  return ['@surface', container.surfaceId, 'childIds']
}

function descendantIds(project: CourseProjectV10, instanceId: string): string[] {
  const instance = project.instances[instanceId]
  if (!instance) throw new ComponentOperationConflict(['instances', instanceId], '目标对象已不存在')
  return [instanceId, ...(instance.childIds ?? []).flatMap(id => descendantIds(project, id))]
}


/** Only references actually touched by deletion join its captured baseline. */
function removalReferencePaths(project: CourseProjectV10, removed: ReadonlySet<string>, removedSurface?: string): string[][] {
  const paths: string[][] = []
  for (const surface of project.surfaces) {
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

function removeDeletedReferences(project: CourseProjectV10, removed: ReadonlySet<string>, removedSurfaces: ReadonlySet<string>): void {
  for (const surface of project.surfaces) {
    const spatial = surface.spatial
    if (spatial) {
      for (const frame of spatial.frames) if (frame.targetInstanceId && removed.has(frame.targetInstanceId)) delete frame.targetInstanceId
      for (const path of spatial.paths ?? []) if (path.instanceIds) path.instanceIds = path.instanceIds.filter(id => !removed.has(id))
      if (spatial.relations) spatial.relations = spatial.relations.filter(relation => !removed.has(relation.sourceInstanceId) && !removed.has(relation.targetInstanceId))
      if (spatial.semanticZoom) spatial.semanticZoom = spatial.semanticZoom.map(rule => ({ ...rule, instanceIds: rule.instanceIds.filter(id => !removed.has(id)) })).filter(rule => rule.instanceIds.length)
    }
    for (const state of surface.presentation?.states ?? []) {
      for (const id of removed) delete state.overrides[id]
      if (state.order) state.order = state.order.filter(id => !removed.has(id))
    }
  }
  for (const instance of Object.values(project.instances)) {
    if (instance.flowPlacement?.paragraphAnchor && removed.has(instance.flowPlacement.paragraphAnchor.blockId)) delete instance.flowPlacement.paragraphAnchor
    if (instance.visibility && removedSurfaces.size) instance.visibility.surfaceIds = instance.visibility.surfaceIds.filter(id => !removedSurfaces.has(id))
  }
  if (project.logic && removedSurfaces.size) project.logic.navigationGuards = project.logic.navigationGuards.flatMap(guard => {
    const toSurfaceIds = guard.toSurfaceIds.filter(id => !removedSurfaces.has(id))
    if (guard.toSurfaceIds.length && !toSurfaceIds.length) return []
    return [{ ...guard, toSurfaceIds, ...(guard.fromSurfaceIds ? { fromSurfaceIds: guard.fromSurfaceIds.filter(id => !removedSurfaces.has(id)) } : {}) }]
  })
}

/** The same dependency description is used for capture and host coverage checks. */
function dependencyPaths(project: CourseProjectV10, edits: ComponentEdit[]): string[][] {
  const paths: string[][] = []
  // Read later structural dependencies from the batch's current ownership. Expectations
  // are still captured exclusively from the original project, including absent new IDs.
  const structure = structuredClone(project)
  const children = (container: ComponentContainer) => {
    if (container.kind === 'instance' && structure.instances[container.instanceId]) structure.instances[container.instanceId].childIds ??= []
    return containerChildIds(structure, container)
  }
  const instanceDependency = (id: string) => { paths.push(['instances', id, 'id'], ['instances', id, 'definitionId'], ['@owner', id]) }
  for (const edit of edits) {
    if (edit.type === 'project.title.set') { paths.push(['title']); continue }
    if (edit.type === 'project.background.set' || edit.type === 'project.designTokens.set' || edit.type === 'project.theme.set'
      || edit.type === 'project.playback.set' || edit.type === 'project.media.set' || edit.type === 'project.logic.set') {
      paths.push([edit.type.split('.')[1]]); continue
    }
    if (edit.type === 'surface.insert') {
      paths.push(['@surfaceOrder'], ['@surface', edit.surface.id])
      structure.surfaces.splice(edit.index, 0, structuredClone(edit.surface)); continue
    }
    if (edit.type === 'surface.title.set' || edit.type === 'surface.designSize.set') {
      paths.push(['@surface', edit.surfaceId, 'id'], ['@surface', edit.surfaceId, edit.type === 'surface.title.set' ? 'title' : 'designSize']); continue
    }
    if (edit.type === 'surface.move') { paths.push(['@surfaceOrder'], ['@surface', edit.surfaceId, 'id']); continue }
    if (edit.type === 'surface.remove') {
      paths.push(['@surfaceOrder'], ['@surface', edit.surfaceId])
      const surface = structure.surfaces.find(value => value.id === edit.surfaceId)
      const removed = new Set((surface?.childIds ?? []).flatMap(id => descendantIds(structure, id)))
      for (const id of removed) paths.push(['instances', id])
      paths.push(...removalReferencePaths(project, removed, edit.surfaceId))
      for (const instance of Object.values(project.instances)) if (instance.attachments?.some(attachment => removed.has(attachment.instanceId)
        || attachment.target.kind === 'instance' && removed.has(attachment.target.instanceId)
        || attachment.target.kind === 'surface' && attachment.target.surfaceId === edit.surfaceId)) paths.push(['instances', instance.id, 'attachments'])
      structure.surfaces = structure.surfaces.filter(value => value.id !== edit.surfaceId)
      for (const id of removed) delete structure.instances[id]
      continue
    }
    if (edit.type === 'spatial.set' || edit.type === 'flow.set' || edit.type === 'surface.background.set' || edit.type === 'surface.presentation.set') {
      const field = edit.type === 'spatial.set' ? 'spatial' : edit.type === 'flow.set' ? 'flow' : edit.type.split('.')[1]
      paths.push(['@surface', edit.surfaceId, 'id'], ['@surface', edit.surfaceId, field]); continue
    }
    if (edit.type === 'definition.set') { paths.push(['definitions', edit.definition.id]); continue }
    if (edit.type === 'definition.remove') { paths.push(['definitions', edit.definitionId], ['instances'], ['definitions']); continue }
    if (edit.type === 'asset.remove') { paths.push(['assets', edit.assetId], ['instances'], ['surfaces'], ['background'], ['media'], ['theme']); continue }
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
    if (edit.type === 'data.set' || edit.type === 'style.set') {
      const field = ['instances', edit.instanceId, edit.type === 'data.set' ? 'data' : 'style', ...edit.path]
      paths.push(field)
      if (edit.type === 'data.set') paths.push(...componentFieldIdentityPaths(project, field))
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
        const sourceChildren = children(source)
        sourceChildren.splice(sourceChildren.indexOf(edit.instanceId), 1)
        children(edit.container).splice(edit.index, 0, edit.instanceId)
      }
      else {
        const removed = new Set(descendantIds(structure, edit.instanceId))
        for (const id of removed) paths.push(['instances', id])
        paths.push(...removalReferencePaths(project, removed))
        for (const instance of Object.values(project.instances)) if (instance.attachments?.some(attachment => removed.has(attachment.instanceId)
          || attachment.target.kind === 'instance' && removed.has(attachment.target.instanceId))) paths.push(['instances', instance.id, 'attachments'])
        const sourceChildren = children(source)
        sourceChildren.splice(sourceChildren.indexOf(edit.instanceId), 1)
        for (const id of removed) delete structure.instances[id]
      }
    }
  }
  return [...new Map(paths.map(path => [JSON.stringify(path), path])).values()]
}

export function captureComponentOperation(project: CourseProjectV10, edits: ComponentEdit[]): ComponentOperationBatch {
  return { type: 'component-platform.apply', edits: structuredClone(edits), expected: dependencyPaths(project, edits)
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
    const surface = project.surfaces.find(value => value.id === id)
    if (!surface || surface.kind !== 'slide') throw new Error('尺寸修改目标演示页已不存在')
    return surface
  })
  const edits: ComponentEdit[] = surfaces.filter(surface => !equalComponentValue(surface.designSize ?? null, input.designSize))
    .map(surface => ({ type: 'surface.designSize.set', surfaceId: surface.id, designSize: input.designSize }))
  if (input.mode === 'preserve' || !surfaces.length) return edits
  const nextSize = input.designSize ?? DEFAULT_SLIDE_CANVAS
  const matrix = (surface: CourseProjectV10['surfaces'][number]): AffineMatrix => {
    const mapping = sharedSlideFrameMapping(surface.designSize ?? DEFAULT_SLIDE_CANVAS, nextSize)
    return [mapping.scale, 0, 0, mapping.scale, mapping.offsetX, mapping.offsetY]
  }
  const transforms = new Map(surfaces.map(surface => [surface.id, matrix(surface)]))
  const reference = input.globalReferenceSurfaceId ? project.surfaces.find(surface => surface.id === input.globalReferenceSurfaceId) : undefined
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
  for (const surface of project.surfaces) {
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
export function presentationComponentEdits(project: CourseProjectV10, surfaceId: string | null, stateId: string | null, edits: ComponentEdit[]): ComponentEdit[] {
  if (!surfaceId || !stateId) return edits
  const surface = project.surfaces.find(value => value.id === surfaceId)
  const original = surface?.presentation
  if (!original || !original.states.some(value => value.id === stateId)) throw new Error('捕获的展示状态已不存在')
  const presentation = structuredClone(original), state = presentation.states.find(value => value.id === stateId)!
  const effective = resolveComponentPresentation(project, surfaceId, stateId)
  const result: ComponentEdit[] = []
  let changed = false
  for (const edit of edits) {
    if (edit.type === 'instance.insert') {
      let owner: ComponentContainer | null = edit.container
      while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
      if (owner?.kind === 'surface' && owner.surfaceId === surfaceId) {
        const roots = new Set(edit.rootIds)
        for (const instance of edit.instances) if (roots.has(instance.id)) state.overrides[instance.id] = { visible: instance.visible !== false }
        result.push({ ...edit, instances: edit.instances.map(instance => roots.has(instance.id) ? { ...instance, visible: false } : instance) })
        if (edit.container.kind === 'surface' && state.order) state.order.splice(edit.index, 0, ...edit.rootIds)
        changed = true; continue
      }
    }
    if (edit.type === 'instance.move' && edit.container.kind === 'surface' && edit.container.surfaceId === surfaceId) {
      const owner = owningContainer(project, edit.instanceId)
      if (owner?.kind === 'surface' && owner.surfaceId === surfaceId) {
        const order = state.order ?? effective.surfaces.find(value => value.id === surfaceId)!.childIds
        state.order = order.filter(id => id !== edit.instanceId)
        if (edit.index > state.order.length) throw new Error('状态层序位置已不存在')
        state.order.splice(edit.index, 0, edit.instanceId)
        if (edit.frame) (state.overrides[edit.instanceId] ??= {}).frame = structuredClone(edit.frame)
        changed = true; continue
      }
    }
    if (!(edit.type === 'data.set' || edit.type === 'style.set' || edit.type === 'frame.set' || edit.type === 'instance.patch') || !project.instances[edit.instanceId]) {
      result.push(edit); continue
    }
    if (edit.type === 'instance.patch' && edit.patch.visible === undefined && edit.patch.playbackInitialVisibility === undefined) { result.push(edit); continue }
    let owner = owningContainer(project, edit.instanceId)
    while (owner?.kind === 'instance') owner = owningContainer(project, owner.instanceId)
    if (owner?.kind !== 'surface' || owner.surfaceId !== surfaceId) { result.push(edit); continue }
    const override = state.overrides[edit.instanceId] ??= {}
    if (edit.type === 'data.set') {
      if (!edit.path.length) override.data = structuredClone(edit.value)
      else { override.data ??= structuredClone(effective.instances[edit.instanceId].data); writeField(override.data, edit.path, edit.value) }
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
  return result
}

export function applyComponentOperation(project: CourseProjectV10, raw: ComponentOperationBatch): CourseProjectV10 {
  const command = componentOperationBatchSchema.parse(raw)
  checkComponentExpectations(project, command)
  const next = structuredClone(project)
  const removedInBatch = new Set<string>()
  for (const edit of command.edits) {
    // Every author entry reaches this application boundary. Runtime state/animation never does.
    const requireUnlocked = (id: string) => {
      if (project.instances[id] && componentIsLocked(next, id)) throw new Error('对象已锁定，请先解锁')
    }
    if ('instanceId' in edit && !(edit.type === 'instance.patch' && Object.keys(edit.patch).every(key => key === 'locked')))
      requireUnlocked(edit.instanceId)
    if (edit.type === 'instance.insert' && edit.container.kind === 'instance') requireUnlocked(edit.container.instanceId)
    if (edit.type === 'instance.move' && edit.container.kind === 'instance') requireUnlocked(edit.container.instanceId)
    if (edit.type === 'instance.remove') descendantIds(next, edit.instanceId).forEach(requireUnlocked)
    if (edit.type === 'surface.remove') next.surfaces.find(surface => surface.id === edit.surfaceId)?.childIds
      .flatMap(id => descendantIds(next, id)).forEach(requireUnlocked)
    if (edit.type === 'definition.set' || edit.type === 'definition.remove') {
      const id = edit.type === 'definition.set' ? edit.definition.id : edit.definitionId
      for (const instance of Object.values(next.instances)) if (instance.definitionId === id
        && (edit.type === 'definition.remove' || !equalComponentValue(next.definitions[id], edit.definition))) requireUnlocked(instance.id)
    }
    if (edit.type === 'component.files.set') for (const instance of Object.values(next.instances)) {
      const implementation = instance.implementationOverride ?? next.definitions[instance.definitionId]?.implementation
      if (implementation?.kind === 'source' && implementation.workspace?.ownerId === edit.ownerId) requireUnlocked(instance.id)
    }
    if (edit.type === 'asset.replace') for (const instance of Object.values(next.instances)) {
      if (componentAssetIds(instance, next.definitions[instance.definitionId]).includes(edit.asset.id)) requireUnlocked(instance.id)
    }
    if (edit.type === 'surface.presentation.set') {
      const old = next.surfaces.find(surface => surface.id === edit.surfaceId)?.presentation
      for (const state of [...(old?.states ?? []), ...(edit.presentation?.states ?? [])]) {
        const before = old?.states.find(value => value.id === state.id), after = edit.presentation?.states.find(value => value.id === state.id)
        for (const id of new Set([...Object.keys(before?.overrides ?? {}), ...Object.keys(after?.overrides ?? {})])) {
          if (!equalComponentValue(before?.overrides[id], after?.overrides[id])) requireUnlocked(id)
        }
      }
    }
    if (edit.type === 'component.files.set') continue
    if (edit.type === 'project.title.set') { next.title = edit.title; continue }
    if (edit.type === 'project.background.set') { if (edit.background == null) delete next.background; else next.background = structuredClone(edit.background); continue }
    if (edit.type === 'project.designTokens.set') { if (edit.designTokens == null) delete next.designTokens; else next.designTokens = structuredClone(edit.designTokens); continue }
    if (edit.type === 'project.theme.set') { if (edit.theme == null) delete next.theme; else next.theme = structuredClone(edit.theme); continue }
    if (edit.type === 'project.playback.set') { if (edit.playback == null) delete next.playback; else next.playback = structuredClone(edit.playback); continue }
    if (edit.type === 'project.media.set') { if (edit.media == null) delete next.media; else next.media = structuredClone(edit.media); continue }
    if (edit.type === 'project.logic.set') { if (edit.logic == null) delete next.logic; else next.logic = structuredClone(edit.logic); continue }
    if (edit.type === 'surface.insert') {
      if (next.surfaces.some(surface => surface.id === edit.surface.id)) throw new Error('表面身份已存在')
      if (edit.index > next.surfaces.length) throw new Error('表面插入位置已不存在')
      next.surfaces.splice(edit.index, 0, structuredClone(edit.surface)); continue
    }
    if (edit.type === 'surface.title.set' || edit.type === 'surface.designSize.set' || edit.type === 'surface.move' || edit.type === 'surface.remove') {
      const index = next.surfaces.findIndex(surface => surface.id === edit.surfaceId)
      const surface = next.surfaces[index]
      if (!surface) throw new Error('表面已不存在')
      if (edit.type === 'surface.title.set') surface.title = edit.title
      else if (edit.type === 'surface.designSize.set') { if (edit.designSize === null) delete surface.designSize; else surface.designSize = structuredClone(edit.designSize) }
      else if (edit.type === 'surface.move') {
        if (edit.index >= next.surfaces.length) throw new Error('表面移动位置已不存在')
        next.surfaces.splice(index, 1); next.surfaces.splice(edit.index, 0, surface)
      } else {
        const removed = new Set(surface.childIds.flatMap(id => descendantIds(next, id)))
        next.surfaces.splice(index, 1)
        for (const id of removed) { delete next.instances[id]; removedInBatch.add(id) }
        for (const other of Object.values(next.instances)) if (other.attachments) other.attachments = other.attachments.filter(attachment => !removed.has(attachment.instanceId)
          && !(attachment.target.kind === 'instance' && removed.has(attachment.target.instanceId))
          && !(attachment.target.kind === 'surface' && attachment.target.surfaceId === edit.surfaceId))
      }
      continue
    }
    if (edit.type === 'surface.background.set' || edit.type === 'surface.presentation.set' || edit.type === 'flow.set') {
      const surface = next.surfaces.find(value => value.id === edit.surfaceId)
      if (!surface) throw new Error('目标表面已不存在')
      if (edit.type === 'surface.background.set') { if (edit.background === null) delete surface.background; else surface.background = structuredClone(edit.background) }
      else if (edit.type === 'surface.presentation.set') { if (edit.presentation === null) delete surface.presentation; else surface.presentation = structuredClone(edit.presentation) }
      else surface.flow = structuredClone(edit.flow)
      continue
    }
    if (edit.type === 'spatial.set') {
      const surface = next.surfaces.find(value => value.id === edit.surfaceId)
      if (!surface || surface.kind !== 'spatial') throw new Error('目标不是Spatial表面')
      surface.spatial = structuredClone(edit.spatial); continue
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
      const referenced = Object.values(next.instances).some(instance => componentAssetIds(instance, next.definitions[instance.definitionId]).includes(edit.assetId))
        || next.background?.assetId === edit.assetId || next.surfaces.some(surface => surface.background?.assetId === edit.assetId
          || surface.presentation?.states.some(state => state.background?.assetId === edit.assetId || Object.entries(state.overrides).some(([instanceId, override]) => {
            if (override.data === undefined) return false
            const instance = next.instances[instanceId]
            return instance && componentAssetIds({ ...instance, data: override.data }, next.definitions[instance.definitionId]).includes(edit.assetId)
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
    if (edit.type === 'data.set') {
      if (!edit.path.length) instance.data = structuredClone(edit.value)
      else writeField(instance.data, edit.path, edit.value)
    } else if (edit.type === 'style.set') {
      if (!edit.path.length) {
        if (!edit.value || typeof edit.value !== 'object' || Array.isArray(edit.value)) throw new Error('样式必须是对象')
        instance.style = structuredClone(edit.value)
      } else { instance.style ??= {}; writeField(instance.style, edit.path, edit.value) }
    }
    else if (edit.type === 'frame.set') { if (edit.frame === null) delete instance.frame; else instance.frame = structuredClone(edit.frame) }
    else if (edit.type === 'instance.patch') {
      const { visibility, name, ...patch } = edit.patch
      Object.assign(instance, patch)
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
        if (instance.frame && !equalComponentValue(owner, edit.container) && !edit.frame) throw new Error('跨父移动需要保持视觉位置的局部 frame')
        destination.splice(edit.index, 0, edit.instanceId)
        if (edit.frame) instance.frame = structuredClone(edit.frame)
      } else {
        const removed = new Set(descendantIds(next, edit.instanceId))
        for (const id of removed) { delete next.instances[id]; removedInBatch.add(id) }
        for (const other of Object.values(next.instances)) if (other.attachments) other.attachments = other.attachments.filter(attachment => !removed.has(attachment.instanceId)
          && !(attachment.target.kind === 'instance' && removed.has(attachment.target.instanceId)))
      }
    }
  }
  const removed = new Set([...removedInBatch, ...Object.keys(project.instances).filter(id => !next.instances[id])].filter(id => !next.instances[id]))
  const removedSurfaces = new Set(project.surfaces.filter(surface => !next.surfaces.some(value => value.id === surface.id)).map(surface => surface.id))
  if (removed.size || removedSurfaces.size) removeDeletedReferences(next, removed, removedSurfaces)
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
  return courseProjectV10Schema.parse(next)
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
  for (const field of ['definitions', 'surfaces', 'global', 'assets', 'title', 'background', 'designTokens', 'theme', 'playback', 'media', 'logic'] as const) add([field], before[field], after[field], Object.hasOwn(after, field))
  for (const instance of Object.values(after.instances)) if (!equalComponentValue(before.definitions[instance.definitionId], after.definitions[instance.definitionId])) targets.add(instance.id)
  return { changes, affectedTargets: [...targets] }
}
