import type { AvailableComponentCatalogPackage, AvailableHtmlComponent, ComponentCatalogTrust } from '../../../shared/componentCatalog'
import { scanComponentCatalogSources } from '../../componentCatalogSources'
import { compareVersions, readHtmlComponent, saveHtmlComponent, type SaveHtmlComponentInput } from '../../htmlComponentLibrary'

export interface ComponentLibrarySnapshot {
  packages: readonly AvailableComponentCatalogPackage[]
  htmlComponents: readonly AvailableHtmlComponent[]
  /** sourceId → catalog directory, to read an entry's files. */
  roots: ReadonlyMap<string, string>
  /** Unreadable directories, packages and entries. */
  issues: number
}

/** 资产库即现有组件库的全部目录：内置、环境变量目录、我的资产库和用户添加的目录；只读扫描。 */
export async function readComponentLibrary(appRoot: string, userData: string): Promise<ComponentLibrarySnapshot> {
  const scan = await scanComponentCatalogSources(appRoot, userData)
  const sources = [...scan.sources.values()]
  return { packages: sources.flatMap(source => source.packages), htmlComponents: sources.flatMap(source => source.htmlComponents),
    roots: new Map(sources.map(source => [source.source.sourceId, source.rootPath])),
    issues: scan.issues.length + sources.reduce((count, source) => count + source.issues.length, 0) }
}

/** 给模型看的资产候选；packageId 与 version 是资产库自身的身份。 */
export interface AssetCandidateView {
  /** html-component 可用 asset.use 填入 components/<名称>.html；component-package 由教师在组件库面板插入。 */
  kind: 'html-component' | 'component-package'
  packageId: string
  version: string
  name: string
  description: string
  category?: string
  subject?: readonly string[]
  schoolStage?: readonly string[]
  tags?: readonly string[]
  quality?: AvailableComponentCatalogPackage['quality']
  sourceCourse?: string
  savedAt?: string
  /** 所在组件目录与信任状态；prompt 目录的条目须教师先确认信任。 */
  source: string
  trust: ComponentCatalogTrust
}

export interface AssetSearchResult {
  status: 'results'
  query: string
  candidates: readonly AssetCandidateView[]
  /** 资产库条目（每个只计当前版本）的总数。 */
  libraryEntries: number
  /** 无法读取的目录或条目数。 */
  unreadable?: number
  note?: string
  hint?: string
}

const trustRank: Record<ComponentCatalogTrust, number> = { 'built-in': 3, trusted: 2, prompt: 1 }
type Entry = (AvailableComponentCatalogPackage & { kind: 'component-package' }) | (AvailableHtmlComponent & { kind: 'html-component' })
const newer = (left: Entry, right: Entry) => compareVersions(left.version, right.version) || trustRank[left.sourceTrust] - trustRank[right.sourceTrust]

