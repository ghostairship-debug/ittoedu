import {
  authoringObservationInputSchema,
  authoringObservationSpatialViewSchema,
  type AuthoringObservationCaptureImage,
  type AuthoringObservationCaptureRect,
  type AuthoringObservationInput,
  type AuthoringObservationResourceFile,
  type AuthoringObservationSource,
  type AuthoringObservationSpatialView,
} from '../../../shared/authoringObservation'
import type { SurfaceDiagnostic } from '../../../player/surfaces/SurfaceHost'
import type { PublishedInteractionDiagnostic } from '../../../player/interactions/PublishedInteractionSurfacePort'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { analyzeCourseAssetReferences } from '../../../shared/contracts/course-project-v9/assetReferences'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { generationNavigationContext } from './generationNavigationContext'
import { bytesToBase64 } from '../../export/base64'
import { waitForPublishedObservationReady } from '../../../player/surfaces/publishedCapture'
import type { BackgroundPreview } from '../backgroundPreview'
import { MAX_GENERATION_RESOURCE_BYTES } from '../../../shared/generationContract'
import { LOGICAL_STAGE_VIEWPORT } from '../stageViewportTransform'
import { observeRuntimeDomControls, type RuntimeDomObservationTarget } from './runtimeDomControlObservation'
import { collectCurrentHostMotion, currentHostMotionEvidenceSchema } from './currentHostMotionObservation'
import {
  prepareObservationImageResources,
  type ObservationImageResourceInput,
  type ObservationImageResourceResult,
} from './observationImageResources'

const objectTokens = new WeakMap<object, number>()
let nextObjectToken = 1

function observationJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { bigint: item.toString() } : item)
}

/** Identity of an actual immutable Owner draft, shared with its rendered view. */
export function authoringObservationDraftToken(draft: object | null | undefined): number {
  if (!draft) return 0
  let value = objectTokens.get(draft)
  if (value === undefined) { value = nextObjectToken++; objectTokens.set(draft, value) }
  return value
}

/** The camera used by the actual Spatial painter must match its session Owner. */
export function authoringObservationCameraToken(camera: AuthoringObservationSpatialView['camera']): string {
  return JSON.stringify([camera.x, camera.y, camera.zoom])
}

export class AuthoringObservationUnavailable extends Error {
  readonly code = 'observation-pending-sync'
  constructor(message: string) { super(`当前课件观察待同步：${message}`) }
}

export interface AuthoringObservationState {
  readonly document: CourseProjectDocument
  readonly sessionGeneration: number
  readonly surfaceId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly selectedIds: readonly string[]
  /** The active Surface Owner's immutable draft. Never read an input DOM as a document. */
  readonly draft: object | null
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  readonly previewBackgroundColor?: BackgroundPreview | null
  readonly spatialCamera?: AuthoringObservationSpatialView['camera']
}

export interface AuthoringObservationPorts {
  read(): AuthoringObservationState | null
  prepareForEdit(): { readonly ok: true } | { readonly ok: false; readonly reason: string }
  materializeDraft(): { readonly ok: true; readonly snapshot: { readonly project: CourseProjectDocument } }
    | { readonly ok: false; readonly reason: string }
  captureImage(rect: AuthoringObservationCaptureRect): Promise<AuthoringObservationCaptureImage>
  document?: Document
  /** Host test seam; production waits for actual compositor frames. */
  waitForPaint?: () => Promise<void>
  /** Host test seam; production prepares verified originals from its current asset sidecar. */
  prepareImageResources?: (input: ObservationImageResourceInput) => Promise<ObservationImageResourceResult>
}

/**
 * One interaction diagnostic observed by a mounted try-run/preview session.
 * Diagnostics without interaction fields (plain SurfaceDiagnostic) stay intact.
 */
export interface AuthoringInteractionDiagnosticRecord {
  readonly receivedAt: number
  readonly diagnostic: SurfaceDiagnostic & Partial<Pick<PublishedInteractionDiagnostic,
    'code' | 'ruleId' | 'stepId' | 'nodeId' | 'interactionType'>>
}

export interface AuthoringInteractionDiagnosticSnapshot {
  readonly records: readonly AuthoringInteractionDiagnosticRecord[]
  /** Total records evicted since this mounted session began. */
  readonly droppedCount: number
}

