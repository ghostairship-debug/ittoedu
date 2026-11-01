import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20Row, m20VisibleTextEditor } from './helpers/g20M20Harness'

const sha256 = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')
const previewFor = (page: Page, name: string) => page.locator(`.pptx-file-preview[aria-label=${JSON.stringify(`${name} PPTX 只读预览`)}]`)
const fileTab = (page: Page, name: string) => page.locator('.workspace-document-tabs').getByRole('tab', { name, exact: true })

test('T6 original PPTX preview, animation, lifecycle, failure and cold reopen use the real App without writing the file', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'PPTX desktop acceptance uses Windows Electron.')
  test.setTimeout(240_000)
  const base = resolve('output/comprehensive-execution-20261101/office/resume-20261101')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'ui-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const source = resolve('output/comprehensive-execution-20261101/office/fixtures/original-timeline-opaque.pptx')
  expect(existsSync(source), 'The existing timeline/opaque fixture is required').toBe(true)
  const name = '课堂演示.pptx', fastName = '加载即关.pptx', brokenName = '损坏演示.pptx'
  const filename = join(workspace, name), fastFilename = join(workspace, fastName), brokenFilename = join(workspace, brokenName)
  copyFileSync(source, filename); copyFileSync(source, fastFilename)
  writeFileSync(brokenFilename, 'This is deliberately not an OOXML ZIP file.\n', 'utf8')
  writeFileSync(join(workspace, '旁边的笔记.txt'), '切换到这里时，演示文稿暂停。\n', 'utf8')
  const before = { source: sha256(source), preview: sha256(filename), fast: sha256(fastFilename), broken: sha256(brokenFilename) }
  const slide = unzipSync(readFileSync(source))['ppt/slides/slide1.xml']
  expect(slide).toBeTruthy()
  const animatedId = strFromU8(slide!).match(/\bspid=["'](\d+)["']/)?.[1]
  expect(animatedId, 'The original fixture must contain a real animation target').toBeTruthy()
  const evidence: Record<string, unknown> = { case: 'T6 PPTX original preview', workspace, before, animatedId, phase: 'launch' }
  const errors: string[] = [], network: string[] = []
  let { app, page } = await launchM20(fixture)
  const observe = (current: Page) => {
    current.on('pageerror', error => errors.push(error.message))
    current.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  }
  observe(page)
  try {
    const initialPid = app.process().pid
    evidence.initialPid = initialPid
    await chooseM20Workspace(app, page, workspace)
    evidence.phase = 'original-readonly-render'
    await m20Row(page, name).dblclick()
    const preview = previewFor(page, name)
    await expect(fileTab(page, name)).toHaveAttribute('aria-selected', 'true')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('第 1 / 2 页')
    await expect(preview.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
    await expect(preview.getByRole('button', { name: '导入为果铃作品', exact: true })).toBeVisible()
    const bounds = await preview.locator('.pptx-file-preview__surface svg').first().boundingBox()
    expect(bounds && bounds.width > 100 && bounds.height > 100, 'An actual visible SVG must be rendered').toBe(true)
    evidence.initialSvgBounds = bounds
    const animated = preview.locator(`[data-el="${animatedId}"]`).first()
    await expect(animated).toBeVisible()
    await page.screenshot({ path: join(directory, '01-browse.png'), fullPage: true })

    evidence.phase = 'actual-click-animation'
    await preview.getByRole('button', { name: '播放动画', exact: true }).click()
    await expect(preview).toContainText('本页动画 0 / 1')
    await expect(animated).toBeHidden()
    await page.screenshot({ path: join(directory, '02-before-animation.png'), fullPage: true })
    await preview.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(preview).toContainText('本页动画 1 / 1')
    await expect(animated).toBeVisible()
    await page.screenshot({ path: join(directory, '03-after-animation.png'), fullPage: true })
    await preview.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect(preview.locator('.pptx-file-preview__surface')).toContainText('Keep other slide')
    evidence.animation = { initialHidden: true, clickRevealed: true, nextClickAdvanced: true }

    evidence.phase = 'inactive-tab-release-and-resume'
    await m20Row(page, '旁边的笔记.txt').dblclick()
    await expect(m20VisibleTextEditor(page)).toBeVisible()
    await expect(preview).toBeHidden()
    // Destroyed SVG/layers demonstrate that playback and delegated listeners are no
    // longer attached to the inactive view, not merely hidden behind another tab.
    await expect(preview.locator('.pptx-file-preview__surface svg')).toHaveCount(0)
    await m20VisibleTextEditor(page).click(); await page.keyboard.press('ArrowLeft')
    await fileTab(page, name).click()
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect(preview.locator('.pptx-file-preview__surface svg').first()).toBeVisible()
    evidence.inactiveLifecycle = { releasedSvg: true, restoredPage: 2, backgroundKeyDidNotNavigate: true }

    evidence.phase = 'close-while-loading'
    // Arm a UI observer before opening. It clicks the real close button at the
    // first committed loading view; neither parsing nor the Main IPC is replaced.
    await page.evaluate(input => {
      const state = globalThis as unknown as { __t6FastClose?: { closed: boolean; observedLoading: boolean } }
      state.__t6FastClose = { closed: false, observedLoading: false }
      const observer = new MutationObserver(() => {
        const region = Array.from(document.querySelectorAll<HTMLElement>('.pptx-file-preview'))
          .find(node => node.getAttribute('aria-label') === input.label)
        const close = Array.from(document.querySelectorAll<HTMLButtonElement>('.workspace-document-tabs button'))
          .find(node => node.getAttribute('aria-label') === input.closeLabel)
        if (!region || !close || !state.__t6FastClose) return
        state.__t6FastClose.observedLoading = region.textContent?.includes('正在载入演示文稿') ?? false
        observer.disconnect(); close.click(); state.__t6FastClose.closed = true
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }, { label: `${fastName} PPTX 只读预览`, closeLabel: `关闭 ${fastName}` })
    await m20Row(page, fastName).dblclick()
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __t6FastClose?: unknown }).__t6FastClose))
      .toEqual({ closed: true, observedLoading: true })
    await expect(fileTab(page, fastName)).toHaveCount(0)
    await expect(previewFor(page, fastName)).toHaveCount(0)
    evidence.closedDuringLoading = true

    evidence.phase = 'corrupt-file-and-external-failure'
    await app.evaluate(({ shell }) => {
      const state = globalThis as unknown as { __t6ExternalPaths: string[] }
      state.__t6ExternalPaths = []
      // Only the OS shell is replaced, so acceptance cannot launch a user's Office.
      shell.openPath = async path => { state.__t6ExternalPaths.push(path); return 'fixture: no associated presentation application' }
    })
    await m20Row(page, brokenName).dblclick()
    const broken = previewFor(page, brokenName)
    await expect(broken).toBeVisible()
    await expect(broken.getByRole('alert').filter({ hasText: 'PPTX 预览失败' })).toBeVisible()
    await broken.getByRole('button', { name: '重新载入', exact: true }).click()
    await expect(broken.getByRole('alert').filter({ hasText: 'PPTX 预览失败' })).toBeVisible()
    await broken.getByRole('button', { name: '用系统应用打开', exact: true }).click()
    await expect(broken.getByRole('alert').filter({ hasText: 'fixture: no associated presentation application' })).toBeVisible()
    const externalPaths = await app.evaluate(() => (globalThis as unknown as { __t6ExternalPaths: string[] }).__t6ExternalPaths)
    expect(externalPaths).toEqual([brokenFilename])
    evidence.externalPaths = externalPaths
    await page.screenshot({ path: join(directory, '04-corrupt-file-feedback.png'), fullPage: true })
    await page.getByRole('button', { name: `关闭 ${brokenName}`, exact: true }).click()
    await expect(fileTab(page, brokenName)).toHaveCount(0)
    await expect(previewFor(page, brokenName)).toHaveCount(0)
    await fileTab(page, name).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect(fileTab(page, fastName)).toHaveCount(0)
    const warm = { source: sha256(source), preview: sha256(filename), fast: sha256(fastFilename), broken: sha256(brokenFilename) }
    expect(warm).toEqual(before); evidence.warmHashes = warm

    evidence.phase = 'independent-process-cold-reopen'
    await closeM20(app)
    ;({ app, page } = await launchM20(fixture))
    observe(page)
    expect(app.process().pid).not.toBe(initialPid)
    evidence.coldPid = app.process().pid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const cold = previewFor(page, name)
    await expect(cold).toContainText('第 1 / 2 页')
    await expect(cold.locator(`[data-el="${animatedId}"]`).first()).toBeVisible()
    await cold.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(cold).toContainText('第 2 / 2 页')
    await expect(cold.locator('.pptx-file-preview__surface')).toContainText('Keep other slide')
    const after = { source: sha256(source), preview: sha256(filename), fast: sha256(fastFilename), broken: sha256(brokenFilename) }
    expect(after).toEqual(before)
    expect(errors).toEqual([]); expect(network).toEqual([])
    evidence.after = after; evidence.errors = errors; evidence.network = network
    evidence.status = 'real-ui-and-independent-cold-reopen-passed'; evidence.phase = 'complete'
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.errors = errors; evidence.network = network
    evidence.finalHashes = { source: sha256(source), preview: sha256(filename), fast: sha256(fastFilename), broken: sha256(brokenFilename) }
    await m20Evidence(info, fixture, page, evidence, error); throw error
  } finally { await closeM20(app) }
})

