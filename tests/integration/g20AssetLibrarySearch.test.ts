// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { managedComponentLibrary } from '../../src/main/componentCatalogSources'
import { deleteHtmlComponent, saveHtmlComponent } from '../../src/main/htmlComponentLibrary'
import { AssetLibraryService, readComponentLibrary, searchComponentLibrary, type ComponentLibrarySnapshot } from '../../src/main/workbench/assetSources/componentLibrarySearch'
import type { AvailableComponentCatalogPackage } from '../../src/shared/componentCatalog'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const temporary = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-asset-library-')); roots.push(root); return root }

const entry = (overrides: Partial<AvailableComponentCatalogPackage>): AvailableComponentCatalogPackage => ({
  packageId: 'com.example.sample', version: '1.0.0', name: '示例组件', description: '示例说明', subject: [], schoolStage: [], tags: [],
  packagePath: 'packages/x.h5component', thumbnailPath: 'x.svg', sha256: 'a'.repeat(64), componentSchemaVersion: 4, runtimeApiVersion: 4,
  renderMode: 'dom', supportedScopes: ['scene'], quality: 'experimental', maintainer: 'fixture', verifiedCases: [],
  sourceId: 'component-catalog:fixture', sourceLabel: '测试目录', sourceTrust: 'trusted', ...overrides,
})
const snapshot = (packages: AvailableComponentCatalogPackage[]): ComponentLibrarySnapshot => ({ packages, htmlComponents: [], roots: new Map(), issues: 1 })

it('reads every library directory: built-in packages, my library and teacher-added directories with their HTML components', async () => {
  const userData = await temporary(), external = await temporary()
  await saveHtmlComponent(managedComponentLibrary(userData), { name: '公转模拟', description: '拖动地球观察四季', tags: ['公转'],
    html: '<!doctype html><html><body>公转</body></html>', assets: [] })
  await saveHtmlComponent(external, { name: '拼读卡片', html: '<p>拼读</p>', assets: [] })
  await fs.writeFile(path.join(external, 'catalog.json'), JSON.stringify({ catalogVersion: 1, name: '同事的组件', packages: [] }))
  await fs.mkdir(path.join(external, 'html-components', 'broken'), { recursive: true })
  await fs.writeFile(path.join(external, 'html-components', 'broken', 'component.json'), '{"format":"guoling-html-component"}')
  await fs.writeFile(path.join(userData, 'component-catalog-sources.json'), JSON.stringify({ version: 1, sources: [{ path: external, trust: 'prompt' }] }))

  const library = await readComponentLibrary(process.cwd(), userData)
  expect(library.packages.map(item => item.packageId)).toEqual(expect.arrayContaining(['com.ittoedu.language.pinyin-annotation', 'com.ittoedu.visual.image-frame']))
  expect(library.htmlComponents.map(item => [item.name, item.sourceLabel, item.sourceTrust, item.removable])).toEqual(expect.arrayContaining([
    ['公转模拟', '我的资产库', 'trusted', true], ['拼读卡片', '同事的组件', 'prompt', false]]))
  expect(library.issues).toBeGreaterThanOrEqual(1)

  const found = searchComponentLibrary(library, '公转', 5)
  expect(found.candidates).toEqual([expect.objectContaining({ kind: 'html-component', name: '公转模拟', source: '我的资产库', trust: 'trusted' })])
  expect(found).not.toHaveProperty('note')
  expect(searchComponentLibrary(library, '拼音', 5)).toMatchObject({ candidates: [{ kind: 'component-package', name: '汉语拼音标注' }],
    note: expect.stringContaining('组件库面板插入') })
  expect(searchComponentLibrary(library, '月相', 5)).toMatchObject({ candidates: [], hint: expect.stringContaining('没有匹配') })

  const service = new AssetLibraryService({ load: () => readComponentLibrary(process.cwd(), userData), managedLibrary: managedComponentLibrary(userData) })
  const unconfirmed = library.htmlComponents.find(item => item.name === '拼读卡片')!
  expect(await service.read({ packageId: unconfirmed.packageId })).toMatchObject({ status: 'rejected', reason: expect.stringContaining('确认信任') })
  const mine = library.htmlComponents.find(item => item.name === '公转模拟')!
  expect(await service.read({ packageId: mine.packageId })).toMatchObject({ status: 'ready', name: '公转模拟', html: '<!doctype html><html><body>公转</body></html>', assets: [] })

  await deleteHtmlComponent(managedComponentLibrary(userData), mine.entry)
  expect((await readComponentLibrary(process.cwd(), userData)).htmlComponents.map(item => item.name)).toEqual(['拼读卡片'])
})

it('ranks by matched terms then field weight, keeps only the newest version and omits deprecated packages', () => {
  const library = snapshot([
    entry({ packageId: 'com.example.quiz', name: '选择题', description: '四季知识小测', tags: ['测验'] }),
    entry({ packageId: 'com.example.seasons', name: '四季转盘', version: '1.9.0', tags: ['四季', '转盘'] }),
    entry({ packageId: 'com.example.seasons', name: '四季转盘（旧）', version: '1.10.0', tags: ['四季', '转盘'], sourceTrust: 'prompt' }),
    entry({ packageId: 'com.example.old', name: '四季旧组件', quality: 'deprecated' }),
  ])
  const result = searchComponentLibrary(library, '四季 转盘', 10)
  expect(result.candidates.map(item => [item.packageId, item.version])).toEqual([['com.example.seasons', '1.10.0'], ['com.example.quiz', '1.0.0']])
  expect(result).toMatchObject({ libraryEntries: 3, unreadable: 1 })
  expect(searchComponentLibrary(library, '四季', 1).candidates).toHaveLength(1)
})
