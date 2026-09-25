// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deserialize, serialize } from 'node:v8'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { addCourseFlowPage, addCourseSpatialPage } from '../../src/core/tools/courseLocations'
import { applyDynamicInstanceCaptures, dynamicCaptureRefreshIds } from '../../src/core/tools/dynamicCaptureAssets'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { componentPackageMeta } from '../../src/shared/componentPackageMeta'
import { visitCourseLayerItems, visitCourseFlowBlocks } from '../../src/shared/courseProjectHealth/internal'
import type { ComponentLayerItem, CourseProjectDocument, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import type { DynamicAdmissionResult, DynamicInstanceCapture } from '../../src/shared/dynamicAdmissionContract'
import type { BuildAdmissionPort, BuildImportArtifact } from '../../src/shared/workbench/build'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const data = (result: ToolResult) => {
  if (result.kind !== 'read' || !result.data || typeof result.data !== 'object') throw new Error(JSON.stringify(result))
  return result.data as Record<string, unknown>
}
async function fixture() {
  const flow = addCourseFlowPage(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  if (!flow.ok) throw new Error(flow.reason)
  const spatial = addCourseSpatialPage(flow.project)
  if (!spatial.ok) throw new Error(spatial.reason)
  const project = spatial.project, encoder = new TextEncoder()
  const pkg = parseComponentPackageFiles({
    'manifest.json': encoder.encode(JSON.stringify({ schemaVersion: 4, runtimeApiVersion: 4, id: 'com.test.capture', version: '1.0.0',
      name: 'Capture fixture', entry: 'runtime.js', renderMode: 'dom', supportedScopes: ['global', 'scene'],
      defaultSize: { width: 20, height: 20 }, minSize: { width: 16, height: 16 }, preserveAspectRatio: false, assets: {}, defaultProps: {} })),
    'runtime.js': encoder.encode('CoursewareComponent.define({id:"com.test.capture",runtimeApiVersion:4,create(){return {destroy(){}}}})'),
  })
  project.componentPackages[pkg.manifest.id] = componentPackageMeta(pkg)
  const png = new Uint8Array(await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ca22ef' } }).png().toBuffer())
  for (const id of ['user-original', 'component-capture-referenced', 'component-capture-orphan']) project.assets[id] = {
    id, filename: `${id}.png`, path: `assets/${id}.png`, kind: 'image', mimeType: 'image/png', byteLength: png.length, width: 20, height: 20 }
  const common = { label: 'capture', frame: { mode: 'absolute' as const, x: 0, y: 0, width: 20, height: 20 }, order: 1,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const }
  const component = (id: string, fallback: string): ComponentLayerItem => ({ ...common, kind: 'component', layerItemId: id,
    component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: {}, staticFallbackAssetId: fallback })
  const runtime: RuntimeLayerItem = { ...common, kind: 'runtime', layerItemId: 'runtime', runtime: {
    protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
    source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
    assets: {}, content: { values: {} }, staticFallback: { assetId: 'user-original', coverage: 'scene' } } }
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  const flowSurface = project.surfaces.find(surface => surface.type === 'flow')!
  const world = project.surfaces.find(surface => surface.type === 'spatial-2d')!
  if (slide.type !== 'slide' || flowSurface.type !== 'flow' || world.type !== 'spatial-2d') throw new Error('fixture')
  slide.scenes[0].layerItems.push(runtime, component('slide-component', 'component-capture-referenced'), component('untouched', 'component-capture-referenced'))
  slide.scenes[0].layerItems.forEach((item, index) => { item.order = index })
  world.world.layerItems.push(component('spatial-component', 'component-capture-orphan'))
  flowSurface.blocks.push({ id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false,
    blocks: [{ id: 'nested-flow', type: 'component', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: {}, staticFallbackAssetId: 'user-original', wrap: 'none' }] })
  const model: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project,
    resources: { assets: Object.fromEntries(Object.keys(project.assets).map(id => [id, png])), components: { [`${pkg.manifest.id}@${pkg.manifest.version}`]: pkg.files } } }
  const targets = project.locations.map(location => ({ locationId: location.id, instanceIds: location.surfaceId === slide.id ? ['runtime', 'slide-component'] : location.surfaceId === flowSurface.id ? ['nested-flow'] : ['spatial-component'] }))
  const captures = targets.flatMap(target => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId, width: 20, height: 20,
    dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}` })))
  return { model, pkg, png, targets, captures }
}
function fallbacks(project: CourseProjectDocument) {
  const result: Record<string, string | undefined> = {}
  visitCourseLayerItems(project, ({ item }) => {
    if (item.kind === 'component') result[item.layerItemId] = item.staticFallbackAssetId
    if (item.kind === 'runtime') result[item.layerItemId] = item.runtime.staticFallback?.assetId
  })
  visitCourseFlowBlocks(project, ({ block }) => { if (block.type === 'component') result[block.id] = block.staticFallbackAssetId })
  return result
}

it('applies exact captures across Native Runtime, Slide/Spatial and nested Flow components and collects only unreferenced generated fallbacks', async () => {
  const f = await fixture(), original = structuredClone(f.model)
  const applied = applyDynamicInstanceCaptures({ project: f.model.project, assetFiles: f.model.resources.assets, componentPackages: { [f.pkg.manifest.id]: f.pkg }, targets: f.targets, captures: f.captures })
  const ids = fallbacks(applied.project)
  expect(ids.runtime).toMatch(/^runtime-capture-/)
  for (const id of ['slide-component', 'nested-flow', 'spatial-component']) expect(ids[id]).toMatch(/^component-capture-/)
  expect(ids.untouched).toBe('component-capture-referenced')
  expect(applied.assetFiles['component-capture-referenced']).toEqual(f.png)
  expect(applied.assetFiles['component-capture-orphan']).toBeUndefined()
  expect(applied.project.assets['component-capture-orphan']).toBeUndefined()
  expect(applied.assetFiles['user-original']).toEqual(f.png)
  expect(applied.project.revision).toBe(f.model.project.revision)
  expect(f.model).toEqual(original)
  const loaded = await new CourseV9Driver().load(await new CourseV9Driver().serialize({ kind: 'course-v9', project: applied.project,
    resources: { ...f.model.resources, assets: applied.assetFiles } }))
  expect(loaded.resources.assets).toEqual(applied.assetFiles)
  for (const captures of [f.captures.slice(1), [...f.captures, f.captures[0]], f.captures.map((capture, i) => i ? capture : { ...capture, locationId: 'wrong-location' })]) {
    expect(() => applyDynamicInstanceCaptures({ project: f.model.project, assetFiles: f.model.resources.assets, componentPackages: { [f.pkg.manifest.id]: f.pkg }, targets: f.targets, captures })).toThrow()
  }
  const moved = structuredClone(f.model), slide = moved.project.surfaces.find(surface => surface.type === 'slide')!, world = moved.project.surfaces.find(surface => surface.type === 'spatial-2d')!
  if (slide.type !== 'slide' || world.type !== 'spatial-2d') throw new Error('fixture')
  const index = slide.scenes[0].layerItems.findIndex(item => item.layerItemId === 'slide-component')
  world.world.layerItems.push(slide.scenes[0].layerItems.splice(index, 1)[0])
  expect(dynamicCaptureRefreshIds(moved, f.model, { [f.pkg.manifest.id]: f.pkg }, [{ locationId: moved.project.locations.find(location => location.surfaceId === world.id)!.id,
    instanceIds: ['slide-component'] }])).toEqual(new Set(['slide-component']))
})

async function harness(admissionResult?: (captures: DynamicInstanceCapture[]) => DynamicInstanceCapture[]) {
  const f = await fixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-capture-')); roots.push(root)
  // This suite injects admission responses to verify artifact plumbing; it is not real-host admission evidence.
  const admission: BuildAdmissionPort = { async run(payload) {
    const captures = payload.targets.flatMap(target => target.instanceIds.map(instanceId => ({ ...f.captures[0], instanceId, locationId: target.locationId })))
      .filter((capture, i, all) => all.findIndex(item => item.instanceId === capture.instanceId) === i)
    const response: DynamicAdmissionResult = { ok: true, processId: 7, message: 'injected admission boundary', captures: admissionResult?.(captures) ?? captures,
      behaviorEvidence: payload.targets.map(target => ({ version: 1, status: 'observed', mode: 'full-admission', projectId: payload.project.id,
        documentRevision: payload.project.revision, locationId: target.locationId, stateId: target.stateId ?? null, instanceIds: target.instanceIds,
        sourceIdentities: {}, actions: ['update-inputs', 'resize-and-restore', 'suspend', 'resume'], elapsedMs: 1, semanticVerdict: 'requires-review',
        frames: [{ phase: 'running', elapsedMs: 0, capturedAt: 1, stateVersion: 0, publicState: {}, width: 20, height: 20, dataUrl: f.captures[0].dataUrl }] })) }
    return response
  } }
  const buildDirectory = path.join(root, 'builds'), service = new ControlledBuildService({ directory: buildDirectory, admission })
  const journal = createDocumentJournal({ directory: path.join(root, 'journal') }), driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ persistence: journal, drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path })
  const session = await registry.create(f.model, 'capture.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID, { services: { builds: service } })
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const target = await gateway.issueTarget('run', session.documentId, { kind: 'document' })
  const call = (name: string, input: unknown) => gateway.execute('run', randomUUID(), { name, input })
  const job = data(await call('build.create', { target })).job as string
  const changed = structuredClone(f.model.project)
  visitCourseLayerItems(changed, ({ item }) => { if ((item.kind === 'component' || item.kind === 'runtime') && item.layerItemId !== 'untouched') item.opacity = 0.9 })
  visitCourseFlowBlocks(changed, ({ block }) => { if (block.type === 'component') block.props = { ...block.props, edited: true } })
  // A new unrelated asset broadens admission, but must not rewrite an unchanged neighbor's fallback.
  changed.assets.unrelated = { ...changed.assets['user-original'], id: 'unrelated', filename: 'unrelated.png', path: 'assets/unrelated.png' }
  await call('build.write', { job, path: 'assets/unrelated.png', content: Buffer.from(f.png).toString('base64'), encoding: 'base64' })
  await call('build.write', { job, path: 'project.json', content: JSON.stringify(changed) })
  return { ...f, root, buildDirectory, service, journal, driver, registry, session, gateway, call, job, admission }
}

it('freezes final capture bytes before ready, imports one durable History entry, preserves undo/redo/reopen, and rejects altered frozen output', async () => {
  const f = await harness(), before = f.session.read()
  const checked = data(await f.call('build.check', { job: f.job }))
  expect(checked.status, JSON.stringify(data(await f.call('build.logs', { job: f.job })))).toBe('ready')
  expect(f.session.read()).toEqual(before)
  const artifact = await f.service.artifact('run', f.job, checked.artifact as string)
  const newFallback = fallbacks(artifact.command.project).runtime!
  expect(artifact.admission.captures?.some(capture => capture.instanceId === 'untouched')).toBe(true)
  expect(fallbacks(artifact.command.project).untouched).toBe('component-capture-referenced')
  expect(artifact.command.resources?.assets['component-capture-referenced']).toEqual(before.model.resources.assets['component-capture-referenced'])
  expect(newFallback).toMatch(/^runtime-capture-/)
  expect(artifact.command.resources?.assets[newFallback]).toEqual(f.png)
  const restarted = new ControlledBuildService({ directory: f.buildDirectory, admission: f.admission })
  expect(await restarted.artifact('run', f.job, checked.artifact as string)).toEqual(artifact)
  expect(await f.call('build.import', { job: f.job, artifact: checked.artifact })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(f.session.read().undoDepth).toBe(1)
  const file = path.join(f.root, 'saved.h5lesson')
  await f.registry.save(f.session.documentId, { kind: 'file', path: file, version: null, bindingVersion: 0 })
  expect((await f.driver.load(await fs.readFile(file))).resources.assets[newFallback]).toEqual(f.png)
  const undo = async (type: 'undo' | 'redo') => { const now = f.session.read(); return f.session.execute({ documentId: now.documentId, epoch: now.epoch,
    baseRevision: now.revision, operationId: randomUUID(), actor: 'human', mutation: { type } }) }
  await undo('undo'); expect(f.session.read().model.resources).toEqual(before.model.resources)
  await undo('redo'); expect(f.session.read().model.resources.assets[newFallback]).toEqual(f.png)
  expect((await f.journal.recover(f.session.documentId))?.model.resources.assets[newFallback]).toEqual(f.png)
  const statePath = path.join(f.buildDirectory, f.job, 'state.bin')
  const stored = deserialize(await fs.readFile(statePath)) as { artifact: BuildImportArtifact }
  stored.artifact.command.resources!.assets[newFallback][stored.artifact.command.resources!.assets[newFallback].length - 1] ^= 1
  await fs.writeFile(statePath, serialize(stored))
  const altered = new ControlledBuildService({ directory: f.buildDirectory, admission: f.admission })
  await expect(altered.artifact('run', f.job, checked.artifact as string)).rejects.toMatchObject({ code: 'artifact-not-ready' })
})

it('rejects missing, unrelated and corrupt-pixel admission captures without changing the canonical document', async () => {
  for (const [index, corrupt] of [
    (captures: DynamicInstanceCapture[]) => captures.slice(1),
    (captures: DynamicInstanceCapture[]) => [...captures, { ...captures[0], instanceId: 'not-authorized' }],
    (captures: DynamicInstanceCapture[]) => captures.map((capture, i) => i ? capture : { ...capture,
      dataUrl: `data:image/png;base64,${Buffer.from(capture.dataUrl.split(',')[1], 'base64').subarray(0, 33).toString('base64')}` }),
  ].entries()) {
    const f = await harness(corrupt), before = f.session.read()
    expect(data(await f.call('build.check', { job: f.job }))).toMatchObject({ status: 'failed' })
    const logs = JSON.stringify(data(await f.call('build.logs', { job: f.job })))
    expect(logs).toMatch([/缺少真实后备图面/, /不属于本次准入/, /png|image|buffer/i][index])
    expect(f.session.read()).toEqual(before)
    await expect(f.service.artifact('run', f.job, 'unavailable')).rejects.toMatchObject({ code: 'artifact-not-ready' })
  }
})
