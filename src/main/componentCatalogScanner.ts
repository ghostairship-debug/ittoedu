import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AvailableComponentCatalogPackage, ComponentCatalogIssue, ComponentCatalogPackage, ComponentCatalogPackageFile, ComponentCatalogSourceSnapshot, ComponentCatalogTrust } from '../shared/componentCatalog'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../core/components/library/archive'
import type { ComponentLibraryArchiveMetadata } from '../core/components/library/archive'
import type { ComponentLibraryEntry } from '../shared/contracts/component-platform/library'

export class ComponentCatalogScanError extends Error {
  constructor(readonly code: 'catalog-unreadable' | 'catalog-invalid', message: string, options?: ErrorOptions) { super(message, options); this.name = 'ComponentCatalogScanError' }
}
export interface ScannedComponentCatalogSource {
  source: ComponentCatalogSourceSnapshot
  rootPath: string
  packages: AvailableComponentCatalogPackage[]
  issues: ComponentCatalogIssue[]
  packageIndex: ReadonlyMap<string, ComponentCatalogPackage>
  memoryPackages?: ReadonlyMap<string, Uint8Array>
}
export const catalogPackageIdentity = (id: string, version: string) => `${id}@${version}`
export const catalogSourceId = (root: string) => `component-catalog:${createHash('sha256').update(path.resolve(root).toLocaleLowerCase('en-US')).digest('hex').slice(0, 24)}`
export async function resolveCatalogFilePath(root: string, relative: string): Promise<string> {
  const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(path.resolve(root, relative))])
  const relation = path.relative(realRoot, realFile)
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error(`目录路径越界：${relative}`)
  return realFile
}
export async function readCatalogFile(file: string): Promise<Uint8Array> {
  if (!(await fs.stat(file)).isFile()) throw new Error('路径不是文件')
  return Uint8Array.from(await fs.readFile(file))
}
export function libraryCatalogPackage(entry: ComponentLibraryEntry, version: string, packagePath: string, bytes: Uint8Array, metadata?: ComponentLibraryArchiveMetadata): ComponentCatalogPackage {
  return { packageId: entry.id, version, name: entry.title, description: metadata?.description ?? `可编辑组件 · ${entry.example.rootIds.length} 个根对象`,
    subject: [...(metadata?.subject ?? [])], schoolStage: [...(metadata?.schoolStage ?? [])], tags: [...(metadata?.tags ?? [])], packagePath, thumbnailPath: '', sha256: createHash('sha256').update(bytes).digest('hex'),
    componentSchemaVersion: 1, runtimeApiVersion: 5, renderMode: 'dom', supportedScopes: ['scene', 'global'],
    quality: 'experimental', maintainer: '本地组件作者', verifiedCases: [], ...(metadata?.sourceCourse ? { source: { kind: 'local', reference: metadata.sourceCourse } as const } : {}) }
}

