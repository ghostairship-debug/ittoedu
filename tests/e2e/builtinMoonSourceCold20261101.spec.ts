/** Actual App consumer of the formal source handoff; never edits the built-in original. */
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/comprehensive-execution-20261101/creation/builtin-moon-source-handoff')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function close(app: ElectronApplication | undefined) {
  if (!app) return
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
async function author(page: Page, id: string) {
  return page.evaluate(async documentId => {
    const snapshot = await window.desktopAPI.documents!.read(documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected a course')
    const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))]
      .map(value => value.toString(16).padStart(2, '0')).join('')
    const assets = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.assets)
      .map(async ([key, bytes]) => [key, await sha(bytes)])))
    const components = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.components)
      .map(async ([key, files]) => [key, Object.fromEntries(await Promise.all(Object.entries(files)
        .map(async ([name, bytes]) => [name, await sha(bytes)])))])))
    return { project: snapshot.model.project, assets, components, revision: snapshot.revision, dirty: snapshot.dirty }
  }, id)
}
async function clickAuthored(page: Page, frame: Frame, selector: string) {
  await frame.locator(selector).scrollIntoViewIfNeeded()
  let point = await frame.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  for (let current = frame; current.parentFrame(); current = current.parentFrame()!) {
    const owner = await current.frameElement()
    const geometry = await owner.evaluate(element => {
      if (!(element instanceof HTMLElement)) throw new Error('The real frame owner must be an HTMLElement')
      const rect = element.getBoundingClientRect(), node = element
      return { left: rect.left, top: rect.top, sx: rect.width / node.offsetWidth, sy: rect.height / node.offsetHeight,
        bx: node.clientLeft, by: node.clientTop }
    })
    point = { x: geometry.left + (point.x + geometry.bx) * geometry.sx,
      y: geometry.top + (point.y + geometry.by) * geometry.sy }
    expect(await owner.evaluate((element, position) => {
      const root = element.getRootNode() as Document | ShadowRoot
      return root.elementFromPoint(position.x, position.y) === element
    }, point), `Actual frame hit for ${selector}`).toBe(true)
  }
  await page.mouse.click(point.x, point.y)
}

