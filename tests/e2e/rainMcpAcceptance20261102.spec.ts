import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const originalTitle = '雨水去哪儿了？', editedTitle = '雨水去哪儿了？·课堂版'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function author(page: Page, id: string) {
  return page.evaluate(async documentId => {
    const snapshot = await window.desktopAPI.documents!.read(documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Expected current course model')
    const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('')
    const assets = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.assets).map(async ([key, bytes]) => [key, await sha(bytes)])))
    const components = Object.fromEntries(await Promise.all(Object.entries(snapshot.model.resources.components).map(async ([owner, files]) => [owner,
      Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, bytes]) => [name, await sha(bytes)])))])))
    return { project: snapshot.model.project, assets, components, revision: snapshot.revision, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth }
  }, id)
}

test('rain MCP work: real title edit, save and independent process cold open preserve the rest', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Real workbench acceptance runs on Windows.')
  test.setTimeout(180_000)
  const sourceWorkspace = process.env.RAIN_MCP_WORKSPACE
  if (!sourceWorkspace) throw new Error('Set RAIN_MCP_WORKSPACE to the original MCP workspace')
  const glxFiles = (await fs.readdir(sourceWorkspace, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.glx'))
  if (glxFiles.length !== 1) throw new Error(`Expected exactly one GLX in ${sourceWorkspace}; found ${glxFiles.map(file => file.name).join(', ')}`)
  const source = join(sourceWorkspace, glxFiles[0]!.name), originalBytes = await fs.readFile(source), sourceHash = hash(originalBytes)
  const out = info.outputPath('rain-mcp-handoff'), workspace = join(out, 'workspace'), profile = join(out, 'profile')
  await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(profile, { recursive: true })
  const document = join(workspace, basename(source)); await fs.writeFile(document, originalBytes, { flag: 'wx' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }); delete env.ELECTRON_RUN_AS_NODE
  const errors: string[] = [], network: string[] = []
  const facts: Record<string, unknown> = { startedAtUtc: new Date().toISOString(), source, sourceHash, document, status: 'running', htmlAcceptance: 'not-run-in-this-test; validate exported HTML separately' }
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const close = async () => { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); app = undefined } }
  const launch = async () => {
    app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + profile], env, timeout: 30_000 })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => { const url = route.request().url(); if (/^https?:/i.test(url)) { network.push(url); return route.abort() } return route.continue() })
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const win = BrowserWindow.getAllWindows()[0]; win?.setContentSize(1500, 1000); win?.show(); win?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: basename(document), exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible'); await expect(editor).toBeVisible()
    const open = editor.getByRole('button', { name: '在编辑器中打开', exact: true }); if (await open.count()) await open.click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    const id = await editor.getAttribute('data-document-id'); if (!id) throw new Error('No author document')
    await expect.poll(async () => page!.evaluate(async ({ id, filename }) => {
      const snapshot = await window.desktopAPI.documents!.read(id)
      return snapshot.binding.kind === 'file' && snapshot.binding.path === filename
    }, { id, filename: document })).toBe(true)
    return { id, pid: app.process().pid }
  }
  try {
    const initial = await launch(), before = await author(page!, initial.id)
    const candidates = Object.values(before.project.instances).filter(instance => {
      const implementation = instance.implementationOverride ?? before.project.definitions[instance.definitionId]?.implementation
      return implementation?.kind === 'builtin' && implementation.key === 'guoling.text' && JSON.stringify(instance.data).includes(originalTitle)
    })
    if (candidates.length !== 1) throw new Error(`Expected one native title containing ${originalTitle}; found ${candidates.map(instance => instance.id).join(', ')}`)
    const titleId = candidates[0]!.id; facts.titleId = titleId
    await fs.writeFile(join(out, 'before-author.json'), JSON.stringify(before, null, 2))
    phase = 'real-title-edit'
    const visible = page!.locator(`[data-component-instance="${titleId}"]:visible`); await expect(visible).toBeVisible()
    const bounds = await visible.boundingBox(); if (!bounds) throw new Error('Native title has no visible bounds')
    await page!.mouse.dblclick(bounds.x + Math.min(40, bounds.width / 2), bounds.y + Math.min(20, bounds.height / 2))
    const overlay = page!.locator('.text-edit-overlay[data-component-professional-editor]:visible'), input = overlay.locator('[contenteditable=true],textarea').first()
    await expect(input).toBeVisible(); await input.press('Control+a'); await page!.keyboard.insertText(editedTitle); await input.press('Escape'); await expect(overlay).toHaveCount(0)
    await expect.poll(async () => JSON.stringify((await author(page!, initial.id)).project.instances[titleId].data)).toContain(editedTitle)
    const changed = await author(page!, initial.id), normalized = structuredClone(changed.project)
    normalized.revision = before.project.revision
    const changedData = normalized.instances[titleId].data, beforeData = before.project.instances[titleId].data
    if (!changedData || typeof changedData !== 'object' || Array.isArray(changedData) || !beforeData || typeof beforeData !== 'object' || Array.isArray(beforeData)) throw new Error('Native author data is not an object')
    changedData.content = structuredClone(beforeData.content)
    expect(normalized).toEqual(before.project); expect(changed.assets).toEqual(before.assets); expect(changed.components).toEqual(before.components)
    phase = 'save'; await page!.keyboard.press('Control+s'); await expect.poll(async () => (await author(page!, initial.id)).dirty).toBe(false)
    const saved = await author(page!, initial.id); await fs.writeFile(join(out, 'saved-author.json'), JSON.stringify(saved, null, 2))
    await page!.screenshot({ path: join(out, 'edited.png') })
    await close()
    phase = 'independent-cold-open'; const cold = await launch(), reopened = await author(page!, cold.id)
    expect(cold.pid).toBeTruthy(); expect(cold.pid).not.toBe(initial.pid)
    expect(reopened.project).toEqual(saved.project); expect(reopened.assets).toEqual(saved.assets); expect(reopened.components).toEqual(saved.components); expect(reopened.dirty).toBe(false)
    await expect(page!.locator(`[data-component-instance="${titleId}"]:visible`)).toContainText(editedTitle)
    await page!.screenshot({ path: join(out, 'cold.png') })
    expect(hash(await fs.readFile(source))).toBe(sourceHash); expect(errors).toEqual([]); expect(network).toEqual([])
    Object.assign(facts, { status: 'glx-handoff-passed-html-pending', initialPid: initial.pid, coldPid: cold.pid, errors, network,
      originalUnchanged: true, otherProjectDataAndResourcesPreserved: true, savedSha256: hash(await fs.readFile(document)), finishedAtUtc: new Date().toISOString() })
    await fs.writeFile(join(out, 'result.json'), JSON.stringify(facts, null, 2))
  } catch (error) {
    if (page) await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {})
    Object.assign(facts, { status: 'failed', phase, failure: String(error), stack: error instanceof Error ? error.stack : '', errors, network,
      originalUnchanged: hash(await fs.readFile(source)) === sourceHash, finishedAtUtc: new Date().toISOString() })
    await fs.writeFile(join(out, 'result.json'), JSON.stringify(facts, null, 2)); throw error
  } finally { await close() }
})
