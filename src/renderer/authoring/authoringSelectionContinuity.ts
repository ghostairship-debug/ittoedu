import { readAuthoringToolSelection, type AuthoringToolSelectionV1 } from '../../shared/authoringToolContract'
import type { CourseLocation, CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { EditorTransactionStep } from './editorTransaction'
import { defaultOwnerForSurface, type CourseAuthoringOwner } from './courseAuthoringScope'
import { selectFlowToolResult, selectSlideToolResult, selectSpatialToolResult } from './toolSelection'

type CurrentAuthoringSelection = Pick<AuthoringToolSelectionV1, 'locationId' | 'stateId' | 'owner'> & { readonly itemIds: readonly string[] }

export interface AuthoringSelectionContinuity {
  readonly step: EditorTransactionStep
  /** The complete live browsing selection can be reprojected without repair. */
  readonly preservesCurrentSelection: boolean
}

function sameCarrier(left: CourseLocation, right: CourseLocation): boolean {
  if (left.kind !== right.kind || left.surfaceId !== right.surfaceId) return false
  if (left.kind === 'slide-scene' && right.kind === 'slide-scene') return left.sceneId === right.sceneId
  if (left.kind === 'flow-block' && right.kind === 'flow-block') return left.blockId === right.blockId
  return left.kind === 'spatial-camera' && right.kind === 'spatial-camera'
    && left.cameraFrameId === right.cameraFrameId
}

function surfaceFor(project: CourseProjectDocument, location: CourseLocation) {
  return project.surfaces.find(surface => surface.id === location.surfaceId)
}

function validSelection(project: CourseProjectDocument, hint: AuthoringToolSelectionV1): boolean {
  const location = project.locations.find(entry => entry.id === hint.locationId)
  const surface = location && surfaceFor(project, location)
  if (!surface) return false
  try {
    if (surface.type === 'slide') selectSlideToolResult(project, hint)
    else if (surface.type === 'flow') selectFlowToolResult(project, hint)
    else selectSpatialToolResult(project, hint)
    return true
  } catch {
    return false
  }
}

function possibleOwners(type: 'slide' | 'flow' | 'spatial-2d', preferred: CourseAuthoringOwner): CourseAuthoringOwner[] {
  const allowed: readonly CourseAuthoringOwner[] = type === 'slide'
    ? ['global', 'surface', 'scene']
    : type === 'flow'
      ? ['global', 'surface']
      : ['global', 'surface', 'world']
  const fallback = defaultOwnerForSurface(type)
  return allowed.includes(preferred) && preferred !== fallback ? [preferred, fallback] : [fallback]
}

function possibleStates(project: CourseProjectDocument, location: CourseLocation, preferred: string | null): Array<string | null> {
  if (location.kind !== 'slide-scene') return [null]
  const surface = surfaceFor(project, location)
  const scene = surface?.type === 'slide' ? surface.scenes.find(entry => entry.id === location.sceneId) : undefined
  const states = new Set(scene?.presentation?.states.map(state => state.id) ?? [])
  const fallback = location.stateId && states.has(location.stateId) ? location.stateId : null
  return preferred && states.has(preferred) && preferred !== fallback ? [preferred, fallback] : [fallback]
}

function validItems(project: CourseProjectDocument, base: Omit<AuthoringToolSelectionV1, 'itemIds'>,
  itemIds: readonly string[]): AuthoringToolSelectionV1 | null {
  const carriers: Array<AuthoringToolSelectionV1['flowCarrier']> = base.flowCarrier
    ? [base.flowCarrier]
    : [undefined, 'overlay']
  let best: AuthoringToolSelectionV1 | null = null
  for (const flowCarrier of carriers) {
    const candidateBase = { ...base, ...(flowCarrier ? { flowCarrier } : {}) }
    const kept = itemIds.filter(itemId => validSelection(project, { ...candidateBase, itemIds: [itemId] }))
    const candidate = { ...candidateBase, itemIds: kept }
    if (validSelection(project, candidate) && (!best || candidate.itemIds.length > best.itemIds.length)) best = candidate
  }
  return best
}

function fallbackSelection(before: CourseProjectDocument, next: CourseProjectDocument,
  current: CurrentAuthoringSelection): AuthoringToolSelectionV1 {
  const previousLocation = before.locations.find(location => location.id === current.locationId)
  const sameLocation = next.locations.find(location => location.id === current.locationId)
  const samePhysicalCarrier = previousLocation
    ? next.locations.find(location => sameCarrier(previousLocation, location))
    : undefined
  const start = next.locations.find(location => location.id === next.startLocationId)
  const location = sameLocation ?? samePhysicalCarrier ?? start
  if (!location) throw new Error('完整工程没有有效的起始课程位置')
  const surface = surfaceFor(next, location)
  if (!surface) throw new Error(`找不到表面：${location.surfaceId}`)
  const retainsCarrier = Boolean(sameLocation || samePhysicalCarrier)
  for (const owner of possibleOwners(surface.type, retainsCarrier ? current.owner : defaultOwnerForSurface(surface.type))) {
    for (const stateId of possibleStates(next, location, retainsCarrier ? current.stateId : null)) {
      const base = { kind: 'authoring-tool-selection' as const, locationId: location.id, stateId, owner }
      const selected = validItems(next, base, retainsCarrier ? current.itemIds : [])
      if (selected) return selected
    }
  }
  const selection = { kind: 'authoring-tool-selection' as const, locationId: location.id, stateId: null,
    owner: defaultOwnerForSurface(surface.type), itemIds: [] }
  if (!validSelection(next, selection)) throw new Error(`无法建立有效作者位置：${location.id}`)
  return selection
}

/**
 * Reconcile a transaction with the live author selection at commit time.
 * Candidate destinations are immutable version anchors and are never used as
 * browsing intent. A valid explicit tool selection still wins unchanged.
 */
export function preserveAuthoringSelectionAcrossTransaction(
  step: EditorTransactionStep,
  current: CurrentAuthoringSelection,
): AuthoringSelectionContinuity {
  let existing: AuthoringToolSelectionV1 | null = null
  try { existing = readAuthoringToolSelection(step.selectionHint) } catch { /* malformed hints are repaired below */ }
  const currentHint: AuthoringToolSelectionV1 = { kind: 'authoring-tool-selection', ...current, itemIds: [...current.itemIds] }
  const preservesCurrentSelection = validSelection(step.nextDocument, currentHint)
  if (existing && validSelection(step.nextDocument, existing)) return { step, preservesCurrentSelection }
  if (preservesCurrentSelection && step.selectionHint === undefined) return { step, preservesCurrentSelection: true }
  const selectionHint = preservesCurrentSelection ? currentHint
    : fallbackSelection(step.previousDocument, step.nextDocument, current)
  return { step: Object.freeze({ ...step, selectionHint: Object.freeze(selectionHint) }), preservesCurrentSelection }
}
