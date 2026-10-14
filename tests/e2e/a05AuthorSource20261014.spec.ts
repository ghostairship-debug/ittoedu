import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

// Candidate is integrated at tests/e2e before running. No existing course is opened.
const root = resolve(__dirname, '../..')
const fileName = 'a05-author-source.glx'
const originalTitle = '同一份 Web 内容'
const changedTitle = '普通编辑接续源码定制'
const neighborText = '同一数据，实例各自运行'
const html = `<article>
  <h2 id="title">${originalTitle}</h2><p id="neighbor">${neighborText}</p>
  <img id="scene" src="cw-resource:scene" alt="工程内的绿色山丘" width="120" height="72">
  <div class="actions"><button id="module-button" type="button">本地模块 +1</button><output id="module-state">模块计数 0</output></div>
  <div class="actions"><button id="source-button" type="button">默认按钮</button><output id="source-state">共享默认实例</output></div>
</article><script type="module" src="./counter.js"></script>`
const css = `*{box-sizing:border-box}body{margin:0;color:#18352a;font:20px sans-serif}article{padding:24px;background:#f0f7f3;min-height:340px;border:2px solid #c7e0d0;border-radius:16px}h2{font-size:26px;margin:0 0 12px}p{margin:0 0 16px}img{display:block;margin-bottom:14px}.actions{display:flex;align-items:center;gap:14px;margin:10px 0}button{border:0;border-radius:8px;padding:9px 13px;background:#23764d;color:white;font:18px sans-serif}output{font-size:18px}`
const modules = { 'counter.js': `let count=0;const button=document.getElementById('module-button');const output=document.getElementById('module-state');button.addEventListener('click',()=>{output.textContent='模块计数 '+(++count)});` }
const image = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72" viewBox="0 0 120 72"><rect width="120" height="72" rx="8" fill="#d5eef5"/><circle cx="96" cy="18" r="10" fill="#f6c854"/><path d="M0 65L34 18L68 58L95 31L120 62V72H0Z" fill="#398b61"/></svg>')
const customSource = `import implementation from './implementation';

export default {
  ...implementation,
  async mount(context) {
    const mounted = await implementation.mount(context);
    const root = context.root;
    let count = 0;
    const decorate = () => {
      root.querySelector('#source-button').textContent = '源码 +1';
      root.querySelector('#source-state').textContent = '源码计数 ' + count;
    };
    const click = event => {
      if (event.target.closest('#source-button')) { count += 1; decorate(); }
    };
    root.addEventListener('click', click);
    context.scope.cleanup(() => root.removeEventListener('click', click));
    decorate();
    return {
      ...mounted,
      async update(next) { await mounted.update(next); decorate(); },
    };
  },
};
`

function fixture() {
  const project = createBlankCourseProjectV10('A05 作者入口与相邻实例')
  project.definitions.web = { ...WEB_DEFINITION, id: 'web' }
  project.assets.scene = { id: 'scene', kind: 'image', filename: 'scene.svg', path: 'assets/scene.svg',
    mimeType: 'image/svg+xml', byteLength: image.byteLength, width: 120, height: 72 }
  const data = { html, css, modules, resourceBindings: { 'cw-resource:scene': 'scene' } }
  project.instances.primary = { id: 'primary', name: 'A05 定制实例', definitionId: 'web', data: structuredClone(data),
    frame: { width: 540, height: 380, transform: [1, 0, 0, 1, 50, 100] } }
  project.instances.neighbor = { id: 'neighbor', name: 'A05 邻实例', definitionId: 'web', data: structuredClone(data),
    frame: { width: 540, height: 380, transform: [1, 0, 0, 1, 660, 100] } }
  project.surfaces[0].childIds = ['primary', 'neighbor']
  return { project, resources: { assets: { scene: image }, components: {} } }
}

async function launch(profile: string, workspace: string) {
  mkdirSync(profile, { recursive: true })
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '0' } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow, dialog }, directory) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setContentSize(1600, 1000)
    window?.show(); window?.focus()
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

