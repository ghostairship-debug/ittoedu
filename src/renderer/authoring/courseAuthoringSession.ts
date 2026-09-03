import type {
  CourseProjectDocument,
  CourseSurfaceType,
} from '../../shared/courseProjectTypes'
import type { CourseAuthoringOwner } from './courseAuthoringScope'

export type CourseAuthoringSurfaceType = Extract<
  CourseSurfaceType,
  'slide' | 'flow' | 'spatial-2d'
>

export interface CourseAuthoringSessionToken {
  readonly locationId: string
  readonly surfaceType: CourseAuthoringSurfaceType
  readonly revision: number
  readonly generation: number
}

export interface CourseAuthoringSession {
  readonly token: CourseAuthoringSessionToken
  readonly itemIds: readonly string[]
}

export interface CourseAuthoringExactRevisionPolicy {
  readonly kind: 'exact'
}

export interface CourseProjectRevisionTarget {
  readonly projectId: string
  readonly documentRevision: number
}

/**
 * Immutable identity captured before an asynchronous authoring operation.
 *
 * This is deliberately a scalar snapshot rather than a document, selection,
 * Store or navigation object. A later selection change therefore cannot
 * retarget the operation. The target is transient editor state and is never a
 * persisted Course Project field.
 */
export interface CourseAuthoringTarget {
  readonly projectId: string
  readonly documentRevision: number
  readonly revisionPolicy: CourseAuthoringExactRevisionPolicy
  readonly sessionGeneration: number
  readonly surfaceType: CourseAuthoringSurfaceType
  readonly surfaceId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly owner: CourseAuthoringOwner
  readonly ownerKey: string
  readonly itemId: string
  readonly authoringAddress: string
}

/** Current canonical identity supplied at completion time by the consumer. */
export interface CurrentCourseAuthoringTargetIdentity {
  readonly projectId: string
  readonly documentRevision: number
  readonly sessionToken: CourseAuthoringSessionToken
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: CourseAuthoringOwner
  readonly ownerKey: string
}

export const COURSE_AUTHORING_TARGET_REJECTION_CODES = [
  'project-mismatch',
  'session-stale',
  'surface-or-location',
  'owner-mismatch',
  'item-missing',
  'revision-conflict',
] as const

export type CourseAuthoringTargetRejectionCode =
  typeof COURSE_AUTHORING_TARGET_REJECTION_CODES[number]

export const COURSE_AUTHORING_TARGET_REJECTION_REASONS: Readonly<
  Record<CourseAuthoringTargetRejectionCode, string>
> = Object.freeze({
  'project-mismatch': '当前工程已改变，请重新选择目标后再试',
  'session-stale': '编辑会话已过期，请重新选择当前页面',
  'surface-or-location': '当前页面或呈现状态已改变，请重新选择目标后再试',
  'owner-mismatch': '当前编辑范围已改变，请重新选择目标后再试',
  'item-missing': '原目标已不存在或类型已改变，请重新选择后再试',
  'revision-conflict': '工程内容已改变，请重新选择目标后再试',
})

export type CourseAuthoringTargetValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: CourseAuthoringTargetRejectionCode
      readonly reason: string
    }

export type CourseAuthoringTargetItemLookup = (
  target: CourseAuthoringTarget,
) => boolean

export const COURSE_AUTHORING_STALE_SESSION_REASON =
  '编辑会话已过期，请重新选择当前页面'

export const COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON =
  '文字尚未提交，请先完成或取消编辑后再切换页面'

const COURSE_AUTHORING_EXACT_REVISION_POLICY = Object.freeze({
  kind: 'exact' as const,
})

const COURSE_AUTHORING_TARGET_VALID = Object.freeze({ ok: true as const })

/**
 * Captures one stable item identity from the existing Session lifecycle.
 * Location, surface type, revision and generation come from the Session token
 * so this helper cannot create a competing navigation truth.
 */
