import { expect, test, type Browser, type Page } from '@playwright/test'
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform'
import { buildComponentSingleHtml } from '../../src/core/publish/componentPlatform/buildSingleHtml'
import { createEditableSharedExperiment, MIXING_DIAGRAM_SVG, SHARED_EXPERIMENT } from '../fixtures/creation/editableSharedExperiment'
import type { DocumentEvent, DocumentSnapshot } from '../../src/shared/workbench/document'

const root = resolve(__dirname, '../..')
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item))
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const course = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected a formal course document')
  return snapshot.model
}
const editorObject = (id: string) => `[data-component-instance="${id}"]`
const playerObject = (id: string) => `[data-component-object="${id}"]`

async function editorBundle(directory: string) {
  const result = await build({ stdin: {
    contents: 'import "./src/renderer/styles/variables.css";import "./src/renderer/styles/globals.css";export * from "./tests/helpers/currentFlowBrowserHarness"', resolveDir: root,
  }, bundle: true, platform: 'browser', format: 'iife', globalName: 'SharedEditor', write: false, outfile: join(directory, 'editor.js'),
  loader: { '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' })
  return `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(result.outputFiles.find(file => file.path.endsWith('.css'))!.text)};document.head.append(s)})();`
    + result.outputFiles.find(file => file.path.endsWith('.js'))!.text
}

/** Only transport and the file-picker boundary are fixtures. The Store, Bridge,
 * native selection/menu, image decoder/import, Source compiler and Session are real. */
async function mountEditor(page: Page, host: DocumentHostService, documentId: string, events: DocumentEvent[], directory: string, imagePath: string) {
  const compiler = host.compilation, api = host.internalAPI as any
  let picks = 0
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(20_000)
  await page.route('http://localhost/shared-experiment-editor', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><style>html,body,#editor{margin:0;width:100%;height:100%}#editor{position:relative}</style><div id="editor"></div>' }))
  await page.goto('http://localhost/shared-experiment-editor')
  await page.exposeFunction('sharedCompileComponent', (input: Parameters<typeof compiler.compile>[0]) => compiler.compile(input))
  await page.exposeFunction('sharedChooseImage', async () => {
    picks++
    return { path: imagePath, name: '教师替换示意图.png', mimeType: 'image/png', bytes: [...await fs.readFile(imagePath)] }
  })
  await page.exposeFunction('sharedDocumentCall', async (name: string, args: unknown[]) => {
    const result = name === 'bootstrapCourse' ? await host.internalAPI.read(documentId)
      : name === 'readAuthoringDrafts' ? await host.readAuthoringDrafts(args[0] as string)
        : name === 'writeAuthoringDrafts' ? await host.writeAuthoringDrafts(args[0] as string, args[1] as any)
          : name === 'clearAuthoringDrafts' ? await host.clearAuthoringDrafts(args[0] as string) : await api[name](...args)
    return json({ result, events: events.splice(0) })
  })
  await page.evaluate(await editorBundle(directory))
  await page.evaluate(async () => {
    const listeners = new Set<(event: any) => void>()
    const hydrate = (snapshot: any) => {
      if (snapshot?.model?.resources) for (const family of ['assets', 'components']) {
        const values = snapshot.model.resources[family]
        for (const [id, value] of Object.entries(values)) values[id] = family === 'assets' ? Uint8Array.from(value as number[])
          : Object.fromEntries(Object.entries(value as object).map(([name, bytes]) => [name, Uint8Array.from(bytes as number[])]))
      }
      return snapshot
    }
    const receive = (events: any[]) => events.forEach(event => { if (event.snapshot) hydrate(event.snapshot); listeners.forEach(listener => listener(event)) })
    const methods = ['list', 'read', 'dispatch', 'restore', 'save', 'bootstrapCourse', 'readAuthoringDrafts', 'writeAuthoringDrafts', 'clearAuthoringDrafts']
    const api = { ...Object.fromEntries(methods.map(name => [name, async (...args: any[]) => {
      const packet = await (window as any).sharedDocumentCall(name, args); receive(packet.events)
      return Array.isArray(packet.result) ? packet.result.map(hydrate) : hydrate(packet.result)
    }])), subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
    ;(window as any).sharedDocumentApi = api
    ;(window as any).desktopAPI = { ...(window as any).desktopAPI, compileComponent: (input: unknown) => (window as any).sharedCompileComponent(input) }
    ;(window as any).sharedHarness = await (window as any).SharedEditor.mountCurrentCourseBrowserHarness(document.getElementById('editor'), api, false, {
      selectImage: async () => { const selected = await (window as any).sharedChooseImage(); return { ...selected, bytes: Uint8Array.from(selected.bytes) } },
    })
  })
  return { get picks() { return picks } }
}

async function pointAt(page: Page, id: string) {
  const box = await page.locator(editorObject(id)).boundingBox()
  if (!box) throw new Error(`Missing native editor object ${id}`)
  return { x: box.x + Math.min(45, box.width / 2), y: box.y + Math.min(20, box.height / 2) }
}
async function appendNativeText(page: Page, id: string, text: string) {
  const point = await pointAt(page, id)
  await page.mouse.dblclick(point.x, point.y)
  await expect.poll(() => page.evaluate(() => Boolean((window as any).SharedEditor.useEditorStore.getState().slideContentEdit))).toBe(true)
  await page.keyboard.press('Control+End'); await page.keyboard.insertText(text); await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).SharedEditor.useEditorStore.getState().slideContentEdit))).toBe(false)
}