/** 按名称、标签、分类、学科学段与说明检索两种条目；每个条目只取当前最新版本，弃用的组件包不列出。 */
export function searchComponentLibrary(snapshot: ComponentLibrarySnapshot, query: string, limit: number): AssetSearchResult {
  const current = new Map<string, Entry>()
  const entries: Entry[] = [...snapshot.packages.map(entry => ({ ...entry, kind: 'component-package' as const })),
    ...snapshot.htmlComponents.map(entry => ({ ...entry, kind: 'html-component' as const }))]
  for (const entry of entries) {
    const key = `${entry.kind}\u0000${entry.packageId}`, existing = current.get(key)
    if (!existing || newer(entry, existing) > 0) current.set(key, entry)
  }
  const terms = [...new Set(query.toLowerCase().split(/[\s,，、;；/]+/).filter(Boolean))]
  const scored = [...current.values()].filter(entry => entry.kind === 'html-component' || entry.quality !== 'deprecated').flatMap(entry => {
    const category = entry.kind === 'component-package' ? entry.category ?? '' : ''
    const fields: [readonly string[], number][] = [[[entry.name], 6], [entry.tags, 3], [[category, ...entry.subject, ...entry.schoolStage], 2],
      [[entry.description], 2], [[entry.packageId], 1]]
    let matched = 0, score = 0
    for (const term of terms) {
      const weight = Math.max(0, ...fields.map(([values, value]) => values.some(text => text.toLowerCase().includes(term)) ? value : 0))
      if (weight) { matched++; score += weight }
    }
    return matched ? [{ entry, matched, score }] : []
  }).sort((left, right) => right.matched - left.matched || right.score - left.score || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
  const candidates = scored.slice(0, limit).map(({ entry }): AssetCandidateView => ({ kind: entry.kind, packageId: entry.packageId,
    version: entry.version, name: entry.name, description: entry.description,
    ...(entry.kind === 'component-package' && entry.category ? { category: entry.category } : {}),
    ...(entry.subject.length ? { subject: entry.subject } : {}), ...(entry.schoolStage.length ? { schoolStage: entry.schoolStage } : {}),
    ...(entry.tags.length ? { tags: entry.tags } : {}),
    ...(entry.kind === 'component-package' ? { quality: entry.quality } : {}),
    ...(entry.kind === 'html-component' && entry.sourceCourse ? { sourceCourse: entry.sourceCourse } : {}),
    ...(entry.kind === 'html-component' && entry.savedAt ? { savedAt: entry.savedAt } : {}),
    source: entry.sourceLabel, trust: entry.sourceTrust }))
  return { status: 'results', query, candidates, libraryEntries: current.size, ...(snapshot.issues ? { unreadable: snapshot.issues } : {}),
    ...(candidates.some(item => item.kind === 'component-package')
      ? { note: 'component-package 是组件包，不能填入 components/<名称>.html 占位，需要时请教师在组件库面板插入；html-component 可用 asset.use 填入占位。' } : {}),
    ...(candidates.length ? {} : { hint: '资产库中没有匹配的条目；可换用更通用的词，或按需新建组件' }) }
}

export type LibraryComponentFiles =
  | { status: 'ready'; packageId: string; version: string; name: string; html: string; assets: { path: string; mimeType: string; bytes: Uint8Array }[] }
  | { status: 'rejected' | 'failed'; reason: string }

/** 资产库检索、读取与存入；存入只写“我的资产库”。 */
export class AssetLibraryService {
  constructor(private readonly options: { load: () => Promise<ComponentLibrarySnapshot>; managedLibrary: string; now?: () => Date }) {}

  async search(input: { query: string; limit?: number }): Promise<AssetSearchResult> {
    return searchComponentLibrary(await this.options.load(), input.query.trim(), input.limit ?? 8)
  }

  /** The newest (or the named) version of an HTML component; packages and unconfirmed directories are not used for placeholders. */
  async read(input: { packageId: string; version?: string }): Promise<LibraryComponentFiles> {
    const library = await this.options.load()
    const found = library.htmlComponents.filter(item => item.packageId === input.packageId && (!input.version || item.version === input.version))
      .sort((left, right) => compareVersions(right.version, left.version))[0]
    if (!found) return { status: 'rejected', reason: library.packages.some(item => item.packageId === input.packageId)
      ? '这是组件包（Component API 4），不能填入 components/<名称>.html 占位；需要时请教师在组件库面板插入'
      : `资产库中没有 ${input.packageId}${input.version ? `@${input.version}` : ''}；请先用 asset.search 检索` }
    if (found.sourceTrust === 'prompt')
      return { status: 'rejected', reason: `“${found.name}”所在的组件目录尚未确认信任；请教师在组件库面板确认信任后再使用` }
    const root = library.roots.get(found.sourceId)
    if (!root) return { status: 'failed', reason: '组件目录已失效，请重新检索' }
    try {
      const files = await readHtmlComponent(root, found.entry)
      return { status: 'ready', packageId: found.packageId, version: found.version, name: found.name, html: files.html, assets: files.assets }
    } catch (error) {
      return { status: 'failed', reason: `HTML 组件无法读取：${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  async save(input: Omit<SaveHtmlComponentInput, 'now'>): Promise<{ status: 'saved'; packageId: string; version: string; name: string; library: string }> {
    const saved = await saveHtmlComponent(this.options.managedLibrary, { ...input, now: this.options.now?.() ?? new Date() })
    return { status: 'saved', packageId: saved.packageId, version: saved.version, name: input.name, library: '我的资产库' }
  }
}
