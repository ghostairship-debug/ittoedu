import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

test('default execution passes 24 requests and 120 tools in the Electron assistant', async ({}, info) => {
  test.setTimeout(180_000)
  const fixture = selectionFixtures()
  for (let index = 1; index <= 25; index++) mkdirSync(join(fixture.workspace, `folder-${index}`), { recursive: true })
  const requests: Array<{ tools: string[]; text: string }> = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('Unexpected fixture request')
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString()
    const payload = JSON.parse(text) as { tools?: Array<{ function: { name: string } }> }
    requests.push({ tools: payload.tools?.map(tool => tool.function.name) ?? [], text })
    const number = requests.length
    const list = modelToolWireName('file.list')
    if (number <= 24 && !requests[number - 1]!.tools.includes(list)) throw new Error('Local file.list tool missing')
    const delta = number <= 25
      ? { role: 'assistant', tool_calls: Array.from({ length: 5 }, (_, index) => ({ index, id: `list-${number}-${index}`, type: 'function',
        function: { name: list, arguments: JSON.stringify({ path: `folder-${number}` }) } })) }
      : { role: 'assistant', content: '长任务已完成' }
    const finish_reason = number <= 25 ? 'tool_calls' : 'stop'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: `budget-${number}`, model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => { if (!response.headersSent) response.writeHead(500); response.end(String(error)) }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await setupSelectionUI(app, page, endpoint, fixture.workspace)
    await openSelectionFile(page, fixture.workspace, 'selection.md')
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    const text = '请按步骤检查工作空间并给出结果'
    await assistant.getByRole('textbox', { name: '给创作助手发消息' }).fill(text)
    await expect(assistant.getByRole('textbox', { name: '给创作助手发消息' })).toHaveValue(text)
    await expect(assistant.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
    await expect(assistant.getByText('长任务已完成', { exact: true })).toBeVisible({ timeout: 120_000 })
    expect(requests).toHaveLength(26)
    const records = await page.evaluate(async root => {
      const opened = await window.desktopAPI.execution!.workspace(root)
      const conversation = (await window.desktopAPI.execution!.conversations(opened.workspace.workspaceId))[0]!
      const submissions = await window.desktopAPI.execution!.submissions({ workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId })
      const runs = await Promise.all(submissions.filter(item => item.runId).map(item => window.desktopAPI.execution!.run(item.runId!)))
      return { submissions, runs }
    }, fixture.workspace)
    const own = records.submissions.filter(item => item.text === text)
    expect(own).toHaveLength(1)
    expect(records.runs.map(run => run?.status)).toEqual(['completed'])
    expect(records.runs[0]?.requests).toHaveLength(26)
    expect(records.runs[0]?.tools).toHaveLength(125)
    expect(records.runs[0]?.budget).toMatchObject({ maxRequests: null, maxToolCalls: null })
    expect(errors).toEqual([])
    const evidence = join(fixture.directory, 'budget-continuation-ui-evidence.json')
    writeFileSync(evidence, JSON.stringify({ requests: requests.length, tools: records.runs[0]?.tools.length,
      statuses: records.runs.map(run => run?.status), runId: own[0]?.runId, errors }, null, 2))
    await info.attach('budget continuation UI evidence', { path: evidence, contentType: 'application/json' })
  } finally {
    await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