async function coldOpen(host: DocumentHostService, documentId: string, directory: string) {
  const filename = join(directory, 'editable-shared-handoff.glx'), output = join(directory, 'cold-author-snapshot.json')
  await host.saveToPath(documentId, filename)
  const source = `import {DocumentHostService} from ${JSON.stringify(pathToFileURL(join(root, 'src/main/workbench/DocumentHostService.ts')).href)};import {writeFile} from 'node:fs/promises';const s=await new DocumentHostService(${JSON.stringify(join(directory, 'cold-recovery'))}).open(${JSON.stringify(filename)});await writeFile(${JSON.stringify(output)},JSON.stringify(s,(_k,v)=>v instanceof Uint8Array?[...v]:v));`
  await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { cwd: root, timeout: 30_000 })
  const reopened = JSON.parse(await fs.readFile(output, 'utf8')) as DocumentSnapshot
  expect(reopened.model).toEqual(json((await host.internalAPI.read(documentId)).model))
  const model = course(reopened)
  model.resources.assets = Object.fromEntries(Object.entries(model.resources.assets).map(([id, bytes]) => [id, Uint8Array.from(bytes)]))
  model.resources.components = Object.fromEntries(Object.entries(model.resources.components).map(([id, files]) => [id,
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Uint8Array.from(bytes)]))]))
  return { filename, model }
}

async function offlinePlayer(browser: Browser, model: ReturnType<typeof course>, directory: string,
  compilation: DocumentHostService['compilation'], checkpoint: (name: string) => Promise<void>) {
  await checkpoint('publish-start')
  const published = await buildPublishedCourseV3({ project: model.project, assetBytes: model.resources.assets, componentFiles: model.resources.components },
    { compilation, singleHtmlMode: 'offline-portable' })
  expect(published.diagnostics.filter(item => item.code !== 'source-compile-warning')).toEqual([])
  expect(published.offlineComplete).toBe(true)
  await checkpoint('publish-prepared')
  const bundled = await build({ stdin: { contents: 'export * from "./src/player/componentPlatform/entry"', resolveDir: root }, bundle: true,
    platform: 'browser', format: 'iife', globalName: 'CoursewarePlayer', write: false, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const filename = join(directory, 'editable-shared-offline.html')
  await fs.writeFile(filename, buildComponentSingleHtml(published.payload, bundled.outputFiles[0]!.text))
  await checkpoint('offline-html-written')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true }), page = await context.newPage()
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(20_000)
  const remoteRequests: string[] = [], errors: string[] = []
  page.on('request', request => { if (/^https?:/i.test(request.url())) remoteRequests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(pathToFileURL(filename).href)
    await checkpoint('offline-page-loaded')
    await page.waitForFunction(() => Boolean((window as any).coursePlayer || (window as any).__coursePlaybackFailed), undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false)).toBe(false)
    await checkpoint('offline-player-ready')
    return { context, page, filename, remoteRequests, errors }
  } catch (error) {
    await fs.writeFile(join(directory, 'offline-start-failure.json'), JSON.stringify({ error: String(error), remoteRequests, errors }, null, 2))
    await page.screenshot({ path: join(directory, 'offline-start-failure.png'), timeout: 5_000 }).catch(() => undefined)
    await context.close().catch(() => undefined)
    throw error
  }
}

