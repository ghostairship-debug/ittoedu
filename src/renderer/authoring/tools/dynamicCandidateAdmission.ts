import type { CourseProjectDocument, FlowBlock, LayerItem } from '../../../shared/courseProjectTypes'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { buildPublishedCourseV2Payload, collectPublishedCourseSourceIssues, collectPublishedCourseComponentKeys } from '../../export/course/buildPublishedCourse'
import { AuthoringToolFailure } from './executeAuthoringTool'
import { capturePublishedSurfacePng, waitForPublishedObservationReady } from '../../../player/surfaces/publishedCapture'
import { bytesToBase64 } from '../../export/base64'
import { exercisePublishedDynamicUpdates, exercisePublishedDynamicLifecycle } from '../../../player/surfaces/publishedDynamicUpdateProbe'
import type { DynamicInstanceCapture } from '../../../shared/dynamicAdmissionContract'
import { DYNAMIC_BEHAVIOR_SAMPLING, dynamicBehaviorObservationSchema, dynamicButtonCheckSchema, type DynamicBehaviorFrame, type DynamicBehaviorObservation, type DynamicButtonCheck, type DynamicButtonObservation } from '../../../shared/dynamicBehaviorObservation'
import { resolveRuntimeDomButton } from '../generation/runtimeDomControlObservation'
import { componentRuntimeSourceIdentity } from '../../../shared/componentRegistryIdentity'
import { validateDynamicCandidateFallbackAssets } from './dynamicCandidateFallbackAssets'
import { dynamicAdmissionScope } from './dynamicAdmissionScope'

export interface DynamicVerificationOptions {
  verificationMode?: 'full-admission' | 'public-props'
  buttonCheck?: DynamicButtonCheck
  onBehaviorEvidence?: (evidence: readonly DynamicBehaviorObservation[]) => void
  assetResources?: Readonly<Record<string, { url: string; byteLength: number }>>
  onTargetComplete?: () => void
}
export interface DynamicBehaviorCapturePort {
  captureFrame(): Promise<{ dataUrl: string; capturedAt: number; width: number; height: number }>
  clickAt?(point: { x: number; y: number }): Promise<void>
}

function sourceIdentities(project: CourseProjectDocument, resources: HistoryResourceState, ids: readonly string[]) {
  const result: Record<string, string> = {}
  const layer = (item: LayerItem) => {
    if (!ids.includes(item.layerItemId)) return
    if (item.kind === 'runtime') result[item.layerItemId] = componentRuntimeSourceIdentity(JSON.stringify({ runtime: item.runtime, frame: item.frame }))
    if (item.kind === 'component') result[item.layerItemId] = componentRuntimeSourceIdentity(JSON.stringify({ component: item.component, contentIdentity: resources.componentPackages[item.component.packageId]?.contentSha256, props: item.props, frame: item.frame }))
  }
  const blocks = (items: FlowBlock[]) => items.forEach(item => {
    if (item.type === 'section') blocks(item.blocks)
    if (item.type === 'component' && ids.includes(item.id)) result[item.id] = componentRuntimeSourceIdentity(JSON.stringify({ component: item.component, contentIdentity: resources.componentPackages[item.component.packageId]?.contentSha256, props: item.props }))
  })
  project.globalLayerItems.forEach(entry => layer(entry.item))
  project.surfaces.forEach(surface => {
    surface.surfaceLayerItems.forEach(entry => layer(entry.item))
    if (surface.type === 'slide') surface.scenes.forEach(scene => scene.layerItems.forEach(layer))
    if (surface.type === 'spatial-2d') surface.world.layerItems.forEach(layer)
    if (surface.type === 'flow') blocks(surface.blocks)
  })
  return result
}

/** Exercise code even when its authored instance is hidden/disabled. This private
 * projection never participates in the candidate transaction or saved output. */
