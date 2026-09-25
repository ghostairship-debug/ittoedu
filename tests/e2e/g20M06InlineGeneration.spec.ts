import { expect, test, type Page } from '@playwright/test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, finishRound, heldRound, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument,
  selectionFixtures, selectionServer, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
const card = (page: Page) => page.getByLabel('当前编辑目标', { exact: true })
async function sendInline(page: Page, instruction: string) {
  await card(page).getByLabel('AI 指令', { exact: true }).fill(instruction)
  await card(page).getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}

test('M06-T03 stops a live inline body before completion and rejects its late tool tail', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    await region.getByRole('button', { name: '源文', exact: true }).click()
    const source = page.getByRole('textbox', { name: '正文源文编辑', exact: true })
    await source.click(); await source.press('Control+End'); await page.keyboard.type('人工先完成。')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: `${markdownSource}人工先完成。` })
    await region.getByRole('button', { name: '正文', exact: true }).click()
    const before = await readSelectionDocument(page, document.documentId)
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('m06-stop', 'markdown-range', '迟到的生成正文')
    await sendInline(page, '只改写选中正文，生成后等待我停止')
    await heldRound(round)
    const preview = body(page).locator('[data-edit-preview]')
    await expect(preview).toContainText('迟到的生成正文')
    expect((await readSelectionDocument(page, document.documentId)).model).toEqual(before.model)
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect(preview).toHaveCount(0)
    round.release() // The local HTTP server still emits its delayed complete tail.
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toEqual(before.model)
    const after = await readSelectionDocument(page, document.documentId)
    expect(after.undoDepth).toBe(before.undoDepth)
    expect(after.model).toMatchObject({ source: `${markdownSource}人工先完成。` })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm06-stop.json'), JSON.stringify({ before, after, round: { held: round.held, returned: round.returned, error: round.error }, errors }, null, 2))
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M06-T02 Flow body appears in its document before complete and commits without an external candidate', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const files = readdirSync(fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'flow.h5lesson')
    const before = await readSelectionDocument(page, document.documentId)
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('m06-flow', 'flow-range', '先讨论😀')
    await sendInline(page, '将选中的讲义正文改为先讨论')
    await heldRound(round)
    const preview = body(page).locator('[data-edit-preview]')
    await expect(preview).toContainText('先讨论😀')
    expect((await readSelectionDocument(page, document.documentId)).model).toEqual(before.model)
    expect(readdirSync(fixture.workspace)).toEqual(files)
    await finishRound(page, round)
    await expect(preview).toHaveCount(0)
    await expect(body(page)).toContainText('甲段：先讨论😀，再观察。')
    const after = await readSelectionDocument(page, document.documentId)
    expect(after.undoDepth).toBe(before.undoDepth + 1)
    if (after.model.kind !== 'course-v9') throw new Error('Flow course was not retained')
    const flow = after.model.project.surfaces.find(surface => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('Flow surface was not retained')
    expect(flow.blocks.find(block => block.id === 'flow-a')).toMatchObject({ type: 'paragraph', content: { inlines: [{ type: 'text', text: '甲段：先讨论😀，再观察。' }] } })
    expect(readdirSync(fixture.workspace)).toEqual(files)
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm06-flow.json'), JSON.stringify({ beforeRevision: before.revision, afterRevision: after.revision, files, round, errors }, null, 2))
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M06-T04 one completed body generation and later human edit undo separately, then save and reopen', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), server = await selectionServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const region = page.getByRole('region', { name: '教学文档 selection.md', exact: true })
    const before = await readSelectionDocument(page, document.documentId)
    await selectVisibleText(page, body(page), '先预测😀')
    const round = server.arm('m06-undo', 'markdown-range', '先讨论😀')
    await sendInline(page, '只将所选正文改为先讨论')
    await heldRound(round)
    await expect(body(page).locator('[data-edit-preview]')).toContainText('先讨论😀')
    expect((await readSelectionDocument(page, document.documentId)).model).toEqual(before.model)
    await finishRound(page, round)
    const generated = markdownSource.replace('先预测😀', '先讨论😀')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: generated })
    const committed = await readSelectionDocument(page, document.documentId)
    expect(committed.undoDepth).toBe(before.undoDepth + 1)
    await selectVisibleText(page, body(page), '保持原样')
    await page.keyboard.insertText('人工手改')
    const human = generated.replace('保持原样', '人工手改')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: human })
    const edited = await readSelectionDocument(page, document.documentId)
    expect(edited.undoDepth).toBe(committed.undoDepth + 1)
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: generated })
    await region.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: markdownSource })
    await region.getByRole('button', { name: '重做', exact: true }).click()
    await region.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: human })
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(fixture.workspace, 'selection.md'), 'utf8')).toBe(human)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 selection.md', exact: true }).click()
    const reopened = await openSelectionFile(page, fixture.workspace, 'selection.md')
    expect(reopened.model).toMatchObject({ source: human })
    expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm06-undo.json'), JSON.stringify({ before, committed, edited, reopened, round, errors }, null, 2))
  } finally { await closeSelectionApp(app); await server.close() }
})

