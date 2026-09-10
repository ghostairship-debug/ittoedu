import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { readGenerationResult } from '../../src/shared/generationResult'
import { projectV2RecordToV1 } from '../../src/shared/localAgentProjection'
import { localAgentText } from '../../src/shared/localAgentText'
import type { GenerationRequest } from '../../src/shared/generationContract'
import type { LocalAgentRecordV2 } from '../../src/shared/localAgentTaskContract'
import type { CourseProjectArchiveData } from '../../src/renderer/project/courseProjectArchive'
import {
  closeNativeEditor, launchNativeEditor, nativeRecords, preserveNativeFailure, readSaved, recordEvidence,
  saveStage, selectLayer, type NativeCli, type NativeRun,
} from './r18NativeAuthoringFixture'
import {
  REMAINING_IDS, REMAINING_PROMPTS, buttonRuntime, chat, configureRemainingChat, confirmConfiguration,
  verifyButtonClick, writeRemainingLesson,
} from './r18NativeAuthoringRemainingFixture'

const productRoot = resolve(__dirname, '..', '..')
const adapter = (process.env.COURSEWARE_R18_NATIVE_CLI ?? 'codex') as NativeCli
const model = process.env.COURSEWARE_R18_NATIVE_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_NATIVE_EFFORT ?? ''
const gate = process.env.COURSEWARE_R18_SHORT_PATH_GATE ?? ''
const prompt = REMAINING_PROMPTS.T10
const answerText = '正确答案：周期是完成一次往复运动所用的时间。'
const deadlineMs = 20 * 60_000

function currentTask(run: NativeRun) {
  for (const record of nativeRecords(run)) {
    const task = record.tasks.find(task => task.goal === prompt)
    if (task) return { record, task }
  }
  return undefined
}

function taskEvidence(record: LocalAgentRecordV2, taskId: string) {
  const task = record.tasks.find(task => task.taskId === taskId)!
  const results = record.hostResults.filter(result => result.taskId === taskId)
  const events = record.events.filter(event => event.taskId === taskId)
  return {
    sessionId: record.id, externalSessionId: record.externalSessionId, task,
    nativeRunIds: [...new Set(events.map(event => event.runId))],
    nativeTurnIds: [...new Set(events.map(event => event.nativeTurnId).filter(Boolean))],
    // Native turn identity is transport evidence, never an internal request count.
    internalModelRequests: null, nativeTurnCount: task.execution?.turnCount ?? null,
    candidateIds: [...new Set(results.map(result => result.candidateId))],
    committedResults: results.filter(result => result.status === 'committed'),
    results, usage: events.filter(event => event.kind === 'usage'),
    configuration: events.filter(event => event.kind === 'configuration'),
    nativeTurnEnds: events.filter(event => event.kind === 'turn-ended'),
  }
}

function taskTiming(record: LocalAgentRecordV2, taskId: string) {
  const execution = record.tasks.find(task => task.taskId === taskId)?.execution
  return execution && 'timing' in execution ? execution.timing as { entries: Array<{ observationId: string; runId: string; stage: string }> } : undefined
}

function requestedButtonChecks(record: LocalAgentRecordV2, taskId: string, request: GenerationRequest) {
  const results = record.hostResults.filter(result => result.taskId === taskId && result.requestId === request.requestId
    && ['committed', 'unchanged'].includes(result.status))
  const timing = taskTiming(record, taskId)
  return results.flatMap(result => {
    const resultStage = result.status === 'committed' ? 'hostCommitRecorded' : 'hostResultRecorded'
    const runIds = [...new Set(timing?.entries.filter(entry => entry.observationId === result.observationId && entry.stage === resultStage)
      .map(entry => entry.runId) ?? [])]
    expect(runIds, 'Bind candidate parsing to its actual applied native run, not another reply using the same request').toHaveLength(1)
    expect(timing?.entries).toContainEqual(expect.objectContaining({ observationId: result.observationId, runId: runIds[0], stage: 'candidateParsed' }))
    const runId = runIds[0]!
    const events = projectV2RecordToV1({ ...record, events: record.events.filter(event => event.runId === runId) }).events
    const parsed = readGenerationResult(localAgentText(events, { includeCandidates: true }), request, { candidateId: result.candidateId })
    if (parsed.kind !== 'candidate' || parsed.candidate.candidateId !== result.candidateId) return []
    return parsed.candidate.steps.flatMap(step => {
      if (step.tool !== 'runtime.source' || !step.input || typeof step.input !== 'object' || Array.isArray(step.input) || !('observeButton' in step.input)) return []
      expect(step.input.observeButton).toEqual({ version: 1, label: '显示答案' })
      expect(step.destination).toMatchObject({ kind: 'update', target: { itemId: REMAINING_IDS.brokenRuntime } })
      return [{ requestId: request.requestId, candidateId: result.candidateId, runId, stepId: step.id, observeButton: step.input.observeButton }]
    })
  })
}

