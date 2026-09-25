import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const root = resolve(__dirname, '../..')
const count = 5_000
const model = 'fixture-m09-long-output'
const commandOutput = Array.from({ length: 1_500 }, (_, index) => `命令输出 ${index.toString().padStart(4, '0')}：读取、核对、继续。`).join('\n')
const frame = (id: string, delta: unknown, finish: string | null = null, usage?: unknown) =>
  `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`

function gate() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

async function chooseWorkspace(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
}

test('M09-T02 keeps long output, focus, reading position, expansion and busy state through a continuing real-host stream', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'The acceptance carrier is the Windows Electron desktop.')
  test.setTimeout(240_000)
  const base = join(root, 'output/g20/m09/long-output'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const filename = join(workspace, '过程样本.md')
  writeFileSync(filename, '# 过程样本\n\n请读取这一份文档。\n')
  const afterFirstText = gate(), beforeLastText = gate()
  const requests: { model: string; toolResult?: string }[] = [], serverErrors: string[] = [], rendererErrors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: model }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected fixture route ${request.method} ${request.url}`)
    let raw = ''; for await (const bytes of request) raw += bytes.toString()
    const body = JSON.parse(raw) as { model: string; messages: { role: string; content: string; tool_call_id?: string }[]; tools: { function: { name: string } }[] }
    if (body.model !== model) throw new Error(`Wrong model: ${body.model}`)
    requests.push({ model: body.model, toolResult: body.messages.find(message => message.tool_call_id === 'm09-list')?.content })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const frozen = body.messages.find(message => message.content?.startsWith(prefix))
      if (!frozen) throw new Error('The real run has no frozen document reference')
      const refs = JSON.parse(frozen.content.slice(prefix.length)) as { target: string }[]
      if (refs.length !== 1 || !refs[0]?.target) throw new Error('The fixture expected one document target')
      const wire = modelToolWireName('listChildren')
      if (!body.tools.some(tool => tool.function.name === wire)) throw new Error('The real model catalog omitted listChildren')
      response.write(frame('m09-first', { role: 'assistant', content: '正文第一段：开始核对。' }))
      await afterFirstText.wait
      response.write(frame('m09-first', { content: '正文第二段：准备读取。' }))
      response.write(frame('m09-first', { tool_calls: [{ index: 0, id: 'm09-list', type: 'function', function: {
        name: wire, arguments: JSON.stringify({ target: refs[0].target, limit: 20 }),
      } }] }, 'tool_calls', { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 }))
    } else if (requests.length === 2) {
      if (!requests[1]?.toolResult) throw new Error('The real tool result was not returned to the provider')
      response.write(frame('m09-second', { role: 'assistant', content: '正文第三段：工具结果已到达。' }))
      await beforeLastText.wait
      response.write(frame('m09-second', { content: '正文第四段：任务完成。' }, 'stop', { prompt_tokens: 60, completion_tokens: 18, total_tokens: 78 }))
    } else throw new Error('Unexpected extra provider request')
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | undefined
  let page: Page | undefined
  let conversationId = ''
  const evidence: Record<string, unknown> = { caseId: 'M09-T02', fixture: { durableEventCount: count, commandOutputCharacters: commandOutput.length,
    provider: 'local-http-sse', charge: 0 }, dom: {}, screenReader: { status: 'not_observed', reason: 'DOM and accessibility attributes are not a real screen reader observation.' } }
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => rendererErrors.push(error.message))
    await page.bringToFront()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 920))
    await page.evaluate(async input => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 'fixture-only-no-real-account', connection: {
        provider: 'fixture-m09', protocol: 'openai-chat', baseURL: input.address, accountId: 'local-fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: connection.connection.id, model: input.model },
        vision: null, imageGenerate: null, imageEdit: null } })
    }, { address: endpoint, model })
    await chooseWorkspace(app, page, workspace)
    conversationId = await page.evaluate(async input => {
      const api = window.desktopAPI!, opened = await api.execution!.workspace(input.workspace)
      const conversation = opened.conversations[0] ?? await api.execution!.createConversation(opened.workspace.workspaceId)
      return conversation.conversationId
    }, { workspace })
    await closeApp(app); app = undefined; page = undefined

    // Seed only while Main is closed: no second writer or event subscription is bypassed during the live task.
    const store = new ExecutionEventStore({ directory: join(profile, 'workbench-v2/events') })
    const oldRun = 'm09-seeded-run', time = Date.now() - 60_000
    for (let start = 0; start < count; start += 500) {
      const batch: ExecutionEventInput[] = Array.from({ length: 500 }, (_, offset) => {
        const index = start + offset
        const baseEvent: ExecutionEventInput = { eventId: `m09-seed-${index}`, conversationId, taskId: 'm09-seeded-task', runId: oldRun,
          itemId: `item-${index}`, time: time + index, source: 'builtin', update: 'snapshot', type: 'text',
          data: { text: `记录 ${index}：历史过程可分页读取。` } }
        if (index === 4_970) return { ...baseEvent, itemId: 'command-output', type: 'tool', data: { label: '连续命令输出', toolName: 'fixture.command', status: 'running', text: '第一块输出\n' } }
        if (index === 4_971) return { ...baseEvent, itemId: 'command-output', type: 'tool', update: 'append', data: { status: 'running', text: '第二块输出\n' } }
        if (index === 4_972) return { ...baseEvent, itemId: 'command-output', type: 'tool', update: 'append', data: { status: 'running', text: '第三块输出\n' } }
        if (index === 4_973) return { ...baseEvent, itemId: 'command-output', type: 'tool', update: 'append', data: { status: 'completed', output: commandOutput } }
        if (index === count - 1) return { ...baseEvent, type: 'run.end', data: { status: 'completed', text: '历史任务完成' } }
        return baseEvent
      })
      await store.batchAppend(batch)
    }
    expect((await store.snapshot(conversationId)).cursor).toBe(count)

    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    page.on('pageerror', error => rendererErrors.push(error.message))
    await page.bringToFront()
    await chooseWorkspace(app, page, workspace)
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '过程样本.md', exact: true }).dblclick()
    await page.evaluate(async input => {
      const api = window.desktopAPI!, opened = await api.execution!.workspace(input.workspace)
      const conversation = await api.execution!.conversation(opened.workspace.workspaceId, input.conversationId)
      if (!conversation) throw new Error('The seeded conversation was not restored')
      const document = await api.documents!.open(input.filename)
      await api.execution!.draft({ workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId,
        expectedRevision: conversation.revision, text: '读取绑定文档，报告核对过程。',
        documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [] }], attachments: [] })
    }, { workspace, filename, conversationId })
    await page.reload()
    const timeline = page.getByRole('region', { name: '任务过程' }), history = page.locator('.execution-assistant__history')
    const composer = page.getByLabel('给创作助手发消息')
    const currentReply = () => page!.evaluate(async id => {
      const projection = await window.desktopAPI!.execution!.timeline(id)
      return projection.items.filter(item => item.type === 'text' && item.taskId !== 'm09-seeded-task')
        .flatMap(item => item.content.filter(part => part.kind === 'text').map(part => part.text)).join('')
    }, conversationId)
    await expect(composer).toHaveValue('读取绑定文档，报告核对过程。')
    await expect(page.locator('[data-execution-item]')).toHaveCount(100)
    await expect(timeline).toHaveAttribute('aria-busy', 'false')
    const tool = timeline.locator('.execution-timeline__card--tool').filter({ hasText: '连续命令输出' })
    await tool.locator('summary').click()
    await expect(tool.locator('details')).toHaveAttribute('open', '')
    await tool.getByRole('button', { name: /读取完整内容/ }).click()
    await expect(tool.getByRole('button', { name: /继续读取内容/ })).toBeVisible()
    await tool.getByRole('button', { name: /继续读取内容/ }).click()
    const outputLength = await tool.getByRole('region', { name: '工具输出' }).locator('pre').textContent().then(value => value?.length ?? 0)
    expect(outputLength).toBe(24_000)

    await composer.focus()
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(1)
    await expect(timeline).toHaveAttribute('aria-busy', 'true')
    await expect.poll(currentReply).toContain('正文第一段：开始核对。')
    const stable = await page.evaluate(() => {
      const node = [...document.querySelectorAll<HTMLElement>('.execution-timeline__card--tool')].find(item => item.textContent?.includes('连续命令输出'))
      if (!node) throw new Error('Expanded historical output missing')
      ;(window as typeof window & { __m09Stable?: HTMLElement }).__m09Stable = node
      return { live: node.closest('[aria-live]')?.getAttribute('aria-live') ?? null, text: node.querySelector('pre')?.textContent?.length ?? 0 }
    })
    expect(stable.live).toBeNull()

    // Scroll away from the bottom while the first provider response is held.
    await history.evaluate(element => { element.scrollTop = Math.max(0, element.scrollTop - 350); element.dispatchEvent(new Event('scroll')) })
    await expect(timeline.getByRole('button', { name: /回到最新/ })).toBeVisible()
    const before = await history.evaluate(element => element.scrollTop)
    await composer.focus()
    afterFirstText.release()
    await expect.poll(() => requests.length).toBe(2)
    await expect(timeline).toHaveAttribute('aria-busy', 'true') // Usage and a completed tool do not end the run.
    await expect(tool.locator('details')).toHaveAttribute('open', '')
    const during = await history.evaluate(element => element.scrollTop)
    expect(Math.abs(during - before)).toBeLessThan(45)
    expect(await composer.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await page.evaluate(() => (window as typeof window & { __m09Stable?: HTMLElement }).__m09Stable?.isConnected)).toBe(true)
    const interleaved = await page.evaluate(async id => {
      const projection = await window.desktopAPI!.execution!.timeline(id)
      return projection.items.filter(item => item.type === 'usage' || item.type === 'tool').slice(-2).map(item => ({ type: item.type, status: item.data.status }))
    }, conversationId)
    expect(interleaved).toEqual([{ type: 'tool', status: 'completed' }, { type: 'usage', status: undefined }])

    beforeLastText.release()
    await expect.poll(currentReply).toContain('正文第四段：任务完成。')
    await expect(timeline).toHaveAttribute('aria-busy', 'false')
    await expect(tool.locator('details')).toHaveAttribute('open', '')
    await expect(timeline.getByRole('button', { name: /回到最新/ })).toBeVisible()
    await timeline.getByRole('button', { name: /回到最新/ }).click()
    await expect(timeline.getByRole('button', { name: /回到最新/ })).toHaveCount(0)
    await expect(timeline.locator('.execution-timeline__card--text').last()).toContainText('正文第四段：任务完成。')
    await expect(timeline.locator('.execution-timeline__card--usage').first()).toBeVisible()
    await expect(timeline.locator('.execution-timeline__card--tool').filter({ hasText: '查看文档结构' })).toBeVisible()
    await timeline.getByRole('button', { name: /读取更早记录/ }).click()
    await expect(page.locator('[data-execution-item]')).toHaveCount(100)
    await timeline.getByRole('button', { name: /读取更后记录/ }).click()
    await expect(timeline.locator('.execution-timeline__card--run-end').last()).toBeVisible()
    expect((await page.evaluate(async id => window.desktopAPI!.execution!.timeline(id), conversationId)).cursor).toBeGreaterThan(count)
    expect(serverErrors).toEqual([]); expect(rendererErrors).toEqual([])
    evidence.dom = { seededCursor: count, visibleItemsBound: 100, outputReadCharacters: outputLength, stableLiveAttribute: stable.live,
      beforeScrollTop: before, duringScrollTop: during, focusRetained: true, expansionRetained: true,
      busyDuringInterleavedToolAndUsage: true, busyAfterRunEnd: false, interleaved, requests: requests.length }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await page.screenshot({ path: join(directory, 'completed.png'), fullPage: true })
    await info.attach('m09-long-output-dom', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    evidence.serverErrors = serverErrors; evidence.rendererErrors = rendererErrors; evidence.requests = requests.length
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    afterFirstText.release(); beforeLastText.release()
    if (app) await closeApp(app)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
