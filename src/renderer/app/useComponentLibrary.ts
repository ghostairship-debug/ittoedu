import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AvailableComponentCatalogPackage, ComponentCatalogSnapshot } from '../../shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { DesktopAPI, OpenBinaryFileResult, SelectedBinaryBatchFile, SelectedFileBatch } from '../../shared/ipcTypes'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { settleCourseComponentInput } from '../documents/CourseV10DocumentBridge'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../core/components/library/archive'
import { captureComponentPackageReplacementTarget, commitComponentReplacementAtTarget, type ComponentPackageReplacementTarget } from '../components/commitComponentPackageAuthoring'
import { insertComponentPackagesAtTarget, type ComponentLibraryAddOptions } from '../components/insertComponentPackages'
import { loadBuiltInWorkAsset } from '../../core/components/library/workAssets'
import type { CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'
import { selectProjectLibraryDefinitions } from '../components/componentLibraryModel'
import { inspectComponentLibraryUpdate, type ComponentLibraryUpdateReview } from '../../core/components/library/updateSource'
import { componentSurface } from '../../shared/contracts/component-platform/project'
import { captureFlowMenuPage } from '../document/flowWorkspaceRegistry'
import { refreshFlowMenuTarget, releaseFlowMenuTarget, resolveFlowMenuInsertionOptions, type CapturedFlowMenuTarget } from '../ui/flow/flowInsertCommands'

type CatalogPackageReference = Parameters<DesktopAPI['readComponentCatalogPackage']>[0]
const catalogPackageReference = ({ sourceId, packageId, version }: AvailableComponentCatalogPackage): CatalogPackageReference =>
  ({ sourceId, packageId, version })

export interface ComponentLibraryPorts {
  kernel: EditorStoreKernel
  capturePlacement?(target: CapturedCourseTarget): CourseInsertionOptions
  selectComponentPackage(): Promise<OpenBinaryFileResult | null>
  selectComponentPackages(): Promise<SelectedFileBatch<SelectedBinaryBatchFile> | null>
  desktopAvailable(): boolean
  loadCatalog(): Promise<ComponentCatalogSnapshot>
  readCatalogPackage(input: CatalogPackageReference): Promise<{ bytes: Uint8Array; sha256: string }>
  installLibraryEntry?(bytes: Uint8Array): Promise<ComponentCatalogSnapshot>
  deleteCatalogPackage?(input: CatalogPackageReference): Promise<ComponentCatalogSnapshot>
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
}
export interface ComponentPackageReplacementRequest { mode: 'replace'; packageId: string; target: ComponentPackageReplacementTarget; packageData: ComponentLibraryEntry; sourceFileName: string; sourceReview: ComponentLibraryUpdateReview }
export interface CatalogPackageUpdateRequest { mode: 'update'; entries: AvailableComponentCatalogPackage[]; target: ComponentPackageReplacementTarget; packageData: ComponentLibraryEntry; sourceReview: ComponentLibraryUpdateReview }
/** Library cards retain identity and labels; the existing insertion service extracts their actual example on demand. */
export interface InstalledComponentLibraryEntry { id: string; title: string; definitionId: string }
export interface ComponentLibraryApi {
  componentCatalog: ComponentCatalogSnapshot
  installedEntries: InstalledComponentLibraryEntry[]
  replacementRequest: ComponentPackageReplacementRequest | null
  catalogUpdateRequest: CatalogPackageUpdateRequest | null
  importExternalPackages(): void
  replacePackage(packageId: string): void
  refreshCatalog(): void
  addCatalogPackages(entries: AvailableComponentCatalogPackage[], options?: ComponentLibraryAddOptions): Promise<boolean>
  prepareCatalogPackage(entry: AvailableComponentCatalogPackage): Promise<ComponentLibraryEntry | null>
  requestCatalogUpdate(entry: AvailableComponentCatalogPackage): void
  confirmReplacement(): void
  cancelReplacement(): void
  confirmCatalogUpdate(): void
  cancelCatalogUpdate(): void
  extractSelection(title: string, kind?: ComponentLibraryEntry['kind'], surfaceIds?: readonly string[]): Promise<void>
  deleteCatalogPackage(entry: AvailableComponentCatalogPackage): Promise<void>
}
const EMPTY: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [] }
/** The existing Flow input owns the bookmark; this adapter only holds it across package reads. */
function captureLibraryInsertion(ports: ComponentLibraryPorts) {
  const target = ports.kernel.captureTarget(), placement = ports.capturePlacement?.(target) ?? {}
  const page = !placement.container && placement.destination !== 'paper' && target.surfaceId
    && componentSurface(target.project, target.surfaceId)?.kind === 'flow' ? captureFlowMenuPage(true) : undefined
  const flow: CapturedFlowMenuTarget | undefined = page?.ok && page.documentId === target.documentId
    && page.surfaceId === target.surfaceId && (!page.epoch || page.epoch === target.epoch) ? { ...target, flowMenuPage: page } : undefined
  if (page?.ok && !flow) page.insertionSelection?.release()
  return {
    scope: JSON.stringify([target.documentId, target.epoch, target.surfaceId, target.activeStateId,
      target.rootInstanceId, target.editingContainerId, target.activation, target.selectionIdentity, target.instanceIds]),
    release: () => { if (flow) releaseFlowMenuTarget(flow) },
    async prepare(entries: readonly ComponentLibraryEntry[], options: ComponentLibraryAddOptions = {}) {
      if (!flow || !entries.some(entry => entry.kind !== 'page' && entry.kind !== 'structure' || options.placement === 'local')) return { target, placement }
      const refreshed = await refreshFlowMenuTarget(ports.kernel, flow)
      return { target: refreshed, placement: resolveFlowMenuInsertionOptions(refreshed,
        { kind: 'component', destination: 'document', label: '组件' }, placement) }
    },
  }
}
export function useComponentLibrary(ports: ComponentLibraryPorts): ComponentLibraryApi {
  const current = useRef(ports); current.current = ports
  const view = useSyncExternalStore(ports.kernel.bridge.subscribe, ports.kernel.readView, ports.kernel.readView)
  const [componentCatalog, setCatalog] = useState<ComponentCatalogSnapshot>(EMPTY)
  const [replacementRequest, setReplacement] = useState<ComponentPackageReplacementRequest | null>(null)
  const [catalogUpdateRequest, setUpdate] = useState<CatalogPackageUpdateRequest | null>(null)
  const catalogUpdateGeneration = useRef(0)
  const replacementCommit = useRef<ComponentPackageReplacementRequest | null>(null)
  const updateCommit = useRef<CatalogPackageUpdateRequest | null>(null)
  const replacementFailure = useRef<{ request: ComponentPackageReplacementRequest; error: unknown } | null>(null)
  const updateFailure = useRef<{ request: CatalogPackageUpdateRequest; error: unknown } | null>(null)
  const insertionFailure = useRef<{ key: string; error: unknown } | null>(null)
  const installedEntries = useMemo((): InstalledComponentLibraryEntry[] => {
    const project = view.project
    if (!project) return []
    const usedDefinitions = new Set(Object.values(project.instances).map(instance => instance.definitionId))
    return selectProjectLibraryDefinitions(project.definitions).filter(definition => usedDefinitions.has(definition.id))
      .map(definition => ({ id: definition.library?.packageId ?? definition.id,
        title: definition.title ?? definition.id, definitionId: definition.id }))
  }, [view.project])
  const refreshCatalog = useCallback(() => {
    if (!current.current.desktopAvailable()) return
    void current.current.runBusy(async () => { setCatalog(await current.current.loadCatalog()) }, '组件目录读取失败。')
  }, [])
  useEffect(refreshCatalog, [refreshCatalog])
  const prepareCatalogPackage = useCallback(async (entry: AvailableComponentCatalogPackage) => {
    return await current.current.runBusy(async () => {
      const file = await current.current.readCatalogPackage(catalogPackageReference(entry))
      const archive = importComponentLibraryArchive(file.bytes)
      if (archive.entry.id !== entry.packageId || archive.version !== entry.version) throw new Error('目录组件身份已改变，请刷新。')
      return archive.entry
    }, '组件条目读取失败，原工程保留。') ?? null
  }, [])
  const addCatalogPackages = useCallback(async (entries: AvailableComponentCatalogPackage[], options: ComponentLibraryAddOptions = {}) => {
    const input = captureLibraryInsertion(current.current)
    const key = JSON.stringify([options.attemptId ?? crypto.randomUUID(), input.scope,
      entries.map(({ sourceId, packageId, version }) => [sourceId, packageId, version]), options])
    if (insertionFailure.current) {
      try {
      const previous = insertionFailure.current, outcome = await settleCourseComponentInput(previous.error)
      if (outcome === 'pending') throw new Error('上一次添加结果仍在核实，所选内容保留，请稍后重试。')
      insertionFailure.current = null
      if (outcome === 'applied' && previous.key === key) { input.release(); return true }
      } catch (error) { input.release(); throw error }
    }
    let failure: { error: unknown } | undefined
    const completed = await current.current.runBusy(async () => {
      try {
      const prepared: ComponentLibraryEntry[] = []
      for (const id of options.builtInAssetIds ?? []) {
        const asset = await loadBuiltInWorkAsset(id)
        if (!asset) throw new Error('资产已不存在，请刷新后重试。')
        prepared.push(asset)
      }
      for (const entry of entries) {
        const file = await current.current.readCatalogPackage(catalogPackageReference(entry))
        const archive = importComponentLibraryArchive(file.bytes)
        if (archive.entry.id !== entry.packageId || archive.version !== entry.version) throw new Error('目录条目身份已改变，请刷新。')
        prepared.push(archive.entry)
      }
      const { target, placement } = await input.prepare(prepared, options)
      const result = await insertComponentPackagesAtTarget(current.current.kernel, target, prepared, {
        ...placement,
        ...(options.placement ? { placement: options.placement } : {}),
        ...(options.includeTeacherController ? { includeTeacherController: true } : {}),
        ...(target.instanceId ? { targetBindings: { navigation: target.instanceId } } : {}),
      })
      if (!result.ok) {
        const error = result.inputFailure ?? new Error(result.reason)
        if (result.inputFailure) {
          insertionFailure.current = { key, error }
          const outcome = await settleCourseComponentInput(error)
          if (outcome !== 'pending') insertionFailure.current = null
          if (outcome === 'applied') return true
        }
        throw error
      }
      current.current.commitStatus(`已应用 ${prepared.length + (options.includeTeacherController ? 1 : 0)} 个组件与资产`)
      return true
      } catch (error) { failure = { error }; throw error }
    }, '组件添加未完成。').finally(input.release)
    if (failure) throw failure.error
    return completed === true
  }, [])
  const importExternalPackages = useCallback(() => {
    const input = captureLibraryInsertion(current.current)
    void current.current.runBusy(async () => {
      if (insertionFailure.current) {
        const outcome = await settleCourseComponentInput(insertionFailure.current.error)
        if (outcome === 'pending') throw new Error('上一次添加结果仍在核实，原文件保留，请稍后重试。')
        insertionFailure.current = null
        if (outcome === 'applied') current.current.commitStatus('上一次组件添加已经完成')
      }
      const batch = await current.current.selectComponentPackages()
      if (!batch) return
      const entries: ComponentLibraryEntry[] = [], problems = batch.rejected.map(item => `${item.name}：${item.message}`)
      for (const file of batch.accepted) {
        try {
          const archive = importComponentLibraryArchive(file.bytes)
          if (current.current.installLibraryEntry) setCatalog(await current.current.installLibraryEntry(file.bytes))
          entries.push(archive.entry)
        } catch (error) { problems.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`) }
      }
      if (entries.length) {
        const { target, placement } = await input.prepare(entries)
        const result = await insertComponentPackagesAtTarget(current.current.kernel, target, entries, placement)
        if (!result.ok) {
          const error = result.inputFailure ?? new Error(result.reason)
          if (result.inputFailure) {
            insertionFailure.current = { key: 'external', error }
            const outcome = await settleCourseComponentInput(error)
            if (outcome !== 'pending') insertionFailure.current = null
            if (outcome === 'applied') { current.current.commitStatus(`已添加 ${entries.length} 个外部组件`); return }
          }
          throw error
        }
        current.current.commitStatus(`已添加 ${entries.length} 个外部组件`)
      }
      if (problems.length) current.current.reportError(problems.join('\n'))
    }, '外部组件读取失败，原件保留。').finally(input.release)
  }, [])
  const replacePackage = useCallback((id: string) => {
    const target = captureComponentPackageReplacementTarget(current.current.kernel, id)
    if (!target) { current.current.reportError('待替换组件已不存在。'); return }
    void current.current.runBusy(async () => {
      const file = await current.current.selectComponentPackage()
      if (!file) return
      const packageData = importComponentLibraryArchive(file.bytes).entry
      const sourceReview = inspectComponentLibraryUpdate(target.captured.project, target.packageId, packageData, target.captured.resources)
      setReplacement({ mode: 'replace', packageId: id, target, packageData, sourceFileName: file.name, sourceReview })
    }, '替换组件读取失败，原版本保留。')
  }, [])
  const confirmReplacement = useCallback(() => {
    const request = replacementRequest
    if (!request || replacementCommit.current === request) return
    replacementCommit.current = request
    void current.current.runBusy(async () => {
      try {
      if (replacementFailure.current) {
        const pending = replacementFailure.current, outcome = await settleCourseComponentInput(pending.error)
        if (outcome === 'pending') throw new Error('上一次替换结果仍在核实，审阅内容已保留，请稍后重试。')
        replacementFailure.current = null
        if (outcome === 'applied' && pending.request === request) { setReplacement(current => current === request ? null : current); return }
      }
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, request.packageData,
        { replaceLocalSource: request.sourceReview.localSourceModified })
      if (!result.ok) {
        const error = result.inputFailure ?? new Error(result.reason)
        replacementFailure.current = { request, error }
        const outcome = await settleCourseComponentInput(error)
        if (outcome !== 'applied') throw error
        replacementFailure.current = null
      }
      setReplacement(current => current === request ? null : current)
      } finally { if (replacementCommit.current === request) replacementCommit.current = null }
    }, '组件替换失败，原版本保留。').finally(() => { if (replacementCommit.current === request) replacementCommit.current = null })
  }, [replacementRequest])
  const requestCatalogUpdate = useCallback((entry: AvailableComponentCatalogPackage) => {
    const target = captureComponentPackageReplacementTarget(current.current.kernel, entry.packageId,true)
    if (!target) { current.current.reportError('工程中没有此组件定义，无法更新。'); return }
    const generation = ++catalogUpdateGeneration.current
    setUpdate(null)
    void current.current.runBusy(async () => {
      const file = await current.current.readCatalogPackage(catalogPackageReference(entry))
      const archive = importComponentLibraryArchive(file.bytes)
      if (archive.entry.id !== entry.packageId || archive.version !== entry.version) throw new Error('目录条目身份已改变，请刷新；工程原版本保留。')
      const sourceReview = inspectComponentLibraryUpdate(target.captured.project, target.packageId, archive.entry, target.captured.resources)
      if (generation === catalogUpdateGeneration.current) setUpdate({ mode: 'update', entries: [entry], target,
        packageData: archive.entry, sourceReview })
    }, '组件更新准备失败，原版本保留。')
  }, [])
  const confirmCatalogUpdate = useCallback(() => {
    const request = catalogUpdateRequest
    if (!request || updateCommit.current === request) return
    updateCommit.current = request
    void current.current.runBusy(async () => {
      try {
      if (updateFailure.current) {
        const pending = updateFailure.current, outcome = await settleCourseComponentInput(pending.error)
        if (outcome === 'pending') throw new Error('上一次更新结果仍在核实，审阅内容已保留，请稍后重试。')
        updateFailure.current = null
        if (outcome === 'applied' && pending.request === request) { setUpdate(current => current === request ? null : current); return }
      }
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, request.packageData,
        { replaceLocalSource: request.sourceReview.localSourceModified })
      if (!result.ok) {
        const error = result.inputFailure ?? new Error(result.reason)
        updateFailure.current = { request, error }
        const outcome = await settleCourseComponentInput(error)
        if (outcome !== 'applied') throw error
        updateFailure.current = null
      }
      setUpdate(current => current === request ? null : current)
      } finally { if (updateCommit.current === request) updateCommit.current = null }
    }, '组件更新失败。').finally(() => { if (updateCommit.current === request) updateCommit.current = null })
  }, [catalogUpdateRequest])
  const extractSelection = useCallback(async (title: string, kind: ComponentLibraryEntry['kind'] = 'objects', surfaceIds?: readonly string[]) => {
    const kernel = current.current.kernel, target: CapturedCourseTarget = kernel.captureTarget()
    if (!title.trim() || kind === 'objects' && !target.instanceIds.length) throw new Error('请输入名称并选择需要提炼的对象。')
    const pages = kind === 'page' ? target.surfaceId ? [target.surfaceId] : [] : [...surfaceIds ?? []]
    if (kind !== 'objects' && !pages.length) throw new Error('请选择需要提炼的页面。')
    const { entry, diagnostics } = extractComponentLibraryEntry(kind === 'objects' ? target.editingProject : target.project, target.resources,
      { id: `library_${crypto.randomUUID()}`, title: title.trim(), kind, ...(kind === 'objects' ? { rootIds: [...target.instanceIds] } : { surfaceIds: pages }) })
    if (!current.current.installLibraryEntry) throw new Error('组件库保存入口尚未连接，工程原件保留。')
    setCatalog(await current.current.installLibraryEntry(exportComponentLibraryArchive(entry)))
    current.current.commitStatus(`已将“${entry.title}”保存到我的资产库`)
    if (diagnostics.length) current.current.reportError(diagnostics.map(item => item.message).join('\n'))
  }, [])
  const deleteCatalogPackage = useCallback(async (entry: AvailableComponentCatalogPackage) => {
    await current.current.runBusy(async () => {
      if (!current.current.deleteCatalogPackage) throw new Error('库删除入口尚未连接。')
      setCatalog(await current.current.deleteCatalogPackage(catalogPackageReference(entry)))
    }, '库条目删除失败，原库条目保留。')
  }, [])
  return { componentCatalog, installedEntries, replacementRequest, catalogUpdateRequest, importExternalPackages, replacePackage, refreshCatalog,
    addCatalogPackages, prepareCatalogPackage, requestCatalogUpdate, confirmReplacement, cancelReplacement: () => setReplacement(null),
    confirmCatalogUpdate, cancelCatalogUpdate: () => { catalogUpdateGeneration.current++; setUpdate(null) }, extractSelection, deleteCatalogPackage }
}
