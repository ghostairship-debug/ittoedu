import {
  composeMatrices, invertMatrix, rotationMatrix, scaleMatrix, transformPoint,
  transformVector, translationMatrix, type AffineMatrix, type GeometryPoint,
} from '../../../../core/components/geometry'

import type { ComponentCameraMotion, ComponentCameraPose } from '../../../../shared/contracts/component-platform/navigationMotion'
import { componentCameraMotionSchema } from '../../../../shared/contracts/component-platform/navigationMotion'

/** A view pose. It does not change object frames or runtime instance identity. */
export type ComponentSpatialCamera = ComponentCameraPose
export interface ComponentSpatialViewport { x: number; y: number; width: number; height: number }

function checked(camera: ComponentSpatialCamera): ComponentSpatialCamera {
  if (![camera.x, camera.y, camera.zoom, camera.rotation ?? 0].every(Number.isFinite) || camera.zoom <= 0) {
    throw new RangeError('空间镜头位置和旋转必须有限，倍率必须大于零')
  }
  return { ...camera }
}

/** Maps world coordinates to client CSS pixels, including the viewport's origin. */
export function componentSpatialCameraMatrix(camera: ComponentSpatialCamera, viewport: ComponentSpatialViewport): AffineMatrix {
  checked(camera)
  return composeMatrices(
    translationMatrix(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2),
    rotationMatrix(-(camera.rotation ?? 0) * Math.PI / 180), scaleMatrix(camera.zoom),
    translationMatrix(-camera.x, -camera.y),
  )
}

export function panComponentSpatialCamera(camera: ComponentSpatialCamera, delta: GeometryPoint): ComponentSpatialCamera {
  const worldDelta = transformVector(invertMatrix(componentSpatialCameraMatrix(camera, { x: 0, y: 0, width: 1, height: 1 })), delta)
  return checked({ ...camera, x: camera.x - worldDelta.x, y: camera.y - worldDelta.y })
}

export function zoomComponentSpatialCamera(camera: ComponentSpatialCamera, zoom: number, anchor: GeometryPoint, viewport: ComponentSpatialViewport): ComponentSpatialCamera {
  const before = transformPoint(invertMatrix(componentSpatialCameraMatrix(camera, viewport)), anchor)
  const next = checked({ ...camera, zoom })
  const after = transformPoint(invertMatrix(componentSpatialCameraMatrix(next, viewport)), anchor)
  return checked({ ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y })
}

export interface ComponentSpatialCameraPort {
  read(): ComponentSpatialCamera
  set(pose: ComponentSpatialCamera): void
  subscribe(listener: (pose: ComponentSpatialCamera) => void): () => void
  /** A cancelled request never snaps to its old target. Latest request replaces it. */
  present(pose: ComponentSpatialCamera, options?: ComponentCameraMotion & { signal?: AbortSignal }): Promise<boolean>
  dispose(): void
}

export interface SpatialFrameClock {
  now(): number
  request(callback: (time: number) => void): number
  cancel(handle: number): void
}

/** Session/view state only. Author frame/path changes go through the canonical writer. */
export function createComponentSpatialCameraPort(initial: ComponentSpatialCamera, clock?: SpatialFrameClock): ComponentSpatialCameraPort {
  const scheduler: SpatialFrameClock = clock ?? {
    now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: handle => cancelAnimationFrame(handle),
  }
  let current = checked(initial)
  let disposed = false
  let cancelPresentation: (() => void) | undefined
  const listeners = new Set<(pose: ComponentSpatialCamera) => void>()
  const notify = (pose: ComponentSpatialCamera) => {
    if (disposed) return
    current = checked(pose)
    for (const listener of listeners) listener({ ...current })
  }
  return {
    read: () => ({ ...current }),
    set(pose) { cancelPresentation?.(); notify(pose) },
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    present(pose, options = {}) {
      if (disposed || options.signal?.aborted) return Promise.resolve(false)
      const { signal: _signal, ...motion } = options
      componentCameraMotionSchema.parse(motion)
      const to = checked(pose), from = { ...current }
      const stops = [{ offset: 0, pose: from, easing: options.easing }, ...(options.keyframes ?? []), { offset: 1, pose: to }]
      const samplers: Animation[] = []
      let curves: ((progress: number) => number)[]
      try {
        curves = stops.slice(0, -1).map(stop => {
          const easing = stop.easing ?? options.easing
          if (!easing) return (t: number) => t * t * (3 - 2 * t)
          if (easing === 'linear') return (t: number) => t
          // Browser timing evaluates arbitrary CSS curves without owning or writing a pose.
          const effect = new KeyframeEffect(null, [], { duration: 1, easing, fill: 'both' })
          const sampler = new Animation(effect); samplers.push(sampler)
          return (t: number) => { sampler.currentTime = t; return effect.getComputedTiming().progress ?? t }
        })
      } catch (error) { samplers.forEach(sampler => sampler.cancel()); throw error }
      cancelPresentation?.()
      const duration = options.durationMs ?? 0
      if (duration === 0) { samplers.forEach(sampler => sampler.cancel()); notify(to); return Promise.resolve(true) }
      return new Promise<boolean>(resolve => {
        const start = scheduler.now()
        let handle: number | undefined
        let done = false
        const finish = (success: boolean) => {
          if (done) return
          done = true
          if (handle !== undefined) scheduler.cancel(handle)
          samplers.forEach(sampler => sampler.cancel())
          options.signal?.removeEventListener('abort', abort)
          if (cancelPresentation === abort) cancelPresentation = undefined
          resolve(success)
        }
        const abort = () => finish(false)
        cancelPresentation = abort
        options.signal?.addEventListener('abort', abort, { once: true })
        const tick = (time: number) => {
          if (done || disposed || options.signal?.aborted) { finish(false); return }
          const t = Math.min(1, Math.max(0, (time - start) / duration))
          let index = stops.findIndex((stop, index) => index > 0 && t <= stop.offset) - 1
          if (index < 0) index = stops.length - 2
          const segmentStart = stops[index]!, end = stops[index + 1]!
          const eased = curves[index]!((t - segmentStart.offset) / (end.offset - segmentStart.offset))
          const left = segmentStart.pose, right = end.pose
          const angle = (((right.rotation ?? 0) - (left.rotation ?? 0) + 180) % 360 + 360) % 360 - 180
          notify({ x: left.x + (right.x - left.x) * eased, y: left.y + (right.y - left.y) * eased,
            zoom: Math.exp(Math.log(left.zoom) + (Math.log(right.zoom) - Math.log(left.zoom)) * eased),
            rotation: (left.rotation ?? 0) + angle * eased })
          if (done) return
          if (t === 1) { notify(to); finish(true) }
          else handle = scheduler.request(tick)
        }
        handle = scheduler.request(tick)
      })
    },
    dispose() { cancelPresentation?.(); disposed = true; listeners.clear() },
  }
}
