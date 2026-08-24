import { makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import type {
  CourseRuntimeContent,
  CourseRuntimeDefinition,
} from '@/shared/courseProjectTypes'
import {
  captureCourseRuntimeContentTextTarget,
  type CourseRuntimeContentTextTarget,
} from './runtimeContentTextAuthoringCommands'
import {
  COURSE_RUNTIME_ENABLED_AUTHORING_FIELD,
  COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD,
  retargetCourseRuntimeProperty,
  type CourseRuntimePropertyTarget,
} from './runtimePropertyAuthoringCommands'
import {
  selectRuntimeSourceAuthoringView,
  type RuntimeSourceAuthoringCarrier,
  type RuntimeSourceReadonly,
  type SelectRuntimeSourceAuthoringViewInput,
  type UnavailableRuntimeSourceAuthoringView,
} from './runtimeSourceAuthoringView'

export type SelectRuntimeInspectorAuthoringViewInput =
  SelectRuntimeSourceAuthoringViewInput

export interface RuntimeInspectorContentField {
  readonly key: string
  readonly value: string
  readonly metadata?: RuntimeSourceReadonly<
    NonNullable<CourseRuntimeContent['metadata']>[string]
  >
  readonly target: CourseRuntimeContentTextTarget
}

export interface AvailableRuntimeInspectorAuthoringView {
  readonly availability: 'available'
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly label: string
  readonly documentKey: string
  readonly runtime: RuntimeSourceReadonly<CourseRuntimeDefinition>
  readonly protocol: CourseRuntimeDefinition['protocol']
  readonly runtimeApiVersion: CourseRuntimeDefinition['runtimeApiVersion']
  readonly enabled: boolean
  readonly renderMode: CourseRuntimeDefinition['renderMode']
  readonly sourceBytes: number
  readonly assetCount: number
  readonly fallback: RuntimeSourceReadonly<
    NonNullable<CourseRuntimeDefinition['staticFallback']>
  > | null
  readonly contentFields: readonly RuntimeInspectorContentField[]
  readonly effectiveLocked: boolean
  readonly enabledTarget: Extract<
    CourseRuntimePropertyTarget,
    { readonly field: 'enabled' }
  >
  readonly renderModeTarget: Extract<
    CourseRuntimePropertyTarget,
    { readonly field: 'renderMode' }
  >
}

export type UnavailableRuntimeInspectorAuthoringView =
  UnavailableRuntimeSourceAuthoringView

export type RuntimeInspectorAuthoringView =
  | AvailableRuntimeInspectorAuthoringView
  | UnavailableRuntimeInspectorAuthoringView

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
    || Object.isFrozen(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function sceneIdFromOwnerKey(
  owner: AvailableRuntimeInspectorAuthoringView['enabledTarget']['courseTarget']['owner'],
  ownerKey: string,
): string | null {
  if (owner !== 'scene') return null
  const prefix = 'scene:'
  return ownerKey.startsWith(prefix) ? ownerKey.slice(prefix.length) : null
}

/**
 * Selects the canonical Runtime inspector value model. Carrier discovery,
 * named-state validation and effective locking stay owned by the B1-09 source
 * selector; this adapter only adds exact scalar/content field targets.
 */
export function selectRuntimeInspectorAuthoringView(
  input: SelectRuntimeInspectorAuthoringViewInput,
): RuntimeInspectorAuthoringView {
  const source = selectRuntimeSourceAuthoringView(input)
  if (source.availability !== 'available') return source

  const sceneId = sceneIdFromOwnerKey(source.target.owner, source.target.ownerKey)
  if (source.target.owner === 'scene' && !sceneId) {
    return Object.freeze({
      availability: 'unavailable' as const,
      reason: 'invalid-location' as const,
      label: 'Runtime 的 scene ownerKey 无效',
      documentKey: null,
    })
  }
  const enabledTarget = retargetCourseRuntimeProperty(source.target, {
    field: 'enabled',
    initialValue: source.runtime.enabled,
  }) as AvailableRuntimeInspectorAuthoringView['enabledTarget']
  const renderModeTarget = retargetCourseRuntimeProperty(source.target, {
    field: 'renderMode',
    initialValue: source.runtime.renderMode,
  }) as AvailableRuntimeInspectorAuthoringView['renderModeTarget']
  const metadata = source.runtime.content.metadata
  const contentFields = Object.entries(source.runtime.content.values).map(
    ([key, value]): RuntimeInspectorContentField => {
      const fieldMetadata = metadata?.[key]
      return deepFreeze({
        key,
        value,
        ...(fieldMetadata ? { metadata: structuredClone(fieldMetadata) } : {}),
        target: captureCourseRuntimeContentTextTarget({
          sessionToken: input.sessionToken,
          projectId: source.target.projectId,
          surfaceId: source.target.surfaceId,
          stateId: source.target.stateId,
          owner: source.target.owner,
          sceneId,
          itemId: source.target.itemId,
          contentKey: key,
          initialValue: value,
        }),
      })
    },
  )
  const documentKey = JSON.stringify([
    'runtime-inspector',
    source.documentKey,
    enabledTarget.courseTarget.authoringAddress,
    renderModeTarget.courseTarget.authoringAddress,
  ])

  return deepFreeze({
    availability: 'available' as const,
    carrier: source.carrier,
    label: source.label,
    documentKey,
    runtime: source.runtime,
    protocol: source.runtime.protocol,
    runtimeApiVersion: source.runtime.runtimeApiVersion,
    enabled: source.runtime.enabled,
    renderMode: source.runtime.renderMode,
    sourceBytes: new TextEncoder().encode(source.runtime.source).byteLength,
    assetCount: Object.keys(source.runtime.assets).length,
    fallback: source.runtime.staticFallback ?? null,
    contentFields,
    effectiveLocked: source.effectiveLocked,
    enabledTarget,
    renderModeTarget,
  })
}

/** Exact field names are exported here for inspector/UI inventory assertions. */
export const RUNTIME_INSPECTOR_AUTHORING_FIELDS = Object.freeze({
  enabled: COURSE_RUNTIME_ENABLED_AUTHORING_FIELD,
  renderMode: COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD,
})

/** Produces a canonical exact address without exposing the B1-09 source target. */
export function runtimeInspectorPropertyAuthoringAddress(
  target: CourseRuntimePropertyTarget,
): string {
  const stable = target.courseTarget
  return makeLayerItemAuthoringAddress({
    projectId: stable.projectId,
    owner: stable.owner,
    surfaceId: stable.surfaceId,
    sceneId: sceneIdFromOwnerKey(stable.owner, stable.ownerKey),
    kind: 'runtime',
    layerItemId: stable.itemId,
    field: target.field === 'enabled'
      ? COURSE_RUNTIME_ENABLED_AUTHORING_FIELD
      : COURSE_RUNTIME_RENDER_MODE_AUTHORING_FIELD,
  })
}
