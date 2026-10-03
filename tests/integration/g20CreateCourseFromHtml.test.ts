// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { HtmlImportToolService } from '../../src/main/workbench/htmlImport/HtmlImportToolService'
import { HtmlImportOperationStore } from '../../src/main/workbench/htmlImport/HtmlImportOperationStore'
import { HtmlImportNetworkGrants } from '../../src/main/workbench/htmlImport/htmlImportNetworkGrants'
import { createCourseFromHtml, type CreateCourseFromHtmlPorts, type CreatedCourseFromHtml } from '../../src/main/workbench/htmlImport/CreateCourseFromHtml'
import { resolveSaveDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { ModelToolCall, ToolResult } from '../../src/shared/workbench/tools'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-course-from-html-')); roots.push(root)
  const workspaceRoot = path.join(root, 'workspace')
  await fs.mkdir(workspaceRoot)
  const sourcePath = path.join(workspaceRoot, '斜抛运动.html')
  await fs.writeFile(sourcePath, '<!doctype html><html><head><style>h1{color:#236}</style></head><body><h1>斜抛运动</h1><button onclick="this.textContent=\'已观察\'">观察</button></body></html>')
  const host = new DocumentHostService(path.join(root, 'journal'))
  const files = new AgentFileService(host)
  const context: AgentFileContext = { runId: 'run', workspaceRoot, permission: 'workspace' }
  const pixel = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const image = `data:image/png;base64,${pixel.toString('base64')}`
  // Only the renderer admission is a fixture. File creation, staging, canonical import and save are real.
  const admission = vi.fn<BuildAdmissionPort['run']>(async payload => ({
    ok: true, processId: 1, message: 'fixture admission',
    captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({
      instanceId, locationId: target.locationId, width: 1, height: 1, dataUrl: image,
    }))).filter((capture, index, all) => all.findIndex(value => value.instanceId === capture.instanceId) === index),
    behaviorEvidence: payload.targets.map(target => ({
      version: 1, status: 'observed', mode: 'full-admission', projectId: payload.project.id,
      documentRevision: payload.project.revision, locationId: target.locationId, stateId: target.stateId ?? null,
      instanceIds: target.instanceIds, sourceIdentities: {}, actions: [], elapsedMs: 0, semanticVerdict: 'requires-review',
      frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 0, stateVersion: 0, publicState: {}, width: 1, height: 1, dataUrl: image }],
    })),
  }))
  const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: { run: admission } })
  const grants = new HtmlImportNetworkGrants()
  const htmlImports = new HtmlImportToolService({
    documents: { read: host.internalAPI.read, get: id => host.registry.get(id) }, gateway: host.tools,
    cancelJob: async (runId, jobId) => { await builds.execute(runId, { type: 'cancel', jobId }) },
    networkGrants: grants, operationStore: new HtmlImportOperationStore(path.join(root, 'imports')),
  })
  const deliveries = new DocumentDeliveryService({
    documents: { read: host.internalAPI.read, saveWithFact: (...args) => host.saveWithFact(...args),
      lookupSave: (...args) => host.lookupSave(...args),
      withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(root, 'delivery')),
    authorize: async ({ runId }) => { if (runId !== context.runId || context.permission === 'read-only') throw new Error('没有保存授权') },
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, () => context),
    resolveExportDestination: async () => null,
    build: { build: async () => { throw new Error('export not requested') } }, writer: workbenchExportWriter,
  })
  host.tools.configureHostServices({ htmlImports, deliveries, builds: Object.assign(builds, {
    policy: (runId: string, documentId: string) => grants.policy(runId, documentId, () => host.registry.get(documentId).read()),
  }) })
  await host.tools.beginRun({ runId: context.runId, actor: 'agent', documents: [], fileAccess: context })
  const children = new Map<string, { call: ModelToolCall; result: ToolResult }>()
  let stopped = false, loseImportAcknowledgement = false
  const assertActive = () => { if (stopped) throw new Error('任务已停止') }
  const executeChild = vi.fn<CreateCourseFromHtmlPorts['executeChild']>(async (callId, call) => {
    let result: ToolResult
    if (call.name === 'file.open' || call.name === 'file.create') {
      const outcome = await files.execute({ ...context, assertActive }, call.name, call.input,
        host.tools.operationIdentity(context.runId, callId))
      if (outcome.opened) await host.tools.attachRunDocument(context.runId, outcome.opened.documentId, outcome.opened.writable)
      result = { kind: 'read', data: outcome.data }
    } else result = await host.tools.execute(context.runId, callId, call)
    children.set(callId, { call, result })
    if (call.name === 'html.import' && loseImportAcknowledgement) {
      loseImportAcknowledgement = false
      throw new Error('lost outer acknowledgement after stored import receipt')
    }
    return result
  })
  const ports: CreateCourseFromHtmlPorts = {
    lookupChild: async (callId, name) => {
      const previous = children.get(callId)
      if (previous && previous.call.name !== name) throw new Error('child identity changed')
      return previous?.result ?? null
    },
    executeChild,
    documentTarget: async (documentId, access) => {
      const snapshot = await host.internalAPI.read(documentId)
      const writable = context.permission !== 'read-only' && snapshot.binding.kind === 'file'
        && path.dirname(snapshot.binding.path) === workspaceRoot
      if (access === 'write' && !writable) throw new Error('没有写入授权')
      await host.tools.attachRunDocument(context.runId, documentId, writable)
      return host.tools.issueTarget(context.runId, documentId, { kind: 'document' })
    },
  }
  return { root, workspaceRoot, host, files, sourcePath, admission, executeChild, children, ports,
    context: { callId: 'create-course', permission: context.permission, assertActive },
    stop: () => { stopped = true }, loseImportAck: () => { loseImportAcknowledgement = true } }
}

