/** Explicit, zero-model-cost phase; same production network owner as the app. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assertExperimentNetworkReady } from './experimentOwnerBootstrap20261031.node'
import { NETWORK_REUSE_ENDPOINT, runNetworkReuseExperiment } from '../helpers/w7NetworkReuseExperiment'

export async function executeW7NetworkReuse(input: { out: string; phase: 'network'; perRequestTimeoutMs?: number }) {
  assert(input.phase === 'network' && path.isAbsolute(input.out), 'explicit-network-phase-and-output-required')
  const network = assertExperimentNetworkReady()
  await fs.mkdir(input.out, { recursive: true })
  const report = await runNetworkReuseExperiment({ endpoint: NETWORK_REUSE_ENDPOINT, perRequestTimeoutMs: input.perRequestTimeoutMs,
    ensureReady: assertExperimentNetworkReady,
    checkpoint: value => fs.writeFile(path.join(input.out, 'network-samples-checkpoint.json'), JSON.stringify(value, null, 2)) })
  const result = { ...report, phase: 'network' as const, networkOwner: network, pid: process.pid,
    credentialsAccessed: false, status: report.comparisonEligible ? 'network-complete-comparable' : 'network-complete-ineligible' }
  await fs.writeFile(path.join(input.out, 'network-result.json'), JSON.stringify(result, null, 2))
  return result
}
