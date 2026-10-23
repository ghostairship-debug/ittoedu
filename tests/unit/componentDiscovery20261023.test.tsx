import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BUILTIN_DISCOVERY_ENTRIES, createProjectDefinitionDiscoveryEntries, createRecipeDiscoveryEntries, searchDiscoveryEntries } from '../../src/shared/componentDiscovery'
import { filterBuiltInWorkAssets } from '../../src/renderer/components/componentLibraryModel'
import { builtInWorkAssetMetadata } from '../../src/core/components/library/workAssets'
import { RECIPE_CATALOG } from '../../src/core/course/courseRecipeEdits'
import { FlowInsertMenu } from '../../src/renderer/ui/flow/FlowInsertMenu'
import { HostToolCoordinator, type HostToolServices } from '../../src/core/tools/HostToolServices'
import type { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { assetSourceRegistration } from '../../src/core/tools/AssetSourceTools'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

afterEach(cleanup)

it('shares purpose aliases and multi-term ranking across builtin facts, work assets and Flow menus', () => {
  expect(searchDiscoveryEntries(BUILTIN_DISCOVERY_ENTRIES, '柱形图')[0].id).toBe('chart:bar')
  expect(searchDiscoveryEntries(BUILTIN_DISCOVERY_ENTRIES, '图文 并排')[0].id).toBe('layout_group')
  expect(searchDiscoveryEntries(BUILTIN_DISCOVERY_ENTRIES, '图文 并排')[0].action).toMatchObject({ tool: 'object.layout', input: { intent: { kind: 'columns' } } })
  expect(filterBuiltInWorkAssets(builtInWorkAssetMetadata(), '可调程序 速度')[0].id).toBe('guoling.work.program')
  const found = searchDiscoveryEntries(createRecipeDiscoveryEntries(RECIPE_CATALOG), '滑杆 联动')[0]
  expect(found.action).toMatchObject({ tool: 'surface.recipe', input: { recipeId: 'continuous-variable-v1' } })
  render(<FlowInsertMenu query="文字" onInsert={vi.fn()}/>)
  expect(screen.getByRole('menuitem', { name: '正文' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '公式' })).toBeNull()
})

it('projects only Gateway-provided readable project identities and lists actual copy sources', () => {
  const project = { definitions: { own: { id: 'own', title: '工程例子', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } },
    empty: { id: 'empty', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
    instances: { first: { id: 'first', definitionId: 'own', name: '人工甲', data: { label: '甲' } }, second: { id: 'second', definitionId: 'own', name: '人工乙', data: { label: '乙' } } } } as Pick<CourseProjectV10, 'definitions' | 'instances'>
  const facts = createProjectDefinitionDiscoveryEntries(project, { definitionIds: ['own', 'empty'], instanceIds: ['second'] })
  expect(facts[0]).toMatchObject({ source: { kind: 'project' }, action: { kind: 'copy', tool: 'object.structure', input: { action: 'duplicate' } }, sources: [{ instanceId: 'second', title: '人工乙' }] })
  expect(facts[1]).toMatchObject({ sources: [], availability: { available: false, reason: expect.stringContaining('没有可复制') } })
  expect(createProjectDefinitionDiscoveryEntries(project, { definitionIds: [], instanceIds: ['first', 'second'] })).toEqual([])
})

function host(services: HostToolServices = {}) {
  const projectDiscovery = vi.fn(async () => [])
  const coordinator = new HostToolCoordinator(services, {} as DocumentRegistry, { projectDiscovery,
    active() {}, ownsDocument: () => true, resolveImage: async () => { throw new Error('unused') },
    provideImage: async () => { throw new Error('unused') }, readImage: async () => { throw new Error('unused') } })
  return { coordinator, projectDiscovery }
}
const read = (value: Awaited<ReturnType<HostToolCoordinator['assetSearch']>>): any => { if (value.kind !== 'read') throw new Error(JSON.stringify(value)); return value.data }

it('queries builtin and recipe facts and reads the real builtin asset without an asset service or file grant', async () => {
  const { coordinator } = host()
  await coordinator.beginRun({ runId: 'run', actor: 'agent', documents: [] })
  expect(assetSourceRegistration('asset.search')!.supports({ assetLibrary: false, workbenchServices: false })).toBe(true)
  expect(read(await coordinator.assetSearch('run', { query: '柱形图' })).entries[0].action).toMatchObject({ tool: 'object.insert', input: { kind: 'chart', chartType: 'bar' } })
  expect(read(await coordinator.assetSearch('run', { query: '滑杆 联动' })).entries[0].action).toMatchObject({ tool: 'surface.recipe', input: { recipeId: 'continuous-variable-v1' } })
  expect(read(await coordinator.assetSearch('run', { packageId: 'guoling.work.program' }))).toMatchObject({ status: 'entry', usage: { kind: 'program' }, rootIds: ['program'] })
  expect(await coordinator.libraryComponent('run', 'guoling.work.program')).toMatchObject({ status: 'ready', entry: { usage: { kind: 'program' } } })
})

it('keeps real directory search and reads behind the existing file grant', async () => {
  const search = vi.fn(async () => ({ status: 'results', candidates: [], entries: [] })), readLibrary = vi.fn(async () => ({ status: 'rejected' as const, reason: 'fixture' }))
  const { coordinator } = host({ assetLibrary: { search, read: readLibrary, import: async () => ({}), delete: async () => ({}), save: async () => ({}) } })
  await coordinator.beginRun({ runId: 'scoped', actor: 'agent', documents: [] })
  expect(read(await coordinator.assetSearch('scoped', { query: '图片' })).directory.reason).toContain('未授权')
  expect(search).not.toHaveBeenCalled()
  await expect(coordinator.assetSearch('scoped', { packageId: 'com.example.package' })).rejects.toThrow('宿主服务授权')
  expect(readLibrary).not.toHaveBeenCalled()
  await coordinator.beginRun({ runId: 'files', actor: 'agent', documents: [], fileAccess: { workspaceRoot: 'D:/fixture', permission: 'read-only' } })
  await coordinator.assetSearch('files', { query: '图片' })
  await coordinator.assetSearch('files', { packageId: 'com.example.package', sourceId: 'trusted:one' })
  expect(search).toHaveBeenCalledOnce()
  expect(readLibrary).toHaveBeenCalledWith({ runId: 'files', packageId: 'com.example.package', sourceId: 'trusted:one' })
})
