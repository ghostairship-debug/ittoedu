// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { mutateAddSlideScene } from '../../src/core/tools/slideStructure'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { McpDocumentServer } from '../../src/main/workbench/external/McpDocumentServer'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { HtmlImportNetworkGrants } from '../../src/main/workbench/htmlImport/htmlImportNetworkGrants'
import { HtmlImportOperationStore } from '../../src/main/workbench/htmlImport/HtmlImportOperationStore'
import { HtmlImportToolService } from '../../src/main/workbench/htmlImport/HtmlImportToolService'
import { executeHtmlImport, htmlImportInputSchema } from '../../src/core/tools/HtmlImportTools'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import type { BuildAdmissionPort } from '../../src/shared/workbench/build'
import type { SpatialSurfaceDocument } from '../../src/shared/courseProjectTypes'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function setupTestEnvironment(admission?: BuildAdmissionPort, cancelJobSpy?: (runId: string, jobId: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m24-html-import-'))
  roots.push(root)

  const threeSectionsFixture = path.resolve(__dirname, '../fixtures/g20-m24/three-sections.html')
  const remoteScriptFixture = path.resolve(__dirname, '../fixtures/g20-m24/remote-script.html')

  const blank = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const projectWithFlow = addCourseFlowPage(blank, { expectedRevision: blank.revision }).project
  projectWithFlow.surfaces.push({
    id: 'surface-spatial',
    title: '无限画布',
    type: 'spatial-2d',
    surfaceLayerItems: [],
    world: {
      bounds: { mode: 'infinite' },
      layerItems: [],
      paths: [],
      relations: [],
    },
    camera: {
      home: { x: 200, y: 130, zoom: 1 },
      frames: [{ id: 'camera-home', name: '全景', x: 200, y: 130, zoom: 1 }],
    },
    semanticZoom: [],
  })
  projectWithFlow.locations.push({
    id: 'loc-spatial',
    kind: 'spatial-camera',
    surfaceId: 'surface-spatial',
    cameraFrameId: 'camera-home',
    label: '全景',
  })
  projectWithFlow.mixedPrintPlan!.entries.push({
    id: 'print-entry-spatial',
    kind: 'spatial-frames',
    surfaceId: 'surface-spatial',
    cameraFrameIds: ['camera-home'],
  })

  const driver = new CourseV9Driver()
  const textDriver = new TextDriver()
  const journal = createDocumentJournal({ directory: path.join(root, 'journal') })
  const registry = new DocumentRegistry({
    persistence: journal,
    drivers: [driver, textDriver],
    createId: randomUUID,
    bindingKey: binding => binding.path,
  })

  const courseSession = await registry.create(
    { kind: 'course-v9', project: projectWithFlow, resources: { assets: {}, components: {} } },
    path.join(root, 'course.h5lesson'),
  )

  const threeSectionsHtml = await fs.readFile(threeSectionsFixture, 'utf8')
  const htmlSession = await registry.open(
    { kind: 'file', path: threeSectionsFixture, version: null, bindingVersion: 1 },
    async () => ({ kind: 'text', source: threeSectionsHtml, resources: { assets: {}, components: {} } }),
  )

  const remoteScriptHtml = await fs.readFile(remoteScriptFixture, 'utf8')
  const remoteHtmlSession = await registry.open(
    { kind: 'file', path: remoteScriptFixture, version: null, bindingVersion: 1 },
    async () => ({ kind: 'text', source: remoteScriptHtml, resources: { assets: {}, components: {} } }),
  )

  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  const run = vi.fn<BuildAdmissionPort['run']>(async payload => ({
    ok: true,
    message: 'fake admission',
    processId: 1,
    captures: payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({
      instanceId,
      locationId: target.locationId,
      width: 1,
      height: 1,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    }))).filter((capture, index, all) => all.findIndex(item => item.instanceId === capture.instanceId) === index),
    behaviorEvidence: payload.targets.map(target => ({
      version: 1,
      status: 'observed',
      mode: 'full-admission',
      projectId: payload.project.id,
      documentRevision: payload.project.revision,
      locationId: target.locationId,
      stateId: target.stateId ?? null,
      instanceIds: target.instanceIds,
      sourceIdentities: {},
      actions: [],
      frames: [{
        phase: 'running',
        elapsedMs: 0,
        capturedAt: 0,
        stateVersion: 0,
        publicState: {},
        width: 1,
        height: 1,
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      }],
      elapsedMs: 0,
      semanticVerdict: 'requires-review',
    })),
  }))

  const builds = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: admission ?? { run } })
  const grants = new HtmlImportNetworkGrants()
  const hostedBuilds = Object.assign(builds, {
    policy: (runId: string, documentId: string) => grants.policy(runId, documentId, () => registry.get(documentId).read()),
  })

  const gateway = new DocumentToolGateway(registry, [driver, textDriver], randomUUID)
  const operationStore = new HtmlImportOperationStore(path.join(root, 'operations'))

  const cancelJob = cancelJobSpy ?? (async (runId: string, jobId: string) => {
    await builds.execute(runId, { type: 'cancel', jobId })
  })

  const toolService = new HtmlImportToolService({
    documents: {
      read: async (id: string) => registry.get(id).drain(),
      get: (id: string) => registry.get(id),
    },
    gateway,
    cancelJob,
    networkGrants: grants,
    operationStore,
  })
  gateway.configureHostServices({ builds: hostedBuilds, htmlImports: toolService })

  return {
    root,
    registry,
    gateway,
    operationStore,
    toolService,
    courseSession,
    htmlSession,
    remoteHtmlSession,
    run,
    builds,
  }
}

