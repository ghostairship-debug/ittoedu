import { isComponentVisibleAtSurface, owningContainer, type CourseProjectV10 } from '../../../shared/contracts/component-platform/project'

/** Derived author ownership only; navigation and runtime state keep their existing owners. */
export function instanceContainerId(project: CourseProjectV10, instanceId: string, includeSelf = false): string | null {
  if (includeSelf && project.instances[instanceId]?.container) return instanceId
  const visited = new Set<string>()
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') {
    if (visited.has(owner.instanceId)) return null
    visited.add(owner.instanceId)
    if (project.instances[owner.instanceId]?.container) return owner.instanceId
    owner = owningContainer(project, owner.instanceId)
  }
  return null
}

/** The root controls entry/leave; a nested container does not become another work root. */
export function instanceWorkRootId(project: CourseProjectV10, instanceId: string): string | null | undefined {
  const visited = new Set<string>()
  let current = instanceId
  while (!visited.has(current)) {
    visited.add(current)
    const owner = owningContainer(project, current)
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
    const owner = owningContainer(project, current)
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
    const owner = owningContainer(project, current)
    if (owner?.kind !== 'instance') return false
    current = owner.instanceId
  }
  return false
}
