import assert from 'node:assert/strict'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'

// Usage from repository root: node scripts/run-delegation-directory-consumer-20261030.mjs zero|live [unique-attempt-name]
const root = process.cwd(), mode = process.argv[2]
assert(['zero', 'live'].includes(mode), 'Choose zero or live explicitly')
const name = process.argv[3] ?? `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`
assert(/^[a-zA-Z0-9_-]+$/.test(name), 'Attempt name must be a plain unique name')
const out = path.join(root, 'output/ai-productivity-execution-20261030/delegation', name)
await fs.mkdir(out, { recursive: false }) // Existing attempts are never overwritten or replayed.
const config = { root, out, mode,
  sources: ['C:\\Users\\74755\\Desktop\\英语素材2\\Unit 1 Section A 2a-2e.md', 'C:\\Users\\74755\\Desktop\\英语素材2\\unit1'],
  seed: path.join(root, 'output/architecture-round3-research-20261027/parallel-warm/seed/three-units.glx'),
  originalProfile: path.join(process.env.APPDATA, 'ittoedu-courseware-editor-v8-rebuild') }
const helper = path.join(out, 'consumer-node.cjs')
await fs.access(path.join(root, 'dist-electron/main/workbench/DocumentHostService.js'))
await build({ entryPoints: [path.join(root, 'tests/e2e/delegationDirectoryConsumer20261030.node.ts')], outfile: helper,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'formal-main-modules', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/src\// }, input => {
      const base = path.join(root, 'dist-electron', input.path.slice('../../src/'.length)).replace(/\.js$/, '')
      const filename = existsSync(base + '.js') ? base + '.js' : path.join(base, 'index.js')
      assert(existsSync(filename), `Build the formal module before starting Electron: ${input.path}`)
      return { path: input.kind === 'dynamic-import' ? pathToFileURL(filename).href : filename, external: true }
    })
  } }] })
await fs.writeFile(path.join(out, 'launch-config.json'), JSON.stringify({ ...config,
  parentProvider: 'scripted-fixture', childProvider: mode === 'live' ? 'gpt-6.1-terra' : 'scripted-fixture',
  childPermissionNarrowedInTestOnly: true, credentialCopy: false, saveProfile: false,
  credentialBootstrap: mode === 'live' ? 'original-process-context-zero-network-probe-then-isolated-domain' : 'isolated-no-real-model',
  credentialBootstrapGate: mode === 'live' ? 'Original startup switch and sessionData checked; formal store decrypt before and after isolated userData/sessionData switch required before install' : null,
  stopConditions: { treeRequestRecords: 20, childRequestRecords: 6, childWallMs: 180000, wholeWallMs: 480000 },
  inferenceLimits: ['Does not measure natural subagent adoption', 'Does not measure parallel speed', 'Does not establish full-permission filesystem isolation'] }, null, 2))

async function instance(kind) {
  const userData = path.join(out, `${kind}-profile`), entry = path.join(out, `${kind}-main.cjs`)
  await fs.mkdir(userData)
  const sessionData = path.join(out, `${kind}-session-data`); await fs.mkdir(sessionData)
  const ownerBootstrap = mode === 'live' && kind === 'producer'
  const startupProfile = ownerBootstrap ? config.originalProfile : userData
  const credentialOut = path.join(out, `${kind}-credential-bootstrap`)
  if (ownerBootstrap) await fs.mkdir(credentialOut)
  const prepareContext = ownerBootstrap
    ? `directoryMain.probeDirectoryConsumerCredentials(${JSON.stringify({ out: credentialOut, originalProfile: config.originalProfile, domainProfile: userData, domainSessionData: sessionData, requireOriginalStartupContext: true })}).then(facts=>{if(facts.status!=='decryption-readable-token-validity-unprobed'||!facts.credentialReadableAfterDomainSwitch)throw Error('Credential context preflight failed');return directoryMain.installDirectoryConsumer(${JSON.stringify(config)})})`
    : `directoryMain.installDirectoryConsumer(${JSON.stringify(config)})`
  await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(startupProfile)});${ownerBootstrap ? '' : `app.setPath('sessionData',${JSON.stringify(sessionData)});`}require(${JSON.stringify(path.join(root, 'dist-electron/main/protocols.js'))}).registerPrivilegedSchemes();const directoryMain=require(${JSON.stringify(helper)});${prepareContext}.catch(error=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(out, kind + '-bootstrap-error.json'))},JSON.stringify({name:typeof error?.name==='string'?error.name:'Error',phase:'bootstrap'}));app.exit(1)});`)
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: process.env.AUDIT_ELECTRON_EXECUTABLE ?? path.join(root, 'node_modules/electron/dist/electron.exe'),
    cwd: root, args: [`--user-data-dir=${startupProfile}`, entry], env, timeout: 30_000 })
  try {
    const began = Date.now()
    while (!(await app.evaluate(() => typeof globalThis.__directoryConsumer === 'function'))) {
      assert(Date.now() - began < 30000, 'Consumer bootstrap timeout')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return await app.evaluate((_electron, method) => globalThis.__directoryConsumer(method), kind === 'cold' ? 'cold' : 'run')
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
}
try {
  const producer = await instance('producer')
  assert.equal(producer.status, 'passed-producer-awaiting-independent-cold-open')
  const result = await instance('cold')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await fs.writeFile(path.join(out, 'launcher-error.json'), JSON.stringify({ error: String(error), stack: error.stack, at: new Date().toISOString() }, null, 2))
  console.error(String(error)); process.exitCode = 1
}
