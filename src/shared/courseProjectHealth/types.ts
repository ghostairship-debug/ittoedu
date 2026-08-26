import type { ComponentManifest } from '../componentTypes'
import type { CourseProjectDocument } from '../courseProjectTypes'
import type {
  CourseProjectValidationFindingCode,
  DiagnosticTargetV1,
} from '../courseProjectValidationDiagnostics'
import type { ProjectHealthCode } from '../diagnosticCodes'

export type CourseProjectHealthSeverity = 'error' | 'warning' | 'info'
export type CourseProjectHealthCode = Extract<
  CourseProjectValidationFindingCode,
  ProjectHealthCode
>

export interface CourseProjectHealthArchiveFiles {
  /** Already-opened archive bytes, keyed by AssetMeta.id. */
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  /** Already-opened component files, keyed by `${packageId}@${version}`. */
  readonly componentFiles: Readonly<
    Record<string, Readonly<Record<string, Uint8Array>>>
  >
}

export interface CourseProjectHealthFinding {
  severity: CourseProjectHealthSeverity
  code: CourseProjectHealthCode
  message: string
  path: Array<string | number>
  surfaceId?: string
  layerItemId?: string
  target: DiagnosticTargetV1
}

export type CourseProjectHealthFindingDraft = Omit<
  CourseProjectHealthFinding,
  'target'
>

export interface CourseProjectHealthContext {
  readonly project: CourseProjectDocument
  readonly archiveFiles: CourseProjectHealthArchiveFiles
  readonly componentManifests: ReadonlyMap<string, ComponentManifest>
}
