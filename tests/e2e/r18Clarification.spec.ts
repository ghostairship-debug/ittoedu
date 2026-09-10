import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  FIXTURE_IDS, closeNativeEditor, launchNativeEditor, nativeRecords, preserveNativeFailure, readSaved,
  recordEvidence, saveStage, selectLayer, sendNatural, titleItem, writeNativeLesson, type NativeCli, type NativeRun,
} from './r18NativeAuthoringFixture'
import {
  REMAINING_PROMPTS, assertSavedUnchanged, chat, confirmConfiguration, configureRemainingChat, saveVisualReview,
} from './r18NativeAuthoringRemainingFixture'

const productRoot = resolve(__dirname, '..', '..')
const adapter = (process.env.COURSEWARE_R18_NATIVE_CLI ?? 'opencode') as NativeCli
const model = process.env.COURSEWARE_R18_NATIVE_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_NATIVE_EFFORT ?? ''
const gate = process.env.COURSEWARE_R18_CLARIFICATION_GATE ?? ''
const turnTimeoutMs = 20 * 60_000
const expectedTitle = '波动的秘密'

function taskFor(run: NativeRun, goal: string) {
  const matches = nativeRecords(run).flatMap(record => record.tasks.filter(task => task.goal === goal).map(task => ({ record, task })))
  expect(matches, 'Each original user message has one retained task; no automatic resend is allowed').toHaveLength(1)
  return matches[0]!
}

function assertTerminal(run: NativeRun, goal: string, intent: 'discuss' | 'edit') {
  const current = taskFor(run, goal)
  expect(current.task).toMatchObject({ goal, intent, status: 'completed', pendingInputs: [] })
  confirmConfiguration(current.record, adapter, model, effort)
  const taskEvents = current.record.events.filter(event => event.taskId === current.task.taskId)
  expect(taskEvents.filter(event => event.kind === 'turn-ended' && event.status === 'failed'),
    'A later successful answer must not hide a failed question turn').toHaveLength(0)
  expect(taskEvents.some(event => event.kind === 'turn-ended' && event.status === 'completed')).toBe(true)
  return current
}

function committedResults(record: LocalAgentRecordV2, taskId: string) {
  return record.hostResults.filter(result => result.taskId === taskId && result.status === 'committed')
}

