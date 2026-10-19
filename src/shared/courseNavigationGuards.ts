import type { CourseProjectLogic } from './contracts/component-platform/project'

type NavigationGuard = CourseProjectLogic['navigationGuards'][number]
export type NavigationGuardSources = { kind: 'all' } | { kind: 'only'; surfaceIds: readonly [string, ...string[]] } | { kind: 'none' }

/** The one read boundary for the historical empty-array spelling of all sources. */
export function readNavigationGuardSources(surfaceIds: readonly string[] | undefined): NavigationGuardSources {
  return surfaceIds?.length ? { kind: 'only', surfaceIds: surfaceIds as readonly [string, ...string[]] } : { kind: 'all' }
}

export function navigationGuardHasSource(guard: Pick<NavigationGuard, 'fromSurfaceIds'>, surfaceId: string): boolean {
  const sources = readNavigationGuardSources(guard.fromSurfaceIds)
  return sources.kind === 'all' || sources.kind === 'only' && sources.surfaceIds.includes(surfaceId)
}

/** New author writes use omission for all and a nonempty list for a restriction. */
export function canonicalNavigationGuard(guard: NavigationGuard): NavigationGuard {
  const { fromSurfaceIds, ...rest } = guard, sources = readNavigationGuardSources(fromSurfaceIds)
  return sources.kind === 'only' ? { ...rest, fromSurfaceIds: [...sources.surfaceIds] } : rest
}

function removeSources(sources: NavigationGuardSources, removed: ReadonlySet<string>): NavigationGuardSources {
  if (sources.kind !== 'only') return sources
  const remaining = sources.surfaceIds.filter(id => !removed.has(id))
  return remaining.length ? { kind: 'only', surfaceIds: remaining as [string, ...string[]] } : { kind: 'none' }
}

/** A deleted final restriction becomes no rule in the same formal deletion transaction. */
export function removeNavigationGuardSurfaces(guard: NavigationGuard, removed: ReadonlySet<string>): NavigationGuard | null {
  if (!guard.fromSurfaceIds?.some(id => removed.has(id)) && !guard.toSurfaceIds.some(id => removed.has(id))) return guard
  const sources = removeSources(readNavigationGuardSources(guard.fromSurfaceIds), removed)
  const toSurfaceIds = guard.toSurfaceIds.filter(id => !removed.has(id))
  if (sources.kind === 'none' || guard.toSurfaceIds.length > 0 && !toSurfaceIds.length) return null
  const { fromSurfaceIds: _from, ...rest } = guard
  return { ...rest, toSurfaceIds, ...(sources.kind === 'only' ? { fromSurfaceIds: [...sources.surfaceIds] } : {}) }
}
