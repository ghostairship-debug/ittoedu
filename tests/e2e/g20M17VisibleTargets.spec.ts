import { expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'
import { solidPng } from '../helpers/solidPng'

const root = resolve(__dirname, '../..')
const courseName = 'M17 可见目标.h5lesson'
const htmlName = 'visible-targets.html'

function fixtureHtml() {
  const png = solidPng(8, 8, [220, 70, 60]).toString('base64')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font:22px sans-serif}main{display:flex;gap:0;padding:32px;width:720px}
    #clip{width:260px;height:190px;overflow:hidden;flex:none}#picture{display:block;width:130%;height:180px;object-fit:cover}
    #right{width:340px;height:190px;padding:24px;background:#eef4ff;flex:none}#copy{margin:0}
  </style></head><body><main><div id="clip"><img id="picture" alt="clipped picture" src="data:image/png;base64,${png}"></div><section id="right"><p id="copy">Edit me</p></section></main></body></html>`
}

function makeCourse() {
  const project = createBlankCourseProject({ title: 'M17 可见目标', canvas: { width: 1280, height: 720 }, includeDefaultController: false, controls: 'none' })
  return new CourseV9Driver().serialize({ kind: 'course-v9', project, resources: { assets: {}, components: {} } })
}

async function closeBounded(app: ElectronApplication) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closeSelectionApp(app).then(() => 'closed' as const),
    new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 8_000) }),
  ])
  if (timer) clearTimeout(timer)
  if (result === 'timeout') { try { app.process()?.kill() } catch { /* preserve the original test failure */ } }
}

async function visibleTextHit(frame: Locator, text: Locator, image: Locator, clip: Locator) {
  await expect(frame).toBeVisible()
  await expect(text).toBeVisible()
  const frameBox = await frame.boundingBox()
  if (!frameBox) throw new Error('Imported Runtime has no visible iframe bounds')
  const local = await text.evaluate(element => {
    const doc = element.ownerDocument
    const viewport = doc.defaultView
    if (!viewport) throw new Error('Runtime iframe has no viewport')
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? ''
      const start = value.search(/\S/)
      if (start < 0) continue
      const end = value.length - (value.match(/\s*$/)?.[0].length ?? 0)
      const range = doc.createRange()
      range.setStart(node, start); range.setEnd(node, end)
      const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0)
      if (rect) return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: viewport.innerWidth, height: viewport.innerHeight } }
    }
    throw new Error('Visible text has no nonempty range')
  })
  const imageBounds = await image.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom } })
  const clipBounds = await clip.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom } })
  const localX = local.rect.x + local.rect.width / 2, localY = local.rect.y + local.rect.height / 2
  if (!(localX > clipBounds.right && localX < imageBounds.right && localY > imageBounds.y && localY < imageBounds.bottom)) {
    throw new Error('Text hit must overlap the image raw bounds in the container-clipped overflow area')
  }
  const point = { x: frameBox.x + localX * frameBox.width / local.viewport.width, y: frameBox.y + localY * frameBox.height / local.viewport.height }
  const visibleTag = await frame.evaluate((iframe, p) => {
    const doc = (iframe as HTMLIFrameElement).contentDocument
    if (!doc) throw new Error('Runtime iframe document is unavailable')
    const box = iframe.getBoundingClientRect()
    const view = doc.defaultView
    if (!view) throw new Error('Runtime iframe has no viewport')
    const localPoint = { x: (p.x - box.x) * view.innerWidth / box.width, y: (p.y - box.y) * view.innerHeight / box.height }
    return doc.elementFromPoint(localPoint.x, localPoint.y)?.closest('#right')?.id ?? ''
  }, point)
  expect(visibleTag).toBe('right')
  return point
}

test('M17: clipped image overflow cannot steal a visible text edit target', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(180_000)
  const base = join(root, 'output/g20/m17/visible-target-e2e')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, courseName), makeCourse())
  writeFileSync(join(workspace, htmlName), fixtureHtml())
  const replacement = join(directory, 'replacement.png')
  writeFileSync(replacement, solidPng(2, 2, [37, 99, 235]))
  const pngBytes = readFileSync(replacement)
  expect(pngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)

  const server = await selectionServer()
  let app: ElectronApplication | undefined
  const errors: string[] = []
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, workspace)
    const opened = await openSelectionFile(page, workspace, courseName)
    await expect(page.locator('.course-editor-frame:visible')).toHaveAttribute('data-document-id', opened.documentId)

    // One UI route: import this workspace file from its row context menu into the demo page.
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: htmlName, exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '作为互动页导入', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`来源：${htmlName}`)
    await dialog.getByLabel('导入目标页面').selectOption({ index: 0 })
    await expect(dialog.getByLabel('导入目标页面').locator('option:checked')).toContainText('演示页')
    await dialog.getByRole('button', { name: '导入', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByText('HTML 页面已导入到所选位置')).toBeVisible()

    // Install the picker spy after import so only dynamic image selection is counted.
    await app.evaluate(({ dialog: nativeDialog }, args) => {
      const global = globalThis as unknown as { m17FilePicker?: string; m17ImagePickerCalls?: number }
      global.m17FilePicker = args.replacement
      global.m17ImagePickerCalls = 0
      nativeDialog.showOpenDialog = async (...callArgs: unknown[]) => {
        const options = callArgs.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        if ((options?.properties ?? []).includes('openFile')) global.m17ImagePickerCalls = (global.m17ImagePickerCalls ?? 0) + 1
        return { canceled: false, filePaths: [global.m17FilePicker ?? ''] }
      }
    }, { replacement })

    const modes = page.getByRole('group', { name: '画布模式' })
    await modes.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const tryRun = page.getByTestId('course-try-run-host')
    await expect(tryRun).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
    const iframe = page.locator('.course-try-run-host iframe').first()
    const frame = iframe.contentFrame()
    await expect(frame.locator('#copy')).toHaveText('Edit me')
    await expect.poll(() => frame.locator('#picture').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(8)
    const clip = frame.locator('#clip'), image = frame.locator('#picture'), copy = frame.locator('#copy')

    await modes.getByRole('button', { name: '编辑状态', exact: true }).click()
    const liveBar = page.getByTestId('live-scene-bar')
    await expect(liveBar).toBeVisible()
    await expect(liveBar).toContainText('已停在试运行的这一刻')
    const point = await visibleTextHit(iframe, copy, image, clip)
    await page.mouse.dblclick(point.x, point.y)
    await expect(page.getByTestId('canvas-plain-text-editor')).toBeVisible()
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { m17ImagePickerCalls?: number }).m17ImagePickerCalls ?? -1)).toBe(0)

    await page.getByTestId('canvas-plain-text-editor').locator('input, textarea').press('Escape')
    const imageBox = await image.boundingBox()
    if (!imageBox) throw new Error('Visible image has no clickable bounds')
    await page.mouse.dblclick(imageBox.x + Math.min(imageBox.width, 260) / 2, imageBox.y + imageBox.height / 2)
    await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { m17ImagePickerCalls?: number }).m17ImagePickerCalls ?? -1)).toBe(1)
    expect(pngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    await server.close()
    if (app) await closeBounded(app)
  }
})
