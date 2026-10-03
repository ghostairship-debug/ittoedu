// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { modelToolWireName, OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('M20-T02 local HTTP/SSE agent opens, reads, edits and creates formal text documents', async () => {
  const { directory, host } = await setup()
  const workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const original = path.join(workspace, 'existing.txt'), created = path.join(workspace, 'created.txt')
  const originalSource = '\ufeff# 标题\r\n- 列表 `code` 😀\r\n'
  await fs.writeFile(original, originalSource)
  const requests: Array<{ action: string; turn: number; tools: string[] }> = []
  const receipts: Array<{ action: string; name: string; result: unknown }> = []
  let action: 'open' | 'create' = 'open', turn = 0, documentTarget = '', rangeTarget = ''
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages: Array<{ role: string; content?: string }>; tools: Array<{ function: { name: string } }> }
    turn++
    requests.push({ action, turn, tools: payload.tools.map(tool => tool.function.name) })
    const prior = [...payload.messages].reverse().find(message => message.role === 'tool')
    if (prior?.content) {
      const parsed = JSON.parse(prior.content) as { data?: unknown; result?: unknown }
      const name = ['file.open', 'read', 'listChildren', 'read', 'text.replace'][turn - 2]
      receipts.push({ action, name: name ?? 'unknown', result: parsed })
      if (turn === 2) documentTarget = (parsed.data as { target: string }).target
      if (turn === 4) rangeTarget = (parsed.data as Array<{ target: string }>)[0]!.target
      if (turn === 5) expect((parsed.data as { text: string }).text).toBe(action === 'open' ? originalSource : '')
    }
    const calls: Record<number, { name: string; input: object }> = {
      1: { name: action === 'open' ? 'file.open' : 'file.create', input: action === 'open' ? { path: 'existing.txt' } : { name: 'created.txt', kind: 'text' } },
      2: { name: 'read', input: { target: documentTarget } },
      3: { name: 'listChildren', input: { target: documentTarget } },
      4: { name: 'read', input: { target: rangeTarget } },
      5: { name: 'text.replace', input: { target: rangeTarget, content: action === 'open' ? '\ufeff# 改题\r\n- 列表 `code` 😀\r\n' : '新建纯文本\n' } },
    }
    const call = calls[turn]
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (chunk: object) => response.write(`data: ${JSON.stringify(chunk)}\n\n`)
    const id = `${action}-${turn}`
    send({ id, object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: call
      ? { role: 'assistant', tool_calls: [{ index: 0, id: `${action}-call-${turn}`, type: 'function', function: { name: modelToolWireName(call.name), arguments: JSON.stringify(call.input) } }] }
      : { role: 'assistant', content: '完成' }, finish_reason: null }] })
    send({ id, object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] })
    response.end('data: [DONE]\n\n')
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server address unavailable')
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture-secret', fetch })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: new AgentFileService(host),
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  for (const intent of ['open', 'create'] as const) {
    action = intent; turn = 0; documentTarget = ''; rangeTarget = ''
    const started = await engine.start({ conversationId: `conversation-${intent}`, taskId: `task-${intent}`, instruction: intent === 'open' ? '打开、读取并修改纯文本' : '新建、读取并修改纯文本',
      documents: [], workspaceRoot: workspace, permission: 'workspace',
      selection: { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture',
        auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const result = await engine.wait(started.runId)
    // R3 之后 file.create 建立的新文件若 run 内未显式 file.save 落盘，run 状态为 partial（unconfirmedSave 门），
    // 已 applied 的修改保留在宿主文档 session 中，由 host.saveToPath 显式持久化（见下方行）。
    expect(result.status, JSON.stringify(result.tools.map(tool => tool.result))).toBe(intent === 'create' ? 'partial' : 'completed')
    expect(result.tools.map(tool => tool.result?.kind)).toEqual(['read', 'read', 'read', 'read', 'document-operation'])
    expect(turn).toBe(6)
  }
  expect(new Uint8Array(await fs.readFile(original))).toEqual(new TextEncoder().encode(originalSource))
  const opened = await host.open(original)
  expect(opened.model).toMatchObject({ kind: 'text', source: '\ufeff# 改题\r\n- 列表 `code` 😀\r\n' })
  const newDoc = await host.open(created)
  expect(newDoc.model).toMatchObject({ kind: 'text', source: '新建纯文本\n' })
  await host.saveToPath(opened.documentId)
  await host.saveToPath(newDoc.documentId)
  expect(await fs.readFile(original, 'utf8')).toBe('\ufeff# 改题\r\n- 列表 `code` 😀\r\n')
  expect(await fs.readFile(created, 'utf8')).toBe('新建纯文本\n')
  expect(requests).toHaveLength(12)
  expect(receipts.filter(receipt => receipt.name === 'text.replace').length).toBe(2)
})

it('gives direct source write targets when opening .txt and creating .html', async () => {
  const { directory, host } = await setup()
  const workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace)
  const original = path.join(workspace, 'existing.txt'), created = path.join(workspace, 'created.html')
  await fs.writeFile(original, '原稿')
  const complete = (request: ModelRequest, turn: number, call?: { name: string; input: object }): Extract<ModelEvent, { type: 'response.completed' }> => {
    const toolCalls = call ? [{ id: `call-${turn}`, name: call.name, argumentsText: JSON.stringify(call.input) }] : []
    return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turn}`,
      actualModel: 'fixture-model', nativeResponse: {}, finishReason: call ? 'tool_calls' : 'stop', toolCalls,
      assistant: { role: 'assistant', content: '', ...(call ? { tool_calls: [{ id: `call-${turn}`, type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.input) } }] } : {}) } }
  }
  for (const [index, intent] of (['open', 'create'] as const).entries()) {
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      turn++
      if (turn === 1) {
        yield complete(request, turn, intent === 'open'
          ? { name: 'file.open', input: { path: 'existing.txt' } }
          : { name: 'file.create', input: { name: 'created.html', kind: 'html' } })
        return
      }
      if (turn === 2) {
        const prior = [...request.messages].reverse().find(message => message.role === 'tool')
        const result = JSON.parse(String(prior?.content)) as { data: { markdown?: unknown; text?: {
          content: string; truncated: boolean; writableTarget?: string } } }
        expect(result.data.markdown).toBeUndefined()
        expect(result.data.text).toMatchObject({ content: intent === 'open' ? '原稿' : '', truncated: false })
        expect(result.data.text?.writableTarget).toEqual(expect.any(String))
        yield complete(request, turn, { name: 'text.replace', input: { target: result.data.text!.writableTarget!,
          content: intent === 'open' ? '已改稿' : '<h1>新页</h1>' } })
        return
      }
      yield complete(request, turn)
    } }
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: new AgentFileService(host),
      runs: new ExecutionRunStore(path.join(directory, `direct-runs-${index}`)),
      events: new ExecutionEventStore({ directory: path.join(directory, `direct-events-${index}`) }) })
    const started = await engine.start({ conversationId: `direct-${intent}`, taskId: `direct-${intent}`,
      instruction: '打开或新建文件并写入正文', documents: [], workspaceRoot: workspace, permission: 'workspace',
      selection: { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
        billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
    const run = await engine.wait(started.runId)
    // R3 之后 file.create 建立的 .html 新文件若 run 内未显式 file.save，run 状态为 partial（unconfirmedSave 门）；
    // 修改仍 applied 到宿主文档 session，由后续 host 端显式持久化（见下方 readFile 断言验证磁盘原文未变）。
    expect(run.status, JSON.stringify(run.tools.map(tool => tool.result))).toBe(intent === 'create' ? 'partial' : 'completed')
    expect(run.tools[1]?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const documentId = (run.tools[0]!.result as { data: { documentId: string } }).data.documentId
    expect((await host.internalAPI.read(documentId)).model).toMatchObject({ kind: 'text',
      source: intent === 'open' ? '已改稿' : '<h1>新页</h1>' })
    expect(turn).toBe(3)
  }
  expect(await fs.readFile(original, 'utf8')).toBe('原稿')
  expect(await fs.readFile(created, 'utf8')).toBe('')
})
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m20-text-'))
  directories.push(directory)
  return { directory, recovery: path.join(directory, 'recovery'), host: new DocumentHostService(path.join(directory, 'recovery')) }
}
async function change(host: DocumentHostService, snapshot: DocumentSnapshot, operationId: string, source: string) {
  return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
}
async function history(host: DocumentHostService, snapshot: DocumentSnapshot, operationId: string, type: 'undo' | 'redo') {
  return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId, actor: 'human', mutation: { type } })
}

it('M20-T02 saves and reopens exact source bytes, Save As rebinds, and history round trips', async () => {
  const { directory, host } = await setup()
  const original = path.join(directory, 'original.txt'), copy = path.join(directory, 'copy.txt')
  const source = '\ufeff# 标题\r\n- 列表 `code` 😀\r\n'
  const edited = '\ufeff# 改题\r\n- 列表 `code` 😀\r\n'
  await fs.writeFile(original, new TextEncoder().encode(source))
  const opened = await host.open(original)
  expect(opened.model).toMatchObject({ kind: 'text', source })
  expect(await change(host, opened, 'edit', edited)).toMatchObject({ status: 'applied' })
  let current = await host.internalAPI.read(opened.documentId)
  expect(await history(host, current, 'undo', 'undo')).toMatchObject({ status: 'applied' })
  current = await host.internalAPI.read(opened.documentId)
  expect(current.model).toMatchObject({ source })
  expect(await history(host, current, 'redo', 'redo')).toMatchObject({ status: 'applied' })
  const saved = await host.saveToPath(opened.documentId, copy)
  expect(saved).toMatchObject({ dirty: false, binding: { kind: 'file', path: copy }, model: { source: edited } })
  expect(new Uint8Array(await fs.readFile(copy))).toEqual(new TextEncoder().encode(edited))
  expect(new Uint8Array(await fs.readFile(original))).toEqual(new TextEncoder().encode(source))
  await host.operate({ type: 'close', documentId: opened.documentId })
  expect((await host.open(copy)).model).toMatchObject({ kind: 'text', source: edited })
})

it('M20-T02 recovers committed mixed-line draft and rejects an old epoch', async () => {
  const { directory, recovery, host } = await setup()
  const filename = path.join(directory, 'mixed.txt'), source = 'one\r\ntwo\nthree\rfour'
  await fs.writeFile(filename, source)
  const opened = await host.open(filename)
  const edited = 'ONE\r\ntwo\nthree\rfour'
  const receipt = await change(host, opened, 'edit-mixed', edited)
  expect(receipt).toMatchObject({ status: 'applied' })
  const restarted = new DocumentHostService(recovery)
  expect(await restarted.internalAPI.recoverable()).toMatchObject([{ documentId: opened.documentId, dirty: true, model: { kind: 'text', source: edited } }])
  const restored = await restarted.internalAPI.restore(opened.documentId)
  expect(restored).toMatchObject({ undoDepth: 1, model: { kind: 'text', source: edited } })
  expect(restored.epoch).not.toBe(opened.epoch)
  expect(await restarted.internalAPI.lookup(opened.documentId, 'edit-mixed')).toEqual(receipt)
  expect(await change(restarted, opened, 'stale', 'wrong')).toMatchObject({ status: 'conflict', code: 'stale-epoch' })
  expect((await restarted.saveToPath(opened.documentId)).model).toMatchObject({ source: edited })
  expect(new Uint8Array(await fs.readFile(filename))).toEqual(new TextEncoder().encode(edited))
})

it('M20-T02 refuses external overwrite and GBK bytes without modifying either disk file', async () => {
  const { directory, host } = await setup()
  const filename = path.join(directory, 'conflict.txt')
  await fs.writeFile(filename, 'base\r\n')
  const opened = await host.open(filename)
  await change(host, opened, 'local', 'local\r\n')
  await fs.writeFile(filename, 'external\r\n')
  await expect(host.saveToPath(opened.documentId)).rejects.toThrow('已改变')
  expect(await fs.readFile(filename, 'utf8')).toBe('external\r\n')
  expect((await host.internalAPI.read(opened.documentId)).model).toMatchObject({ source: 'local\r\n' })
  const observation = await host.observeFile(opened.documentId)
  const current = await host.internalAPI.read(opened.documentId)
  const reconciled = await host.reconcileFile({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })
  expect(reconciled.model).toMatchObject({ source: 'external\r\n' })
  const gbk = path.join(directory, 'gbk.txt'), bytes = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  await fs.writeFile(gbk, bytes)
  await expect(host.open(gbk)).rejects.toMatchObject({ code: 'TEXT_ENCODING_UNSUPPORTED' })
  expect(await fs.readFile(gbk)).toEqual(bytes)
})
