/** One bounded new-creation attempt; default phase is zero, live is explicit.
 * Each phase reuses the verified W7 credential/network startup in a fresh PID. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Script } from 'node:vm'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const invocationStartedAt = Date.now()
const phases = ['zero', 'live', 'cold']
const statuses = ['zero-pass', 'candidate-produced-awaiting-review', 'candidate-preserved-incomplete', 'candidate-cold-ready-for-review', 'blocked']
const codes = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_ASSERTION', 'EACCES', 'ENOENT', 'EEXIST', 'EXPERIMENT_TIMEOUT']
const sha256 = value => createHash('sha256').update(value).digest('hex')
// Only these fixture entrypoints are transpiled. Every product import resolves
// to the existing, complete production build, including its real preload paths.
async function prepareCompiledConsumer(out, stem) {
  const names = ['creationMigration20261031.node', 'experimentOwnerBootstrap20261031.node', 'delegationDirectoryConsumer20261030.node']
  const directory = path.join(out, `${stem}-runtime`)
  await fs.mkdir(directory)
  const outputs = new Map(names.map(name => [name, path.join(directory, `${name}.cjs`)])), imports = new Map(), fixtures = []
  const { transform } = require('esbuild')
  for (const name of names) {
    const sourcePath = path.join(root, 'tests/e2e', `${name}.ts`), source = await fs.readFile(sourcePath, 'utf8')
    const pattern = /^(import[^\r\n]*?\sfrom\s*)(['"])(\.{1,2}\/[^'"]+)\2/gm, replacements = new Map()
    for (const match of source.matchAll(pattern)) {
      const specifier = match[3]
      if (specifier.startsWith('../../src/')) {
        const base = path.join(root, 'dist-electron', specifier.slice('../../src/'.length)), candidates = [`${base}.js`, path.join(base, 'index.js')]
        let resolved
        for (const filename of candidates) if (await fs.stat(filename).then(info => info.isFile()).catch(() => false)) { resolved = filename; break }
        assert(resolved, `compiled-owner-unavailable:${specifier}`)
        replacements.set(specifier, resolved)
        if (!imports.has(resolved)) imports.set(resolved, { path: path.relative(root, resolved), sha256: sha256(await fs.readFile(resolved)) })
      } else {
        const dependency = specifier.startsWith('./') && outputs.get(specifier.slice(2))
        assert(dependency, `unexpected-fixture-import:${specifier}`)
        replacements.set(specifier, dependency)
      }
    }
    const rewritten = source.replace(pattern, (_match, prefix, _quote, specifier) => `${prefix}${JSON.stringify(replacements.get(specifier))}`)
    assert(!/\bfrom\s*['"]\.\.\/\.\.\/src\//.test(rewritten), 'unresolved-source-owner-import')
    const result = await transform(rewritten, { loader: 'ts', format: 'cjs', target: 'node22', sourcefile: sourcePath,
      banner: `var require = require('node:module').createRequire(${JSON.stringify(path.join(root, 'package.json'))});` })
    const destination = outputs.get(name)
    await fs.writeFile(destination, result.code, { flag: 'wx' })
    fixtures.push({ source: path.relative(root, sourcePath), sourceSha256: sha256(source), output: path.basename(destination), outputSha256: sha256(result.code) })
  }
  const critical = []
  for (const relative of ['dist-electron/main/protocols.js', 'dist-electron/main/rendererEntry.js',
    'dist-electron/main/workbench/workbenchToolServices.js', 'dist-electron/main/workbench/delivery/HeadlessDocumentExportWorker.js',
    'dist-electron/preload/documentExport.js', 'dist-renderer/document-export.html']) {
    const bytes = await fs.readFile(path.join(root, relative)); assert(bytes.length > 0, 'empty-compiled-owner')
    critical.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length })
  }
  const manifest = { mode: 'compiled-production-owner-tree', fixtures, imports: [...imports.values()], critical }
  await fs.writeFile(path.join(out, `${stem}-runtime.json`), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  return { consumer: outputs.get(names[0]), bootstrap: outputs.get(names[1]), critical }
}
let lock, lockPath, config, wrapperStage = 'configuration'
try {
  assert(process.argv.length === 3, 'expected-config-file')
  const supplied = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
  config = { root, originalProfile: supplied.originalProfile, out: supplied.out, phase: supplied.phase ?? 'zero',
    budgetMs: supplied.budgetMs ?? 600000, attemptStartedAt: invocationStartedAt,
    ...(supplied.repairHandoff === undefined ? {} : { repairHandoff: supplied.repairHandoff }) }
  assert(phases.includes(config.phase), 'explicit-phase-required')
  for (const name of ['originalProfile', 'out'])
    assert(typeof config[name] === 'string' && path.isAbsolute(config[name]), 'absolute-paths-required')
  if (config.repairHandoff !== undefined) assert(typeof config.repairHandoff === 'string' && path.isAbsolute(config.repairHandoff), 'absolute-handoff-path-required')
  assert(Number.isSafeInteger(config.budgetMs) && config.budgetMs > 0 && config.budgetMs <= 600000, 'invalid-model-run-budget')
  const relative = path.relative(config.originalProfile, config.out)
  assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'output-must-be-outside-owner-profile')
  const electron = require('electron')
  assert(typeof electron === 'string' && path.isAbsolute(electron), 'electron-binary-unavailable')
  await fs.mkdir(config.out, { recursive: true })
  lockPath = path.join(config.out, 'creation-migration-running.lock')
  lock = await fs.open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ pid: process.pid, phase: config.phase }))
  const attempt = randomUUID(), stem = `migration-bootstrap-${config.phase}-${attempt}`
  const summaryPath = path.join(config.out, `${stem}-summary.json`), bootstrapPath = path.join(config.out, `${stem}.cjs`)
  wrapperStage = 'prepare-compiled-consumer'
  const runtime = await prepareCompiledConsumer(config.out, stem)
  const phaseLimit = config.phase === 'live' ? config.budgetMs + 60_000 : 120_000
  const hardDeadline = config.attemptStartedAt + phaseLimit
  const bootstrap = `
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = ${JSON.stringify(config)};
const summaryPath = ${JSON.stringify(summaryPath)}, stem = ${JSON.stringify(stem)};
const codes = ${JSON.stringify(codes)};
app.setAppPath(config.root);
app.setPath('userData', config.originalProfile);
app.setPath('sessionData', config.originalProfile);
app.on('window-all-closed', () => undefined);
const protocols = require(${JSON.stringify(path.join(root, 'dist-electron/main/protocols.js'))});
protocols.registerPrivilegedSchemes();
let stage = 'owner-bootstrap', probe;
const lifecycle = [];
const record = value => { if (lifecycle.length < 200) lifecycle.push({ ...value, at: Date.now() }); };
const safeUrl = raw => { try { const value = new URL(raw); return value.protocol + '//' + value.host + value.pathname; } catch { return 'invalid-url'; } };
app.on('web-contents-created', (_event, contents) => {
  record({ event: 'created', webContentsId: contents.id });
  contents.on('preload-error', (_event, preload, error) => record({ event: 'preload-error', webContentsId: contents.id,
    preload: path.basename(preload), name: error?.name ?? null, code: codes.includes(error?.code) ? error.code : null }));
  contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => record({ event: 'did-fail-load', webContentsId: contents.id, code, url: safeUrl(url), mainFrame }));
  contents.on('did-finish-load', () => record({ event: 'did-finish-load', webContentsId: contents.id, url: safeUrl(contents.getURL()) }));
  contents.on('render-process-gone', (_event, details) => record({ event: 'render-process-gone', webContentsId: contents.id, reason: details.reason }));
});
const writeLifecycle = () => fs.writeFile(path.join(config.out, stem + '-renderer-lifecycle.json'), JSON.stringify({ phase: config.phase, stage, pid: process.pid, lifecycle }, null, 2));
const hardTimer = setTimeout(async () => {
  record({ event: 'phase-deadline', stage });
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy();
  await writeLifecycle().catch(() => {});
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: 'blocked', stage, pid: process.pid,
    errorCode: 'EXPERIMENT_TIMEOUT', observedModelFetchInvocations: config.phase === 'live' && stage === 'consumer' ? null : 0,
    networkOwnerInstalled: probe?.network?.status === 'installed', diagnostic: stem + '-renderer-lifecycle.json' }, null, 2)).catch(() => {});
  app.exit(1);
}, Math.max(1, ${hardDeadline} - Date.now()));
app.whenReady().then(async () => {
  const { prepareExperimentOwnerBootstrap } = require(${JSON.stringify(runtime.bootstrap)});
  const required = config.phase !== 'cold';
  probe = await prepareExperimentOwnerBootstrap({ out: config.out, originalProfile: config.originalProfile,
    credentialProbe: required ? 'required' : 'not-needed' });
  if (probe.network?.status !== 'installed' || probe.network.pid !== process.pid
    || required && (!probe.credentialPresence || !probe.credentialReadableAfterDomainSwitch))
    throw new Error('experiment-owner-unavailable');
  const networkReport = stem + '-network.json';
  await fs.copyFile(path.join(config.out, 'network-preflight.json'), path.join(config.out, networkReport));
  const credentialReport = required ? stem + '-credential.json' : null;
  if (credentialReport) await fs.copyFile(path.join(config.out, 'credential-preflight.json'), path.join(config.out, credentialReport));
  protocols.installEditorProtocol(session.defaultSession);
  protocols.installHtmlPreviewProtocol(session.defaultSession);
  const entry = require(${JSON.stringify(path.join(root, 'dist-electron/main/rendererEntry.js'))}).resolveRendererEntryUrl();
  if (entry !== 'courseware-editor://app/index.html') throw new Error('compiled-renderer-entry-required');
  const rendererOwner = { status: 'installed', mode: 'compiled-production-owner-tree', beforeReadyRegistered: true,
    entry, pid: process.pid, critical: ${JSON.stringify(runtime.critical)} };
  await fs.writeFile(path.join(config.out, 'renderer-owner-preflight.json'), JSON.stringify(rendererOwner, null, 2));
  await fs.writeFile(path.join(config.out, stem + '-renderer-owner.json'), JSON.stringify(rendererOwner, null, 2));
  stage = 'consumer';
  const { executeCreationMigration } = require(${JSON.stringify(runtime.consumer)});
  const result = await executeCreationMigration(config);
  const report = config.phase === 'zero' ? 'zero-preflight.json' : config.phase === 'live' ? 'producer-result.json' : 'cold-result.json';
  const summary = { phase: config.phase, status: result.status, pid: process.pid,
    observedModelFetchInvocations: config.phase === 'live' ? result.modelFetchInvocations : 0,
    currentPhaseModelRequests: config.phase === 'live' ? result.requestRecords : 0,
    modelIdentity: config.phase === 'live' && result.selection?.model === 'gpt-6.1-terra'
      && !result.findings?.some(finding => finding.includes('model identity'))
      && !result.transportCoverage?.identityUnobserved?.length ? 'gpt-6.1-terra' : null,
    experimentKind: config.repairHandoff ? 'review-guided-follow-up' : 'new-creation',
    credentialProbe: required ? 'presence-only-no-network' : 'not-needed',
    credentialPresence: required ? probe.credentialPresence : null,
    credentialReadableAfterDomainSwitch: required ? probe.credentialReadableAfterDomainSwitch : null,
    networkOwnerInstalled: true, networkReport, credentialReport,
    profileRolesUnchanged: config.phase === 'cold' ? null : result.profileRolesUnchanged === true,
    currentBundledGuidesVerified: config.phase === 'zero' ? result.guides?.length === 3 : config.phase === 'live' ? result.observedGuides?.every(guide => guide.delivered.length > 0) : null,
    candidateReviewPending: config.phase !== 'zero',
    candidateCount: config.phase === 'live' ? result.candidateCount : null,
    productionAffinityStable: config.phase === 'live' ? result.affinity?.stableSameConversation : null,
    findings: config.phase === 'live' ? result.findings : [],
    report };
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await writeLifecycle();
  clearTimeout(hardTimer);
  app.exit(result.status === 'candidate-preserved-incomplete' ? 2 : 0);
}).catch(async error => {
  await writeLifecycle().catch(() => {});
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: 'blocked', stage, pid: process.pid,
    errorCode: codes.includes(error?.code) ? error.code : null,
    observedModelFetchInvocations: config.phase !== 'live' || stage === 'owner-bootstrap' ? 0 : null,
    credentialProbe: config.phase === 'cold' ? 'not-needed' : 'presence-only-no-network',
    credentialPresence: config.phase === 'cold' ? null : Boolean(probe?.credentialPresence),
    credentialReadableAfterDomainSwitch: config.phase === 'cold' ? null : Boolean(probe?.credentialReadableAfterDomainSwitch),
    networkOwnerInstalled: probe?.network?.status === 'installed' && probe?.network?.pid === process.pid,
    diagnostic: stage === 'owner-bootstrap' ? 'credential-preflight.json' : 'failure.json' }, null, 2)).catch(() => {});
  clearTimeout(hardTimer);
  app.exit(1);
});
`
  new Script(bootstrap, { filename: bootstrapPath })
  await fs.writeFile(bootstrapPath, bootstrap)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
  wrapperStage = 'electron-phase'
  const child = spawn(electron, [`--user-data-dir=${config.originalProfile}`, bootstrapPath], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
  const stop = () => child.kill()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  let deadlineExceeded = false
  const watchdog = setTimeout(() => { deadlineExceeded = true; child.kill() }, Math.max(1, hardDeadline + 10_000 - Date.now()))
  let exitCode
  try { exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) }) }
  finally { clearTimeout(watchdog); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
  let summary
  try {
    const saved = JSON.parse(await fs.readFile(summaryPath, 'utf8'))
    const booleanOrNull = value => typeof value === 'boolean' ? value : null
    summary = { phase: config.phase, status: statuses.includes(saved.status) ? saved.status : 'unclassified', exitCode,
      observedModelFetchInvocations: Number.isSafeInteger(saved.observedModelFetchInvocations) ? saved.observedModelFetchInvocations : null,
      currentPhaseModelRequests: Number.isSafeInteger(saved.currentPhaseModelRequests) ? saved.currentPhaseModelRequests : null,
      modelIdentity: saved.modelIdentity === 'gpt-6.1-terra' ? saved.modelIdentity : null,
      experimentKind: config.repairHandoff ? 'review-guided-follow-up' : 'new-creation',
      credentialProbe: config.phase === 'cold' ? 'not-needed' : 'presence-only-no-network',
      credentialPresence: booleanOrNull(saved.credentialPresence), credentialReadableAfterDomainSwitch: booleanOrNull(saved.credentialReadableAfterDomainSwitch),
      networkOwnerInstalled: saved.networkOwnerInstalled === true, profileRolesUnchanged: booleanOrNull(saved.profileRolesUnchanged),
      currentBundledGuidesVerified: booleanOrNull(saved.currentBundledGuidesVerified),
      candidateReviewPending: booleanOrNull(saved.candidateReviewPending),
      candidateCount: Number.isSafeInteger(saved.candidateCount) ? saved.candidateCount : null,
      productionAffinityStable: booleanOrNull(saved.productionAffinityStable),
      errorCode: codes.includes(saved.errorCode) ? saved.errorCode : null, report: path.basename(summaryPath),
      stage: ['owner-bootstrap', 'consumer'].includes(saved.stage) ? saved.stage : null }
  } catch { summary = { phase: config.phase, status: 'child-exited-without-safe-summary', exitCode, observedModelFetchInvocations: null } }
  summary.deadlineExceeded = deadlineExceeded
  console.log(JSON.stringify(summary)); process.exitCode = exitCode
} catch (error) {
  if (config?.out && path.isAbsolute(config.out)) await fs.writeFile(path.join(config.out, 'wrapper-failure.json'), JSON.stringify({
    stage: wrapperStage, errorCode: codes.includes(error?.code) ? error.code : null,
    assertion: error?.code === 'ERR_ASSERTION' ? String(error.message).slice(0, 1500) : null, at: Date.now(),
  }, null, 2)).catch(() => {});
  console.log(JSON.stringify({ phase: phases.includes(config?.phase) ? config.phase : null,
    status: 'wrapper-configuration-or-launch-failed', stage: wrapperStage, observedModelFetchInvocations: null }))
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }) }
}
