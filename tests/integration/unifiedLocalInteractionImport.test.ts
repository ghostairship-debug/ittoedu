// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type BrowserServer } from 'playwright'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { documentDigest } from '../../src/core/documents/documentDigest'
import { applyCompositionContentEdit } from '../../src/core/tools/compositionContent'
import { ControlledBuildService } from '../../src/main/workbench/build/ControlledBuildService'
import { prepareHtmlCourseCandidate } from '../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { walkComposition } from '../../src/shared/composition/content'
import { visitProjectDynamicInstances } from '../../src/shared/composition/dynamic'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { BuildJobSnapshot, BuildLogEntry } from '../../src/shared/workbench/build'
import type { DocumentModel, DocumentPersistence, DocumentSnapshot } from '../../src/shared/workbench/document'

let browser: Browser, server: BrowserServer, bundle: string
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    export {runDynamicCandidateHostSmoke} from './src/renderer/authoring/tools/dynamicCandidateAdmission';
    export {mountWebComposition} from './src/player/composition/mountWebComposition';
    export {createPublishedSurfaceRuntimeSession} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';
    export {mountPublishedSurfaceRuntime} from './src/player/surfaces/runtime/publishedSurfaceRuntimeMount';
    export {applyCompositionContentEdit} from './src/core/tools/compositionContent';
    export {findCompositionNode} from './src/shared/composition/content';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife',
    globalName: 'LocalInteractionTest', define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
  server = await chromium.launchServer({ headless: true })
  browser = await chromium.connect(server.wsEndpoint())
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })

const childHtml = '<!doctype html><html><head><link rel="stylesheet" href="theme.css"></head><body><img src="diagram.png" alt="示意图"><button id="counter">次数：0</button><script src="experiment.js"></script></body></html>'
const shellHtml = '<!doctype html><html><head><style>html,body{margin:0}main{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:20px}iframe{width:100%;height:160px;border:0}.note{font:24px Arial}</style></head><body><main><p class="note">先预测，再观察。</p><iframe id="experiment" title="独立实验" src="interaction/experiment.html"></iframe></main></body></html>'

async function disposeFixture(root: string) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
  await fs.rm(root, { recursive: true, force: true })
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-interaction-import-'))
  const sourcePath = path.join(root, 'lesson.html'), interaction = path.join(root, 'interaction')
  await fs.mkdir(interaction)
  await fs.writeFile(sourcePath, shellHtml)
  await fs.writeFile(path.join(interaction, 'experiment.html'), childHtml)
  await fs.writeFile(path.join(interaction, 'theme.css'), 'body{margin:0;background:#dcfce7}button{font:24px Arial;color:#14532d}img{width:20px;height:20px}')
  await fs.writeFile(path.join(interaction, 'experiment.js'), 'window.loadRuns=(window.loadRuns||0)+1;let n=0;document.getElementById("counter").addEventListener("click",()=>document.getElementById("counter").textContent="次数："+ ++n);')
  await sharp({ create: { width: 2, height: 3, channels: 4, background: '#16a34a' } }).png().toFile(path.join(interaction, 'diagram.png'))
  const project = createBlankCourseProject({ canvas: { width: 800, height: 480 }, includeDefaultController: false, controls: 'none' })
  const baseline: Extract<DocumentModel, { kind: 'course-v9' }> = { kind: 'course-v9', project, resources: { assets: {}, components: {} } }
  const snapshot: DocumentSnapshot = { documentId: 'local-import-document', epoch: 'local-import-epoch', revision: project.revision,
    binding: { kind: 'untitled', suggestedName: 'lesson.h5lesson' }, model: baseline,
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { root, sourcePath, baseline, snapshot }
}