describe('M24 g20-b18-c2 HTML section import orchestration', () => {
  it('automatically imports ambiguous sections as one faithful page and preserves them after saving', async () => {
    const env = await setupTestEnvironment(), runId = 'auto-whole-fallback'
    const html = '<body><section>Intro</section><main><section>Exercise</section><button onclick="this.textContent=\'Done\'">Start</button></main></body>'
    const sourceSession = await env.registry.create({ kind: 'text', source: html, resources: { assets: {}, components: {} } }, 'flexible.html')
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: sourceSession.documentId, writable: [] },
    ] })
    await env.gateway.loadToolFamilies(runId, ['build'])
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, sourceSession.documentId, { kind: 'document' }, { readOnly: true })
    const result = await env.gateway.execute(runId, 'auto-import', { name: 'html.import', input: { source, target, mode: 'auto' } })
    expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(env.courseSession.read().undoDepth).toBe(1)
    const file = path.join(env.root, 'auto-import.h5lesson')
    await env.courseSession.save({ kind: 'file', path: file, version: null, bindingVersion: 1 })
    const reopened = new CourseV9Driver().load(new Uint8Array(await fs.readFile(file)))
    if (reopened.kind !== 'course-v9') throw new Error('wrong model')
    const imports = reopened.project.surfaces.flatMap(surface => surface.type === 'slide'
      ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime')) : [])
    expect(imports).toHaveLength(1)
    const item = imports[0]!
    if (item.kind !== 'runtime') throw new Error('wrong carrier')
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toBe(html)
  })
  it('executes html.import through the external MCP HTTP bridge with the same canonical receipt', async () => {
    const env = await setupTestEnvironment()
    const server = new McpDocumentServer({ gateway: env.gateway, registry: env.registry,
      appendEvent: async () => undefined })
    const connection = await server.grant({ workspaceId: 'space', conversationId: 'conversation', taskId: 'import',
      instruction: '导入 HTML', documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [] },
      ] })
    try {
      let session = '', sequence = 0
      const request = async (method: string, params: unknown = {}) => {
        const response = await fetch(connection.endpoint, { method: 'POST', headers: {
          Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
          ...(session ? { 'MCP-Session-Id': session } : {}),
        }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) })
        session = response.headers.get('mcp-session-id') ?? session
        expect(response.status).toBe(200)
        return await response.json() as any
      }
      await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'm24-fixture', version: '1' } })
      const initialized = await fetch(connection.endpoint, { method: 'POST', headers: {
        Authorization: `Bearer ${connection.bearer}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', 'MCP-Session-Id': session,
      }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
      expect(initialized.status).toBe(202)
      const context = JSON.parse((await request('resources/read', { uri: 'guoling://task/context' })).result.contents[0].text)
      const catalog = (await request('tools/list')).result.tools
      const canonical = (await env.gateway.describe(['html.import']))[0]!
      expect(catalog.find((tool: any) => tool.name === 'html.import').inputSchema.properties.arguments).toEqual(canonical.schema)
      const before = env.courseSession.read()
      if (before.model.kind !== 'course-v9') throw new Error('wrong model')
      const slide = before.model.project.surfaces.find(item => item.type === 'slide')!
      const args = { source: context.documents[1].target, target: context.documents[0].target,
        mode: 'sections', destinations: [{ kind: 'slide-new', surface: slide.id }] }
      const ticket = context.operationTickets[0]
      const call = await request('tools/call', { name: 'html.import', arguments: { ticket, arguments: args } })
      expect(call.result.structuredContent.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      const lookup = await request('tools/call', { name: 'operation.lookup', arguments: { ticket, name: 'html.import', arguments: args } })
      expect(lookup.result.structuredContent.result).toEqual(call.result.structuredContent.result)
      expect(env.courseSession.read().undoDepth).toBe(before.undoDepth + 1)
      expect(env.run).toHaveBeenCalledOnce()
    } finally { await server.close() }
  })

  it('uses the shared html.import schema and canonical gateway execute/lookup path', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-gateway-html-import'
    const described = (await env.gateway.describe(['html.import']))[0]
    expect(described?.name).toBe('html.import')
    expect(described?.schema).toEqual(z.toJSONSchema(htmlImportInputSchema))
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [] },
    ] })
    await env.gateway.loadToolFamilies(runId, ['build'])
    expect((await env.gateway.describeRun(runId)).map(tool => tool.name)).toContain('html.import')
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const before = env.courseSession.read()
    if (before.model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = before.model.project.surfaces.find(item => item.type === 'slide')!
    const location = before.model.project.locations.find(item => item.surfaceId === slide.id)!
    const slideHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId,
      { kind: 'course-surface', surfaceId: slide.id })
    const locationHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId,
      { kind: 'course-location', locationId: location.id })
    const call = { name: 'html.import', input: { source, target, mode: 'sections',
      destinations: [
        { kind: 'slide-existing', location: locationHandle },
        { kind: 'slide-new', surface: slideHandle },
        { kind: 'slide-new', surface: slideHandle },
      ] } }
    const first = await env.gateway.execute(runId, 'gateway-html-import-call', call)
    expect(first.kind).toBe('document-operation')
    if (first.kind !== 'document-operation') return
    expect(first.result.status).toBe('applied')
    expect(env.courseSession.read().undoDepth).toBe(before.undoDepth + 1)
    expect(env.run).toHaveBeenCalledOnce()
    expect(await env.gateway.lookup(runId, 'gateway-html-import-call', call)).toEqual(first)
    await env.registry.close(env.htmlSession.documentId)
    expect(await env.gateway.lookup(runId, 'gateway-html-import-call', call)).toEqual(first)
    expect(await env.gateway.execute(runId, 'gateway-html-import-call', call)).toEqual(first)
    expect(env.courseSession.read().undoDepth).toBe(before.undoDepth + 1)
  })

  it('splits three sections into slide-existing, flow-insert, and slide-new in a single admission and single commit with undo/redo', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-1'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshotBefore = await env.courseSession.drain()
    const slideSurface = snapshotBefore.model.kind === 'course-v9' ? snapshotBefore.model.project.surfaces.find(s => s.type === 'slide')! : null
    const flowSurface = snapshotBefore.model.kind === 'course-v9' ? snapshotBefore.model.project.surfaces.find(s => s.type === 'flow')! : null
    if (!slideSurface || slideSurface.type !== 'slide' || !flowSurface || flowSurface.type !== 'flow') throw new Error('surfaces missing')

    const initialSceneId = slideSurface.scenes[0]!.id

    const destinations = [
      { kind: 'slide-existing' as const, location: initialSceneId },
      { kind: 'flow-insert' as const, container: flowSurface.id },
      { kind: 'slide-new' as const, surface: slideSurface.id },
    ]

    const context = {
      runId,
      operationId: 'op-three-sections-1',
      requestDigest: 'digest-three-sections-1',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    const toolResult = await executeHtmlImport(
      env.toolService,
      context,
      {
        source: sourceHandle,
        target: targetHandle,
        mode: 'sections',
        destinations,
      },
    )

    expect(toolResult.kind).toBe('document-operation')
    if (toolResult.kind !== 'document-operation') return
    expect(toolResult.result.status).toBe('applied')

    // Verify admission was run exactly once for all 3 pages
    expect(env.run).toHaveBeenCalledOnce()

    // Verify document model structure after import
    const committedSnapshot = await env.courseSession.drain()
    if (committedSnapshot.model.kind !== 'course-v9') throw new Error('wrong model')
    const model = committedSnapshot.model

    const slideAfter = model.project.surfaces.find(s => s.id === slideSurface.id)
    if (!slideAfter || slideAfter.type !== 'slide') throw new Error('missing slide')
    expect(slideAfter.scenes).toHaveLength(2)

    // Scene 0 (existing) has Section 1 runtime
    const scene0Runtime = slideAfter.scenes[0]!.layerItems.find(item => item.kind === 'runtime')
    expect(scene0Runtime).toBeDefined()
    if (scene0Runtime?.kind !== 'runtime') throw new Error('scene0 runtime missing')
    const s1Html = unpackHtmlDocumentRuntimeSource(scene0Runtime.runtime.source)?.html ?? ''
    expect(s1Html).toContain('第一节：固定画布观察')
    expect(s1Html).toContain('页内说明')
    expect(s1Html).toContain('cw-resource:')
    expect(s1Html).not.toContain('data:image/png;base64,')

    // Flow surface has Section 2 runtime anchored to an inserted paragraph
    const flowAfter = model.project.surfaces.find(s => s.id === flowSurface.id)
    if (!flowAfter || flowAfter.type !== 'flow') throw new Error('missing flow')
    expect(flowAfter.surfaceLayerItems).toHaveLength(1)
    const flowLayerItem = flowAfter.surfaceLayerItems[0]!
    expect(flowLayerItem.item.kind).toBe('runtime')
    expect(flowLayerItem.paragraphAnchor?.blockId).toBeTruthy()
    const anchorBlock = flowAfter.blocks.find(b => b.id === flowLayerItem.paragraphAnchor!.blockId)
    expect(anchorBlock).toBeDefined()
    expect(anchorBlock?.type).toBe('paragraph')
    const s2Html = unpackHtmlDocumentRuntimeSource((flowLayerItem.item as any).runtime.source)?.html ?? ''
    expect(s2Html).toContain('第二节：流式观察记录')

    // Scene 1 (new) has Section 3 runtime
    const scene1 = slideAfter.scenes[1]!
    const scene1Runtime = scene1.layerItems.find(item => item.kind === 'runtime')
    expect(scene1Runtime).toBeDefined()
    if (scene1Runtime?.kind !== 'runtime') throw new Error('scene1 runtime missing')
    const s3Html = unpackHtmlDocumentRuntimeSource(scene1Runtime.runtime.source)?.html ?? ''
    expect(s3Html).toContain('第三节：持续镜头')

    // Verify asset deduplication across all three sections:
    // All 3 sections referenced the exact same base64 png data.
    const key0 = Object.keys(scene0Runtime.runtime.assets)[0]!
    const key1 = Object.keys((flowLayerItem.item as any).runtime.assets)[0]!
    const key2 = Object.keys(scene1Runtime.runtime.assets)[0]!

    expect(key0).toBe(key1)
    expect(key1).toBe(key2)

    const assetId0 = scene0Runtime.runtime.assets[key0]!.assetId
    const assetId1 = (flowLayerItem.item as any).runtime.assets[key1]!.assetId
    const assetId2 = scene1Runtime.runtime.assets[key2]!.assetId

    expect(assetId0).toBe(assetId1)
    expect(assetId1).toBe(assetId2)

    // The asset exists in model.resources.assets exactly once
    const matchingAssets = Object.keys(model.resources.assets).filter(id => id === assetId0)
    expect(matchingAssets).toHaveLength(1)

    // Verify single-transaction Undo
    expect(committedSnapshot.undoDepth).toBe(1)
    await env.courseSession.execute({
      documentId: committedSnapshot.documentId,
      epoch: committedSnapshot.epoch,
      baseRevision: committedSnapshot.revision,
      operationId: 'undo-import',
      actor: 'human',
      mutation: { type: 'undo' },
    })

    const undoneSnapshot = await env.courseSession.drain()
    expect(undoneSnapshot.undoDepth).toBe(0)
    expect(undoneSnapshot.revision).toBeGreaterThan(committedSnapshot.revision)
    if (undoneSnapshot.model.kind !== 'course-v9') throw new Error('wrong model')
    const undoneSlide = undoneSnapshot.model.project.surfaces.find(s => s.id === slideSurface.id)! as any
    expect(undoneSlide.scenes).toHaveLength(1)
    expect(undoneSlide.scenes[0]!.layerItems).toHaveLength(0)

    const undoneFlow = undoneSnapshot.model.project.surfaces.find(s => s.id === flowSurface.id)! as any
    expect(undoneFlow.surfaceLayerItems).toHaveLength(0)
    expect(undoneFlow.blocks.some((b: any) => b.id === flowLayerItem.paragraphAnchor!.blockId)).toBe(false)
    expect(undoneSnapshot.model.resources.assets[assetId0]).toBeUndefined()

    // Verify single-transaction Redo restores everything
    await env.courseSession.execute({
      documentId: undoneSnapshot.documentId,
      epoch: undoneSnapshot.epoch,
      baseRevision: undoneSnapshot.revision,
      operationId: 'redo-import',
      actor: 'human',
      mutation: { type: 'redo' },
    })

    const redoneSnapshot = await env.courseSession.drain()
    expect(redoneSnapshot.undoDepth).toBe(1)
    if (redoneSnapshot.model.kind !== 'course-v9') throw new Error('wrong model')
    const redoneSlide = redoneSnapshot.model.project.surfaces.find(s => s.id === slideSurface.id)! as any
    expect(redoneSlide.scenes).toHaveLength(2)
    expect(redoneSnapshot.model.resources.assets[assetId0]).toBeDefined()
  })

  it('provides idempotent receipts and returns existing receipt without repeating admission on same operationId', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-idempotency'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshot = await env.courseSession.drain()
    const slideSurface = snapshot.model.kind === 'course-v9' ? snapshot.model.project.surfaces.find(s => s.type === 'slide')! : null
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('slide missing')

    const context = {
      runId,
      operationId: 'op-idem-1',
      requestDigest: 'digest-idem-1',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    const payload = {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections' as const,
      destinations: [{ kind: 'slide-new' as const, surface: slideSurface.id }],
    }

    const result1 = await executeHtmlImport(env.toolService, context, payload)
    expect(result1.kind).toBe('document-operation')
    expect(env.run).toHaveBeenCalledOnce()

    // Second execution with same operationId and requestDigest
    const result2 = await executeHtmlImport(env.toolService, context, payload)
    expect(result2).toEqual(result1)
    // Admission run was NOT called again
    expect(env.run).toHaveBeenCalledOnce()

    // Lookup also returns the exact receipt
    const lookupReceipt = await env.toolService.lookup({
      runId,
      operationId: context.operationId,
      requestDigest: context.requestDigest,
    })
    expect(lookupReceipt).toBeDefined()
    expect(lookupReceipt?.status).toBe('applied')
  })

  it('rejects with error when same operationId is reused with different requestDigest', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-mismatch'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshot = await env.courseSession.drain()
    const slideSurface = snapshot.model.kind === 'course-v9' ? snapshot.model.project.surfaces.find(s => s.type === 'slide')! : null
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('slide missing')

    const context1 = {
      runId,
      operationId: 'op-mismatch-1',
      requestDigest: 'digest-original',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    await executeHtmlImport(env.toolService, context1, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-new', surface: slideSurface.id }],
    })

    // Same operationId but changed requestDigest
    const context2 = {
      ...context1,
      requestDigest: 'digest-altered',
    }

    await expect(
      executeHtmlImport(env.toolService, context2, {
        source: sourceHandle,
        target: targetHandle,
        mode: 'sections',
        destinations: [{ kind: 'slide-new', surface: slideSurface.id }],
      }),
    ).rejects.toThrow('同一 HTML 导入操作编号不能改变请求参数')
  })

  it('rejects remote scripts before creating scratch and touches neither disk nor document', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-remote-script'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.remoteHtmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.remoteHtmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshotBefore = await env.courseSession.drain()
    const slideSurface = snapshotBefore.model.kind === 'course-v9' ? snapshotBefore.model.project.surfaces.find(s => s.type === 'slide')! : null
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('slide missing')

    const context = {
      runId,
      operationId: 'op-remote-1',
      requestDigest: 'digest-remote-1',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    const result = await executeHtmlImport(env.toolService, context, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-new', surface: slideSurface.id }],
    })

    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('远程')
    }

    // Admission was never called
    expect(env.run).not.toHaveBeenCalled()

    // Target document was untouched
    const snapshotAfter = await env.courseSession.drain()
    expect(snapshotAfter.revision).toBe(snapshotBefore.revision)
    expect(snapshotAfter.undoDepth).toBe(snapshotBefore.undoDepth)
  })

  it('cancels before a build job exists without dispatching any child call', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-cancel-before-job'
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [] },
    ] })
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const model = env.courseSession.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = model.project.surfaces.find(item => item.type === 'slide')!
    let releaseTarget!: () => void
    const targetGate = new Promise<void>(resolve => { releaseTarget = resolve })
    const originalIssueTarget = env.gateway.issueTarget.bind(env.gateway)
    vi.spyOn(env.gateway, 'issueTarget').mockImplementation(async (id, documentId, requested, options) => {
      await targetGate
      return originalIssueTarget(id, documentId, requested, options)
    })
    const childSpy = vi.spyOn(env.gateway, 'executeInternalBuild')
    const stopSpy = vi.spyOn(env.gateway, 'stop')
    const operationId = 'cancel-before-job'
    const running = executeHtmlImport(env.toolService, { runId, operationId, requestDigest: 'cancel-before-job-digest',
      resolveHandle: (handle, access) => env.gateway.resolveWholeDocumentHandle(runId, handle, access) },
    { source, target, mode: 'sections', destinations: [{ kind: 'slide-new', surface: slide.id }] })
    let record = await env.operationStore.lookup(runId, operationId)
    for (let i = 0; i < 50 && record?.status !== 'preparing'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20))
      record = await env.operationStore.lookup(runId, operationId)
    }
    if (record?.status !== 'preparing') { releaseTarget(); throw new Error('import did not reach target issuance') }
    await env.toolService.cancel({ runId, operationId })
    releaseTarget()
    expect((await running).kind).toBe('error')
    expect(childSpy).not.toHaveBeenCalled()
    expect(stopSpy).not.toHaveBeenCalled()
    expect((await env.operationStore.lookup(runId, operationId))?.status).toBe('cancelled')
    expect(env.courseSession.read().undoDepth).toBe(0)
  })

  it('cancels only the specific import job when cancel is requested and does not stop the entire run', async () => {
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    const cancelJobSpy = vi.fn(async (_runId: string, _jobId: string) => {})

    const env = await setupTestEnvironment(
      {
        run: async () => {
          await gate
          return { ok: true, message: 'late', processId: 1 }
        },
      },
      cancelJobSpy,
    )

    const runId = 'test-run-cancel-job'
    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshot = await env.courseSession.drain()
    const slideSurface = snapshot.model.kind === 'course-v9' ? snapshot.model.project.surfaces.find(s => s.type === 'slide')! : null
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('slide missing')

    const context = {
      runId,
      operationId: 'op-cancel-1',
      requestDigest: 'digest-cancel-1',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    const gatewayStopSpy = vi.spyOn(env.gateway, 'stop')

    // Start import (which will block waiting for gate in admission)
    const importPromise = executeHtmlImport(env.toolService, context, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-new', surface: slideSurface.id }],
    })

    // Wait until prepare finishes and records the checking status with jobId
    for (let i = 0; i < 50; i++) {
      const rec = await env.operationStore.lookup(runId, context.operationId)
      if (rec?.jobId) break
      await new Promise(r => setTimeout(r, 20))
    }

    // Request cancel on this operation
    await env.toolService.cancel({ runId, operationId: context.operationId })

    // Release admission gate
    releaseGate!()

    const result = await importPromise
    expect(result.kind).toBe('error')

    // cancelJob was called with the specific jobId
    expect(cancelJobSpy).toHaveBeenCalledOnce()
    expect(cancelJobSpy.mock.calls[0]![0]).toBe(runId)
    expect(typeof cancelJobSpy.mock.calls[0]![1]).toBe('string')

    // gateway.stop was NOT called, leaving other jobs in runId running!
    expect(gatewayStopSpy).not.toHaveBeenCalled()
  })

  it('rejects import destinations targeting Spatial 2D surface', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-spatial-reject'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const context = {
      runId,
      operationId: 'op-spatial-reject',
      requestDigest: 'digest-spatial-reject',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    // 1. slide-new targeting spatial surface
    const resultSlideNew = await executeHtmlImport(env.toolService, context, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-new', surface: 'surface-spatial' }],
    })
    expect(resultSlideNew.kind).toBe('error')
    if (resultSlideNew.kind === 'error') {
      expect(resultSlideNew.message).toContain('Spatial')
    }

    // 2. slide-existing targeting spatial camera location
    const context2 = { ...context, operationId: 'op-spatial-reject-2', requestDigest: 'digest-spatial-reject-2' }
    const resultSlideExisting = await executeHtmlImport(env.toolService, context2, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-existing', location: 'loc-spatial' }],
    })
    expect(resultSlideExisting.kind).toBe('error')
    if (resultSlideExisting.kind === 'error') {
      expect(resultSlideExisting.message).toContain('Spatial')
    }

    // 3. flow-insert targeting spatial surface
    const context3 = { ...context, operationId: 'op-spatial-reject-3', requestDigest: 'digest-spatial-reject-3' }
    const resultFlowInsert = await executeHtmlImport(env.toolService, context3, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'flow-insert', container: 'surface-spatial' }],
    })
    expect(resultFlowInsert.kind).toBe('error')
    if (resultFlowInsert.kind === 'error') {
      expect(resultFlowInsert.message).toContain('Spatial')
    }
  })

  it('separates outer operationId from child callIds and records them in operation store', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-run-callids'

    await env.gateway.beginRun({
      runId,
      actor: 'human',
      documents: [
        { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
        { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
      ],
    })

    const targetHandle = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const sourceHandle = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })

    const snapshot = await env.courseSession.drain()
    const slideSurface = snapshot.model.kind === 'course-v9' ? snapshot.model.project.surfaces.find(s => s.type === 'slide')! : null
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('slide missing')

    const executeSpy = vi.spyOn(env.gateway, 'executeInternalBuild')

    const outerOpId = 'op-outer-xyz'
    const context = {
      runId,
      operationId: outerOpId,
      requestDigest: 'digest-xyz',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access),
    }

    const result = await executeHtmlImport(env.toolService, context, {
      source: sourceHandle,
      target: targetHandle,
      mode: 'sections',
      destinations: [{ kind: 'slide-new', surface: slideSurface.id }],
    })

    expect(result.kind).toBe('document-operation')

    // Inspect operation record in store
    const record = await env.operationStore.lookup(runId, outerOpId)
    expect(record).toBeDefined()
    expect(record?.children.find(child => child.name === 'build.import')?.callId).toBe(`html:${outerOpId}:commit`)

    // Verify all callIds passed to gateway.executeInternalBuild
    const calledCallIds = executeSpy.mock.calls.map(call => call[1])
    expect(calledCallIds.length).toBeGreaterThan(0)
    for (const callId of calledCallIds) {
      expect(callId).toMatch(/^html:op-outer-xyz:/)
      // The outer operationId is NEVER used verbatim as callId
      expect(callId).not.toBe(outerOpId)
    }

    expect(calledCallIds).toContain(`html:${outerOpId}:create`)
    expect(calledCallIds).toContain(`html:${outerOpId}:project`)
    expect(calledCallIds).toContain(`html:${outerOpId}:check`)
    expect(calledCallIds).toContain(`html:${outerOpId}:commit`)
  })

  it('gives three Flow pages independent paragraph anchors in one candidate', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-flow-three'
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const before = env.courseSession.read()
    if (before.model.kind !== 'course-v9') throw new Error('wrong model')
    const flow = before.model.project.surfaces.find(item => item.type === 'flow')!
    const receipt = await executeHtmlImport(env.toolService, { runId, operationId: 'flow-three', requestDigest: 'flow-three-digest',
      resolveHandle: (handle, access) => env.gateway.resolveWholeDocumentHandle(runId, handle, access) },
    { source, target, mode: 'sections', destinations: [{ kind: 'flow-insert', container: flow.id }] })
    expect(receipt.kind).toBe('document-operation')
    expect(env.run).toHaveBeenCalledOnce()
    const after = env.courseSession.read()
    if (after.model.kind !== 'course-v9') throw new Error('wrong model')
    const imported = after.model.project.surfaces.find(item => item.id === flow.id)
    if (imported?.type !== 'flow') throw new Error('wrong surface')
    const entries = imported.surfaceLayerItems.filter(entry => entry.item.kind === 'runtime')
    expect(entries).toHaveLength(3)
    const anchors = entries.map(entry => entry.paragraphAnchor?.blockId)
    expect(new Set(anchors).size).toBe(3)
    for (const anchor of anchors) expect(imported.blocks.some(block => block.id === anchor && block.type === 'paragraph')).toBe(true)
    expect(Object.keys(after.model.project.assets).filter(id => id.startsWith('html_'))).toHaveLength(1)
    expect(after.undoDepth).toBe(1)
  })

  it('imports unsaved canonical HTML and replays its receipt before stale handle resolution', async () => {
    const env = await setupTestEnvironment()
    const initial = env.htmlSession.read()
    await env.htmlSession.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
      operationId: 'edit-source', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace',
        source: '<!doctype html><html><body><section id="only"><h1>UNSAVED CANONICAL</h1></section></body></html>' } } })
    const runId = 'test-canonical-source'
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const model = env.courseSession.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = model.project.surfaces.find(item => item.type === 'slide')!
    const context = { runId, operationId: 'canonical-import', requestDigest: 'canonical-import-digest',
      resolveHandle: (handle: string, access: 'read' | 'write') => env.gateway.resolveWholeDocumentHandle(runId, handle, access) }
    const payload = { source, target, mode: 'sections' as const, destinations: [{ kind: 'slide-new' as const, surface: slide.id }] }
    const first = await executeHtmlImport(env.toolService, context, payload)
    expect(first.kind).toBe('document-operation')
    const imported = env.courseSession.read().model
    if (imported.kind !== 'course-v9') throw new Error('wrong model')
    const slideAfter = imported.project.surfaces.find(item => item.id === slide.id)
    if (slideAfter?.type !== 'slide') throw new Error('wrong surface')
    const runtime = slideAfter.scenes.at(-1)?.layerItems.find(item => item.kind === 'runtime')
    expect(runtime?.kind).toBe('runtime')
    if (runtime?.kind !== 'runtime') throw new Error('wrong runtime')
    expect(unpackHtmlDocumentRuntimeSource(runtime.runtime.source)?.html).toContain('UNSAVED CANONICAL')
    expect(unpackHtmlDocumentRuntimeSource(runtime.runtime.source)?.html).not.toContain('第一节：固定画布观察')
    const edited = env.htmlSession.read()
    await env.htmlSession.execute({ documentId: edited.documentId, epoch: edited.epoch, baseRevision: edited.revision,
      operationId: 'edit-source-again', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '<html><body>Changed</body></html>' } } })
    const repeat = await executeHtmlImport(env.toolService, { ...context, resolveHandle: async () => { throw new Error('stale handle was resolved') } }, payload)
    expect(repeat).toEqual(first)
    expect(env.run).toHaveBeenCalledOnce()
  })

  it('recovers a committed child after its outer ACK is lost without a second import', async () => {
    const env = await setupTestEnvironment()
    const runId = 'test-ack-loss'
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const model = env.courseSession.read().model
    if (model.kind !== 'course-v9') throw new Error('wrong model')
    const slide = model.project.surfaces.find(item => item.type === 'slide')!
    const payload = { source, target, mode: 'sections' as const, destinations: [{ kind: 'slide-new' as const, surface: slide.id }] }
    const callId = 'ack-loss-import'
    const operationId = env.gateway.operationIdentity(runId, callId)
    const call = { name: 'html.import', input: payload }
    await env.gateway.loadToolFamilies(runId, ['build'])
    const patch = env.operationStore.patch.bind(env.operationStore)
    const lost = vi.spyOn(env.operationStore, 'patch').mockImplementation(async (run, operation, change) => {
      if (change.status === 'committed') throw new Error('simulated lost outer ACK')
      return patch(run, operation, change)
    })
    expect(await env.gateway.execute(runId, callId, call)).toMatchObject({ kind: 'error', code: 'tool-outcome-unknown' })
    lost.mockRestore()
    const uncertain = await env.operationStore.lookup(runId, operationId)
    expect(uncertain?.status).toBe('committing')
    const child = uncertain?.children.find(item => item.name === 'build.import')
    expect(child?.callId).toBe(`html:${operationId}:commit`)
    expect(child?.input).toMatchObject({ job: expect.any(String), artifact: expect.any(String) })
    expect(await env.gateway.lookup(runId, callId, call)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const reopenedStore = new HtmlImportOperationStore(path.join(env.root, 'operations'))
    const reopenedService = new HtmlImportToolService({ documents: { read: async id => env.registry.get(id).drain(), get: id => env.registry.get(id) },
      gateway: env.gateway, cancelJob: async (run, jobId) => { await env.builds.execute(run, { type: 'cancel', jobId }) },
      operationStore: reopenedStore })
    const recovered = await executeHtmlImport(reopenedService,
      { runId, operationId, requestDigest: uncertain!.requestDigest,
        resolveHandle: async () => { throw new Error('stale handle was resolved') } }, payload)
    expect(recovered.kind).toBe('document-operation')
    expect(env.run).toHaveBeenCalledOnce()
    expect(env.courseSession.read().undoDepth).toBe(1)
    expect((await reopenedStore.lookup(runId, operationId))?.status).toBe('committed')
  })

  it('places newly imported scenes after the requested scene in source-page order', async () => {
    const env = await setupTestEnvironment()
    const initial = env.courseSession.read()
    if (initial.model.kind !== 'course-v9') throw new Error('wrong model')
    const surface = initial.model.project.surfaces.find(item => item.type === 'slide')!
    const original = surface.scenes[0]!.id
    const project = mutateAddSlideScene(initial.model.project, surface.id, { name: 'following scene' })
    project.revision = initial.model.project.revision
    const following = project.surfaces.find(item => item.id === surface.id)
    if (following?.type !== 'slide') throw new Error('wrong surface')
    const followingId = following.scenes[1]!.id
    const added = await env.courseSession.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
      operationId: 'add-following', actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project } } })
    expect(added.status).toBe('applied')
    const runId = 'test-slide-after'
    await env.gateway.beginRun({ runId, actor: 'human', documents: [
      { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
      { documentId: env.htmlSession.documentId, writable: [{ kind: 'document' }] },
    ] })
    const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
    const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
    const result = await executeHtmlImport(env.toolService, { runId, operationId: 'slide-after', requestDigest: 'slide-after-digest',
      resolveHandle: (handle, access) => env.gateway.resolveWholeDocumentHandle(runId, handle, access) },
    { source, target, mode: 'sections', destinations: [{ kind: 'slide-new', surface: surface.id, after: original }] })
    expect(result.kind).toBe('document-operation')
    const committed = env.courseSession.read()
    if (committed.model.kind !== 'course-v9') throw new Error('wrong model')
    const final = committed.model.project.surfaces.find(item => item.id === surface.id)
    if (final?.type !== 'slide') throw new Error('wrong surface')
    expect(final.scenes).toHaveLength(5)
    expect(final.scenes[0]!.id).toBe(original)
    expect(final.scenes[4]!.id).toBe(followingId)
    const sectionTitles = final.scenes.slice(1, 4).map(scene => scene.name)
    expect(sectionTitles).toEqual(['第一节：固定画布观察', '第二节：流式观察记录', '第三节：持续镜头'])
  })
})


it('persists an imported course to the actual h5lesson bytes and reopens it without a recovery journal', async () => {
  // Admission is the fixture above; this test verifies the real writer/archive round trip, not art quality.
  const env = await setupTestEnvironment(), runId = 'disk-roundtrip'
  await env.gateway.beginRun({ runId, actor: 'human', documents: [
    { documentId: env.courseSession.documentId, writable: [{ kind: 'document' }] },
    { documentId: env.htmlSession.documentId, writable: [] },
  ] })
  await env.gateway.loadToolFamilies(runId, ['build'])
  const target = await env.gateway.issueTarget(runId, env.courseSession.documentId, { kind: 'document' })
  const source = await env.gateway.issueTarget(runId, env.htmlSession.documentId, { kind: 'document' }, { readOnly: true })
  const before = env.courseSession.read()
  if (before.model.kind !== 'course-v9') throw new Error('fixture model')
  const slide = before.model.project.surfaces.find(surface => surface.type === 'slide')!
  const result = await env.gateway.execute(runId, 'import', { name: 'html.import', input: {
    source, target, mode: 'sections',
  } })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied', persistence: 'recoverable' } })
  // Compound import advances this run's own document reference; no reopen/read-tree ceremony.
  await expect(env.gateway.resolveWholeDocumentHandle(runId, target, 'write')).resolves.toMatchObject({ revision: before.revision + 1 })
  const file = path.join(env.root, 'delivered.h5lesson')
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  const saved = await env.courseSession.save({ kind: 'file', path: file, version: null, bindingVersion: 1 })
  expect(saved.dirty).toBe(false)
  await env.registry.close(env.courseSession.documentId)
  // A fresh driver reads only the archive, never the old session or journal.
  const reopened = new CourseV9Driver().load(new Uint8Array(await fs.readFile(file)))
  expect(reopened.kind).toBe('course-v9')
  if (reopened.kind !== 'course-v9' || saved.model.kind !== 'course-v9') throw new Error('fixture model')
  expect(reopened.project).toEqual(saved.model.project)
  expect(Object.keys(reopened.resources.assets)).toEqual(Object.keys(saved.model.resources.assets))
  const imported = reopened.project.surfaces.flatMap(surface => surface.type === 'slide'
    ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'runtime')) : [])
  expect(imported).toHaveLength(3)
  for (const item of imported) {
    if (item.kind !== 'runtime') throw new Error('fixture runtime')
    expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)?.html).toContain('<section')
  }
})

it('records a signal-only cancellation before preparation without misreporting an import failure', async () => {
  const env = await setupTestEnvironment(), controller = new AbortController()
  const source = env.htmlSession.read(), target = env.courseSession.read()
  controller.abort(new Error('user stopped'))
  const input = { runId: 'signal-only', operationId: 'cancelled-before-prepare', requestDigest: 'signal-digest',
    sourceDocumentId: source.documentId, sourceEpoch: source.epoch, sourceRevision: source.revision,
    sourceBindingVersion: source.binding.kind === 'file' ? source.binding.bindingVersion : null,
    targetDocumentId: target.documentId, targetEpoch: target.epoch, targetRevision: target.revision,
    mode: 'whole' as const, destinations: [{ kind: 'slide-new' as const, surface: 'unused' }], signal: controller.signal }
  const result = await env.toolService.import(input)
  expect(result).toMatchObject({ status: 'cancelled' })
  expect(await env.toolService.lookup(input)).toEqual(result)
  expect(await env.operationStore.lookup(input.runId, input.operationId)).toMatchObject({ status: 'cancelled', children: [] })
  expect(env.courseSession.read().revision).toBe(target.revision)
  expect(env.courseSession.read().undoDepth).toBe(target.undoDepth)
  expect(env.run).not.toHaveBeenCalled()
})
