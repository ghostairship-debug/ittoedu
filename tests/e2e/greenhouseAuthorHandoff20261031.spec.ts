/** Candidate-specific native handoff. The only substituted OS boundary is the
 * file picker's selected path. Author changes use the complete built App. */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(__dirname, '../..'), packagedExecutable = process.env.GUOLING_PACKAGED_EXECUTABLE
const producerPath = process.env.GUOLING_GREENHOUSE_PRODUCER
  ?? path.join(root, 'output/creation-execution-20261031/creation-migration-02/producer-result.json')
const TITLE = 'instance_rTBx4ZZHgs_11MIzDcB7_', DESCRIPTION = 'instance_wLlzFRNaNsHQq7w2U3Pxv'
const IMAGE = 'instance_d6769b34-cdf9-4dd4-960d-0f5ca1c4e6d6'
const TITLE_NOTE = ' · 教师接手', DESCRIPTION_NOTE = ' 请先比较两种用水方案。'
const object = (id: string) => `[data-component-instance="${id}"]:visible`
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function readAuthor(page: Page, documentId: string) {
  return page.evaluate(async id => {
    const snapshot = await window.desktopAPI.documents!.read(id)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the native greenhouse course')
    const digest = async (bytes: Uint8Array) => ({ bytes: bytes.byteLength,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('') })
    const model = snapshot.model
    return { project: model.project, resources: {
      assets: Object.fromEntries(await Promise.all(Object.entries(model.resources.assets).map(async ([key, bytes]) => [key, await digest(bytes)]))),
      components: Object.fromEntries(await Promise.all(Object.entries(model.resources.components).map(async ([key, files]) => [key,
        Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, bytes]) => [name, await digest(bytes)])))]))),
    }, revision: snapshot.revision, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
  }, documentId)
}
async function pointAt(page: Page, id: string) {
  const target = page.locator(object(id)); await expect(target).toBeVisible()
  const box = await target.boundingBox(); if (!box) throw new Error(`Native target has no geometry: ${id}`)
  return { x: box.x + Math.min(45, box.width / 2), y: box.y + Math.min(20, box.height / 2) }
}
async function appendText(page: Page, id: string, text: string) {
  const point = await pointAt(page, id); await page.mouse.dblclick(point.x, point.y)
  const overlay = page.locator('.text-edit-overlay[data-component-professional-editor]:visible')
  await expect(overlay).toHaveCount(1)
  const input = overlay.locator('[contenteditable="true"],textarea').first(); await expect(input).toBeVisible()
  await input.press('Control+End'); await page.keyboard.insertText(text); await input.press('Escape')
  await expect(overlay).toHaveCount(0)
}
async function shownImage(page: Page) {
  const image = page.locator(`${object(IMAGE)} img`).first(); await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const result = await image.evaluate(async element => {
    const image = element as HTMLImageElement, bytes = new Uint8Array(await (await fetch(image.currentSrc || image.src)).arrayBuffer())
    const rect = image.getBoundingClientRect()
    return { bytes: [...bytes], width: rect.width, height: rect.height, fit: getComputedStyle(image).objectFit }
  })
  return { sha256: sha(Uint8Array.from(result.bytes)), width: result.width, height: result.height, fit: result.fit }
}
async function closeApp(app: ElectronApplication | undefined) {
  if (!app) return
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app.close().catch(() => undefined)
}

