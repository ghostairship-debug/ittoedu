// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { ComponentCatalogManager } from '../../src/main/componentCatalogManager'
import { managedComponentLibrary } from '../../src/main/componentCatalogSources'
import { saveHtmlComponent } from '../../src/main/htmlComponentLibrary'
import { AssetLibraryService, readComponentLibrary, searchComponentLibrary } from '../../src/main/workbench/assetSources/componentLibrarySearch'
import { exportComponentLibraryArchive } from '../../src/core/components/library/archive'
import type { ComponentLibraryEntry } from '../../src/shared/contracts/component-platform/library'

const electronPaths = vi.hoisted(() => ({ userData: '', appPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronPaths.userData, getAppPath: () => electronPaths.appPath }, dialog: {} }))
function entry(id: string, title: string, version: string, label = title): ComponentLibraryEntry {
  return { schemaVersion: 1, id, title, definitions: {
    [id]: { id, version, role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'source', entry: 'main.js' } } },
  }, example: { rootIds: ['example'], instances: { example: { id: 'example', definitionId: id, data: { label } } } }, assets: {},
    resources: { assets: {}, components: { source: { 'main.js': new TextEncoder().encode('export default {mount(){return {update(){},dispose(){}}}}') } } } }
}

it('searches current archives across actual catalog directories, ranks the newest trusted version and reads only the qualified authorized source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-current-library-search-'))
  electronPaths.userData = path.join(root, 'user-data'); electronPaths.appPath = process.cwd()
  const external = path.join(root, 'teacher-library'); await fs.mkdir(external, { recursive: true })
  await fs.mkdir(electronPaths.userData, { recursive: true })
  const catalog = new ComponentCatalogManager(), service = new AssetLibraryService({ catalog })
  const readPackage = vi.spyOn(catalog, 'readPackage')
  try {
    const metadata = { description: '四季知识小测', tags: ['四季', '转盘'] }
    await service.save({ entry: entry('com.example.seasons', '四季转盘', '1.9.0'), ...metadata })
    const current = entry('com.example.seasons', '四季转盘', '1.10.0')
    await service.save({ entry: current, ...metadata, sourceCourse: '教师原课件.h5lesson' })
    await service.save({ entry: entry('com.example.quiz', '选择题', '1.0.0'), description: '四季知识小测', tags: ['测验'] })
    await fs.writeFile(path.join(external, 'seasons.h5component'), exportComponentLibraryArchive(entry(current.id, current.title, '1.10.0', '外部目录正文'), '1.10.0', metadata))
    await fs.writeFile(path.join(external, 'catalog.json'), JSON.stringify({ catalogVersion: 1, name: '同事的组件', packages: [] }))
    await fs.writeFile(path.join(external, 'broken.h5component'), 'broken archive')
    await fs.writeFile(path.join(electronPaths.userData, 'component-catalog-sources.json'), JSON.stringify({ version: 1, sources: [{ path: external, trust: 'prompt' }] }))
    await saveHtmlComponent(managedComponentLibrary(electronPaths.userData), { name: '旧公转HTML', html: '<p>原文件保留</p>', assets: [] })

    const snapshot = await readComponentLibrary(catalog)
    expect(snapshot.packages.filter(value => value.packageId === current.id)).toHaveLength(3)
    expect(snapshot.htmlComponents?.map(value => value.name)).toContain('旧公转HTML')
    expect(snapshot.issues.some(value => value.code === 'package-unreadable')).toBe(true)
    const found = await service.search({ query: '  四季 转盘  ', limit: 10 })
    expect(found.query).toBe('四季 转盘')
    expect(found.candidates.map(value => [value.packageId, value.version])).toEqual([[current.id, '1.10.0'], ['com.example.quiz', '1.0.0']])
    expect(found.candidates[0]).toMatchObject({ kind: 'component-package', trust: 'trusted', removable: true, sourceCourse: '教师原课件.h5lesson' })
    expect(found).toMatchObject({ unreadable: expect.any(Number), note: expect.stringContaining('旧 HTML') })
    expect((await service.search({ query: '四季', limit: 1 })).candidates).toHaveLength(1)
    expect(await service.search({ query: '无匹配的月相' })).toMatchObject({ candidates: [], hint: expect.stringContaining('没有匹配') })
    expect((await service.search({ query: '旧公转HTML' })).candidates).toEqual([])

    const externalEntry = snapshot.packages.find(value => value.packageId === current.id && value.sourceTrust === 'prompt')!
    expect(await service.read({ packageId: current.id, version: '1.10.0', sourceId: externalEntry.sourceId }))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('确认信任') })
    expect(readPackage).not.toHaveBeenCalled()
    const mine = found.candidates[0]
    expect(await service.read({ packageId: mine.packageId, version: mine.version, sourceId: mine.sourceId }))
      .toMatchObject({ status: 'ready', entry: current })
    expect(readPackage).toHaveBeenLastCalledWith(mine.sourceId, current.id, '1.10.0')
    await catalog.setTrust(externalEntry.sourceId, 'trusted')
    expect(await service.read({ packageId: current.id, version: '1.10.0', sourceId: externalEntry.sourceId }))
      .toMatchObject({ status: 'ready', entry: { example: { instances: { example: { data: { label: '外部目录正文' } } } } } })
    expect(readPackage).toHaveBeenLastCalledWith(externalEntry.sourceId, current.id, '1.10.0')

    // Deprecation is a discovery policy over current entries, independent of archive parsing.
    const deprecated = snapshot.packages.find(value => value.packageId === 'com.example.quiz')!
    expect(searchComponentLibrary({ ...snapshot, packages: snapshot.packages.map(value => value === deprecated ? { ...value, quality: 'deprecated' } : value) }, '四季 转盘', 10)
      .candidates.map(value => value.packageId)).toEqual([current.id])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
