import { componentDefinitionBuiltinKey, owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'

export type ContainerEditingProject = Pick<CourseProjectV10, 'rootIds' | 'entry' | 'instances'> & Partial<Pick<CourseProjectV10, 'global'>>

/** Transient editor location. It never changes the work's entry or instance ownership. */
export interface ContainerEditingContext {
  rootInstanceId: string | null
  /** Null means the root view, including a root which is itself a container. */
  editingContainerId: string | null
  /** Existing professional workspaces use this actual container identity. */
  surfaceId: string | null
  /** Root/container ancestry or actual shared-layer containers; ordinary groups are omitted. */
  path: readonly string[]
  /** Shared-layer inspection retains its actual owner, independently of the work root. */
  editingPlane?: 'underlay' | 'overlay'
}

type GroupEditingProject = ContainerEditingProject & Pick<CourseProjectV10, 'definitions'>

/** The selection level is independent of whether its target owns a free frame. */
export function editingLevelFromAncestry(instanceId: string, ancestors: readonly string[], activeGroupId: string | null = null, deep = false): string | null {
  const index = activeGroupId ? ancestors.indexOf(activeGroupId) : -1
  if (activeGroupId && index < 0) return null
  return deep ? instanceId : ancestors[index + 1] ?? instanceId
}

/** A click may enter a group, but the same press dragged before release still moves the selected group. */
export interface GroupSelectionIntent {
  pressId: string
  clickId: string
  groupId: string | null
}

export function resolveGroupSelectionIntent(project: GroupEditingProject, scopeId: string | null,
  instanceId: string, selectedIds: readonly string[], activeGroupId: string | null = null,
  deep = false, additive = false): GroupSelectionIntent | null {
  if (!scopeId || instanceId === scopeId || !project.instances[instanceId]) return null
  const groups: string[] = [], visited = new Set<string>()
  let id = instanceId, inScope = false
  const ownership = { ...project, global: project.global ?? { underlay: [], overlay: [] } }
  while (!visited.has(id)) {
    visited.add(id)
    const owner = owningContainer(ownership, id)
    if (owner?.kind === 'global' || owner?.kind === 'instance' && owner.instanceId === scopeId) { inScope = true; break }
    if (owner?.kind !== 'instance' || project.instances[owner.instanceId]?.container) break
    id = owner.instanceId
    if (isOrdinaryEditingGroup(project, id)) groups.unshift(id)
  }
  if (!inScope) return null
  const context = activeGroupId && (groups.includes(activeGroupId) || activeGroupId === instanceId) ? activeGroupId : null
  if (deep) return { pressId: instanceId, clickId: instanceId, groupId: context ?? groups[0] ?? null }
  const selectedGroup = selectedIds.length === 1 && groups.includes(selectedIds[0]!) ? selectedIds[0]! : null
  if (selectedGroup && !additive) return { pressId: selectedGroup, clickId: instanceId, groupId: selectedGroup }
  if (context) return { pressId: instanceId, clickId: instanceId, groupId: context }
  const outer = groups[0] ?? instanceId
  return { pressId: outer, clickId: outer, groupId: null }
}

/** Resolve a visible leaf to its current selection level using only the formal author tree. */
export function editingLevelInstanceId(project: Pick<CourseProjectV10, 'instances' | 'rootIds' | 'global'>,
  scopeId: string | null, instanceId: string, activeGroupId: string | null = null, deep = false): string | null {
  if (!scopeId || instanceId === scopeId || !project.instances[instanceId]) return null
  const ancestors: string[] = [], visited = new Set<string>()
  let id = instanceId
  while (!visited.has(id)) {
    visited.add(id)
    const owner = owningContainer(project, id)
    if (owner?.kind === 'global' || owner?.kind === 'instance' && owner.instanceId === scopeId)
      return editingLevelFromAncestry(instanceId, ancestors, activeGroupId, deep)
    if (owner?.kind !== 'instance' || project.instances[owner.instanceId]?.container) return null
    ancestors.unshift(owner.instanceId); id = owner.instanceId
  }
  return null
}

export function isOrdinaryEditingGroup(project: GroupEditingProject, instanceId: string): boolean {
  const instance = project.instances[instanceId]
  return Boolean(instance && !instance.container
    && componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) === 'guoling.group')
}

