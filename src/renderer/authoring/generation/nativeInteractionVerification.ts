import type { CourseProjectDocument, SlideSceneDocument } from '../../../shared/courseProjectTypes'
import type { InteractionRule } from '../../../shared/contracts/interaction-v1/types'
import { composeCourseProjectLocation } from '../../../shared/courseLayerComposition'
import { buildPublishedCourseV2Payload } from '../../export/course/buildPublishedCourse'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'
import { createPublishedCourseSession } from '../../../player/surfaces/publishedDynamicHosts'
import { waitForPublishedObservationReady } from '../../../player/surfaces/publishedCapture'
import { adjacentPlaybackTarget, buildCoursePlaybackSequence } from '../../../player/navigation/coursePlaybackSequence'
import type { PublishedInteractionDiagnostic, PublishedInteractionRun } from '../../../player/interactions/PublishedInteractionSurfacePort'
import { isPublishedInteractionClickBindable } from '../../../shared/publishedInteractionSupport'

export interface NativeInteractionVerificationInput {
  before: CourseProjectDocument
  document: CourseProjectDocument
  resources: HistoryResourceState
  signal: AbortSignal
  deadlineAt: number
}
export interface NativeInteractionVerificationReport {
  checked: string[]
  executions?: PublishedInteractionRun[]
  evidence?: NativeInteractionExecutionEvidence[]
  skipped: Array<{ ruleId: string; reason: string }>
}
export interface NativeInteractionExecutionEvidence {
  source: 'published-player'
  ruleId: string
  runId: number
  chainId: number
  parentRunId?: number
  status: 'checked' | 'skipped' | 'failed'
  runStatus: PublishedInteractionRun['status']
  start: PublishedInteractionRun['start']
  end: PublishedInteractionRun['end']
  reason?: string
}

function executionEvidence(run: PublishedInteractionRun, status: NativeInteractionExecutionEvidence['status'], reason?: string): NativeInteractionExecutionEvidence {
  return { source: 'published-player', ruleId: run.ruleId, runId: run.runId, chainId: run.chainId,
    ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }), status, runStatus: run.status,
    start: run.start, end: run.end, ...(reason ? { reason } : {}) }
}
type Check = {
  scope: 'scene' | 'global'
  locationId: string
  stateId: string | null
  scene: SlideSceneDocument
  rule: InteractionRule
  nodeId: string
}

const checkableActionTypes = new Set([
  'node.enter', 'node.exit', 'presentation.set', 'scene.go', 'location.go',
  'scene.next', 'scene.previous', 'step.next', 'step.previous', 'course-state.set',
])

function isInitiallyClickableNative(
  entry: ReturnType<typeof composeCourseProjectLocation>['entries'][number],
): boolean {
  return entry.mounted
    && entry.initiallyVisible
    && entry.item.opacity > 0
    && isPublishedInteractionClickBindable(entry.item)
}

function checkableRuleReason(rule: InteractionRule): string | null {
  if (!rule.enabled) return '规则已禁用，未触发'
  if (rule.trigger.type !== 'node.click') return '本检查只覆盖 Native 点击触发'
  if (rule.conditions.some((condition) => condition.type !== 'scene.in')) {
    return '带运行期条件，需要满足条件后的操作证据'
  }
  if (!rule.actions.every((step) => checkableActionTypes.has(step.action.type))) {
    return '媒体或连续机制需要专门的行为观察'
  }
  return null
}

/** Only changed declarative clicks are exercised. Existing scene-enter failures
 * remain visible in normal diagnostics, but do not become this candidate's failures. */
