/** Node <this-file> <absolute-config.json>. Each explicit phase gets a fresh
 * Electron PID. Startup follows the verified W7 credential/network owner. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const phases = ['zero', 'live', 'cold']
const statuses = ['zero-pass', 'producer-verified-awaiting-cold', 'qualified', 'blocked']
const codes = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_ASSERTION', 'EACCES', 'ENOENT', 'EEXIST']
let lock, lockPath, config
try {
  assert(process.argv.length === 3, 'expected-config-file')
  const supplied = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
  config = { root, originalProfile: supplied.originalProfile, out: supplied.out, sourceFile: supplied.sourceFile,
    handoffEvidence: supplied.handoffEvidence, phase: supplied.phase, budgetMs: supplied.budgetMs ?? 300000 }
  assert(phases.includes(config.phase), 'explicit-phase-required')
  for (const name of ['originalProfile', 'out', 'sourceFile', 'handoffEvidence'])
    assert(typeof config[name] === 'string' && path.isAbsolute(config[name]), 'absolute-paths-required')
  assert(Number.isSafeInteger(config.budgetMs) && config.budgetMs > 0 && config.budgetMs <= 600000, 'invalid-model-run-budget')
  const relative = path.relative(config.originalProfile, config.out)
  assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'output-must-be-outside-owner-profile')
  const electron = require('electron'), registration = require.resolve('tsx/cjs')
  assert(typeof electron === 'string' && path.isAbsolute(electron), 'electron-binary-unavailable')
  await fs.mkdir(config.out, { recursive: true })
  lockPath = path.join(config.out, 'w3-shared-consumer-running.lock')
  lock = await fs.open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ pid: process.pid, phase: config.phase }))
  const attempt = randomUUID(), stem = `w3-bootstrap-${config.phase}-${attempt}`
  const summaryPath = path.join(config.out, `${stem}-summary.json`), bootstrapPath = path.join(config.out, `${stem}.cjs`)
  const bootstrap = `
require(${JSON.stringify(registration)});
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = ${JSON.stringify(config)};
const summaryPath = ${JSON.stringify(summaryPath)}, stem = ${JSON.stringify(stem)};
const codes = ${JSON.stringify(codes)};
app.setAppPath(config.root);
app.setPath('userData', config.originalProfile);
app.setPath('sessionData', config.originalProfile);
app.on('window-all-closed', () => undefined);
let stage = 'owner-bootstrap', probe;
app.whenReady().then(async () => {
  const { prepareExperimentOwnerBootstrap } = require(${JSON.stringify(path.join(root, 'tests/e2e/experimentOwnerBootstrap20261031.node.ts'))});
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
  stage = 'consumer';
  const { executeW3EditableSharedConsumer } = require(${JSON.stringify(path.join(root, 'tests/e2e/w3EditableSharedConsumer20261031.node.ts'))});
  const result = await executeW3EditableSharedConsumer(config);
  const report = config.phase === 'zero' ? 'zero-preflight.json' : config.phase === 'live' ? 'producer-result.json' : 'result.json';
  const summary = { phase: config.phase, status: result.status, pid: process.pid,
    observedModelFetchInvocations: config.phase === 'live' ? result.modelFetchInvocations : 0,
    currentPhaseModelRequests: config.phase === 'live' ? result.requestRecords : 0,
    modelIdentity: config.phase === 'live' && result.actualModelConfirmed ? 'gpt-6.1-terra' : null,
    credentialProbe: required ? 'presence-only-no-network' : 'not-needed',
    credentialPresence: required ? probe.credentialPresence : null,
    credentialReadableAfterDomainSwitch: required ? probe.credentialReadableAfterDomainSwitch : null,
    networkOwnerInstalled: true, networkReport, credentialReport,
    profileRolesUnchanged: config.phase === 'cold' ? null : result.profileRolesUnchanged === true,
    currentBundledGuideVerified: config.phase === 'zero' ? result.guide?.markersVerified === true : Boolean(result.consumedGuide?.deliveries?.length),
    offlineSharedResult: config.phase === 'cold' ? result.offline?.sharedResult : null,
    report };
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  app.exit(0);
}).catch(async error => {
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: 'blocked', stage, pid: process.pid,
    errorCode: codes.includes(error?.code) ? error.code : null,
    observedModelFetchInvocations: config.phase !== 'live' || stage === 'owner-bootstrap' ? 0 : null,
    credentialProbe: config.phase === 'cold' ? 'not-needed' : 'presence-only-no-network',
    credentialPresence: config.phase === 'cold' ? null : Boolean(probe?.credentialPresence),
    credentialReadableAfterDomainSwitch: config.phase === 'cold' ? null : Boolean(probe?.credentialReadableAfterDomainSwitch),
    networkOwnerInstalled: probe?.network?.status === 'installed' && probe?.network?.pid === process.pid,
    diagnostic: stage === 'owner-bootstrap' ? 'credential-preflight.json' : 'failure.json' }, null, 2)).catch(() => {});
  app.exit(1);
});
`
  await fs.writeFile(bootstrapPath, bootstrap)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [`--user-data-dir=${config.originalProfile}`, bootstrapPath], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
  const stop = () => child.kill()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  let summary
  try {
    const saved = JSON.parse(await fs.readFile(summaryPath, 'utf8'))
    const booleanOrNull = value => typeof value === 'boolean' ? value : null
    summary = { phase: config.phase, status: statuses.includes(saved.status) ? saved.status : 'unclassified', exitCode,
      observedModelFetchInvocations: Number.isSafeInteger(saved.observedModelFetchInvocations) ? saved.observedModelFetchInvocations : null,
      currentPhaseModelRequests: Number.isSafeInteger(saved.currentPhaseModelRequests) ? saved.currentPhaseModelRequests : null,
      modelIdentity: saved.modelIdentity === 'gpt-6.1-terra' ? saved.modelIdentity : null,
      credentialProbe: config.phase === 'cold' ? 'not-needed' : 'presence-only-no-network',
      credentialPresence: booleanOrNull(saved.credentialPresence), credentialReadableAfterDomainSwitch: booleanOrNull(saved.credentialReadableAfterDomainSwitch),
      networkOwnerInstalled: saved.networkOwnerInstalled === true, profileRolesUnchanged: booleanOrNull(saved.profileRolesUnchanged),
      currentBundledGuideVerified: booleanOrNull(saved.currentBundledGuideVerified),
      offlineSharedResult: Number.isFinite(saved.offlineSharedResult) ? saved.offlineSharedResult : null,
      errorCode: codes.includes(saved.errorCode) ? saved.errorCode : null, report: path.basename(summaryPath),
      stage: ['owner-bootstrap', 'consumer'].includes(saved.stage) ? saved.stage : null }
  } catch { summary = { phase: config.phase, status: 'child-exited-without-safe-summary', exitCode, observedModelFetchInvocations: null } }
  console.log(JSON.stringify(summary)); process.exitCode = exitCode
} catch {
  console.log(JSON.stringify({ phase: phases.includes(config?.phase) ? config.phase : null,
    status: 'wrapper-configuration-or-launch-failed', observedModelFetchInvocations: null }))
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }) }
}
