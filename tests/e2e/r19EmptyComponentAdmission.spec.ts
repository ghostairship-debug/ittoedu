import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { componentPackageMeta } from '../../src/shared/componentPackageMeta'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../src/core/drivers/codecs/archivePath'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')
const packageId = 'com.example.empty-admission', instanceId = 'empty-admission-instance'
const cases = {
  // Same failure as the retained teacher candidate: create returns an object,
  // but the constructed interface never enters ctx.dom.root. Frame is nonzero.
  empty: "const box=document.createElement('section');box.textContent='预测并操作开关';",
  text: "ctx.dom.root.textContent='可见的预测与操作';ctx.dom.root.style.color='#123456';",
  background: "ctx.dom.root.style.background='#245580';",
  border: "ctx.dom.root.style.border='8px solid #245580';",
  pseudo: "ctx.dom.root.className='painted-pseudo';const style=document.createElement('style');style.textContent='.painted-pseudo::before{content:\"可见伪元素\";display:block;color:#123456;font-size:24px}';ctx.dom.root.append(style);",
  canvas: "const canvas=document.createElement('canvas');canvas.width=830;canvas.height=240;ctx.dom.root.append(canvas);const g=canvas.getContext('2d');g.fillStyle='#245580';g.fillRect(20,20,100,80);",
} as const
const source = (body: string) => `CoursewareComponent.define({id:${JSON.stringify(packageId)},runtimeApiVersion:4,create(ctx){${body}return{destroy(){ctx.dom.root.replaceChildren()}}}});`

