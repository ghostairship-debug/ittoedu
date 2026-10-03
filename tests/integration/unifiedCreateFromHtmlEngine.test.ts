// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { HtmlImportToolService } from '../../src/main/workbench/htmlImport/HtmlImportToolService'
import { HtmlImportOperationStore } from '../../src/main/workbench/htmlImport/HtmlImportOperationStore'
import { HtmlImportNetworkGrants } from '../../src/main/workbench/htmlImport/htmlImportNetworkGrants'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { resolveSaveDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'
import type { CreatedCourseFromHtml } from '../../src/main/workbench/htmlImport/CreateCourseFromHtml'

it('creates, imports and saves an external HTML from an actual document-free Engine run without exposing mechanical child calls to the provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-html-engine-'))
  try {
    const workspaceRoot = path.join(root, 'workspace')
    await fs.mkdir(workspaceRoot)
    const html = '<!doctype html><html><head><style>main{display:grid;grid-template-columns:1fr 1fr;gap:24px}</style></head><body><main><h1>外部互动页面</h1><button onclick="this.textContent=\'已观察\'">观察</button></main></body></html>'
    const sourcePath = path.join(workspaceRoot, 'external.html')
    await fs.writeFile(sourcePath, html)
    const host = new DocumentHostService(path.join(root, 'journal'))
    const files = new AgentFileService(host)
    const access = { workspaceRoot, permission: 'workspace' as const }
    const pixel = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
    const png = `data:image/png;base64,${pixel.toString('base64')}`
    // This adapter exercises canonical import/application wiring. It is not a new visual-admission claim;
    // real mixed-layout/Runtime Chromium evidence belongs to the composition runtime integration tests.
    const admission = vi.fn<BuildAdmissionPort['run']>(async payload => ({
      ok: true, processId: 1, message: 'controlled renderer admission adapter',
      captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({
        instanceId, locationId: target.locationId, width: 1, height: 1, dataUrl: png,
      }))).filter((capture, at, all) => all.findIndex(value => value.instanceId === capture.instanceId) === at),
      behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission',
        projectId: payload.project.id, documentRevision: payload.project.revision, locationId: target.locationId,
        stateId: target.stateId ?? null, instanceIds: target.instanceIds, sourceIdentities: {}, actions: [], elapsedMs: 0,
        semanticVerdict: 'requires-review', frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 0, stateVersion: 0,
          publicState: {}, width: 1, height: 1, dataUrl: png }] })),
    }))
    const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: { run: admission } })
    const grants = new HtmlImportNetworkGrants()
    const htmlImports = new HtmlImportToolService({
      documents: { read: host.internalAPI.read, get: id => host.registry.get(id) }, gateway: host.tools,
      cancelJob: async (runId, jobId) => { await builds.execute(runId, { type: 'cancel', jobId }) },
      networkGrants: grants, operationStore: new HtmlImportOperationStore(path.join(root, 'imports')),
    })
    const imported = vi.spyOn(htmlImports, 'import')
    const deliveries = new DocumentDeliveryService({
      documents: { read: host.internalAPI.read, saveWithFact: (...args) => host.saveWithFact(...args),
        lookupSave: (...args) => host.lookupSave(...args),
        withFileLease: (id, work) => host.registry.get(id).withFileLease(lease => work(() => lease.read())) },
      operations: new DocumentDeliveryOperationStore(path.join(root, 'deliveries')),
      authorize: async ({ documentId }) => {
        const snapshot = await host.internalAPI.read(documentId)
        if (snapshot.binding.kind !== 'file' || path.dirname(snapshot.binding.path) !== workspaceRoot) throw new Error('outside frozen workspace')
      },
      resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, () => access),
      resolveExportDestination: async () => null,
      build: { build: async () => { throw new Error('This task does not export') } }, writer: workbenchExportWriter,
    })
    host.tools.configureHostServices({ htmlImports, deliveries, builds: Object.assign(builds, {
      policy: (runId: string, documentId: string) => grants.policy(runId, documentId, () => host.registry.get(documentId).read()),
    }) })
    const requests: ModelRequest[] = []
    const complete = (request: ModelRequest, call = false): Extract<ModelEvent, { type: 'response.completed' }> => {
      const calls = call ? [{ id: 'create-html-course', name: 'course.createFromHtml', argumentsText: JSON.stringify({ sourcePath }) }] : []
      return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: `response-${requests.length}`,
        actualModel: 'controlled-provider', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
        assistant: { role: 'assistant', content: call ? null : '课件已导入并保存。', ...(call ? { tool_calls: calls.map(value => ({
          id: value.id, type: 'function' as const, function: { name: value.name, arguments: value.argumentsText },
        })) } : {}) } }
    }
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) {
        expect(host.registry.list()).toHaveLength(0)
        expect(request.tools?.some(tool => tool.name === 'course.createFromHtml')).toBe(true)
        yield complete(request, true); return
      }
      const responses = request.messages.filter(message => message.role === 'tool')
      expect(responses).toHaveLength(1)
      expect(responses[0]!.tool_call_id).toBe('create-html-course')
      expect(JSON.parse(String(responses[0]!.content))).toMatchObject({ kind: 'read', data: { status: 'saved', saved: true } })
      const modelCallIds = request.messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.tool_calls)
        ? message.tool_calls.map(call => typeof call === 'object' && call !== null && !Array.isArray(call) ? call.id : null) : [])
      expect(modelCallIds).toEqual(['create-html-course'])
      yield complete(request)
    } }
    const runs = new ExecutionRunStore(path.join(root, 'runs'))
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files, runs,
      events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
    const started = await engine.start({ conversationId: 'html-from-no-target', taskId: 'create-html-course', instruction: '将这个第三方 HTML 新建为可编辑课件并保存',
      documents: [], workspaceRoot, permission: 'workspace', selection: { model: 'controlled-provider', connection: {
        id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat', baseURL: 'https://controlled.invalid/v1', accountId: 'controlled',
        auth: { kind: 'api-key', credentialRef: 'controlled' }, billing: { kind: 'unknown' },
        capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
      } } })
    const final = await engine.wait(started.runId)
    expect(final.status, JSON.stringify(final.tools.map(tool => tool.result))).toBe('completed')
    expect(requests).toHaveLength(2)
    const outer = final.tools.find(tool => tool.call.name === 'course.createFromHtml')!
    if (outer.result?.kind !== 'read') throw new Error('Expected saved course receipt')
    const delivered = outer.result.data as CreatedCourseFromHtml
    expect(delivered).toMatchObject({ status: 'saved', saved: true, path: path.join(workspaceRoot, 'external.h5lesson') })
    expect(imported).toHaveBeenCalledOnce()
    expect(admission).toHaveBeenCalledOnce()
    const hostTools = final.tools.filter(tool => tool.origin === 'host')
    expect(hostTools.map(tool => tool.call.name)).toEqual(['file.open', 'file.create', 'html.import', 'file.save'])
    expect(hostTools.every(tool => tool.state === 'returned')).toBe(true)
    expect(final.messages.filter(message => message.role === 'tool')).toHaveLength(1)
    expect((await runs.read(final.runId))?.tools.filter(tool => tool.origin === 'host')).toHaveLength(4)
    expect(host.registry.get(delivered.documentId).read()).toMatchObject({ undoDepth: 1, dirty: false })
    const reopened = await new DocumentHostService(path.join(root, 'reopened-journal')).open(delivered.path)
    if (reopened.model.kind !== 'course-v9') throw new Error('Saved file is not a real Course V9 document')
    const slide = reopened.model.project.surfaces.find(surface => surface.type === 'slide')!
    expect(slide.scenes).toHaveLength(1)
    const importedItems = slide.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime'))
    expect(importedItems).toHaveLength(1)
    const item = importedItems[0]!
    if (item.kind !== 'runtime') throw new Error('Interaction carrier was changed')
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toBe(html)
    expect(await fs.readFile(sourcePath, 'utf8')).toBe(html)
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) }
}, 30000)
