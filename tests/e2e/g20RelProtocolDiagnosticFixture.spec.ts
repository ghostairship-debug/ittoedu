import { _electron as electron, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { relProtocolDiagnostics } from './helpers/g20RelProtocolDiagnostics'

const root = resolve(__dirname, '../..')
test.use({ trace: 'off' })

test('REL-T11 local unsupported tool type retains only allowlisted Main diagnostic before profile cleanup', async () => {
  test.setTimeout(90_000)
  const directory = mkdtempSync(join(root, 'output/g20/rel-t11/protocol-fixture-'))
  const profile = join(directory, 'profile'), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const marker = 'PRIVATE_FIXTURE_PROMPT_SENTINEL'
  let calls = 0
  const server = createServer((request, response) => { void (async () => {
    let body = ''; for await (const part of request) body += part.toString()
    const payload = JSON.parse(body)
    expect(request.url).toBe('/v1/chat/completions')
    expect(payload.model).toBe('fixture-text-model')
    expect(JSON.stringify(payload.messages)).toContain(marker)
    calls++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ id: 'rel-protocol-local', model: 'fixture-text-model', choices: [{ index: 0,
      delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'local-call', type: 'custom',
        function: { name: 'never_executed', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch(error => { response.writeHead(500); response.end(String(error)) }) })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await electron.launch({ cwd: root,
    args: [join(root, 'tests/e2e/helpers/g20ImageResultsBootstrap.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '',
      G20_IMAGE_HTTP_FIXTURE: endpoint, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    await app.evaluate(async () => { await (globalThis as any).__G20_IMAGE_RESULTS_FIXTURE__.ready })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const prepared = await page.evaluate(async selected => {
      const api = window.desktopAPI!.execution!, space = await api.workspace(selected)
      const conversation = space.conversations[0] ?? await api.createConversation(space.workspace.workspaceId)
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        revision: conversation.revision }
    }, workspace)
    const runId = await page.evaluate(async input => {
      const sent = await window.desktopAPI!.execution!.send({ workspaceId: input.prepared.workspaceId,
        conversationId: input.prepared.conversationId, expectedRevision: input.prepared.revision,
        submissionId: input.submissionId, text: input.marker, documents: [], attachments: [] })
      return sent.run?.runId ?? null
    }, { prepared, marker, submissionId: randomUUID() })
    expect(runId).toBeTruthy()
    await expect.poll(async () => (await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!))?.status,
      { timeout: 30_000 }).toMatch(/^(partial|failed)$/)
    const run = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!)
    expect(run?.failure?.code).toBe('unsupported-tool-type')
    expect(calls).toBe(1)
    const diagnosticFile = join(profile, 'diagnostics', 'editor-diagnostics.jsonl')
    await expect.poll(() => existsSync(diagnosticFile), { timeout: 10_000 }).toBe(true)
    const diagnostics = relProtocolDiagnostics(profile)
    expect(diagnostics).toEqual([{ code: 'unsupported-tool-type', type: 'custom', index: 0, hasFunction: true }])
    const rawLog = readFileSync(diagnosticFile, 'utf8')
    expect(rawLog).not.toContain(marker)
    expect(rawLog).not.toContain('fixture-text-only')
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ route: 'loopback', paidRequests: 0,
      runStatus: run?.status, failureCode: run?.failure?.code, calls, protocolDiagnostics: diagnostics,
      credentialPresentInLog: false, promptPresentInLog: false }, null, 2))
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0)
    }).catch(() => undefined)
    await app.close().catch(() => undefined)
    rmSync(profile, { recursive: true, force: true })
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
  expect(existsSync(profile)).toBe(false)
  expect(existsSync(join(directory, 'evidence.json'))).toBe(true)
})
