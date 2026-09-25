import { installHostToolTestTransport } from './helpers/g20HostTools'
import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

import { closeNativeEditor, readSaved, runtimeItem, saveStage, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor as enterStandaloneEditorFromLanding } from './lessonWorkspaceEntry'

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
    await installHostToolTestTransport(app, page)
    run = { app, page, runRoot, workspaceRoot: runRoot, projectPath, userData, pageErrors: [], consoleErrors: [] }
    page.on('pageerror', error => run!.pageErrors.push(error.message))
    await enterStandaloneEditorFromLanding(page)
    await expectBackgroundWindowsIsolated(app, true)
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await page.getByTestId(`node-item-${runtime.layerItemId}`).locator('.node-name').click()
    const result = await page.evaluate(async ({ runtimeId }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const { readCanonicalCourse, stageCourseBuild } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
      const { locateCourseLayer } = await load('/src/core/drivers/course/layerProperties.ts')
      const snapshot = async () => {
        const value = await readCanonicalCourse()
        return { document: value.model.project, assets: Object.fromEntries(Object.entries(value.model.resources.assets).map(([id, bytes]) => [id, Array.from(bytes as Uint8Array)])), history: value.undoDepth }
      }
      const before = await snapshot(), old = locateCourseLayer(before.document, runtimeId).item
      const source = `${old.runtime.source}\n// zero-model fallback transaction verification`
      const candidate = structuredClone(before.document)
      locateCourseLayer(candidate, runtimeId).item.runtime.source = source
      // Missing reference is still a real closure failure; a corrupt old fallback
      // alone is repairable from this candidate's successful host capture.
      const broken = structuredClone(candidate)
      locateCourseLayer(broken, runtimeId).item.runtime.staticFallback.assetId = 'missing-fallback-reference'
      const bad = await stageCourseBuild(broken)
      const rejected = bad.checked.status === 'failed' ? JSON.stringify(bad.logs) : ''
      await bad.stop()
      const afterRejected = await snapshot()
      const late = await stageCourseBuild(candidate)
      const afterPrepared = await snapshot()
      await late.stop()
      let lateError = ''
      try { await late.commit() } catch (error) { lateError = String(error) }
      const afterDiscard = await snapshot()
      const prepared = await stageCourseBuild(candidate)
      const receipt = await prepared.commit()
      const after = await snapshot()
      const captured = prepared.admission.captures.find((capture: { instanceId: string }) => capture.instanceId === runtimeId)
      if (!captured) throw new Error('No actual admitted Runtime fallback capture')
      await prepared.stop()
      return { before, afterRejected, afterPrepared, afterDiscard, after, rejected, lateError, receipt,
        runtime: locateCourseLayer(after.document, runtimeId).item, source, capturedFallback: captured.dataUrl,
        behaviorEvidence: prepared.admission.behaviorEvidence }
    }, { runtimeId: runtime.layerItemId })
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2))
    expect(result.rejected).not.toBe('')
    expect(result.afterRejected).toEqual(result.before)
    expect(result.afterPrepared).toEqual(result.before)
    expect(result.afterDiscard).toEqual(result.before)
    expect(result.lateError).not.toBe('')
    expect(result.receipt.status).toBe('applied')
    expect(result.after.history).toBe(result.before.history + 1)
    expect(result.runtime).toEqual({ ...runtime, runtime: { ...runtime.runtime, source: result.source, staticFallback: result.runtime.runtime.staticFallback } })
    const capturedFallback = Buffer.from(result.capturedFallback.split(',')[1], 'base64')
    await sharp(capturedFallback).raw().toBuffer()
    const newId = result.runtime.runtime.staticFallback.assetId
    expect(newId).not.toBe(oldId)
    expect(result.after.assets[newId]).toEqual(Array.from(capturedFallback))
    expect(Object.keys(result.after.assets).filter(id => !Object.hasOwn(result.before.assets, id))).toEqual([newId])
    const saved = await saveStage(run, 'committed')
    expect(runtimeItem(saved.project)).toEqual(result.runtime)
    expect(Array.from(saved.assetFiles[newId]!)).toEqual(Array.from(capturedFallback))
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    const undone = await saveStage(run, 'undone')
    expect(runtimeItem(undone.project)).toEqual(runtime)
    expect(undone.assetFiles[newId]).toBeUndefined()
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    const redone = await saveStage(run, 'redone')
    expect(runtimeItem(redone.project)).toEqual(result.runtime)
    expect(Array.from(redone.assetFiles[newId]!)).toEqual(Array.from(capturedFallback))
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
    expect(JSON.stringify(published)).toContain(capturedFallback.toString('base64'))
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
