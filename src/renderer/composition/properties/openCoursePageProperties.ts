import type { EditorStoreKernel } from '../../store/editorStoreKernel'
import type { DocumentSnapshot } from '../../../shared/workbench/document'

/** Page settings are an explicit selection of the existing surface, after committing its input. */
export async function openCoursePageProperties(input: {
  kernel: EditorStoreKernel
  drain(documentId: string): Promise<DocumentSnapshot>
  open(surfaceId: string): void
}): Promise<void> {
  const target = input.kernel.captureTarget()
  if (!target.surfaceId || !target.project.surfaces.some(surface => surface.id === target.surfaceId)) return
  const confirmed = await input.drain(target.documentId), current = input.kernel.readView()
  if (current.activeDocumentId !== target.documentId || current.surfaceId !== target.surfaceId
    || confirmed.epoch !== target.epoch || current.snapshot?.epoch !== target.epoch) return
  input.kernel.selectSurface(target.surfaceId, target.documentId)
  input.open(target.surfaceId)
}
