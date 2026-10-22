import type { AvailableComponentCatalogPackage, AvailableHtmlComponent } from '../../shared/componentCatalog'
import { componentDefinitionBuiltinKey, type ComponentDefinition } from '../../shared/contracts/component-platform/project'
import { BUILTIN_SOURCE_ENTRIES } from '../../components/builtin-source/entries'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import {
  compareSemanticVersions,
} from './componentCatalogStatus'

export const GENERAL_COMPONENT_SUBJECT = '通用组件'

/** Built-in work assets use the same insertion service and appear in the existing library. */
export function filterBuiltInWorkAssets<T extends Pick<ComponentLibraryEntry, 'id' | 'title' | 'usage'>>(entries: readonly T[], query: string): T[] {
  const term = query.trim().toLocaleLowerCase()
  return entries.filter(entry => !term || [entry.id, entry.title, entry.usage?.kind, entry.usage?.description]
    .filter(Boolean).join(' ').toLocaleLowerCase().includes(term))
}

const internalImplementationKeys = new Set(Object.keys(BUILTIN_SOURCE_ENTRIES))
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
  const query = filters.query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (
      filters.subject &&
      !componentLibrarySubjects(entry).includes(filters.subject)
    ) return false
    if (
      filters.schoolStage &&
      !entry.schoolStage.includes(filters.schoolStage)
    ) return false
    if (filters.category && entry.category !== filters.category) return false
    if (!query) return true
    return [
      entry.name,
      entry.packageId,
      entry.description,
      entry.category ?? '',
      ...entry.subject,
      ...entry.schoolStage,
      ...entry.tags,
    ].join(' ').toLocaleLowerCase().includes(query)
  })
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
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...entries]
  return entries.filter((entry) => [entry.name, entry.description, entry.sourceCourse ?? '', ...entry.subject, ...entry.schoolStage, ...entry.tags]
    .join(' ').toLocaleLowerCase().includes(normalized))
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