test('generated Component admission rejects an empty 830x240 host and preserves real paint without model calls', async () => {
  test.setTimeout(180_000)
  const runRoot = join(productRoot, 'output', 'r19-empty-component-admission', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  const project = createBlankCourseProject({ title: 'Empty component admission', includeDefaultController: false, controls: 'none' })
  const encoder = new TextEncoder()
  const pkg = parseComponentPackageFiles({
    'manifest.json': encoder.encode(JSON.stringify({ schemaVersion: 4, runtimeApiVersion: 4, id: packageId, name: 'Paint probe', version: '1.0.0',
      entry: 'runtime.js', defaultSize: { width: 830, height: 240 }, minSize: { width: 16, height: 16 }, preserveAspectRatio: false,
      assets: {}, defaultProps: {}, supportedScopes: ['scene', 'global'], renderMode: 'dom' })),
    'runtime.js': encoder.encode(source("ctx.dom.root.textContent='原实例';")),
  })
  project.componentPackages[packageId] = componentPackageMeta(pkg)
  const fallback = new Uint8Array(await sharp({ create: { width: 830, height: 240, channels: 4, background: '#245580' } }).png().toBuffer())
  project.assets.fallback = { id: 'fallback', filename: 'fallback.png', path: 'assets/fallback.png', kind: 'image', mimeType: 'image/png',
    byteLength: fallback.byteLength, width: 830, height: 240 }
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Expected Slide')
  surface.scenes[0]!.layerItems.push({ kind: 'component', layerItemId: instanceId, label: 'Paint probe', order: 0,
    frame: { mode: 'absolute', x: 80, y: 180, width: 830, height: 240 }, rotation: 0, opacity: 1, visible: true, locked: false,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId, version: '1.0.0' }, props: {}, staticFallbackAssetId: 'fallback' })
  const archive = createCourseProjectArchive({ project, assetFiles: { fallback }, componentFiles: { [componentPackageKey(packageId, '1.0.0')]: pkg.files } })
  writeFileSync(projectPath, archive)
  let app: ElectronApplication | undefined, server: ViteDevServer | undefined
  try {
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('No isolated renderer address')
    app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, [BACKGROUND_E2E_ENV]: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    const workers = new Set<string>()
    app.on('window', worker => {
      const observe = () => { if (worker.url().includes('/admission.html')) workers.add(worker.url()) }
      observe(); worker.on('framenavigated', observe)
    })
    const page = await app.firstWindow()
    // A fresh lesson workspace keeps the unused editor tab hidden. This test
    // drives the separate admission window, so only renderer readiness matters.
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor({ state: 'attached' })
    await expectBackgroundWindowsIsolated(app, true)
    for (const [kind, body] of Object.entries(cases)) {
      const result = await page.evaluate(async ({ archive, projectPath, packageId, instanceId, changedSource }) => {
        const load = (path: string) => import(/* @vite-ignore */ path)
        const { openCourseProjectArchive } = await load('/src/core/drivers/codecs/courseProjectArchive.ts')
        const { componentPackagesFromArchive } = await load('/src/renderer/components/componentPackageStore.ts')
        const { useEditorStore, selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectSlideAuthoringBackend } = await load('/src/renderer/store/editorStore.ts')
        const { captureGenerationSnapshot } = await load('/src/renderer/authoring/generation/generationSnapshot.ts')
        const opened = openCourseProjectArchive(new Uint8Array(archive))
        useEditorStore.getState().loadCourseProject(opened.project, projectPath, opened.assetFiles, componentPackagesFromArchive(opened.project, opened.componentFiles))
        useEditorStore.getState().selectNode(instanceId)
        const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
        const before = { document: JSON.stringify(document), resources: JSON.stringify(state.componentPackages), assets: JSON.stringify(state.courseAssetSidecar.files),
          history: selectSlideAuthoringBackend(state).getSession().history.past.length }
        if (typeof window.desktopAPI.dynamicAdmission !== 'function') throw new Error('Real Main dynamic admission is required')
        const request = captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: projectPath.toLowerCase().replace(/\\/g, '/') },
          projection: selectEffectiveLayerProjection(state), sessionToken: state.courseAuthoringSession.token, selectedIds: [instanceId],
          componentPackages: state.componentPackages, scope: 'selection', purpose: 'local-edit', instruction: '修改现有组件源码并检查实际显示', intent: 'edit' })
        const baseline = request.context.componentSources.find((value: any) => value.packageId === packageId)
        const destination = request.destinations.find((value: any) => value.kind === 'update'
          && value.target.authoringAddress === baseline.editTargets.shared.target.authoringAddress)
        let accepted = false, diagnostics: unknown[] = [], frame: string | undefined
        try {
          const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, {
            version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '检查组件绘制', afterCommit: { version: 1, action: 'finish' },
            steps: [{ id: 'patch', tool: 'component.package', carrier: 'generated-component', destination,
              input: { operation: 'patch', mode: 'shared', basePackageId: packageId, baseVersion: baseline.baseVersion, baseContentIdentity: baseline.baseContentIdentity,
                changedFiles: { 'runtime.js': { encoding: 'utf8', text: changedSource } }, deleteFiles: [] } }],
          })
          accepted = true
          frame = prepared.behaviorEvidence[0]?.frames[0]?.dataUrl
          useEditorStore.getState().discardGenerationCandidate()
        } catch (error: any) { diagnostics = error.failure?.diagnostics ?? error.diagnostics ?? [{ message: String(error) }] }
        const current = useEditorStore.getState()
        return { accepted, diagnostics, frame, revision: selectActiveCourseProjectDocument(current).revision,
          documentUnchanged: JSON.stringify(selectActiveCourseProjectDocument(current)) === before.document,
          resourcesUnchanged: JSON.stringify(current.componentPackages) === before.resources && JSON.stringify(current.courseAssetSidecar.files) === before.assets,
          historyBefore: before.history, historyAfter: selectSlideAuthoringBackend(current).getSession().history.past.length }
      }, { archive: [...archive], projectPath, packageId, instanceId, changedSource: source(body) })
      const { frame, ...summary } = result
      writeFileSync(join(runRoot, `${kind}.json`), JSON.stringify(summary, null, 2))
      if (frame) writeFileSync(join(runRoot, `${kind}.png`), Buffer.from(frame.split(',')[1]!, 'base64'))
      expect(result.documentUnchanged && result.resourcesUnchanged).toBe(true)
      expect(result.historyAfter).toBe(result.historyBefore)
      expect(result.revision).toBe(project.revision)
      if (kind === 'empty') {
        expect(result.accepted).toBe(false)
        expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'dynamic-component-empty-content',
          message: expect.stringContaining('ctx.dom.root'), path: ['locations', project.startLocationId, 'instances', instanceId, 'create'] })]))
      } else expect(result.accepted, JSON.stringify(result.diagnostics)).toBe(true)
    }
    expect(workers.size, 'Real Electron admission window must be used').toBeGreaterThan(0)
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ cases: Object.keys(cases), nativeModelCalls: 0, isolatedAdmission: true, status: 'passed' }, null, 2))
  } finally {
    if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}) }
    await server?.close()
  }
})
