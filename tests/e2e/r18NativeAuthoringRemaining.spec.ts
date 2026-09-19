import { requireProjectWorkspace } from './r18NativeAuthoringFixture'
import { plainDocumentText } from '../../src/shared/document/content'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  FIXTURE_IDS, closeNativeEditor, launchNativeEditor, nativeEvidence, nativeRecords, readSaved, recordEvidence,
  saveStage, preserveNativeFailure, selectLayer, sendNatural, titleItem, verifyGreenImage, waitNativeTurn, type NativeRun,
} from './r18NativeAuthoringFixture'
import {
  MANUAL_AFTER_AI, MATERIAL_FIXTURE, REMAINING_IDS, REMAINING_PROMPTS, SECOND_PARAGRAPH, assertRemainingHistoryPreserved, assertSavedUnchanged, beginNatural,
  buttonRuntime, chat, committed, configureRemainingChat, configureRemainingModel, confirmConfiguration, flowParagraph, flowSurface,
  expectMaterialBody, importAndReferenceMaterial, loadRemainingAfterT11QueuedCancelledResume, loadRemainingFlowResume, loadRemainingPlanContinuation, loadRemainingRecoveredFlowResume, materialSlide, materialTexts, openSurface, recordMaterialObservation, recordSpatialObservation, recordRuntimeDomObservation,
  saveVisualReview, selectedRecord, selectSpatialObject, spatialSurface, verifyButtonClick, verifyFreshRemainingHtml, verifyPublishedControls,
  waitReviewedPreviews, waitUiBoundary, writeRemainingLesson,
} from './r18NativeAuthoringRemainingFixture'
import { selectReferenceScope } from './chatReferenceTarget'

const productRoot = resolve(__dirname, '..', '..')
const gate = process.env.COURSEWARE_R18_REMAINING_GATE ?? ''
const model = process.env.COURSEWARE_R18_REMAINING_MODEL ?? ''
const effort = process.env.COURSEWARE_R18_REMAINING_EFFORT ?? ''
const resumeAfterFlow = process.env.COURSEWARE_R18_REMAINING_RESUME_AFTER_FLOW ?? ''
const resumeSpatialFailure = process.env.COURSEWARE_R18_REMAINING_RESUME_SPATIAL_FAILURE ?? ''
const resumeAfterSpatial = process.env.COURSEWARE_R18_REMAINING_RESUME_AFTER_SPATIAL ?? ''
const resumeAfterFailedT10 = process.env.COURSEWARE_R18_REMAINING_RESUME_AFTER_FAILED_T10 ?? ''
const resumeAfterT11 = process.env.COURSEWARE_R18_REMAINING_RESUME_AFTER_T11 ?? ''
const resumeRecoveredFlow = process.env.COURSEWARE_R18_REMAINING_RECOVERED_FLOW ?? ''
const resumePlanContinuation = process.env.COURSEWARE_R18_REMAINING_PLAN_CONTINUATION ?? ''
const resumeAfterT11QueuedCancelled = process.env.COURSEWARE_R18_REMAINING_AFTER_T11_QUEUED_CANCELLED ?? ''
const checkpointInspect = process.env.COURSEWARE_R18_REMAINING_CHECKPOINT_INSPECT ?? ''
const planNegativeCheckpoint = process.env.COURSEWARE_R18_REMAINING_PLAN_NEGATIVE_CHECKPOINT ?? ''
const turnTimeoutMs = 20 * 60_000
const planned = ['codex', 'claude', 'opencode'] as const
if (gate && !planned.some(cli => gate === `${cli}-once`)) throw new Error('Remaining matrix gate must explicitly name codex-once, claude-once or opencode-once')
if ([resumeAfterFlow, resumeRecoveredFlow, resumePlanContinuation, resumeAfterT11QueuedCancelled].filter(Boolean).length > 1) {
  throw new Error('Choose exactly one explicit remaining checkpoint entrypoint')
}
if ((resumeRecoveredFlow || resumePlanContinuation || resumeAfterT11QueuedCancelled) && [resumeSpatialFailure, resumeAfterSpatial, resumeAfterFailedT10, resumeAfterT11].some(Boolean)) {
  throw new Error('Recovered-Flow and reviewed-plan checkpoints cannot be combined with an older continuation chain')
}

// Native runs must keep all Electron windows backgrounded and avoid tracing
// side effects. The structural checkpoint checks below do not launch Electron.
test.use({ trace: 'off' })

