// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ComponentCatalogManager } from '../../src/main/componentCatalogManager'
import { AssetLibraryService } from '../../src/main/workbench/assetSources/componentLibrarySearch'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseSurface } from '../../src/core/course/courseSurfaceStructure'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { INTERACTIONS_DEFINITION, componentInteractionDataSchema } from '../../src/shared/componentInteractionData'
import { isComponentVisibleAtSurface, type CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { DocumentResources, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const electronPaths = vi.hoisted(() => ({ userData: '', appPath: '' }))
// Only Electron process paths are controlled; archive save, directory scan/read and canonical writes are real.
vi.mock('electron', () => ({ app: { getPath: () => electronPaths.userData, getAppPath: () => electronPaths.appPath }, dialog: {} }))
const evidence = path.resolve('output/repair-library-gateway')
function data<T>(result: ToolResult): T {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as T
}
function model(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}
function content(snapshot: DocumentSnapshot) {
  const current = model(snapshot)
  return { ...current, project: { ...current.project, revision: 0 } }
}
type Saved = { status: 'saved'; packageId: string; version: string; name: string }
type SaveView = Saved | { result: Saved; diagnostics: { code: string; message: string }[] }
type EntryView = { status: 'entry'; packageId: string; version: string; title: string; kind: 'objects' | 'page' | 'structure'; rootIds: string[];
  objects: { id: string; title: string; definitionId: string; childIds?: string[]; data: unknown }[];
  pages?: { id: string; kind: string; title: string; childIds: string[] }[] }
async function record(name: string, value: unknown) {
  await fs.mkdir(evidence, { recursive: true })
  await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2), 'utf8')
}
async function fixture(source: CourseProjectV10, resources: DocumentResources, destinationAssets?: DocumentResources['assets']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'software-library-gateway-'))
  electronPaths.userData = path.join(root, 'isolated-user-data'); electronPaths.appPath = root
  const catalog = new ComponentCatalogManager(), library = new AssetLibraryService({ catalog })
  const sourceHost = new DocumentHostService(path.join(root, 'source-host')), targetHost = new DocumentHostService(path.join(root, 'target-host'))
  const connect = (host: DocumentHostService) => host.tools.configureHostServices({ assetLibrary: {
    search: ({ runId: _runId, ...input }) => library.search(input), read: ({ runId: _runId, ...input }) => library.read(input),
    save: ({ runId: _runId, ...input }) => library.save(input), delete: ({ runId: _runId, ...input }) => library.delete(input),
    import: async () => { throw new Error('This fixture does not import a foreign archive') },
  } })
  connect(sourceHost); connect(targetHost)
  const sourceSnapshot = await sourceHost.internalAPI.create({ kind: 'course-v10', project: source, resources }, '来源A.glx')
  const destination = createBlankCourseProjectV10('保留人工内容的工程B')
  destination.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  destination.theme = { css: '.manual{color:#6b21a8}' }
  destination.instances.manual = { id: 'manual', definitionId: WEB_DEFINITION.id, data: { html: '<div class="manual">保留人工布局</div>' },
    frame: { width: 250, height: 100, transform: [1, 0, 0, 1, 600, 120] } }
  destination.surfaces[0].childIds = ['manual']
  if (destinationAssets) for (const [id, bytes] of Object.entries(destinationAssets)) destination.assets[id] = {
    id, path: `assets/${id}.png`, mimeType: 'image/png', width: 4, height: 3, byteLength: bytes.byteLength,
  }
  const targetSnapshot = await targetHost.internalAPI.create({ kind: 'course-v10', project: destination,
    resources: { assets: destinationAssets ?? {}, components: {} } }, '目标B.glx')
  const begin = async (host: DocumentHostService, runId: string, snapshot: DocumentSnapshot, selected: string[] = []) => host.tools.beginRun({ runId, actor: 'agent',
    documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }], selection: selected.map(instanceId => ({ kind: 'course-instance', surfaceId: source.surfaces[0].id, instanceId })) }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  await begin(sourceHost, 'source', sourceSnapshot, source.surfaces[0].childIds)
  await begin(targetHost, 'target', targetSnapshot)
  let seq = 0
  const sourceCall = (name: string, input: unknown) => sourceHost.tools.execute('source', `source-${++seq}`, { name, input })
  const targetCall = (name: string, input: unknown) => targetHost.tools.execute('target', `target-${++seq}`, { name, input })
  const pages = async (call: typeof sourceCall) => {
    const listed = data<{ files: { path: string; type: string }[] }>(await call('project.list', {}))
    const observed: { path: string; title: string }[] = []
    for (const file of listed.files.filter(file => file.type === 'structure' && file.path.startsWith('pages/'))) {
      const read = data<{ content: string }>(await call('project.read', { path: file.path }))
      const page = JSON.parse(read.content) as { title: string }
      observed.push({ path: file.path, title: page.title })
    }
    return observed
  }
  const current = () => targetHost.internalAPI.read(targetSnapshot.documentId)
  const history = async (type: 'undo' | 'redo') => {
    const snapshot = await current()
    return targetHost.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      actor: 'human', operationId: `${type}-${++seq}`, mutation: { type } })
  }
  const closeSource = async () => { await sourceHost.tools.stop('source'); await sourceHost.registry.close(sourceSnapshot.documentId, { discardDirty: true }) }
  const persist = async (name: string) => {
    await fs.mkdir(evidence, { recursive: true })
    const file = path.join(root, name)
    await targetHost.internalAPI.save(targetSnapshot.documentId, file)
    const cold = await new DocumentHostService(path.join(root, 'cold-host')).internalAPI.open(file)
    await fs.copyFile(file, path.join(evidence, name))
    return cold
  }
  const dispose = async () => {
    await sourceHost.tools.stop('source'); await targetHost.tools.stop('target')
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture cleanup escaped temp directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
  return { root, sourceHost, targetHost, catalog, library, sourceSnapshot, targetSnapshot, destination, sourceCall, targetCall, pages, current, history, closeSource, persist, dispose }
}
async function png(color: string, width = 160, height = 100) {
  return new Uint8Array(await sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer())
}

