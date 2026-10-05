import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ObservationResult, ObservationServicePort } from '../../../shared/workbench/toolPorts'
import { observationSnapshotMatches, sameObservationIdentity,
  type ViewObservationCapture, type ViewObservationIdentity, type ViewObservationSnapshot } from '../../../shared/workbench/viewObservation'
import { ObservationImageStore } from './ObservationImageStore'

export interface ViewObservationServiceOptions {
  snapshot(documentId: string): Promise<DocumentSnapshot>
  /** Return null unless the mounted host has the exact requested identity. */
  captureLive?(input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null>
  captureIsolated(input: { identity: ViewObservationIdentity; snapshot: ViewObservationSnapshot;
    signal?: AbortSignal }): Promise<ViewObservationCapture>
  images: ObservationImageStore
}

function assertFresh(snapshot: DocumentSnapshot, identity: ViewObservationIdentity, projectId: string): asserts snapshot is ViewObservationSnapshot {
  if (!observationSnapshotMatches(snapshot, identity, projectId)) throw new Error('观察目标已改变，请重新读取页面目标')
}

/** Validates both sides of capture, so a late frame cannot be assigned to a new revision. */
export class ViewObservationService implements ObservationServicePort {
  private readonly stopped = new Set<string>()
  constructor(private readonly options: ViewObservationServiceOptions) {}
  async stopRun(runId: string): Promise<void> { this.stopped.add(runId); await this.options.images.clearRun(runId) }

  async observe(input: Parameters<ObservationServicePort['observe']>[0]): Promise<ObservationResult> {
    const identity: ViewObservationIdentity = { documentId: input.documentId, epoch: input.epoch,
      revision: input.revision, locationId: input.locationId,
      ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
      ...(input.viewGeneration === undefined ? {} : { viewGeneration: input.viewGeneration }) }
    if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
    const snapshot = await this.options.snapshot(input.documentId)
    assertFresh(snapshot, identity, input.projectId)
    let capture: ViewObservationCapture | null = null
    let source: ObservationResult['source'] = 'isolated-published'
    // A missing generation cannot prove the mounted host belongs to this view.
    if (identity.viewGeneration && this.options.captureLive) {
      const candidate = await this.options.captureLive({ identity, signal: input.signal })
      if (candidate && sameObservationIdentity(candidate.identity, identity)) { capture = candidate; source = 'live' }
    }
    if (!capture) capture = await this.options.captureIsolated({ identity, snapshot: structuredClone(snapshot), signal: input.signal })
    if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
    if (!sameObservationIdentity(capture.identity, identity)) throw new Error('捕获画面的宿主身份与请求目标不符')
    assertFresh(await this.options.snapshot(input.documentId), identity, input.projectId)
    if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
    const image = await this.options.images.put(input.runId, capture.png, capture.width, capture.height)
    if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
    assertFresh(await this.options.snapshot(input.documentId), identity, input.projectId)
    return { source, identity, coverage: { width: capture.width, height: capture.height },
      structure: capture.structure, diagnostics: capture.diagnostics, image }
  }

  async readResource(input: Parameters<ObservationServicePort['readResource']>[0]): ReturnType<ObservationServicePort['readResource']> {
    return this.options.images.read(input.runId, input.resourceId)
  }
}
