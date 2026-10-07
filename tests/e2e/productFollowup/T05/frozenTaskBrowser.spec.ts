import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')
test('T05 public Engine uses frozen Main task authorization and real Electron DOM facts without model snapshots or repeated approval', async () => {
  test.setTimeout(150_000)
  const base = join(root, 'output/productFollowup/T05'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'frozen-browser-'))
  const posted: string[] = []
  const html = '<!doctype html><title>Teacher form</title><form method="post" action="/submit"><label>Name <input name="name" aria-label="Name"></label><button type="submit">Submit</button></form><button type="button" onclick="document.getElementById(\'count\').textContent=\'Unknown clicks 1\'">Other effect</button><p id="count">Unknown clicks 0</p>'
  const server = createServer((request, response) => {
    let body = ''; request.on('data', chunk => { body += chunk })
    request.on('end', () => { if (request.method === 'POST') posted.push(body); response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture origin')
  const origin = `http://127.0.0.1:${address.port}`
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
    await app.firstWindow()
    const facts = await app.evaluate(async ({ BrowserWindow }, input) => {
      const path = await import('node:path'), { pathToFileURL } = await import('node:url')
      const load = (file: string) => import(pathToFileURL(path.join(input.root, 'dist-electron', file)).href)
      const [{ DocumentHostService }, { ManagedBrowserMcpService }, { BrowserActionApprovals }, { createElectronEmbeddedBrowserFactory },
        { browserTaskActionWithinGrant, managedBrowserGrantForRun }, { ExecutionEngine }, { ExecutionRunStore }, { ExecutionEventStore }] = await Promise.all([
        load('main/workbench/DocumentHostService.js'), load('main/workbench/externalTools/ManagedBrowserMcpService.js'),
        load('main/workbench/externalTools/BrowserActionApprovals.js'), load('main/workbench/browserEmbedded/ElectronEmbeddedBrowser.js'),
        load('main/workbench/workbenchToolServices.js'), load('main/workbench/execution/ExecutionEngine.js'),
        load('main/workbench/execution/ExecutionRunStore.js'), load('main/workbench/execution/ExecutionEventStore.js'),
      ])
      const host = new DocumentHostService(path.join(input.directory, 'documents')), approvals = new BrowserActionApprovals()
      const taskFacts: unknown[] = [], states: unknown[] = [], denied: unknown[] = []
      const service = new ManagedBrowserMcpService({ scratchRoot: path.join(input.directory, 'browser'), testLoopbackOrigin: input.origin,
        embeddedBackend: createElectronEmbeddedBrowserFactory(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('courseware-editor://')) ?? null),
        approveExternalAction: async (action: any) => approvals.consume(action), authorizeTaskAction: (action: any) => approvals.grantFromTask(action) })
      host.tools.configureHostServices({ mcp: service,
        beginRun: async (grant: any) => { await service.beginRun(grant.runId, managedBrowserGrantForRun(grant));
          approvals.beginRun(grant.runId, (action: any) => { taskFacts.push(action); return browserTaskActionWithinGrant(grant, action) }) },
        stopRun: async (id: string) => { approvals.revokeRun(id); await service.stopRun(id) },
      })
      const selection = { model: 'local-controlled-browser', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
        capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }
      let turn = 0, nameRef = '', submitRef = '', unknownRef = '', snapshotText = ''
      const complete = (request: any, name?: string, args?: unknown) => {
        const calls = name ? [{ id: `call-${turn}`, name, argumentsText: JSON.stringify(args) }] : []
        return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turn}`, actualModel: selection.model,
          nativeResponse: {}, finishReason: name ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content: name ? '' : '已提交一次',
            ...(name ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
      }
      const readSnapshot = (request: any) => {
        const tool = [...request.messages].reverse().find(message => message.role === 'tool')
        const text = typeof tool?.content === 'string' ? tool.content : JSON.stringify(tool?.content)
        const result = JSON.parse(text)
        snapshotText = result.data?.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n') ?? text
        const ref = (label: string) => new RegExp(`(?:textbox|button) "${label}" \\[ref=(e\\d+)\\]`).exec(snapshotText)?.[1]
        nameRef = ref('Name') ?? ''; submitRef = ref('Submit') ?? ''; unknownRef = ref('Other effect') ?? ''
      }
      const provider = { async *stream(request: any) {
        turn++
        if (!(request.tools ?? []).some((tool: any) => tool.name === 'mcp.invoke')) throw new Error('Default public browser capability was hidden')
        const invoke = (name: string, args: unknown) => complete(request, 'mcp.invoke', { name: `mcp.browser.${name}`, arguments: args })
        if (turn === 1) yield complete(request, 'mcp.discover', {})
        else if (turn === 2) yield invoke('browser_navigate', { url: input.origin })
        else if (turn === 3 || turn === 5 || turn === 7 || turn === 9) yield invoke('browser_snapshot', {})
        else if (turn === 4) { readSnapshot(request); if (!nameRef) throw new Error(`No actual Name ref: ${snapshotText}`); yield invoke('browser_type', { target: nameRef, text: 'Teacher answer' }) }
        else if (turn === 6) { readSnapshot(request); if (!submitRef) throw new Error(`No actual submit ref: ${snapshotText}`); yield invoke('browser_click', { target: submitRef }) }
        else if (turn === 8) { readSnapshot(request); if (!unknownRef) throw new Error(`No actual unknown ref: ${snapshotText}`); yield invoke('browser_click', { target: unknownRef }) }
        else {
          readSnapshot(request)
          const id = taskFacts.length ? (taskFacts[0] as any).runId : ''
          states.push(await service.control(id, 'takeover')); states.push(await service.control(id, 'resume'))
          yield complete(request)
        }
      } }
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
        runs: new ExecutionRunStore(path.join(input.directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(input.directory, 'events') }),
        authorizeBrowserActionFromTask: (action: any) => service.authorizeTaskAction(action),
      })
      engine.subscribe((event: any) => { if (event.type === 'tool' && event.data.status === 'approval') { denied.push(event.data); void engine.decide({ runId: event.runId, callId: event.itemId, decision: 'deny' }) } })
      const started = await engine.start({ conversationId: 'browser', taskId: 'authorized-form', instruction: '填入姓名并向此网站提交表单一次。', documents: [],
        selection, permission: 'workspace', workspaceRoot: input.directory, webAuthorization: { origins: [input.origin], actions: ['submit'] } })
      const finished = await engine.wait(started.runId)
      await service.endRun(started.runId)
      return { status: finished.status, failure: finished.failure, tools: finished.tools.map((tool: any) => ({ name: tool.call.name, input: tool.call.input, result: tool.result })),
        taskFacts, denied, states, snapshotText, turn }
    }, { root, directory, origin })
    expect(facts.status, JSON.stringify(facts)).toBe('completed')
    expect(posted).toEqual(['name=Teacher+answer'])
    expect(facts.taskFacts).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'prepare' }), expect.objectContaining({ action: 'submit', destinationUrl: `${origin}/submit` })]))
    expect(facts.denied).toHaveLength(1)
    expect(facts.snapshotText).toContain('Unknown clicks 0')
    expect(facts.states).toEqual([expect.objectContaining({ state: 'human' }), expect.objectContaining({ state: 'agent', snapshotId: expect.any(String) })])
    expect(facts.tools.every((tool: any) => !('snapshotId' in tool.input))).toBe(true)
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ ...facts, posted, paidCalls: 0 }, null, 2))
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app?.close().catch(() => undefined)
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
