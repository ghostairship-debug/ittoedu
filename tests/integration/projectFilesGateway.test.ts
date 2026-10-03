// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { findCompositionNode, walkComposition } from '../../src/shared/composition/content'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
const driver = new CourseV9Driver()
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})

function blank(): CourseModel {
  return { kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), resources: { assets: {}, components: {} } }
}
function applied(result: ToolResult) {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (result.kind !== 'document-operation') throw new Error('ACK')
  return result
}
function data<T = Record<string, unknown>>(result: ToolResult): T {
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' })
  if (result.kind !== 'read') throw new Error('read')
  return result.data as T
}

async function harness(options: { models?: CourseModel[]; writable?: ToolTarget[]; admission?: BuildAdmissionPort
  readFile?: NonNullable<HostToolServices['projectFiles']>['readFile']; unopened?: { model: CourseModel; writable: boolean } } = {}) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const models = options.models ?? [blank()]
  const sessions = await Promise.all(models.map((model, index) => registry.create(model, index ? `第${index + 1}课.h5lesson` : '四季.h5lesson')))
  const unopened = options.unopened && await registry.create(options.unopened.model, '新课.h5lesson')
  const services: HostToolServices = { projectFiles: { parsePage: parseWebComposition, ...(options.readFile ? { readFile: options.readFile } : {}),
    ...(unopened ? { openProject: async ({ path: requested }) => {
      if (requested !== '课程/新课.h5lesson') throw new Error('没有这个课件')
      return { documentId: unopened.documentId, writable: options.unopened!.writable }
    } } : {}) } }
  if (options.admission) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-build-')); roots.push(root)
    services.builds = new ControlledBuildService({ directory: path.join(root, 'scratch'), admission: options.admission })
  }
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++id), { services, prepareImage: prepareImageResource })
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: sessions.map(session => ({ documentId: session.documentId, writable: options.writable ?? [{ kind: 'document' }] })) })
  const session = sessions[0]!
  return { gateway, session, sessions, unopened,
    call: (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input }),
    project: () => (session.read().model as CourseModel).project,
    files: async () => data<{ files: { path: string; type: string; note?: string }[] }>(await gateway.execute('r', `list-${++id}`, { name: 'project.list', input: {} })).files,
    pages: async () => data<{ files: { path: string; type: string; note?: string }[] }>(await gateway.execute('r', `list-${++id}`, { name: 'project.list', input: {} })).files.filter(file => file.path.startsWith('slides/')) }
}

function pageLayer(model: CourseModel['project'], index = 0) {
  const slide = model.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('slide')
  return slide.scenes[index]!.layerItems[0]!
}

const PAGE = '<!doctype html><html><head><style>h1 { color: #1d4ed8 }</style></head><body><h1 class="fragment">四季的成因</h1><p>导入</p><p>导入</p></body></html>'

/** An injected port verifies the lifecycle, not real-host rendering (as in the controlled build tests). */
async function passingAdmission() {
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#3388aa' } }).png().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  let admitted = 0
  const admission: BuildAdmissionPort = { async run(payload) {
    admitted++
    return { ok: true, processId: 7, message: 'injected admission port',
      captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId, width: 20, height: 20, dataUrl })))
        .filter((capture, index, values) => values.findIndex(value => value.instanceId === capture.instanceId) === index),
      behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission', projectId: payload.project.id,
        documentRevision: payload.project.revision, locationId: target.locationId, stateId: target.stateId ?? null, instanceIds: target.instanceIds,
        sourceIdentities: {}, actions: [], elapsedMs: 5, semanticVerdict: 'requires-review',
        frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 1, stateVersion: 0, publicState: {}, width: 20, height: 20, dataUrl }] })) }
  } }
  return { admission, count: () => admitted }
}

