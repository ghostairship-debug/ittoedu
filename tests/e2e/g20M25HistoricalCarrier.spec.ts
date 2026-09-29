import { _electron as electron, expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { solidPng } from '../helpers/solidPng'

const root = resolve(__dirname, '../..')
const repaired = join(root, 'output/g20/b19/光合作用互动课件-受管载体修复.h5lesson')
const name = '光合作用互动课件-受管载体修复.h5lesson'
const runtimeIds = ['html_6de91a987dc26c08b905d060', 'html_dd3948438e8f61bf0440e039', 'html_8cefa3eb11c5a68912d85f5d']
const nativeImageId = 'image-493cd899-cacd-4787-9b6c-5413bd4da214'

async function textHit(iframe: Locator, target: Locator) {
  await expect(iframe).toBeVisible()
  await expect(target).toBeVisible()
  const frame = await iframe.boundingBox()
  if (!frame) throw new Error('Runtime iframe has no bounds')
  const local = await target.evaluate(element => {
    const doc = element.ownerDocument
    const view = doc.defaultView
    if (!view) throw new Error('Runtime iframe has no viewport')
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.textContent ?? ''
      const start = value.search(/\S/)
      if (start < 0) continue
      const end = value.length - (value.match(/\s*$/)?.[0].length ?? 0)
      const range = doc.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0)
      if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: view.innerWidth, height: view.innerHeight }
    }
    throw new Error('Visible heading has no text range')
  })
  return { x: frame.x + local.x * frame.width / local.width, y: frame.y + local.y * frame.height / local.height }
}

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {})
}

function archive(path: string) { return openCourseProjectArchive(new Uint8Array(readFileSync(path))) }

