import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import sharp from 'sharp'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import type { DynamicContentFallbackCapture, DynamicContentHostTarget } from '../../../core/tools/DynamicContentEditPlanner'
import { isCourseLayerVisibleAtLocation } from '../../../shared/courseProjectModel'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { DocumentModel } from '../../../shared/workbench/document'
import { installEditorProtocol } from '../../protocols'
import { PreviewNetworkPolicy } from '../../previewNetworkPolicy'
import { configureRestrictedSession } from '../../security'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
interface DynamicFallbackWorkerInput {
  readonly project: CourseProjectDocument
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly itemId: string
  readonly assets: Record<string, string>
  readonly assetResources: Record<string, { url: string; byteLength: number }>
  readonly components: Record<string, Record<string, string>>
}
interface DynamicFallbackWorkerResult {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly itemId: string
  readonly dataUrl: string
}

export interface DynamicContentFallbackCaptureOptions {
  rendererEntryUrl(): string | null
  signalForRun?(runId: string): AbortSignal | undefined
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/** Validate the exact candidate location and layer before starting any renderer. */
export function prepareDynamicContentFallbackCapture(input: {
  target: DynamicContentHostTarget; candidate: CourseModel
}): DynamicFallbackWorkerInput {
  const { target, candidate } = input
  const { project, resources } = candidate
  const location = project.locations.find(value => value.id === target.locationId)
  const surface = location && project.surfaces.find(value => value.id === location.surfaceId)
  const located = locateCourseLayer(project, target.itemId)
  if (project.id !== target.projectId || project.revision !== target.revision
    || !location || !surface || surface.id !== target.surfaceId || !located || located.item.kind === 'native'
    || located.source !== target.owner || located.source !== 'global' && located.surfaceId !== surface.id
    || located.source === 'scene' && (location.kind !== 'slide-scene' || located.sceneId !== location.sceneId)
    || located.scoped && !isCourseLayerVisibleAtLocation(located.scoped, location.id)
    || located.item.locked) throw new Error('候选图层身份、位置或可见性已改变')
  if (target.stateId !== null) throw new Error('命名状态暂不支持精确静态后备截图')
  if (surface.type === 'spatial-2d') throw new Error('Spatial 暂不支持精确图层静态后备截图')
  const assets = Object.fromEntries(Object.entries(resources.assets).map(([id, bytes]) => [id, toBase64(bytes)]))
  const components = Object.fromEntries(Object.entries(resources.components).map(([key, files]) =>
    [key, Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, toBase64(bytes)]))]))
  const assetResources: Record<string, { url: string; byteLength: number }> = {}
  for (const [id, asset] of Object.entries(project.assets)) if (!resources.assets[id] && asset.remote)
    assetResources[id] = { url: asset.remote.url, byteLength: asset.byteLength }
  return { project, projectId: project.id, revision: project.revision,
    locationId: location.id, surfaceId: surface.id, itemId: target.itemId, assets, components, assetResources }
}

/** Candidate pixels come from the exact Published layer, never BrowserWindow.capturePage(). */
export class DynamicContentFallbackCaptureService {
  private readonly active = new Map<string, Set<AbortController>>()
  constructor(private readonly options: DynamicContentFallbackCaptureOptions) {}

  /** Gateway calls this at the stop barrier; all private capture windows close promptly. */
  stopRun(runId: string): void {
    for (const controller of this.active.get(runId) ?? []) controller.abort()
  }

