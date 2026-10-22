import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AvailableComponentCatalogPackage, ComponentCatalogSnapshot } from '../../shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { DesktopAPI, OpenBinaryFileResult, SelectedBinaryBatchFile, SelectedFileBatch } from '../../shared/ipcTypes'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../core/components/library/archive'
import { captureComponentPackageReplacementTarget, commitComponentReplacementAtTarget, type ComponentPackageReplacementTarget } from '../components/commitComponentPackageAuthoring'
import { insertComponentPackagesAtTarget } from '../components/insertComponentPackages'
import type { CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'
import { selectProjectLibraryDefinitions } from '../components/componentLibraryModel'
import { inspectComponentLibraryUpdate, type ComponentLibraryUpdateReview } from '../../core/components/library/updateSource'

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
  addCatalogPackages(entries: AvailableComponentCatalogPackage[]): Promise<boolean>
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
export function useComponentLibrary(ports: ComponentLibraryPorts): ComponentLibraryApi {
  const current = useRef(ports); current.current = ports
  const view = useSyncExternalStore(ports.kernel.bridge.subscribe, ports.kernel.readView, ports.kernel.readView)
  const [componentCatalog, setCatalog] = useState<ComponentCatalogSnapshot>(EMPTY)
  const [replacementRequest, setReplacement] = useState<ComponentPackageReplacementRequest | null>(null)
  const [catalogUpdateRequest, setUpdate] = useState<CatalogPackageUpdateRequest | null>(null)
  const catalogUpdateGeneration = useRef(0)
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
  const addCatalogPackages = useCallback(async (entries: AvailableComponentCatalogPackage[]) => {
    const target = current.current.kernel.captureTarget()
    const placement = current.current.capturePlacement?.(target) ?? {}
    const completed = await current.current.runBusy(async () => {
      const prepared: ComponentLibraryEntry[] = []
      for (const entry of entries) {
        const file = await current.current.readCatalogPackage(catalogPackageReference(entry))
        const archive = importComponentLibraryArchive(file.bytes)
        if (archive.entry.id !== entry.packageId || archive.version !== entry.version) throw new Error('目录条目身份已改变，请刷新。')
        prepared.push(archive.entry)
      }
      const result = await insertComponentPackagesAtTarget(current.current.kernel, target, prepared, placement)
      if (!result.ok) throw new Error(result.reason)
      current.current.commitStatus(`已添加 ${entries.length} 个组件到原画布`)
      return true
    }, '组件添加未完成。')
    return completed === true
  }, [])
  const importExternalPackages = useCallback(() => {
    const target = current.current.kernel.captureTarget()
    const placement = current.current.capturePlacement?.(target) ?? {}
    void current.current.runBusy(async () => {
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
        const result = await insertComponentPackagesAtTarget(current.current.kernel, target, entries, placement)
        if (!result.ok) throw new Error(result.reason)
        current.current.commitStatus(`已添加 ${entries.length} 个外部组件`)
      }
      if (problems.length) current.current.reportError(problems.join('\n'))
    }, '外部组件读取失败，原件保留。')
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
    const request = replacementRequest; setReplacement(null)
    if (!request) return
    void current.current.runBusy(async () => {
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, request.packageData,
        { replaceLocalSource: request.sourceReview.localSourceModified })
      if (!result.ok) throw new Error(result.reason)
    }, '组件替换失败，原版本保留。')
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
    const request = catalogUpdateRequest; setUpdate(null)
    if (!request) return
    void current.current.runBusy(async () => {
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, request.packageData,
        { replaceLocalSource: request.sourceReview.localSourceModified })
      if (!result.ok) throw new Error(result.reason)
    }, '组件更新失败。')
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