async function installLiveButtonCounter(run: NativeRun) {
  await run.page.evaluate(instanceId => {
    const target = window as typeof window & { __r18LiveRepairClicks: number }
    target.__r18LiveRepairClicks = 0
    document.addEventListener('click', event => {
      const elements = event.composedPath().filter((node): node is HTMLElement => node instanceof HTMLElement)
      if (elements.some(element => element.dataset.runtimeInstanceId === instanceId)
        && elements.some(element => element.matches('button, [role="button"]'))) target.__r18LiveRepairClicks++
    }, true)
  }, REMAINING_IDS.brokenRuntime)
}

async function liveButtonClicks(run: NativeRun) {
  return run.page.evaluate(() => (window as typeof window & { __r18LiveRepairClicks: number }).__r18LiveRepairClicks)
}

function assertOnlyRequestedRepair(before: CourseProjectArchiveData, after: CourseProjectArchiveData) {
  const original = buttonRuntime(before.project), repaired = buttonRuntime(after.project)
  expect(repaired.runtime.source, 'The existing Runtime source must actually change').not.toBe(original.runtime.source)
  // The source transaction updates the document clock; all props, frames, other
  // source, Surface content and resources stay outside this repair's scope.
  const normalized = structuredClone(after.project)
  buttonRuntime(normalized).runtime.source = original.runtime.source
  normalized.revision = before.project.revision
  normalized.updatedAt = before.project.updatedAt
  expect(normalized).toEqual(before.project)
  expect(after.assetFiles).toEqual(before.assetFiles)
  expect(after.componentFiles).toEqual(before.componentFiles)
}

async function readObservationEvidence(run: NativeRun, record: LocalAgentRecordV2, taskId: string) {
  const repository = new LocalAgentRepository(run.userData)
  const evidence = []
  for (const observation of record.observations.filter(value => value.taskId === taskId)) {
    const request = await repository.readGenerationRequest(record.workspace, record.workingDirectoryId, observation.observationId)
    expect(request, 'Every recorded observation must resolve to its actual immutable request').toBeTruthy()
    expect(request!.documentRevision).toBe(observation.documentRevision)
    expect(request!.observation).toMatchObject({ documentRevision: observation.documentRevision,
      sessionGeneration: observation.sessionGeneration, source: observation.source, runtime: observation.runtime })
    const runtimeFile = observation.files.find(file => file.fileId === 'runtime-state')
    const facts = runtimeFile ? JSON.parse(readFileSync(join(repository.observationPath(record.workspace,
      record.workingDirectoryId, observation.observationId), runtimeFile.relativePath), 'utf8')) : null
    if (observation.runtime) {
      expect(facts).toMatchObject({ sessionId: observation.runtime.sessionId, stateVersion: observation.runtime.stateVersion })
    }
    const context = request!.context
    const previousResult = context && typeof context === 'object' && !Array.isArray(context) ? context.previousResult : null
    const behaviorSummary = context && typeof context === 'object' && !Array.isArray(context) ? context.behaviorEvidence : null
    const behaviorFile = observation.files.find(file => file.fileId === 'dynamic-behavior')
    const behavior = behaviorFile ? JSON.parse(readFileSync(join(repository.observationPath(record.workspace,
      record.workingDirectoryId, observation.observationId), behaviorFile.relativePath), 'utf8')) : null
    const buttonFrames = (behavior?.observations ?? []).flatMap((entry: { frames: Array<{ phase: string; fileId?: string; path?: string; source?: string }> }) => entry.frames
      .filter(frame => ['before-button-click', 'after-button-click'].includes(frame.phase)).map(frame => {
        expect(frame.source).toBe('candidate-host-before-commit')
        const file = observation.files.find(value => value.fileId === frame.fileId)
        expect(file, 'Each candidate click frame must be an actual immutable continuation attachment').toBeTruthy()
        expect(frame.path).toBe(`resources/${file!.relativePath}`)
        const bytes = readFileSync(join(repository.observationPath(record.workspace, record.workingDirectoryId, observation.observationId), file!.relativePath))
        expect(bytes.length).toBe(file!.byteLength)
        expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
        return { ...frame, byteLength: bytes.length }
      }))
    const timing = taskTiming(record, taskId)
    const acceptedRunIds = [...new Set(timing?.entries.filter(entry => entry.observationId === observation.observationId && entry.stage === 'turnAccepted').map(entry => entry.runId) ?? [])]
    evidence.push({ observation, requestId: request!.requestId, previousResult, runtimeFacts: facts,
      requestedChecks: requestedButtonChecks(record, taskId, request!), behaviorSummary, behavior, buttonFrames, acceptedRunIds })
  }
  writeFileSync(join(run.runRoot, 'runtime-observations.json'), JSON.stringify(evidence, null, 2))
  return evidence
}

