// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { managedComponentLibrary } from '../../src/main/componentCatalogSources'
import { prepareImageResource } from '../../src/main/workbench/admittedImageResource'
import { AssetLibraryService, readComponentLibrary } from '../../src/main/workbench/assetSources/componentLibrarySearch'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

type CourseModel = Extract<DocumentModel, { kind: 'course-v9' }>
const driver = new CourseV9Driver()
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(root, { recursive: true, force: true })
})
const temporary = async (prefix: string) => { const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(root); return root }
const data = (result: ToolResult): any => { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read' }); return (result as { data: unknown }).data }
const applied = (result: ToolResult) => expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
const png = (background: string) => sharp({ create: { width: 64, height: 64, channels: 4, background } }).png().toBuffer().then(buffer => new Uint8Array(buffer))

/** A course with one image at assets/地球.png. */
async function course(background = '#2266cc'): Promise<CourseModel> {
  const prepared = await prepareImageResource({ bytes: await png(background), mimeType: 'image/png', filename: '地球.png' }, () => 'earth')
  return { kind: 'course-v9', project: { ...createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    assets: { [prepared.meta.id]: { ...prepared.meta, path: 'assets/地球.png' } } }, resources: { assets: { [prepared.meta.id]: prepared.bytes }, components: {} } }
}

/** Injected admission: verifies the lifecycle, not real-host rendering (as in the project-file tests). */
const admission: BuildAdmissionPort = { async run(payload) {
  const dataUrl = `data:image/png;base64,${Buffer.from(await png('#3388aa')).toString('base64')}`
  return { ok: true, processId: 7, message: 'injected admission port',
    captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId, width: 64, height: 64, dataUrl })))
      .filter((capture, index, values) => values.findIndex(value => value.instanceId === capture.instanceId) === index),
    behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission', projectId: payload.project.id,
      documentRevision: payload.project.revision, locationId: target.locationId, stateId: target.stateId ?? null, instanceIds: target.instanceIds,
      sourceIdentities: {}, actions: [], elapsedMs: 5, semanticVerdict: 'requires-review',
      frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 1, stateVersion: 0, publicState: {}, width: 64, height: 64, dataUrl }] })) }
} }

async function harness(models: { name: string; model: CourseModel }[]) {
  const userData = await temporary('g20-asset-library-user-'), scratch = await temporary('g20-asset-library-build-')
  const library = new AssetLibraryService({ load: () => readComponentLibrary(process.cwd(), userData), managedLibrary: managedComponentLibrary(userData),
    now: () => new Date('2026-10-04T08:00:00.000Z') })
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const gateway = new DocumentToolGateway(registry, [driver], () => String(++id), { prepareImage: prepareImageResource, services: {
    projectFiles: { parsePage: parseWebComposition },
    builds: new ControlledBuildService({ directory: scratch, admission }),
    assetLibrary: { search: input => library.search(input), read: input => library.read(input), save: ({ runId: _runId, ...input }) => library.save(input) },
  } })
  const sessions = await Promise.all(models.map(({ name, model }) => registry.create(model, `${name}.h5lesson`)))
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: sessions.map(session => ({ documentId: session.documentId, writable: [{ kind: 'document' }] })),
    fileAccess: { permission: 'workspace', workspaceRoot: 'D:/asset-library-fixture' } })
  const call = (callId: string, name: string, input: unknown) => gateway.execute('r', callId, { name, input })
  const project = (index: number) => (sessions[index]!.read().model as CourseModel).project
  return { userData, sessions, call, project }
}

const COMPONENT = '<!doctype html><html><body><img src="../assets/地球.png" alt="地球"><script>document.title = "公转"</script></body></html>'

