import type { AvailableComponentCatalogPackage, ComponentCatalogSnapshot, ComponentCatalogTrust } from '../../../shared/componentCatalog'
import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentCatalogManager } from '../../componentCatalogManager'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../../core/components/library/archive'
import type { ComponentLibraryArchiveMetadata } from '../../../core/components/library/archive'
import { compareVersions } from '../../htmlComponentLibrary'

export type ComponentLibrarySnapshot = ComponentCatalogSnapshot
export type AssetLibraryCatalog = Pick<ComponentCatalogManager, 'load' | 'readPackage' | 'install'> & Partial<Pick<ComponentCatalogManager, 'deletePackage'>>
export const readComponentLibrary = (catalog: AssetLibraryCatalog) => catalog.load()

export interface AssetCandidateView {
  kind: 'component-package'
  packageId: string
  version: string
  name: string
  description: string
  category?: string
  subject?: readonly string[]
  schoolStage?: readonly string[]
  tags?: readonly string[]
  sourceCourse?: string
  quality?: AvailableComponentCatalogPackage['quality']
  source: string
  sourceId: string
  removable: boolean
  trust: ComponentCatalogTrust
}
export interface AssetSearchResult {
  status: 'results'
  query: string
  candidates: readonly AssetCandidateView[]
  libraryEntries: number
  unreadable?: number
  note?: string
  hint?: string
}
const trustRank: Record<ComponentCatalogTrust, number> = { 'built-in': 3, trusted: 2, prompt: 1 }
const usablePackages = (snapshot: ComponentLibrarySnapshot) => snapshot.packages.filter(entry => entry.componentSchemaVersion === 1 && entry.runtimeApiVersion === 5 && entry.quality !== 'deprecated')
const newer = (left: AvailableComponentCatalogPackage, right: AvailableComponentCatalogPackage) => compareVersions(left.version, right.version) || trustRank[left.sourceTrust] - trustRank[right.sourceTrust]

