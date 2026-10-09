// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { textDataEdit } from '../../src/components/text/adapters'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { executeTaskFinishDelivery, executeDocumentDeliveryTool } from '../../src/core/tools/DocumentDeliveryTools'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { deliverComponentProject } from '../../src/main/workbench/delivery/componentProjectDelivery'
import { resolveExportDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { buildDocumentExport } from '../../src/renderer/workbench/delivery/buildDocumentExport'

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => { throw new Error('PPTX sample does not require Player capture') } }))

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('keeps save-only finish separate from the interactive default and resolves explicit export paths from the frozen workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explicit-export-root-')); roots.push(root)
  await fs.mkdir(path.join(root, 'lesson'))
  const host = new DocumentHostService(path.join(root, 'journal'))
  const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('互动'), resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
  const filename = path.join(root, 'lesson', 'lesson.h5lesson')
  await host.internalAPI.save(document.documentId, filename)
  const current = await host.internalAPI.read(document.documentId)
  expect(await resolveExportDestination('run', current, 'lesson/课堂演示.html', '默认.html', 'html-offline',
    () => ({ permission: 'workspace', workspaceRoot: root }))).toBe(path.join(root, 'lesson', '课堂演示.html'))
  expect(await resolveExportDestination('run', current, undefined, '默认.html', 'html-offline',
    () => ({ permission: 'workspace', workspaceRoot: root }))).toBe(path.join(root, 'lesson', '默认.html'))
  const save = vi.fn(async () => ({ status: 'saved', documentId: current.documentId, epoch: current.epoch, savedRevision: 0, currentRevision: 0, dirty: false, warnings: [] }))
  const exportDocument = vi.fn(async () => ({ status: 'generated', documentId: current.documentId, epoch: current.epoch, format: 'html-offline', warnings: [] }))
  const service = { lookup: async () => null, save, export: exportDocument } as unknown as Parameters<typeof executeTaskFinishDelivery>[0]
  const context = { runId: 'run', operationId: 'finish', requestDigest: 'finish', current: async () => current }
  expect(await executeTaskFinishDelivery(service, context, {})).toMatchObject({ kind: 'read', data: { status: 'saved' } })
  expect(exportDocument).not.toHaveBeenCalled()
  await executeDocumentDeliveryTool(service, { ...context, operationId: 'export', requestDigest: 'export', resolveHandle: async () => current }, 'document.export', { target: 'document' })
  expect(exportDocument).toHaveBeenCalledWith(expect.objectContaining({ format: 'html-offline' }))
  expect(save).toHaveBeenCalledOnce()
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'explicit-delivery-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const project = createBlankCourseProjectV10('明确交付')
  project.global.overlay = []; project.definitions = { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } }
  project.instances = { text: { id: 'text', definitionId: 'text', data: textDataEdit('text', createTextComponentData('当前正式正文')).value,
    frame: { width: 500, height: 100, transform: [1, 0, 0, 1, 20, 20] } } }
  project.surfaces = [{ id: 'page', kind: 'slide', title: '首页', childIds: ['text'], designSize: { width: 1280, height: 720 } }]
  const document = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '明确交付.h5lesson')
  const operations = new DocumentDeliveryOperationStore(path.join(root, 'operations')), stop = new AbortController()
  const saveWithFact = vi.fn(host.saveWithFact.bind(host)), authorize = vi.fn(async () => {})
  const build = vi.fn((request: Parameters<typeof buildDocumentExport>[0], signal?: AbortSignal) => buildDocumentExport(request, signal,
    async () => { throw new Error('fixture contains no custom source') }, async () => {}))
  const service = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read, saveWithFact, lookupSave: host.lookupSave.bind(host),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations, authorize, signalForRun: () => stop.signal,
    resolveSaveDestination: async ({ requested, snapshot }) => requested
      ?? (snapshot.binding.kind === 'file' ? snapshot.binding.path : path.join(root, '明确交付.h5lesson')),
    resolveExportDestination: async ({ requested }) => requested ?? null,
    build: { build }, writer: workbenchExportWriter,
  })
  const current = vi.fn(async (_target?: string) => host.internalAPI.read(document.documentId))
  const context = (operationId: string) => ({ runId: 'run', operationId, requestDigest: operationId, signal: stop.signal, current })
  return { root, host, document, service, operations, stop, current, context, saveWithFact, authorize, build }
}

