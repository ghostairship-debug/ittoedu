import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { componentPackagesFromArchive } from '../components/componentPackageStore'

export interface CourseDeliverySnapshot {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly project: CourseProjectDocument
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly components: Readonly<Record<string, ComponentPackageData>>
}
/** drain already owns a structured clone, including every resource byte. Do not reread the active view. */
export function courseDeliverySnapshot(snapshot: DocumentSnapshot | null): CourseDeliverySnapshot | null {
  if (snapshot?.model.kind !== 'course-v9') return null
  const model = snapshot.model
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, project: model.project,
    assetFiles: model.resources.assets, components: componentPackagesFromArchive(model.project, model.resources.components) }
}
export function sameDeliveryDocument(left: Pick<CourseDeliverySnapshot, 'documentId' | 'epoch'>, right: Pick<CourseDeliverySnapshot, 'documentId' | 'epoch'>): boolean {
  return left.documentId === right.documentId && left.epoch === right.epoch
}
