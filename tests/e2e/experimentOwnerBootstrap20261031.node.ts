/** Shared test-process bootstrap, using the production credential and network owners.
 * No browser, login flow, model request or new dispatcher implementation lives here. */
import assert from 'node:assert/strict'
import { app, session } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getGlobalDispatcher, type Dispatcher } from 'undici'
import { installSystemProxy } from '../../src/main/workbench/network/systemProxyDispatcher'
import { probeDirectoryConsumerCredentials } from './delegationDirectoryConsumer20261030.node'

export interface ExperimentNetworkFacts {
  status: 'installed'
  owner: 'installSystemProxy(session.defaultSession)'
  pid: number
  afterReady: true
  dispatcherChanged: true
  installedAt: string
  connectionReused: null
  routeDecision: 'production Electron system/PAC resolver per new connection; no proxy address recorded'
}
let installedDispatcher: Dispatcher | undefined, installedFacts: ExperimentNetworkFacts | undefined

/** A file from an earlier process cannot satisfy this live in-process check. */
export function assertExperimentNetworkReady(): ExperimentNetworkFacts {
  if (!app.isReady() || !installedFacts || !installedDispatcher || getGlobalDispatcher() !== installedDispatcher)
    throw new Error('experiment-production-network-owner-not-installed')
  return { ...installedFacts }
}

export async function prepareExperimentOwnerBootstrap(input: {
  out: string; originalProfile?: string; credentialProbe?: 'required' | 'not-needed'
}) {
  await app.whenReady()
  assert(path.isAbsolute(input.out), 'Experiment output must be an explicit absolute path')
  const domainProfile = path.join(input.out, 'domain-profile'), domainSessionData = path.join(input.out, 'domain-session')
  await fs.mkdir(domainProfile, { recursive: true }); await fs.mkdir(domainSessionData, { recursive: true })
  const required = input.credentialProbe !== 'not-needed'
  let credentialPresence = false, credentialReadableAfterDomainSwitch = false
  if (required) {
    assert(input.originalProfile && path.isAbsolute(input.originalProfile), 'Credential owner profile must be explicit')
    const probe = await probeDirectoryConsumerCredentials({ out: input.out, originalProfile: input.originalProfile,
      domainProfile, domainSessionData, requireOriginalStartupContext: true })
    credentialPresence = probe.credentialReadable === true
    credentialReadableAfterDomainSwitch = probe.credentialReadableAfterDomainSwitch === true
    assert(probe.status === 'decryption-readable-token-validity-unprobed' && credentialPresence && credentialReadableAfterDomainSwitch,
      'Original credential owner was not readable after the isolated domain switch')
  } else {
    // Offline/cold consumers do not need credential decryption.
    app.setPath('userData', domainProfile); app.setPath('sessionData', domainSessionData)
  }
  // Same ordering as Main: app.ready, then install the real default-session
  // resolver before any account refresh, Provider fetch or domain service startup.
  const before = getGlobalDispatcher()
  installSystemProxy(session.defaultSession)
  installedDispatcher = getGlobalDispatcher()
  assert.notEqual(installedDispatcher, before, 'Production network owner did not install its dispatcher')
  installedFacts = { status: 'installed', owner: 'installSystemProxy(session.defaultSession)', pid: process.pid,
    afterReady: true, dispatcherChanged: true, installedAt: new Date().toISOString(), connectionReused: null,
    routeDecision: 'production Electron system/PAC resolver per new connection; no proxy address recorded' }
  const network = assertExperimentNetworkReady()
  await fs.writeFile(path.join(input.out, 'network-preflight.json'), JSON.stringify(network, null, 2))
  return { credentialProbe: required ? 'presence-only-no-network' : 'not-needed-for-offline-consumer', credentialPresence,
    credentialReadableAfterDomainSwitch, tokenValidityProbed: false, domainPathsSwitched: true, network }
}
