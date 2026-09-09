import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nativeParityExecutable, nativeParityPrompt, PARITY_EFFORT, PARITY_MODEL, runIndependentNativeParity } from '../../scripts/r18-native-parity-probe'
import { closeNativeEditor, launchNativeEditor, nativeRecords, readSaved, recordEvidence, selectLayer, writeNativeLesson,
  FIXTURE_IDS, type NativeRun } from './r18NativeAuthoringFixture'
import { beginNatural, chat, configureRemainingChat } from './r18NativeAuthoringRemainingFixture'

const productRoot = resolve(__dirname, '../..')
const gate = process.env.COURSEWARE_R18_NATIVE_PARITY === 'opencode-pair-once'
const requestedRoot = process.env.COURSEWARE_R18_NATIVE_PARITY_ROOT

function cancellationBase() {
  if (!requestedRoot) throw new Error('Cancellation must reference the retained original pair')
  const root = resolve(requestedRoot), base = join(productRoot, 'output/r18-native-parity')
  if (!root.toLowerCase().startsWith(base.toLowerCase() + '\\')) throw new Error('Cancellation source outside owned output')
  const previous = JSON.parse(readFileSync(join(root, 'semantic-summary.json'), 'utf8'))
  if (previous.status !== 'network-skill-allow-reject-actual-pair-confirmed' || previous.parentTurns !== 2) throw new Error('Prior pair is not the reviewed two-parent evidence')
  return { root, cwd: join(root, 'workspace'), projectPath: join(root, 'workspace/parity.h5lesson'), base }
}

test('R18 cancellation actual GUI selector preflight without a model turn', async () => {
  test.skip(process.env.COURSEWARE_R18_NATIVE_PARITY !== 'opencode-cancel-preflight', 'Explicit zero-model selector gate')
  test.setTimeout(120_000)
  const { root, cwd, projectPath, base } = cancellationBase()
  const runRoot = join(cwd, 'cancel-selector-preflight'), profilePath = join(base, 'p-cancel-preflight')
  mkdirSync(runRoot, { recursive: true })
  const original = readSaved(projectPath)
  const run = await launchNativeEditor(productRoot, runRoot, projectPath, { sourceRoot: cwd, projectPath, profilePath })
  try {
    await selectLayer(run.page, FIXTURE_IDS.image)
    await configureRemainingChat(run, 'opencode', PARITY_MODEL, PARITY_EFFORT)
    await chat(run).getByLabel('意图', { exact: true }).selectOption('discuss')
    const stop = chat(run).getByRole('button', { name: '停止', exact: true })
    await expect(stop).toHaveCount(1); await expect(stop).toBeDisabled()
    await expect(chat(run).getByRole('region', { name: 'CLI 授权请求', exact: true })).toHaveCount(0)
    await expect(chat(run).getByLabel('发送给创作助手', { exact: true })).toBeEditable()
    expect(nativeRecords(run).flatMap(record => record.events).filter(event => event.kind === 'tool')).toHaveLength(0)
    expect(readSaved(projectPath)).toEqual(original)
    writeFileSync(join(root, 'cancellation-ui-preflight.json'), JSON.stringify({ status: 'passed', modelTurns: 0,
      stopSelector: 'CLI 创作助手 > button exact 停止', stopCount: 1, disabledBeforePrompt: true,
      pendingRegionSelectorReusedFromActualAllowReject: true, profilePath, projectUnchanged: true,
      at: new Date().toISOString() }, null, 2))
  } finally { await closeNativeEditor(run) }
})

