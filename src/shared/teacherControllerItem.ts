import type { ComponentLayerItem } from './courseProjectTypes'
import { createDefaultTeacherControllerPackage } from './defaultTeacherControllerComponent'

/** Direct component factory: no intermediate native controller or conversion. */
export function createTeacherControllerComponentItem(id: string): ComponentLayerItem {
  const pkg = createDefaultTeacherControllerPackage()
  return { layerItemId: id, kind: 'component', role: 'teacher-controller', label: '教师控制台',
    frame: { mode: 'absolute', x: 200, y: 638, width: 880, height: 64 }, rotation: 0, opacity: 1, visible: true, locked: false,
    playbackInitialVisibility: 'inherit', order: 1, hitPolicy: 'auto',
    component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: structuredClone(pkg.manifest.defaultProps ?? {}) }
}