function iframe(page: Page, instanceId: string) {
  return page.locator(`.course-editor-frame:visible [data-component-instance="${instanceId}"] iframe[title="组件内容"]`)
}
function rendered(page: Page, instanceId: string, selector: string): Locator {
  return iframe(page, instanceId).contentFrame().locator(selector)
}

async function visibleTitlePoint(page: Page, instanceId: string, facts?: Record<string, unknown>) {
  const target = rendered(page, instanceId, '#title')
  const hotspot = page.locator(`.course-editor-frame:visible button[data-author-spot^="${instanceId}:"]`).first()
  await expect(hotspot).toBeVisible()
  let point = { x: 0, y: 0 }
  await expect.poll(async () => {
    const local = await target.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), width: window.innerWidth }))
    const outer = await iframe(page, instanceId).evaluate(node => node.getBoundingClientRect().toJSON())
    const host = await hotspot.evaluate(node => node.getBoundingClientRect().toJSON())
    point = { x: host.x + Math.min(host.width / 2, 110), y: host.y + host.height / 2 }
    const spots = await page.getByRole('button', { name: '双击编辑此处文字', exact: true }).evaluateAll((nodes, point) => nodes
      .map(node => node.getBoundingClientRect().toJSON()).filter(rect => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom), point)
    if (facts) facts[`${instanceId}TitleTarget`] = { local, outer, host, point }
    return Math.abs(host.width - local.rect.width * outer.width / local.width) < 2 && spots.length === 1
  }, { message: 'The title hotspot must match the rendered title before real mouse input' }).toBe(true)
  return point
}

async function clickContent(page: Page, instanceId: string, selector: string, facts: Record<string, unknown>) {
  const target = rendered(page, instanceId, selector)
  await expect(target).toBeVisible()
  const outer = await iframe(page, instanceId).evaluate(node => {
    const frame = node as HTMLIFrameElement
    return { rect: frame.getBoundingClientRect().toJSON(), width: frame.offsetWidth, height: frame.offsetHeight,
      left: frame.clientLeft, top: frame.clientTop }
  })
  const inner = await target.evaluate(node => node.getBoundingClientRect().toJSON())
  const mainBox = await iframe(page, instanceId).boundingBox()
  if (!mainBox) throw new Error('The content frame has no main-page pointer box')
  const cssPoint = { x: outer.rect.x + (outer.left + inner.x + inner.width / 2) * outer.rect.width / outer.width,
    y: outer.rect.y + (outer.top + inner.y + inner.height / 2) * outer.rect.height / outer.height }
  const point = { x: mainBox.x + (outer.left + inner.x + inner.width / 2) * mainBox.width / outer.width,
    y: mainBox.y + (outer.top + inner.y + inner.height / 2) * mainBox.height / outer.height }
  const parentHit = await page.evaluate(point => {
    const hit = document.elementFromPoint(point.x, point.y)
    return { tag: hit?.tagName, id: hit?.id, className: hit?.className,
      instance: hit?.closest('[data-component-instance]')?.getAttribute('data-component-instance') }
  }, point)
  const contentHit = await target.evaluate(node => {
    const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return { tag: hit?.tagName, id: hit?.id,
      activity: (window as Window & { __guolingRuntimeActivity?: unknown }).__guolingRuntimeActivity }
  })
  const identityBefore = await iframe(page, instanceId).evaluate(node => ({ name: node.getAttribute('name'), src: node.getAttribute('src'),
    ancestors: [...(function* () { let current: Element | null = node; while (current) { yield current; current = current.parentElement } })()]
      .map(element => ({ tag: element.tagName, className: element.className, pointerEvents: getComputedStyle(element).pointerEvents })) }))
  // Observe the trusted event delivered by mouse.click; never synthesize user input.
  await target.evaluate(() => {
    const record: unknown[] = []
    const listener = (event: MouseEvent) => record.push({ type: event.type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
      target: (event.target as Element)?.tagName, id: (event.target as Element)?.id })
    for (const name of ['pointerdown', 'pointerup', 'click'] as const) window.addEventListener(name, listener, true)
    Object.assign(window, { __a05Pointer: { record, release: () => {
      for (const name of ['pointerdown', 'pointerup', 'click'] as const) window.removeEventListener(name, listener, true)
    } } })
  })
  await page.evaluate(() => {
    const record: unknown[] = []
    const listener = (event: MouseEvent) => record.push({ type: event.type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
      target: (event.target as Element)?.tagName, id: (event.target as Element)?.id, className: (event.target as Element)?.className })
    for (const name of ['pointerdown', 'pointerup', 'click'] as const) window.addEventListener(name, listener, true)
    Object.assign(window, { __a05Pointer: { record, release: () => {
      for (const name of ['pointerdown', 'pointerup', 'click'] as const) window.removeEventListener(name, listener, true)
    } } })
  })
  const evidence = { outer, mainBox, inner, cssPoint, point, parentHit, contentHit, identityBefore }
  facts[`${instanceId}${selector}Click`] = evidence
  await page.mouse.click(point.x, point.y)
  Object.assign(evidence, { actualPointer: await target.evaluate(() => {
    const observed = (window as Window & { __a05Pointer?: { record: unknown[]; release(): void } }).__a05Pointer
    observed?.release(); return observed?.record ?? []
  }), parentPointer: await page.evaluate(() => {
    const observed = (window as Window & { __a05Pointer?: { record: unknown[]; release(): void } }).__a05Pointer
    observed?.release(); return observed?.record ?? []
  }), identityAfter: await iframe(page, instanceId).evaluate(node => ({ name: node.getAttribute('name'), src: node.getAttribute('src') })) })
}

