import type { CourseProjectDocument } from '../../shared/courseProjectTypes'

/** Outline order is course order: the first location is always the start. */
export function syncStartLocationToFirstLocation(draft: CourseProjectDocument): void {
  const first = draft.locations[0]
  if (first) draft.startLocationId = first.id
}
