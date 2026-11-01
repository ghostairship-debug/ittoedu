import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareOasisAuthorHandoff, oasisDigest } from './oasisAuthorHandoffPrepare20261031.node'
import { OASIS_04_SHA256, OASIS_HANDOFF_DESCRIPTION, OASIS_HANDOFF_IMAGE, OASIS_HANDOFF_TEACHER_NOTE } from '../fixtures/creation/repairOasisAuthorHandoff'

const root = path.resolve(__dirname, '../..')
const original = process.env.GUOLING_OASIS_HANDOFF_BASELINE
  ?? path.join(root, 'output/creation-execution-20261031/oasis-final-04/无光绿洲_深海失联_修复版.glx')
const packagedExecutable = process.env.GUOLING_PACKAGED_EXECUTABLE
const descriptionSelector = '.og-intro .panel .stack > p.muted'

async function originalFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined
  await expect.poll(async () => {
    for (const frame of page.frames()) if (frame !== page.mainFrame() && !frame.isDetached()) {
      if (await frame.locator('#start-button').count().catch(() => 0)) { found = frame; return true }
    }
    return false
  }, { timeout: 20_000, message: 'The actual original-work program document must mount in the App' }).toBe(true)
  return found!
}

/** Use measured visible frame geometry. This is a real mouse gesture, not a DOM
 * click: iframe CSS scaling is not assumed to equal its layout viewport width. */
async function visiblePoint(frame: Frame, locator: Locator, at: { x?: number; y?: number } = {}) {
  await locator.scrollIntoViewIfNeeded()
  const local = await locator.evaluate(element => {
    const r = element.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  const host = await frame.frameElement(), bounds = await host.boundingBox(); await host.dispose()
  if (!bounds || !(local.width > 0 && local.height > 0 && local.viewportWidth > 0 && local.viewportHeight > 0))
    throw new Error('The original-work target has no visible frame geometry')
  const sx = bounds.width / local.viewportWidth, sy = bounds.height / local.viewportHeight
  const x = bounds.x + (local.x + (at.x ?? Math.min(35, local.width / 2))) * sx
  const y = bounds.y + (local.y + (at.y ?? Math.min(13, local.height / 2))) * sy
  return { x, y, sx, sy, local, host: bounds }
}
async function clickOriginal(page: Page, selector: string) {
  const frame = await originalFrame(page), target = frame.locator(selector)
  await expect(target).toBeVisible(); await expect(target).toBeEnabled()
  const point = await visiblePoint(frame, target)
  await page.mouse.click(point.x, point.y)
}
async function descriptionGeometry(frame: Frame) {
  return frame.locator(descriptionSelector).evaluate(element => {
    const rect = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect(), style = getComputedStyle(element)
    return { x: rect.x - parent.x, y: rect.y - parent.y, width: rect.width, height: rect.height,
      translate: style.translate, transform: style.transform, text: element.textContent }
  })
}
function expectSameDescriptionGeometry(actual: Awaited<ReturnType<typeof descriptionGeometry>>, expected: Awaited<ReturnType<typeof descriptionGeometry>>) {
  // The production owner composes author deltas with individual CSS translate;
  // transform may correctly remain `none`. Preserve the measured geometry gate.
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(actual[key], `Restored text ${key}`).toBeCloseTo(expected[key], 0)
  expect(actual.translate).toBe(expected.translate); expect(actual.text).toBe(expected.text)
}
async function decodedPictureComparison(frame: Frame) {
  const comparison = await frame.evaluate(async selector => {
    const encode = async (image: HTMLImageElement | null) => {
      if (!image) throw new Error('The actual scene image or original descent asset is missing')
      await image.decode()
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('The original-work picture did not decode')
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas image readback is unavailable')
      context.drawImage(image, 0, 0)
      return { src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight, png: canvas.toDataURL('image/png') }
    }
    // This consumes already allowed, decoded images. Unlike fetch(blob:), it
    // does not require or relax the content document's connect-src policy.
    return { actual: await encode(document.querySelector<HTMLImageElement>(selector)),
      reference: await encode(document.querySelector<HTMLImageElement>('#asset-descent')) }
  }, OASIS_HANDOFF_IMAGE)
  const digest = ({ png, ...value }: typeof comparison.actual) => ({ ...value,
    decodedPngSha256: oasisDigest(Buffer.from(png.slice(png.indexOf(',') + 1), 'base64')) })
  return { actual: digest(comparison.actual), reference: digest(comparison.reference),
    definition: 'SHA-256 of same-browser PNG encodings of the actual decoded image pixels; original encoded resource bytes are separately verified' }
}

/** Public DocumentHost read, with real resource-byte digests instead of a huge
 * JSON array transport. No renderer store or authoring state is written here. */
async function readAuthor(page: Page, documentId: string) {
  return page.evaluate(async id => {
    const snapshot = await window.desktopAPI.documents!.read(id)
    if (snapshot.model.kind !== 'course-v10') throw new Error('The active original-work document is not a course')
    const model = snapshot.model
    const digest = async (bytes: Uint8Array) => ({ bytes: bytes.byteLength,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('') })
    return { project: model.project, resources: {
      assets: Object.fromEntries(await Promise.all(Object.entries(model.resources.assets).map(async ([key, bytes]) => [key, await digest(bytes)]))),
      components: Object.fromEntries(await Promise.all(Object.entries(model.resources.components).map(async ([key, files]) => [key,
        Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, bytes]) => [name, await digest(bytes)])))]))),
    }, revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth, dirty: snapshot.dirty }
  }, documentId)
}
type AuthorSnapshot = Awaited<ReturnType<typeof readAuthor>>
const records = (snapshot: AuthorSnapshot, rootId: string) => snapshot.project.instances[rootId]!.authoring?.records ?? {}
const authoring = (snapshot: AuthorSnapshot, rootId: string) => snapshot.project.instances[rootId]!.authoring