it('saves the current V10 target once and reopens its real archive; normal save and project.save use the same owner', async () => {
  const f = await fixture(), destination = path.join(f.root, '选择的文件.h5lesson')
  const first = await executeTaskFinishDelivery(f.service, f.context('finish:delivery'), { destination })
  expect(first).toMatchObject({ kind: 'read', data: { status: 'saved', path: destination, savedRevision: 0, dirty: false } })
  expect(f.current).toHaveBeenCalledWith(undefined)
  expect(new CourseV10Driver().load(await fs.readFile(destination))).toMatchObject({ kind: 'course-v10', project: {
    title: '明确交付', instances: { text: { data: createTextComponentData('当前正式正文') } },
  } })
  f.current.mockRejectedValueOnce(new Error('stale current target must not be resolved on lookup'))
  expect(await executeTaskFinishDelivery(f.service, f.context('finish:delivery'), { destination })).toEqual(first)
  expect(await executeDocumentDeliveryTool(f.service, { ...f.context('finish:delivery'), resolveHandle: async () => { throw new Error('stale handle') } },
    'file.save', { target: 'existing-handle', destination })).toEqual(first)
  expect(await deliverComponentProject(f.service, { ...f.context('finish:delivery'), current: async () => { throw new Error('stale project') } },
    { project: 'existing-file', destination })).toEqual(first)
  expect(f.saveWithFact).toHaveBeenCalledTimes(1)
})

it('exports current V10 through the real PPTX producer and preserves generated versus written and rejected facts', async () => {
  const f = await fixture(), options = { pageIds: ['page'], pageSize: 'letter' as const, orientation: 'landscape' as const }
  const generated = await executeTaskFinishDelivery(f.service, f.context('generated'), { format: 'pptx', options })
  expect(generated).toMatchObject({ kind: 'read', data: { status: 'generated', exportedRevision: 0, format: 'pptx' } })
  const destination = path.join(f.root, '交付.pptx')
  expect(await executeTaskFinishDelivery(f.service, f.context('written'), { target: '选择的课件', format: 'pptx', destination, options }))
    .toMatchObject({ kind: 'read', data: { status: 'written', path: destination, exportedRevision: 0 } })
  expect(f.current).toHaveBeenLastCalledWith('选择的课件')
  const files = unzipSync(await fs.readFile(destination))
  expect(strFromU8(files['ppt/slides/slide1.xml']!)).toContain('当前正式正文')
  expect(strFromU8(files['ppt/presentation.xml']!)).toContain(String(11 * 914400))
  expect(f.build).toHaveBeenLastCalledWith(expect.objectContaining({ options }), f.stop.signal)
  f.authorize.mockRejectedValueOnce(new Error('当前任务只读'))
  expect(await executeTaskFinishDelivery(f.service, f.context('rejected'), {})).toMatchObject({ kind: 'error', data: {
    status: 'rejected', documentId: f.document.documentId, reason: '当前任务只读',
  } })
})

it('queries a lost save acknowledgement without replay, leaves unknown pending, and starts no new operation after Stop', async () => {
  const f = await fixture(), context = f.context('lost-ack')
  f.saveWithFact.mockImplementationOnce(async (id, filename, identity) => {
    await f.host.saveWithFact(id, filename, identity)
    throw new Error('lost acknowledgement')
  })
  await expect(executeTaskFinishDelivery(f.service, context, {})).rejects.toMatchObject({ code: 'tool-outcome-unknown' })
  f.stop.abort(new Error('Stopped'))
  expect(await executeTaskFinishDelivery(f.service, context, {})).toMatchObject({ kind: 'read', data: { status: 'saved' } })
  expect(f.saveWithFact).toHaveBeenCalledTimes(1)
  await f.operations.start({ runId: 'run', operationId: 'unknown', requestDigest: 'unknown', kind: 'save' })
  await expect(executeTaskFinishDelivery(f.service, f.context('unknown'), {})).rejects.toMatchObject({ code: 'tool-outcome-unknown' })
  await expect(executeTaskFinishDelivery(f.service, f.context('after-stop'), {})).rejects.toThrow('Stopped')
  await expect(f.service.save({ ...f.context('direct-save-after-stop'), documentId: f.document.documentId, epoch: f.document.epoch, baseRevision: 0 })).rejects.toThrow('Stopped')
  await expect(f.service.export({ ...f.context('direct-export-after-stop'), documentId: f.document.documentId, epoch: f.document.epoch, revision: 0, format: 'pptx' })).rejects.toThrow('Stopped')
  expect(f.current).toHaveBeenCalledTimes(1)
  expect(await f.operations.lookup('run', 'after-stop')).toBeNull()
  expect(await f.operations.lookup('run', 'direct-save-after-stop')).toBeNull()
  expect(await f.operations.lookup('run', 'direct-export-after-stop')).toBeNull()
  expect(f.build).not.toHaveBeenCalled()
})