export function nativeInteractionChecks(before: CourseProjectDocument, project: CourseProjectDocument) {
  const previous = new Map(before.surfaces.flatMap(surface => surface.type === 'slide'
    ? surface.scenes.map(scene => [`${surface.id}/${scene.id}`, scene.interactions] as const) : []))
  const checks: Check[] = [], skipped: NativeInteractionVerificationReport['skipped'] = []
  for (const surface of project.surfaces) if (surface.type === 'slide') for (const scene of surface.scenes) {
    const old = previous.get(`${surface.id}/${scene.id}`) ?? []
    for (const rule of scene.interactions) {
      if (old.some(value => JSON.stringify(value) === JSON.stringify(rule))) continue
      const unavailable = checkableRuleReason(rule)
      if (unavailable) { skipped.push({ ruleId: rule.id, reason: unavailable }); continue }
      if (rule.trigger.type !== 'node.click') continue
      if (rule.conditions.some(condition => condition.type !== 'scene.in'
        || !condition.sceneIds.includes(scene.id))) { skipped.push({ ruleId: rule.id, reason: '带运行期条件，需要满足条件后的操作证据' }); continue }
      const location = project.locations.find(value => value.kind === 'slide-scene' && value.surfaceId === surface.id && value.sceneId === scene.id)
      if (!location || location.kind !== 'slide-scene') continue
      const stateId = location.stateId ?? scene.presentation?.initialStateId ?? null
      const nodeId = rule.trigger.nodeId
      const trigger = composeCourseProjectLocation({ project, locationId: location.id, stateId }).entries.find(entry => entry.item.layerItemId === nodeId)
      if (!trigger?.mounted || !trigger.initiallyVisible) { skipped.push({ ruleId: rule.id, reason: '初始状态无法点击目标，需要对应状态的操作证据' }); continue }
      checks.push({ scope: 'scene', locationId: location.id, stateId, scene, rule, nodeId: rule.trigger.nodeId })
    }
  }
  for (const rule of project.globalInteractions) {
    if (before.globalInteractions.some(value => JSON.stringify(value) === JSON.stringify(rule))) continue
    const unavailable = checkableRuleReason(rule)
    if (unavailable) { skipped.push({ ruleId: rule.id, reason: unavailable }); continue }
    if (rule.trigger.type !== 'node.click') continue
    const nodeId = rule.trigger.nodeId
    const candidateLocations = project.locations.flatMap((location) => {
      if (location.kind !== 'slide-scene') return []
      const surface = project.surfaces.find(value => value.id === location.surfaceId)
      if (surface?.type !== 'slide') return []
      const scene = surface.scenes.find(value => value.id === location.sceneId)
      if (!scene || rule.conditions.some(condition => (
        condition.type === 'scene.in' && !condition.sceneIds.includes(scene.id)
      ))) return []
      const stateId = location.stateId ?? scene.presentation?.initialStateId ?? null
      const trigger = composeCourseProjectLocation({ project, locationId: location.id, stateId }).entries.find(entry => (
        entry.item.layerItemId === nodeId && isInitiallyClickableNative(entry)
      ))
      return trigger
        ? [{ scope: 'global' as const, locationId: location.id, stateId, scene, rule, nodeId }]
        : []
    })
    if (candidateLocations.length === 0) {
      skipped.push({ ruleId: rule.id, reason: '没有满足场景范围且初始可点击的 Slide 位置，需要对应状态的操作证据' })
      continue
    }
    checks.push(...candidateLocations)
  }
  return { checks, skipped }
}

/** Product-owned check of declared execution, not a natural-language evaluator.
 * Uses the actual Player and click binding; never touches the live editor. */
