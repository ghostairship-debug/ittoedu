import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const root = resolve(__dirname, '../..')
const fileName = 'author-fields.glx'
const htmlOriginal = 'Source HTML 原标题'
const htmlChanged = '现场修改后的 HTML 标题'
const recordOriginal = 'Primitive Source 原标题'
const recordChanged = '作者记录保存后的标题'
const htmlNeighbor = 'HTML 邻文保持原样'
const recordNeighbor = 'Primitive 邻文保持原样'
const html = `<h2 id="html-title">${htmlOriginal}</h2><p id="html-neighbor">${htmlNeighbor}</p>`
const htmlSource = `export default { mount({root,instance}) {
  root.style.cssText='box-sizing:border-box;padding:24px;color:#18352a;background:#f2f8f4;font:20px sans-serif';
  const render=next=>{root.innerHTML=next.data.html}; render(instance);
  return {update:render,dispose(){root.replaceChildren()}};
} }`
const primitiveSource = `export default { mount({root}) {
  root.style.cssText='box-sizing:border-box;padding:24px;color:#233b5b;background:#f0f5fc;font:20px sans-serif';
  const render=()=>{root.innerHTML='<h2 id="record-title">${recordOriginal}</h2><p id="record-neighbor">${recordNeighbor}</p>'}; render();
  return {update:render,dispose(){root.replaceChildren()}};
} }`

function fixture(): CourseProjectV10 {
  const project = createBlankCourseProjectV10('A01–A03 作者字段 GUI 小样')
  project.definitions.web = { ...WEB_DEFINITION, id: 'web' }
  project.definitions.primitive = { id: 'primitive', role: 'content', implementation: { kind: 'source', language: 'javascript', source: primitiveSource } }
  project.instances.html = { id: 'html', name: 'HTML Source 标题', definitionId: 'web', data: { html },
    implementationOverride: { kind: 'source', language: 'javascript', source: htmlSource },
    frame: { width: 520, height: 200, transform: [1, 0, 0, 1, 70, 100] } }
  project.instances.primitive = { id: 'primitive', name: 'Primitive Source 标题', definitionId: 'primitive', data: 17,
    frame: { width: 520, height: 200, transform: [1, 0, 0, 1, 660, 100] } }
  project.surfaces[0].childIds = ['html', 'primitive']
  return project
}

async function launch(profile: string, workspace: string) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow, dialog }, directory) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { buttons: string[] }
      const response = options.buttons.indexOf('退出')
      if (response < 0) throw new Error(`Unexpected dialog: ${options.buttons.join(',')}`)
      return { response, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
  await page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: fileName, exact: true }).dblclick()
  const frame = page.locator('.course-editor-frame:visible')
  await expect(frame).toBeVisible()
  if (await frame.getAttribute('data-editor-mode') !== 'deep') await frame.getByRole('button', { name: '在编辑器中打开', exact: true }).click()
  await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
  const documentId = await frame.getAttribute('data-document-id')
  if (!documentId) throw new Error('Opened V10 editor has no document identity')
  return { app, page, documentId }
}

async function read(page: Page, documentId: string) {
  const snapshot = await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected the V10 document Session')
  return { ...snapshot, model: snapshot.model }
}

function rendered(page: Page, instanceId: string, selector: string): Locator {
  return page.locator(`.course-editor-frame:visible [data-component-instance="${instanceId}"]`)
    .frameLocator('iframe[title="组件内容"]').locator(selector)
}