test('M06-T05 final-only tool arguments are reported as operation-level updates, not proven body streaming', async () => {
  test.setTimeout(120_000)
  const fixture = selectionFixtures(), requests: any[] = [], serverErrors: string[] = []
  const sse = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'm06-final-only', model: 'fixture-selection',
    choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('Unexpected local fixture request')
    let body = ''; for await (const bytes of request) body += bytes.toString()
    const data = JSON.parse(body); requests.push(data)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const tool = (name: string, id: string, args: unknown) => {
      const wire = modelToolWireName(name)
      if (!data.tools.some((item: any) => item.function.name === wire)) throw new Error(`Missing ${name} tool`)
      response.write(sse({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: wire, arguments: JSON.stringify(args) } }] }, 'tool_calls'))
    }
    if (requests.length === 1) {
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const frozen = data.messages.find((item: any) => typeof item.content === 'string' && item.content.startsWith(prefix))
      if (!frozen) throw new Error('Missing frozen target')
      const target = JSON.parse(frozen.content.slice(prefix.length))[0]?.writable?.[0]?.target
      if (!target) throw new Error('Missing writable target')
      tool('read', 'm06-read', { target, limit: 100 })
    } else if (requests.length === 2) {
      const read = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'm06-read')
      if (!read || JSON.parse(read.content)?.kind !== 'read') throw new Error('Selected source was not read')
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const frozen = data.messages.find((item: any) => typeof item.content === 'string' && item.content.startsWith(prefix))
      const target = JSON.parse(frozen.content.slice(prefix.length))[0].writable[0].target
      // One complete arguments chunk: no partial decoded body reaches the host.
      tool('text.replace', 'm06-final-edit', { target, content: '操作级更新' })
    } else if (requests.length === 3) {
      const edit = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'm06-final-edit')
      if (JSON.parse(edit?.content ?? '{}')?.result?.status !== 'applied') throw new Error('Canonical edit did not commit')
      response.write(sse({ role: 'assistant', content: '操作已完成。' }, 'stop'))
    } else throw new Error('Unexpected additional model turn')
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    await setupSelectionUI(app, page, endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    await selectVisibleText(page, body(page), '先预测😀')
    await sendInline(page, '将选中内容改为操作级更新')
    const expected = markdownSource.replace('先预测😀', '操作级更新')
    await expect.poll(async () => (await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: expected })
    await expect(page.getByText('操作已完成。', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await expect(page.getByRole('group', { name: '对话模型选择' })).toContainText('最近一次正文修改仅完整操作更新')
    await expect(body(page).locator('[data-edit-preview]')).toHaveCount(0)
    expect(requests).toHaveLength(3); expect(serverErrors).toEqual([]); expect(errors).toEqual([])
    writeFileSync(join(fixture.directory, 'm06-final-only.json'), JSON.stringify({ requestCount: requests.length, source: expected, serverErrors, errors }, null, 2))
  } finally {
    await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
