import type { CourseProjectDocument, LayerItem } from '../../../shared/courseProjectTypes'
import type { HistoryResourceState } from '../../store/courseResourceState'
import { buildPublishedCourseV2Payload, collectPublishedCourseSourceIssues } from '../../export/course/buildPublishedCourse'
import { AuthoringToolFailure } from './executeAuthoringTool'
import { capturePublishedSurfacePng } from '../../../player/surfaces/publishedCapture'

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
  targets: readonly { locationId: string; stateId?: string | null; instanceIds: readonly string[] }[]): Promise<void> {
  const sources = { project, assetFiles: resources.assetFiles, components: resources.componentPackages }
  const issues = collectPublishedCourseSourceIssues(sources)
  if (issues.length) throw new AuthoringToolFailure(issues.map(issue => ({ ...issue, path: issue.path.map(String) })))
  if (typeof document === 'undefined' || !document.defaultView || !document.createElement('canvas').getContext('2d')) {
    throw new Error('动态工具需要产品浏览器中的真实 Published 宿主准入')
  }
  const { createPublishedCourseSession } = await import('../../../player/surfaces/publishedDynamicHosts')
  for (const { locationId, stateId, instanceIds } of targets) {
    const payload = buildPublishedCourseV2Payload({ ...sources, project: admissionProjection(project, instanceIds) })
    const location = project.locations.find((entry) => entry.id === locationId)
    if (!location) throw new Error(`动态准入位置已失效：${locationId}`)
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)
    const initialStateId = stateId ?? (surface?.type === 'slide' && location.kind === 'slide-scene'
      ? surface.scenes.find(entry => entry.id === location.sceneId)?.presentation?.initialStateId : undefined)
    const root = document.createElement('div')
    Object.assign(root.style, { position: 'fixed', left: '-1400px', top: '0', width: '1280px', height: '720px', pointerEvents: 'none' })
    root.setAttribute('aria-hidden', 'true')
    document.body.append(root)
    const failures: string[] = []
    let session: ReturnType<typeof createPublishedCourseSession> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      session = createPublishedCourseSession(payload, { initialLocationId: locationId,
        ...(initialStateId ? { initialPresentationStateId: initialStateId } : {}),
        onFailure: failure => { failures.push(String(failure.error)) } })
      const mountedSession = session
      await Promise.race([
        (async () => {
          await mountedSession.mount(root)
          const mountedElements = Array.from(root.querySelectorAll<HTMLElement>('.published-component-mount, .published-slide-phaser-component-mount, .published-surface-runtime-mount, .published-canvas-runtime-mount'))
          const instanceId = (element: HTMLElement) => element.dataset.componentInstanceId ?? element.dataset.runtimeInstanceId
          const mountedIds = new Set(mountedElements.map(instanceId))
          for (const id of instanceIds) if (!mountedIds.has(id)) throw new Error(`候选实例 ${id} 未实际挂载`)
          if (surface?.type === 'spatial-2d') {
            // Spatial export intentionally uses static camera pages. Probe the
            // actual mounted DOM instances with the same product capture barrier;
            // do not pretend its SVG playback world is an HTML export carrier.
            await capturePublishedSurfacePng({ root, width: 1280, height: 720,
              layers: mountedElements.filter(element => instanceIds.includes(instanceId(element) ?? '')).map(mount => {
                const element = mount.parentElement
                if (!element) throw new Error('组件捕获容器已卸载')
                return { element, x: 0, y: 0, width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight), rotation: 0, opacity: 1 }
              }) })
          } else {
            const capture = await mountedSession.player.captureSurface(location.surfaceId, { purpose: 'export', width: 1280, height: 720 })
            if (!capture.ok) throw new Error(`动态候选无法完成真实宿主捕获：${JSON.stringify(capture)}${failures.length ? `；${failures.join('；')}` : ''}`)
          }
          if (root.querySelector('.published-component-fallback, [data-runtime-fallback="true"], [data-slide-component-state="fallback"]')) throw new Error('动态候选触发了静态后备')
          if (failures.length) throw new Error(failures.join('\n'))
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('动态候选真实宿主准入超时')), 12_000) }),
      ])
    } catch (error) {
      throw new AuthoringToolFailure([{ code: 'dynamic-host-failed', message: error instanceof Error ? error.message : String(error), path: ['locations', locationId, 'instances', ...instanceIds] }])
    } finally {
      clearTimeout(timer)
      try { await session?.destroy() } finally { root.remove() }
    }
    if (failures.length) throw new Error(failures.join('\n'))
  }
}
