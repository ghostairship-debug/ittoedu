import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeNativeEditor, FIXTURE_IDS, selectLayer, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor as enterStandaloneEditorFromLanding } from './lessonWorkspaceEntry'

const productRoot = resolve(__dirname, '..', '..')

const runtimeSource = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
  const tile=document.createElement('div');
  tile.setAttribute('aria-label','Runtime replacement ready');
  tile.textContent='RUNTIME READY';
  Object.assign(tile.style,{position:'absolute',inset:'0',background:'#c026d3',color:'#ffffff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'36px',fontFamily:'sans-serif',pointerEvents:'none'});
  ctx.dom.overlay.append(tile);
  return {destroy(){tile.remove()}};
}})`

async function pixels(base64: string) {
  const image = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let blue = 0, magenta = 0
  const bounds = { left: image.info.width, top: image.info.height, right: -1, bottom: -1 }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const [r, g, b, a] = image.data.subarray(offset, offset + 4)
    if (a! < 240) continue
    if (b! > 150 && b! > r! * 1.5 && b! > g! * 1.15) blue++
    if (r! > 150 && b! > 150 && g! < 90) {
      magenta++
      const x = (offset / 4) % image.info.width, y = Math.floor(offset / 4 / image.info.width)
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y)
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y)
    }
  }
  return { width: image.info.width, height: image.info.height, blue, magenta, magentaBounds: magenta ? bounds : null }
}

test('the immediate formal observation reflects a Runtime replacement at its final frame', async () => {
  test.setTimeout(150_000)
  const runRoot = join(productRoot, 'output', 'r18-runtime-replacement-observation', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  await writeNativeLesson(projectPath)
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
    await enterStandaloneEditorFromLanding(page)
    await expectBackgroundWindowsIsolated(app, true)
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await selectLayer(page, FIXTURE_IDS.square)

    const result = await page.evaluate(async ({ ids, source }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { createCourseChatObservation } = await load('/src/renderer/ui/chat/courseChatObservation.ts')
      const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
      const owner = { projectId: project.id, projectPath: state.projectPath }
      const workspace = (await window.desktopAPI.localAgent({ operation: 'workspace', ...owner })).workspace
      if (!workspace) throw new Error('Main did not return the current workspace')
      const captureRects: Array<{ x: number; y: number; width: number; height: number }> = []
      const bridge = createCourseChatObservation({ ...window.desktopAPI,
        captureAuthoringObservation(rect: { x: number; y: number; width: number; height: number }) {
          captureRects.push({ ...rect })
          return window.desktopAPI.captureAuthoringObservation!(rect)
        } }, owner)
      const items = (document: any) => document.surfaces.flatMap((surface: any) => surface.type === 'slide' ? surface.scenes.flatMap((scene: any) => scene.layerItems) : [])
      const original = items(project).find((item: any) => item.layerItemId === ids.square)
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      try {
        const before = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
          instruction: 'Replace the selected blue square with the purple Runtime panel and retain its frame.', applyPolicy: 'auto', expectedResult: 'auto', materials: [], catalogPackages: [] })
        const destination = before.destinations.find((value: any) => value.kind === 'update' && value.target.itemId === ids.square)
        const scope = before.destinations.find((value: any) => value.kind === 'create' && value.scope.ownerKey === destination?.target.ownerKey)
        if (!destination || !scope) throw new Error('Formal observation did not expose replacement destinations')
        const prepared = await useEditorStore.getState().prepareGenerationCandidate(before, {
          version: 1, requestId: before.requestId, candidateId: crypto.randomUUID(), summary: 'Canonical Runtime replacement observation',
          steps: [
            { id: 'runtime', tool: 'runtime.insert', carrier: 'runtime', destination: scope,
              input: { label: 'Purple Runtime panel', runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true,
                renderMode: 'dom', source, content: { values: {} }, assets: {}, staticFallback: { assetId: ids.asset, coverage: 'scene' } } } },
            { id: 'replace', tool: 'selection.replace', carrier: 'native', destination,
              input: { replacementItemId: { $result: { stepId: 'runtime', kind: 'item-id', index: 0 } } } },
          ],
        })
        const committed = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
        if (committed.status !== 'committed') throw new Error('Runtime replacement did not commit')
        const atCommit = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState()))
        const historyAtCommit = useEditorStore.getState().slideBackend.getSession().history.past.length
        // The normal immediate post-commit capture; no sleep, pixel polling,
        // extra capture or preview transition occurs between these operations.
        const after = await bridge.captureNext(before, committed.receipt, prepared.behaviorEvidence)
        const current = selectActiveCourseProjectDocument(useEditorStore.getState())
        const replacement = items(current).find((item: any) => item.kind === 'runtime')
        const mounted = document.querySelector(`[data-slide-layer-item="${replacement?.layerItemId}"]`)
        const slide = mounted?.closest('.slide-published-adapter')
        if (!mounted || !slide) throw new Error('The final Runtime has no mounted Published layer')
        return { before, after, receipt: committed.receipt, originalFrame: original.frame, replacement,
          originalStillInProject: items(current).some((item: any) => item.layerItemId === ids.square),
          originalStillMounted: !!document.querySelector(`[data-slide-layer-item="${ids.square}"]`),
          mountedRect: rect(mounted), slideRect: rect(slide), captureRects,
          slideSize: { width: (slide as HTMLElement).offsetWidth, height: (slide as HTMLElement).offsetHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          historyAtCommit, historyAfterObservation: useEditorStore.getState().slideBackend.getSession().history.past.length,
          documentUnchangedByObservation: JSON.stringify(current) === JSON.stringify(atCommit),
          candidateBehavior: { observations: prepared.behaviorEvidence?.length ?? 0,
            boundary: 'Per-tool insertion evidence precedes selection.replace and is not final placement or cube semantic evidence.' } }
      } finally { bridge.dispose() }
    }, { ids: FIXTURE_IDS, source: runtimeSource })
    const frame = (request: typeof result.before) => {
      const file = request.resourceFiles.find((value: any) => value.path === 'observation/current-frame.png')
      if (!file || file.encoding !== 'base64') throw new Error('Missing actual Main current-frame image')
      return file.content as string
    }
    const beforeFrame = frame(result.before), afterFrame = frame(result.after)
    const pixelEvidence = { before: await pixels(beforeFrame), after: await pixels(afterFrame) }
    writeFileSync(join(runRoot, 'before.png'), Buffer.from(beforeFrame, 'base64'))
    writeFileSync(join(runRoot, 'after.png'), Buffer.from(afterFrame, 'base64'))
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ evidence: 'Real Electron Main with isolated development renderer, zero native model calls; final current-frame synchronization only.', ...result, pixels: pixelEvidence }, null, 2))
    await page.screenshot({ path: join(runRoot, 'after-ui.png') })
    expect(result.replacement.frame).toEqual(result.originalFrame)
    expect(result.originalStillInProject).toBe(false)
    expect(result.originalStillMounted).toBe(false)
    const scaleX = result.slideRect.width / result.slideSize.width, scaleY = result.slideRect.height / result.slideSize.height
    const expectedRect = { x: result.slideRect.x + result.replacement.frame.x * scaleX,
      y: result.slideRect.y + result.replacement.frame.y * scaleY,
      width: result.replacement.frame.width * scaleX, height: result.replacement.frame.height * scaleY }
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(result.mountedRect[key] - expectedRect[key])).toBeLessThan(1)
    expect(pixelEvidence.before.blue).toBeGreaterThan(1000)
    expect(pixelEvidence.before.magenta).toBe(0)
    expect(pixelEvidence.after.blue).toBeLessThan(pixelEvidence.before.blue * 0.02)
    expect(pixelEvidence.after.magenta).toBeGreaterThan(pixelEvidence.before.blue * 0.85)
    expect(result.captureRects).toHaveLength(4)
    const capture = result.captureRects[1]!
    const imageScaleX = pixelEvidence.after.width / capture.width, imageScaleY = pixelEvidence.after.height / capture.height
    const expectedPixels = { left: (expectedRect.x - capture.x) * imageScaleX, top: (expectedRect.y - capture.y) * imageScaleY,
      right: (expectedRect.x + expectedRect.width - capture.x) * imageScaleX - 1,
      bottom: (expectedRect.y + expectedRect.height - capture.y) * imageScaleY - 1 }
    expect(pixelEvidence.after.magentaBounds).not.toBeNull()
    for (const key of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(pixelEvidence.after.magentaBounds![key] - expectedPixels[key])).toBeLessThan(3)
    expect(result.after.documentRevision).toBe(result.receipt.afterRevision)
    expect(result.documentUnchangedByObservation).toBe(true)
    expect(result.historyAfterObservation).toBe(result.historyAtCommit)
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