it('saves a course component with its assets into my library and reuses it to fill another course placeholder in one change', async () => {
  const h = await harness([{ name: '第一课', model: await course() }, { name: '第二课', model: await course() }])
  applied(await h.call('page-1', 'project.write', { project: '第一课', path: 'slides/01-导入.html', content: '<iframe src="../components/公转模拟.html" title="公转"></iframe>' }))
  applied(await h.call('component-1', 'project.write', { project: '第一课', path: 'components/公转模拟.html', content: COMPONENT }))

  const saved = data(await h.call('save-1', 'asset.save', { project: '第一课', path: 'components/公转模拟.html', description: '拖动地球观察四季',
    subject: ['地理', '地理'], tags: ['公转', '四季'] }))
  expect(saved).toEqual({ status: 'saved', packageId: expect.stringMatching(/^html-component\./), version: '1.0.0', name: '公转模拟', library: '我的资产库' })
  const entry = path.join(managedComponentLibrary(h.userData), 'html-components', `${saved.packageId}@1.0.0`)
  expect(JSON.parse(await fs.readFile(path.join(entry, 'component.json'), 'utf8'))).toEqual({ format: 'guoling-html-component', formatVersion: 1,
    packageId: saved.packageId, version: '1.0.0', name: '公转模拟', description: '拖动地球观察四季', subject: ['地理'], schoolStage: [], tags: ['公转', '四季'],
    sourceCourse: '第一课.h5lesson', savedAt: '2026-10-04T08:00:00.000Z', assets: [{ path: 'assets/地球.png', mimeType: 'image/png' }] })
  expect(await fs.readFile(path.join(entry, 'component.html'), 'utf8')).toBe(COMPONENT)
  expect((await fs.stat(path.join(entry, 'assets', '地球.png'))).isFile()).toBe(true)

  const found = data(await h.call('search-1', 'asset.search', { query: '公转 四季' }))
  expect(found.candidates[0]).toEqual({ kind: 'html-component', packageId: saved.packageId, version: '1.0.0', name: '公转模拟',
    description: '拖动地球观察四季', subject: ['地理'], tags: ['公转', '四季'], sourceCourse: '第一课.h5lesson', savedAt: '2026-10-04T08:00:00.000Z',
    source: '我的资产库', trust: 'trusted' })

  // The second course waits for the component under another name; its identical 地球.png is reused, not duplicated.
  applied(await h.call('page-2', 'project.write', { project: '第二课', path: 'slides/01-观察.html', content: '<iframe src="../components/地球公转.html" title="公转"></iframe>' }))
  const before = h.sessions[1]!.read().undoDepth
  applied(await h.call('use-1', 'asset.use', { project: '第二课', packageId: saved.packageId, path: '../components/地球公转.html' }))
  expect(h.sessions[1]!.read().undoDepth).toBe(before + 1)
  expect(h.project(1).components?.['地球公转']).toMatchObject({ enabled: true })
  expect(Object.values(h.project(1).assets).filter(meta => meta.path === 'assets/地球.png').map(meta => meta.id)).toEqual(['asset_earth'])
  const pending = data(await h.call('list-2', 'project.list', { project: '第二课' })).files.filter((file: { type: string }) => file.type === '待写组件')
  expect(pending).toEqual([])

  // Saving the same name again is the next version of the same entry.
  expect(data(await h.call('save-2', 'asset.save', { project: '第一课', path: 'components/公转模拟.html' }))).toMatchObject({ packageId: saved.packageId, version: '1.0.1' })
})

it('adds missing assets with their library source, reports conflicting ones, and does not use component packages for placeholders', async () => {
  const h = await harness([{ name: '第一课', model: await course() }, { name: '第二课', model: await course('#cc2222') }])
  applied(await h.call('page-1', 'project.write', { project: '第一课', path: 'slides/01-导入.html', content: '<iframe src="../components/公转模拟.html" title="公转"></iframe>' }))
  applied(await h.call('component-1', 'project.write', { project: '第一课', path: 'components/公转模拟.html', content: COMPONENT }))
  const saved = data(await h.call('save-1', 'asset.save', { project: '第一课', path: 'components/公转模拟.html' }))
  expect(await h.call('use-conflict', 'asset.use', { project: '第二课', packageId: saved.packageId, path: 'components/公转模拟.html' }))
    .toMatchObject({ kind: 'error', code: 'asset-conflict', message: expect.stringContaining('assets/地球.png') })

  const empty = await harness([{ name: '空课', model: { kind: 'course-v9', project: createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    resources: { assets: {}, components: {} } } }])
  // A separate user-data folder: copy the saved entry into this harness's library.
  await fs.cp(managedComponentLibrary(h.userData), managedComponentLibrary(empty.userData), { recursive: true })
  applied(await empty.call('use', 'asset.use', { packageId: saved.packageId, path: 'components/公转模拟.html' }))
  expect(Object.values(empty.project(0).assets).filter(meta => meta.path === 'assets/地球.png')).toEqual([expect.objectContaining({
    mimeType: 'image/png', source: { kind: 'asset-library', title: '公转模拟' } })])
  expect(data(await empty.call('use-package', 'asset.use', { packageId: 'com.ittoedu.visual.image-frame', path: 'components/相框.html' })))
    .toMatchObject({ status: 'rejected', reason: expect.stringContaining('组件包') })
  expect(await empty.call('save-missing', 'asset.save', { path: 'components/没有.html' })).toMatchObject({ kind: 'error', code: 'not-found' })
})