export function captureCourseAuthoringTarget(input: {
  readonly sessionToken: CourseAuthoringSessionToken
  readonly projectId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly owner: CourseAuthoringOwner
  readonly ownerKey: string
  readonly itemId: string
  readonly authoringAddress: string
}): CourseAuthoringTarget {
  const projectId = requireAuthoringIdentity(input.projectId, 'projectId')
  const surfaceId = requireAuthoringIdentity(input.surfaceId, 'surfaceId')
  const ownerKey = requireAuthoringIdentity(input.ownerKey, 'ownerKey')
  const itemId = requireAuthoringIdentity(input.itemId, 'itemId')
  const authoringAddress = requireAuthoringIdentity(
    input.authoringAddress,
    'authoringAddress',
  )
  if (input.stateId !== null) {
    requireAuthoringIdentity(input.stateId, 'stateId')
  }

  return Object.freeze({
    projectId,
    documentRevision: input.sessionToken.revision,
    revisionPolicy: COURSE_AUTHORING_EXACT_REVISION_POLICY,
    sessionGeneration: input.sessionToken.generation,
    surfaceType: input.sessionToken.surfaceType,
    surfaceId,
    locationId: input.sessionToken.locationId,
    stateId: input.stateId,
    owner: input.owner,
    ownerKey,
    itemId,
    authoringAddress,
  })
}

/**
 * Validates a captured target without importing a concrete Surface command.
 * `hasItem` is the consumer-owned carrier/existence port; it must resolve the
 * captured item and authoring address, never the current selection.
 */
export function validateCourseAuthoringTarget(input: {
  readonly target: CourseAuthoringTarget
  readonly current: CurrentCourseAuthoringTargetIdentity
  readonly hasItem: CourseAuthoringTargetItemLookup
}): CourseAuthoringTargetValidationResult {
  const { current, target } = input
  if (current.projectId !== target.projectId) {
    return rejectCourseAuthoringTarget('project-mismatch')
  }
  if (current.sessionToken.generation !== target.sessionGeneration) {
    return rejectCourseAuthoringTarget('session-stale')
  }
  if (
    current.sessionToken.surfaceType !== target.surfaceType ||
    current.surfaceId !== target.surfaceId ||
    current.sessionToken.locationId !== target.locationId ||
    current.stateId !== target.stateId
  ) {
    return rejectCourseAuthoringTarget('surface-or-location')
  }
  if (current.owner !== target.owner || current.ownerKey !== target.ownerKey) {
    return rejectCourseAuthoringTarget('owner-mismatch')
  }
  if (!input.hasItem(target)) {
    return rejectCourseAuthoringTarget('item-missing')
  }
  if (
    target.revisionPolicy.kind === 'exact' &&
    current.documentRevision !== target.documentRevision
  ) {
    return rejectCourseAuthoringTarget('revision-conflict')
  }
  return COURSE_AUTHORING_TARGET_VALID
}

export function guardCourseAuthoringTargetCallback<T>(
  input: {
    readonly target: CourseAuthoringTarget
    readonly current: CurrentCourseAuthoringTargetIdentity
    readonly hasItem: CourseAuthoringTargetItemLookup
  },
  run: () => T,
): T | Exclude<CourseAuthoringTargetValidationResult, { readonly ok: true }> {
  const validation = validateCourseAuthoringTarget(input)
  if (!validation.ok) return validation
  return run()
}

export function surfaceTypeForLocation(
  project: CourseProjectDocument,
  locationId: string,
): CourseAuthoringSurfaceType {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || (
    surface.type !== 'slide' &&
    surface.type !== 'flow' &&
    surface.type !== 'spatial-2d'
  )) {
    throw new Error(`找不到可编辑表面：${location.surfaceId}`)
  }
  return surface.type
}

export function createCourseAuthoringSession(input: {
  readonly locationId: string
  readonly surfaceType: CourseAuthoringSurfaceType
  readonly revision: number
  readonly itemIds?: readonly string[]
}): CourseAuthoringSession {
  return freezeSession({
    token: createSessionToken(input, 0),
    itemIds: input.itemIds ?? [],
  })
}

export function buildCourseAuthoringSessionForProject(
  project: CourseProjectDocument,
  locationId: string,
  itemIds: readonly string[] = [],
): CourseAuthoringSession {
  return createCourseAuthoringSession({
    locationId,
    surfaceType: surfaceTypeForLocation(project, locationId),
    revision: project.revision,
    itemIds,
  })
}

export function createSessionToken(
  input: {
    readonly locationId: string
    readonly surfaceType: CourseAuthoringSurfaceType
    readonly revision: number
  },
  generation: number,
): CourseAuthoringSessionToken {
  if (!input.locationId.trim()) throw new TypeError('locationId 不能为空')
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new TypeError('revision 必须是非负整数')
  }
  if (!Number.isInteger(generation) || generation < 0) {
    throw new TypeError('generation 必须是非负整数')
  }
  return Object.freeze({
    locationId: input.locationId,
    surfaceType: input.surfaceType,
    revision: input.revision,
    generation,
  })
}

