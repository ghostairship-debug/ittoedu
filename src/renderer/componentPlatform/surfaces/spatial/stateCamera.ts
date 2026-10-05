import { createComponentSpatialCameraPort, type ComponentSpatialCamera, type ComponentSpatialCameraPort } from '../../../../player/surfaces/spatial/componentSpatialAdapter'

/** Camera presentation delegates its sole current value to the existing Surface ViewState. */
export function createSpatialStateCameraPort(backing: {
  read(): ComponentSpatialCamera
  set(pose: ComponentSpatialCamera): void
  subscribe(listener: (pose: ComponentSpatialCamera) => void): () => void
}): ComponentSpatialCameraPort {
  let active: ComponentSpatialCameraPort | undefined
  let writing = false, disposed = false
  const stops = new Set<() => void>()
  const stopWatch = backing.subscribe(() => { if (!writing) { active?.dispose(); active = undefined } })
  return {
    read: () => ({ ...backing.read() }),
    set(pose) { if (disposed) return; active?.dispose(); active = undefined; backing.set(pose) },
    subscribe(listener) {
      if (disposed) return () => {}
      const off = backing.subscribe(listener)
      const stop = () => { stops.delete(stop); off() }; stops.add(stop); return stop
    },
    async present(pose, options) {
      active?.dispose()
      if (disposed) return false
      const tween = createComponentSpatialCameraPort(backing.read()); active = tween
      const stop = tween.subscribe(value => {
        if (active !== tween || disposed) return
        writing = true
        try { backing.set(value) } finally { writing = false }
      })
      try { return await tween.present(pose, options) }
      finally { stop(); tween.dispose(); if (active === tween) active = undefined }
    },
    dispose() { disposed = true; active?.dispose(); active = undefined; stopWatch(); for (const stop of [...stops]) stop() },
  }
}