/** Ordinary groups keep the current real surface and derive their ancestry from the author tree. */
export function groupEditingPath(project: GroupEditingProject, scopeId: string | null, groupId: string): readonly string[] | null {
  if (!scopeId || !isOrdinaryEditingGroup(project, groupId)) return null
  const visited = new Set<string>()
  const find = (ids: readonly string[], path: readonly string[]): readonly string[] | null => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance || visited.has(id)) continue
      visited.add(id)
      const next = isOrdinaryEditingGroup(project, id) ? [...path, id] : path
      if (id === groupId) return next
      if (!instance.container) {
        const result = find(instance.childIds ?? [], next)
        if (result) return result
      }
    }
    return null
  }
  return find(project.instances[scopeId]?.childIds ?? [], [])
    ?? find(project.global?.underlay ?? [], []) ?? find(project.global?.overlay ?? [], [])
}

/** Returning from a real container restores its ordinary parent group, when one exists. */
export function parentEditingGroup(project: GroupEditingProject, scopeId: string | null, instanceId: string): string | null {
  const owner = owningContainer({ ...project, global: project.global ?? { underlay: [], overlay: [] } }, instanceId)
  return owner?.kind === 'instance' && groupEditingPath(project, scopeId, owner.instanceId) ? owner.instanceId : null
}

export function resolveWorkRoot(project: ContainerEditingProject, desiredRootId?: string | null): string | null {
  const valid = (id: string | null | undefined): id is string => Boolean(id && project.rootIds.includes(id) && project.instances[id])
  if (valid(desiredRootId)) return desiredRootId
  if (valid(project.entry?.rootInstanceId)) return project.entry.rootInstanceId
  return project.rootIds.find(id => valid(id)) ?? null
}

/** Full author ancestry, ending at a real shared layer rather than at the current work root. */
export function globalContainerEditingLocation(project: ContainerEditingProject, containerId: string): { plane: 'underlay' | 'overlay'; path: readonly string[] } | null {
  if (!project.instances[containerId]?.container || !project.global) return null
  const ownership = { ...project, global: project.global }, path: string[] = [], visited = new Set<string>()
  let id = containerId
  while (project.instances[id] && !visited.has(id)) {
    visited.add(id); path.unshift(id)
    const owner = owningContainer(ownership, id)
    if (owner?.kind === 'global') return { plane: owner.plane, path }
    if (owner?.kind !== 'instance') return null
    id = owner.instanceId
  }
  return null
}

/** Entering a container changes inspection only, either inside this root or inside its shared layers. */
export function containerEditingPath(project: ContainerEditingProject, rootId: string, containerId: string): readonly string[] | null {
  if (!project.rootIds.includes(rootId) || !project.instances[rootId] || !project.instances[containerId]?.container) return null
  const visited = new Set<string>()
  const find = (id: string, path: readonly string[]): readonly string[] | null => {
    const instance = project.instances[id]
    if (!instance || visited.has(id)) return null
    visited.add(id)
    const next = id === rootId || instance.container ? [...path, id] : path
    if (id === containerId) return next
    for (const childId of instance.childIds ?? []) {
      const result = find(childId, next)
      if (result) return result
    }
    return null
  }
  return find(rootId, []) ?? globalContainerEditingLocation(project, containerId)?.path.filter(id => project.instances[id]?.container) ?? null
}

export function normalizeEditingContext(
  project: ContainerEditingProject,
  desiredRootId?: string | null,
  editingContainerId?: string | null,
  previousPath: readonly string[] = [],
): ContainerEditingContext {
  const rootInstanceId = resolveWorkRoot(project, desiredRootId)
  if (!rootInstanceId) return { rootInstanceId: null, editingContainerId: null, surfaceId: null, path: [] }
  const context = (id: string, path: readonly string[]): ContainerEditingContext => {
    const shared = globalContainerEditingLocation(project, id)
    return { rootInstanceId, editingContainerId: id === rootInstanceId ? null : id,
      surfaceId: id, path, ...(shared ? { editingPlane: shared.plane } : {}) }
  }
  if (editingContainerId) {
    const path = containerEditingPath(project, rootInstanceId, editingContainerId)
    if (path) return context(editingContainerId, path)
    // A removed/reparented container can leave its old breadcrumb behind. Reuse
    // only an ancestor still contained by this root, without following it elsewhere.
    if (rootInstanceId === desiredRootId) for (const id of [...previousPath].reverse()) {
      const ancestorPath = containerEditingPath(project, rootInstanceId, id)
      if (ancestorPath) return context(id, ancestorPath)
    }
  }
  return {
    rootInstanceId,
    editingContainerId: null,
    surfaceId: project.instances[rootInstanceId].container ? rootInstanceId : null,
    path: [rootInstanceId],
  }
}
