import { componentSurfaces } from '../../shared/contracts/component-platform/project'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sameDeliveryDocument, type CourseDeliverySnapshot } from './courseDeliverySnapshot'
import { buildComponentDelivery, type BuiltComponentDelivery, type ComponentDeliveryFinding, type ComponentDeliveryFormat, type ComponentDeliveryReport, type ComponentOutputCapture } from '../export/componentPlatform/delivery'
import { buildComponentPublished, type ComponentCompilePort } from '../export/componentPlatform/buildHtml'
import type { PublishedCourseV3 } from '../../shared/contracts/component-platform/published'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import { SINGLE_HTML_WARNING_BYTES, utf8ByteLength } from '../export/exportSize'
import { mountPublishedCourseV3 } from '../../player/componentPlatform/publishedPlayer'
import { installedBundledFontFaceCss } from '../../shared/fonts/installedBundledFontFaceCss'
import { beginSerializedSessionMount, enqueueSerial } from '../ui/serializedSessionMount'
import { createComponentDeliveryCapture, type ComponentScreenshot } from '../export/componentPlatform/capture'
import type { ExportPageOptions } from '../../shared/workbench/toolPorts'
import { componentDeliveryPages, type ComponentDeliveryPage } from '../export/componentPlatform/deliveryPages'
import type { StaticCourseExportFormat } from './CourseExportSettingsDialog'
import type { FrozenDeliveryBuildInput } from '../../shared/workbench/frozenDelivery'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import { setDeliveryImageDocuments } from '../export/componentPlatform/encodeDeliveryImage'

export type { CourseDeliverySnapshot } from './courseDeliverySnapshot'
export type { ComponentDeliveryFinding, ComponentDeliveryReport } from '../export/componentPlatform/delivery'
export type CourseDeliveryFormat = ComponentDeliveryFormat
export interface CourseDeliveryPreviewFeedback { readonly kind: 'loading' | 'error'; readonly title: string; readonly message: string }
export interface CourseDeliveryPorts {
  captureSnapshot(): Promise<CourseDeliverySnapshot | null>
  readCanonicalSnapshot(): CourseDeliverySnapshot | null
  compileComponent: ComponentCompilePort
  /** Desktop builds use Main's fixed-revision isolated export producer. */
  buildOutput?(input: FrozenDeliveryBuildInput, signal: AbortSignal): Promise<BuiltComponentDelivery>
  createOutputCapture?(payload: PublishedCourseV3): Promise<ComponentOutputCapture>
  captureAuthoringObservation?: ComponentScreenshot
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
  navigateFinding(item: ComponentDeliveryFinding): void
  exportHtml(input: { suggestedName: string; html: string; projectPath?: string }): Promise<{ path: string } | null>
  exportWebPackage(input: { suggestedName: string; bytes: Uint8Array; projectPath?: string }): Promise<{ path: string } | null>
  exportPdf(input: { suggestedName: string; html: string; projectPath?: string }): Promise<{ path: string } | null>
  exportBinary(input: { suggestedName: string; extension: 'pptx' | 'json' | 'docx'; bytes: Uint8Array; projectPath?: string }): Promise<{ path: string } | null>
}
export interface CourseDeliveryWatch { readonly documentTrigger: unknown; readonly sidecarTrigger: unknown; readonly componentPackagesTrigger: unknown; readonly liveDocuments?: readonly DocumentSnapshot[] }
export interface CourseDeliveryApi {
  readonly exportProgress: 'generating' | 'saving' | 'cancelling' | null
  cancelExport(): void
  readonly previewOpen: boolean
  readonly previewFeedback: CourseDeliveryPreviewFeedback | null
  readonly previewDiagnostics: readonly string[]
  readonly exportPreflightReport: ComponentDeliveryReport | null
  readonly largeHtmlByteLength: number | null
  bindPreviewHost(host: HTMLDivElement | null): void
  previousPreview(): void
  nextPreview(): void
  closePreview(): void
  openPreview(): void
  exportCourse(format: CourseDeliveryFormat, mode?: SingleHtmlExportMode, options?: ExportPageOptions): void
  readonly exportSettingsOpen: boolean
  readonly exportSettingsPages: readonly ComponentDeliveryPage[]
  openExportSettings(): void
  closeExportSettings(): void
  confirmExportSettings(format: StaticCourseExportFormat, options: ExportPageOptions): void
  cancelPreflight(): void
  continuePreflightExport(): void
  locatePreflightItem(item: ComponentDeliveryFinding): void
  savePreflightReport(): void
  cancelLargeHtml(): void
  continueLargeHtml(): void
  exportLargeHtmlAsWebPackage(): void
}
interface PendingDelivery { snapshot: CourseDeliverySnapshot; format: CourseDeliveryFormat; mode: SingleHtmlExportMode; built: BuiltComponentDelivery }

