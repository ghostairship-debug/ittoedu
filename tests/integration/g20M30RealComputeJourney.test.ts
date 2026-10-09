// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ComputeJobService } from '../../src/main/workbench/compute/ComputeJobService'
import { PINNED_PYTHON_IMAGE_ID, PodmanComputeBackend } from '../../src/main/workbench/compute/PodmanComputeBackend'
import { HostJobService } from '../../src/main/workbench/jobs/HostJobService'
import { HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
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

function toolReceipt(receipts: Array<{ tool_call_id: string; content: string }>, id: string): {
  kind: string; data: Record<string, unknown> } {
  const content = receipts.find(item => item.tool_call_id === id)?.content
  if (!content) throw new Error(`Missing tool receipt ${id}`)
  return JSON.parse(content) as { kind: string; data: Record<string, unknown> }
}

it.skipIf(!process.env.G20_TEST_PODMAN_IMAGE)('M30 T1 runs the exact delivered Python source in real isolated compute and saves its verified output', async () => {
  const image = process.env.G20_TEST_PODMAN_IMAGE
  if (image !== PINNED_PYTHON_IMAGE_ID) throw new Error('Set G20_TEST_PODMAN_IMAGE to the pinned local Python image ID')
  const backend = new PodmanComputeBackend({ distro: 'Ubuntu', image })
  expect(await backend.availability()).toEqual({ available: true })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m30-real-t1-')); roots.push(root)
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const inputCsv = 'month,amount\nJan,20\nFeb,22\n'
  await fs.writeFile(path.join(workspace, 'sales.csv'), inputCsv)
  const originalHtml = '<!doctype html><html><head><link rel="stylesheet" href="report.css"></head><body><h1>销售报告</h1><p>总额：42</p><figure><img src="chart.svg" alt="两个月销售额图表"></figure></body></html>\n'
  let source = '', requestCount = 0, serverError: string | null = null
  let computeJob = ''
  const server = createServer((request, response) => { void (async () => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw) as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>
      tools: Array<{ function: { name: string; description: string } }>
    }
    requestCount++
    const receipts = payload.messages.filter(message => message.role === 'tool' && message.tool_call_id && message.content)
      .map(message => ({ tool_call_id: message.tool_call_id!, content: message.content! }))
    const wire = (prefix: string) => {
      const match = payload.tools.find(tool => tool.function.description.startsWith(prefix))
      if (!match) throw new Error(`Model did not receive tool description: ${prefix}`)
      return match.function.name
    }
    const call = (index: number, id: string, name: string, input: unknown) => ({ index, id, type: 'function',
      function: { name, arguments: JSON.stringify(input) } })
    if (requestCount === 1) {
      expect(payload.messages.some(message => message.role === 'system' && message.content?.includes('本次固定文档与权限'))).toBe(true)
      sse(response, 't1-read', { tool_calls: [call(0, 't1-read', wire('读取普通 UTF-8 文件'), { path: 'sales.csv' })] }, 'tool_calls')
    } else if (requestCount === 2) {
      const read = toolReceipt(receipts, 't1-read')
      expect(read).toMatchObject({ kind: 'read', data: { text: inputCsv, truncated: false } })
      const csv = read.data.text as string
      source = `from pathlib import Path\nimport csv, io, json\nrows = list(csv.DictReader(io.StringIO(${JSON.stringify(csv)})))\nlabels = [row["month"] for row in rows]\nvalues = [int(row["amount"]) for row in rows]\ntotal = sum(values)\nPath("/job/output/computed.json").write_text(json.dumps({"total": total, "count": len(rows)}))\nbars = ''.join(f'<rect x="{40 + i * 120}" y="{140 - value * 4}" width="70" height="{value * 4}" fill="#2563eb"/><text x="{40 + i * 120}" y="165">{labels[i]} {value}</text>' for i, value in enumerate(values))\nsvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img"><title>两个月销售额</title>' + bars + '</svg>\\n'\nPath("/job/output/chart.svg").write_text(svg, encoding="utf-8")\nprint("computed", total)\n`
      const write = wire('新建或完整替换普通 UTF-8 文件')
      sse(response, 't1-write', { tool_calls: [
        call(0, 't1-python', write, { mode: 'create', path: 'chart.py', content: source }),
        call(1, 't1-json', write, { mode: 'create', path: 'summary.json', content: '{"total":42,"count":2}\n' }),
        call(2, 't1-html', write, { mode: 'create', path: 'report.html', content: originalHtml }),
        call(3, 't1-css', write, { mode: 'create', path: 'report.css', content: 'body { font: 16px sans-serif; }\n' }),
      ] }, 'tool_calls')
    } else if (requestCount === 3) {
      for (const id of ['t1-python', 't1-json', 't1-html', 't1-css'])
        expect(toolReceipt(receipts, id)).toMatchObject({ kind: 'read', data: { saved: true } })
      sse(response, 't1-compute', { tool_calls: [call(0, 't1-compute', wire('在已配置的受限 Python 后端'),
        { code: source, outputNames: ['computed.json', 'chart.svg'] })] }, 'tool_calls')
    } else if (requestCount === 4) {
      const compute = toolReceipt(receipts, 't1-compute')
      expect(compute).toMatchObject({ kind: 'read', data: { job: expect.stringMatching(/^compute-/) } })
      computeJob = compute.data.job as string
      sse(response, 't1-wait', { tool_calls: [call(0, 't1-wait', wire('有界等待本任务'),
        { kind: 'compute', job: computeJob, milliseconds: 30_000 })] }, 'tool_calls')
    } else if (requestCount === 5) {
      const waited = toolReceipt(receipts, 't1-wait')
      if (waited.data.status !== 'ready') throw new Error(`Compute did not become ready: ${JSON.stringify(waited)}`)
      expect(waited).toMatchObject({ kind: 'read', data: {
        kind: 'compute', jobId: computeJob, status: 'ready', terminal: true,
        snapshot: { artifacts: expect.arrayContaining([
          expect.objectContaining({ name: 'computed.json' }), expect.objectContaining({ name: 'chart.svg' }),
        ]) },
      } })
      sse(response, 't1-logs', { tool_calls: [call(0, 't1-logs', wire('分页读取本任务作业日志'),
        { kind: 'compute', job: computeJob })] }, 'tool_calls')
    } else if (requestCount === 6) {
      const logs = toolReceipt(receipts, 't1-logs')
      expect(JSON.stringify(logs.data)).toContain('computed 42')
      sse(response, 't1-save-json', { tool_calls: [call(0, 't1-save-json', wire('把本任务已确认 ready'),
        { kind: 'compute', job: computeJob, name: 'computed.json', destination: 'computed.json' })] }, 'tool_calls')
    } else if (requestCount === 7) {
      expect(toolReceipt(receipts, 't1-save-json')).toMatchObject({ kind: 'read', data: { status: 'written', sourceKind: 'compute' } })
      sse(response, 't1-save-svg', { tool_calls: [call(0, 't1-save-svg', wire('把本任务已确认 ready'),
        { kind: 'compute', job: computeJob, name: 'chart.svg', destination: 'chart.svg' })] }, 'tool_calls')
    } else if (requestCount === 8) {
      expect(toolReceipt(receipts, 't1-save-svg')).toMatchObject({ kind: 'read', data: { status: 'written', sourceKind: 'compute' } })
      sse(response, 't1-read-html', { tool_calls: [call(0, 't1-read-html', wire('读取普通 UTF-8 文件'),
        { path: 'report.html' })] }, 'tool_calls')
    } else if (requestCount === 9) {
      const htmlRead = toolReceipt(receipts, 't1-read-html')
      expect(htmlRead).toMatchObject({ kind: 'read', data: { text: originalHtml } })
      sse(response, 't1-patch-html', { tool_calls: [call(0, 't1-patch-html', wire('按 file.read 的版本'), {
        path: 'report.html', expectedVersion: htmlRead.data.version,
        oldText: '<h1>销售报告</h1>', newText: '<h1>两个月销售报告</h1>',
      })] }, 'tool_calls')
    } else if (requestCount === 10) {
      expect(toolReceipt(receipts, 't1-patch-html')).toMatchObject({ kind: 'read', data: { status: 'written', saved: true } })
      sse(response, 't1-final', { content: '受限计算结果为 42，已交付报告、图表和计算成果。' }, 'stop')
    } else throw new Error(`Unexpected model request ${requestCount}`)
  })().catch(error => {
    serverError ??= error instanceof Error ? error.stack ?? error.message : String(error)
    if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: serverError } }))
  }) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')

  const documents = new DocumentHostService(path.join(root, 'journals'))
  const compute = new ComputeJobService({ directory: path.join(root, 'jobs'), backend })
  const jobs = new HostJobService({ compute, images: {} as ImageGenerationService })
  documents.tools.configureHostServices({ compute, jobs })
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
    conversationId: conversation.conversationId, submissionId: '65555555-5555-4555-8555-555555555555',
    expectedRevision: conversation.revision, text: '读取 sales.csv，交付四份文件，在受限计算后端运行同一 Python 脚本生成可见图表和数值，并保存成果，再更新报告标题。',
    documents: [], permission: 'workspace' }) as { run: ExecutionRunRecord }
  expect(submitted.run.input.documents).toEqual([])
  let run: ExecutionRunRecord | null = null
  for (let attempt = 0; attempt < 3000; attempt++) {
    run = await service.operate({ type: 'run', runId: submitted.run.runId }) as ExecutionRunRecord | null
    if (run && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  if (serverError) throw new Error(`${serverError}\nRun tools: ${JSON.stringify(run?.tools.map(tool => ({
    callId: tool.callId, name: tool.call.name, state: tool.state, result: tool.result,
  })))}`)
  if (!run) throw new Error('No terminal run')
  expect(run.status).toBe('completed')
  expect(requestCount).toBe(10)
  expect(await fs.readFile(path.join(workspace, 'sales.csv'), 'utf8')).toBe(inputCsv)
  expect(await fs.readFile(path.join(workspace, 'chart.py'), 'utf8')).toBe(source)
  expect(JSON.parse(await fs.readFile(path.join(workspace, 'summary.json'), 'utf8'))).toEqual({ total: 42, count: 2 })
  expect(await fs.readFile(path.join(workspace, 'report.css'), 'utf8')).toBe('body { font: 16px sans-serif; }\n')
  expect(JSON.parse(await fs.readFile(path.join(workspace, 'computed.json'), 'utf8'))).toEqual({ total: 42, count: 2 })
  const svg = await fs.readFile(path.join(workspace, 'chart.svg'), 'utf8')
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"')
  expect(svg).toContain('<rect x="40" y="60" width="70" height="80"')
  expect(svg).toContain('<rect x="160" y="52" width="70" height="88"')
  expect(svg).toContain('<text x="40" y="165">Jan 20</text>')
  expect(svg).toContain('<text x="160" y="165">Feb 22</text>')
  const html = await fs.readFile(path.join(workspace, 'report.html'), 'utf8')
  expect(html).toBe(originalHtml.replace('销售报告</h1>', '两个月销售报告</h1>'))
  expect((await fs.readdir(workspace)).some(name => name.endsWith('.h5lesson'))).toBe(false)
  const reopened = new DocumentHostService(path.join(root, 'reopen-journals'))
  const reopenedSnapshot = await reopened.open(path.join(workspace, 'report.html'))
  expect(reopenedSnapshot.model).toMatchObject({ kind: 'text', source: html })
  if (reopenedSnapshot.binding.kind !== 'file') throw new Error('Reopened HTML lost its file binding')
  const owner = { processId: 4, frameToken: 'frame', documentToken: 'document-token' }
  const policy = new PreviewNetworkPolicy()
  policy.activateDocument(owner)
  const preview = new HtmlPreviewService({ readDocument: async () => reopenedSnapshot,
    networkOwner: () => owner, currentMainFrame: () => ({ webContentsId: 7, processId: 4, frameToken: 'frame' }),
    networkPolicy: policy, registerFrameEntry: () => () => {} })
  const lease = await preview.open({ type: 'html-preview.open', documentId: reopenedSnapshot.documentId,
    epoch: reopenedSnapshot.epoch, expectedBindingVersion: reopenedSnapshot.binding.bindingVersion, tabId: 'report-tab' })
  const servedHtml = await preview.handleProtocolRequest(new Request(lease.url))
  expect(servedHtml.status).toBe(200)
  expect(await servedHtml.text()).toContain('<img src="chart.svg" alt="两个月销售额图表">')
  const relativeSvg = await preview.handleProtocolRequest(new Request(new URL('chart.svg', lease.url)))
  expect(relativeSvg.status).toBe(200)
  expect(relativeSvg.headers.get('Content-Type')).toBe('image/svg+xml')
  expect(await relativeSvg.text()).toBe(svg)
  await preview.release({ type: 'html-preview.release', leaseId: lease.leaseId, tabId: 'report-tab' })
  const restored = new ExecutionDesktopService({ directory, documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: await fs.realpath(value) }), fetch: async () => { throw new Error('History reopen must not call model') } })
  expect(await restored.operate({ type: 'run', runId: run.runId })).toMatchObject({ status: 'completed' })
  expect(await restored.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId,
    conversationId: conversation.conversationId })).toMatchObject({ messages: expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', text: '受限计算结果为 42，已交付报告、图表和计算成果。' }),
  ]) })
  console.info(JSON.stringify({ case: 'M30-T04-real-compute-subset', status: run.status, model: 'local HTTP fixture',
    backend: 'Podman', image, requests: requestCount, job: computeJob, result: 42, artifacts: ['computed.json', 'chart.svg'],
    workspaceFiles: await fs.readdir(workspace) }))
}, 120_000)
