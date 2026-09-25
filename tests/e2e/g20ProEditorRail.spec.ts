import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseScene } from '../../src/core/tools/courseLocations'

const root = resolve(__dirname, '../..')
const fixture = join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson')
const changedText = '专业侧栏往返仍保留的文档修改'
const unsentDraft = '往返后仍可继续输入的草稿'

const sseEvent = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: 'pro-rail-response', model: 'fixture-pro-rail', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

function finishResponse(response: ServerResponse) {
  if (response.destroyed || response.writableEnded || !response.writable) return
  response.write(sseEvent({ role: 'assistant', content: '模式切换后任务已完成。' }, 'stop'))
  response.end('data: [DONE]\n\n')
}

async function clickPaintedObject(page: Page, painted: Locator) {
  await expect(painted).toBeVisible()
  const bounds = await painted.boundingBox()
  if (!bounds) throw new Error('Selected layer has no painted bounds')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.workspace-grid')
    const assistant = document.querySelector<HTMLElement>('.workspace-region--assistant')
    const measure = (selector: string) => {
      const element = [...document.querySelectorAll<HTMLElement>(selector)].find(node => node.getClientRects().length > 0)
      if (!element) return null
      return { rect: element.getBoundingClientRect().toJSON(), display: getComputedStyle(element).display, hidden: element.hidden }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      gridState: grid ? { editorFocus: grid.dataset.editorFocus, chatClosed: grid.dataset.chatClosed,
        navCollapsed: grid.dataset.navCollapsed, columns: getComputedStyle(grid).gridTemplateColumns } : null,
      assistantState: assistant ? { display: getComputedStyle(assistant).display,
        visibility: getComputedStyle(assistant).visibility, rect: assistant.getBoundingClientRect().toJSON() } : null,
      grid: measure('.workspace-grid'),
      workspaceToolbar: measure('.lesson-workspace-toolbar'),
      documentHeader: measure('.workbench-layout-bar'),
      documentTabs: measure('.workspace-document-tabs'),
      editorToolbar: measure('[data-testid="top-toolbar"]'),
      layout: measure('.editor-panel-layout:not(.editor-panel-layout--light)'),
      sceneTree: measure('.scene-panel'),
      canvas: measure('[data-testid="canvas-stage"]'),
      rail: measure('.right-sidebar'),
      tool: measure('#pro-editor-tool-panel'),
      resources: measure('.workspace-region--resources'),
      assistant: measure('.workspace-region--assistant'),
      activePanel: document.querySelector('.workspace-grid')?.getAttribute('data-pro-panel') ?? null,
      documentId: document.querySelector('.course-editor-frame')?.getAttribute('data-document-id') ?? null,
      editorMode: document.querySelector('.course-editor-frame')?.getAttribute('data-editor-mode') ?? null,
      selected: document.querySelector('.status-bar')?.textContent ?? null,
    }
  })
}

