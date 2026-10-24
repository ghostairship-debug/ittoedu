import { componentContainerForInstance, componentSurface, type ComponentContainer, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ComponentFrame } from '../../shared/contracts/component-platform/frame'
import type { ProfessionalElementOrigin } from './professionalElementDefaults'

export interface CourseInsertionFrameOptions {
  x?: number; y?: number; width?: number; height?: number
  center?: { x: number; y: number }
  container?: ComponentContainer
  origin?: ProfessionalElementOrigin
}

/** Shared frame policy for insertion and copy; it does not prepare or move objects. */
export function courseInsertionFrame(target: { project: CourseProjectV10; surfaceId: string | null; instanceId?: string | null },
  width: number, height: number, options: CourseInsertionFrameOptions): ComponentFrame {
  const requested = options.container?.kind === 'instance' ? componentSurface(target.project, options.container.instanceId)
    : options.container?.kind === 'surface' ? componentSurface(target.project, options.container.surfaceId) : undefined
  const surface = requested ?? (target.surfaceId ? componentSurface(target.project, target.surfaceId)
    : target.instanceId ? componentContainerForInstance(target.project, target.instanceId) : undefined)
  const size = surface?.designSize ?? { width: 1280, height: 720 }
  const actualWidth = options.width ?? width, actualHeight = options.height ?? height
  return { width: actualWidth, height: actualHeight,
    transform: [1, 0, 0, 1, options.x ?? (options.center ? options.center.x - actualWidth / 2 : options.origin === 'slide-authoring' ? 80 : surface?.kind === 'slide' ? (size.width - width) / 2 : 0),
      options.y ?? (options.center ? options.center.y - actualHeight / 2 : options.origin === 'slide-authoring' ? 80 : surface?.kind === 'slide' ? (size.height - height) / 2 : 0)] }
}
