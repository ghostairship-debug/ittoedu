import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../../../src/core/drivers/codecs/courseProjectV10Archive'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')
async function launch(profile: string, workspace: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow, dialog }, directory) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { buttons: string[] }
      const preserve = options.buttons.indexOf('保留恢复稿并关闭')
      const exit = options.buttons.indexOf('退出')
      if (preserve < 0 && exit < 0) throw new Error(`Unexpected close dialog: ${options.buttons.join(',')}`)
      return { response: preserve >= 0 ? preserve : exit, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: 'drafts.h5lesson', exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  return { app, page }
}
async function select(page: Page, id: string) {
  const rail = page.locator('.course-editor-frame:visible').getByRole('complementary', { name: '编辑面板', exact: true })
  await expect(rail).toBeVisible()
  const layers = rail.getByRole('tab', { name: '图层', exact: true })
  if (await layers.getAttribute('aria-expanded') !== 'true') await layers.click()
  await page.getByTestId(`node-item-${id}`).locator('.node-name').click()
  await expect(page.getByTestId(`node-item-${id}`)).toHaveClass(/node-item--selected/)
}
async function forceCleanup(app?: ElectronApplication) {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
}

test('T03 real GUI preserves half JSON and numeric raw at normal close and restores original targets in a cold process while valid source stays editable', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const base = join(root, 'output/productFollowup/T03'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'visible-recovery-')), workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const project = createBlankCourseProjectV10('Draft recovery')
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'code', entry: 'main.js' } } }
  project.definitions.canvas = { id: 'canvas', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "export default {mount({root,instance,authoring}) {root.textContent=instance.data.label;const release=authoring?.register({kind:'text',dataPath:['label'],initialValue:instance.data.label,localBounds:{width:180,height:80,transform:[1,0,0,1,0,0]}});return {update(next){root.textContent=next.data.label},dispose(){release?.();root.replaceChildren()}}}}" } }
  project.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
  project.instances.source = { id: 'source', name: 'Source target', definitionId: 'custom', data: {}, frame: { width: 160, height: 80, transform: [1, 0, 0, 1, 30, 40] } }
  project.instances.text = { id: 'text', name: 'Teacher text', definitionId: 'text', data: createTextComponentData('Keep teacher text'), frame: { width: 200, height: 80, transform: [1, 0, 0, 1, 250, 40] } }
  project.instances.canvas = { id: 'canvas', name: 'Canvas teacher target', definitionId: 'canvas', data: { label: 'Canvas teacher original' }, frame: { width: 180, height: 80, transform: [1, 0, 0, 1, 250, 190] } }
  project.surfaces[0].childIds = ['source', 'text', 'canvas']
  const filename = join(workspace, 'drafts.h5lesson')
  writeFileSync(filename, createCourseProjectV10Archive({ project, resources: { assets: {}, components: { code: { 'main.js': new TextEncoder().encode("export default {mount({root}){root.textContent='42';return {update(){},dispose(){}}}}") } } } }))
  const sourceText = "export default {mount({root}){root.textContent='85';return {update(){},dispose(){}}}}", halfJson = '{"data":', canvasRaw = '尚未完成的画布拼音稿'
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    let view = await launch(profile, workspace); app = view.app; page = view.page
    await select(view.page, 'source')
    await view.page.getByRole('tab', { name: '开发', exact: true }).click()
    await view.page.getByRole('tab', { name: /组件代码/ }).click()
    await view.page.getByRole('tab', { name: '共享定义源码', exact: true }).click()
    const initialDetails = view.page.locator('details').filter({ has: view.page.locator('summary', { hasText: '共享定义源码' }) })
    if (await initialDetails.getAttribute('open') === null) await initialDetails.locator('summary').click()
    await view.page.getByRole('textbox', { name: '组件实现源码', exact: true }).fill(sourceText)
    await select(view.page, 'text')
    await view.page.getByRole('tab', { name: '开发', exact: true }).click()
    await view.page.getByRole('tab', { name: /对象 JSON/ }).click()
    await view.page.getByRole('textbox', { name: '所选对象 · Teacher text', exact: true }).fill(halfJson)
    await view.page.getByRole('tab', { name: '属性', exact: true }).click()
    await view.page.getByLabel('X', { exact: true }).fill('-')
    await select(view.page, 'canvas')
    await view.page.getByRole('button', { name: '双击编辑此处文字', exact: true }).click()
    const canvasInput = view.page.getByRole('textbox', { name: '编辑此处文字', exact: true })
    await expect(canvasInput).toHaveValue('Canvas teacher original')
    await canvasInput.dispatchEvent('compositionstart')
    await canvasInput.fill(canvasRaw)
    const id = await view.page.locator('.course-editor-frame:visible').getAttribute('data-document-id')
    const before = await view.page.evaluate(id => window.desktopAPI.documents!.read(id!), id)
    expect(before.undoDepth).toBe(1)
    expect(before.model).toMatchObject({ kind: 'course-v10', project: { instances: { text: { frame: { transform: [1, 0, 0, 1, 250, 40] } } } } })
    const exited = app.waitForEvent('close')
    await app.evaluate(({ app }) => app.quit())
    await exited; app = undefined
    expect(openCourseProjectV10Archive(new Uint8Array(readFileSync(filename))).project.instances.text.frame?.transform[4]).toBe(250)
    view = await launch(profile, workspace); app = view.app; page = view.page
    await expect(view.page.getByRole('textbox', { name: '编辑此处文字', exact: true })).toHaveValue(canvasRaw)
    await select(view.page, 'text')
    await view.page.getByRole('tab', { name: '属性', exact: true }).click()
    await expect(view.page.getByLabel('X', { exact: true })).toHaveValue('-')
    await view.page.getByRole('tab', { name: '开发', exact: true }).click()
    await view.page.getByRole('tab', { name: /对象 JSON/ }).click()
    await expect(view.page.getByRole('textbox', { name: '所选对象 · Teacher text', exact: true })).toHaveValue(halfJson)
    const coldId = await view.page.locator('.course-editor-frame:visible').getAttribute('data-document-id')
    const restored = await view.page.evaluate(id => window.desktopAPI.documents!.read(id!), coldId)
    expect(restored.undoDepth).toBe(before.undoDepth)
    expect(restored.model).toMatchObject({ kind: 'course-v10', project: { instances: { canvas: project.instances.canvas } } })
    expect(restored.model).toMatchObject({ kind: 'course-v10', project: { instances: { text: { frame: { transform: [1, 0, 0, 1, 250, 40] } } } } })
    await select(view.page, 'source')
    await view.page.getByRole('tab', { name: '开发', exact: true }).click()
    await view.page.getByRole('tab', { name: /组件代码/ }).click()
    await view.page.getByRole('tab', { name: '共享定义源码', exact: true }).click()
    const details = view.page.locator('details').filter({ has: view.page.locator('summary', { hasText: '共享定义源码' }) })
    if (await details.getAttribute('open') === null) await details.locator('summary').click()
    await expect(view.page.getByRole('textbox', { name: '组件实现源码', exact: true })).toHaveValue(sourceText)
    await view.page.screenshot({ path: join(directory, 'cold-source.png'), fullPage: true })
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ before, restored, paidCalls: 0, normalQuit: true }, null, 2))
  } catch (error) {
    if (page && !page.isClosed()) {
      const screenshot = join(directory, 'failure.png'), dom = join(directory, 'failure-dom.html'), facts = join(directory, 'failure-ui-facts.json')
      await page.screenshot({ path: screenshot, fullPage: true }).then(() => testInfo.attach('T03 failure screenshot', { path: screenshot, contentType: 'image/png' })).catch(() => undefined)
      const html = await page.content().catch(() => 'DOM unavailable'); writeFileSync(dom, html)
      await testInfo.attach('T03 failure DOM', { path: dom, contentType: 'text/html' })
      const ui = await page.evaluate(() => ({ frames: [...document.querySelectorAll('.course-editor-frame')].map(node => ({ mode: node.getAttribute('data-editor-mode'), documentId: node.getAttribute('data-document-id') })),
        tabs: [...document.querySelectorAll('[role="tab"]')].map(node => ({ name: node.textContent, expanded: node.getAttribute('aria-expanded'), selected: node.getAttribute('aria-selected'), visible: (node as HTMLElement).offsetWidth > 0 })),
        selectedRows: [...document.querySelectorAll('.node-item--selected')].map(node => node.getAttribute('data-testid')),
        targets: [...document.querySelectorAll('.canvas-authoring-target')].map(node => ({ label: node.getAttribute('aria-label'), visible: (node as HTMLElement).offsetWidth > 0, rect: node.getBoundingClientRect().toJSON() })),
        inputs: [...document.querySelectorAll('input,textarea')].map(node => ({ label: node.getAttribute('aria-label'), value: (node as HTMLInputElement).value })) })).catch(() => ({ unavailable: true }))
      writeFileSync(facts, JSON.stringify({ error: String(error), ui }, null, 2))
      await testInfo.attach('T03 failure UI facts', { path: facts, contentType: 'application/json' })
    }
    throw error
  } finally { await forceCleanup(app) }
})
