/** Isolated real-App acceptance. Edits use the existing formal project tool owner. */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row } from './helpers/g20M20Harness'

type Change = { path: string; before: string; after: string }
type Config = { sourcePath: string; sourceSha256?: string; content: Change; parameter: Change }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('reference copy supports content, structure and business changes through formal tools, save and cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The real desktop acceptance runs on Windows.')
  test.setTimeout(240_000)
  const configPath = process.env.REFERENCE_FREEDOM_CONFIG
  if (!configPath) throw new Error('Set REFERENCE_FREEDOM_CONFIG to a JSON file containing sourcePath, optional sourceSha256, content and parameter changes (path, before, after).')
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Config
  for (const change of [config.content, config.parameter]) {
    if (!change?.path || !change.before || !change.after || change.before === change.after) throw new Error('Each distinct content/parameter change needs a path, before and after.')
  }
  const source = path.resolve(config.sourcePath), original = await fs.readFile(source), sourceHash = hash(original)
  if (config.sourceSha256) expect(sourceHash).toBe(config.sourceSha256)
  const base = path.resolve('output/goal-correction-20261102/reference-freedom')
  await fs.mkdir(base, { recursive: true })
  const directory = await fs.mkdtemp(path.join(base, 'ui-')), workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const filename = path.join(workspace, path.basename(source))
  await fs.writeFile(filename, original, { flag: 'wx' })
  const fixture = { directory, workspace, profile: path.join(directory, 'profile') }
  const evidence: Record<string, unknown> = { source, sourceHash, filename, method: 'real UI open/save; formal project tools perform bounded changes', phase: 'launch' }
  let running: Awaited<ReturnType<typeof launchM20>> | undefined
  const open = async () => {
    running = await launchM20(fixture)
    const { app, page } = running
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, path.basename(filename)).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toBeVisible()
    const openButton = editor.getByRole('button', { name: '在编辑器中打开', exact: true })
    if (await openButton.count()) await openButton.click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    const id = await editor.getAttribute('data-document-id')
    if (!id) throw new Error('No author document ID')
    return { app, page, id, pid: app.process().pid }
  }
  // These are the application's existing in-process document tools with a scoped
  // write run, not a filesystem rewrite or an emulated authoring model.
  const begin = async (app: ElectronApplication, id: string, runId: string) => app.evaluate(async ({ app }, input) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const host = load('./dist-electron/main/workbench/documentHost.js').documentHost()
    await host.tools.beginRun({ runId: input.runId, actor: 'agent', documents: [{ documentId: input.id, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
  }, { id, runId, workspace })
  const call = async (app: ElectronApplication, runId: string, name: string, input: Record<string, unknown>) => app.evaluate(async ({ app }, args) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    const host = load('./dist-electron/main/workbench/documentHost.js').documentHost()
    return host.tools.execute(args.runId, args.callId, { name: args.name, input: args.input })
  }, { runId, callId: randomUUID(), name, input })
  const stop = async (app: ElectronApplication, runId: string) => app.evaluate(async ({ app }, id) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
    await load('./dist-electron/main/workbench/documentHost.js').documentHost().tools.stop(id)
  }, runId)
  const sourceText = async (app: ElectronApplication, runId: string, sourcePath: string) => {
    const result = await call(app, runId, 'project.read', { path: sourcePath }) as { kind: string; data?: { content?: string; complete?: boolean } }
    if (result.kind !== 'read' || typeof result.data?.content !== 'string' || result.data.complete === false) throw new Error('Complete project.read required: ' + JSON.stringify(result))
    return result.data.content
  }
  let activeRun: string | undefined, app: ElectronApplication | undefined, page: Page | undefined
  try {
    const initial = await open(); ({ app, page } = initial)
    activeRun = 'reference-' + randomUUID(); await begin(app, initial.id, activeRun)
    const list = await call(app, activeRun, 'project.list', {})
    evidence.list = list
    for (const [label, change] of [['content', config.content], ['parameter', config.parameter]] as const) {
      evidence.phase = label
      const before = await sourceText(app, activeRun, change.path)
      if (before.split(change.before).length !== 2) throw new Error(`${label}: expected exactly one before match`)
      const result = await call(app, activeRun, 'project.apply', { path: change.path, content: before.replace(change.before, change.after) }) as { kind: string; data?: { commit?: string } }
      if (result.kind !== 'read' || result.data?.commit !== 'committed') throw new Error(`${label} not committed: ${JSON.stringify(result)}`)
      const after = await sourceText(app, activeRun, change.path)
      expect(after).toContain(change.after)
      evidence[label] = { path: change.path, before: change.before, after: change.after, result }
    }
    evidence.phase = 'add-section'
    const add = await call(app, activeRun, 'project.apply', { path: 'pages', intent: 'surface.add', kind: 'slide', title: '参考改造：延伸练习' }) as { kind: string; data?: { commit?: string; path?: string } }
    if (add.kind !== 'read' || add.data?.commit !== 'committed' || !add.data.path) throw new Error('Section add not committed: ' + JSON.stringify(add))
    evidence.add = add
    await stop(app, activeRun); activeRun = undefined
    evidence.phase = 'ui-save'
    expect((await page.evaluate(id => window.desktopAPI.documents!.read(id), initial.id)).dirty).toBe(true)
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await page!.evaluate(id => window.desktopAPI.documents!.read(id), initial.id)).dirty).toBe(false)
    const saved = await page.evaluate(id => window.desktopAPI.documents!.read(id), initial.id)
    await page.screenshot({ path: path.join(directory, '01-saved.png') })
    await closeM20(app); running = undefined; app = undefined
    evidence.phase = 'cold-reopen'
    const cold = await open(); ({ app, page } = cold)
    expect(cold.pid).not.toBe(initial.pid)
    const reopened = await page.evaluate(id => window.desktopAPI.documents!.read(id), cold.id)
    expect(reopened.model).toEqual(saved.model)
    expect(reopened.dirty).toBe(false)
    // The author surface reserves input for editing. Exercise the retained
    // interactive program through the formal whole-course preview instead.
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '整课预览', exact: true })).toBeVisible()
    const findPreviewFrame = async () => {
      for (const frame of page!.frames()) {
        if (!await frame.locator('#angleOut').count()) continue
        let outer = frame
        while (outer.parentFrame() && outer.parentFrame() !== page!.mainFrame()) outer = outer.parentFrame()!
        if (!outer.parentFrame()) continue
        const owner = await outer.frameElement()
        if (await owner.evaluate(element => element instanceof Element && Boolean(element.closest('[data-testid="course-preview-overlay"]')))) return frame
      }
      return undefined
    }
    await expect.poll(async () => Boolean(await findPreviewFrame()), { timeout: 30_000 }).toBe(true)
    const moonFrame = await findPreviewFrame()
    if (!moonFrame) throw new Error('Moon interaction frame disappeared')
    await expect(moonFrame.locator('#angleOut')).toHaveText('90°')
    await expect(moonFrame.locator('#fraction')).toHaveText('50%')
    await expect(moonFrame.getByText(config.content.after, { exact: true })).toBeVisible()
    await moonFrame.locator('#angle').focus()
    await moonFrame.locator('#angle').press('Home')
    await expect(moonFrame.locator('#angleOut')).toHaveText('0°')
    await expect(moonFrame.locator('#fraction')).toHaveText('0%')
    evidence.interaction = { coldDefaultAngle: 90, coldDefaultIllumination: '50%', homeAngle: 0, homeIllumination: '0%' }
    activeRun = 'reference-cold-' + randomUUID(); await begin(app, cold.id, activeRun)
    for (const change of [config.content, config.parameter]) expect(await sourceText(app, activeRun, change.path)).toContain(change.after)
    const coldList = await call(app, activeRun, 'project.list', {})
    expect(JSON.stringify(coldList)).toContain('参考改造：延伸练习')
    await stop(app, activeRun); activeRun = undefined
    expect(hash(await fs.readFile(source))).toBe(sourceHash)
    evidence.phase = 'complete'; evidence.status = 'passed'; evidence.initialPid = initial.pid; evidence.coldPid = cold.pid
    evidence.savedSha256 = hash(await fs.readFile(filename)); evidence.coldList = coldList
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.sourceUnchanged = hash(await fs.readFile(source)) === sourceHash
    if (page) await m20Evidence(info, fixture, page, evidence, error)
    else await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ ...evidence, error: String(error) }, null, 2))
    throw error
  } finally {
    if (app && activeRun) await stop(app, activeRun).catch(() => {})
    if (running) await closeM20(running.app)
  }
})
