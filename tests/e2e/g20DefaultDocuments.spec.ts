import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')

test('G20 default course view preserves first-page focus while third-page edits, history, switching and reopen use main', async ({}, info) => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/b01/default-documents'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'))))
  const surface = archive.project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('fixture')
  const original = surface.scenes[0]!
  surface.scenes = [1, 2, 3].map(index => ({ ...structuredClone(original), id: `page-${index}`, name: `第${index}页`,
    layerItems: [{ ...structuredClone(original.layerItems[0]!), layerItemId: `title-${index}` }], interactions: [] }))
  archive.project.locations = surface.scenes.map(scene => ({ id: scene.id, label: scene.name, kind: 'slide-scene', surfaceId: surface.id, sceneId: scene.id }))
  archive.project.startLocationId = 'page-1'
  const fileA = join(workspace, '课件A.h5lesson'), fileB = join(workspace, '课件B.h5lesson')
  writeFileSync(fileA, createCourseProjectArchive(archive)); writeFileSync(fileB, createCourseProjectArchive(archive))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: '课件A.h5lesson', exact: true }).click()
    const first = page.locator('.course-page-tree__label').filter({ hasText: '第1页' })
    const third = page.locator('.course-page-tree__label').filter({ hasText: '第3页' })
    if (!await first.isVisible()) await page.getByRole('button', { name: '页面与图层', exact: true }).click()
    await expect(first).toBeVisible()
    await expect(first).toHaveAttribute('aria-current', 'page')
    const viewport = page.getByTestId('canvas-stage')
    await expect(viewport).toBeVisible()
    const geometry = await viewport.boundingBox()
    const observed = await page.evaluate(async filename => {
      const api = window.desktopAPI!.documents!
      const a = await api.open(filename)
      const receipt = await api.dispatch({ documentId: a.documentId, epoch: a.epoch, baseRevision: a.revision,
        actor: 'human', operationId: 'non-current-third-page', mutation: { type: 'command', command: {
          type: 'course.object.patch', locationId: 'page-3', itemId: 'title-3', patch: { nativeData: { text: '第三页的修改已到达' } },
        } } })
      return { id: a.documentId, receipt }
    }, fileA)
    expect(observed.receipt).toMatchObject({ status: 'applied' })
    await expect(first).toHaveAttribute('aria-current', 'page')
    expect(await viewport.boundingBox()).toEqual(geometry)
    await page.screenshot({ path: join(directory, 'first-page-after-external-commit.png') })
    writeFileSync(join(directory, 'view-after-commit.json'), JSON.stringify(await page.evaluate(() => ({
      text: document.body.innerText,
      rows: [...document.querySelectorAll('.course-page-tree__label')].map(node => ({ text: node.textContent, rect: node.getBoundingClientRect().toJSON(), current: node.getAttribute('aria-current') })),
    })), null, 2))
    await third.click()
    await expect(third).toHaveAttribute('aria-current', 'page')
    const thirdText = async () => page.evaluate(async id => {
      const snapshot = await window.desktopAPI!.documents!.read(id)
      if (snapshot.model.kind !== 'course-v9') throw new Error('course')
      const surface = snapshot.model.project.surfaces[0]!
      if (surface.type !== 'slide') throw new Error('slide')
      const item = surface.scenes[2]!.layerItems[0]!
      return item.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.text : ''
    }, observed.id)
    await expect.poll(thirdText).toBe('第三页的修改已到达')
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
    await expect(third).toBeHidden()
    await expect(viewport.locator('canvas').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
    })
    await page.screenshot({ path: join(directory, 'third-page-applied.png') })
    await page.getByRole('button', { name: /撤销/ }).click()
    await expect.poll(thirdText).toBe('用判别式判断方程根的情况')
    await page.getByRole('button', { name: /重做/ }).click()
    await expect.poll(thirdText).toBe('第三页的修改已到达')
    await tree.getByRole('button', { name: '课件B.h5lesson', exact: true }).click()
    if (!await first.isVisible()) await page.getByRole('button', { name: '页面与图层', exact: true }).click()
    await expect(first).toHaveAttribute('aria-current', 'page')
    await tree.getByRole('button', { name: '课件A.h5lesson', exact: true }).click()
    await expect(third).toHaveAttribute('aria-current', 'page')
    await expect.poll(thirdText).toBe('第三页的修改已到达')
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await page.evaluate(async id => window.desktopAPI!.documents!.read(id), observed.id)).dirty).toBe(false)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(fileA)))
    const savedSurface = saved.project.surfaces[0]!
    expect(savedSurface.type === 'slide' && savedSurface.scenes[2]!.layerItems[0]!).toMatchObject({ content: { data: { text: '第三页的修改已到达' } } })
    await page.reload()
    await tree.getByRole('button', { name: '课件A.h5lesson', exact: true }).click()
    if (!await third.isVisible()) await page.getByRole('button', { name: '页面与图层', exact: true }).click()
    await third.click()
    await expect.poll(thirdText).toBe('第三页的修改已到达')
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
    await expect(third).toBeHidden()
    await expect(viewport.locator('canvas').first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
    })
    await page.screenshot({ path: join(directory, 'reopened-third-page.png') })
    await info.attach('third-page', { path: join(directory, 'reopened-third-page.png'), contentType: 'image/png' })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ fileA, fileB, observed, thirdPageText: await thirdText() }, null, 2))
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
