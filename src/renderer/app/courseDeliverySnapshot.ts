import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { DocumentResources } from '../../shared/workbench/document'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { ExportPageOptions } from '../../shared/workbench/toolPorts'

export interface CourseDeliverySnapshot {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
  readonly project: CourseProjectV10
  readonly snapshot: DocumentSnapshot
  readonly resources: DocumentResources
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly deliveryOptions?: ExportPageOptions
}
/** drain already owns a structured clone, including every resource byte. Do not reread the active view. */
export function courseDeliverySnapshot(snapshot: DocumentSnapshot | null, deliveryOptions?: ExportPageOptions): CourseDeliverySnapshot | null {
  if (snapshot?.model.kind !== 'course-v10') return null
  const model = snapshot.model
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, project: model.project,
    snapshot, resources: model.resources, assetFiles: model.resources.assets,
    ...(deliveryOptions ? { deliveryOptions: structuredClone(deliveryOptions) } : {}) }
}
export function sameDeliveryDocument(left: Pick<CourseDeliverySnapshot, 'documentId' | 'epoch'>, right: Pick<CourseDeliverySnapshot, 'documentId' | 'epoch'>): boolean {
  return left.documentId === right.documentId && left.epoch === right.epoch
}
