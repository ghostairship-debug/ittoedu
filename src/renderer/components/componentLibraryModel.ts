import type { AvailableComponentCatalogPackage, AvailableHtmlComponent } from '../../shared/componentCatalog'
import { componentContainerBuiltinKey, componentDefinitionBuiltinKey, type ComponentDefinition, type CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { BUILTIN_SOURCE_ENTRIES } from '../../components/builtin-source/entries'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import { BUILTIN_DISCOVERY_ENTRIES, createCatalogDiscoveryEntry, createHtmlDiscoveryEntry, createWorkAssetDiscoveryEntry, searchDiscoveryEntries, type ComponentDiscoveryEntry } from '../../shared/componentDiscovery'
import { builtInWorkAssetMetadata, type BuiltInWorkAssetMetadata } from '../../core/components/library/workAssets'
import { planComponentLibraryUsage } from '../../core/components/library/usage'
import {
  compareSemanticVersions,
} from './componentCatalogStatus'

export const GENERAL_COMPONENT_SUBJECT = '通用组件'

export interface ComponentLibraryCardEntry extends ComponentDiscoveryEntry {
  selectionId: string
  sourceId: string
  sourceLabel: string
  catalogEntry?: AvailableComponentCatalogPackage
  workAsset?: BuiltInWorkAssetMetadata
  teacherController?: boolean
}

/** One read projection of the existing owners; resources remain lazy until adding. */
export function createComponentLibraryCards(packages: readonly AvailableComponentCatalogPackage[]): ComponentLibraryCardEntry[] {
  const cards = new Map<string, ComponentLibraryCardEntry>()
  for (const asset of builtInWorkAssetMetadata()) cards.set(asset.id, { ...createWorkAssetDiscoveryEntry(asset),
    selectionId: `builtin:${asset.id}`, sourceId: 'built-in', sourceLabel: '内置', workAsset: asset })
  const teacher = BUILTIN_DISCOVERY_ENTRIES.find(entry => entry.id === 'navigation')!
  cards.set(teacher.id, { ...teacher, selectionId: 'builtin:navigation', sourceId: 'built-in', sourceLabel: '内置', teacherController: true })
  for (const entry of selectCurrentCatalogPackages(packages)) cards.set(entry.packageId, { ...createCatalogDiscoveryEntry(entry),
    // Explicit human selection is the existing manual import path. AI trust facts remain unchanged.
    availability: { available: entry.quality !== 'deprecated', ...(entry.quality === 'deprecated' ? { reason: '此版本已弃用。' } : {}) },
    selectionId: entry.packageId, sourceId: entry.sourceKind === 'built-in' || entry.sourceTrust === 'built-in' ? 'built-in' : entry.sourceId,
    sourceLabel: entry.sourceKind === 'built-in' || entry.sourceTrust === 'built-in' ? '内置' : entry.sourceKind === 'personal' ? '我的资产库' : entry.sourceLabel, catalogEntry: entry })
  return [...cards.values()]
}

export interface ComponentLibraryBrowseFilters { query: string; category: string; source: string; subject: string; schoolStage: string }
export function filterComponentLibraryCards(cards: readonly ComponentLibraryCardEntry[], filters: ComponentLibraryBrowseFilters) {
  const filtered = cards.filter(entry => {
    if (filters.category && entry.library?.category !== filters.category) return false
    if (filters.source && entry.sourceId !== filters.source) return false
    const subjects = entry.library?.subjects ?? []
    const stages = entry.library?.schoolStages ?? []
    if (filters.subject && subjects.length && !subjects.some(value => normalizeSubject(value) === GENERAL_COMPONENT_SUBJECT || value === filters.subject)) return false
    if (filters.schoolStage && stages.length && !stages.some(value => ['通用', '不限', '不限学段'].includes(value) || value === filters.schoolStage)) return false
    return true
  })
  return searchDiscoveryEntries(filtered, filters.query)
}

export function componentLibraryCardAvailability(entry: ComponentLibraryCardEntry, project?: CourseProjectV10 | null, navigationTargetId?: string | null) {
  if (!entry.availability.available || entry.usage?.kind !== 'transition') return entry.availability
  if (!project || !navigationTargetId) return { available: false, reason: '请先返回编辑器，选中含导航动作的控件或规则。' }
  try {
    planComponentLibraryUsage(project, entry, { container: { kind: 'instance', instanceId: navigationTargetId }, index: 0,
      targetBindings: { navigation: navigationTargetId } })
    return { available: true }
  } catch (error) { return { available: false, reason: error instanceof Error ? error.message : String(error) } }
}

export function componentLibraryPlacementLabel(entry: ComponentLibraryCardEntry, local = false) {
  if (entry.teacherController) return '整课全局层 · 已有时复用'
  if (entry.usage?.kind === 'transition') return '应用到所选导航动作 · 每次选一种'
  if (entry.usage?.kind === 'background') return '当前作用范围的背景层'
  if (entry.workAsset?.kind === 'page' || entry.workAsset?.kind === 'structure') return local ? '嵌入当前容器' : '新增页面 · 保留内部结构'
  return '当前编辑容器'
}

/** Built-in work assets use the same insertion service and appear in the existing library. */
export function filterBuiltInWorkAssets<T extends Pick<ComponentLibraryEntry, 'id' | 'title' | 'usage'>>(entries: readonly T[], query: string): T[] {
  return searchDiscoveryEntries(entries.map(entry => ({ ...createWorkAssetDiscoveryEntry(entry), entry })), query).map(value => value.entry)
}

const internalImplementationKeys = new Set([...Object.keys(BUILTIN_SOURCE_ENTRIES),
  ...(['slide', 'flow', 'spatial'] as const).map(componentContainerBuiltinKey)])
/** Engine definitions keep their editing actions; authored packages and custom definitions belong in this panel. */
export function selectProjectLibraryDefinitions(definitions: Readonly<Record<string, ComponentDefinition>>): ComponentDefinition[] {
  return Object.values(definitions).filter(definition => {
    const key = componentDefinitionBuiltinKey(definition)
    return definition.implementation.kind !== 'builtin' || !key || !internalImplementationKeys.has(key)
  }).sort((left, right) => (left.title ?? left.id).localeCompare(right.title ?? right.id, 'zh-CN'))
}

const RECOMMENDED_SUBJECT_ORDER = [
  GENERAL_COMPONENT_SUBJECT,
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
] as const

const GENERAL_SUBJECT_ALIASES = new Set([
  '',
  '通用',
  GENERAL_COMPONENT_SUBJECT,
  'general',
  'common',
])

function normalizeSubject(subject: string): string {
  const normalized = subject.trim()
  return GENERAL_SUBJECT_ALIASES.has(normalized.toLocaleLowerCase())
    ? GENERAL_COMPONENT_SUBJECT
    : normalized
}

export function componentLibrarySubjects(
  entry: Pick<AvailableComponentCatalogPackage, 'subject'>,
): string[] {
  const values = entry.subject
    .map(normalizeSubject)
    .filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : [GENERAL_COMPONENT_SUBJECT]
}

export function collectComponentLibrarySubjects(
  entries: ReadonlyArray<AvailableComponentCatalogPackage>,
): string[] {
  const subjects = new Set(entries.flatMap(componentLibrarySubjects))
  const order = new Map<string, number>(
    RECOMMENDED_SUBJECT_ORDER.map((subject, index) => [subject, index]),
  )
  return [...subjects].sort((left, right) => {
    const leftOrder = order.get(left) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(right) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.localeCompare(right, 'zh-CN')
  })
}

function sourceTrustRank(entry: AvailableComponentCatalogPackage): number {
  switch (entry.sourceTrust) {
    case 'built-in': return 3
    case 'trusted': return 2
    case 'prompt': return 1
  }
}

/**
 * The library presents one current card per package ID. Older versions and
 * duplicate source records stay available to catalog diagnostics, but do not
 * create duplicate author-facing choices.
 */
export function selectCurrentCatalogPackages(
  entries: ReadonlyArray<AvailableComponentCatalogPackage>,
): AvailableComponentCatalogPackage[] {
  const selected = new Map<string, AvailableComponentCatalogPackage>()
  entries.forEach((entry) => {
    const current = selected.get(entry.packageId)
    if (!current) {
      selected.set(entry.packageId, entry)
      return
    }
    const versionComparison = compareSemanticVersions(entry.version, current.version)
    if (
      versionComparison > 0 ||
      (versionComparison === 0 && sourceTrustRank(entry) > sourceTrustRank(current))
    ) {
      selected.set(entry.packageId, entry)
    }
  })
  return [...selected.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN') ||
    left.packageId.localeCompare(right.packageId, 'en-US'),
  )
}

/** Flow's insert menu offers one current built-in package per ID until it is embedded. */
export function selectAvailableBuiltInCatalogPackages(
  entries: ReadonlyArray<AvailableComponentCatalogPackage>,
  components: Readonly<Record<string, ComponentDefinition>>,
): AvailableComponentCatalogPackage[] {
  return selectCurrentCatalogPackages(entries.filter((entry) => entry.sourceTrust === 'built-in'))
    .filter((entry) => componentCatalogInstallStatus(entry, projectLibraryDefinition(components,entry.packageId)) === 'available')
}

export interface ComponentLibraryFilters {
  query: string
  subject: string | null
  schoolStage: string
  category: string
}

export interface CatalogBatchJoinPlan {
  entries: AvailableComponentCatalogPackage[]
  requiresTrustConfirmation: boolean
}

/** Trust is evaluated only after already embedded package IDs are removed. */
export function planCatalogBatchJoin(
  entries: ReadonlyArray<AvailableComponentCatalogPackage>,
  components: Readonly<Record<string, ComponentDefinition>>,
): CatalogBatchJoinPlan {
  const pending = entries.filter((entry) =>
    componentCatalogInstallStatus(entry, projectLibraryDefinition(components,entry.packageId)) === 'available',
  )
  return {
    entries: pending,
    requiresTrustConfirmation: pending.some((entry) => entry.sourceTrust === 'prompt'),
  }
}

export function filterComponentLibraryPackages(
  entries: ReadonlyArray<AvailableComponentCatalogPackage>,
  filters: ComponentLibraryFilters,
): AvailableComponentCatalogPackage[] {
  const filtered = entries.filter((entry) => {
    if (
      filters.subject &&
      !componentLibrarySubjects(entry).includes(filters.subject)
    ) return false
    if (
      filters.schoolStage &&
      !entry.schoolStage.includes(filters.schoolStage)
    ) return false
    if (filters.category && entry.category !== filters.category) return false
    return true
  })
  return searchDiscoveryEntries(filtered.map(entry => ({ ...createCatalogDiscoveryEntry(entry), entry })), filters.query).map(value => value.entry)
}

/** One card per HTML component entry (packageId within its directory), the newest saved version. */
export function selectCurrentHtmlComponents(
  entries: ReadonlyArray<AvailableHtmlComponent>,
): AvailableHtmlComponent[] {
  const selected = new Map<string, AvailableHtmlComponent>()
  entries.forEach((entry) => {
    const key = `${entry.sourceId}\u0000${entry.packageId}`
    const current = selected.get(key)
    if (!current || compareSemanticVersions(entry.version, current.version) > 0) selected.set(key, entry)
  })
  return [...selected.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

export function filterHtmlComponents(
  entries: ReadonlyArray<AvailableHtmlComponent>,
  query: string,
): AvailableHtmlComponent[] {
  return searchDiscoveryEntries(entries.map(entry => ({ ...createHtmlDiscoveryEntry(entry), entry })), query).map(value => value.entry)
}

/** Catalog byte identity is metadata; author availability follows the formal definition version. */
export function componentCatalogInstallStatus(entry: Pick<AvailableComponentCatalogPackage, 'version'>, definition?: ComponentDefinition): 'available' | 'embedded' | 'update-available' | 'embedded-newer' {
  if (!definition) return 'available'
  const difference = compareSemanticVersions(entry.version, definition.library?.version ?? definition.version ?? '1.0.0')
  return difference > 0 ? 'update-available' : difference < 0 ? 'embedded-newer' : 'embedded'
}
export function projectLibraryDefinition(definitions:Readonly<Record<string,ComponentDefinition>>,packageId:string):ComponentDefinition|undefined {
  const candidates=Object.values(definitions).filter(value=>value.library?.packageId===packageId)
  return candidates.sort((a,b)=>compareSemanticVersions(b.library?.version ?? b.version ?? '1.0.0',a.library?.version ?? a.version ?? '1.0.0'))[0]
    ?? (Object.hasOwn(definitions,packageId) && (!definitions[packageId].library || definitions[packageId].library?.packageId===packageId) ? definitions[packageId]:undefined)
}
