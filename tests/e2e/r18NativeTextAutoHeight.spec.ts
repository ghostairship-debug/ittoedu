import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { enterIndependentEditor } from './lessonWorkspaceEntry'

const root = resolve(__dirname, '../..')
const evidenceRoot = join(root, 'output/r18-native-text-autoheight')
const configuredInputArchive = process.env.R18_NATIVE_TEXT_INPUT?.trim()
const TITLE = '教师手工保留：现在的标题'
const titleId = 'native-title'

async function stateOf(page: Page) {
  return page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
    const { locateCourseLayer } = await load('/src/renderer/course/effectiveLayerCommands.ts')
    const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
    return { project: structuredClone(project), item: structuredClone(locateCourseLayer(project, id)?.item),
      past: state.slideBackend?.getSession().history.past.length, path: state.projectPath }
  }, titleId)
}

async function toolFontSize(page: Page, fontSize: number) {
  return page.evaluate(async ({ id, fontSize }) => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
    const { locateCourseLayer, makeEffectiveLayerAuthoringAddress } = await load('/src/renderer/course/effectiveLayerCommands.ts')
    const { courseAuthoringScopeFromLocation } = await load('/src/renderer/authoring/courseAuthoringScope.ts')
    const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state)
    const session = state.courseAuthoringSession, slide = state.slideBackend.getSession()
    const located = locateCourseLayer(project, id)
    const scope = courseAuthoringScopeFromLocation({ project, locationId: slide.selection.locationId,
      stateId: slide.selection.stateId, owner: located.source })
    return state.runAuthoringTool({ version: 1, requestId: crypto.randomUUID(), tool: 'native.content',
      input: { operation: 'edit', textStyle: { fontSize } }, destination: { kind: 'update', target: {
        projectId: project.id, documentRevision: project.revision, revisionPolicy: { kind: 'exact' },
        sessionGeneration: session.token.generation, surfaceType: 'slide', surfaceId: scope.surfaceId,
        locationId: scope.locationId, stateId: scope.stateId, owner: scope.owner, ownerKey: scope.ownerKey,
        itemId: id, authoringAddress: makeEffectiveLayerAuthoringAddress(project.id, located),
      } } })
  }, { id: titleId, fontSize })
}

async function selectTitle(page: Page) {
  await page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path)
    const { useEditorStore } = await load('/src/renderer/store/editorStore.ts')
    useEditorStore.getState().selectNodes([id])
  }, titleId)
  await page.getByRole('tab', { name: '属性', exact: true }).click()
}

