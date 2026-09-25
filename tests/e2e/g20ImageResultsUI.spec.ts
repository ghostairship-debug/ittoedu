import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'

const root = resolve(__dirname, '../..')
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
type FixtureMain = typeof globalThis & { __G20_IMAGE_RESULTS_FIXTURE__: { ready: Promise<void>; lateReady: boolean; releaseLate?(): void } }
function images(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a V9 document')
  return snapshot.model.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'native' && item.content.nativeType === 'image')) : [])
}
async function expandImages(page: Page, expected: number) {
  const latest = page.getByRole('button', { name: /回到最新/ })
  if (await latest.isVisible()) await latest.click()
  const cards = page.locator('.execution-timeline__card--image')
  await expect(cards).toHaveCount(expected)
  for (let index = 0; index < expected; index++) {
    const details = cards.nth(index).locator('details').first()
    if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click()
  }
  return cards
}

test('S14/M08 local HTTP fixture with real Engine: preview, insert, undo/redo, reference edit, replace, save/reopen and stopped-late bytes', async ({}, info) => {
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/s14/image-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, '图像闭环.h5lesson')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), filename)
  const generated = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#3388ff' } }).png().toBuffer()
  const edited = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#ff8833' } }).png().toBuffer()
  const late = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#bb44ee' } }).png().toBuffer()
  const imageBodies: any[] = [], textBodies: any[] = [], serverErrors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (request.url === '/backend-api/codex/images/generations' || request.url === '/backend-api/codex/images/edits') {
      expect(request.headers.authorization).toBe('Bearer fixture-image-access')
      expect(request.headers['chatgpt-account-id']).toBe('fixture-image-account')
      expect(body.model).toBe(request.url.endsWith('/edits') ? 'fixture-image-edit-model' : 'fixture-image-model')
      imageBodies.push(body)
      const bytes = imageBodies.length === 1 ? generated : imageBodies.length === 2 ? edited : late
      response.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': `fixture-request-${imageBodies.length}` })
      response.end(JSON.stringify({ created: 123, data: [{ generation_id: `image-${imageBodies.length}`, b64_json: bytes.toString('base64') }],
        size: '64x48', output_format: 'png', usage: { input_tokens: 10, output_tokens: 20 } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    expect(request.url).toBe('/v1/chat/completions'); expect(body.model).toBe('fixture-text-model'); textBodies.push(body)
    const fixed = body.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档与权限'))
    const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1))
    const priorToolNames = body.messages.flatMap((message: any) => message.role === 'assistant' && Array.isArray(message.tool_calls)
      ? message.tool_calls.map((toolCall: any) => toolCall.function?.name) : [])
    const loadToolsName = modelToolWireName('tools.load')
    const generateImageName = modelToolWireName('image.generate')
    if (!priorToolNames.includes(loadToolsName)) {
      expect(body.tools.some((tool: any) => tool.function.name === loadToolsName)).toBe(true)
      response.write(sse({ id: 'text-load-image-tools', model: 'fixture-text-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'load-image-tools', type: 'function', function: { name: loadToolsName, arguments: JSON.stringify({ families: ['media'] }) } }] }, finish_reason: null }] }))
      response.end(sse({ id: 'text-load-image-tools', model: 'fixture-text-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    } else if (!priorToolNames.includes(generateImageName)) {
      expect(body.tools.some((tool: any) => tool.function.name === generateImageName)).toBe(true)
      response.write(sse({ id: 'text-tool', model: 'fixture-text-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'generate-image', type: 'function', function: { name: generateImageName, arguments: JSON.stringify({ target: references[0].target, prompt: 'initial local image fixture', output: { format: 'png' } }) } }] }, finish_reason: null }] }))
      response.end(sse({ id: 'text-tool', model: 'fixture-text-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    } else response.end(sse({ id: 'text-finish', model: 'fixture-text-model', choices: [{ index: 0, delta: { role: 'assistant', content: '图片已生成，尚未应用。' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await electron.launch({ cwd: root, args: [join(root, 'tests/e2e/helpers/g20ImageResultsBootstrap.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', G20_IMAGE_HTTP_FIXTURE: endpoint, [BACKGROUND_E2E_ENV]: '1' } })
  try {
    await app.evaluate(async () => { await (globalThis as FixtureMain).__G20_IMAGE_RESULTS_FIXTURE__.ready })
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: '图像闭环.h5lesson', exact: true }).dblclick()
    await expect.poll(() => page.evaluate(async filename => (await window.desktopAPI!.documents!.list()).some(item => item.binding.kind === 'file' && item.binding.path === filename), filename)).toBe(true)
    const initial = await page.evaluate(async filename => (await window.desktopAPI!.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path === filename)!, filename)
    if (initial.model.kind !== 'course-v9') throw new Error('Expected course')
    const location = initial.model.project.locations.find(value => value.kind === 'slide-scene')!
    const read = () => page.evaluate(id => window.desktopAPI!.documents!.read(id), initial.documentId)
    await page.getByLabel('给创作助手发消息').fill('生成一张图片，先让我查看后再选择插入。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    let cards = await expandImages(page, 1), originalCard = cards.nth(0)
    await expect(originalCard.getByRole('status')).toHaveText('已生成，尚未应用')
    await originalCard.getByRole('button', { name: '预览图片', exact: true }).click()
    await expect(originalCard.getByAltText('生成的图片预览')).toBeVisible()
    expect((await read()).revision).toBe(initial.revision)
    expect(imageBodies).toHaveLength(1)
    await originalCard.getByLabel('应用到课件').selectOption(initial.documentId)
    await originalCard.getByLabel('插入位置').selectOption(location.id)
    const placement = originalCard.locator('details.image-result-card__placement')
    await expect(placement.locator('summary')).toContainText('画布位置与尺寸')
    await placement.locator('summary').click()
    const frame = { x: 760, y: 380, width: 400, height: 280 }
    await placement.getByLabel('X', { exact: true }).fill(String(frame.x))
    await placement.getByLabel('Y', { exact: true }).fill(String(frame.y))
    await placement.getByLabel('宽', { exact: true }).fill(String(frame.width))
    await placement.getByLabel('高', { exact: true }).fill(String(frame.height))
    await expect(placement.locator('summary')).toContainText('X 760 · Y 380 · 400×280')
    const placementScreenshot = join(directory, 'image-result-placement.png')
    await page.screenshot({ path: placementScreenshot })
    await info.attach('image result placement controls', { path: placementScreenshot, contentType: 'image/png' })
    await originalCard.getByRole('button', { name: '插入图片', exact: true }).click()
    await expect.poll(async () => (await read()).undoDepth).toBe(initial.undoDepth + 1)
    const inserted = images(await read()).find(item => !images(initial).some(old => old.layerItemId === item.layerItemId))!
    expect(inserted).toBeDefined()
    expect(inserted.frame).toMatchObject(frame)
    const lightTools = page.locator('.course-light-tools')
    await lightTools.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => images(await read()).map(item => item.layerItemId)).not.toContain(inserted.layerItemId)
    await lightTools.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => images(await read()).map(item => item.layerItemId)).toContain(inserted.layerItemId)
    await originalCard.getByLabel('继续编辑图片').fill('将这张参考图改为橙色，保留形状。')
    await originalCard.getByRole('button', { name: '发送图片编辑请求', exact: true }).click()
    cards = await expandImages(page, 2)
    const editCard = cards.nth(1)
    await expect(editCard.getByRole('status')).toHaveText('已生成，尚未应用')
    expect(imageBodies[1].images[0].image_url).toBe(`data:image/png;base64,${generated.toString('base64')}`)
    expect(imageBodies[1].model).toBe('fixture-image-edit-model')
    const paintedImage = page.locator(`[data-slide-layer-item="${inserted.layerItemId}"]:visible`).first()
    await expect(paintedImage).toBeVisible()
    await expect(page.locator('.canvas-viewport')).toHaveAttribute('data-observation-ready', 'true')
    let paintedBounds = await paintedImage.boundingBox()
    if (!paintedBounds) throw new Error('AI image has no painted bounds')
    await page.mouse.click(paintedBounds.x + paintedBounds.width / 2, paintedBounds.y + paintedBounds.height / 2)
    await editCard.getByLabel('应用到课件').selectOption(initial.documentId)
    await expect(editCard.getByRole('button', { name: '替换选中图片', exact: true })).toBeEnabled()
    await editCard.getByRole('button', { name: '替换选中图片', exact: true }).click()
    await expect.poll(async () => (await read()).undoDepth).toBe(initial.undoDepth + 2)
    expect(images(await read()).some(item => item.layerItemId === inserted.layerItemId)).toBe(true)
    // The image created by the real Engine/Image Results route must use the
    // same light-workbench selection and canonical property commands as a
    // manually inserted Native image.
    await expect(paintedImage).toBeVisible()
    await expect(page.locator('.canvas-viewport')).toHaveAttribute('data-observation-ready', 'true')
    paintedBounds = await paintedImage.boundingBox()
    if (!paintedBounds) throw new Error('AI image has no painted bounds')
    await page.mouse.click(paintedBounds.x + paintedBounds.width / 2, paintedBounds.y + paintedBounds.height / 2)
    const quickTools = page.getByRole('toolbar', { name: '选中对象快捷工具' })
    await expect(quickTools).toBeVisible()
    await quickTools.getByRole('button', { name: '属性', exact: true }).click()
    const quickProperties = page.getByRole('complementary', { name: '选中对象属性' })
    await expect(quickProperties).toBeVisible()
    const beforeProperties = await read()
    const beforeImage = images(beforeProperties).find(item => item.layerItemId === inserted.layerItemId)
    if (!beforeImage || beforeImage.kind !== 'native' || beforeImage.content.nativeType !== 'image') throw new Error('AI image missing from formal course')
    const nextWidth = Math.round(beforeImage.frame.width) + 28
    const width = quickProperties.getByLabel('宽', { exact: true })
    await width.fill(String(nextWidth)); await width.press('Tab')
    await expect.poll(async () => images(await read()).find(item => item.layerItemId === inserted.layerItemId)?.frame.width).toBe(nextWidth)
    const crop = quickProperties.locator('details[aria-label="图片裁剪"]')
    await crop.locator('summary').click()
    await crop.getByRole('slider', { name: '左裁剪' }).press('ArrowRight')
    await expect.poll(async () => {
      const item = images(await read()).find(candidate => candidate.layerItemId === inserted.layerItemId)
      return item?.kind === 'native' && item.content.nativeType === 'image' ? item.content.data.crop.left : null
    }).toBe(0.01)
    expect((await read()).undoDepth).toBe(beforeProperties.undoDepth + 2)
    const popover = page.locator('.native-selection-context.canvas-mode-switch:visible')
    const canvas = page.getByRole('main', { name: '课件画布' })
    const bounds = async () => {
      const [panel, content, toolbar] = await Promise.all([
        popover.boundingBox(), canvas.boundingBox(), page.getByLabel('课件常用工具').boundingBox(),
      ])
      if (!panel || !content || !toolbar) return null
      return { panel, content, toolbar }
    }
    await expect.poll(async () => {
      const measured = await bounds()
      if (!measured) return false
      const { panel, content, toolbar } = measured
      return toolbar.y + toolbar.height <= content.y + 1
        && panel.x >= content.x - 1 && panel.y >= content.y - 1
        && panel.x + panel.width <= content.x + content.width + 1
        && panel.y + panel.height <= content.y + content.height + 1
    }).toBe(true)
    const popoverBounds = await bounds()
    writeFileSync(join(directory, 'ai-native-popover-bounds.json'), JSON.stringify(popoverBounds, null, 2))
    const aiPropertiesImage = join(directory, 'ai-native-light-properties.png')
    await page.screenshot({ path: aiPropertiesImage })
    await info.attach('AI native image light properties', { path: aiPropertiesImage, contentType: 'image/png' })
    await quickTools.getByRole('button', { name: 'AI 修改选中内容' }).click()
    await expect(page.getByLabel('选中对象的修改要求')).toBeVisible()
    await page.getByLabel('选中对象的修改要求').fill('修改这张图片的视觉风格')
    await expect(page.getByRole('button', { name: '交给创作助手' })).toBeEnabled()
    await page.getByRole('button', { name: '取消引用' }).click()
    const beforeLate = await read()
    await originalCard.getByLabel('继续编辑图片').fill('hold-late：把原图改为紫色，暂不应用。')
    await originalCard.getByRole('button', { name: '发送图片编辑请求', exact: true }).click()
    cards = await expandImages(page, 3)
    const lateCard = cards.nth(2)
    await expect.poll(() => app.evaluate(() => (globalThis as FixtureMain).__G20_IMAGE_RESULTS_FIXTURE__.lateReady)).toBe(true)
    await lateCard.getByRole('button', { name: '停止图片请求', exact: true }).click()
    await expect(lateCard.getByRole('status')).toHaveText('结果未知；不会自动重发')
    await app.evaluate(() => (globalThis as FixtureMain).__G20_IMAGE_RESULTS_FIXTURE__.releaseLate!())
    await expect(lateCard.getByRole('status')).toHaveText('已生成，停止后尚未应用')
    await lateCard.getByRole('button', { name: '预览图片', exact: true }).click()
    const lateBytes = await lateCard.getByAltText('生成的图片预览').evaluate(async image => Array.from(new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer())))
    expect(Buffer.from(lateBytes)).toEqual(late)
    expect((await read()).revision).toBe(beforeLate.revision)
    expect(imageBodies[2].images[0].image_url).toBe(`data:image/png;base64,${generated.toString('base64')}`)
    await lightTools.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.workspace-document-status')).toHaveText('已保存')
    const saved = await read(), archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(archive.project).toEqual(saved.model.kind === 'course-v9' ? saved.model.project : null)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 图像闭环.h5lesson', exact: true }).click()
    await tree.getByRole('button', { name: '图像闭环.h5lesson', exact: true }).dblclick()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /^图像闭环\.h5lesson/ })).toHaveAttribute('aria-selected', 'true')
    const reopenedId = await page.locator('.course-editor-frame:visible').getAttribute('data-document-id')
    if (!reopenedId || reopenedId === initial.documentId) throw new Error('Tree reopen did not create a new DocumentSession')
    const reopened = await page.evaluate(id => window.desktopAPI!.documents!.read(id), reopenedId)
    expect(reopened.model).toEqual(saved.model)
    cards = await expandImages(page, 3); originalCard = cards.nth(0)
    await originalCard.getByRole('button', { name: '预览图片', exact: true }).click()
    const previewBytes = await originalCard.getByAltText('生成的图片预览').evaluate(async image => Array.from(new Uint8Array(await (await fetch((image as HTMLImageElement).src)).arrayBuffer())))
    expect(Buffer.from(previewBytes)).toEqual(generated)
    const owner = await page.evaluate(async workspace => {
      const state = await window.desktopAPI!.execution!.workspace(workspace)
      const conversation = state.conversations.find(value => value.runIndex.builtinRunIds.length)!
      const results = await window.desktopAPI!.imageResults!.list({ workspaceId: state.workspace.workspaceId, conversationId: conversation.conversationId })
      return { workspaceId: state.workspace.workspaceId, conversationId: conversation.conversationId, results }
    }, workspace)
    expect(owner.results).toHaveLength(3)
    expect(owner.results.find(result => result.job.operation === 'generate')?.job.provenance.requestedImageModel).toBe('fixture-image-model')
    expect(owner.results.find(result => result.job.status === 'unapplied')?.job.stopped).toBe(true)
    await page.screenshot({ path: join(directory, 'image-result-reopened.png') })
    const resourceFiles = owner.results.flatMap(result => result.job.resources.map(resource => join(directory, 'profile', 'workbench-v2', 'images', 'resources', `${resource.digest}.blob`)))
    expect(resourceFiles).toHaveLength(3)
    expect(resourceFiles.every(existsSync)).toBe(true)
    const conversationIdentity = { workspaceId: owner.workspaceId, conversationId: owner.conversationId }
    await page.evaluate(async identity => {
      const conversation = await window.desktopAPI!.execution!.conversation(identity.workspaceId, identity.conversationId)
      if (!conversation) throw new Error('Expected image conversation')
      await window.desktopAPI!.execution!.deleteConversation({ ...identity, expectedRevision: conversation.revision })
    }, conversationIdentity)
    await expect.poll(() => resourceFiles.every(filename => !existsSync(filename))).toBe(true)
    expect((await page.evaluate(id => window.desktopAPI!.documents!.read(id), reopened.documentId)).model).toEqual(reopened.model)
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(filename))).project).toEqual(saved.model.kind === 'course-v9' ? saved.model.project : null)
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ textRequests: textBodies.length, imageRequests: imageBodies.length,
      results: owner.results, resourceFilesReleased: resourceFiles, savedDocumentRetained: true, errors, serverErrors }, null, 2))
    await info.attach('image-results', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    expect(textBodies).toHaveLength(3); expect(imageBodies).toHaveLength(3)
    expect(errors).toEqual([]); expect(serverErrors).toEqual([])
  } catch (error) {
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ textRequests: textBodies.length, imageRequests: imageBodies.length, serverErrors }, null, 2))
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { (globalThis as FixtureMain).__G20_IMAGE_RESULTS_FIXTURE__.releaseLate?.(); BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
