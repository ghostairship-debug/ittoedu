import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
test('M13 real HTML export keeps the old file on cancel and emits one frozen revision while editing continues', async ({}, info) => {
  test.setTimeout(150000)
  const output = join(root, 'output/g20/b01/export-preservation'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const course = join(workspace, '导出保全.h5lesson'), filename = join(directory, 'delivery.html')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), course)
  writeFileSync(filename, '原有完整正式文件')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '导出保全.h5lesson', exact: true }).dblclick()
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    const documentId = await page.evaluate(async filename => (await window.desktopAPI!.documents!.open(filename)).documentId, course)
    await app.evaluate(({ dialog }) => {
      const state = { calls: 0, finish: null as null | ((value: { canceled: boolean; filePath: string }) => void) }
      ;(globalThis as any).__m13Save = state
      dialog.showSaveDialog = async () => { state.calls++; return new Promise(resolve => { state.finish = resolve }) }
    })
    const begin = async () => { await page.getByTestId('export-menu-trigger').click(); await page.getByTestId('export-single-html').click(); await page.getByRole('button', { name: '继续导出', exact: true }).click() }
    const rename = async (title: string) => page.evaluate(async ({ documentId, title }) => {
      const documents = window.desktopAPI!.documents!, snapshot = await documents.read(documentId)
      if (snapshot.model.kind !== 'course-v9') throw new Error('fixture course missing')
      const project = structuredClone(snapshot.model.project); project.title = title
      const result = await documents.dispatch({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'course.replace', project } } })
      if (result.status !== 'applied') throw new Error('actual document edit did not commit')
      return documents.read(documentId)
    }, { documentId, title })
    await begin()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__m13Save.calls)).toBe(1)
    const r1 = await rename('取消后保留的新稿 r1')
    await app.evaluate(() => (globalThis as any).__m13Save.finish({ canceled: true, filePath: '' }))
    await expect(page.getByTestId('export-menu-trigger')).toHaveAttribute('aria-disabled', 'false')
    expect(readFileSync(filename, 'utf8')).toBe('原有完整正式文件')
    await begin()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__m13Save.calls)).toBe(2)
    const r2 = await rename('等待保存时继续编辑 r2')
    await app.evaluate(({}, filename) => (globalThis as any).__m13Save.finish({ canceled: false, filePath: filename }), filename)
    await expect(page.getByTestId('export-menu-trigger')).toHaveAttribute('aria-disabled', 'false')
    const html = readFileSync(filename, 'utf8')
    expect(html).toContain('取消后保留的新稿 r1'); expect(html).not.toContain('等待保存时继续编辑 r2')
    if (r1.model.kind !== 'course-v9') throw new Error('fixture model')
    for (const bytes of Object.values(r1.model.resources.assets)) expect(html).toContain(Buffer.from(bytes).toString('base64'))
    expect(r2.revision).toBe(r1.revision + 1)
    // Open the actual standalone result in a separate sandboxed window; authoring state is not its source.
    const opened = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, filename) => { const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); await window.loadFile(filename) }, filename)
    const player = await opened
    await expect(player.locator('#course-root')).not.toBeEmpty()
    await expect.poll(() => player.evaluate(() => document.querySelectorAll('.course-player-error').length)).toBe(0)
    await expect.poll(() => player.evaluate(() => [...document.images].filter(image => image.complete && image.naturalWidth > 0).length)).toBeGreaterThan(0)
    await player.screenshot({ path: join(directory, 'standalone.png'), fullPage: true })
    const evidence = join(directory, 'evidence.json')
    writeFileSync(evidence, JSON.stringify({ format: 'offline-portable single HTML', generatedRevision: r1.revision, laterLiveRevision: r2.revision,
      cancellationPreservedOriginal: true, resourceCount: Object.keys(r1.model.resources.assets).length, htmlBytes: Buffer.byteLength(html), limitation: 'Independent mount/resource load; not a complete interaction or all-format acceptance.' }, null, 2))
    await info.attach('export-preservation', { path: evidence, contentType: 'application/json' })
  } catch (error) { await app.windows()[0]?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined); throw error }
  finally { await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined); await app.close().catch(() => undefined) }
})