test('T6 PPTX reload consumes a narrow Office edit and cold-reopens the saved version without changing other parts', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'PPTX desktop acceptance uses Windows Electron.')
  test.setTimeout(180_000)
  const base = resolve('output/comprehensive-execution-20261101/resilient-20261101/office')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'reload-ui-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const source = resolve('output/comprehensive-execution-20261101/office/fixtures/original-timeline-opaque.pptx')
  expect(existsSync(source), 'The existing timeline/opaque fixture is required').toBe(true)
  const sourceHash = sha256(source), name = '修改后重新载入.pptx', filename = join(workspace, name)
  copyFileSync(source, filename)
  const before = readFileSync(filename), beforeHash = sha256(filename)
  // This separate owner performs the actual Office edit while the App retains
  // its old read-only snapshot, as when another application changes the file.
  const host = new DocumentHostService(join(directory, 'office-owner'))
  await host.files.registerRoot(workspace)
  const office = new OfficeFileService(host), binding = await host.artifacts.bind(filename)
  const inspected = await office.inspect(binding, 'pptx')
  if (inspected.inspection.format !== 'pptx') throw new Error('Expected the original PPTX inspection')
  const slide = inspected.inspection.slides[0]
  const shape = slide?.shapes.find(item => item.text.trim().length > 0)
  if (!slide || !shape) throw new Error('The original fixture needs a visible text shape')
  const replacement = 'Reloaded title'
  const evidence: Record<string, unknown> = { case: 'T6 Office narrow edit to PPTX preview reload', workspace, beforeHash,
    target: { part: slide.part, shapeId: shape.shapeId, oldText: shape.text, replacement }, phase: 'launch' }
  const errors: string[] = [], network: string[] = []
  let { app, page } = await launchM20(fixture)
  const observe = (current: Page) => {
    current.on('pageerror', error => errors.push(error.message))
    current.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
  }
  observe(page)
  try {
    const initialPid = app.process().pid
    evidence.initialPid = initialPid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const preview = previewFor(page, name)
    const shapeSelector = `[data-el="${shape.shapeId}"]`
    await expect(preview).toContainText('第 1 / 2 页')
    await expect(preview.locator(shapeSelector).first()).toContainText(shape.text)
    evidence.phase = 'formal-narrow-edit'
    const saved = await office.edit(binding, { format: 'pptx', operation: 'edit', edits: [{
      slide: slide.index, part: slide.part, partVersion: slide.partVersion, shapeId: shape.shapeId, text: replacement,
    }] })
    expect(saved.status).toBe('saved')
    expect(saved.binding.fileVersion).not.toBe(binding.fileVersion)
    const edited = readFileSync(filename), editedHash = sha256(filename)
    expect(editedHash).not.toBe(beforeHash)
    const oldParts = unzipSync(before), newParts = unzipSync(edited)
    expect(Object.keys(newParts).sort()).toEqual(Object.keys(oldParts).sort())
    const changedParts = Object.keys(oldParts).filter(part => !Buffer.from(oldParts[part]!).equals(newParts[part]!))
    expect(changedParts).toEqual([slide.part])
    expect(sha256(source)).toBe(sourceHash)
    evidence.changedParts = changedParts; evidence.editedHash = editedHash
    evidence.savedVersion = saved.binding.fileVersion
    await expect(preview.locator(shapeSelector).first()).toContainText(shape.text)
    evidence.phase = 'actual-reload-click'
    await preview.getByRole('button', { name: '重新载入', exact: true }).click()
    await expect(preview).toContainText('第 1 / 2 页')
    await expect(preview.locator(shapeSelector).first()).toContainText(replacement)
    await expect(preview.getByRole('alert')).toHaveCount(0)
    expect(sha256(filename)).toBe(editedHash)
    await page.screenshot({ path: join(directory, '01-reloaded-edited-title.png'), fullPage: true })
    await preview.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(preview.locator('.pptx-file-preview__surface')).toContainText('Keep other slide')
    evidence.phase = 'independent-process-cold-reopen'
    await closeM20(app)
    ;({ app, page } = await launchM20(fixture))
    observe(page)
    expect(app.process().pid).not.toBe(initialPid)
    evidence.coldPid = app.process().pid
    await chooseM20Workspace(app, page, workspace)
    await m20Row(page, name).dblclick()
    const cold = previewFor(page, name)
    await expect(cold).toContainText('第 1 / 2 页')
    await expect(cold.locator(shapeSelector).first()).toContainText(replacement)
    await expect(cold.getByRole('alert')).toHaveCount(0)
    expect(sha256(filename)).toBe(editedHash); expect(sha256(source)).toBe(sourceHash)
    expect(errors).toEqual([]); expect(network).toEqual([])
    evidence.afterHash = sha256(filename); evidence.sourceHash = sourceHash
    evidence.errors = errors; evidence.network = network
    evidence.status = 'narrow-edit-reload-and-independent-cold-reopen-passed'; evidence.phase = 'complete'
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) {
    evidence.errors = errors; evidence.network = network
    evidence.finalHash = sha256(filename); evidence.sourceHash = sha256(source)
    await m20Evidence(info, fixture, page, evidence, error); throw error
  } finally { await closeM20(app) }
})
