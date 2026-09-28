import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { disclosedExecutionSettings } from '../../src/shared/workbench/executionDesktop'
import { modelCapabilityRecord } from '../../src/shared/workbench/modelCapabilities'
import { validateRelRecoveryDirectory } from './helpers/g20RelMixedRecovery'

const root = resolve(__dirname, '../..')
const baseURL = 'https://api.teamorouter.com/v1'
const textModel = 'deepseek-flash'
const imageModel = 'gpt-image-2.5-sunburst'

test.use({ trace: 'off' })
test.describe.configure({ retries: 0 })

test('REL-T11 route and capability preflight', async ({}, info) => {
  test.skip(!process.env.G20_REL_OAUTH_PROFILE_RECOVERY_DIR,
    'Set G20_REL_OAUTH_PROFILE_RECOVERY_DIR to an existing formally logged-in private profile')
  test.setTimeout(process.env.G20_REL_PROBE_VISION === '1' ? 120_000 : 45_000)
  const recoveryDirectory = validateRelRecoveryDirectory(resolve(process.env.G20_REL_OAUTH_PROFILE_RECOVERY_DIR!))
  const paidVisionProbe = process.env.G20_REL_PROBE_VISION === '1'
  if (paidVisionProbe && process.env.G20_REL_OWNER_RELEASE !== '1')
    throw new Error('Paid vision capability probe requires G20_REL_OWNER_RELEASE=1')
  const profile = join(recoveryDirectory, 'profile')
  const output = join(root, 'output/g20/rel-t11')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'preflight-'))
  const app = await electron.launch({ cwd: root,
    args: [join(root, 'tests/e2e/helpers/g20RelMixedRealPreflightBootstrap.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '',
      VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    let state = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    if (process.env.G20_REL_PREPARE_IMAGE_ROLE === '1') {
      const generate = state.profile.roles.imageGenerate
      const edit = state.profile.roles.imageEdit
      const connection = state.connections.find(item => item.connection.id === generate?.connectionId)
      if (!generate || !edit || generate.connectionId !== edit.connectionId
        || !connection?.hasCredential || connection.revoked || connection.connection.provider !== 'openai'
        || connection.connection.protocol !== 'chatgpt-responses' || connection.connection.auth.kind !== 'oauth')
        throw new Error('Existing GPT OAuth generate/edit connection is unavailable; profile was not changed')
      if (generate.model !== imageModel || edit.model !== imageModel) {
        await page.evaluate(async (input: any) => { await window.desktopAPI!.executionSettings!.saveProfile(input) }, {
          expectedRevision: state.profile.revision, roles: { ...state.profile.roles,
            imageGenerate: { ...generate, model: imageModel }, imageEdit: { ...edit, model: imageModel } },
        } as any)
        state = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
      }
    }
    let probeResult: { status: string; observedAt?: number; actualModel?: string } | null = null
    if (paidVisionProbe) {
      const selected = state.profile.roles.conversation
      const connection = state.connections.find(item => item.connection.id === selected?.connectionId)
      if (!connection?.hasCredential || connection.revoked || connection.connection.provider !== 'teamorouter'
        || connection.connection.protocol !== 'openai-chat' || connection.connection.baseURL !== baseURL
        || selected?.model !== textModel)
        throw new Error('Frozen TeamoRouter deepseek-flash conversation selection is unavailable; probe was not sent')
      const result = await page.evaluate(async revision => window.desktopAPI!.executionSettings!.probeCapabilities({
        role: 'conversation', expectedProfileRevision: revision, checks: ['vision'] }), state.profile.revision)
      probeResult = { status: result.facts.vision?.status ?? 'unknown', observedAt: result.facts.vision?.observedAt,
        actualModel: result.facts.vision?.actualModel }
      state = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    }
    const credential = await app.evaluate(async () => (globalThis as any).__G20_REL_REAL_PREFLIGHT__.ready)
    const roles = disclosedExecutionSettings(state).roles
    const text = state.connections.find(item => item.connection.id === roles.conversation?.connectionId)
    const image = state.connections.find(item => item.connection.id === roles.imageGenerate?.connectionId)
    const visionFact = text && state.profile.roles.conversation && modelCapabilityRecord(state.capabilityRecords ?? [], {
      connection: text.connection, model: state.profile.roles.conversation.model,
      parameters: state.profile.roles.conversation.parameters })?.facts.vision
    const blockers = [
      ...(!text?.hasCredential || text.revoked || text.connection.provider !== 'teamorouter'
        || text.connection.protocol !== 'openai-chat' || text.connection.imageProtocol !== null
        || text.connection.baseURL !== baseURL || roles.conversation?.model !== textModel
        ? ['TeamoRouter deepseek-flash text route is unavailable'] : []),
      ...(!image?.hasCredential || image.revoked || image.connection.provider !== 'openai'
        || image.connection.protocol !== 'chatgpt-responses' || roles.imageGenerate?.model !== imageModel
        || !credential.credentialReadable || credential.expired || !credential.sourceIsIsolated
        ? ['Existing private GPT OAuth image role is unavailable'] : []),
    ]
    const evidence = { caseId: 'REL-T11', phase: paidVisionProbe ? 'paid-vision-probe' : 'no-fee',
      status: blockers.length ? 'blocked' : 'ready', paidRequests: paidVisionProbe ? 1 : 0,
      recoveryDirectory, blockers, roles, probeResult,
      imageCapability: { model: imageModel, credentialReady: credential.credentialReadable,
        generationUnverified: true },
      visionCapability: { route: 'conversation', model: textModel, fact: visionFact?.status ?? 'unknown',
        actualModel: visionFact?.actualModel ?? null,
        declared: text?.connection.capabilities.vision ?? null },
      runPolicy: { capabilityProbe: 'one approved vision check on current conversation model',
        fullRun: 'one run, no Playwright retries; observe actual usage and stop on nonprogress or unrecoverable error' },
      highCapabilityComparison: { status: 'prepared-only', provider: 'openai', model: 'gpt-6-astra',
        fullRunRequests: 0 },
      next: blockers.length ? 'Correct the blocked route or credential before the single real run.'
        : 'Run the single real task with the approved route and image model.' }
    const filename = join(directory, 'preflight.json')
    writeFileSync(filename, JSON.stringify(evidence, null, 2))
    await info.attach('REL-T11 no-fee preflight', { path: filename, contentType: 'application/json' })
    expect(['blocked', 'ready']).toContain(evidence.status)
  } finally {
    const child = app.process()
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
      else child.kill('SIGKILL')
    }
    await app.close().catch(() => undefined)
  }
})