async function visibleTitlePoint(page: Page, instanceId: string, selector: string, facts?: Record<string, unknown>) {
  const target = rendered(page, instanceId, selector)
  // The fixture's title is the first DOM field. Its visible host hotspot is an
  // observation; the canvas hit plane owns the actual mouse event routing.
  const hotspot = page.locator(`.course-editor-frame:visible button[data-author-spot^="${instanceId}:"]`).first()
  await expect(hotspot).toBeVisible()
  const frame = page.locator(`.course-editor-frame:visible [data-component-instance="${instanceId}"] iframe[title="组件内容"]`)
  await expect(frame).toBeVisible()
  // Use the product's real top-level author hotspot, avoiding Chromium's inaccurate
  // iframe locator boundingBox under canvas CSS scaling. No synthetic input events.
  let point = { x: 0, y: 0 }
  await expect.poll(async () => {
    const local = await target.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: window.innerWidth, height: window.innerHeight }))
    const outer = await frame.evaluate(node => node.getBoundingClientRect().toJSON())
    const host = await hotspot.evaluate(node => node.getBoundingClientRect().toJSON())
    point = { x: host.x + Math.min(host.width / 2, 110), y: host.y + host.height / 2 }
    const spots = await page.getByRole('button', { name: '双击编辑此处文字', exact: true }).evaluateAll((nodes, point) => nodes
      .map(node => node.getBoundingClientRect().toJSON()).filter(rect => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom), point)
    if (facts) facts[`${instanceId}InputTarget`] = { local, outer, host, point, spots }
    // Initial author reports can precede measured layout and expose minimum-size placeholders.
    // Wait for this fixture's real heading geometry, not an arbitrary sleep or wider timeout.
    return Math.abs(host.width - local.rect.width * outer.width / local.width) < 2 && spots.length === 1
  }, { message: 'The heading hotspot must match the actual rendered heading geometry' }).toBe(true)
  return point
}

async function editVisibleTitle(page: Page, instanceId: string, selector: string, before: string, after: string, facts: Record<string, unknown>) {
  const target = rendered(page, instanceId, selector)
  await expect(target).toHaveText(before)
  const point = await visibleTitlePoint(page, instanceId, selector, facts)
  await page.mouse.dblclick(point.x, point.y)
  const input = page.getByRole('textbox', { name: '编辑此处文字', exact: true })
  await expect(input).toHaveValue(before)
  await input.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(after)
  await expect(input).toHaveValue(after)
  await page.keyboard.press('Control+Enter')
  await expect(input).toHaveCount(0)
  await expect(target).toHaveText(after)
}

function expectOwners(project: CourseProjectV10, changed: boolean) {
  expect(project.instances.html.data).toEqual({ html: changed ? html.replace(htmlOriginal, htmlChanged) : html })
  expect(project.instances.html.implementationOverride).toEqual({ kind: 'source', language: 'javascript', source: htmlSource })
  expect(project.instances.primitive.data).toBe(17)
  expect(project.definitions.primitive.implementation).toEqual({ kind: 'source', language: 'javascript', source: primitiveSource })
}

async function expectVisible(page: Page, htmlTitle: string, recordTitle: string) {
  await expect(rendered(page, 'html', '#html-title')).toHaveText(htmlTitle)
  await expect(rendered(page, 'html', '#html-neighbor')).toHaveText(htmlNeighbor)
  await expect(rendered(page, 'primitive', '#record-title')).toHaveText(recordTitle)
  await expect(rendered(page, 'primitive', '#record-neighbor')).toHaveText(recordNeighbor)
  await visibleTitlePoint(page, 'html', '#html-title')
  await visibleTitlePoint(page, 'primitive', '#record-title')
}

async function normalQuit(app: ElectronApplication) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

