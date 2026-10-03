// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'
import { expect, it } from 'vitest'
import type { ManagedBrowserResult } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it('embeds the actual automated task page and resumes after human login without replacing its WebContents', async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'guoling-embedded-browser-'))
  const cookie = `fixture-${randomUUID()}`, password = 'only-local-fixture-password'
  let logins = 0
  const server = createServer((request, response) => {
    if (request.url === '/login' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        const values = new URLSearchParams(Buffer.concat(chunks).toString())
        if (values.get('username') !== 'fixture-user' || values.get('password') !== password) {
          response.writeHead(401).end('Invalid fixture login'); return
        }
        logins++
        response.writeHead(303, { 'Set-Cookie': `session=${cookie}; Path=/; HttpOnly; SameSite=Strict`, Location: '/protected' }).end()
      })
    } else if (request.url === '/protected' || request.url === '/download') {
      if (request.headers.cookie !== `session=${cookie}`) { response.writeHead(302, { Location: '/login' }).end(); return }
      if (request.url === '/download') response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="lesson.txt"' }).end('same-session protected lesson')
      else response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><h1>Protected lesson</h1><label>Automatic note<input id="auto-input"></label><input id="upload" type="file"><a id="download" href="/download">Download lesson</a>')
    } else if (request.url === '/login') response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><h1>Fixture login</h1><form action="/login" method="post"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><button type="submit">Sign in</button></form>')
    else response.writeHead(404).end()
  })
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('local test server did not start')
  const origin = `http://127.0.0.1:${address.port}`, scratch = join(directory, 'runs'), uploads = join(directory, 'uploads')
  await fs.mkdir(uploads)
  await fs.writeFile(join(uploads, 'source.txt'), 'uploaded fixture')
  const entry = join(directory, 'main.cjs')
  await build({ entryPoints: [resolve('tests/fixtures/embedded-browser/main.ts')], outfile: entry, bundle: true,
    platform: 'node', format: 'cjs', external: ['electron', '@playwright/mcp/package.json'], logLevel: 'silent',
    banner: { js: "process.on('uncaughtException', error => { globalThis.embeddedBrowserFixtureError = error.stack; console.error(error); });" } })
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  const application = await electron.launch({ args: [entry], cwd: process.cwd(), env: { ...env,
    NODE_PATH: resolve('node_modules'), GUOLING_EMBEDDED_BROWSER_TEST_ORIGIN: origin, GUOLING_EMBEDDED_BROWSER_TEST_SCRATCH: scratch,
    GUOLING_EMBEDDED_BROWSER_TEST_UPLOADS: uploads }, timeout: 30_000 })
  const results: unknown[] = []
  let processErrors = ''
  application.process().stderr?.on('data', chunk => { processErrors += chunk.toString() })
  const invoke = async (operationId: string, name: string, args: Record<string, unknown> = {}, snapshotId?: string) => {
    const result = await application.evaluate(async (_electron, input) => {
      const fixture = (globalThis as any).embeddedBrowserFixture
      return fixture.service.invoke({ runId: 'task', ...input })
    }, { operationId, name: `mcp.browser.${name}`, arguments: args, snapshotId }) as ManagedBrowserResult
    results.push(result); return result
  }
  try {
    const startup = await application.evaluate(async ({ app, BrowserWindow }) => {
      await app.whenReady()
      for (let i = 0; i < 100 && !(globalThis as any).embeddedBrowserFixture; i++) await new Promise(done => setTimeout(done, 30))
      return (globalThis as any).embeddedBrowserFixture ? null : (globalThis as any).embeddedBrowserFixtureError
        || `fixture service unavailable; windows=${BrowserWindow.getAllWindows().length}; argv=${JSON.stringify(process.argv)}; NODE_PATH=${process.env.NODE_PATH}`
    })
    if (startup) throw new Error(`${startup}\n${processErrors}`)
    const initial = await application.evaluate(() => (globalThis as any).embeddedBrowserFixture.service.controlState('task'))
    expect(initial).toEqual({ state: 'agent' })
    expect(await invoke('navigate', 'browser_navigate', { url: `${origin}/protected` })).toMatchObject({ status: 'returned' })
    const before = await invoke('before-human', 'browser_snapshot')
    expect(JSON.stringify(before)).toContain('Fixture login')
    const viewIdentity = await application.evaluate(async () => {
      const { service, window } = (globalThis as any).embeddedBrowserFixture
      const viewport = service.viewport('task', { visible: true, bounds: { x: 10, y: 65, width: 1000, height: 650 } })
      const view = window.contentView.children.find((view: any) => view.webContents && view.webContents.id !== window.webContents.id)
      return { viewport, id: view.webContents.id, count: window.contentView.children.filter((view: any) => view.webContents).length,
        preferences: view.webContents.getLastWebPreferences(), visible: view.getVisible() }
    })
    expect(viewIdentity.viewport).toMatchObject({ embedded: true, visible: true, pageUrl: `${origin}/login` })
    expect(viewIdentity.visible).toBe(true)
    expect(viewIdentity.preferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
    expect(viewIdentity.preferences.preload ?? '').toBe('')
    await application.evaluate(async () => (globalThis as any).embeddedBrowserFixture.service.control('task', 'takeover'))
    // A human-side driver sends native mouse and text input to the displayed WebContents.
    // It does not set a cookie or call the agent's browser tools.
    await application.evaluate(async (_electron, input) => {
      const { window } = (globalThis as any).embeddedBrowserFixture
      const view = window.contentView.children.find((view: any) => view.webContents?.id === input.id)
      const contents = view.webContents
      const click = async (selector: string) => {
        const point = await contents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
        contents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        contents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
        await new Promise(done => setTimeout(done, 40))
      }
      await click('[name="username"]'); await contents.insertText('fixture-user')
      await click('[name="password"]'); await contents.insertText(input.password)
      await click('button')
      for (let i = 0; i < 100 && !contents.getURL().endsWith('/protected'); i++) await new Promise(done => setTimeout(done, 50))
      if (!contents.getURL().endsWith('/protected')) throw new Error('human fixture login did not navigate')
    }, { id: viewIdentity.id, password })
    expect(logins).toBe(1)
    const resumed = await application.evaluate(async () => (globalThis as any).embeddedBrowserFixture.service.control('task', 'resume'))
    expect(resumed).toMatchObject({ state: 'agent', pageUrl: `${origin}/protected` })
    const samePage = await application.evaluate(() => {
      const { window } = (globalThis as any).embeddedBrowserFixture
      const view = window.contentView.children.find((view: any) => view.webContents && view.webContents.id !== window.webContents.id)
      return { id: view.webContents.id, visible: view.getVisible() }
    })
    expect(samePage).toEqual({ id: viewIdentity.id, visible: true })
    expect(await invoke('stale', 'browser_click', { target: '#download' }, before.snapshotId)).toMatchObject({ status: 'rejected' })
    let observed = await invoke('protected', 'browser_snapshot')
    expect(JSON.stringify(observed)).toContain('Protected lesson')
    expect(await invoke('automatic-edit', 'browser_type', { target: '#auto-input', text: 'continued automatically' }, observed.snapshotId)).toMatchObject({ status: 'returned' })
    observed = await invoke('after-edit', 'browser_snapshot')
    expect(JSON.stringify(observed)).toContain('continued automatically')
    expect(await invoke('chooser', 'browser_click', { target: '#upload' }, observed.snapshotId)).toMatchObject({ status: 'returned' })
    expect(await invoke('upload', 'browser_file_upload', { paths: ['source.txt'] }, observed.snapshotId)).toMatchObject({ status: 'returned' })
    observed = await invoke('download-observation', 'browser_snapshot')
    const downloaded = await invoke('download', 'browser_click', { target: '#download' }, observed.snapshotId)
    expect(downloaded).toMatchObject({ status: 'returned' })
    expect(downloaded.downloads).toHaveLength(1)
    const artifact = await application.evaluate(async (_electron, resourceId) => {
      const resource = await (globalThis as any).embeddedBrowserFixture.service.readResource('task', resourceId)
      return Buffer.from(resource.bytes).toString()
    }, downloaded.downloads![0]!.resourceId)
    expect(artifact).toBe('same-session protected lesson')
    const screenshot = await invoke('screenshot', 'browser_take_screenshot')
    expect(screenshot.status).toBe('returned')
    const hidden = await application.evaluate(() => {
      const { service, window } = (globalThis as any).embeddedBrowserFixture
      service.viewport('task', { visible: false })
      const view = window.contentView.children.find((view: any) => view.webContents && view.webContents.id !== window.webContents.id)
      return { id: view.webContents.id, visible: view.getVisible(), url: view.webContents.getURL() }
    })
    expect(hidden).toEqual({ id: viewIdentity.id, visible: false, url: `${origin}/protected` })
    expect(JSON.stringify(results)).not.toContain(cookie)
    expect(JSON.stringify(results)).not.toContain(password)
    const waiting = invoke('stop-long-wait', 'browser_wait_for', { time: 30 })
    await application.evaluate(async () => new Promise(done => setTimeout(done, 100)))
    await application.evaluate(async () => (globalThis as any).embeddedBrowserFixture.service.endRun('task'))
    expect((await waiting).status).toBe('unknown')
    expect(await fs.readdir(scratch)).toEqual([])
  } finally {
    await application.close()
    await new Promise<void>(done => server.close(() => done()))
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 90_000)
