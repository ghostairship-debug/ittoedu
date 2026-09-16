import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createTextNode } from '../../src/renderer/project/nativeNodeFactories'

const root = resolve(__dirname, '../..')
const evidence = join(root, 'output/r19-chat-scope-qa')
const rejection = 'R19_SCOPE_QA_ZERO_MODEL_REJECTION'

function createSavedFixture(path: string) {
  const project = createBlankCourseProject({ id: 'r19-chat-scope-v9', title: '聊天范围连续性', includeDefaultController: false, controls: 'none' })
  const scene = project.surfaces[0]!.type === 'slide' ? project.surfaces[0]!.scenes[0]! : undefined
  if (!scene) throw new Error('Expected a slide V9 fixture')
  const selected = createTextNode({ id: 'scope-selected', text: '局部对象：只改这一段', x: 140, y: 130, width: 520, height: 100,
    style: { color: '#0f172a', fontSize: 42, bold: true } })
  const page = createTextNode({ id: 'scope-page', text: '同页另一个对象：不能混入局部范围', x: 140, y: 340, width: 720, height: 90,
    style: { color: '#334155', fontSize: 34 } })
  scene.layerItems.push(sceneNodeToCourseLayerItem(selected, 1), sceneNodeToCourseLayerItem(page, 2))
  writeFileSync(path, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
  return { project, selectedId: selected.id }
}

test('r19 GUI chat keeps one panel configuration while selection and page requests freeze independently without launching a model', async () => {
  test.setTimeout(90_000)
  const run = join(evidence, new Date().toISOString().replace(/[:.]/g, '-'))
  const profile = join(run, 'profile'), fixture = join(run, 'chat-scope-v9.h5lesson'), savedCopy = join(run, 'chat-scope-v9-saved-copy.h5lesson')
  mkdirSync(run, { recursive: true })
  const expected = createSavedFixture(fixture)
  copyFileSync(fixture, savedCopy)
  expect(unzipSync(readFileSync(savedCopy))['project.json']).toBeTruthy()

  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let handlerPatched = false
  try {
    // The renderer still performs its normal bridge observation and request build.
    // This formal Main IPC boundary rejects only generate before LocalAgentHarness.generate,
    // so no native turn or model can start.
    await app.evaluate(({ ipcMain }, channel) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers
      const original = handlers?.get(channel)
      if (!original) throw new Error('Formal local-agent IPC handler is unavailable for zero-model interception')
      ;(globalThis as typeof globalThis & { __r19ScopeQa?: { original: (event: unknown, ...args: unknown[]) => unknown; captured: unknown[] } }).__r19ScopeQa = { original, captured: [] }
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        const request = args[0] as { operation?: string }
        const state = (globalThis as typeof globalThis & { __r19ScopeQa: { original: (event: unknown, ...args: unknown[]) => unknown; captured: unknown[] } }).__r19ScopeQa
        if (request?.operation === 'generate') {
          state.captured.push(request)
          throw new Error(rejection)
        }
        return state.original(event, ...args)
      })
    }, 'local-agent:operate')
    handlerPatched = true
    const page = await app.firstWindow()
    const lesson = await page.evaluate(async directory => {
      const made = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '聊天范围连续性课例' })
      if (!made.lesson || !made.conversation) throw new Error('Independent scope fixture lesson creation failed')
      return { lesson: made.lesson.identity, conversation: made.conversation.conversationId }
    }, run)
    const projectPath = join(lesson.lesson.normalizedDirectory, 'chat-scope-v9.h5lesson')
    copyFileSync(savedCopy, projectPath)
    await page.evaluate(async ({ lesson, conversation, projectPath, projectId }) => {
      await window.desktopAPI!.lesson!({ operation: 'bind-project', lesson, conversationId: conversation, projectId, projectPath, saveAs: false })
    }, { ...lesson, projectPath, projectId: expected.project.id })
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [directory] })) as typeof dialog.showOpenDialog
    }, run)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.locator('button').filter({ hasText: '聊天范围连续性课例' }).last().click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()

    // Confirm a Luna choice from the actual native catalog once, then use that same
    // configured adapter for both sends. Discovery/configuration does not start a turn.
    const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
    const luna = directory.capabilities?.models.find(model => /luna/i.test(model.id))
    expect(luna, 'The actual native catalog must expose Luna for this zero-model GUI proof').toBeTruthy()
    const configuration = { model: luna!.id, effort: luna!.effort.kind === 'supported' ? luna!.effort.values[0]! : null }
    const configured = await page.evaluate(configuration => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'codex', configuration }), configuration)
    expect(configured.enabled).toBe(true)

    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible()
    await expect(chat.getByRole('combobox', { name: 'CLI', exact: true })).toHaveValue('codex')

    // Select the rendered object through the visible canvas; no Store mutation is used.
    await page.getByRole('button', { name: '页面与图层', exact: true }).click()
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
    const stage = page.getByTestId('canvas-stage')
    const bounds = await stage.boundingBox()
    if (!bounds) throw new Error('Visible canvas stage is unavailable')
    await page.mouse.click(bounds.x + bounds.width * (390 / 1280), bounds.y + bounds.height * (175 / 720))
    await expect(chat.getByLabel('本轮引用', { exact: true })).toHaveValue('selection')
    await expect(chat.getByLabel('本轮引用摘要')).toContainText('场景 1')
    await chat.getByRole('textbox', { name: '发送给创作助手' }).fill('只调整当前选择对象的标题')
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect(chat.getByRole('alert')).toContainText('桌面功能暂时不可用')

    // Clearing via the visible canvas and sending again exercises the normal page scope.
    await page.mouse.click(bounds.x + bounds.width * 0.94, bounds.y + bounds.height * 0.92)
    await expect(chat.getByLabel('本轮引用', { exact: true })).toHaveValue('page')
    await chat.getByRole('textbox', { name: '发送给创作助手' }).fill('检查当前页的两个对象关系')
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect(chat.getByRole('alert')).toContainText('桌面功能暂时不可用')

    const captured = await app.evaluate(() => (globalThis as typeof globalThis & { __r19ScopeQa: { captured: unknown[] } }).__r19ScopeQa.captured)
    expect(captured).toHaveLength(2)
    const requests = captured as Array<{ adapter: string; request: { context: { reference: string; focusLocationId: string; pages: Array<{ items: Array<{ item: { layerItemId: string }; selected: boolean }> }> }; purpose: string; destinations: unknown[]; instruction: string } }>
    expect(requests.map(value => value.adapter)).toEqual(['codex', 'codex'])
    expect(requests[0]!.request.context.reference).toBe('selection')
    expect(requests[0]!.request.purpose).toBe('local-edit')
    expect(requests[0]!.request.context.pages).toHaveLength(1)
    expect(requests[0]!.request.context.pages[0]!.items.filter(item => item.selected).map(item => item.item.layerItemId)).toEqual([expected.selectedId])
    expect(JSON.stringify(requests[0]!.request.destinations)).toContain(expected.selectedId)
    expect(requests[1]!.request.context.reference).toBe('page')
    expect(requests[1]!.request.purpose).toBe('single-page')
    expect(requests[1]!.request.context.pages[0]!.items.some(item => item.selected)).toBe(false)
    expect(requests[1]!.request.context.focusLocationId).toBe(requests[0]!.request.context.focusLocationId)
    expect(requests[1]!.request.instruction).toBe('检查当前页的两个对象关系')
    writeFileSync(join(run, 'frozen-formal-generate-requests.json'), JSON.stringify({ configuration, captured: requests, rejection }, null, 2))
    await page.screenshot({ path: join(run, 'page-scope-after-zero-model-rejection.png') })
  } finally {
    if (handlerPatched) await app.evaluate(({ ipcMain }, channel) => {
      const state = (globalThis as typeof globalThis & { __r19ScopeQa?: { original: (event: unknown, ...args: unknown[]) => unknown } }).__r19ScopeQa
      if (state) { ipcMain.removeHandler(channel); ipcMain.handle(channel, state.original); delete (globalThis as typeof globalThis & { __r19ScopeQa?: unknown }).__r19ScopeQa }
    }, 'local-agent:operate').catch(() => {})
    await app.close()
  }
  expect(existsSync(join(run, 'frozen-formal-generate-requests.json'))).toBe(true)
})
