import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  HTML_COMPONENT_FORMAT,
  htmlComponentManifestSchema,
  type AvailableHtmlComponent,
  type ComponentCatalogIssue,
  type ComponentCatalogSourceSnapshot,
  type HtmlComponentManifest,
} from '../shared/componentCatalog'
import { courseComponentNameKey } from '../shared/composition/projectReferences'
import { readCatalogFile, resolveCatalogFilePath } from './componentCatalogScanner'

/** `html-components/<entry>/` in any component catalog directory. */
export const HTML_COMPONENTS_DIRECTORY = 'html-components'
/** The managed library under userData (“我的资产库”), where saved HTML components go. */
export const MANAGED_COMPONENT_LIBRARY_DIRECTORY = 'component-library'
const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,200}$/

const reason = (error: unknown) => error instanceof Error && error.message ? error.message : '未知错误'
/** Numeric-aware version order, enough for picking the newest saved entry. */
export const compareVersions = (left: string, right: string) => left.localeCompare(right, 'en-US', { numeric: true })

/** Manifests of the HTML components in one catalog directory; unreadable entries become issues. */
export async function scanHtmlComponents(rootPath: string, source: Pick<ComponentCatalogSourceSnapshot, 'sourceId' | 'label' | 'trust'>,
  removable: boolean): Promise<{ entries: AvailableHtmlComponent[]; issues: ComponentCatalogIssue[] }> {
  let names: string[]
  try {
    names = (await fs.readdir(path.join(rootPath, HTML_COMPONENTS_DIRECTORY), { withFileTypes: true }))
      .filter(item => item.isDirectory() && ENTRY_NAME.test(item.name)).map(item => item.name).sort()
  } catch { return { entries: [], issues: [] } }
  const entries: AvailableHtmlComponent[] = [], issues: ComponentCatalogIssue[] = []
  for (const entry of names) {
    try {
      const manifest = await readManifest(rootPath, entry)
      await resolveCatalogFilePath(rootPath, `${HTML_COMPONENTS_DIRECTORY}/${entry}/component.html`)
      entries.push({ ...manifest, sourceId: source.sourceId, sourceLabel: source.label, sourceTrust: source.trust, entry, removable })
    } catch (error) {
      issues.push({ sourceId: source.sourceId, sourceLabel: source.label, packageId: entry, code: 'package-unreadable',
        message: `HTML 组件 ${entry} 无法读取：${reason(error)}。` })
    }
  }
  return { entries, issues }
}

async function readManifest(rootPath: string, entry: string): Promise<HtmlComponentManifest> {
  const bytes = await readCatalogFile(await resolveCatalogFilePath(rootPath, `${HTML_COMPONENTS_DIRECTORY}/${entry}/component.json`))
  const parsed = htmlComponentManifestSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`component.json 校验失败：${first?.path.join('.') || 'manifest'} ${first?.message ?? '字段无效'}`)
  }
  return parsed.data
}

export interface HtmlComponentFiles {
  manifest: HtmlComponentManifest
  html: string
  assets: { path: string; mimeType: string; bytes: Uint8Array }[]
}

/** The text and asset files of one entry, read through the same in-root path checks as packages. */
export async function readHtmlComponent(rootPath: string, entry: string): Promise<HtmlComponentFiles> {
  if (!ENTRY_NAME.test(entry)) throw new Error('HTML 组件条目名无效')
  const manifest = await readManifest(rootPath, entry)
  const file = async (relative: string) => readCatalogFile(await resolveCatalogFilePath(rootPath, `${HTML_COMPONENTS_DIRECTORY}/${entry}/${relative}`))
  const html = new TextDecoder('utf-8', { fatal: true }).decode(await file('component.html'))
  const assets = []
  for (const asset of manifest.assets) assets.push({ ...asset, bytes: await file(asset.path) })
  return { manifest, html, assets }
}

export interface SaveHtmlComponentInput {
  name: string
  description?: string
  subject?: readonly string[]
  schoolStage?: readonly string[]
  tags?: readonly string[]
  sourceCourse?: string
  html: string
  assets: readonly { path: string; mimeType: string; bytes: Uint8Array }[]
  now?: Date
}

/**
 * Saves into the managed library. The same component name keeps its packageId and gets the next
 * patch version; files are written to a temporary directory first, so a scan never sees half an entry.
 */
export async function saveHtmlComponent(libraryRoot: string, input: SaveHtmlComponentInput): Promise<{ packageId: string; version: string; entry: string }> {
  await fs.mkdir(path.join(libraryRoot, HTML_COMPONENTS_DIRECTORY), { recursive: true })
  const catalog = path.join(libraryRoot, 'catalog.json')
  try { await fs.writeFile(catalog, `${JSON.stringify({ catalogVersion: 1, name: '我的资产库', packages: [] }, null, 2)}\n`, { flag: 'wx' }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const { entries } = await scanHtmlComponents(libraryRoot, { sourceId: 'managed', label: '我的资产库', trust: 'trusted' }, true)
  const key = courseComponentNameKey(input.name)
  const previous = entries.filter(item => courseComponentNameKey(item.name) === key)
    .sort((left, right) => compareVersions(right.version, left.version))[0]
  const packageId = previous?.packageId ?? `html-component.${randomUUID().slice(0, 8)}`
  const version = previous ? previous.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_all, major: string, minor: string, patch: string) =>
    `${major}.${minor}.${Number(patch) + 1}`) : '1.0.0'
  const manifest: HtmlComponentManifest = htmlComponentManifestSchema.parse({ format: HTML_COMPONENT_FORMAT, formatVersion: 1, packageId, version,
    name: input.name, description: input.description ?? '', subject: [...input.subject ?? []], schoolStage: [...input.schoolStage ?? []],
    tags: [...input.tags ?? []], ...(input.sourceCourse ? { sourceCourse: input.sourceCourse } : {}),
    savedAt: (input.now ?? new Date()).toISOString(), assets: input.assets.map(({ path: assetPath, mimeType }) => ({ path: assetPath, mimeType })) })
  const entry = `${packageId}@${version}`
  const staging = path.join(libraryRoot, HTML_COMPONENTS_DIRECTORY, `.saving-${randomUUID()}`)
  try {
    await fs.mkdir(staging)
    await fs.writeFile(path.join(staging, 'component.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await fs.writeFile(path.join(staging, 'component.html'), input.html)
    for (const asset of input.assets) {
      const target = path.join(staging, ...asset.path.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, asset.bytes)
    }
    await fs.rename(staging, path.join(libraryRoot, HTML_COMPONENTS_DIRECTORY, entry))
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true })
    throw error
  }
  return { packageId, version, entry }
}

/** Removes one entry of the managed library. */
export async function deleteHtmlComponent(libraryRoot: string, entry: string): Promise<void> {
  if (!ENTRY_NAME.test(entry)) throw new Error('HTML 组件条目名无效')
  const target = await resolveCatalogFilePath(libraryRoot, `${HTML_COMPONENTS_DIRECTORY}/${entry}`)
  await fs.rm(target, { recursive: true })
}
