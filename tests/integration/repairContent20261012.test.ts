// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { setRootContainers, appendRootContainers, testContainerInstance } from '../helpers/glxWorkFixture'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseSurface } from '../../src/core/course/courseSurfaceStructure'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { courseAuthorData } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { INTERACTIONS_DEFINITION, componentInteractionDataSchema } from '../../src/shared/componentInteractionData'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion, sourceResourceReferences } from '../../src/core/components/library'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { isComponentVisibleAtSurface } from '../../src/shared/contracts/component-platform'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'

async function setup(project: CourseProjectV10, resources = { assets: {}, components: {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-repair-'))
  const host = new DocumentHostService(path.join(root, 'state'))
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources }, 'content.glx')
  await host.tools.beginRun({ runId: 'author', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: root } })
  await host.tools.loadToolFamilies('author', ['content'])
  const read = async () => {
    const value = await host.internalAPI.read(snapshot.documentId)
    if (value.model.kind !== 'course-v10') throw new Error('Expected course')
    return { snapshot: value, ...value.model }
  }
  const tool = (name: string, input: unknown) => host.tools.execute('author', randomUUID(), { name, input })
  const history = async (type: 'undo' | 'redo') => {
    const { snapshot: current } = await read()
    return host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      actor: 'human', operationId: randomUUID(), mutation: { type } })
  }
  const cold = async (label?: string) => {
    const filename = path.join(root, 'saved.glx')
    await host.internalAPI.save(snapshot.documentId, filename)
    if (label) {
      const directory = path.resolve('output/repair-content/fixtures')
      await fs.mkdir(directory, { recursive: true }); await fs.copyFile(filename, path.join(directory, label + '.glx'))
    }
    return new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename)
  }
  const dispose = async () => { await host.tools.stop('author'); await fs.rm(root, { recursive: true, force: true }) }
  return { root, host, snapshot, read, tool, history, cold, dispose }
}

it('creates all mixed page targets in one public call and history entry, then saves and cold opens', async () => {
  const project = createBlankCourseProjectV10('人工工程')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.manual = { id: 'manual', definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextData('原有文字')) }
  testContainerInstance(project, 0).childIds.push('manual')
  const test = await setup(project)
  try {
    await test.tool('project.read', { path: 'pages' })
    const result = await test.tool('project.apply', { path: 'pages', intent: 'surface.add', pages: [
      { kind: 'slide' }, { kind: 'flow', title: '讲义' }, { kind: 'spatial', title: '地图' }, { kind: 'slide' },
    ] })
    expect(result).toMatchObject({ kind: 'read', data: { commit: 'committed', targets: expect.any(Array) } })
    const targets = (result as any).data.targets
    expect(targets).toHaveLength(4)
    expect(new Set(targets.map((target: any) => target.path)).size).toBe(4)
    let model = await test.read()
    expect(model.snapshot.undoDepth).toBe(1)
    expect(componentSurfaces(model.project).map(surface => surface.kind)).toEqual(['slide', 'slide', 'flow', 'spatial', 'slide'])
    expect(componentSurfaces(model.project).filter(surface => surface.kind === 'slide').map(surface => surface.title)).toEqual(['第 1 页', '第 2 页', '第 3 页'])
    for (const target of targets) {
      expect(componentSurfaces(model.project)[target.order]).toMatchObject({ id: target.surfaceId, kind: target.kind, title: target.title })
      const read = await test.tool('project.read', { path: target.path })
      expect(read).toMatchObject({ kind: 'read', data: { content: expect.any(String) } })
      expect(JSON.parse((read as any).data.content)).toMatchObject({ title: target.title, kind: target.kind })
      expect(await test.tool('project.apply', { path: target.path, intent: 'surface.title', title: target.title })).toMatchObject({ kind: 'read', data: { commit: 'unchanged' } })
    }
    await test.history('undo'); expect(componentSurfaces((await test.read()).project)).toEqual(componentSurfaces(project))
    await test.history('redo'); model = await test.read()
    expect(model.project.instances.manual).toEqual(project.instances.manual)
    expect((await test.cold('batch-pages')).model).toEqual(model.snapshot.model)
  } finally { await test.dispose() }
})

