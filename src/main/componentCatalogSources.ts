import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { BUILT_IN_COMPONENT_CATALOG_DIRECTORY, trustForManagedCatalogDigest } from '../shared/builtInComponentCatalog'
import type { AvailableHtmlComponent, ComponentCatalogIssue, ComponentCatalogTrust } from '../shared/componentCatalog'
import { ComponentCatalogScanError, createBuiltInCatalogSource, scanComponentCatalogDirectory, type ScannedComponentCatalogSource } from './componentCatalogScanner'
import type { ComponentLibraryEntry } from '../shared/contracts/component-platform/library'
import type { ComponentDefinition, JsonValue } from '../shared/contracts/component-platform/project'
import { TEXT_DEFINITION, FORMULA_DEFINITION } from '../components/text/adapters'
import { createTextComponentData, createFormulaComponentData } from '../components/text/data'
import { SHAPE_DEFINITION } from '../components/shape/authoring'
import { defaultShapeData } from '../components/shape/data'
import { TABLE_DEFINITION } from '../components/table/adapters'
import { createTableData } from '../components/table/data'
import { CHART_DEFINITION, createChartData } from '../components/chart'
import { MANAGED_COMPONENT_LIBRARY_DIRECTORY, scanHtmlComponents } from './htmlComponentLibrary'

/** Directories the user added in the component library panel (under userData). */
export const COMPONENT_CATALOG_SOURCES_FILE = 'component-catalog-sources.json'
export const configuredSourcesSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({
    path: z.string().min(1).max(32_767),
    trust: z.enum(['trusted', 'prompt']),
  }).strict()).max(100),
}).strict()
export type ConfiguredCatalogSource = z.infer<typeof configuredSourcesSchema>['sources'][number]

export async function readConfiguredCatalogSources(userData: string): Promise<ConfiguredCatalogSource[]> {
  try {
    const text = await fs.readFile(path.join(userData, COMPONENT_CATALOG_SOURCES_FILE), 'utf8')
    const parsed = configuredSourcesSchema.safeParse(JSON.parse(text) as unknown)
    return parsed.success ? parsed.data.sources : []
  } catch {
    return []
  }
}

export function canonicalCatalogPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

/** The managed library (“我的资产库”) that saved HTML components go to. */
export const managedComponentLibrary = (userData: string) => path.join(userData, MANAGED_COMPONENT_LIBRARY_DIRECTORY)

export function builtInComponentLibraryEntries(): ComponentLibraryEntry[] {
  const entry = (definition: ComponentDefinition, data: unknown, width: number, height: number): ComponentLibraryEntry => ({
    schemaVersion: 1, id: definition.id, title: definition.title ?? definition.id,
    definitions: { [definition.id]: structuredClone(definition) },
    example: { rootIds: ['example'], instances: { example: { id: 'example', definitionId: definition.id,
      data: JSON.parse(JSON.stringify(data)) as JsonValue, frame: { width, height, transform: [1, 0, 0, 1, 40, 40] } } } },
    assets: {}, resources: { assets: {}, components: {} },
  })
  return [entry(TEXT_DEFINITION, createTextComponentData('输入文字'), 400, 100),
    entry(FORMULA_DEFINITION, createFormulaComponentData('formula', 'E=mc^2'), 300, 100),
    entry(SHAPE_DEFINITION, defaultShapeData(), 260, 160), entry(TABLE_DEFINITION, createTableData(), 600, 160),
    entry(CHART_DEFINITION, createChartData(), 600, 400)]
}

/** Built-ins always come from the application. External directories and the managed library are additive. */
export async function defaultComponentCatalogSources(
  appRoot: string,
  externalDirectory = process.env.COURSEWARE_COMPONENTS_DIR,
  managedLibrary?: string,
): Promise<Array<{ path: string; trust: ComponentCatalogTrust }>> {
  const builtInRoot = path.resolve(appRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY)
  let trust: ComponentCatalogTrust = 'prompt'
  try {
    const bytes = await fs.readFile(path.join(builtInRoot, 'catalog.json'))
    trust = trustForManagedCatalogDigest(createHash('sha256').update(bytes).digest('hex'))
  } catch {
    // Keep the source so the scanner reports a missing built-in library.
  }
  const sources = [{ path: builtInRoot, trust }]
  for (const [directory, sourceTrust] of [[externalDirectory, 'prompt'], [managedLibrary, 'trusted']] as const) {
    if (!directory) continue
    const root = path.resolve(directory)
    if (canonicalCatalogPath(root) === canonicalCatalogPath(builtInRoot)) continue
    try {
      if ((await fs.stat(root)).isDirectory()) sources.push({ path: root, trust: sourceTrust })
    } catch { /* An unavailable optional source does not hide built-ins. */ }
  }
  return sources
}

export interface ScannedCatalogSource extends ScannedComponentCatalogSource {
  htmlComponents: AvailableHtmlComponent[]
}

/** One directory: its `.h5component` packages and its HTML components. */
export async function scanCatalogSource(rootPath: string, trust: ComponentCatalogTrust, managedLibrary: string): Promise<ScannedCatalogSource> {
  const scanned = await scanComponentCatalogDirectory(rootPath, trust)
  const html = await scanHtmlComponents(scanned.rootPath, scanned.source, canonicalCatalogPath(scanned.rootPath) === canonicalCatalogPath(managedLibrary))
  const removable = canonicalCatalogPath(scanned.rootPath) === canonicalCatalogPath(managedLibrary)
  return { ...scanned, packages: scanned.packages.map(entry => ({ ...entry, removable })), issues: [...scanned.issues, ...html.issues], htmlComponents: html.entries }
}

/** Every catalog source the component library panel shows, scanned without touching any shared state. */
export async function scanComponentCatalogSources(appRoot: string, userData: string): Promise<{
  sources: Map<string, ScannedCatalogSource>; issues: ComponentCatalogIssue[]
}> {
  const managed = managedComponentLibrary(userData)
  const byPath = new Map<string, { path: string; trust: ComponentCatalogTrust }>()
  for (const source of await defaultComponentCatalogSources(appRoot, undefined, managed)) byPath.set(canonicalCatalogPath(source.path), source)
  for (const source of await readConfiguredCatalogSources(userData)) {
    const key = canonicalCatalogPath(source.path)
    if (byPath.get(key)?.trust !== 'built-in') byPath.set(key, source)
  }
  const sources = new Map<string, ScannedCatalogSource>(), issues: ComponentCatalogIssue[] = []
  const builtins = createBuiltInCatalogSource(appRoot, builtInComponentLibraryEntries())
  sources.set(builtins.source.sourceId, { ...builtins, htmlComponents: [] })
  for (const source of byPath.values()) {
    if (canonicalCatalogPath(source.path) === canonicalCatalogPath(path.join(appRoot, BUILT_IN_COMPONENT_CATALOG_DIRECTORY))) continue
    try {
      const scanned = await scanCatalogSource(source.path, source.trust, managed)
      sources.set(scanned.source.sourceId, scanned)
    } catch (error) {
      issues.push({
        sourceLabel: path.basename(source.path) || '组件目录',
        code: error instanceof ComponentCatalogScanError ? error.code : 'catalog-unreadable',
        message: error instanceof Error ? error.message : '组件目录扫描失败。',
      })
    }
  }
  if (!byPath.has(canonicalCatalogPath(managed))) {
    try { const source = await scanCatalogSource(managed, 'trusted', managed); sources.set(source.source.sourceId, source) } catch { /* Empty managed library has no files yet. */ }
  }
  return { sources, issues }
}
