import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { configureG20M24Roles, createG20M24Connection } from './helpers/g20M24Harness'
import { chooseM23Workspace, closeM23, launchM23, m23Preview, m23Shot, m23Snapshot, openM23Html, writeM23Evidence } from './helpers/g20M23Harness'

const frozenPrefix = '本次固定文档与权限（切换界面不改变它们）：'
const frame = (delta: unknown, finish: string) => `data: ${JSON.stringify({ id: 'm23-html-ai-card', model: 'fixture-m23-html', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

async function startModel() {
  const requests: Array<{ toolNames: string[]; frozen: Array<{ writable?: Array<{ target: string }> }> }> = []
  const calls: Array<{ name: string; args: unknown }> = []
  const errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'fixture-m23-html' }] }))
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local model route ${request.method} ${request.url}`)
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>
      tools?: Array<{ function: { name: string } }>
    }
    const context = [...body.messages].reverse().find(message => typeof message.content === 'string' && message.content.startsWith(frozenPrefix))?.content as string | undefined
    const frozen = context ? JSON.parse(context.slice(frozenPrefix.length)) as Array<{ writable?: Array<{ target: string }> }> : []
    const names = body.tools?.map(tool => tool.function.name) ?? []
    requests.push({ toolNames: names, frozen })
    const lastUser = body.messages.map(message => message.role).lastIndexOf('user')
    const results = new Set(body.messages.slice(lastUser + 1).filter(message => message.role === 'tool').map(message => message.tool_call_id?.split(':').at(-1)))
    const send = (name: string, args: unknown, id: string) => {
      calls.push({ name, args })
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.end(frame({ role: 'assistant', tool_calls: [{ index: 0, id: `m23:${id}`, type: 'function', function: {
        name: modelToolWireName(name), arguments: JSON.stringify(args),
      } }] }, 'tool_calls') + 'data: [DONE]\n\n')
    }
    const say = (content: string) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.end(frame({ role: 'assistant', content }, 'stop') + 'data: [DONE]\n\n')
    }
    const target = frozen[0]?.writable?.[0]?.target
    if (!target) { say('未找到固定的 HTML 文字目标。'); return }
    if (!names.includes(modelToolWireName('text.replace')) && !results.has('load')) {
      send('tools.load', { families: ['content'] }, 'load')
    } else if (!results.has('read')) {
      send('read', { target, limit: 100 }, 'read')
    } else if (!results.has('replace')) {
      send('text.replace', { target, content: 'AI 卡热更新标题' }, 'replace')
    } else say('标题已修改。')
  })().catch(error => {
    errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
    if (!response.headersSent) response.writeHead(500)
    response.end()
  }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local M23 model server did not bind')
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`, requests, calls, errors,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

test('M23-T03 HTML element AI card calls text.replace and hot-updates the active preview', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M23 HTML AI-card acceptance requires the Windows Electron host.')
  test.setTimeout(240_000)
  const fixture = m23Fixture('light-edit')
  const facts: Record<string, unknown> = { case: 'M23-T03-AI-card', status: 'running' }
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let model: Awaited<ReturnType<typeof startModel>> | undefined
  let failure: unknown
  try {
    model = await startModel()
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    const connectionId = await createG20M24Connection(page, model.endpoint)
    await configureG20M24Roles(page, connectionId, 'fixture-m23-html', null, false)
    await chooseM23Workspace(app, page, fixture.workspace)
    const region = await openM23Html(page, 'light-edit.html')
    const preview = m23Preview(page)
    const pagination = region.getByRole('toolbar', { name: 'HTML 分页', exact: true })
    await pagination.getByRole('button', { name: '编辑预览', exact: true }).click()
    await expect(pagination).toContainText('连续页面')
    await preview.locator('#count-up').click()
    await preview.locator('#count-up').click()
    await expect(preview.locator('#count-value')).toHaveText('计数：2')

    await preview.locator('#lesson-title').dblclick()
    const lightEdit = page.getByRole('dialog', { name: '编辑 HTML 文字', exact: true })
    await expect(lightEdit).toBeVisible()
    await lightEdit.getByRole('button', { name: 'AI 修改', exact: true }).press('Enter')
    const card = page.getByRole('dialog', { name: /^AI 修改：/ }).last()
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('把标题改成 AI 卡热更新标题。')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(card.locator('.element-ai-card__state')).toHaveText('已完成', { timeout: 60_000 })
    facts.model = { endpoint: model.endpoint, requestCount: model.requests.length, requests: model.requests, calls: model.calls, errors: model.errors }
    expect(model.calls.some(call => call.name === 'text.replace')).toBe(true)

    const snapshot = await m23Snapshot(page, fixture.files.lightEdit)
    expect(snapshot?.model.kind).toBe('text')
    const documentId = snapshot!.documentId
    const expected = fixture.sources.lightEdit.replace('<h1 id="lesson-title">可编辑 HTML 课例</h1>', '<h1 id="lesson-title">AI 卡热更新标题</h1>')
    await expect.poll(async () => {
      const current = await page!.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
      return current.model.kind === 'text' ? current.model.source : ''
    }).toBe(expected)
    const refreshedTitle = await preview.locator('#lesson-title').textContent()
    const refreshedCounter = await preview.locator('#count-value').textContent()
    const refreshedPage = (await pagination.innerText()).match(/连续页面|\d+\s*\/\s*\d+/)?.[0] ?? null
    facts.edit = { tool: 'text.replace', expectedSource: expected, documentRevision: snapshot!.revision, sourceExact: true }
    facts.previewAfterAi = { title: refreshedTitle, counter: refreshedCounter, currentPage: refreshedPage }
    expect(refreshedTitle).toBe('AI 卡热更新标题')
    expect(refreshedCounter).toBe('计数：2')
    expect(refreshedPage).toBe('连续页面')
    expect(readFileSync(fixture.files.lightEdit, 'utf8')).toBe(fixture.sources.lightEdit)
    expect(model.errors).toEqual([])
    expect(model.requests.some(request => request.frozen[0]?.writable?.[0]?.target)).toBe(true)
    facts.status = 'passed'
    await m23Shot(fixture, page, info, 'html-ai-card-hot-update')
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (app && page && capture) {
      await m23Shot(fixture, page, info, failure ? 'failure' : 'html-ai-card-result')
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('M23-T03 AI card evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
    await model?.close()
  }
})
