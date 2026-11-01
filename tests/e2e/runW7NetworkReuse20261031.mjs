/** Node <this-file> <absolute-config.json>, phase must be "network". The owned
 * Electron process sends at most four unauthenticated, bodyless HEAD requests.
 * Raw child output is suppressed; this wrapper prints an allowlisted summary. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../', import.meta.url))
const statuses = ['network-complete-comparable', 'network-complete-ineligible', 'blocked']
const codes = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_ASSERTION', 'EACCES', 'ENOENT', 'EEXIST']
let lock, lockPath, config
try {
  assert(process.argv.length === 3, 'expected-config-file')
  const supplied = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
  config = { profile: supplied.profile, out: supplied.out, phase: supplied.phase, perRequestTimeoutMs: supplied.perRequestTimeoutMs ?? 15000 }
  assert(config.phase === 'network', 'explicit-network-phase-required')
  assert(typeof config.profile === 'string' && path.isAbsolute(config.profile) && typeof config.out === 'string' && path.isAbsolute(config.out), 'absolute-paths-required')
  assert(Number.isSafeInteger(config.perRequestTimeoutMs) && config.perRequestTimeoutMs > 0 && config.perRequestTimeoutMs <= 15000, 'invalid-request-time-budget')
  const relative = path.relative(config.profile, config.out)
  assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'output-must-be-outside-owner-profile')
  const electron = require('electron'), registration = require.resolve('tsx/cjs')
  assert(typeof electron === 'string' && path.isAbsolute(electron), 'electron-binary-unavailable')
  await fs.mkdir(config.out, { recursive: true })
  lockPath = path.join(config.out, 'w7-network-running.lock')
  lock = await fs.open(lockPath, 'wx'); await lock.writeFile(JSON.stringify({ pid: process.pid, phase: config.phase }))
  const attempt = randomUUID(), stem = `w7-network-bootstrap-${attempt}`
  const summaryPath = path.join(config.out, `${stem}-summary.json`), bootstrapPath = path.join(config.out, `${stem}.cjs`)
  const bootstrap = `
require(${JSON.stringify(registration)});
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = ${JSON.stringify(config)};
const summaryPath = ${JSON.stringify(summaryPath)};
const codes = ${JSON.stringify(codes)};
app.setAppPath(${JSON.stringify(root)});
app.setPath('userData', config.profile);
app.setPath('sessionData', config.profile);
app.on('window-all-closed', () => undefined);
let stage = 'network-owner-bootstrap', probe;
app.whenReady().then(async () => {
  const { prepareExperimentOwnerBootstrap } = require(${JSON.stringify(path.join(root, 'tests/e2e/experimentOwnerBootstrap20261031.node.ts'))});
  // HEAD has no Authorization or account state; no credential owner is read.
  probe = await prepareExperimentOwnerBootstrap({ out: config.out, originalProfile: config.profile, credentialProbe: 'not-needed' });
  if (probe.network?.status !== 'installed' || probe.network.pid !== process.pid) throw new Error('network-owner-unavailable');
  stage = 'bounded-head-experiment';
  const { executeW7NetworkReuse } = require(${JSON.stringify(path.join(root, 'tests/e2e/w7NetworkReuse20261031.node.ts'))});
  const result = await executeW7NetworkReuse(config);
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: result.status, pid: process.pid,
    actualModelRequests: 0, headFetchInvocations: result.samples.reduce((sum, sample) => sum + sample.fetchInvocations, 0),
    comparisonEligible: result.comparisonEligible, pooledSecondReusedSocket: result.pooledSecondReusedSocket,
    freshRequestsUsedDistinctSockets: result.freshRequestsUsedDistinctSockets,
    credentialsAccessed: false, networkOwnerInstalled: true, cleanupCompleted: result.cleanupCompleted,
    report: 'network-result.json' }, null, 2));
  app.exit(0);
}).catch(async error => {
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: 'blocked', stage, pid: process.pid,
    errorCode: codes.includes(error?.code) ? error.code : null, actualModelRequests: 0,
    headFetchInvocations: stage === 'network-owner-bootstrap' ? 0 : null, credentialsAccessed: false,
    networkOwnerInstalled: probe?.network?.status === 'installed' && probe?.network?.pid === process.pid,
    diagnostic: stage === 'network-owner-bootstrap' ? 'network-preflight.json' : 'network-samples-checkpoint.json' }, null, 2)).catch(() => {});
  app.exit(1);
});
`
  await fs.writeFile(bootstrapPath, bootstrap)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [`--user-data-dir=${config.profile}`, bootstrapPath], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
  const stop = () => child.kill()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  let summary
  try {
    const saved = JSON.parse(await fs.readFile(summaryPath, 'utf8'))
    const booleanOrNull = value => typeof value === 'boolean' ? value : null
    summary = { phase: 'network', status: statuses.includes(saved.status) ? saved.status : 'unclassified', exitCode,
      actualModelRequests: 0, headFetchInvocations: Number.isSafeInteger(saved.headFetchInvocations) ? saved.headFetchInvocations : null,
      comparisonEligible: booleanOrNull(saved.comparisonEligible), pooledSecondReusedSocket: booleanOrNull(saved.pooledSecondReusedSocket),
      freshRequestsUsedDistinctSockets: booleanOrNull(saved.freshRequestsUsedDistinctSockets),
      credentialsAccessed: false, networkOwnerInstalled: saved.networkOwnerInstalled === true,
      cleanupCompleted: booleanOrNull(saved.cleanupCompleted),
      errorCode: codes.includes(saved.errorCode) ? saved.errorCode : null, report: path.basename(summaryPath),
      stage: ['network-owner-bootstrap', 'bounded-head-experiment'].includes(saved.stage) ? saved.stage : null }
  } catch { summary = { phase: 'network', status: 'child-exited-without-safe-summary', exitCode, actualModelRequests: 0, headFetchInvocations: null } }
  console.log(JSON.stringify(summary)); process.exitCode = exitCode
} catch {
  console.log(JSON.stringify({ phase: config?.phase === 'network' ? 'network' : null,
    status: 'wrapper-configuration-or-launch-failed', actualModelRequests: 0, headFetchInvocations: null }))
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }) }
}
