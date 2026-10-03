// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { findCompositionNode } from '../../src/shared/composition/content'
import { visitProjectDynamicInstances } from '../../src/shared/composition/dynamic'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import type { BuildJobSnapshot } from '../../src/shared/workbench/build'
import type { DocumentModel, DocumentPersistence } from '../../src/shared/workbench/document'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'

it('creates and admits a new Component inside composition document content, saves once, and runs from reopened bytes', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-nested-document-component-'))
  const server = await chromium.launchServer({ headless: true })
  const browser = await chromium.connect(server.wsEndpoint())
  try {
    const fixture = compositionFragmentFixture()
    fixture.assetFiles['source-photo'] = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: '#16a34a' } }).png().toBuffer())
    Object.assign(fixture.project.assets['source-photo']!, { byteLength: fixture.assetFiles['source-photo'].length, width: 8, height: 8 })
    const region = findCompositionNode(fixture.item.content.root, 'interaction')!
    if (region.kind !== 'element') throw new Error('Missing document region')
    region.attributes.style = 'height:auto'
    region.children = []
    const before = courseProjectDocumentSchema.parse(fixture.project)
    const source = `window.CoursewareComponent.define({id:'org.guoling.nested-counter',runtimeApiVersion:4,create(ctx){
      const probe=window.__documentComponentProbe={creates:1,updates:0,resizes:0,suspends:0,resumes:0,destroys:0};
      let count=0, label=ctx.props.label;const button=document.createElement('button');
      button.style.cssText='font:24px Arial;padding:16px;color:white;background:#16a34a;border:0';
      const paint=()=>button.textContent=label+' '+count;paint();button.onclick=()=>{count++;paint()};ctx.dom.root.append(button);
      return {setMode(){},updateProps(props){probe.updates++;label=props.label;paint()},resize(){probe.resizes++},
        suspend(){probe.suspends++},resume(){probe.resumes++},destroy(){probe.destroys++;button.remove()}};
    }});`
    const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'org.guoling.nested-counter', name: 'Document counter', version: '1.0.0',
      entry: 'runtime.js', defaultSize: { width: 260, height: 200 }, minSize: { width: 100, height: 100 },
      preserveAspectRatio: false, supportedScopes: ['scene'], renderMode: 'dom', defaultProps: { label: 'Saved counter' }, assets: {} }
    const encode = (value: string) => new TextEncoder().encode(value)
    const component = parseComponentPackageFiles({ 'manifest.json': encode(JSON.stringify(manifest)), 'runtime.js': encode(source) })
    const project = structuredClone(before)
    project.componentPackages[component.manifest.id] = component.metadata
    const item = project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem
    const documentRegion = findCompositionNode(item.content.root, 'interaction')!
    if (documentRegion.kind !== 'element') throw new Error('Missing candidate region')
    documentRegion.children = [{ kind: 'document', id: 'document-leaf', content: { blocks: [{ id: 'section', type: 'section',
      title: { inlines: [{ type: 'text', text: 'Document interaction' }] }, collapsedByDefault: false, blocks: [
        { id: 'intro', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Editable prose remains outside the component.' }] } },
        { id: 'component-block', type: 'component', component: { packageId: manifest.id, version: manifest.version },
          props: { label: 'Saved counter' }, staticFallbackAssetId: 'source-photo' },
      ] }] } }]
    const instanceId = `${item.layerItemId}/document-leaf/component-block`
    const visited: string[] = []
    visitProjectDynamicInstances(project, entry => visited.push(entry.instanceId))
    expect(visited).toEqual([instanceId])
    const bundle = (await build({ stdin: { contents: `
      export {runDynamicCandidateHostSmoke} from './src/renderer/authoring/tools/dynamicCandidateAdmission';
      export {parseComponentPackageFiles} from './src/core/drivers/codecs/importComponentPackage';
      export {queryPublishedDynamicElements} from './src/player/surfaces/publishedDynamicUpdateProbe';
      export {capturePublishedSurfacePng,waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
      export {SlidePublishedAdapter} from './src/player/surfaces/slide/SlidePublishedAdapter';
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
      globalName: 'NestedDocumentComponent', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
    await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
    let admissionCalls = 0
    let admissionProbe: Record<string, number> | undefined
    const service = new ControlledBuildService({ directory: path.join(folder, 'builds'), admission: { async run(payload, signal) {
      admissionCalls++; signal.throwIfAborted()
      const result = await page.evaluate(async input => {
        const api = (window as any).NestedDocumentComponent
        const assets = Object.fromEntries(Object.entries(input.assets).map(([id, bytes]) => [id, new Uint8Array(bytes)]))
        const components = Object.fromEntries(Object.values(input.components).map(files => {
          const parsed = api.parseComponentPackageFiles(Object.fromEntries(Object.entries(files).map(([name, encoded]) => [name, Uint8Array.from(atob(encoded), c => c.charCodeAt(0))])))
          return [parsed.manifest.id, parsed]
        }))
        const evidence: any[] = []
        let probe: any
        const capturePort = { async captureFrame() {
          const mount = api.queryPublishedDynamicElements(document.body, '.published-component-mount')[0] as HTMLElement
          probe = (window as any).__documentComponentProbe
          const owner = mount.parentElement!, width = owner.offsetWidth, height = owner.offsetHeight
          const dataUrl = await api.capturePublishedSurfacePng({ root: owner, width, height, transparentBackground: true,
            layers: [{ element: owner, x: 0, y: 0, width, height, rotation: 0, opacity: 1 }] })
          return { dataUrl, capturedAt: Date.now(), width, height }
        } }
        const captures = await api.runDynamicCandidateHostSmoke(input.project, { assetFiles: assets, componentPackages: components }, input.targets, true,
          { capturePort, verificationMode: 'full-admission', onBehaviorEvidence(values: any[]) { evidence.push(...values) } })
        return { captures, evidence, probe: { ...probe } }
      }, { project: payload.project, targets: payload.targets, components: payload.componentFiles,
        assets: Object.fromEntries(Object.entries(payload.assetFiles).map(([id, bytes]) => [id, Array.from(typeof bytes === 'string' ? Buffer.from(bytes, 'base64') : bytes)])) })
      signal.throwIfAborted(); admissionProbe = result.probe
      return { ok: true, message: 'Observed nested document Component in an independent Chromium process', processId: server.process().pid,
        captures: result.captures, behaviorEvidence: result.evidence }
    } } })
    const baseline: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project: before,
      resources: { assets: fixture.assetFiles, components: {} } }
    const digest = documentDigest(baseline)
    const job = await service.create({ runId: 'nested-component', baseline, allowedOrigins: [],
      target: { documentId: 'nested-document', projectId: before.id, epoch: 'nested-epoch', baseRevision: before.revision, modelDigest: digest },
      readSet: [{ documentId: 'nested-document', epoch: 'nested-epoch', revision: before.revision, digest }] })
    await service.execute('nested-component', { type: 'write', jobId: job.jobId, path: 'project.json', content: JSON.stringify(project) })
    const prefix = path.posix.dirname(component.metadata.manifestPath)
    for (const [name, bytes] of Object.entries(component.files)) await service.execute('nested-component', {
      type: 'write', jobId: job.jobId, path: `${prefix}/${name}`, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' })
    const ready = await service.execute('nested-component', { type: 'check', jobId: job.jobId }) as BuildJobSnapshot
    const logs = await service.execute('nested-component', { type: 'logs', jobId: job.jobId })
    expect(ready.status, JSON.stringify(logs)).toBe('ready')
    expect(admissionCalls).toBe(1)
    expect(admissionProbe).toMatchObject({ creates: 1, destroys: 1 })
    for (const key of ['updates', 'resizes', 'suspends', 'resumes']) expect(admissionProbe![key]).toBeGreaterThan(0)
    const artifact = await service.artifact('nested-component', job.jobId, ready.artifactId!)
    expect(artifact.admission.captures).toEqual([expect.objectContaining({ instanceId })])
    const finalItem = artifact.command.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0] as CompositionLayerItem
    const leaf = findCompositionNode(finalItem.content.root, 'document-leaf')!
    if (leaf.kind !== 'document' || leaf.content.blocks[0]?.type !== 'section') throw new Error('Lost document content')
    const block = leaf.content.blocks[0].blocks.find(block => block.type === 'component')!
    if (block.type !== 'component') throw new Error('Lost nested Component')
    expect(block.staticFallbackAssetId).toMatch(/^component-capture-/)
    const filename = path.join(folder, 'nested-component.h5lesson'), driver = new CourseV9Driver()
    const persistence: DocumentPersistence = { async append() {}, async save(input) {
      await fs.writeFile(filename, input.bytes)
      return { kind: 'file', path: filename, version: 'saved', bindingVersion: 1 }
    } }
    const session = await DocumentSession.create({ documentId: 'nested-document', epoch: 'nested-epoch', model: baseline,
      binding: { kind: 'untitled', suggestedName: 'nested-component.h5lesson' } }, driver, persistence)
    expect(await session.execute({ documentId: session.documentId, epoch: session.read().epoch, baseRevision: session.read().revision,
      operationId: 'admitted-component', actor: 'agent', runId: 'nested-component', mutation: { type: 'command', command: artifact.command } }))
      .toMatchObject({ status: 'applied' })
    expect(session.read().undoDepth).toBe(1)
    await session.save({ kind: 'file', path: filename, version: null, bindingVersion: 0 })
    const reopened = driver.load(new Uint8Array(await fs.readFile(filename)))
    if (reopened.kind !== 'course-v9') throw new Error('Expected saved course')
    const savedComponent = parseComponentPackageFiles(reopened.resources.components[component.key]!)
    const published = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.resources.assets,
      components: { [manifest.id]: savedComponent } })
    const playback = await page.evaluate(async ({ published, instanceId }) => {
      const api = (window as any).NestedDocumentComponent, container = document.createElement('div')
      container.style.cssText = 'width:800px;height:1100px'; document.body.append(container)
      const surface = published.surfaces.find((surface: any) => surface.type === 'slide')!
      const host = new api.SlidePublishedAdapter(published, surface.id, { locationId: published.startLocationId })
      await host.mount({ surfaceId: surface.id, container, signal: new AbortController().signal,
        services: { navigate() {}, getCourseState() {}, setCourseState() {}, resolveAsset() {}, reportDiagnostic() {} } })
      await host.activate(); await api.waitForPublishedObservationReady(container)
      const mount = api.queryPublishedDynamicElements(container, '.published-component-mount').find((element: HTMLElement) => element.dataset.componentInstanceId === instanceId)
      const button = mount.shadowRoot.querySelector('button'), before = button.textContent
      button.click(); const after = button.textContent
      const prose = mount.ownerDocument.body.textContent.includes('Editable prose remains outside the component.')
      await host.destroy(); container.remove(); return { before, after, prose }
    }, { published, instanceId })
    expect(playback).toEqual({ before: 'Saved counter 0', after: 'Saved counter 1', prose: true })
  } finally {
    await browser.close(); await server.close()
    const resolved = path.resolve(folder)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected component fixture directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}, 45_000)
