// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readComponentLibrary, searchComponentLibrary } from '../../src/main/workbench/assetSources/componentLibrarySearch'
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

it('reads the same catalog sources as the component library panel: built-ins plus teacher-added directories', async () => {
  const userData = await temporary(), external = await temporary()
  const bytes = Buffer.from('fixture package')
  await fs.mkdir(path.join(external, 'packages'))
  await fs.writeFile(path.join(external, 'packages', 'orbit.h5component'), bytes)
  await fs.writeFile(path.join(external, 'orbit.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await fs.writeFile(path.join(external, 'catalog.json'), JSON.stringify({ catalogVersion: 1, name: '地理组件', packages: [{
    packageId: 'com.example.earth-orbit', version: '1.2.0', name: '地球公转模拟', description: '拖动地球观察四季与太阳直射点变化',
    subject: ['地理'], schoolStage: ['初中'], tags: ['公转', '四季'], packagePath: 'packages/orbit.h5component', thumbnailPath: 'orbit.svg',
    sha256: createHash('sha256').update(bytes).digest('hex'), componentSchemaVersion: 4, runtimeApiVersion: 4, renderMode: 'dom',
    supportedScopes: ['scene'], quality: 'experimental', maintainer: 'fixture', verifiedCases: [] }] }))
  await fs.writeFile(path.join(userData, 'component-catalog-sources.json'), JSON.stringify({ version: 1, sources: [{ path: external, trust: 'prompt' }] }))
  const library = await readComponentLibrary(process.cwd(), userData)
  expect(library.packages.map(item => item.packageId)).toEqual(expect.arrayContaining([
    'com.ittoedu.language.pinyin-annotation', 'com.ittoedu.visual.image-frame', 'com.example.earth-orbit']))
  expect(library.packages.find(item => item.packageId === 'com.example.earth-orbit')).toMatchObject({ sourceLabel: '地理组件', sourceTrust: 'prompt' })

  const found = searchComponentLibrary(library, '公转 四季', 5)
  expect(found).toMatchObject({ status: 'results', candidates: [{ kind: 'component', packageId: 'com.example.earth-orbit', version: '1.2.0',
    name: '地球公转模拟', subject: ['地理'], schoolStage: ['初中'], tags: ['公转', '四季'], source: '地理组件', trust: 'prompt', scopes: ['scene'] }] })
  expect(found.candidates).toHaveLength(1)
  expect(searchComponentLibrary(library, '拼音', 5).candidates[0]).toMatchObject({ packageId: 'com.ittoedu.language.pinyin-annotation', name: '汉语拼音标注' })
  expect(searchComponentLibrary(await readComponentLibrary(process.cwd(), await temporary()), '公转', 5))
    .toMatchObject({ candidates: [], hint: expect.stringContaining('没有匹配') })
})

it('ranks by matched terms then field weight, keeps only the newest version and omits deprecated components', () => {
  const library = { issues: 1, packages: [
    entry({ packageId: 'com.example.quiz', name: '选择题', description: '四季知识小测', tags: ['测验'] }),
    entry({ packageId: 'com.example.seasons', name: '四季转盘', version: '1.9.0', tags: ['四季', '转盘'] }),
    entry({ packageId: 'com.example.seasons', name: '四季转盘（旧）', version: '1.10.0', tags: ['四季', '转盘'], sourceTrust: 'prompt' }),
    entry({ packageId: 'com.example.old', name: '四季旧组件', quality: 'deprecated' }),
  ] }
  const result = searchComponentLibrary(library, '四季 转盘', 10)
  expect(result.candidates.map(item => [item.packageId, item.version])).toEqual([['com.example.seasons', '1.10.0'], ['com.example.quiz', '1.0.0']])
  expect(result).toMatchObject({ libraryComponents: 3, unreadable: 1 })
  expect(searchComponentLibrary(library, '四季', 1).candidates).toHaveLength(1)
})