describe('host-owned course creation from HTML', () => {
  it('creates without an existing target, imports through the canonical service, saves and reopens the interactive source', async () => {
    const f = await fixture()
    expect(f.host.registry.list()).toHaveLength(0)
    const output = await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)
    expect(output).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true,
      path: path.join(f.workspaceRoot, '斜抛运动.h5lesson'), import: { kind: 'document-operation', result: { status: 'applied' } },
      save: { kind: 'read', data: { status: 'saved', dirty: false } } } })
    const result = (output as Extract<ToolResult, { kind: 'read' }>).data as CreatedCourseFromHtml
    const reopenedHost = new DocumentHostService(path.join(f.root, 'reopened-journal'))
    const reopened = await reopenedHost.open(result.path)
    expect(reopened.model.kind).toBe('course-v9')
    if (reopened.model.kind !== 'course-v9') throw new Error('wrong saved format')
    const slide = reopened.model.project.surfaces.find(surface => surface.type === 'slide')!
    expect(slide.type).toBe('slide')
    if (slide.type !== 'slide') throw new Error('missing slide')
    expect(slide.scenes).toHaveLength(1)
    const runtimes = slide.scenes.flatMap(scene => scene.layerItems).filter(item => item.kind === 'runtime')
    expect(runtimes).toHaveLength(1)
    const runtime = runtimes[0]!
    const html = unpackHtmlDocumentRuntimeSource(runtime.runtime.source)?.html ?? ''
    expect(html).toContain('<h1>斜抛运动</h1>')
    expect(html).toContain('this.textContent=\'已观察\'')
    expect(f.admission).toHaveBeenCalledOnce()
    expect(f.executeChild.mock.calls.map(([, call]) => call.name)).toEqual(['file.open', 'file.create', 'html.import', 'file.save'])
    expect(await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)).toEqual(output)
    expect(f.executeChild).toHaveBeenCalledTimes(4)
  })

  it('continues at save after a lost import acknowledgement without creating a second file or importing twice', async () => {
    const f = await fixture(); f.loseImportAck()
    await expect(createCourseFromHtml({ sourcePath: f.sourcePath, name: '课程初稿' }, f.context, f.ports)).rejects.toThrow('lost outer acknowledgement')
    const output = await createCourseFromHtml({ sourcePath: f.sourcePath, name: '课程初稿' }, f.context, f.ports)
    expect(output).toMatchObject({ kind: 'read', data: { saved: true, path: path.join(f.workspaceRoot, '课程初稿.h5lesson') } })
    expect(f.executeChild.mock.calls.map(([, call]) => call.name)).toEqual(['file.open', 'file.create', 'html.import', 'file.save'])
    expect(f.admission).toHaveBeenCalledOnce()
    expect((await fs.readdir(f.workspaceRoot)).filter(name => name.endsWith('.h5lesson'))).toEqual(['课程初稿.h5lesson'])
  })

  it('reports an applied import separately from a definite save rejection and preserves unknown outcomes', async () => {
    const f = await fixture()
    const saveError: ToolResult = { kind: 'error', code: 'delivery-rejected', message: '磁盘文件在保存前改变' }
    const execute = f.ports.executeChild
    f.ports.executeChild = async (id, call) => call.name === 'file.save' ? saveError : execute(id, call)
    expect(await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)).toMatchObject({ kind: 'read', data: {
      status: 'imported', saved: false, saveError: saveError.message, import: { kind: 'document-operation', result: { status: 'applied' } },
    } })
    f.ports.lookupChild = async (_id, name) => name === 'html.import'
      ? { kind: 'error', code: 'tool-outcome-unknown', message: '原导入提交待查证' }
      : f.children.get(_id)?.result ?? null
    const before = f.executeChild.mock.calls.length
    expect(await createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
    expect(f.executeChild).toHaveBeenCalledTimes(before)
  })

  it('honors read-only and the stop barrier before creating or continuing work', async () => {
    const f = await fixture()
    expect(await createCourseFromHtml({ sourcePath: f.sourcePath }, { ...f.context, permission: 'read-only' }, f.ports))
      .toMatchObject({ kind: 'error', code: 'permission-denied' })
    expect(f.executeChild).not.toHaveBeenCalled()
    const execute = f.ports.executeChild
    f.ports.executeChild = async (id, call) => { const result = await execute(id, call); f.stop(); return result }
    await expect(createCourseFromHtml({ sourcePath: f.sourcePath }, f.context, f.ports)).rejects.toThrow('任务已停止')
    expect(f.executeChild.mock.calls.map(([, call]) => call.name)).toEqual(['file.open'])
    expect((await fs.readdir(f.workspaceRoot)).some(name => name.endsWith('.h5lesson'))).toBe(false)
  })
})
