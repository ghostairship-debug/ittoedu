import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { LocalAgentRecord } from '../../src/shared/localAgentContract'

const retainedLunaEffort = process.env.R19_TEACHER_LUNA_EFFORT ?? 'high'

/** One explicitly authorized Luna repair of the retained teacher result.
 * This does not rerun the five-stage producer or imply behavioral acceptance. */
test(`r19 retained teacher Luna ${retainedLunaEffort} repair: same course and saved reopen`, async () => {
  test.skip((retainedLunaEffort === 'medium' ? process.env.R19_TEACHER_MEDIUM_RUN : process.env.R19_TEACHER_HIGH_RUN) !== '1', 'Explicit retained-course Luna repair only')
  expect(['medium', 'high']).toContain(retainedLunaEffort)
  test.setTimeout(30 * 60_000)
  const root = resolve(__dirname, '../..')
  const base = resolve(root, 'output/r19-current-teacher-luna/20260915-current-unified')
  const output = join(base, `${retainedLunaEffort}-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`); mkdirSync(output, { recursive: true })
  const context = JSON.parse(readFileSync(join(base, 'context.json'), 'utf8')) as { lesson: { schemaVersion: 1; lessonId: string; normalizedDirectory: string }; conversationId: string }
  const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: context.lesson.lessonId, normalizedDirectory: context.lesson.normalizedDirectory, conversationId: context.conversationId }
  const projectPath = join(context.lesson.normalizedDirectory, 'course.h5lesson')
  const archive = () => openCourseProjectArchive(new Uint8Array(readFileSync(projectPath)))
  const before = archive().project
  expect(before.id).toBe('project_hoksN3OuOuokYSn5i0Tpm')
  expect(before.revision).toBeGreaterThan(0)
  const documents = ['teaching-brief.md', '01-teaching-plan.md', 'presentation-brief.md', '02-presentation-script.md']
  const originalDocuments = documents.map(name => readFileSync(join(context.lesson.normalizedDirectory, name), 'utf8'))
  const instructionPath = process.env.R19_TEACHER_REPAIR_INSTRUCTION
  if (!instructionPath) throw new Error('Set the reviewed natural teacher correction file for this retained repair')
  const instruction = readFileSync(resolve(instructionPath), 'utf8')
  const evidence = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2))
  let app = await electron.launch({ args: ['.', `--user-data-dir=${join(base, 'profile')}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let page = await app.firstWindow(), activeId: string | undefined
  const list = () => page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), workspace)
  async function read(id: string) {
    let after = 0, record: LocalAgentRecord | undefined
    const events: LocalAgentRecord['events'] = []
    for (;;) {
      const reply = await page.evaluate(({ workspace, id, after }) => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace, sessionId: id, after }), { workspace, id, after })
      record = reply.records?.[0]; if (!record) throw new Error('Current repair record missing')
      const incoming = record.events.filter(event => event.sequence > after); events.push(...incoming)
      if (record.events.length < 200) break
      expect(incoming.length).toBeGreaterThan(0); after = incoming.at(-1)!.sequence
    }
    return { ...record, events }
  }
  async function openRetained() {
    const opened = await page.evaluate(directory => window.desktopAPI!.lesson!({ operation: 'open-lesson', directory }), context.lesson.normalizedDirectory)
    expect(opened.lesson!.identity.lessonId).toBe(context.lesson.lessonId)
    const conversation = opened.conversations!.find(value => value.conversationId === context.conversationId)!
    expect(conversation.projectTarget?.projectId).toBe(before.id)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, dirname(context.lesson.normalizedDirectory))
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, context.lesson.normalizedDirectory)
    await page.getByRole('button', { name: '打开课例', exact: true }).click()
    await page.getByRole('region', { name: '课例对话导航' }).getByRole('button', { name: conversation.title, exact: true }).and(page.locator('[aria-pressed]')).click()
    await page.getByRole('tab', { name: /^课件/ }).click()
    await expect(page.getByRole('button', { name: '整课预览', exact: true })).toBeVisible()
  }
  try {
    const prior = await list(); evidence('prior-session-list.json', prior)
    expect(prior.records?.some(record => record.status === 'running')).toBe(false)
    await openRetained()
    const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
    const model = directory.capabilities?.models.find(value => value.id === 'gpt-5.6-luna')
    expect(model?.effort.kind === 'supported' && model.effort.values.includes(retainedLunaEffort)).toBe(true)
    const tier = model!.serviceTiers?.find(value => /priority|fast/i.test(`${value.id} ${value.name}`)); expect(tier).toBeTruthy()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手', exact: true })
    const historyWaitStartedAt = Date.now()
    await expect(chat.getByLabel('会话', { exact: true })).toBeVisible({ timeout: 90_000 })
    evidence('retained-history-ready.json', { waitedMs: Date.now() - historyWaitStartedAt, beforeRevision: before.revision })
    const latest = [...(prior.records ?? [])].filter(record => record.adapter === 'codex').sort((left, right) => (right.generationRequest?.execution?.startedAt ?? right.events[0]?.time ?? 0) - (left.generationRequest?.execution?.startedAt ?? left.events[0]?.time ?? 0))[0]
    expect(latest, 'Retained conversation must have an existing native session').toBeTruthy()
    await chat.getByLabel('会话', { exact: true }).selectOption(latest.id)
    await expect(chat.getByLabel('CLI', { exact: true })).toHaveValue('codex')
    evidence('native-resume-boundary.json', { priorSessionId: latest.id, priorExternalSessionId: latest.externalSessionId, priorTaskStatus: latest.task?.status, beforeRevision: before.revision, mode: 'new-task-resume-codex-history' })
    const configuration = chat.getByRole('region', { name: 'CLI 模型配置' })
    if (!await configuration.locator('details').evaluate(element => element.hasAttribute('open'))) await configuration.locator('summary').click()
    await chat.getByLabel('模型', { exact: true }).selectOption(model!.id)
    await chat.getByLabel('强度', { exact: true }).selectOption(retainedLunaEffort)
    await chat.getByLabel('速度', { exact: true }).selectOption(tier!.id)
    await expect(configuration).toHaveAttribute('aria-busy', 'false')
    await expect(chat.getByLabel('强度', { exact: true })).toHaveValue(retainedLunaEffort)
    await expect(chat.getByLabel('速度', { exact: true })).toHaveValue(tier!.id)
    evidence('native-route.json', { directory, model: model!.id, effort: retainedLunaEffort, serviceTier: tier!.id, preservedBeforeRevision: before.revision })
    await chat.getByLabel('意图', { exact: true }).selectOption('edit')
    await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
    await chat.getByLabel('本轮引用', { exact: true }).selectOption('course')
    await chat.getByLabel('发送给创作助手', { exact: true }).fill(instruction)
    await page.screenshot({ path: join(output, 'before-send.png') })
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    for (let attempt = 0; !activeId && attempt < 45; attempt++) {
      const added = (await list()).records?.filter(record => !prior.records?.some(old => old.id === record.id)) ?? []
      expect(added.length).toBeLessThanOrEqual(1); activeId = added[0]?.id
      if (!activeId) {
        const errors = await chat.getByRole('alert').allTextContents()
        if (errors.length) { evidence('prelaunch-failure.json', { errors }); throw new Error(errors.join('；')) }
      }
      if (!activeId) await page.waitForTimeout(2000)
    }
    expect(activeId, 'A native task must actually start').toBeTruthy()
    await expect.poll(async () => {
      const current = await read(activeId!); evidence('current-native-record.json', current)
      return ['completed', 'failed', 'cancelled', 'partial'].includes(current.task?.status ?? current.status)
    }, { timeout: 22 * 60_000, intervals: [3000] }).toBe(true)
    const record = await read(activeId!); evidence('completed-native-record.json', record)
    const confirmed = record.events.find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
    expect(JSON.stringify(confirmed)).toContain('gpt-5.6-luna')
    expect(JSON.stringify(confirmed)).toContain(retainedLunaEffort)
    expect(JSON.stringify(confirmed)).toContain(tier!.id)
    await page.keyboard.press('Control+s')
    await expect.poll(() => archive().project.revision).toBeGreaterThanOrEqual(record.hostResult?.afterRevision ?? before.revision)
    evidence('saved-outcome.json', { projectId: archive().project.id, beforeRevision: before.revision, savedRevision: archive().project.revision, task: record.task, hostResult: record.hostResult })
    await page.screenshot({ path: join(output, 'saved-result.png') })
    writeFileSync(join(output, 'saved-chat.txt'), await chat.innerText())
    expect(archive().project.id).toBe(before.id)
    expect(archive().project.surfaces.map(surface => surface.type)).toEqual(expect.arrayContaining(['slide', 'flow', 'spatial-2d']))
    documents.forEach((name, index) => expect(readFileSync(join(context.lesson.normalizedDirectory, name), 'utf8')).toBe(originalDocuments[index]))
    await app.close()
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(base, 'profile')}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow(); activeId = undefined
    await openRetained()
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    await expect(page.getByTestId('course-preview-host')).toBeVisible()
    await page.screenshot({ path: join(output, 'saved-reopened-preview.png') })
    evidence('engineering-result.json', { nativeTaskStatus: record.task?.status, committedStages: record.task?.committedStages, savedProjectId: archive().project.id, savedRevision: archive().project.revision, reopened: true, behaviorAcceptance: 'not-inferred-from-engineering-result' })
    await page.getByTestId('course-preview-overlay').getByRole('button', { name: '关闭预览', exact: true }).click()
    evidence('saved-reopened.json', { projectId: archive().project.id, revision: archive().project.revision, locations: archive().project.locations, behaviorAcceptance: 'pending-real-interaction-review' })
    expect(record.task?.status, 'A failed or partial repair is not accepted; saved and reopened evidence is retained').toBe('completed')
    expect(record.task?.committedStages).toBeGreaterThan(0)
  } finally {
    if (activeId && (await list()).records?.some(record => record.id === activeId && record.status === 'running')) await page.evaluate(({ workspace, id }) => window.desktopAPI!.localAgent({ operation: 'lesson-cancel', workspace, sessionId: id }), { workspace, id: activeId })
    await page.keyboard.press('Control+s').catch(() => {})
    await app.close()
  }
})
