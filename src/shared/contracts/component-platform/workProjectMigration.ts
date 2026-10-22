import { normalizeLegacyFlowBackgrounds } from './legacyFlowBackground'
import { componentContainerBuiltinKey, componentDefinitionBuiltinKey, createComponentContainerInstance,
  type ComponentInstance, type ComponentSurface, type CourseProjectV11, type JsonValue, type LegacyCourseProjectV10 } from './project'
import { courseProjectV11Schema, legacyCourseProjectV10Schema } from './schema'
import { UserFacingError } from '../../errors'

type ContainerKind = ComponentSurface['kind']
export interface WorkProjectMigrationMap {
  surfaceIds: Record<string, string>
  containerDefinitionIds: Record<ContainerKind, string>
}

function version(input: unknown): unknown {
  return input && typeof input === 'object' ? Reflect.get(input, 'schemaVersion') : undefined
}

/** Preserve earlier experimental V11 input rather than silently discarding its overrides. */
function readProjectV11(input: unknown): CourseProjectV11 {
  const result = courseProjectV11Schema.safeParse(normalizeLegacyFlowBackgrounds(input))
  if (result.success) return result.data
  const conflict = result.error.issues.find(issue => issue.code === 'custom'
    && issue.path[0] === 'instances' && issue.path[2] === 'container' && issue.path[3] === 'presentation')
  if (conflict) {
    const id = String(conflict.path[1])
    throw new UserFacingError('工程含有不适用的场景状态',
      `容器“${id}”在早期 Project 11 中保存了非 Slide 场景状态。Flow 的内部导航是章节标题，Spatial 的内部导航是镜头。`,
      '原工程、恢复稿和状态覆盖均未修改。请保留原件，在副本中明确处理这些状态后重新打开；软件不会自动删除或压平内容。',
      { cause: result.error })
  }
  throw result.error
}

/** One identity map is shared by current, saved and every history model. */
export function createWorkProjectMigrationMap(inputs: readonly unknown[], existing?: WorkProjectMigrationMap): WorkProjectMigrationMap {
  const projects = inputs.map(input => version(input) === 11 ? readProjectV11(input) : legacyCourseProjectV10Schema.parse(normalizeLegacyFlowBackgrounds(input)))
  const instanceIds = new Set(projects.flatMap(project => Object.keys(project.instances)))
  // A container already converted in a sibling history model is the same identity,
  // not a new collision merely because it now resides in instances.
  const collisionIds = new Set(projects.flatMap(project => Object.values(project.instances)
    .filter(instance => project.schemaVersion === 10 || !instance.container).map(instance => instance.id)))
  const definitionIds = new Set(projects.flatMap(project => Object.keys(project.definitions)))
  const surfaceIds = [...new Set(projects.flatMap(project => 'surfaces' in project ? project.surfaces.map(surface => surface.id) : []))]
  // Reserve every old surface name before allocating collision replacements.
  const allocated = new Set([...instanceIds, ...surfaceIds, ...Object.values(existing?.surfaceIds ?? {})])
  const allocate = (base: string, occupied: Set<string>) => {
    let result = base, suffix = 2
    while (occupied.has(result)) result = `${base}:${suffix++}`
    occupied.add(result)
    return result
  }
  const mappedSurfaces: Record<string, string> = Object.assign(Object.create(null),existing?.surfaceIds)
  // A later external V10 edit can legitimately introduce an ordinary object at
  // an earlier synthetic container ID. Only that read context needs a new root
  // ID; already canonical history models retain their original identities.
  for (const surfaceId of surfaceIds) if (Object.hasOwn(mappedSurfaces,surfaceId)
    && collisionIds.has(mappedSurfaces[surfaceId])) mappedSurfaces[surfaceId] = allocate(`container:${surfaceId}`,allocated)
  for (const surfaceId of surfaceIds) if (!Object.hasOwn(mappedSurfaces,surfaceId)) mappedSurfaces[surfaceId] = collisionIds.has(surfaceId)
    || Object.values(mappedSurfaces).includes(surfaceId) ? allocate(`container:${surfaceId}`, allocated) : surfaceId
  const containerDefinitionIds = Object.assign(Object.create(null),existing?.containerDefinitionIds) as Record<ContainerKind, string>
  for (const id of Object.values(containerDefinitionIds)) definitionIds.add(id)
  for (const kind of ['slide', 'flow', 'spatial'] as const) {
    const key = componentContainerBuiltinKey(kind)
    const compatible = (id: string) => projects.every(project => {
      const implementation = project.definitions[id]?.implementation
      return !implementation || implementation.kind === 'builtin' && implementation.key === key
    })
    if (containerDefinitionIds[kind] && compatible(containerDefinitionIds[kind])) continue
    const matching = projects.flatMap(project => Object.values(project.definitions)).find(definition => definition.implementation.kind === 'builtin'
      && definition.implementation.key === key && compatible(definition.id))
    containerDefinitionIds[kind] = matching?.id ?? allocate(`builtin:${key}`, definitionIds)
  }
  return { surfaceIds: mappedSurfaces, containerDefinitionIds }
}

