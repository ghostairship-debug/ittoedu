/** The built-in candidate stays unchanged; only an isolated copy is edited. No model calls. */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = path.resolve(__dirname, '../..')
const creation = path.join(root, 'output/comprehensive-execution-20261101/creation')
const source = path.join(creation, 'builtin-moon-normal-20261101T084000/workspace/月光的几何.glx')
const sourceHash = '20ae62da81ef2a8116d8d3eeb63af07c39e641312383736d521a9489467593aa'
const titleId = 'instance_uADaklTuyIGyG7YUJwK73'
const titleBefore = '月光的几何', titleAfter = '月光的几何·课堂'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function close(app: ElectronApplication | undefined) {
  if (!app) return
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
async function author(page: Page, id: string) {
  return page.evaluate(async documentId => {
    const snapshot = await window.desktopAPI.documents!.read(documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the current course model')
    const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))]
      .map(value => value.toString(16).padStart(2, '0')).join('')
    const assets = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.assets)
      .map(async ([key, bytes]) => [key, await sha(bytes)])))
    const components = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.components)
      .map(async ([key, files]) => [key, Object.fromEntries(await Promise.all(Object.entries(files)
        .map(async ([name, bytes]) => [name, await sha(bytes)])))])))
    return { project: snapshot.model.project, assets, components, revision: snapshot.revision, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth }
  }, id)
}

test('built-in moon candidate supports actual native title editing, undo, save and independent cold reopening', async () => {
  test.skip(process.platform !== 'win32', 'Actual authoring acceptance uses Windows Electron.')
  test.setTimeout(150_000)
  const base = path.join(creation, 'builtin-moon-handoff')
  await fs.mkdir(base, { recursive: true })
  const out = await fs.mkdtemp(path.join(base, 'run-'))
  const workspace = path.join(out, 'workspace'), profile = path.join(out, 'profile')
  await fs.mkdir(workspace); await fs.mkdir(profile)
  const document = path.join(workspace, '月光的几何-人工接力.glx')
  const original = await fs.readFile(source)
  expect(hash(original)).toBe(sourceHash)
  await fs.writeFile(document, original, { flag: 'wx' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' })
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const errors: string[] = [], network: string[] = []
  const launch = async () => {
    app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + profile], env, timeout: 30_000 })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setContentSize(1500, 1000); window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(document), exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toBeVisible()
    const open = editor.getByRole('button', { name: '在编辑器中打开', exact: true })
    if (await open.count()) await open.click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    const id = await editor.getAttribute('data-document-id')
    if (!id) throw new Error('No active author document')
    await expect.poll(async () => page!.evaluate(async ({ id, filename }) => {
      const snapshot = await window.desktopAPI.documents!.read(id)
      return snapshot.binding.kind === 'file' && snapshot.binding.path === filename
    }, { id, filename: document })).toBe(true)
    return { id, pid: app.process().pid }
  }
  try {
    const initial = await launch(), before = await author(page!, initial.id)
    expect(before.project.revision).toBe(4)
    expect(before.project.instances[titleId]?.definitionId).toBe('guoling.text')
    expect(JSON.stringify(before.project.instances[titleId].data)).toContain(titleBefore)
    await fs.writeFile(path.join(out, 'before-author.json'), JSON.stringify(before, null, 2))
    phase = 'actual-native-title-edit'
    const visible = page!.locator(`[data-component-instance="${titleId}"]:visible`)
    await expect(visible).toBeVisible()
    const bounds = await visible.boundingBox()
    expect(bounds).toBeTruthy()
    await page!.mouse.dblclick(bounds!.x + 40, bounds!.y + 20)
    const overlay = page!.locator('.text-edit-overlay[data-component-professional-editor]:visible')
    const input = overlay.locator('[contenteditable=true],textarea').first()
    await expect(input).toBeVisible()
    await input.press('Control+a'); await page!.keyboard.insertText(titleAfter); await input.press('Escape')
    await expect(overlay).toHaveCount(0)
    await expect.poll(async () => JSON.stringify((await author(page!, initial.id)).project.instances[titleId].data)).toContain(titleAfter)
    const changed = await author(page!, initial.id)
    const normalized = structuredClone(changed.project)
    normalized.revision = before.project.revision
    const changedTitleData = normalized.instances[titleId].data, originalTitleData = before.project.instances[titleId].data
    if (!changedTitleData || typeof changedTitleData !== 'object' || Array.isArray(changedTitleData)
      || !originalTitleData || typeof originalTitleData !== 'object' || Array.isArray(originalTitleData)) {
      throw new Error('The native text author data must be an object')
    }
    changedTitleData.content = structuredClone(originalTitleData.content)
    expect(normalized).toEqual(before.project)
    expect(changed.assets).toEqual(before.assets); expect(changed.components).toEqual(before.components)
    phase = 'actual-undo-redo'
    await page!.getByTestId('course-try-run-chrome').getByRole('button', { name: '编辑', exact: true }).click()
    await page!.keyboard.press('Control+z')
    await expect.poll(async () => JSON.stringify((await author(page!, initial.id)).project.instances[titleId].data)).toContain(titleBefore)
    expect(JSON.stringify((await author(page!, initial.id)).project.instances[titleId].data)).not.toContain(titleAfter)
    await page!.keyboard.press('Control+Shift+z')
    await expect.poll(async () => JSON.stringify((await author(page!, initial.id)).project.instances[titleId].data)).toContain(titleAfter)
    phase = 'actual-save'
    await page!.keyboard.press('Control+s')
    await expect.poll(async () => (await author(page!, initial.id)).dirty).toBe(false)
    const saved = await author(page!, initial.id)
    await fs.writeFile(path.join(out, 'human-author.json'), JSON.stringify(saved, null, 2))
    await page!.screenshot({ path: path.join(out, 'human.png') })
    await close(app); app = undefined
    phase = 'independent-cold-reopen'
    const cold = await launch(), reopened = await author(page!, cold.id)
    expect(cold.pid).not.toBe(initial.pid)
    expect(reopened.project).toEqual(saved.project)
    expect(reopened.assets).toEqual(saved.assets); expect(reopened.components).toEqual(saved.components)
    expect(reopened.dirty).toBe(false)
    await expect(page!.locator(`[data-component-instance="${titleId}"]:visible`)).toContainText(titleAfter)
    await page!.screenshot({ path: path.join(out, 'cold.png') })
    expect(errors).toEqual([]); expect(network).toEqual([])
    expect(hash(await fs.readFile(source))).toBe(sourceHash)
    const result = { status: 'human-native-edit-cold-open-verified-source-handoff-pending', checkedAt: new Date().toISOString(),
      source, sourceHash, document, workspace, profile, out, titleId, titleBefore, titleAfter,
      revision: saved.revision, projectRevision: saved.project.revision, sha256: hash(await fs.readFile(document)),
      initialPid: initial.pid, coldPid: cold.pid, modelRequests: 0, errors, network, originalsUnchanged: true }
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
    await fs.writeFile(path.join(base, 'latest.json'), JSON.stringify({ out, result: path.join(out, 'result.json') }, null, 2))
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
    await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error),
      stack: error instanceof Error ? error.stack : '', errors, network, sourceStillUnchanged: hash(await fs.readFile(source)) === sourceHash }, null, 2))
    throw error
  } finally { await close(app) }
})
