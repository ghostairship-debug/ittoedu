// @vitest-environment node
import { mkdir, mkdtemp, readFile, writeFile, symlink, realpath, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { createServer, loadConfigFromFile } from 'vite'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('captures formal roots and uses real Published input with mixed-root navigation and revision checks', async () => {
  const directory = process.env.OBSERVATION_AUDIT_ROOT ?? await mkdtemp(join(tmpdir(), 'guoling-observation-audit-'))
  await mkdir(directory, { recursive: true })
  if (!await lstat(join(directory, 'node_modules')).catch(() => null)) await symlink(await realpath(resolve('node_modules')), join(directory, 'node_modules'), 'junction')
  const config = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve('vite.renderer.config.ts'))
  if (!config) throw new Error('Renderer configuration missing')
  const server = await createServer({ ...config.config, configFile: false,
    plugins: config.config.plugins?.filter(plugin => (plugin as any)?.name !== 'html-preview-agent'), cacheDir: join(directory, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, entries: ['observation.html'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('No fixture address')
  const entry = join(directory, 'main.cjs')
  const startupLog = join(directory, 'electron-startup.log')
  // The fixture's node_modules junction lets Node resolve the original package
  // specifiers, including conditional ESM exports. A Windows require.resolve
  // path is not a valid import() URL and must not replace a dynamic import.
  await build({ entryPoints: ['tests/fixtures/observation/auditObservationMain.ts'], bundle: true, platform: 'node', target: 'node22',
    format: 'cjs', outfile: entry, packages: 'external', loader: { '.css': 'empty' },
    // Runs before bundled dependencies, so launch failures retain the original
    // exception/exit behavior while leaving evidence even before app is returned.
    banner: { js: `{
      const auditLog = ${JSON.stringify(startupLog)};
      globalThis.__guolingAuditStartup = message => {
        try { require('node:fs').appendFileSync(auditLog, new Date().toISOString() + ' ' + message + '\\n') } catch {}
      };
      process.on('uncaughtExceptionMonitor', (error, origin) => globalThis.__guolingAuditStartup(origin + ': ' + (error.stack || error)));
      process.on('exit', code => globalThis.__guolingAuditStartup('exit: ' + code));
      globalThis.__guolingAuditStartup('entry');
    }` } })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 30_000, env: { ...env,
      NODE_PATH: resolve('node_modules'), OBSERVATION_AUDIT_ROOT: directory, OBSERVATION_AUDIT_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    await app.firstWindow()
    const result: any = await app.evaluate(() => (globalThis as any).runObservationAudit())
    // These identity/lifecycle assertions complement direct visual inspection of
    // the retained PNGs; metadata alone cannot prove their displayed content.
    expect(result.observations.map((value: any) => [value.name, value.identity.revision, value.diagnostics, value.windowCount])).toEqual([
      ['01-second-blue', 0, [], 1], ['02-first-red', 0, [], 1], ['03-second-green-updated', 1, [], 1], ['04-program-root', 1, [], 1],
    ])
    for (const value of result.observations) { expect(value.coverage.width).toBeGreaterThan(0); expect(value.coverage.width / value.coverage.height).toBeCloseTo(800 / 450) }
    expect(result.commit.status).toBe('applied')
    const output = result.programOutput
    expect(output.cssRect).toEqual({ x: 0, y: 0, width: 640, height: 360 })
    expect(output.devicePixelRatio).toBeGreaterThan(0)
    expect(output.pngSize).toEqual({ width: Math.round(640 * output.devicePixelRatio), height: Math.round(360 * output.devicePixelRatio) })
    expect(output.resultSize).toEqual(output.pngSize)
    const interactive = result.interactive, steps = interactive.observations
    expect(interactive.authorUnchangedByActions).toBe(true)
    expect(interactive.labels).toEqual(['继续实验（0）', '继续实验（1）', '继续实验（1）', '继续实验（0）'])
    // The fixed program/slide root retains its requested logical dimensions.
    // Read the actual native-window viewport separately: Windows may quantize
    // a DIP window extent to a fractional CSS pixel on a scaled display.
    expect(steps.map((value: any) => [value.name, value.identity.locationId, value.hostGeometry.rootRect.width, value.hostGeometry.rootRect.height, value.windowCount])).toEqual([
      ['06-program-interactive', 'program-root', 1280, 720, 2], ['07-program-after-click', 'program-root', 1280, 720, 2],
      ['08-program-reread', 'program-root', 1280, 720, 2], ['09-mixed-slide', 'second', 800, 450, 2],
      ['10-mixed-program', 'program-root', 1280, 720, 2], ['11-program-revised-source', 'program-root', 1280, 720, 2],
    ])
    for (const step of steps) {
      const actual = step.hostGeometry
      expect([actual.rootRect.x, actual.rootRect.y, actual.visualViewport.scale, actual.zoomFactor]).toEqual([0, 0, 1, 1])
      expect([step.coverage.viewport.width, step.coverage.viewport.height]).toEqual([actual.innerSize.width, actual.innerSize.height])
      for (const dimension of ['width', 'height']) {
        expect(Math.abs(actual.innerSize[dimension] - actual.rootRect[dimension])).toBeLessThanOrEqual(1)
        expect(Math.abs(actual.visualViewport[dimension] - actual.rootRect[dimension])).toBeLessThanOrEqual(1)
      }
      expect([step.coverage.width, step.coverage.height]).toEqual([actual.pngSize.width, actual.pngSize.height])
      expect(actual.pngSize).toEqual({ width: Math.round(actual.visualViewport.width * actual.devicePixelRatio),
        height: Math.round(actual.visualViewport.height * actual.devicePixelRatio) })
    }
    expect(steps[0].identity.viewGeneration).toEqual(expect.any(String))
    for (const step of steps.slice(0, 5)) {
      expect(step.identity.viewGeneration).toBe(steps[0].identity.viewGeneration)
      expect(step.identity.revision).toBe(steps[0].identity.revision)
    }
    expect(steps[1].actionReceipt).toMatchObject({ dispatch: 'dispatched', application: 'applied', observation: 'complete' })
    expect(interactive.staleAction).toMatchObject({ kind: 'error', code: 'observation-stale' })
    expect(steps[5].identity.revision).toBe(steps[0].identity.revision + 1)
    expect(steps[5].identity.viewGeneration).not.toBe(steps[0].identity.viewGeneration)
    expect(interactive.windowCountAfterStop).toBe(1)
    expect(result.windowCount).toBe(1)
    await writeFile(join(directory, 'run.json'), JSON.stringify({ passed: true, source: 'real Electron Main/Chromium, public DocumentToolGateway view.observe', evidence: directory, modelCalls: 0 }, null, 2))
  } catch (cause) {
    const startup = await readFile(startupLog, 'utf8').catch(() => 'No Electron startup log was written')
    const message = `${cause instanceof Error ? cause.message : String(cause)}\nElectron startup:\n${startup}`
    await writeFile(join(directory, 'failure.txt'), message).catch(() => {})
    throw new Error(message, { cause })
  } finally { await app?.close(); await server.close() }
}, 120_000)