it('redo of independent HTML preserves original object/frame, external rules, state and attachments through undo/save', async () => {
  const project = createBlankCourseProjectV10('局部重做')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  const frame = { width: 380, height: 210, transform: [1, 0, 0, 1, 40, 60] as [number, number, number, number, number, number] }
  project.instances.target = { id: 'target', definitionId: WEB_DEFINITION.id, data: { html: '<section>原内容</section>' }, frame, childIds: ['old-child'],
    attachments: [{ instanceId: 'behavior', target: { kind: 'instance', instanceId: 'target' } }] }
  project.instances['old-child'] = { id: 'old-child', definitionId: WEB_DEFINITION.id, data: { html: '<span>旧子节点</span>' }, frame: { ...frame, transform: [1, 0, 0, 1, 5, 5] } }
  project.instances.neighbor = { id: 'neighbor', definitionId: WEB_DEFINITION.id, data: { html: '<button>外部控制</button>' }, frame: { ...frame, transform: [1, 0, 0, 1, 600, 80] } }
  project.instances.behavior = { id: 'behavior', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: [{ id: 'r', name: '外部控制', enabled: true,
    trigger: { type: 'node.click', nodeId: 'neighbor' }, conditions: [], actions: [{ id: 'a', start: 'after-previous', delayMs: 0, action: { type: 'node.exit', nodeId: 'target', durationMs: 0, easing: 'linear', effect: 'none' } }] }] } }
  testContainerInstance(project, 0).childIds = ['target', 'neighbor', 'behavior']
  testContainerInstance(project, 0).container.presentation = { states: [{ id: 's', title: '强调', overrides: { target: { visible: false } }, order: ['neighbor', 'target', 'behavior'] }] }
  const test = await setup(project)
  try {
    const file = componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === 'target')!
    await test.tool('project.read', { path: file.path })
    expect(await test.tool('project.apply', { path: file.path, edits: [{ old: '旧子节点', new: '投影修改有效' }] })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect((await test.read()).project.instances['old-child'].data).toMatchObject({ html: expect.stringContaining('投影修改有效') })
    await test.history('undo'); expect((await test.read()).project.instances).toEqual(project.instances)
    await test.tool('project.read', { path: file.path })
    const html = '<!doctype html><html><body><button id="advance">预测</button><button id="back">返回</button><button id="reset">清空</button><output id="result">待预测</output><script>const result=document.querySelector("#result");document.querySelector("#advance").onclick=()=>result.textContent="反馈";document.querySelector("#back").onclick=()=>result.textContent="待预测";document.querySelector("#reset").onclick=()=>result.textContent=""</script></body></html>'
    const result = await test.tool('project.apply', { path: file.path, intent: 'redo', content: html })
    expect((result as any).data.commit, JSON.stringify(result)).toBe('committed')
    let model = await test.read()
    expect(model.project.instances.target.frame).toEqual(frame)
    expect(model.project.instances.target.attachments).toEqual(project.instances.target.attachments)
    expect(model.project.instances.neighbor).toEqual(project.instances.neighbor)
    expect(model.project.instances.behavior).toEqual(project.instances.behavior)
    expect(componentSurfaces(model.project)[0].presentation).toEqual(componentSurfaces(project)[0].presentation)
    expect(model.project.instances['old-child']).toBeUndefined()
    expect(model.project.instances.target.data).toMatchObject({ html: expect.stringContaining('advance') })
    await test.history('undo'); expect((await test.read()).project.instances).toEqual(project.instances)
    await test.history('redo'); model = await test.read()
    expect((await test.cold('redo-program')).model).toEqual(model.snapshot.model)
  } finally { await test.dispose() }
})