export async function verifyNativeInteractions(input: NativeInteractionVerificationInput): Promise<NativeInteractionVerificationReport> {
  const { before, document: project, resources, signal } = input
  const { checks, skipped } = nativeInteractionChecks(before, project)
  const report: NativeInteractionVerificationReport = { checked: [], skipped, executions: [], evidence: [] }
  if (!checks.length) return report
  const sources = { project, assetFiles: resources.assetFiles, components: resources.componentPackages }
  const payload = buildPublishedCourseV2Payload(sources)
  const sequence = buildCoursePlaybackSequence(payload)
  const guard = () => { if (signal.aborted || Date.now() >= input.deadlineAt) throw new Error('stale：交互检查已取消或执行预算已到') }
  const fail = (check: Check, message: string, runs: PublishedInteractionRun[] = []): never => { throw Object.assign(new AuthoringToolFailure([{ code: 'native-interaction-result-mismatch',
    path: check.scope === 'global' ? ['globalInteractions', check.rule.id] : ['scenes', check.scene.id, 'interactions', check.rule.id],
    message: `真实 Player 点击“${check.nodeId}”后：${message}。请修正该规则并在原任务重新交付；现有工程未应用此候选。` }]),
  { nativeInteractionEvidence: [...report.evidence!, ...runs.map(run => executionEvidence(run, run.parentRunId === undefined ? 'failed' : 'skipped', message))] }) }
  for (const check of checks) {
    guard()
    const root = document.createElement('div')
    Object.assign(root.style, { position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '720px', pointerEvents: 'none' })
    root.setAttribute('aria-hidden', 'true')
    document.body.append(root)
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const session = createPublishedCourseSession(payload, { initialLocationId: check.locationId,
      ...(check.stateId ? { initialPresentationStateId: check.stateId } : {}),
      services: { reportDiagnostic: value => { if ('ruleId' in value && value.ruleId === check.rule.id) diagnostics.push(value as PublishedInteractionDiagnostic) } } })
    let timer: ReturnType<typeof setTimeout> | undefined
    let observation: ReturnType<typeof session.interactionRuns.observe> | undefined
    let active = true
    const stop = () => { active = false; void session.destroy() }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await Promise.race([(async () => {
        await session.mount(root)
        await waitForPublishedObservationReady(root)
        guard(); if (!active) return
        const item = (id: string) => Array.from(root.querySelectorAll<HTMLElement>('[data-slide-layer-item], [data-global-layer-item]')).find(element => (
          element.dataset.slideLayerItem === id || element.dataset.globalLayerItem === id
        ))
        const visible = (id: string) => {
          const element = item(id)
          if (!element) return false
          const style = getComputedStyle(element)
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
        }
        const trigger = item(check.nodeId)
        if (!trigger || !visible(check.nodeId)) fail(check, '点击目标未实际显示')
        let expectedLocation = check.locationId, expectedState = check.stateId
        const expectedVisibility = new Map<string, boolean>()
        for (const { action } of check.rule.actions) {
          if (action.type === 'node.enter' || action.type === 'node.exit') expectedVisibility.set(action.nodeId, action.type === 'node.enter')
          if (action.type === 'presentation.set') {
            expectedState = action.stateId
            expectedVisibility.clear()
            // Enter rules run again after a presentation change and may animate
            // beyond its initial projection. Their targets need their own
            // observation; do not mistake initial visibility for a settled result.
            const enterMotionTargets = new Set(check.scene.interactions.filter(rule => rule.enabled && rule.trigger.type === 'scene.enter')
              .flatMap(rule => rule.actions.flatMap(({ action }) => action.type === 'node.enter' || action.type === 'node.exit' ? [action.nodeId] : [])))
            for (const entry of composeCourseProjectLocation({ project, locationId: check.locationId, stateId: expectedState }).entries) {
              if (enterMotionTargets.has(entry.item.layerItemId)) continue
              expectedVisibility.set(entry.item.layerItemId, entry.mounted && entry.initiallyVisible && entry.item.opacity > 0)
            }
            if (enterMotionTargets.size) report.skipped.push({ ruleId: check.rule.id, reason: `状态切换后的入场动画显隐另需观察：${[...enterMotionTargets].join('、')}` })
          }
          if (action.type === 'scene.go') {
            const target = project.locations.find(value => value.kind === 'slide-scene' && value.sceneId === action.sceneId)
            if (target?.kind === 'slide-scene') {
              expectedLocation = target.id
              const surface = project.surfaces.find(value => value.id === target.surfaceId)
              expectedState = action.targetStateId ?? target.stateId ?? (surface?.type === 'slide' ? surface.scenes.find(value => value.id === target.sceneId)?.presentation?.initialStateId : null) ?? null
              expectedVisibility.clear()
            }
          }
          if (action.type === 'location.go') {
            const target = project.locations.find(value => value.id === action.locationId)
            if (target) {
              expectedLocation = target.id
              const surface = project.surfaces.find(value => value.id === target.surfaceId)
              expectedState = target.kind === 'slide-scene' && surface?.type === 'slide'
                ? target.stateId ?? surface.scenes.find(value => value.id === target.sceneId)?.presentation?.initialStateId ?? null
                : null
              expectedVisibility.clear()
            }
          }
          if (['scene.next', 'scene.previous', 'step.next', 'step.previous'].includes(action.type)) {
            const target = adjacentPlaybackTarget(sequence, session.getPlaybackProgress(), action.type.startsWith('scene.') ? 'scene' : 'step', action.type.endsWith('next') ? 'next' : 'previous')
            if (target) { expectedLocation = target.locationId; expectedState = target.stateId ?? null; expectedVisibility.clear() }
          }
        }
        observation = session.interactionRuns.observe(check.rule.id, session.navigator.current!.surfaceId)
        trigger!.click()
        if (!observation.read().length) {
          fail(check, '初始可点击目标的实际点击未触发该规则')
        }
        let actual = ''
        while (active) {
          guard()
          const slot = Array.from(root.querySelectorAll<HTMLElement>('[data-course-surface-slot]')).find(value => value.dataset.courseSurfaceSlot === session.navigator.current?.surfaceId)
          const scene = slot?.querySelector<HTMLElement>('.slide-published-adapter[data-scene-id]')
          const actualLocation = session.navigator.current?.locationId
          const actualState = scene?.dataset.presentationStateId ?? null
          const hiddenMismatch = [...expectedVisibility].filter(([id, expected]) => visible(id) !== expected)
          actual = `期望位置 ${expectedLocation} / 状态 ${expectedState ?? '无'}，实际 ${actualLocation} / ${actualState ?? '无'}${hiddenMismatch.length ? `；显隐不符：${hiddenMismatch.map(([id]) => id).join('、')}` : ''}`
          const runs = observation!.read()
          if (diagnostics.length) fail(check, `${diagnostics.map(value => `${value.code} (${value.stepId ?? ''})`).join('；')}；${actual}`, runs)
          const triggered = runs.filter(run => run.parentRunId === undefined)
          const unsuccessful = triggered.find(run => run.status === 'failed' || run.status === 'cancelled')
          if (unsuccessful) fail(check, `运行 ${unsuccessful.runId} ${unsuccessful.status} (${unsuccessful.reason ?? ''})；${actual}`, runs)
          if (triggered.every(run => run.status !== 'running')) {
            report.executions!.push(...runs)
            for (const run of runs.filter(value => value.parentRunId !== undefined)) {
              report.skipped.push({ ruleId: run.ruleId, reason: `关联入场运行 ${run.runId}（来源 ${run.parentRunId}）未纳入本次结果核对；终态 ${run.status}` })
            }
            if (triggered.some(run => run.status === 'skipped')) {
              report.skipped.push({ ruleId: check.rule.id, reason: '本次触发被跳过，未证明动作结果' })
              report.evidence!.push(...runs.map(run => executionEvidence(run, 'skipped', '本次运行未纳入结果核对')))
              return
            }
            if (actualLocation !== expectedLocation || actualState !== expectedState || hiddenMismatch.length) fail(check, actual, runs)
            report.evidence!.push(...runs.map(run => executionEvidence(run, run.parentRunId === undefined ? 'checked' : 'skipped', run.parentRunId === undefined ? undefined : '入场运行未纳入本次结果核对')))
            if (!report.checked.includes(check.rule.id)) report.checked.push(check.rule.id)
            return
          }
          await new Promise(resolve => setTimeout(resolve, 16))
        }
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AuthoringToolFailure([{ code: 'native-interaction-check-unavailable',
        message: `规则 ${check.rule.id} 的真实 Player 检查未在剩余预算内完成`, path: ['scenes', check.scene.id, 'interactions', check.rule.id] }])), Math.max(1, input.deadlineAt - Date.now())) })])
    } finally {
      observation?.close()
      active = false; clearTimeout(timer); signal.removeEventListener('abort', stop)
      await session.destroy(); root.remove()
    }
    guard()
  }
  return report
}
