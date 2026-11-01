import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const root = path.resolve(__dirname, '../..')
const packagedExecutable = process.env.GUOLING_PACKAGED_EXECUTABLE
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('the built App shows one common toolbar for program roots in both editor modes and uses the real navigation/reset owner', async () => {
  test.setTimeout(150_000)
  const out = await fs.mkdtemp(path.join(root, 'output/creation-execution-20261031/program-workspace-ui-'))
  const workspace = path.join(out, 'workspace'), profile = path.join(out, 'profile')
  await fs.mkdir(workspace); await fs.mkdir(profile)
  const project = createBlankCourseProjectV10('程序与幻灯混排')
  const slideId = project.rootIds[0]!
  project.instances[slideId]!.name = '相邻幻灯'
  project.definitions.program = { id: 'program', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
  project.instances['program-root'] = { id: 'program-root', definitionId: 'program', name: '程序实验', data: {
    html: '<style>html,body{margin:0;height:100%}main{height:100%;display:grid;place-items:center;background:#123b4c;color:white;font:28px sans-serif}button{font:inherit;padding:20px}</style><main><button id="advance">继续实验</button><output id="count">0</output></main><script>let count=0;document.getElementById("advance").onclick=()=>document.getElementById("count").textContent=String(++count)</script>',
  } }
  project.rootIds = ['program-root', slideId]; project.entry = { rootInstanceId: 'program-root' }
  const host = new DocumentHostService(path.join(out, 'fixture-recovery'))
  const document = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'program-mixed.glx')
  const filename = path.join(workspace, 'program-mixed.glx')
  await host.internalAPI.save(document.documentId, filename)
  const originalHash = digest(await fs.readFile(filename))
  await host.operate({ type: 'close', documentId: document.documentId, discardDirty: false })
  let app: ElectronApplication | undefined, page: Page | undefined
  const errors: string[] = [], remoteRequests: string[] = []
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    Object.assign(env, { VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0',
      ...(packagedExecutable ? { PATH: 'C:\\Windows\\System32;C:\\Windows' } : {}) })
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
      ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
      args: [...(packagedExecutable ? [] : ['.']), `--user-data-dir=${profile}`], env, timeout: 30_000 })
    const isPackaged = await app.evaluate(({ app }) => app.isPackaged)
    if (packagedExecutable) expect(isPackaged).toBe(true)
    page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
    await app.evaluate(({ BrowserWindow, dialog }, directory) => {
      const window = BrowserWindow.getAllWindows()[0]; window?.setContentSize(1600, 1000); window?.show(); window?.focus()
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'program-mixed.glx', exact: true }).dblclick()
    const editor = page.locator('.course-editor-frame:visible')
    await expect(editor).toBeVisible()
    const documentId = await editor.getAttribute('data-document-id'); expect(documentId).toBeTruthy()
    const read = () => page!.evaluate(id => window.desktopAPI.documents!.read(id), documentId!)
    const before = await read()
    const chrome = page.getByTestId('course-try-run-chrome')
    const program = page.getByTestId('program-workspace')
    const oneVisibleToolbar = async (name: string) => {
      await expect(chrome).toHaveCount(1); await expect(chrome).toBeVisible()
      const bounds = await chrome.boundingBox(); const viewport = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds).toBeTruthy(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
      await page!.screenshot({ path: path.join(out, `${name}.png`) })
    }
    await expect(program).toBeVisible(); await oneVisibleToolbar('01-light-program')
    await expect(chrome.getByRole('button', { name: '选择程序', exact: true })).toBeVisible()
    await expect(chrome.getByTestId('course-try-run-previous')).toBeDisabled()
    await expect(chrome.getByTestId('course-try-run-next')).toBeEnabled()
    await chrome.getByRole('button', { name: '试运行', exact: true }).click()
    await expect(chrome.getByRole('button', { name: '试运行', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const frame = page.frameLocator('[data-program-viewport] iframe').first()
    await frame.locator('#advance').click(); await expect(frame.locator('#count')).toHaveText('1')
    await chrome.getByRole('button', { name: '回到初始画面', exact: true }).click()
    await expect(frame.locator('#count')).toHaveText('0')
    await chrome.getByTestId('course-try-run-next').click()
    await expect(program).toHaveCount(0); await oneVisibleToolbar('02-light-slide')
    await expect(chrome.getByTestId('course-try-run-next')).toBeDisabled()
    await chrome.getByTestId('course-try-run-previous').click()
    await expect(program).toBeVisible(); await expect(frame.locator('#count')).toHaveText('0')
    await chrome.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(chrome.getByRole('button', { name: '编辑', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await editor.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
    await expect(editor).toHaveAttribute('data-editor-mode', 'deep')
    await expect(program).toBeVisible(); await oneVisibleToolbar('03-deep-program')
    await chrome.getByRole('button', { name: '选择程序', exact: true }).click()
    await chrome.getByRole('button', { name: '试运行', exact: true }).click()
    await frame.locator('#advance').click(); await expect(frame.locator('#count')).toHaveText('1')
    await chrome.getByRole('button', { name: '回到初始画面', exact: true }).click()
    await expect(frame.locator('#count')).toHaveText('0')
    const after = await read()
    expect(after.model).toEqual(before.model); expect(after.revision).toBe(before.revision)
    expect(digest(await fs.readFile(filename))).toBe(originalHash)
    expect(errors).toEqual([]); expect(remoteRequests).toEqual([])
    await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({ passed: true, fullBuiltApp: true, isPackaged,
      lightAndDeepVisible: true, exactlyOneToolbar: true, realProgramReset: true, mixedRootBothDirections: true,
      authorUnchanged: true, modelRequests: 0, errors, remoteRequests, sourceHash: originalHash,
      draftFailureGuard: 'separate focused current-owner regression; this UI consumer does not inject a failed transaction' }, null, 2))
    console.log(JSON.stringify({ programWorkspaceEvidence: out }))
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => undefined)
    await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), stack: error instanceof Error ? error.stack : '', errors, remoteRequests }, null, 2))
    throw error
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined) }
  }
})
