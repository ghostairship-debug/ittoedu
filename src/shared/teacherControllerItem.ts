import type { ComponentLayerItem } from './courseProjectTypes'
import { createDefaultTeacherControllerPackage } from './defaultTeacherControllerComponent'
import { DEFAULT_SLIDE_CANVAS, type SlideCanvasSize } from './slideCanvas'

/** Bottom centre of the page and inside it on any canvas (M19): 880×64 at (200, 638) on 1280×720. */
export function defaultTeacherControllerFrame(canvas: Readonly<SlideCanvasSize> = DEFAULT_SLIDE_CANVAS) {
  const height = 64, width = Math.min(880, Math.max(160, canvas.width - 40))
  return { mode: 'absolute' as const, x: Math.round((canvas.width - width) / 2), y: canvas.height - height - 18, width, height }
}

/** Direct component factory: no intermediate native controller or conversion. */
export function createTeacherControllerComponentItem(id: string, canvas?: Readonly<SlideCanvasSize>): ComponentLayerItem {
  const pkg = createDefaultTeacherControllerPackage()
  return { layerItemId: id, kind: 'component', role: 'teacher-controller', label: '教师控制台',
    frame: defaultTeacherControllerFrame(canvas), rotation: 0, opacity: 1, visible: true, locked: false,
    playbackInitialVisibility: 'inherit', order: 1, hitPolicy: 'auto',
    component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: structuredClone(pkg.manifest.defaultProps ?? {}) }
}
