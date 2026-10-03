// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
}, 30_000)

function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), data])
    },
    decryptString(value) {
      const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
}

function sse(response: import('node:http').ServerResponse, id: string, delta: Record<string, unknown>, finish: 'tool_calls' | 'stop') {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-model',
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-model',
    choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function settled(service: ExecutionDesktopService, runId: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const run = await service.operate({ type: 'run', runId }) as ExecutionRunRecord | null
    if (run && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('No terminal run')
}

it('M30 T1 fixture: a no-document product run reads data, delivers four real files, patches and reopens HTML', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m30-t1-')); roots.push(root)
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  await fs.writeFile(path.join(workspace, 'sales.csv'), 'month,amount\nJan,20\nFeb,22\n')
  const source = 'from pathlib import Path\nimport csv, json\nrows = list(csv.DictReader(Path("sales.csv").open()))\nprint(json.dumps({"total": sum(int(row["amount"]) for row in rows)}))\n'
  const originalHtml = '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body><h1>销售报告</h1><p>总额：42</p></body></html>\n'
  let requestCount = 0
  const serviceReceipts: Array<Array<{ tool_call_id: string; content: string }>> = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>
      tools: Array<{ function: { name: string; description: string } }>
    }
    requestCount++
    const receipts = payload.messages.filter(message => message.role === 'tool' && message.tool_call_id && message.content)
      .map(message => ({ tool_call_id: message.tool_call_id!, content: message.content! }))
    serviceReceipts.push(receipts)
    const wire = (...prefixes: string[]) => {
      const match = payload.tools.find(tool => prefixes.some(prefix => tool.function.description.startsWith(prefix)))
      if (!match) throw new Error(`Model did not receive any of: ${prefixes.join(' | ')}`)
      return match.function.name
    }
    const call = (index: number, id: string, name: string, input: unknown) => ({ index, id, type: 'function',
      function: { name, arguments: JSON.stringify(input) } })
    if (requestCount === 1) {
      expect(payload.messages.some(message => message.role === 'system' && message.content?.includes('本次固定文档与权限'))).toBe(true)
      sse(response, 't1-read-input', { tool_calls: [call(0, 't1-read-input', wire('读取普通 UTF-8 文件'), { path: 'sales.csv' })] }, 'tool_calls')
    } else if (requestCount === 2) {
      expect(JSON.parse(receipts.find(item => item.tool_call_id === 't1-read-input')!.content))
        .toMatchObject({ kind: 'read', data: { text: 'month,amount\nJan,20\nFeb,22\n', truncated: false } })
      const write = wire('直接写入完整普通 UTF-8 内容', '新建或完整替换普通 UTF-8 文件')
      sse(response, 't1-write-files', { tool_calls: [
        call(0, 't1-write-python', write, { mode: 'create', path: 'chart.py', content: source }),
        call(1, 't1-write-json', write, { mode: 'create', path: 'summary.json', content: '{"total":42,"count":2}\n' }),
        call(2, 't1-write-html', write, { mode: 'create', path: 'report.html', content: originalHtml }),
        call(3, 't1-write-css', write, { mode: 'create', path: 'report.css', content: 'body { font: 16px sans-serif; }\n' }),
      ] }, 'tool_calls')
    } else if (requestCount === 3) {
      expect(receipts.filter(item => item.tool_call_id.startsWith('t1-write-'))).toHaveLength(4)
      for (const receipt of receipts.filter(item => item.tool_call_id.startsWith('t1-write-')))
        expect(JSON.parse(receipt.content)).toMatchObject({ kind: 'read', data: { saved: true } })
      sse(response, 't1-read-html', { tool_calls: [call(0, 't1-read-html', wire('读取普通 UTF-8 文件'), { path: 'report.html' })] }, 'tool_calls')
    } else if (requestCount === 4) {
      const htmlRead = JSON.parse(receipts.find(item => item.tool_call_id === 't1-read-html')!.content) as {
        kind: string; data: { text: string; version: string }
      }
      expect(htmlRead).toMatchObject({ kind: 'read', data: { text: originalHtml } })
      sse(response, 't1-patch-html', { tool_calls: [call(0, 't1-patch-html', wire('按唯一 oldText'), {
        path: 'report.html', expectedVersion: htmlRead.data.version,
        oldText: '<h1>销售报告</h1>', newText: '<h1>两个月销售报告</h1>',
      })] }, 'tool_calls')
    } else {
      expect(requestCount).toBe(5)
      expect(JSON.parse(receipts.find(item => item.tool_call_id === 't1-patch-html')!.content))
        .toMatchObject({ kind: 'read', data: { status: 'written', saved: true } })
      sse(response, 't1-final', { content: '已生成四个文件并更新报告标题。' }, 'stop')
    }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')

  const documents = new DocumentHostService(path.join(root, 'journals'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: encryption() })
  const saved = await settings.saveConnection({ apiKey: 'fixture-secret', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture-account',
    authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null,
  } })
  const directory = path.join(root, 'desktop')
  const service = new ExecutionDesktopService({ directory, documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }), fetch })
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const submitted = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
    conversationId: conversation.conversationId, submissionId: '64444444-4444-4444-8444-444444444444',
    expectedRevision: conversation.revision, text: '读取 sales.csv，交付 Python/JSON/HTML/CSS，之后修改报告标题。',
    documents: [], permission: 'workspace' }) as { run: ExecutionRunRecord }
  expect(submitted.run.input.documents).toEqual([])
  const run = await settled(service, submitted.run.runId)
  expect(run.status).toBe('completed')
  expect(requestCount).toBe(5)
  expect(await fs.readFile(path.join(workspace, 'sales.csv'), 'utf8')).toBe('month,amount\nJan,20\nFeb,22\n')
  expect(await fs.readFile(path.join(workspace, 'chart.py'), 'utf8')).toBe(source)
  expect(JSON.parse(await fs.readFile(path.join(workspace, 'summary.json'), 'utf8'))).toEqual({ total: 42, count: 2 })
  expect(await fs.readFile(path.join(workspace, 'report.css'), 'utf8')).toBe('body { font: 16px sans-serif; }\n')
  const html = await fs.readFile(path.join(workspace, 'report.html'), 'utf8')
  expect(html).toBe(originalHtml.replace('销售报告</h1>', '两个月销售报告</h1>'))
  expect((await fs.readdir(workspace)).some(name => name.endsWith('.h5lesson'))).toBe(false)

  const reopened = new DocumentHostService(path.join(root, 'reopen-journals'))
  const htmlDocument = await reopened.open(path.join(workspace, 'report.html'))
  expect(htmlDocument.model).toMatchObject({ kind: 'text', source: html })
  const restoredService = new ExecutionDesktopService({ directory, documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }), fetch: async () => { throw new Error('History reopen must not call model') } })
  expect(await restoredService.operate({ type: 'run', runId: run.runId })).toMatchObject({ status: 'completed' })
  expect(await restoredService.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId,
    conversationId: conversation.conversationId })).toMatchObject({ messages: expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', text: '已生成四个文件并更新报告标题。' }),
  ]) })
  expect(serviceReceipts[4]!.some(item => item.tool_call_id === 't1-patch-html')).toBe(true)
}, 30_000)
