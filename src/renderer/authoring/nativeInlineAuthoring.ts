import { componentIsLocked, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { invertMatrix, multiplyMatrices, type AffineMatrix } from '../../core/components/geometry'
import { componentClientMatrix } from '../../player/components/runtime/componentClientMatrix'
import { freeSurfaceTargets, type FreeObjectTarget } from '../componentPlatform/surfaces/slide/targets'
import { editingLevelInstanceId } from '../documents/containerEditingContext'

export interface ComponentInlineChildHit { instanceId: string; ownerId: string }

function inlineMount(slot: HTMLElement): (ComponentInlineChildHit & { root: HTMLElement }) | undefined {
  const instanceId = slot.dataset.componentInlineSlot
  const ownerId = slot.closest<HTMLElement>('[data-component-inline-overlay]')?.dataset.componentInlineOverlay
  if (!instanceId || !ownerId) return undefined
  // Only the host's direct World/Host allocation names this child. Author DOM
  // and an empty slot do not confer a second component identity.
  const world = [...slot.children].find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.componentRuntimeRoot === instanceId)
  const root = world && [...world.children].find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset.componentInstanceId === instanceId)
  return root ? { instanceId, ownerId, root } : undefined
}

/** A content hit can name a native child while object selection keeps its current level. */
export function componentInlineChildAt(element: Element): ComponentInlineChildHit | undefined {
  const slot = element.closest<HTMLElement>('[data-component-inline-slot]'), mounted = slot && inlineMount(slot)
  return mounted?.root.contains(element) ? { instanceId: mounted.instanceId, ownerId: mounted.ownerId } : undefined
}

/** View-only geometry for the existing native editor; no DOM measurement becomes an author frame. */
export function nativeInlineAuthorTarget(project: CourseProjectV10, surfaceId: string | null, activeGroupId: string | null | undefined,
  workspace: HTMLElement | null, instanceId: string, surfaceToClient: AffineMatrix, expectedOwnerId?: string): FreeObjectTarget | null {
  if (!workspace || !surfaceId) return null
  const instance = project.instances[instanceId], definition = instance && project.definitions[instance.definitionId]
  if (!instance || componentIsLocked(project, instanceId)) return null
  const implementation = instance?.implementationOverride ?? definition?.implementation
  if (implementation?.kind !== 'builtin' || !['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'].includes(implementation.key)) return null
  const allocations = [...workspace.querySelectorAll<HTMLElement>('[data-component-inline-slot]')]
    .filter(slot => slot.dataset.componentInlineSlot === instanceId).flatMap(slot => {
      const value = inlineMount(slot)
      return value && (!expectedOwnerId || value.ownerId === expectedOwnerId) && componentClientMatrix(value.root) ? [value] : []
    })
  // An instance may have a parked or repeated projection. Never choose the
  // first visible copy; the captured owner must resolve to one live allocation.
  if (allocations.length !== 1) return null
  const mounted = allocations[0]!
  if (!project.instances[mounted.ownerId]?.childIds?.includes(instanceId)) return null
  const level = mounted.ownerId === surfaceId ? mounted.ownerId : editingLevelInstanceId(project, surfaceId, mounted.ownerId, activeGroupId)
  if (level !== mounted.ownerId) return null
  const target = freeSurfaceTargets(project, surfaceId).find(value => value.instanceId === instanceId)
    ?? freeSurfaceTargets(project, mounted.ownerId).find(value => value.instanceId === instanceId)
  const rendered = componentClientMatrix(mounted.root)
  if (!target || !rendered) return null
  try {
    // Runtime inline mounting allocates the native root at the authored slot,
    // independently of its saved free-frame translation. Cancel only that
    // translation/linear basis in this disposable editor projection.
    return { ...target, parentToSurface: multiplyMatrices(multiplyMatrices(invertMatrix(surfaceToClient), rendered), invertMatrix(target.frame.transform)) }
  } catch { return null }
}