/** Archives are the source; optional catalog metadata enriches discovery without blocking usable files. */
export async function scanComponentCatalogDirectory(rootPath: string, trust: ComponentCatalogTrust): Promise<ScannedComponentCatalogSource> {
  const root = path.resolve(rootPath), sourceId = catalogSourceId(root), issues: ComponentCatalogIssue[] = []
  let metadata: { name?: string; packages?: Partial<ComponentCatalogPackage>[] } = {}
  try { metadata = JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8')) } catch { /* metadata is optional */ }
  const label = metadata.name ?? path.basename(root), packages: AvailableComponentCatalogPackage[] = [], index = new Map<string, ComponentCatalogPackage>()
  let entries: string[]
  try { entries = await fs.readdir(root, { recursive: true }) } catch (cause) { throw new ComponentCatalogScanError('catalog-unreadable', '组件目录无法读取。', { cause }) }
  for (const relative of entries.filter(file => file.toLowerCase().endsWith('.h5component'))) {
    try {
      const bytes = await readCatalogFile(await resolveCatalogFilePath(root, relative))
      const archive = importComponentLibraryArchive(bytes)
      const pkg = libraryCatalogPackage(archive.entry, archive.version, relative.replaceAll('\\', '/'), bytes, archive.metadata)
      const extra = (Array.isArray(metadata.packages) ? metadata.packages : []).find(item => item.packageId === pkg.packageId && item.version === pkg.version)
      if (extra) Object.assign(pkg, { description: extra.description ?? pkg.description, subject: extra.subject ?? pkg.subject, schoolStage: extra.schoolStage ?? pkg.schoolStage, tags: extra.tags ?? pkg.tags, category: extra.category, thumbnailPath: extra.thumbnailPath ?? '', license: extra.license, source: extra.source ?? pkg.source })
      let thumbnailDataUrl: string | undefined
      if (pkg.thumbnailPath) {
        try {
          const thumbnail = await readCatalogFile(await resolveCatalogFilePath(root, pkg.thumbnailPath))
          const extension = path.extname(pkg.thumbnailPath).slice(1).toLowerCase()
          thumbnailDataUrl = `data:image/${extension === 'svg' ? 'svg+xml' : extension === 'jpg' ? 'jpeg' : extension};base64,${Buffer.from(thumbnail).toString('base64')}`
        } catch (cause) { issues.push({ sourceId, sourceLabel: label, packageId: pkg.packageId, code: 'thumbnail-unreadable', message: `缩略图缺失；组件仍可使用：${String(cause)}` }) }
      }
      index.set(catalogPackageIdentity(pkg.packageId, pkg.version), pkg)
      packages.push({ ...pkg, sourceId, sourceLabel: label, sourceTrust: trust, thumbnailDataUrl })
    } catch (cause) { issues.push({ sourceId, sourceLabel: label, code: 'package-unreadable', message: `${relative}：${cause instanceof Error ? cause.message : String(cause)}` }) }
  }
  return { source: { sourceId, label, trust, packageCount: packages.length }, rootPath: root, packages, issues, packageIndex: index }
}

export function createBuiltInCatalogSource(root: string, entries: ComponentLibraryEntry[]): ScannedComponentCatalogSource {
  const sourceId = 'component-catalog:builtins-v10', label = '内置组件', memoryPackages = new Map<string, Uint8Array>()
  const packages = entries.map(entry => {
    const version = Object.values(entry.definitions)[0]?.version ?? '1.0.0', bytes = exportComponentLibraryArchive(entry, version)
    memoryPackages.set(catalogPackageIdentity(entry.id, version), bytes)
    return { ...libraryCatalogPackage(entry, version, `builtin/${encodeURIComponent(entry.id)}.h5component`, bytes), sourceId, sourceLabel: label, sourceTrust: 'built-in' as const }
  })
  return { source: { sourceId, label, trust: 'built-in', packageCount: packages.length }, rootPath: root, packages, issues: [],
    packageIndex: new Map(packages.map(pkg => [catalogPackageIdentity(pkg.packageId, pkg.version), pkg])), memoryPackages }
}
export async function readCatalogComponentPackage(source: ScannedComponentCatalogSource, packageId: string, version: string): Promise<ComponentCatalogPackageFile> {
  const identity = catalogPackageIdentity(packageId, version), pkg = source.packageIndex.get(identity)
  if (!pkg) throw new Error('组件目录条目已不存在，请刷新。')
  const bytes = source.memoryPackages?.get(identity) ?? await readCatalogFile(await resolveCatalogFilePath(source.rootPath, pkg.packagePath))
  const archive = importComponentLibraryArchive(bytes)
  if (archive.entry.id !== packageId || archive.version !== version) throw new Error('组件文件身份已改变，请刷新目录。')
  return { sourceId: source.source.sourceId, sourceLabel: source.source.label, sourceTrust: source.source.trust, packageId, version,
    sha256: createHash('sha256').update(bytes).digest('hex'), name: path.basename(pkg.packagePath), bytes: Uint8Array.from(bytes) }
}
