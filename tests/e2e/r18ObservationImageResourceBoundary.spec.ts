import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { showEditorPanel } from './r18NativeAuthoringFixture'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { closeNativeEditor, FIXTURE_IDS, readSaved, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor as enterStandaloneEditorFromLanding } from './lessonWorkspaceEntry'

const productRoot = resolve(__dirname, '..', '..')

const corruptAssetId = 'corrupt-runtime-fallback'
const runtimeId = 'corrupt-runtime-fallback-host'
const svgRuntimeId = 'svg-runtime-fallback-host'
const svgAssetId = 'valid-svg-runtime-fallback'
// The 444-byte fallback committed in the real recovered OpenCode workspace.
const repairedCubeSvg = Buffer.from('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMjAiIGhlaWdodD0iMjIwIiB2aWV3Qm94PSIwIDAgMjIwIDIyMCI+PHBvbHlnb24gcG9pbnRzPSIxMTAsMjYgMTkxLDY5IDExMCwxMTIgMjksNjkiIGZpbGw9IiM2MGE1ZmEiLz48cG9seWdvbiBwb2ludHM9IjI5LDY5IDExMCwxMTIgMTEwLDE5OSAyOSwxNTYiIGZpbGw9IiMyNTYzZWIiLz48cG9seWdvbiBwb2ludHM9IjExMCwxMTIgMTkxLDY5IDE5MSwxNTYgMTEwLDE5OSIgZmlsbD0iIzFkNGVkOCIvPjxwYXRoIGQ9Ik0xMTAgMjZMMTkxIDY5TDE5MSAxNTZMMTEwIDE5OUwyOSAxNTZMMjkgNjlaIE0yOSA2OUwxMTAgMTEyTDE5MSA2OSBNMTEwIDExMlYxOTkiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzEwMmE2OCIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+', 'base64')

