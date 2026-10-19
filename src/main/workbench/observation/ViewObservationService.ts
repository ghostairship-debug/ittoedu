import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ObservationClip, ObservationResult, ObservationServicePort } from '../../../shared/workbench/toolPorts'
import sharp from 'sharp'
import { observationSnapshotMatches, sameObservationIdentity, sameObservationTarget,
  type ViewObservationCapture, type ViewObservationIdentity, type ViewObservationSnapshot } from '../../../shared/workbench/viewObservation'
import { ObservationImageStore } from './ObservationImageStore'

export interface ViewObservationServiceOptions {
  snapshot(documentId: string): Promise<DocumentSnapshot>
  /** Return null unless the mounted host has the exact requested identity. */
  captureLive?(input: { identity: ViewObservationIdentity; signal?: AbortSignal }): Promise<ViewObservationCapture | null>
  captureIsolated(input: { identity: ViewObservationIdentity; snapshot: ViewObservationSnapshot;
    signal?: AbortSignal }): Promise<ViewObservationCapture>
  images: ObservationImageStore
  /** One persistent Published player owns both the pixels and action handles. */
  observeInteractive?(input: { runId: string; identity: ViewObservationIdentity; snapshot: ViewObservationSnapshot;
    projectId: string; signal?: AbortSignal }): Promise<ObservationResult>
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
    if (this.options.observeInteractive) {
      const observation = await this.options.observeInteractive({ runId: input.runId, identity, snapshot: structuredClone(snapshot),
        projectId: input.projectId, signal: input.signal })
      if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
      // Interactive playback has its own host generation, distinct from an editor view token.
      if (!sameObservationTarget(observation.identity, identity))
        throw new Error('操作会话的画面与请求目标不符')
      assertFresh(await this.options.snapshot(input.documentId), identity, input.projectId)
      const result = await this.crop(input.runId, observation, input.clip, input.signal)
      if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
      assertFresh(await this.options.snapshot(input.documentId), identity, input.projectId)
      return result
    }
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
    const result = await this.crop(input.runId, { source, identity, coverage: { width: capture.width, height: capture.height },
      structure: capture.structure, diagnostics: capture.diagnostics, image }, input.clip, input.signal)
    if (input.signal?.aborted || this.stopped.has(input.runId)) throw new Error('观察已取消')
    assertFresh(await this.options.snapshot(input.documentId), identity, input.projectId)
    return result
  }

  private async crop(runId: string, observation: ObservationResult, requested?: ObservationClip, signal?: AbortSignal): Promise<ObservationResult> {
    if (!requested) return observation
    const viewport = observation.coverage.viewport ?? { width: observation.coverage.width, height: observation.coverage.height }
    if (![requested.x, requested.y, requested.width, requested.height].every(Number.isFinite)
      || requested.width <= 0 || requested.height <= 0 || requested.x >= viewport.width || requested.y >= viewport.height
      || requested.x + requested.width <= 0 || requested.y + requested.height <= 0)
      throw new Error(`局部观察clip不在当前viewport内；请按原CSS像素坐标读取范围0,0,${viewport.width},${viewport.height}`)
    const leftEdge = Math.max(0, requested.x), topEdge = Math.max(0, requested.y)
    const clip = { x: leftEdge, y: topEdge, width: Math.min(requested.x + requested.width, viewport.width) - leftEdge,
      height: Math.min(requested.y + requested.height, viewport.height) - topEdge }
    const originalImage = observation.image
    const original = await this.options.images.read(runId, originalImage.resourceId)
    const scale = { x: originalImage.width / viewport.width, y: originalImage.height / viewport.height }
    const left = Math.floor(clip.x * scale.x), top = Math.floor(clip.y * scale.y)
    const width = Math.min(originalImage.width, Math.ceil((clip.x + clip.width) * scale.x)) - left
    const height = Math.min(originalImage.height, Math.ceil((clip.y + clip.height) * scale.y)) - top
    const capturedClip = { x: left / scale.x, y: top / scale.y, width: width / scale.x, height: height / scale.y }
    const bytes = await sharp(original.bytes).extract({ left, top, width, height }).png().toBuffer()
    if (signal?.aborted || this.stopped.has(runId)) throw new Error('观察已取消')
    const image = await this.options.images.put(runId, bytes, width, height)
    // Handles continue to address the original page. Cropping never remaps or
    // synthesizes an action point; only controls intersecting the clip are shown.
    const elements = observation.elements?.filter(({ rect }) => rect.x < capturedClip.x + capturedClip.width && rect.y < capturedClip.y + capturedClip.height
      && rect.x + rect.width > capturedClip.x && rect.y + rect.height > capturedClip.y)
    // Raw tool records retain this complete capture. The model projection omits
    // it and links context.read to the original tool record instead.
    const result = { ...observation,
      fullObservation: { ...observation, imageDataUrl: `data:image/png;base64,${Buffer.from(original.bytes).toString('base64')}` },
      image, originalImage, ...(elements ? { elements } : {}),
      coverage: { width, height, viewport, clip: capturedClip, scale, coordinateSpace: 'preview-viewport-css-pixels' as const } }
    return result
  }

  async readResource(input: Parameters<ObservationServicePort['readResource']>[0]): ReturnType<ObservationServicePort['readResource']> {
    return this.options.images.read(input.runId, input.resourceId)
  }
}