test('A01–A03 real Source title input writes the exact owner, supports history, and survives save and a cold host', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const base = join(root, 'output/playwright/audit-author-fields-20261014')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, fileName)
  const project = fixture()
  writeFileSync(file, createCourseProjectV10Archive({ project, resources: { assets: {}, components: {} } }))
  const facts: Record<string, unknown> = { file, paidCalls: 0, existingUserWorkModified: false, input: 'Electron mouse.dblclick and keyboard; no dispatchEvent' }
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    let view = await launch(join(directory, 'profile-author'), workspace)
    app = view.app; page = view.page
    facts.initial = await read(page, view.documentId)
    await expectVisible(page, htmlOriginal, recordOriginal)
    await editVisibleTitle(page, 'html', '#html-title', htmlOriginal, htmlChanged, facts)
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(1)
    const afterHtml = await read(page, view.documentId)
    facts.afterHtml = afterHtml
    expectOwners(afterHtml.model.project, true)
    expect(afterHtml.model.project.instances.primitive.authoring?.records ?? {}).toEqual({})
    await editVisibleTitle(page, 'primitive', '#record-title', recordOriginal, recordChanged, facts)
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(2)
    const afterRecord = await read(page, view.documentId)
    facts.afterRecord = afterRecord
    expectOwners(afterRecord.model.project, true)
    const records = Object.entries(afterRecord.model.project.instances.primitive.authoring?.records ?? {})
    expect(records).toHaveLength(1)
    expect(records[0][1]).toMatchObject({ kind: 'text', binding: { kind: 'dom', baseline: recordOriginal }, overrides: { text: recordChanged } })
    facts.authorKey = records[0][0]
    await expectVisible(page, htmlChanged, recordChanged)
    await page.screenshot({ path: join(directory, 'edited.png'), fullPage: true })

    await page.keyboard.press('Control+z')
    await expect.poll(async () => ({ undo: (await read(view.page, view.documentId)).undoDepth, redo: (await read(view.page, view.documentId)).redoDepth }))
      .toEqual({ undo: 1, redo: 1 })
    const undone = await read(page, view.documentId)
    expectOwners(undone.model.project, true)
    expect(undone.model.project.instances.primitive.authoring?.records ?? {}).toEqual({})
    await expectVisible(page, htmlChanged, recordOriginal)
    facts.undone = undone
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(2)
    const redone = await read(page, view.documentId)
    expect(redone.model.project.instances).toEqual(afterRecord.model.project.instances)
    await expectVisible(page, htmlChanged, recordChanged)
    facts.redone = redone

    await page.keyboard.press('Control+s')
    await expect.poll(async () => ({ dirty: (await read(view.page, view.documentId)).dirty, saving: (await read(view.page, view.documentId)).saving }))
      .toEqual({ dirty: false, saving: false })
    const saved = await read(page, view.documentId)
    const archive = openCourseProjectV10Archive(new Uint8Array(readFileSync(file)))
    expect(archive.project.instances).toEqual(saved.model.project.instances)
    expectOwners(archive.project, true)
    facts.saved = saved
    await normalQuit(app); app = undefined
    facts.firstNormalQuit = true

    // A new process and new profile prove file persistence independently of recovery/view-state.
    view = await launch(join(directory, 'profile-cold'), workspace)
    app = view.app; page = view.page
    const reopened = await read(page, view.documentId)
    expect(reopened).toMatchObject({ dirty: false, undoDepth: 0, redoDepth: 0, revision: saved.revision })
    expect(reopened.model.project.instances).toEqual(saved.model.project.instances)
    expectOwners(reopened.model.project, true)
    await expectVisible(page, htmlChanged, recordChanged)
    await page.screenshot({ path: join(directory, 'cold-reopened.png'), fullPage: true })
    facts.reopened = reopened
    await normalQuit(app); app = undefined
    facts.secondNormalQuit = true
    facts.result = 'pass'
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('Source author-field GUI facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
  } catch (error) {
    facts.result = 'fail'; facts.error = String(error)
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
      writeFileSync(join(directory, 'failure-dom.html'), await page.content().catch(() => 'DOM unavailable'))
      facts.ui = await page.evaluate(() => ({
        frames: [...document.querySelectorAll('.course-editor-frame')].map(node => ({ mode: node.getAttribute('data-editor-mode'), documentId: node.getAttribute('data-document-id') })),
        spots: [...document.querySelectorAll('.canvas-authoring-target')].map(node => ({ label: node.getAttribute('aria-label'), rect: node.getBoundingClientRect().toJSON() })),
        inputs: [...document.querySelectorAll('input,textarea')].map(node => ({ label: node.getAttribute('aria-label'), value: (node as HTMLInputElement).value })),
      })).catch(() => ({ unavailable: true }))
    }
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('Source author-field GUI failure facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    throw error
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app?.close().catch(() => undefined)
  }
})