test('M03-T03/T08 professional rail keeps one DocumentSession, History, location, zoom, selection and task across both editor modes', async ({}, info) => {
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/pro-editor-rail/e2e')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const filename = join(workspace, '专业侧栏课件.h5lesson')
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(fixture)))
  const originalSurface = archive.project.surfaces[0]
  if (originalSurface?.type !== 'slide') throw new Error('Expected Slide fixture')
  const added = addCourseScene(archive.project, { surfaceId: originalSurface.id, title: 'M03 往返目标页' })
  if (!added.ok) throw new Error(added.reason)
  writeFileSync(filename, createCourseProjectArchive({ project: added.project,
    assetFiles: archive.assetFiles, componentFiles: archive.componentFiles }))
  const secondLocationId = added.activatedLocationId
  const surface = added.project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('Expected Slide fixture')
  const owner = surface.scenes.map(scene => ({ scene, item: scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text') }))
    .find(value => value.item)
  if (!owner || owner.item?.kind !== 'native' || owner.item.content.nativeType !== 'text') throw new Error('Expected text layer in fixture')
  const sceneId = owner.scene.id
  const locationId = archive.project.locations.find(location => location.kind === 'slide-scene' && location.sceneId === sceneId)?.id
  if (!locationId) throw new Error('Expected location for selected Slide scene')
  const itemId = owner.item.layerItemId, originalText = owner.item.content.data.text

  let requestCount = 0
  let releaseResponse!: () => void
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
  const responses = new Set<ServerResponse>()
  const server = createServer(async (request, response) => {
    responses.add(response)
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const payload = JSON.parse(body) as { model: string }
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/chat/completions')
    expect(payload.model).toBe('fixture-pro-rail')
    requestCount += 1
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    await responseGate
    finishResponse(response)
    responses.delete(response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const evidence: Record<string, unknown> = { fixture, filename, locationId, sceneId, itemId, originalText, changedText, geometry: {} }
  let app: Awaited<ReturnType<typeof electron.launch>> | null = null
  let page: Page | null = null
  const pageErrors: string[] = []
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const saved = await settings.saveConnection({ apiKey: 'fixture-pro-rail-only', connection: {
        provider: 'fixture-pro-rail', protocol: 'openai-chat', baseURL: endpoint, accountId: 'pro-rail-e2e',
        authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      const current = await settings.read()
      await settings.saveProfile({ expectedRevision: current.profile.revision, roles: {
        ...current.profile.roles, conversation: { connectionId: saved.connection.id, model: 'fixture-pro-rail' },
      } })
    }, endpoint)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间').click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '专业侧栏课件.h5lesson', exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    const before = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const snapshot = await documents.open(input.filename)
      const receipt = await documents.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        baseRevision: snapshot.revision, operationId: 'pro-rail-history-before-mode-switch', actor: 'human',
        mutation: { type: 'command', command: { type: 'course.object.patch', locationId: input.locationId,
          itemId: input.itemId, patch: { nativeData: { text: input.text } } } },
      })
      if (receipt.status !== 'applied') throw new Error(`Host patch failed: ${JSON.stringify(receipt)}`)
      return documents.read(snapshot.documentId)
    }, { filename, locationId, itemId, text: changedText })
    expect(before).toMatchObject({ dirty: true, undoDepth: 1 })
    await expect(frame).toHaveAttribute('data-document-id', before.documentId)
    const workbenchGridBounds = await page.locator('.workspace-grid').boundingBox()
    expect(workbenchGridBounds).not.toBeNull()
    const readText = async () => page!.evaluate(async input => {
      const snapshot = await window.desktopAPI!.documents!.read(input.documentId)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Expected course document')
      const surface = snapshot.model.project.surfaces.find(value => value.type === 'slide' && value.scenes.some(scene => scene.id === input.sceneId))
      if (surface?.type !== 'slide') throw new Error('Expected Slide surface')
      const item = surface.scenes.find(scene => scene.id === input.sceneId)?.layerItems.find(value => value.layerItemId === input.itemId)
      if (item?.kind !== 'native' || item.content.nativeType !== 'text') throw new Error('Expected native text layer')
      return item.content.data.text
    }, { documentId: before.documentId, sceneId, itemId })
    await expect.poll(readText).toBe(changedText)
    evidence.before = { documentId: before.documentId, revision: before.revision, undoDepth: before.undoDepth, dirty: before.dirty }
    await page.screenshot({ path: join(directory, '01-workbench.png') })

    const assistant = page.locator('.execution-assistant')
    await expect(assistant).toHaveCount(1)
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByLabel('给创作助手发消息').fill('仅分析当前课件，等我切换界面后结束。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requestCount).toBe(1)
    const active = await page.evaluate(async workspace => {
      const execution = window.desktopAPI!.execution!
      const space = await execution.workspace(workspace)
      const conversation = space.conversations.find(value => value.runIndex.builtinRunIds.length > 0)
      if (!conversation) throw new Error('Missing active conversation')
      const runId = conversation.runIndex.builtinRunIds.at(-1)!
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        runId, run: await execution.run(runId) }
    }, workspace)
    expect(active.run).toMatchObject({ runId: active.runId, status: expect.stringMatching(/queued|running/) })
    evidence.activeTask = active

    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
    const grid = page.locator('.workspace-grid')
    await expect(grid).toHaveAttribute('data-editor-focus', 'true')
    await expect(grid).toHaveAttribute('data-pro-panel', '')
    await expect(page.locator('.lesson-workspace-toolbar')).toHaveCount(0)
    await expect(page.locator('.workbench-layout-bar')).toHaveCount(0)
    await expect(page.locator('.workspace-document-tabs')).toBeHidden()
    const editorToolbar = frame.getByTestId('top-toolbar')
    await expect(editorToolbar).toBeVisible()
    await expect(editorToolbar.getByRole('button', { name: '返回工作台', exact: true })).toBeVisible()
    const deepGridBounds = await grid.boundingBox()
    expect(deepGridBounds).not.toBeNull()
    expect(deepGridBounds!.y).toBeLessThanOrEqual(2)
    expect(deepGridBounds!.height).toBeGreaterThan(workbenchGridBounds!.height + 40)
    expect((await editorToolbar.boundingBox())?.y).toBeLessThanOrEqual(2)
    const layout = page.locator('.editor-panel-layout:not(.editor-panel-layout--light):visible')
    await expect(layout).not.toHaveClass(/editor-panel-layout--compact/)
    const rail = page.locator('.right-sidebar:visible')
    const tool = rail.locator('#pro-editor-tool-panel')
    await expect(page.getByRole('complementary', { name: '课程结构' })).toBeVisible()
    await expect(page.getByTestId('canvas-stage').first()).toBeVisible()
    await expect(tool).toBeHidden()
    await expect(page.locator('.workspace-region--resources')).toBeHidden()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    const selectionShell = page.locator('.native-selection-context')
    await expect(selectionShell).toHaveClass(/native-selection-context--idle/)
    expect(await selectionShell.evaluate(node => ({ width: node.getBoundingClientRect().width,
      background: getComputedStyle(node).backgroundColor, shadow: getComputedStyle(node).boxShadow })))
      .toMatchObject({ width: 0, background: 'rgba(0, 0, 0, 0)', shadow: 'none' })
    const collapsed = await rail.boundingBox()
    expect(collapsed).not.toBeNull()
    expect(collapsed!.width).toBeGreaterThanOrEqual(47)
    expect(collapsed!.width).toBeLessThanOrEqual(49)
    ;(evidence.geometry as Record<string, unknown>).collapsed = await geometry(page)
    await page.screenshot({ path: join(directory, '02-professional-collapsed.png') })

    const painted = page.locator(`[data-slide-layer-item="${itemId}"]:visible`).first()
    await clickPaintedObject(page, painted)
    const selection = page.getByRole('toolbar', { name: '选中对象快捷工具' })
    await expect(selection).toBeVisible()
    await expect(selectionShell).not.toHaveClass(/native-selection-context--idle/)
    const selectionText = await page.locator('.status-bar').innerText()
    expect(selectionText).toContain('已选：')
    evidence.selection = selectionText

    const railTab = (name: string) => rail.getByRole('tab', { name, exact: true })
    const railButton = (name: string) => rail.getByRole('button', { name, exact: true })
    await railTab('元素').click()
    await expect(grid).toHaveAttribute('data-pro-panel', 'elements')
    await expect(tool).toBeVisible()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    const expanded = await rail.boundingBox()
    expect(expanded).not.toBeNull()
    expect(expanded!.width).toBeGreaterThanOrEqual(310)
    expect(expanded!.width).toBeLessThanOrEqual(314)
    const search = tool.getByLabel('搜索元素内容')
    await search.fill('保留输入')
    await expect(search).toHaveValue('保留输入')
    await expect(page.locator('.status-bar')).toContainText('已选：')
    ;(evidence.geometry as Record<string, unknown>).tool = await geometry(page)
    await page.screenshot({ path: join(directory, '03-professional-tool.png') })

    await railButton('AI 助手').click()
    await expect(grid).toHaveAttribute('data-pro-panel', 'ai')
    await expect(grid).toHaveAttribute('data-chat-closed', 'false')
    ;(evidence.geometry as Record<string, unknown>).aiRequested = await geometry(page)
    await expect(tool).toBeHidden()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await expect(page.locator('.workspace-region--resources')).toBeHidden()
    await expect(assistant).toHaveCount(1)
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    expect(await rail.boundingBox()).toMatchObject({ width: expect.closeTo(48, 1) })
    ;(evidence.geometry as Record<string, unknown>).ai = await geometry(page)
    const aiBounds = await page.locator('.workspace-region--assistant').boundingBox()
    const aiRailBounds = await rail.boundingBox()
    expect(aiBounds?.width).toBeGreaterThanOrEqual(300)
    expect(aiBounds && aiRailBounds && aiBounds.x + aiBounds.width <= aiRailBounds.x + 1).toBe(true)
    await page.screenshot({ path: join(directory, '04-professional-ai.png') })

    await railButton('资源管理器').click()
    await expect(grid).toHaveAttribute('data-pro-panel', 'resources')
    await expect(page.locator('.lesson-workspace-files')).toBeVisible()
    await expect(page.locator('.lesson-workspace-sessions')).toBeHidden()
    expect((await page.locator('.workspace-region--resources').boundingBox())?.width).toBeGreaterThanOrEqual(280)
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await expect(tool).toBeHidden()
    ;(evidence.geometry as Record<string, unknown>).resources = await geometry(page)
    await page.screenshot({ path: join(directory, '05-professional-resources.png') })

    await railButton('会话列表').click()
    await expect(grid).toHaveAttribute('data-pro-panel', 'conversations')
    await expect(page.locator('.lesson-workspace-sessions')).toBeVisible()
    await expect(page.locator('.lesson-workspace-files')).toBeHidden()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await expect(tool).toBeHidden()
    ;(evidence.geometry as Record<string, unknown>).conversations = await geometry(page)
    await page.screenshot({ path: join(directory, '06-professional-conversations.png') })

    await railTab('元素').click()
    await expect(grid).toHaveAttribute('data-pro-panel', 'elements')
    await expect(search).toHaveValue('保留输入')
    await expect(page.locator('.status-bar')).toContainText('已选：')
    await expect(selection).toBeVisible()
    await railTab('元素').click()
    await expect(grid).toHaveAttribute('data-pro-panel', '')
    await expect(tool).toBeHidden()
    expect((await rail.boundingBox())?.width).toBeCloseTo(48, 0)

    const during = await page.evaluate(async input => ({
      document: await window.desktopAPI!.documents!.read(input.documentId),
      run: await window.desktopAPI!.execution!.run(input.runId),
      conversation: await window.desktopAPI!.execution!.conversation(input.workspaceId, input.conversationId),
    }), { documentId: before.documentId, runId: active.runId, workspaceId: active.workspaceId, conversationId: active.conversationId })
    expect(during.document).toMatchObject({ documentId: before.documentId, revision: before.revision,
      undoDepth: before.undoDepth, dirty: true })
    expect(during.run).toMatchObject({ runId: active.runId, status: expect.stringMatching(/queued|running/) })
    expect(during.conversation).toMatchObject({ conversationId: active.conversationId })
    expect(requestCount).toBe(1)
    evidence.during = { documentId: during.document.documentId, revision: during.document.revision,
      undoDepth: during.document.undoDepth, runId: active.runId, runStatus: during.run?.status }

    await editorToolbar.getByRole('button', { name: '返回工作台', exact: true }).click()
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    await expect(frame).toHaveAttribute('data-document-id', before.documentId)
    await expect(grid).toHaveAttribute('data-editor-focus', 'false')
    await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
    await expect(page.locator('.workspace-document-tabs')).toBeVisible()
    await expect(page.locator('.workbench-layout-bar')).toHaveCount(0)
    await expect(editorToolbar).toBeHidden()
    await expect(page.locator('.workspace-region--resources')).toBeVisible()
    await expect(page.locator('.lesson-workspace-files')).toBeVisible()
    await expect(page.locator('.lesson-workspace-sessions')).toBeVisible()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await expect(selection).toBeVisible()
    await expect(page.locator('.status-bar')).toContainText('已选：')
    const returned = await page.evaluate(async input => ({
      document: await window.desktopAPI!.documents!.read(input.documentId),
      run: await window.desktopAPI!.execution!.run(input.runId),
    }), { documentId: before.documentId, runId: active.runId })
    expect(returned.document).toMatchObject({ documentId: before.documentId, revision: before.revision,
      undoDepth: before.undoDepth, dirty: true })
    expect(returned.run).toMatchObject({ runId: active.runId, status: expect.stringMatching(/queued|running/) })
    expect(await readText()).toBe(changedText)
    expect(requestCount).toBe(1)
    ;(evidence.geometry as Record<string, unknown>).returned = await geometry(page)
    await page.screenshot({ path: join(directory, '07-back-workbench.png') })

    releaseResponse()
    await expect.poll(async () => page!.evaluate(async runId => (await window.desktopAPI!.execution!.run(runId))?.status, active.runId)).toBe('completed')
    expect(requestCount).toBe(1)
    await page.getByLabel('给创作助手发消息').fill(unsentDraft)
    const workbenchAssistantButton = page.locator('.lesson-workspace-toolbar-actions').getByRole('button', { name: 'AI 助手', exact: true })
    await workbenchAssistantButton.click()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await railButton('AI 助手').click()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(unsentDraft)
    await railButton('资源管理器').click()
    await railButton('AI 助手').click()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(unsentDraft)
    await editorToolbar.getByRole('button', { name: '返回工作台', exact: true }).click()
    await expect(page.locator('.workspace-region--assistant')).toBeHidden()
    await workbenchAssistantButton.click()
    await expect(page.locator('.workspace-region--assistant')).toBeVisible()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(unsentDraft)

    const undo = page.locator('.course-light-tools').getByRole('button', { name: '撤销', exact: true })
    const redo = page.locator('.course-light-tools').getByRole('button', { name: '重做', exact: true })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect.poll(readText).toBe(originalText)
    await expect(redo).toBeEnabled()
    await redo.click()
    await expect.poll(readText).toBe(changedText)
    const after = await page.evaluate(async documentId => window.desktopAPI!.documents!.read(documentId), before.documentId)
    expect(after).toMatchObject({ documentId: before.documentId, dirty: true, undoDepth: before.undoDepth })
    const secondCard = frame.getByTestId(`bottom-scene-${secondLocationId}`)
    await secondCard.locator('.bottom-scene-card__main').click()
    await expect(secondCard.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await frame.getByRole('button', { name: '放大画布', exact: true }).click()
    const zoom = frame.getByLabel('画布缩放比例', { exact: true })
    await expect(zoom).toHaveText('110%')
    await frame.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(frame).toHaveAttribute('data-editor-mode', 'deep')
    await expect(page.locator('.scene-panel [aria-current="page"]')).toContainText('M03 往返目标页')
    await expect(zoom).toHaveText('110%')
    await editorToolbar.getByRole('button', { name: '返回工作台', exact: true }).click()
    await expect(frame).toHaveAttribute('data-editor-mode', 'light')
    await expect(secondCard.locator('.bottom-scene-card__main')).toHaveAttribute('aria-current', 'page')
    await expect(zoom).toHaveText('110%')
    const afterViewRoundTrip = await page.evaluate(async documentId => window.desktopAPI!.documents!.read(documentId), before.documentId)
    expect(afterViewRoundTrip).toMatchObject({ documentId: after.documentId, revision: after.revision,
      undoDepth: after.undoDepth, dirty: after.dirty })
    evidence.viewRoundTrip = { locationId: secondLocationId, zoom: '110%', revision: afterViewRoundTrip.revision,
      undoDepth: afterViewRoundTrip.undoDepth }
    evidence.after = { documentId: after.documentId, revision: after.revision, undoDepth: after.undoDepth,
      dirty: after.dirty, text: await readText(), runStatus: 'completed', requestCount, pageErrors }
    expect(pageErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('professional rail collapsed', { path: join(directory, '02-professional-collapsed.png'), contentType: 'image/png' })
    await info.attach('professional rail AI', { path: join(directory, '04-professional-ai.png'), contentType: 'image/png' })
    await info.attach('workbench return', { path: join(directory, '07-back-workbench.png'), contentType: 'image/png' })
  } catch (error) {
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ error: String(error), requestCount, pageErrors, evidence }, null, 2))
    throw error
  } finally {
    releaseResponse()
    for (const response of responses) if (!response.writableEnded) finishResponse(response)
    if (app) {
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
