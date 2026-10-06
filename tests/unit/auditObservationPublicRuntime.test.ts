// @vitest-environment node
import { mkdir, mkdtemp, writeFile, symlink, realpath, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createServer, loadConfigFromFile } from 'vite'
import { _electron as electron } from 'playwright'
import { expect, it } from 'vitest'

it('public view.observe captures the non-first page, another page, and a committed content update', async () => {
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
  const require = createRequire(resolve('package.json'))
  await build({ entryPoints: ['tests/fixtures/observation/auditObservationMain.ts'], bundle: true, platform: 'node', target: 'node22',
    format: 'cjs', outfile: entry, packages: 'external', loader: { '.css': 'empty' },
    plugins: [{ name: 'native-fixture-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path.startsWith('node:') || args.path === 'electron' ? args.path : require.resolve(args.path), external: true }))
    } }] })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ cwd: process.cwd(), args: [entry], timeout: 10_000, env: { ...env,
      NODE_PATH: resolve('node_modules'), OBSERVATION_AUDIT_ROOT: directory, OBSERVATION_AUDIT_URL: `http://127.0.0.1:${address.port}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
    await app.firstWindow()
    const result: any = await app.evaluate(() => (globalThis as any).runObservationAudit())
    // These identity/lifecycle assertions complement direct visual inspection of
    // the three retained PNGs; metadata alone cannot prove their displayed content.
    expect(result.observations.map((value: any) => [value.name, value.identity.revision, value.diagnostics, value.windowCount])).toEqual([
      ['01-second-blue', 0, [], 1], ['02-first-red', 0, [], 1], ['03-second-green-updated', 1, [], 1],
    ])
    for (const value of result.observations) { expect(value.coverage.width).toBeGreaterThan(0); expect(value.coverage.width / value.coverage.height).toBeCloseTo(800 / 450) }
    expect(result.commit.status).toBe('applied')
    expect(result.windowCount).toBe(1)
    await writeFile(join(directory, 'run.json'), JSON.stringify({ passed: true, source: 'real Electron Main/Chromium, public DocumentToolGateway view.observe', evidence: directory, modelCalls: 0 }, null, 2))
  } finally { await app?.close(); await server.close() }
}, 60_000)