// One predeclared full remaining-task slot per CLI. No default CLI, expanded
// repeat count, retries, model fallback or hidden automatic repair prompt.
for (const cli of planned) {
  test(`R18 remaining ${cli} once: T03/T08/T09/T10/T11/T12 and 050 material/export through real native UI`, async ({}, testInfo) => {
    test.skip(gate !== `${cli}-once`, `Explicit ${cli}-once paid native gate is closed. Discovery/skipping is not passing.`)
    expect(model, 'Freeze the actual native model before opening this slot').not.toBe('')
    expect(effort, 'Freeze a native effort value or the explicit string default').not.toBe('')
    test.setTimeout(16 * turnTimeoutMs + 15 * 60_000)
    const traceEnabled = false
    testInfo.annotations.push({ type: 'native-evidence', description: 'Real installed CLI, native identities and UI. Formal broken lesson content; no mocked CLI/host/candidates. Requires visual and semantic review.' })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (resumeSpatialFailure && !resumeAfterFlow) throw new Error('A Spatial failure continuation requires its original Flow evidence root')
    if (resumeAfterSpatial && !resumeSpatialFailure) throw new Error('A completed Spatial continuation requires its actual earlier failure evidence')
    if (resumeAfterFailedT10 && !resumeAfterSpatial) throw new Error('A failed T10 continuation requires its actual completed Spatial evidence')
    if (resumeAfterT11 && !resumeAfterFailedT10) throw new Error('An after-T11 continuation requires its actual earlier failed T10 evidence')
    const selected = { cli, slot: 1, model, effort, gate }
    const resume = resumeAfterFlow
      ? await loadRemainingFlowResume(productRoot, resumeAfterFlow, selected, resumeSpatialFailure || undefined, resumeAfterSpatial || undefined, resumeAfterFailedT10 || undefined, resumeAfterT11 || undefined)
      : resumeRecoveredFlow
        ? await loadRemainingRecoveredFlowResume(productRoot, resolve(resumeRecoveredFlow, '..', '..'), resumeRecoveredFlow, selected)
      : resumePlanContinuation
          ? await loadRemainingPlanContinuation(productRoot, resumePlanContinuation, selected)
          : resumeAfterT11QueuedCancelled
            ? await loadRemainingAfterT11QueuedCancelledResume(productRoot, resumeAfterT11QueuedCancelled, selected)
          : undefined
    const runRoot = resume ? join(resume.sourceRoot, 'attempts', `${resume.phase}-${stamp}`)
      : join(productRoot, 'output', 'r18-native-authoring-remaining', `${cli}-once-${stamp}`)
    mkdirSync(runRoot, { recursive: true })
    const projectPath = resume?.projectPath ?? join(runRoot, 'remaining.h5lesson')
    const reusedEvidence = (() => {
      if (!resume) return []
      const retainedT03 = ['T03.native.json', 'T03.h5lesson', 'T03.pixels.json'].map(file => join(resume.sourceRoot, file))
      if (resume.phase === 'after-T11-queued-cancelled') {
        if (!resume.t11QueuedCancelledRoot) throw new Error('The queued/cancelled T11 checkpoint has no evidence root')
        return [...retainedT03, join(resume.t11QueuedCancelledRoot, 'run.json'), ...[
          'T09-flow.native.json', 'T09-flow.h5lesson', 'T09-flow-controls.png',
          'T09-spatial.native.json', 'T09-spatial.h5lesson', 'T09-spatial-current-camera.json', 'T09-spatial-visible.png', 'T09-spatial-controls.png',
          'T10.native.json', 'T10-repaired.h5lesson', 'T10-repaired-after-click.png', 'T10-runtime-dom-observation.json',
          'T11-question.input.json', 'T11-before-answer.h5lesson', 'T11-question-visible.review.json', 'T11-answered.native.json', 'T11-answered.h5lesson',
          'T11-active.input.json', 'T11-supplement.input.json', 'failure.native.json', 'failure-current.h5lesson', 'failure-current.project.json', 'failure-current.png', 'failure.ui.txt',
        ].map(file => join(resume.t11QueuedCancelledRoot!, file))]
      }
      if (resume.phase === 'after-reviewed-T08-and-Flow') {
        if (!resume.continuationRoot) throw new Error('The reviewed-plan checkpoint has no continuation root')
        const t08Root = resume.reusedT08Root ?? resume.continuationRoot
        const t08Evidence = ['T08-applied.native.json', 'T08-applied.h5lesson'].map(file => join(t08Root, file))
        const previousIncorrectFlowEvidence = resume.previousFlowFailureRoot ? [
          'T09-flow.native.json', 'T09-flow.h5lesson', 'T09-flow.png', 'T09-flow.project.json',
        ].map(file => join(resume.previousFlowFailureRoot!, file)) : []
        const flowEvidence = resume.previousFlowFailureRoot ? [
          'T09-flow-correction.input.json', 'T09-flow-correction.native.json', 'T09-flow.h5lesson', 'T09-flow.png',
          'T09-flow.project.json', 'T09-flow-controls.png', 'before-Flow-correction.h5lesson', 'flow-semantic-review.json',
        ].map(file => join(resume.continuationRoot!, file)) : [
          'T09-flow.native.json', 'T09-flow.h5lesson', 'T09-flow-controls.png',
        ].map(file => join(resume.continuationRoot!, file))
        return [...retainedT03, join(resume.continuationRoot, 'run.json'), ...t08Evidence, ...previousIncorrectFlowEvidence, ...flowEvidence]
      }
      if (resume.phase === 'after-recovered-Flow') {
        if (!resume.continuationRoot) throw new Error('The recovered-Flow checkpoint has no recovery root')
        return [...retainedT03, ...[
          'T08-plan-visible.review.json', 'T08-plan-zero-write.h5lesson', 'T08-apply-plan.native.json', 'T08-applied.h5lesson',
          'T09-flow.input.json', 'failure.native.json',
        ].map(file => join(resume.sourceRoot, file)), join(resume.sourceRoot, 'profile', 'project-data', 'recovery.h5lesson'), ...[
          'recovery-result.json', 'recovered-Flow.h5lesson',
        ].map(file => join(resume.continuationRoot!, file))]
      }
      return [...retainedT03, ...[
        'T08-plan-visible.review.json', 'T08-plan-zero-write.h5lesson', 'T08-apply-plan.native.json', 'T08-applied.h5lesson',
        'T09-flow.native.json', 'T09-flow.h5lesson', 'T09-flow-controls.png',
      ].map(file => join(resume.sourceRoot, file))]
    })()
    const manifest: Record<string, unknown> = {
      selected: { cli, slot: 1, model, effort, gate }, planned: planned.map(adapter => ({ adapter, slot: 1 })),
      prompts: REMAINING_PROMPTS, productRoot, runRoot, projectPath, startedAt: new Date().toISOString(), status: 'running',
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: productRoot, encoding: 'utf8', windowsHide: true }).trim(),
      dirtyPaths: execFileSync('git', ['status', '--porcelain'], { cwd: productRoot, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean),
      coverage: ['T03', 'T08', 'T09 Flow/Spatial', 'T10 actual broken button and repaired click', 'T11 natural clarification, active input and Stop',
        'T12 actual before/after preview, ordered Undo/Redo, save/reopen and application restart/native resume',
        '050 real material import/reference, empty-page generation, same-native-session modification, save/reopen and unique final offline HTML'],
      notCovered: ['critical-chain three independent runs', 'external Builder', 'PPTX/DOCX format exports', 'Owner/S3 acceptance'],
      review: 'All plan/preview text and real screenshots are retained. Automated structural/pixel checks do not establish semantic or visual acceptance.',
      stopObservationWindowMs: 5000, noAutomaticRetries: true, visibleWindowsAllowed: false, traceEnabled,
    }
    if (resume) manifest.continuation = { from: resume.sourceRoot, phase: resume.phase, profilePath: resume.profilePath,
      previousFailureRoot: resume.previousFailureRoot, previousFailedCommitIds: resume.previousFailedCommitIds,
      spatialCompletedRoot: resume.spatialCompletedRoot,
      failedT10Root: resume.failedT10Root, failedT10CommitIds: resume.failedT10CommitIds,
      t11ProgressRoot: resume.t11ProgressRoot, cancelledT12RecordId: resume.cancelledT12RecordId,
      t11AutoHeightChange: resume.t11AutoHeightChange,
      unresolvedQuestion: resume.unresolvedQuestionRecordId ? { recordId: resume.unresolvedQuestionRecordId,
        status: 'failed', path: 'text', gate: resume.requiresQueuedSupplementCompletion
          ? 'T11 text question remains failed; the preceding supplement was only queued and must be newly consumed before Stop evidence is complete'
          : 'T11 remains incomplete; answer/edit and Stop evidence are independently retained' } : null,
      reusesNativeSession: resume.reuseNativeSession !== false, previousExternalSessionId: resume.previousExternalSessionId,
      sessionId: resume.reuseNativeSession === false ? null : resume.record.id,
      externalSessionId: resume.reuseNativeSession === false ? null : resume.record.externalSessionId,
      reusedT08Root: resume.reusedT08Root, previousFlowFailureRoot: resume.previousFlowFailureRoot,
      t11QueuedCancelled: resume.t11QueuedCancelledRoot ? { root: resume.t11QueuedCancelledRoot,
        recordId: resume.t11QueuedCancelledRecordId, previousDelivery: 'queued', previousStop: 'cancelled',
        requiresFreshTail: ['native acceptance or consumption', 'Stop', 'five-second late-write window'] } : null,
      preservedHistoricalFiles: resume.historyFiles.map(file => file.path), reusedEvidence,
      reusedSpatialEvidence: resume.spatialCompletedRoot ? ['T09-spatial.native.json', 'T09-spatial.h5lesson', 'T09-spatial-current-camera.json', 'T09-spatial-visible.png', 'T09-spatial-controls.png'].map(file => join(resume.spatialCompletedRoot!, file)) : [],
      reusedT10T11Evidence: resume.t11ProgressRoot ? (resume.t11QueuedCancelledRoot ? [
        'T10.native.json', 'T10-repaired.h5lesson', 'T10-repaired-after-click.png', 'T10-runtime-dom-observation.json',
        'T11-before-answer.h5lesson', 'T11-question-visible.review.json', 'T11-answered.native.json', 'T11-answered.h5lesson',
        'T11-active.input.json', 'T11-supplement.input.json', 'failure.native.json', 'failure-current.h5lesson',
      ].map(file => join(resume.t11QueuedCancelledRoot!, file)) : ['T10.native.json', 'T10-repaired.h5lesson', 'T10-repaired-after-click.png',
        'T10-runtime-dom-observation.json', 'T11-before-answer.h5lesson', 'T11-question-visible.review.json',
        'T11-answered.native.json', 'T11-answered.h5lesson', 'T11-stop.native.json', 'T11-late-result-window.h5lesson'].map(file => join(resume.t11ProgressRoot!, file))) : [],
      freshCoverage: [...(resume.requiresFreshFlowFeedback ? ['T09 Flow feedback after recovery'] : []),
        ...(resume.spatialCompletedRoot ? [] : ['T09 Spatial']), ...(resume.requiresQueuedSupplementCompletion
          ? ['T11 active supplement consumption, Stop and late-write window'] : (resume.t11ProgressRoot ? [] : ['T10', 'T11'])), 'T12', '050 material/export'],
      fixtureRestored: false, modelCandidateReplayed: false }
    const persist = () => writeFileSync(join(runRoot, 'run.json'), JSON.stringify(manifest, null, 2))
    persist()
    let run: NativeRun | undefined
    const launches: NativeRun[] = []
    try {
      const original = resume?.original ?? await writeRemainingLesson(projectPath)
      if (!resume) writeFileSync(join(runRoot, '00-original.h5lesson'), readFileSync(projectPath))
      run = await launchNativeEditor(productRoot, runRoot, projectPath, resume)
      launches.push(run)
      if (traceEnabled) await run.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      await configureRemainingChat(run, cli, model, effort)
      let initialNativeId: string | undefined
      if (resume && resume.reuseNativeSession !== false) {
        await chat(run).getByLabel('会话', { exact: true }).selectOption(resume.record.id)
        expect((await selectedRecord(run)).externalSessionId).toBe(resume.record.externalSessionId)
        await configureRemainingModel(run, model, effort)
        initialNativeId = (await selectedRecord(run)).externalSessionId ?? undefined
      } else if (resume) {
        expect(await chat(run).getByLabel('会话', { exact: true }).inputValue()).toBe('')
        expect(nativeRecords(run).some(record => requireProjectWorkspace(record.workspace).normalizedPath === projectPath.replace(/\\/g, '/').toLowerCase())).toBe(false)
      }
      await chat(run).getByLabel('意图', { exact: true }).selectOption('edit')
      await chat(run).getByLabel('应用方式', { exact: true }).selectOption('auto')

      if (!resume) await test.step('T03 changes only the red part of the real embedded image', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.image)
        await sendNatural(run!, 'T03', REMAINING_PROMPTS.T03, turnTimeoutMs)
        const changed = await saveStage(run!, 'T03')
        const pixels = await verifyGreenImage(original, changed)
        writeFileSync(join(runRoot, 'T03.pixels.json'), JSON.stringify(pixels, null, 2))
        expect(titleItem(changed.project)).toEqual(titleItem(original.project))
        expect(buttonRuntime(changed.project)).toEqual(buttonRuntime(original.project))
        expect(committed(await selectedRecord(run!)).length).toBeGreaterThan(0)
        confirmConfiguration(await selectedRecord(run!), cli, model, effort)
      })
      if (!resume) {
        initialNativeId = (await selectedRecord(run)).externalSessionId ?? undefined
        if (!initialNativeId) throw new Error('The first native task has no external session identity')
      }

      if (!resume) await test.step('T08 reads the real plan, proves zero writes, then sends the original execution phrase', async () => {
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const before = readSaved(projectPath)
        await sendNatural(run!, 'T08-plan', REMAINING_PROMPTS.T08Plan, turnTimeoutMs)
        const message = chat(run!).locator('.chat-scroll > .chat-message').last()
        const actualPlan = await saveVisualReview(run!, 'T08-plan-visible', message)
        expect(actualPlan.length, 'The reply must contain a reviewable plan, not an empty completion notice').toBeGreaterThan(30)
        expect(actualPlan).toMatch(/方案|调整|建议|标题|字号|居中/)
        expect((await selectedRecord(run!)).tasks.at(-1)!.intent).toBe('plan')
        expect(committed(await selectedRecord(run!))).toHaveLength(0)
        await assertSavedUnchanged(run!, 'T08-plan-zero-write', before)
        // The rendered plan was read and recorded above. The instruction below is
        // sent only after that real artifact exists; no plan is preloaded.
        await chat(run!).getByLabel('意图', { exact: true }).selectOption('edit')
        await sendNatural(run!, 'T08-apply-plan', REMAINING_PROMPTS.T08Apply, turnTimeoutMs)
        const applied = await saveStage(run!, 'T08-applied')
        expect(titleItem(applied.project)).not.toEqual(titleItem(before.project))
        expect(committed(await selectedRecord(run!)).length).toBeGreaterThan(0)
        expect((await selectedRecord(run!)).externalSessionId).toBe(initialNativeId)
      })

      if (!resume || resume.requiresFreshFlowFeedback) await test.step('T09 Flow edits the actual second paragraph and keeps the first paragraph intact', async () => {
        await openSurface(run!, 'flow-page')
        await run!.page.getByTestId(`flow-block-${REMAINING_IDS.paragraphTwo}`).click()
        await expect(run!.page.getByTestId(`flow-block-${REMAINING_IDS.paragraphTwo}`)).toHaveAttribute('aria-selected', 'true')
        await selectReferenceScope(chat(run!), 'page')
        const before = readSaved(projectPath)
        const beforeParagraph = flowParagraph(before.project, REMAINING_IDS.paragraphTwo)
        if (resume?.requiresFreshFlowFeedback) {
          expect(plainDocumentText(beforeParagraph.content).length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
          expect(plainDocumentText(beforeParagraph.content)).toMatch(/周期/)
          expect(plainDocumentText(beforeParagraph.content)).toMatch(/往复|计时|时间/)
        }
        await sendNatural(run!, 'T09-flow', REMAINING_PROMPTS.T09Flow, turnTimeoutMs)
        const after = await saveStage(run!, 'T09-flow')
        const paragraph = flowParagraph(after.project, REMAINING_IDS.paragraphTwo)
        if (resume?.requiresFreshFlowFeedback) expect(plainDocumentText(paragraph.content).length).toBeLessThan(plainDocumentText(beforeParagraph.content).length)
        else expect(plainDocumentText(paragraph.content).length).toBeLessThan(SECOND_PARAGRAPH.length * .8)
        expect(plainDocumentText(paragraph.content)).toMatch(/周期/)
        expect(plainDocumentText(paragraph.content)).toMatch(/往复|计时|时间/)
        // This guards the observed replacement of a complete oscillation with
        // a mere crossing; retained visual/full-text review remains required.
        expect(plainDocumentText(paragraph.content)).toMatch(/(?:十次完整往复(?:运动)?|十个周期)[\s\S]{0,60}总时间[\s\S]{0,60}除以\s*(?:十|10)/)
        expect(flowParagraph(after.project, REMAINING_IDS.paragraphOne)).toEqual(flowParagraph(before.project, REMAINING_IDS.paragraphOne))
        expect(flowSurface(after.project).blocks.map(block => block.id)).toEqual(flowSurface(before.project).blocks.map(block => block.id))
        expect(spatialSurface(after.project)).toEqual(spatialSurface(before.project))
        const flowRecord = await selectedRecord(run!)
        expect(committed(flowRecord).length).toBeGreaterThan(0)
        if (resume?.requiresFreshFlowFeedback) {
          initialNativeId = flowRecord.externalSessionId ?? undefined
          if (!initialNativeId) throw new Error('The fresh recovered-Flow feedback has no native session identity')
          expect(initialNativeId).not.toBe(resume.previousExternalSessionId)
          const continuation = manifest.continuation as Record<string, unknown>
          continuation.freshNativeSession = { recordId: flowRecord.id, externalSessionId: initialNativeId,
            previousExternalSessionId: resume.previousExternalSessionId }
          persist()
        }
        await verifyPublishedControls(run!, 'T09-flow')
      })

      if (!initialNativeId) throw new Error('The current remaining stage has no native session identity')
      if (!resume?.spatialCompletedRoot) await test.step('T09 Spatial moves the same object to the real nonzero camera center', async () => {
        await openSurface(run!, 'spatial-camera')
        await selectSpatialObject(run!)
        await selectReferenceScope(chat(run!), 'selection')
        const before = readSaved(projectPath), oldSurface = spatialSurface(before.project)
        const paintedCamera = JSON.parse((await run!.page.getByTestId('spatial-world-stage').getAttribute('data-observation-spatial-camera')) ?? 'null') as number[] | null
        if (!paintedCamera || paintedCamera.length !== 3 || paintedCamera.some(value => !Number.isFinite(value))) throw new Error('The actual Spatial painter has no current camera observation')
        const camera = { x: paintedCamera[0]!, y: paintedCamera[1]!, zoom: paintedCamera[2]! }
        const originalItem = oldSurface.world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!
        await sendNatural(run!, 'T09-spatial', REMAINING_PROMPTS.T09Spatial, turnTimeoutMs)
        await recordSpatialObservation(run!, camera)
        const after = await saveStage(run!, 'T09-spatial'), surface = spatialSurface(after.project)
        const item = surface.world.layerItems.find(item => item.layerItemId === REMAINING_IDS.spatialObject)!
        expect(item, 'The stable world object must survive').toBeTruthy()
        expect(item.frame.width).toBe(originalItem.frame.width); expect(item.frame.height).toBe(originalItem.frame.height)
        expect(Math.abs(item.frame.x + item.frame.width / 2 - camera.x)).toBeLessThan(2)
        expect(Math.abs(item.frame.y + item.frame.height / 2 - camera.y)).toBeLessThan(2)
        expect(surface.camera).toEqual(oldSurface.camera)
        expect(flowSurface(after.project)).toEqual(flowSurface(before.project))
        await saveVisualReview(run!, 'T09-spatial-visible', run!.page.getByTestId('spatial-workspace'))
        await verifyPublishedControls(run!, 'T09-spatial')
      })

      if (!resume?.t11ProgressRoot) await test.step('T10 first reproduces the actual broken button, then asks the model to diagnose and repair it', async () => {
        await openSurface(run!, 'slide-scene')
        await selectReferenceScope(chat(run!), 'selection')
        const before = readSaved(projectPath)
        await verifyButtonClick(run!, 'broken', 'T10-broken', true)
        // Entering trial mode intentionally clears authoring selection. Select
        // the same actual Runtime through Layers after reproducing the failure.
        await selectLayer(run!.page, REMAINING_IDS.brokenRuntime)
        await expect(run!.page.getByRole('button', { name: '当前位置试运行', exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(chat(run!).getByLabel('本轮引用摘要')).toContainText('点击显示答案')
        await sendNatural(run!, 'T10', REMAINING_PROMPTS.T10, turnTimeoutMs)
        await recordRuntimeDomObservation(run!, before.project.revision)
        const record = await selectedRecord(run!)
        expect(record.observations.some(observation => observation.source === 'trial' && observation.runtime !== null),
          'The model must receive the real trial-run observation, not a separately invented screenshot').toBe(true)
        expect(committed(record).length).toBeGreaterThan(0)
        await run!.page.getByRole('button', { name: '编辑状态', exact: true }).click()
        const after = await saveStage(run!, 'T10-repaired')
        expect(buttonRuntime(after.project).runtime.source).not.toBe(buttonRuntime(before.project).runtime.source)
        expect(buttonRuntime(after.project).frame).toEqual(buttonRuntime(before.project).frame)
        await verifyButtonClick(run!, 'repaired', 'T10-repaired')
      })

      if (!resume?.t11ProgressRoot) await test.step('T11 answers a real native clarification through the available UI path', async () => {
        await run!.page.getByRole('button', { name: '编辑状态', exact: true }).click()
        await run!.page.getByRole('button', { name: '基础场景，所有命名状态的继承源', exact: true }).click()
        await selectLayer(run!.page, FIXTURE_IDS.title)
        await selectReferenceScope(chat(run!), 'selection')
        const before = readSaved(projectPath)
        await beginNatural(run!, 'T11-question', REMAINING_PROMPTS.T11Ask)
        let clarification: 'structured' | 'text' | undefined
        await waitUiBoundary(run!, 'T11 actual clarification', turnTimeoutMs, async () => {
          const active = await selectedRecord(run!).catch(() => null)
          if (active?.tasks.at(-1)?.goal !== REMAINING_PROMPTS.T11Ask) return false
          const question = chat(run!).getByRole('region', { name: 'CLI 提问' })
          if (await question.count()) { clarification = 'structured'; return true }
          const text = await chat(run!).locator('.chat-scroll > .chat-message').last().innerText().catch(() => '')
          if (/标题/.test(text) && /什么|哪|请告诉|请问|[？?]/.test(text)) { clarification = 'text'; return true }
          return false
        }, true)
        expect(committed(await selectedRecord(run!)), 'The requested question must precede all project writes').toHaveLength(0)
        await assertSavedUnchanged(run!, 'T11-before-answer', before)
        await saveVisualReview(run!, 'T11-question-visible', chat(run!))
        writeFileSync(join(runRoot, 'T11-clarification-path.json'), JSON.stringify({ cli, clarification, answer: REMAINING_PROMPTS.T11Answer }, null, 2))
        if (clarification === 'structured') {
          const question = chat(run!).getByRole('region', { name: 'CLI 提问' })
          const legends = await question.locator('legend').allTextContents()
          if (!legends.length || legends.some(text => !/标题/.test(text))) throw new Error('The real clarification needs information outside this fixed title task; inspect the retained question instead of guessing')
          const inputs = question.getByRole('textbox')
          expect(await inputs.count()).toBe(legends.length)
          for (const input of await inputs.all()) await input.fill('波动的秘密')
          await question.getByRole('button', { name: '发送回答', exact: true }).click()
          await expect(question).toHaveCount(0)
        } else {
          await chat(run!).getByLabel('发送给创作助手', { exact: true }).fill(REMAINING_PROMPTS.T11Answer)
          await chat(run!).getByRole('button', { name: /^(发送输入|发送)$/ }).click()
        }
        await expect(chat(run!).getByRole('button', { name: '停止', exact: true })).toBeEnabled()
        await waitNativeTurn(run!, 'T11-answered', turnTimeoutMs)
        const after = await saveStage(run!, 'T11-answered')
        expect(titleItem(after.project).content.data.text).toBe('波动的秘密')
        expect((await selectedRecord(run!)).externalSessionId).toBe(initialNativeId)
      })

      if (!resume?.t11ProgressRoot || resume.requiresQueuedSupplementCompletion) await test.step('T11 delivers an active supplement and stops a real unfinished turn with no late project writes', async () => {
        await selectReferenceScope(chat(run!), 'page')
        await beginNatural(run!, 'T11-active', REMAINING_PROMPTS.T11Start)
        await waitUiBoundary(run!, 'T11 native active turn', 60000, async () => {
          const record = await selectedRecord(run!).catch(() => null)
          if (!record || record.tasks.at(-1)?.goal !== REMAINING_PROMPTS.T11Start) return false
          if (committed(record).length) throw new Error('T11 missed the pre-commit intervention window; this attempt is not valid concurrency evidence')
          return record.tasks.at(-1)?.status === 'running' && record.events.some(event => event.kind === 'tool' || event.kind === 'text')
        })
        const oldDeliveries = new Set((await selectedRecord(run!)).events.filter(event => event.kind === 'input-delivery').map(event => event.delivery.inputId))
        writeFileSync(join(runRoot, 'T11-supplement.input.json'), JSON.stringify({ prompt: REMAINING_PROMPTS.T11Supplement, time: new Date().toISOString() }, null, 2))
        await chat(run!).getByLabel('输入用途', { exact: true }).selectOption('supplement')
        await chat(run!).getByLabel('发送给创作助手', { exact: true }).fill(REMAINING_PROMPTS.T11Supplement)
        await chat(run!).getByRole('button', { name: '发送输入', exact: true }).click()
        await waitUiBoundary(run!, 'T11 supplement native acceptance/consumption', turnTimeoutMs, async () => {
          const record = await selectedRecord(run!)
          if (committed(record).length) throw new Error('T11 completed a live stage before the required Stop window; retain this failed attempt')
          return record.events.some(event => event.kind === 'input-delivery' && !oldDeliveries.has(event.delivery.inputId)
            && ['accepted', 'consumed'].includes(event.delivery.status))
        })
        const beforeStop = await saveStage(run!, 'T11-before-stop')
        const recordBefore = await selectedRecord(run!)
        expect(committed(recordBefore)).toHaveLength(0)
        await expect(chat(run!).getByRole('button', { name: '停止', exact: true })).toBeEnabled()
        await chat(run!).getByRole('button', { name: '停止', exact: true }).click()
        await expect(chat(run!).getByRole('button', { name: '停止', exact: true })).toBeDisabled()
        await expect.poll(async () => (await selectedRecord(run!)).tasks.at(-1)?.status, { timeout: 15000 }).toBe('cancelled')
        await assertSavedUnchanged(run!, 'T11-stopped', beforeStop)
        await run!.page.waitForTimeout(5000)
        await assertSavedUnchanged(run!, 'T11-late-result-window', beforeStop)
        const recordAfter = await selectedRecord(run!)
        expect(committed(recordAfter)).toHaveLength(0)
        expect(recordAfter.tasks.at(-1)!.epoch).toBeGreaterThan(recordBefore.tasks.at(-1)!.epoch)
        expect(recordAfter.events.some(event => event.kind === 'turn-ended' && event.status === 'cancelled')).toBe(true)
        await recordEvidence(run!, 'T11-stop')
      })

      let resumeSessionId = '', resumeNativeId = ''
      await test.step('T12 reviews a real before/after candidate, applies it, and follows actual mixed Undo history', async () => {
        await run!.page.getByRole('button', { name: '编辑状态', exact: true }).click()
        await run!.page.getByRole('button', { name: '基础场景，所有命名状态的继承源', exact: true }).click()
        await selectLayer(run!.page, FIXTURE_IDS.title)
        await selectReferenceScope(chat(run!), 'selection')
        await chat(run!).getByLabel('应用方式', { exact: true }).selectOption('preview')
        const before = readSaved(projectPath)
        await beginNatural(run!, 'T12-preview', REMAINING_PROMPTS.T12Preview)
        await waitUiBoundary(run!, 'T12 checked preview before any commit', turnTimeoutMs,
          async () => await chat(run!).getByRole('region', { name: '候选变更预览' }).count() > 0)
        expect(committed(await selectedRecord(run!))).toHaveLength(0)
        await assertSavedUnchanged(run!, 'T12-preview-zero-write', before)
        await waitReviewedPreviews(run!, turnTimeoutMs)
        const applied = await saveStage(run!, 'T12-applied')
        expect(titleItem(applied.project).content.data.text).toBe('保存与恢复验证')
        const record = await selectedRecord(run!), count = committed(record).length
        expect(count).toBeGreaterThan(0)
        resumeSessionId = record.id; resumeNativeId = record.externalSessionId!
        await selectLayer(run!.page, FIXTURE_IDS.title)
        const title = run!.page.getByRole('textbox', { name: '文字内容', exact: true })
        await title.fill(MANUAL_AFTER_AI); await title.press('Tab')
        await saveStage(run!, 'T12-manual-after-ai')
        await expect(chat(run!).getByRole('button', { name: '撤销最近一次 AI 修改', exact: true })).toBeDisabled()
        await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
        expect(titleItem((await saveStage(run!, 'T12-undo-manual')).project)).toEqual(titleItem(applied.project))
        for (let index = 0; index < count; index++) await run!.page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true }).click()
        const undone = await saveStage(run!, 'T12-undo-ai')
        expect(titleItem(undone.project)).toEqual(titleItem(before.project))
        expect(flowSurface(undone.project)).toEqual(flowSurface(before.project))
        expect(spatialSurface(undone.project)).toEqual(spatialSurface(before.project))
        for (let index = 0; index < count + 1; index++) await run!.page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
        expect(titleItem((await saveStage(run!, 'T12-redo-all')).project).content.data.text).toBe(MANUAL_AFTER_AI)
      })

      await test.step('T12 reopens saved content and restarts the actual app before resuming the confirmed native conversation', async () => {
        const final = readSaved(projectPath), recordIds = nativeRecords(run!).map(record => record.id)
        await chat(run!).getByRole('button', { name: '关闭', exact: true }).click()
        await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
        await selectLayer(run!.page, FIXTURE_IDS.title)
        await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MANUAL_AFTER_AI)
        await assertSavedUnchanged(run!, 'T12-reopened', final)
        await verifyButtonClick(run!, 'repaired', 'T12-reopened-button')
        if (traceEnabled) await run!.app.context().tracing.stop({ path: join(runRoot, 'trace-before-restart.zip') })
        await closeNativeEditor(run!)
        run = await launchNativeEditor(productRoot, runRoot, projectPath, resume)
        launches.push(run)
        if (traceEnabled) await run.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
        expect(nativeRecords(run).map(record => record.id)).toEqual(expect.arrayContaining(recordIds))
        await run.page.getByRole('button', { name: '创作助手', exact: true }).click()
        await chat(run).getByLabel('会话', { exact: true }).selectOption(resumeSessionId)
        await expect(chat(run).locator('.chat-message').last()).toBeVisible()
        await configureRemainingModel(run, model, effort)
        await selectLayer(run.page, FIXTURE_IDS.title)
        await selectReferenceScope(chat(run), 'selection')
        await chat(run).getByLabel('意图', { exact: true }).selectOption('discuss')
        await sendNatural(run, 'T12-restart-continue', REMAINING_PROMPTS.T12Resume, turnTimeoutMs)
        await expect(chat(run).locator('.chat-scroll > .chat-message').last()).toContainText(MANUAL_AFTER_AI)
        const resumed = await selectedRecord(run)
        expect(resumed.id).not.toBe(resumeSessionId)
        expect(resumed.externalSessionId).toBe(resumeNativeId)
        expect(committed(resumed)).toHaveLength(0)
        confirmConfiguration(resumed, cli, model, effort)
        await assertSavedUnchanged(run, 'T12-resumed-zero-write', final)
      })

      await test.step('050 imports and references actual project material, generates an editable empty page, and revises it in the same native conversation', async () => {
        const before = readSaved(projectPath)
        const blank = before.project.surfaces.find(surface => surface.type === 'slide' && surface.title === MATERIAL_FIXTURE.blankPageName)
        if (!blank || blank.type !== 'slide') throw new Error('The formally created material page is missing')
        expect(blank.surfaceLayerItems).toHaveLength(0)
        expect(blank.scenes.flatMap(scene => scene.layerItems), 'The source fixture must not preload the answer').toHaveLength(0)
        const location = before.project.locations.find(location => location.surfaceId === blank.id)!
        await run!.page.getByTestId(`scene-item-${location.id}`).click()
        const nativeId = await importAndReferenceMaterial(run!, cli, model, effort)
        expect(nativeId).toBe(resumeNativeId)
        await expect(chat(run!).getByLabel('本轮引用摘要')).toContainText(location.label)
        await assertSavedUnchanged(run!, 'T050-material-import-zero-project-write', before)
        await sendNatural(run!, 'T050-generate', REMAINING_PROMPTS.T050Generate, turnTimeoutMs)
        const generated = await saveStage(run!, 'T050-generated')
        const texts = materialTexts(generated.project, blank.id)
        expect(texts.length, 'The page must contain independently editable title and body text').toBeGreaterThanOrEqual(2)
        const title = texts.filter(text => text.content.data.text === MATERIAL_FIXTURE.initialTitle)
        expect(title).toHaveLength(1)
        expectMaterialBody(generated.project, blank.id)
        expect(materialSlide(generated.project, blank.id).scenes.flatMap(scene => scene.layerItems)
          .every(item => item.kind === 'native'), 'Simple material text must be authored as editable Native items').toBe(true)
        expect(generated.project.surfaces.filter(surface => surface.id !== blank.id)).toEqual(before.project.surfaces.filter(surface => surface.id !== blank.id))
        expect(generated.project.globalLayerItems).toEqual(before.project.globalLayerItems)
        expect(generated.assetFiles).toEqual(before.assetFiles); expect(generated.componentFiles).toEqual(before.componentFiles)
        const firstRecord = await selectedRecord(run!)
        expect(firstRecord.externalSessionId).toBe(nativeId)
        expect(committed(firstRecord).length).toBeGreaterThan(0)
        confirmConfiguration(firstRecord, cli, model, effort)
        await recordMaterialObservation(run!, 'T050-generated', location.id)

        await sendNatural(run!, 'T050-continue', REMAINING_PROMPTS.T050Continue, turnTimeoutMs)
        const revised = await saveStage(run!, 'T050-revised')
        const nextTexts = materialTexts(revised.project, blank.id)
        expect(nextTexts.map(text => text.layerItemId)).toEqual(texts.map(text => text.layerItemId))
        const revisedTitle = nextTexts.find(text => text.layerItemId === title[0]!.layerItemId)!
        expect(revisedTitle.content.data.text).toBe(MATERIAL_FIXTURE.revisedTitle)
        expect(revisedTitle.frame).toEqual(title[0]!.frame)
        expect(revisedTitle.content.data.style).toEqual(title[0]!.content.data.style)
        expect(nextTexts.filter(text => text.layerItemId !== revisedTitle.layerItemId)).toEqual(texts.filter(text => text.layerItemId !== title[0]!.layerItemId))
        const expectedSlide = structuredClone(materialSlide(generated.project, blank.id))
        for (const scene of expectedSlide.scenes) scene.layerItems = scene.layerItems.map(item => item.layerItemId === revisedTitle.layerItemId ? revisedTitle : item)
        expect(materialSlide(revised.project, blank.id)).toEqual(expectedSlide)
        expectMaterialBody(revised.project, blank.id)
        expect(revised.project.surfaces.filter(surface => surface.id !== blank.id)).toEqual(generated.project.surfaces.filter(surface => surface.id !== blank.id))
        expect(revised.project.globalLayerItems).toEqual(generated.project.globalLayerItems)
        expect(revised.project.locations).toEqual(generated.project.locations)
        expect(revised.assetFiles).toEqual(generated.assetFiles); expect(revised.componentFiles).toEqual(generated.componentFiles)
        const nextRecord = await selectedRecord(run!)
        expect(nextRecord.id).not.toBe(firstRecord.id)
        expect(nextRecord.externalSessionId).toBe(nativeId)
        expect(committed(nextRecord).length).toBeGreaterThan(0)
        confirmConfiguration(nextRecord, cli, model, effort)
        await recordMaterialObservation(run!, 'T050-revised', location.id)
        await chat(run!).getByRole('button', { name: '关闭', exact: true }).click()
        await run!.page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
        await run!.page.getByTestId(`scene-item-${location.id}`).click()
        await selectLayer(run!.page, revisedTitle.layerItemId)
        await expect(run!.page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(MATERIAL_FIXTURE.revisedTitle)
        const reopened = await assertSavedUnchanged(run!, 'T050-reopened', revised)
        await verifyGreenImage(original, reopened)
        manifest.finalOfflineHtml = await verifyFreshRemainingHtml(run!, reopened, blank.id)
      })
      expect(launches.flatMap(launch => launch.pageErrors)).toEqual([])
      await recordEvidence(run, 'final')
      manifest.status = resume?.unresolvedQuestionRecordId ? 'T12-and-050-checks-passed-T11-question-still-incomplete'
        : 'automated-checks-passed-awaiting-visual-and-semantic-review'
    } catch (error) {
      manifest.status = 'failed'; manifest.failure = error instanceof Error ? error.stack : String(error)
      if (run) {
        await run.page.screenshot({ path: join(runRoot, 'failure.png'), animations: 'allow' }).catch(() => {})
        await recordEvidence(run, 'failure').catch(() => {})
        writeFileSync(join(runRoot, 'failure.ui.txt'), await run.page.locator('body').innerText().catch(() => 'UI unavailable'))
        try { manifest.failureSavedRevision = await preserveNativeFailure(run) }
        catch (saveError) { manifest.failureSaveError = String(saveError) }
      }
      throw error
    } finally {
      manifest.finishedAt = new Date().toISOString()
      if (run) {
        manifest.pageErrors = launches.flatMap(launch => launch.pageErrors)
        manifest.consoleErrors = launches.flatMap(launch => launch.consoleErrors)
        try { manifest.native = nativeEvidence(run).summary } catch (error) { manifest.nativeEvidenceError = String(error) }
        if (traceEnabled) await run.app.context().tracing.stop({ path: join(runRoot, 'trace.zip') }).catch(() => {})
        await closeNativeEditor(run)
      }
      if (resume) {
        try { assertRemainingHistoryPreserved(resume); manifest.existingHistoryPreserved = true }
        catch (error) { manifest.existingHistoryPreserved = false; manifest.historyPreservationError = String(error); persist(); throw error }
      }
      persist()
      await testInfo.attach('remaining-native-run-manifest', { path: join(runRoot, 'run.json'), contentType: 'application/json' })
    }
  })
}