test('R18 native and GUI cancel only while an actual permission is pending', async () => {
  test.skip(process.env.COURSEWARE_R18_NATIVE_PARITY !== 'opencode-cancel-pair-once', 'Two authorized cancellation-only parent turns')
  test.setTimeout(10 * 60_000)
  const { root, cwd, projectPath, base } = cancellationBase()
  const preflight = JSON.parse(readFileSync(join(root, 'cancellation-ui-preflight.json'), 'utf8'))
  expect(preflight.status).toBe('passed'); expect(preflight.modelTurns).toBe(0)
  const cancelOut = join(root, 'cancellation'), nativeOut = join(cancelOut, 'native'), guiOut = join(cwd, 'cancellation-gui')
  for (const dir of [cancelOut, nativeOut, guiOut]) mkdirSync(dir, { recursive: true })
  const external = { allow: join(root, 'external-allow/probe.txt'), deny: join(root, 'external-deny/probe.txt'), cancel: join(root, 'external-cancel/probe.txt') }
  const marker = readFileSync(external.cancel, 'utf8').trim(), original = readSaved(projectPath)
  const prompt = `只做一次原生Read尝试：读取 ${external.cancel}。这是一份自制无敏感测试文件。出现原生权限询问时等待用户处理；用户取消后立即停止，不重试、不换工具、不读其他文件、不联网、不启动子任务、不改课件或设置。`
  const summary: Record<string, any> = { kind: 'pending-permission-cancellation-only', originalPair: root, cwd,
    authorizedAdditionalParentTurns: 2, prompt, status: 'starting' }
  let run: NativeRun | undefined
  try {
    const nativeResultPath = join(nativeOut, 'native-result.json')
    const native = existsSync(nativeResultPath) ? JSON.parse(readFileSync(nativeResultPath, 'utf8'))
      : await runIndependentNativeParity({ cwd, out: nativeOut, prompt, external, turnTimeoutMs: 180_000 })
    summary.native = native
    expect(native.parentTurns).toBe(1)
    expect(native.status, native.failure).toBe('cancelled-after-observed-native-permission')
    expect(native.permissions.map((item: any) => [item.target, item.decision])).toEqual([['cancel', 'cancelled']])
    expect(readFileSync(join(nativeOut, 'native-acp.jsonl'), 'utf8')).not.toContain(marker)
    summary.nativeDeniedContentAbsent = true
    expect(readSaved(projectPath)).toEqual(original)
    const sentinel = join(guiOut, 'gui-parent-started.json')
    if (existsSync(sentinel)) throw new Error('The cancellation GUI parent was already spent; do not replay it')
    const profilePath = join(base, 'p-cancel-actual')
    run = await launchNativeEditor(productRoot, guiOut, projectPath, { sourceRoot: cwd, projectPath, profilePath })
    await selectLayer(run.page, FIXTURE_IDS.image)
    await configureRemainingChat(run, 'opencode', PARITY_MODEL, PARITY_EFFORT)
    await chat(run).getByLabel('意图', { exact: true }).selectOption('discuss')
    await expect(chat(run).getByRole('button', { name: '停止', exact: true })).toHaveCount(1)
    writeFileSync(sentinel, JSON.stringify({ prompt, at: new Date().toISOString() }, null, 2), { flag: 'wx' })
    await beginNatural(run, 'cancel-only', prompt)
    const permissionRegion = chat(run).getByRole('region', { name: 'CLI 授权请求', exact: true })
    await expect(permissionRegion).toBeVisible({ timeout: 180_000 })
    const recordBefore = nativeRecords(run).at(-1)!
    const permission = [...recordBefore.events].reverse().find(event => event.kind === 'question' && event.question.purpose === 'permission')
    if (!permission || permission.kind !== 'question') throw new Error('Visible permission did not have its real persisted native request')
    expect(permission.question.questions.map(item => item.title).join('\n')).toContain('external-cancel')
    summary.gui = { parentTurns: 1, nativeSessionId: recordBefore.externalSessionId, permission: permission.question,
      pendingObservedAt: new Date().toISOString(), action: 'actual normal GUI Stop button; no option selected' }
    await permissionRegion.locator('fieldset').screenshot({ path: join(guiOut, 'pending-permission.png') })
    await chat(run).getByRole('button', { name: '停止', exact: true }).click()
    summary.gui.stopClickedAt = new Date().toISOString()
    await expect(chat(run).getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 15_000 })
    await expect.poll(() => nativeRecords(run!).at(-1)?.tasks.at(-1)?.status, { timeout: 15_000 }).toBe('cancelled')
    await expect(permissionRegion).toHaveCount(0)
    const evidence = await recordEvidence(run, 'final'), recordAfter = evidence.records.at(-1)!
    summary.gui.terminalStatus = recordAfter.tasks.at(-1)?.status
    summary.gui.terminalEvents = recordAfter.events.filter(event => event.kind === 'turn-ended')
    summary.gui.configuration = recordAfter.events.filter(event => event.kind === 'configuration').map(event => event.capabilities.current)
    expect(recordAfter.events.some(event => event.kind === 'configuration' && event.capabilities.current.model === PARITY_MODEL && event.capabilities.current.effort === PARITY_EFFORT)).toBe(true)
    expect(recordAfter.externalSessionId).not.toBe(native.sessionId)
    expect(recordAfter.hostResults).toHaveLength(0)
    expect(JSON.stringify(evidence)).not.toContain(marker)
    expect(readSaved(projectPath)).toEqual(original)
    expect(readFileSync(external.cancel, 'utf8').trim()).toBe(marker)
    summary.guiDeniedContentAbsent = true; summary.projectUnchanged = true
    summary.status = 'actual-native-and-gui-pending-permission-cancel-confirmed'
  } catch (error) {
    summary.status = 'failed'; summary.failure = error instanceof Error ? error.stack : String(error)
    if (run) await recordEvidence(run, 'failure')
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    summary.finishedAt = new Date().toISOString()
    writeFileSync(join(cancelOut, 'summary.json'), JSON.stringify(summary, null, 2))
  }
})