it('pagination continues its captured revision and refreshes Markdown/HTML from offset zero', async () => {
  const project = createBlankCourseProjectV10('分页')
  setRootContainers(project, [createCourseSurface(project, { kind: 'flow', title: '讲义' })])
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextData('首段内容连续。'.repeat(40) + '旧史料')) }
  testContainerInstance(project, 0).childIds = ['body']
  const test = await setup(project)
  try {
    const file = componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.binding?.kind === 'flow' && file.path.endsWith('.md'))!
    const first = await test.tool('project.read', { path: file.path, limit: 25 })
    expect(first).toMatchObject({ kind: 'read', data: { revision: 0, currentRevision: 0, nextOffset: 25 } })
    expect(await test.tool('project.apply', { path: file.path, edits: [{ old: '旧史料', new: '新增史料' }] })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const old = await test.tool('project.read', { path: file.path, offset: 25 })
    expect(old).toMatchObject({ kind: 'read', data: { revision: 0, currentRevision: 1, staleSnapshot: true, content: expect.stringContaining('旧史料'), next: expect.stringContaining('refresh') } })
    const fresh = await test.tool('project.read', { path: file.path, offset: 0 })
    expect(fresh).toMatchObject({ kind: 'read', data: { revision: 1, currentRevision: 1, content: expect.stringContaining('新增史料') } })
    const html = file.path.replace(/\.md$/, '.html')
    expect(await test.tool('project.read', { path: html })).toMatchObject({ kind: 'read', data: { revision: 1, content: expect.stringContaining('新增史料') } })
  } finally { await test.dispose() }
})

it('extracts closed source assets and selected subtree without losing dynamic resource API semantics', () => {
  const project = createBlankCourseProjectV10('资源闭包')
  project.assets = Object.fromEntries(['used', 'branch', 'unrelated'].map(id => [id, { id, path: `assets/${id}.png`, mimeType: 'image/png' }]))
  project.definitions.code = { id: 'code', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(ctx){ctx.resources.url("used");ctx.resources.url("branch")}}' } }
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.code = { id: 'code', definitionId: 'code', data: {} }
  project.instances.other = { id: 'other', definitionId: WEB_DEFINITION.id, data: { html: '<img src="cw-resource:other">', resourceBindings: { 'cw-resource:other': 'unrelated' } } }
  testContainerInstance(project, 0).childIds = ['code', 'other']
  const resources = { assets: Object.fromEntries(Object.keys(project.assets).map(id => [id, new Uint8Array([1])])), components: {} }
  const extracted = extractComponentLibraryEntry(project, resources, { id: 'library', title: '程序', rootIds: ['code', 'other'] })
  const destination = createBlankCourseProjectV10('目标')
  destination.assets.destinationOnly = { id: 'destinationOnly', path: 'assets/destination.png' }
  const insertion = prepareComponentLibraryInsertion(destination, extracted.entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 0, rootIds: ['code'] })
  const copied = applyComponentOperation(destination, insertion.command)
  expect(insertion.identities.instances.has('other')).toBe(false)
  expect(insertion.identities.assets.has('unrelated')).toBe(false)
  expect(insertion.identities.assets.has('used')).toBe(true)
  expect(insertion.identities.assets.has('branch')).toBe(true)
  expect(Object.values(copied.definitions).filter(definition => definition.implementation.kind === 'source').flatMap(definition => Object.values((definition.implementation as any).resourceBindings ?? {}))).not.toContain('destinationOnly')
  expect(sourceResourceReferences({ kind: 'source', language: 'javascript', source: 'export default {mount(ctx){return ctx.resources.url(ctx.instance.data.choice)}}' }, project).dynamic).toBe(true)
  expect(sourceResourceReferences({ kind: 'source', language: 'javascript', source: 'export default {mount(ctx){return ctx.resources.url(ctx.instance.data.choice)}}' }, project).assetIds).toEqual(expect.arrayContaining(['used', 'branch', 'unrelated']))
  for (const source of ['export default {mount({resources: assets,instance}){return assets.url(instance.data.choice)}}',
    'export default {mount(ctx){const {resources: assets}=ctx; return assets.url(ctx.instance.data.choice)}}',
    'export default {mount(ctx){const url=ctx.resources.url; return url(ctx.instance.data.choice)}}']) {
    const references = sourceResourceReferences({ kind: 'source', language: 'javascript', source }, project)
    expect(references.dynamic).toBe(true)
    expect(references.assetIds).toEqual(expect.arrayContaining(['used', 'branch', 'unrelated']))
  }
})

