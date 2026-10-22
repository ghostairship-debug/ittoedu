import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/glx-work-containers-20261020/final-ui')
const env = () => Object.fromEntries(Object.entries({ ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_E2E_BACKGROUND: '1' })
  .filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(key))) as Record<string, string>
async function launch(profile: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: env() })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
  await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
  return { app, page }
}
async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}
async function open(app: ElectronApplication, page: Page, directory: string, filename: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, directory)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: filename, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  const id = await frame.getAttribute('data-document-id')
  if (!id) throw new Error('No formal document in the editor')
  return id
}
async function snapshot(page: Page, id: string) {
  const value = await page.evaluate(id => window.desktopAPI.documents!.read(id), id)
  if (value.model.kind !== 'course-v10') throw new Error('Expected canonical work')
  return { ...value, model: value.model }
}
async function exportHtml(app: ElectronApplication, id: string, workspace: string, destination: string) {
  return app.evaluate(async ({ app }, input) => {
    const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
    const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
    await host.tools.beginRun({ runId: 'work-final-export', actor: 'human', documents: [{ documentId: input.id, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
    await host.tools.loadToolFamilies('work-final-export', ['build'])
    try {
      const opened = await host.tools.completeOpenedDocument('work-final-export', { documentId: input.id, writable: true }, { selection: 'preserve' })
      return await host.tools.execute('work-final-export', 'offline', { name: 'document.export', input: { target: opened.target, format: 'html-offline', destination: input.destination } })
    } finally { await host.tools.stop('work-final-export') }
  }, { id, workspace, destination })
}

test('V1 opens an existing V10 copy, edits through the native UI, undoes, saves and cold opens the same work', async ({}, info) => {
  test.setTimeout(120_000)
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'v1-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace)
  const source = process.env.GLX_V1_SOURCE ?? 'D:/果铃工作台/output/creation-boundary-implementation-20261020/F03/run-wZOO6C/workspace/mixed-saved.glx'
  await copyFile(source, path.join(workspace, 'old-copy.glx'))
  const errors: string[] = [], facts: Record<string, unknown> = { source, directory }
  let warm: Awaited<ReturnType<typeof launch>> | undefined, cold: Awaited<ReturnType<typeof launch>> | undefined
  try {
    warm = await launch(path.join(directory, 'warm-profile')); warm.page.on('pageerror', error => errors.push(error.message))
    const id = await open(warm.app, warm.page, workspace, 'old-copy.glx'), before = await snapshot(warm.page, id)
    expect(before.model.project.schemaVersion).toBe(11); expect(before.model.project).not.toHaveProperty('surfaces')
    const title = warm.page.getByText('Boundary title revised', { exact: true }).first()
    await expect(title).toBeVisible()
    const box = await title.boundingBox(); if (!box) throw new Error('Title has no real bounds')
    facts.beforeEdit = await warm.page.evaluate(({ x, y }) => ({ x, y, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 500),
      viewports: [...document.querySelectorAll('.canvas-viewport,[data-testid="canvas-stage"],.slide-stage')].map(element => ({ rect: element.getBoundingClientRect().toJSON(), style: element.getAttribute('style') })) }),
    { x: box.x + Math.min(60, box.width / 2), y: box.y + box.height / 2 })
    facts.titleBounds = box
    await warm.page.screenshot({ path: path.join(directory, 'before-edit.png') })
    await warm.page.mouse.dblclick(box.x + Math.min(60, box.width / 2), box.y + box.height / 2)
    const editor = warm.page.locator('[data-component-professional-editor] [contenteditable="true"]').first()
    await expect(editor).toBeVisible(); await editor.click(); await warm.page.keyboard.press('Control+a')
    await warm.page.keyboard.insertText('V11 preserved title'); await warm.page.keyboard.press('Control+Enter')
    await expect(warm.page.getByText('V11 preserved title', { exact: true }).first()).toBeVisible()
    const edited = await snapshot(warm.page, id)
    await warm.page.keyboard.press('Control+z'); await expect(warm.page.getByText('Boundary title revised', { exact: true }).first()).toBeVisible()
    await warm.page.keyboard.press('Control+Shift+z'); await expect(warm.page.getByText('V11 preserved title', { exact: true }).first()).toBeVisible()
    const destination = path.join(workspace, 'v1-saved.glx')
    await warm.app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, destination)
    await warm.page.getByRole('button', { name: '另存为', exact: true }).click()
    await expect.poll(() => snapshot(warm!.page, id).then(value => value.dirty)).toBe(false)
    const saved = await snapshot(warm.page, id)
    expect(saved.model.project.rootIds).toEqual(before.model.project.rootIds)
    const changed = Object.keys(before.model.project.instances).filter(key => JSON.stringify(before.model.project.instances[key]) !== JSON.stringify(saved.model.project.instances[key]))
    expect(changed).toHaveLength(1)
    expect(saved.model.project.instances[changed[0]]!.frame).toEqual(before.model.project.instances[changed[0]]!.frame)
    facts.warm = { pid: await warm.app.evaluate(() => process.pid), revision: edited.revision, changed, destination }
    await warm.page.screenshot({ path: path.join(directory, 'native-edited.png') })
    await close(warm.app); warm = undefined
    cold = await launch(path.join(directory, 'cold-profile')); cold.page.on('pageerror', error => errors.push(error.message))
    const coldId = await open(cold.app, cold.page, workspace, 'v1-saved.glx')
    await expect(cold.page.getByText('V11 preserved title', { exact: true }).first()).toBeVisible()
    const reopened = await snapshot(cold.page, coldId)
    expect(reopened.model).toEqual(saved.model); expect(reopened.dirty).toBe(false)
    await cold.page.screenshot({ path: path.join(directory, 'cold-editor.png') })
    facts.cold = { pid: await cold.app.evaluate(() => process.pid), revision: reopened.revision, dirty: reopened.dirty }
    facts.export = await exportHtml(cold.app, coldId, workspace, 'v1-offline.html')
    expect(facts.export).toMatchObject({ kind: 'read', data: { status: 'written' } })
    expect(errors).toEqual([])
  } finally {
    if (warm) { await warm.page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => undefined); await close(warm.app) }
    if (cold) await close(cold.app)
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify({ ...facts, errors }, null, 2))
    await info.attach('V1 facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})