export function updateCourseAuthoringSessionItems(
  session: CourseAuthoringSession,
  itemIds: readonly string[],
): CourseAuthoringSession {
  return freezeSession({
    token: session.token,
    itemIds: Object.freeze([...itemIds]),
  })
}

export function updateCourseAuthoringSessionRevision(
  session: CourseAuthoringSession,
  revision: number,
): CourseAuthoringSession {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError('revision 必须是非负整数')
  }
  return freezeSession({
    token: Object.freeze({ ...session.token, revision }),
    itemIds: session.itemIds,
  })
}

export function canSwitchCourseAuthoringLocation(input: {
  readonly composing?: boolean
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (input.composing) {
    return { ok: false, reason: COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON }
  }
  return { ok: true }
}

export function switchCourseAuthoringLocation(
  session: CourseAuthoringSession,
  input: {
    readonly locationId: string
    readonly surfaceType: CourseAuthoringSurfaceType
    readonly revision: number
    readonly composing?: boolean
  },
): CourseAuthoringSession | { readonly ok: false; readonly reason: string } {
  const guard = canSwitchCourseAuthoringLocation(input)
  if (!guard.ok) return guard

  if (
    session.token.locationId === input.locationId &&
    session.token.surfaceType === input.surfaceType
  ) {
    return freezeSession({
      token: createSessionToken(input, session.token.generation),
      itemIds: [],
    })
  }

  return freezeSession({
    token: createSessionToken(input, session.token.generation + 1),
    itemIds: [],
  })
}

export function isFreshCourseAuthoringSessionToken(
  current: CourseAuthoringSessionToken,
  expected: Pick<CourseAuthoringSessionToken, 'locationId' | 'generation'>,
): boolean {
  return current.locationId === expected.locationId &&
    current.generation === expected.generation
}

export function rejectStaleCourseAuthoringSessionToken(
  current: CourseAuthoringSessionToken,
  expected: Pick<CourseAuthoringSessionToken, 'locationId' | 'generation'>,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (isFreshCourseAuthoringSessionToken(current, expected)) {
    return { ok: true }
  }
  return { ok: false, reason: COURSE_AUTHORING_STALE_SESSION_REASON }
}

export function guardCourseAuthoringSessionCallback<T>(
  session: CourseAuthoringSession,
  expected: Pick<CourseAuthoringSessionToken, 'locationId' | 'generation'>,
  run: () => T,
): T | { readonly ok: false; readonly reason: string } {
  const guard = rejectStaleCourseAuthoringSessionToken(session.token, expected)
  if (!guard.ok) return guard
  return run()
}

export function selectionSnapshotFromSession(
  session: CourseAuthoringSession,
  input: {
    readonly scope: 'location' | 'global'
    readonly focus: 'none' | 'text' | 'block' | 'overlay' | 'layer'
    readonly stateId?: string | null
  },
): {
  readonly locationId: string
  readonly revision: number
  readonly sessionGeneration: number
  readonly surfaceKind: CourseAuthoringSurfaceType
  readonly stateId: string | null
  readonly scope: 'location' | 'global'
  readonly focus: 'none' | 'text' | 'block' | 'overlay' | 'layer'
  readonly itemIds: readonly string[]
} {
  return Object.freeze({
    locationId: session.token.locationId,
    revision: session.token.revision,
    sessionGeneration: session.token.generation,
    surfaceKind: session.token.surfaceType,
    stateId: input.stateId ?? null,
    scope: input.scope,
    focus: input.focus,
    itemIds: session.itemIds,
  })
}

function freezeSession(session: CourseAuthoringSession): CourseAuthoringSession {
  return Object.freeze({
    token: Object.freeze({ ...session.token }),
    itemIds: Object.freeze([...session.itemIds]),
  })
}

function requireAuthoringIdentity(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} 不能为空`)
  return value
}

function rejectCourseAuthoringTarget(
  code: CourseAuthoringTargetRejectionCode,
): Exclude<CourseAuthoringTargetValidationResult, { readonly ok: true }> {
  return Object.freeze({
    ok: false as const,
    code,
    reason: COURSE_AUTHORING_TARGET_REJECTION_REASONS[code],
  })
}