test('M25-T04 repaired historical HTML course supports light edits, undo, reopen and offline interaction', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.skip(!existsSync(repaired), 'The named historical repair artifact is required for this acceptance test.')
  test.setTimeout(240_000)
  const base = join(root, 'output/g20/b19/historical-carrier-e2e')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const coursePath = join(workspace, name)
  copyFileSync(repaired, coursePath)
  const exportPath = join(directory, '光合作用互动课件-修复导出.html')
  const imagePath = join(directory, '替换叶片图.png')
  const imageBytes = solidPng(24, 24, [37, 99, 235])
  writeFileSync(imagePath, imageBytes)
  const original = archive(coursePath)
  const slide = original.project.surfaces.find(surface => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('Historical course has no Slide surface')
  expect(slide.scenes).toHaveLength(3)
  expect(slide.scenes.flatMap(scene => scene.layerItems).filter(item => item.kind === 'runtime').map(item => item.layerItemId)).toEqual(runtimeIds)
  expect(slide.scenes[1]?.layerItems.some(item => item.layerItemId === nativeImageId && item.kind === 'native')).toBe(true)
  const pageErrors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? paths.workspace : paths.image] }
      }
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath })
    }, { workspace, image: imagePath, exportPath })
    await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toHaveAttribute('data-document-id', /.+/)
    const documentId = await editor.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course did not bind a DocumentSession')
    const frame = page.locator('.published-authoring-host iframe[data-html-document-runtime="true"]').first()
    await expect(frame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const content = frame.contentFrame()
    await expect(content.getByRole('heading', { name: '植物靠什么长大？' })).toBeVisible()
    const point = await textHit(frame, content.getByRole('heading', { name: '植物靠什么长大？' }))
    await page.mouse.dblclick(point.x, point.y)
    const textEditor = page.getByTestId('canvas-plain-text-editor').locator('input, textarea')
    await expect(textEditor).toBeVisible()
    await textEditor.fill('植物靠什么长大？课堂复习')
    await textEditor.press('Enter')
    await expect(content.getByRole('heading', { name: '植物靠什么长大？课堂复习' })).toBeVisible()

    const sceneCards = page.getByRole('navigation', { name: '场景与页面导航' }).locator('li[data-kind="slide"]')
    await sceneCards.nth(1).locator('button.bottom-scene-card__main').click()
    const secondFrame = page.locator('.published-authoring-host iframe[data-html-document-runtime="true"]').first()
    await expect(secondFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })

    const stage = await page.locator('.canvas-stage-stack').boundingBox()
    if (!stage) throw new Error('Canvas stage has no visible bounds')
    const imagePoint = { x: stage.x + (57 + 548 / 2) * stage.width / 1280, y: stage.y + (207 + 411 / 2) * stage.height / 720 }
    await page.mouse.click(imagePoint.x, imagePoint.y, { button: 'right' })
    await page.getByRole('menu', { name: '对象操作' }).getByRole('menuitem', { name: '替换图片…', exact: true }).click()
    const imageAsset = async () => page.evaluate(async id => {
      const snapshot = await window.desktopAPI.documents!.read(id)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Expected Course V9')
      const surface = snapshot.model.project.surfaces.find(candidate => candidate.type === 'slide')
      const item = surface?.type === 'slide' ? surface.scenes[1]?.layerItems.find(entry => entry.layerItemId === 'image-493cd899-cacd-4787-9b6c-5413bd4da214') : null
      if (!item || item.kind !== 'native' || item.content.nativeType !== 'image') throw new Error('Expected historical Native image')
      return { assetId: item.content.data.assetId, revision: snapshot.revision, dirty: snapshot.dirty }
    }, documentId)
    await expect.poll(async () => (await imageAsset()).assetId).not.toBe('asset_821876ce-0bcb-4b00-ad11-fef0eb6d437d')
    const replaced = await imageAsset()
    await page.keyboard.press('Control+Z')
    await expect.poll(async () => (await imageAsset()).assetId).toBe('asset_821876ce-0bcb-4b00-ad11-fef0eb6d437d')
    await page.keyboard.press('Control+Shift+Z')
    await expect.poll(async () => (await imageAsset()).assetId).toBe(replaced.assetId)

    await page.getByLabel('常用工具').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await imageAsset()).dirty).toBe(false)
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    await expect(editor).toHaveAttribute('data-document-id', /.+/)
    const reopenedId = await editor.getAttribute('data-document-id')
    expect(reopenedId).not.toBe(documentId)
    const reopened = archive(coursePath)
    const savedSlide = reopened.project.surfaces.find(surface => surface.type === 'slide')
    if (!savedSlide || savedSlide.type !== 'slide') throw new Error('Saved course lost Slide')
    expect(savedSlide.scenes.map(scene => scene.id)).toEqual(slide.scenes.map(scene => scene.id))
    for (const id of runtimeIds) {
      const item = savedSlide.scenes.flatMap(scene => scene.layerItems).find(item => item.layerItemId === id)
      if (!item || item.kind !== 'runtime') throw new Error(`Saved runtime missing: ${id}`)
      expect(unpackHtmlDocumentRuntimeSource(item.runtime.source)).not.toBeNull()
    }
    expect(JSON.stringify(savedSlide.scenes[0]!.layerItems.find(item => item.layerItemId === runtimeIds[0])!)).toContain('植物靠什么长大？课堂复习')
    expect(savedSlide.scenes[1]!.layerItems.find(item => item.layerItemId === nativeImageId)).toMatchObject({ kind: 'native', content: { data: { assetId: replaced.assetId } } })
    expect(reopened.assetFiles[replaced.assetId]).toEqual(imageBytes)
    await expect(page.locator('.published-authoring-host iframe[data-html-document-runtime="true"]').first().contentFrame()
      .getByRole('heading', { name: '植物靠什么长大？课堂复习' })).toBeVisible()

    await sceneCards.nth(1).locator('button.bottom-scene-card__main').click()
    const modes = page.getByRole('group', { name: '画布模式' })
    await modes.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const tryRun = page.getByTestId('course-try-run-host')
    await expect(tryRun).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
    const runningFrame = page.locator('.course-try-run-host iframe[data-html-document-runtime="true"]').first()
    await expect(runningFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const reveal = runningFrame.contentFrame().getByRole('button', { name: '显示答案' })
    await reveal.click()
    await expect(reveal).toHaveAttribute('aria-expanded', 'true')
    await reveal.click()
    await expect(reveal).toHaveAttribute('aria-expanded', 'false')
    await reveal.click()
    await expect(reveal).toHaveAttribute('aria-expanded', 'true')
    await modes.getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByTestId('live-scene-bar').getByRole('button', { name: '回到编辑画面', exact: true }).click()

    await page.getByTestId('light-export-menu-trigger').click()
    await page.getByTestId('light-export-single-html').click()
    await page.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect.poll(() => existsSync(exportPath)).toBe(true)
    const exported = readFileSync(exportPath, 'utf8')
    expect(exported).toContain('植物靠什么长大？课堂复习')
    const opened = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, path) => {
      const preview = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      await preview.loadFile(path)
    }, exportPath)
    const preview = await opened
    const exportedFrame = preview.locator('iframe[data-html-document-runtime="true"]').first()
    await expect(exportedFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const exportedPage = exportedFrame.contentFrame()
    await expect(exportedPage.getByRole('heading', { name: '植物靠什么长大？课堂复习' })).toBeVisible()
    await exportedPage.locator('.opt').nth(1).click()
    await exportedPage.locator('#p1-reason').fill('阳光进入叶片')
    await exportedPage.locator('#p1-submit').click()
    await expect(exportedPage.locator('#p1-feedback')).toContainText('预测已记录')
    expect(pageErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ source: repaired, workingCopy: coursePath, exportPath,
      projectId: reopened.project.id, revision: reopened.project.revision, runtimeIds, imageBefore: 'asset_821876ce-0bcb-4b00-ad11-fef0eb6d437d',
      imageAfter: replaced.assetId, pages: savedSlide.scenes.length, verified: ['text-edit', 'native-image-replace', 'undo-redo', 'save-reopen', 'offline-export-interaction'] }, null, 2))
  } finally {
    if (app) await closeApp(app)
  }
})