it('creates nested Runtime from ordinary local iframe HTML, admits it, edits static siblings, saves/reopens and keeps the live block during reflow', async () => {
  const { root, sourcePath, baseline, snapshot } = await fixture()
  try {
    const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath, locationId: baseline.project.startLocationId })
    const slide = candidate.model.project.surfaces.find(surface => surface.type === 'slide')!
    const item = slide.scenes[0]!.layerItems[0]!
    if (item.kind !== 'composition') throw new Error('Independent interaction flattened the static shell')
    let noteId = '', iframeId = '', runtimeId = '', mainId = ''
    walkComposition(item.content.root, node => {
      if (node.kind === 'text' && node.text === '先预测，再观察。') noteId = node.id
      if (node.kind === 'element' && node.tagName === 'main') mainId = node.id
      if (node.kind === 'element' && node.tagName === 'iframe') {
        iframeId = node.id
        expect(node.attributes).toMatchObject({ id: 'experiment', title: '独立实验' })
        expect(node.attributes.src ?? node.attributes.srcdoc).toBeUndefined()
        expect(node.children).toHaveLength(1)
      }
      if (node.kind === 'runtime') {
        runtimeId = node.id
        const html = unpackHtmlDocumentRuntimeSource(node.runtime.source)!.html
        expect(html).toContain('window.loadRuns=')
        expect(html).toContain('background:#dcfce7')
        expect(html).toContain('cw-resource:')
        expect(Object.keys(node.runtime.assets)).toHaveLength(1)
        expect(node.runtime.staticFallback?.coverage).toBe('surface')
      }
    })
    const edit = applyCompositionContentEdit(item.content, { type: 'text', nodeId: noteId, text: '先预测，再操作独立实验。' })
    if (!edit.ok) throw new Error(edit.diagnostic.message)
    item.content = edit.content

    // Real compiler and real Chromium host admission consume this ordinary import output.
    const service = new ControlledBuildService({ directory: path.join(root, 'builds'), admission: { async run(input) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      try {
        await page.setContent('<body></body>'); await page.addScriptTag({ content: bundle })
        await page.exposeFunction('captureLocalInteractionFrame', async () => ({
          dataUrl: `data:image/png;base64,${(await page.screenshot()).toString('base64')}`, width: 1280, height: 720, capturedAt: Date.now(),
        }))
        const result = await page.evaluate(async input => {
          const evidence: any[] = [], api = (window as any).LocalInteractionTest
          const assets = Object.fromEntries(Object.entries(input.assets).map(([id, values]) => [id, new Uint8Array(values)]))
          const captures = await api.runDynamicCandidateHostSmoke(input.project, { assetFiles: assets, componentPackages: {} }, input.targets, true,
            { capturePort: { captureFrame: () => (window as any).captureLocalInteractionFrame() }, onBehaviorEvidence(values: any[]) { evidence.push(...values) } })
          return { captures, evidence }
        }, { project: input.project, targets: input.targets,
          assets: Object.fromEntries(Object.entries(candidate.model.resources.assets).map(([id, bytes]) => [id, Array.from(bytes)])) })
        return { ok: true, message: 'Real Chromium nested-document admission', processId: server.process().pid,
          captures: result.captures, behaviorEvidence: result.evidence }
      } finally { await page.close() }
    } } })
    const digest = documentDigest(baseline)
    const job = await service.create({ runId: 'local-import-run', baseline, allowedOrigins: [],
      target: { documentId: snapshot.documentId, projectId: baseline.project.id, epoch: snapshot.epoch, baseRevision: snapshot.revision, modelDigest: digest },
      readSet: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, digest }] })
    for (const meta of Object.values(candidate.model.project.assets)) await service.execute(job.runId, {
      type: 'write', jobId: job.jobId, path: meta.path, encoding: 'base64', content: Buffer.from(candidate.model.resources.assets[meta.id]!).toString('base64'),
    })
    await service.execute(job.runId, { type: 'write', jobId: job.jobId, path: 'project.json', content: JSON.stringify(candidate.model.project) })
    const checked = await service.execute(job.runId, { type: 'check', jobId: job.jobId }) as BuildJobSnapshot
    const logs = await service.execute(job.runId, { type: 'logs', jobId: job.jobId }) as { entries: BuildLogEntry[] }
    expect(checked.status, logs.entries.map(entry => entry.message).join('\n')).toBe('ready')
    const artifact = await service.artifact(job.runId, job.jobId, checked.artifactId!)
    expect(artifact.admission.captures?.[0]).toMatchObject({ instanceId: `${item.layerItemId}/${runtimeId}`, width: 370, height: 160 })
    const savedPath = path.join(root, 'lesson.h5lesson'), driver = new CourseV9Driver()
    const persistence: DocumentPersistence = { async append() {}, async save(input) {
      await fs.writeFile(savedPath, input.bytes)
      return { kind: 'file', path: savedPath, version: 'saved', bindingVersion: 1 }
    } }
    const session = await DocumentSession.create({ documentId: snapshot.documentId, epoch: snapshot.epoch, model: baseline, binding: snapshot.binding }, driver, persistence)
    expect((await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: 'local-import-commit', actor: 'agent', runId: job.runId, mutation: { type: 'command', command: artifact.command } })).status).toBe('applied')
    expect(session.read().undoDepth).toBe(1)
    await session.save({ kind: 'file', path: savedPath, version: null, bindingVersion: 0 })
    const reopened = driver.load(new Uint8Array(await fs.readFile(savedPath)))
    if (reopened.kind !== 'course-v9') throw new Error('Wrong reopened document')
    visitProjectDynamicInstances(reopened.project, entry => { if (entry.kind === 'runtime') expect(reopened.resources.assets[entry.runtime.staticFallback!.assetId]).toBeDefined() })
    const payload = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.resources.assets, components: {} })
    const published = payload.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0]!
    if (published.kind !== 'composition') throw new Error('Reopen changed the content carrier')
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
    try {
      await page.setContent('<div id="host"></div>'); await page.addScriptTag({ content: bundle })
      await page.evaluate(async input => {
        const api = (window as any).LocalInteractionTest, session = api.createPublishedSurfaceRuntimeSession()
        const handle = api.mountWebComposition(document.getElementById('host'), { instanceId: input.instanceId, content: input.content,
          width: 800, height: 480, session, resolveAsset: (id: string) => input.assets[id]?.url })
        Object.assign(window, { localHandle: handle, localContent: input.content, localSession: session })
        await handle.ready; await handle.waitForObservationReady()
      }, { instanceId: item.layerItemId, content: published.content, assets: payload.assets })
      const frame = page.frameLocator('iframe[data-web-composition]').frameLocator('#experiment').frameLocator('iframe[data-html-document-runtime]')
      await expect.poll(() => frame.locator('#counter').textContent()).toBe('次数：0')
      await frame.locator('#counter').click()
      await expect.poll(() => frame.locator('#counter').textContent()).toBe('次数：1')
      const before = await page.evaluate(() => {
        const iframe = (window as any).localHandle.element.contentDocument.querySelector('#experiment')
        const child = iframe.contentDocument.querySelector('iframe[data-html-document-runtime]')
        Object.assign(window, { originalIframe: iframe, originalInteraction: child })
        return { width: iframe.clientWidth, height: iframe.clientHeight, note: (window as any).localHandle.element.contentDocument.querySelector('.note').textContent,
          imageWidth: child.contentDocument.querySelector('img').naturalWidth }
      })
      expect(before).toEqual({ width: 370, height: 160, note: '先预测，再操作独立实验。', imageWidth: 2 })
      const after = await page.evaluate(async ({ noteId, iframeId, mainId }) => {
        const w = window as any, api = w.LocalInteractionTest
        let content = api.applyCompositionContentEdit(w.localContent, { type: 'text', nodeId: noteId, text: '改过的静态说明。' }).content
        const moved = api.applyCompositionContentEdit(content, { type: 'move', nodeId: iframeId, parentId: mainId, index: 0 })
        if (!moved.ok) throw new Error(moved.diagnostic.message)
        content = moved.content
        // A real resize and a static sibling edit preserve the same interaction document.
        await w.localHandle.update(content)
        w.localHandle.resize(600, 480); await w.localHandle.waitForObservationReady()
        const iframe = w.localHandle.element.contentDocument.querySelector('#experiment'), child = iframe.contentDocument.querySelector('iframe[data-html-document-runtime]')
        return { sameIframe: iframe === w.originalIframe, sameInteraction: child === w.originalInteraction,
          count: child.contentDocument.querySelector('#counter').textContent, loads: child.contentWindow.loadRuns,
          width: iframe.clientWidth, firstChild: w.localHandle.element.contentDocument.querySelector('main').firstElementChild.id,
          note: w.localHandle.element.contentDocument.querySelector('.note').textContent }
      }, { noteId, iframeId, mainId })
      expect(after).toEqual({ sameIframe: true, sameInteraction: true, count: '次数：1', loads: 1, width: 270, firstChild: 'experiment', note: '改过的静态说明。' })
      await page.evaluate(() => { (window as any).localHandle.destroy(); (window as any).localSession.destroy() })
    } finally { await page.close() }
  } finally { await disposeFixture(root) }
}, 30_000)

