import { installHostToolTestTransport } from './helpers/g20HostTools'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeNativeEditor, FIXTURE_IDS, selectLayer, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor } from './lessonWorkspaceEntry'

const productRoot = resolve(__dirname, '..', '..')

async function colors(base64: string) {
  const image = await sharp(Buffer.from(base64, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let red = 0, green = 0
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const [r, g, b, a] = image.data.subarray(offset, offset + 4)
    if (a! < 240) continue
    if (r! > 150 && r! > g! * 1.5 && r! > b! * 1.5) red++
    if (g! > 130 && g! > r! * 1.5 && g! > b! * 1.2) green++
  }
  return { width: image.info.width, height: image.info.height, red, green }
}

test('a real image commit is green in the immediately following formal observation', async () => {
  test.setTimeout(150_000)
  const runRoot = join(productRoot, 'output', 'r18-native-image-observation', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  await writeNativeLesson(projectPath)
  let server: ViteDevServer | undefined, run: NativeRun | undefined
  try {
    // Real Electron Main, native capturePage, mounted UI, production observation
    // owner and canonical image transaction. Vite exposes those same modules for
    // direct invocation; this is development-renderer evidence, with no CLI call.
    server = await createServer({ configFile: join(productRoot, 'vite.renderer.config.ts'), cacheDir: join(runRoot, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
        watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('No local renderer address')
    const userData = join(runRoot, 'profile')
    const app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await installHostToolTestTransport(app, page)
    run = { app, page, runRoot, workspaceRoot: runRoot, projectPath, userData, pageErrors: [], consoleErrors: [] }
    page.on('pageerror', error => run!.pageErrors.push(error.message))
    await expectBackgroundWindowsIsolated(app, true)
    // 冷启动只进入独立编辑器面（判据见 tests/e2e/lessonWorkspaceEntry.ts）。
    await enterIndependentEditor(page)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await selectLayer(page, FIXTURE_IDS.image)

    const result = await page.evaluate(async ids => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { createCurrentObservation, readCanonicalCourse } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
      const { transformImageAsset } = await load('/src/renderer/project/imageTransform.ts')
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)
      const observer = createCurrentObservation()
      const canonical = await readCanonicalCourse(), runId = crypto.randomUUID()
      const originalBytes = Array.from(canonical.model.resources.assets[ids.asset])
      try {
        const before = await observer.capture({ intent: 'edit' })
        const target = await window.g20HostTool({ kind: 'begin', runId, documentId: canonical.documentId,
          target: { kind: 'course-object', locationId: state.courseAuthoringSession.token.locationId, itemId: ids.image } })
        if (typeof target !== 'string') throw new Error('No Gateway image target')
        const transformed = await transformImageAsset(canonical.model.resources.assets[ids.asset], document.assets[ids.asset].mimeType,
          { sourceAssetId: ids.asset, operations: [{ kind: 'replace-color', sourceColor: '#ef3333', targetColor: '#22c55e', tolerance: 32 }], alpha: 'preserve', outputFormat: 'png' })
        const resource = await window.g20HostTool({ kind: 'image', runId, documentId: canonical.documentId,
          bytes: Array.from(transformed.bytes), mimeType: 'image/png', filename: 'transformed.png' })
        if (typeof resource !== 'string') throw new Error('No decoded resource handle')
        const committed = await window.g20HostTool({ kind: 'call', runId, call: { name: 'media.apply', input: { target, resource } } })
        if (!committed || typeof committed === 'string' || committed.kind !== 'document-operation' || committed.result.status !== 'applied') throw new Error(JSON.stringify(committed))
        const atCommit = (await readCanonicalCourse()).model.project
        const historyAtCommit = (await readCanonicalCourse()).undoDepth
        // No test sleep, pixel polling or second capture: use the same immediate
        // production painter readiness barrier after the main-session commit.
        const after = await observer.capture({ intent: 'edit', prepareDrafts: false })
        return { before, after, receipt: committed.result, originalBytes, retainedOriginalBytes: Array.from((await readCanonicalCourse()).model.resources.assets[ids.asset]), historyAtCommit,
          historyAfterObservation: (await readCanonicalCourse()).undoDepth,
          documentUnchangedByObservation: JSON.stringify(atCommit) === JSON.stringify(selectActiveCourseProjectDocument(useEditorStore.getState())) }
      } finally { observer.dispose(); await window.g20HostTool({ kind: 'stop', runId }) }
    }, FIXTURE_IDS)
    const file = (request: typeof result.before, path: string) => {
      const value = request.resourceFiles.find((entry: any) => entry.path === path)
      if (!value || value.encoding !== 'base64') throw new Error(`Missing real observation image ${path}`)
      return value.content as string
    }
    const beforeFrame = file(result.before, 'observation/current-frame.png')
    const afterFrame = file(result.after, 'observation/current-frame.png')
    const original = result.after.resourceFiles.find((entry: any) => /^observation\/images\/0\./.test(entry.path))
    if (!original) throw new Error('The current original image was not captured')
    const pixels = { before: await colors(beforeFrame), after: await colors(afterFrame), original: await colors(original.content) }
    writeFileSync(join(runRoot, 'before.png'), Buffer.from(beforeFrame, 'base64'))
    writeFileSync(join(runRoot, 'after.png'), Buffer.from(afterFrame, 'base64'))
    writeFileSync(join(runRoot, 'after-original.png'), Buffer.from(original.content, 'base64'))
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ evidence: 'real Main and mounted development renderer; zero native CLI calls', ...result, pixels }, null, 2))
    await page.screenshot({ path: join(runRoot, 'after-ui.png') })
    expect(pixels.before.red).toBeGreaterThan(1000)
    // The transform deliberately preserves antialiased white boundaries. A tiny
    // red fringe also exists in the new original and is not a stale frame.
    expect(pixels.after.red).toBeLessThan(pixels.before.red * 0.01)
    expect(pixels.after.green).toBeGreaterThan(pixels.before.red * 0.95)
    expect(pixels.original.red).toBeLessThan(pixels.original.green * 0.01)
    expect(pixels.original.green).toBeGreaterThan(1000)
    expect(result.after.observation.documentRevision).toBe(result.receipt.revision)
    expect(result.retainedOriginalBytes).toEqual(result.originalBytes)
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
