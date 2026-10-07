// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { ComponentCatalogManager } from '../../../../src/main/componentCatalogManager'
import { AssetLibraryService } from '../../../../src/main/workbench/assetSources/componentLibrarySearch'
import { exportComponentLibraryArchive } from '../../../../src/core/components/library/archive'
import type { ToolResult } from '../../../../src/shared/workbench/tools'

const electronPaths = vi.hoisted(() => ({ userData: '', appPath: '' }))
// Only Electron's process paths are substituted. The catalog scan/install/delete uses actual files.
vi.mock('electron', () => ({ app: { getPath: () => electronPaths.userData, getAppPath: () => electronPaths.appPath }, dialog: {} }))
function data(result: ToolResult): any {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  return (result as { data: any }).data
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }

it('the public V10 asset tools save all frozen selections and retain actual content frames and resources through import insertion update deletion and cold reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-library-selection-'))
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
  electronPaths.userData = path.join(directory, 'user-data'); electronPaths.appPath = directory
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const catalog = new ComponentCatalogManager(), library = new AssetLibraryService({ catalog })
  host.tools.configureHostServices({ assetLibrary: { search: input => library.search(input), read: input => library.read(input),
    save: ({ runId: _runId, ...input }) => library.save(input), delete: ({ runId: _runId, ...input }) => library.delete(input),
    import: async ({ runId, file }) => library.import((await host.agentFiles.readAuthorizedFile({ runId, workspaceRoot: workspace, permission: 'workspace' }, file)).bytes) } })
  const project = createBlankCourseProjectV10('多选素材课件')
  const surfaceId = project.surfaces[0].id; project.surfaces[0].title = '素材演示'
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.lesson = { id: 'lesson', title: '资料卡', role: 'content', version: '1.0.0',
    implementation: { kind: 'source', language: 'typescript', workspace: { ownerId: 'lesson-code', entry: 'main.ts' } } }
  const frame = { width: 180, height: 90, transform: [1, 0, 0, 1, 42, 67] as [number, number, number, number, number, number] }
  const localOverride = { kind: 'source' as const, language: 'javascript' as const,
    source: 'export default {mount({root,instance}){root.textContent=instance.data.label;return{update(){},dispose(){}}}}' }
  project.instances.first = { id: 'first', definitionId: 'lesson', data: { label: '甲资料正文', assetId: 'photo' }, frame, style: { opacity: 0.8 }, implementationOverride: localOverride }
  project.instances.second = { id: 'second', definitionId: 'lesson', data: { label: '乙资料正文', assetId: 'photo' }, frame: { ...frame, transform: [1, 0, 0, 1, 280, 96] }, style: { opacity: 0.6 } }
  project.instances.neighbor = { id: 'neighbor', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('未选邻居'), frame: { ...frame, transform: [1, 0, 0, 1, 510, 43] } }
  project.surfaces[0].childIds = ['first', 'second', 'neighbor']
  project.assets.photo = { id: 'photo', path: 'assets/photo.png', mimeType: 'image/png', width: 8, height: 6 }
  const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#1a78b0' } }).png().toBuffer()
  const resources = { assets: { photo: Uint8Array.from(png) }, components: { 'lesson-code': {
    'main.ts': new TextEncoder().encode("import {word} from './helper'; export default {mount({root,instance}){root.textContent=word+instance.data.label;return{update(){},dispose(){}}}}"),
    'helper.ts': new TextEncoder().encode("export const word='原实现';"),
  } } }
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources }, '多选课件.h5lesson')
  const runId = 'library-selection'
  const call = (id: string, name: string, input: unknown) => host.tools.execute(runId, id, { name, input })
  try {
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }],
      selection: [{ kind: 'course-instance', surfaceId, instanceId: 'first' }, { kind: 'course-instance', surfaceId, instanceId: 'second' }] }],
      fileAccess: { workspaceRoot: workspace, permission: 'workspace' } })
    // No tools.load or private asset handler: these are the actual authorized default run tools.
    const advertised = await host.tools.describe(['asset.save', 'asset.import', 'asset.use', 'asset.update', 'asset.delete'])
    for (const name of ['asset.save', 'asset.import', 'asset.use', 'asset.update', 'asset.delete']) expect(advertised.some(value => value.name === name), name).toBe(true)
    const saved = data(await call('save-selection', 'asset.save', { title: '双对象资料', description: '教师明确要求保存当前多选' }))
    expect(saved).toMatchObject({ status: 'saved', name: '双对象资料' })
    expect((await host.internalAPI.read(initial.documentId)).undoDepth).toBe(0)
    const found = data(await call('search-saved', 'asset.search', { query: '双对象资料' })).candidates.find((value: any) => value.packageId === saved.packageId)
    expect(found).toMatchObject({ removable: true })
    const archived = await library.read({ packageId: found.packageId, version: found.version, sourceId: found.sourceId })
    expect(archived.status).toBe('ready')
    if (archived.status !== 'ready') throw new Error('Saved library entry required')
    const entry = archived.entry
    expect(entry.example.rootIds.map(id => entry.example.instances[id].data.label)).toEqual(['甲资料正文', '乙资料正文'])
    expect(entry.example.rootIds.map(id => entry.example.instances[id].frame)).toEqual([project.instances.first.frame, project.instances.second.frame])
    expect(entry.example.rootIds.map(id => entry.example.instances[id].style)).toEqual([project.instances.first.style, project.instances.second.style])
    expect(Object.values(entry.example.instances).some(value => value.data?.label === '未选邻居')).toBe(false)
    expect(Object.values(entry.resources.components).some(files => Object.keys(files).includes('helper.ts'))).toBe(true)
    expect(await sharp(Object.values(entry.resources.assets)[0]).metadata()).toMatchObject({ width: 8, height: 6 })
    const files = data(await call('list-project', 'project.list', {})).files as Array<{ path: string }>
    const page = files.find(value => /素材演示\.json$/.test(value.path))
    expect(page, JSON.stringify(files)).toBeTruthy()
    applied(await call('use-saved', 'asset.use', { packageId: saved.packageId, path: page!.path }))
    const inserted = await host.internalAPI.read(initial.documentId)
    if (inserted.model.kind !== 'course-v10') throw new Error('V10 required')
    const appended = inserted.model.project.surfaces[0].childIds.slice(3)
    expect(appended).toHaveLength(2)
    expect(appended.some(id => ['first', 'second'].includes(id))).toBe(false)
    expect(appended.map(id => inserted.model.project.instances[id].data.label)).toEqual(['甲资料正文', '乙资料正文'])
    expect(inserted.undoDepth).toBe(1)
    const revised = structuredClone(entry)
    for (const definition of Object.values(revised.definitions)) {
      definition.version = '1.0.1'
      if (definition.implementation.kind === 'source' && definition.implementation.workspace) {
        const owner = definition.implementation.workspace.ownerId
        revised.resources.components[owner]['helper.ts'] = new TextEncoder().encode("export const word='新版实现';")
      }
    }
    const importFile = path.join(workspace, '教师提供的新版.h5component')
    await fs.writeFile(importFile, exportComponentLibraryArchive(revised, '1.0.1'))
    expect(data(await call('import-new-version', 'asset.import', { file: importFile }))).toMatchObject({ status: 'imported', packageId: saved.packageId, version: '1.0.1' })
    const newCandidate = data(await call('search-new-version', 'asset.search', { query: '双对象资料' })).candidates.find((value: any) => value.packageId === saved.packageId)
    expect(newCandidate.version).toBe('1.0.1')
    applied(await call('update-selected', 'asset.update', { packageId: newCandidate.packageId, version: newCandidate.version }))
    const updated = await host.internalAPI.read(initial.documentId)
    if (updated.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(updated.undoDepth).toBe(2)
    for (const id of ['first', 'second', 'neighbor']) expect(updated.model.project.instances[id]).toEqual(project.instances[id])
    const replacement = updated.model.project.definitions[updated.model.project.instances.second.definitionId]
    expect(replacement.version).toBe('1.0.1')
    if (replacement.implementation.kind !== 'source' || !replacement.implementation.workspace) throw new Error('Updated shared source workspace required')
    expect(new TextDecoder().decode(updated.model.resources.components[replacement.implementation.workspace.ownerId]['helper.ts'])).toContain('新版实现')
    expect(data(await call('delete-new-version', 'asset.delete', { packageId: newCandidate.packageId, version: newCandidate.version, sourceId: newCandidate.sourceId }))).toMatchObject({ status: 'deleted', version: '1.0.1' })
    expect((await library.read({ packageId: newCandidate.packageId, version: '1.0.1' })).status).toBe('rejected')
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ undoDepth: 2, model: updated.model })
    await fs.access(importFile)
    const filename = path.join(directory, 'saved.h5lesson'); await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    expect(reopened.model).toEqual(updated.model)
    const head = await host.internalAPI.read(initial.documentId)
    expect(await host.internalAPI.dispatch({ documentId: head.documentId, epoch: head.epoch, baseRevision: head.revision, actor: 'human', operationId: 'undo-library-update', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = await host.internalAPI.read(initial.documentId)
    expect(undone).toMatchObject({ model: { project: { definitions: { lesson: project.definitions.lesson }, instances: { first: project.instances.first, second: project.instances.second } } } })
  } finally { await host.tools.stop(runId); if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory'); await fs.rm(directory, { recursive: true, force: true }) }
})