const runtimeSource = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
  const root=document.createElement('div');root.dataset.corruptObservationRuntime='mounted';
  root.textContent='Runtime remains mounted while its fallback is diagnosed';
  root.style.cssText='position:absolute;inset:0;display:grid;place-items:center;background:#0f766e;color:white;font:600 22px sans-serif';
  ctx.dom.overlay.append(root);return {destroy(){root.remove()}};
}})`

async function greenImage(): Promise<Buffer> {
  return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#16a34a"/><circle cx="72" cy="80" r="28" fill="white"/><path d="M116 80l23 23 52-52" fill="none" stroke="white" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>')).png().toBuffer()
}

async function greenPixels(content: string): Promise<number> {
  const image = await sharp(Buffer.from(content, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let green = 0
  for (let index = 0; index < image.data.length; index += 4) {
    const [red, value, blue, alpha] = image.data.subarray(index, index + 4)
    if (alpha! > 240 && value! > 110 && value! > red! * 1.4 && value! > blue! * 1.25) green += 1
  }
  return green
}

async function bluePixels(content: string): Promise<number> {
  const image = await sharp(Buffer.from(content, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let blue = 0
  for (let index = 0; index < image.data.length; index += 4) {
    const [red, green, value, alpha] = image.data.subarray(index, index + 4)
    if (alpha! > 240 && value! > 120 && value! > red! * 1.35 && value! > green! * 1.15) blue += 1
  }
  return blue
}

test('a corrupt current Runtime fallback is diagnosed without becoming a native image attachment', async () => {
  test.setTimeout(150_000)
  const runRoot = join(productRoot, 'output', 'r18-observation-image-resource-boundary', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  const damaged = readFileSync(join(productRoot, 'tests', 'fixtures', 'image-validation', 'malformed-pixel-data.png'))
  expect(damaged.byteLength).toBe(1100)
  await writeNativeLesson(projectPath)
  const archive = readSaved(projectPath)
  const project = archive.project, surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('Expected the native Slide fixture')
  const green = await greenImage()
  expect(repairedCubeSvg.byteLength).toBe(444)
  project.assets[FIXTURE_IDS.asset] = {
    ...project.assets[FIXTURE_IDS.asset]!, filename: 'green-original.jpg', byteLength: green.byteLength, width: 240, height: 160,
  }
  project.assets[corruptAssetId] = {
    id: corruptAssetId, kind: 'image', filename: 'malformed-pixel-data.png', path: `assets/${corruptAssetId}.png`, mimeType: 'image/png',
    byteLength: damaged.byteLength, width: 220, height: 220,
  }
  project.assets[svgAssetId] = {
    id: svgAssetId, kind: 'image', filename: 'rolling-cube-fallback-repaired.svg', path: `assets/${svgAssetId}.svg`, mimeType: 'image/svg+xml',
    byteLength: repairedCubeSvg.byteLength, width: 220, height: 220,
  }
  const runtime: RuntimeLayerItem = {
    kind: 'runtime', layerItemId: runtimeId, label: 'Corrupt fallback observation boundary', order: 3,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    frame: { mode: 'absolute', x: 650, y: 265, width: 330, height: 220 },
    runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom', source: runtimeSource,
      content: { values: {} }, assets: {}, staticFallback: { assetId: corruptAssetId, coverage: 'scene' } },
  }
  surface.scenes[0]!.layerItems.push(runtime)
  const svgRuntime: RuntimeLayerItem = {
    ...runtime, layerItemId: svgRuntimeId, label: 'SVG fallback observation boundary', order: 4,
    frame: { mode: 'absolute', x: 310, y: 265, width: 220, height: 220 },
    runtime: { ...runtime.runtime, staticFallback: { assetId: svgAssetId, coverage: 'scene' } },
  }
  surface.scenes[0]!.layerItems.push(svgRuntime)
  const assetFiles = { ...archive.assetFiles, [FIXTURE_IDS.asset]: new Uint8Array(green), [corruptAssetId]: new Uint8Array(damaged),
    [svgAssetId]: new Uint8Array(repairedCubeSvg) }
  writeFileSync(projectPath, createCourseProjectArchive({ project, assetFiles, componentFiles: archive.componentFiles }))
  const fixtureProject = structuredClone(project)
  const fixtureDamagedBase64 = Buffer.from(damaged).toString('base64')

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
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await showEditorPanel(page, '属性与素材')
    await page.getByRole('tab', { name: '图层', exact: true }).click()
    await expect(page.locator('[data-corrupt-observation-runtime="mounted"]').first()).toBeVisible()

    const result = await page.evaluate(async ({ badAssetId, vectorAssetId, mountedRuntimeId }) => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const { useEditorStore, selectActiveCourseProjectDocument, selectMediaAssetFiles } = await load('/src/renderer/store/editorStore.ts')
      const { createCurrentObservation, readCanonicalCourse } = await load('/tests/e2e/helpers/g20AuthoringObservation.ts')
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      if (!document || !state.projectPath) throw new Error('The fixture did not open as a saved project')
      state.selectNodes([mountedRuntimeId])
      const beforeDocument = JSON.stringify(document)
      const beforeHistory = (await readCanonicalCourse()).undoDepth
      const observer = createCurrentObservation()
      try {
        const request = await observer.capture({ intent: 'discuss' })
        const structureFile = request.resourceFiles?.find((file: any) => file.path === 'observation/current-structure.json')
        const diagnosticsFile = request.resourceFiles?.find((file: any) => file.path === 'observation/images/original-image-diagnostics.json')
        if (!structureFile || !diagnosticsFile) throw new Error('Missing original-image diagnostic evidence')
        const structure = JSON.parse(structureFile.content)
        const valid = structure.originalImages.find((entry: any) => entry.assetId !== badAssetId && entry.assetId !== vectorAssetId)
        const vectorOriginal = structure.originalImages.find((entry: any) => entry.assetId === vectorAssetId)
        const vectorDerived = structure.derivedImages?.find((entry: any) => entry.assetId === vectorAssetId)
        if (!valid || !vectorOriginal || !vectorDerived) throw new Error('Missing valid original-image or derived SVG mapping')
        const validResource = request.resourceFiles?.find((file: any) => file.path === valid.relativePath)
        const vectorOriginalResource = request.resourceFiles?.find((file: any) => file.path === vectorOriginal.relativePath)
        const vectorDerivedResource = request.resourceFiles?.find((file: any) => file.path === vectorDerived.relativePath)
        const currentFrame = request.resourceFiles?.find((file: any) => file.path === 'observation/current-frame.png')
        const now = useEditorStore.getState()
        const afterDocument = selectActiveCourseProjectDocument(now)
        const bytes = selectMediaAssetFiles(now)[badAssetId]
        return {
          observationFiles: request.observation?.files,
          originalImages: structure.originalImages,
          unavailableOriginalImages: structure.unavailableOriginalImages,
          diagnostics: JSON.parse(diagnosticsFile.content),
          validResource: validResource ? { path: validResource.path, role: validResource.role, mediaType: validResource.mediaType, content: validResource.content } : null,
          vectorOriginal,
          vectorDerived,
          vectorOriginalResource: vectorOriginalResource ? { path: vectorOriginalResource.path, role: vectorOriginalResource.role, mediaType: vectorOriginalResource.mediaType, content: vectorOriginalResource.content } : null,
          vectorDerivedResource: vectorDerivedResource ? { path: vectorDerivedResource.path, role: vectorDerivedResource.role, mediaType: vectorDerivedResource.mediaType, content: vectorDerivedResource.content } : null,
          currentFrame: currentFrame ? { path: currentFrame.path, role: currentFrame.role, mediaType: currentFrame.mediaType, byteLength: currentFrame.content.length } : null,
          promptRequest: request,
          documentUnchanged: JSON.stringify(afterDocument) === beforeDocument,
          historyUnchanged: (await readCanonicalCourse()).undoDepth === beforeHistory,
          badBytesUnchanged: bytes ? btoa(String.fromCharCode(...bytes)) : null,
        }
      } finally { observer.dispose() }
    }, { badAssetId: corruptAssetId, vectorAssetId: svgAssetId, mountedRuntimeId: runtimeId })

    const { promptRequest: actualObservation, ...observationResult } = result
    // Retired: the three embedded CLI prompt encodings are no longer product surfaces.
    // These assertions retain actual original/derived byte and current-host capture boundaries.
    const originalImageFiles = observationResult.observationFiles.filter((file: any) => file.role === 'image' && file.fileId.startsWith('original-image-'))
    expect(observationResult.unavailableOriginalImages).toMatchObject([{ assetId: corruptAssetId, code: 'image-decode-failed' }])
    expect(observationResult.diagnostics).toMatchObject({ unavailableOriginalImages: [{ assetId: corruptAssetId, code: 'image-decode-failed' }], unavailableDerivedImages: [] })
    expect(observationResult.originalImages.some((entry: any) => entry.assetId === corruptAssetId)).toBe(false)
    expect(originalImageFiles).toHaveLength(1)
    expect(observationResult.originalImages).toHaveLength(2)
    const directOriginal = observationResult.originalImages.find((entry: any) => entry.attachmentRole === 'image')
    expect(originalImageFiles[0]).toMatchObject({ fileId: directOriginal.fileId, relativePath: directOriginal.relativePath })
    expect(observationResult.validResource).toMatchObject({ role: 'image', mediaType: 'image/png', path: expect.stringMatching(/^observation\/images\/\d+\.png$/) })
    expect(await greenPixels(observationResult.validResource!.content)).toBeGreaterThan(10_000)
    expect(observationResult.vectorOriginal).toMatchObject({ assetId: svgAssetId, mediaType: 'image/svg+xml', attachmentRole: 'structure',
      relativePath: expect.stringMatching(/^observation\/original-images\/\d+\.svg$/) })
    expect(observationResult.vectorOriginalResource).toMatchObject({ role: 'structure', mediaType: 'image/svg+xml', content: repairedCubeSvg.toString('base64') })
    expect(observationResult.vectorDerived).toMatchObject({ assetId: svgAssetId, mediaType: 'image/png', derivedFrom: observationResult.vectorOriginal.fileId,
      relativePath: expect.stringMatching(/^observation\/images\/\d+\.png$/) })
    expect(observationResult.vectorDerivedResource).toMatchObject({ role: 'image', mediaType: 'image/png' })
    expect(await bluePixels(observationResult.vectorDerivedResource!.content)).toBeGreaterThan(10_000)
    expect(observationResult.observationFiles.some((file: any) => file.role === 'image' && file.mediaType === 'image/svg+xml')).toBe(false)
    expect(observationResult.currentFrame).toMatchObject({ path: 'observation/current-frame.png', role: 'image', mediaType: 'image/png' })
    expect(observationResult.currentFrame!.byteLength).toBeGreaterThan(1_000)
    expect(observationResult.documentUnchanged).toBe(true)
    expect(observationResult.historyUnchanged).toBe(true)
    expect(observationResult.badBytesUnchanged).toBe(fixtureDamagedBase64)
    expect(run.pageErrors).toEqual([])
    expect(readSaved(projectPath).project).toEqual(fixtureProject)
    writeFileSync(join(runRoot, 'observation-result.json'), JSON.stringify({ ...observationResult, observation: actualObservation, modelCalls: 0, source: 'real Electron Main and Chromium renderer; no native CLI turn' }, null, 2))
    await page.screenshot({ path: join(runRoot, 'observation.png') })
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