it('round trips two page author structure, remaps navigation/state/resources and keeps destination content with one transaction', async () => {
  const source = createBlankCourseProjectV10('来源')
  const first = componentSurfaces(source)[0]
  const second = createCourseSurface(source, { kind: 'slide', title: '第二页' })
  source.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  source.definitions[INTERACTIONS_DEFINITION.id] = INTERACTIONS_DEFINITION
  source.instances.card = { id: 'card', definitionId: WEB_DEFINITION.id, data: { html: '<button>进入第二页</button>' }, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 90, 110] } }
  source.instances.branch = { id: 'branch', definitionId: WEB_DEFINITION.id, data: { html: '<p>第二页依赖图片</p><img width="160" height="100" src="cw-resource:branch">', resourceBindings: { 'cw-resource:branch': 'branchAsset' } }, frame: { width: 300, height: 200, transform: [1, 0, 0, 1, 120, 140] } }
  source.instances.globalBackground = { id: 'globalBackground', definitionId: WEB_DEFINITION.id, data: { html: '<div>第二页背景</div>' }, visibility: { mode: 'exclude', surfaceIds: [first.id] } }
  source.global.underlay = ['globalBackground']
  source.instances.nav = { id: 'nav', definitionId: INTERACTIONS_DEFINITION.id, data: { rules: [{ id: 'rule', name: '跳转', enabled: true,
    trigger: { type: 'node.click', nodeId: 'card' }, conditions: [], actions: [{ id: 'action', start: 'after-previous', delayMs: 0, action: { type: 'scene.go', sceneId: second.id, targetStateId: 'second-state' } }] }] } }
  testContainerInstance(source, first.id).childIds = ['card', 'nav']; second.childIds = ['branch']
  second.presentation = { initialStateId: 'second-state', states: [{ id: 'second-state', title: '分支', overrides: { branch: { visible: true } }, order: ['branch'] }] }
  appendRootContainers(source, second)
  const image = new Uint8Array(await sharp({ create: { width: 160, height: 100, channels: 4, background: '#2563eb' } }).png().toBuffer())
  source.assets.branchAsset = { id: 'branchAsset', path: 'assets/branch.png', mimeType: 'image/png', width: 160, height: 100, byteLength: image.length }
  const resources = { assets: { branchAsset: image }, components: {} }
  const extracted = extractComponentLibraryEntry(source, resources, { id: 'structure', title: '两页结构', kind: 'structure', surfaceIds: [first.id, second.id] })
  const page = extractComponentLibraryEntry(source, resources, { id: 'page', title: '一页模板', kind: 'page', surfaceIds: [second.id] }).entry
  expect(importComponentLibraryArchive(exportComponentLibraryArchive(page)).entry.example.instances[second.id].container?.presentation).toEqual(second.presentation)
  const entry = importComponentLibraryArchive(exportComponentLibraryArchive(extracted.entry)).entry
  await fs.mkdir(path.resolve('output/repair-content/fixtures'), { recursive: true })
  await fs.writeFile(path.resolve('output/repair-content/fixtures/two-page-structure.h5component'), exportComponentLibraryArchive(entry))
  await fs.writeFile(path.resolve('output/repair-content/fixtures/page-template.h5component'), exportComponentLibraryArchive(page))
  const destination = createBlankCourseProjectV10('目标')
  destination.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  destination.instances.manual = { id: 'manual', definitionId: WEB_DEFINITION.id, data: { html: '<div>保留人工布局</div>' }, frame: { width: 250, height: 100, transform: [1, 0, 0, 1, 600, 120] } }
  testContainerInstance(destination, 0).childIds = ['manual']
  const test = await setup(destination)
  try {
    const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: componentSurfaces(destination)[0].id }, index: 1 })
    expect(insertion.diagnostics).toEqual([])
    expect(await test.host.internalAPI.dispatch({ documentId: test.snapshot.documentId, epoch: test.snapshot.epoch, baseRevision: 0,
      actor: 'human', operationId: randomUUID(), mutation: { type: 'command', command: insertion.command } })).toMatchObject({ status: 'applied' })
    let model = await test.read()
    expect(model.snapshot.undoDepth).toBe(1)
    expect(componentSurfaces(model.project)).toHaveLength(3)
    expect(componentSurfaces(model.project)[0]).toEqual(componentSurfaces(destination)[0])
    expect(model.project.instances.manual).toEqual(destination.instances.manual)
    const copiedSecond = componentSurfaces(model.project)[2]
    const background = model.project.instances[insertion.identities.instances.get('globalBackground')!]
    expect(isComponentVisibleAtSurface(background, componentSurfaces(model.project)[1].id)).toBe(false)
    expect(isComponentVisibleAtSurface(background, copiedSecond.id)).toBe(true)
    expect(isComponentVisibleAtSurface(background, componentSurfaces(destination)[0].id)).toBe(false)
    const nav = model.project.instances[insertion.identities.instances.get('nav')!]
    expect(componentInteractionDataSchema.parse(nav.data).rules[0].actions[0].action).toEqual({ type: 'scene.go', sceneId: copiedSecond.id, targetStateId: copiedSecond.presentation!.initialStateId })
    expect(copiedSecond.presentation!.states[0].order).toEqual([insertion.identities.instances.get('branch')])
    expect(Object.values(model.resources.assets)).toEqual([resources.assets.branchAsset])
    await test.history('undo'); expect((await test.read()).project).toMatchObject({ rootIds: destination.rootIds, entry: destination.entry, instances: destination.instances })
    await test.history('redo'); model = await test.read()
    expect((await test.cold('library-structure')).model).toEqual(model.snapshot.model)
  } finally { await test.dispose() }
})

