import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { _electron as electron } from '@playwright/test'

// prepare <existing-450-baseline.glx> <new-attempt-name> : all gates, no model.
// run <absolute-attempt-directory> : one real turn on each route, no retry.
// Optional prepare arg 5: a successful original-context credential-preflight.json, already reviewed by the caller.
const root = process.cwd(), command = process.argv[2]
assert(['prepare', 'run'].includes(command), 'Choose prepare or run explicitly')
const digest = value => createHash('sha256').update(value).digest('hex')
const fileHash = async filename => digest(await fs.readFile(filename))
const write = (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2))
const primaryFiles = ['dist-electron/main/workbench/execution/ExecutionEngine.js', 'dist-electron/core/tools/DocumentToolGateway.js',
  'dist-electron/core/tools/HostToolServices.js', 'dist-electron/main/workbench/external/acp/AcpAgentSession.js',
  'scripts/experiments/prepare-acp-domain.mjs', 'scripts/experiments/acp-domain-controller.mjs', 'tests/e2e/e2ShortEdit20261030.node.ts',
  'tests/e2e/delegationDirectoryConsumer20261030.node.ts', 'scripts/experiments/run-e2-short-edit-20261030.mjs']
const codeHashes = async () => Object.fromEntries(await Promise.all(primaryFiles.map(async name => [name, await fileHash(path.join(root, name))])))
let out, manifest
if (command === 'prepare') {
  const source = path.resolve(process.argv[3] ?? ''), name = process.argv[4]
  assert(name && /^[a-zA-Z0-9_-]+$/.test(name), 'Provide a unique plain attempt name')
  assert.equal(path.extname(source).toLowerCase(), '.glx')
  const parent = path.join(root, 'output/ai-productivity-execution-20261030/e2-short-edit')
  await fs.mkdir(parent, { recursive: true }); out = path.join(parent, name); await fs.mkdir(out)
  const initialHash = await fileHash(source), frozen = path.join(out, 'frozen-input.glx')
  await fs.copyFile(source, frozen, fs.constants.COPYFILE_EXCL)
  manifest = { version: 1, createdAt: new Date().toISOString(), source, initialHash, frozen, root, out,
    originalProfile: path.join(process.env.APPDATA, 'ittoedu-courseware-editor-v8-rebuild'), nodePath: process.execPath,
    routeOrder: Number.parseInt(initialHash.slice(0, 2), 16) % 2 ? ['engine', 'acp'] : ['acp', 'engine'],
    codeHashes: await codeHashes(), status: 'preparing-zero-model', maxTurnMs: 240000,
    comparison: 'Composite product routes; same model label/effort/input/task/domain allowlist, not a pure Harness or channel experiment.' }
  if (process.argv[5]) {
    const proofFile = path.resolve(process.argv[5]), proof = JSON.parse(await fs.readFile(proofFile, 'utf8'))
    assert.equal(proof.status, 'decryption-readable-token-validity-unprobed')
    assert.equal(proof.credentialReadableAfterDomainSwitch, true)
    assert.equal(proof.credentialOwnerProfile, manifest.originalProfile)
    assert.equal(proof.originalStartupContextRequired, true)
    assert.equal(proof.startupUserDataMatched, true)
    assert.equal(path.resolve(proof.sessionDataAtProbe), path.resolve(manifest.originalProfile))
    assert(proof.domainSessionData && path.resolve(proof.domainSessionData) !== path.resolve(manifest.originalProfile))
    assert.equal(proof.modelProviderEntries, 0); assert.equal(proof.actualNetworkRequests, 0)
    manifest.credentialBootstrapProof = { file: proofFile, sha256: await fileHash(proofFile), mode: 'original-crypto-context-isolated-domain' }
  }
  for (const route of ['engine', 'acp']) { const workspace = path.join(out, route, 'workspace'); await fs.mkdir(workspace, { recursive: true }); await fs.copyFile(frozen, path.join(workspace, 'market.glx'), fs.constants.COPYFILE_EXCL) }
  await write(path.join(out, 'manifest.json'), manifest)
} else {
  out = path.resolve(process.argv[3] ?? '')
  manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'))
  assert.equal(manifest.root, root); assert.equal(manifest.status, 'ready-no-model')
  assert.deepEqual(await codeHashes(), manifest.codeHashes, 'Product or experiment code changed after preflight')
  assert.equal(await fileHash(manifest.frozen), manifest.initialHash)
  assert.equal(await fileHash(manifest.source), manifest.initialHash, 'Original changed; do not silently change frozen task')
}

const helper = path.join(out, 'e2-node.cjs')
if (command === 'prepare') await build({ entryPoints: [path.join(root, 'tests/e2e/e2ShortEdit20261030.node.ts')], outfile: helper,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'formal-main-modules', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/src\// }, async input => {
      const stem = path.join(root, 'dist-electron', input.path.slice('../../src/'.length)).replace(/\.js$/, '')
      const filename = await fs.access(stem + '.js').then(() => stem + '.js', async () => { await fs.access(path.join(stem, 'index.js')); return path.join(stem, 'index.js') })
      return { path: input.kind === 'dynamic-import' ? pathToFileURL(filename).href : filename, external: true }
    })
  } }] })
