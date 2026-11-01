/** Run with Node and one JSON config path. phase must explicitly be zero or live.
 * The child uses the original crypto owner at startup, then isolated domain paths.
 * stdout contains only this wrapper's allowlisted summary; no raw child output. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
let lock, lockPath, config
try {
  assert(process.argv.length === 3, 'expected-config-file')
  const supplied = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'))
  config = { profile: supplied.profile, out: supplied.out, phase: supplied.phase, blocks: supplied.blocks ?? 1,
    inputTokenFloor: supplied.inputTokenFloor ?? 4096, perRequestTimeoutMs: supplied.perRequestTimeoutMs ?? 180000 }
  assert(config.phase === 'zero' || config.phase === 'live', 'explicit-phase-required')
  assert(typeof config.profile === 'string' && path.isAbsolute(config.profile) && typeof config.out === 'string' && path.isAbsolute(config.out), 'absolute-paths-required')
  assert(config.blocks === 1, 'this-opt-in-wrapper-has-a-four-request-budget')
  assert(Number.isSafeInteger(config.inputTokenFloor) && config.inputTokenFloor >= 1024, 'invalid-input-floor')
  assert(Number.isSafeInteger(config.perRequestTimeoutMs) && config.perRequestTimeoutMs > 0 && config.perRequestTimeoutMs <= 300000, 'invalid-request-time-budget')
  const relative = path.relative(config.profile, config.out)
  assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'output-must-be-outside-owner-profile')
  const electron = require('electron')
  assert(typeof electron === 'string' && path.isAbsolute(electron), 'electron-binary-unavailable')
  const registration = require.resolve('tsx/cjs')
  await fs.mkdir(config.out, { recursive: true })
  lockPath = path.join(config.out, 'w7-affinity-running.lock')
  lock = await fs.open(lockPath, 'wx')
  await lock.writeFile(JSON.stringify({ pid: process.pid, phase: config.phase }))
  const attempt = randomUUID()
  const summaryPath = path.join(config.out, `bootstrap-summary-${config.phase}-${attempt}.json`)
  const bootstrapPath = path.join(config.out, `w7-bootstrap-${config.phase}-${attempt}.cjs`)
  const bootstrap = `
require(${JSON.stringify(registration)});
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = ${JSON.stringify(config)};
const summaryPath = ${JSON.stringify(summaryPath)};
app.setAppPath(${JSON.stringify(root)});
app.setPath('userData', config.profile);
app.setPath('sessionData', config.profile);
app.on('window-all-closed', () => undefined);
let stage = 'credential-presence', probe;
app.whenReady().then(async () => {
  const { prepareExperimentOwnerBootstrap } = require(${JSON.stringify(path.join(root, 'tests/e2e/experimentOwnerBootstrap20261031.node.ts'))});
  probe = await prepareExperimentOwnerBootstrap({ out: config.out, originalProfile: config.profile, credentialProbe: 'required' });
  if (!probe.credentialPresence || !probe.credentialReadableAfterDomainSwitch || probe.network?.status !== 'installed')
    throw new Error('credential-presence-unavailable');
  stage = 'fixed-payload-experiment';
  const { executeW7AffinityExperiment } = require(${JSON.stringify(path.join(root, 'tests/e2e/w7ProviderAffinity20261031.node.ts'))});
  const result = await executeW7AffinityExperiment(config);
  const live = config.phase === 'live';
  const sampleCount = live ? result.samples.length : 0;
  const networkRequests = live ? result.samples.reduce((sum, sample) => sum + sample.network.fetchCalls, 0) : 0;
  const summary = { phase: config.phase, status: live ? (result.comparisonEligible ? 'live-complete' : 'live-complete-ineligible') : result.status,
    actualModelRequests: networkRequests, sampleCount, comparisonEligible: live ? result.comparisonEligible : null,
    credentialPresence: true, credentialReadableAfterDomainSwitch: true, tokenValidityProbedByPresenceCheck: false,
    networkOwnerInstalled: probe.network.status === 'installed' && probe.network.pid === process.pid,
    profileUnchanged: typeof result.profileUnchanged === 'boolean' ? result.profileUnchanged : null,
    report: path.basename(live ? 'result.json' : 'zero-preflight.json') };
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  app.exit(live && !result.complete ? 2 : 0);
}).catch(async error => {
  const code = ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_ASSERTION', 'EACCES', 'ENOENT'].includes(error?.code) ? error.code : null;
  await fs.writeFile(summaryPath, JSON.stringify({ phase: config.phase, status: 'blocked', stage,
    errorCode: code,
    credentialPresence: Boolean(probe?.credentialPresence), credentialReadableAfterDomainSwitch: Boolean(probe?.credentialReadableAfterDomainSwitch),
    networkOwnerInstalled: probe?.network?.status === 'installed' && probe?.network?.pid === process.pid,
    actualModelRequests: stage === 'credential-presence' ? 0 : null,
    diagnostic: stage === 'credential-presence' ? 'credential-preflight.json' : 'samples-checkpoint.json' }, null, 2)).catch(() => {});
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
    summary = { phase: config.phase, status: ['zero-pass', 'live-complete', 'live-complete-ineligible', 'blocked'].includes(saved.status) ? saved.status : 'unclassified',
      exitCode, actualModelRequests: Number.isSafeInteger(saved.actualModelRequests) ? saved.actualModelRequests : null,
      sampleCount: Number.isSafeInteger(saved.sampleCount) ? saved.sampleCount : null,
      comparisonEligible: typeof saved.comparisonEligible === 'boolean' ? saved.comparisonEligible : null,
      credentialPresence: saved.credentialPresence === true, credentialReadableAfterDomainSwitch: saved.credentialReadableAfterDomainSwitch === true,
      networkOwnerInstalled: saved.networkOwnerInstalled === true,
      profileUnchanged: typeof saved.profileUnchanged === 'boolean' ? saved.profileUnchanged : null,
      errorCode: ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_ASSERTION', 'EACCES', 'ENOENT'].includes(saved.errorCode) ? saved.errorCode : null,
      report: path.basename(summaryPath),
      stage: saved.stage === 'credential-presence' || saved.stage === 'fixed-payload-experiment' ? saved.stage : null }
  } catch { summary = { phase: config.phase, status: 'child-exited-without-safe-summary', exitCode, actualModelRequests: null } }
  console.log(JSON.stringify(summary)); process.exitCode = exitCode
} catch {
  console.log(JSON.stringify({ phase: config?.phase === 'zero' || config?.phase === 'live' ? config.phase : null,
    status: 'wrapper-configuration-or-launch-failed', actualModelRequests: null }))
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await fs.rm(lockPath, { force: true }) }
}