test('R18 recovered Flow checkpoint retains the real partial record and requires fresh feedback with no model call during inspection', async () => {
  test.skip(checkpointInspect !== '1' || !resumeRecoveredFlow, 'Explicit zero-model recovered-Flow inspection gate is closed')
  const checkpoint = await loadRemainingRecoveredFlowResume(productRoot, resolve(resumeRecoveredFlow, '..', '..'), resumeRecoveredFlow,
    { cli: 'opencode', slot: 1, model: 'openai/gpt-5.6-luna', effort: 'max', gate: 'opencode-once' })
  expect(checkpoint.phase).toBe('after-recovered-Flow')
  expect(checkpoint.reuseNativeSession).toBe(false)
  expect(checkpoint.requiresFreshFlowFeedback).toBe(true)
  expect(checkpoint.previousExternalSessionId).toBeTruthy()
})

test('R18 queued/cancelled T11 checkpoint retains only the actual queued delivery before a fresh tail, with no model call during inspection', async () => {
  test.skip(checkpointInspect !== '1' || !resumeAfterT11QueuedCancelled, 'Explicit zero-model queued/cancelled T11 inspection gate is closed')
  const checkpoint = await loadRemainingAfterT11QueuedCancelledResume(productRoot, resumeAfterT11QueuedCancelled,
    { cli: 'opencode', slot: 1, model: 'openai/gpt-5.6-luna', effort: 'max', gate: 'opencode-once' })
  expect(checkpoint.phase).toBe('after-T11-queued-cancelled')
  expect(checkpoint.t11ProgressRoot).toBe(resumeAfterT11QueuedCancelled)
  expect(checkpoint.requiresQueuedSupplementCompletion).toBe(true)
  expect(checkpoint.t11QueuedCancelledRecordId).toBeTruthy()
  expect(checkpoint.record.tasks.at(-1)).toMatchObject({ status: 'cancelled', epoch: 1 })
})

test('R18 reviewed Claude Flow correction is a preserved same-session continuation with a completed semantic review', async () => {
  test.skip(checkpointInspect !== '1' || !resumePlanContinuation, 'Explicit zero-model reviewed-Claude inspection gate is closed')
  const checkpoint = await loadRemainingPlanContinuation(productRoot, resumePlanContinuation,
    { cli: 'claude', slot: 1, model: 'sonnet', effort: 'low', gate: 'claude-once' })
  expect(checkpoint.phase).toBe('after-reviewed-T08-and-Flow')
  expect(checkpoint.reuseNativeSession).toBe(true)
  expect(checkpoint.record.tasks.at(-1)?.status).toBe('completed')
})

test('R18 rejected Claude plan checkpoint cannot be misrepresented as a completed reviewed continuation', async () => {
  test.skip(checkpointInspect !== '1' || !planNegativeCheckpoint, 'Explicit zero-model rejected-Claude inspection gate is closed')
  await expect(loadRemainingPlanContinuation(productRoot, planNegativeCheckpoint,
    { cli: 'claude', slot: 1, model: 'sonnet', effort: 'low', gate: 'claude-once' })).rejects.toThrow()
})

test.describe.configure({ mode: 'serial', retries: 0 })
