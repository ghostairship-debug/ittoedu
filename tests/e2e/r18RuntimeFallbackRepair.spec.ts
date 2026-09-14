import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

import { closeNativeEditor, nativeRecords, readSaved, runtimeItem, saveStage, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')

test('same Runtime repairs an imported fallback through real admission and one resource transaction', async () => {
  test.skip(!process.env.R18_FALLBACK_SOURCE, 'Explicit existing corrupt-fallback lesson required; no native CLI calls')
  test.setTimeout(240_000)
  const sourcePath = resolve(process.env.R18_FALLBACK_SOURCE!)
  const original = readSaved(sourcePath), runtime = runtimeItem(original.project)
  const oldId = runtime.runtime.staticFallback!.assetId
  await expect(sharp(original.assetFiles[oldId]!).raw().toBuffer()).rejects.toThrow()
  const runRoot = join(productRoot, 'output', 'r18-runtime-fallback-repair', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  copyFileSync(sourcePath, projectPath)
  // Deterministic zero-model test artwork: not a replacement for the actual
  // paid-session candidate or proof of the requested cube speed adjustment.
  const png = await sharp({ create: { width: 240, height: 240, channels: 4, background: '#8b5cf6' } }).png().toBuffer()
  await sharp(png).raw().toBuffer()
  writeFileSync(join(runRoot, 'test-fallback.png'), png)
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
    await page.getByTestId(`node-item-${runtime.layerItemId}`).locator('.node-name').click()
    const result = await page.evaluate(async ({ runtimeId, base64 }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { createCourseChatObservation } = await load('/src/renderer/ui/chat/courseChatObservation.ts')
      const { locateCourseLayer } = await load('/src/renderer/course/effectiveLayerCommands.ts')
      const state = () => useEditorStore.getState()
      const snapshot = () => ({ document: structuredClone(selectActiveCourseProjectDocument(state())),
        assets: Object.fromEntries(Object.entries(state().courseAssetSidecar.files).map(([id, bytes]) => [id, Array.from(bytes as Uint8Array)])),
        history: state().slideBackend.getSession().history.past.length })
      const before = snapshot(), old = locateCourseLayer(before.document, runtimeId).item
      const owner = { projectId: before.document.id, projectPath: state().projectPath }
      const workspace = (await window.desktopAPI.localAgent({ operation: 'workspace', ...owner })).workspace
      const bridge = createCourseChatObservation(window.desktopAPI, owner)
      try {
        const request = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
          instruction: 'Repair the selected Runtime source and fallback in place.', applyPolicy: 'auto', expectedResult: 'auto', materials: [], catalogPackages: [] })
        const destination = request.destinations.find((entry: any) => entry.kind === 'update' && entry.target.itemId === runtimeId)
        const global = request.destinations.find((entry: any) => entry.kind === 'create' && entry.scope.owner === 'global')
        if (!destination || !global) throw new Error('Missing formal selected Runtime and asset destinations')
        const source = `${old.runtime.source}\n// zero-model fallback transaction verification`
        const candidate = () => ({ version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: 'Zero-model same Runtime fallback repair', steps: [
          { id: 'fallback', tool: 'asset.media.import', carrier: 'native', destination: global,
            input: { kind: 'image', filename: 'verified-fallback.png', mimeType: 'image/png', base64 } },
          { id: 'repair', tool: 'runtime.source', carrier: 'runtime', destination,
            lowerCarrierReason: 'The existing Runtime source and fallback require the Runtime carrier.',
            input: { source, staticFallback: { assetId: { $result: { stepId: 'fallback', kind: 'asset-id', index: 0 } }, coverage: old.runtime.staticFallback.coverage } } },
        ] })
        const bad = candidate()
        bad.steps = [bad.steps[1]]
        bad.steps[0]!.input.staticFallback!.assetId = old.runtime.staticFallback.assetId
        let rejected = ''
        try { await state().prepareGenerationCandidate(request, bad) } catch (error) { rejected = String(error) }
        const afterRejected = snapshot()
        const late = await state().prepareGenerationCandidate(request, candidate())
        const afterPrepared = snapshot()
        state().discardGenerationCandidate()
        const lateResult = state().applyGenerationCandidate(late.previewId)
        const afterDiscard = snapshot()
        const prepared = await state().prepareGenerationCandidate(request, candidate())
        const receipt = state().applyGenerationCandidate(prepared.previewId)
        const after = snapshot()
        return { before, afterRejected, afterPrepared, afterDiscard, after, rejected, lateResult, receipt,
          runtime: locateCourseLayer(after.document, runtimeId).item, source,
          behaviorEvidence: prepared.behaviorEvidence, request }
      } finally { bridge.dispose() }
    }, { runtimeId: runtime.layerItemId, base64: png.toString('base64') })
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2))
    expect(result.rejected).not.toBe('')
    expect(result.afterRejected).toEqual(result.before)
    expect(result.afterPrepared).toEqual(result.before)
    expect(result.afterDiscard).toEqual(result.before)
    expect(result.lateResult.status).toBe('stale')
    expect(result.receipt.status).toBe('committed')
    expect(result.after.history).toBe(result.before.history + 1)
    expect(result.runtime).toEqual({ ...runtime, runtime: { ...runtime.runtime, source: result.source, staticFallback: result.runtime.runtime.staticFallback } })
    const newId = result.runtime.runtime.staticFallback.assetId
    expect(newId).not.toBe(oldId)
    expect(result.after.assets[newId]).toEqual(Array.from(png))
    const saved = await saveStage(run, 'committed')
    expect(runtimeItem(saved.project)).toEqual(result.runtime)
    expect(Array.from(saved.assetFiles[newId]!)).toEqual(Array.from(png))
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveStage(run, 'undone')
    expect(runtimeItem(undone.project)).toEqual(runtime)
    expect(undone.assetFiles[newId]).toBeUndefined()
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    const redone = await saveStage(run, 'redone')
    expect(runtimeItem(redone.project)).toEqual(result.runtime)
    expect(Array.from(redone.assetFiles[newId]!)).toEqual(Array.from(png))
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await expect(page.getByTestId(`node-item-${runtime.layerItemId}`)).toHaveCount(1)
    const reopened = await saveStage(run, 'reopened')
    expect(reopened).toEqual(redone)
    const published = buildPublishedCourseV2Payload({ project: reopened.project, assetFiles: reopened.assetFiles, components: {} })
    writeFileSync(join(runRoot, 'published.json'), JSON.stringify(published, null, 2))
    const runtimeDefinitions: Array<Record<string, unknown>> = []
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      if ('protocol' in value && value.protocol === 'canvas-runtime') runtimeDefinitions.push(value as Record<string, unknown>)
      for (const nested of Object.values(value)) visit(nested)
    }
    visit(published)
    expect(runtimeDefinitions).toHaveLength(1)
    const publishedRuntime = runtimeDefinitions[0]!
    const code = publishedRuntime.code as { encoding: string; data: string }
    expect(code.encoding).toBe('base64-utf16le')
    expect(Buffer.from(code.data, 'base64').toString('utf16le')).toBe(result.source)
    expect(publishedRuntime.staticFallback).toEqual(result.runtime.runtime.staticFallback)
    expect(JSON.stringify(published)).toContain(newId)
    expect(JSON.stringify(published)).toContain(png.toString('base64'))
    expect(nativeRecords(run)).toHaveLength(0)
    expect(readSaved(sourcePath)).toEqual(original)
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
