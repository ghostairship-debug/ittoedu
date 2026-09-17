import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { currentHostMotionEvidenceSchema } from '../../src/renderer/authoring/generation/currentHostMotionObservation'
import { closeNativeEditor, FIXTURE_IDS, selectLayer, writeNativeLesson, type NativeRun } from './r18NativeAuthoringFixture'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const productRoot = resolve(__dirname, '..', '..')
const runtimeSource = `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
  const root=document.createElement('div');root.setAttribute('aria-label','Current formal rotating cube');
  Object.assign(root.style,{position:'absolute',inset:'0',display:'flex',alignItems:'center',justifyContent:'center',perspective:'450px',pointerEvents:'none'});
  const style=document.createElement('style');style.textContent='@keyframes formalCubeMotion {from{transform:rotateX(-22deg) rotateY(25deg)}to{transform:rotateX(338deg) rotateY(745deg)}}';
  const cube=document.createElement('div');Object.assign(cube.style,{position:'relative',width:'110px',height:'110px',transformStyle:'preserve-3d',animation:'formalCubeMotion 4.2s linear infinite'});
  const faces=[['#c026d3','translateZ(55px)'],['#f97316','rotateY(180deg) translateZ(55px)'],['#e11d48','rotateY(90deg) translateZ(55px)'],['#ea580c','rotateY(-90deg) translateZ(55px)'],['#f59e0b','rotateX(90deg) translateZ(55px)'],['#db2777','rotateX(-90deg) translateZ(55px)']];
  faces.forEach(([color,transform])=>{const face=document.createElement('div');Object.assign(face.style,{position:'absolute',inset:'0',background:color,transform,border:'2px solid #ffffff',boxSizing:'border-box',backfaceVisibility:'hidden'});cube.append(face)});
  root.append(style,cube);ctx.dom.overlay.append(root);return {destroy(){root.remove()}};
}})`

async function imageFacts(content: string) {
  const image = await sharp(Buffer.from(content, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let blue = 0, cube = 0
  const bounds = { left: image.info.width, top: image.info.height, right: -1, bottom: -1 }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const [r, g, b, a] = image.data.subarray(offset, offset + 4)
    if (a! < 240) continue
    if (b! > 150 && b! > r! * 1.5 && b! > g! * 1.15) blue++
    // The original red artwork also appears in the viewport. Cube motion is
    // measured separately inside its formal frame below.
    if (r! > 150 && b! > 150 && g! < 90) {
      cube++
      const x = (offset / 4) % image.info.width, y = Math.floor(offset / 4 / image.info.width)
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y)
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y)
    }
  }
  return { width: image.info.width, height: image.info.height, blue, magenta: cube, magentaBounds: cube ? bounds : null }
}