export interface MountedObservationFacts {
  readonly projectId: string
  readonly documentRevision: number
  readonly surfaceId: string
  readonly locationId: string
  readonly stateId: string | null
  readonly ready: boolean
  readonly stateVersion: number
  /** Only public host state. Private Runtime closure variables are never inferred. */
  readonly publicState: unknown
}

interface MountedObservationHost {
  root: HTMLElement
  source: 'trial' | 'preview'
  sessionId: string
  read(): MountedObservationFacts
  /** Bounded per-session diagnostics buffer; capture consumes only new entries. */
  readInteractionDiagnostics?(): AuthoringInteractionDiagnosticSnapshot
  /** Count acknowledged by successfully built observations in this session. */
  diagnosticCursor: number
  viewEpoch: number
  interactionEpoch: number
  flush(): void
  dispose(): void
}
const mountedHosts = new Set<MountedObservationHost>()

export interface CanvasObservationDraft {
  readonly label: string
  readonly value: string
  readonly initialValue: string
  readonly composing: boolean
  readonly bounds: { x: number; y: number; width: number; height: number }
}
const canvasDrafts = new Map<HTMLElement, { read(): CanvasObservationDraft; commit(): void }>()

/** Connects an existing local text Owner; the registry never stores draft data. */
export function registerAuthoringObservationDraft(element: HTMLElement, port: { read(): CanvasObservationDraft; commit(): void }): () => void {
  canvasDrafts.set(element, port)
  return () => { if (canvasDrafts.get(element) === port) canvasDrafts.delete(element) }
}

/** Read through the registered input Owners, including composing local controls. */
export function readAuthoringObservationDraftState(dom: Document = document): string {
  return observationJson([...canvasDrafts].filter(([element]) => element.ownerDocument === dom && visible(element))
    .flatMap(([, port]) => {
      const draft = port.read()
      return draft.composing || draft.value !== draft.initialValue
        ? [[authoringObservationDraftToken(port), draft.value, draft.initialValue, draft.composing]] : []
    }))
}

export interface AuthoringObservationTarget {
  readonly surfaceId: string
  readonly locationId: string
  readonly stateId: string | null
}

function matchesTarget(facts: AuthoringObservationTarget, target: AuthoringObservationTarget): boolean {
  return facts.surfaceId === target.surfaceId && facts.locationId === target.locationId && facts.stateId === target.stateId
}

function currentCanvasDrafts(root: HTMLElement): CanvasObservationDraft[] {
  return [...canvasDrafts].filter(([element]) => root.contains(element) && visible(element)).map(([, port]) => port.read())
}

function observeView(root: HTMLElement, invalidate: () => void, invalidateInteraction: () => void): { flush(): void; dispose(): void } {
  // These are content roots owned by the mounted extension. Animation can
  // change their DOM continuously without changing the document or user view.
  // Their outer mount wrappers, removal, user input and public state keep the
  // normal invalidation guards; a screenshot is one frame of that live content.
  const dynamicContent = '[data-surface-runtime-root], [data-canvas-runtime-dom-underlay], [data-canvas-runtime-dom-overlay], [data-canvas-runtime-phaser], [data-published-hybrid-component-dom]'
  const changedView = (records: MutationRecord[]) => records.some(record => {
    const element = record.target.nodeType === Node.ELEMENT_NODE
      ? record.target as Element : record.target.parentElement
    const content = element?.closest(dynamicContent)
    return !content || !root.contains(content)
  })
  const observer = new MutationObserver(records => { if (changedView(records)) invalidate() })
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
  let size = root.getBoundingClientRect()
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const next = root.getBoundingClientRect()
    // ResizeObserver always sends an initial notification, even when no layout
    // changed. That notification cannot invalidate the first real screenshot.
    if (next.width !== size.width || next.height !== size.height) invalidate()
    size = next
  })
  resize?.observe(root)
  const events = ['scroll', 'input', 'change', 'pointerup', 'wheel'] as const
  const interaction = () => { invalidate(); invalidateInteraction() }
  events.forEach(name => root.addEventListener(name, interaction, true))
  return {
    flush() { if (changedView(observer.takeRecords())) invalidate() },
    dispose() { observer.disconnect(); resize?.disconnect(); events.forEach(name => root.removeEventListener(name, interaction, true)) },
  }
}

