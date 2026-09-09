import type { PublishedRuntimeLayerItem } from '../../../shared/publishedCourseTypes'

/** API 2 DOM Runtime has no full-frame input plane; its controls opt in individually. */
export function isPublishedDomCanvasRuntime(runtime: PublishedRuntimeLayerItem['runtime']): boolean {
  return runtime.protocol === 'canvas-runtime'
    && runtime.runtimeApiVersion === 2
    && runtime.renderMode === 'dom'
}