test('post-commit motion uses the actual final host for all three frames', async () => {
  test.setTimeout(150_000)
  const runRoot = join(productRoot, 'output', 'r18-current-host-motion-observation', new Date().toISOString().replace(/[:.]/g, '-'))
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
    // Enter only the landing page; never replace an already opened editor or recovery draft.
    const startupMore = page.locator('.lesson-workspace-more > summary')
    const startupEditor = page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true })
    const startupRecovery = page.getByRole('alertdialog', { name: '发现未完成的本地恢复副本', exact: true })
    await expect.poll(async () => await startupEditor.isVisible() || await startupMore.isVisible() || await startupRecovery.isVisible()).toBe(true)
    if (!await startupEditor.isVisible() && await startupMore.isVisible() && !await startupRecovery.isVisible()) {
      await startupMore.click()
      await page.getByRole('button', { name: '新建独立课件', exact: true }).click()
    }
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const professional = page.getByRole('button', { name: '专业', exact: true })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
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
          captureRects.push({ ...rect }); return window.desktopAPI.captureAuthoringObservation!(rect)
        } }, owner)
      const items = (document: any) => document.surfaces.flatMap((surface: any) => surface.type === 'slide' ? surface.scenes.flatMap((scene: any) => scene.layerItems) : [])
      const original = items(project).find((item: any) => item.layerItemId === ids.square)
      const rect = (element: Element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height } }
      try {
        const before = await bridge.capture({ workspace, scope: 'selection', purpose: 'local-edit', intent: 'edit',
          instruction: 'Replace the blue square with a rolling cube and preserve the current frame.', applyPolicy: 'auto', expectedResult: 'auto', materials: [], catalogPackages: [] })
        const destination = before.destinations.find((value: any) => value.kind === 'update' && value.target.itemId === ids.square)
        const scope = before.destinations.find((value: any) => value.kind === 'create' && value.scope.ownerKey === destination?.target.ownerKey)
        if (!destination || !scope) throw new Error('Formal observation did not expose replacement destinations')
        const prepared = await useEditorStore.getState().prepareGenerationCandidate(before, {
          version: 1, requestId: before.requestId, candidateId: crypto.randomUUID(), summary: 'Canonical rolling cube replacement',
          steps: [
            { id: 'runtime', tool: 'runtime.insert', carrier: 'runtime', destination: scope,
              input: { label: 'Current formal rotating cube', runtime: { protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true,
                renderMode: 'dom', source, content: { values: {} }, assets: {}, staticFallback: { assetId: ids.asset, coverage: 'scene' } } } },
            { id: 'replace', tool: 'selection.replace', carrier: 'native', destination,
              input: { replacementItemId: { $result: { stepId: 'runtime', kind: 'item-id', index: 0 } } } },
          ],
        })
        const committed = useEditorStore.getState().applyGenerationCandidate(prepared.previewId)
        if (committed.status !== 'committed') throw new Error('Runtime replacement did not commit')
        const atCommit = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState()))
        const historyAtCommit = useEditorStore.getState().slideBackend.getSession().history.past.length
        const after = await bridge.captureNext(before, committed.receipt, prepared.behaviorEvidence)
        const current = selectActiveCourseProjectDocument(useEditorStore.getState()), replacement = items(current).find((item: any) => item.kind === 'runtime')
        const mounted = document.querySelector(`[data-slide-layer-item="${replacement?.layerItemId}"]`), slide = mounted?.closest('.slide-published-adapter')
        if (!mounted || !slide) throw new Error('The final Runtime has no mounted Published layer')
        return { before, after, receipt: committed.receipt, originalFrame: original.frame, replacement,
          originalStillInProject: items(current).some((item: any) => item.layerItemId === ids.square),
          originalStillMounted: !!document.querySelector(`[data-slide-layer-item="${ids.square}"]`),
          mountedRect: rect(mounted), slideRect: rect(slide), captureRects,
          slideSize: { width: (slide as HTMLElement).offsetWidth, height: (slide as HTMLElement).offsetHeight },
          historyAtCommit, historyAfterObservation: useEditorStore.getState().slideBackend.getSession().history.past.length,
          documentUnchangedByObservation: JSON.stringify(current) === JSON.stringify(atCommit),
          admissionFrameCount: prepared.behaviorEvidence?.reduce((sum: number, item: any) => sum + item.frames.length, 0) ?? 0 }
      } finally { bridge.dispose() }
    }, { ids: FIXTURE_IDS, source: runtimeSource })
    const resource = (path: string, request = result.after) => {
      const file = request.resourceFiles.find((value: any) => value.path === path)
      if (!file) throw new Error(`Missing observation resource: ${path}`)
      return file
    }
    const motion = currentHostMotionEvidenceSchema.parse(JSON.parse(resource('observation/motion/current-host.json').content))
    const beforeFrame = resource('observation/current-frame.png', result.before).content as string
    const frames = motion.frames.map(frame => {
      const file = result.after.observation.files.find((value: any) => value.fileId === frame.fileId)
      return { ...frame, content: resource(file.relativePath).content as string }
    })
    const facts = await Promise.all(frames.map(frame => imageFacts(frame.content)))
    const beforeFacts = await imageFacts(beforeFrame)
    writeFileSync(join(runRoot, 'before.png'), Buffer.from(beforeFrame, 'base64'))
    frames.forEach((frame, index) => writeFileSync(join(runRoot, `frame-${index}.png`), Buffer.from(frame.content, 'base64')))
    const capture = result.captureRects[1]!, sx = facts[0]!.width / capture.width, sy = facts[0]!.height / capture.height
    const crop = { left: Math.ceil((result.mountedRect.x - capture.x) * sx), top: Math.ceil((result.mountedRect.y - capture.y) * sy),
      width: Math.floor(result.mountedRect.width * sx), height: Math.floor(result.mountedRect.height * sy) }
    const cropped = await Promise.all(frames.map(frame => sharp(Buffer.from(frame.content, 'base64')).extract(crop).ensureAlpha().raw().toBuffer()))
    const changedPixels = cropped.slice(1).map(bytes => {
      let changed = 0
      for (let i = 0; i < bytes.length; i += 4) if (Math.abs(bytes[i]! - cropped[0]![i]!) + Math.abs(bytes[i + 1]! - cropped[0]![i + 1]!) + Math.abs(bytes[i + 2]! - cropped[0]![i + 2]!) > 40) changed++
      return changed
    })
    const filmstripInputs = await Promise.all(frames.map(frame => sharp(Buffer.from(frame.content, 'base64')).extract(crop).png().toBuffer()))
    await sharp({ create: { width: crop.width * 3, height: crop.height, channels: 4, background: '#ffffff' } })
      .composite(filmstripInputs.map((input, index) => ({ input, left: index * crop.width, top: 0 }))).png().toFile(join(runRoot, 'formal-cube-filmstrip.png'))
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ evidence: 'Real Electron Main and isolated renderer; no native model calls or extra observation retries.',
      ...result, motion, frameFacts: facts, beforeFacts, changedPixels, crop }, null, 2))
    await page.screenshot({ path: join(runRoot, 'after-ui.png') })
    expect(result.replacement.frame).toEqual(result.originalFrame)
    expect(result.originalStillInProject).toBe(false); expect(result.originalStillMounted).toBe(false)
    expect(motion.instances.some(instance => instance.instanceId === result.replacement.layerItemId)).toBe(true)
    expect(motion.documentRevision).toBe(result.receipt.afterRevision)
    expect(result.captureRects).toHaveLength(4)
    result.captureRects.slice(1).forEach(rect => expect(rect).toEqual(motion.captureRect))
    expect(beforeFacts.blue).toBeGreaterThan(1000)
    facts.forEach(fact => expect(fact.blue).toBeLessThan(beforeFacts.blue * 0.02))
    changedPixels.forEach(changed => expect(changed).toBeGreaterThan(1000))
    expect(result.admissionFrameCount).toBeGreaterThan(0)
    expect(result.after.observation.files.some((file: any) => file.fileId.startsWith('dynamic-frame-'))).toBe(false)
    expect(JSON.parse(resource('observation/dynamic/behavior.json').content).imageFeedback).toBe('current-formal-host-only')
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
