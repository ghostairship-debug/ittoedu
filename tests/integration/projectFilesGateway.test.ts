// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { HostToolServices } from '../../src/core/tools/HostToolServices'
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

async function harness(options: { models?: CourseModel[]; writable?: ToolTarget[]; admission?: BuildAdmissionPort } = {}) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const models = options.models ?? [blank()]
  const sessions = await Promise.all(models.map((model, index) => registry.create(model, index ? `第${index + 1}课.h5lesson` : '四季.h5lesson')))
  const services: HostToolServices = { projectFiles: { parsePage: parseWebComposition } }
  if (options.admission) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-build-')); roots.push(root)
    services.builds = new ControlledBuildService({ directory: path.join(root, 'scratch'), admission: options.admission })
  }
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++id), { services })
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: sessions.map(session => ({ documentId: session.documentId, writable: options.writable ?? [{ kind: 'document' }] })) })
  const session = sessions[0]!
  return { gateway, session, sessions,
    call: (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input }),
    project: () => (session.read().model as CourseModel).project,
    files: async () => data<{ files: { path: string; type: string; note?: string }[] }>(await gateway.execute('r', `list-${++id}`, { name: 'project.list', input: {} })).files }
}

function pageLayer(model: CourseModel['project'], index = 0) {
  const slide = model.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('slide')
  return slide.scenes[index]!.layerItems[0]!
}

const PAGE = '<!doctype html><html><head><style>h1 { color: #1d4ed8 }</style></head><body><h1 class="fragment">四季的成因</h1><p>导入</p><p>导入</p></body></html>'

describe('project files through the tool gateway', () => {
  it('lists, creates, orders and reads slide pages as plain HTML, each write being one undoable change', async () => {
    const f = await harness()
    expect(await f.files()).toEqual([{ path: 'slides/01-场景 1.html', type: '空白页' }])
    const first = applied(await f.call('w1', 'project.write', { path: 'slides/01-导入.html', content: PAGE }))
    expect(first.affected).toEqual(['slides/01-导入.html'])
    expect(await f.files()).toEqual([{ path: 'slides/01-导入.html', type: '可编辑页' }])
    applied(await f.call('w2', 'project.write', { path: 'slides/02-观察.html', content: '<h1>观察</h1>' }))
    applied(await f.call('w3', 'project.write', { path: 'slides/02-讨论.html', content: '<h1>讨论</h1>' }))
    expect((await f.files()).map(file => file.path)).toEqual(['slides/01-导入.html', 'slides/02-讨论.html', 'slides/03-观察.html'])
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
  })

  it('renames, reorders and deletes pages with the formal location rules', async () => {
    const f = await harness()
    for (const [index, name] of ['导入', '观察', '结论'].entries())
      applied(await f.call(`w${index}`, 'project.write', { path: `slides/0${index + 1}-${name}.html`, content: `<h1>${name}</h1>` }))
    applied(await f.call('m1', 'project.move', { from: 'slides/03-结论.html', to: 'slides/01-结论.html' }))
    applied(await f.call('m2', 'project.move', { from: 'slides/02-导入.html', to: 'slides/02-引入.html' }))
    expect((await f.files()).map(file => file.path)).toEqual(['slides/01-结论.html', 'slides/02-引入.html', 'slides/03-观察.html'])
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
    expect(data<{ files: unknown[] }>(await readOnly.call('l2', 'project.list', {})).files).toHaveLength(1)
    expect(await readOnly.call('w2', 'project.write', { path: 'slides/01-甲.html', content: '<p>甲</p>' })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  })

  it('admits a scripted page through the existing staging build before its single commit', async () => {
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
    const f = await harness({ admission })
    const program = '<!doctype html><html><body><button>开始</button><script>document.querySelector("button").textContent = "运行中"</script></body></html>'
    applied(await f.call('p1', 'project.write', { path: 'slides/01-实验.html', content: program }))
    expect(admitted).toBe(1)
    const layer = pageLayer(f.project())
    expect(layer).toMatchObject({ kind: 'runtime', runtime: { protocol: 'surface-runtime', staticFallback: { coverage: 'scene' } } })
    expect(f.session.read().undoDepth).toBe(1)
    expect(await f.files()).toEqual([{ path: 'slides/01-实验.html', type: '整页程序' }])
    expect(data<{ content: string }>(await f.call('r1', 'project.read', { path: 'slides/01-实验.html' })).content).toBe(program)
    // Unchanged program text needs no second admission.
    expect(await f.call('p2', 'project.write', { path: 'slides/01-实验.html', content: program })).toMatchObject({ kind: 'document-operation', result: { status: 'unchanged' } })
    expect(admitted).toBe(1)
  })

  it('reports a failed admission without committing anything', async () => {
    const f = await harness({ admission: { async run() { return { ok: false, message: '页面脚本运行时抛出错误' } } } as unknown as BuildAdmissionPort })
    const before = f.session.read().revision
    expect(await f.call('p1', 'project.write', { path: 'slides/01-实验.html', content: '<script>throw new Error("x")</script>' }))
      .toMatchObject({ kind: 'error', code: 'admission-failed' })
    expect(f.session.read().revision).toBe(before)
  })
})