/** The published Slide fits the whole work with a CSS scale. Record both the
 * automation locator's point and the displayed pixel point, then use a real
 * pointer only after the top document and content document agree on its hit. */
async function clickProgramButton(page: Page, instanceId: string, label: string, directory: string) {
  const iframe = page.locator(`${playerObject(instanceId)} iframe`), button = iframe.contentFrame().getByRole('button', { name: label, exact: true })
  await expect(button).toBeVisible(); await expect(button).toBeEnabled()
  const locatorBox = await button.boundingBox()
  if (!locatorBox) throw new Error(`Button has no automation geometry: ${label}`)
  const frame = await iframe.evaluate(element => {
    const frame = element as HTMLIFrameElement, rect = frame.getBoundingClientRect()
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, offsetWidth: frame.offsetWidth, offsetHeight: frame.offsetHeight,
      clientWidth: frame.clientWidth, clientHeight: frame.clientHeight, clientLeft: frame.clientLeft, clientTop: frame.clientTop }
  })
  const content = await button.evaluate(element => {
    const rect = element.getBoundingClientRect(), view = element.ownerDocument.defaultView!
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: view.innerWidth, height: view.innerHeight },
      pointerEvents: view.getComputedStyle(element).pointerEvents }
  })
  const scale = { x: frame.rect.width / frame.offsetWidth, y: frame.rect.height / frame.offsetHeight }
  const local = { x: content.rect.x + content.rect.width / 2, y: content.rect.y + content.rect.height / 2 }
  const visible = { x: frame.rect.x + (frame.clientLeft + local.x) * scale.x, y: frame.rect.y + (frame.clientTop + local.y) * scale.y }
  const automation = { x: locatorBox.x + locatorBox.width / 2, y: locatorBox.y + locatorBox.height / 2 }
  const automationLocal = { x: (automation.x - frame.rect.x) / scale.x - frame.clientLeft,
    y: (automation.y - frame.rect.y) / scale.y - frame.clientTop }
  const topHit = await iframe.evaluate((element, point) => {
    const hit = element.ownerDocument.elementFromPoint(point.x, point.y)
    return { ownFrame: hit === element, tag: hit?.tagName, id: hit?.id, classes: typeof hit?.className === 'string' ? hit.className : null }
  }, visible)
  const contentHits = await button.evaluate((element, points) => {
    const hit = (point: { x: number; y: number }) => {
      const target = element.ownerDocument.elementFromPoint(point.x, point.y)
      return { ownButton: target === element || Boolean(target && element.contains(target)), tag: target?.tagName,
        classes: typeof target?.className === 'string' ? target.className : null, text: target?.textContent?.trim().slice(0, 90) }
    }
    return { visible: hit(points.local), automation: hit(points.automationLocal) }
  }, { local, automationLocal })
  const fact = { instanceId, label, locatorBox, frame, content, scale, visible, automation, topHit, contentHits,
    classification: topHit.ownFrame && contentHits.visible.ownButton && !contentHits.automation.ownButton ? 'automation-frame-coordinate-mismatch'
      : topHit.ownFrame && contentHits.visible.ownButton ? 'visible-button-hit' : 'visible-button-obstructed' }
  await fs.appendFile(join(directory, 'frame-pointer-evidence.jsonl'), JSON.stringify(fact) + '\n')
  expect(topHit.ownFrame, JSON.stringify(fact)).toBe(true)
  expect(contentHits.visible.ownButton, JSON.stringify(fact)).toBe(true)
  await page.mouse.click(visible.x, visible.y)
}

