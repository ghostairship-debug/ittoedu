import { resolveComponentPresentation, type CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { ComponentExportDocument } from './document/reading'

/** Read-only initial author presentation. Published compiled code and asset URLs survive. */
export function componentOutputPresentation<T extends ComponentExportDocument>(document: T, surfaceId: string): T {
  const surface = document.surfaces.find(value => value.id === surfaceId)
  const author: CourseProjectV10 = { ...document, schemaVersion: 10, revision: 0, assets: {} }
  const effective = resolveComponentPresentation(author, surfaceId, surface?.presentation?.initialStateId ?? null)
  return { ...document, instances: effective.instances, surfaces: effective.surfaces }
}
