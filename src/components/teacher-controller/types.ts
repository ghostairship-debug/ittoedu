import type { TeacherControllerConfig } from '../../shared/teacherControllerConfig'
import type { ComponentRuntimeContext } from '../../shared/contracts/component-platform'
import type { TeacherControllerPort } from '../../shared/contracts/component-platform/teacherController'
export type { TeacherControllerPort, TeacherControllerSnapshot } from '../../shared/contracts/component-platform/teacherController'

export type TeacherControllerData = TeacherControllerConfig & {
  /** Stable author space for the controller's saved frame, independent of page order. */
  hudReferenceSize?: { width: number; height: number }
  enabled?: boolean
  backgroundAssetId?: string
  sceneStyles?: Record<string, Partial<TeacherControllerData>>
}
export type TeacherControllerRuntimeContext = ComponentRuntimeContext<TeacherControllerData> & {
  /** Optional R1 service: absent in author-only views; no fallback navigator. */
  teacherController?: TeacherControllerPort
}