it('keeps a shared shell program whole and runs its inlined srcdoc child without changing the ordinary source contract', async () => {
  const { root, sourcePath, baseline, snapshot } = await fixture()
  try {
    await fs.writeFile(sourcePath, shellHtml.replace('</body>', '<script>window.sharedShell="kept";</script></body>'))
    await fs.appendFile(path.join(root, 'interaction', 'experiment.js'), 'document.getElementById("counter").addEventListener("click",()=>document.getElementById("counter").dataset.shared=parent.sharedShell);')
    const closure = await readHtmlClosure({ htmlPath: sourcePath })
    expect(closure.diagnostics.filter(item => item.level === 'error')).toEqual([])
    expect(parseWebComposition({ html: closure.html }).kind).toBe('program')
    const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath, locationId: baseline.project.startLocationId })
    const item = candidate.model.project.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0]!
    if (item.kind !== 'runtime') throw new Error('Shared program was split into independent blocks')
    const payload = buildPublishedCourseV2Payload({ project: candidate.model.project, assetFiles: candidate.model.resources.assets, components: {} })
    const published = payload.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems[0]!
    if (published.kind !== 'runtime') throw new Error('Published shared carrier changed')
    const page = await browser.newPage()
    try {
      await page.setContent('<div id="host"></div>'); await page.addScriptTag({ content: bundle })
      await page.evaluate(async input => {
        const api = (window as any).LocalInteractionTest, session = api.createPublishedSurfaceRuntimeSession()
        const handle = api.mountPublishedSurfaceRuntime(document.getElementById('host'), { instanceId: 'whole-shell', runtime: input.runtime,
          width: 800, height: 480, visible: true, session, resolveAsset: (id: string) => input.assets[id]?.url })
        Object.assign(window, { wholeHandle: handle, wholeSession: session })
        await handle.waitForReady(); await handle.waitForObservationReady()
      }, { runtime: published.runtime, assets: payload.assets })
      const frame = page.frameLocator('iframe[data-html-document-runtime]').frameLocator('#experiment')
      await expect.poll(() => frame.locator('#counter').textContent()).toBe('次数：0')
      await frame.locator('#counter').click()
      await expect.poll(() => frame.locator('#counter').textContent()).toBe('次数：1')
      expect(await frame.locator('#counter').getAttribute('data-shared')).toBe('kept')
      expect(await page.evaluate(() => ((document.querySelector('iframe[data-html-document-runtime]') as HTMLIFrameElement).contentWindow as any).sharedShell)).toBe('kept')
      await page.evaluate(() => { (window as any).wholeHandle.destroy(); (window as any).wholeSession.destroy() })
    } finally { await page.close() }
  } finally { await disposeFixture(root) }
}, 30_000)

