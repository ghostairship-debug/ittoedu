import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  componentCatalogSchema,
  type AvailableComponentCatalogPackage,
  type ComponentCatalogIssue,
  type ComponentCatalogPackage,
  type ComponentCatalogPackageFile,
  type ComponentCatalogSourceSnapshot,
  type ComponentCatalogTrust,
} from '../shared/componentCatalog'

export class ComponentCatalogScanError extends Error {
  constructor(
    readonly code: 'catalog-unreadable' | 'catalog-invalid',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ComponentCatalogScanError'
  }
}

export interface ScannedComponentCatalogSource {
  source: ComponentCatalogSourceSnapshot
  rootPath: string
  packages: AvailableComponentCatalogPackage[]
  issues: ComponentCatalogIssue[]
  packageIndex: ReadonlyMap<string, ComponentCatalogPackage>
}

function sourceIdForPath(rootPath: string): string {
  const resolved = path.resolve(rootPath)
  const normalized = process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return `component-catalog:${digest}`
}

function pathEscapesRoot(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function resolveCatalogPath(rootPath: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootPath)
  const target = path.resolve(resolvedRoot, ...relativePath.replaceAll('\\', '/').split('/'))
  const relative = path.relative(resolvedRoot, target)
  if (relative === '' || pathEscapesRoot(relative)) {
    throw new Error(`目录路径越界：${relativePath}`)
  }
  return target
}

export async function resolveCatalogFilePath(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const lexicalTarget = resolveCatalogPath(rootPath, relativePath)
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(lexicalTarget),
  ])
  const relative = path.relative(realRoot, realTarget)
  if (relative === '' || pathEscapesRoot(relative)) {
    throw new Error(`目录路径经符号链接越界：${relativePath}`)
  }
  return realTarget
}

export async function readCatalogFile(filePath: string): Promise<Uint8Array> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('路径不是文件')
  return new Uint8Array(await fs.readFile(filePath))
}

function thumbnailMimeType(relativePath: string): string {
  switch (path.extname(relativePath).toLocaleLowerCase('en-US')) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: throw new Error('缩略图必须是 PNG、JPG、WebP、GIF 或 SVG')
  }
}

function packageIdentity(packageId: string, version: string): string {
  return `${packageId}@${version}`
}

export async function scanComponentCatalogDirectory(
  rootPath: string,
  trust: ComponentCatalogTrust,
): Promise<ScannedComponentCatalogSource> {
  const resolvedRoot = path.resolve(rootPath)
  const sourceId = sourceIdForPath(resolvedRoot)
  const fallbackLabel = path.basename(resolvedRoot) || '组件目录'
  let catalogBytes: Uint8Array
  try {
    catalogBytes = await readCatalogFile(path.join(resolvedRoot, 'catalog.json'))
  } catch (error) {
    throw new ComponentCatalogScanError(
      'catalog-unreadable',
      '无法读取目录根部的 catalog.json。',
      { cause: error },
    )
  }

  let rawCatalog: unknown
  try {
    rawCatalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(catalogBytes))
  } catch (error) {
    throw new ComponentCatalogScanError(
      'catalog-invalid',
      'catalog.json 不是有效的 UTF-8 JSON。',
      { cause: error },
    )
  }
  const parsed = componentCatalogSchema.safeParse(rawCatalog)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ComponentCatalogScanError(
      'catalog-invalid',
      `catalog.json 校验失败：${first?.path.join('.') || 'catalog'} ${first?.message ?? '字段无效'}。`,
      { cause: parsed.error },
    )
  }

  const label = parsed.data.name ?? fallbackLabel
  const packages: AvailableComponentCatalogPackage[] = []
  const issues: ComponentCatalogIssue[] = []
  const packageIndex = new Map<string, ComponentCatalogPackage>()

  for (const pkg of parsed.data.packages) {
    const identity = packageIdentity(pkg.packageId, pkg.version)
    try {
      const packagePath = await resolveCatalogFilePath(resolvedRoot, pkg.packagePath)
      const bytes = await readCatalogFile(packagePath)
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      if (actualHash !== pkg.sha256) {
        issues.push({
          sourceId,
          sourceLabel: label,
          packageId: pkg.packageId,
          code: 'package-hash-mismatch',
          message: `组件 ${identity} 的实际 SHA-256 与 catalog.json 不一致，已停止发现。`,
        })
        continue
      }

      let thumbnailDataUrl: string | undefined
      try {
        const thumbnailBytes = await readCatalogFile(await resolveCatalogFilePath(resolvedRoot, pkg.thumbnailPath))
        const mimeType = thumbnailMimeType(pkg.thumbnailPath)
        thumbnailDataUrl = `data:${mimeType};base64,${Buffer.from(thumbnailBytes).toString('base64')}`
      } catch (error) {
        issues.push({
          sourceId,
          sourceLabel: label,
          packageId: pkg.packageId,
          code: 'thumbnail-unreadable',
          message: `组件 ${identity} 的缩略图无法读取：${error instanceof Error ? error.message : '未知错误'}。`,
        })
      }

      packages.push({
        ...pkg,
        sourceId,
        sourceLabel: label,
        sourceTrust: trust,
        ...(thumbnailDataUrl === undefined ? {} : { thumbnailDataUrl }),
      })
      packageIndex.set(identity, pkg)
    } catch (error) {
      issues.push({
        sourceId,
        sourceLabel: label,
        packageId: pkg.packageId,
        code: 'package-unreadable',
        message: `组件 ${identity} 无法读取：${error instanceof Error ? error.message : '未知错误'}。`,
      })
    }
  }

  return {
    source: { sourceId, label, trust, packageCount: packages.length },
    rootPath: resolvedRoot,
    packages,
    issues,
    packageIndex,
  }
}

export async function readCatalogComponentPackage(
  source: ScannedComponentCatalogSource,
  packageId: string,
  version: string,
): Promise<ComponentCatalogPackageFile> {
  const identity = packageIdentity(packageId, version)
  const pkg = source.packageIndex.get(identity)
  if (!pkg) throw new Error(`组件目录中不存在 ${identity}。`)
  const bytes = await readCatalogFile(await resolveCatalogFilePath(source.rootPath, pkg.packagePath))
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  if (actualHash !== pkg.sha256) {
    throw new Error(`组件 ${identity} 自上次扫描后已改变，实际 SHA-256 不匹配。`)
  }
  return {
    sourceId: source.source.sourceId,
    sourceLabel: source.source.label,
    sourceTrust: source.source.trust,
    packageId,
    version,
    sha256: actualHash,
    name: path.basename(pkg.packagePath),
    bytes,
  }
}