test(`R18 ${adapter} T11 text clarification: zero-write question, answered edit and same native session`, async ({}, testInfo) => {
  test.skip(!gate, 'Explicit clarification native gate is closed; discovery or a skipped test is not a passed run.')
  expect(gate).toBe('clarification')
  expect(adapter, 'This regression targets OpenCode plain-text clarification, not structured native questions').toBe('opencode')
  expect(model, 'Freeze COURSEWARE_R18_NATIVE_MODEL before opening this real native gate').not.toBe('')
  expect(effort, 'Freeze COURSEWARE_R18_NATIVE_EFFORT or the explicit value default').not.toBe('')
  test.setTimeout(2 * turnTimeoutMs + 180_000)
  const runRoot = join(productRoot, 'output', 'r18-clarification', `${adapter}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson')
  let baseline = await writeNativeLesson(projectPath)
  // Keep this question/answer regression independent of auto-height reflow.
  // The original five-character title fits the unchanged fixed frame, as does
  // the five-character answer. No answer or candidate is preloaded.
  titleItem(baseline.project).content.data.style.overflow = 'fixed'
  writeFileSync(projectPath, createCourseProjectArchive(baseline))
  baseline = readSaved(projectPath)
  const result: Record<string, unknown> = {
    status: 'running', adapter, requestedModel: model, requestedEffort: effort,
    prompts: { question: REMAINING_PROMPTS.T11Ask, answer: REMAINING_PROMPTS.T11Answer },
    fixture: 'Fresh saved V9 title/image/square fixture; title uses a fixed frame',
    projectPath, runRoot, startedAt: new Date().toISOString(), noAutomaticRetries: true,
    userMessages: 2, internalModelRequestCount: null, ownerAcceptance: false,
    scope: 'One plain-text question and its answered edit in the same native session; separate user requests have separate AiTask IDs',
  }
  const persist = () => writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2))
  persist()
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    await selectLayer(run.page, FIXTURE_IDS.title)
    await configureRemainingChat(run, adapter, model, effort)
    await chat(run).getByLabel('意图', { exact: true }).selectOption('edit')
    await chat(run).getByLabel('应用方式', { exact: true }).selectOption('auto')
    await assertSavedUnchanged(run, 'before-question', baseline)

    // Wait for the entire first turn. Looking only for a question substring
    // would reproduce the old false pass: the host subsequently marked it failed.
    await sendNatural(run, 'T11-question', REMAINING_PROMPTS.T11Ask, turnTimeoutMs)
    const question = assertTerminal(run, REMAINING_PROMPTS.T11Ask, 'discuss')
    expect(question.task.committedResultIds).toHaveLength(0)
    expect(question.record.hostResults.filter(value => value.taskId === question.task.taskId)).toHaveLength(0)
    expect(question.record.events.filter(event => event.taskId === question.task.taskId && event.kind === 'question'
      && event.question.purpose !== 'permission'), 'OpenCode declares text clarification, so do not invent a structured question receipt').toHaveLength(0)
    const configuration = question.record.events.filter(event => event.kind === 'configuration').at(-1)
    if (configuration?.kind !== 'configuration') throw new Error('Missing native configuration evidence')
    expect(configuration.capabilities.input.question).toBe('text')
    await expect(chat(run).getByRole('alert')).toHaveCount(0)
    const visibleReply = await saveVisualReview(run, 'T11-question-visible', chat(run).locator('.chat-scroll > .chat-message').last())
    expect(visibleReply).toMatch(/标题/)
    expect(visibleReply).toMatch(/什么|哪|请告诉|请问|请提供|[？?]/)
    await assertSavedUnchanged(run, 'T11-before-answer', baseline)
    await expect(run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true })).toBeDisabled()
    result.question = { recordId: question.record.id, taskId: question.task.taskId,
      externalSessionId: question.record.externalSessionId, taskStatus: question.task.status, intent: question.task.intent,
      visibleReply, completedAt: new Date().toISOString(), projectRevision: baseline.project.revision }
    persist()

    await sendNatural(run, 'T11-answer', REMAINING_PROMPTS.T11Answer, turnTimeoutMs)
    const answer = assertTerminal(run, REMAINING_PROMPTS.T11Answer, 'edit')
    expect(answer.record.externalSessionId).toBe(question.record.externalSessionId)
    expect(answer.task.taskId, 'The user answer is an explicit new request in the confirmed native conversation').not.toBe(question.task.taskId)
    const commits = committedResults(answer.record, answer.task.taskId)
    expect(commits, 'The answer must produce exactly one actual title transaction').toHaveLength(1)
    expect(commits[0]).toMatchObject({ beforeRevision: baseline.project.revision, afterRevision: baseline.project.revision + 1 })
    expect(commits[0]!.receipts).toHaveLength(1)
    expect(answer.task.committedResultIds).toEqual([commits[0]!.resultId])
    await expect(chat(run).getByRole('alert')).toHaveCount(0)
    const applied = await saveStage(run, 'T11-answered')
    const expected = structuredClone(baseline)
    expected.project.revision++
    expect(Date.parse(applied.project.updatedAt)).toBeGreaterThan(Date.parse(baseline.project.updatedAt))
    expect(Date.parse(applied.project.updatedAt)).toBeLessThanOrEqual(Date.now())
    expected.project.updatedAt = applied.project.updatedAt
    titleItem(expected.project).content.data.text = expectedTitle
    expect(applied.project, 'Only the requested title text and its one transaction revision/clock may change').toEqual(expected.project)
    expect(applied.assetFiles).toEqual(baseline.assetFiles)
    expect(applied.componentFiles).toEqual(baseline.componentFiles)
    await saveVisualReview(run, 'T11-answer-visible', chat(run).locator('.chat-scroll > .chat-message').last())
    assertTerminal(run, REMAINING_PROMPTS.T11Ask, 'discuss')
    result.answer = { recordId: answer.record.id, taskId: answer.task.taskId, externalSessionId: answer.record.externalSessionId,
      taskStatus: answer.task.status, committedResultId: commits[0]!.resultId, completedAt: new Date().toISOString(),
      beforeRevision: baseline.project.revision, afterRevision: applied.project.revision }
    persist()

    await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
    await assertSavedUnchanged(run, 'one-undo', baseline)
    await expect(run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true })).toBeDisabled()
    await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await assertSavedUnchanged(run, 'one-redo', applied)
    await expect(run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true })).toBeDisabled()
    await recordEvidence(run, 'before-reopen')
    expect(run.pageErrors).toEqual([])
    await closeNativeEditor(run); run = undefined

    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    await assertSavedUnchanged(run, 'reopened', applied)
    const reopenedQuestion = assertTerminal(run, REMAINING_PROMPTS.T11Ask, 'discuss')
    const reopenedAnswer = assertTerminal(run, REMAINING_PROMPTS.T11Answer, 'edit')
    expect(reopenedQuestion.task.taskId).toBe(question.task.taskId)
    expect(reopenedQuestion.record.externalSessionId).toBe(question.record.externalSessionId)
    expect(reopenedQuestion.record.hostResults.filter(value => value.taskId === question.task.taskId)).toHaveLength(0)
    expect(reopenedAnswer.task.taskId).toBe(answer.task.taskId)
    expect(reopenedAnswer.record.externalSessionId).toBe(answer.record.externalSessionId)
    expect(committedResults(reopenedAnswer.record, answer.task.taskId).map(value => value.resultId)).toEqual([commits[0]!.resultId])
    await recordEvidence(run, 'reopened')
    expect(run.pageErrors).toEqual([])
    result.status = 'engineering-checks-passed-awaiting-visual-review'
    result.visualReview = 'Review the actual question/answer and before/after/reopened screenshots; one bounded sample is not a repeated reliability gate or Owner acceptance.'
  } catch (error) {
    result.status = 'failed'
    result.failure = error instanceof Error ? error.stack : String(error)
    if (run) {
      await recordEvidence(run, 'failure-before-stop').catch(() => {})
      await run.page.screenshot({ path: join(runRoot, 'failure.png'), animations: 'allow' }).catch(() => {})
      try { result.failureSavedRevision = await preserveNativeFailure(run) }
      catch (saveError) { result.failureSaveError = String(saveError) }
      await recordEvidence(run, 'failure-after-stop').catch(() => {})
    }
    throw error
  } finally {
    if (run) {
      result.pageErrors = run.pageErrors
      result.consoleErrors = run.consoleErrors
      await closeNativeEditor(run)
    }
    result.finishedAt = new Date().toISOString()
    persist()
    await testInfo.attach('clarification-result', { path: join(runRoot, 'result.json'), contentType: 'application/json' })
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