/** Discover the same current API 5 entries offered by the component panel. */
export function searchComponentLibrary(snapshot: ComponentLibrarySnapshot, query: string, limit: number): AssetSearchResult {
  const current = new Map<string, AvailableComponentCatalogPackage>()
  for (const entry of usablePackages(snapshot)) {
    const existing = current.get(entry.packageId)
    if (!existing || newer(entry, existing) > 0) current.set(entry.packageId, entry)
  }
  const terms = [...new Set(query.toLowerCase().split(/[\s,，、;；/]+/).filter(Boolean))]
  const scored = [...current.values()].flatMap(entry => {
    const fields: [readonly string[], number][] = [[[entry.name], 6], [entry.tags, 3], [[entry.category ?? '', ...entry.subject, ...entry.schoolStage], 2], [[entry.description], 2], [[entry.packageId], 1]]
    let matched = 0, score = 0
    for (const term of terms) {
      const weight = Math.max(0, ...fields.map(([values, value]) => values.some(text => text.toLowerCase().includes(term)) ? value : 0))
      if (weight) { matched++; score += weight }
    }
    return matched || !terms.length ? [{ entry, matched, score }] : []
  }).sort((left, right) => right.matched - left.matched || right.score - left.score || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
  const candidates = scored.slice(0, limit).map(({ entry }): AssetCandidateView => ({ kind: 'component-package', packageId: entry.packageId, version: entry.version,
    name: entry.name, description: entry.description, ...(entry.category ? { category: entry.category } : {}),
    ...(entry.subject.length ? { subject: entry.subject } : {}), ...(entry.schoolStage.length ? { schoolStage: entry.schoolStage } : {}),
    ...(entry.tags.length ? { tags: entry.tags } : {}), ...(entry.source?.kind === 'local' ? { sourceCourse: entry.source.reference } : {}), quality: entry.quality,
    source: entry.sourceLabel, sourceId: entry.sourceId, removable: entry.removable === true, trust: entry.sourceTrust }))
  return { status: 'results', query, candidates, libraryEntries: current.size,
    ...(snapshot.issues.length ? { unreadable: snapshot.issues.length } : {}),
    ...(snapshot.htmlComponents?.length ? { note: '目录内的旧 HTML 条目未列为 Component API 5 可插入条目；原文件保留。' } : {}),
    ...(candidates.length ? {} : { hint: '资产库中没有匹配的条目；可换用更通用的词，或按需新建组件' }) }
}
export type LibraryComponentFiles =
  | { status: 'ready'; packageId: string; version: string; name: string; entry: ComponentLibraryEntry }
  | { status: 'rejected' | 'failed'; reason: string }
export type LibraryImportResult = { status: 'imported'; packageId: string; version: string; name: string; library: '我的资产库'; diagnostics?: NonNullable<ReturnType<typeof importComponentLibraryArchive>['diagnostics']> }
export type LibraryDeleteResult =
  | { status: 'deleted'; packageId: string; version: string; name: string; library: '我的资产库' }
  | { status: 'rejected'; reason: string }

/** Main owns catalog file reads and installation; formal project edits remain with C1. */
export class AssetLibraryService {
  constructor(private readonly options: { catalog: AssetLibraryCatalog }) {}
  async search(input: { query: string; limit?: number }): Promise<AssetSearchResult> {
    return searchComponentLibrary(await this.options.catalog.load(), input.query.trim(), input.limit ?? 8)
  }
  async read(input: { packageId: string; version?: string; sourceId?: string }): Promise<LibraryComponentFiles> {
    const library = await this.options.catalog.load()
    const found = usablePackages(library).filter(entry => entry.packageId === input.packageId && (!input.version || entry.version === input.version)
      && (!input.sourceId || entry.sourceId === input.sourceId)).sort((left, right) => newer(right, left))[0]
    if (!found) return { status: 'rejected', reason: `资产库中没有可用的 Component API 5 条目 ${input.packageId}${input.version ? `@${input.version}` : ''}；请先用 asset.search 检索` }
    if (found.sourceTrust === 'prompt') return { status: 'rejected', reason: `“${found.name}”所在的组件目录尚未确认信任；请教师在组件库面板确认信任后再使用` }
    try {
      const file = await this.options.catalog.readPackage(found.sourceId, found.packageId, found.version)
      const { entry, version } = importComponentLibraryArchive(file.bytes)
      if (entry.id !== found.packageId || version !== found.version) return { status: 'rejected', reason: '目录条目身份已改变，请刷新资产库后重试。' }
      return { status: 'ready', packageId: found.packageId, version: found.version, name: entry.title, entry }
    } catch (error) { return { status: 'failed', reason: `组件条目无法读取：${error instanceof Error ? error.message : String(error)}` } }
  }
  async save(input: { entry: ComponentLibraryEntry } & ComponentLibraryArchiveMetadata): Promise<{ status: 'saved'; packageId: string; version: string; name: string; library: '我的资产库' }> {
    const { entry, ...metadata } = input
    const bytes = exportComponentLibraryArchive(entry, undefined, metadata)
    const { version } = importComponentLibraryArchive(bytes)
    await this.options.catalog.install(bytes)
    return { status: 'saved', packageId: input.entry.id, version, name: input.entry.title, library: '我的资产库' }
  }
  /** Import the original archive through the panel's managed catalog owner, without changing project instances. */
  async import(bytes: Uint8Array): Promise<LibraryImportResult> {
    const archive = importComponentLibraryArchive(bytes)
    await this.options.catalog.install(bytes)
    return { status: 'imported', packageId: archive.entry.id, version: archive.version, name: archive.entry.title, library: '我的资产库',
      ...(archive.diagnostics?.length ? { diagnostics: archive.diagnostics } : {}) }
  }
  /** The catalog manager owns deletion and enforces its real managed-directory boundary. */
  async delete(input: { packageId: string; version?: string; sourceId?: string }): Promise<LibraryDeleteResult> {
    if (!this.options.catalog.deletePackage) return { status: 'rejected', reason: '资产库删除入口尚未连接。' }
    const library = await this.options.catalog.load()
    const found = library.packages.filter(entry => entry.packageId === input.packageId && entry.removable === true
      && (!input.version || entry.version === input.version) && (!input.sourceId || entry.sourceId === input.sourceId))
      .sort((left, right) => newer(right, left))[0]
    if (!found) return { status: 'rejected', reason: '我的资产库中没有可删除的指定条目版本；其他目录和工程中的实例保留，请刷新资产库。' }
    await this.options.catalog.deletePackage(found.sourceId, found.packageId, found.version)
    return { status: 'deleted', packageId: found.packageId, version: found.version, name: found.name, library: '我的资产库' }
  }
}