it('public page and two-page structure save/use keep source state, remap internal navigation, preserve the destination, and retain resources after source close and cold open', async () => {
  const source = createBlankCourseProjectV10('来源A'), first = source.surfaces[0], second = createCourseSurface(source, { kind: 'slide', title: '第二页' })
  first.title = '第一页'; source.surfaces.push(second)
  source.theme = { css: '.evidence{color:#2563eb}' }
  source.definitions[WEB_DEFINITION.id] = WEB_DEFINITION; source.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  source.instances.card = { id: 'card', definitionId: WEB_DEFINITION.id, data: { html: '<button>进入第二页</button>' }, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 90, 110] } }
  source.instances.branch = { id: 'branch', definitionId: WEB_DEFINITION.id, data: { html: '<p class="evidence">第二页图片证据</p><img src="cw-resource:branch">',
    resourceBindings: { 'cw-resource:branch': 'branchAsset' } }, frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 120, 140] } }
  source.instances.globalBackground = { id: 'globalBackground', definitionId: WEB_DEFINITION.id, data: { html: '<div>第二页背景</div>' }, visibility: { mode: 'exclude', surfaceIds: [first.id] } }
  source.global.underlay = ['globalBackground']
  source.instances.nav = { id: 'nav', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: [{ id: 'rule', name: '跳转', enabled: true,
    trigger: { type: 'node.click', nodeId: 'card' }, conditions: [], actions: [{ id: 'action', start: 'after-previous', delayMs: 0,
      action: { type: 'scene.go', sceneId: second.id, targetStateId: 'second-state' } }] }] } }
  first.childIds = ['card', 'nav']; second.childIds = ['branch']
  second.presentation = { initialStateId: 'second-state', states: [{ id: 'second-state', title: '分支', overrides: { branch: { visible: true } }, order: ['branch'] }] }
  const bytes = await png('#2563eb')
  source.assets.branchAsset = { id: 'branchAsset', path: 'assets/branch.png', mimeType: 'image/png', width: 160, height: 100, byteLength: bytes.byteLength }
  const f = await fixture(source, { assets: { branchAsset: bytes }, components: {} })
  try {
    const observed = await f.pages(f.sourceCall), secondPath = observed.find(page => page.title === '第二页')!.path
    const pageSaveView = data<SaveView>(await f.sourceCall('asset.save', { scope: 'page', path: secondPath, title: '真实一页模板' }))
    const structureSaveView = data<SaveView>(await f.sourceCall('asset.save', { scope: 'structure', pages: observed.map(page => page.path), title: '真实两页结构' }))
    await record('save-receipts', { pageSaveView, structureSaveView })
    const pageSave = 'result' in pageSaveView ? pageSaveView.result : pageSaveView
    const structureSave = 'result' in structureSaveView ? structureSaveView.result : structureSaveView
    expect(pageSave.status).toBe('saved'); expect(structureSave.status).toBe('saved')
    expect(content(await f.sourceHost.internalAPI.read(f.sourceSnapshot.documentId))).toEqual(content(f.sourceSnapshot))
    expect((await f.sourceHost.internalAPI.read(f.sourceSnapshot.documentId)).undoDepth).toBe(0)
    const pageView = data<EntryView>(await f.sourceCall('asset.search', { packageId: pageSave.packageId, version: pageSave.version }))
    const structureView = data<EntryView>(await f.sourceCall('asset.search', { packageId: structureSave.packageId }))
    expect(pageView).toMatchObject({ status: 'entry', kind: 'page', pages: [{ title: '第二页' }] })
    expect(structureView).toMatchObject({ status: 'entry', kind: 'structure' }); expect(structureView.pages?.map(page => page.title)).toEqual(['第一页', '第二页'])
    await f.closeSource()
    const targetPath = (await f.pages(f.targetCall))[0].path
    expect(await f.targetCall('asset.use', { packageId: pageSave.packageId, path: targetPath })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const pageApplied = await f.current(), pageModel = model(pageApplied), template = pageModel.project.surfaces[1]
    expect(pageApplied.undoDepth).toBe(1); expect(pageModel.project.surfaces).toHaveLength(2)
    expect(template.presentation?.states[0].order).toEqual(template.childIds)
    expect(template.presentation?.initialStateId).not.toBe('second-state')
    expect(pageModel.project.instances.manual).toEqual(f.destination.instances.manual)
    expect(pageModel.project.surfaces[0]).toEqual(f.destination.surfaces[0]); expect(pageModel.project.theme).toEqual(f.destination.theme)
    // Refresh the real page path after the first insertion; no handwritten ids or disk-project edits.
    const refreshedPath = (await f.pages(f.targetCall)).find(page => page.title === f.destination.surfaces[0].title)!.path
    expect(await f.targetCall('asset.use', { packageId: structureSave.packageId, path: refreshedPath })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const applied = await f.current(), project = model(applied).project
    expect(applied.undoDepth).toBe(2); expect(project.surfaces).toHaveLength(4)
    expect(project.instances.manual).toEqual(f.destination.instances.manual); expect(project.surfaces[0]).toEqual(f.destination.surfaces[0]); expect(project.theme).toEqual(f.destination.theme)
    expect(project.surfaces.filter(surface => pageModel.project.surfaces.some(existing => existing.id === surface.id))).toEqual(pageModel.project.surfaces)
    const inserted = project.surfaces.filter(surface => !pageModel.project.surfaces.some(existing => existing.id === surface.id))
    expect(inserted.map(surface => surface.title)).toEqual(['第一页', '第二页'])
    const [insertedFirst, insertedSecond] = inserted
    const card = insertedFirst.childIds.find(id => project.instances[id].definitionId !== INTERACTIONS_DEFINITION.id &&
      (project.instances[id].data as { html?: string }).html?.includes('进入第二页'))!
    const navId = insertedFirst.childIds.find(id => project.definitions[project.instances[id].definitionId].implementation.kind === 'builtin' &&
      (project.definitions[project.instances[id].definitionId].implementation as { key: string }).key === 'guoling.interactions')!
    const rule = componentInteractionDataSchema.parse(project.instances[navId].data).rules[0]
    expect(rule.trigger).toEqual({ type: 'node.click', nodeId: card })
    expect(rule.actions[0].action).toEqual({ type: 'scene.go', sceneId: insertedSecond.id, targetStateId: insertedSecond.presentation!.initialStateId })
    expect(insertedSecond.presentation!.states[0].order).toEqual(insertedSecond.childIds)
    expect([insertedFirst.id, insertedSecond.id]).not.toContain(first.id); expect([insertedFirst.id, insertedSecond.id]).not.toContain(second.id)
    for (const id of project.global.underlay) {
      const background = project.instances[id]
      expect(isComponentVisibleAtSurface(background, project.surfaces[0].id)).toBe(false)
      expect(isComponentVisibleAtSurface(background, insertedFirst.id)).toBe(false)
    }
    expect(project.global.underlay.some(id => isComponentVisibleAtSurface(project.instances[id], insertedSecond.id))).toBe(true)
    for (const assetBytes of Object.values(model(applied).resources.assets)) expect(await sharp(assetBytes).metadata()).toMatchObject({ width: 160, height: 100 })
    expect(Object.values(model(applied).resources.assets)).toHaveLength(2)
    expect(await f.history('undo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(pageApplied))
    expect(await f.history('undo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(f.targetSnapshot))
    expect(await f.history('redo')).toMatchObject({ status: 'applied' }); expect(await f.history('redo')).toMatchObject({ status: 'applied' })
    const final = await f.current(), cold = await f.persist('public-library-structure.glx')
    expect(cold.model).toEqual(final.model)
    const copiedBranch = model(cold).project.instances[insertedSecond.childIds[0]], binding = Object.values((copiedBranch.data as { resourceBindings: Record<string, string> }).resourceBindings)[0]
    const decoded = await sharp(model(cold).resources.assets[binding]).raw().toBuffer({ resolveWithObject: true })
    expect(Array.from(decoded.data.subarray(0, 3))).toEqual([37, 99, 235])
    await record('page-structure', { observed, pageSaveView, structureSaveView, pageView, structureView,
      appliedRevision: applied.revision, undoDepth: applied.undoDepth, template, insertedFirst, insertedSecond, rule,
      manual: project.instances.manual, sourceClosedBeforeUse: true, coldRevision: cold.revision, decoded: decoded.info })
  } finally { await f.dispose() }
})

it('public entry discovery and rootIds selection insert only the chosen object with its real resource closure and one History', async () => {
  const source = createBlankCourseProjectV10('对象来源A')
  source.definitions.code = { id: 'code', title: '两个分支程序', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: 'export default {mount(ctx){ctx.resources.url("used");ctx.resources.url("branch");return {dispose(){}}}}' } }
  source.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  source.instances.code = { id: 'code', definitionId: 'code', name: '需要选择的程序', data: {}, frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 80, 100] } }
  source.instances.other = { id: 'other', definitionId: WEB_DEFINITION.id, name: '不要插入的对象', data: { html: '<img src="cw-resource:other">', resourceBindings: { 'cw-resource:other': 'unrelated' } } }
  source.surfaces[0].childIds = ['code', 'other']
  const assets = { used: await png('#e6a02b', 8, 6), branch: await png('#2563eb', 8, 6), unrelated: await png('#999999', 8, 6) }
  for (const [id, bytes] of Object.entries(assets)) source.assets[id] = { id, path: `assets/${id}.png`, mimeType: 'image/png', width: 8, height: 6, byteLength: bytes.byteLength }
  const destinationOnly = await png('#008844', 4, 3), f = await fixture(source, { assets, components: {} }, { destinationOnly })
  try {
    const saved = data<Saved>(await f.sourceCall('asset.save', { scope: 'objects', title: '两个可选对象' }))
    expect(saved.status).toBe('saved')
    const entry = data<EntryView>(await f.targetCall('asset.search', { packageId: saved.packageId }))
    expect(entry).toMatchObject({ status: 'entry', kind: 'objects' }); expect(entry.rootIds).toHaveLength(2)
    const selected = entry.objects.find(object => object.title === '需要选择的程序')!
    expect(selected).toBeTruthy(); expect(entry.rootIds).toContain(selected.id)
    await f.closeSource()
    const targetPath = (await f.pages(f.targetCall))[0].path
    expect(await f.targetCall('asset.use', { packageId: saved.packageId, path: targetPath, rootIds: [selected.id] })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const applied = await f.current(), current = model(applied)
    expect(applied.undoDepth).toBe(1); expect(current.project.surfaces[0].childIds).toHaveLength(2)
    expect(current.project.instances.manual).toEqual(f.destination.instances.manual)
    const copied = current.project.instances[current.project.surfaces[0].childIds[1]]
    expect(copied.name).toBe('需要选择的程序'); expect(copied.id).not.toBe(selected.id); expect(copied.frame).toEqual(source.instances.code.frame)
    expect(Object.values(current.project.instances).some(instance => instance.name === '不要插入的对象')).toBe(false)
    const implementation = current.project.definitions[copied.definitionId].implementation
    expect(implementation.kind).toBe('source')
    if (implementation.kind !== 'source') throw new Error('Expected source implementation')
    const bound = Object.values(implementation.resourceBindings ?? {})
    expect(bound).toHaveLength(2); expect(bound).not.toContain('destinationOnly')
    expect(Object.keys(current.resources.assets)).toHaveLength(3)
    expect(current.resources.assets.destinationOnly).toEqual(destinationOnly)
    const copiedPixels: number[][] = []
    for (const assetId of bound) {
      const decoded = await sharp(current.resources.assets[assetId]).raw().toBuffer({ resolveWithObject: true })
      copiedPixels.push(Array.from(decoded.data.subarray(0, 3)))
    }
    expect(copiedPixels).toEqual(expect.arrayContaining([[230, 160, 43], [37, 99, 235]])); expect(copiedPixels).not.toContainEqual([153, 153, 153])
    expect(await f.history('undo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(f.targetSnapshot))
    expect(await f.history('redo')).toMatchObject({ status: 'applied' }); expect(content(await f.current())).toEqual(content(applied))
    const final = await f.current(), cold = await f.persist('public-library-subset.glx'); expect(cold.model).toEqual(final.model)
    await record('object-subset', { saved, entry, selected, copied, implementation, copiedPixels, appliedRevision: applied.revision,
      undoDepth: applied.undoDepth, assetIds: Object.keys(current.resources.assets), coldRevision: cold.revision, sourceClosedBeforeUse: true })
  } finally { await f.dispose() }
})
