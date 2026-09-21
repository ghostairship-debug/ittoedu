import { _electron as electron, chromium, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { syncFlowCourseLocations } from '../../src/renderer/course/flowDocumentModel'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { enterIndependentEditor } from './lessonWorkspaceEntry'

const productRoot = resolve(__dirname, '../..')
const title = '2.0 Flow 选区 AI：Luna Fast 预览、精确应用、历史、重开与离线 HTML'
const targetId = 'r20-flow-selected-paragraph'
const beforeText = '串联电路有两条电流路径。'
const afterText = '串联电路只有一条电流路径。'
const firstText = '保留前段：先观察电路，再作出预测。'
const lastText = '保留后段：记录现象，说明判断依据。'
const instruction = `请把选中的这段改写为“${afterText}”，其余内容和格式保持不变。`

function flowOf(project: CourseProjectDocument) {
  const flow = project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Fixture must contain a Flow surface')
  return flow
}

function expectedProject(original: CourseProjectDocument, text: string) {
  const expected = structuredClone(original)
  const block = flowOf(expected).blocks.find(value => value.id === targetId)
  if (!block || block.type !== 'paragraph') throw new Error('Selected paragraph is missing')
  block.content = { inlines: [{ type: 'text', text }] }
  return expected
}

function assertProjectContent(actual: CourseProjectDocument, expected: CourseProjectDocument) {
  // Only transaction metadata may differ; IDs, layout, other blocks and resources must survive.
  expect({ ...actual, revision: expected.revision, updatedAt: expected.updatedAt }).toEqual(expected)
}

function readNativeRecords(profile: string): LocalAgentRecordV2[] {
  // Current production LocalAgentRepository.v2Directory stores wire version 3 under v3.
  // Do not use r18NativeAuthoringFixture.nativeRecords: it still scans the historical v2 path.
  const root = join(profile, 'local-agent', 'v3')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const directory = join(root, entry.name)
    return readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).map(name => {
      const record: LocalAgentRecordV2 = JSON.parse(readFileSync(join(directory, name), 'utf8'))
      expect(record.version).toBe(3)
      return record
    })
  })
}

async function closeEditor(app: ElectronApplication | undefined) {
  if (!app) return
  await app.evaluate(({ BrowserWindow, app: native }) => {
    BrowserWindow.getAllWindows().forEach(window => window.destroy())
    setTimeout(() => native.exit(0), 0)
  }).catch(() => {})
  await app.close().catch(() => {})
}