test('built-in moon source handoff cold opens with the human title, local source edit and authored state intact', async () => {
  test.skip(process.platform !== 'win32', 'Actual authoring acceptance uses Windows Electron.')
  test.setTimeout(100_000)
  const latest = JSON.parse(await fs.readFile(path.join(base, 'latest.json'), 'utf8'))
  const input = JSON.parse(await fs.readFile(latest.result, 'utf8'))
  expect(input.status).toBe('formal-source-edit-saved-awaiting-app-cold')
  const expected = JSON.parse(await fs.readFile(input.authorJSON, 'utf8'))
  const out = await fs.mkdtemp(path.join(input.out, 'app-cold-')), profile = path.join(out, 'profile')
  await fs.mkdir(profile)
  expect(hash(await fs.readFile(input.document))).toBe(input.savedHash)
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' })
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const errors: string[] = [], network: string[] = []
  try {
    app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + profile], env, timeout: 30_000 })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setContentSize(1500, 1000); window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, input.workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: path.basename(input.document), exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toBeVisible()
    await expect.poll(async () => {
      const id = await editor.getAttribute('data-document-id')
      return !!id && page!.evaluate(async ({ id, filename }) => {
        const snapshot = await window.desktopAPI.documents!.read(id)
        return snapshot.binding.kind === 'file' && snapshot.binding.path === filename
      }, { id, filename: input.document })
    }).toBe(true)
    const id = (await editor.getAttribute('data-document-id'))!
    const before = await author(page, id)
    expect(before.project).toEqual(expected.project)
    expect(before.assets).toEqual(expected.assets); expect(before.components).toEqual(expected.components)
    expect(before.dirty).toBe(false)
    await expect(page.locator(`[data-component-instance="${input.titleId}"]:visible`)).toContainText(input.titleAfter)
    phase = 'actual-source-consumer'
    const chrome = page.getByTestId('course-try-run-chrome')
    await chrome.getByRole('button', { name: '试运行', exact: true }).click()
    let lab: Frame | undefined
    await expect.poll(async () => {
      for (const frame of page!.frames()) if (await frame.locator('#angle').count().catch(() => 0)) { lab = frame; return true }
      return false
    }).toBe(true)
    await expect(lab!.locator('#reset')).toHaveText('重置实验')
    await clickAuthored(page, lab!, '[data-angle="180"]')
    await expect(lab!.locator('#phaseName')).toHaveText('满月')
    await expect(lab!.locator('#fraction')).toHaveText('100%')
    await clickAuthored(page, lab!, '#reset')
    await expect(lab!.locator('#phaseName')).toHaveText('新月')
    await expect(lab!.locator('#fraction')).toHaveText('0%')
    await page.screenshot({ path: path.join(out, 'source-cold.png') })
    expect(await author(page, id)).toEqual(before)
    phase = 'formal-app-offline-export'
    const destination = path.join(input.workspace, `月光的几何-源码接力-${path.basename(out)}.html`)
    const runId = 'builtin-moon-cold-export-' + randomUUID()
    const exported = await app.evaluate(async ({ app }, request) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      await host.tools.beginRun({ runId: request.runId, actor: 'human',
        documents: [{ documentId: request.id, writable: [{ kind: 'document' }] }],
        fileAccess: { permission: 'workspace', workspaceRoot: request.workspace } })
      try {
        await host.tools.loadToolFamilies(request.runId, ['build'])
        const opened = await host.tools.completeOpenedDocument(request.runId,
          { documentId: request.id, writable: true }, { selection: 'preserve' })
        return await host.tools.execute(request.runId, 'offline', { name: 'document.export',
          input: { target: opened.target, format: 'html-offline', destination: request.destination } })
      } finally { await host.tools.stop(request.runId) }
    }, { runId, id, workspace: input.workspace, destination })
    const exportReceipt = path.join(out, 'export-receipt.json')
    await fs.writeFile(exportReceipt, JSON.stringify(exported, null, 2))
    expect(exported).toMatchObject({ kind: 'read', data: { status: 'written', path: destination,
      format: 'html-offline', exportedRevision: before.revision, currentRevision: before.revision } })
    const html = await fs.readFile(destination)
    expect(html.byteLength).toBeGreaterThan(0)
    const exportHash = hash(html)
    expect(await author(page, id)).toEqual(before)
    expect(hash(await fs.readFile(input.document))).toBe(input.savedHash)
    expect(hash(await fs.readFile(input.source))).toBe(input.sourceHash)
    expect(hash(await fs.readFile(input.humanDocument))).toBe(input.humanHash)
    expect(errors).toEqual([]); expect(network).toEqual([])
    const result = { status: 'source-handoff-app-cold-verified', checkedAt: new Date().toISOString(),
      input: latest.result, document: input.document, pid: app.process().pid, out,
      humanTitlePreserved: true, localSourceVisible: true, actualPointer: true, authorUnchanged: true,
      originalAndHumanCopyUnchanged: true, errors, network, modelRequests: 0,
      export: { status: 'written', path: destination, sha256: exportHash, bytes: html.byteLength,
        revision: before.revision, receipt: exportReceipt, offlineBehavior: 'pending' },
      next: ['node', 'scripts/experiments/verify-builtin-moon-20261101.mjs', destination,
        path.join(out, 'offline-verification'), input.titleAfter] }
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
    await fs.writeFile(path.join(base, 'cold-latest.json'), JSON.stringify({ out, result: path.join(out, 'result.json') }, null, 2))
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
    await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ phase, error: String(error),
      stack: error instanceof Error ? error.stack : '', errors, network }, null, 2))
    throw error
  } finally { await close(app) }
})