async function setMode(page: Page, name: '编辑' | '试运行') {
  const button = page.getByRole('group', { name: '画布模式', exact: true }).getByRole('button', { name, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  // The toolbar state precedes the cross-realm runtime activity message.
  for (const id of ['primary', 'neighbor']) await expect.poll(() => rendered(page, id, 'body').evaluate(() =>
    (window as Window & { __guolingRuntimeActivity?: { playing: boolean } }).__guolingRuntimeActivity?.playing)).toBe(name === '试运行')
}

async function openInstanceSource(page: Page) {
  // A blank lower margin selects the object through the real canvas hit plane.
  const outer = await iframe(page, 'primary').evaluate(node => node.getBoundingClientRect().toJSON())
  await page.mouse.click(outer.right - 12, outer.bottom - 12)
  const panel = page.getByRole('complementary', { name: '编辑面板', exact: true })
  if (!await panel.isVisible()) await page.getByLabel('面板切换', { exact: true }).getByRole('button', { name: '属性与素材', exact: true }).click()
  await panel.getByRole('tab', { name: '开发', exact: true }).click()
  const developer = page.getByTestId('developer-tab')
  await developer.getByRole('tab', { name: /^组件代码/ }).click()
  await developer.getByRole('tab', { name: '当前实例源码', exact: true }).click()
  const source = developer.locator('details:visible').filter({ has: page.locator('summary', { hasText: /^组件实现源码$/ }) })
  await expect(source.getByRole('textbox', { name: '组件实现源码', exact: true })).toBeVisible()
  return source
}

async function expectVisible(page: Page, primaryTitle: string, customized: boolean) {
  await expect(rendered(page, 'primary', '#title')).toHaveText(primaryTitle)
  await expect(rendered(page, 'primary', '#source-button')).toHaveText(customized ? '源码 +1' : '默认按钮')
  await expect(rendered(page, 'neighbor', '#title')).toHaveText(originalTitle)
  await expect(rendered(page, 'neighbor', '#source-button')).toHaveText('默认按钮')
  await expect(rendered(page, 'neighbor', '#source-state')).toHaveText('共享默认实例')
  for (const id of ['primary', 'neighbor']) {
    await expect(rendered(page, id, '#neighbor')).toHaveText(neighborText)
    await expect.poll(() => rendered(page, id, '#scene').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(120)
    await expect(rendered(page, id, '#scene')).toBeVisible()
  }
}

function expectOwners(project: CourseProjectV10, baseline: CourseProjectV10, title: string) {
  expect(project.instances.neighbor).toEqual(baseline.instances.neighbor)
  expect(project.definitions.web).toEqual(baseline.definitions.web)
  expect(project.instances.primary.frame).toEqual(baseline.instances.primary.frame)
  expect(project.instances.primary.data).toEqual({ ...baseline.instances.primary.data as object, html: html.replace(originalTitle, title) })
  const implementation = project.instances.primary.implementationOverride
  expect(implementation?.kind).toBe('source')
  if (implementation?.kind !== 'source') throw new Error('Primary did not receive its own source entry')
  expect(implementation.source).toBe(customSource)
  const dependencyId = implementation.moduleBindings?.['./implementation']
  expect(dependencyId).toBeTruthy()
  expect(project.definitions[dependencyId!]?.implementation.kind).toBe('source')
}

function summary(snapshot: Awaited<ReturnType<typeof read>>) {
  return { revision: snapshot.revision, dirty: snapshot.dirty, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth,
    instances: snapshot.model.project.instances, definitions: Object.values(snapshot.model.project.definitions).map(definition => ({
      id: definition.id, kind: definition.implementation.kind,
      sourceCharacters: definition.implementation.kind === 'source' ? definition.implementation.source?.length : undefined })) }
}

async function normalQuit(app: ElectronApplication) {
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
}

test('A05 real author source entry preserves mature Web behavior, ordinary edits, history, and a cold file reopen', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const base = join(root, 'output/playwright/a05-author-source-20261014')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const file = join(workspace, fileName), initial = fixture()
  writeFileSync(file, createCourseProjectV10Archive(initial))
  const facts: Record<string, unknown> = { file, paidCalls: 0, existingUserWorkModified: false,
    windowMode: 'Visible dedicated Electron window; hidden-window OOPIF routing failures retained in prior run directories.',
    input: 'Electron real mouse and keyboard; DOM reads only measure or observe',
    visualReview: 'Screenshots require separate view_image inspection; automation does not sign visual acceptance.' }
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    let view = await launch(join(directory, 'profile-author'), workspace)
    app = view.app; page = view.page
    await expectVisible(page, originalTitle, false)
    const before = await read(page, view.documentId)
    const source = await openInstanceSource(page)
    const input = source.getByRole('textbox', { name: '组件实现源码', exact: true })
    const module = source.getByRole('combobox', { name: '组件源码模块', exact: true })
    await expect(module).toHaveValue('')
    const rootSource = await input.inputValue()
    expect(rootSource).toContain("from './implementation'")
    expect(rootSource).toContain('implementation.mount(context)')
    facts.defaultRootCharacters = rootSource.length
    await module.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    await expect(module).not.toHaveValue('')
    const dependencySource = await input.inputValue()
    expect(dependencySource.trim()).not.toBe('')
    expect(dependencySource).not.toBe(rootSource)
    facts.dependencyRead = { id: await module.inputValue(), characters: dependencySource.length }
    await module.click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter')
    await expect(module).toHaveValue('')
    await expect(input).toHaveValue(rootSource)
    const afterRead = await read(page, view.documentId)
    expect(afterRead).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, dirty: false })
    expect(afterRead.model.project).toEqual(before.model.project)

    await input.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(customSource)
    await expect(input).toHaveValue(customSource)
    await source.getByRole('button', { name: '保存实现', exact: true }).click()
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(1)
    const customized = await read(page, view.documentId)
    expectOwners(customized.model.project, initial.project, originalTitle)
    facts.customized = summary(customized)
    // Leave the textarea so subsequent shortcuts address document History.
    await page.getByRole('tab', { name: '属性', exact: true }).click()
    await expectVisible(page, originalTitle, true)
    await setMode(page, '试运行')
    await expect(rendered(page, 'primary', '#source-state')).toHaveText('源码计数 0')
    await clickContent(page, 'primary', '#source-button', facts)
    await expect(rendered(page, 'primary', '#source-state')).toHaveText('源码计数 1')
    await clickContent(page, 'primary', '#module-button', facts)
    await expect(rendered(page, 'primary', '#module-state')).toHaveText('模块计数 1')
    await expect(rendered(page, 'neighbor', '#module-state')).toHaveText('模块计数 0')
    await expectVisible(page, originalTitle, true)
    await page.screenshot({ path: join(directory, '01-source-running.png'), fullPage: true })
    await setMode(page, '编辑')

    const titlePoint = await visibleTitlePoint(page, 'primary', facts)
    await page.mouse.dblclick(titlePoint.x, titlePoint.y)
    const titleInput = page.getByRole('textbox', { name: '编辑此处文字', exact: true })
    await expect(titleInput).toHaveValue(originalTitle)
    await titleInput.click(); await page.keyboard.press('Control+a'); await page.keyboard.insertText(changedTitle)
    await page.keyboard.press('Control+Enter')
    await expect(titleInput).toHaveCount(0)
    await expectVisible(page, changedTitle, true)
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(2)
    const edited = await read(page, view.documentId)
    expectOwners(edited.model.project, initial.project, changedTitle)
    facts.edited = summary(edited)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => ({ undo: (await read(view.page, view.documentId)).undoDepth, redo: (await read(view.page, view.documentId)).redoDepth }))
      .toEqual({ undo: 1, redo: 1 })
    await expectVisible(page, originalTitle, true)
    expectOwners((await read(page, view.documentId)).model.project, initial.project, originalTitle)
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await read(view.page, view.documentId)).undoDepth).toBe(2)
    await expectVisible(page, changedTitle, true)
    expectOwners((await read(page, view.documentId)).model.project, initial.project, changedTitle)
    await visibleTitlePoint(page, 'primary')
    await visibleTitlePoint(page, 'neighbor')
    await page.screenshot({ path: join(directory, '02-edited-and-redone.png'), fullPage: true })

    await page.keyboard.press('Control+s')
    await expect.poll(async () => ({ dirty: (await read(view.page, view.documentId)).dirty, saving: (await read(view.page, view.documentId)).saving }))
      .toEqual({ dirty: false, saving: false })
    const saved = await read(page, view.documentId)
    const archive = openCourseProjectV10Archive(new Uint8Array(readFileSync(file)))
    expectOwners(archive.project, initial.project, changedTitle)
    expect(archive.project.instances).toEqual(saved.model.project.instances)
    facts.saved = summary(saved)
    await normalQuit(app); app = undefined; facts.firstNormalQuit = true

    view = await launch(join(directory, 'profile-cold'), workspace)
    app = view.app; page = view.page
    const reopened = await read(page, view.documentId)
    expect(reopened).toMatchObject({ dirty: false, undoDepth: 0, redoDepth: 0, revision: saved.revision })
    expectOwners(reopened.model.project, initial.project, changedTitle)
    await expectVisible(page, changedTitle, true)
    await visibleTitlePoint(page, 'primary')
    await visibleTitlePoint(page, 'neighbor')
    await setMode(page, '试运行')
    await expect(rendered(page, 'primary', '#source-state')).toHaveText('源码计数 0')
    await clickContent(page, 'primary', '#source-button', facts)
    await expect(rendered(page, 'primary', '#source-state')).toHaveText('源码计数 1')
    await clickContent(page, 'primary', '#module-button', facts)
    await expect(rendered(page, 'primary', '#module-state')).toHaveText('模块计数 1')
    await expectVisible(page, changedTitle, true)
    await page.screenshot({ path: join(directory, '03-cold-reopened-running.png'), fullPage: true })
    facts.reopened = summary(reopened)
    await normalQuit(app); app = undefined; facts.secondNormalQuit = true
    facts.result = 'automated-pass-awaiting-image-review'
  } catch (error) {
    facts.result = 'fail'; facts.error = String(error)
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
      writeFileSync(join(directory, 'failure-dom.html'), await page.content().catch(() => 'DOM unavailable'))
    }
    throw error
  } finally {
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await testInfo.attach('A05 author-source GUI facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await app?.close().catch(() => undefined)
  }
})