it('delivers current V10 content from a created handle after canonical edits while retaining edit CAS and cross-run authorization', async () => {
  const f = await fixture(), gateway = f.host.tools
  gateway.configureHostServices({ deliveries: f.service })
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [], fileAccess: { permission: 'workspace', workspaceRoot: f.root } })
  const files = new AgentFileService(f.host)
  const created = await files.execute({ runId: 'run', workspaceRoot: f.root, permission: 'workspace' },
    'file.create', { name: '新建的课件.h5lesson' }, gateway.operationIdentity('run', 'create'))
  expect(created.opened).toMatchObject({ kind: 'course-v10', writable: true })
  // This is the same file-create -> Gateway continuation used by the normal Engine.
  const opened = await gateway.completeOpenedDocument('run', created.opened!, { selection: 'select' })
  const oldTarget = opened.target, destination = (created.data as { path: string }).path
  await gateway.loadToolFamilies('run', ['layout', 'build'])
  expect(await gateway.execute('run', 'edit-title', { name: 'course.configure', input: {
    target: oldTarget, settings: { title: '两次编辑后的当前课件' },
  } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
  const freshTarget = await gateway.issueTarget('run', opened.documentId, { kind: 'document' })
  expect(await gateway.execute('run', 'edit-background', { name: 'course.configure', input: {
    target: freshTarget, settings: { background: { color: '#126A34' } },
  } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 2 } })

  const humanBaseline = await f.host.internalAPI.read(opened.documentId)
  if (humanBaseline.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(await f.host.internalAPI.dispatch({ documentId: opened.documentId, epoch: humanBaseline.epoch, baseRevision: humanBaseline.revision,
    operationId: 'human-title-conflict', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(humanBaseline.model.project,
      [{ type: 'project.title.set', title: '人工确认的当前课件' }]) } })).toMatchObject({ status: 'applied', revision: 3 })

  expect(await gateway.execute('run', 'stale-edit', { name: 'course.configure', input: {
    target: oldTarget, settings: { title: '旧目标不得覆盖当前内容' },
  } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect((await f.host.internalAPI.read(opened.documentId)).revision).toBe(3)
  let prepared = false
  f.host.setDocumentInputPreparer(async documentId => {
    if (prepared) return
    prepared = true
    const current = await f.host.internalAPI.read(documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected current V10 input')
    expect(await f.host.internalAPI.dispatch({ documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: 'ack-human-background', actor: 'human', mutation: { type: 'command',
        command: captureComponentOperation(current.model.project, [{ type: 'project.background.set', background: { color: '#873CAD' } }]) } }))
      .toMatchObject({ status: 'applied', revision: 4 })
  })
  expect(await gateway.execute('run', 'save-old-target', { name: 'file.save', input: { target: oldTarget, destination } }))
    .toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: 4, currentRevision: 4, dirty: false } })
  expect(prepared).toBe(true)
  expect(await gateway.execute('run', 'project-save-old-target', { name: 'project.save', input: { project: oldTarget } }))
    .toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: 4 } })
  const exported = path.join(f.root, '旧句柄当前内容.pptx')
  expect(await gateway.execute('run', 'export-old-target', { name: 'document.export', input: {
    target: oldTarget, format: 'pptx', destination: exported,
  } })).toMatchObject({ kind: 'read', data: { status: 'written', exportedRevision: 4, currentRevision: 4 } })
  const finished = await gateway.completeTaskDelivery('run', 'finish:delivery', { target: oldTarget, destination }, f.stop.signal)
  expect(finished, JSON.stringify(finished))
    .toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: 4, currentRevision: 4, dirty: false } })
  expect(new CourseV10Driver().load(await fs.readFile(destination))).toMatchObject({ kind: 'course-v10', project: {
    revision: 4, title: '人工确认的当前课件', background: { color: '#873CAD' },
  } })
  const output = unzipSync(await fs.readFile(exported))
  expect(strFromU8(output['ppt/slides/slide1.xml']!)).toContain('873CAD')

  await gateway.beginRun({ runId: 'other-run', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }] })
  expect(await gateway.completeTaskDelivery('other-run', 'foreign-target', { target: oldTarget }))
    .toMatchObject({ kind: 'error', code: 'invalid-target' })
  await gateway.beginRun({ runId: 'readonly-run', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [] }],
    fileAccess: { permission: 'read-only', workspaceRoot: f.root } })
  const readTarget = await gateway.issueTarget('readonly-run', opened.documentId, { kind: 'document' })
  expect(await gateway.completeTaskDelivery('readonly-run', 'read-target', { target: readTarget }))
    .toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect((await f.host.internalAPI.read(opened.documentId)).revision).toBe(4)
  expect(f.saveWithFact).toHaveBeenCalledTimes(3)
  expect(f.build).toHaveBeenCalledTimes(1)
})