async function recordFailure(page: Page, out: string, phase: string, error: unknown, consoleErrors: string[], errors: string[]) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined)
  const frames: unknown[] = []
  for (const frame of page.frames()) frames.push(await frame.evaluate(() => {
    const image = document.querySelector<HTMLElement>('[data-scene-key="intro-illustration"]')
    const description = document.querySelector<HTMLElement>('.og-intro .panel .stack > p.muted')
    const facts = (element: HTMLElement | null) => {
      if (!element) return null
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return { html: element.outerHTML.slice(0, 2500), rect: rect.toJSON(), display: style.display, visibility: style.visibility,
        filter: style.filter, transform: style.transform, translate: style.translate, opacity: style.opacity }
    }
    const resources = Object.getOwnPropertyNames(window).filter(name => name.startsWith('__guoling_parser_')).flatMap(name => {
      const lease = (window as any)[name]?.resourceLease
      if (!lease || typeof lease.reverse !== 'function') return []
      const inspect = (selector: string) => {
        const node = document.querySelector<HTMLImageElement>(selector), url = node?.currentSrc || node?.src
        return url ? { src: url, logicalReference: lease.reverse(url) ?? null, naturalWidth: node!.naturalWidth } : null
      }
      return [{ parser: name, sourceIds: Object.keys(lease.sources ?? {}), actual: inspect('[data-scene-key="intro-illustration"]'),
        hero: inspect('#asset-hero'), descent: inspect('#asset-descent') }]
    })
    return { url: location.href.slice(0, 240), viewport: { width: innerWidth, height: innerHeight },
      text: document.body?.innerText?.slice(0, 9000), image: facts(image), description: facts(description),
      focused: document.activeElement?.outerHTML.slice(0, 1200), resources, authorMarkers: document.querySelectorAll('[data-html-preview-edit-markers]').length }
  }).catch(failure => ({ unavailable: String(failure) })))
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error),
    stack: error instanceof Error ? error.stack : '', consoleErrors, errors, frames }, null, 2))
}

