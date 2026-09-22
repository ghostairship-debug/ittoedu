import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type {
  ComponentCatalogPackageFile,
  ComponentCatalogSnapshot,
  ComponentCatalogTrust,
} from '../shared/componentCatalog'
import { defaultComponentCatalogSources } from './componentCatalogSources'
import {
  ComponentCatalogScanError,
  readCatalogComponentPackage,
  scanComponentCatalogDirectory,
  type ScannedComponentCatalogSource,
} from './componentCatalogScanner'

const sourceConfigSchema = z.object({
  version: z.literal(1),
  sources: z.array(z.object({
    path: z.string().min(1).max(32_767),
    trust: z.enum(['trusted', 'prompt']),
  }).strict()).max(100),
}).strict()

interface SourceConfig {
  path: string
  trust: 'trusted' | 'prompt'
}

interface DiscoveredSourceConfig {
  path: string
  trust: ComponentCatalogTrust
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved
}

function configuredSourcesPath(): string {
  return path.join(app.getPath('userData'), 'component-catalog-sources.json')
}

async function readConfiguredSources(): Promise<SourceConfig[]> {
  try {
    const text = await fs.readFile(configuredSourcesPath(), 'utf8')
    const parsed = sourceConfigSchema.safeParse(JSON.parse(text) as unknown)
    return parsed.success ? parsed.data.sources : []
  } catch {
    return []
  }
}

async function writeConfiguredSources(sources: SourceConfig[]): Promise<void> {
  const target = configuredSourcesPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(
    target,
    `${JSON.stringify({ version: 1, sources }, null, 2)}\n`,
    'utf8',
  )
}

export class ComponentCatalogManager {
  private readonly sources = new Map<string, ScannedComponentCatalogSource>()

  private snapshot(): ComponentCatalogSnapshot {
    const values = [...this.sources.values()]
    return {
      sources: values.map((entry) => ({ ...entry.source })),
      packages: values.flatMap((entry) => entry.packages.map((pkg) => ({ ...pkg }))),
      issues: values.flatMap((entry) => entry.issues.map((issue) => ({ ...issue }))),
    }
  }

  async load(): Promise<ComponentCatalogSnapshot> {
    this.sources.clear()
    const configured = await readConfiguredSources()
    const defaults = await defaultComponentCatalogSources(app.getAppPath())
    const byPath = new Map<string, DiscoveredSourceConfig>()
    for (const source of defaults) byPath.set(canonicalPath(source.path), source)
    for (const source of configured) {
      const key = canonicalPath(source.path)
      if (byPath.get(key)?.trust !== 'built-in') byPath.set(key, source)
    }

    const detachedIssues: ComponentCatalogSnapshot['issues'] = []
    for (const source of byPath.values()) {
      try {
        const scanned = await scanComponentCatalogDirectory(source.path, source.trust)
        this.sources.set(scanned.source.sourceId, scanned)
      } catch (error) {
        detachedIssues.push({
          sourceLabel: path.basename(source.path) || '组件目录',
          code: error instanceof ComponentCatalogScanError
            ? error.code
            : 'catalog-unreadable',
          message: error instanceof Error ? error.message : '组件目录扫描失败。',
        })
      }
    }
    const snapshot = this.snapshot()
    snapshot.issues.push(...detachedIssues)
    return snapshot
  }

  async select(window: BrowserWindow): Promise<ComponentCatalogSnapshot | null> {
    const result = await dialog.showOpenDialog(window, {
      title: '选择组件目录',
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = path.resolve(result.filePaths[0]!)
    const scanned = await scanComponentCatalogDirectory(selectedPath, 'prompt')
    this.sources.set(scanned.source.sourceId, scanned)

    const configured = await readConfiguredSources()
    const canonicalSelected = canonicalPath(selectedPath)
    const next = configured.filter((source) => canonicalPath(source.path) !== canonicalSelected)
    next.push({ path: selectedPath, trust: 'prompt' })
    await writeConfiguredSources(next)
    return this.snapshot()
  }

  async setTrust(
    sourceId: string,
    trust: Exclude<ComponentCatalogTrust, 'built-in'>,
  ): Promise<ComponentCatalogSnapshot> {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error('组件目录已失效，请重新扫描。')
    source.source.trust = trust
    source.packages.forEach((pkg) => {
      pkg.sourceTrust = trust
    })

    const configured = await readConfiguredSources()
    const sourcePath = canonicalPath(source.rootPath)
    const next = configured.filter((item) => canonicalPath(item.path) !== sourcePath)
    next.push({ path: source.rootPath, trust })
    await writeConfiguredSources(next)
    return this.snapshot()
  }

  async readPackage(
    sourceId: string,
    packageId: string,
    version: string,
  ): Promise<ComponentCatalogPackageFile> {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error('组件目录已失效，请重新扫描。')
    return readCatalogComponentPackage(source, packageId, version)
  }
}

export const componentCatalogManager = new ComponentCatalogManager()
