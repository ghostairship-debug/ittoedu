import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { addCourseFlowPage, addCourseSpatialPage } from '../../src/renderer/course/courseLocationCommands'
import { componentPackageMeta } from '../../src/renderer/components/editableComponentPackage'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { createCourseProjectArchive, type CourseProjectArchiveData } from '../../src/renderer/project/courseProjectArchive'
import { componentPackageKey } from '../../src/renderer/project/archivePath'
import type { CourseProjectDocument, FlowBlock, LayerItem } from '../../src/shared/courseProjectTypes'
import { closeNativeEditor, nativeRecords, readSaved, saveStage, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')
const packageId = 'com.example.short-path-patch'
const ids = { slide: 'patch-slide', flow: 'patch-flow', spatial: 'patch-spatial' } as const
type Mode = 'shared' | 'instance'

// A real interaction distinguishes the edited executable from a fresh fallback
// image or a source-only change. The patch changes only this file's increment.
function source(increment: number) {
  return `CoursewareComponent.define({id:${JSON.stringify(packageId)},runtimeApiVersion:4,create(ctx){
    var count=0,box=document.createElement('div'),button=document.createElement('button'),status=document.createElement('p');
    box.style.cssText='box-sizing:border-box;width:100%;height:100%;padding:16px;background:#dbeafe;color:#153e75;font:22px sans-serif';
    button.textContent='Add '+ctx.props.label;button.style.cssText='padding:8px;font:20px sans-serif';
    status.setAttribute('role','status');function paint(){status.textContent=ctx.props.label+' count '+count+' step ${increment}'}
    button.onclick=function(){count+=${increment};paint()};paint();box.append(button,status);ctx.dom.root.append(box);
    return{destroy(){button.onclick=null;box.remove()}};
  }});`
}

async function writeFixture(path: string) {
  const withFlow = addCourseFlowPage(createBlankCourseProject({ title: 'Component patch lifecycle' }))
  if (!withFlow.ok) throw new Error(withFlow.reason)
  const withSpatial = addCourseSpatialPage(withFlow.project)
  if (!withSpatial.ok) throw new Error(withSpatial.reason)
  const project = withSpatial.project
  const encoder = new TextEncoder()
  const data = parseComponentPackageFiles({
    'manifest.json': encoder.encode(JSON.stringify({ schemaVersion: 4, runtimeApiVersion: 4, id: packageId,
      name: 'Increment fixture', version: '1.0.0', entry: 'runtime.js', defaultSize: { width: 320, height: 150 },
      minSize: { width: 16, height: 16 }, preserveAspectRatio: false, assets: {}, defaultProps: {},
      supportedScopes: ['scene', 'global'], renderMode: 'dom' })),
    'runtime.js': encoder.encode(source(1)),
    'spare.js': encoder.encode('// Keep this unmodified source file.\n'),
    'notes.json': encoder.encode('{"keep":"unmodified package data"}\n'),
  })
  project.componentPackages[packageId] = componentPackageMeta(data)
  const fallback = new Uint8Array(await sharp({ create: { width: 320, height: 150, channels: 4, background: '#e2e8f0' } }).png().toBuffer())
  await sharp(fallback).raw().toBuffer()
  project.assets.fallback = { id: 'fallback', filename: 'fallback.png', path: 'assets/fallback.png',
    kind: 'image', mimeType: 'image/png', byteLength: fallback.byteLength, width: 320, height: 150 }
  const layer = (id: string, x: number, y: number) => ({ kind: 'component' as const, layerItemId: id, label: id,
    frame: { mode: 'absolute' as const, x, y, width: 320, height: 150 }, order: 10, visible: true, locked: false,
    rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const,
    component: { packageId, version: '1.0.0' }, props: { label: id, preserve: { value: id } }, staticFallbackAssetId: 'fallback' })
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  const flow = project.surfaces.find(surface => surface.type === 'flow')!
  const spatial = project.surfaces.find(surface => surface.type === 'spatial-2d')!
  if (slide.type !== 'slide' || flow.type !== 'flow' || spatial.type !== 'spatial-2d') throw new Error('Incomplete three-surface fixture')
  slide.scenes[0]!.layerItems.push(layer(ids.slide, 100, 200))
  flow.blocks.push({ id: 'patch-section', type: 'section', title: { inlines: [{ type: 'text', text: 'Nested component' }] }, collapsedByDefault: false,
    blocks: [{ id: ids.flow, type: 'component', component: { packageId, version: '1.0.0' },
      props: { label: ids.flow, preserve: { value: ids.flow } }, staticFallbackAssetId: 'fallback', wrap: 'none' }] })
  spatial.world.layerItems.push(layer(ids.spatial, -160, -75))
  writeFileSync(path, createCourseProjectArchive({ project, assetFiles: { fallback },
    componentFiles: { [componentPackageKey(packageId, data.manifest.version)]: data.files } }))
  return readSaved(path)
}

function instances(project: CourseProjectDocument) {
  const result: Record<string, { component: { packageId: string; version: string }; staticFallbackAssetId: string }> = {}
  const layer = (item: LayerItem) => {
    if (item.kind !== 'component') return
    if (!item.staticFallbackAssetId) throw new Error('Fixture component lost its fallback')
    result[item.layerItemId] = item as typeof result[string]
  }
  const blocks = (values: FlowBlock[]) => values.forEach(block => {
    if (block.type === 'section') blocks(block.blocks)
    if (block.type === 'component') result[block.id] = block
  })
  project.globalLayerItems.forEach(entry => layer(entry.item))
  project.surfaces.forEach(surface => {
    surface.surfaceLayerItems.forEach(entry => layer(entry.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => scene.layerItems.forEach(layer))
    if (surface.type === 'flow') blocks(surface.blocks)
    if (surface.type === 'spatial-2d') surface.world.layerItems.forEach(layer)
  })
  return result
}

function withoutClock(project: CourseProjectDocument) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = project
  return content
}

function archivedPackageFiles(archive: CourseProjectArchiveData, id: string) {
  const meta = archive.project.componentPackages[id]
  if (!meta || meta.packageId !== id) throw new Error(`Missing package metadata: ${id}`)
  const key = componentPackageKey(id, meta.version)
  const files = archive.componentFiles[key]
  if (!files) throw new Error(`Missing canonical archive package: ${key}`)
  return files
}

function expectPatched(saved: CourseProjectArchiveData, original: CourseProjectArchiveData, mode: Mode) {
  const before = instances(original.project), after = instances(saved.project)
  expect(Object.keys(after).sort()).toEqual(Object.values(ids).sort())
  const changedId = mode === 'shared' ? packageId : after[ids.flow]!.component.packageId
  const affected = mode === 'shared' ? Object.values(ids) : [ids.flow]
  const expectedPackages = mode === 'shared' ? [packageId] : [packageId, changedId]
  expect(Object.keys(saved.componentFiles).sort()).toEqual(expectedPackages
    .map(id => componentPackageKey(id, saved.project.componentPackages[id]!.version)).sort())
  const originalFiles = archivedPackageFiles(original, packageId)
  if (mode === 'instance') {
    expect(changedId).not.toBe(packageId)
    expect(archivedPackageFiles(saved, packageId)).toEqual(originalFiles)
    expect(saved.project.componentPackages[packageId]).toEqual(original.project.componentPackages[packageId])
  }
  const changed = parseComponentPackageFiles(archivedPackageFiles(saved, changedId))
  expect(changed.manifest.id).toBe(changedId)
  expect(changed.manifest.version).not.toBe('1.0.0')
  expect(changed.manifest.version).toBe(saved.project.componentPackages[changedId]!.version)
  expect(Object.keys(changed.files).sort()).toEqual(Object.keys(originalFiles).sort())
  const { id: _id, version: _version, ...manifest } = changed.manifest
  const { id: _baseId, version: _baseVersion, ...originalManifest } = parseComponentPackageFiles(originalFiles).manifest
  expect(manifest).toEqual(originalManifest)
  expect(new TextDecoder().decode(changed.files['runtime.js'])).toBe(source(2).replace(JSON.stringify(packageId), JSON.stringify(changedId)))
  for (const name of ['spare.js', 'notes.json']) expect(changed.files[name]).toEqual(originalFiles[name])
  const restored = structuredClone(saved.project), restoredInstances = instances(restored)
  for (const id of Object.values(ids)) {
    if (affected.includes(id)) {
      expect(after[id]!.component).toEqual({ packageId: changedId, version: changed.manifest.version })
      expect(after[id]!.staticFallbackAssetId).toMatch(/^component-capture-/)
      expect(saved.assetFiles[after[id]!.staticFallbackAssetId]).toBeDefined()
      restoredInstances[id]!.component = structuredClone(before[id]!.component)
      restoredInstances[id]!.staticFallbackAssetId = before[id]!.staticFallbackAssetId
    } else expect(after[id]).toEqual(before[id])
  }
  // Everything except the exact source identity, refreshed fallbacks and clocks
  // must survive, including nested props, geometry, ordering and other surfaces.
  restored.componentPackages = original.project.componentPackages
  restored.assets = original.project.assets
  expect(withoutClock(restored)).toEqual(withoutClock(original.project))
  expect(saved.assetFiles.fallback).toEqual(original.assetFiles.fallback)
  expect(Object.keys(saved.assetFiles).filter(id => id !== 'fallback').sort())
    .toEqual(affected.map(id => after[id]!.staticFallbackAssetId).sort())
  return affected.map(id => ({ id, assetId: after[id]!.staticFallbackAssetId }))
}

async function openSurface(page: Page, kind: 'slide-scene' | 'flow-page' | 'spatial-camera') {
  await page.getByTestId('course-page-tree').locator(`[data-kind="${kind}"]`).first().locator('button.course-page-tree__label').first().click()
  await expect(page.getByTestId(kind === 'slide-scene' ? 'canvas-stage' : kind === 'flow-page' ? 'flow-workspace' : 'spatial-workspace')).toBeVisible()
}

async function expectInteractivePreview(run: NativeRun, mode: Mode) {
  const surfaces = [{ kind: 'slide-scene', id: ids.slide }, { kind: 'flow-page', id: ids.flow },
    { kind: 'spatial-camera', id: ids.spatial }] as const
  await run.page.getByRole('button', { name: '整课预览', exact: true }).click()
  const overlay = run.page.getByTestId('course-preview-overlay'), host = run.page.getByTestId('course-preview-host')
  await expect(overlay).toBeVisible()
  // Whole-course preview starts at the saved start location, independently of
  // the current authoring location. Traverse the fixture's actual page order.
  for (const [index, surface] of surfaces.entries()) {
    if (index > 0) await overlay.getByTestId('course-preview-next').click()
    const component = host.locator(`.published-component-mount[data-component-instance-id="${surface.id}"]`)
    await expect(component).toBeVisible()
    const increment = mode === 'shared' || surface.id === ids.flow ? 2 : 1
    await expect(component.getByRole('status')).toHaveText(`${surface.id} count 0 step ${increment}`)
    await component.getByRole('button', { name: `Add ${surface.id}`, exact: true }).click()
    await expect(component.getByRole('status')).toHaveText(`${surface.id} count ${increment} step ${increment}`)
    await run.page.screenshot({ path: join(run.runRoot, `reopened-${surface.kind}-interaction.png`) })
  }
  await overlay.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(overlay).toHaveCount(0)
}

for (const mode of ['shared', 'instance'] as const) test(`component.package patch ${mode}: real admission, three surfaces and saved interaction`, async () => {
  test.setTimeout(240_000)
  const runRoot = join(productRoot, 'output', 'r18-short-path-component-patch', `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson'), original = await writeFixture(projectPath)
  let server: ViteDevServer | undefined, run: NativeRun | undefined
  try {
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('No isolated renderer address')
    const userData = join(runRoot, 'profile')
    const app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    run = { app, page, runRoot, workspaceRoot: runRoot, projectPath, userData, pageErrors: [], consoleErrors: [] }
    page.on('pageerror', error => run!.pageErrors.push(error.message))
    const admissionWindows = new Set<Page>()
    app.on('window', worker => {
      const observe = () => { if (worker.url().includes('/admission.html')) admissionWindows.add(worker) }
      observe(); worker.on('framenavigated', observe)
    })
    await expectBackgroundWindowsIsolated(app, true)
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    // The only replacement is the OS picker for this test's known lesson.
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    await openSurface(page, mode === 'instance' ? 'flow-page' : 'slide-scene')
    const result = await page.evaluate(async ({ mode, packageId, ids, changedSource }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { createCourseChatObservation } = await load('/src/renderer/ui/chat/courseChatObservation.ts')
      const selectedId = mode === 'instance' ? ids.flow : ids.slide
      useEditorStore.getState().selectNode(selectedId)
      const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
      if (typeof window.desktopAPI.dynamicAdmission !== 'function') throw new Error('Real Main admission IPC is required')
      const owner = { projectId: project.id, projectPath: state.projectPath }
      const workspace = (await window.desktopAPI.localAgent({ operation: 'workspace', ...owner })).workspace
      if (!workspace) throw new Error('Main did not return the current workspace')
      const bridge = createCourseChatObservation(window.desktopAPI, owner)
      const current = () => {
        const value = useEditorStore.getState()
        return { project: structuredClone(selectActiveCourseProjectDocument(value)),
          assets: structuredClone(value.courseAssetSidecar.files), packages: structuredClone(value.componentPackages),
          history: (mode === 'instance' ? value.flowSession.history : value.slideBackend.getSession().history).past.length }
      }
      try {
        const request = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
          instruction: mode === 'shared' ? 'Change this component source so every instance on all pages adds two.' : 'Change only this selected nested Flow component to add two; preserve the other instances.',
          applyPolicy: 'auto', expectedResult: 'candidate', materials: [], catalogPackages: [] })
        const baseline = request.context.componentSources.find((value: any) => value.packageId === packageId)
        if (!baseline) throw new Error('Formal observation did not expose the existing source baseline')
        const instance = baseline.editTargets.instance.find((value: any) => value.selected && value.target.itemId === selectedId)
        if (mode === 'instance' && instance?.sourcePatch.status !== 'available') throw new Error('Selected nested Flow instance patch is unavailable')
        const target = mode === 'shared' ? baseline.editTargets.shared.target : instance.target
        const destination = request.destinations.find((value: any) => value.kind === 'update' && JSON.stringify(value.target) === JSON.stringify(target))
        if (!destination) throw new Error('Patch target is not one exact frozen destination')
        const input = { operation: 'patch', mode, basePackageId: packageId, baseVersion: baseline.baseVersion,
          baseContentIdentity: baseline.baseContentIdentity, changedFiles: { 'runtime.js': btoa(changedSource) }, deleteFiles: [] }
        const before = current()
        const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, {
          version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: 'One-file existing component source patch',
          afterCommit: { version: 1, action: 'observe', reason: 'Verify the changed executable interaction in the actual host.' },
          steps: [{ id: 'patch', tool: 'component.package', carrier: 'generated-component', destination, input,
            lowerCarrierReason: 'The requested behavior lives in this existing component source, not public properties.' }],
        })
        const afterPrepare = current()
        const committed = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
        if (committed.status !== 'committed') throw new Error('Formal patch did not commit')
        return { input, baseline: { packageId, version: baseline.baseVersion }, beforeRevision: before.project.revision,
          preparePreservedDocument: JSON.stringify(afterPrepare.project) === JSON.stringify(before.project),
          preparePreservedAssets: JSON.stringify(afterPrepare.assets) === JSON.stringify(before.assets),
          preparePreservedPackages: JSON.stringify(afterPrepare.packages) === JSON.stringify(before.packages),
          historyBefore: before.history, historyAfterPrepare: afterPrepare.history, historyAfterCommit: current().history,
          behaviorEvidence: prepared.behaviorEvidence, receipt: committed.receipt }
      } finally { bridge.dispose() }
    }, { mode, packageId, ids, changedSource: source(2) })
    writeFileSync(join(runRoot, 'formal-patch-result.json'), JSON.stringify(result, null, 2))
    expect(Object.keys(result.input.changedFiles)).toEqual(['runtime.js'])
    expect(result.preparePreservedDocument && result.preparePreservedAssets && result.preparePreservedPackages).toBe(true)
    expect(result.historyAfterPrepare).toBe(result.historyBefore)
    expect(result.historyAfterCommit).toBe(result.historyBefore + 1)
    expect(result.receipt).toMatchObject({ status: 'committed', beforeRevision: result.beforeRevision, afterRevision: result.beforeRevision + 1 })
    const affected = mode === 'shared' ? Object.values(ids) : [ids.flow]
    expect(result.behaviorEvidence.flatMap((evidence: any) => evidence.instanceIds).sort()).toEqual(affected.sort())
    for (const evidence of result.behaviorEvidence) {
      expect(evidence).toMatchObject({ status: 'observed', mode: 'full-admission', semanticVerdict: 'requires-review' })
      expect(evidence.actions).toEqual(['update-inputs', 'resize-and-restore', 'suspend', 'resume'])
      expect(evidence.frames).toHaveLength(6)
      for (const frame of evidence.frames) await sharp(Buffer.from(frame.dataUrl.split(',')[1]!, 'base64')).raw().toBuffer()
    }
    expect(admissionWindows.size, 'The formal path must create one actual Electron admission worker').toBe(1)
    await expect.poll(() => [...admissionWindows].every(worker => worker.isClosed())).toBe(true)
    const saved = await saveStage(run, '01-patched')
    const captures = expectPatched(saved, original, mode)
    for (const capture of captures) {
      const bytes = saved.assetFiles[capture.assetId]!
      const meta = await sharp(bytes).metadata()
      expect(meta.width).toBeGreaterThan(0); expect(meta.height).toBeGreaterThan(0)
      await sharp(bytes).raw().toBuffer()
      writeFileSync(join(runRoot, `${capture.id}-admitted-fallback.png`), bytes)
    }
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveStage(run, '02-undone')
    expect(withoutClock(undone.project)).toEqual(withoutClock(original.project))
    expect(undone.componentFiles).toEqual(original.componentFiles)
    expect(undone.assetFiles).toEqual(original.assetFiles)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    const redone = await saveStage(run, '03-redone')
    expect(withoutClock(redone.project)).toEqual(withoutClock(saved.project))
    expect(redone.componentFiles).toEqual(saved.componentFiles)
    expect(redone.assetFiles).toEqual(saved.assetFiles)
    await page.getByRole('button', { name: '新建课件（Ctrl+N）', exact: true }).click()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expectInteractivePreview(run, mode)
    const reopened = await saveStage(run, '04-reopened-interacted')
    expectPatched(reopened, original, mode)
    expect(withoutClock(reopened.project)).toEqual(withoutClock(redone.project))
    expect(reopened.componentFiles).toEqual(redone.componentFiles)
    expect(reopened.assetFiles).toEqual(redone.assetFiles)
    expect(nativeRecords(run), 'This deterministic host test must not call a paid native model').toEqual([])
    expect(run.pageErrors).toEqual([])
    await expectBackgroundWindowsIsolated(app, true)
  } catch (error) {
    writeFileSync(join(runRoot, 'failure.txt'), String(error))
    await run?.page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    await server?.close()
  }
})