function admissionProjection(project: CourseProjectDocument, instanceIds: readonly string[]): CourseProjectDocument {
  const next = structuredClone(project)
  const ids = new Set(instanceIds)
  const activate = (item: LayerItem) => {
    if (!ids.has(item.layerItemId)) return
    item.visible = true
    item.playbackInitialVisibility = 'inherit'
    if (item.kind === 'runtime') item.runtime.enabled = true
  }
  next.globalLayerItems.forEach(entry => { activate(entry.item); if (ids.has(entry.item.layerItemId)) entry.visibility = { mode: 'all', locationIds: [] } })
  for (const surface of next.surfaces) {
    surface.surfaceLayerItems.forEach(entry => { activate(entry.item); if (ids.has(entry.item.layerItemId)) entry.visibility = { mode: 'all', locationIds: [] } })
    if (surface.type === 'flow') {
      const expandTargets = (blocks: FlowBlock[]): boolean => {
        let containsTarget = false
        for (const block of blocks) {
          if (ids.has(block.id)) containsTarget = true
          if (block.type === 'section' && expandTargets(block.blocks)) { block.collapsedByDefault = false; containsTarget = true }
        }
        return containsTarget
      }
      expandTargets(surface.blocks)
    }
    if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(activate)
      const worldTargets = surface.world.layerItems.filter(item => ids.has(item.layerItemId))
      if (worldTargets.length) {
        const left = Math.min(...worldTargets.map(item => item.frame.x))
        const top = Math.min(...worldTargets.map(item => item.frame.y))
        const right = Math.max(...worldTargets.map(item => item.frame.x + item.frame.width))
        const bottom = Math.max(...worldTargets.map(item => item.frame.y + item.frame.height))
        const pose = { x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.min(1, 1152 / (right - left), 648 / (bottom - top)) }
        surface.camera.home = pose
        surface.camera.frames.forEach(frame => Object.assign(frame, pose))
        surface.semanticZoom = surface.semanticZoom.map(rule => ({ ...rule, layerItemIds: rule.layerItemIds.filter(id => !ids.has(id)) })).filter(rule => rule.layerItemIds.length)
      }
    }
    if (surface.type === 'slide') for (const scene of surface.scenes) {
      scene.layerItems.forEach(activate)
      for (const state of scene.presentation?.states ?? []) for (const id of ids) {
        const override = state.layerItemOverrides[id]
        if (override) { override.visible = true; override.playbackInitialVisibility = 'inherit' }
      }
    }
  }
  return next
}

/** Fixed product admission: callers cannot supply a success flag or replace the host. */
export async function admitDynamicCandidate(project: CourseProjectDocument, resources: HistoryResourceState,
  targets: readonly { locationId: string; stateId?: string | null; instanceIds: readonly string[] }[], signal?: AbortSignal,
  captureInstances = false, options: DynamicVerificationOptions = {}): Promise<readonly DynamicInstanceCapture[]> {
  if (signal?.aborted) throw new Error('动态准入已取消')
  // A click can navigate beyond the initial target; retain its real destination.
  if (!options.buttonCheck) project = dynamicAdmissionScope(project, targets.map(target => target.locationId))
  const packages = collectPublishedCourseComponentKeys(project)
  resources = { ...resources, componentPackages: Object.fromEntries(Object.entries(resources.componentPackages).filter(([, pkg]) => packages.has(`${pkg.manifest.id}@${pkg.manifest.version}`))) }
  const api = typeof window !== 'undefined' ? window.desktopAPI?.dynamicAdmission : undefined
  if (!api) return runDynamicCandidateHostSmoke(project, resources, targets, captureInstances, options)
  const id = crypto.randomUUID()
  const payload = { project, captureInstances, observeBehavior: true, verificationMode: options.verificationMode ?? 'full-admission',
    ...(options.buttonCheck ? { buttonCheck: dynamicButtonCheckSchema.parse(options.buttonCheck) } : {}), targets: targets.map(target => ({ ...target, instanceIds: [...target.instanceIds] })),
    assetFiles: Object.fromEntries(Object.entries(resources.assetFiles).map(([id, bytes]) => [id, new Uint8Array(bytes)])),
    componentFiles: Object.fromEntries(Object.entries(resources.componentPackages).map(([key, data]) => [key,
      Object.fromEntries(Object.entries(data.files).map(([name, bytes]) => [name, bytesToBase64(bytes)]))])) }
  const cancel = () => { void api({ operation: 'cancel', id }).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await api({ operation: 'run', id, payload })
    if (signal?.aborted || !result.ok) throw new AuthoringToolFailure(!signal?.aborted && result.diagnostics?.length ? result.diagnostics
      : [{ code: 'dynamic-host-failed', message: signal?.aborted ? '动态准入已取消' : result.message, path: [] }], result.behaviorEvidence)
    if (result.behaviorEvidence?.length) options.onBehaviorEvidence?.(result.behaviorEvidence)
    return result.captures ?? []
  } finally { signal?.removeEventListener('abort', cancel) }
}

