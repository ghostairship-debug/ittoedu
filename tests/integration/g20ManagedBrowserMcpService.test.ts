import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
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
  const service = new ManagedBrowserMcpService({ scratchRoot, testLoopbackOrigin: origin, externalBackend: 'edge-mcp',
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

    const noApproval = new ManagedBrowserMcpService({ scratchRoot, testLoopbackOrigin: origin, externalBackend: 'edge-mcp' })
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
    const oldObservation = snapshot.snapshotId
    const takingOver = service.control('authorized', 'takeover')
    const handoffWrite = invoke('authorized', 'during-handoff', 'browser_click', { target: '#submit' }, oldObservation)
    expect(await takingOver).toMatchObject({ state: 'human' })
    expect(await invoke('authorized', 'hidden-code-denied', 'browser_run_code_unsafe', { code: 'async(page)=>page.context().cookies()' })).toMatchObject({ status: 'rejected' })
    let returnedWhileHuman = false
    const heldRead = invoke('authorized', 'during-login', 'browser_snapshot').then(result => { returnedWhileHuman = true; return result })
    await new Promise(resolve => setTimeout(resolve, 80)); expect(returnedWhileHuman).toBe(false)
    const cancelled = new AbortController()
    const cancelledRead = service.invoke({ runId: 'authorized', operationId: 'cancel-during-login', name: 'mcp.browser.browser_snapshot', arguments: {}, signal: cancelled.signal })
    cancelled.abort(); expect(await cancelledRead).toMatchObject({ status: 'rejected' })
    const resumed = await service.control('authorized', 'resume')
    expect(resumed).toMatchObject({ state: 'agent', pageUrl: `${origin}/` })
    expect(await handoffWrite).toMatchObject({ status: 'rejected' })
    expect(await heldRead).toMatchObject({ status: 'returned' })
    expect(resumed.snapshotId).toBeTruthy(); expect(resumed.snapshotId).not.toBe(oldObservation)
    expect(await invoke('authorized', 'old-observation-after-login', 'browser_click', { target: '#submit' }, oldObservation)).toMatchObject({ status: 'rejected' })
    snapshot = await invoke('authorized', 'after-login-observation', 'browser_snapshot')
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
    expect(Buffer.from((await service.readResource('authorized', download.downloads![0]!.resourceId)).bytes).toString())
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

it('resumes the same browser after a visible local login and keeps its cookie out of model results and downloads', async () => {
  const fixture = await fs.mkdtemp(join(tmpdir(), 'g20-browser-login-'))
  const cookie = `fixture-session-${randomUUID()}`
  const password = 'fixture-password-only'
  let logins = 0, authenticatedReads = 0
  const server = createServer((request, response) => {
    const authenticated = request.headers.cookie === `session=${cookie}`
    if (request.url === '/login' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        const fields = new URLSearchParams(Buffer.concat(chunks).toString())
        if (fields.get('username') !== 'fixture-user' || fields.get('password') !== password) {
          response.writeHead(401); response.end('Login required'); return
        }
        logins++
        response.writeHead(303, { 'Set-Cookie': `session=${cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: '/protected' })
        response.end()
      })
    } else if (request.url === '/login') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><h1>Fixture login</h1><form method="post" action="/login"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><button>Sign in</button></form>')
    } else if (request.url === '/protected' || request.url === '/protected-download') {
      if (!authenticated) { response.writeHead(302, { Location: '/login' }); response.end(); return }
      authenticatedReads++
      if (request.url === '/protected-download') {
        response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="protected-lesson.txt"' })
        response.end('protected lesson content')
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><h1>Protected lesson</h1><a id="download" href="/protected-download" download="protected-lesson.txt">Download lesson</a>')
      }
    } else { response.writeHead(404); response.end('missing') }
  })
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server unavailable')
  const origin = `http://127.0.0.1:${address.port}`, runId = 'login-task'
  const service = new ManagedBrowserMcpService({ scratchRoot: join(fixture, 'runs'), testLoopbackOrigin: origin, externalBackend: 'edge-mcp',
    approveExternalAction: async input => input.tool === 'browser_click' && input.arguments.target === '#download'
      && input.pageUrl === `${origin}/protected` })
  const modelResults: unknown[] = []
  const invoke = async (operationId: string, name: string, args: Record<string, unknown> = {}, snapshotId?: string) => {
    const result = await service.invoke({ runId, operationId, name: `mcp.browser.${name}`, arguments: args, snapshotId })
    modelResults.push(result); return result
  }
  try {
    await service.beginRun(runId, { permission: 'workspace-write', allowedOrigins: [origin] })
    expect(await invoke('open-protected', 'browser_navigate', { url: `${origin}/protected` })).toMatchObject({ status: 'returned' })
    const before = await invoke('before-login', 'browser_snapshot')
    expect(JSON.stringify(before)).toContain('Fixture login')
    expect(authenticatedReads).toBe(0)
    expect(await service.control(runId, 'takeover')).toMatchObject({ state: 'human', pageUrl: `${origin}/login` })
    let resumedRead = false
    const held = invoke('paused-observation', 'browser_snapshot').then(result => { resumedRead = true; return result })

    // A test-only user driver operates the actual visible page through its existing
    // transport. It fills the form and submits it; it never writes browser cookies.
    // This transport is deliberately absent from the agent's public tool surface.
    type UserDriver = { callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ isError?: boolean }> }
    const driver = (service as unknown as { runs: Map<string, { client: { runs: Map<string, { client?: UserDriver }> } }> })
      .runs.get(runId)?.client.runs.get(runId)?.client
    if (!driver) throw new Error('original browser transport unavailable')
    const userAction = await driver.callTool({ name: 'browser_run_code_unsafe', arguments: { code: `async (page) => {
      const cdp = await page.context().newCDPSession(page);
      try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
        if (bounds.windowState === 'minimized' || bounds.left < 0 || bounds.top < 0) throw new Error('Login window is not visible');
      } finally { await cdp.detach(); }
      await page.getByLabel('Username').fill('fixture-user');
      await page.getByLabel('Password').fill(${JSON.stringify(password)});
      await Promise.all([page.waitForURL('**/protected'), page.getByRole('button', { name: 'Sign in' }).click()]);
      return { signedIn: true };
    }` } })
    expect(userAction.isError).not.toBe(true)
    expect(logins).toBe(1)
    expect(authenticatedReads).toBe(1)
    expect(resumedRead).toBe(false)

    const resumed = await service.control(runId, 'resume')
    modelResults.push(resumed)
    expect(resumed).toMatchObject({ state: 'agent', pageUrl: `${origin}/protected` })
    expect(JSON.stringify(await held)).toContain('Protected lesson')
    expect(await invoke('old-login-action', 'browser_click', { target: '#download' }, before.snapshotId)).toMatchObject({ status: 'rejected' })
    const after = await invoke('protected-observation', 'browser_snapshot')
    const downloaded = await invoke('download-protected', 'browser_click', { target: '#download' }, after.snapshotId)
    expect(downloaded).toMatchObject({ status: 'returned' })
    expect(downloaded.downloads).toHaveLength(1)
    const artifact = await service.readResource(runId, downloaded.downloads![0]!.resourceId)
    expect(Buffer.from(artifact.bytes).toString()).toBe('protected lesson content')
    expect(authenticatedReads).toBe(2)
    expect(JSON.stringify(modelResults)).not.toContain(cookie)
    expect(JSON.stringify(modelResults)).not.toContain(password)

    await service.control(runId, 'takeover')
    const cancelled = invoke('cancelled-login-wait', 'browser_snapshot')
    await service.stopRun(runId)
    expect(await cancelled).toMatchObject({ status: 'rejected' })
    expect(service.controlState(runId).state).toBe('stopped')
    expect(await fs.readdir(join(fixture, 'runs'))).toEqual([])
  } finally {
    await service.endRun(runId)
    await new Promise<void>(done => server.close(() => done()))
    await fs.rm(fixture, { recursive: true, force: true })
  }
}, 120_000)