async function launch(route, phase) {
  const evidence = path.join(out, route, phase === 'zero' ? 'zero' : 'live')
  if (phase !== 'cold') await fs.mkdir(evidence)
  const profile = path.join(evidence, phase === 'cold' ? 'cold-profile' : 'profile'); await fs.mkdir(profile)
  const sessionData = path.join(evidence, `${phase}-session-data`); await fs.mkdir(sessionData)
  const config = { root, route, phase, out: evidence, file: path.join(out, route, 'workspace/market.glx'),
    originalProfile: manifest.originalProfile, nodePath: manifest.nodePath, initialHash: manifest.initialHash,
    ...(phase !== 'zero' ? { expectedSchemas: manifest.schemas } : {}) }
  const entry = path.join(evidence, `${phase}-main.cjs`)
  const ownerBootstrap = route === 'engine' && phase !== 'cold' && manifest.credentialBootstrapProof
  const startupProfile = ownerBootstrap ? manifest.originalProfile : profile
  const credentialBootstrapOut = path.join(evidence, 'credential-owner-bootstrap')
  if (ownerBootstrap) await fs.mkdir(credentialBootstrapOut)
  const prepareContext = ownerBootstrap
    ? `e2Main.probeDirectoryConsumerCredentials(${JSON.stringify({ out: credentialBootstrapOut, originalProfile: manifest.originalProfile, domainProfile: profile, domainSessionData: sessionData, requireOriginalStartupContext: true })}).then(facts=>{if(facts.status!=='decryption-readable-token-validity-unprobed'||!facts.credentialReadableAfterDomainSwitch)throw Error('Credential context preflight failed');return e2Main.installE2ShortEdit(${JSON.stringify(config)})})`
    : `e2Main.installE2ShortEdit(${JSON.stringify(config)})`
  await fs.writeFile(entry, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(startupProfile)});${ownerBootstrap ? '' : `app.setPath('sessionData',${JSON.stringify(sessionData)});`}require(${JSON.stringify(path.join(root, 'dist-electron/main/protocols.js'))}).registerPrivilegedSchemes();const e2Main=require(${JSON.stringify(helper)});${prepareContext}.catch(error=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(evidence, 'bootstrap-error.json'))},JSON.stringify({name:typeof error?.name==='string'?error.name:'Error',phase:'bootstrap'}));app.exit(1)});`)
  const env = { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', COURSEWARE_E2E_BACKGROUND: '0' }; delete env.ELECTRON_RUN_AS_NODE
  const instance = await electron.launch({ cwd: root, executablePath: process.env.AUDIT_ELECTRON_EXECUTABLE ?? path.join(root, 'node_modules/electron/dist/electron.exe'), args: [`--user-data-dir=${startupProfile}`, entry], env, timeout: 30000 })
  try {
    const until = Date.now() + 30000
    while (!(await instance.evaluate(() => typeof globalThis.__e2ShortEdit === 'function'))) {
      assert(Date.now() < until, 'Bootstrap timeout'); await new Promise(resolve => setTimeout(resolve, 100))
    }
    return await instance.evaluate(() => globalThis.__e2ShortEdit())
  } finally { await instance.evaluate(({ app }) => app.exit(0)).catch(() => {}); await instance.close().catch(() => {}) }
}

try {
  if (command === 'prepare') {
    const preflights = {}
    for (const route of ['engine', 'acp']) {
      try { preflights[route] = await launch(route, 'zero') }
      catch (error) { preflights[route] = { status: 'blocked-no-model', route, error: String(error), modelCalls: 0 } }
    }
    await write(path.join(out, 'zero-model-results.json'), preflights)
    const { engine, acp } = preflights
    if (engine.status !== 'ready-no-model' || acp.status !== 'ready-no-model') {
      manifest.status = 'blocked-no-model'; await write(path.join(out, 'manifest.json'), manifest)
      throw Error('At least one zero-model route is blocked; no unpaired paid turn will start')
    }
    assert.equal(engine.status, 'ready-no-model'); assert.equal(acp.status, 'ready-no-model')
    assert.equal(engine.initialHash, acp.initialHash); assert.equal(engine.promptSha256, acp.promptSha256)
    assert.deepEqual(engine.allowedTools, acp.allowedTools)
    assert.deepEqual(engine.schemas, acp.schemas, 'Domain input schemas differ; no live pair until the concrete mismatch is understood')
    assert.deepEqual(engine.target, acp.target)
    manifest.status = 'ready-no-model'; manifest.schemas = engine.schemas; manifest.allowedTools = engine.allowedTools; manifest.promptSha256 = engine.promptSha256
    await write(path.join(out, 'manifest.json'), manifest)
    console.log(JSON.stringify({ status: manifest.status, out, modelCalls: 0, order: manifest.routeOrder, target: engine.target }, null, 2))
  } else {
    const results = []
    for (const route of manifest.routeOrder) {
      assert.deepEqual(await codeHashes(), manifest.codeHashes, 'Code changed between routes')
      const file = path.join(out, route, 'workspace/market.glx'); assert.equal(await fileHash(file), manifest.initialHash)
      await fs.writeFile(path.join(out, route, 'live-attempted.json'), JSON.stringify({ at: new Date().toISOString(), automaticRetry: false }), { flag: 'wx' })
      try { const produced = await launch(route, 'live'); assert.equal(produced.status, 'producer-verified-awaiting-cold'); results.push(await launch(route, 'cold')) }
      catch (error) { const failure = { route, status: 'not-qualified', error: String(error), noReplay: true }; await write(path.join(out, route, 'route-failure.json'), failure); results.push(failure) }
    }
    assert.equal(await fileHash(manifest.source), manifest.initialHash)
    const pair = { completedAt: new Date().toISOString(), results, initialHash: manifest.initialHash,
      independentRuns: 1, causalHarnessClaim: false, routeWinnerClaim: false,
      note: 'One pair can reveal a missing capability or gross latency cost; it cannot establish stable route superiority. Native request counts or actual model may be unavailable and remain unknown.' }
    await write(path.join(out, 'paired-result.json'), pair); console.log(JSON.stringify(pair, null, 2))
  }
} catch (error) {
  await write(path.join(out, `${command}-failure.json`), { error: String(error), stack: error.stack, at: new Date().toISOString() })
  console.error(String(error)); process.exitCode = 1
}
