import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { AvailableComponentCatalogPackage, ComponentCatalogTrust } from '../../../shared/componentCatalog'
import { defaultComponentCatalogSources } from '../../componentCatalogSources'
import { scanComponentCatalogDirectory } from '../../componentCatalogScanner'

/** 与组件库面板同一份用户目录配置（componentCatalogManager 的 component-catalog-sources.json）。 */
const configuredSourcesSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({ path: z.string().min(1).max(32_767), trust: z.enum(['trusted', 'prompt']) }).strict()).max(100),
}).strict()

export interface ComponentLibrarySnapshot { packages: readonly AvailableComponentCatalogPackage[]; issues: number }

/** 资产库即现有组件库：内置目录、环境变量目录和用户添加的目录。只读扫描，不改动组件库面板的目录状态。 */
export async function readComponentLibrary(appRoot: string, userData: string): Promise<ComponentLibrarySnapshot> {
  const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
  const sources = new Map<string, { path: string; trust: ComponentCatalogTrust }>()
  for (const source of await defaultComponentCatalogSources(appRoot)) sources.set(key(source.path), source)
  try {
    const parsed = configuredSourcesSchema.safeParse(JSON.parse(await fs.readFile(path.join(userData, 'component-catalog-sources.json'), 'utf8')))
    if (parsed.success) for (const source of parsed.data.sources)
      if (sources.get(key(source.path))?.trust !== 'built-in') sources.set(key(source.path), source)
  } catch { /* 用户尚未添加组件目录。 */ }
  const packages: AvailableComponentCatalogPackage[] = []
  let issues = 0
  for (const source of sources.values()) {
    try {
      const scanned = await scanComponentCatalogDirectory(source.path, source.trust)
      packages.push(...scanned.packages)
      issues += scanned.issues.length
    } catch { issues++ }
  }
  return { packages, issues }
}

/** 给模型看的资产候选；packageId 与 version 是组件库自身的身份。 */
export interface AssetCandidateView {
  kind: 'component'
  packageId: string
  version: string
  name: string
  description: string
  category?: string
  subject?: readonly string[]
  schoolStage?: readonly string[]
  tags?: readonly string[]
  quality: AvailableComponentCatalogPackage['quality']
  /** 所在组件目录与信任状态；prompt 目录的组件加入课件前须教师确认。 */
  source: string
  trust: ComponentCatalogTrust
  scopes: readonly string[]
}

export interface AssetSearchResult {
  status: 'results'
  query: string
  candidates: readonly AssetCandidateView[]
  /** 资产库中组件（每个只计当前版本）的总数。 */
  libraryComponents: number
  /** 无法读取的目录或组件数。 */
  unreadable?: number
  hint?: string
}

const trustRank: Record<ComponentCatalogTrust, number> = { 'built-in': 3, trusted: 2, prompt: 1 }
const newer = (left: AvailableComponentCatalogPackage, right: AvailableComponentCatalogPackage) =>
  left.version.localeCompare(right.version, 'en-US', { numeric: true }) || trustRank[left.sourceTrust] - trustRank[right.sourceTrust]

/** 按名称、标签、分类、学科学段与说明检索；每个组件只取当前最新版本，弃用的不列出。 */
export function searchComponentLibrary(snapshot: ComponentLibrarySnapshot, query: string, limit: number): AssetSearchResult {
  const current = new Map<string, AvailableComponentCatalogPackage>()
  for (const entry of snapshot.packages) {
    const existing = current.get(entry.packageId)
    if (!existing || newer(entry, existing) > 0) current.set(entry.packageId, entry)
  }
  const terms = [...new Set(query.toLowerCase().split(/[\s,，、;；/]+/).filter(Boolean))]
  const scored = [...current.values()].filter(entry => entry.quality !== 'deprecated').flatMap(entry => {
    const fields: [readonly string[], number][] = [[[entry.name], 6], [entry.tags, 3], [[entry.category ?? '', ...entry.subject, ...entry.schoolStage], 2],
      [[entry.description], 2], [[entry.packageId], 1]]
    let matched = 0, score = 0
    for (const term of terms) {
      const weight = Math.max(0, ...fields.map(([values, value]) => values.some(text => text.toLowerCase().includes(term)) ? value : 0))
      if (weight) { matched++; score += weight }
    }
    return matched ? [{ entry, matched, score }] : []
  }).sort((left, right) => right.matched - left.matched || right.score - left.score || left.entry.name.localeCompare(right.entry.name, 'zh-CN'))
  const candidates = scored.slice(0, limit).map(({ entry }): AssetCandidateView => ({ kind: 'component', packageId: entry.packageId,
    version: entry.version, name: entry.name, description: entry.description, ...(entry.category ? { category: entry.category } : {}),
    ...(entry.subject.length ? { subject: entry.subject } : {}), ...(entry.schoolStage.length ? { schoolStage: entry.schoolStage } : {}),
    ...(entry.tags.length ? { tags: entry.tags } : {}), quality: entry.quality, source: entry.sourceLabel, trust: entry.sourceTrust,
    scopes: entry.supportedScopes }))
  return { status: 'results', query, candidates, libraryComponents: current.size, ...(snapshot.issues ? { unreadable: snapshot.issues } : {}),
    ...(candidates.length ? {} : { hint: '资产库中没有匹配的组件；可换用更通用的词，或按需新建组件' }) }
}
