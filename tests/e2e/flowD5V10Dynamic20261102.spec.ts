import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { sampleFlowD5 } from './helpers/flowD5Sampling'
import { makeFlowD5Archive } from '../helpers/flowD5Fixture'

const root = resolve(__dirname, '../..')

test('D5 current Flow Source runtime converges in the real app and survives independent cold reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Actual workbench acceptance runs on Windows.')
  test.setTimeout(180_000)
  const out = info.outputPath('flow-d5-v10'), workspace = join(out, 'workspace'), profile = join(out, 'profile')
  await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(profile, { recursive: true })
  const name = 'D5-动态组件.glx', filename = join(workspace, name)
  await fs.writeFile(filename, makeFlowD5Archive(), { flag: 'wx' })
  const facts: Record<string, unknown> = { started: new Date().toISOString(), samples: [], fixture: 'V10 Flow Source in app' }
  const samples = facts.samples as unknown[]
  const errors: string[] = []
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' })
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined, page: Page | undefined, phase = 'launch'
  const close = async () => { if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); app = undefined } }
  const launch = async () => {
    app = await electron.launch({ cwd: root, args: ['.', '--user-data-dir=' + profile], env, timeout: 30_000 })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const win = BrowserWindow.getAllWindows()[0]; win?.setContentSize(1500, 1000); win?.show(); win?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name, exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible'); await expect(editor).toBeVisible()
    const open = editor.getByRole('button', { name: '在编辑器中打开', exact: true })
    if (await open.count()) await open.click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    const id = await editor.getAttribute('data-document-id'); if (!id) throw new Error('No document session')
    return { id, pid: app.process().pid }
  }
  try {
    const first = await launch(), activePage = page!
    const read = async (id: string) => activePage.evaluate(documentId => window.desktopAPI.documents!.read(documentId), id)
    const history = async () => { const s = await read(first.id); return { revision: s.revision, undoDepth: s.undoDepth, redoDepth: s.redoDepth } }
    phase = 'run-mode'
    await activePage.getByTestId('course-try-run-chrome').getByRole('button', { name: '试运行', exact: true }).click()
    const selector = '[data-flow-block-id="d5-widget"] iframe'
    const blockSelector = '[data-flow-block-id="d5-widget"]'
    const tailSelector = '[data-flow-block-id="d5-tail"]'
    const iframe = activePage.locator(selector).filter({ visible: true }), content = activePage.frameLocator(selector + ':visible')
    await expect(iframe).toBeVisible()
    await expect(content.getByRole('button', { name: '增长文字', exact: true })).toBeVisible()
    const one = async (name: string, act: () => Promise<void>, effect: 'height' | 'width') => {
      try {
        const before = await iframe.boundingBox()
        const result = await sampleFlowD5(activePage, name, { iframe: selector, block: blockSelector, tail: tailSelector }, act, history)
        const after = await iframe.boundingBox()
        if (!before || !after || Math.abs(before[effect] - after[effect]) <= .5) result.issues.push(`no effective iframe ${effect} change; scenario not exercised`)
        result.passed = result.issues.length === 0
        samples.push({ ...result, before, after })
      } catch (error) { samples.push({ name, passed: false, issues: [String(error)] }) }
      await activePage.screenshot({ path: join(out, name + '.png') }).catch(() => {})
      await fs.writeFile(join(out, 'result.json'), JSON.stringify(facts, null, 2))
    }
    phase = 'dynamic-interactions'
    await one('01-text-growth', async () => { await content.getByRole('button', { name: '增长文字', exact: true }).click() }, 'height')
    await one('02-expand', async () => { await content.getByRole('button', { name: '展开内容', exact: true }).click() }, 'height')
    await one('03-collapse', async () => { await content.getByRole('button', { name: '收起内容', exact: true }).click() }, 'height')
    await one('04-continuous-width', async () => { for (const width of [1400, 1250, 1100, 950, 1150]) await app!.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, 1000), width) }, 'width')
    await one('05-narrow', async () => { await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(700, 1000)) }, 'width')
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 1000))
    phase = 'save'; await activePage.getByTestId('course-try-run-chrome').getByRole('button', { name: '编辑', exact: true }).click()
    await activePage.keyboard.press('Control+s'); await expect.poll(async () => (await read(first.id)).dirty).toBe(false)
    const saved = await read(first.id)
    if (saved.model.kind !== 'course-v10') throw new Error('Unexpected model')
    await activePage.screenshot({ path: join(out, '06-saved.png') })
    await close()
    phase = 'cold-reopen'; const cold = await launch(); expect(cold.pid).not.toBe(first.pid)
    const reopened = await page!.evaluate(id => window.desktopAPI.documents!.read(id), cold.id)
    if (reopened.model.kind !== 'course-v10') throw new Error('Unexpected reopened model')
    expect(reopened.model.project).toEqual(saved.model.project)
    await page!.screenshot({ path: join(out, '07-cold.png') })
    facts.savedAndColdOpened = true; facts.errors = errors; facts.pid = first.pid; facts.coldPid = cold.pid
    await fs.writeFile(join(out, 'result.json'), JSON.stringify(facts, null, 2))
    expect(errors).toEqual([]); expect(samples).toHaveLength(5); expect(samples.filter((sample: any) => !sample.passed)).toEqual([])
  } catch (error) {
    facts.phase = phase; facts.failure = String(error); facts.errors = errors
    await page?.screenshot({ path: join(out, 'failure.png') }).catch(() => {})
    await fs.writeFile(join(out, 'result.json'), JSON.stringify(facts, null, 2)); throw error
  } finally { await close() }
})

