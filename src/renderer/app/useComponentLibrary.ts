import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AvailableComponentCatalogPackage, ComponentCatalogSnapshot } from '../../shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { OpenBinaryFileResult, SelectedBinaryBatchFile, SelectedFileBatch } from '../../shared/ipcTypes'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { extractComponentLibraryEntry } from '../../core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../core/components/library/archive'
import { captureComponentPackageReplacementTarget, commitComponentReplacementAtTarget, type ComponentPackageReplacementTarget } from '../components/commitComponentPackageAuthoring'
import { insertComponentPackagesAtTarget } from '../components/insertComponentPackages'
import type { CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'

export interface ComponentLibraryPorts {
  kernel: EditorStoreKernel
  capturePlacement?(target: CapturedCourseTarget): CourseInsertionOptions
  selectComponentPackage(): Promise<OpenBinaryFileResult | null>
  selectComponentPackages(): Promise<SelectedFileBatch<SelectedBinaryBatchFile> | null>
  desktopAvailable(): boolean
  loadCatalog(): Promise<ComponentCatalogSnapshot>
  readCatalogPackage(input: { sourceId: string; packageId: string; version: string }): Promise<{ bytes: Uint8Array; sha256: string }>
  installLibraryEntry?(bytes: Uint8Array): Promise<ComponentCatalogSnapshot>
  deleteCatalogPackage?(input: { sourceId: string; packageId: string; version: string }): Promise<ComponentCatalogSnapshot>
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
}
export interface ComponentPackageReplacementRequest { mode: 'replace'; packageId: string; target: ComponentPackageReplacementTarget; packageData: ComponentLibraryEntry; sourceFileName: string }
export interface CatalogPackageUpdateRequest { mode: 'update'; entries: AvailableComponentCatalogPackage[]; target: ComponentPackageReplacementTarget }
export interface ComponentLibraryApi {
  componentCatalog: ComponentCatalogSnapshot
  installedEntries: ComponentLibraryEntry[]
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
  extractSelection(title: string): Promise<void>
  deleteCatalogPackage(entry: AvailableComponentCatalogPackage): Promise<void>
}
const EMPTY: ComponentCatalogSnapshot = { sources: [], packages: [], issues: [] }
export function useComponentLibrary(ports: ComponentLibraryPorts): ComponentLibraryApi {
  const current = useRef(ports); current.current = ports
  const view = useSyncExternalStore(ports.kernel.bridge.subscribe, ports.kernel.readView, ports.kernel.readView)
  const [componentCatalog, setCatalog] = useState<ComponentCatalogSnapshot>(EMPTY)
  const [replacementRequest, setReplacement] = useState<ComponentPackageReplacementRequest | null>(null)
  const [catalogUpdateRequest, setUpdate] = useState<CatalogPackageUpdateRequest | null>(null)
  const installed = useMemo(() => {
    const entries: ComponentLibraryEntry[] = [], issues: string[] = []
    if (!view.project) return { entries, issues }
    const resources = view.views.find(item => item.documentId === view.activeDocumentId)?.model.resources
    if (!resources) return { entries, issues }
    for (const definition of Object.values(view.project.definitions)) {
      const sample = Object.values(view.project.instances).find(instance => instance.definitionId === definition.id)
      if (!sample) continue
      try { entries.push(extractComponentLibraryEntry(view.project, resources, { id: definition.id, title: definition.title ?? definition.id, rootIds: [sample.id] }).entry) }
      catch (error) { issues.push(`${definition.title ?? definition.id}：${error instanceof Error ? error.message : String(error)}`) }
    }
    return { entries, issues }
  }, [view.project, ports.kernel])
  const installedEntries = installed.entries
  useEffect(() => { if (installed.issues.length) current.current.reportError(installed.issues.join('\n')) }, [installed])
  const refreshCatalog = useCallback(() => {
    if (!current.current.desktopAvailable()) return
    void current.current.runBusy(async () => { setCatalog(await current.current.loadCatalog()) }, '组件目录读取失败。')
  }, [])
  useEffect(refreshCatalog, [refreshCatalog])
  const prepareCatalogPackage = useCallback(async (entry: AvailableComponentCatalogPackage) => {
    return await current.current.runBusy(async () => {
      const file = await current.current.readCatalogPackage(entry)
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
        const file = await current.current.readCatalogPackage(entry)
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
      setReplacement({ mode: 'replace', packageId: id, target, packageData: importComponentLibraryArchive(file.bytes).entry, sourceFileName: file.name })
    }, '替换组件读取失败，原版本保留。')
  }, [])
  const confirmReplacement = useCallback(() => {
    const request = replacementRequest; setReplacement(null)
    if (!request) return
    void current.current.runBusy(async () => {
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, request.packageData)
      if (!result.ok) throw new Error(result.reason)
    }, '组件替换失败，原版本保留。')
  }, [replacementRequest])
  const requestCatalogUpdate = useCallback((entry: AvailableComponentCatalogPackage) => {
    const target = captureComponentPackageReplacementTarget(current.current.kernel, entry.packageId)
    if (target) setUpdate({ mode: 'update', entries: [entry], target })
    else current.current.reportError('工程中没有此组件定义，无法更新。')
  }, [])
  const confirmCatalogUpdate = useCallback(() => {
    const request = catalogUpdateRequest; setUpdate(null)
    if (!request) return
    void current.current.runBusy(async () => {
      const file = await current.current.readCatalogPackage(request.entries[0])
      const result = await commitComponentReplacementAtTarget(current.current.kernel, request.target, importComponentLibraryArchive(file.bytes).entry)
      if (!result.ok) throw new Error(result.reason)
    }, '组件更新失败。')
  }, [catalogUpdateRequest])
  const extractSelection = useCallback(async (title: string) => {
    const kernel = current.current.kernel, target: CapturedCourseTarget = kernel.captureTarget()
    if (!title.trim() || !target.instanceIds.length) throw new Error('请输入名称并选择需要提炼的对象。')
    const { entry, diagnostics } = extractComponentLibraryEntry(target.project, target.resources, { id: `library_${crypto.randomUUID()}`, title: title.trim(), rootIds: [...target.instanceIds] })
    if (!current.current.installLibraryEntry) throw new Error('组件库保存入口尚未连接，工程原件保留。')
    setCatalog(await current.current.installLibraryEntry(exportComponentLibraryArchive(entry)))
    current.current.commitStatus(`已将“${entry.title}”保存到我的资产库`)
    if (diagnostics.length) current.current.reportError(diagnostics.map(item => item.message).join('\n'))
  }, [])
  const deleteCatalogPackage = useCallback(async (entry: AvailableComponentCatalogPackage) => {
    await current.current.runBusy(async () => {
      if (!current.current.deleteCatalogPackage) throw new Error('库删除入口尚未连接。')
      setCatalog(await current.current.deleteCatalogPackage(entry))
    }, '库条目删除失败，原库条目保留。')
  }, [])
  return { componentCatalog, installedEntries, replacementRequest, catalogUpdateRequest, importExternalPackages, replacePackage, refreshCatalog,
    addCatalogPackages, prepareCatalogPackage, requestCatalogUpdate, confirmReplacement, cancelReplacement: () => setReplacement(null),
    confirmCatalogUpdate, cancelCatalogUpdate: () => setUpdate(null), extractSelection, deleteCatalogPackage }
}
