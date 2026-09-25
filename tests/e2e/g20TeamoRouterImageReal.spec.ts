import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { disclosedExecutionSettings } from '../../src/shared/workbench/executionDesktop'

const root = resolve(__dirname, '../..')
const teamoEndpoint = 'https://api.teamorouter.com/v1'
const imageModel = 'gpt-image-2'
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

function expectSupportedRaster(mimeType: string, raw: Uint8Array) {
  const bytes = Buffer.from(raw)
  expect(['image/png', 'image/jpeg', 'image/webp']).toContain(mimeType)
  if (mimeType === 'image/png')
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  else if (mimeType === 'image/jpeg')
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]))
  else {
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP')
  }
}

function apiKey(): string {
  const key = process.env.TEAMOROUTER_API_KEY || execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('TEAMOROUTER_API_KEY','User')"], { encoding: 'utf8' }).trim()
  if (!key) throw new Error('TEAMOROUTER_API_KEY is absent; no image request was made')
  return key
}

// A loopback text model issues one deterministic image.generate call. The only paid
// model request in this test is made by the product's TeamoRouter image provider.
function textFixture() {
  const requests: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') throw new Error('Unexpected text request')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body.model !== 'fixture-image-controller') throw new Error('Unexpected text model')
    const prior = body.messages.flatMap((message: any) => message.role === 'assistant' && Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call: any) => call.function?.name) : [])
    const load = modelToolWireName('tools.load'), generate = modelToolWireName('image.generate')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (!prior.includes(load)) {
      requests.push('tools.load')
      response.write(sse({ id: 'load-media', model: body.model, choices: [{ index: 0,
        delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'load-media', type: 'function',
          function: { name: load, arguments: JSON.stringify({ families: ['media'] }) } }] }, finish_reason: null }] }))
      response.end(sse({ id: 'load-media', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    } else if (!prior.includes(generate)) {
      requests.push('image.generate')
      if (requests.filter(value => value === 'image.generate').length !== 1) throw new Error('Second image request refused')
      const fixed = body.messages.find((message: any) => typeof message.content === 'string'
        && message.content.startsWith('本次固定文档与权限'))
      if (!fixed) throw new Error('Missing frozen document target')
      const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1))
      if (!references[0]?.target) throw new Error('Missing image target')
      response.write(sse({ id: 'make-image', model: body.model, choices: [{ index: 0,
        delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'make-image', type: 'function',
          function: { name: generate, arguments: JSON.stringify({ target: references[0].target,
            prompt: '简洁教学插图：一片绿色叶子和一束温暖阳光，纯白背景，无文字。' }) } }] },
        finish_reason: null }] }))
      response.end(sse({ id: 'make-image', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    } else {
      requests.push('finish')
      response.end(sse({ id: 'image-finished', model: body.model, choices: [{ index: 0,
        delta: { role: 'assistant', content: '图片已生成，等待预览和插入。' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')
    }
  })().catch(error => { response.destroy(error) }) })
  return { server, requests }
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' }) // The API key crosses page.evaluate once.
test.describe.configure({ retries: 0, mode: 'serial' }) // Never replay an uncertain paid request.

test('TeamoRouter gpt-image-2: live catalog, one image job, raster preview and saved course', async ({}, info) => {
  test.skip(process.env.G20_TEAMOROUTER_IMAGE_REAL !== '1', 'Real image request requires an explicit gate')
  test.setTimeout(600_000)
  const key = apiKey()
  const base = join(root, 'output/g20/s14/teamorouter-image-real')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const filename = join(workspace, 'TeamoRouter图片验收.h5lesson')
  copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), filename)
  const fixture = textFixture()
  await new Promise<void>(done => fixture.server.listen(0, '127.0.0.1', done))
  const localBase = `http://127.0.0.1:${(fixture.server.address() as { port: number }).port}/v1`
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !['TEAMOROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'].includes(name.toUpperCase())))
  const evidence: Record<string, unknown> = { route: 'teamorouter', requestedImageModel: imageModel,
    declaredBilling: 'metered', actualCharge: 'unknown', imageGenerateToolCalls: 0, imageJobs: 0,
    result: 'not-sent' }
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let stage = 'launch'
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
      env: { ...childEnv, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    stage = 'connection'
    const connections = await page.evaluate(async input => {
      const api = window.desktopAPI!.executionSettings!
      const text = await api.saveConnection({ apiKey: 'loopback-text-only', connection: {
        provider: 'image-e2e-fixture', protocol: 'openai-chat', baseURL: input.localBase,
        imageProtocol: null, accountId: 'fixture-text', authKind: 'api-key', billing: { kind: 'unknown' } } })
      const image = await api.saveConnection({ apiKey: input.key, connection: {
        provider: 'teamorouter', protocol: 'openai-chat', baseURL: input.teamoEndpoint,
        imageProtocol: 'openai-images', accountId: 'owner-authorized-image-api',
        authKind: 'api-key', billing: { kind: 'metered' } } })
      return { text, image }
    }, { key, localBase, teamoEndpoint })
    expect(connections.image).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: 'teamorouter', protocol: 'openai-chat', baseURL: teamoEndpoint,
      imageProtocol: 'openai-images', auth: { kind: 'api-key' }, billing: { kind: 'metered' } } })

    stage = 'free-live-catalog'
    const catalog = await page.evaluate(input => window.desktopAPI!.executionSettings!.discoverModels(input.id, input.revision),
      { id: connections.image.connection.id, revision: connections.image.connection.revision })
    expect(catalog.source, 'Require a live no-fee catalog, not cached evidence').toBe('live')
    expect(catalog.models.map(item => item.id), 'No paid image call unless gpt-image-2 is listed').toContain(imageModel)
    evidence.catalog = { source: catalog.source, checkedAt: catalog.checkedAt, selectedPresent: true,
      count: catalog.models.length, capabilitiesVerified: catalog.capabilitiesVerified }

    stage = 'frozen-role'
    await page.evaluate(async input => {
      const api = window.desktopAPI!.executionSettings!, current = await api.read()
      await api.saveProfile({ expectedRevision: current.profile.revision, roles: {
        conversation: { connectionId: input.textId, model: 'fixture-image-controller' },
        vision: null, imageGenerate: { connectionId: input.imageId, model: input.imageModel }, imageEdit: null,
      } })
    }, { textId: connections.text.connection.id, imageId: connections.image.connection.id, imageModel })
    const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(settings.connections.every(item => item.connection.auth.kind === 'api-key')).toBe(true)
    expect(settings.connections.find(item => item.connection.id === connections.image.connection.id)?.connection)
      .toMatchObject({ provider: 'teamorouter', protocol: 'openai-chat', imageProtocol: 'openai-images',
        baseURL: teamoEndpoint, billing: { kind: 'metered' } })
    expect(settings.profile.roles.imageEdit).toBeNull()
    const disclosed = disclosedExecutionSettings(settings)
    expect(disclosed.roles.imageGenerate).toMatchObject({ provider: 'teamorouter', model: imageModel,
      billingKind: 'metered', connectionId: connections.image.connection.id })
    evidence.frozenImageRole = disclosed.roles.imageGenerate
    // Settings were written through the product IPC after the first render. Reload the
    // renderer so the visible composer freezes the same roles at Send.
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()

    stage = 'workspace'
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: 'TeamoRouter图片验收.h5lesson', exact: true }).dblclick()
    await expect.poll(async () => (await page.evaluate(async path => (await window.desktopAPI!.documents!.list())
      .some(item => item.binding.kind === 'file' && item.binding.path === path), filename))).toBe(true)
    const initial = await page.evaluate(async path => (await window.desktopAPI!.documents!.list())
      .find(item => item.binding.kind === 'file' && item.binding.path === path), filename)
    expect(initial?.model.kind).toBe('course-v9')
    if (!initial || initial.model.kind !== 'course-v9') throw new Error('V9 document not open')
    const location = initial.model.project.locations.find(value => value.kind === 'slide-scene')
    if (!location) throw new Error('Slide target missing')

    stage = 'one-paid-image-request'
    evidence.result = 'send-intended'
    writeFileSync(join(directory, 'send-intent.json'), JSON.stringify({ stage, at: new Date().toISOString(),
      route: 'teamorouter', model: imageModel, repeatPolicy: 'never retry after unknown result' }, null, 2))
    await page.getByLabel('给创作助手发消息').fill('生成一张叶子与阳光的教学插图，先给我预览，不要自动插入。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    evidence.result = 'send-clicked'

    stage = 'image-job'
    await expect.poll(async () => {
      const state = await page.evaluate(async path => {
        const space = await window.desktopAPI!.execution!.workspace(path)
        const conversation = space.conversations.find(item => item.runIndex.builtinRunIds.length)
        if (!conversation) return null
        const results = await window.desktopAPI!.imageResults!.list({ workspaceId: space.workspace.workspaceId,
          conversationId: conversation.conversationId })
        return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, results }
      }, workspace)
      return state?.results.length ? state : null
    }, { timeout: 360_000, intervals: [500, 1000, 2000] }).not.toBeNull()
    const result = await page.evaluate(async path => {
      const space = await window.desktopAPI!.execution!.workspace(path)
      const conversation = space.conversations.find(item => item.runIndex.builtinRunIds.length)!
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        results: await window.desktopAPI!.imageResults!.list({ workspaceId: space.workspace.workspaceId,
          conversationId: conversation.conversationId }) }
    }, workspace)
    expect(result.results).toHaveLength(1)
    const image = result.results[0]!
    await expect.poll(async () => (await page.evaluate(input => window.desktopAPI!.imageResults!.read(input), {
      workspaceId: result.workspaceId, conversationId: result.conversationId,
      runId: image.runId, jobId: image.job.jobId })).job.status,
    { timeout: 360_000, intervals: [500, 1000, 2000] }).toBe('ready')
    const ready = await page.evaluate(input => window.desktopAPI!.imageResults!.read(input), {
      workspaceId: result.workspaceId, conversationId: result.conversationId, runId: image.runId, jobId: image.job.jobId })
    expect(ready.job.provenance).toMatchObject({ executor: 'guoling-openai-images-api',
      endpoint: `${teamoEndpoint}/images/generations`, connectionId: connections.image.connection.id,
      connectionRevision: connections.image.connection.revision,
      accountId: 'owner-authorized-image-api',
      authKind: 'api-key', billing: { kind: 'metered' }, requestedImageModel: imageModel,
      querySupport: 'unavailable', charge: 'unknown' })
    // The provider may omit its actual model; preserve that distinction in evidence.
    expect(ready.job.resources).toHaveLength(1)
    const resource = ready.job.resources[0]!
    expect(resource.width).toBeGreaterThan(1)
    expect(resource.height).toBeGreaterThan(1)
    const preview = await page.evaluate(input => window.desktopAPI!.imageResults!.preview(input), {
      workspaceId: result.workspaceId, conversationId: result.conversationId, runId: image.runId,
      jobId: image.job.jobId, resourceId: resource.resourceId })
    expect(preview.mimeType).toBe(resource.mimeType)
    expectSupportedRaster(preview.mimeType, preview.bytes)
    expect(Buffer.from(preview.bytes).byteLength).toBe(resource.byteLength)
    evidence.imageJobs = 1
    evidence.provenance = ready.job.provenance
    evidence.resource = resource
    evidence.actualImageFormat = preview.mimeType

    stage = 'visible-preview-and-apply'
    const card = page.locator('.execution-timeline__card--image').first()
    await expect(card).toBeVisible()
    const details = card.locator('details').first()
    if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click()
    await expect(card.getByRole('status')).toHaveText('已生成，尚未应用')
    await card.getByRole('button', { name: '预览图片', exact: true }).click()
    await expect(card.getByAltText('生成的图片预览')).toBeVisible()
    const visiblePreview = await card.getByAltText('生成的图片预览').evaluate(async node => {
      const image = node as HTMLImageElement
      return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
        bytes: Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())) }
    })
    expect(visiblePreview.naturalWidth).toBe(resource.width)
    expect(visiblePreview.naturalHeight).toBe(resource.height)
    expect(Buffer.from(visiblePreview.bytes)).toEqual(Buffer.from(preview.bytes))
    await card.getByLabel('应用到课件').selectOption(initial.documentId)
    await card.getByLabel('插入位置').selectOption(location.id)
    const placement = card.locator('details.image-result-card__placement')
    await placement.locator('summary').click()
    await placement.getByLabel('X', { exact: true }).fill('760')
    await placement.getByLabel('Y', { exact: true }).fill('380')
    await placement.getByLabel('宽', { exact: true }).fill('400')
    await placement.getByLabel('高', { exact: true }).fill('280')
    await card.getByRole('button', { name: '插入图片', exact: true }).click()
    const read = () => page.evaluate(id => window.desktopAPI!.documents!.read(id), initial.documentId)
    await expect.poll(async () => (await read()).revision).toBeGreaterThan(initial.revision)
    const applied = await read()
    if (applied.model.kind !== 'course-v9') throw new Error('Course changed type')
    const oldIds = new Set(initial.model.project.surfaces.flatMap(surface => surface.type === 'slide'
      ? surface.scenes.flatMap(scene => scene.layerItems.map(item => item.layerItemId)) : []))
    const inserted = applied.model.project.surfaces.flatMap(surface => surface.type === 'slide'
      ? surface.scenes.flatMap(scene => scene.layerItems.filter(item => item.kind === 'native'
        && item.content.nativeType === 'image' && !oldIds.has(item.layerItemId))) : [])
    expect(inserted).toHaveLength(1)
    await page.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.workspace-document-status')).toHaveText('已保存')
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(filename)))
    expect(archive.project).toEqual(applied.model.project)
    const insertedItem = inserted[0]
    if (!insertedItem || insertedItem.kind !== 'native' || insertedItem.content.nativeType !== 'image')
      throw new Error('Inserted image missing from saved course')
    expect(Buffer.from(archive.assetFiles[insertedItem.content.data.assetId]!)).toEqual(Buffer.from(preview.bytes))
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 TeamoRouter图片验收.h5lesson', exact: true }).click()
    await tree.getByRole('button', { name: 'TeamoRouter图片验收.h5lesson', exact: true }).dblclick()
    const reopenedId = await page.locator('.course-editor-frame:visible').getAttribute('data-document-id')
    expect(reopenedId).toBeTruthy()
    expect(reopenedId).not.toBe(initial.documentId)
    const reopened = await page.evaluate(id => window.desktopAPI!.documents!.read(id!), reopenedId)
    expect(reopened.model).toEqual(applied.model)
    evidence.result = 'ready-preview-insert-saved-reopened'
    evidence.imageGenerateToolCalls = fixture.requests.filter(value => value === 'image.generate').length
    evidence.textFixtureRequests = fixture.requests.length
    evidence.rendererErrors = errors
    expect(evidence.imageGenerateToolCalls).toBe(1)
    expect(errors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('teamorouter-image-evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    evidence.failedStage = stage
    evidence.imageGenerateToolCalls = fixture.requests.filter(value => value === 'image.generate').length
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    throw error
  } finally {
    await app?.close().catch(() => undefined)
    fixture.server.closeAllConnections()
    await new Promise<void>(done => fixture.server.close(() => done()))
  }
})