test('the actual greenhouse candidate permits native text, image and geometry handoff and cold App reuse', async () => {
  test.setTimeout(180_000)
  const producer = JSON.parse(await fs.readFile(producerPath, 'utf8'))
  const original = path.join(producer.original, producer.document.relative), originalHtml = path.join(producer.original, producer.html.relative)
  expect(sha(await fs.readFile(original))).toBe(producer.document.sha256)
  expect(sha(await fs.readFile(originalHtml))).toBe(producer.html.sha256)
  const out = await fs.mkdtemp(path.join(root, 'output/creation-execution-20261031/greenhouse-author-handoff-'))
  const workspace = path.join(out, 'workspace'), profile = path.join(out, 'app-profile')
  await fs.mkdir(workspace); await fs.mkdir(profile)
  const glx = path.join(workspace, '社区温室-教师接手.glx')
  await fs.writeFile(glx, await fs.readFile(original), { flag: 'wx' })
  // A deterministic test image is read and decoded by the real media owner.
  // No asset ID or resource bytes are injected into the author document.
  const replacement = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="720" viewBox="0 0 800 720"><rect width="800" height="720" fill="#e7f0e9"/><path d="M80 180L400 60L720 180V640H80Z" fill="#eff9f3" stroke="#2c7050" stroke-width="18"/><path d="M400 70V640M80 300H720M80 460H720" stroke="#9cc8ac" stroke-width="12"/><rect x="235" y="240" width="330" height="330" rx="32" fill="#72bed0" stroke="#285f6b" stroke-width="12"/><path d="M250 350Q330 310 410 350T550 350" fill="none" stroke="#e5ffff" stroke-width="12"/><circle cx="630" cy="110" r="45" fill="#f5d46d"/></svg>')).png().toBuffer()
  const replacementFile = path.join(out, 'teacher-greenhouse.png'); await fs.writeFile(replacementFile, replacement, { flag: 'wx' })
  const errors: string[] = [], consoleErrors: string[] = [], remoteRequests: string[] = []
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const checkpoint = async (name: string) => { phase = name; await fs.appendFile(path.join(out, 'stages.jsonl'), JSON.stringify({ phase, at: Date.now() }) + '\n') }
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0',
      ...(packagedExecutable ? { PATH: 'C:\\Windows\\System32;C:\\Windows' } : {}) }); delete env.ELECTRON_RUN_AS_NODE
    const launch = async () => {
      app = await electron.launch({ cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
        ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
        args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${profile}`], env, timeout: 30_000 })
      const isPackaged = await app.evaluate(({ app }) => app.isPackaged); if (packagedExecutable) expect(isPackaged).toBe(true)
      page = await app.firstWindow(); page.setDefaultTimeout(15_000)
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
      await app.evaluate(({ BrowserWindow, dialog }, input) => {
        const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1600, 1100); window?.show(); window?.focus()
        ;(globalThis as any).greenhousePickerCalls = []
        dialog.showOpenDialog = async (...args: unknown[]) => {
          const options = args.at(-1) as { properties?: string[] }, directory = Boolean(options.properties?.includes('openDirectory'))
          ;(globalThis as any).greenhousePickerCalls.push({ directory })
          return { canceled: false, filePaths: [directory ? input.workspace : input.image] }
        }
      }, { workspace, image: replacementFile })
      await page.getByLabel('切换工作空间', { exact: true }).click()
      await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
      await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(glx), exact: true }).dblclick()
      const editor = page.locator('.course-editor-frame:visible'); await expect(editor).toBeVisible()
      const documentId = await editor.getAttribute('data-document-id'); expect(documentId).toBeTruthy()
      const openDeep = editor.getByRole('button', { name: '在编辑器中打开', exact: true }); if (await openDeep.count()) await openDeep.click()
      await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
      await expect(page.locator(object(TITLE))).toBeVisible()
      return { documentId: documentId!, pid: app.process().pid, isPackaged }
    }
    const initial = await launch(), read = () => readAuthor(page!, initial.documentId)
    const before = await read(); expect(before.project.rootIds).toHaveLength(2)
    await fs.writeFile(path.join(out, 'before-human.json'), JSON.stringify(before, null, 2))
    await checkpoint('native-text')
    await appendText(page!, TITLE, TITLE_NOTE); await appendText(page!, DESCRIPTION, DESCRIPTION_NOTE)
    const textEdited = await read()
    expect(JSON.stringify(textEdited.project.instances[TITLE]!.data)).toContain(TITLE_NOTE)
    expect(JSON.stringify(textEdited.project.instances[DESCRIPTION]!.data)).toContain(DESCRIPTION_NOTE)
    await checkpoint('native-layout-and-history')
    const point = await pointAt(page!, DESCRIPTION)
    await page!.mouse.move(point.x, point.y); await page!.mouse.down()
    await page!.mouse.move(point.x + 20, point.y + 8, { steps: 8 }); await page!.mouse.up()
    await expect.poll(async () => (await read()).project.instances[DESCRIPTION]!.frame).not.toEqual(textEdited.project.instances[DESCRIPTION]!.frame)
    const moved = await read(), chrome = page!.getByTestId('course-try-run-chrome')
    await chrome.getByRole('button', { name: '编辑', exact: true }).click(); await page!.keyboard.press('Control+z')
    await expect.poll(async () => (await read()).project.instances[DESCRIPTION]!.frame).toEqual(textEdited.project.instances[DESCRIPTION]!.frame)
    await page!.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await read()).project.instances[DESCRIPTION]!.frame).toEqual(moved.project.instances[DESCRIPTION]!.frame)
    await checkpoint('native-picture')
    const imagePoint = await pointAt(page!, IMAGE)
    await page!.mouse.click(imagePoint.x, imagePoint.y, { button: 'right' })
    await page!.getByRole('menu', { name: '对象操作' }).getByRole('menuitem', { name: '替换图片…', exact: true }).click()
    const oldAsset = (before.project.instances[IMAGE]!.data as any).assetId
    await expect.poll(async () => ((await read()).project.instances[IMAGE]!.data as any).assetId).not.toBe(oldAsset)
    const human = await read(), newAsset = (human.project.instances[IMAGE]!.data as any).assetId
    expect(human.resources.assets[newAsset]!.sha256).toBe(sha(replacement))
    const renderedImage = await shownImage(page!); expect(renderedImage.sha256).toBe(sha(replacement))
    expect(human.project.instances[IMAGE]!.frame).toEqual(before.project.instances[IMAGE]!.frame)
    // Only the exact human fields and one newly imported asset can differ.
    const restored = structuredClone(human.project); restored.revision = before.project.revision
    for (const id of [TITLE, DESCRIPTION]) restored.instances[id]!.data = structuredClone(before.project.instances[id]!.data)
    restored.instances[DESCRIPTION]!.frame = structuredClone(before.project.instances[DESCRIPTION]!.frame)
    restored.instances[IMAGE]!.data = structuredClone(before.project.instances[IMAGE]!.data)
    for (const id of Object.keys(restored.assets)) if (!Object.hasOwn(before.project.assets, id)) delete restored.assets[id]
    expect(restored).toEqual(before.project)
    expect(human.resources.components).toEqual(before.resources.components)
    for (const [id, fact] of Object.entries(before.resources.assets)) expect(human.resources.assets[id]).toEqual(fact)
    const pickerCalls = await app!.evaluate(() => (globalThis as any).greenhousePickerCalls)
    expect(pickerCalls.filter((call: { directory: boolean }) => !call.directory)).toHaveLength(1)
    await page!.screenshot({ path: path.join(out, '01-human-handoff.png') })
    await checkpoint('save-human-handoff')
    await chrome.getByRole('button', { name: '编辑', exact: true }).click(); await page!.keyboard.press('Control+s')
    await expect.poll(async () => (await read()).dirty).toBe(false)
    const saved = await read(); expect(saved.project).toEqual(human.project); expect(saved.resources).toEqual(human.resources)
    await fs.writeFile(path.join(out, 'handoff-before-ai.json'), JSON.stringify({ project: saved.project, resources: saved.resources }, null, 2))
    await closeApp(app); app = undefined
    await checkpoint('independent-app-cold-render')
    const cold = await launch(); expect(cold.pid).not.toBe(initial.pid)
    const reopened = await readAuthor(page!, cold.documentId)
    expect(reopened.project).toEqual(saved.project); expect(reopened.resources).toEqual(saved.resources); expect(reopened.dirty).toBe(false)
    await expect(page!.locator(object(TITLE))).toContainText(TITLE_NOTE)
    await expect(page!.locator(object(DESCRIPTION))).toContainText(DESCRIPTION_NOTE)
    const coldImage = await shownImage(page!); expect(coldImage.sha256).toBe(sha(replacement))
    expect(coldImage.width).toBeCloseTo(renderedImage.width, 0); expect(coldImage.height).toBeCloseTo(renderedImage.height, 0)
    await page!.screenshot({ path: path.join(out, '02-cold-human-handoff.png') })
    expect(sha(await fs.readFile(original))).toBe(producer.document.sha256); expect(sha(await fs.readFile(originalHtml))).toBe(producer.html.sha256)
    expect(errors).toEqual([]); expect(remoteRequests).toEqual([])
    const result = { status: 'ready-for-review-guided-ai-repair', sourceProducer: producerPath, sourceDocumentSha256: producer.document.sha256,
      document: glx, sha256: sha(await fs.readFile(glx)), authorEvidence: path.join(out, 'handoff-before-ai.json'),
      human: { titleId: TITLE, descriptionId: DESCRIPTION, imageId: IMAGE, titleNote: TITLE_NOTE, descriptionNote: DESCRIPTION_NOTE,
        imageAssetId: newAsset, replacementSha256: sha(replacement), descriptionFrame: saved.project.instances[DESCRIPTION]!.frame },
      completeApp: true, isPackaged: initial.isPackaged, originalFilesUnchanged: true, nativeText: true, nativeLayout: true,
      nativeImageImport: true, humanUndoRedo: true, savedAndColdRendered: true, initialPid: initial.pid, coldPid: cold.pid,
      modelRequests: 0, firstQualifiedAt: null, trialStartedAt: producer.trialStartedAt, finishedAt: Date.now(), errors, consoleErrors, remoteRequests }
    await fs.writeFile(path.join(out, 'human-handoff-result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ greenhouseHumanHandoff: out, status: result.status, modelRequests: 0 }))
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 }).catch(() => undefined)
    await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error), stack: error instanceof Error ? error.stack : '', errors, consoleErrors, remoteRequests }, null, 2))
    throw error
  } finally { await closeApp(app) }
})