test('R18 independent OpenCode native and actual GUI read-only capability parity', async () => {
  test.skip(!gate, 'Two explicitly authorized parent turns only; closed by default')
  test.setTimeout(23 * 60_000)
  const base = join(productRoot, 'output/r18-native-parity')
  const root = requestedRoot ? resolve(requestedRoot) : join(base, new Date().toISOString().replace(/[:.]/g, '-'))
  if (!root.toLowerCase().startsWith(base.toLowerCase() + '\\') && !root.toLowerCase().startsWith(base.toLowerCase() + '/')) throw new Error('Parity output must stay in its owned directory')
  const cwd = join(root, 'workspace'), directOut = join(root, 'native'), guiOut = join(cwd, 'gui')
  for (const dir of [root, cwd, directOut, guiOut]) mkdirSync(dir, { recursive: true })
  // Make the three sibling files genuinely external to OpenCode's Git worktree.
  // This is a new empty test repository with no commits, inside owned output only.
  if (!existsSync(join(cwd, '.git'))) execFileSync('git', ['init', '--quiet'], { cwd, windowsHide: true })
  const external = { allow: join(root, 'external-allow/probe.txt'), deny: join(root, 'external-deny/probe.txt'), cancel: join(root, 'external-cancel/probe.txt') }
  for (const file of Object.values(external)) {
    mkdirSync(resolve(file, '..'), { recursive: true })
    if (!existsSync(file)) writeFileSync(file, `Synthetic public parity marker ${randomUUID()}\n`, { flag: 'wx' })
  }
  const sourceContents = Object.fromEntries(Object.entries(external).map(([key, file]) => [key, readFileSync(file, 'utf8')]))
  const projectPath = join(cwd, 'parity.h5lesson')
  if (!existsSync(projectPath)) await writeNativeLesson(projectPath)
  const original = readSaved(projectPath)
  const profilePath = join(base, 'p-' + root.split(/[\\/]/).at(-1)!.replace(/[^0-9]/g, '').slice(-14))
  const executable = nativeParityExecutable()
  const debug = (args: string[]) => JSON.parse(execFileSync(executable, ['debug', ...args], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))
  const config = debug(['config']), agent = debug(['agent', 'orchestrator']), skills = debug(['skill'])
  const metadata = {
    version: execFileSync(executable, ['--version'], { cwd, windowsHide: true, encoding: 'utf8' }).trim(), cwd, profilePath,
    permission: agent.permission, defaultAgent: config.default_agent,
    configuredMcp: Object.entries(config.mcp ?? {}).map(([name, entry]: [string, any]) => ({ name, type: entry.type, enabled: entry.enabled ?? 'native-default' })),
    skills: skills.map((skill: any) => ({ name: skill.name, location: skill.location })),
    agents: Object.entries(config.agent ?? {}).map(([name, entry]: [string, any]) => ({ name, model: entry.model ?? null, disabled: entry.disable === true })),
    noGlobalSettingsChanged: true, noSubtasksAllowed: true,
  }
  expect(metadata.version).toBe('1.18.26')
  expect(config.agent.general.disable).toBe(true)
  expect(skills.some((skill: any) => skill.name === 'codemap')).toBe(true)
  writeFileSync(join(root, 'configuration-metadata.json'), JSON.stringify(metadata, null, 2))
  const prompt = nativeParityPrompt(external)
  writeFileSync(join(root, 'prompt.txt'), prompt)
  const manifest: Record<string, any> = { kind: 'r18-native-parity', root, cwd, projectPath, profilePath,
    expectedParentTurns: 2, nativeTransport: 'independent raw ACP client; no product transport imported',
    guiTransport: 'actual built Electron Main and OpenCode adapter, ordinary question UI',
    subtask: 'not-applicable: current configured subagents violate Luna-only route; general disabled', status: 'starting' }
  let run: NativeRun | undefined
  try {
    const directResultPath = join(directOut, 'native-result.json')
    const native = existsSync(directResultPath) ? JSON.parse(readFileSync(directResultPath, 'utf8'))
      : await runIndependentNativeParity({ cwd, out: directOut, prompt, external })
    manifest.native = native
    writeFileSync(join(root, 'run.json'), JSON.stringify(manifest, null, 2))
    expect(native.parentTurns).toBe(1)
    expect(native.status, native.failure).not.toBe('failed')
    expect(readSaved(projectPath)).toEqual(original)
    const guiSentinel = join(guiOut, 'gui-parent-started.json')
    if (existsSync(guiSentinel)) throw new Error('GUI parent turn already spent; do not replay it')
    run = await launchNativeEditor(productRoot, guiOut, projectPath, { sourceRoot: cwd, projectPath, profilePath })
    await selectLayer(run.page, FIXTURE_IDS.image)
    await configureRemainingChat(run, 'opencode', PARITY_MODEL, PARITY_EFFORT)
    await chat(run).getByLabel('意图', { exact: true }).selectOption('discuss')
    writeFileSync(guiSentinel, JSON.stringify({ at: new Date().toISOString(), prompt }, null, 2), { flag: 'wx' })
    await beginNatural(run, 'parity', prompt)
    const permissions: any[] = [], seen = new Set<string>()
    manifest.gui = { parentTurns: 1, permissions, status: 'running' }
    const deadline = Date.now() + 10 * 60_000
    while (Date.now() < deadline) {
      const record = nativeRecords(run).at(-1)
      for (const event of record?.events ?? []) {
        if (event.kind !== 'question' || event.question.purpose !== 'permission' || seen.has(event.question.questionId)) continue
        const description = event.question.questions.map(item => item.title).join('\n').replace(/\\/g, '/').toLowerCase()
        const target = (['allow', 'deny', 'cancel'] as const).find(key => description.includes(`external-${key}`))
        if (!target) throw new Error('Unexpected actual GUI authorization; stop without guessing a decision')
        const section = chat(run).getByRole('region', { name: 'CLI 授权请求', exact: true }).filter({ has: run.page.locator(`input[name="${event.question.questions[0]!.id}"]`) })
        await expect(section).toBeVisible()
        const screenshot = join(guiOut, `${permissions.length + 1}-${target}-permission.png`)
        await section.screenshot({ path: screenshot })
        const proof: Record<string, any> = { target, question: event.question, screenshot, decisionAt: new Date().toISOString() }
        permissions.push(proof); seen.add(event.question.questionId)
        if (target === 'cancel') {
          proof.action = 'actual GUI Stop button while native permission is pending'
          await chat(run).getByRole('button', { name: '停止', exact: true }).click()
        } else {
          const labels = await section.getByRole('radio').evaluateAll(radios => radios.map(radio => radio.closest('label')?.textContent ?? ''))
          const option = labels.find(label => target === 'allow' ? /allow once|允许一次|允许本次/i.test(label) : /reject once|reject|deny|拒绝/i.test(label))
          if (!option) throw new Error(`No matching native one-time ${target} choice: ${JSON.stringify(labels)}`)
          if (/always|总是|始终/i.test(option)) throw new Error('Persistent native grants are outside this one-time probe')
          proof.action = option
          await section.getByRole('radio', { name: option, exact: true }).check()
          await section.getByRole('button', { name: '确认选择', exact: true }).click()
        }
        writeFileSync(join(root, 'run.json'), JSON.stringify(manifest, null, 2))
      }
      if (record?.tasks.at(-1)?.status && ['completed', 'failed', 'cancelled'].includes(record.tasks.at(-1)!.status)
        && !(await chat(run).getByRole('button', { name: '停止', exact: true }).isEnabled())) break
      await run.page.waitForTimeout(500)
    }
    const evidence = await recordEvidence(run, 'final')
    const record = evidence.records.at(-1)!
    manifest.gui.nativeSessionId = record.externalSessionId
    manifest.gui.status = record.tasks.at(-1)?.status
    manifest.gui.configuration = record.events.filter(event => event.kind === 'configuration').map(event => event.capabilities.current)
    expect(record.externalSessionId).not.toBe(native.sessionId)
    expect(record.events.some(event => event.kind === 'configuration' && event.capabilities.current.model === PARITY_MODEL && event.capabilities.current.effort === PARITY_EFFORT)).toBe(true)
    expect(['completed', 'failed', 'cancelled']).toContain(record.tasks.at(-1)?.status)
    expect(record.hostResults).toHaveLength(0)
    expect(readSaved(projectPath)).toEqual(original)
    for (const [key, file] of Object.entries(external)) expect(readFileSync(file, 'utf8')).toBe(sourceContents[key])
    manifest.nativePermissionSequence = native.permissions.map((item: any) => ({ target: item.target, decision: item.decision }))
    manifest.guiPermissionSequence = permissions.map(item => ({ target: item.target, action: item.action }))
    manifest.status = 'actual-pair-recorded-awaiting-semantic-review'
    manifest.projectUnchanged = true
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = error instanceof Error ? error.stack : String(error)
    if (run) { await recordEvidence(run, 'failure'); await run.page.screenshot({ path: join(guiOut, 'failure.png') }).catch(() => {}) }
    throw error
  } finally {
    if (run) await closeNativeEditor(run)
    manifest.finishedAt = new Date().toISOString()
    writeFileSync(join(root, 'run.json'), JSON.stringify(manifest, null, 2))
  }
})