/** Click the running surface only after the continuation observation is staged.
 * A real click changes interactionEpoch even when the Runtime only changes DOM. */
async function sampleInteractiveResult(run: NativeRun) {
  const trial = run.page.getByRole('button', { name: '当前位置试运行', exact: true })
  if (await trial.getAttribute('aria-pressed') !== 'true') return { correct: false, reason: 'trial-not-current' }
  const button = run.page.getByRole('button', { name: '显示答案', exact: true })
  if (!await button.isVisible() || !await run.page.getByText('答案尚未显示', { exact: true }).isVisible()) {
    return { correct: false, reason: 'initial-button-state-not-mounted' }
  }
  let clicked = false
  try {
    await button.click({ timeout: 1000 })
    clicked = true
    await run.page.getByText(answerText, { exact: true }).waitFor({ state: 'visible', timeout: 1000 })
    return { correct: true, clicked, answer: await run.page.getByText(answerText, { exact: true }).innerText(), method: 'normal actionable button click' }
  } catch (error) {
    return { correct: false, clicked, reason: 'ordinary-click-or-answer-not-ready', detail: String(error).slice(0, 1200) }
  }
}

test(`R18 short path ${adapter} interaction auto: natural Runtime repair with reasoned continuation and real click`, async ({}, testInfo) => {
  test.skip(!gate, 'Paid real CLI gate closed; --list is discovery, not a passed run.')
  expect(gate).toBe('short-path')
  expect(['codex', 'claude', 'opencode']).toContain(adapter)
  expect(model, 'Freeze the actual model before this one real sample').not.toBe('')
  expect(effort, 'Freeze the effort or explicit default').not.toBe('')
  test.setTimeout(deadlineMs + 240_000)
  const runRoot = join(productRoot, 'output', 'r18-short-path', `${adapter}-interaction-auto-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runRoot, { recursive: true })
  const projectPath = join(runRoot, 'lesson.h5lesson'), baseline = await writeRemainingLesson(projectPath)
  const metrics: Record<string, unknown> = {
    adapter, requestedModel: model, requestedEffort: effort, prompt, status: 'running', applyPolicy: 'auto',
    serviceTier: null, serviceTierEvidence: 'not-exposed-by-formal-configuration-projection',
    coldOrWarm: 'fresh-application-and-native-session', traceMode: testInfo.project.use.trace,
    samplingIntervalMs: 200, hiddenWindow: true, internalModelRequests: null,
    timingBoundary: 'UI Send click to first sampled normal click that displays the correct answer; task terminal is sampled independently.',
  }
  const persist = () => writeFileSync(join(runRoot, 'result.json'), JSON.stringify(metrics, null, 2))
  persist()
  let run: NativeRun | undefined
  try {
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    await configureRemainingChat(run, adapter, model, effort)
    await chat(run).getByLabel('意图', { exact: true }).selectOption('edit')
    await chat(run).getByLabel('应用方式', { exact: true }).selectOption('auto')
    await verifyButtonClick(run, 'broken', 'original-broken', true)
    await selectLayer(run.page, REMAINING_IDS.brokenRuntime)
    await expect(run.page.getByRole('button', { name: '当前位置试运行', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(chat(run).getByLabel('本轮引用摘要')).toContainText('点击显示答案')
    await installLiveButtonCounter(run)
    await chat(run).getByLabel('发送给创作助手', { exact: true }).fill(prompt)
    const startedAt = Date.now()
    metrics.startedAt = startedAt
    await chat(run).getByRole('button', { name: '发送', exact: true }).click()
    let firstInteractiveAt: number | undefined, terminalAt: number | undefined, taskId: string | undefined
    let intentionalLiveClicks = 0
    while (Date.now() - startedAt < deadlineMs) {
      expect(await liveButtonClicks(run), 'Candidate admission must not deliver clicks to the teacher live Runtime').toBe(intentionalLiveClicks)
      const current = currentTask(run)
      if (current) {
        taskId = current.task.taskId
        metrics.native = taskEvidence(current.record, taskId)
        if (['completed', 'failed', 'cancelled', 'partial'].includes(current.task.status) && !terminalAt) {
          terminalAt = Date.now(); metrics.taskTerminalMs = terminalAt - startedAt; metrics.taskTerminalStatus = current.task.status
        }
        if (['failed', 'cancelled', 'partial'].includes(current.task.status)) throw new Error(`Task ended as ${current.task.status}`)
        const committed = current.record.hostResults.filter(result => result.taskId === taskId && result.status === 'committed')
        if (committed.length) {
          if (metrics.firstReceiptObservedMs === undefined) metrics.firstReceiptObservedMs = Date.now() - startedAt
          const latestCommit = committed.at(-1)!
          const stagedObservation = current.record.observations.find(value => value.observationId === current.task.observationId)
          const safeToInteract = current.task.status === 'completed' || (current.task.status === 'running'
            && (current.task.execution?.turnCount ?? 0) >= 2
            && stagedObservation?.documentRevision === latestCommit.afterRevision)
          if (!firstInteractiveAt && safeToInteract) {
            const sampled = await sampleInteractiveResult(run)
            if ('clicked' in sampled && sampled.clicked) intentionalLiveClicks++
            expect(await liveButtonClicks(run)).toBe(intentionalLiveClicks)
            metrics.lastInteractiveSample = { ...sampled, sampledAtMs: Date.now() - startedAt, revision: committed.at(-1)!.afterRevision }
            if (sampled.correct) {
              firstInteractiveAt = Date.now(); metrics.firstCorrectInteractiveMs = firstInteractiveAt - startedAt
              metrics.firstCorrectInteractiveRevision = committed.at(-1)!.afterRevision
              await run.page.screenshot({ path: join(runRoot, 'first-correct-interaction.png'), animations: 'allow' })
            }
          }
        }
        persist()
        if (current.task.status === 'completed') break
      }
      const alerts = await chat(run).getByRole('alert').allTextContents()
      if (alerts.length) throw new Error(alerts.join('\n'))
      if (await chat(run).locator('section.native-agent-question').count()) {
        throw new Error('The repair requested native user input; retain this failed unattended sample without inventing an answer or permission.')
      }
      await run.page.waitForTimeout(200)
    }
    expect(terminalAt, 'The persisted task must reach a terminal state inside the fixed task deadline').toBeTruthy()
    expect(taskId).toBeTruthy()
    await expect(chat(run).getByRole('button', { name: '停止', exact: true })).toBeDisabled()
    const completed = currentTask(run)!
    expect(completed.task.status).toBe('completed')
    confirmConfiguration(completed.record, adapter, model, effort)
    const native = taskEvidence(completed.record, taskId!)
    const commits = [...native.committedResults].sort((left, right) => left.afterRevision - right.afterRevision)
    expect(commits.length, 'A repair needs at least one actual project transaction').toBeGreaterThan(0)
    expect(completed.task.committedResultIds).toEqual(commits.map(result => result.resultId))
    commits.forEach((result, index) => expect(result).toMatchObject({
      beforeRevision: baseline.project.revision + index, afterRevision: baseline.project.revision + index + 1,
    }))
    const observations = await readObservationEvidence(run, completed.record, taskId!)
    const requestedChecks = observations.flatMap(value => value.requestedChecks)
    expect(requestedChecks.length, 'The real model must request observeButton in an applied candidate; the fixture must never inject it').toBeGreaterThan(0)
    const clickFeedback = observations.filter(value => value.behavior?.observations?.some((entry: { buttonClick?: unknown }) => entry.buttonClick))
    expect(clickFeedback.length, 'Actual independent-host click evidence must enter a native continuation').toBeGreaterThan(0)
    for (const feedback of clickFeedback) {
      const commit = native.results.find(result => ['committed', 'unchanged'].includes(result.status)
        && result.candidateId === feedback.behavior.committedCandidate?.candidateId)
      expect(commit, 'Click evidence must identify its actual preceding host result').toBeTruthy()
      expect(feedback.previousResult).toMatchObject({ candidateId: commit!.candidateId, afterRevision: commit!.afterRevision })
      const requested = requestedChecks.find(value => value.candidateId === commit!.candidateId)
      expect(requested, 'The same candidate must explicitly request this exact button check').toBeTruthy()
      expect(feedback.acceptedRunIds.length, 'Staged evidence alone is insufficient; the continuation must reach the native transport').toBeGreaterThan(0)
      expect(feedback.acceptedRunIds).not.toContain(requested!.runId)
      expect(feedback.behavior).toMatchObject({ source: 'actual-candidate-host', semanticVerdict: 'requires-review',
        imageFeedback: 'current-formal-host-with-explicit-candidate-input-evidence' })
      for (const entry of feedback.behavior.observations.filter((value: { buttonClick?: unknown }) => value.buttonClick)) {
        expect(entry.frames.filter((frame: { phase: string }) => frame.phase.endsWith('button-click')).map((frame: { phase: string }) => frame.phase))
          .toEqual(['before-button-click', 'after-button-click'])
        expect(entry.buttonClick).toMatchObject({ instanceId: REMAINING_IDS.brokenRuntime, input: 'electron-mouse', functionalResult: 'requires-review' })
      }
      expect(feedback.behaviorSummary).toMatchObject({ buttonClicks: expect.arrayContaining([expect.objectContaining({ instanceId: REMAINING_IDS.brokenRuntime,
        input: 'electron-mouse', source: 'candidate-host-before-commit', functionalResult: 'requires-review' })]) })
    }
    const clicks = clickFeedback.flatMap(value => value.behavior.observations.flatMap((entry: { buttonClick?: { beforeText: string; afterText: string; clickedAt: number; observedAt: number } }) => entry.buttonClick ? [entry.buttonClick] : []))
    expect(clicks.some(click => click.beforeText.includes('答案尚未显示') && click.afterText.includes(answerText)),
      'At least one factual private-host before/after observation must demonstrate the requested repair').toBe(true)
    clicks.forEach(click => expect(click.observedAt).toBeGreaterThanOrEqual(click.clickedAt))
    expect(await liveButtonClicks(run)).toBe(intentionalLiveClicks)
    metrics.candidateButtonReview = { requestedChecks, continuationObservationIds: clickFeedback.map(value => value.observation.observationId),
      intentionalLiveClicks, observedLiveClicks: await liveButtonClicks(run), unexpectedLiveClicks: 0 }
    expect(observations).toContainEqual(expect.objectContaining({ observation: expect.objectContaining({
      source: 'trial', documentRevision: baseline.project.revision, runtime: expect.any(Object),
    }) }))
    const continued = native.results.filter(result => result.afterCommit?.action === 'observe')
    expect(continued.length, 'Dynamic behavior review must retain its explicit observe continuation').toBeGreaterThan(0)
    expect(native.nativeTurnCount).toBeGreaterThanOrEqual(2)
    for (const result of continued) {
      expect(result.afterCommit?.action).toBe('observe')
      if (result.afterCommit?.action === 'observe') expect(result.afterCommit.reason.trim()).not.toBe('')
      expect(observations).toContainEqual(expect.objectContaining({
        observation: expect.objectContaining({ documentRevision: result.afterRevision }),
        previousResult: expect.objectContaining({ candidateId: result.candidateId, afterRevision: result.afterRevision }),
      }))
    }
    // A natural final answer after reviewing new observations is valid, as is a
    // subsequent formal finish receipt. This test does not dictate either form.
    metrics.native = native
    metrics.completionPath = completed.task.completion ? 'formal-finish-receipt' : 'native-answer-after-observe'
    metrics.commitCount = commits.length
    await recordEvidence(run, 'completed')
    await run.page.getByRole('button', { name: '编辑状态', exact: true }).click()
    // Timestamp the visible answer itself, before the helper's screenshots and
    // window-isolation check, if the first usable result occurs after terminal.
    const postTerminalAnswer = firstInteractiveAt ? undefined
      : run.page.getByText(answerText, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 }).then(() => Date.now()).catch(() => undefined)
    await verifyButtonClick(run, 'repaired', 'final-repaired')
    if (!firstInteractiveAt) {
      firstInteractiveAt = await postTerminalAnswer
      expect(firstInteractiveAt).toBeTruthy()
      metrics.firstCorrectInteractiveMs = firstInteractiveAt! - startedAt
      metrics.firstCorrectInteractiveRevision = commits.at(-1)!.afterRevision
      metrics.firstCorrectInteractiveSource = 'first normal click after terminal; no correct interactive sample was observed while the task was active'
    }
    const saved = await saveStage(run, 'correct-result')
    expect(saved.project.revision).toBe(baseline.project.revision + commits.length)
    assertOnlyRequestedRepair(baseline, saved)
    for (let count = 1; count <= commits.length; count++) {
      await run.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
      const undone = await saveStage(run, `undo-${count}`)
      expect(undone.project.revision).toBe(saved.project.revision - count)
      if (count === commits.length) expect(undone).toEqual(baseline)
    }
    await verifyButtonClick(run, 'broken', 'all-commits-undone')
    for (let count = 1; count <= commits.length; count++) {
      await run.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
      const redone = await saveStage(run, `redo-${count}`)
      expect(redone.project.revision).toBe(baseline.project.revision + count)
      if (count === commits.length) expect(redone).toEqual(saved)
    }
    await verifyButtonClick(run, 'repaired', 'all-commits-redone')
    expect(run.pageErrors).toEqual([])
    await closeNativeEditor(run); run = undefined
    run = await launchNativeEditor(productRoot, runRoot, projectPath)
    expect(readSaved(projectPath)).toEqual(saved)
    const reopened = currentTask(run)!
    expect(reopened.task).toEqual(completed.task)
    expect(taskEvidence(reopened.record, taskId!)).toEqual(native)
    await verifyButtonClick(run, 'repaired', 'reopened-repaired')
    await recordEvidence(run, 'reopened')
    expect(run.pageErrors).toEqual([])
    metrics.status = 'engineering-checks-passed-awaiting-visual-review'
    metrics.visualReview = 'Review original/final/Undo/Redo/reopened real-click screenshots and runtime-observations.json; this one sample is not a latency distribution or S3 acceptance.'
  } catch (error) {
    metrics.status = 'failed'; metrics.failure = error instanceof Error ? error.stack : String(error)
    if (run) {
      const failed = currentTask(run)
      if (failed) metrics.native = taskEvidence(failed.record, failed.task.taskId)
      await recordEvidence(run, 'failure').catch(() => {})
      await run.page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {})
      try { metrics.failureSavedRevision = await preserveNativeFailure(run) } catch (saveError) { metrics.failureSaveError = String(saveError) }
    }
    throw error
  } finally {
    metrics.finishedAt = Date.now(); persist()
    if (run) await closeNativeEditor(run)
    await testInfo.attach('short-path-interaction-result', { path: join(runRoot, 'result.json'), contentType: 'application/json' })
  }
})

test.describe.configure({ mode: 'serial', retries: 0 })
