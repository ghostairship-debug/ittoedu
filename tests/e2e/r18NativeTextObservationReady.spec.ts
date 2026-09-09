import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeNativeEditor, FIXTURE_IDS, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')
type Rect = { x: number; y: number; width: number; height: number }

async function pixels(base64: string, oldTitle: Rect) {
  const image = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let purple = 0, oldTitleInk = 0
  const bounds = { left: image.info.width, top: image.info.height, right: -1, bottom: -1 }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const [r, g, b, a] = image.data.subarray(offset, offset + 4)
    if (a! < 240) continue
    const x = (offset / 4) % image.info.width, y = Math.floor(offset / 4 / image.info.width)
    if (x >= oldTitle.x && x < oldTitle.x + oldTitle.width && y >= oldTitle.y && y < oldTitle.y + oldTitle.height
      && r! < 100 && g! < 100 && b! < 110) oldTitleInk++
    if (r! > 145 && b! > 155 && g! < 95) {
      purple++
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y)
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y)
    }
  }
  return { width: image.info.width, height: image.info.height, purple, oldTitleInk, purpleBounds: purple ? bounds : null }
}

test('the immediate formal observation reflects a Native text, font and frame edit', async () => {
  test.setTimeout(150_000)
  const runRoot = join(productRoot, 'output', 'r18-native-text-observation', new Date().toISOString().replace(/[:.]/g, '-'))
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
    await expectBackgroundWindowsIsolated(app, true)
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await page.getByTestId(`node-item-${FIXTURE_IDS.title}`).locator('.node-name').click()

    const result = await page.evaluate(async ({ ids }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { createCourseChatObservation } = await load('/src/renderer/ui/chat/courseChatObservation.ts')
      const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
      const owner = { projectId: project.id, projectPath: state.projectPath }
      const workspace = (await window.desktopAPI.localAgent({ operation: 'workspace', ...owner })).workspace
      if (!workspace) throw new Error('Main did not return the current workspace')
      const captureRects: Rect[] = []
      const bridge = createCourseChatObservation({ ...window.desktopAPI,
        captureAuthoringObservation(rect: Rect) {
          captureRects.push({ ...rect })
          return window.desktopAPI.captureAuthoringObservation!(rect)
        } }, owner)
      const items = (value: any) => value.surfaces.flatMap((surface: any) => surface.type === 'slide' ? surface.scenes.flatMap((scene: any) => scene.layerItems) : [])
      const original = items(project).find((item: any) => item.layerItemId === ids.title)
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      const rendered = () => {
        const mounted = document.querySelector(`[data-slide-layer-item="${ids.title}"]`)
        const slide = mounted?.closest('.slide-published-adapter')
        if (!mounted || !slide) throw new Error('The title has no mounted Published layer')
        return { text: mounted.textContent, mountedRect: rect(mounted), slideRect: rect(slide),
          slideSize: { width: (slide as HTMLElement).offsetWidth, height: (slide as HTMLElement).offsetHeight } }
      }
      try {
        const before = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
          instruction: '把标题改为简谐运动，放大为64号紫色文字，移到新的文本框中并居中。', applyPolicy: 'auto', expectedResult: 'auto', materials: [], catalogPackages: [] })
        const beforeRendered = rendered()
        const destination = before.destinations.find((value: any) => value.kind === 'update' && value.target.itemId === ids.title)
        if (!destination) throw new Error('Formal observation did not expose the title destination')
        const prepared = await useEditorStore.getState().prepareGenerationCandidate(before, {
          version: 1, requestId: before.requestId, candidateId: crypto.randomUUID(), summary: 'Canonical text/font/frame observation',
          steps: [{ id: 'title', tool: 'native.content', carrier: 'native', destination,
            input: { operation: 'edit', text: '简谐运动', textStyle: { fontSize: 64, align: 'center', color: '#c026d3' },
              properties: { frame: { x: 400, y: 150, width: 600, height: 100 } } } }],
        })
        const committed = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
        if (committed.status !== 'committed') throw new Error('Native text edit did not commit')
        const atCommit = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState()))
        const historyAtCommit = useEditorStore.getState().slideBackend.getSession().history.past.length
        // One normal immediate post-commit capture, without a sleep, pixel poll,
        // second capture, preview transition or substituted image response.
        const after = await bridge.captureNext(before, committed.receipt)
        const current = selectActiveCourseProjectDocument(useEditorStore.getState())
        return { before, after, beforeRendered, afterRendered: rendered(), captureRects, original,
          updated: items(current).find((item: any) => item.layerItemId === ids.title), receipt: committed.receipt,
          historyAtCommit, historyAfterObservation: useEditorStore.getState().slideBackend.getSession().history.past.length,
          documentUnchangedByObservation: JSON.stringify(current) === JSON.stringify(atCommit) }
      } finally { bridge.dispose() }
    }, { ids: FIXTURE_IDS })
    const frame = (request: typeof result.before) => {
      const file = request.resourceFiles.find((value: any) => value.path === 'observation/current-frame.png')
      if (!file || file.encoding !== 'base64') throw new Error('Missing actual Main current-frame image')
      return file.content as string
    }
    const beforeFrame = frame(result.before), afterFrame = frame(result.after)
    const imageSize = await sharp(Buffer.from(beforeFrame, 'base64')).metadata()
    const capture = result.captureRects[0]!, original = result.beforeRendered.mountedRect
    const sx = imageSize.width! / capture.width, sy = imageSize.height! / capture.height
    const oldTitle = { x: (original.x - capture.x) * sx + 3, y: (original.y - capture.y) * sy + 3,
      width: Math.min(original.width * sx - 6, 300), height: original.height * sy - 6 }
    const pixelEvidence = { before: await pixels(beforeFrame, oldTitle), after: await pixels(afterFrame, oldTitle) }
    writeFileSync(join(runRoot, 'before.png'), Buffer.from(beforeFrame, 'base64'))
    writeFileSync(join(runRoot, 'after.png'), Buffer.from(afterFrame, 'base64'))
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ evidence: 'Real Electron Main and isolated development renderer; zero native model calls.', ...result, oldTitle, pixels: pixelEvidence }, null, 2))
    await page.screenshot({ path: join(runRoot, 'after-ui.png') })
    expect(result.updated.content.data.text).toBe('简谐运动')
    expect(result.updated.content.data.style).toMatchObject({ fontSize: 64, align: 'center', color: '#c026d3' })
    expect(result.updated.frame).toEqual({ mode: 'absolute', x: 400, y: 150, width: 600, height: 100 })
    expect(result.afterRendered.text).toContain('简谐运动')
    expect(result.afterRendered.text).not.toContain('振动的世界')
    expect(pixelEvidence.before.oldTitleInk).toBeGreaterThan(200)
    expect(pixelEvidence.before.purple).toBe(0)
    expect(pixelEvidence.after.oldTitleInk).toBeLessThan(20)
    expect(pixelEvidence.after.purple).toBeGreaterThan(1500)
    expect(result.captureRects).toHaveLength(2)
    const nextCapture = result.captureRects[1]!, mounted = result.afterRendered.mountedRect
    const px = pixelEvidence.after.width / nextCapture.width, py = pixelEvidence.after.height / nextCapture.height
    const bounds = pixelEvidence.after.purpleBounds!
    expect(bounds.left).toBeGreaterThanOrEqual((mounted.x - nextCapture.x) * px)
    expect(bounds.right).toBeLessThanOrEqual((mounted.x + mounted.width - nextCapture.x) * px)
    expect(bounds.top).toBeGreaterThanOrEqual((mounted.y - nextCapture.y) * py)
    expect(bounds.bottom).toBeLessThanOrEqual((mounted.y + mounted.height - nextCapture.y) * py)
    expect(Math.abs((bounds.left + bounds.right) / 2 - (mounted.x + mounted.width / 2 - nextCapture.x) * px)).toBeLessThan(8)
    expect(bounds.bottom - bounds.top).toBeGreaterThan(60)
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