test('Native auto-height: real tool and UI edits preserve text through history, reopen and fresh HTML', async () => {
  test.setTimeout(180_000)
  test.skip(!configuredInputArchive,
    '需要通过 R18_NATIVE_TEXT_INPUT 指定既有真实 auto-height T05 制品；默认跳过，不代表通过')
  if (!configuredInputArchive) return
  const inputArchive = resolve(configuredInputArchive)
  expect(existsSync(inputArchive),
    'R18_NATIVE_TEXT_INPUT 必须指向既有真实 .h5lesson 制品，不能重造替代').toBe(true)
  const runRoot = join(evidenceRoot, `ui-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'working-copy.h5lesson'), htmlPath = join(runRoot, 'fresh-text.html')
  copyFileSync(inputArchive, projectPath)
  const input = openCourseProjectArchive(readFileSync(projectPath)).project
  const errors: string[] = [], requests: string[] = []
  let server: ViteDevServer | undefined, app: ElectronApplication | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: {
      host: '127.0.0.1', port: 0, strictPort: false, hmr: false,
      watch: { ignored: ['**/output/**', '**/test-results/**'] },
    } })
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing Vite address')
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`], cwd: root,
      env: { ...process.env, COURSEWARE_E2E_BACKGROUND: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/` } })
    await expectBackgroundWindowsIsolated(app, true)
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    // 冷启动只进入独立编辑器面（判据见 tests/e2e/lessonWorkspaceEntry.ts）。
    await enterIndependentEditor(page)
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.project] })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.html })) as typeof dialog.showSaveDialog
    }, { project: projectPath, html: htmlPath })
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect.poll(async () => (await stateOf(page)).project.id).toBe(input.id)
    await selectTitle(page)
    const failedCopy = await stateOf(page)
    expect(failedCopy.item.content.data.style.fontSize).toBe(48)
    expect(failedCopy.item.frame.height).toBe(48.8)
    await page.screenshot({ path: join(runRoot, 'before-existing-clipping.png') })

    const prepare = await toolFontSize(page, 40)
    expect(prepare.status, JSON.stringify(prepare)).toBe('committed')
    const before = await stateOf(page)
    const receipt = await toolFontSize(page, 48)
    expect(receipt.status, JSON.stringify(receipt)).toBe('committed')
    const afterTool = await stateOf(page)
    expect(afterTool.past).toBe(before.past! + 1)
    expect(afterTool.item.frame).toMatchObject({ x: 260, y: 72, width: 760 })
    expect(afterTool.item.frame.height).toBeCloseTo(58.56)
    expect(afterTool.item.content.data.text).toBe(TITLE)
    await page.screenshot({ path: join(runRoot, 'after-native-tool-48.png') })
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    expect((await stateOf(page)).project).toEqual(before.project)
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    expect((await stateOf(page)).project).toEqual(afterTool.project)

    await selectTitle(page)
    await page.getByLabel('字号', { exact: true }).fill('52')
    await page.getByLabel('字号', { exact: true }).press('Tab')
    await expect.poll(async () => (await stateOf(page)).item.content.data.style.fontSize).toBe(52)
    expect((await stateOf(page)).item.frame.height).toBeCloseTo(63.44)
    const finalText = `${TITLE}\n人工改稿保留`
    const content = page.getByRole('textbox', { name: '文字内容', exact: true })
    await content.fill(finalText)
    await content.press('Tab')
    await expect.poll(async () => (await stateOf(page)).item.content.data.text).toBe(finalText)
    await page.getByLabel('行距', { exact: true }).fill('20')
    await page.getByLabel('行距', { exact: true }).press('Tab')
    await expect.poll(async () => (await stateOf(page)).item.content.data.style.lineSpacing).toBe(20)
    const final = await stateOf(page)
    expect(final.item.frame.height).toBeCloseTo(146.88)
    expect(final.project.surfaces[0].scenes[0].layerItems.filter((item: { layerItemId: string }) => item.layerItemId !== titleId))
      .toEqual(input.surfaces[0].type === 'slide' ? input.surfaces[0].scenes[0]!.layerItems.filter(item => item.layerItemId !== titleId) : [])
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => openCourseProjectArchive(readFileSync(projectPath)).project.revision).toBe(final.project.revision)
    await page.reload()
    await page.getByTestId('canvas-stage').locator('canvas').first().waitFor()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect.poll(async () => (await stateOf(page)).project.id).toBe(input.id)
    expect((await stateOf(page)).project).toEqual(final.project)
    await selectTitle(page)
    await page.screenshot({ path: join(runRoot, 'after-reopen.png') })
    await page.getByLabel('导出课件', { exact: true }).click()
    await page.getByTestId('export-single-html').click()
    const continueExport = page.getByRole('button', { name: '继续导出', exact: true })
    if (await continueExport.isVisible({ timeout: 1000 }).catch(() => false)) await continueExport.click()
    await expect.poll(() => existsSync(htmlPath) && readFileSync(htmlPath).length > 1000, { timeout: 45_000 }).toBe(true)
    browser = await chromium.launch({ headless: true })
    const player = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    player.on('pageerror', error => errors.push(error.message))
    player.on('request', request => { if (/^https?:/i.test(request.url())) requests.push(request.url()) })
    await player.context().setOffline(true)
    await player.goto(pathToFileURL(htmlPath).href)
    await expect(player.locator('[data-native-type="text"]').filter({ hasText: TITLE }).first()).toBeVisible()
    await expect(player.getByText('人工改稿保留', { exact: false })).toBeVisible()
    await player.screenshot({ path: join(runRoot, 'offline-fresh-html.png') })
    await expectBackgroundWindowsIsolated(app, true)
    expect(errors).toEqual([])
    expect(requests).toEqual([])
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ inputArchive, projectPath, htmlPath,
      modelCalls: 0, renderer: 'Vite development renderer; real Electron Main/IPC/UI and native authoring tool',
      failedCopy, before, prepare, receipt, afterTool, final, errors, requests }, null, 2))
    writeFileSync(join(evidenceRoot, 'latest-ui.json'), JSON.stringify({ runRoot }, null, 2))
  } finally {
    await browser?.close()
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy())
        setTimeout(() => electronApp.exit(0), 0)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    await server?.close()
  }
})
