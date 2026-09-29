import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { McpClientService, type McpCallResult } from '../../src/main/workbench/externalTools/McpClientService'

const require = createRequire(import.meta.url)
const fixtureRoot = resolve('output/g20/b23')

it('uses a real Playwright MCP process for an authorized local browser roundtrip', async () => {
  await fs.mkdir(fixtureRoot, { recursive: true })
  const scratch = await fs.mkdtemp(join(fixtureRoot, 'browser-fixture-'))
  const uploadPath = join(scratch, 'test-upload.txt')
  await fs.writeFile(uploadPath, 'guoling-m29-test-upload', 'utf8')
  const received: string[] = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>M29 controlled page</title></head><body>
        <h1>Controlled page</h1><label>Lesson name <input id="title" aria-label="Lesson name"></label>
        <label>Attachment <input id="attachment" type="file" aria-label="Attachment"></label>
        <button id="submit">Submit test form</button><a id="download" href="/download" download="test-download.txt">Download test file</a>
        <p id="result">No submission</p>
        <script>document.querySelector('#submit').addEventListener('click', async () => {
          const form = new FormData(); form.append('title', document.querySelector('#title').value);
          const file = document.querySelector('#attachment').files[0]; if (file) form.append('attachment', file);
          const result = await fetch('/submit', {method:'POST',body:form});
          document.querySelector('#result').textContent = await result.text();
        });</script></body></html>`)
      return
    }
    if (url.pathname === '/download') {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="test-download.txt"' })
      response.end('guoling-m29-test-download')
      return
    }
    if (url.pathname === '/submit' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        received.push(body)
        response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.end('Saved test-only submission')
      })
      return
    }
    response.writeHead(404); response.end('not found')
  })
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); done() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture listener failed')
  const base = `http://127.0.0.1:${address.port}/`
  const mcpRoot = dirname(require.resolve('@playwright/mcp/package.json'))
  const allowed = ['browser_navigate', 'browser_snapshot', 'browser_type', 'browser_click', 'browser_file_upload', 'browser_take_screenshot', 'browser_wait_for']
  const service = new McpClientService({ connection: { namespace: 'browser',
    transport: { kind: 'stdio', command: process.execPath, args: [join(mcpRoot, 'cli.js'), '--browser=msedge', '--headless', '--isolated', '--no-webmcp',
      `--output-dir=${scratch}`], cwd: scratch },
    tools: allowed.map(name => ({ name, effect: ['browser_snapshot', 'browser_take_screenshot'].includes(name) ? 'read' as const : 'write' as const })),
  }, authorizeWrite: async ({ tool, arguments: args }) => {
    if (tool === 'browser_navigate') return args.url === base
    if (tool === 'browser_type') return args.target === '#title' && args.text === 'M29 test'
    if (tool === 'browser_file_upload') return Array.isArray(args.paths) && args.paths.length === 1 && args.paths[0] === uploadPath
    if (tool === 'browser_click') return ['#attachment', '#submit', '#download'].includes(String(args.target))
    if (tool === 'browser_wait_for') return args.text === 'Saved test-only submission'
    return false
  } })
  service.beginRun('browser-run', { allowedTools: allowed, writeAllowed: true })
  const invoke = (id: string, remoteName: string, args: Record<string, unknown> = {}): Promise<McpCallResult> => service.invoke({
    runId: 'browser-run', operationId: id, name: `mcp.browser.${remoteName}`, arguments: args,
  })
  try {
    const discovery = await service.discover('browser-run')
    expect(discovery).toMatchObject({ status: 'available' })
    if (discovery.status !== 'available') throw new Error(discovery.reason)
    expect(discovery.tools.map(tool => tool.name)).toContain('mcp.browser.browser_navigate')
    expect(await invoke('nav', 'browser_navigate', { url: base })).toMatchObject({ status: 'returned' })
    const snapshot = await invoke('snapshot', 'browser_snapshot')
    expect(snapshot).toMatchObject({ status: 'returned' })
    expect(JSON.stringify(snapshot)).toContain('Controlled page')
    expect(await invoke('type', 'browser_type', { target: '#title', text: 'M29 test' })).toMatchObject({ status: 'returned' })
    expect(await invoke('file-chooser', 'browser_click', { target: '#attachment' })).toMatchObject({ status: 'returned' })
    expect(await invoke('upload', 'browser_file_upload', { paths: [uploadPath] })).toMatchObject({ status: 'returned' })
    expect(await invoke('submit', 'browser_click', { target: '#submit' })).toMatchObject({ status: 'returned' })
    expect(await invoke('wait', 'browser_wait_for', { text: 'Saved test-only submission' })).toMatchObject({ status: 'returned' })
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('M29 test')
    expect(received[0]).toContain('guoling-m29-test-upload')
    expect(await invoke('download', 'browser_click', { target: '#download' })).toMatchObject({ status: 'returned' })
    const files = await fs.readdir(scratch)
    expect(files).toContain('test-download.txt')
    expect(await fs.readFile(join(scratch, 'test-download.txt'), 'utf8')).toBe('guoling-m29-test-download')
    const screenshot = await invoke('shot', 'browser_take_screenshot', {})
    expect(screenshot).toMatchObject({ status: 'returned' })
    if (screenshot.status !== 'returned') throw new Error('screenshot call did not return')
    const image = screenshot.content.find(item => item.type === 'binary')
    expect(image).toBeDefined()
    if (image?.type === 'binary') {
      const bytes = service.readResource('browser-run', image.resourceId).bytes
      expect(Buffer.from(bytes.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a')
    }
    await service.stopRun('browser-run')
    expect(await invoke('after-stop', 'browser_snapshot')).toMatchObject({ status: 'rejected' })
  } finally {
    await service.endRun('browser-run')
    await new Promise<void>(done => server.close(() => done()))
    const resolved = await fs.realpath(scratch)
    const rel = relative(fixtureRoot, resolved)
    if (!rel || rel.startsWith('..') || resolve(fixtureRoot, rel) !== resolved) throw new Error('fixture cleanup target escaped output directory')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}, 120_000)