/** Registered by the real mount owner; disposal follows that exact session. */
export function registerAuthoringObservationHost(input: {
  root: HTMLElement
  source: 'trial' | 'preview'
  read(): MountedObservationFacts
  /** Optional per-session interaction diagnostics read port (bounded buffer). */
  readInteractionDiagnostics?(): AuthoringInteractionDiagnosticSnapshot
}): () => void {
  const host: MountedObservationHost = {
    ...input, sessionId: crypto.randomUUID(), diagnosticCursor: 0, viewEpoch: 0, interactionEpoch: 0,
    flush: () => undefined, dispose: () => undefined,
  }
  const view = observeView(input.root, () => { host.viewEpoch += 1 }, () => { host.interactionEpoch += 1 })
  host.flush = view.flush
  host.dispose = view.dispose
  mountedHosts.add(host)
  return () => { mountedHosts.delete(host); host.dispose() }
}

function visible(root: HTMLElement): boolean {
  if (!root.isConnected) return false
  for (let current: HTMLElement | null = root; current; current = current.parentElement) {
    const style = getComputedStyle(current)
    if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false
  }
  const rect = root.getBoundingClientRect()
  return rect.width > 1 && rect.height > 1
}

function captureRect(root: HTMLElement): AuthoringObservationCaptureRect {
  const bounds = root.getBoundingClientRect()
  const view = root.ownerDocument.defaultView!
  let left = Math.max(0, bounds.left), top = Math.max(0, bounds.top)
  let right = Math.min(view.innerWidth, bounds.right), bottom = Math.min(view.innerHeight, bounds.bottom)
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
  }
  const x = Math.ceil(left), y = Math.ceil(top)
  const width = Math.floor(right) - x, height = Math.floor(bottom) - y
  if (width < 8 || height < 8) throw new AuthoringObservationUnavailable('画布没有可捕获的实际视口')
  return { x, y, width, height }
}

interface ResolvedHost {
  root: HTMLElement
  source: AuthoringObservationSource
  facts: MountedObservationFacts
  runtime: AuthoringObservationInput['runtime']
  viewEpoch: number
  interactionEpoch: number
  spatialView?: AuthoringObservationSpatialView
  /** Snapshot now, acknowledge only when this capture has built all resources. */
  snapshotInteractionDiagnostics?: () => {
    records: readonly AuthoringInteractionDiagnosticRecord[]
    truncated: boolean
    acknowledge(): void
  }
}

function readMountedHost(host: MountedObservationHost): ResolvedHost {
  host.flush()
  const facts = host.read()
  return { root: host.root, source: host.source, facts,
    runtime: { sessionId: host.sessionId, stateVersion: facts.stateVersion }, viewEpoch: host.viewEpoch, interactionEpoch: host.interactionEpoch,
    ...(host.readInteractionDiagnostics ? {
      snapshotInteractionDiagnostics: () => {
        const { records, droppedCount } = host.readInteractionDiagnostics!()
        const end = droppedCount + records.length
        return {
          records: records.slice(Math.max(0, host.diagnosticCursor - droppedCount)),
          truncated: host.diagnosticCursor < droppedCount,
          acknowledge: () => { host.diagnosticCursor = Math.max(host.diagnosticCursor, end) },
        }
      },
    } : {}) }
}

function currentStructure(document: CourseProjectDocument, host: ResolvedHost, selectedIds: readonly string[]) {
  const projection = projectEffectiveLayers({ project: document, locationId: host.facts.locationId, stateId: host.facts.stateId })
  const flow = projection.surfaceType === 'flow'
    ? buildFlowEditorView({ project: document, locationId: host.facts.locationId }) : null
  const paper = flow ? host.root.querySelector<HTMLElement>('.flow-body-content') : null
  const scroll = flow ? host.root.querySelector<HTMLElement>('[data-flow-media-query-root]') : null
  const paperRect = paper?.getBoundingClientRect(), viewportRect = host.root.getBoundingClientRect()
  const paperStyle = paper ? paper.ownerDocument.defaultView?.getComputedStyle(paper) : null
  return {
    surfaceId: projection.surfaceId, locationId: projection.locationId, stateId: projection.stateId,
    surfaceType: projection.surfaceType,
    navigation: generationNavigationContext(document, projection.locationId, projection.stateId),
    ...(flow ? { layout: { ...flow.layout, widthMode: flow.layout.widthMode ?? 'reading' },
      flowView: paper && scroll && paperRect ? {
        unit: 'CSS px', viewport: { width: host.root.clientWidth, height: host.root.clientHeight },
        paperWidth: paper.offsetWidth,
        bodyWidth: paper.clientWidth - (parseFloat(paperStyle?.paddingLeft ?? '0') || 0) - (parseFloat(paperStyle?.paddingRight ?? '0') || 0),
        paperScroll: { x: scroll.scrollLeft, y: scroll.scrollTop },
        paperClientOrigin: { x: paperRect.left - viewportRect.left, y: paperRect.top - viewportRect.top },
        observationScale: paper.offsetWidth > 0 ? paperRect.width / paper.offsetWidth : 1,
      } : null } : {}),
    items: projection.unifiedRows.map(row => ({ id: row.id, target: row.authoringAddress, item: row.item,
      selected: selectedIds.includes(row.id) })),
    blocks: flow?.blocks.map(block => ({ id: block.blockId, target: block.authoringAddress, block: block.block,
      selected: selectedIds.includes(block.blockId) })) ?? [],
  }
}

