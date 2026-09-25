import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { disclosedExecutionSettings } from '../../src/shared/workbench/executionDesktop'
import { openAIImagesEndpoint } from '../../src/shared/workbench/images'
import { createRelRecoveryDirectory, readRelResumeManifest, validateRelRecoveryDirectory } from './helpers/g20RelMixedRecovery'

const root = resolve(__dirname, '../..')
const baseURL = 'https://api.teamorouter.com/v1'
const textModel = 'deepseek-flash'
const imageModel = 'gpt-image-2'

test.use({ trace: 'off' })

test('REL-T11 no-fee preflight freezes TeamoRouter text and Images roles in a private fresh profile', async () => {
  test.setTimeout(45_000)
  const output = join(root, 'output/g20/rel-t11')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'real-preflight-'))
  const recoveryDirectory = createRelRecoveryDirectory()
  const profile = join(recoveryDirectory, 'profile')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '',
        VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    const initial = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    expect(initial).toMatchObject({ secureStorageAvailable: true, connections: [] })
    const connection = await page.evaluate(async input => window.desktopAPI!.executionSettings!.saveConnection({
      apiKey: 'fixture-only-no-network', connection: {
        provider: 'teamorouter', protocol: 'openai-chat', imageProtocol: 'openai-images',
        baseURL: input.baseURL, accountId: 'fixture-preflight', authKind: 'api-key', billing: { kind: 'metered' },
      },
    }), { baseURL })
    await page.evaluate(async input => {
      const service = window.desktopAPI!.executionSettings!, current = await service.read()
      await service.saveProfile({ expectedRevision: current.profile.revision, roles: {
        conversation: { connectionId: input.connectionId, model: input.textModel }, vision: null,
        imageGenerate: { connectionId: input.connectionId, model: input.imageModel, parameters: {} },
        imageEdit: { connectionId: input.connectionId, model: input.imageModel, parameters: {} },
      } })
    }, { connectionId: connection.connection.id, textModel, imageModel })
    const frozen = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const selected = frozen.connections.find(item => item.connection.id === connection.connection.id)
    expect(selected).toMatchObject({ hasCredential: true, connection: {
      provider: 'teamorouter', protocol: 'openai-chat', imageProtocol: 'openai-images',
      baseURL, billing: { kind: 'metered' }, auth: { kind: 'api-key' },
    } })
    expect(frozen.profile.roles.conversation).toMatchObject({ connectionId: connection.connection.id, model: textModel })
    expect(frozen.profile.roles.imageGenerate).toMatchObject({ connectionId: connection.connection.id, model: imageModel })
    expect(frozen.profile.roles.imageEdit).toEqual(frozen.profile.roles.imageGenerate)
    const disclosed = disclosedExecutionSettings(frozen)
    expect(disclosed.roles.conversation).toMatchObject({ provider: 'teamorouter', model: textModel, billingKind: 'metered' })
    expect(disclosed.roles.imageGenerate).toMatchObject({ provider: 'teamorouter', model: imageModel, billingKind: 'metered' })
    expect(disclosed.roles.imageEdit).toEqual(disclosed.roles.imageGenerate)
    expect(openAIImagesEndpoint(selected!.connection, 'generate')).toBe(`${baseURL}/images/generations`)
    expect(JSON.stringify(frozen)).not.toContain('fixture-only-no-network')
    writeFileSync(join(directory, 'preflight.json'), JSON.stringify({ caseId: 'REL-T11', phase: 'teamo-only-no-fee-preflight',
      paidRequests: 0, catalogRequests: 0, text: { provider: 'teamorouter', model: textModel, billing: 'metered' },
      image: { provider: 'teamorouter', protocol: 'openai-images', model: imageModel, billing: 'metered' },
      endpoint: `${baseURL}/images/generations`, isolatedProfile: true, frozenRoles: disclosed }, null, 2))
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    rmSync(validateRelRecoveryDirectory(recoveryDirectory), { recursive: true, force: true })
  }
})

test('REL-T11 no-fee preflight verifies a legacy OAuth continuation without changing its frozen route', async () => {
  test.skip(!process.env.G20_REL_RESUME_MANIFEST, 'An existing legacy resume manifest is required')
  test.setTimeout(120_000)
  const manifest = readRelResumeManifest(resolve(process.env.G20_REL_RESUME_MANIFEST!))
  test.skip(manifest.schemaVersion !== 1, 'This check is only for a legacy GPT OAuth image run')
  expect(existsSync(join(manifest.workspacePath, '光合作用材料.md'))).toBe(true)
  const profile = join(manifest.recoveryDirectory, 'profile')
  console.log('REL legacy preflight: launching private profile')
  const app = await electron.launch({ cwd: root,
    args: [join(root, 'tests/e2e/helpers/g20RelMixedRealPreflightBootstrap.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '',
      VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    console.log('REL legacy preflight: checking frozen OAuth credential')
    const oauth = await app.evaluate(async () => (globalThis as any).__G20_REL_REAL_PREFLIGHT__.ready)
    expect(oauth).toMatchObject({ provider: 'openai', protocol: 'chatgpt-responses', billing: 'subscription',
      credentialReadable: true, secureStorageAvailable: true, sourceIsIsolated: true })
    const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    console.log('REL legacy preflight: checking saved roles and prior run')
    const disclosed = disclosedExecutionSettings(settings)
    expect(disclosed.roles.conversation).toMatchObject({ provider: 'teamorouter', model: textModel, billingKind: 'metered' })
    expect(disclosed.roles.imageGenerate).toMatchObject({ provider: 'openai', model: imageModel, billingKind: 'subscription' })
    const state = await page.evaluate(async input => {
      const api = window.desktopAPI!.execution!
      return { run: await api.run(input.runId), submissions: await api.submissions({
        workspaceId: input.workspaceId, conversationId: input.conversationId }),
        conversation: await api.conversation(input.workspaceId, input.conversationId) }
    }, manifest)
    expect(state.run).toMatchObject({ runId: manifest.runId, status: 'partial', input: {
      taskId: manifest.originalSubmissionId, conversationId: manifest.conversationId,
      workspaceRoot: manifest.workspacePath, disclosedSettings: disclosed,
      selection: { model: textModel, connection: { provider: 'teamorouter', baseURL } },
    } })
    expect(state.run?.input.selection.parameters ?? {}).toEqual(settings.profile.roles.conversation?.parameters ?? {})
    expect(state.run?.input.disclosedSettings).toEqual(disclosed)
    expect(state.submissions.some(item => item.retryOfRunId === manifest.runId)).toBe(false)
    expect(state.submissions.find(item => item.submissionId === manifest.originalSubmissionId)?.runId).toBe(manifest.runId)
    expect(state.conversation).toBeTruthy()
  } finally {
    await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0)
    }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