it('uses an ordinary srcdoc boundary but preserves explicit parent access and sandbox semantics through the whole carrier', () => {
  let created = 0
  const createEmbeddedRuntime = (html: string) => { created++; return { html } }
  const independent = '<iframe srcdoc="&lt;button onclick=&quot;this.textContent=\'观察\'&quot;&gt;揭示&lt;/button&gt;" title="实验"></iframe>'
  expect(parseWebComposition({ html: independent, createEmbeddedRuntime }).kind).toBe('composition')
  expect(created).toBe(1)
  const localNames = '<iframe srcdoc="&lt;script&gt;const top=4;function label(parent){return parent+top}window.result=label(2);&lt;/script&gt;"></iframe>'
  expect(parseWebComposition({ html: localNames, createEmbeddedRuntime }).kind).toBe('composition')
  const dependent = '<iframe srcdoc="&lt;button onclick=&quot;this.textContent=parent.document.title&quot;&gt;揭示&lt;/button&gt;"></iframe>'
  expect(parseWebComposition({ html: dependent, createEmbeddedRuntime }).kind).toBe('program')
  expect(parseWebComposition({ html: independent.replace('<iframe ', '<iframe sandbox '), createEmbeddedRuntime }).kind).toBe('program')
  expect(created).toBe(2)
})
