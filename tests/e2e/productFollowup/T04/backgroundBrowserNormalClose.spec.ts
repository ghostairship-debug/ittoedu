import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { connectExplicitMcp, readExplicitMcpConnection } from '../../../../scripts/mcpSdkClient'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')

test('a real headless MCP browser promoted to GUI exits its whole owner through ordinary window close without opening the browser viewport', async ({}, info) => {
  test.setTimeout(90_000)
  const output = join(root, 'output/productFollowup/T04'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'background-close-')), workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const checkpoints = join(directory, 'checkpoint.jsonl')
  const log = (phase: string, facts: unknown = {}) => appendFileSync(checkpoints, JSON.stringify({ time: new Date().toISOString(), phase, facts }) + '\n')
  const facts: Record<string, unknown> = { directory, closeMethod: 'BrowserWindow.close()', browserViewportOpenedByTest: false, forcedCleanupUsedForSuccess: false }
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done))
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No available local MCP port')
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()))
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' }
  let app: ElectronApplication | undefined, secondary: ChildProcess | undefined, client: Awaited<ReturnType<typeof connectExplicitMcp>> | undefined
  try {
    log('headless.launch.before')
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`, '--headless-mcp', `--workspace=${workspace}`, `--port=${port}`, '--permission=workspace'], env })
    const ownedProcess = app.process(); log('headless.launch.returned', { pid: ownedProcess.pid })
    await expect.poll(() => app!.evaluate(async ({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { externalMcpService } = requireProduct('./dist-electron/main/workbench/external/externalDesktopService.js')
      return (await (await externalMcpService()).status()).state
    }), { timeout: 20_000, message: 'Wait for the actual headless host startup before connecting its SDK' }).toBe('running')
    const connection = await app.evaluate(async ({ app, BrowserWindow }) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { externalMcpService } = requireProduct('./dist-electron/main/workbench/external/externalDesktopService.js')
      const service = await externalMcpService()
      const status = await service.status()
      if (status.state !== 'running') throw new Error(`Actual headless MCP was not listening: ${status.message}`)
      return { ...await service.connectionInfo(), token: await service.revealToken(), pid: process.pid, browserWindows: BrowserWindow.getAllWindows().length }
    })
    expect(connection.browserWindows).toBe(0)
    client = await connectExplicitMcp(readExplicitMcpConnection(connection), 'T04-background-close')
    const discovered = await client.call('mcp.discover', {})
    expect(discovered.isError, JSON.stringify(discovered)).toBe(false)
    facts.discovery = discovered.structuredContent
    const background = await app.evaluate(({ BrowserWindow, BaseWindow }) => ({ pid: process.pid,
      browserWindows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, url: window.webContents.getURL() })),
      nativeWindows: BaseWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible() })) }))
    facts.background = background; log('headless.actual-backend.ready', background)
    expect(background.browserWindows).toEqual([])
    expect(background.nativeWindows.length).toBeGreaterThan(0)
    expect(background.nativeWindows.every(window => window.visible === false)).toBe(true)
    // A real second executable launch exercises the product's same-profile GUI promotion.
    secondary = spawn(ownedProcess.spawnfile, ['.', `--user-data-dir=${profile}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    log('gui.second-instance.spawned', { pid: secondary.pid })
    await expect.poll(() => secondary!.exitCode, { timeout: 20_000, message: 'Second GUI launch must hand off to the existing owner' }).toBe(0)
    await expect.poll(() => app!.windows().some(page => page.url().startsWith('courseware-editor://')), { timeout: 20_000 }).toBe(true)
    const page = app.windows().find(page => page.url().startsWith('courseware-editor://'))!
    await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
    const promoted = await app.evaluate(({ BrowserWindow, BaseWindow, dialog }, checkpointPath) => {
      const fs = process.getBuiltinModule('node:fs')
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { buttons: string[]; message?: string }
        const response = options.buttons.indexOf('退出')
        fs.appendFileSync(checkpointPath, JSON.stringify({ phase: 'normal-close.native-prompt', facts: { buttons: options.buttons, message: options.message, response } }) + '\n')
        if (response < 0) throw new Error(`Unexpected normal-close prompt: ${options.buttons.join(',')}`)
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      return { pid: process.pid, browserWindows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, url: window.webContents.getURL() })),
        nativeWindows: BaseWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible() })) }
    }, checkpoints)
    facts.promoted = promoted
    expect(promoted.pid).toBe(background.pid)
    expect(promoted.browserWindows.filter(window => window.url.startsWith('courseware-editor://'))).toHaveLength(1)
    expect(promoted.nativeWindows.some(window => background.nativeWindows.some(original => original.id === window.id))).toBe(true)
    log('ordinary-window-close.before')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('courseware-editor://'))
      if (!window) throw new Error('Actual promoted GUI window was missing')
      setTimeout(() => window.close(), 0)
    })
    // Keep the MCP session connected until AFTER this assertion: detaching it early would remove the background browser and hide the defect.
    await expect.poll(() => ownedProcess.exitCode !== null || ownedProcess.signalCode !== null,
      { timeout: 20_000, message: 'Ordinary GUI close must stop the background native browser owner and exit the actual process' }).toBe(true)
    expect(ownedProcess.exitCode).toBe(0)
    expect(ownedProcess.signalCode).toBeNull()
    facts.naturalExit = { pid: ownedProcess.pid, exitCode: ownedProcess.exitCode, signalCode: ownedProcess.signalCode }
    log('ordinary-window-close.natural-exit', facts.naturalExit)
  } catch (error) { facts.failure = error instanceof Error ? error.stack : String(error); log('failure.before-cleanup', { error: String(error) }); throw error }
  finally {
    await client?.detach().catch(error => log('client.detach.after-proof', { error: String(error) }))
    writeFileSync(join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await info.attach('Headless browser promotion and ordinary process exit', { path: join(directory, 'facts.json'), contentType: 'application/json' })
    // Failure cleanup only. It happens after the measured natural-exit assertion and cannot make that assertion pass.
    for (const child of [secondary, app?.process()]) if (child?.pid && child.exitCode === null && child.signalCode === null && child.spawnargs.includes(`--user-data-dir=${profile}`)) {
      log('failure-cleanup.owned-tree', { pid: child.pid })
      try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true }); else child.kill() }
      catch (error) { log('failure-cleanup.error', { error: String(error) }) }
    }
    await app?.close().catch(() => undefined)
  }
})