test(title, async ({}, testInfo) => {
  test.skip(process.env.R20_FLOW_SELECTION_LUNA_RUN !== '1', 'Set R20_FLOW_SELECTION_LUNA_RUN=1 for one real Codex Luna task')
  test.setTimeout(20 * 60_000)
  for (const file of ['dist-electron/main/index.js', 'dist-renderer/index.html', 'dist-player/player.iife.js']) {
    expect(existsSync(join(productRoot, file)), `Integration must build ${file} in ${productRoot}`).toBe(true)
  }
  const runRoot = testInfo.outputPath('retained-run'), workspace = join(runRoot, 'workspace')
  const profile = join(runRoot, 'profile'), projectPath = join(workspace, 'flow-selection.h5lesson')
  const htmlPath = join(runRoot, 'flow-selection.html')
  mkdirSync(workspace, { recursive: true })
  const evidence = (name: string, value: unknown) => writeFileSync(join(runRoot, name), JSON.stringify(value, null, 2))
  const fixture = createBlankFlowCourseProject({ title: 'Flow 选区验收', includeDefaultController: false, controls: 'none' })
  const flow = flowOf(fixture), first = flow.blocks[0]!
  if (first.type !== 'heading') throw new Error('Preserve the factory navigation anchor')
  flow.blocks = [
    { ...first, content: { inlines: [{ type: 'text', text: firstText }] } },
    { id: targetId, type: 'paragraph', content: { inlines: [{ type: 'text', text: beforeText }] } },
    { id: 'r20-flow-preserved-after', type: 'paragraph', content: { inlines: [{ type: 'text', text: lastText }] } },
  ]
  syncFlowCourseLocations(fixture, flow.id)
  // The only driver-authored project write is this initial fixture, before the application opens it.
  writeFileSync(projectPath, createCourseProjectArchive({ project: fixture, assetFiles: {}, componentFiles: {} }))
  const readSaved = () => openCourseProjectArchive(new Uint8Array(readFileSync(projectPath)))
  const original = readSaved(), expected = expectedProject(original.project, afterText)
  const owner = { projectId: fixture.id, projectPath }
  let app: ElectronApplication | undefined, page: Page | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const pageErrors: string[] = []
  try {
    // Same real launch shape as r19ChatSpecSupport, with the explicitly required product cwd.
    app = await electron.launch({ cwd: productRoot, args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow()
    page.setDefaultTimeout(30_000)
    page.on('pageerror', error => pageErrors.push(error.message))
    const host = await app.evaluate(({ app: native, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 950)
      return { appPath: native.getAppPath(), profile: native.getPath('userData') }
    })
    expect(resolve(host.appPath).toLowerCase()).toBe(resolve(productRoot).toLowerCase())
    expect(resolve(host.profile).toLowerCase()).toBe(resolve(profile).toLowerCase())
    await enterIndependentEditor(page)
    expect(page.url()).toBe('courseware-editor://app/index.html')
    // Only native OS pickers are intercepted. Editor, selection, model, candidate and commit stay real.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    const flowWorkspace = page.getByTestId('flow-workspace')
    await expect(flowWorkspace).toHaveAttribute('data-flow-project-id', fixture.id)
    await expect(flowWorkspace).toHaveAttribute('data-flow-surface-id', flow.id)
    const body = flowWorkspace.getByRole('textbox', { name: '正文排版编辑', exact: true })
    const paragraph = body.locator(`[data-document-id="${targetId}"]`)
    await expect(paragraph).toHaveText(beforeText)
    await page.getByRole('button', { name: '创作助手', exact: true }).click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手', exact: true })
    await expect(chat).toBeVisible()
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    await expect(chat.getByLabel('CLI', { exact: true })).toHaveValue('codex')
    const config = chat.getByRole('region', { name: 'CLI 模型配置', exact: true })
    await config.locator(':scope > details > summary').click()
    await expect(config.locator(':scope > details')).toHaveJSProperty('open', true)
    await expect(config.getByLabel('模型', { exact: true })).toBeEnabled({ timeout: 90_000 })
    const directory = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'capabilities', adapter: 'codex', ...owner }), owner)
    const luna = directory.capabilities?.models.find(model => model.id === 'gpt-5.6-luna')
    expect(luna, 'The actual Codex directory must expose Luna').toBeTruthy()
    expect(luna!.resolvedModel === null || /luna/i.test(luna!.resolvedModel)).toBe(true)
    expect(luna!.effort.kind === 'supported' && luna!.effort.values.includes('max')).toBe(true)
    const tier = luna!.serviceTiers?.find(value => /fast|priority/i.test(`${value.id} ${value.name}`))
    expect(tier, 'This gate requires actual Luna Fast, never an inherited speed').toBeTruthy()
    for (const [label, value] of [['模型', luna!.id], ['强度', 'max'], ['速度', tier!.id]]) {
      const control = config.getByLabel(label!, { exact: true })
      await expect(control).toBeEnabled({ timeout: 60_000 })
      await control.selectOption(value!)
      await expect(config).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
      await expect(control).toHaveValue(value!)
    }
    const route = { model: luna!.id, effort: 'max', serviceTier: tier!.id }
    evidence('requested-route.json', { productRoot, ...route })
    await config.locator(':scope > details > summary').click()
    const settings = chat.locator('details.chat-task-settings')
    await settings.locator('summary').first().click()
    await expect(settings).toHaveJSProperty('open', true)
    await settings.getByLabel('意图', { exact: true }).selectOption('edit')
    await settings.getByLabel('应用方式', { exact: true }).selectOption('preview')
    await expect(settings.getByLabel('应用方式', { exact: true })).toHaveValue('preview')
    await settings.locator('summary').first().click()

    await paragraph.click()
    await expect(body).toBeFocused()
    await body.press('Home')
    await expect.poll(() => paragraph.evaluate(element => {
      const selection = window.getSelection()
      return Boolean(selection?.isCollapsed && selection.anchorOffset === 0 && element.contains(selection.anchorNode))
    })).toBe(true)
    await body.press('Shift+End')
    const selectedDom = () => paragraph.evaluate(element => {
      const selection = window.getSelection()
      return { text: selection?.toString(), anchorInside: element.contains(selection?.anchorNode ?? null),
        headInside: element.contains(selection?.focusNode ?? null), anchor: selection?.anchorOffset, head: selection?.focusOffset }
    })
    await expect.poll(selectedDom).toEqual({ text: beforeText, anchorInside: true, headInside: true, anchor: 0, head: beforeText.length })
    evidence('selected-dom.json', await selectedDom())
    await body.press('Alt+Enter')
    const card = page.getByRole('complementary', { name: '当前编辑目标', exact: true })
    await expect(card).toBeVisible()
    await expect(card).toContainText('段落')
    const command = card.getByRole('textbox', { name: 'AI 指令', exact: true })
    await expect(command).toBeFocused()
    await command.fill(instruction)
    await expect(command).toHaveValue(instruction)
    await expect(card.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
    await page.screenshot({ path: join(runRoot, 'selected-card.png') })
    await card.getByRole('button', { name: '发送', exact: true }).click()
    const notice = page.getByRole('dialog', { name: '发送前了解外部处理范围', exact: true })
    await expect(notice).toBeVisible({ timeout: 60_000 })
    await expect(notice).toContainText('Codex')
    await expect(notice.getByRole('region', { name: '本次实际引用' })).toContainText('编辑目标：当前选区')
    await expect(notice).toContainText('flow-selection.h5lesson')
    expect(readNativeRecords(profile)).toHaveLength(0)
    assertProjectContent(readSaved().project, original.project)
    await page.screenshot({ path: join(runRoot, 'first-use-notice.png') })
    await notice.getByRole('button', { name: '确认并继续', exact: true }).click()
    await expect(notice).toBeHidden()

    const preview = chat.getByRole('region', { name: '候选变更预览', exact: true })
    await expect.poll(async () => {
      const errors = await chat.getByRole('alert').allTextContents()
      if (errors.length) throw new Error(errors.join('\n'))
      return preview.getByRole('button', { name: '应用候选', exact: true }).isEnabled().catch(() => false)
    }, { timeout: 10 * 60_000, intervals: [1000, 2000] }).toBe(true)
    await expect(paragraph).toHaveText(beforeText)
    assertProjectContent(readSaved().project, original.project)
    const records = await page.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), owner)
    expect(records.records).toHaveLength(1)
    const record = records.records![0]!, request = record.generationRequest!
    expect(record.adapter).toBe('codex')
    expect(request.instruction).toBe(instruction)
    expect(request.context).toMatchObject({ reference: 'selection', flowSelection: {
      selectedBlockIds: [targetId], textRange: { blockId: targetId, start: 0, end: beforeText.length },
      documentSelection: { kind: 'text', revision: String(original.project.revision),
        anchor: { blockId: targetId, slot: { kind: 'field', field: 'content' }, offset: 0 },
        head: { blockId: targetId, slot: { kind: 'field', field: 'content' }, offset: beforeText.length } },
    } })
    evidence('frozen-target.json', { requestId: request.requestId, destinations: request.destinations, context: request.context })
    const native = readNativeRecords(profile)
    expect(native).toHaveLength(1)
    expect(native[0]!.id).toBe(record.id)
    expect(native[0]!.externalSessionId).toBeTruthy()
    const configurations = native[0]!.tasks.flatMap(task => task.configurationRuns ?? [])
    expect(configurations.length).toBeGreaterThan(0)
    for (const configuration of configurations) {
      expect(configuration.requested).toMatchObject(route)
      expect(configuration.sent).toMatchObject(route)
      expect(configuration.confirmed).toMatchObject(route)
      expect(configuration.confirmed!.resolvedModel).toMatch(/luna/i)
      expect(JSON.stringify(configuration)).not.toMatch(/astra/i)
    }
    const confirmations = native[0]!.events.filter(event => event.kind === 'configuration')
    expect(confirmations.some(event => event.kind === 'configuration' && event.capabilities.current.model === route.model
      && event.capabilities.current.effort === route.effort && event.capabilities.current.serviceTier === route.serviceTier)).toBe(true)
    evidence('native-route.json', configurations)
    await page.screenshot({ path: join(runRoot, 'candidate-preview.png') })
    await preview.getByRole('button', { name: '应用候选', exact: true }).click()
    await expect(paragraph).toHaveText(afterText, { timeout: 60_000 })
    await expect(chat.getByRole('region', { name: '实际应用结果' })).toContainText('已应用课件修改')
    await expect.poll(async () => (await page!.evaluate(owner => window.desktopAPI.localAgent({ operation: 'list', ...owner }), owner))
      .records?.[0]?.task?.status, { timeout: 60_000 }).toBe('completed')
    const committed = readNativeRecords(profile)[0]!.hostResults.filter(result => result.status === 'committed')
    expect(committed).toHaveLength(1)
    expect(committed[0]!.receipts.some(receipt => receipt.status === 'committed')).toBe(true)
    evidence('host-commit.json', committed)

    const saveAndCheck = async (expectedContent: CourseProjectDocument, name: string) => {
      await page!.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
      await expect.poll(() => {
        const saved = readSaved().project
        return { ...saved, revision: expectedContent.revision, updatedAt: expectedContent.updatedAt }
      }).toEqual(expectedContent)
      const saved = readSaved()
      expect(saved.assetFiles).toEqual(original.assetFiles)
      expect(saved.componentFiles).toEqual(original.componentFiles)
      evidence(`${name}.project.json`, saved.project)
      return saved.project
    }
    const applied = await saveAndCheck(expected, 'applied')
    expect(applied.revision).toBe(original.project.revision + 1)
    await page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await expect(paragraph).toHaveText(beforeText)
    await saveAndCheck(original.project, 'undone')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await expect(paragraph).toHaveText(afterText)
    const redone = await saveAndCheck(expected, 'redone')
    await chat.getByRole('button', { name: '关闭', exact: true }).click()
    // Leave the document first: reopening the same active file alone could reuse live state.
    await page.keyboard.press('Control+N')
    await expect(flowWorkspace).toHaveCount(0)
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
    await expect(flowWorkspace).toHaveAttribute('data-flow-project-id', fixture.id)
    await expect(flowWorkspace).toHaveAttribute('data-observation-revision', String(redone.revision))
    await expect(paragraph).toHaveText(afterText)
    await expect(body).toContainText(firstText)
    await expect(body).toContainText(lastText)
    assertProjectContent(readSaved().project, expected)
    await page.screenshot({ path: join(runRoot, 'reopened.png') })

    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, htmlPath)
    await page.getByTestId('export-menu-trigger').click()
    await expect(page.getByRole('menu', { name: '选择导出格式' })).toBeVisible()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检', exact: true })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect.poll(() => existsSync(htmlPath) && readFileSync(htmlPath, 'utf8').includes(afterText), { timeout: 60_000 }).toBe(true)
    browser = await chromium.launch({ headless: true })
    const offline = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    offline.on('pageerror', error => pageErrors.push(error.message))
    const network: string[] = []
    offline.on('request', request => { if (/^https?:/i.test(request.url())) network.push(request.url()) })
    await offline.context().setOffline(true)
    await offline.goto(pathToFileURL(htmlPath).href)
    const article = offline.getByTestId('flow-runtime-article')
    await expect(article).toBeVisible()
    await expect(article.locator(`[data-flow-block-id="${targetId}"]`)).toHaveText(afterText)
    await expect(article).toContainText(firstText)
    await expect(article).toContainText(lastText)
    await expect(article).not.toContainText(beforeText)
    await offline.screenshot({ path: join(runRoot, 'offline-html.png') })
    expect(network).toEqual([])
    expect(pageErrors).toEqual([])
    evidence('result.json', { status: 'passed', productRoot, route, selectedBlockId: targetId, outsideSelectionPreserved: true,
      projectUndoRedo: true, savedReopened: true, offlineHtml: true, nativeSessionId: record.id, network, pageErrors })
  } catch (error) {
    evidence('failure.json', { message: error instanceof Error ? error.message : String(error), pageErrors })
    throw error
  } finally {
    if (page) {
      await page.screenshot({ path: join(runRoot, 'last-state.png') }).catch(() => {})
      const stop = page.getByRole('complementary', { name: 'CLI 创作助手', exact: true }).getByRole('button', { name: '停止', exact: true })
      if (await stop.isVisible().catch(() => false) && await stop.isEnabled().catch(() => false)) await stop.click().catch(() => {})
    }
    await browser?.close()
    await closeEditor(app)
    await testInfo.attach('retained-run', { body: runRoot, contentType: 'text/plain' })
  }
})
