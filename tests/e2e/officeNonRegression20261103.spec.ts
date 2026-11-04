import { test, expect, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { makeFlowD5Archive } from '../helpers/flowD5Fixture'
import { launchM20, chooseM20Workspace, m20Row, m20Snapshot, closeM20, m20Evidence } from './helpers/g20M20Harness'

type Kind = 'slide' | 'flow' | 'html' | 'markdown'
const hash = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')
const driver = new CourseV10Driver()
const poll = { timeout: 30000, intervals: [50, 100] }
async function documentFor(page: Page, filename: string) {
  const value = await m20Snapshot(page, filename)
  if (!value) throw new Error('No normal document owner: ' + filename)
  return value
}
function courseText(filename: string, id: string) {
  const model = driver.load(readFileSync(filename))
  if (model.kind !== 'course-v10') throw new Error('Expected the current GLX work model')
  return JSON.stringify(model.project.instances[id]?.data)
}
async function firstGlyph(target: Locator) {
  await target.scrollIntoViewIfNeeded()
  return target.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1)
      const rect = range.getClientRects()[0]
      if (rect?.width) return { x: rect.left + Math.min(1, rect.width / 2), y: rect.top + rect.height / 2 }
    }
    throw new Error('No visible text glyph')
  })
}

test.use({ trace: 'off', video: 'off' })
test((process.env.GUOLING_OFFICE_SOURCE_DIAGNOSTIC === '1' ? 'SOURCE DIAGNOSTIC: ' : 'final packaged: ') + 'navigation keeps current slide GLX, Flow, HTML and Markdown edits in their own files', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(180000)
  const sourceDiagnostic = process.env.GUOLING_OFFICE_SOURCE_DIAGNOSTIC === '1'
  if (sourceDiagnostic) expect(process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE?.trim(), 'Source diagnostic must not disguise a packaged launch').toBeFalsy()
  else expect(process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE, 'Use the explicitly selected final package; source requires GUOLING_OFFICE_SOURCE_DIAGNOSTIC=1').toBeTruthy()
  expect(process.env.GUOLING_OFFICE_OFFLINE_ACCEPTANCE).toBe('1')
  const base = resolve('output/office-coedit-20261103/non-office'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const names: Record<Kind, string> = { slide: '导航幻灯片.glx', flow: '导航正文.glx', html: '导航网页.html', markdown: '导航笔记.md' }
  const kinds: Kind[] = ['slide', 'flow', 'html', 'markdown']
  const files = Object.fromEntries(kinds.map(kind => [kind, join(workspace, names[kind])])) as Record<Kind, string>
  const texts: Record<Kind, string> = { slide: 'GLX 幻灯片原文', flow: 'Flow 正文原文。', html: 'HTML 原文', markdown: 'Markdown 原文。' }
  const next: Record<Kind, string> = { slide: 'GLX 幻灯片已修改', flow: 'Flow 正文原文。 已修改。', html: 'HTML 已修改', markdown: 'Markdown 已修改。' }
  const slide = createBlankCourseProjectV10('导航幻灯片')
  slide.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  slide.instances['smoke-title'] = { id: 'smoke-title', definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextComponentData(texts.slide))),
    frame: { width: 850, height: 120, transform: [1, 0, 0, 1, 100, 100] } }
  slide.instances[slide.rootIds[0]].childIds = ['smoke-title']
  writeFileSync(files.slide, driver.serialize({ kind: 'course-v10', project: slide, resources: { assets: {}, components: {} } }))
  const flow = driver.load(makeFlowD5Archive())
  if (flow.kind !== 'course-v10') throw new Error('Expected current Flow fixture')
  flow.project.instances['d5-tail'].data = JSON.parse(JSON.stringify(createTextComponentData(texts.flow)))
  writeFileSync(files.flow, driver.serialize(flow))
  const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>body{font:20px sans-serif;padding:24px}button{font:inherit}h1{font-size:30px}</style></head><body><main><h1 id="title">HTML 原文</h1><p id="keep">保留网页内容</p><button id="increment">计数</button><output id="value">0</output></main><script>document.getElementById("increment").onclick=()=>{document.getElementById("value").textContent=String(Number(document.getElementById("value").textContent)+1)}</script></body></html>'
  const markdown = '# 导航笔记\n\nMarkdown 原文。\n'
  writeFileSync(files.html, html); writeFileSync(files.markdown, markdown)
  const currentHashes = Object.fromEntries(kinds.map(kind => [kind, hash(files[kind])])) as Record<Kind, string>
  const facts: Record<string, unknown> = { directory, status: 'running', phase: 'launch',
    carrier: sourceDiagnostic ? 'source-diagnostic' : 'packaged', finalPackageEvidence: !sourceDiagnostic,
    fixtureSchema: { slide: slide.schemaVersion, flow: flow.project.schemaVersion },
    initialHashes: { ...currentHashes }, changed: [], modelRequests: 0, sharedScope: 'file tree / tabs / active save owner / close and reopen' }
  const { app, page } = await launchM20(fixture, { visible: true })
  const errors: string[] = [], network: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  const tabs = page.locator('.workspace-document-tabs').getByRole('tab')
  const frame = () => page.locator('.course-editor-frame').filter({ visible: true })
  const region = (kind: 'html' | 'markdown') => page.getByRole('region', { name: '教学文档 ' + names[kind], exact: true })
  const returnToWorkbench = async () => {
    const back = page.getByRole('button', { name: '返回工作台', exact: true })
    if (await back.isVisible()) await back.click()
    await expect(page.locator('.workspace-document-tabs')).toBeVisible()
  }
  const visible = async (kind: Kind) => {
    if (kind === 'slide' || kind === 'flow') {
      await expect(frame()).toBeVisible()
      if (await frame().getAttribute('data-editor-mode') !== 'deep') await frame().getByRole('button', { name: '在编辑器中打开', exact: true }).click()
      await expect(frame()).toHaveAttribute('data-editor-mode', 'deep')
      const target = kind === 'slide' ? frame().locator('.canvas-stage [data-component-instance="smoke-title"]').first()
        : frame().locator('.ProseMirror [data-flow-block-id="d5-tail"]').first()
      await expect(target).toContainText(texts[kind])
    } else if (kind === 'html') {
      await expect(region('html').frameLocator('iframe[title="HTML 预览"]').locator('#title')).toHaveText(texts.html)
    } else await expect(region('markdown').getByRole('textbox', { name: '正文编辑', exact: true })).toContainText(texts.markdown)
  }
  const activate = async (kind: Kind) => {
    await returnToWorkbench()
    const tab = tabs.filter({ hasText: names[kind] })
    await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true')
    await visible(kind)
  }
  const preserveOthers = (changed?: Kind) => {
    for (const kind of kinds) if (kind !== changed) expect(hash(files[kind]), 'Preserved inactive file ' + names[kind]).toBe(currentHashes[kind])
  }
  try {
    await page.bringToFront()
    facts.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, execPath: process.execPath,
      appPath: app.getAppPath(), cwd: process.cwd(), userData: app.getPath('userData') }))
    expect((facts.runtime as { packaged: boolean }).packaged).toBe(!sourceDiagnostic)
    facts.offline = JSON.parse(readFileSync(join(directory, 'electron-session-offline.json'), 'utf8'))
    expect(facts.offline).toEqual({ httpAndHttpsBlocked: true, chromiumOffline: true, hostNetworkDisabled: false })
    expect((await page.evaluate(() => window.desktopAPI.executionSettings!.read())).connections).toHaveLength(0)
    await chooseM20Workspace(app, page, workspace)
    await page.evaluate(() => {
      const state = window as unknown as { __nonOfficeClicks: unknown[] }; state.__nonOfficeClicks = []
      document.addEventListener('dblclick', event => {
        const button = (event.target as Element | null)?.closest('button')
        if (button?.closest('[aria-label="工作空间文件"]')) state.__nonOfficeClicks.push({
          text: button.textContent, trusted: event.isTrusted, detail: event.detail, at: performance.now() })
      }, true)
    })
    facts.phase = 'rapid-tree-open'
    for (const kind of kinds) await m20Row(page, names[kind]).dblclick()
    await expect(tabs).toHaveCount(4, { timeout: 45000 })
    for (const kind of kinds) await activate(kind)
    const documents = await Promise.all(kinds.map(kind => documentFor(page, files[kind])))
    expect(new Set(documents.map(document => document.documentId)).size).toBe(4)
    facts.initialOwners = documents.map((document, index) => ({ kind: kinds[index], documentId: document.documentId, modelKind: document.model.kind }))
    preserveOthers()

    for (const kind of kinds) {
      facts.phase = kind + '-edit-save'; await activate(kind)
      const autoSave = (kind === 'slide' || kind === 'flow' ? frame() : region(kind)).getByRole('switch', { name: '自动保存', exact: true })
      await expect(autoSave).not.toBeChecked()
      if (kind === 'slide') {
        const title = frame().locator('.canvas-stage [data-component-instance="smoke-title"]').first()
        const point = await firstGlyph(title); await page.mouse.dblclick(point.x, point.y)
        const input = page.locator('[data-component-professional-editor] [contenteditable="true"]').filter({ visible: true }).first()
        await expect(input).toBeVisible(); await input.click(); await page.keyboard.press('Control+A')
        await page.keyboard.insertText(next.slide); await page.keyboard.press('Control+Enter')
        await expect(title).toContainText(next.slide)
        expect(courseText(files.slide, 'smoke-title')).toContain(texts.slide)
        await autoSave.check()
        await expect.poll(() => courseText(files.slide, 'smoke-title'), poll).toContain(next.slide)
      } else if (kind === 'flow') {
        const paragraph = frame().locator('.ProseMirror [data-flow-block-id="d5-tail"]').first()
        const point = await firstGlyph(paragraph); await page.mouse.dblclick(point.x, point.y)
        await expect(frame().locator('.ProseMirror').first()).toHaveAttribute('contenteditable', 'true')
        await page.keyboard.press('Control+End'); await page.keyboard.insertText(' 已修改。'); await page.keyboard.press('Escape')
        await expect(paragraph).toContainText(next.flow)
        await page.keyboard.press('Control+s')
        await expect.poll(() => courseText(files.flow, 'd5-tail'), poll).toContain(next.flow)
      } else if (kind === 'html') {
        const htmlRegion = region('html'), preview = htmlRegion.frameLocator('iframe[title="HTML 预览"]')
        await preview.getByRole('button', { name: '计数', exact: true }).click()
        await expect(preview.locator('#value')).toHaveText('1')
        const edit = htmlRegion.getByRole('toolbar', { name: 'HTML 分页', exact: true }).getByRole('button', { name: '编辑', exact: true })
        if (await edit.count()) await edit.click()
        await preview.locator('#title').dblclick()
        const input = page.getByRole('textbox', { name: '编辑此处文字', exact: true })
        await expect(input).toBeVisible(); await input.fill(next.html); await input.press('Escape')
        await expect(input).toHaveCount(0); await expect(preview.locator('#title')).toHaveText(next.html)
        await htmlRegion.getByRole('button', { name: '保存', exact: true }).click()
        await expect.poll(() => readFileSync(files.html, 'utf8'), poll).toBe(html.replace(texts.html, next.html))
        await expect(preview.locator('#keep')).toHaveText('保留网页内容')
      } else {
        const markdownRegion = region('markdown')
        await markdownRegion.getByRole('button', { name: '源码', exact: true }).click()
        const input = markdownRegion.getByRole('textbox', { name: '正文源文编辑', exact: true })
        await input.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(markdown.replace(texts.markdown, next.markdown))
        await markdownRegion.getByRole('button', { name: '保存', exact: true }).click()
        await expect.poll(() => readFileSync(files.markdown, 'utf8'), poll).toBe(markdown.replace(texts.markdown, next.markdown))
        await markdownRegion.getByRole('button', { name: '正文', exact: true }).click()
      }
      await expect.poll(async () => (await documentFor(page, files[kind])).dirty, poll).toBe(false)
      expect(hash(files[kind]), 'Edited target has new saved bytes').not.toBe(currentHashes[kind])
      preserveOthers(kind); currentHashes[kind] = hash(files[kind]); texts[kind] = next[kind]
      await visible(kind)
      ;(facts.changed as unknown[]).push({ kind, file: files[kind], sha256: currentHashes[kind], inactiveFilesPreserved: true })
      await page.screenshot({ path: join(directory, kind + '-saved.png'), fullPage: true })
    }

    facts.phase = 'switch-saved-tabs'
    for (const kind of [...kinds].reverse()) await activate(kind)
    facts.phase = 'close-and-reopen'
    await returnToWorkbench()
    for (const kind of kinds) await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 ' + names[kind], exact: true }).click()
    await expect(tabs).toHaveCount(0)
    for (const kind of [...kinds].reverse()) {
      await returnToWorkbench()
      await m20Row(page, names[kind]).dblclick(); await activate(kind)
      expect((await documentFor(page, files[kind])).dirty).toBe(false)
    }
    await returnToWorkbench()
    await expect(tabs).toHaveCount(4)
    preserveOthers()
    const activity = await page.evaluate(async folder => {
      const api = window.desktopAPI.execution!, space = await api.workspace(folder)
      const submissions = await Promise.all(space.conversations.map(conversation => api.submissions({
        workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId })))
      return { conversations: space.conversations.length, submissions: submissions.reduce((sum, entries) => sum + entries.length, 0) }
    }, workspace)
    expect(activity.submissions).toBe(0); expect(errors).toEqual([]); expect(network).toEqual([])
    facts.activity = activity; facts.finalHashes = currentHashes; facts.closedThenReopened = true
    facts.errors = errors; facts.network = network; facts.status = 'passed'; facts.phase = 'complete'
    await m20Evidence(info, fixture, page, facts)
  } catch (error) {
    facts.status = 'failed'
    facts.errors = errors; facts.network = network; facts.tabs = await tabs.allTextContents().catch(() => [])
    facts.treeDoubleClicks = await page.evaluate(() => (window as unknown as { __nonOfficeClicks?: unknown[] }).__nonOfficeClicks ?? []).catch(() => [])
    facts.openOwners = await page.evaluate(async () => (await window.desktopAPI.documents!.list()).map(document => ({
      documentId: document.documentId, modelKind: document.model.kind, binding: document.binding, dirty: document.dirty }))).catch(() => [])
    facts.alerts = await page.getByRole('alert').allTextContents().catch(() => [])
    await m20Evidence(info, fixture, page, facts, error); throw error
  } finally { await closeM20(app) }
})
