import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import type {
  ComponentCatalogPackageFile,
  ComponentCatalogSnapshot,
  ComponentCatalogTrust,
} from '../shared/componentCatalog'
import {
  canonicalCatalogPath,
  COMPONENT_CATALOG_SOURCES_FILE,
  managedComponentLibrary,
  readConfiguredCatalogSources,
  scanCatalogSource,
  scanComponentCatalogSources,
  type ConfiguredCatalogSource,
  type ScannedCatalogSource,
} from './componentCatalogSources'
import { readCatalogComponentPackage } from './componentCatalogScanner'
import { deleteHtmlComponent } from './htmlComponentLibrary'

async function writeConfiguredSources(sources: ConfiguredCatalogSource[]): Promise<void> {
  const target = path.join(app.getPath('userData'), COMPONENT_CATALOG_SOURCES_FILE)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(
    target,
    `${JSON.stringify({ version: 1, sources }, null, 2)}\n`,
    'utf8',
  )
}

export class ComponentCatalogManager {
  private sources = new Map<string, ScannedCatalogSource>()

  private snapshot(): ComponentCatalogSnapshot {
    const values = [...this.sources.values()]
    return {
      sources: values.map((entry) => ({ ...entry.source })),
      packages: values.flatMap((entry) => entry.packages.map((pkg) => ({ ...pkg }))),
      htmlComponents: values.flatMap((entry) => entry.htmlComponents.map((component) => ({ ...component }))),
      issues: values.flatMap((entry) => entry.issues.map((issue) => ({ ...issue }))),
    }
  }

  async load(): Promise<ComponentCatalogSnapshot> {
    // A complete fresh scan replaces the previous state at once; reads never see a half-cleared map.
    const scan = await scanComponentCatalogSources(app.getAppPath(), app.getPath('userData'))
    this.sources = scan.sources
    const snapshot = this.snapshot()
    snapshot.issues.push(...scan.issues)
    return snapshot
  }

  async select(window: BrowserWindow): Promise<ComponentCatalogSnapshot | null> {
    const result = await dialog.showOpenDialog(window, {
      title: '选择组件目录',
      properties: ['openDirectory', 'dontAddToRecent'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = path.resolve(result.filePaths[0]!)
    const scanned = await scanCatalogSource(selectedPath, 'prompt', managedComponentLibrary(app.getPath('userData')))
    this.sources.set(scanned.source.sourceId, scanned)

    const configured = await readConfiguredCatalogSources(app.getPath('userData'))
    const canonicalSelected = canonicalCatalogPath(selectedPath)
    const next = configured.filter((source) => canonicalCatalogPath(source.path) !== canonicalSelected)
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
    source.htmlComponents.forEach((component) => {
      component.sourceTrust = trust
    })

    const configured = await readConfiguredCatalogSources(app.getPath('userData'))
    const sourcePath = canonicalCatalogPath(source.rootPath)
    const next = configured.filter((item) => canonicalCatalogPath(item.path) !== sourcePath)
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

  /** Only entries of the managed library (“我的资产库”) can be deleted from the panel. */
  async deleteHtmlComponent(sourceId: string, entry: string): Promise<ComponentCatalogSnapshot> {
    const source = this.sources.get(sourceId)
    if (!source?.htmlComponents.some((component) => component.entry === entry && component.removable))
      throw new Error('只能删除“我的资产库”中的 HTML 组件；请刷新组件库后重试。')
    await deleteHtmlComponent(source.rootPath, entry)
    this.sources.set(sourceId, await scanCatalogSource(source.rootPath, source.source.trust, managedComponentLibrary(app.getPath('userData'))))
    return this.snapshot()
  }
}

export const componentCatalogManager = new ComponentCatalogManager()
