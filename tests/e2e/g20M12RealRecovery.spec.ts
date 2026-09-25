import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { closeSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText } from './helpers/g20SelectionHarness'
import { createRelRecoveryDirectory, validateRelRecoveryDirectory } from './helpers/g20RelMixedRecovery'

type Route = 'teamorouter' | 'official' | 'oauth'
const root = resolve(__dirname, '../..')
const routes = {
  teamorouter: { provider: 'teamorouter', baseURL: 'https://api.teamorouter.com/v1', model: 'deepseek-flash', key: 'TEAMOROUTER_API_KEY', billing: 'metered' },
  official: { provider: 'deepseek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', key: 'DEEPSEEK_API_KEY', billing: 'metered' },
  oauth: { provider: 'openai', baseURL: 'https://chatgpt.com/backend-api/codex', model: 'gpt-6-luna', key: '', billing: 'subscription' },
} as const

test.use({ trace: 'off' }) // A provider credential is passed through page.evaluate.
test.describe.configure({ retries: 0 })

test('M12-T05 one real provider response after explicit recovery from a no-fee Main transport fault', async ({}, info) => {
  const paid = process.env.G20_M12_REAL_RECOVERY === '1'
  const preflightOnly = process.env.G20_M12_RECOVERY_PREFLIGHT === '1'
  test.skip(!paid && !preflightOnly, 'Set G20_M12_RECOVERY_PREFLIGHT=1 or G20_M12_REAL_RECOVERY=1')
  if (paid && preflightOnly) throw new Error('Choose exactly one M12 recovery mode')
  test.setTimeout(preflightOnly ? 75_000 : 180_000)
  const route = process.env.G20_M12_RECOVERY_ROUTE as Route
  if (!Object.hasOwn(routes, route)) throw new Error('Set G20_M12_RECOVERY_ROUTE=teamorouter|official|oauth')
  const selected = routes[route]
  const key = selected.key ? process.env[selected.key] : null
  if (selected.key && !key) throw new Error(`${selected.key} is absent; no model request was made`)

  const output = join(root, 'output/g20/m12-real-recovery'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, `${route}-`))
  const stageFile = join(directory, 'startup-stage.txt')
  const mark = (stage: string) => writeFileSync(stageFile, stage)
  mark('fixture-created')
  const privateDirectory = createRelRecoveryDirectory(), profile = join(privateDirectory, 'profile')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const source = '# 恢复验收\n\n先预测，再观察。\n'
  writeFileSync(join(workspace, '恢复任务.md'), source)
  const attachment = join(workspace, '参考材料.md')
  const attachmentSource = '观察之后再解释，解释时在蓝卡记录证据。'
  writeFileSync(attachment, attachmentSource)
  const originalWorkspaceFiles = readdirSync(workspace).sort()
  if (route === 'oauth') {
    const engineering = join(process.env.APPDATA ?? '', 'Guoling-2.0-engineering-oauth')
    const settings = join(engineering, 'workbench-v2', 'settings', 'execution-settings-v1.json')
    if (!existsSync(settings) || !existsSync(join(engineering, 'Local State')))
      throw new Error('Authorized engineering OAuth profile is absent; no model request was made')
    const target = join(profile, 'workbench-v2', 'settings'); mkdirSync(target, { recursive: true })
    copyFileSync(settings, join(target, 'execution-settings-v1.json'))
    copyFileSync(join(engineering, 'Local State'), join(profile, 'Local State'))
  }
  const app = await electron.launch({ cwd: root,
    args: [join(root, 'tests/e2e/helpers/g20M12RealRecoveryBootstrap.cjs'), `--user-data-dir=${profile}`],
    env: { ...process.env, G20_M12_RECOVERY_ROUTE: route, TEAMOROUTER_API_KEY: '', DEEPSEEK_API_KEY: '',
      G20_M12_PREFLIGHT_STAGE_FILE: stageFile, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const evidence: Record<string, unknown> = { caseId: 'M12-T05', route, requestedModel: selected.model,
    declaredBilling: selected.billing, actualCharge: 'unknown', firstRequestNativeFetch: false, continued: false,
    mode: paid ? 'one-paid-continuation' : 'zero-paid-preflight' }
  let failedPage: Page | undefined
  let activeIdentity: { workspaceId: string; conversationId: string } | undefined
  let preservePrivateProfile = false
  let paidContinuationAttempted = false
  try {
    mark('electron-launched')
    const page = await app.firstWindow(); failedPage = page; page.setDefaultTimeout(20_000)
    mark('window-ready')
    if (route === 'oauth') {
      mark('oauth-preflight-await')
      const oauth = await Promise.race([
        app.evaluate(async () => await (globalThis as any).__G20_M12_OAUTH_PREFLIGHT__),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OAuth preflight exceeded 20 seconds')), 20_000)),
      ])
      mark('oauth-preflight-complete')
      evidence.oauthPreflight = oauth
      writeFileSync(join(directory, 'oauth-preflight.json'), JSON.stringify(oauth, null, 2))
      expect(oauth).toMatchObject({ ready: true, expired: false, accountMatches: true, sourceIsIsolated: true })
      mark('oauth-preflight-verified')
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    mark('window-sized')
    if (route === 'oauth') {
      mark('renderer-settings-await')
      const state = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
      mark('renderer-settings-read')
      const connection = state.connections.find(item => item.connection.provider === 'openai'
        && item.connection.protocol === 'chatgpt-responses' && item.hasCredential && !item.revoked)
      expect(connection, 'OAuth credential must be readable in the isolated profile').toBeTruthy()
      evidence.oauthConnection = connection && { provider: connection.connection.provider,
        protocol: connection.connection.protocol, hasCredential: connection.hasCredential,
        revoked: connection.revoked, tools: connection.connection.capabilities.tools,
        profileRoleModel: state.profile.roles.conversation?.model }
      await page.getByRole('button', { name: '切换模型', exact: true }).click()
      const option = page.getByRole('group', { name: '对话模型选择', exact: true })
        .locator('.execution-assistant__model-option').filter({ hasText: selected.model }).first()
      await expect(option).toBeVisible()
      await expect(option).toBeEnabled({ timeout: 25_000 })
      await option.click()
    } else {
      const saved = await page.evaluate(async input => window.desktopAPI.executionSettings!.saveConnection({
        apiKey: input.key, connection: { provider: input.provider, protocol: 'openai-chat', baseURL: input.baseURL,
          accountId: `m12-${input.route}`, authKind: 'api-key', billing: { kind: 'metered' } },
      }), { key: key!, provider: selected.provider, baseURL: selected.baseURL, route })
      const catalog = await page.evaluate(async input => window.desktopAPI.executionSettings!.discoverModels(input.id, input.revision),
        saved.connection)
      expect(catalog.models.some(item => item.id === selected.model)).toBe(true)
      await page.evaluate(async input => {
        const api = window.desktopAPI.executionSettings!, current = await api.read()
        return api.saveProfile({ expectedRevision: current.profile.revision, roles: {
          ...current.profile.roles, conversation: { connectionId: input.connectionId, model: input.model },
        } })
      }, { connectionId: saved.connection.id, model: selected.model })
    }
    // The role was changed through IPC after this renderer mounted. Recreate
    // its settings projection before any UI send; the frozen Main state alone
    // does not prove the composer is using the same role.
    if (route !== 'oauth') await page.reload({ waitUntil: 'commit' })
    await expect(page.getByLabel('当前模型', { exact: true })).toContainText(`${selected.provider} · ${selected.model}`)
    const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
    const binding = settings.profile.roles.conversation!
    const connection = settings.connections.find(item => item.connection.id === binding.connectionId)!
    expect(connection).toMatchObject({ hasCredential: true, revoked: false, connection: {
      provider: selected.provider, baseURL: selected.baseURL, billing: { kind: selected.billing },
    } })
    expect(binding.model).toBe(selected.model)
    const frozen = { id: connection.connection.id, revision: connection.connection.revision,
      provider: connection.connection.provider, protocol: connection.connection.protocol,
      baseURL: connection.connection.baseURL, accountId: connection.connection.accountId,
      auth: connection.connection.auth.kind, billing: connection.connection.billing.kind,
      model: binding.model, profileRevision: settings.profile.revision }
    evidence.frozen = frozen

    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await openSelectionFile(page, workspace, '恢复任务.md')
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, editor, '先预测')
    await page.getByLabel('当前编辑目标', { exact: true }).getByRole('button', { name: '保留目标', exact: true }).click()
    await assistant.getByRole('button', { name: '添加', exact: true }).click()
    await assistant.getByRole('menuitem', { name: '引用当前选区', exact: true }).click()
    await expect(assistant.getByLabel('本条消息的引用', { exact: true })).toContainText('选区 1 处')
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, attachment)
    await page.locator('.attachment-composer').getByRole('button', { name: '添加', exact: true }).click()
    await page.locator('.attachment-composer').getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    await expect(page.locator('.attachment-composer').getByRole('button', { name: '预览发送内容', exact: true })).toHaveCount(1)
    const text = '只读任务：继续前先读取当前文档；综合当前选区和本条消息已附的材料正文，用一句话写出完整课堂观察顺序。附件正文已随消息提供，无需按磁盘路径打开。不要修改任何文件。'
    const composer = page.getByLabel('给创作助手发消息', { exact: true })
    await composer.fill(text)
    const stateBefore = await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.state())
    expect(stateBefore).toMatchObject({ armed: true, faulted: 0, forwarded: 0, unrelated: 0 })
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
    const continueButton = assistant.getByRole('button', { name: '连接恢复后继续此任务', exact: true })
    await expect(continueButton).toBeVisible()
    const identity = await page.evaluate(async root => {
      const space = await window.desktopAPI.execution!.workspace(root)
      return { workspaceId: space.workspace.workspaceId, conversationId: space.conversations[0].conversationId }
    }, workspace)
    activeIdentity = identity
    const readBefore = () => page.evaluate(async input => {
      const api = window.desktopAPI.execution!, submissions = await api.submissions({
        workspaceId: input.workspaceId, conversationId: input.conversationId,
      })
      const source = submissions.find(item => item.text === input.text)
      return { submissions, source, run: source?.runId ? await api.run(source.runId) : null }
    }, { ...identity, text }).catch(() => null)
    await expect.poll(async () => (await readBefore())?.run?.status ?? null, { timeout: 30_000 }).toMatch(/failed|partial/)
    const before = await readBefore()
    if (!before) throw new Error('Failed run became unreadable after terminal observation')
    expect(before.source).toBeTruthy()
    expect(before.run?.status).toMatch(/failed|partial/)
    expect(before.run?.requests).toHaveLength(1)
    expect(before.run?.input.selection.connection).toMatchObject({ id: frozen.id, revision: frozen.revision,
      provider: frozen.provider, baseURL: frozen.baseURL, accountId: frozen.accountId,
      auth: { kind: frozen.auth }, billing: { kind: frozen.billing } })
    expect(before.run?.input.selection.model).toBe(frozen.model)
    const noFee = await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.state())
    expect(noFee).toMatchObject({ armed: false, faulted: 1, forwarded: 0, unrelated: 0 })
    await page.waitForTimeout(1_500)
    expect(await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.state())).toMatchObject({ forwarded: 0, unrelated: 0 })
    evidence.first = { status: before.run!.status, failure: before.run!.failure,
      requests: before.run!.requests.map(item => ({ state: item.state, failure: item.failure })),
      fault: noFee, submissionId: before.source!.submissionId, runId: before.run!.runId }
    writeFileSync(join(directory, 'before-paid-continuation.json'), JSON.stringify(evidence, null, 2))

    if (preflightOnly) {
      evidence.preflightPassed = true
      writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
      await info.attach('M12 zero-paid recovery preflight', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
      return
    }

    // Only this visible click crosses the paid boundary. This one Engine run
    // may need further model turns after tool results; no fixed request cap.
    paidContinuationAttempted = true
    await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.allowPaidContinuation())
    await continueButton.click()
    await expect.poll(async () => (await page.evaluate(async input =>
      (await window.desktopAPI.execution!.submissions({ workspaceId: input.workspaceId,
        conversationId: input.conversationId })).find(item => item.retryOfRunId === input.runId)?.runId,
      { ...identity, runId: before.run!.runId })) ?? null, { timeout: 120_000 }).not.toBeNull()
    const after = await page.evaluate(async input => {
      const api = window.desktopAPI.execution!, submissions = await api.submissions({
        workspaceId: input.workspaceId, conversationId: input.conversationId,
      })
      const child = submissions.find(item => item.retryOfRunId === input.runId)
      return { submissions, child, run: child?.runId ? await api.run(child.runId) : null,
        conversation: await api.conversation(input.workspaceId, input.conversationId) }
    }, { ...identity, runId: before.run!.runId })
    expect(after.child).toBeTruthy()
    await expect.poll(async () => (await page.evaluate(id => window.desktopAPI.execution!.run(id), after.child!.runId!))?.status,
      { timeout: 120_000 }).toMatch(/^(completed|failed|partial|stopped|interrupted)$/)
    const complete = await page.evaluate(id => window.desktopAPI.execution!.run(id), after.child!.runId!)
    expect(complete?.status).toBe('completed')
    const answer = complete?.messages.filter(message => message.role === 'assistant').at(-1)?.content
    expect(typeof answer).toBe('string')
    expect(answer).toMatch(/预测/)
    expect(answer).toMatch(/观察/)
    expect(answer).toMatch(/解释/)
    expect(answer).toMatch(/蓝卡记录证据/)
    expect(answer).not.toMatch(/附件.{0,20}(无法|不能|未能|不可).*读|无法.{0,20}(读取|参考).*附件/)
    const documentId = before.run!.input.documents[0]!.documentId
    expect(await readSelectionDocument(page, documentId)).toMatchObject({
      revision: 0, undoDepth: 0, model: { kind: 'markdown', source },
    })
    expect(readdirSync(workspace).sort()).toEqual(originalWorkspaceFiles)
    expect(readFileSync(join(workspace, '恢复任务.md'))).toEqual(Buffer.from(source, 'utf8'))
    expect(readFileSync(attachment)).toEqual(Buffer.from(attachmentSource, 'utf8'))
    await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.closePaidContinuation())
    const finalFault = await app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.state())
    expect(finalFault).toMatchObject({ faulted: 1, blockedBeforeContinue: 0, blockedAfterContinue: 0,
      unrelated: 0, allowPaid: false })
    expect(finalFault.forwarded).toBeGreaterThanOrEqual(1)
    expect(after.child).toMatchObject({ retryOfRunId: before.run!.runId, text: before.source!.text,
      documents: before.source!.documents, attachments: before.source!.attachments,
      model: before.source!.model })
    expect(complete?.input.selection.connection).toEqual(before.run!.input.selection.connection)
    expect(complete?.input.selection.model).toBe(before.run!.input.selection.model)
    expect(complete?.continuedFrom).toBe(before.run!.runId)
    expect(complete?.requests).toHaveLength(finalFault.forwarded)
    expect(complete?.requests.every(item => item.state === 'completed' && !!item.actualModel)).toBe(true)
    expect(complete?.tools.every(item => item.state === 'returned')).toBe(true)
    expect(after.submissions.filter(item => item.runId)).toHaveLength(2)
    expect(after.conversation?.messages.filter(message => message.role === 'user' && message.text === text)).toHaveLength(1)
    evidence.continued = true
    evidence.second = { status: complete!.status, continuedFrom: complete!.continuedFrom,
      retryOfRunId: after.child!.retryOfRunId, actualModels: complete!.requests.map(item => item.actualModel),
      requests: complete!.requests.length, tools: complete!.tools.map(item => ({ name: item.call.name, state: item.state })),
      fault: finalFault, runId: complete!.runId, singleUserMessage: true,
      answer, documentUnchanged: true }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('M12 real recovery evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    mark('catch-entered')
    evidence.error = error instanceof Error ? error.message : String(error)
    if (route === 'oauth' && failedPage) evidence.oauthUI = await failedPage.evaluate(() => ({
      currentModel: document.querySelector('[aria-label="当前模型"]')?.textContent?.trim() ?? null,
      options: [...document.querySelectorAll<HTMLButtonElement>('.execution-assistant__model-option')]
        .map(option => ({ model: option.querySelector('span')?.textContent?.trim() ?? '',
          disabled: option.disabled, unavailable: option.textContent?.includes('连接不可用') ?? false })),
      alertCount: document.querySelectorAll('[role="alert"]').length,
    })).catch(() => null)
    // A terminal failure or unreadable counter still needs the private Main
    // transport journal. Only a fully successful paid continuation is cleaned.
    if (paidContinuationAttempted) preservePrivateProfile = true
    evidence.fault = await Promise.race([
      app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.state()).catch(() => null),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 5_000)),
    ])
    mark('catch-fault-read')
    const paidWasForwarded = !!(evidence.fault && typeof evidence.fault === 'object'
      && 'forwarded' in evidence.fault && evidence.fault.forwarded)
    if (paidWasForwarded && failedPage && activeIdentity) {
      const initialRuns = await failedPage.evaluate(async input => {
        const api = window.desktopAPI.execution!, submissions = await api.submissions(input)
        return Promise.all(submissions.filter(item => item.runId).map(item => api.run(item.runId!)))
      }, activeIdentity).catch(() => null)
      const pending = initialRuns?.filter(run => run && ['queued', 'running', 'stopping'].includes(run.status)).map(run => run!.runId) ?? []
      const stopped = []
      for (const id of pending) stopped.push(await failedPage.evaluate(id => window.desktopAPI.execution!.stop(id), id).catch(() => null))
      let runs = initialRuns, terminal = false
      for (let attempt = 0; attempt < 30; attempt++) {
        runs = await failedPage.evaluate(async input => {
          const api = window.desktopAPI.execution!, submissions = await api.submissions(input)
          return Promise.all(submissions.filter(item => item.runId).map(item => api.run(item.runId!)))
        }, activeIdentity).catch(() => null)
        terminal = !!runs && runs.every(run => run && ['completed', 'failed', 'partial', 'stopped', 'interrupted'].includes(run.status))
        if (terminal) break
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      evidence.shutdown = { stopRequestedFor: pending, stopReturned: stopped.map(run => run?.status ?? null),
        terminal, statuses: runs?.map(run => run?.status ?? null) ?? null }
      if (!terminal) preservePrivateProfile = true
    } else if (paidWasForwarded) {
      evidence.shutdown = { terminal: false, reason: 'window-or-identity-unavailable' }
      preservePrivateProfile = true
    }
    if (paidContinuationAttempted) await Promise.race([
      app.evaluate(() => (globalThis as any).__G20_M12_RECOVERY_FAULT__.closePaidContinuation()).catch(() => null),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 5_000)),
    ])
    if (failedPage && activeIdentity) evidence.finalState = await failedPage.evaluate(async input => {
      const api = window.desktopAPI.execution!, submissions = await api.submissions(input)
      const runs = await Promise.all(submissions.filter(item => item.runId).map(item => api.run(item.runId!)))
      return { submissions: submissions.map(item => ({ submissionId: item.submissionId, runId: item.runId,
        state: item.state, retryOfRunId: item.retryOfRunId, text: item.text, model: item.model })),
        runs: runs.map(run => run && ({ runId: run.runId, status: run.status, failure: run.failure,
          continuedFrom: run.continuedFrom, requests: run.requests.map(item => ({ state: item.state,
            actualModel: item.actualModel, failure: item.failure })) })) }
    }, activeIdentity).catch(() => null)
    if (preservePrivateProfile) evidence.privateProfilePath = profile
    writeFileSync(join(directory, 'failure.json'), JSON.stringify(evidence, null, 2))
    mark('failure-written')
    throw error
  } finally {
    if (preflightOnly) {
      let closed = false
      await Promise.race([closeSelectionApp(app).then(() => { closed = true }),
        new Promise<void>(resolve => setTimeout(resolve, 8_000))])
      if (!closed) {
        preservePrivateProfile = true
        app.process().kill()
      }
    } else await closeSelectionApp(app)
    mark('app-closed')
    if (!preservePrivateProfile) try {
      rmSync(validateRelRecoveryDirectory(privateDirectory), { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
    } catch (cleanupError) {
      writeFileSync(join(directory, 'private-profile-cleanup-error.json'), JSON.stringify({
        privateProfilePath: profile, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      }, null, 2))
    }
  }
})
