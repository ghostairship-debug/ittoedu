import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService, type ManagedBrowserResult } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it('manages a real Edge MCP browser with per-action approval, scoped transfer and stop cleanup', async () => {
  const root = resolve('output/g20/b23')
  await fs.mkdir(root, { recursive: true })
  const fixture = await fs.mkdtemp(join(root, 'managed-browser-fixture-'))
  const scratchRoot = join(fixture, 'runs')
  const uploadRoot = join(fixture, 'uploads')
  await fs.mkdir(uploadRoot)
  await fs.writeFile(join(uploadRoot, 'test.txt'), 'managed-browser-upload')
  const received: string[] = []
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><head><title>M29 managed browser</title></head><body>
        <h1>Controlled page</h1><input id="title" aria-label="Lesson name"><input id="attachment" type="file" aria-label="Attachment">
        <button id="submit">Submit test form</button><a id="download" href="/download" download="artifact.txt">Download artifact</a>
        <p id="result">No submission</p><script>document.querySelector('#submit').addEventListener('click',async()=>{
          const data=new FormData();data.append('title',document.querySelector('#title').value);
          const file=document.querySelector('#attachment').files[0];if(file)data.append('attachment',file);
          const answer=await fetch('/submit',{method:'POST',body:data});document.querySelector('#result').textContent=await answer.text();
        });</script></body></html>`)
    } else if (request.url === '/submit' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => { received.push(Buffer.concat(chunks).toString()); response.end('Saved test only') })
    } else if (request.url === '/download') {
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="artifact.txt"' })
      response.end('managed-browser-download')
    } else { response.writeHead(404); response.end('missing') }
  })
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server unavailable')
  const origin = `http://127.0.0.1:${address.port}`
  const approvals: string[] = []
  const service = new ManagedBrowserMcpService({ scratchRoot, testLoopbackOrigin: origin,
    approveExternalAction: async ({ tool, arguments: args, pageUrl }) => {
      approvals.push(tool)
      return pageUrl === `${origin}/` && (
        tool === 'browser_type' && args.target === '#title' && args.text === 'M29 test'
        || tool === 'browser_click' && ['#attachment', '#submit', '#download'].includes(String(args.target))
        || tool === 'browser_file_upload' && JSON.stringify(args.paths) === '["test.txt"]')
    } })
  const invoke = (runId: string, id: string, name: string, args: Record<string, unknown> = {}, snapshotId?: string): Promise<ManagedBrowserResult> =>
    service.invoke({ runId, operationId: id, name: `mcp.browser.${name}`, arguments: args, snapshotId })
  try {
    await service.beginRun('readonly', { permission: 'read-only', allowedOrigins: [origin] })
    const tools = await service.discover('readonly')
    expect(tools.status).toBe('available')
    if (tools.status !== 'available') throw new Error(tools.reason)
    expect(tools.tools.some(tool => tool.name === 'mcp.browser.browser_run_code_unsafe')).toBe(false)
    expect(tools.tools.every(tool => tool.effect === 'read')).toBe(true)
    expect(await invoke('readonly', 'nav', 'browser_navigate', { url: `${origin}/` })).toMatchObject({ status: 'returned' })
    const first = await invoke('readonly', 'snapshot', 'browser_snapshot')
    expect(first).toMatchObject({ status: 'returned' })
    expect(JSON.stringify(first)).toContain('Controlled page')
    expect(await invoke('readonly', 'click-denied', 'browser_click', { target: '#submit' }, first.snapshotId)).toMatchObject({ status: 'rejected' })
    expect(await invoke('readonly', 'private-denied', 'browser_navigate', { url: 'http://127.0.0.1:9/' })).toMatchObject({ status: 'rejected' })
    expect(received).toHaveLength(0)
    await service.endRun('readonly')

    const noApproval = new ManagedBrowserMcpService({ scratchRoot, testLoopbackOrigin: origin })
    try {
      await noApproval.beginRun('missing-approval', { permission: 'workspace-write', allowedOrigins: [origin] })
      const noApprovalTools = await noApproval.discover('missing-approval')
      expect(noApprovalTools.status).toBe('available')
      if (noApprovalTools.status === 'available') expect(noApprovalTools.tools.every(tool => tool.effect === 'read')).toBe(true)
      expect(await noApproval.invoke({ runId: 'missing-approval', operationId: 'nav', name: 'browser_navigate',
        arguments: { url: `${origin}/` } })).toMatchObject({ status: 'returned' })
      const observed = await noApproval.invoke({ runId: 'missing-approval', operationId: 's', name: 'browser_snapshot', arguments: {} })
      expect(await noApproval.invoke({ runId: 'missing-approval', operationId: 'click', name: 'browser_click',
        arguments: { target: '#submit' }, snapshotId: observed.snapshotId })).toMatchObject({ status: 'rejected' })
      expect(received).toHaveLength(0)
    } finally { await noApproval.endRun('missing-approval') }

    await service.beginRun('authorized', { permission: 'ask-before-edit', allowedOrigins: [origin], uploadRoot })
    const approvedTools = await service.discover('authorized')
    expect(approvedTools.status).toBe('available')
    if (approvedTools.status === 'available')
      expect(JSON.stringify(approvedTools.tools.find(tool => tool.remoteName === 'browser_click')?.inputSchema)).toContain('snapshotId')
    expect(await invoke('authorized', 'nav', 'browser_navigate', { url: `${origin}/` })).toMatchObject({ status: 'returned' })
    let snapshot = await invoke('authorized', 's1', 'browser_snapshot')
    expect(snapshot.snapshotId).toBeTruthy()
    expect(await invoke('authorized', 'type', 'browser_type', { target: '#title', text: 'M29 test', snapshotId: snapshot.snapshotId }))
      .toMatchObject({ status: 'returned' })
    expect(await invoke('authorized', 'stale-click', 'browser_click', { target: '#submit' }, snapshot.snapshotId))
      .toMatchObject({ status: 'rejected' })
    snapshot = await invoke('authorized', 's2', 'browser_snapshot')
    expect(await invoke('authorized', 'chooser', 'browser_click', { target: '#attachment' }, snapshot.snapshotId))
      .toMatchObject({ status: 'returned' })
    expect(service.approvalContext('authorized')).toMatchObject({ pageUrl: `${origin}/`, snapshotId: snapshot.snapshotId })
    expect(await invoke('authorized', 'bad-upload', 'browser_file_upload', { paths: ['../outside.txt'] }, snapshot.snapshotId))
      .toMatchObject({ status: 'rejected' })
    expect(await invoke('authorized', 'upload', 'browser_file_upload', { paths: ['test.txt'] }, snapshot.snapshotId))
      .toMatchObject({ status: 'returned' })
    expect(service.approvalContext('authorized').snapshotId).toBeUndefined()
    snapshot = await invoke('authorized', 's3', 'browser_snapshot')
    expect(await invoke('authorized', 'submit', 'browser_click', { target: '#submit' }, snapshot.snapshotId))
      .toMatchObject({ status: 'returned' })
    expect(received).toHaveLength(1)
    expect(received[0]).toContain('M29 test')
    expect(received[0]).toContain('managed-browser-upload')
    snapshot = await invoke('authorized', 's4', 'browser_snapshot')
    const download = await invoke('authorized', 'download', 'browser_click', { target: '#download' }, snapshot.snapshotId)
    expect(download).toMatchObject({ status: 'returned' })
    expect(download.downloads).toHaveLength(1)
    expect(Buffer.from(service.readResource('authorized', download.downloads![0]!.resourceId).bytes).toString())
      .toBe('managed-browser-download')
    await service.stopRun('authorized')
    expect(await invoke('authorized', 'after-stop', 'browser_snapshot')).toMatchObject({ status: 'rejected' })
    expect(await fs.readdir(scratchRoot)).toEqual([])
    expect(approvals).toContain('browser_file_upload')
  } finally {
    await Promise.all([service.endRun('readonly'), service.endRun('authorized')])
    await new Promise<void>(done => server.close(() => done()))
    await fs.rm(fixture, { recursive: true, force: true })
  }
}, 120_000)
