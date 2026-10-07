import type { PublishedCourseV3 } from '../../shared/contracts/component-platform/published'
import { mountPublishedCourseV3, publishedComponentModel } from './publishedPlayer'
import { componentSurfaceGeometryTargets } from './spatialTargets'
import { spatialFramePose } from '../surfaces/spatial/componentPlatform/graph'

export interface ComponentOutputImage { dataUrl: string; width: number; height: number }
export interface ComponentOutputCaptureOptions {
  payload: PublishedCourseV3
  root: HTMLElement
  screenshot(rect: { x: number; y: number; width: number; height: number }): Promise<ComponentOutputImage>
}

/** Camera and local-frame preparation is shared by isolated observation and output capture. */
export async function prepareComponentOutputRegion(input: {
  payload: PublishedCourseV3; root: HTMLElement; player: Awaited<ReturnType<typeof mountPublishedCourseV3>>;
  surfaceId: string; instanceId?: string; spatialFrameId?: string;
}): Promise<{ x: number; y: number; width: number; height: number }> {
  const { payload, root, player, surfaceId, instanceId, spatialFrameId } = input
  const surface = payload.surfaces.find(value => value.id === surfaceId)
  if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
  if (spatialFrameId) {
    const frame = surface.spatial?.frames.find(value => value.id === spatialFrameId), camera = player.camera(surfaceId)
    if (!frame || !camera) throw new Error(`捕获镜头已不存在：${spatialFrameId}`)
    camera.set(spatialFramePose(frame, player.viewport(surfaceId) ?? surface.designSize ?? { width: 960, height: 640 }, componentSurfaceGeometryTargets(publishedComponentModel(payload).project, surfaceId)))
  }
  const element = instanceId ? player.runtime.contentElement(instanceId) : root
  if (!element) throw new Error(`捕获组件没有运行内容：${instanceId}`)
  await player.waitForCaptureReady(element)
  if (instanceId) {
    const target = player.runtime.targetElement(instanceId)
    if (!target) throw new Error(`捕获组件没有本地投影：${instanceId}`)
    // Office applies the authored frame itself. Capture only local professional pixels.
    const local = root.ownerDocument.createElement('div')
    local.dataset.componentLocalCapture = instanceId
    const frame = payload.instances[instanceId]?.frame
    const width = frame?.width ?? target.offsetWidth, height = frame?.height ?? target.offsetHeight
    const scale = Math.min(1, root.clientWidth / Math.max(1, width), root.clientHeight / Math.max(1, height))
    Object.assign(local.style, { position: 'absolute', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`,
      transform: `scale(${scale})`, transformOrigin: '0 0', background: 'white', zIndex: '10' })
    root.append(local)
    player.runtime.beforeProjectionMutation()
    local.append(target)
    Object.assign(target.style, { position: 'relative', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, maxWidth: 'none', margin: '0px', float: 'none', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    // Flow's reading-lane fitting also belongs to its projection, never the
    // instance-local Office bitmap. The authored local frame remains 1:1.
    Object.assign(element.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    // The Flow stage can still have a fitted extent/height between target and
    // content. Reset that projection wrapper too, so 100% means the local frame.
    for (let wrapper = element.parentElement; wrapper && wrapper !== target; wrapper = wrapper.parentElement) {
      Object.assign(wrapper.style, { position: 'absolute', inset: '0px', width: '100%', height: '100%', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' })
    }
    player.runtime.afterProjectionMutation()
    for (const outer of root.querySelectorAll<HTMLElement>('[data-component-object],[data-component-instance-id]')) {
      const ownerId = outer.dataset.componentObject ?? outer.dataset.componentInstanceId
      if (ownerId !== instanceId && !outer.contains(target)) outer.hidden = true
    }
    target.hidden = false
  }
  const view = root.ownerDocument.defaultView
  if (!view) throw new Error('捕获窗口已关闭')
  await root.ownerDocument.fonts?.ready
  await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())))
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) throw new Error('捕获目标没有可见运行尺寸')
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Every image starts a fresh author-initial run of the supplied immutable payload. */
export async function prepareComponentOutputCapture(options: ComponentOutputCaptureOptions) {
  let disposed = false, current: Awaited<ReturnType<typeof mountPublishedCourseV3>> | undefined
  let queue = Promise.resolve()
  const capture = (surfaceId: string, instanceId?: string, spatialFrameId?: string): Promise<ComponentOutputImage> => {
    const work = queue.then(async () => {
      if (disposed) throw new Error('输出捕获已结束')
      const surface = options.payload.surfaces.find(value => value.id === surfaceId)
      if (!surface) throw new Error(`捕获表面已不存在：${surfaceId}`)
      current = await mountPublishedCourseV3(options.payload, options.root, { initialSurfaceId: surfaceId, capture: true, keyboardNavigation: false })
      try {
        if (disposed) throw new Error('输出捕获已结束')
        const rect = await prepareComponentOutputRegion({ payload: options.payload, root: options.root, player: current,
          surfaceId, instanceId, spatialFrameId })
        return await options.screenshot({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      } finally { await current.dispose(); current = undefined; options.root.querySelector('[data-component-local-capture]')?.remove() }
    })
    queue = work.then(() => {}, () => {})
    return work
  }
  return {
    captureInstance: (surfaceId: string, instanceId: string) => capture(surfaceId, instanceId),
    captureSurface: (surfaceId: string, spatialFrameId?: string) => capture(surfaceId, undefined, spatialFrameId),
    async dispose() { if (disposed) return; disposed = true; await current?.dispose(); await queue },
  }
}
