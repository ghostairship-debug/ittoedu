import { isComponentVisibleAtSurface, type ComponentContainer, type CourseProjectV10 } from '../../../shared/contracts/component-platform/project'

interface RuntimeOwnership {
  instances: CourseProjectV10['instances']
  revision: number
  roots: CourseProjectV10['rootIds']
  underlay: string[]
  overlay: string[]
  owners: ReadonlyMap<string, ComponentContainer>
}
const ownership = new WeakMap<CourseProjectV10, RuntimeOwnership>()

/** Runtime consumes immutable document/projection snapshots. Index the existing
 * formal tree once, rather than scanning every instance at each ancestry step.
 * A new snapshot (including Undo/Redo) gets its own derived index. */
export function runtimeInstanceOwner(project: CourseProjectV10, id: string): ComponentContainer | undefined {
  let index = ownership.get(project)
  if (!index || index.instances !== project.instances || index.revision !== project.revision || index.roots !== project.rootIds
    || index.underlay !== project.global.underlay || index.overlay !== project.global.overlay) {
    const owners = new Map<string, ComponentContainer>()
    for (const root of project.rootIds) owners.set(root, { kind: 'project' })
    for (const plane of ['underlay', 'overlay'] as const)
      for (const child of project.global[plane]) if (!owners.has(child)) owners.set(child, { kind: 'global', plane })
    for (const instance of Object.values(project.instances))
      for (const child of instance.childIds ?? []) if (!owners.has(child)) owners.set(child, { kind: 'instance', instanceId: instance.id })
    index = { instances: project.instances, revision: project.revision, roots: project.rootIds,
      underlay: project.global.underlay, overlay: project.global.overlay, owners }
    ownership.set(project, index)
  }
  return index.owners.get(id)
}

/** Derived author ownership only; navigation and runtime state keep their existing owners. */
export function instanceContainerId(project: CourseProjectV10, instanceId: string, includeSelf = false): string | null {
  if (includeSelf && project.instances[instanceId]?.container) return instanceId
  const visited = new Set<string>()
  let owner = runtimeInstanceOwner(project, instanceId)
  while (owner?.kind === 'instance') {
    if (visited.has(owner.instanceId)) return null
    visited.add(owner.instanceId)
    if (project.instances[owner.instanceId]?.container) return owner.instanceId
    owner = runtimeInstanceOwner(project, owner.instanceId)
  }
  return null
}

/** The root controls entry/leave; a nested container does not become another work root. */
export function instanceWorkRootId(project: CourseProjectV10, instanceId: string): string | null | undefined {
  const visited = new Set<string>()
  let current = instanceId
  while (!visited.has(current)) {
    visited.add(current)
    const owner = runtimeInstanceOwner(project, current)
    if (owner?.kind === 'project') return current
    if (owner?.kind === 'global') return null
    if (owner?.kind !== 'instance') return undefined
    current = owner.instanceId
  }
  return undefined
}

export function containerRootId(project: CourseProjectV10, containerId: string): string | undefined {
  return instanceWorkRootId(project, containerId) ?? undefined
}

export function containerIsActive(project: CourseProjectV10, containerId: string, activeRootId: string | null): boolean {
  if (!project.instances[containerId]?.container || containerRootId(project, containerId) !== activeRootId) return false
  const visited = new Set<string>()
  let current = containerId
  while (!visited.has(current)) {
    visited.add(current)
    const instance = project.instances[current]
    if (!instance || !isComponentVisibleAtSurface(instance, activeRootId ?? '')) return false
    const owner = runtimeInstanceOwner(project, current)
    if (owner?.kind === 'project') return true
    if (owner?.kind !== 'instance') return false
    current = owner.instanceId
  }
  return false
}

export function isWithinContainer(project: CourseProjectV10, instanceId: string, containerId: string): boolean {
  const visited = new Set<string>()
  let current = instanceId
  while (!visited.has(current)) {
    if (current === containerId) return true
    visited.add(current)
    const owner = runtimeInstanceOwner(project, current)
    if (owner?.kind !== 'instance') return false
    current = owner.instanceId
  }
  return false
}