it('keeps every assembled root under the original redo identity and frame', () => {
  const project = createBlankCourseProjectV10('多个根')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.original = { id: 'original', definitionId: WEB_DEFINITION.id, data: { html: '<div>旧内容</div>' },
    frame: { width: 400, height: 200, transform: [1, 0, 0, 1, 70, 100] } }
  testContainerInstance(project, 0).childIds = ['original']
  let serial = 0
  const plan = planContentApply({ project, createId: () => `new-${++serial}`, request: { intent: 'redo', target: { kind: 'instance', instanceId: 'original' }, source: {
    kind: 'objects', objects: ['第一部分', '第二部分'].map(text => ({ definitionId: WEB_DEFINITION.id, data: { html: `<button>${text}</button>` },
      frame: { width: 180, height: 80, transform: [1, 0, 0, 1, 10, text === '第一部分' ? 0 : 100] } })) } } })
  const applied = applyComponentOperation(project, plan.command)
  expect(plan.command.edits.some(edit => edit.type === 'instance.remove' && edit.instanceId === 'original')).toBe(false)
  expect(applied.instances.original.frame).toEqual(project.instances.original.frame)
  expect(applied.instances.original.childIds).toHaveLength(2)
  expect(applied.instances.original.childIds!.map(id => applied.instances[id].data)).toEqual([{ html: '<button>第一部分</button>' }, { html: '<button>第二部分</button>' }])
  expect(componentSurfaces(applied)[0].childIds).toEqual(['original'])
  const single = planContentApply({ project, createId: () => `one-${++serial}`, request: { intent: 'redo', target: { kind: 'instance', instanceId: 'original' }, source: {
    kind: 'objects', objects: [{ definitionId: WEB_DEFINITION.id, data: { html: '<button>新内容</button>' }, style: { position: 'absolute', width: '900px', color: 'red' } }] } } })
  const normalized = applyComponentOperation(project, single.command).instances.original
  expect(normalized.frame).toEqual(project.instances.original.frame)
  expect(normalized.style).toEqual({ color: 'red' })
})
