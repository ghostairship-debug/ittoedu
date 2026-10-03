export const AUTHORING_ADDRESS_PROTOCOL_VERSION = 1 as const

export type AuthoringCarrier = 'native' | 'runtime' | 'component' | 'composition'

export interface AuthoringAddressParts {
  projectId: string
  scope: 'global' | 'surface' | 'scene'
  surfaceId?: string
  sceneId?: string
  carrier: AuthoringCarrier
  layerItemId: string
  field: string
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} 不能为空`)
  return value
}

/** Stable authoring identity shared by the editor bridge and Agent Kit. */
export function makeAuthoringAddress(parts: AuthoringAddressParts): string {
  const projectId = nonEmpty(parts.projectId, 'projectId')
  const layerItemId = nonEmpty(parts.layerItemId, 'layerItemId')
  const field = nonEmpty(parts.field, 'field')
  if (
    parts.scope === 'scene' &&
    (!parts.surfaceId?.trim() || !parts.sceneId?.trim())
  ) {
    throw new TypeError('scene 作者地址必须包含 surfaceId 与 sceneId')
  }
  return [
    'courseware://authoring/',
    encodeURIComponent(projectId),
    '/',
    parts.scope,
    '/',
    encodeURIComponent(parts.surfaceId ?? '-'),
    '/',
    encodeURIComponent(parts.sceneId ?? '-'),
    '/',
    parts.carrier,
    '/',
    encodeURIComponent(layerItemId),
    '?field=',
    encodeURIComponent(field),
  ].join('')
}

export interface AiSelectionReference {
  protocolVersion: typeof AUTHORING_ADDRESS_PROTOCOL_VERSION
  projectId: string
  projectRevision: number
  layoutRevision: number
  hitId: string
  authoringAddress: string
  kind: 'text' | 'asset' | 'property'
  label: string
  currentValue: unknown
}

/**
 * Internal/reserved selection snapshot. It is not a persisted Course Project
 * field and must not be wired into the product App as a visible AI workflow.
 */
export interface CurrentCourseSelectionUpdate {
  projectPath: string | null
  dirty: boolean
  reference: AiSelectionReference | null
}

export interface CurrentCourseSelectionState extends CurrentCourseSelectionUpdate {
  protocolVersion: typeof AUTHORING_ADDRESS_PROTOCOL_VERSION
  editorProcessId: number
  updatedAt: string
}

export function serializeAiSelectionReference(
  reference: AiSelectionReference,
): string {
  return JSON.stringify(reference, null, 2)
}