export function useCourseDelivery(ports: CourseDeliveryPorts, watch: CourseDeliveryWatch): CourseDeliveryApi {
  const ownsImageCache = watch.liveDocuments !== undefined
  useEffect(() => { if (watch.liveDocuments) setDeliveryImageDocuments(document, watch.liveDocuments) }, [watch.liveDocuments])
  useEffect(() => {
    if (ownsImageCache) return () => setDeliveryImageDocuments(document, [])
  }, [ownsImageCache])
  const ref = useRef(ports); ref.current = ports
  const job = useRef<AbortController | null>(null), phase = useRef<CourseDeliveryApi['exportProgress']>(null)
  const [exportProgress, setExportProgress] = useState<CourseDeliveryApi['exportProgress']>(null)
  const [previewOpen, setPreviewOpen] = useState(false), [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null)
  const [previewSnapshot, setPreviewSnapshot] = useState<CourseDeliverySnapshot | null>(null)
  const [previewFeedback, setPreviewFeedback] = useState<CourseDeliveryPreviewFeedback | null>(null)
  const [previewDiagnostics, setPreviewDiagnostics] = useState<readonly string[]>([])
  const [exportPreflightReport, setExportPreflightReport] = useState<ComponentDeliveryReport | null>(null)
  const [largeHtmlByteLength, setLargeHtmlByteLength] = useState<number | null>(null)
  const [settingsSnapshot, setSettingsSnapshot] = useState<CourseDeliverySnapshot | null>(null)
  const pending = useRef<PendingDelivery | null>(null), large = useRef<PendingDelivery | null>(null)
  const preview = useRef<Awaited<ReturnType<typeof mountPublishedCourseV3>> | null>(null)
  const chain = useRef(Promise.resolve())
  useEffect(() => () => { if (phase.current !== 'saving') job.current?.abort() }, [])
  const generate = useCallback((work: (signal: AbortSignal, beforeSave: () => void) => Promise<void>) => {
    const controller = new AbortController(); job.current?.abort(); job.current = controller
    phase.current = 'generating'; setExportProgress('generating')
    void ref.current.runBusy(async () => {
      const beforeSave = () => { controller.signal.throwIfAborted(); phase.current = 'saving'; setExportProgress('saving') }
      try { await work(controller.signal, beforeSave) }
      catch (error) { if (!controller.signal.aborted) throw error }
      finally { if (job.current === controller) { job.current = null; phase.current = null; setExportProgress(null) } }
    }, '导出失败，当前内容与原文件已保留。')
  }, [])
  const capture = useCallback(async (expected = ref.current.readCanonicalSnapshot()) => {
    const value = await ref.current.captureSnapshot()
    if (!value) throw new Error('当前会话没有可交付的 V10 工程，请新建或打开课程后再试。')
    if (expected && !sameDeliveryDocument(value, expected)) throw new Error('准备交付期间已切换文档，请在目标文档重新执行。')
    return value
  }, [])
  const build = useCallback((snapshot: CourseDeliverySnapshot, format: CourseDeliveryFormat, signal: AbortSignal, mode: SingleHtmlExportMode = 'offline-portable') =>
    ref.current.buildOutput ? ref.current.buildOutput({ requestId: crypto.randomUUID(),
      identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: snapshot.project.id },
      format, singleHtmlMode: mode, ...(snapshot.deliveryOptions ? { options: snapshot.deliveryOptions } : {}) }, signal)
    : buildComponentDelivery(snapshot, format, { compile: ref.current.compileComponent,
      createCapture: ref.current.createOutputCapture ?? (ref.current.captureAuthoringObservation
        ? payload => createComponentDeliveryCapture(payload, ref.current.captureAuthoringObservation!) : undefined), signal, singleHtmlMode: mode }), [])
  const write = useCallback(async (value: PendingDelivery, beforeSave: () => void) => {
    const paths: string[] = []
    const binding = value.snapshot.snapshot.binding
    const location = binding.kind === 'file' ? { projectPath: binding.path } : {}
    for (const artifact of value.built.artifacts) {
      beforeSave()
      const result = artifact.extension === 'html'
        ? await ref.current.exportHtml({ suggestedName: artifact.suggestedName, html: artifact.html!, ...location })
        : artifact.extension === 'zip' ? await ref.current.exportWebPackage({ suggestedName: artifact.suggestedName, bytes: artifact.bytes!, ...location })
        : artifact.extension === 'pdf' ? await ref.current.exportPdf({ suggestedName: artifact.suggestedName, html: artifact.html!, ...location })
        : await ref.current.exportBinary({ suggestedName: artifact.suggestedName, extension: artifact.extension, bytes: artifact.bytes!, ...location })
      if (!result) break
      paths.push(result.path)
    }
    if (paths.length) ref.current.commitStatus(`已导出到 ${paths.length === 1 ? paths[0] : `${paths.length} 个文件`}${value.built.report.items.length ? `；${value.built.report.items.length} 项输出说明` : ''}`)
  }, [])
  const present = useCallback(async (value: PendingDelivery, beforeSave: () => void) => {
    const html = value.built.artifacts[0]?.extension === 'html' ? value.built.artifacts[0].html : undefined
    if (html && utf8ByteLength(html) > SINGLE_HTML_WARNING_BYTES) { large.current = value; setLargeHtmlByteLength(utf8ByteLength(html)); return }
    await write(value, beforeSave)
  }, [write])
  const exportCourse = useCallback((format: CourseDeliveryFormat, mode: SingleHtmlExportMode = 'offline-portable', options?: ExportPageOptions) => {
    const expected = ref.current.readCanonicalSnapshot()
    const deliveryOptions = options ? structuredClone(options) : undefined
    generate(async (signal, beforeSave) => {
      const snapshot = { ...await capture(expected), ...(deliveryOptions ? { deliveryOptions } : {}) }, built = await build(snapshot, format, signal, mode)
      const value = { snapshot, format, mode, built }
      if (built.report.items.some(item => item.severity !== 'info')) { pending.current = value; setExportPreflightReport(built.report) }
      else await present(value, beforeSave)
    })
  }, [build, capture, generate, present])
  const openExportSettings = useCallback(() => {
    const snapshot = ref.current.readCanonicalSnapshot()
    if (!snapshot) { ref.current.reportError('当前会话没有可导出的课程。'); return }
    setSettingsSnapshot(snapshot)
  }, [])
  const confirmExportSettings = useCallback((format: StaticCourseExportFormat, options: ExportPageOptions) => {
    const current = ref.current.readCanonicalSnapshot()
    if (!settingsSnapshot || !current || !sameDeliveryDocument(settingsSnapshot, current)) {
      ref.current.reportError('导出设置的目标文档已切换，请在当前文档重新打开设置。'); return
    }
    setSettingsSnapshot(null); exportCourse(format, 'offline-portable', options)
  }, [exportCourse, settingsSnapshot])
  const cancelPreflight = useCallback(() => { pending.current = null; setExportPreflightReport(null) }, [])
  const continuePreflightExport = useCallback(() => {
    const value = pending.current
    if (!value) return
    generate(async (signal, beforeSave) => {
      const current = { ...await capture(value.snapshot), deliveryOptions: value.snapshot.deliveryOptions }
      if (pending.current !== value) return
      // New edits refresh the actual producer; revision is not a user-supplied delivery gate.
      const built = current.revision === value.snapshot.revision ? value.built : await build(current, value.format, signal, value.mode)
      cancelPreflight(); await present({ ...value, snapshot: current, built }, beforeSave)
    })
  }, [build, cancelPreflight, capture, generate, present])
  const cancelLargeHtml = useCallback(() => { large.current = null; setLargeHtmlByteLength(null) }, [])
  const continueLargeHtml = useCallback(() => {
    const value = large.current; cancelLargeHtml()
    if (value) generate(async (signal, beforeSave) => {
      const current = { ...await capture(value.snapshot), deliveryOptions: value.snapshot.deliveryOptions }
      const built = current.revision === value.snapshot.revision ? value.built : await build(current, value.format, signal, value.mode)
      await write({ ...value, snapshot: current, built }, beforeSave)
    })
  }, [build, cancelLargeHtml, capture, generate, write])
  const savePreflightReport = useCallback(() => {
    if (!exportPreflightReport) return
    const snapshot = pending.current?.snapshot
    const binding = snapshot?.snapshot.binding
    void ref.current.runBusy(async () => { await ref.current.exportBinary({ suggestedName: `${snapshot?.project.title ?? '课程'}-导出说明.json`, extension: 'json', bytes: new TextEncoder().encode(JSON.stringify(exportPreflightReport, null, 2)),
      ...(binding?.kind === 'file' ? { projectPath: binding.path } : {}) }) }, '输出说明保存失败。')
  }, [exportPreflightReport])
  const openPreview = useCallback(() => {
    void ref.current.runBusy(async () => { const snapshot = await capture(); setPreviewSnapshot(snapshot); setPreviewOpen(true) }, '整课预览不可用。')
  }, [capture])
  useEffect(() => {
    if (!previewOpen || !previewHost || !previewSnapshot) {
      const old = preview.current; preview.current = null
      if (old) enqueueSerial(chain, () => old.dispose())
      return
    }
    let active = true
    setPreviewDiagnostics([])
    setPreviewFeedback({ kind: 'loading', title: '正在准备整课预览', message: '正在载入当前课程…' })
    const report = (message: string) => {
      if (active) setPreviewDiagnostics(current => current.includes(message) ? current : [...current, message])
    }
    const dispose = beginSerializedSessionMount(chain, async () => {
      const result = await buildComponentPublished(previewSnapshot.snapshot, ref.current.compileComponent)
      for (const item of result.diagnostics) report(`${item.path.length ? `${item.path.join(' / ')}：` : ''}${item.message}`)
      const player = await mountPublishedCourseV3(result.payload, previewHost, { fontFaceCss: installedBundledFontFaceCss(document), report })
      return { ...player, destroy: player.dispose }
    }, {
      onReady: player => { preview.current = player; setPreviewFeedback(null) },
      onError: error => setPreviewFeedback({ kind: 'error', title: '整课预览启动失败', message: error instanceof Error ? error.message : String(error) }),
      onCleanup: () => { preview.current = null },
    })
    return () => { active = false; dispose() }
  }, [previewHost, previewOpen, previewSnapshot])
  // An open preview is a frozen run. Author updates do not remount its answer state.
  void watch
  return {
    exportProgress, cancelExport: () => { if (phase.current === 'generating') { job.current?.abort(); phase.current = 'cancelling'; setExportProgress('cancelling') } },
    previewOpen, previewFeedback, previewDiagnostics, exportPreflightReport, largeHtmlByteLength, bindPreviewHost: setPreviewHost,
    previousPreview: () => { void preview.current?.previous() }, nextPreview: () => { void preview.current?.next() },
    closePreview: () => setPreviewOpen(false), openPreview, exportCourse, cancelPreflight, continuePreflightExport,
    exportSettingsOpen: settingsSnapshot !== null, exportSettingsPages: settingsSnapshot ? componentDeliveryPages(componentSurfaces(settingsSnapshot.project)) : [],
    openExportSettings, closeExportSettings: () => setSettingsSnapshot(null), confirmExportSettings,
    locatePreflightItem: item => { const current = ref.current.readCanonicalSnapshot(); if (current && pending.current && sameDeliveryDocument(current, pending.current.snapshot)) ref.current.navigateFinding(item); cancelPreflight() },
    savePreflightReport, cancelLargeHtml, continueLargeHtml,
    exportLargeHtmlAsWebPackage: () => { cancelLargeHtml(); exportCourse('web-package') },
  }
}