test('two native roots support real human handoff, one shared Source edit, history, cold save and offline shared runtime', async ({ browser }, info) => {
  test.setTimeout(180_000)
  const directory = info.outputPath('editable-shared-experiment'); await fs.mkdir(directory, { recursive: true })
  let phase = 'start'
  const checkpoint = async (name: string) => { phase = name; await fs.appendFile(join(directory, 'phase-checkpoints.jsonl'), JSON.stringify({ phase, at: new Date().toISOString() }) + '\n') }
  const model = await createEditableSharedExperiment(), host = new DocumentHostService(join(directory, 'recovery'))
  const initial = await host.internalAPI.create(model, 'editable-shared-original.glx'), events: DocumentEvent[] = [], errors: string[] = []
  await host.saveToPath(initial.documentId, join(directory, 'editable-shared-original.glx'))
  const off = host.subscribeEvents(event => events.push(event)), page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  const replacement = await sharp(Buffer.from(MIXING_DIAGRAM_SVG.replace('#103145', '#231c40').replace('混合带示意', '教师重绘示意'))).png().toBuffer()
  const replacementPath = join(directory, 'teacher-replacement.png'); await fs.writeFile(replacementPath, replacement)
  const runId = 'shared-experiment-logic'
  try {
    const picker = await mountEditor(page, host, initial.documentId, events, directory, replacementPath)
    await checkpoint('editor-mounted')
    await expect(page.locator(editorObject(SHARED_EXPERIMENT.title))).toBeVisible()
    await appendNativeText(page, SHARED_EXPERIMENT.title, ' · 教师接手')
    await appendNativeText(page, SHARED_EXPERIMENT.description, ' 请比较两种方案。')
    const beforeMove = course(await host.internalAPI.read(initial.documentId)).project.instances[SHARED_EXPERIMENT.description]!.frame
    const position = await pointAt(page, SHARED_EXPERIMENT.description)
    await page.mouse.move(position.x, position.y); await page.mouse.down(); await page.mouse.move(position.x + 36, position.y + 12, { steps: 8 }); await page.mouse.up()
    await expect.poll(async () => course(await host.internalAPI.read(initial.documentId)).project.instances[SHARED_EXPERIMENT.description]!.frame).not.toEqual(beforeMove)
    const imagePoint = await pointAt(page, SHARED_EXPERIMENT.image)
    await page.mouse.click(imagePoint.x, imagePoint.y, { button: 'right' })
    await page.getByRole('menu', { name: '对象操作' }).getByRole('menuitem', { name: '替换图片…', exact: true }).click()
    await expect.poll(async () => (course(await host.internalAPI.read(initial.documentId)).project.instances[SHARED_EXPERIMENT.image]!.data as any).assetId).not.toBe(SHARED_EXPERIMENT.imageAsset)
    expect(picker.picks).toBe(1)
    const human = await host.internalAPI.read(initial.documentId), humanModel = course(human)
    const replacementId = (humanModel.project.instances[SHARED_EXPERIMENT.image]!.data as any).assetId as string
    expect(digest(humanModel.resources.assets[replacementId]!)).toBe(digest(replacement))
    expect(humanModel.project.instances[SHARED_EXPERIMENT.image]!.frame).toEqual(model.project.instances[SHARED_EXPERIMENT.image]!.frame)
    expect(JSON.stringify(humanModel.project.instances[SHARED_EXPERIMENT.title]!.data)).toContain('教师接手')
    expect(JSON.stringify(humanModel.project.instances[SHARED_EXPERIMENT.description]!.data)).toContain('请比较两种方案')
    await checkpoint('native-handoff-complete')

    // A deterministic official tool consumer isolates the writer contract. The
    // separate live-model acceptance does not get substituted by this fixture.
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    const file = componentProjectFiles(humanModel.project, humanModel.resources).find(item => item.kind === 'source'
      && item.binding?.kind === 'definition-source' && item.binding.definitionId === SHARED_EXPERIMENT.modelDefinition && !item.authorSource?.dependencyId)!
    expect(file).toBeDefined()
    expect(await host.tools.execute(runId, 'read-model', { name: 'project.read', input: { path: file.path } })).toMatchObject({ kind: 'read', data: { content: expect.stringContaining('energyScale: 100') } })
    expect(await host.tools.execute(runId, 'adjust-model', { name: 'project.apply', input: { path: file.path,
      edits: [{ old: 'energyScale: 100', new: 'energyScale: 120' }] } })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const after = await host.internalAPI.read(initial.documentId), afterModel = course(after)
    expect(after.undoDepth).toBe(human.undoDepth + 1)
    expect(afterModel.project.instances).toEqual(humanModel.project.instances)
    expect(afterModel.project.assets).toEqual(humanModel.project.assets)
    expect(afterModel.resources).toEqual(humanModel.resources)
    for (const [id, definition] of Object.entries(humanModel.project.definitions)) if (id !== SHARED_EXPERIMENT.modelDefinition)
      expect(afterModel.project.definitions[id]).toEqual(definition)
    await page.evaluate(id => (window as any).sharedDocumentApi.read(id), initial.documentId)
    await page.evaluate(id => (window as any).SharedEditor.useEditorStore.getState().courseBridge.undo(id), initial.documentId)
    const undone = course(await host.internalAPI.read(initial.documentId))
    expect(undone.project.definitions[SHARED_EXPERIMENT.modelDefinition]).toEqual(humanModel.project.definitions[SHARED_EXPERIMENT.modelDefinition])
    expect(undone.project.instances).toEqual(humanModel.project.instances); expect(undone.resources).toEqual(humanModel.resources)
    await page.evaluate(id => (window as any).SharedEditor.useEditorStore.getState().courseBridge.redo(id), initial.documentId)
    expect(course(await host.internalAPI.read(initial.documentId)).project.definitions).toEqual(afterModel.project.definitions)
    await page.screenshot({ path: join(directory, 'native-handoff.png') })
    const saved = await coldOpen(host, initial.documentId, directory)
    await checkpoint('shared-source-history-and-cold-save-complete')
    expect(await page.evaluate(() => (window as any).sharedHarness.errors)).toEqual([])
    expect(errors).toEqual([])

    const output = await offlinePlayer(browser, saved.model, directory, host.compilation, checkpoint)
    try {
      const player = output.page, experiment = player.locator(`${playerObject(SHARED_EXPERIMENT.experiment)} iframe`).contentFrame()
      const result = player.locator(`${playerObject(SHARED_EXPERIMENT.result)} iframe`).contentFrame()
      await expect(player.locator(playerObject(SHARED_EXPERIMENT.title))).toContainText('教师接手')
      await expect(experiment.getByRole('slider', { name: '海水比例' })).toHaveValue('35')
      expect(await player.evaluate(id => (window as any).coursePlayer.go(id), SHARED_EXPERIMENT.resultScene)).toBe(false)
      expect(await player.evaluate(() => (window as any).coursePlayer.navigation.readLocation())).toBe(SHARED_EXPERIMENT.experimentScene)
      expect(await player.evaluate(key => (window as any).coursePlayer.runtime.getState(key), SHARED_EXPERIMENT.resultKey)).toBeUndefined()
      await checkpoint('offline-initial-guard-verified')
      const slider = experiment.getByRole('slider', { name: '海水比例' })
      await slider.focus(); await slider.press('Home')
      for (let i = 0; i < 20; i++) await slider.press('ArrowRight')
      await clickProgramButton(player, SHARED_EXPERIMENT.experiment, '运行实验', directory)
      await expect(experiment.locator('[data-result]')).toContainText('能量比较指数 77')
      await clickProgramButton(player, SHARED_EXPERIMENT.experiment, '查看相邻结论', directory)
      await expect(result.locator('[data-energy]')).toHaveText('77')
      await expect(result.locator('[data-trial]')).toHaveText('第 1 次实验的真实结果')
      await checkpoint('offline-first-shared-result')
      await expect(player.locator(playerObject('sample-footer'))).toBeVisible()
      await player.evaluate(id => { (window as any).sharedResultFrame = document.querySelector(`[data-component-object="${id}"] iframe`) }, SHARED_EXPERIMENT.result)
      await player.screenshot({ path: join(directory, 'offline-shared-result.png') })
      await clickProgramButton(player, SHARED_EXPERIMENT.result, '返回实验', directory)
      await expect(slider).toHaveValue('20')
      await slider.focus(); await slider.press('Home')
      for (let i = 0; i < 50; i++) await slider.press('ArrowRight')
      await clickProgramButton(player, SHARED_EXPERIMENT.experiment, '运行实验', directory)
      await clickProgramButton(player, SHARED_EXPERIMENT.experiment, '查看相邻结论', directory)
      await expect(result.locator('[data-energy]')).toHaveText('120')
      await expect(result.locator('[data-trial]')).toHaveText('第 2 次实验的真实结果')
      expect(await player.evaluate(id => (window as any).sharedResultFrame === document.querySelector(`[data-component-object="${id}"] iframe`), SHARED_EXPERIMENT.result)).toBe(true)
      await checkpoint('offline-subsequent-shared-result')
      await clickProgramButton(player, SHARED_EXPERIMENT.result, '返回实验', directory)
      await clickProgramButton(player, SHARED_EXPERIMENT.experiment, '重播本幕', directory)
      await expect(slider).toHaveValue('35')
      await expect(experiment.getByRole('button', { name: '查看相邻结论', exact: true })).toBeDisabled()
      expect(await player.evaluate(key => (window as any).coursePlayer.runtime.getState(key), SHARED_EXPERIMENT.resultKey)).toBeNull()
      expect(await player.evaluate(key => (window as any).coursePlayer.runtime.getState(key), SHARED_EXPERIMENT.completionKey)).toBe(false)
      expect(await player.evaluate(id => (window as any).coursePlayer.go(id), SHARED_EXPERIMENT.resultScene)).toBe(false)
      await player.screenshot({ path: join(directory, 'offline-replayed.png') })
      expect(output.remoteRequests).toEqual([]); expect(output.errors).toEqual([])
      await checkpoint('offline-replay-verified')
      await fs.writeFile(join(directory, 'consumer-evidence.json'), JSON.stringify({
        sample: saved.filename, sampleSha256: digest(await fs.readFile(saved.filename)), offlineHtml: output.filename,
        offlineHtmlSha256: digest(await fs.readFile(output.filename)), rootCount: saved.model.project.rootIds.length,
        authoring: { nativeTitle: true, nativeDescription: true, pointerLayout: true, nativeImageMenu: true,
          originalAssetSha256: digest(model.resources.assets[SHARED_EXPERIMENT.imageAsset]!), replacementAssetSha256: digest(replacement),
          pickerCalls: picker.picks, sharedModulePath: file.path, isolatedAgentSourceEdit: true, oneStepUndoRedo: true, newProcessColdOpen: true },
        runtime: { guardBeforeComplete: 'blocked', firstResult: 77, subsequentResult: 120, resultFrameRetained: true,
          returnPreserves: true, replayResets: true, authorSnapshotHasNoLearnerResult: true, remoteRequests: output.remoteRequests, errors: output.errors },
      }, null, 2))
    } catch (error) {
      await fs.writeFile(join(directory, 'offline-consumer-failure.json'), JSON.stringify({ phase, error: String(error),
        stack: error instanceof Error ? error.stack : undefined, remoteRequests: output.remoteRequests, errors: output.errors }, null, 2))
      await output.page.screenshot({ path: join(directory, 'offline-consumer-failure.png'), timeout: 5_000 }).catch(() => undefined)
      throw error
    } finally { await output.context.close().catch(() => undefined) }
  } catch (error) {
    await fs.writeFile(join(directory, 'failure-phase.json'), JSON.stringify({ phase, error: String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2))
    throw error
  } finally {
    await host.tools.stop(runId).catch(() => undefined); off()
    await page.evaluate(() => (window as any).sharedHarness?.dispose()).catch(() => undefined); await page.close().catch(() => undefined)
  }
})
