import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canvasReady } from './helpers/g20M21Harness'
import { closeM22, COURSE, firstScene, item, launchM22, menuCommand, project, retainM22Evidence, savedProject, selectItem, wave } from './helpers/g20M22Harness'

async function spyOnRealAudio(page: Page) {
  await page.evaluate(() => {
    const old = HTMLMediaElement.prototype.play
    ;(window as any).__m22Played = [] as HTMLMediaElement[]
    HTMLMediaElement.prototype.play = function () {
      ;(window as any).__m22Played.push(this)
      return old.call(this)
    }
  })
}
async function clearPlayedAudio(page: Page) {
  await page.evaluate(() => { (window as any).__m22Played = [] as HTMLMediaElement[] })
  expect(await page.evaluate(() => (window as any).__m22Played.length)).toBe(0)
}
async function expectAudioPlayed(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__m22Played?.length ?? 0)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => ((window as any).__m22Played as HTMLMediaElement[]).some(audio => audio.currentTime > 0 && !audio.error))).toBe(true)
}
async function clickPlaybackItem(page: Page, selector: string, id: string) {
  const found = page.locator(`${selector} [data-slide-layer-item="${id}"]:visible`).first()
  await expect(found).toBeVisible()
  await found.click()
}
async function expectNavigated(page: Page, selector: string) {
  await expect(page.locator(`${selector} [data-slide-layer-item="m22-arrived"]:visible`).first()).toBeVisible()
}

// M22-T02 requirement assertions. UI wiring is pending; do not satisfy these with only a project field or mock player.
test('M22-T02 workbench audio placement and identity-based jump survive save and play in three real carriers', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance')
  test.setTimeout(240_000)
  const h = await launchM22('interactions')
  try {
    const { app, page, frame, read, fixture } = h
    const initial = await read()
    await selectItem(page, 'm22-title')
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, h.audioFile)
    await menuCommand(page, '放置音频')
    await expect.poll(async () => firstScene(await read()).layerItems.length).toBe(3)
    const placed = await read()
    const button = firstScene(placed).layerItems.find(candidate => !['m22-title', 'm22-target'].includes(candidate.layerItemId))
    if (!button) throw new Error('Audio button was not placed in the Slide scene')
    const audioRule = firstScene(placed).interactions.find(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === button.layerItemId)
    const action = audioRule?.actions[0]?.action
    if (action?.type !== 'audio.play') throw new Error('Placed audio has no declarative click-play rule')
    const sound = project(placed).media.audio.sounds[action.soundId]
    if (!sound) throw new Error('Click-play sound was not registered')
    expect(Buffer.from(placed.model.kind === 'course-v9' ? placed.model.resources.assets[sound.assetId]! : [])).toEqual(Buffer.from(wave()))
    expect(placed.undoDepth).toBe(initial.undoDepth + 1)
    await frame.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => firstScene(await read()).layerItems.length).toBe(2)
    await frame.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => firstScene(await read()).layerItems.length).toBe(3)

    await selectItem(page, 'm22-target')
    // Two pages have the same visible name. The product must expose their distinct location identities to users.
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '更多操作', exact: true }).click()
    const duplicates = page.getByRole('menuitem', { name: /点击跳到：同名页/ }).filter({ visible: true })
    await expect(duplicates).toHaveCount(2)
    await duplicates.nth(1).click()
    await expect.poll(async () => firstScene(await read()).interactions.filter(rule =>
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === 'm22-target').length).toBe(1)
    const nav = firstScene(await read()).interactions.find(rule => rule.trigger.type === 'node.click' && rule.trigger.nodeId === 'm22-target')
    expect(nav?.actions[0]?.action).toEqual({ type: 'location.go', locationId: fixture.secondLocationId })
    // Flow is also a real navigation destination. Updating the same simple rule must reuse it.
    const flowLabel = project(await read()).locations.find(location => location.id === fixture.flowLocationId)?.label
    if (!flowLabel) throw new Error('Flow destination missing')
    await selectItem(page, 'm22-target')
    await menuCommand(page, `点击跳到：${flowLabel}`)
    await expect.poll(async () => firstScene(await read()).interactions.find(rule =>
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === 'm22-target')?.actions[0]?.action)
      .toEqual({ type: 'location.go', locationId: fixture.flowLocationId })
    await selectItem(page, 'm22-target')
    await page.locator('[data-selection-quick-bar]').getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: /点击跳到：同名页/ }).filter({ visible: true }).nth(1).click()
    await expect.poll(async () => firstScene(await read()).interactions.find(rule =>
      rule.trigger.type === 'node.click' && rule.trigger.nodeId === 'm22-target')?.actions[0]?.action)
      .toEqual({ type: 'location.go', locationId: fixture.secondLocationId })

    await frame.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await read()).dirty).toBe(false)
    const saved = await read()
    expect(savedProject(h.courseFile)).toEqual(project(saved))
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true }).dblclick()
    await canvasReady(page)
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === h.documentId) throw new Error('UI did not reopen a new DocumentSession')
    const reopened = await page.evaluate(id => window.desktopAPI!.documents!.read(id), reopenedId)
    expect(project(reopened)).toEqual(project(saved))
    expect(Buffer.from(reopened.model.kind === 'course-v9' ? reopened.model.resources.assets[sound.assetId]! : [])).toEqual(Buffer.from(wave()))

    await spyOnRealAudio(page)
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    await clearPlayedAudio(page)
    await clickPlaybackItem(page, '.course-try-run-host', button.layerItemId)
    await expectAudioPlayed(page)
    await clickPlaybackItem(page, '.course-try-run-host', 'm22-target')
    await expectNavigated(page, '.course-try-run-host')
    await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    await frame.getByTestId(`bottom-scene-${fixture.firstLocationId}`).locator('.bottom-scene-card__main').click()

    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await clearPlayedAudio(page)
    await clickPlaybackItem(page, '.course-preview-host', button.layerItemId)
    await expectAudioPlayed(page)
    await clickPlaybackItem(page, '.course-preview-host', 'm22-target')
    await expectNavigated(page, '.course-preview-host')
    await page.getByRole('button', { name: '关闭预览', exact: true }).click()

    const htmlFile = join(h.directory, 'M22 离线互动.html')
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, htmlFile)
    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    await expect.poll(async () => {
      const proceed = page.getByRole('alertdialog').getByRole('button', { name: /^(继续导出|仍然导出)$/ }).first()
      if (!existsSync(htmlFile) && await proceed.isVisible().catch(() => false)) await proceed.click().catch(() => undefined)
      return existsSync(htmlFile)
    }, { timeout: 60_000 }).toBe(true)
    expect(readFileSync(htmlFile).length).toBeGreaterThan(10_000)
    await app.context().addInitScript(() => {
      const old = HTMLMediaElement.prototype.play
      ;(window as any).__m22Played = [] as HTMLMediaElement[]
      HTMLMediaElement.prototype.play = function () { ;(window as any).__m22Played.push(this); return old.call(this) }
    })
    const opened = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, file) => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, partition: `m22-export-${Date.now()}`, backgroundThrottling: false } })
      await window.loadFile(file)
    }, htmlFile)
    const exported = await opened
    await expect(exported.locator('#course-root')).not.toBeEmpty()
    await clearPlayedAudio(exported)
    await clickPlaybackItem(exported, '#course-root', button.layerItemId)
    await expectAudioPlayed(exported)
    await clickPlaybackItem(exported, '#course-root', 'm22-target')
    await expectNavigated(exported, '#course-root')
  } finally { try { await retainM22Evidence(h, 'interactions') } finally { await closeM22(h.app) } }
})