/** Only declared platform navigation data is rewritten; source text and arbitrary business data stay intact. */
function remapNavigationData(data: JsonValue, surfaceIds: Readonly<Record<string, string>>): JsonValue {
  const visit = (value: JsonValue): JsonValue => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(visit)
    const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    if (next.type === 'scene.go' && typeof next.sceneId === 'string') next.sceneId = surfaceIds[next.sceneId] ?? next.sceneId
    if (next.type === 'location.go' && typeof next.locationId === 'string') next.locationId = surfaceIds[next.locationId] ?? next.locationId
    if (next.type === 'scene.in' && Array.isArray(next.sceneIds)) next.sceneIds = next.sceneIds.map(id => typeof id === 'string' ? surfaceIds[id] ?? id : id)
    if (next.sceneStyles && typeof next.sceneStyles === 'object' && !Array.isArray(next.sceneStyles)) {
      next.sceneStyles = Object.fromEntries(Object.entries(next.sceneStyles).map(([id, style]) => [surfaceIds[id] ?? id, style]))
    }
    return next
  }
  return visit(data)
}

function remapInstance(instance: ComponentInstance, project: LegacyCourseProjectV10, identities: WorkProjectMigrationMap): ComponentInstance {
  const next = structuredClone(instance)
  if (next.visibility) next.visibility.surfaceIds = next.visibility.surfaceIds.map(id => identities.surfaceIds[id] ?? id)
  if (next.attachments) next.attachments = next.attachments.map(attachment => ({ ...attachment,
    target: attachment.target.kind === 'surface'
      ? { kind: 'instance', instanceId: identities.surfaceIds[attachment.target.surfaceId] ?? attachment.target.surfaceId }
      : attachment.target,
  }))
  const key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
  if (key === 'guoling.interactions' || key === 'guoling.navigation') next.data = remapNavigationData(next.data, identities.surfaceIds)
  return next
}

export function migrateCourseProjectV10(input: unknown, options: { identities?: WorkProjectMigrationMap } = {}): CourseProjectV11 {
  const source = legacyCourseProjectV10Schema.parse(normalizeLegacyFlowBackgrounds(input))
  const identities = options.identities ?? createWorkProjectMigrationMap([source])
  const { surfaces, schemaVersion: _schemaVersion, ...rest } = source
  const project: CourseProjectV11 = { ...rest, schemaVersion: 11,
    definitions: structuredClone(source.definitions),
    instances: Object.fromEntries(Object.entries(source.instances).map(([id, instance]) => [id, remapInstance(instance, source, identities)])),
    rootIds: surfaces.map(surface => identities.surfaceIds[surface.id] ?? surface.id),
    ...(surfaces[0] ? { entry: { rootInstanceId: identities.surfaceIds[surfaces[0].id] ?? surfaces[0].id } } : {}),
  }
  for (const surface of surfaces) {
    const instanceId = identities.surfaceIds[surface.id] ?? surface.id
    const definitionId = identities.containerDefinitionIds[surface.kind]
    if (!project.definitions[definitionId]) project.definitions[definitionId] = {
      id: definitionId, title: surface.kind === 'flow' ? '流式容器' : surface.kind === 'spatial' ? '空间容器' : '幻灯片容器',
      role: 'mixed', implementation: { kind: 'builtin', key: componentContainerBuiltinKey(surface.kind) },
    }
    if (project.instances[instanceId]) throw new Error(`容器身份与已有实例冲突：${instanceId}`)
    const instance = createComponentContainerInstance(surface, definitionId, instanceId)
    for (const state of instance.container?.presentation?.states ?? []) for (const [id, override] of Object.entries(state.overrides)) {
      const key = componentDefinitionBuiltinKey(source.definitions[source.instances[id]?.definitionId])
      if (override.data !== undefined && (key === 'guoling.interactions' || key === 'guoling.navigation')) override.data = remapNavigationData(override.data, identities.surfaceIds)
    }
    project.instances[instanceId] = instance
  }
  if (project.logic) project.logic.navigationGuards = project.logic.navigationGuards.map(guard => ({ ...guard,
    ...(guard.fromSurfaceIds ? { fromSurfaceIds: guard.fromSurfaceIds.map(id => identities.surfaceIds[id] ?? id) } : {}),
    toSurfaceIds: guard.toSurfaceIds.map(id => identities.surfaceIds[id] ?? id),
  }))
  return courseProjectV11Schema.parse(project)
}

/** Public read normalization accepts only current Project 11 or the one supported V10 input. */
export function normalizeWorkProject(input: unknown, identities?: WorkProjectMigrationMap): CourseProjectV11 {
  if (version(input) === 11) return readProjectV11(input)
  return migrateCourseProjectV10(input, { identities })
}

export function migrateCourseProjectV10Models(inputs: readonly unknown[]): CourseProjectV11[] {
  const identities = createWorkProjectMigrationMap(inputs)
  return inputs.map(input => normalizeWorkProject(input, identities))
}
