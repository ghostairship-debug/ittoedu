import type { CourseProjectDocument, SlideSceneDocument } from '../../../shared/courseProjectTypes'
import type { InteractionRule } from '../../../shared/contracts/interaction-v1/types'
import { composeCourseProjectLocation } from '../../../shared/courseLayerComposition'
import { buildPublishedCourseV2Payload } from '../../export/course/buildPublishedCourse'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'
import { createPublishedCourseSession } from '../../../player/surfaces/publishedDynamicHosts'
import { waitForPublishedObservationReady } from '../../../player/surfaces/publishedCapture'
import { adjacentPlaybackTarget, buildCoursePlaybackSequence } from '../../../player/navigation/coursePlaybackSequence'
import type { PublishedInteractionDiagnostic } from '../../../player/interactions/PublishedInteractionSurfacePort'

export interface NativeInteractionVerificationInput {
  before: CourseProjectDocument
  document: CourseProjectDocument
  resources: HistoryResourceState
  signal: AbortSignal
  deadlineAt: number
}
export interface NativeInteractionVerificationReport {
  checked: string[]
  skipped: Array<{ ruleId: string; reason: string }>
}
type Check = { locationId: string; stateId: string | null; scene: SlideSceneDocument; rule: InteractionRule; nodeId: string }

/** Only changed declarative clicks are exercised. Existing scene-enter failures
 * remain visible in normal diagnostics, but do not become this candidate's failures. */
export function nativeInteractionChecks(before: CourseProjectDocument, project: CourseProjectDocument) {
  const previous = new Map(before.surfaces.flatMap(surface => surface.type === 'slide'
    ? surface.scenes.map(scene => [`${surface.id}/${scene.id}`, scene.interactions] as const) : []))
  const checks: Check[] = [], skipped: NativeInteractionVerificationReport['skipped'] = []
  for (const surface of project.surfaces) if (surface.type === 'slide') for (const scene of surface.scenes) {
    const old = previous.get(`${surface.id}/${scene.id}`) ?? []
    for (const rule of scene.interactions) {
      if (!rule.enabled || old.some(value => JSON.stringify(value) === JSON.stringify(rule))) continue
      if (rule.trigger.type !== 'node.click') { skipped.push({ ruleId: rule.id, reason: '本检查只覆盖 Native 点击触发' }); continue }
      if (rule.conditions.some(condition => condition.type !== 'scene.in'
        || !condition.sceneIds.includes(scene.id))) { skipped.push({ ruleId: rule.id, reason: '带运行期条件，需要满足条件后的操作证据' }); continue }
      const location = project.locations.find(value => value.kind === 'slide-scene' && value.surfaceId === surface.id && value.sceneId === scene.id)
      if (!location || location.kind !== 'slide-scene') continue
      const stateId = location.stateId ?? scene.presentation?.initialStateId ?? null
      const nodeId = rule.trigger.nodeId
      const trigger = composeCourseProjectLocation({ project, locationId: location.id, stateId }).entries.find(entry => entry.item.layerItemId === nodeId)
      if (!trigger?.mounted || !trigger.initiallyVisible) { skipped.push({ ruleId: rule.id, reason: '初始状态无法点击目标，需要对应状态的操作证据' }); continue }
      if (!rule.actions.every(step => ['node.enter', 'node.exit', 'presentation.set', 'scene.go', 'scene.next', 'scene.previous', 'step.next', 'step.previous', 'course-state.set'].includes(step.action.type))) {
        skipped.push({ ruleId: rule.id, reason: '媒体或连续机制需要专门的行为观察' }); continue
      }
      checks.push({ locationId: location.id, stateId, scene, rule, nodeId: rule.trigger.nodeId })
    }
  }
  return { checks, skipped }
}

/** Product-owned check of declared execution, not a natural-language evaluator.
 * Uses the actual Player and click binding; never touches the live editor. */
