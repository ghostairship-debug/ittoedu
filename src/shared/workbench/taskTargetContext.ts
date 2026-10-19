import { componentFrameSchema, type ComponentFrame } from '../contracts/component-platform'
import type { DelegationTarget } from './toolPorts'

/** Host-frozen task facts travel with the candidate; they do not become author data. */
export interface TaskTargetMetadata { targetContext?: unknown }

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

function size(value: unknown): { width: number; height: number } | undefined {
  const candidate = record(value)
  return candidate && typeof candidate.width === 'number' && typeof candidate.height === 'number'
    && Number.isFinite(candidate.width) && Number.isFinite(candidate.height) && candidate.width > 0 && candidate.height > 0
    ? { width: candidate.width, height: candidate.height } : undefined
}

/** Explicit placement has priority over the observed target's current internal viewport. */
export function taskTargetViewport(context: unknown): { width: number; height: number } | undefined {
  const captured = record(context)
  return captured ? size(captured.region) ?? size(captured.viewport) ?? size(captured.frame) : undefined
}

/** Restore the task's declared address for a fresh owner read. Observed frame and
 * viewport remain current facts; neither becomes a new placement declaration. */
export function taskTargetDeclaration(context: unknown): DelegationTarget | undefined {
  const captured = record(context)
  if (!captured || typeof captured.path !== 'string' || !captured.path.trim()) return undefined
  const region = captured.regionStatus === 'explicit' || captured.regionStatus === undefined
    ? componentFrameSchema.safeParse(captured.region) : undefined
  return { path: captured.path,
    ...(typeof captured.project === 'string' && captured.project.trim() ? { project: captured.project } : {}),
    ...(region?.success ? { region: structuredClone(region.data) } : {}) }
}

function targetIdentity(value: unknown): string | undefined {
  const target = record(value)
  if (target?.kind === 'instance' && typeof target.instanceId === 'string') return `instance:${target.instanceId}`
  if (target?.kind !== 'container') return undefined
  const container = record(target.container)
  if (container?.kind === 'surface' && typeof container.surfaceId === 'string') return `surface:${container.surfaceId}`
  if (container?.kind === 'instance' && typeof container.instanceId === 'string') return `container:${container.instanceId}`
  if (container?.kind === 'global' && (container.plane === 'underlay' || container.plane === 'overlay')) return `global:${container.plane}`
  return undefined
}

/** Inherit one declared region only for the same formal destination. Current apply/CAS
 * still owns freshness and existing-object frames; a revision difference is not a new gate. */
export function taskTargetRegion(context: unknown, destination: {
  documentId: string; epoch: string; target: unknown; editingContext?: { surfaceId: string; stateId: string | null }
}): ComponentFrame | undefined {
  const captured = record(context)
  if (!captured || captured.documentId !== destination.documentId || captured.epoch !== destination.epoch) return undefined
  const identity = targetIdentity(captured.target)
  if (!identity || identity !== targetIdentity(destination.target)) return undefined
  const state = record(captured.editingContext)
  if ((state || destination.editingContext) && (!state || !destination.editingContext
    || state.surfaceId !== destination.editingContext.surfaceId || state.stateId !== destination.editingContext.stateId)) return undefined
  const region = componentFrameSchema.safeParse(captured.region)
  return region.success ? structuredClone(region.data) : undefined
}