describe('project files through the tool gateway', () => {
  it('lists, creates, orders and reads slide pages as plain HTML, each write being one undoable change', async () => {
    const f = await harness()
    expect(await f.pages()).toEqual([{ path: 'slides/01-场景 1.html', type: '空白页' }])
    const first = applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html', content: PAGE }))
    expect(first.affected).toEqual(['slides/01-导入.html'])
    expect(await f.pages()).toEqual([{ path: 'slides/01-导入.html', type: '可编辑页' }])
    applied(await f.call('w2', 'project.write', { path: 'slides/02-观察.html', content: '<h1>观察</h1>' }))
    applied(await f.call('w3', 'project.write', { path: 'slides/02-讨论.html', content: '<h1>讨论</h1>' }))
    expect((await f.pages()).map(file => file.path)).toEqual(['slides/01-导入.html', 'slides/02-讨论.html', 'slides/03-观察.html'])
    expect(f.session.read().undoDepth).toBe(3)
    const read = data<{ content: string; type: string }>(await f.call('r1', 'project.read', { path: 'slides/01-导入.html' }))
    expect(read.type).toBe('可编辑页')
    expect(read.content).toBe('<!doctype html>\n<html><head><style>h1 { color: #1d4ed8 }</style></head><body><h1 class="fragment">四季的成因</h1><p>导入</p><p>导入</p></body></html>')
    expect(read.content).not.toMatch(/web_|page_|scene_/)
    // Writing back exactly what was read changes nothing.
    expect(await f.call('w4', 'project.write', { path: 'slides/01-导入.html', content: read.content }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
  })

  it('keeps human edits: whole writes need a fresh read, local edits keep every other identity and style', async () => {
    const f = await harness()
    applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html', content: PAGE }))
    const layer = pageLayer(f.project())
    if (layer.kind !== 'composition') throw new Error('composition')
    let heading = ''
    walkComposition(layer.content.root, node => { if (node.kind === 'element' && node.tagName === 'h1') heading = node.id })
    const snapshot = f.session.read()
    await f.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-style', actor: 'human', baseRevision: snapshot.revision,
      mutation: { type: 'command', command: { type: 'composition.edit', layerItemId: layer.layerItemId, edit: { type: 'style', nodeId: heading, patch: { color: 'red' } } } } })
    expect(await f.call('w2', 'project.write', { path: 'slides/01-导入.html', content: PAGE })).toMatchObject({ kind: 'error', code: 'file-changed' })
    expect(await f.call('e0', 'project.edit', { path: 'slides/01-导入.html', edits: [{ old: '<p>导入</p>', new: '<p>问题</p>' }] }))
      .toMatchObject({ kind: 'error', code: 'edit-ambiguous' })
    expect(await f.call('e1', 'project.edit', { path: 'slides/01-导入.html', edits: [{ old: '<p>没有</p>', new: '' }] }))
      .toMatchObject({ kind: 'error', code: 'edit-mismatch' })
    applied(await f.call('e2', 'project.edit', { path: 'slides/01-导入.html', edits: [{ old: '<p>导入</p><p>导入</p>', new: '<p>导入</p><p>为什么会有四季？</p>' }] }))
    const after = pageLayer(f.project())
    if (after.kind !== 'composition') throw new Error('composition')
    expect(after.layerItemId).toBe(layer.layerItemId)
    const kept = findCompositionNode(after.content.root, heading)
    expect(kept?.kind === 'element' && kept.attributes.style).toBe('color: red;')
    const before: string[] = [], now: string[] = []
    walkComposition(layer.content.root, node => before.push(node.id)); walkComposition(after.content.root, node => now.push(node.id))
    expect(now).toEqual(before)
    // After its own write the run may overwrite again without another read.
    const fresh = data<{ content: string }>(await f.call('r2', 'project.read', { path: 'slides/01-导入.html' })).content
    applied(await f.call('w3', 'project.write', { path: 'slides/01-导入.html', content: fresh.replace('为什么会有四季？', '四季从何而来？') }))
    applied(await f.call('w4', 'project.write', { path: 'slides/01-导入.html', content: fresh }))
    // Dragging and resizing the page body in the editor is a layer change the page file never overwrites.
    const moved = f.session.read()
    await f.session.execute({ documentId: moved.documentId, epoch: moved.epoch, operationId: 'human-frame', actor: 'human', baseRevision: moved.revision,
      mutation: { type: 'command', command: { type: 'course.object.patch', locationId: f.project().locations[0]!.id, itemId: layer.layerItemId,
        patch: { frame: { x: 40, y: 30, width: 900, height: 500 } } } } })
    applied(await f.call('e3', 'project.edit', { path: 'slides/01-导入.html', edits: [{ old: '为什么会有四季？', new: '四季的成因是什么？' }] }))
    expect(pageLayer(f.project()).frame).toEqual({ mode: 'absolute', x: 40, y: 30, width: 900, height: 500 })
  })

  it('renames, reorders and deletes pages with the formal location rules', async () => {
    const f = await harness()
    for (const [index, name] of ['导入', '观察', '结论'].entries())
      applied(await f.call(`w${index}`, 'project.write', { path: `slides/0${index + 1}-${name}.html`, content: `<h1>${name}</h1>` }))
    applied(await f.call('m1', 'project.move', { from: 'slides/03-结论.html', to: 'slides/01-结论.html' }))
    applied(await f.call('m2', 'project.move', { from: 'slides/02-导入.html', to: 'slides/02-引入.html' }))
    expect((await f.pages()).map(file => file.path)).toEqual(['slides/01-结论.html', 'slides/02-引入.html', 'slides/03-观察.html'])
    expect(f.project().locations.map(location => location.label)).toEqual(expect.arrayContaining([expect.stringContaining('引入')]))
    applied(await f.call('d1', 'project.delete', { path: 'slides/03-观察.html' }))
    applied(await f.call('d2', 'project.delete', { path: 'slides/02-引入.html' }))
    expect(await f.call('d3', 'project.delete', { path: 'slides/01-结论.html' })).toMatchObject({ kind: 'error', code: 'delete-refused' })
    expect(await f.call('m3', 'project.move', { from: 'slides/01-结论.html', to: 'slides-2/01-结论.html' })).toMatchObject({ kind: 'error', code: 'unsupported-move' })
  })

  it('names the course without handles, refuses writes outside a whole-course grant', async () => {
    const two = await harness({ models: [blank(), blank()] })
    expect(await two.call('l1', 'project.list', {})).toMatchObject({ kind: 'error', code: 'project-ambiguous' })
    applied(await two.call('w1', 'project.write', { project: '第2课.h5lesson', path: 'slides/01-甲.html', content: '<p>甲</p>' }))
    expect(pageLayer((two.sessions[1]!.read().model as CourseModel).project).kind).toBe('composition')
    expect(pageLayer(two.project(), 0)).toBeUndefined()
    const readOnly = await harness({ writable: [] })
    expect(await readOnly.pages()).toHaveLength(1)
    expect(await readOnly.call('w2', 'project.write', { path: 'slides/01-甲.html', content: '<p>甲</p>' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  })

  it('admits a scripted page through the existing staging build before its single commit', async () => {
    const { admission, count } = await passingAdmission()
    const f = await harness({ admission })
    const program = '<!doctype html><html><body><button>开始</button><script>document.querySelector("button").textContent = "运行中"</script></body></html>'
    applied(await f.call('p1', 'project.write', { path: 'slides/01-实验.html', content: program }))
    expect(count()).toBe(1)
    const layer = pageLayer(f.project())
    expect(layer).toMatchObject({ kind: 'runtime', runtime: { protocol: 'surface-runtime', staticFallback: { coverage: 'scene' } } })
    expect(f.session.read().undoDepth).toBe(1)
    expect(await f.pages()).toEqual([{ path: 'slides/01-实验.html', type: '整页程序' }])
    expect(data<{ content: string }>(await f.call('r1', 'project.read', { path: 'slides/01-实验.html' })).content).toBe(program)
    // Unchanged program text needs no second admission.
    expect(await f.call('p2', 'project.write', { path: 'slides/01-实验.html', content: program })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
    expect(count()).toBe(1)
  })

  it('reports a failed admission without committing anything', async () => {
    const f = await harness({ admission: { async run() { return { ok: false, message: '页面脚本运行时抛出错误' } } } as unknown as BuildAdmissionPort })
    const before = f.session.read().revision
    expect(await f.call('p1', 'project.write', { path: 'slides/01-实验.html', content: '<script>throw new Error("x")</script>' }))
      .toMatchObject({ kind: 'error', code: 'admission-failed' })
    expect(f.session.read().revision).toBe(before)
  })

  it('writes the course theme and lists pending assets and components a page refers to', async () => {
    const f = await harness()
    expect((await f.files())[0]).toEqual({ path: 'theme.css', type: '主题', note: '尚未写入' })
    applied(await f.call('t1', 'project.write', { path: 'theme.css', content: 'h1 { color: var(--color-accent); background: url(../assets/纸纹.png) }' }))
    expect(f.project().theme?.css).toContain('var(--color-accent)')
    applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html',
      content: '<h1>四季</h1><img src="../assets/地轴倾斜.svg" alt="地轴倾斜示意"><iframe src="../components/公转模拟.html" title="公转模拟"></iframe>' }))
    const files = await f.files()
    expect(files).toEqual(expect.arrayContaining([
      { path: 'assets/纸纹.png', type: '待填素材', note: '引用：theme.css' },
      { path: 'assets/地轴倾斜.svg', type: '待填素材', note: '说明：地轴倾斜示意；引用：slides/01-导入.html' },
      { path: 'components/公转模拟.html', type: '待写组件', note: '说明：公转模拟；引用：slides/01-导入.html' },
    ]))
    // The run wrote the theme itself, so it may overwrite it; another run would have to read it first.
    applied(await f.call('t2', 'project.write', { path: 'theme.css', content: 'h1 { color: red }' }))
    await f.gateway.beginRun({ runId: 'r2', actor: 'agent', documents: [{ documentId: f.session.documentId, writable: [{ kind: 'document' }] }] })
    expect(await f.gateway.execute('r2', 't3', { name: 'project.write', input: { path: 'theme.css', content: 'h1 { color: blue }' } })).toMatchObject({ kind: 'error', code: 'read-required' })
    applied(await f.call('d1', 'project.delete', { path: 'theme.css' }))
    expect(f.project().theme).toBeUndefined()
  })

  it('writes a named component once; every page copy follows after admission, and a refused one is kept as a draft', async () => {
    const pass = await passingAdmission()
    const f = await harness({ admission: pass.admission })
    applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html', content: '<h1>四季</h1><iframe src="../components/公转模拟.html" title="公转模拟"></iframe>' }))
    applied(await f.call('w2', 'project.write', { path: 'slides/02-观察.html', content: '<iframe src="../components/公转模拟.html" title="再看一次"></iframe>' }))
    expect(pass.count()).toBe(0)
    const component = '<!doctype html><html><body><canvas></canvas><script>document.title = "公转"</script></body></html>'
    const written = applied(await f.call('c1', 'project.write', { path: 'components/公转模拟.html', content: component }))
    expect(written.affected).toEqual(['components/公转模拟.html'])
    expect(pass.count()).toBe(1)
    expect(f.project().components?.['公转模拟']).toMatchObject({ enabled: true, protocol: 'surface-runtime' })
    const copies: unknown[] = []
    for (const index of [0, 1]) {
      const layer = pageLayer(f.project(), index)
      if (layer.kind !== 'composition') throw new Error('composition')
      walkComposition(layer.content.root, node => { if (node.kind === 'runtime') copies.push(node.runtime) })
    }
    expect(copies).toHaveLength(2)
    expect(copies.every(copy => (copy as { staticFallback?: unknown }).staticFallback)).toBe(true)
    expect(data<{ content: string; type: string }>(await f.call('r1', 'project.read', { path: 'components/公转模拟.html' }))).toMatchObject({ content: component, type: '组件' })
    // Editing a page that uses the component keeps its copy and needs no new admission.
    applied(await f.call('e1', 'project.edit', { path: 'slides/02-观察.html', edits: [{ old: 'title="再看一次"', new: 'title="再观察一次"' }] }))
    expect(pass.count()).toBe(1)
    applied(await f.call('m1', 'project.move', { from: 'components/公转模拟.html', to: 'components/地球公转.html' }))
    expect(data<{ content: string }>(await f.call('r2', 'project.read', { path: 'slides/01-导入.html' })).content).toContain('src="../components/%E5%9C%B0%E7%90%83%E5%85%AC%E8%BD%AC.html"')

    const refused = await harness({ admission: { async run() { return { ok: false, message: '组件脚本抛出错误' } } } as unknown as BuildAdmissionPort })
    applied(await refused.call('w1', 'project.write', { path: 'slides/01-导入.html', content: '<iframe src="../components/坏组件.html" title="坏"></iframe>' }))
    const draft = applied(await refused.call('c1', 'project.write', { path: 'components/坏组件.html', content: '<script>throw new Error("x")</script>' }))
    expect(draft.advisories?.[0]?.message).toContain('已保存为草稿')
    expect(refused.project().components?.['坏组件']).toMatchObject({ enabled: false, draft: { reason: expect.stringContaining('未通过准入') } })
    expect((await refused.files()).find(file => file.path === 'components/坏组件.html')).toMatchObject({ type: '组件草稿' })
  })

  it('writes, edits, copies, renames and deletes image assets; pages follow a rename', async () => {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const f = await harness({ readFile: async ({ path: file }) => {
      if (file !== '材料/照片.png') throw new Error('没有这个文件')
      return { bytes: new Uint8Array(png), mimeType: 'image/png', filename: '照片.png' }
    } })
    applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html',
      content: '<img src="../assets/地轴.svg" alt="地轴倾斜"><div style="background: url(../assets/照片.png)">照片</div>' }))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#2563eb"/></svg>'
    expect(applied(await f.call('a1', 'project.write', { path: 'assets/地轴.svg', content: svg })).affected).toEqual(['assets/地轴.svg'])
    const meta = Object.values(f.project().assets).find(value => value.path === 'assets/地轴.svg')!
    expect(meta).toMatchObject({ mimeType: 'image/svg+xml', width: 40, height: 20, filename: '地轴.svg', source: { kind: 'model-svg' } })
    const layer = pageLayer(f.project())
    expect(layer.kind === 'composition' && layer.content.assets['assets/地轴.svg']).toEqual({ assetId: meta.id })
    expect(data(await f.call('r1', 'project.read', { path: 'assets/地轴.svg' }))).toMatchObject({ path: 'assets/地轴.svg', content: svg, mediaType: 'image/svg+xml', width: 40 })
    applied(await f.call('e1', 'project.edit', { path: 'assets/地轴.svg', edits: [{ old: '#2563eb', new: '#dc2626' }] }))
    const model = f.session.read().model as CourseModel
    expect(new TextDecoder().decode(model.resources.assets[meta.id])).toContain('#dc2626')
    applied(await f.call('a2', 'project.write', { path: 'assets/照片.png', from: '材料/照片.png' }))
    expect(Object.values(f.project().assets).find(value => value.path === 'assets/照片.png')).toMatchObject({ width: 3, height: 2, source: { kind: 'user-material' } })
    expect(await f.call('a3', 'project.write', { path: 'assets/照片2.jpg', from: '材料/照片.png' })).toMatchObject({ kind: 'error', code: 'type-mismatch' })
    expect(await f.call('a4', 'project.write', { path: 'assets/照片3.png', content: 'not an image' })).toMatchObject({ kind: 'error', code: 'binary-file' })
    applied(await f.call('m1', 'project.move', { from: 'assets/地轴.svg', to: 'assets/地轴倾斜.svg' }))
    expect(data<{ content: string }>(await f.call('r2', 'project.read', { path: 'slides/01-导入.html' })).content).toContain('src="../assets/地轴倾斜.svg"')
    applied(await f.call('d1', 'project.delete', { path: 'assets/照片.png' }))
    expect(await f.files()).toEqual(expect.arrayContaining([{ path: 'assets/照片.png', type: '待填素材', note: '引用：slides/01-导入.html' }]))
    const generated = await f.gateway.provideImage('r', f.session.documentId, { bytes: new Uint8Array(png), mimeType: 'image/png', filename: 'gen.png' })
    applied(await f.call('a5', 'project.write', { path: 'assets/照片.png', from: generated }))
    expect(Object.values(f.project().assets).find(value => value.path === 'assets/照片.png')).toMatchObject({ source: { kind: 'image-model' } })
    expect(await f.files()).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: '待填素材' })]))
  })

  it('revises the teacher controller source through admission and keeps its package identity', async () => {
    const pass = await passingAdmission()
    const pkg = createDefaultTeacherControllerPackage()
    const model: CourseModel = { kind: 'course-v9', project: createBlankCourseProject(),
      resources: { assets: {}, components: { [`${pkg.manifest.id}@${pkg.manifest.version}`]: pkg.files } } }
    const f = await harness({ models: [model], admission: pass.admission })
    expect(await f.files()).toEqual(expect.arrayContaining([{ path: 'controller/教师控制台.js', type: '教师控制台' }]))
    expect(await f.call('w0', 'project.write', { path: 'controller/教师控制台.js', content: 'x' })).toMatchObject({ kind: 'error', code: 'read-required' })
    const source = data<{ content: string }>(await f.call('r1', 'project.read', { path: 'controller/教师控制台.js' })).content
    expect(source).toBe(pkg.runtimeSource)
    const before = f.project().componentPackages[pkg.manifest.id]!
    applied(await f.call('w1', 'project.write', { path: 'controller/教师控制台.js', content: `${source}\n// 课程定制\n` }))
    expect(pass.count()).toBe(1)
    const after = f.project().componentPackages[pkg.manifest.id]!
    expect(after).toMatchObject({ packageId: before.packageId, version: before.version })
    expect(after.contentSha256).not.toBe(before.contentSha256)
    expect(data<{ content: string }>(await f.call('r2', 'project.read', { path: 'controller/教师控制台.js' })).content).toContain('// 课程定制')
  })

  it('opens a course named by path through the host port and keeps its writability', async () => {
    const f = await harness({ unopened: { model: blank(), writable: true } })
    applied(await f.call('w1', 'project.write', { project: '课程/新课.h5lesson', path: 'slides/01-甲.html', content: '<p>甲</p>' }))
    expect(pageLayer((f.unopened!.read().model as CourseModel).project).kind).toBe('composition')
    // Once attached, the course is found by its short name too.
    expect(data<{ files: unknown[] }>(await f.call('l1', 'project.list', { project: '新课' })).files.length).toBeGreaterThan(0)
    const readOnly = await harness({ unopened: { model: blank(), writable: false } })
    expect(await readOnly.call('w2', 'project.write', { project: '课程/新课.h5lesson', path: 'slides/01-甲.html', content: '<p>甲</p>' }))
      .toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(await readOnly.call('w3', 'project.list', { project: '课程/别的.h5lesson' })).toMatchObject({ kind: 'error', message: '没有这个课件' })
  })
})
