import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const original = '前段。\n\n原段文字\n\n后段。\n'
const replacement = '先预测😀\n再观察，解释结论。'
const sse = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 's06-local-response', model: 'fixture-selection',
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
function gate() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

test('S06-T01 real Electron Markdown body shows Chinese, emoji and line break before complete, then commits once', async () => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/s06/real-text-streaming'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = join(workspace, '流式正文.md'); writeFileSync(filename, original)
  const gates = Array.from({ length: 5 }, gate), requests: any[] = [], serverErrors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected fixture route ${request.method} ${request.url}`)
    let raw = ''; for await (const bytes of request) raw += bytes.toString()
    const data = JSON.parse(raw); requests.push(data)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const frozen = data.messages.find((item: any) => typeof item.content === 'string' && item.content.startsWith(prefix))
      if (!frozen) throw new Error('Missing real frozen document reference')
      const refs = JSON.parse(frozen.content.slice(prefix.length))
      if (refs.length !== 1 || refs[0].writable.length !== 1 || refs[0].writable[0].kind !== 'markdown-range') throw new Error('UI selection did not freeze one writable Markdown range')
      const wire = modelToolWireName('read')
      if (!data.tools.some((tool: any) => tool.function.name === wire)) throw new Error('Missing canonical read tool')
      response.write(sse({ role: 'assistant', tool_calls: [{ index: 0, id: 'read-selection', type: 'function',
        function: { name: wire, arguments: JSON.stringify({ target: refs[0].writable[0].target, limit: 100 }) } }] }, 'tool_calls'))
    } else if (requests.length === 2) {
      const readMessage = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'read-selection')
      const result = readMessage ? JSON.parse(readMessage.content) : null
      if (result?.kind !== 'read' || result.data?.text !== '原段文字' || result.data?.truncated) throw new Error('The real selected source was not read before editing')
      const target = JSON.parse(data.messages.find((item: any) => typeof item.content === 'string' && item.content.startsWith('本次固定文档')).content.split('：')[1])[0].writable[0].target
      const wire = modelToolWireName('text.replace')
      if (!data.tools.some((tool: any) => tool.function.name === wire)) throw new Error('Missing canonical text.replace tool')
      const args = JSON.stringify({ target, content: replacement })
      const emoji = args.indexOf('😀'), newline = args.indexOf('\\n', emoji), explanation = args.indexOf('解释结论', newline)
      if (emoji < 0 || newline < 0 || explanation < 0) throw new Error('Fixture did not split the intended Unicode content')
      // The split inside the surrogate pair and immediately after the JSON escape
      // proves the editor uses decoded confirmed characters, not raw JSON chunks.
      const parts = [args.slice(0, emoji), args.slice(emoji, emoji + 1), args.slice(emoji + 1, newline + 1),
        args.slice(newline + 1, explanation), args.slice(explanation)]
      for (const [index, part] of parts.entries()) {
        response.write(sse({ ...(index === 0 ? { role: 'assistant' } : {}), tool_calls: [{ index: 0,
          ...(index === 0 ? { id: 'stream-edit', type: 'function' } : {}), function: { ...(index === 0 ? { name: wire } : {}), arguments: part } }] }, index === parts.length - 1 ? 'tool_calls' : null))
        await gates[index]!.wait
      }
      // A finish_reason chunk is insufficient: the provider withholds
      // response.completed until the actual SSE [DONE] arrives.
    } else if (requests.length === 3) {
      const result = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'stream-edit')
      const receipt = result ? JSON.parse(result.content) : null
      if (receipt?.kind !== 'document-operation' || receipt.result?.status !== 'applied') throw new Error('No formal applied receipt from the real Gateway')
      response.write(sse({ role: 'assistant', content: '流式正文已应用。' }, 'stop'))
    } else throw new Error('Unexpected additional model turn')
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let app: Awaited<ReturnType<typeof launchSelectionApp>> | undefined
  try {
    app = await launchSelectionApp(directory)
    const mainErrors: string[] = []
    app.process().stderr?.on('data', bytes => mainErrors.push(String(bytes)))
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    await setupSelectionUI(app, page, endpoint, workspace)
    const document = await openSelectionFile(page, workspace, '流式正文.md')
    const before = await readSelectionDocument(page, document.documentId)
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await expect(editor).toBeVisible()
    await selectVisibleText(page, editor, '原段文字')
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await expect(card).toBeVisible()
    await card.getByLabel('AI 指令', { exact: true }).fill('把选中文字改为先预测，再观察并解释结论')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(2).catch(async error => {
      const diagnostic = { requests: requests.length, serverErrors, mainErrors, alerts: await page.getByRole('alert').allTextContents(),
        statuses: await page.getByRole('status').allTextContents(), body: (await page.locator('body').innerText()).slice(-3000) }
      writeFileSync(join(directory, 'send-diagnostic.json'), JSON.stringify(diagnostic, null, 2))
      throw new Error(`Model request did not reach local SSE fixture: ${JSON.stringify(diagnostic)}`, { cause: error })
    })
    const preview = page.locator('[data-edit-preview]')
    const previewValue = () => page.evaluate(async id => (await window.desktopAPI.execution!.edits(id))[0]?.value ?? null, document.documentId)
    const previewSequence = () => page.evaluate(async id => (await window.desktopAPI.execution!.edits(id))[0]?.sequence ?? -1, document.documentId)
    await expect.poll(() => preview.innerText()).toBe('先预测')
    const firstSequence = await previewSequence()
    expect((await readSelectionDocument(page, document.documentId)).model).toMatchObject({ source: original })
    gates[0]!.release()
    await expect.poll(previewSequence).toBeGreaterThan(firstSequence)
    const secondSequence = await previewSequence()
    await expect.poll(() => preview.innerText()).toBe('先预测')
    expect(await preview.innerText()).not.toContain('�')
    gates[1]!.release()
    await expect.poll(previewSequence).toBeGreaterThan(secondSequence)
    const thirdSequence = await previewSequence()
    await expect.poll(() => preview.innerText()).toBe('先预测😀')
    gates[2]!.release()
    await expect.poll(previewSequence).toBeGreaterThan(thirdSequence)
    const fourthSequence = await previewSequence()
    await expect.poll(previewValue).toBe('先预测😀\n再观察，')
    await expect(preview).toContainText('再观察，')
    gates[3]!.release()
    await expect.poll(previewSequence).toBeGreaterThan(fourthSequence)
    await expect.poll(previewValue).toBe(replacement)
    const region = page.getByRole('region', { name: '教学文档 流式正文.md', exact: true })
    await region.getByRole('button', { name: '源文', exact: true }).click()
    await expect.poll(() => preview.textContent()).toBe(replacement)
    await region.getByRole('button', { name: '正文', exact: true }).click()
    await expect(preview).toContainText('解释结论。')
    await expect(page.getByRole('status').filter({ hasText: '正文正在生成，生成部分尚未保存' })).toBeVisible()
    const held = await readSelectionDocument(page, document.documentId)
    expect(held).toMatchObject({ revision: before.revision, undoDepth: before.undoDepth, model: { source: original } })
    expect(readdirSync(workspace)).toEqual(['流式正文.md'])
    expect(readFileSync(filename, 'utf8')).toBe(original)
    await page.screenshot({ path: join(directory, 'before-complete.png') })
    gates[4]!.release()
    await expect(page.getByText('流式正文已应用。', { exact: true })).toBeVisible()
    await expect(preview).toHaveCount(0)
    const after = await readSelectionDocument(page, document.documentId)
    expect(after).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1, model: { source: original.replace('原段文字', replacement) } })
    expect((await editor.innerText()).split('先预测😀').length - 1).toBe(1)
    expect(requests).toHaveLength(3)
    expect(serverErrors).toEqual([])
    expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'after-complete.png') })
  } finally {
    for (const pending of gates) pending.release()
    if (app) await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