export async function verifyNativeInteractions(input: NativeInteractionVerificationInput): Promise<NativeInteractionVerificationReport> {
  const { before, document: project, resources, signal } = input
  const { checks, skipped } = nativeInteractionChecks(before, project)
  const report: NativeInteractionVerificationReport = { checked: [], skipped }
  if (!checks.length) return report
  const sources = { project, assetFiles: resources.assetFiles, components: resources.componentPackages }
  const payload = buildPublishedCourseV2Payload(sources)
  const sequence = buildCoursePlaybackSequence(payload)
  const guard = () => { if (signal.aborted || Date.now() >= input.deadlineAt) throw new Error('stale：交互检查已取消或执行预算已到') }
  const fail = (check: Check, message: string): never => { throw new AuthoringToolFailure([{ code: 'native-interaction-result-mismatch',
    path: ['scenes', check.scene.id, 'interactions', check.rule.id],
    message: `真实 Player 点击“${check.nodeId}”后：${message}。请修正该规则并在原任务重新交付；现有工程未应用此候选。` }]) }
  for (const check of checks) {
    guard()
    // A conservative sampling delay, not a second action scheduler. Long authored
    // animation remains bounded by the original task deadline, not a new 10s gate.
    const actionDuration = check.rule.actions.reduce((sum, step) => sum + step.delayMs
      + ((step.action.type === 'node.enter' || step.action.type === 'node.exit') && step.action.effect !== 'none' ? step.action.durationMs : 0), 0)
    const root = document.createElement('div')
    Object.assign(root.style, { position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '720px', pointerEvents: 'none' })
    root.setAttribute('aria-hidden', 'true')
    document.body.append(root)
    const diagnostics: PublishedInteractionDiagnostic[] = []
    const session = createPublishedCourseSession(payload, { initialLocationId: check.locationId,
      ...(check.stateId ? { initialPresentationStateId: check.stateId } : {}),
      services: { reportDiagnostic: value => { if ('ruleId' in value && value.ruleId === check.rule.id) diagnostics.push(value as PublishedInteractionDiagnostic) } } })
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const stop = () => { active = false; void session.destroy() }
    signal.addEventListener('abort', stop, { once: true })
    try {
      await Promise.race([(async () => {
        await session.mount(root)
        await waitForPublishedObservationReady(root)
        guard(); if (!active) return
        const item = (id: string) => Array.from(root.querySelectorAll<HTMLElement>('[data-slide-layer-item]')).find(element => element.dataset.slideLayerItem === id)
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
          if (['scene.next', 'scene.previous', 'step.next', 'step.previous'].includes(action.type)) {
            const target = adjacentPlaybackTarget(sequence, session.getPlaybackProgress(), action.type.startsWith('scene.') ? 'scene' : 'step', action.type.endsWith('next') ? 'next' : 'previous')
            if (target) { expectedLocation = target.locationId; expectedState = target.stateId ?? null; expectedVisibility.clear() }
          }
        }
        trigger!.click()
        const earliestResultAt = Date.now() + actionDuration
        const limit = Math.min(input.deadlineAt, earliestResultAt + 10_000)
        let actual = ''
        while (active) {
          guard()
          const slot = Array.from(root.querySelectorAll<HTMLElement>('[data-course-surface-slot]')).find(value => value.dataset.courseSurfaceSlot === session.navigator.current?.surfaceId)
          const scene = slot?.querySelector<HTMLElement>('.slide-published-adapter[data-scene-id]')
          const actualLocation = session.navigator.current?.locationId
          const actualState = scene?.dataset.presentationStateId ?? null
          const hiddenMismatch = [...expectedVisibility].filter(([id, expected]) => visible(id) !== expected)
          actual = `期望位置 ${expectedLocation} / 状态 ${expectedState ?? '无'}，实际 ${actualLocation} / ${actualState ?? '无'}${hiddenMismatch.length ? `；显隐不符：${hiddenMismatch.map(([id]) => id).join('、')}` : ''}`
          if (diagnostics.length) fail(check, `${diagnostics.map(value => `${value.code} (${value.stepId ?? ''})`).join('；')}；${actual}`)
          if (Date.now() >= earliestResultAt && actualLocation === expectedLocation && actualState === expectedState && !hiddenMismatch.length) {
            // Let synchronous click dispatch and its action microtasks finish before passing.
            await new Promise(resolve => setTimeout(resolve, 30))
            guard()
            if (diagnostics.length) fail(check, diagnostics.map(value => value.code).join('；'))
            report.checked.push(check.rule.id)
            return
          }
          if (Date.now() >= limit) fail(check, actual)
          await new Promise(resolve => setTimeout(resolve, 30))
        }
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AuthoringToolFailure([{ code: 'native-interaction-check-unavailable',
        message: `规则 ${check.rule.id} 的真实 Player 检查未在剩余预算内完成`, path: ['scenes', check.scene.id, 'interactions', check.rule.id] }])), Math.max(1, Math.min(actionDuration + 15_000, input.deadlineAt - Date.now()))) })])
    } finally {
      active = false; clearTimeout(timer); signal.removeEventListener('abort', stop)
      await session.destroy(); root.remove()
    }
    guard()
  }
  return report
}
