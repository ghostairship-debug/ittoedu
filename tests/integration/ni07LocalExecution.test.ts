// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const electronDirectory = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronDirectory.value, getAppPath: () => process.cwd(), getVersion: () => '0.0.1', whenReady: async () => undefined },
  shell: {}, dialog: {}, BrowserWindow: class {}, session: {}, WebContentsView: class {}, net: {}, protocol: {}, ipcMain: {},
  safeStorage: { isEncryptionAvailable: () => true, isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text: string) => { const { createCipheriv, randomBytes } = await import('node:crypto'); const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 47), iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]) },
    decryptStringAsync: async (bytes: Buffer) => { const { createDecipheriv } = await import('node:crypto'); const cipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 47), bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return { result: Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8') } },
  }, clipboard: {}, screen: {}, webContents: {} }))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }

it('executes exact approved commands in the real managed copy, freezes current source and parent route, and reads readonly work before finishing and delivering', async () => {
  const base = path.resolve('output/ni07-desktop-host'); await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'run-')); electronDirectory.value = root
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
  const source = path.join(workspace, 'numbers.txt'); await fs.writeFile(source, '[1]')
  const { documentHost } = await import('../../src/main/workbench/documentHost')
  const { installWorkbenchToolServices, disposeHeadlessWorkbenchWorkers } = await import('../../src/main/workbench/workbenchToolServices')
  const { executionSettingsStore } = await import('../../src/main/workbench/providers/executionSettingsService')
  const host = documentHost(), settings = await executionSettingsStore()
  const document = await host.internalAPI.open(source), session = host.registry.get(document.documentId)
  const human = async (text: string) => { const before = session.read(); await session.execute({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: text } } }) }
  await human('[10,20]')
  const frozenSource = session.read()
  const connection = await settings.saveConnection({ apiKey: 'offline-fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
    accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'supported' } } })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
  const parentPayloads: any[] = [], childPayloads: any[] = [], approvals: ExecutionEvent[] = [], firstApproval = deferred(), secondApproval = deferred(), stopApproval = deferred(), stopRequest = deferred(), stopRelease = deferred()
  let stopTurns = 0, stopJob = ''
  let emptyJob = '', outputJob = '', readonlyJob = '', localSource = '', readonlySource = '', localVersion = '', readonlyVersion = ''
  const response = (payload: any, turn: number, tools: { name: string; input: unknown }[], content = '继续原任务') => new Response('data: ' + JSON.stringify({ id: `response-${turn}`, model: payload.model,
    choices: [{ index: 0, delta: { role: 'assistant', content, ...(tools.length ? { tool_calls: tools.map((tool, index) => ({ index, id: `tool-${turn}-${index}`, type: 'function',
      function: { name: tool.name.replaceAll('.', '_'), arguments: JSON.stringify(tool.input) } })) } : {}) }, finish_reason: tools.length ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  const transport: typeof fetch = async (url, init) => {
    expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:1\/v1\//)
    const payload = JSON.parse(String(init?.body))
    if (payload.messages.some((message: { role: string; content?: unknown }) => message.role === 'user' && (typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(part => part.text ?? '').join('') : '') === '启动后停止')) {
      expect(payload.model).toBe('replacement-model')
      const turn = ++stopTurns
      if (turn === 1) return response(payload, 200 + turn, [{ name: 'tools.load', input: { families: ['jobs'] } }])
      if (turn === 2) return response(payload, 200 + turn, [{ name: 'local.run', input: { command: process.execPath, args: ['-e',
        'const fs=require("fs");fs.writeFileSync("started.txt","once",{flag:"wx"});setInterval(()=>fs.appendFileSync("ticks.txt","tick"),30);'] } }])
      stopJob = JSON.parse(payload.messages.findLast((message: { role: string }) => message.role === 'tool').content).data.job
      stopRequest.resolve(); await stopRelease.promise
      return response(payload, 200 + turn, [], '停止后的迟到回复')
    }
    expect(payload.model).toBe('fixture-model')
    if (String(payload.messages[0].content).startsWith('完成父任务指定的有限只读子任务')) {
      childPayloads.push(payload); expect(payload.tools ?? []).toEqual([]); expect(payload.max_tokens).toBe(128)
      const input = JSON.parse(payload.messages[1].content); expect(input.sources[0]).toMatchObject({ source: 'numbers.txt', text: '[99]' })
      return response(payload, 100, [], 'numbers.txt 显示当前数值为99；仅提供候选，不修改来源。')
    }
    const turn = parentPayloads.push(payload)
    const result = () => JSON.parse(payload.messages.findLast((value: { role: string }) => value.role === 'tool').content)
    let tools: { name: string; input: unknown }[]
    if (turn === 1) tools = [{ name: 'tools.load', input: { families: ['jobs'] } }]
    else if (turn === 2) tools = [{ name: 'local.run', input: { command: process.execPath, stdin: '原样输入 ping', args: ['-e', 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(s));'] } }]
    else if (turn === 3) { emptyJob = result().data.job; expect(emptyJob).toMatch(/^delegate-/); tools = [{ name: 'task.finish', input: {} }] }
    else if (turn === 4) { expect(result().code).toBe('task-unfinished'); tools = [{ name: 'job.wait', input: { job: emptyJob, milliseconds: 10000 } }] }
    else if (turn === 5) {
      expect(result().data).toMatchObject({ jobId: emptyJob, terminal: true, status: 'ready', snapshot: { exitCode: 0, artifacts: [] } })
      tools = [{ name: 'local.run', input: { command: process.execPath, sources: ['numbers.txt'], outputs: ['current.json'], stdin: '批准输入正文', args: ['-e',
        'const fs=require("fs");const a=JSON.parse(fs.readFileSync("numbers.txt","utf8"));fs.writeFileSync("current.json",JSON.stringify({total:a.reduce((x,y)=>x+y,0)}));'] } }]
    }
    else if (turn === 6) { outputJob = result().data.job; tools = [{ name: 'job.wait', input: { job: outputJob, milliseconds: 10000 } }] }
    else if (turn === 7) { const artifact = result().data.snapshot.artifacts[0]; localSource = artifact.source; localVersion = artifact.digest; tools = [{ name: 'delegate.read', input: { job: outputJob, name: artifact.name, version: localVersion } }] }
    else if (turn === 8) { expect(JSON.parse(result().data.text)).toEqual({ total: 30 }); tools = [{ name: 'artifact.save', input: { source: localSource, destination: 'local-result.json' } }] }
    else if (turn === 9) { expect(result().data).toMatchObject({ status: 'written', sourceKind: 'delegation' }); tools = [{ name: 'delegate.readonly', input: { goal: '根据当前numbers.txt给出引用来源的简短结论', sources: ['numbers.txt'], budget: { maxOutputTokens: 128, maxDurationMs: 10000 } } }] }
    else if (turn === 10) { readonlyJob = result().data.job; tools = [{ name: 'job.wait', input: { job: readonlyJob, milliseconds: 10000 } }] }
    else if (turn === 11) { const artifact = result().data.snapshot.artifacts[0]; readonlySource = artifact.source; readonlyVersion = artifact.digest; tools = [{ name: 'task.finish', input: {} }] }
    else if (turn === 12) { expect(result().code).toBe('task-unfinished'); tools = [{ name: 'delegate.read', input: { job: readonlyJob, name: 'report.md', version: readonlyVersion } }] }
    else if (turn === 13) { expect(result().data.text).toContain('来源快照'); expect(result().data.text).toContain('numbers.txt'); tools = [{ name: 'artifact.save', input: { source: readonlySource, destination: 'readonly-report.md' } }] }
    else if (turn === 14) tools = [{ name: 'task.finish', input: {} }]
    else throw new Error(`Unexpected parent turn ${turn}: ${JSON.stringify(result())}`)
    return response(payload, turn, tools)
  }
  vi.stubGlobal('fetch', transport)
  installWorkbenchToolServices({ getMainWindow: () => null, getRendererEntryUrl: () => null })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'workbench-v2'), documents: host, settings, fetch: transport,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }) })
  service.engine.subscribe(event => { if (event.type === 'tool' && event.data.status === 'approval') { approvals.push(event); if (approvals.length === 1) firstApproval.resolve(); if (approvals.length === 2) secondApproval.resolve(); if (approvals.length === 3) stopApproval.resolve() } })
  try {
    const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    const started = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, submissionId: randomUUID(),
      expectedRevision: conversation.revision, text: '调用原生工具，并用只读子任务给出当前文件结论；把两份成果保存到工作空间。', permission: 'full', documents: [{ documentId: document.documentId,
        epoch: frozenSource.epoch, revision: frozenSource.revision, writable: [] }] }) as ExecutionSendResult
    await firstApproval.promise
    expect(approvals[0]!.data.approval).toMatchObject({ kind: 'local-command', reason: 'ask' })
    expect(approvals[0]!.data.approval!.preview).toContain('原样输入 ping')
    expect((await service.engine.read(started.run!.runId))!.tools.find(tool => tool.call.name === 'local.run')).toMatchObject({ state: 'pending' })
    await settings.saveProfile({ expectedRevision: 1, roles: { conversation: { connectionId: connection.connection.id, model: 'replacement-model' }, vision: null, imageGenerate: null, imageEdit: null } })
    await service.engine.decide({ runId: started.run!.runId, callId: approvals[0]!.itemId, decision: 'allow-all' })
    await secondApproval.promise
    const preview = JSON.parse(approvals[1]!.data.approval!.preview!)
    expect(preview).toMatchObject({ executable: await fs.realpath(process.execPath), stdin: '批准输入正文', outputs: ['current.json'], sources: [{ source: 'numbers.txt', version: `document:${frozenSource.documentId}:${frozenSource.epoch}:${frozenSource.revision}` }] })
    // prepare freezes bytes in the owner; the managed directory is populated only after approval.
    await expect(fs.stat(path.join(preview.cwd, 'current.json'))).rejects.toThrow()
    await human('[99]')
    await service.engine.decide({ runId: started.run!.runId, callId: approvals[1]!.itemId, decision: 'allow' })
    const final = await service.engine.wait(started.run!.runId)
    expect(final.status, JSON.stringify(final.failure)).toBe('completed')
    expect(approvals).toHaveLength(2); expect(childPayloads).toHaveLength(1); expect(parentPayloads).toHaveLength(14)
    expect(final.input.selection.model).toBe('fixture-model')
    expect(final.tools.filter(tool => tool.call.name === 'local.run')).toHaveLength(2)
    expect(final.tools.filter(tool => tool.call.name === 'delegate.readonly')).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(path.join(workspace, 'local-result.json'), 'utf8'))).toEqual({ total: 30 })
    expect(await fs.readFile(path.join(workspace, 'readonly-report.md'), 'utf8')).toContain('当前数值为99')
    expect(await fs.readFile(source, 'utf8')).toBe('[1]'); expect(session.read()).toMatchObject({ dirty: true, undoDepth: 2, model: { source: '[99]' } })
    expect((await service.runs.read(final.runId))!.tools.filter(tool => tool.call.name === 'artifact.save').map(tool => tool.result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'read', data: expect.objectContaining({ status: 'written', sourceKind: 'delegation' }) })]))
    const stopConversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    const stopStarted = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: stopConversation.conversationId, submissionId: randomUUID(),
      expectedRevision: stopConversation.revision, text: '启动后停止', permission: 'full', documents: [] }) as ExecutionSendResult
    await stopApproval.promise
    const stopPreview = JSON.parse(approvals[2]!.data.approval!.preview!)
    await service.engine.decide({ runId: stopStarted.run!.runId, callId: approvals[2]!.itemId, decision: 'allow' })
    await stopRequest.promise
    await expect.poll(() => fs.readFile(path.join(stopPreview.cwd, 'started.txt'), 'utf8').catch(() => ''), { timeout: 10000 }).toBe('once')
    const stopping = service.engine.stop(stopStarted.run!.runId); stopRelease.resolve()
    const stopped = (await stopping)!
    expect(stopped.status).toBe('stopped'); expect(stopTurns).toBe(3)
    const originalCall = stopped.tools.find(tool => tool.call.name === 'local.run')!
    expect(await host.tools.lookup(stopped.runId, originalCall.callId, originalCall.call)).toMatchObject({ kind: 'read', data: { job: stopJob, status: 'cancelled', terminal: true, stopped: true, artifacts: [] } })
    expect(stopped.tools.some(tool => tool.call.name === 'artifact.save')).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(workspace, 'local-result.json'), 'utf8'))).toEqual({ total: 30 })
  } finally {
    await service.shutdown(); disposeHeadlessWorkbenchWorkers(); vi.unstubAllGlobals()
    if (path.dirname(path.resolve(root)) !== base || !path.basename(root).startsWith('run-')) throw new Error('Unsafe local fixture root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
}, 30000)
