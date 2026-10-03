// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'
import { findCompositionNode } from '../../src/shared/composition/content'
import { visitProjectDynamicInstances } from '../../src/shared/composition/dynamic'
import { projectDynamicTargets } from '../../src/shared/projectDynamicTargets'
import { applyDynamicInstanceCaptures, dynamicCaptureRefreshIds } from '../../src/core/tools/dynamicCaptureAssets'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { createHtmlDocumentRuntimeSource, unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { DynamicInstanceCapture } from '../../src/shared/dynamicAdmissionContract'
import type { BuildJobSnapshot, BuildLogEntry } from '../../src/shared/workbench/build'
import type { DocumentModel, DocumentPersistence } from '../../src/shared/workbench/document'

it('compiles nested Runtime candidates through ControlledBuildService and preserves their managed HTML factory', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nested-composition-compiler-'))
  try {
    let admissionCalls = 0
    const service = new ControlledBuildService({ directory: path.join(folder, 'builds'), admission: {
      async run() { admissionCalls++; throw new Error('Compiler-only cases must not reach dynamic admission') },
    } })
    const { project: fixtureProject, item, assetFiles } = compositionFragmentFixture()
    const node = findCompositionNode(item.content.root, 'counter')!
    if (node.kind !== 'runtime') throw new Error('Missing fixture Runtime')
    const customSource = node.runtime.source
    const payload = { html: '<!DOCTYPE html><html><body><p>Editable nested content</p></body></html>', resourceKeys: [] }
    const factorySource = createHtmlDocumentRuntimeSource(payload)
    node.runtime.source = factorySource
    const project = courseProjectDocumentSchema.parse(fixtureProject)
    const instanceId = `${item.layerItemId}/${node.id}`
    const createJob = async (baselineProject: typeof project) => {
      const baseline: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project: baselineProject,
        resources: { assets: assetFiles, components: {} } }
      const digest = documentDigest(baseline)
      return service.create({ runId: 'compiler-run', baseline, allowedOrigins: [],
        target: { documentId: 'compiler-document', projectId: project.id, epoch: 'compiler-epoch', baseRevision: project.revision, modelDigest: digest },
        readSet: [{ documentId: 'compiler-document', epoch: 'compiler-epoch', revision: project.revision, digest }] })
    }
    const check = async (jobId: string, source: string) => {
      const candidate = structuredClone(project)
      visitProjectDynamicInstances(candidate, entry => { if (entry.instanceId === instanceId && entry.kind === 'runtime') entry.runtime.source = source })
      await service.execute('compiler-run', { type: 'write', jobId, path: 'project.json', content: JSON.stringify(candidate) })
      return service.execute('compiler-run', { type: 'check', jobId }) as Promise<BuildJobSnapshot>
    }
    const messages = async (jobId: string) => {
      const logs = await service.execute('compiler-run', { type: 'logs', jobId }) as { entries: BuildLogEntry[] }
      return logs.entries.map(entry => entry.message).join('\n')
    }

    // Cosmetic edits are consumed by the real compiler and restored to the host factory.
    // Once restored, unchanged content needs no new runtime smoke or capture.
    const managed = await createJob(project)
    const cosmeticSource = `/* cosmetic formatting */\n${factorySource}\n`
    const ready = await check(managed.jobId, cosmeticSource)
    expect(ready.status, await messages(managed.jobId)).toBe('ready')
    const artifact = await service.artifact('compiler-run', managed.jobId, ready.artifactId!)
    let compiledSource: string | undefined
    visitProjectDynamicInstances(artifact.command.project, entry => {
      if (entry.instanceId === instanceId && entry.kind === 'runtime') compiledSource = entry.runtime.source
    })
    expect(compiledSource).toBe(factorySource)
    expect(unpackHtmlDocumentRuntimeSource(compiledSource!)).toEqual(payload)

    // The baseline lookup must also find the nested managed carrier by its full instance ID.
    const replacement = await createJob(project)
    expect((await check(replacement.jobId, customSource)).status).toBe('failed')
    expect(await messages(replacement.jobId)).toContain(`受管HTML页面“${instanceId}”的宿主封装发生语义变化`)

    const customBaseline = structuredClone(project)
    visitProjectDynamicInstances(customBaseline, entry => { if (entry.instanceId === instanceId && entry.kind === 'runtime') entry.runtime.source = customSource })
    const syntax = await createJob(customBaseline)
    const invalidSource = "CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(){const broken = ;return{destroy(){}}}})"
    expect((await check(syntax.jobId, invalidSource)).status).toBe('failed')
    expect(await messages(syntax.jobId)).toMatch(/Unexpected token/)
    expect(admissionCalls).toBe(0)
  } finally {
    const resolved = path.resolve(folder)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected compiler fixture root')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})

it('admits a changed nested Runtime through its real iframe, captures its own fallback, commits once and runs after reopening', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nested-composition-admission-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const { project: before, assetFiles } = compositionFragmentFixture()
    assetFiles['source-photo'] = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ef4444' } }).png().toBuffer())
    before.assets['source-photo']!.byteLength = assetFiles['source-photo'].length
    before.assets['source-photo']!.width = 8; before.assets['source-photo']!.height = 8
    const project = structuredClone(before)
    const slide = project.surfaces.find(surface => surface.type === 'slide')!
    const item = slide.scenes[0]!.layerItems[0] as CompositionLayerItem
    const original = before.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem
    const baselineRuntime = findCompositionNode(original.content.root, 'counter')!
    const counter = findCompositionNode(item.content.root, 'counter')!
    if (counter.kind !== 'runtime' || baselineRuntime.kind !== 'runtime') throw new Error('Missing fixture Runtime')
    baselineRuntime.runtime.staticFallback = { assetId: 'source-photo', coverage: 'surface' }
    counter.runtime.staticFallback = { assetId: 'source-photo', coverage: 'surface' }
    counter.runtime.content.values = { start: '3' }
    counter.runtime.source = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
      const probe=window.__nestedAdmissionProbe={creates:1,updates:0,assets:0,resizes:0,suspends:0,resumes:0,destroys:0};
      let n=Number(ctx.content.get('start'));
      const button=document.createElement('button');button.dataset.fragmentCounter='true';
      const paint=()=>button.textContent='Saved counter '+n;paint();button.onclick=()=>{n++;paint()};
      button.style.cssText='font:20px Arial;background:#16a34a;color:white;padding:12px;border:0';ctx.dom.root.append(button);
      return {updateContent(value){probe.updates++;n=Number(value.start);paint()},updateAssets(){probe.assets++},resize(){probe.resizes++},
        suspend(){probe.suspends++},resume(){probe.resumes++},destroy(){probe.destroys++;button.remove()}};
    }});`
    const instanceId = `${item.layerItemId}/counter`
    const targets = projectDynamicTargets(project, before, false)
    expect(targets).toEqual([{ locationId: project.startLocationId, stateId: slide.scenes[0]!.presentation?.initialStateId ?? null, instanceIds: [instanceId] }])
    const staticProject = structuredClone(project)
    const staticItem = staticProject.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem
    const region = findCompositionNode(staticItem.content.root, 'interaction')!
    if (region.kind !== 'element') throw new Error('Missing region')
    region.children = [{ id: 'plain-text', kind: 'text', text: 'Static content needs no program admission' }]
    expect(projectDynamicTargets(staticProject, before, false)).toEqual([])
    const resized = structuredClone(before)
    resized.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.canvas = { width: 720, height: 960 }
    expect(projectDynamicTargets(resized, before, false)[0]?.instanceIds).toEqual([instanceId])
    const visited: string[] = []
    visitProjectDynamicInstances(project, entry => visited.push(entry.instanceId))
    expect(visited).toEqual([instanceId])
    const bundle = (await build({ stdin: { contents: `
      export {runDynamicCandidateHostSmoke} from './src/renderer/authoring/tools/dynamicCandidateAdmission';
      export {queryPublishedDynamicElements} from './src/player/surfaces/publishedDynamicUpdateProbe';
      export {capturePublishedSurfacePng} from './src/player/surfaces/publishedCapture';
      export {SlidePublishedAdapter} from './src/player/surfaces/slide/SlidePublishedAdapter';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
      globalName: 'NestedAdmission', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
    await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
    const result = await page.evaluate(async input => {
      const api = (window as any).NestedAdmission, resources = { assetFiles: Object.fromEntries(Object.entries(input.assets).map(([id, values]) => [id, new Uint8Array(values)])), componentPackages: {} }
      const evidence: any[] = []
      let probe: any
      let iframe: HTMLIFrameElement | null = null
      const capturePort = { async captureFrame() {
        const current = document.querySelector<HTMLIFrameElement>('iframe[data-web-composition]')!
        if (iframe && iframe !== current) throw new Error('Admission replaced the Web iframe')
        iframe = current; probe = (current.contentWindow as any).__nestedAdmissionProbe
        const mount = api.queryPublishedDynamicElements(document.body, '.published-surface-runtime-mount')[0] as HTMLElement
        const owner = mount.parentElement!, width = owner.offsetWidth, height = owner.offsetHeight
        const dataUrl = await api.capturePublishedSurfacePng({ root: owner, width, height, transparentBackground: true,
          layers: [{ element: owner, x: 0, y: 0, width, height, rotation: 0, opacity: 1 }] })
        return { dataUrl, capturedAt: Date.now(), width, height }
      } }
      const captures = await api.runDynamicCandidateHostSmoke(input.project, resources, input.targets, true,
        { capturePort, onBehaviorEvidence(values: any[]) { evidence.push(...values) } })
      return { captures, evidence, probe: { ...probe }, removed: !iframe!.isConnected }
    }, { project, targets, assets: Object.fromEntries(Object.entries(assetFiles).map(([id, bytes]) => [id, Array.from(bytes)])) })
    expect(result.captures).toHaveLength(1)
    expect(result.captures[0]).toMatchObject({ instanceId, locationId: project.startLocationId, height: 70 })
    expect(result.probe).toMatchObject({ creates: 1, destroys: 1 })
    for (const key of ['updates', 'assets', 'resizes', 'suspends', 'resumes']) expect(result.probe[key]).toBeGreaterThan(0)
    expect(result.removed).toBe(true)
    expect(result.evidence[0].sourceIdentities[instanceId]).toBeTruthy()
    expect(result.evidence[0].actions).toEqual(['update-inputs', 'resize-and-restore', 'suspend', 'resume'])
    const model: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project, resources: { assets: assetFiles, components: {} } }
    const baseline: typeof model = { ...model, project: before }
    const refresh = dynamicCaptureRefreshIds(model, baseline, {}, targets)
    expect([...refresh]).toEqual([instanceId])
    const applied = applyDynamicInstanceCaptures({ project, assetFiles, componentPackages: {}, targets,
      captures: result.captures as DynamicInstanceCapture[], refreshInstanceIds: refresh })
    const appliedItem = applied.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem
    const appliedCounter = findCompositionNode(appliedItem.content.root, 'counter')!
    if (appliedCounter.kind !== 'runtime') throw new Error('Lost Runtime')
    const fallbackId = appliedCounter.runtime.staticFallback!.assetId
    expect(fallbackId).toMatch(/^runtime-capture-/)
    expect(applied.project.assets[fallbackId]?.height).toBe(70)
    expect(applied.assetFiles[fallbackId]?.length).toBeGreaterThan(100)
    expect(appliedCounter.runtime.staticFallback!.coverage).toBe('surface')
    expect(applied.project.assets['source-photo']).toBeDefined()
    const savedPath = path.join(folder, 'nested.h5lesson')
    const driver = new CourseV9Driver()
    const persistence: DocumentPersistence = { async append() {}, async save(input) {
      await fs.writeFile(savedPath, input.bytes)
      return { kind: 'file', path: savedPath, version: 'saved', bindingVersion: 1 }
    } }
    const session = await DocumentSession.create({ documentId: 'nested-document', epoch: 'nested-epoch', model: baseline,
      binding: { kind: 'untitled', suggestedName: 'nested.h5lesson' } }, driver, persistence)
    const operation = { documentId: session.documentId, epoch: session.read().epoch, baseRevision: session.read().revision,
      operationId: 'nested-admitted', actor: 'agent' as const, runId: 'nested-run', mutation: { type: 'command' as const,
        command: { type: 'course.replace' as const, project: applied.project, resources: { assets: applied.assetFiles, components: {} } } } }
    expect((await session.execute(operation)).status).toBe('applied')
    expect((await session.execute({ ...operation, operationId: 'stale-nested' })).status).toBe('conflict')
    expect(session.read().undoDepth).toBe(1)
    await session.save({ kind: 'file', path: savedPath, version: null, bindingVersion: 0 })
    const reopened = driver.load(new Uint8Array(await fs.readFile(savedPath)))
    if (reopened.kind !== 'course-v9') throw new Error('Wrong reopened document')
    const payload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.resources.assets, components: {} })
    const playback = await page.evaluate(async ({ payload, instanceId }) => {
      const api = (window as any).NestedAdmission, container = document.createElement('div')
      container.style.cssText = 'width:800px;height:1100px'; document.body.append(container)
      const surface = payload.surfaces.find((surface: any) => surface.type === 'slide')!
      const host = new api.SlidePublishedAdapter(payload, surface.id, { locationId: payload.startLocationId })
      await host.mount({ surfaceId: surface.id, container, signal: new AbortController().signal,
        services: { navigate() {}, getCourseState() {}, setCourseState() {}, resolveAsset() {}, reportDiagnostic() {} } })
      await host.activate(); await api.waitForPublishedObservationReady(container)
      const mount = api.queryPublishedDynamicElements(container, '.published-surface-runtime-mount').find((element: HTMLElement) => element.dataset.runtimeInstanceId === instanceId)
      const button = mount.querySelector('button'); const before = button.textContent; button.click()
      const after = button.textContent
      await host.destroy(); container.remove()
      return { before, after, hasFallback: Boolean(payload.assets[Object.keys(payload.assets).find(id => id.startsWith('runtime-capture-'))!]) }
    }, { payload, instanceId })
    expect(playback).toEqual({ before: 'Saved counter 3', after: 'Saved counter 4', hasFallback: true })
    await page.close()
  } finally { await browser.close(); await fs.rm(folder, { recursive: true, force: true }) }
}, 30_000)
