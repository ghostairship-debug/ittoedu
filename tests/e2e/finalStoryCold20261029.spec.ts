import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'

test('final refined story retains its own authored state in an independent cold editor', async () => {
  test.skip(!process.env.GUOLING_FINAL_STORY_COLD, 'Explicit final artifact verification only')
  test.setTimeout(120000)
  const root = resolve(__dirname, '../..')
  const out = resolve(root, 'output/creation-editing-completion-20261029/resume-root/closure-20261029/d2-final-cold')
  mkdirSync(out, { recursive: true })
  const run = mkdtempSync(join(out, 'run-')), workspace = join(run, 'workspace')
  mkdirSync(workspace)
  const source = resolve(root, 'output/creation-editing-completion-20261029/production/workspace/resume-story-polished.glx')
  const bytes = readFileSync(source), hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex')
  const file = join(workspace, 'story-final.glx')
  copyFileSync(source, file)
  const disk = await new CourseV10Driver().load(bytes)
  if (disk.kind !== 'course-v10') throw Error('Wrong final document kind')
  expect(disk.project.revision).toBe(41)
  const titleId = 'd6deb4b5-3139-45c6-9107-8b65cb0915e3', noonId = '5a3f801c-bf2a-43ed-8a2d-8b2f3b2a6e7a'
  const imageId = '69a87fd2-286e-4872-b661-1907c3c3605a'
  const imageData = disk.project.instances[imageId].data as { assetId: string; crop: { left: number } }
  expect(hash(disk.resources.assets[imageData.assetId])).toBe(hash(readFileSync(resolve(root, 'output/audit-remediation-20261027/benchmark/assets/platform-alt.png'))))
  expect(imageData.crop.left).toBe(.05)
  const errors: string[] = [], startedAt = new Date().toISOString()
  const app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + join(run, 'profile')], env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' } })
  const page = await app.firstWindow()
  try {
    page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message))
    await app.evaluate(({ BrowserWindow, dialog }, directory) => { const w = BrowserWindow.getAllWindows()[0]; w?.setContentSize(1600, 1050); w?.show(); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'story-final.glx', exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toBeVisible()
    if (await editor.getAttribute('data-editor-mode') !== 'deep') await editor.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(page.getByTestId('flow-workspace')).toBeVisible()
    const id = await editor.getAttribute('data-document-id')
    if (!id) throw Error('Missing cold document identity')
    const snapshot = await page.evaluate(id => window.desktopAPI.documents!.read(id), id)
    if (snapshot.model.kind !== 'course-v10') throw Error('Wrong cold model kind')
    expect(snapshot.model.project).toEqual(disk.project)
    const block = (target: string) => editor.locator('[data-flow-block-id="' + target + '"]').first()
    await expect(block(titleId)).toHaveText(/旧站的一天\s*· 社区试运行版/)
    await expect(block(noonId)).toHaveText('12:00 记忆候车厅')
    await expect(block(imageId).locator('img')).toBeVisible()
    await expect.poll(() => block(imageId).locator('img').evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: join(run, 'cold-editor.png') })
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.documents!.read(id), id)).dirty).toBe(false)
    const saved = await new CourseV10Driver().load(readFileSync(file))
    if (saved.kind !== 'course-v10') throw Error('Wrong saved model kind')
    expect(saved.project).toEqual(disk.project)
    const resourceHashes = (model: typeof disk) => ({
      assets: Object.fromEntries(Object.entries(model.resources.assets).map(([id, data]) => [id, hash(data)])),
      components: Object.fromEntries(Object.entries(model.resources.components).map(([id, files]) => [id, Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)]))])),
    })
    expect(resourceHashes(saved)).toEqual(resourceHashes(disk))
    expect(hash(readFileSync(source))).toBe(hash(bytes))
    expect(errors).toEqual([])
    const result = { status: 'passed', startedAt, completedAt: new Date().toISOString(), source, sha256: hash(bytes), revision: snapshot.revision, exactProjectPreserved: true, replacementImageBytesMatch: true, ownCropPreserved: .05, historicalR22BaselineNotUsed: true, errors }
    writeFileSync(join(run, 'result.json'), JSON.stringify(result, null, 2)); writeFileSync(join(out, 'latest.json'), JSON.stringify(result, null, 2))
  } catch (e) {
    await page.screenshot({ path: join(run, 'failure.png') }).catch(() => {})
    writeFileSync(join(run, 'failure.json'), JSON.stringify({ error: String(e), errors, body: await page.locator('body').innerText().catch(() => '') }, null, 2)); throw e
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
})
