import { owningContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'

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