/** Existing code and public props keep their identity; only affected live inputs are exercised. */
export async function verifyDynamicCandidateBehavior(project: CourseProjectDocument, resources: HistoryResourceState,
  targets: Parameters<typeof admitDynamicCandidate>[2], signal?: AbortSignal): Promise<DynamicBehaviorObservation[]> {
  const evidence: DynamicBehaviorObservation[] = []
  await admitDynamicCandidate(project, resources, targets, signal, false, { verificationMode: 'public-props', onBehaviorEvidence: values => evidence.push(...values) })
  return evidence
}

/** Executes inside the disposable process, or the existing trusted browser Builder host. */
export async function runDynamicCandidateHostSmoke(project: CourseProjectDocument, resources: HistoryResourceState,
  targets: readonly { locationId: string; stateId?: string | null; instanceIds: readonly string[] }[], captureInstances = false,
  options: DynamicVerificationOptions & { capturePort?: DynamicBehaviorCapturePort } = {}): Promise<readonly DynamicInstanceCapture[]> {
  if (options.buttonCheck && (options.verificationMode === 'public-props' || !options.capturePort?.clickAt
    || targets.filter(target => target.instanceIds.includes(options.buttonCheck!.instanceId)).length !== 1)) throw new Error('按钮检查需要唯一候选目标和真实独立窗口输入端口')
  await validateDynamicCandidateFallbackAssets(project, resources, targets.flatMap(target => target.instanceIds), options.assetResources)
  const captures: DynamicInstanceCapture[] = []
  const observed: DynamicBehaviorObservation[] = []
  let captureBytes = 0
  const sources = { project, assetFiles: resources.assetFiles, components: resources.componentPackages, assetResources: options.assetResources }
  const fullAdmission = options.verificationMode !== 'public-props'
  const issues = fullAdmission ? collectPublishedCourseSourceIssues(sources) : []
  if (issues.length) throw new AuthoringToolFailure(issues.map(issue => ({ ...issue, path: issue.path.map(String) })))
  if (typeof document === 'undefined' || !document.defaultView || !document.createElement('canvas').getContext('2d')) {
    throw new Error('动态工具需要产品浏览器中的真实 Published 宿主准入')
  }
  const { createPublishedCourseSession } = await import('../../../player/surfaces/publishedDynamicHosts')
  const payload = buildPublishedCourseV2Payload({ ...sources, project: admissionProjection(project, targets.flatMap(target => [...target.instanceIds])) })
  const root = document.createElement('div')
  Object.assign(root.style, { position: 'fixed', left: options.capturePort ? '0' : '-1400px', top: '0', width: '1280px', height: '720px', pointerEvents: 'none' })
  root.setAttribute('aria-hidden', 'true')
  document.body.append(root)
  const failures: string[] = []
  const exercised = new Set<string>()
  let session: ReturnType<typeof createPublishedCourseSession> | undefined
  let runFailure: unknown
  try {
  for (const { locationId, stateId, instanceIds } of targets) {
    const location = project.locations.find((entry) => entry.id === locationId)
    if (!location) throw new Error(`动态准入位置已失效：${locationId}`)
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)
    const initialStateId = stateId ?? (surface?.type === 'slide' && location.kind === 'slide-scene'
      ? surface.scenes.find(entry => entry.id === location.sceneId)?.presentation?.initialStateId : undefined)
    const frames: DynamicBehaviorFrame[] = []
    const actions: DynamicBehaviorObservation['actions'] = []
    let buttonClick: DynamicButtonObservation | undefined
    let startedAt = Date.now()
    let active = true
    const observation = () => frames.length ? dynamicBehaviorObservationSchema.parse({ version: 1, status: 'observed', mode: fullAdmission ? 'full-admission' : 'public-props',
      projectId: project.id, documentRevision: project.revision, locationId, stateId: initialStateId ?? null, instanceIds: [...instanceIds], sourceIdentities: sourceIdentities(project, resources, instanceIds),
      actions, frames, ...(buttonClick ? { buttonClick } : {}), elapsedMs: Math.max(0, Date.now() - startedAt), semanticVerdict: 'requires-review' }) : undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let hostFailure: AuthoringToolFailure | undefined
    try {
      const firstTarget = !session
      session ??= createPublishedCourseSession(payload, { initialLocationId: locationId,
        ...(initialStateId ? { initialPresentationStateId: initialStateId } : {}),
        resolveAsset: assetId => {
          const url = payload.assets[assetId]?.url
          if (!url) failures.push(`运行场景缺少实际请求的素材：${assetId}`)
          return url
        },
        onFailure: failure => { failures.push(String(failure.error)) } })
      const mountedSession = session
      await Promise.race([
        (async () => {
          if (firstTarget) await mountedSession.mount(root)
          else await mountedSession.goToObservationTarget(locationId, initialStateId)
          await waitForPublishedObservationReady(root)
          const currentMounts = () => Array.from(root.querySelectorAll<HTMLElement>('.published-component-mount, .published-slide-phaser-component-mount, .published-surface-runtime-mount, .published-canvas-runtime-mount')).filter(element => {
            // Reused sessions retain hidden hosts for other surfaces.
            const bounds = element.getBoundingClientRect()
            return bounds.width > 0 && bounds.height > 0
          })
          let mountedElements = currentMounts()
          const instanceId = (element: HTMLElement) => element.dataset.componentInstanceId ?? element.dataset.runtimeInstanceId
          const mountedIds = new Set(mountedElements.map(instanceId))
          for (const id of instanceIds) if (!mountedIds.has(id)) throw new Error(`候选实例 ${id} 未实际挂载`)
          const identities = sourceIdentities(project, resources, instanceIds)
          const stateOverrides = surface?.type === 'slide' && location.kind === 'slide-scene'
            ? surface.scenes.find(scene => scene.id === location.sceneId)?.presentation?.states.find(state => state.id === initialStateId)?.layerItemOverrides : undefined
          const exerciseKeys = mountedElements.filter(element => instanceIds.includes(instanceId(element) ?? '')).map(element =>
            JSON.stringify([surface?.type, instanceId(element), identities[instanceId(element)!], stateOverrides?.[instanceId(element)!], element.offsetWidth, element.offsetHeight]))
          const exerciseLifecycle = fullAdmission && exerciseKeys.some(key => !exercised.has(key))
          startedAt = Date.now()
          const sample = async (phase: DynamicBehaviorFrame['phase']) => {
            if (!active) throw new Error('动态观察已结束')
            if (!options.capturePort) return
            await waitForPublishedObservationReady(root)
            const state = mountedSession.readObservationState()
            if (phase !== 'paused' && !state.ready) throw new Error('动态观察宿主未就绪')
            if (phase !== 'after-button-click' && (state.locationId !== locationId || state.stateId !== (initialStateId ?? null))) throw new Error('动态观察期间组件改变了待检查的位置或状态，需要检查实际跳转目标')
            const capture = await options.capturePort.captureFrame()
            if (!active) throw new Error('动态观察已结束')
            captureBytes += capture.dataUrl.length
            if (captureBytes > 48_000_000) throw new Error('动态观察图面超过本轮资源上限')
            frames.push({ ...capture, phase, elapsedMs: Math.max(0, capture.capturedAt - startedAt), stateVersion: state.stateVersion, publicState: JSON.parse(JSON.stringify(state.publicState)) })
          }
          if (options.capturePort && exerciseLifecycle) for (const at of DYNAMIC_BEHAVIOR_SAMPLING.runningAtMs) {
            const wait = at - (Date.now() - startedAt)
            if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
            await sample('running')
          }
          if (!exerciseLifecycle) await sample('running')
          for (const element of mountedElements) {
            if (instanceIds.includes(instanceId(element) ?? '') && (fullAdmission || element.dataset.componentInstanceId)) await exercisePublishedDynamicUpdates(element, { resize: exerciseLifecycle })
          }
          actions.push('update-inputs')
          if (exerciseLifecycle) actions.push('resize-and-restore')
          if (exerciseLifecycle) {
          for (const element of mountedElements) if (instanceIds.includes(instanceId(element) ?? '')) await exercisePublishedDynamicLifecycle(element, 'suspend')
          actions.push('suspend')
          await sample('paused')
          if (options.capturePort) { await new Promise(resolve => setTimeout(resolve, DYNAMIC_BEHAVIOR_SAMPLING.pausedForMs)); await sample('paused') }
          for (const element of mountedElements) if (instanceIds.includes(instanceId(element) ?? '')) await exercisePublishedDynamicLifecycle(element, 'resume')
          actions.push('resume')
          if (options.capturePort) { await new Promise(resolve => setTimeout(resolve, DYNAMIC_BEHAVIOR_SAMPLING.resumedForMs)); await sample('resumed') }
          const suspended = await mountedSession.player.suspendSurface(location.surfaceId)
          if (!suspended.ok) throw suspended.failure?.error ?? new Error('动态候选无法挂起')
          const resumed = await mountedSession.player.resumeSurface(location.surfaceId)
          if (!resumed.ok) throw resumed.failure?.error ?? new Error('动态候选无法恢复')
          await waitForPublishedObservationReady(root)
          mountedElements = currentMounts()
          for (const id of instanceIds) if (!mountedElements.some(element => instanceId(element) === id)) throw new Error(`候选实例 ${id} 恢复后未实际挂载`)
          exerciseKeys.forEach(key => exercised.add(key))
          }
          if (captureInstances) for (const element of mountedElements) {
            const id = instanceId(element)
            if (!id || !instanceIds.includes(id) || captures.some(capture => capture.instanceId === id)) continue
            const width = Math.round(element.offsetWidth), height = Math.round(element.offsetHeight)
            if (width <= 0 || height <= 0 || width > 4096 || height > 4096) throw new Error(`实例 ${id} 的后备图面尺寸超限或不可见`)
            const dataUrl = await capturePublishedSurfacePng({ root: element, width, height, transparentBackground: true,
              layers: [{ element, x: 0, y: 0, width, height, rotation: 0, opacity: 1 }] })
            captureBytes += dataUrl.length
            if (captureBytes > 48_000_000) throw new Error('实例后备图面超过本轮资源上限')
            captures.push({ instanceId: id, locationId, width, height, dataUrl })
          }
          if (fullAdmission && (surface?.type === 'spatial-2d' || surface?.type === 'flow')) {
            // Flow's location JSON and Spatial's static camera pages are not
            // evidence that a candidate instance can prepare a capture. Probe
            // the mounted instances through the shared product capture barrier.
            await capturePublishedSurfacePng({ root, width: 1280, height: 720,
              layers: mountedElements.filter(element => instanceIds.includes(instanceId(element) ?? '')).map(element => {
                return { element, x: 0, y: 0, width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight), rotation: 0, opacity: 1 }
              }) })
          } else if (fullAdmission) {
            const capture = await mountedSession.player.captureSurface(location.surfaceId, { purpose: 'export', width: 1280, height: 720 })
            if (!capture.ok) throw new Error(`动态候选无法完成真实宿主捕获：${JSON.stringify(capture)}${failures.length ? `；${failures.join('；')}` : ''}`)
          }
          if (root.querySelector('.published-component-fallback, [data-runtime-fallback="true"], [data-slide-component-state="fallback"]')) throw new Error('动态候选触发了静态后备')
          if (failures.length) throw new Error(failures.join('\n'))
          if (options.buttonCheck && instanceIds.includes(options.buttonCheck.instanceId)) {
            // Code has completed the normal admission path. Only this private
            // instance receives one real input, never the editor's live session.
            const check = options.buttonCheck
            const button = resolveRuntimeDomButton(root, check.instanceId, check.label)
            const before = button.readText()
            await sample('before-button-click')
            if (!active) throw new Error('按钮检查已取消')
            const current = resolveRuntimeDomButton(root, check.instanceId, check.label)
            const clickedAt = Date.now()
            await options.capturePort!.clickAt!({ x: current.x, y: current.y })
            actions.push('click-button')
            const remainingObservation = DYNAMIC_BEHAVIOR_SAMPLING.buttonObserveForMs - (Date.now() - clickedAt)
            if (remainingObservation > 0) await new Promise(resolve => setTimeout(resolve, remainingObservation))
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            if (!active) throw new Error('按钮检查已取消')
            const after = button.readText()
            buttonClick = { version: 1, instanceId: check.instanceId, label: check.label, input: 'electron-mouse',
              x: current.x, y: current.y, beforeText: before.text, afterText: after.text,
              textTruncated: before.truncated || after.truncated, clickedAt, observedAt: Date.now(), functionalResult: 'requires-review' }
            await sample('after-button-click')
            if (failures.length) throw new Error(failures.join('\n'))
          }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('动态候选真实宿主准入超时')), 12_000) }),
      ])
      const evidence = observation()
      if (evidence) { observed.push(evidence); options.onBehaviorEvidence?.([evidence]) }
      options.onTargetComplete?.()
    } catch (error) {
      const evidence = observation()
      hostFailure = new AuthoringToolFailure(error instanceof AuthoringToolFailure ? error.diagnostics : [{ code: 'dynamic-host-failed', message: error instanceof Error ? error.message : String(error), path: ['locations', locationId, 'instances', ...instanceIds] }],
        [...observed, ...(evidence ? [evidence] : []), ...(error instanceof AuthoringToolFailure ? error.behaviorEvidence ?? [] : [])])
    } finally {
      active = false
      clearTimeout(timer)
    }
    if (hostFailure) throw hostFailure
    if (failures.length) throw new AuthoringToolFailure([{ code: 'dynamic-host-failed', message: failures.join('\n'), path: ['locations', locationId, 'instances', ...instanceIds] }], observed)
  }
  } catch (error) { runFailure = error }
  finally {
    try { await session?.destroy() }
    catch (error) { runFailure = new AuthoringToolFailure([...(runFailure instanceof AuthoringToolFailure ? runFailure.diagnostics : []),
      { code: 'dynamic-host-destroy-failed', message: error instanceof Error ? error.message : String(error), path: ['destroy'] }], runFailure instanceof AuthoringToolFailure ? runFailure.behaviorEvidence : observed) }
    finally { root.remove() }
  }
  if (runFailure) throw runFailure
  if (failures.length) throw new AuthoringToolFailure([{ code: 'dynamic-host-failed', message: failures.join('\n'), path: ['destroy'] }], observed)
  return captures
}