  capture = async (input: { runId: string; documentId: string; target: DynamicContentHostTarget;
    candidate: CourseModel }): Promise<DynamicContentFallbackCapture> => {
    if (input.documentId !== input.target.documentId) throw new Error('候选截图文档身份不匹配')
    const upstream = this.options.signalForRun?.(input.runId)
    if (this.options.signalForRun && !upstream || upstream?.aborted) throw new Error('动态图文截图已取消')
    const request = prepareDynamicContentFallbackCapture(input)
    const rendererEntryUrl = this.options.rendererEntryUrl()
    if (!rendererEntryUrl) throw new Error('当前没有可用的候选图层截图入口')
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64')

    const isolatedSession = session.fromPartition(`dynamic-fallback-${randomUUID()}`)
    installEditorProtocol(isolatedSession)
    const network = new PreviewNetworkPolicy()
    const base = new URL(rendererEntryUrl)
    network.replaceBaseOrigins(['http:', 'https:'].includes(base.protocol) ? [base.origin] : [])
    const token = randomUUID(), owner = { processId: 0, frameToken: token, documentToken: token }
    network.activateDocument(owner)
    network.replacePreviewLease({ leaseId: token, connectOrigins: request.project.network?.connectOrigins ?? [],
      remoteAssetUrls: Object.values(request.project.assets).flatMap(asset => asset.remote ? [asset.remote.url] : []) }, owner)
    configureRestrictedSession(isolatedSession, url => network.allowsRequest(url))
    const worker = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, frame: false, show: false,
      skipTaskbar: true, webPreferences: { session: isolatedSession, contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: true } })
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const entry = new URL('observation.html', rendererEntryUrl).toString()
    worker.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault() })
    const controller = new AbortController(), signal = controller.signal
    const onUpstreamAbort = () => controller.abort()
    upstream?.addEventListener('abort', onUpstreamAbort, { once: true })
    let active = this.active.get(input.runId)
    if (!active) { active = new Set(); this.active.set(input.runId, active) }
    active.add(controller)
    let rejectStop!: (error: Error) => void
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
    const stop = (message: string) => {
      rejectStop(new Error(message))
      if (!worker.isDestroyed()) worker.destroy()
    }
    const onAbort = () => stop('动态图文截图已取消')
    const onGone = () => rejectStop(new Error('候选图层截图宿主异常退出'))
    const onClosed = () => rejectStop(new Error('候选图层截图宿主已关闭'))
    signal?.addEventListener('abort', onAbort, { once: true })
    worker.webContents.once('render-process-gone', onGone)
    worker.once('closed', onClosed)
    if (upstream?.aborted) controller.abort()
    const faultWait = setTimeout(() => stop('候选图层截图宿主无响应'), 20_000)
    try {
      const result = await Promise.race([stopped, (async () => {
        await worker.loadURL(entry)
        const output = await worker.webContents.executeJavaScript(
          `window.__COURSEWARE_DYNAMIC_FALLBACK_RUN__(${JSON.stringify(encoded)})`) as DynamicFallbackWorkerResult
        if (signal?.aborted) throw new Error('动态图文截图已取消')
        if (output.projectId !== request.projectId || output.revision !== request.revision
          || output.locationId !== request.locationId || output.surfaceId !== request.surfaceId
          || output.itemId !== request.itemId) throw new Error('候选图层截图返回了其他目标')
        if (typeof output.dataUrl !== 'string' || !output.dataUrl.startsWith('data:image/png;base64,')) throw new Error('候选图层没有返回有效 PNG')
        const bytes = Uint8Array.from(Buffer.from(output.dataUrl.slice('data:image/png;base64,'.length), 'base64'))
        const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: false })
        const metadata = await decoder.metadata()
        if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error('候选图层 PNG 无效')
        await decoder.raw().toBuffer()
        let id = `fallback-${randomUUID()}`
        while (request.project.assets[id] || request.assets[id]) id = `fallback-${randomUUID()}`
        return { asset: { id, filename: `${id}.png`, mimeType: 'image/png' as const, kind: 'image' as const,
          path: `assets/${id}.png`, byteLength: bytes.byteLength, width: metadata.width, height: metadata.height }, bytes }
      })()])
      return result
    } finally {
      clearTimeout(faultWait)
      signal?.removeEventListener('abort', onAbort)
      upstream?.removeEventListener('abort', onUpstreamAbort)
      worker.removeListener('closed', onClosed)
      worker.webContents.removeListener('render-process-gone', onGone)
      active.delete(controller)
      if (!active.size) this.active.delete(input.runId)
      if (!worker.isDestroyed()) worker.destroy()
      await isolatedSession.clearStorageData()
    }
  }
}