test('the original Oasis copy supports ordinary ProgramWorkspace text, image and geometry edits, remount and a cold AI handoff', async () => {
  test.setTimeout(240_000)
  const out = await fs.mkdtemp(path.join(root, 'output/creation-execution-20261031/oasis-author-handoff-'))
  const prepared = await prepareOasisAuthorHandoff({ original: path.resolve(original), out })
  const profile = path.join(out, 'app-profile'); await fs.mkdir(profile)
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const errors: string[] = [], consoleErrors: string[] = [], remoteRequests: string[] = [], checkpoints: unknown[] = []
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0',
      ...(packagedExecutable ? { PATH: 'C:\\Windows\\System32;C:\\Windows' } : {}) })
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${profile}`], env, timeout: 30_000 })
    const initialAppPid = app.process().pid
    const isPackaged = await app.evaluate(({ app }) => app.isPackaged)
    if (packagedExecutable) expect(isPackaged).toBe(true)
    page = await app.firstWindow(); page.setDefaultTimeout(18_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
    await app.evaluate(({ BrowserWindow, dialog }, input) => {
      const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1600, 1100); window?.show(); window?.focus()
      ;(globalThis as any).oasisFilePickerEvidence = []
      // Only the operating-system dialog selection is predetermined. The App
      // still calls its actual picker IPC, reads, decodes and imports the file.
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.at(-1) as { properties?: string[] }
        const directory = Boolean(options.properties?.includes('openDirectory'))
        ;(globalThis as any).oasisFilePickerEvidence.push({ directory, file: directory ? input.workspace : input.image })
        return { canceled: false, filePaths: [directory ? input.workspace : input.image] }
      }
    }, { workspace: prepared.workspace, image: prepared.replacementFile })
    phase = 'open-original-copy'
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(prepared.glx), exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible'), chrome = page.getByTestId('course-try-run-chrome')
    await expect(editor).toBeVisible(); await expect(page.getByTestId('program-workspace')).toBeVisible()
    const documentId = await editor.getAttribute('data-document-id'); expect(documentId).toBeTruthy()
    await editor.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    const before = await readAuthor(page, documentId!)
    expect(before.project.id).toBe(prepared.projectId); expect(before.project.id).not.toBe(prepared.originalProjectId)
    const preparedBaseline = JSON.parse(await fs.readFile(path.join(out, 'prepared-author-baseline.json'), 'utf8'))
    expect(before.project).toEqual(preparedBaseline.project); expect(before.resources).toEqual(preparedBaseline.resources)
    const checkpoint = async (name: string) => {
      const snapshot = await readAuthor(page!, documentId!)
      checkpoints.push({ name, revision: snapshot.revision, undoDepth: snapshot.undoDepth, authoring: authoring(snapshot, prepared.rootId) })
      await fs.writeFile(path.join(out, 'human-checkpoints.json'), JSON.stringify(checkpoints, null, 2))
      await page!.screenshot({ path: path.join(out, `${name}.png`) })
      return snapshot
    }
    phase = 'enter-first-act'
    await chrome.getByRole('button', { name: '试运行', exact: true }).click()
    await clickOriginal(page, '#start-button')
    let frame = await originalFrame(page)
    await expect(frame.locator('[data-action="power"]')).toBeVisible()
    await expect(frame.locator(descriptionSelector)).toHaveText(OASIS_HANDOFF_DESCRIPTION)
    await expect(frame.locator(OASIS_HANDOFF_IMAGE)).toBeVisible()
    await expect.poll(() => frame.locator(OASIS_HANDOFF_IMAGE).evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await checkpoint('01-original-scene-before-human-edit')
    await chrome.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(chrome.getByRole('button', { name: '编辑', exact: true })).toHaveAttribute('aria-pressed', 'true')
    frame = await originalFrame(page)
    await expect(frame.locator('[data-action="power"]')).toBeVisible()

    phase = 'ordinary-text-input'
    let point = await visiblePoint(frame, frame.locator(descriptionSelector))
    await page.mouse.dblclick(point.x, point.y)
    const input = page.getByRole('textbox', { name: '编辑此处文字', exact: true })
    await expect(input).toBeVisible()
    await input.press('Control+End'); await page.keyboard.insertText(OASIS_HANDOFF_TEACHER_NOTE); await input.press('Escape')
    await expect(page.locator('.text-edit-overlay')).toHaveCount(0)
    frame = await originalFrame(page)
    await expect(frame.locator(descriptionSelector)).toHaveText(OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    const textEdited = await checkpoint('02-ordinary-text-edit')
    const textRecords = Object.entries(records(textEdited, prepared.rootId)).filter(([, record]) => record.kind === 'text'
      && record.binding.baseline === OASIS_HANDOFF_DESCRIPTION && record.overrides.text === OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    expect(textRecords).toHaveLength(1)
    const textKey = textRecords[0]![0]
    expect(textEdited.project.instances[prepared.rootId]!.data).toEqual(before.project.instances[prepared.rootId]!.data)

    phase = 'ordinary-local-layout'
    point = await visiblePoint(frame, frame.locator(descriptionSelector))
    await page.mouse.move(point.x, point.y); await page.mouse.down()
    await page.mouse.move(point.x + 10, point.y + 6, { steps: 8 }); await page.mouse.up()
    await expect.poll(async () => records(await readAuthor(page!, documentId!), prepared.rootId)[textKey]?.overrides.geometry).toBeTruthy()
    const layoutEdited = await checkpoint('03-ordinary-local-layout')
    const geometry = records(layoutEdited, prepared.rootId)[textKey]!.overrides.geometry!
    expect(Math.abs(geometry.translateX ?? 0) + Math.abs(geometry.translateY ?? 0)).toBeGreaterThan(0)
    const movedPoint = await visiblePoint(await originalFrame(page), (await originalFrame(page)).locator(descriptionSelector))
    expect(movedPoint.x - point.x).toBeCloseTo(10, 0); expect(movedPoint.y - point.y).toBeCloseTo(6, 0)
    expect(layoutEdited.project.instances[prepared.rootId]!.data).toEqual(before.project.instances[prepared.rootId]!.data)
    // Real top-level shortcuts exercise the same human History owner used by the UI.
    await chrome.getByRole('button', { name: '编辑', exact: true }).click(); await page.keyboard.press('Control+z')
    await expect.poll(async () => authoring(await readAuthor(page!, documentId!), prepared.rootId)).toEqual(authoring(textEdited, prepared.rootId))
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => authoring(await readAuthor(page!, documentId!), prepared.rootId)).toEqual(authoring(layoutEdited, prepared.rootId))

    phase = 'ordinary-image-replacement'
    frame = await originalFrame(page)
    const image = frame.locator(OASIS_HANDOFF_IMAGE)
    const imageBefore = await image.evaluate(element => ({ src: (element as HTMLImageElement).src, width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height, objectFit: getComputedStyle(element).objectFit, filter: getComputedStyle(element).filter }))
    const pixelsBefore = await decodedPictureComparison(frame)
    expect(pixelsBefore.actual.decodedPngSha256).not.toBe(pixelsBefore.reference.decodedPngSha256)
    // The quiet left margin has no foreground text/plot. The image itself owns
    // its preserved gradient effect, so this ordinary pointer must select it.
    point = await visiblePoint(frame, image, { x: 10, y: 200 })
    await page.mouse.dblclick(point.x, point.y)
    const imagePanel = page.getByRole('dialog', { name: '图片简易编辑', exact: true })
    await expect(imagePanel).toBeVisible()
    await imagePanel.getByRole('button', { name: '替换图片', exact: true }).click()
    await expect.poll(async () => Object.values(records(await readAuthor(page!, documentId!), prepared.rootId))
      .filter(record => record.kind === 'image' && Boolean(record.overrides.src)).length).toBe(1)
    await imagePanel.getByRole('button', { name: '完成', exact: true }).click()
    const human = await checkpoint('04-ordinary-picture-replacement')
    const imageRecords = Object.entries(records(human, prepared.rootId)).filter(([, record]) => record.kind === 'image' && record.overrides.src)
    expect(imageRecords).toHaveLength(1)
    const [imageKey, imageRecord] = imageRecords[0]!
    const sourceBindings = (human.project.instances[prepared.rootId]!.data as { resourceBindings?: Record<string, string> }).resourceBindings ?? {}
    const baselineReference = imageRecord.binding.baseline
    expect(baselineReference).not.toMatch(/^blob:/)
    expect(before.resources.assets[sourceBindings[baselineReference] ?? baselineReference],
      'The saved image binding must identify an original managed resource, not its realm URL').toBeDefined()
    const imageAssetId = authoring(human, prepared.rootId)!.resourceBindings![imageRecord.overrides.src!]!
    expect(human.resources.assets[imageAssetId]?.sha256).toBe(prepared.replacementSha256)
    expect(records(human, prepared.rootId)[textKey]).toEqual(records(layoutEdited, prepared.rootId)[textKey])
    const imageAfter = await (await originalFrame(page)).locator(OASIS_HANDOFF_IMAGE).evaluate(element => ({ src: (element as HTMLImageElement).src,
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
      objectFit: getComputedStyle(element).objectFit, filter: getComputedStyle(element).filter }))
    expect(imageAfter.src).not.toBe(imageBefore.src); expect(imageAfter.width).toBe(imageBefore.width); expect(imageAfter.height).toBe(imageBefore.height)
    expect(imageAfter.objectFit).toBe('cover'); expect(imageAfter.filter).toBe(imageBefore.filter)
    expect(imageAfter.filter).toContain('oasis-intro-scene-shade')
    const pixelsAfter = await decodedPictureComparison(await originalFrame(page))
    expect(pixelsAfter.actual.decodedPngSha256).toBe(pixelsAfter.reference.decodedPngSha256)
    const projectedBefore = structuredClone(before.project), projectedHuman = structuredClone(human.project)
    projectedHuman.revision = projectedBefore.revision
    delete projectedHuman.instances[prepared.rootId]!.authoring
    // The picker imports a managed copy of bytes from the existing work. Only
    // those new asset entries and the two author records may change.
    for (const id of Object.keys(projectedHuman.assets)) if (!Object.hasOwn(projectedBefore.assets, id)) delete projectedHuman.assets[id]
    expect(projectedHuman).toEqual(projectedBefore)
    for (const [id, bytes] of Object.entries(before.resources.assets)) expect(human.resources.assets[id]).toEqual(bytes)
    expect(human.resources.components).toEqual(before.resources.components)
    expect(Object.keys(records(human, prepared.rootId))).toHaveLength(2)

    phase = 'actual-scene-remount'
    await chrome.getByRole('button', { name: '试运行', exact: true }).click()
    const descriptionBeforeRemount = await descriptionGeometry(await originalFrame(page))
    expect(descriptionBeforeRemount.translate).not.toBe('none')
    const firstMount = await (await originalFrame(page)).locator('.og-intro').getAttribute('data-instance')
    await clickOriginal(page, '#pause-button'); await clickOriginal(page, '#return-home-button')
    await expect((await originalFrame(page)).locator('.og-intro')).toHaveCount(0)
    await clickOriginal(page, '#continue-button')
    frame = await originalFrame(page)
    await expect(frame.locator(descriptionSelector)).toHaveText(OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    expect(await frame.locator('.og-intro').getAttribute('data-instance')).not.toBe(firstMount)
    const reboundImage = await frame.locator(OASIS_HANDOFF_IMAGE).evaluate(element => ({ src: (element as HTMLImageElement).src,
      filter: getComputedStyle(element).filter, naturalWidth: (element as HTMLImageElement).naturalWidth }))
    expect(reboundImage.src).toBe(imageAfter.src); expect(reboundImage.filter).toBe(imageAfter.filter); expect(reboundImage.naturalWidth).toBeGreaterThan(0)
    const reboundDescription = await descriptionGeometry(frame)
    expectSameDescriptionGeometry(reboundDescription, descriptionBeforeRemount)
    const remounted = await checkpoint('05-actual-scene-remount')
    expect(authoring(remounted, prepared.rootId)).toEqual(authoring(human, prepared.rootId))
    expect(remounted.project.instances[prepared.rootId]!.data).toEqual(human.project.instances[prepared.rootId]!.data)

    phase = 'save-human-handoff'
    await chrome.getByRole('button', { name: '编辑', exact: true }).click()
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await readAuthor(page!, documentId!)).dirty).toBe(false)
    const saved = await readAuthor(page, documentId!)
    expect(authoring(saved, prepared.rootId)).toEqual(authoring(human, prepared.rootId))
    const coldFile = path.join(out, 'cold-human-author-snapshot.json')
    const code = `import {DocumentHostService} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/main/workbench/DocumentHostService.ts')).href)};`
      + `import {oasisCourse,oasisResourceDigests} from ${JSON.stringify(pathToFileURL(path.join(root, 'tests/e2e/oasisAuthorHandoffPrepare20261031.node.ts')).href)};`
      + `import {writeFile} from 'node:fs/promises';const s=await new DocumentHostService(${JSON.stringify(path.join(out, 'cold-recovery'))}).open(${JSON.stringify(prepared.glx)});`
      + `const m=oasisCourse(s);await writeFile(${JSON.stringify(coldFile)},JSON.stringify({project:m.project,resources:oasisResourceDigests(m)}));`
    await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], { cwd: root, timeout: 45_000, maxBuffer: 1024 * 1024 })
    const cold = JSON.parse(await fs.readFile(coldFile, 'utf8'))
    expect(cold.project).toEqual(saved.project); expect(cold.resources).toEqual(saved.resources)
    const filePicker = await app.evaluate(() => (globalThis as any).oasisFilePickerEvidence)
    expect(filePicker.filter((value: { directory: boolean }) => !value.directory)).toHaveLength(1)

    // A saved author record can be byte-identical yet retain an ephemeral blob
    // baseline. Reopen the actual App in another process and consume the image,
    // text and geometry before admitting this file to a paid model experiment.
    phase = 'complete-app-cold-render'
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined)
    app = undefined
    app = await electron.launch({ cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${profile}`], env, timeout: 30_000 })
    const coldAppPid = app.process().pid; expect(coldAppPid).not.toBe(initialAppPid)
    page = await app.firstWindow(); page.setDefaultTimeout(18_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
    await app.evaluate(({ BrowserWindow, dialog }, workspace) => {
      const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1600, 1100); window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
    }, prepared.workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(prepared.glx), exact: true }).dblclick()
    const coldEditor = page.locator('.course-editor-frame:visible'), coldChrome = page.getByTestId('course-try-run-chrome')
    await expect(coldEditor).toBeVisible(); await expect(page.getByTestId('program-workspace')).toBeVisible()
    const coldDocumentId = await coldEditor.getAttribute('data-document-id'); expect(coldDocumentId).toBeTruthy()
    // Keep the same complete-editor viewport for geometric comparisons.
    const openDeep = coldEditor.getByRole('button', { name: '在编辑器中打开', exact: true })
    if (await openDeep.count()) await openDeep.click()
    await expect(coldEditor).toHaveAttribute('data-editor-mode', 'deep')
    const coldOpened = await readAuthor(page, coldDocumentId!)
    expect(coldOpened.project).toEqual(saved.project); expect(coldOpened.resources).toEqual(saved.resources)
    await coldChrome.getByRole('button', { name: '试运行', exact: true }).click()
    await clickOriginal(page, '#start-button')
    frame = await originalFrame(page)
    if (await frame.locator('#confirm-restart-button').isVisible()) await clickOriginal(page, '#confirm-restart-button')
    await expect(frame.locator(descriptionSelector)).toHaveText(OASIS_HANDOFF_DESCRIPTION + OASIS_HANDOFF_TEACHER_NOTE)
    await expect(frame.locator(OASIS_HANDOFF_IMAGE)).toBeVisible()
    let coldPixels: Awaited<ReturnType<typeof decodedPictureComparison>> | undefined
    await expect.poll(async () => {
      coldPixels = await decodedPictureComparison(frame)
      await fs.writeFile(path.join(out, 'cold-image-comparison.json'), JSON.stringify({ before: pixelsBefore, after: pixelsAfter, cold: coldPixels }, null, 2))
      return coldPixels.actual.decodedPngSha256
    }, { timeout: 8_000, intervals: [100, 250, 500, 1000], message: 'The cold App must paint the teacher replacement pixels, not a fresh original Blob URL' })
      .toBe(pixelsAfter.reference.decodedPngSha256)
    expect(coldPixels!.reference.decodedPngSha256).toBe(pixelsAfter.reference.decodedPngSha256)
    const coldGeometry = await descriptionGeometry(frame)
    expectSameDescriptionGeometry(coldGeometry, descriptionBeforeRemount)
    const coldImage = await frame.locator(OASIS_HANDOFF_IMAGE).evaluate(element => ({ src: (element as HTMLImageElement).src,
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
      filter: getComputedStyle(element).filter, objectFit: getComputedStyle(element).objectFit, naturalWidth: (element as HTMLImageElement).naturalWidth }))
    expect(coldImage.filter).toContain('oasis-intro-scene-shade'); expect(coldImage.objectFit).toBe('cover'); expect(coldImage.naturalWidth).toBeGreaterThan(0)
    expect(coldImage.width).toBeCloseTo(imageAfter.width, 0); expect(coldImage.height).toBeCloseTo(imageAfter.height, 0)
    await page.screenshot({ path: path.join(out, '06-cold-app-first-act.png') })
    await fs.writeFile(path.join(out, 'cold-app-render.json'), JSON.stringify({ initialAppPid, coldAppPid,
      originalEncodedPictureSha256: prepared.replacementSha256, decodedPixels: coldPixels,
      image: coldImage, geometryBeforeRemount: descriptionBeforeRemount, geometryAfterRemount: reboundDescription, geometryCold: coldGeometry }, null, 2))
    await fs.writeFile(path.join(out, 'handoff-before-ai.json'), JSON.stringify({ project: saved.project, resources: saved.resources }, null, 2))
    const expectedEdits = [{ old: 'advance(); schedule(); }, 2200);', new: 'advance(); schedule(); }, 3000);' },
      { old: '约每2秒推进一个。', new: '约每3秒推进一个。' }]
    const aiHandoff = { status: 'ready-for-real-built-in-ai', document: prepared.glx, sha256: oasisDigest(await fs.readFile(prepared.glx)),
      requiredModel: 'gpt-6.1-terra', requiredReasoning: 'xhigh', modulePath: prepared.modulePath, expectedEdits,
      humanTextKey: textKey, humanImageKey: imageKey, allAuthoringMustRemainExact: true,
      prompt: '请接手当前工作空间中的 oasis-human-handoff.glx。先读取当前内置 orchestrate-courseware 指引及局部增强最短路径。'
        + '使用正式 file.open、project.list/read 找到 intro.js。只把第一幕自动下潜推进由 2200 毫秒改为 3000 毫秒，并把该说明中“约每2秒推进一个。”改为“约每3秒推进一个。”；'
        + '使用 project.apply 的两处精确 edits，并在目标不唯一或旧值不符时停止。完整保留教师新增文字、替换图片、局部布局、instance.authoring、现有 SVG 图片渐变、所有资源、其余七模块、五截面、档案封存和章节解锁。'
        + '不重建页面，不更换素材，不委派，不调用其他模型，不联网，不运行 shell。最后通过 file.save 保存此副本并回读回执。',
      remainingAcceptance: ['real AI call and exact isolated module edit', 'AI history undo/redo preserving human edits', 'formal export and original first-act/adjacent-edge offline consumer'] }
    await fs.writeFile(path.join(out, 'ai-handoff-request.json'), JSON.stringify(aiHandoff, null, 2))
    expect(oasisDigest(await fs.readFile(original))).toBe(OASIS_04_SHA256)
    expect(errors).toEqual([]); expect(remoteRequests).toEqual([])
    const result = { status: 'zero-model-human-handoff-passed', original: prepared.original, originalHash: prepared.originalHash,
      originalUnchanged: true, fullBuiltApp: true, isPackaged, modelRequests: 0, projectId: prepared.projectId, rootId: prepared.rootId,
      realTextInput: true, realPictureImport: true, realPointerGeometry: true, geometryUndoRedo: true, realSceneRemount: true,
      formalSaveShortcut: true, independentProcessColdOpen: true, completeAppColdRender: true, initialAppPid, coldAppPid,
      exactModulesPreservedDuringHumanEdits: true,
      originalResourcesPreserved: true, importedBytesFromExistingWork: prepared.replacementSha256,
      image: { before: imageBefore, after: imageAfter, afterRemount: reboundImage, cold: coldImage,
        pixelsBefore, pixelsAfter, pixelsCold: coldPixels,
        controls: 'replace and transform overlay; no crop UI was offered' },
      geometry: { beforeRemount: descriptionBeforeRemount, afterRemount: reboundDescription, cold: coldGeometry },
      authorRecordKeys: [textKey, imageKey], filePickerBoundary: 'OS selection returns predetermined existing files; all product read/decode/import paths are real',
      filePicker, errors, consoleErrors, remoteRequests, handoff: aiHandoff,
      unverified: aiHandoff.remainingAcceptance }
    await fs.writeFile(path.join(out, 'human-handoff-result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ oasisOriginalHumanHandoff: out, glx: prepared.glx, status: result.status }))
  } catch (error) {
    if (page) await recordFailure(page, out, phase, error, consoleErrors, errors)
    else await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error), stack: error instanceof Error ? error.stack : '' }, null, 2))
    console.log(JSON.stringify({ oasisOriginalHumanHandoff: out, phase, failed: true }))
    throw error
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined) }
  }
})
