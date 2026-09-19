import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { workspaceIdentityKey } from '../../src/shared/workspaceIdentity'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { LocalAgentRecord } from '../../src/shared/localAgentContract'
import { selectReferenceScope } from './chatReferenceTarget'

/** One explicitly authorized Claude-channel DeepSeek repair of the retained teacher result.
 * This does not rerun the five-stage producer or imply behavioral acceptance. */
test('r19 retained teacher Claude DeepSeek repair: same course and saved reopen', async () => {
  test.skip(process.env.R19_TEACHER_DEEPSEEK_RUN !== '1', 'Explicit retained-course DeepSeek high repair only')
  test.setTimeout(30 * 60_000)
  const root = resolve(__dirname, '../..')
  const base = resolve(root, 'output/r19-current-teacher-luna/20260915-current-unified')
  const output = join(base, `claude-deepseek-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`); mkdirSync(output, { recursive: true })
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
  let initialRequestId: string | undefined
  const feedbackRoots: Record<string, { candidateRoot: string; requestFileExists: boolean; requestIdMatches: boolean; checkedAt: string; nativeToolReferencedRequest: boolean; missingOrInvalidObserved: boolean }> = {}
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
    // V3.1：保留 profile 重开自动回到上次工作空间；课例入口已从「更多」菜单移除，经目录树点选 .h5lesson 激活；课例对话导航区已随课例段取消，激活后自动接上最近会话
    await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: basename(context.lesson.normalizedDirectory), exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
    await expect(page.locator('.lesson-workflow')).toBeVisible()
    await page.getByRole('tab', { name: /course|新建课件/ }).click()
    await expect(page.getByRole('button', { name: '整课预览', exact: true })).toBeVisible()
  }
  try {
    const prior = await list(); evidence('prior-session-list.json', prior)
    expect(prior.records?.some(record => record.status === 'running')).toBe(false)
    await openRetained()
    const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'claude', refresh: true }))
    const model = directory.capabilities?.models.find(value => value.id === 'deepseek-flash[1M]')
    expect(model?.effort.kind === 'supported' && model.effort.values.includes('high')).toBe(true)
    expect(model?.resolvedModel?.toLowerCase()).toBe('deepseek-flash[1m]')
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手', exact: true })
    // The retained lesson loads historical records before exposing CourseChat.
    // A missing selector during that load is not a request to re-save the stage.
    const historyWaitStartedAt = Date.now()
    await expect(chat.getByLabel('会话', { exact: true })).toBeVisible({ timeout: 90_000 })
    evidence('retained-history-ready.json', { waitedMs: Date.now() - historyWaitStartedAt, originalProjectId: before.id, beforeRevision: before.revision })
    const retainedClaude = [...(prior.records ?? [])].filter(record => record.adapter === 'claude').sort((left, right) => (right.generationRequest?.execution?.startedAt ?? 0) - (left.generationRequest?.execution?.startedAt ?? 0))[0]
    if (retainedClaude) {
      await chat.getByLabel('会话', { exact: true }).selectOption(retainedClaude.id)
      await expect(chat.getByLabel('CLI', { exact: true })).toHaveValue('claude')
    } else {
      await chat.getByLabel('会话', { exact: true }).selectOption('')
      await chat.getByLabel('CLI', { exact: true }).selectOption('claude')
    }
    evidence('native-resume-boundary.json', { priorSessionId: retainedClaude?.id ?? null, priorExternalSessionId: retainedClaude?.externalSessionId ?? null, priorTaskStatus: retainedClaude?.task?.status ?? null, mode: retainedClaude ? 'new-task-resume-native-history' : 'new-native-session', beforeRevision: before.revision })
    const configuration = chat.getByRole('region', { name: 'CLI 模型配置' })
    if (!await configuration.locator('details').evaluate(element => element.hasAttribute('open'))) await configuration.locator('summary').click()
    await chat.getByLabel('模型', { exact: true }).selectOption(model!.id)
    await chat.getByLabel('强度', { exact: true }).selectOption('high')
    await expect(configuration).toHaveAttribute('aria-busy', 'false')
    await expect(chat.getByLabel('强度', { exact: true })).toHaveValue('high')
    evidence('native-route.json', { directory, model: model!.id, effort: 'high', serviceTier: null, speed: 'not-exposed-by-native-directory', preservedBeforeRevision: before.revision })
    await chat.getByLabel('意图', { exact: true }).selectOption('edit')
    await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
    await selectReferenceScope(chat, 'course')
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
      const requestId = current.generationRequestId
      initialRequestId ??= requestId
      if (requestId && initialRequestId && requestId !== initialRequestId && current.status === 'running') {
        const repository = join(base, 'profile', 'local-agent', 'v3')
        const scope = createHash('sha256').update(workspaceIdentityKey(current.workspace)).digest('hex')
        if (existsSync(join(repository, scope, `${current.id}.json`))) {
          const candidateRoot = join(repository, scope, current.workingDirectoryId ?? current.id, 'staging', 'candidates', requestId)
          const requestFile = join(candidateRoot, 'request.json')
          const requestFileExists = existsSync(requestFile)
          let requestIdMatches = false
          try {
            const requestDocument = JSON.parse(readFileSync(requestFile, 'utf8')) as { requestId: string; resourceIndex?: { path: string; localPath?: string }[] }
            requestIdMatches = requestDocument.requestId === requestId
            const repairIndexes = (requestDocument.resourceIndex ?? []).filter(resource => /^resources\/repair\/component-changes-[^/]+\/index\.json$/.test(resource.path))
            const repairEvidence = repairIndexes.map(resource => {
              const localPath = resource.localPath ?? join(candidateRoot, ...resource.path.split('/'))
              let index: { purpose?: string; origin?: unknown; changes?: unknown[] } | undefined
              try { index = JSON.parse(readFileSync(localPath, 'utf8')) } catch { /* Preserve unreadable evidence. */ }
              const referenceEvents = current.events.filter(event => event.kind === 'tool-call' && JSON.stringify(event.payload).includes(resource.path.replace('resources/', '')))
              return { path: resource.path, localPath, readable: !!index, purpose: index?.purpose, origin: index?.origin, changesCount: index?.changes?.length ?? 0,
                nativeReferenceSequences: referenceEvents.map(event => event.sequence), nativeReadStatus: referenceEvents.length ? 'referenced-by-tool-review-result-before-claiming-read' : 'not-yet-observed' }
            })
            evidence(`feedback-repair-inputs-${requestId}.json`, { requestId, repairIndexes: repairEvidence, reuseRequiredForThisRun: false })
          } catch { /* Record a missing/invalid request without interrupting native work. */ }
          const nativeToolReferencedRequest = current.events.some(event => event.kind === 'tool-call' && JSON.stringify(event.payload).includes(requestId) && JSON.stringify(event.payload).includes('request.json'))
          if (!feedbackRoots[requestId]) evidence(`first-feedback-root-${requestId}.json`, { candidateRoot, requestFileExists, requestIdMatches, checkedAt: new Date().toISOString() })
          feedbackRoots[requestId] = { candidateRoot, requestFileExists, requestIdMatches, checkedAt: new Date().toISOString(), nativeToolReferencedRequest: nativeToolReferencedRequest || feedbackRoots[requestId]?.nativeToolReferencedRequest === true, missingOrInvalidObserved: !requestFileExists || !requestIdMatches || feedbackRoots[requestId]?.missingOrInvalidObserved === true }
          evidence('feedback-root-observations.json', feedbackRoots)
        }
      }
      return ['completed', 'failed', 'cancelled', 'partial'].includes(current.task?.status ?? current.status)
    }, { timeout: 22 * 60_000, intervals: [3000] }).toBe(true)
    const record = await read(activeId!); evidence('completed-native-record.json', record)
    const confirmed = record.events.find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
    expect(confirmed?.payload).toEqual(expect.objectContaining({ capabilities: expect.objectContaining({ adapter: 'claude', current: expect.objectContaining({ model: 'deepseek-flash[1M]', effort: 'high' }) }) }))
    const nativeResolved = record.events.filter(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
    evidence('native-configuration-events.json', nativeResolved)
    expect(JSON.stringify(nativeResolved).toLowerCase()).toContain('deepseek-flash[1m]')
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
    const preview = page.getByTestId('course-preview-host')
    const operationCount = await preview.getByRole('button', { name: /操作.*开关|操作.*电路|验证.*预测/ }).count()
    evidence('reopened-behavior-smoke.json', { status: operationCount > 0 ? 'smoke-passed-full-QA-pending' : 'failed', operationCount, buttons: await preview.getByRole('button').allTextContents(), fullBehaviorAcceptance: 'pending-separate-real-QA' })
    expect(operationCount, 'Reopened Slide must expose a real operation control; a blank component is a failure').toBeGreaterThan(0)
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
