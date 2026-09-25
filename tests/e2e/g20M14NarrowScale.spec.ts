import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

// M14-T04 with the Owner-selected method: in-app simulated display scaling
// (--force-device-scale-factor), a narrow window, and the five core actions.
const root = resolve(__dirname, '../..')
const cases = [{ scale: 1.25, width: 1024, height: 700 }, { scale: 1.5, width: 860, height: 620 }]

async function heldServer() {
  let requests = 0
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    for await (const _chunk of request) { /* consume */ }
    requests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    // Keep the first answer open so the run can be stopped from the narrow window.
    response.write(`data: ${JSON.stringify({ id: 'narrow', model: 'fixture-selection', choices: [{ index: 0, delta: { role: 'assistant', content: '正在处理' }, finish_reason: null }] })}\n\n`)
  })().catch(() => response.destroy()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, get requests() { return requests },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

/** The control is inside the viewport and its centre hits the control itself (not covered, no dead zone). */
async function expectReachable(page: Page, control: Locator, name: string) {
  await control.scrollIntoViewIfNeeded()
  await expect(control, name).toBeVisible()
  await expect(control, name).toBeEnabled()
  const result = await control.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2
    const hit = document.elementFromPoint(x, y)
    return { inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, hits: !!hit && (hit === element || element.contains(hit)),
      box: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } }
  })
  expect(result, `${name} must be fully visible and hit-testable`).toMatchObject({ inside: true, hits: true })
  return result.box
}

for (const { scale, width, height } of cases) test(`M14-T04 narrow ${width}x${height} window at simulated ${scale * 100}% scale completes send, stop, save, attach and return`, async ({}, info) => {
  test.setTimeout(240_000)
  const fixture = selectionFixtures(), server = await heldServer()
  const attachment = join(fixture.directory, '课堂记录.txt'); writeFileSync(attachment, 'M14 附件：小窗口下添加。')
  const app: ElectronApplication = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(fixture.directory, 'profile')}`, `--force-device-scale-factor=${scale}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const resize = (w: number, h: number) => app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(600, 500); window.setContentSize(size.w, size.h) }, { w, h })
  const panes = page.getByRole('tablist', { name: '工作台区域', exact: true })
  const showPane = async (name: string) => { if (await panes.isVisible()) await panes.getByRole('tab', { name, exact: true }).click() }
  const boxes: Record<string, unknown> = {}
  try {
    await resize(1300, 820)
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const opened = await openSelectionFile(page, fixture.workspace, 'selection.md')
    await resize(width, height)
    // Forced scaling on top of this machine's 200% system scale rounds to physical pixels;
    // the exact CSS width is recorded, the check is that the window really is narrow.
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(Math.ceil(width * 1.05))
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth, paneSwitcher: !!document.querySelector('.lesson-workspace-pane-switcher:not([hidden])') }))
    expect(viewport.ratio).toBeCloseTo(scale, 2)
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 2)

    // Save: a real body edit, then the document Save button.
    await showPane('内容')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    const body = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, body, '保持原样')
    await page.keyboard.insertText('小窗修改')
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).dirty).toBe(true)
    const card = page.getByLabel('当前编辑目标', { exact: true })
    if (await card.isVisible()) await card.getByRole('button', { name: '保留目标', exact: true }).click()
    boxes.save = await expectReachable(page, region.getByRole('button', { name: '保存', exact: true }), '保存')
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).dirty).toBe(false)

    // Attachment, send and stop in the assistant.
    await showPane('AI 助手')
    const composer = page.getByLabel('给创作助手发消息', { exact: true })
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, attachment)
    boxes.permission = await expectReachable(page, assistant.getByRole('button', { name: /^权限：/ }), '权限')
    boxes.model = await expectReachable(page, assistant.getByRole('button', { name: '切换模型', exact: true }), '切换模型')
    const plus = assistant.getByRole('button', { name: '添加', exact: true })
    boxes.plus = await expectReachable(page, plus, '添加')
    await plus.click()
    const addAttachment = assistant.getByRole('menu', { name: '添加内容', exact: true }).getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true })
    boxes.attach = await expectReachable(page, addAttachment, '添加附件（图片或文档）')
    await addAttachment.click()
    await expect(page.locator('.attachment-composer').getByRole('button', { name: '预览发送内容', exact: true })).toHaveCount(1)
    await composer.fill('小窗口下发送并停止')
    const send = page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true })
    boxes.send = await expectReachable(page, send, '发送')
    await send.click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => server.requests).toBe(1)
    const stop = page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '停止', exact: true })
    boxes.stop = await expectReachable(page, stop, '停止')
    await stop.click()
    await expect(stop).toHaveCount(0, { timeout: 30_000 })

    // Return: deep edit exists for course documents; enter it and use its embedded 返回工作台.
    await showPane('资源管理器与会话列表')
    const course = await openSelectionFile(page, fixture.workspace, 'named-selection.h5lesson')
    await showPane('内容')
    const deep = page.getByRole('button', { name: '深度编辑', exact: true })
    boxes.deepEdit = await expectReachable(page, deep, '深度编辑')
    await deep.click()
    const back = page.getByRole('button', { name: '返回工作台', exact: true })
    boxes.return = await expectReachable(page, back, '返回工作台')
    await back.click()
    await expect(deep).toBeVisible()
    expect((await readSelectionDocument(page, course.documentId)).documentId).toBe(course.documentId)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^selection\.md/ }).click()
    await expect(region).toBeVisible()

    // No remount while the window crosses the narrow/wide layouts and back.
    await showPane('AI 助手')
    await composer.fill('跨尺寸保留的草稿')
    const composerHandle = await composer.elementHandle(), regionHandle = await region.elementHandle()
    await resize(1300, 820); await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(width + 200)
    await resize(width, height); await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(Math.ceil(width * 1.05))
    await showPane('AI 助手')
    await expect(composer).toHaveValue('跨尺寸保留的草稿')
    expect(await composer.evaluate((element, previous) => element === previous, composerHandle)).toBe(true)
    await showPane('内容')
    expect(await region.evaluate((element, previous) => element === previous, regionHandle)).toBe(true)
    expect((await readSelectionDocument(page, opened.documentId)).documentId).toBe(opened.documentId)
    expect(server.requests).toBe(1)
    expect(errors).toEqual([])
    const path = join(fixture.directory, 'm14-t04-evidence.json')
    writeFileSync(path, JSON.stringify({ caseId: 'M14-T04', scaleMethod: 'in-app --force-device-scale-factor (Owner-selected, not a system DPI change)',
      scale, window: { width, height }, viewport, boxes, requests: server.requests, sameComposerNode: true, sameDocumentRegionNode: true, errors }, null, 2))
    await page.screenshot({ path: join(fixture.directory, `narrow-${scale}.png`) })
    await info.attach('M14-T04 narrow scale evidence', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})
