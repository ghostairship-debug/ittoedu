import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')
test('T05 public Engine uses frozen Main task authorization and real Electron DOM facts without model snapshots or repeated approval', async () => {
  test.setTimeout(150_000)
  const base = join(root, 'output/productFollowup/T05'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'frozen-browser-'))
  const checkpoints = join(directory, 'checkpoint.jsonl')
  const checkpoint = (phase: string, facts: unknown = {}) => appendFileSync(checkpoints, JSON.stringify({ time: new Date().toISOString(), process: 'test', phase, facts }) + '\n')
  checkpoint('fixture.created', { directory })
  const posted: string[] = []
  const html = '<!doctype html><title>Teacher form</title><form method="post" action="/submit"><label>Name <input name="name" aria-label="Name"></label><button type="submit">Submit</button></form><button type="button" onclick="document.getElementById(\'count\').textContent=\'Unknown clicks 1\'">Other effect</button><p id="count">Unknown clicks 0</p>'
  const server = createServer((request, response) => {
    checkpoint('http.request', { method: request.method, url: request.url })
    let body = ''; request.on('data', chunk => { body += chunk })
    request.on('end', () => { checkpoint('http.request.end', { method: request.method, url: request.url, body }); if (request.method === 'POST') posted.push(body); response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html) })
    response.on('finish', () => checkpoint('http.response.finished', { status: response.statusCode }))
    request.on('error', error => checkpoint('http.request.error', { message: error.message }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture origin')
  const origin = `http://127.0.0.1:${address.port}`
  let app: ElectronApplication | undefined
  try {
    checkpoint('electron.launch.before')
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
    checkpoint('electron.launch.returned')
    const page = await app.firstWindow(); checkpoint('electron.firstWindow.returned', { url: page.url() })
    page.on('pageerror', error => checkpoint('renderer.error', { message: error.message }))
    checkpoint('main.evaluate.before')
    const facts = await app.evaluate(async ({ BrowserWindow, app }, input) => {
      const path = await import('node:path'), { pathToFileURL } = await import('node:url'), fs = await import('node:fs')
      const log = (phase: string, facts: unknown = {}) => fs.appendFileSync(input.checkpoints, JSON.stringify({ time: new Date().toISOString(), process: 'main', phase, facts }) + '\n')
      log('imports.before')
      const load = async (file: string) => {
        log('module.load.before', { file })
        try { const module = await import(pathToFileURL(path.join(input.root, 'dist-electron', file)).href); log('module.load.returned', { file }); return module }
        catch (error) { log('module.load.error', { file, error: String(error) }); throw error }
      }
      const [{ DocumentHostService }, { ManagedBrowserMcpService }, { BrowserActionApprovals }, { createElectronEmbeddedBrowserFactory },
        { browserTaskActionWithinGrant, managedBrowserGrantForRun }, { ExecutionEngine }, { ExecutionRunStore }, { ExecutionEventStore }] = await Promise.all([
        load('main/workbench/DocumentHostService.js'), load('main/workbench/externalTools/ManagedBrowserMcpService.js'),
        load('main/workbench/externalTools/BrowserActionApprovals.js'), load('main/workbench/browserEmbedded/ElectronEmbeddedBrowser.js'),
        load('main/workbench/workbenchToolServices.js'), load('main/workbench/execution/ExecutionEngine.js'),
        load('main/workbench/execution/ExecutionRunStore.js'), load('main/workbench/execution/ExecutionEventStore.js'),
      ])
      log('imports.returned')
      const host = new DocumentHostService(path.join(input.directory, 'documents')), approvals = new BrowserActionApprovals()
      const taskFacts: unknown[] = [], states: unknown[] = [], denied: unknown[] = []
      const actualFactory = createElectronEmbeddedBrowserFactory(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('courseware-editor://')) ?? null)
      let creatingBackend = false
      const watchCreated = (_event: unknown, contents: any) => {
        if (!creatingBackend) return
        log('backend.webContents.created', { id: contents.id })
        for (const name of ['did-start-loading', 'did-finish-load', 'did-fail-load', 'render-process-gone']) contents.on(name, (...args: unknown[]) => log(`backend.webContents.${name}`, { id: contents.id, url: contents.getURL(), details: args.slice(1) }))
        const send = contents.debugger.sendCommand.bind(contents.debugger)
        contents.debugger.sendCommand = async (...args: unknown[]) => {
          log('backend.cdp.before', { id: contents.id, method: args[0] })
          try { const value = await send(...args); log('backend.cdp.returned', { id: contents.id, method: args[0] }); return value }
          catch (error) { log('backend.cdp.error', { id: contents.id, method: args[0], error: String(error) }); throw error }
        }
      }
      app.on('web-contents-created', watchCreated)
      const service = new ManagedBrowserMcpService({ scratchRoot: path.join(input.directory, 'browser'), testLoopbackOrigin: input.origin,
        embeddedBackend: async (options: any) => {
          log('backend.factory.before', { runId: options.runId, proxyUrl: options.proxyUrl }); creatingBackend = true
          try {
            const backend = await actualFactory(options); log('backend.factory.returned', { runId: options.runId })
            return new Proxy(backend, { get(owner: any, key) {
              const value = Reflect.get(owner, key, owner)
              if (typeof value !== 'function') return value
              return (...args: any[]) => {
                log('backend.method.before', { method: String(key), operationId: args[0]?.operationId, name: args[0]?.name })
                try {
                  const result = value.apply(owner, args)
                  if (result && typeof result.then === 'function') return result.then((resolved: unknown) => { log('backend.method.returned', { method: String(key) }); return resolved }, (error: unknown) => { log('backend.method.error', { method: String(key), error: String(error) }); throw error })
                  log('backend.method.returned', { method: String(key) }); return result
                } catch (error) { log('backend.method.error', { method: String(key), error: String(error) }); throw error }
              }
            } })
          } catch (error) { log('backend.factory.error', { error: String(error) }); throw error }
          finally { creatingBackend = false }
        },
        approveExternalAction: async (action: any) => { const granted = approvals.consume(action); log('approval.consume', { action, granted }); return granted },
        authorizeTaskAction: async (action: any) => { log('task.authorize.before', action); const granted = await approvals.grantFromTask(action); log('task.authorize.returned', { granted }); return granted } })
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
        log('provider.snapshot.parsed', { turn, nameRef, submitRef, unknownRef, snapshotText })
      }
      const provider = { async *stream(request: any) {
        turn++
        log('provider.turn', { turn, requestId: request.requestId, lastTool: [...request.messages].reverse().find((message: any) => message.role === 'tool') })
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
          log('takeover.before', { runId: id }); states.push(await service.control(id, 'takeover')); log('takeover.returned', states.at(-1))
          log('resume.before', { runId: id }); states.push(await service.control(id, 'resume')); log('resume.returned', states.at(-1))
          yield complete(request)
        }
      } }
      const runs = new ExecutionRunStore(path.join(input.directory, 'runs'))
      const save = runs.save.bind(runs)
      runs.save = async (record: any) => { await save(record); log('run.checkpoint.durable', { runId: record.runId, status: record.status, failure: record.failure,
        requests: record.requests.map((request: any) => ({ requestId: request.requestId, state: request.state })),
        tools: record.tools.map((tool: any) => ({ callId: tool.callId, name: tool.call.name, state: tool.state, result: tool.result })) }) }
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
        runs, events: new ExecutionEventStore({ directory: path.join(input.directory, 'events') }),
        authorizeBrowserActionFromTask: (action: any) => service.authorizeTaskAction(action),
      })
      log('engine.constructed')
      engine.subscribe((event: any) => { log('engine.event', { type: event.type, runId: event.runId, itemId: event.itemId, data: event.data }); if (event.type === 'tool' && event.data.status === 'approval') { denied.push(event.data); void engine.decide({ runId: event.runId, callId: event.itemId, decision: 'deny' }).then(() => log('approval.deny.returned'), (error: unknown) => log('approval.deny.error', { error: String(error) })) } })
      log('engine.start.before')
      const started = await engine.start({ conversationId: 'browser', taskId: 'authorized-form', instruction: '填入姓名并向此网站提交表单一次。', documents: [],
        selection, permission: 'workspace', workspaceRoot: input.directory, webAuthorization: { origins: [input.origin], actions: ['submit'] } })
      log('engine.start.returned', { runId: started.runId })
      const finished = await engine.wait(started.runId); log('engine.wait.returned', { status: finished.status, failure: finished.failure })
      log('service.endRun.before'); await service.endRun(started.runId); log('service.endRun.returned')
      app.removeListener('web-contents-created', watchCreated)
      return { status: finished.status, failure: finished.failure, tools: finished.tools.map((tool: any) => ({ name: tool.call.name, input: tool.call.input, result: tool.result })),
        taskFacts, denied, states, snapshotText, turn }
    }, { root, directory, origin, checkpoints })
    checkpoint('main.evaluate.returned', { status: facts.status })
    expect(facts.status, JSON.stringify(facts)).toBe('completed')
    expect(posted).toEqual(['name=Teacher+answer'])
    expect(facts.taskFacts).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'prepare' }), expect.objectContaining({ action: 'submit', destinationUrl: `${origin}/submit` })]))
    expect(facts.denied).toHaveLength(1)
    expect(facts.snapshotText).toContain('Unknown clicks 0')
    expect(facts.states).toEqual([expect.objectContaining({ state: 'human' }), expect.objectContaining({ state: 'agent', snapshotId: expect.any(String) })])
    expect(facts.tools.every((tool: any) => !('snapshotId' in tool.input))).toBe(true)
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ ...facts, posted, paidCalls: 0 }, null, 2))
  } finally {
    checkpoint('cleanup.app.before')
    await app?.evaluate(({ app }) => app.exit(0)).catch(error => checkpoint('cleanup.exit.error', { error: String(error) })); await app?.close().catch(() => undefined)
    checkpoint('cleanup.app.returned')
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    checkpoint('cleanup.server.returned')
  }
})