function referencedImages(document: CourseProjectDocument, structure: ReturnType<typeof currentStructure>, components?: Readonly<Record<string, ComponentPackageData>>): string[] {
  const surfaceIndex = document.surfaces.findIndex(surface => surface.id === structure.surfaceId)
  const currentIds = new Set([...structure.items.map(item => item.id), ...structure.blocks.map(block => block.id)])
  const location = document.locations.find(item => item.id === structure.locationId)
  const sceneId = location?.kind === 'slide-scene' ? location.sceneId : undefined
  const graph = analyzeCourseAssetReferences(document, { componentPackages: components }).graph
  return [...graph].filter(([assetId, references]) => document.assets[assetId]?.kind === 'image' && references.some(reference => {
    if (reference.layerItemId || reference.blockId) return currentIds.has(reference.layerItemId ?? reference.blockId!)
    if (reference.sceneId) return reference.sceneId === sceneId && (!reference.stateId || reference.stateId === structure.stateId)
    if (reference.path[0] === 'surfaces') return reference.path[1] === surfaceIndex
    return reference.kind === 'course-background'
  })).map(([id]) => id)
}

/** One read-only observation owner. No Store import, disk read or document writer. */
export function createAuthoringObservationController(ports: AuthoringObservationPorts) {
  const dom = ports.document ?? document
  const waitForPaint = () => ports.waitForPaint?.()
    ?? new Promise<void>(resolve => dom.defaultView!.requestAnimationFrame(() => dom.defaultView!.requestAnimationFrame(() => resolve())))
  let draftEpoch = 0, viewEpoch = 0, authoringDomEpoch = 0, authoringInteractionEpoch = 0
  let lastDraftKey = '', lastViewKey = ''
  let authoringRoot: HTMLElement | null = null
  let authoringView: ReturnType<typeof observeView> | null = null

  const read = (): AuthoringObservationState => {
    const state = ports.read()
    if (!state) throw new AuthoringObservationUnavailable('没有活动课程会话')
    return state
  }
  const draftKey = (state: AuthoringObservationState) => JSON.stringify([
    state.document.id, state.sessionGeneration, authoringObservationDraftToken(state.draft),
    authoringObservationDraftToken(state.previewBackgroundColor),
  ])
  const resolveHost = (state: AuthoringObservationState, target?: AuthoringObservationTarget): ResolvedHost => {
    const previewOpen = [...dom.querySelectorAll<HTMLElement>('[data-testid="course-preview-overlay"]')].some(visible)
    const playback = [...mountedHosts].filter(host => host.root.ownerDocument === dom && visible(host.root)
      && (!target || matchesTarget(host.read(), target)))
      .sort((a, b) => Number(b.source === 'preview') - Number(a.source === 'preview'))[0]
    if (previewOpen && playback?.source !== 'preview') throw new AuthoringObservationUnavailable('整课预览正在准备，不能引用后面的作者画布')
    if (playback) return readMountedHost(playback)
    const root = [...dom.querySelectorAll<HTMLElement>('[data-observation-source="authoring"]')].find(root => visible(root)
      && (!target || matchesTarget({ surfaceId: root.dataset.observationSurfaceId ?? '',
        locationId: root.dataset.observationLocationId ?? '', stateId: root.dataset.observationStateId || null }, target)))
    if (!root) throw new AuthoringObservationUnavailable(target
      ? '原任务目标没有可用的正式作者、试运行或预览宿主；请返回原目标后重新观察继续' : '实际作者画布尚未就绪')
    if (root !== authoringRoot) {
      authoringView?.dispose(); authoringRoot = root; authoringDomEpoch += 1
      authoringView = observeView(root, () => { authoringDomEpoch += 1 }, () => { authoringInteractionEpoch += 1 })
    }
    authoringView?.flush()
    const data = root.dataset
    if (data.observationSessionGeneration !== String(state.sessionGeneration)) {
      throw new AuthoringObservationUnavailable('当前会话尚未绘制到作者画布')
    }
    if (data.observationDraftToken !== String(authoringObservationDraftToken(state.draft))) {
      throw new AuthoringObservationUnavailable('活动草稿尚未绘制到当前画布')
    }
    let spatialView: AuthoringObservationSpatialView | undefined
    if (state.document.surfaces.find(surface => surface.id === state.surfaceId)?.type === 'spatial-2d') {
      if (!state.spatialCamera || data.observationSpatialCamera !== authoringObservationCameraToken(state.spatialCamera)) {
        throw new AuthoringObservationUnavailable('当前镜头尚未绘制到 Spatial 画布')
      }
      spatialView = authoringObservationSpatialViewSchema.parse({ camera: state.spatialCamera,
        viewport: LOGICAL_STAGE_VIEWPORT, coordinateSpace: 'world', cameraAnchor: 'viewport-center', globalCoordinateSpace: 'viewport' })
    }
    return { root, source: 'authoring', runtime: null, viewEpoch: authoringDomEpoch, interactionEpoch: authoringInteractionEpoch,
      spatialView,
      facts: { projectId: data.observationProjectId ?? '', documentRevision: Number(data.observationRevision),
        surfaceId: data.observationSurfaceId ?? '', locationId: data.observationLocationId ?? '',
        stateId: data.observationStateId || null, ready: data.observationReady === 'true', stateVersion: 0, publicState: null } }
  }
  const identity = (state: AuthoringObservationState, host: ResolvedHost, includeDomEpoch = true) => observationJson([
    state.document.id, state.document.revision, state.sessionGeneration, draftKey(state), state.surfaceId,
    state.locationId, state.stateId, state.selectedIds, host.source, host.facts, host.runtime,
    includeDomEpoch ? host.viewEpoch : null, host.interactionEpoch, currentCanvasDrafts(host.root),
    captureRect(host.root), host.spatialView, authoringObservationDraftToken(state.assetFiles),
  ])
  const assertHost = (state: AuthoringObservationState, host: ResolvedHost) => {
    if (!host.facts.ready || host.facts.projectId !== state.document.id || host.facts.documentRevision !== state.document.revision) {
      throw new AuthoringObservationUnavailable('宿主画面与当前内存文档尚未同步')
    }
    if (host.source === 'authoring' && (host.facts.surfaceId !== state.surfaceId
      || host.facts.locationId !== state.locationId || host.facts.stateId !== state.stateId)) {
      throw new AuthoringObservationUnavailable('画布位置正在切换')
    }
  }

  const prepareForEdit = () => {
    for (const [element, owner] of canvasDrafts) {
      if (element.ownerDocument !== dom || !visible(element)) continue
      const draft = owner.read()
      if (draft.composing) throw new AuthoringObservationUnavailable('输入法组合中，请完成当前文字后再编辑')
      owner.commit()
    }
    const prepared = ports.prepareForEdit()
    if (!prepared.ok) throw new AuthoringObservationUnavailable(`活动草稿无法提交：${prepared.reason}`)
  }
  return {
    dispose() { authoringView?.dispose(); authoringView = null; authoringRoot = null },
    prepareForEdit,
    async capture(input: { intent: 'discuss' | 'plan' | 'edit'; dynamicTargetIds?: readonly string[]; target?: AuthoringObservationTarget; prepareDrafts?: boolean }) {
      if (input.intent === 'edit' && input.prepareDrafts !== false) prepareForEdit()
      const started = performance.now()
      await waitForPaint()
      const before = read()
      let host = resolveHost(before, input.target)
      assertHost(before, host)
      const readinessIdentity = identity(before, host, false)
      const preview = before.previewBackgroundColor
      const activeStylePreview = host.source === 'authoring' && preview
        && preview.target.projectId === before.document.id && preview.target.revision === before.document.revision
        && preview.target.generation === before.sessionGeneration && preview.target.locationId === host.facts.locationId
        && preview.target.stateId === host.facts.stateId ? preview : null
      if (input.intent === 'edit' && activeStylePreview) throw new AuthoringObservationUnavailable('当前样式预览尚未正式提交')
      const localDrafts = currentCanvasDrafts(host.root)
      if (input.intent === 'edit' && localDrafts.some(draft => draft.value !== draft.initialValue)) {
        throw new AuthoringObservationUnavailable('Runtime/Component 文本草稿尚未由原入口提交')
      }
      try { await waitForPublishedObservationReady(host.root) }
      catch (error) { throw new AuthoringObservationUnavailable(error instanceof Error ? error.message : String(error)) }
      // Readiness can flush authoring commands and install DOM after the first
      // frame wait. Cross a rendered frame after those Owners finish so the
      // native capture contains their current text, geometry and resources.
      await waitForPaint()
      const settled = read(), settledHost = resolveHost(settled, input.target)
      assertHost(settled, settledHost)
      // The same Owner may finish painting while resources settle. Bind the
      // screenshot to that completed DOM, while rejecting document, draft,
      // selection, geometry, public state, host or user interaction changes.
      if (before.document !== settled.document || host.root !== settledHost.root
        || readinessIdentity !== identity(settled, settledHost, false)) {
        throw new AuthoringObservationUnavailable('准备画面期间内容、选区、草稿、视图或运行状态已变化，请重试')
      }
      host = settledHost
      const key = observationJson([draftKey(before), localDrafts])
      if (key !== lastDraftKey) { lastDraftKey = key; draftEpoch += 1 }
      const structural = input.intent === 'edit' ? { ok: true as const, snapshot: { project: before.document } } : ports.materializeDraft()
      if (!structural.ok) throw new AuthoringObservationUnavailable(`草稿无法只读物化：${structural.reason}`)
      if (structural.snapshot.project.id !== before.document.id) throw new AuthoringObservationUnavailable('草稿已属于其他工程')
      const structure = currentStructure(structural.snapshot.project, host, before.selectedIds)
      const baseIdentity = identity(before, host)
      if (baseIdentity !== lastViewKey) { lastViewKey = baseIdentity; viewEpoch += 1 }
      const files: AuthoringObservationInput['files'] = [], resourceFiles: AuthoringObservationResourceFile[] = []
      let totalBytes = 0
      const add = (fileId: string, path: string, mediaType: string, role: AuthoringObservationResourceFile['role'], content: string, encoding: 'utf8' | 'base64', byteLength: number) => {
        totalBytes += new TextEncoder().encode(content).byteLength
        if (totalBytes > MAX_GENERATION_RESOURCE_BYTES) throw new AuthoringObservationUnavailable('当前画面与必要原图超过 12 MiB 附件容量，请缩小引用范围')
        files.push({ fileId, relativePath: path, mediaType, role, byteLength })
        resourceFiles.push({ path, mediaType, role, content, encoding })
      }
      const imageResources = await (ports.prepareImageResources ?? prepareObservationImageResources)({
        document: before.document,
        assetFiles: before.assetFiles,
        assetIds: referencedImages(structural.snapshot.project, structure, before.componentPackages),
      })
      const rect = captureRect(host.root)
      const image = await ports.captureImage(rect)
      if (!image.dataUrl.startsWith('data:image/png;base64,') || image.width < 1 || image.height < 1) {
        throw new AuthoringObservationUnavailable('宿主没有返回实际 PNG 画面')
      }
      const png = image.dataUrl.slice('data:image/png;base64,'.length)
      const byteLength = Math.floor(png.length * 3 / 4) - (png.endsWith('==') ? 2 : png.endsWith('=') ? 1 : 0)
      type PlannedResource = {
        fileId: string
        path: string
        mediaType: string
        role: AuthoringObservationResourceFile['role']
        content: string
        encoding: 'utf8' | 'base64'
        byteLength: number
      }
      const jsonResource = (fileId: string, path: string, role: 'structure' | 'runtime-evidence', value: unknown): PlannedResource => {
        const content = observationJson(value)
        return { fileId, path, mediaType: 'application/json', role, content, encoding: 'utf8', byteLength: new TextEncoder().encode(content).byteLength }
      }
      const assertCurrent = () => {
        const after = read(), afterHost = resolveHost(after, input.target)
        assertHost(after, afterHost)
        if (baseIdentity !== identity(after, afterHost) || before.document !== after.document || host.root !== afterHost.root) {
          throw new AuthoringObservationUnavailable('捕获期间内容、选区、草稿、视图或运行状态已变化，请重试')
        }
      }
      assertCurrent()
      const targetIds = input.dynamicTargetIds ?? before.selectedIds
      const dynamicTargets: RuntimeDomObservationTarget[] = [
        ...structure.items.flatMap(({ id, item }) => item.kind === 'runtime' || item.kind === 'component'
          ? [{ instanceId: id, carrier: item.kind } satisfies RuntimeDomObservationTarget] : []),
        ...structure.blocks.flatMap(({ id, block }) => block.type === 'component'
          ? [{ instanceId: id, carrier: 'component' } satisfies RuntimeDomObservationTarget] : []),
      ].filter(target => !targetIds.length || targetIds.includes(target.instanceId))
      // Collect every mandatory current-host attachment before admitting an
      // optional SVG PNG. A near-limit derivative must not evict motion or
      // runtime-state evidence from this same observation.
      const mandatoryResources: PlannedResource[] = [{
        fileId: 'current-frame', path: 'observation/current-frame.png', mediaType: 'image/png',
        role: 'image', content: png, encoding: 'base64', byteLength,
      }]
      if (dynamicTargets.length) {
        const motion = await collectCurrentHostMotion(image, { capture: () => ports.captureImage(rect), assertCurrent })
        const frames = motion.map(({ image: frame, elapsedMs }, index) => {
          const fileId = index === 0 ? 'current-frame' : `current-motion-${index}`
          if (index > 0) {
            const content = frame.dataUrl.slice('data:image/png;base64,'.length)
            const bytes = Math.floor(content.length * 3 / 4) - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0)
            mandatoryResources.push({
              fileId, path: `observation/motion/frame-${index}.png`, mediaType: 'image/png',
              role: 'image', content, encoding: 'base64', byteLength: bytes,
            })
          }
          return { fileId, elapsedMs, capturedAt: frame.capturedAt, width: frame.width, height: frame.height }
        })
        mandatoryResources.push(jsonResource('current-host-motion', 'observation/motion/current-host.json', 'runtime-evidence', currentHostMotionEvidenceSchema.parse({
          version: 1, source: 'actual-current-host', projectId: before.document.id,
          documentRevision: before.document.revision, sessionGeneration: before.sessionGeneration,
          viewSource: host.source, surfaceId: host.facts.surfaceId, locationId: host.facts.locationId, stateId: host.facts.stateId,
          runtime: host.runtime, instances: dynamicTargets, captureRect: rect, frames,
          semanticVerdict: 'requires-review', privateRuntimeState: 'not-exposed',
        })))
      }
      if (host.runtime) mandatoryResources.push(jsonResource('runtime-state', 'observation/runtime-state.json', 'runtime-evidence', {
        sessionId: host.runtime.sessionId, stateVersion: host.runtime.stateVersion, capturedAt: image.capturedAt,
        coverage: 'public-host-state-and-captured-frame', privateRuntimeState: 'not-exposed',
        state: host.facts.publicState,
        domControls: observeRuntimeDomControls(host.root, dynamicTargets),
      }))
      const diagnosticSnapshot = host.runtime ? host.snapshotInteractionDiagnostics?.() : undefined
      if (host.runtime) {
        // Feedback only: the observation package records what the live session
        // diagnosed since the previous capture. It never creates candidates or
        // commits project changes.
        const fresh = diagnosticSnapshot ?? { records: [] as const, truncated: false }
        const records = fresh.records.slice(-100)
        mandatoryResources.push(jsonResource('interaction-diagnostics', 'observation/interaction-diagnostics.json', 'runtime-evidence', {
          version: 1,
          kind: 'interaction-diagnostics',
          sessionId: host.runtime.sessionId,
          stateVersion: host.runtime.stateVersion,
          capturedAt: image.capturedAt,
          truncated: fresh.truncated || fresh.records.length > records.length,
          diagnostics: records.map(record => ({
            receivedAt: record.receivedAt,
            ageMs: Math.max(0, image.capturedAt - record.receivedAt),
            surfaceId: record.diagnostic.surfaceId,
            phase: record.diagnostic.phase,
            severity: record.diagnostic.severity,
            message: record.diagnostic.message,
            ...(record.diagnostic.code !== undefined ? { code: record.diagnostic.code } : {}),
            ...(record.diagnostic.ruleId !== undefined ? { ruleId: record.diagnostic.ruleId } : {}),
            ...(record.diagnostic.stepId !== undefined ? { stepId: record.diagnostic.stepId } : {}),
            ...(record.diagnostic.nodeId !== undefined ? { nodeId: record.diagnostic.nodeId } : {}),
            ...(record.diagnostic.interactionType !== undefined ? { interactionType: record.diagnostic.interactionType } : {}),
          })),
        }))
      }
      const unavailableDerivedImages = [...imageResources.unavailableDerivedImages]
      const acceptedDerivedImages = [...imageResources.derivedImages]
      const plan = (): PlannedResource[] => {
        const currentStructure = observationJson({
          canonicalDocumentRevision: before.document.revision, draftEpoch,
          hasActiveDraft: before.draft !== null || localDrafts.length > 0, source: host.source,
          activeCanvasDrafts: localDrafts, activeStylePreview,
          originalImages: imageResources.originalImages.map(({ assetId, fileId, relativePath, mediaType, attachmentRole }) => ({
            assetId, fileId, relativePath, mediaType, attachmentRole,
          })),
          derivedImages: acceptedDerivedImages.map(({ assetId, fileId, relativePath, mediaType, derivedFrom }) => ({
            assetId, fileId, relativePath, mediaType, derivedFrom,
          })),
          unavailableOriginalImages: imageResources.unavailableOriginalImages,
          unavailableDerivedImages,
          ...structure,
          spatialView: host.spatialView,
        })
        const entries: PlannedResource[] = [{
          fileId: 'current-structure', path: 'observation/current-structure.json', mediaType: 'application/json',
          role: 'structure', content: currentStructure, encoding: 'utf8', byteLength: new TextEncoder().encode(currentStructure).byteLength,
        }]
        if (imageResources.unavailableOriginalImages.length || unavailableDerivedImages.length) {
          const diagnostics = observationJson({
            version: 1,
            kind: 'original-image-resource-diagnostics',
            unavailableOriginalImages: imageResources.unavailableOriginalImages,
            unavailableDerivedImages,
          })
          entries.push({
            fileId: 'image-resource-diagnostics', path: 'observation/images/original-image-diagnostics.json', mediaType: 'application/json',
            role: 'runtime-evidence', content: diagnostics, encoding: 'utf8', byteLength: new TextEncoder().encode(diagnostics).byteLength,
          })
        }
        entries.push(...imageResources.originalImages.map(({ fileId, relativePath, mediaType, attachmentRole, bytes }) => ({
          fileId, path: relativePath, mediaType, role: attachmentRole,
          content: bytesToBase64(bytes), encoding: 'base64' as const, byteLength: bytes.byteLength,
        })))
        entries.push(...mandatoryResources)
        entries.push(...acceptedDerivedImages.map(({ fileId, relativePath, mediaType, bytes }) => ({
          fileId, path: relativePath, mediaType, role: 'image' as const,
          content: bytesToBase64(bytes), encoding: 'base64' as const, byteLength: bytes.byteLength,
        })))
        return entries
      }
      let planned = plan()
      while (planned.reduce((sum, entry) => sum + new TextEncoder().encode(entry.content).byteLength, 0) > MAX_GENERATION_RESOURCE_BYTES) {
        const omitted = acceptedDerivedImages.pop()
        if (!omitted) throw new AuthoringObservationUnavailable('当前画面与必要原图超过 12 MiB 附件容量，请缩小引用范围')
        unavailableDerivedImages.push({
          assetId: omitted.assetId, code: 'image-derived-byte-budget-exceeded',
          message: '这张 SVG 的 PNG 派生图超过本轮附件容量，原始 SVG 结构证据和当前画面已保留。',
          mimeType: 'image/svg+xml', expectedByteLength: null, actualByteLength: omitted.bytes.byteLength,
        })
        planned = plan()
      }
      for (const entry of planned) {
        add(entry.fileId, entry.path, entry.mediaType, entry.role, entry.content, entry.encoding, entry.byteLength)
      }
      const observation = authoringObservationInputSchema.parse({ documentRevision: before.document.revision,
        sessionGeneration: before.sessionGeneration, draftEpoch, viewEpoch, runtime: host.runtime,
        surfaceId: host.facts.surfaceId, locationId: host.facts.locationId, stateId: host.facts.stateId,
        source: host.source, spatialView: host.spatialView, capturedAt: image.capturedAt, files })
      diagnosticSnapshot?.acknowledge()
      return { observation, resourceFiles, document: before.document, captureDurationMs: performance.now() - started }
    },
  }
}
